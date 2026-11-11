// Creates (or updates) the two SeatSmart outbound agents in the restaurant's Synthflow workspace.
import type { Settings } from "@shared/schema";

const API = "https://api.synthflow.ai/v2";

const COMMON = `
Style: warm, brief, natural. One question at a time. Keep the call under 2 minutes.
Never ask for, repeat or write down card numbers, CVV or expiration dates by voice. Cards are only taken through the secure link we text.
Never invent policies, prices or menu details. If asked something you don't know, say a manager will call back.
If the guest asks to stop calling, apologize, confirm they won't be called again, and end the call.
If you reach the wrong person, apologize and end the call.`;

export const CARD_PROMPT = `You are the reservations host for {restaurant_name}, calling {guest_name} about their reservation.
Reservation: party of {party_size} on {reservation_date} at {reservation_time}.
For parties this size the restaurant needs a credit card on file to hold the table. The card is not charged unless the party doesn't show, per the restaurant's policy ({no_show_policy}).

Goals, in order:
1. Confirm you're speaking with {guest_name} and that the reservation is still happening.
2. Tell them we need a card on file for the table and that you're texting them a secure link right now (it's {card_link}). They can also use that link to change the party size or time.
3. If they want to change or cancel, tell them they can do it from the same link, or a manager will call them back. Note what they want.
4. Thank them and end the call.
${COMMON}`;

export const OFFER_PROMPT = `You are the host at {restaurant_name}, calling {guest_name} about their reservation for {party_size} at {reservation_time}.
They are currently seated on the patio. {offer}
If they want to move inside, tell them the table is theirs and the host will have it ready. If they prefer the patio, thank them and keep it as is.
${COMMON}`;

async function sf(key: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.detail?.description || j?.message || j?.response?.message || `Synthflow ${r.status}`);
  return j;
}

function agentBody(name: string, prompt: string, greeting: string, s: Settings, webhook: string) {
  return {
    name,
    ...(s.twilioFrom ? { phone_number: s.twilioFrom } : {}),
    ...(webhook ? { external_webhook_url: webhook } : {}),
    is_recording: false,
    max_duration: { is_enabled: true, duration_seconds: 240 },
    voicemail_message: {
      enabled: true, mode: "exact_message",
      exact_message: `Hi {guest_name}, this is {restaurant_name} about your reservation for {party_size} on {reservation_date} at {reservation_time}. We're texting you a link to finish holding your table. Thank you.`,
    },
    agent: {
      prompt, greeting_message: greeting, language: "en-US", timezone: "America/New_York",
      greeting_message_mode: "human", greeting_message_human_talk_timeout: 3, patience_level: "medium",
      transcriber_keywords: [s.restaurantName || "Chateau"].filter(Boolean),
    },
  };
}

export async function setupAgents(s: Settings, webhook: string) {
  if (!s.synthflowKey) throw new Error("Add your Synthflow API key and save first");
  const card = agentBody("SeatSmart – card & confirmation", CARD_PROMPT,
    "Hi, is this {guest_name}? This is {restaurant_name} calling about your reservation for {party_size} on {reservation_date}.", s, webhook);
  const offer = agentBody("SeatSmart – move inside offer", OFFER_PROMPT,
    "Hi, is this {guest_name}? This is {restaurant_name} about your reservation tonight.", s, webhook);
  const out: { cardId: string; offerId: string; created: string[]; updated: string[] } = { cardId: s.synthflowCardAgentId, offerId: s.synthflowAgentId, created: [], updated: [] };
  if (s.synthflowCardAgentId) { await sf(s.synthflowKey, "PUT", `/assistants/${s.synthflowCardAgentId}`, card); out.updated.push("card"); }
  else { const j = await sf(s.synthflowKey, "POST", "/assistants", { type: "outbound", ...card }); out.cardId = j?.response?.model_id || ""; out.created.push("card"); }
  if (s.synthflowAgentId) { await sf(s.synthflowKey, "PUT", `/assistants/${s.synthflowAgentId}`, offer); out.updated.push("offer"); }
  else { const j = await sf(s.synthflowKey, "POST", "/assistants", { type: "outbound", ...offer }); out.offerId = j?.response?.model_id || ""; out.created.push("offer"); }
  if (!out.cardId || !out.offerId) throw new Error("Synthflow didn't return an agent ID");
  return out;
}
