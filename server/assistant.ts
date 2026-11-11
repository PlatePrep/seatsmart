// "Ask SeatSmart": staff type what they want; the model looks things up and proposes changes.
// Lookups run right away. Changes are only queued; staff review and click Apply. Apply saves a version first.
import { storage } from "./storage";
import { localToday, minToLabel, toMin } from "@shared/time";

export type ApiCall = (method: string, path: string, body?: any) => Promise<{ ok: boolean; status: number; json: any }>;
export type ProposedAction = { id: string; tool: string; args: any; summary: string };
type Msg = { role: "user" | "assistant"; content: string };

const t12 = (hhmm: string) => (hhmm ? minToLabel(toMin(hhmm)) : "");
const fn = (name: string, description: string, properties: Record<string, any>, required: string[] = []) =>
  ({ type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } });
const S = (d: string) => ({ type: "string", description: d });
const N = (d: string) => ({ type: "integer", description: d });
const DATE = S("YYYY-MM-DD");
const TIME = S("24-hour HH:MM, e.g. 17:30");
const LABELS = { type: "array", items: { type: "string" }, description: "Table labels exactly as on the floor plan, e.g. [\"50\",\"60\"]" };

const READ_TOOLS = [
  fn("get_day", "Reservations, the seating plan (which tables each party got), unseated parties, risks, open-to-sell seatings, blocks and the pace cap for one date.", { date: DATE }, ["date"]),
  fn("find_reservations", "Search reservations by guest name, phone or email across all dates.", { query: S("Name, phone or email fragment"), date: S("Optional YYYY-MM-DD to limit the search") }, ["query"]),
  fn("get_shifts", "Servers on shift and their tables for one date.", { date: DATE }, ["date"]),
];
const WRITE_TOOLS = [
  fn("update_reservation", "Change a reservation. Only include fields that change.", {
    reservation_id: N("Reservation id from get_day or find_reservations"), date: DATE, time: TIME, party_size: N("Guests"),
    guest_name: S("Guest name"), phone: S("Phone"), email: S("Email"), notes: S("Notes (replaces existing notes)"),
    preference: { type: "string", enum: ["any", "inside", "patio"] }, visits: N("Visit count"),
    status: { type: "string", enum: ["booked", "confirmed", "seated", "completed", "cancelled", "no_show"] },
  }, ["reservation_id"]),
  fn("add_reservation", "Add a new reservation.", {
    date: DATE, time: TIME, guest_name: S("Guest name"), party_size: N("Guests"), phone: S("Phone"), email: S("Email"),
    notes: S("Notes"), preference: { type: "string", enum: ["any", "inside", "patio"] }, visits: N("Visit count"),
  }, ["date", "time", "guest_name", "party_size"]),
  fn("assign_tables", "Lock a reservation to specific tables (they can be pushed together), or pass an empty list to let SeatSmart choose again.", { reservation_id: N("Reservation id"), table_labels: LABELS }, ["reservation_id", "table_labels"]),
  fn("update_table", "Change a table on the floor plan.", {
    table_label: S("Current label"), capacity: N("Seats"), active: { type: "boolean", description: "false removes it from seating" },
    merge_group: S("Tables sharing a merge group can be pushed together; empty string for none"), new_label: S("New label"),
    area: { type: "string", enum: ["inside", "patio", "bar", "ballroom"] },
  }, ["table_label"]),
  fn("add_block", "Hold tables or a whole room for walk-ins, or close them, on a date. Blank times = all day.", {
    date: DATE, table_labels: LABELS, room_name: S("Room name instead of tables, e.g. Patio"), start_time: TIME, end_time: TIME,
    kind: { type: "string", enum: ["walkin", "closed"] }, note: S("Short note"),
  }, ["date", "kind"]),
  fn("remove_block", "Remove a block by id (ids come from get_day).", { block_id: N("Block id") }, ["block_id"]),
  fn("update_rules", "Change location rules. Only include fields that change. Turn times are minutes.", {
    turn_small: N("Turn for 1-2 guests"), turn_mid: N("Turn for 3-6"), turn_large: N("Turn for 7+"), pacing_covers: N("Default pace cap, covers per 15 min"),
    reset_min: N("Table reset minutes"), cushion_min: N("Cushion plan minutes"), card_threshold: N("Card required at this party size"),
    no_show_fee_dollars: { type: "number", description: "No-show fee per seat in dollars" }, vip_min_visits: N("Repeat guest after this many visits"),
    service_start: S("HH:MM or empty"), last_seating: S("HH:MM or empty"), use_ballroom: { type: "boolean" },
  }),
  fn("set_pacing_for_date", "Set a pace cap for one date only, or pass covers 0 to go back to the default.", { date: DATE, covers: N("Covers per 15 minutes; 0 = default"), note: S("Optional note") }, ["date", "covers"]),
  fn("add_shift", "Put a server on shift with tables. Creates the server if the name is new.", {
    date: DATE, server_name: S("Server name"), start_time: TIME, end_time: S("HH:MM, or empty for until close"), table_labels: LABELS,
  }, ["date", "server_name", "start_time", "table_labels"]),
];
const UI_TOOLS = [
  fn("open_page", "Open a page of the app for the user.", {
    page: { type: "string", enum: ["tonight", "reservations", "plan", "floor-view", "staff", "pacing", "floor-plan", "confirmations", "calls", "rules", "settings", "versions"] },
    date: S("Optional YYYY-MM-DD to show"),
  }, ["page"]),
];
const WRITE_NAMES = new Set(WRITE_TOOLS.map((t) => t.function.name));

function context(locationId: number, date: string, page: string) {
  const loc = storage.getLocation(locationId);
  const s = storage.getSettings(locationId);
  const r = storage.rulesFor(locationId, date);
  const rooms = storage.listRooms(locationId);
  const roomName = new Map(rooms.map((x) => [x.id, x.name]));
  const tables = storage.listTables(locationId).filter((t) => t.active);
  const byRoom = new Map<string, string[]>();
  for (const t of tables) {
    const k = roomName.get(t.roomId) || t.area;
    byRoom.set(k, [...(byRoom.get(k) || []), `${t.label}:${t.capacity}${t.mergeGroup ? `(${t.mergeGroup})` : ""}`]);
  }
  const servers = storage.listServers(locationId).filter((x) => x.active).map((x) => x.name);
  return `You are the SeatSmart assistant for ${s.restaurantName || loc?.name || "the restaurant"} (${loc?.city || ""} ${loc?.state || ""}). Staff type requests; you look things up and make changes.
Today is ${localToday()}. The user is viewing ${date} on the "${page}" page. "Tonight", "today" or no date means ${date} unless they say otherwise.
Rules: turn ${r.turnSmall} min for 1-2 guests, ${r.turnMid} for 3-6, ${r.turnLarge} for 7+; table reset ${r.resetMin} min; pace cap ${r.pacingCovers} covers/15 min on ${date}; card required at ${r.cardThreshold}+ guests; repeat guest after ${r.vipMinVisits} visits.
Rooms and tables (label:seats(merge group)):
${Array.from(byRoom.entries()).map(([k, v]) => `- ${k}: ${v.join(", ")}`).join("\n")}
Servers: ${servers.join(", ") || "none yet"}.
How to work:
- Look up ids with get_day or find_reservations before changing a reservation. Never guess an id.
- Changes you request with the change tools are NOT applied yet. They are queued and shown to the staff member with an Apply button. Say what you queued in one or two plain sentences.
- If a request is ambiguous (two guests with the same name, no time given), ask one short question instead of guessing.
- Answer questions about the book directly and briefly. Use 12-hour times like 5:30 PM in replies. Keep replies short.
- You can't send texts, place calls, charge cards or change API keys; say so if asked.`;
}

export async function runAssistant(opts: {
  locationId: number; messages: Msg[]; date: string; page: string; api: ApiCall;
}): Promise<{ reply: string; actions: ProposedAction[]; navigate?: { page: string; date?: string } }> {
  const s = storage.getSettings(opts.locationId);
  const key = s.openaiKey || process.env.OPENAI_API_KEY || "";
  if (!key) throw Object.assign(new Error("Add an OpenAI API key in Settings → AI assistant to turn on the assistant."), { status: 400 });
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = s.assistantModel || "gpt-4.1";
  const L = opts.locationId;
  const tables = storage.listTables(L);
  const byLabel = (l: string) => tables.find((t) => t.label.toLowerCase() === String(l).trim().toLowerCase());
  const actions: ProposedAction[] = [];
  let navigate: { page: string; date?: string } | undefined;

  const msgs: any[] = [{ role: "system", content: context(L, opts.date, opts.page) }, ...opts.messages.slice(-16).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))];

  async function read(name: string, a: any): Promise<any> {
    if (name === "get_day") {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : opts.date;
      const [p, list, bl] = await Promise.all([
        opts.api("GET", `/api/locations/${L}/pacing?date=${d}`), opts.api("GET", `/api/locations/${L}/reservations?date=${d}`), opts.api("GET", `/api/locations/${L}/blocks?date=${d}`),
      ]);
      const plan = p.json?.plan || { assignments: [], unseated: [] };
      const seat = new Map<number, any>((plan.assignments || []).map((x: any) => [x.reservationId, x]));
      const tl = new Map(tables.map((t) => [t.id, t.label]));
      return {
        date: d, pace_cap: p.json?.metrics?.pace,
        reservations: (list.json || []).map((x: any) => ({ id: x.id, time: x.time, guest: x.guestName, party: x.partySize, status: x.status, visits: x.visits, phone: x.phone, preference: x.preference,
          notes: x.notes ? String(x.notes).slice(0, 100) : undefined, card: x.requiresCard ? x.cardStatus : undefined,
          tables: seat.get(x.id)?.labels, area: seat.get(x.id)?.area, locked: x.assignedTables ? true : undefined })),
        unseated: (plan.unseated || []).map((u: any) => ({ reservation_id: u.reservationId, reason: u.reason, suggestion: u.suggestion })),
        risks: (p.json?.risks || []).map((x: any) => `${x.level}: ${x.title}`),
        open_to_sell: (p.json?.holes || []).slice(0, 40).map((h: any) => `${h.time} table ${h.table} (${h.partySize}) out by ${h.mustLeaveBy || "close"}`),
        blocks: (bl.json || []).map((b: any) => ({ id: b.id, tables: b.tableId ? tl.get(b.tableId) : undefined, room_id: b.roomId || undefined, start: b.startTime, end: b.endTime, kind: b.kind, note: b.note })),
      };
    }
    if (name === "find_reservations") {
      const q = String(a.query || "").toLowerCase().trim();
      const digits = q.replace(/\D/g, "");
      const all = storage.listReservations(L, a.date || undefined);
      return all.filter((x) => x.guestName.toLowerCase().includes(q) || x.email.toLowerCase().includes(q) || (digits.length >= 4 && x.phone.replace(/\D/g, "").includes(digits)))
        .slice(0, 25).map((x) => ({ id: x.id, date: x.date, time: x.time, guest: x.guestName, party: x.partySize, status: x.status, phone: x.phone }));
    }
    if (name === "get_shifts") {
      const sv = new Map(storage.listServers(L).map((x) => [x.id, x.name]));
      const tl = new Map(tables.map((t) => [String(t.id), t.label]));
      return storage.listShifts(L, a.date).map((x) => ({ id: x.id, server: sv.get(x.serverId), start: x.startTime, end: x.endTime || "close", tables: x.tableIds.split(",").filter(Boolean).map((i) => tl.get(i)) }));
    }
    return { error: "unknown tool" };
  }

  function propose(name: string, a: any): string {
    const resv = a.reservation_id ? storage.getReservation(Number(a.reservation_id)) : undefined;
    if (["update_reservation", "assign_tables"].includes(name) && (!resv || resv.locationId !== L)) return "Error: no reservation with that id. Look it up first.";
    const who = resv ? `${resv.guestName} (${resv.partySize}, ${resv.date} ${t12(resv.time)})` : "";
    let summary = "";
    if (name === "update_reservation") {
      const parts: string[] = [];
      if (a.date) parts.push(`date → ${a.date}`); if (a.time) parts.push(`time → ${t12(a.time)}`); if (a.party_size) parts.push(`party → ${a.party_size}`);
      if (a.guest_name) parts.push(`name → ${a.guest_name}`); if (a.phone) parts.push(`phone → ${a.phone}`); if (a.email) parts.push(`email → ${a.email}`);
      if (a.notes !== undefined) parts.push(`notes → “${a.notes}”`); if (a.preference) parts.push(`seating → ${a.preference}`); if (a.visits !== undefined) parts.push(`visits → ${a.visits}`);
      if (a.status) parts.push(a.status === "cancelled" ? "cancel" : `status → ${a.status.replace("_", "-")}`);
      if (!parts.length) return "Error: nothing to change.";
      summary = `${who}: ${parts.join(", ")}`;
    } else if (name === "add_reservation") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || !/^\d{2}:\d{2}$/.test(a.time) || !a.guest_name || !a.party_size) return "Error: need date, 24h time, name and party size.";
      summary = `Add ${a.guest_name} (${a.party_size}) on ${a.date} at ${t12(a.time)}${a.notes ? ` — “${a.notes}”` : ""}`;
    } else if (name === "assign_tables") {
      const labels: string[] = a.table_labels || [];
      const bad = labels.filter((l) => !byLabel(l));
      if (bad.length) return `Error: no table ${bad.join(", ")}.`;
      summary = labels.length ? `Seat ${who} at ${labels.join(" + ")} (locked)` : `Let SeatSmart choose the table for ${who}`;
    } else if (name === "update_table") {
      const t = byLabel(a.table_label); if (!t) return `Error: no table ${a.table_label}.`;
      const parts: string[] = [];
      if (a.capacity) parts.push(`${t.capacity} → ${a.capacity} seats`); if (a.active !== undefined) parts.push(a.active ? "back in use" : "out of service");
      if (a.merge_group !== undefined) parts.push(a.merge_group ? `merge group ${a.merge_group}` : "no merge group"); if (a.new_label) parts.push(`rename to ${a.new_label}`);
      if (a.area) parts.push(`area ${a.area}`);
      if (!parts.length) return "Error: nothing to change.";
      summary = `Table ${t.label}: ${parts.join(", ")}`;
    } else if (name === "add_block") {
      const labels: string[] = a.table_labels || [];
      const bad = labels.filter((l) => !byLabel(l)); if (bad.length) return `Error: no table ${bad.join(", ")}.`;
      const room = a.room_name ? storage.listRooms(L).find((r) => r.name.toLowerCase().includes(String(a.room_name).toLowerCase())) : undefined;
      if (!labels.length && !room) return "Error: name tables or a room.";
      const span = a.start_time || a.end_time ? `${t12(a.start_time) || "open"}–${t12(a.end_time) || "close"}` : "all day";
      summary = `${a.kind === "closed" ? "Close" : "Hold for walk-ins"} ${labels.length ? `table${labels.length > 1 ? "s" : ""} ${labels.join(", ")}` : room!.name} on ${a.date}, ${span}${a.note ? ` (${a.note})` : ""}`;
      a._roomId = room?.id;
    } else if (name === "remove_block") {
      const b = storage.getBlock(Number(a.block_id)); if (!b || b.locationId !== L) return "Error: no block with that id.";
      summary = `Remove block #${b.id} on ${b.date}${b.note ? ` (${b.note})` : ""}`;
    } else if (name === "update_rules") {
      const keys = Object.keys(a); if (!keys.length) return "Error: nothing to change.";
      summary = `Rules: ${keys.map((k) => `${k.replace(/_/g, " ")} → ${a[k]}`).join(", ")}`;
    } else if (name === "set_pacing_for_date") {
      summary = Number(a.covers) > 0 ? `Pace cap on ${a.date}: ${a.covers} covers / 15 min${a.note ? ` (${a.note})` : ""}` : `Pace cap on ${a.date}: back to default`;
    } else if (name === "add_shift") {
      const labels: string[] = a.table_labels || [];
      const bad = labels.filter((l) => !byLabel(l)); if (bad.length) return `Error: no table ${bad.join(", ")}.`;
      summary = `${a.server_name} on ${a.date}, ${t12(a.start_time)}–${a.end_time ? t12(a.end_time) : "close"}, tables ${labels.join(", ") || "none"}`;
    }
    actions.push({ id: `a${actions.length + 1}`, tool: name, args: a, summary });
    return `Queued for staff approval: ${summary}`;
  }

  for (let round = 0; round < 6; round++) {
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: msgs, tools: [...READ_TOOLS, ...WRITE_TOOLS, ...UI_TOOLS], tool_choice: "auto", temperature: 0.2 }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`OpenAI: ${j?.error?.message || r.status}`), { status: 502 });
    const m = j.choices?.[0]?.message;
    if (!m) throw Object.assign(new Error("The assistant didn't answer. Try again."), { status: 502 });
    msgs.push(m);
    if (!m.tool_calls?.length) return { reply: String(m.content || "").trim() || (actions.length ? "Review the changes below." : "Done."), actions, navigate };
    for (const c of m.tool_calls) {
      let a: any = {};
      try { a = JSON.parse(c.function?.arguments || "{}"); } catch { /* bad args */ }
      const name = c.function?.name;
      let out: any;
      try {
        if (WRITE_NAMES.has(name)) out = propose(name, a);
        else if (name === "open_page") { navigate = { page: a.page, date: a.date }; out = "Opened."; }
        else out = await read(name, a);
      } catch (e: any) { out = `Error: ${e?.message || e}`; }
      msgs.push({ role: "tool", tool_call_id: c.id, content: typeof out === "string" ? out : JSON.stringify(out).slice(0, 24000) });
    }
  }
  return { reply: actions.length ? "Review the changes below." : "I couldn't finish that. Try asking a narrower question.", actions, navigate };
}

/** Run approved actions through the app's own API (same validation as the screens). */
export async function applyActions(locationId: number, actions: ProposedAction[], api: ApiCall) {
  const L = locationId;
  const tables = storage.listTables(L);
  const byLabel = (l: string) => tables.find((t) => t.label.toLowerCase() === String(l).trim().toLowerCase());
  const results: { id: string; summary: string; ok: boolean; message: string }[] = [];
  for (const act of actions) {
    const a = act.args || {};
    let res: { ok: boolean; status: number; json: any } = { ok: false, status: 400, json: { message: "Unknown action" } };
    try {
      switch (act.tool) {
        case "update_reservation": {
          const body: any = {};
          const map: Record<string, string> = { date: "date", time: "time", party_size: "partySize", guest_name: "guestName", phone: "phone", email: "email", notes: "notes", preference: "preference", visits: "visits", status: "status" };
          for (const [k, v] of Object.entries(map)) if (a[k] !== undefined) body[v] = a[k];
          res = await api("PATCH", `/api/reservations/${Number(a.reservation_id)}`, body); break;
        }
        case "add_reservation":
          res = await api("POST", `/api/locations/${L}/reservations`, { date: a.date, time: a.time, guestName: a.guest_name, partySize: a.party_size, phone: a.phone || "", email: a.email || "", notes: a.notes || "", preference: a.preference || "any", visits: a.visits || 0 }); break;
        case "assign_tables": {
          const ids = (a.table_labels || []).map((l: string) => byLabel(l)?.id).filter(Boolean);
          res = await api("PATCH", `/api/reservations/${Number(a.reservation_id)}`, { assignedTables: ids.join(",") }); break;
        }
        case "update_table": {
          const t = byLabel(a.table_label); if (!t) { res = { ok: false, status: 404, json: { message: `No table ${a.table_label}` } }; break; }
          const body: any = {};
          if (a.capacity) body.capacity = a.capacity; if (a.active !== undefined) body.active = a.active; if (a.merge_group !== undefined) body.mergeGroup = a.merge_group;
          if (a.new_label) body.label = a.new_label; if (a.area) body.area = a.area;
          res = await api("PATCH", `/api/tables/${t.id}`, body); break;
        }
        case "add_block": {
          const base = { date: a.date, startTime: a.start_time || "", endTime: a.end_time || "", kind: a.kind || "walkin", note: a.note || "" };
          const labels: string[] = a.table_labels || [];
          if (labels.length) {
            for (const l of labels) { res = await api("POST", `/api/locations/${L}/blocks`, { ...base, tableId: byLabel(l)?.id }); if (!res.ok) break; }
          } else res = await api("POST", `/api/locations/${L}/blocks`, { ...base, roomId: a._roomId });
          break;
        }
        case "remove_block": res = await api("DELETE", `/api/blocks/${Number(a.block_id)}`); break;
        case "update_rules": {
          const map: Record<string, string> = { turn_small: "turnSmall", turn_mid: "turnMid", turn_large: "turnLarge", pacing_covers: "pacingCovers", reset_min: "resetMin", cushion_min: "cushionMin", card_threshold: "cardThreshold", vip_min_visits: "vipMinVisits", service_start: "serviceStart", last_seating: "lastSeating", use_ballroom: "useBallroom" };
          const body: any = {};
          for (const [k, v] of Object.entries(map)) if (a[k] !== undefined) body[v] = a[k];
          if (a.no_show_fee_dollars !== undefined) body.noShowFeeCents = Math.round(Number(a.no_show_fee_dollars) * 100);
          res = await api("PATCH", `/api/locations/${L}/rules`, body); break;
        }
        case "set_pacing_for_date":
          res = Number(a.covers) > 0 ? await api("PUT", `/api/locations/${L}/pacing-overrides/${a.date}`, { pacingCovers: a.covers, note: a.note || "" }) : await api("DELETE", `/api/locations/${L}/pacing-overrides/${a.date}`); break;
        case "add_shift": {
          let sv = storage.listServers(L).find((x) => x.active && x.name.toLowerCase() === String(a.server_name).trim().toLowerCase());
          if (!sv) { const c = await api("POST", `/api/locations/${L}/servers`, { name: String(a.server_name).trim() }); if (!c.ok) { res = c; break; } sv = c.json; }
          const ids = (a.table_labels || []).map((l: string) => byLabel(l)?.id).filter(Boolean);
          res = await api("POST", `/api/locations/${L}/shifts`, { date: a.date, serverId: sv!.id, startTime: a.start_time, endTime: a.end_time || "", tableIds: ids.join(",") }); break;
        }
      }
    } catch (e: any) { res = { ok: false, status: 500, json: { message: e?.message || String(e) } }; }
    results.push({ id: act.id, summary: act.summary, ok: res.ok, message: res.ok ? "Done" : res.json?.message || `Failed (${res.status})` });
  }
  return results;
}
