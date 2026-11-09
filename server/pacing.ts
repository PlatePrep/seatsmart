import type { Block, DiningTable, Reservation, Room, Rules, SeatingPlan } from "@shared/schema";
import { minToLabel, toMin } from "@shared/time";
import { blockedIntervals, effectivePreference, generatePlan, isBookable, turnFor, type Interval } from "./seating";

export type Risk = { level: "high" | "medium" | "low"; time: string; title: string; detail: string };
export type Hole = { startMin: number; time: string; partySize: number; tableId: number; table: string; area: string; room: string; mustLeaveBy: string };
export type Slot = { startMin: number; time: string; covers: number; parties: number; seated: number; seatsOpen: number; occupancy: number };

const ceil15 = (m: number) => Math.ceil(m / 15) * 15;
const floor15 = (m: number) => Math.floor(m / 15) * 15;
const money = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const AREA: Record<string, string> = { inside: "Inside", ballroom: "Ballroom", patio: "Patio", bar: "Bar" };

export function analyzePacing(date: string, tables: DiningTable[], rooms: Room[], resList: Reservation[], r: Rules, blocks: Block[]) {
  const active = resList.filter((x) => !["cancelled", "no_show"].includes(x.status));
  const byId = new Map(active.map((x) => [x.id, x]));
  const std = generatePlan(date, tables, active, r, 0, blocks);
  const cush = generatePlan(date, tables, active, r, r.cushionMin, blocks);
  const roomName = new Map(rooms.map((x) => [x.id, x.name]));
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const blocked = blockedIntervals(tables, blocks);
  const walkinBlocked = blockedIntervals(tables, blocks, ["walkin"]);
  const bookable = tables.filter((t) => isBookable(t, r));

  // ---- service window
  const times = active.map((x) => toMin(x.time));
  const start = r.serviceStart ? toMin(r.serviceStart) : times.length ? floor15(Math.min(...times)) : 17 * 60;
  const last = r.lastSeating ? toMin(r.lastSeating) : times.length ? ceil15(Math.max(...times)) : 21 * 60;
  const close = last + r.turnLarge;

  // ---- timeline per 15 minutes
  const slots: Slot[] = [];
  for (let t = start; t <= last; t += 15) {
    const arriving = active.filter((x) => { const m = toMin(x.time); return m >= t && m < t + 15; });
    const mid = t + 7;
    const seated = std.assignments.filter((a) => a.startMin <= mid && a.endMin > mid).reduce((s, a) => s + (byId.get(a.reservationId)?.partySize || 0), 0);
    const seatsOpen = bookable.filter((x) => !(blocked.get(x.id) || []).some(([s, e]) => mid >= s && mid < e)).reduce((s, x) => s + x.capacity, 0);
    slots.push({ startMin: t, time: minToLabel(t), covers: arriving.reduce((s, x) => s + x.partySize, 0), parties: arriving.length, seated, seatsOpen, occupancy: seatsOpen ? Math.round((seated / seatsOpen) * 100) : 0 });
  }

  // ---- risks
  const risks: Risk[] = [];
  const heldRooms = Array.from(new Set(blocks.filter((b) => b.roomId && !b.tableId).map((b) => b.roomId)));
  for (const rid of heldRooms) {
    const roomTables = tables.filter((t) => t.roomId === rid);
    const area = roomTables[0]?.area;
    if (area !== "patio") continue;
    const wanted = active.filter((x) => effectivePreference(x) === "patio");
    if (wanted.length) risks.push({ level: "medium", time: "", title: `${wanted.length} booked ${wanted.length === 1 ? "party asked" : "parties asked"} for the ${roomName.get(rid) || "patio"}, which is blocked`,
      detail: `${wanted.map((x) => `${x.guestName} (${x.partySize}) ${minToLabel(toMin(x.time))}`).join(", ")}. Call them to confirm an inside table, or remove the block for their time.` });
  }
  for (const u of std.unseated) {
    const x = byId.get(u.reservationId)!;
    risks.push({ level: "high", time: minToLabel(toMin(x.time)), title: `${x.guestName} (${x.partySize}) has no table`, detail: `${u.reason}. ${u.suggestion || ""}`.trim() });
  }
  // pacing: per-slot and peak 30 minutes
  const cap = r.pacingCovers;
  let i = 0;
  while (i < slots.length) {
    if (slots[i].covers <= cap) { i++; continue; }
    let j = i;
    while (j + 1 < slots.length && slots[j + 1].covers > cap) j++;
    const run = slots.slice(i, j + 1);
    const covers = run.reduce((s, x) => s + x.covers, 0);
    const parties = run.reduce((s, x) => s + x.parties, 0);
    const worst = Math.max(...run.map((x) => x.covers));
    risks.push({
      level: worst > cap * 1.3 ? "high" : "medium",
      time: run.length > 1 ? `${run[0].time}–${minToLabel(run[run.length - 1].startMin + 15)}` : run[0].time,
      title: `Kitchen and floor crunch: ${covers} covers in ${run.length * 15} minutes`,
      detail: `${parties} parties arrive against a pace of ${cap} covers per 15 minutes. Move one or two parties 15–30 minutes earlier or later, or stagger the large tables' orders.`,
    });
    i = j + 1;
  }
  // big parties stacking up
  const big = active.filter((x) => x.partySize >= 8).sort((a, b) => toMin(a.time) - toMin(b.time));
  for (let k = 0; k < big.length; ) {
    const t0 = toMin(big[k].time);
    const win = big.filter((x, idx) => idx >= k && toMin(x.time) < t0 + 45);
    if (win.length >= 3) {
      risks.push({ level: "medium", time: minToLabel(t0), title: `Large parties stacked: ${win.length} tables of 8+ within 45 minutes`,
        detail: `${win.map((w) => `${w.guestName} (${w.partySize}) ${minToLabel(toMin(w.time))}`).join(", ")}. Pre-set these tables, assign a dedicated server, and fire courses on a schedule.` });
      k += win.length;
    } else k++;
  }
  // fragile turns: seated on standard turns but not with the +cushion
  const lost = cush.unseated.filter((u) => !std.unseated.some((s) => s.reservationId === u.reservationId)).map((u) => byId.get(u.reservationId)!);
  if (lost.length) risks.push({ level: lost.length >= 3 ? "high" : "medium", time: lost.map((x) => minToLabel(toMin(x.time))).join(", "),
    title: `If turns run ${r.cushionMin} minutes long, ${lost.length} ${lost.length === 1 ? "party has" : "parties have"} no table`,
    detail: `${lost.map((x) => `${x.guestName} (${x.partySize})`).join(", ")}. Protect these by holding the table, prompting checks on the earlier seating, or moving the booking 15–30 minutes.` });
  // tight hand-offs on the same table
  const tight: string[] = [];
  const perTable = new Map<number, typeof std.assignments>();
  for (const a of std.assignments) for (const id of a.tableIds) perTable.set(id, [...(perTable.get(id) || []), a]);
  perTable.forEach((list, id) => {
    const l = [...list].sort((a, b) => a.startMin - b.startMin);
    for (let k = 1; k < l.length; k++) {
      const gap = l[k].startMin - l[k - 1].endMin;
      if (gap < r.resetMin) tight.push(`${tableById.get(id)?.label}: ${minToLabel(l[k - 1].startMin)} → ${minToLabel(l[k].startMin)} (${Math.max(0, gap)} min to reset)`);
    }
  });
  if (tight.length) risks.push({ level: tight.length > 4 ? "medium" : "low", time: "", title: `${tight.length} back-to-back table ${tight.length === 1 ? "hand-off" : "hand-offs"} under ${r.resetMin} minutes`,
    detail: `${tight.slice(0, 8).join("; ")}${tight.length > 8 ? `; +${tight.length - 8} more` : ""}. Any slow table makes the next party wait.` });
  // preference conflicts
  for (const a of std.assignments) {
    const x = byId.get(a.reservationId)!;
    const pref = effectivePreference(x);
    if (pref === "patio" && a.area !== "patio") risks.push({ level: "low", time: minToLabel(a.startMin), title: `${x.guestName} (${x.partySize}) asked for outside, seated ${AREA[a.area].toLowerCase()}`, detail: `Note: "${x.notes.slice(0, 80)}". Let them know before arrival.` });
    if (pref === "inside" && a.area !== "inside") risks.push({ level: "low", time: minToLabel(a.startMin), title: `${x.guestName} (${x.partySize}) asked for the main dining room, seated ${AREA[a.area].toLowerCase()}`, detail: `Note: "${x.notes.slice(0, 80)}".` });
  }
  // empty chairs locked inside merged tables
  const waste = std.assignments.map((a) => ({ a, x: byId.get(a.reservationId)!, cap: a.tableIds.reduce((s, id) => s + (tableById.get(id)?.capacity || 0), 0) })).filter((w) => w.cap - w.x.partySize >= 3);
  if (waste.length) risks.push({ level: "low", time: "", title: `${waste.reduce((s, w) => s + w.cap - w.x.partySize, 0)} empty chairs at seated tables`,
    detail: waste.slice(0, 6).map((w) => `${w.x.guestName} ${w.x.partySize} on ${w.a.labels} (${w.cap} seats)`).join("; ") + ". Fine if no better fit exists; consider resetting those tables smaller." });
  // big parties without a card
  const noCard = active.filter((x) => x.requiresCard && x.cardStatus !== "on_file" && !x.optedOut);
  if (noCard.length) risks.push({ level: "high", time: "", title: `${noCard.length} large ${noCard.length === 1 ? "party has" : "parties have"} no card on file`,
    detail: `${noCard.map((x) => `${x.guestName} (${x.partySize}) ${minToLabel(toMin(x.time))}`).join(", ")}. A no-show here costs about ${money(noCard.reduce((s, x) => s + x.partySize, 0) * r.avgSpendCents)} in covers.` });
  const patioSeated = std.assignments.filter((a) => a.area === "patio");
  if (patioSeated.length) risks.push({ level: "low", time: "", title: `${patioSeated.length} reservations on the patio`, detail: "Weather-dependent. Have an inside fallback ready, or offer them inside if a table opens." });

  // ---- holes: sellable inventory that respects pacing and resets
  const load = new Map<number, number>(slots.map((s) => [s.startMin, s.covers]));
  const holes: Hole[] = [];
  const areaRank: Record<string, number> = { inside: 0, ballroom: 1, patio: 2 };
  const ballroomInUse = std.assignments.some((a) => a.area === "ballroom") || std.unseated.some((u) => (u.holdTableIds || []).some((id) => tableById.get(id)?.area === "ballroom"));
  const candidates = bookable
    .filter((t) => t.area !== "ballroom" || ballroomInUse)
    .sort((a, b) => areaRank[a.area] - areaRank[b.area] || b.capacity - a.capacity);
  for (const t of candidates) {
    const busy: Interval[] = [
      ...std.assignments.filter((a) => a.tableIds.includes(t.id)).map((a) => [a.startMin, a.endMin] as Interval),
      ...(blocked.get(t.id) || []),
      ...std.unseated.filter((u) => (u.holdTableIds || []).includes(t.id)).map((u) => [u.startMin!, u.endMin!] as Interval),
    ].sort((a, b) => a[0] - b[0]);
    const turn = turnFor(t.capacity, r);
    // free gaps in [start, close]
    let cursor = start;
    const gaps: Interval[] = [];
    for (const [s, e] of busy) { if (s > cursor) gaps.push([cursor, s]); cursor = Math.max(cursor, e); }
    if (cursor < close) gaps.push([cursor, close]);
    for (const [gs, ge] of gaps) {
      const hasNext = ge < close;
      let tt = ceil15(gs === start ? gs : gs + r.resetMin);
      while (tt <= last && tt + turn + (hasNext ? r.resetMin : 0) <= ge) {
        if ((load.get(tt) ?? 0) + t.capacity > cap) { tt += 15; continue; }
        load.set(tt, (load.get(tt) ?? 0) + t.capacity);
        holes.push({ startMin: tt, time: minToLabel(tt), partySize: t.capacity, tableId: t.id, table: t.label, area: t.area, room: roomName.get(t.roomId) || AREA[t.area], mustLeaveBy: hasNext ? minToLabel(ge - r.resetMin) : "" });
        tt = ceil15(tt + turn + r.resetMin);
      }
    }
  }
  holes.sort((a, b) => a.startMin - b.startMin || areaRank[a.area] - areaRank[b.area] || b.partySize - a.partySize);
  const holeCovers = holes.reduce((s, h) => s + h.partySize, 0);

  // ---- metrics
  const covers = active.reduce((s, x) => s + x.partySize, 0);
  const seatedCovers = std.assignments.reduce((s, a) => s + (byId.get(a.reservationId)?.partySize || 0), 0);
  const usedTables = new Set(std.assignments.flatMap((a) => a.tableIds));
  const turns = usedTables.size ? std.assignments.reduce((s, a) => s + a.tableIds.length, 0) / usedTables.size : 0;
  const seatMinutesSold = std.assignments.reduce((s, a) => s + (byId.get(a.reservationId)?.partySize || 0) * (a.endMin - a.startMin), 0);
  const seatMinutesOpen = bookable.reduce((s, t) => {
    const bl = (blocked.get(t.id) || []).reduce((x, [bs, be]) => x + Math.max(0, Math.min(be, close) - Math.max(bs, start)), 0);
    return s + t.capacity * Math.max(0, close - start - bl);
  }, 0);
  const utilization = seatMinutesOpen ? Math.round((seatMinutesSold / seatMinutesOpen) * 100) : 0;
  const peak = slots.reduce((m, s, k) => { const two = s.covers + (slots[k + 1]?.covers || 0); return two > m.covers ? { covers: two, time: s.time, end: minToLabel(s.startMin + 30) } : m; }, { covers: 0, time: "", end: "" });
  const byArea = (area: string) => std.assignments.filter((a) => a.area === area).length;

  // ---- narrative
  const narrative: string[] = [];
  if (!active.length) {
    narrative.push("No reservations on the books for this date yet. Everything below is open inventory.");
  } else {
    narrative.push(`${active.length} parties and ${covers} covers between ${minToLabel(Math.min(...times))} and ${minToLabel(Math.max(...times))}. ` +
      `${byArea("inside")} seat inside${byArea("ballroom") ? `, ${byArea("ballroom")} in the ballroom` : ""}${byArea("patio") ? `, ${byArea("patio")} on the patio` : ""}` +
      `${std.unseated.length ? `, and ${std.unseated.length} can't be seated as booked` : ""}.`);
    narrative.push(`The busiest half hour is ${peak.time}–${peak.end} with ${peak.covers} covers arriving` +
      `${peak.covers > cap * 2 ? `, more than your pace of ${cap} per 15 minutes can absorb` : peak.covers > cap ? ", right at your pace limit" : ", inside your pace limit"}. ` +
      `Seats are ${utilization}% used across service, and each table in use turns about ${turns.toFixed(1)} times.`);
    const hi = risks.filter((x) => x.level === "high").length;
    narrative.push(hi ? `${hi} high-risk ${hi === 1 ? "item needs" : "items need"} attention before service — see the list below.` : "No high-risk items. Watch the medium items during the rush.");
  }
  const walkinTables = tables.filter((t) => walkinBlocked.has(t.id));
  if (walkinTables.length) narrative.push(`${walkinTables.length} tables (${walkinTables.reduce((s, t) => s + t.capacity, 0)} seats) are held for walk-ins and are not offered for reservations.`);
  if (holes.length) {
    const best = Array.from(new Set(holes.map((h) => h.time))).slice(0, 4).join(", ");
    narrative.push(`You can still sell about ${holeCovers} covers (${money(holeCovers * r.avgSpendCents)} at ${money(r.avgSpendCents)} a guest) without breaking pacing or turn times. The best openings start at ${best}.`);
  } else if (active.length) {
    narrative.push("The book is full for your turn times and pacing. Add covers only by shortening turns or raising the pace limit.");
  }

  return {
    date, window: { start: minToLabel(start), last: minToLabel(last) },
    metrics: { parties: active.length, covers, seatedCovers, unseated: std.unseated.length, utilization, turns: Number(turns.toFixed(1)), peak, holeCovers, holeRevenueCents: holeCovers * r.avgSpendCents, bookedRevenueCents: covers * r.avgSpendCents, pace: cap },
    slots, risks: risks.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.level] - { high: 0, medium: 1, low: 2 }[b.level])), holes, narrative,
    plan: std as SeatingPlan,
  };
}
