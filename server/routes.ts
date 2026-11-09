import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { z } from "zod";
import { storage } from "./storage";
import { reservationInputSchema, insertLocationSchema } from "@shared/schema";
import { localToUtc, localToday } from "@shared/time";
import { generatePlan, walkInAvailability } from "./seating";
import {
  syncCampaign, startScheduler, resendNow, markCardOnFile, handleReply, riskLevel,
  setClientOrigin, portalLink, messageFor, voiceScript, isActive,
} from "./outreach";
import {
  createSetupCheckout, getSetupIntent, chargeOffSession, verifyStripeSignature, placeCall,
} from "./providers";
import { seedIfEmpty } from "./seed";
import { detectTables } from "./vision";
import { toMin } from "@shared/time";

const id = (req: Request, k = "id") => Number(req.params[k]);
const SECRET_FIELDS = ["synthflowKey", "stripeSecretKey", "stripeWebhookSecret", "twilioToken", "resendKey", "openaiKey"] as const;

function maskSettings(s: any) {
  const out: any = { ...s };
  for (const f of SECRET_FIELDS) out[f] = s[f] ? `••••${String(s[f]).slice(-4)}` : "";
  return out;
}

function luhn(num: string) {
  let sum = 0; let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number(num[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
function brandOf(num: string) {
  if (/^4/.test(num)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(num)) return "mastercard";
  if (/^3[47]/.test(num)) return "amex";
  if (/^6(011|5)/.test(num)) return "discover";
  return "card";
}

function bigPartyView(r: any) {
  return { ...r, risk: riskLevel(r), steps: storage.listSteps(r.id), events: storage.listEvents(r.id).slice(0, 30), link: portalLink(r) };
}

function portalView(r: any) {
  const loc = storage.getLocation(r.locationId);
  const rules = storage.getRules(r.locationId);
  const s = storage.getSettings(r.locationId);
  const hrs = (localToUtc(r.date, r.time).getTime() - Date.now()) / 3600000;
  return {
    guestName: r.guestName, partySize: r.partySize, date: r.date, time: r.time, status: r.status,
    requiresCard: r.requiresCard, cardStatus: r.cardStatus, cardBrand: r.cardBrand, cardLast4: r.cardLast4,
    restaurant: s.restaurantName || loc?.name || "", city: loc ? `${loc.city}${loc.state ? ", " + loc.state : ""}` : "",
    phone: loc?.phone || "", noShowFeeCents: rules.noShowFeeCents, threshold: rules.cardThreshold,
    canModify: isActive(r) && hrs > 2, hoursUntil: hrs, mockMode: s.mockMode,
  };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await seedIfEmpty();
  startScheduler();

  app.post("/api/client-origin", (req, res) => { setClientOrigin(String(req.body?.origin || "")); res.json({ ok: true }); });

  // ---------- locations ----------
  app.get("/api/locations", (_req, res) => {
    res.json(storage.listLocations().map((l) => ({
      ...l,
      tableCount: storage.listTables(l.id).length,
      todayCount: storage.listReservations(l.id, localToday()).filter((r) => isActive(r) || r.status === "seated").length,
    })));
  });
  app.post("/api/locations", (req, res) => {
    const p = insertLocationSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.message });
    res.json(storage.createLocation(p.data));
  });
  app.patch("/api/locations/:id", (req, res) => res.json(storage.updateLocation(id(req), req.body)));

  // ---------- rooms (floor-plan images) ----------
  const ensureRooms = (locationId: number) => {
    let list = storage.listRooms(locationId);
    if (!list.length) {
      const r = storage.createRoom({ locationId, name: "Main dining", area: "inside", sortOrder: 0, imageData: "", imageW: 0, imageH: 0 });
      for (const t of storage.listTables(locationId)) if (!t.roomId) storage.updateTable(t.id, { roomId: r.id });
      list = [r];
    }
    return list;
  };
  const roomOut = (r: any, withImage = true) => (withImage ? r : { ...r, imageData: r.imageData ? "yes" : "" });
  app.get("/api/locations/:id/rooms", (req, res) => res.json(ensureRooms(id(req)).map((r) => roomOut(r))));
  const roomBody = z.object({
    name: z.string().min(1).max(60).optional(),
    area: z.enum(["inside", "patio", "bar", "ballroom"]).optional(),
    sortOrder: z.coerce.number().int().optional(),
    imageData: z.string().max(12_000_000).refine((v) => v === "" || /^data:image\/(png|jpeg|webp);base64,/.test(v), "Image must be PNG, JPEG or WebP").optional(),
    imageW: z.coerce.number().int().min(0).max(10000).optional(),
    imageH: z.coerce.number().int().min(0).max(10000).optional(),
  });
  app.post("/api/locations/:id/rooms", (req, res) => {
    const b = roomBody.safeParse(req.body);
    if (!b.success || !b.data.name) return res.status(400).json({ message: "Room name is required" });
    const n = storage.listRooms(id(req)).length;
    res.json(storage.createRoom({ locationId: id(req), name: b.data.name, area: b.data.area || "inside", sortOrder: b.data.sortOrder ?? n,
      imageData: b.data.imageData || "", imageW: b.data.imageW || 0, imageH: b.data.imageH || 0 }));
  });
  app.patch("/api/rooms/:id", (req, res) => {
    const b = roomBody.safeParse(req.body);
    if (!b.success) return res.status(400).json({ message: b.error.issues[0]?.message || "Invalid room" });
    if (!storage.getRoom(id(req))) return res.status(404).json({ message: "Room not found" });
    res.json(storage.updateRoom(id(req), b.data));
  });
  app.delete("/api/rooms/:id", (req, res) => {
    const r = storage.getRoom(id(req));
    if (!r) return res.status(404).json({ message: "Room not found" });
    if (storage.listRooms(r.locationId).length <= 1) return res.status(400).json({ message: "A location needs at least one room" });
    storage.deleteRoom(r.id);
    res.json({ ok: true });
  });
  // Read tables from the uploaded image with a vision model (needs an OpenAI key in Settings).
  app.post("/api/rooms/:id/detect", async (req, res) => {
    const r = storage.getRoom(id(req));
    if (!r) return res.status(404).json({ message: "Room not found" });
    if (!r.imageData) return res.status(400).json({ message: "Upload a floor-plan image for this room first." });
    const s = storage.getSettings(r.locationId);
    if (!s.openaiKey) return res.status(400).json({ message: "Add an OpenAI API key in Settings → Floor-plan reading to auto-detect tables. You can still place tables by hand on top of the image." });
    try {
      res.json({ tables: await detectTables(r.imageData, s.openaiKey, s.visionModel || "gpt-4o", r.area) });
    } catch (e: any) {
      res.status(502).json({ message: e?.message || "Couldn't read the image" });
    }
  });
  // Bulk add (optionally replacing) the tables in a room — used after detection.
  app.post("/api/rooms/:id/tables", (req, res) => {
    const r = storage.getRoom(id(req));
    if (!r) return res.status(404).json({ message: "Room not found" });
    const T = z.object({
      label: z.string().min(1).max(20), capacity: z.coerce.number().int().min(1).max(40),
      area: z.enum(["inside", "patio", "bar", "ballroom"]).default(r.area as any),
      shape: z.enum(["square", "round", "rect"]).default("square"),
      x: z.coerce.number().min(0).max(100), y: z.coerce.number().min(0).max(100),
      w: z.coerce.number().min(0).max(100).default(0), h: z.coerce.number().min(0).max(100).default(0),
      mergeGroup: z.string().default(""), mergeOrder: z.coerce.number().int().default(0),
    });
    const b = z.object({ replace: z.boolean().default(false), tables: z.array(T).max(300) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ message: b.error.issues[0]?.message || "Invalid tables" });
    if (b.data.replace) for (const t of storage.listTables(r.locationId)) if (t.roomId === r.id) storage.deleteTable(t.id);
    const out = b.data.tables.map((t) => storage.createTable({ ...t, locationId: r.locationId, roomId: r.id, active: true,
      x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.w), h: Math.round(t.h) }));
    res.json(out);
  });

  // ---------- tables ----------
  app.get("/api/locations/:id/tables", (req, res) => res.json(storage.listTables(id(req))));
  app.post("/api/locations/:id/tables/add", (req, res) => {
    const b = z.object({
      label: z.string().min(1), capacity: z.coerce.number().int().min(1).max(40),
      area: z.enum(["inside", "patio", "bar", "ballroom"]).default("inside"),
      shape: z.enum(["square", "round", "rect"]).default("square"),
      mergeGroup: z.string().default(""), mergeOrder: z.coerce.number().int().default(0),
      roomId: z.coerce.number().int().default(0),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ message: b.error.message });
    const roomId = b.data.roomId || ensureRooms(id(req))[0].id;
    res.json(storage.createTable({ locationId: id(req), x: 45, y: 45, w: 0, h: 0, active: true, ...b.data, roomId }));
  });
  app.patch("/api/tables/:id", (req, res) => {
    const allowed = ["label", "capacity", "area", "shape", "x", "y", "w", "h", "roomId", "mergeGroup", "mergeOrder", "active"];
    const data = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    if ("x" in data) data.x = Math.max(0, Math.min(98, Math.round(Number(data.x))));
    if ("y" in data) data.y = Math.max(0, Math.min(98, Math.round(Number(data.y))));
    for (const k of ["w", "h"]) if (k in data) data[k] = Math.max(0, Math.min(100, Math.round(Number(data[k]))));
    res.json(storage.updateTable(id(req), data as any));
  });
  app.delete("/api/tables/:id", (req, res) => { storage.deleteTable(id(req)); res.json({ ok: true }); });

  // ---------- reservations ----------
  app.get("/api/locations/:id/reservations", (req, res) => {
    const date = req.query.date ? String(req.query.date) : undefined;
    res.json(storage.listReservations(id(req), date));
  });
  app.post("/api/locations/:id/reservations", (req, res) => {
    const p = reservationInputSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const r = storage.createReservation({
      locationId: id(req), ...p.data, bookedAt: p.data.bookedAt || new Date().toISOString(), status: "booked",
      requiresCard: false, cardStatus: "not_required", paymentMethodId: "", cardBrand: "", cardLast4: "",
      outreachToken: "", optedOut: false, noShowCharged: 0,
    });
    res.json(syncCampaign(r.id));
  });
  // CSV import (OpenTable export: Date, Time, Guest/Name, Party/Size, Phone, Email, Visits, Notes)
  app.post("/api/locations/:id/reservations/import", (req, res) => {
    const csv = String(req.body?.csv || "");
    const fallbackDate = String(req.body?.date || localToday());
    const rows = parseCsv(csv);
    if (rows.length < 2) return res.status(400).json({ message: "No rows found in CSV" });
    const head = rows[0].map((h) => h.toLowerCase().trim());
    const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
    const ci = { date: col("date"), time: col("time"), name: col("guest", "name"), size: col("party", "size", "covers", "people"), phone: col("phone"), email: col("email"), visits: col("visit"), notes: col("note", "request") };
    if (ci.name < 0 || ci.size < 0 || ci.time < 0) return res.status(400).json({ message: "CSV needs Guest/Name, Party size and Time columns" });
    let added = 0; const errors: string[] = [];
    for (const row of rows.slice(1)) {
      if (!row.some((c) => c.trim())) continue;
      const time = normTime(row[ci.time] || "");
      const date = ci.date >= 0 ? normDate(row[ci.date] || "") || fallbackDate : fallbackDate;
      const size = parseInt(row[ci.size] || "", 10);
      if (!time || !size) { errors.push(`Skipped: ${row.join(",").slice(0, 60)}`); continue; }
      const r = storage.createReservation({
        locationId: id(req), date, time, guestName: (row[ci.name] || "Guest").trim(), partySize: size,
        phone: ci.phone >= 0 ? row[ci.phone] || "" : "", email: ci.email >= 0 ? row[ci.email] || "" : "",
        visits: ci.visits >= 0 ? parseInt(row[ci.visits] || "0", 10) || 0 : 0, notes: ci.notes >= 0 ? row[ci.notes] || "" : "",
        birthday: /birthday|bday/i.test(ci.notes >= 0 ? row[ci.notes] || "" : ""), preference: "any", bookedAt: new Date().toISOString(),
        status: "booked", requiresCard: false, cardStatus: "not_required", paymentMethodId: "", cardBrand: "", cardLast4: "",
        outreachToken: "", optedOut: false, noShowCharged: 0,
      });
      syncCampaign(r.id); added++;
    }
    res.json({ added, errors });
  });
  app.patch("/api/reservations/:id", (req, res) => {
    const allowed = ["date", "time", "guestName", "phone", "email", "partySize", "visits", "notes", "birthday", "preference", "status"];
    const data = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
    if (!storage.getReservation(id(req))) return res.status(404).json({ message: "Not found" });
    storage.updateReservation(id(req), data as any);
    if (data.status === "cancelled") storage.addEvent(id(req), "cancelled", "host", "Cancelled by host");
    res.json(syncCampaign(id(req)));
  });
  app.delete("/api/reservations/:id", (req, res) => { storage.deleteReservation(id(req)); res.json({ ok: true }); });

  // ---------- rules / settings ----------
  app.get("/api/locations/:id/rules", (req, res) => res.json(storage.getRules(id(req))));
  app.patch("/api/locations/:id/rules", (req, res) => {
    const r = storage.updateRules(id(req), req.body);
    // threshold / cadence changes re-evaluate every upcoming reservation
    const today = localToday();
    for (const x of storage.listReservations(id(req))) if (x.date >= today) syncCampaign(x.id);
    res.json(r);
  });
  app.get("/api/locations/:id/settings", (req, res) => res.json(maskSettings(storage.getSettings(id(req)))));
  app.patch("/api/locations/:id/settings", (req, res) => {
    const data: any = { ...req.body };
    for (const f of SECRET_FIELDS) if (typeof data[f] === "string" && data[f].startsWith("••••")) delete data[f];
    res.json(maskSettings(storage.updateSettings(id(req), data)));
  });
  app.post("/api/locations/:id/settings/test", async (req, res) => {
    const s = storage.getSettings(id(req));
    if (s.mockMode) return res.json({ ok: true, message: "Demo mode is on — no live calls, texts, emails or charges are made." });
    const checks: string[] = [];
    if (s.synthflowKey) {
      const r = await fetch("https://api.synthflow.ai/v2/assistants?limit=1", { headers: { Authorization: `Bearer ${s.synthflowKey}` } }).catch(() => null);
      checks.push(`Synthflow: ${r?.ok ? "OK" : "failed"}`);
    }
    if (s.stripeSecretKey) {
      const r = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${s.stripeSecretKey}` } }).catch(() => null);
      checks.push(`Stripe: ${r?.ok ? "OK" : "failed"}`);
    }
    if (s.twilioSid && s.twilioToken) {
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.twilioSid}.json`, { headers: { Authorization: "Basic " + Buffer.from(`${s.twilioSid}:${s.twilioToken}`).toString("base64") } }).catch(() => null);
      checks.push(`Twilio: ${r?.ok ? "OK" : "failed"}`);
    }
    if (s.resendKey) {
      const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${s.resendKey}` } }).catch(() => null);
      checks.push(`Resend: ${r?.ok ? "OK" : "failed"}`);
    }
    res.json({ ok: checks.every((c) => c.endsWith("OK")) && checks.length > 0, message: checks.length ? checks.join(" · ") : "No keys saved yet." });
  });

  // ---------- seating ----------
  app.post("/api/locations/:id/plan/generate", (req, res) => {
    const date = String(req.body?.date || localToday());
    const tables = storage.listTables(id(req));
    const list = storage.listReservations(id(req), date);
    const rules = storage.getRules(id(req));
    res.json({ standard: generatePlan(date, tables, list, rules, 0), cushion: generatePlan(date, tables, list, rules, rules.cushionMin) });
  });
  app.get("/api/locations/:id/walk-in-availability", (req, res) => {
    const date = String(req.query.date || localToday());
    const at = toMin(String(req.query.at || "19:00"));
    const windowMin = Number(req.query.windowMin || 120);
    const tables = storage.listTables(id(req));
    const plan = generatePlan(date, tables, storage.listReservations(id(req), date), storage.getRules(id(req)), 0);
    res.json(walkInAvailability(tables, plan, at, windowMin));
  });

  // ---------- patio offer-inside calls ----------
  app.get("/api/locations/:id/calls", (req, res) => {
    const list = storage.listCalls(id(req)).map((c) => ({ ...c, guestName: storage.getReservation(c.reservationId)?.guestName || "—" }));
    res.json(list);
  });
  app.post("/api/reservations/:id/call-offer-inside", async (req, res) => {
    const r = storage.getReservation(id(req));
    if (!r) return res.status(404).json({ message: "Not found" });
    const s = storage.getSettings(r.locationId);
    const x = await placeCall(s, s.synthflowAgentId, r.phone, r.guestName, { guest_name: r.guestName, party_size: String(r.partySize), offer: "A table inside opened up. Would you like to move inside?" });
    const call = storage.createCall({
      locationId: r.locationId, reservationId: r.id, intent: "offer_inside", status: x.ok ? (s.mockMode ? "completed" : "queued") : "failed",
      outcome: x.ok && s.mockMode ? "accepted_inside" : x.ok ? "" : x.detail,
      transcript: x.ok && s.mockMode ? `AGENT: Hi ${r.guestName.split(" ")[0]}, a table just opened inside. Would you like it instead of the patio?\nGUEST: Yes please.\nAGENT: Done. We'll see you at ${r.time}.` : "",
      providerId: x.providerId, createdAt: new Date().toISOString(),
    });
    if (x.ok && s.mockMode) storage.updateReservation(r.id, { preference: "inside" });
    res.json(call);
  });

  // ---------- big-party confirmations ----------
  app.get("/api/locations/:id/confirmations", (req, res) => {
    const today = localToday();
    const list = storage.listBigParties(id(req)).filter((r) => r.date >= today || r.status === "no_show");
    res.json(list.map(bigPartyView));
  });
  app.post("/api/reservations/:id/resend", async (req, res) => {
    const ch = z.enum(["sms", "email", "sms_email", "voice", "sms_final"]).safeParse(req.body?.channel);
    if (!ch.success) return res.status(400).json({ message: "Bad channel" });
    try { res.json(await resendNow(id(req), ch.data)); } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.post("/api/reservations/:id/simulate-reply", async (req, res) => {
    const r = storage.getReservation(id(req));
    if (!r) return res.status(404).json({ message: "Not found" });
    res.json({ result: await handleReply(r, String(req.body?.body || "")) });
  });
  app.post("/api/reservations/:id/no-show-charge", async (req, res) => {
    const r = storage.getReservation(id(req));
    if (!r) return res.status(404).json({ message: "Not found" });
    if (r.cardStatus !== "on_file") return res.status(400).json({ message: "No card on file" });
    if (r.noShowCharged) return res.status(400).json({ message: "Already charged" });
    const rules = storage.getRules(r.locationId);
    const s = storage.getSettings(r.locationId);
    const cents = rules.noShowFeeCents * r.partySize;
    try {
      if (!s.mockMode) {
        const [cus, pm] = r.paymentMethodId.split("|");
        if (!cus || !pm) throw new Error("Card was saved in demo mode; cannot charge live");
        await chargeOffSession(s, cus, pm, cents, `No-show: ${r.guestName} party of ${r.partySize} on ${r.date}`);
      }
      storage.updateReservation(r.id, { status: "no_show", noShowCharged: cents });
      storage.cancelScheduledSteps(r.id, "No-show");
      storage.addEvent(r.id, "no_show_charge", "stripe", `Charged $${(cents / 100).toFixed(2)} (${r.partySize} × $${(rules.noShowFeeCents / 100).toFixed(2)})${s.mockMode ? " — demo" : ""}`);
      res.json(storage.getReservation(r.id));
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.get("/api/reservations/:id/preview-messages", (req, res) => {
    const r = storage.getReservation(id(req));
    if (!r) return res.status(404).json({ message: "Not found" });
    res.json({ standard: messageFor("sms", r), final: messageFor("sms_final", r), confirm: messageFor("confirm", r), voice: voiceScript(r) });
  });

  // ---------- guest portal (tokenized, no login) ----------
  app.get("/api/portal/:token", (req, res) => {
    const r = storage.getReservationByToken(String(req.params.token));
    if (!r) return res.status(404).json({ message: "This link is not valid." });
    res.json(portalView(r));
  });
  app.post("/api/portal/:token/checkout", async (req, res) => {
    const r = storage.getReservationByToken(String(req.params.token));
    if (!r) return res.status(404).json({ message: "This link is not valid." });
    const s = storage.getSettings(r.locationId);
    if (s.mockMode) { storage.updateReservation(r.id, { cardStatus: r.cardStatus === "on_file" ? "on_file" : "pending" }); return res.json({ mode: "mock" }); }
    if (!s.stripeSecretKey) return res.status(400).json({ message: "Card capture isn't set up yet. Please call the restaurant." });
    const back = String(req.body?.returnUrl || portalLink(r));
    try {
      const out = await createSetupCheckout(s, {
        email: r.email, name: r.guestName, reservationId: r.id,
        successUrl: `${back}${back.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`, cancelUrl: back,
      });
      storage.updateReservation(r.id, { cardStatus: "pending" });
      res.json({ mode: "stripe", url: out.url });
    } catch (e: any) { res.status(400).json({ message: e.message }); }
  });
  app.post("/api/portal/:token/mock-card", async (req, res) => {
    const r = storage.getReservationByToken(String(req.params.token));
    if (!r) return res.status(404).json({ message: "This link is not valid." });
    const s = storage.getSettings(r.locationId);
    if (!s.mockMode) return res.status(400).json({ message: "Demo card entry is disabled" });
    const num = String(req.body?.number || "").replace(/\D/g, "");
    const exp = String(req.body?.exp || "");
    if (num.length < 13 || !luhn(num)) return res.status(400).json({ message: "That card number isn't valid." });
    const m = exp.match(/^(\d{2})\s*\/\s*(\d{2})$/);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return res.status(400).json({ message: "Use MM/YY for the expiry." });
    // only brand + last 4 are kept; the number is never stored
    await markCardOnFile(r.id, { brand: brandOf(num), last4: num.slice(-4), paymentMethodId: `pm_mock_${num.slice(-4)}` });
    res.json(portalView(storage.getReservation(r.id)!));
  });
  app.post("/api/portal/:token/modify", (req, res) => {
    const r = storage.getReservationByToken(String(req.params.token));
    if (!r) return res.status(404).json({ message: "This link is not valid." });
    if (!portalView(r).canModify) return res.status(400).json({ message: "Changes close 2 hours before your reservation. Please call us." });
    const p = z.object({ partySize: z.coerce.number().int().min(1).max(60), time: z.string().regex(/^\d{2}:\d{2}$/) }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Please check party size and time." });
    storage.updateReservation(r.id, p.data);
    storage.addEvent(r.id, "modified", "web", `Guest changed to ${p.data.partySize} at ${p.data.time} (was ${r.partySize} at ${r.time})`);
    res.json(portalView(syncCampaign(r.id)!));
  });
  app.post("/api/portal/:token/cancel", (req, res) => {
    const r = storage.getReservationByToken(String(req.params.token));
    if (!r) return res.status(404).json({ message: "This link is not valid." });
    if (!isActive(r)) return res.status(400).json({ message: "This reservation is no longer active." });
    storage.updateReservation(r.id, { status: "cancelled" });
    storage.addEvent(r.id, "cancelled", "web", "Guest cancelled from link");
    res.json(portalView(syncCampaign(r.id)!));
  });
  app.post("/api/portal/:token/confirm-session", async (req, res) => {
    // Return from Stripe Checkout: verify the session server-side instead of trusting the URL
    const r = storage.getReservationByToken(String(req.params.token));
    if (!r) return res.status(404).json({ message: "This link is not valid." });
    const s = storage.getSettings(r.locationId);
    const sid = String(req.body?.sessionId || "");
    if (!sid || s.mockMode || !s.stripeSecretKey) return res.json(portalView(r));
    try {
      const sess = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sid}`, { headers: { Authorization: `Bearer ${s.stripeSecretKey}` } }).then((x) => x.json());
      if (sess?.metadata?.reservation_id === String(r.id) && sess.setup_intent) await applySetupIntent(r.id, s, sess.setup_intent);
    } catch (e) { console.error(e); }
    res.json(portalView(storage.getReservation(r.id)!));
  });

  // ---------- webhooks ----------
  app.post("/api/webhooks/stripe/:locationId", async (req: Request, res: Response) => {
    const s = storage.getSettings(id(req, "locationId"));
    const raw = (req as any).rawBody as Buffer;
    if (!s.stripeWebhookSecret || !verifyStripeSignature(raw, String(req.headers["stripe-signature"] || ""), s.stripeWebhookSecret)) {
      return res.status(400).json({ message: "Bad signature" });
    }
    const ev = req.body;
    if (ev.type === "setup_intent.succeeded") {
      const resId = Number(ev.data?.object?.metadata?.reservation_id);
      if (resId) await applySetupIntent(resId, s, ev.data.object.id);
    }
    if (ev.type === "checkout.session.completed" && ev.data?.object?.mode === "setup") {
      const resId = Number(ev.data.object.metadata?.reservation_id);
      if (resId && ev.data.object.setup_intent) await applySetupIntent(resId, s, ev.data.object.setup_intent);
    }
    res.json({ received: true });
  });
  // Twilio inbound SMS (form-encoded From / Body)
  app.post("/api/webhooks/sms", async (req, res) => {
    const from = String(req.body?.From || "").replace(/\D/g, "");
    const body = String(req.body?.Body || "");
    const r = from ? storage.findUpcomingByPhone(from) : undefined;
    if (r) await handleReply(r, body);
    res.type("text/xml").send("<Response></Response>");
  });
  app.post("/api/webhooks/synthflow", (req, res) => {
    const callId = String(req.body?.call?.call_id || req.body?.call_id || "");
    const call = callId ? storage.getCallByProvider(callId) : undefined;
    if (call) {
      storage.updateCall(call.id, {
        status: "completed",
        outcome: String(req.body?.call?.end_call_reason || req.body?.status || "completed"),
        transcript: String(req.body?.call?.transcript || req.body?.transcript || ""),
      });
    }
    res.json({ ok: true });
  });

  return httpServer;
}

async function applySetupIntent(resId: number, s: any, setupIntentId: string) {
  const r = storage.getReservation(resId);
  if (!r || r.cardStatus === "on_file") return;
  const si = await getSetupIntent(s, setupIntentId);
  if (si.status !== "succeeded") return;
  const pm = si.payment_method || {};
  await markCardOnFile(resId, { brand: pm.card?.brand || "card", last4: pm.card?.last4 || "", paymentMethodId: `${si.customer}|${pm.id}` });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function normTime(t: string): string {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?$/i);
  if (!m) return "";
  let h = Number(m[1]); const mm = m[2];
  if (m[3]) { const pm = /p/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return `${String(h).padStart(2, "0")}:${mm}`;
}
function normDate(d: string): string {
  const s = d.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return "";
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
