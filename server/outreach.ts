import crypto from "node:crypto";
import type { CadenceStep, CampaignStep, Reservation } from "@shared/schema";
import { localToUtc, timeLabel, dateLabel } from "@shared/time";
import { storage } from "./storage";
import { sendSms, sendEmail, placeCall } from "./providers";

let clientOrigin = "";
export function setClientOrigin(o: string) { if (o && /^https?:\/\//.test(o)) clientOrigin = o; }

export function portalLink(r: Reservation): string {
  const s = storage.getSettings(r.locationId);
  const base = (s.publicBaseUrl || clientOrigin || "").replace(/#.*$/, "");
  return `${base}#/r/${r.outreachToken}`;
}

export function isActive(r: Reservation) { return r.status === "booked" || r.status === "confirmed"; }

export function newToken() { return crypto.randomBytes(18).toString("base64url"); }

/** Message copy. Ed's line is the SMS / email body. */
export function messageFor(channel: string, r: Reservation): { sms: string; subject: string; email: string } {
  const loc = storage.getLocation(r.locationId);
  const st = storage.getSettings(r.locationId);
  const name = st.restaurantName || loc?.name || "the restaurant";
  const first = r.guestName.split(" ")[0];
  const when = `${dateLabel(r.date, { weekday: "long", month: "long", day: "numeric" })} at ${timeLabel(r.time)}`;
  const link = portalLink(r);
  const phone = loc?.phone || "us";
  const base = `Hi ${first}, confirming your reservation for ${r.partySize} at ${name} on ${when}. ` +
    `If you have not already, please click here to add a credit card or to change your reservation before it's too late: ${link}. ` +
    `Reply CONFIRM to confirm, or call ${phone}. Reply STOP to opt out.`;
  if (channel === "sms_final") {
    const sms = `${name}: we still don't have a card on file for your party of ${r.partySize} tonight at ${timeLabel(r.time)}. ` +
      `Card not received — your table may be released. Add it here: ${link}`;
    return { sms, subject: `Action needed: card for your ${r.partySize}-person table`, email: sms };
  }
  if (channel === "confirm") {
    const sms = `${name}: thank you, ${first}. Your card is on file and your table for ${r.partySize} on ${when} is confirmed. ` +
      `No charge unless the party no-shows. Need changes? ${link}`;
    return { sms, subject: `You're confirmed: ${r.partySize} guests, ${when}`, email: sms };
  }
  return { sms: base, subject: `Please confirm your reservation for ${r.partySize} on ${when}`, email: base };
}

export function voiceScript(r: Reservation): string {
  const loc = storage.getLocation(r.locationId);
  const name = storage.getSettings(r.locationId).restaurantName || loc?.name || "the restaurant";
  return `Hi, this is ${name} confirming your party of ${r.partySize} at ${timeLabel(r.time)} on ${dateLabel(r.date, { weekday: "long", month: "long", day: "numeric" })}. ` +
    `For groups this size we do need a card on file. I'll text you a secure link now, or I can take it by phone. Should I send the link?`;
}

/**
 * Create / refresh / retire the campaign for a reservation after any change.
 * Party >= threshold and active -> card required, steps scheduled.
 * Steps whose time already passed are skipped, but the most recent one is sent
 * right away so a late booking still gets the ask.
 */
export function syncCampaign(resId: number): Reservation | undefined {
  let r = storage.getReservation(resId);
  if (!r) return;
  const rules = storage.getRules(r.locationId);
  const needs = r.partySize >= rules.cardThreshold && isActive(r);
  if (!r.outreachToken) r = storage.updateReservation(r.id, { outreachToken: newToken() })!;

  if (!needs) {
    storage.cancelScheduledSteps(r.id, r.partySize < rules.cardThreshold ? "Party below threshold" : `Reservation ${r.status}`);
    if (r.requiresCard && r.cardStatus !== "on_file") r = storage.updateReservation(r.id, { requiresCard: false, cardStatus: "not_required" })!;
    else if (r.requiresCard && r.partySize < rules.cardThreshold) r = storage.updateReservation(r.id, { requiresCard: false })!;
    return r;
  }
  if (!r.requiresCard || r.cardStatus === "not_required") {
    r = storage.updateReservation(r.id, { requiresCard: true, cardStatus: r.cardStatus === "on_file" ? "on_file" : "none" })!;
  }
  if (r.cardStatus === "on_file" || r.optedOut) { storage.cancelScheduledSteps(r.id, r.optedOut ? "Guest opted out" : "Card on file"); return r; }

  const resAt = localToUtc(r.date, r.time).getTime();
  const now = Date.now();
  const cadence: CadenceStep[] = JSON.parse(rules.cadence || "[]");
  const existing = storage.listSteps(r.id).filter((s) => s.channel !== "confirm");

  // Reschedule if the reservation time moved: cancel pending and rebuild
  const pending = existing.filter((s) => s.status === "scheduled");
  const stale = pending.some((s) => {
    const expect = resAt - s.offsetHours * 3600000;
    return Math.abs(new Date(s.sendAt).getTime() - expect) > 60000 && new Date(s.sendAt).getTime() > now + 60000;
  });
  if (stale) storage.cancelScheduledSteps(r.id, "Reservation time changed");
  const live = storage.listSteps(r.id).filter((s) => s.channel !== "confirm" && s.status !== "cancelled");
  const have = new Set(live.map((s) => s.offsetHours));
  const sentAny = live.some((s) => s.status === "sent");

  const past: CadenceStep[] = [];
  for (const c of [...cadence].sort((a, b) => b.offsetHours - a.offsetHours)) {
    if (have.has(c.offsetHours)) continue;
    const sendAt = resAt - c.offsetHours * 3600000;
    if (sendAt > now) {
      storage.createStep({ reservationId: r.id, offsetHours: c.offsetHours, channel: c.channel, sendAt: new Date(sendAt).toISOString(), status: "scheduled", providerId: "", detail: "", sentAt: "" });
    } else past.push(c);
  }
  if (resAt > now && past.length) {
    // catch-up: send the latest missed step now (unless we already sent one), skip the rest
    const latest = past[past.length - 1];
    past.forEach((c) => {
      const catchUp = c === latest && !sentAny;
      storage.createStep({
        reservationId: r!.id, offsetHours: c.offsetHours, channel: catchUp && c.channel === "email" ? "sms_email" : c.channel,
        sendAt: catchUp ? new Date(now).toISOString() : new Date(resAt - c.offsetHours * 3600000).toISOString(),
        status: catchUp ? "scheduled" : "skipped", providerId: "", detail: catchUp ? "Booked inside window — sent immediately" : "Booked after this step's time",
        sentAt: "",
      });
    });
  }
  return storage.getReservation(r.id);
}

async function deliver(step: CampaignStep, r: Reservation): Promise<{ ok: boolean; providerId: string; detail: string }> {
  const s = storage.getSettings(r.locationId);
  const msg = messageFor(step.channel, r);
  const results: string[] = [];
  let ok = true; let pid = "";
  const wantSms = ["sms", "sms_email", "sms_final", "confirm"].includes(step.channel);
  const wantEmail = ["email", "sms_email", "confirm", "sms_final"].includes(step.channel);
  if (wantSms) {
    const x = await sendSms(s, r.phone, msg.sms);
    storage.addEvent(r.id, "sms_out", "sms", x.ok ? msg.sms : `FAILED: ${x.detail}`);
    results.push(`SMS ${x.ok ? "sent" : "failed: " + x.detail}`); ok = ok && x.ok; pid = pid || x.providerId;
  }
  if (wantEmail && (r.email || step.channel === "email")) {
    const html = `<p>${msg.email.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>`;
    const x = await sendEmail(s, r.email, msg.subject, msg.email, html);
    storage.addEvent(r.id, "email_out", "email", x.ok ? `${msg.subject}\n\n${msg.email}` : `FAILED: ${x.detail}`);
    results.push(`Email ${x.ok ? "sent" : "failed: " + x.detail}`); ok = ok && x.ok; pid = pid || x.providerId;
  }
  if (step.channel === "voice") {
    const script = voiceScript(r);
    const rules = storage.getRules(r.locationId);
    const x = await placeCall(s, s.synthflowCardAgentId || s.synthflowAgentId, r.phone, r.guestName, {
      guest_name: r.guestName, party_size: String(r.partySize), reservation_time: timeLabel(r.time),
      reservation_date: dateLabel(r.date, { weekday: "long", month: "long", day: "numeric" }), card_link: portalLink(r), script,
      restaurant_name: s.restaurantName || storage.getLocation(r.locationId)?.name || "the restaurant",
      no_show_policy: `$${(rules.noShowFeeCents / 100).toFixed(0)} per guest if the party doesn't show`,
    });
    const call = storage.createCall({
      locationId: r.locationId, reservationId: r.id, intent: "card_capture", status: x.ok ? (s.mockMode ? "completed" : "queued") : "failed",
      outcome: x.ok && s.mockMode ? "link_requested" : x.ok ? "" : x.detail,
      transcript: x.ok && s.mockMode ? `AGENT: ${script}\nGUEST: Sure, text me the link.\nAGENT: Done — it's on its way. See you soon.` : "",
      providerId: x.providerId, createdAt: new Date().toISOString(),
    });
    storage.addEvent(r.id, "call_out", "voice", x.ok ? `Card-capture call #${call.id}${s.mockMode ? " (demo): guest asked for the link" : " queued"}` : `FAILED: ${x.detail}`);
    results.push(`Call ${x.ok ? "placed" : "failed: " + x.detail}`); ok = ok && x.ok; pid = x.providerId;
    if (x.ok) { // the agent tells the guest a link is on its way, so send it with the call
      const y = await sendSms(s, r.phone, `${messageFor("sms", r).sms}`);
      storage.addEvent(r.id, "sms_out", "sms", y.ok ? `Link text after call: ${portalLink(r)}` : `FAILED: ${y.detail}`);
    }
  }
  return { ok, providerId: pid, detail: results.join(" · ") + (s.mockMode ? " (demo mode)" : "") };
}

export async function runStep(stepId: number, force = false) {
  const step = storage.getStep(stepId);
  if (!step) return;
  const r = storage.getReservation(step.reservationId);
  if (!r) return;
  if (!force && step.channel !== "confirm") {
    const why = !isActive(r) ? `Reservation ${r.status}` : r.optedOut ? "Guest opted out" : r.cardStatus === "on_file" ? "Card on file" : !r.requiresCard ? "Card not required" : "";
    if (why) { storage.updateStep(step.id, { status: "cancelled", detail: why }); return; }
  }
  // claim the step first so the 30s ticker can't double-send
  storage.updateStep(step.id, { status: "sending" });
  try {
    const out = await deliver(step, r);
    storage.updateStep(step.id, { status: out.ok ? "sent" : "failed", providerId: out.providerId, detail: out.detail, sentAt: new Date().toISOString() });
  } catch (e: any) {
    storage.updateStep(step.id, { status: "failed", detail: String(e?.message || e), sentAt: new Date().toISOString() });
  }
}

/** Manager "resend": creates a one-off step that fires now. */
export async function resendNow(resId: number, channel: string) {
  const r = storage.getReservation(resId);
  if (!r) throw new Error("Reservation not found");
  const step = storage.createStep({ reservationId: r.id, offsetHours: -1, channel, sendAt: new Date().toISOString(), status: "scheduled", providerId: "", detail: "Manual resend", sentAt: "" });
  await runStep(step.id, true);
  return storage.getStep(step.id);
}

export async function markCardOnFile(resId: number, card: { brand: string; last4: string; paymentMethodId: string }) {
  const r = storage.getReservation(resId);
  if (!r) return;
  storage.updateReservation(r.id, { cardStatus: "on_file", cardBrand: card.brand, cardLast4: card.last4, paymentMethodId: card.paymentMethodId, status: r.status === "booked" ? "confirmed" : r.status });
  storage.cancelScheduledSteps(r.id, "Card on file");
  storage.addEvent(r.id, "card_saved", "web", `${card.brand.toUpperCase()} ending ${card.last4} saved`);
  const step = storage.createStep({ reservationId: r.id, offsetHours: 0, channel: "confirm", sendAt: new Date().toISOString(), status: "scheduled", providerId: "", detail: "Confirmation after card saved", sentAt: "" });
  await runStep(step.id, true);
}

export async function handleReply(r: Reservation, body: string) {
  const word = body.trim().toUpperCase().split(/\s+/)[0] || "";
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(word)) {
    storage.updateReservation(r.id, { optedOut: true });
    storage.cancelScheduledSteps(r.id, "Guest replied STOP");
    storage.addEvent(r.id, "reply_stop", "sms", body);
    return "stopped";
  }
  if (["CONFIRM", "YES", "Y", "C"].includes(word)) {
    storage.updateReservation(r.id, { status: "confirmed" });
    storage.addEvent(r.id, "reply_confirm", "sms", body);
    return "confirmed";
  }
  storage.addEvent(r.id, "note", "sms", `Inbound: ${body}`);
  return "logged";
}

let ticking = false;
export function startScheduler() {
  const tick = async () => {
    if (ticking) return; ticking = true;
    try {
      for (const s of storage.dueSteps(new Date().toISOString())) await runStep(s.id);
    } catch (e) { console.error("scheduler", e); } finally { ticking = false; }
  };
  setInterval(tick, 30000);
  setTimeout(tick, 2000);
}

/** Campaign status rollup for the host stand. */
export function riskLevel(r: Reservation): "on_file" | "pending" | "no_card" | "at_risk" | "opted_out" | "inactive" {
  if (!isActive(r)) return "inactive";
  if (r.cardStatus === "on_file") return "on_file";
  if (r.optedOut) return "opted_out";
  const hrs = (localToUtc(r.date, r.time).getTime() - Date.now()) / 3600000;
  if (hrs <= 4) return "at_risk";
  if (r.cardStatus === "pending") return "pending";
  return "no_card";
}
