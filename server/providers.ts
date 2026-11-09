// Thin REST adapters for Twilio, Resend, Synthflow and Stripe.
// Every call is skipped (and logged as mock) when the location is in mock mode.
import crypto from "node:crypto";
import type { Settings } from "@shared/schema";

export type SendResult = { ok: boolean; providerId: string; detail: string };

const mockId = (p: string) => `${p}_mock_${crypto.randomBytes(5).toString("hex")}`;

export async function sendSms(s: Settings, to: string, body: string): Promise<SendResult> {
  if (s.mockMode) return { ok: true, providerId: mockId("SM"), detail: "mock" };
  if (!s.twilioSid || !s.twilioToken || !s.twilioFrom) return { ok: false, providerId: "", detail: "Twilio not configured" };
  if (!to) return { ok: false, providerId: "", detail: "No phone on reservation" };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.twilioSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${s.twilioSid}:${s.twilioToken}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: s.twilioFrom, Body: body }),
  });
  const j: any = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, providerId: j.sid || "", detail: "sent" } : { ok: false, providerId: "", detail: j.message || `Twilio ${res.status}` };
}

export async function sendEmail(s: Settings, to: string, subject: string, text: string, html: string): Promise<SendResult> {
  if (s.mockMode) return { ok: true, providerId: mockId("em"), detail: "mock" };
  if (!s.resendKey || !s.emailFrom) return { ok: false, providerId: "", detail: "Resend not configured" };
  if (!to) return { ok: false, providerId: "", detail: "No email on reservation" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${s.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: s.emailFrom, to: [to], subject, text, html }),
  });
  const j: any = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, providerId: j.id || "", detail: "sent" } : { ok: false, providerId: "", detail: j.message || `Resend ${res.status}` };
}

export async function placeCall(
  s: Settings, agentId: string, to: string, name: string, vars: Record<string, string>,
): Promise<SendResult> {
  if (s.mockMode) return { ok: true, providerId: mockId("call"), detail: "mock" };
  if (!s.synthflowKey || !agentId) return { ok: false, providerId: "", detail: "Synthflow not configured" };
  if (!to) return { ok: false, providerId: "", detail: "No phone on reservation" };
  const res = await fetch("https://api.synthflow.ai/v2/calls", {
    method: "POST",
    headers: { Authorization: `Bearer ${s.synthflowKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: agentId, phone: to, name, custom_variables: Object.entries(vars).map(([key, value]) => ({ key, value })) }),
  });
  const j: any = await res.json().catch(() => ({}));
  const id = j?.response?.call_id || j?.call_id || "";
  return res.ok ? { ok: true, providerId: id, detail: "queued" } : { ok: false, providerId: "", detail: j?.response?.message || j?.message || `Synthflow ${res.status}` };
}

async function stripe(s: Settings, path: string, params: Record<string, string>, method = "POST") {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${s.stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : new URLSearchParams(params),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || `Stripe ${res.status}`);
  return j;
}

/** Creates a customer + Checkout Session in setup mode (no charge). */
export async function createSetupCheckout(
  s: Settings, opts: { email: string; name: string; reservationId: number; successUrl: string; cancelUrl: string },
): Promise<{ url: string; sessionId: string }> {
  const cust = await stripe(s, "customers", { name: opts.name, ...(opts.email ? { email: opts.email } : {}), "metadata[reservation_id]": String(opts.reservationId) });
  const sess = await stripe(s, "checkout/sessions", {
    mode: "setup", customer: cust.id, currency: "usd",
    "payment_method_types[0]": "card",
    success_url: opts.successUrl, cancel_url: opts.cancelUrl,
    "metadata[reservation_id]": String(opts.reservationId),
    "setup_intent_data[metadata][reservation_id]": String(opts.reservationId),
  });
  return { url: sess.url, sessionId: sess.id };
}

export async function getSetupIntent(s: Settings, id: string) {
  return stripe(s, `setup_intents/${id}?expand[]=payment_method`, {}, "GET");
}

export async function chargeOffSession(s: Settings, customer: string, paymentMethod: string, cents: number, desc: string) {
  return stripe(s, "payment_intents", {
    amount: String(cents), currency: "usd", customer, payment_method: paymentMethod,
    off_session: "true", confirm: "true", description: desc,
  });
}

/** Verifies a Stripe-Signature header against the raw body. */
export function verifyStripeSignature(raw: Buffer, header: string, secret: string): boolean {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 600) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${raw.toString("utf8")}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1)); } catch { return false; }
}
