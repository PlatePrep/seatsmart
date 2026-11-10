import type { Block, DiningTable, Reservation, Rules, SeatingPlan, SeatAssignment } from "@shared/schema";
import { toMin, minToLabel } from "@shared/time";

export function turnFor(party: number, r: Rules): number {
  if (party <= 2) return r.turnSmall;
  if (party <= 6) return r.turnMid;
  return r.turnLarge;
}

type Unit = { tableIds: number[]; labels: string; capacity: number; area: string; size: number };
export type Interval = [number, number];

/** Areas reservations can be seated in, in fallback order. */
export function bookableAreas(r: Rules): string[] {
  return r.useBallroom ? ["inside", "ballroom", "patio"] : ["inside", "patio"];
}
export function isBookable(t: DiningTable, r: Rules) {
  return t.active && bookableAreas(r).includes(t.area);
}

/** Single tables plus every contiguous run inside a merge group. */
export function buildUnits(tables: DiningTable[], r: Rules): Unit[] {
  const seatable = tables.filter((t) => isBookable(t, r));
  const units: Unit[] = seatable.map((t) => ({ tableIds: [t.id], labels: t.label, capacity: t.capacity, area: t.area, size: 1 }));
  const groups = new Map<string, DiningTable[]>();
  for (const t of seatable) if (t.mergeGroup) groups.set(t.mergeGroup, [...(groups.get(t.mergeGroup) || []), t]);
  groups.forEach((list) => {
    const g = [...list].sort((a: DiningTable, b: DiningTable) => a.mergeOrder - b.mergeOrder);
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const run = g.slice(i, j + 1);
        if (new Set(run.map((t) => t.area)).size > 1) continue;
        units.push({
          tableIds: run.map((t) => t.id),
          labels: run.map((t) => t.label).join("+"),
          capacity: run.reduce((s, t) => s + t.capacity, 0),
          area: run[0].area,
          size: run.length,
        });
      }
    }
  });
  return units;
}

/** Blocked intervals per table id. kinds = which block kinds to include. */
export function blockedIntervals(tables: DiningTable[], blocks: Block[], kinds = ["walkin", "closed"]): Map<number, Interval[]> {
  const out = new Map<number, Interval[]>();
  for (const b of blocks) {
    if (!kinds.includes(b.kind)) continue;
    const iv: Interval = [b.startTime ? toMin(b.startTime) : 0, b.endTime ? toMin(b.endTime) : 24 * 60];
    for (const t of tables) {
      if ((b.tableId && t.id === b.tableId) || (!b.tableId && b.roomId && t.roomId === b.roomId)) {
        out.set(t.id, [...(out.get(t.id) || []), iv]);
      }
    }
  }
  return out;
}

/** OpenTable notes often carry the seating request. */
export function effectivePreference(res: Reservation): "inside" | "patio" | "any" {
  if (res.preference !== "any") return res.preference as any;
  const n = res.notes || "";
  if (/\b(outside|outdoor|patio)\b/i.test(n)) return "patio";
  if (/main dining|inside|indoor/i.test(n)) return "inside";
  return "any";
}

export function priorityOrder(list: Reservation[], r: Rules): Reservation[] {
  const vip = (x: Reservation) => (x.visits >= r.vipMinVisits ? 1 : 0);
  return [...list].sort((a, b) => {
    if (vip(b) !== vip(a)) return vip(b) - vip(a);
    const cmp = a.bookedAt.localeCompare(b.bookedAt);
    if (cmp !== 0) return r.priorityPolicy === "repeat_then_earlier" ? cmp : -cmp;
    return toMin(a.time) - toMin(b.time);
  });
}

const AREA_NAME: Record<string, string> = { inside: "inside", ballroom: "ballroom", patio: "patio" };

export function generatePlan(
  date: string, tables: DiningTable[], resList: Reservation[], r: Rules, cushion = 0, blocks: Block[] = [],
): SeatingPlan {
  const units = buildUnits(tables, r);
  const blocked = blockedIntervals(tables, blocks);
  const busy = new Map<number, Interval[]>();
  const overlaps = (list: Interval[] | undefined, s: number, e: number) => (list || []).some(([bs, be]) => s < be && e > bs);
  const tableFree = (id: number, s: number, e: number) => !overlaps(busy.get(id), s, e) && !overlaps(blocked.get(id), s, e);
  const isFree = (u: Unit, s: number, e: number) => u.tableIds.every((id) => tableFree(id, s, e) && !overlaps(tentative.get(id), s, e));
  const tentative = new Map<number, Interval[]>(); // tables held by custom set-up suggestions
  const book = (u: Unit, s: number, e: number) =>
    u.tableIds.forEach((id) => busy.set(id, [...(busy.get(id) || []), [s, e]]));

  const active = resList.filter((x) => !["cancelled", "no_show"].includes(x.status));
  const assignments: SeatAssignment[] = [];
  const unseated: SeatingPlan["unseated"] = [];
  const vipSet = new Set(active.filter((x) => x.visits >= r.vipMinVisits).map((x) => x.id));
  const areas = bookableAreas(r);

  for (const res of priorityOrder(active, r)) {
    const start = toMin(res.time);
    const end = start + turnFor(res.partySize, r) + cushion;
    const pref = effectivePreference(res);
    const areaOrder = pref === "patio" ? ["patio", ...areas.filter((a) => a !== "patio")] : areas;
    let placed: Unit | undefined;
    for (const area of areaOrder) {
      const cands = units
        .filter((u) => u.area === area && u.capacity >= res.partySize && isFree(u, start, end))
        .sort((a, b) => (a.capacity - res.partySize) - (b.capacity - res.partySize) || a.size - b.size);
      if (cands.length) { placed = cands[0]; break; }
    }
    if (!placed) {
      const pad = r.resetMin || 0; // big set-ups need time to reset between parties
      const fix = customSetup(tables, r, res.partySize, start, end, (id, s, e) => tableFree(id, s - pad, e + pad) && !overlaps(tentative.get(id), s - pad, e + pad));
      const fixTables = fix.ids.map((id) => tables.find((t) => t.id === id)!).filter(Boolean);
      // Ballroom is open: seat big parties there for real by pushing rounds together.
      if (fixTables.length && res.partySize >= r.cardThreshold && fixTables.every((t) => t.area === "ballroom")) {
        const u: Unit = { tableIds: fix.ids, labels: fixTables.map((t) => t.label).join("+"), capacity: fixTables.reduce((x, t) => x + t.capacity, 0), area: "ballroom", size: fixTables.length };
        book(u, start, end);
        assignments.push({ reservationId: res.id, tableIds: u.tableIds, labels: u.labels, area: "ballroom", startMin: start, endMin: end, reason: `Big party: push ballroom rounds ${u.labels} together (${u.capacity} seats)` });
        continue;
      }
      for (const id of fix.ids) tentative.set(id, [...(tentative.get(id) || []), [start, end]]);
      unseated.push({ reservationId: res.id, reason: `No table or merge for ${res.partySize} at ${minToLabel(start)}`, suggestion: fix.text, holdTableIds: fix.ids, startMin: start, endMin: end });
      continue;
    }
    book(placed, start, end);
    const first = areaOrder[0];
    const reason = placed.area !== first && pref === "patio"
      ? `Asked for patio — patio unavailable, seated ${AREA_NAME[placed.area]}`
      : placed.area !== "inside" && placed.area !== first
        ? `Inside full at this time — ${AREA_NAME[placed.area]} ${placed.area === "patio" ? "fallback" : "overflow"}`
        : placed.area === "patio" && pref === "patio" ? "Asked for patio"
        : vipSet.has(res.id) ? `Repeat guest (${res.visits} visits) — inside priority`
        : placed.size > 1 ? `Merged ${placed.labels} to fit ${res.partySize}` : "Best-fit table";
    assignments.push({ reservationId: res.id, tableIds: placed.tableIds, labels: placed.labels, area: placed.area, startMin: start, endMin: end, reason });
  }
  assignments.sort((a, b) => a.startMin - b.startMin);
  return { date, cushion, assignments, unseated };
}

/** For a party no merge group fits: the fewest free tables in one room that add up to the party. */
function customSetup(tables: DiningTable[], r: Rules, party: number, s: number, e: number, free: (id: number, s: number, e: number) => boolean): { text: string; ids: number[] } {
  let best: DiningTable[] | null = null;
  let bestScore = Infinity;
  const byRoom = new Map<string, DiningTable[]>();
  for (const t of tables) if (isBookable(t, r) && free(t.id, s, e)) {
    const k = `${t.roomId}:${t.area}`;
    byRoom.set(k, [...(byRoom.get(k) || []), t]);
  }
  byRoom.forEach((list) => {
    const pick: DiningTable[] = [];
    let seats = 0;
    for (const t of [...list].sort((a, b) => b.capacity - a.capacity)) {
      if (seats >= party) break;
      pick.push(t); seats += t.capacity;
    }
    if (seats < party) return;
    const free = list.reduce((x, t) => x + t.capacity, 0);
    // fewer tables wins; big parties prefer the ballroom (private, keeps the dining room turning); then the room with most spare seats
    const score = pick.length * 100 - (party >= r.cardThreshold && list[0].area === "ballroom" ? 150 : 0) - Math.min(free, 99);
    if (best === null || score < bestScore) { best = pick; bestScore = score; }
  });
  if (!best) return { text: "Not enough free seats in any one room at this time — move the time or split the party.", ids: [] };
  const b = best as DiningTable[];
  return { text: `Custom set-up: push together ${b.map((t) => t.label).join(" + ")} (${b.reduce((x, t) => x + t.capacity, 0)} seats, ${AREA_NAME[b[0].area] || b[0].area}).`, ids: b.map((t) => t.id) };
}

/** Tables free from `at` for at least windowMin, given a plan. Closed blocks remove tables; walk-in blocks keep them. */
export function walkInAvailability(tables: DiningTable[], plan: SeatingPlan, atMin: number, windowMin: number, r: Rules, blocks: Block[] = []) {
  const closed = blockedIntervals(tables, blocks, ["closed"]);
  const held = blockedIntervals(tables, blocks, ["walkin"]);
  const out: { tableId: number; label: string; capacity: number; area: string; freeFor: number; walkInOnly: boolean }[] = [];
  for (const t of tables.filter((t) => t.active && (isBookable(t, r) || t.area === "bar"))) {
    if ((closed.get(t.id) || []).some(([s, e]) => atMin >= s && atMin < e)) continue;
    const blocksOn = plan.assignments.filter((a) => a.tableIds.includes(t.id));
    if (blocksOn.some((b) => b.startMin <= atMin && b.endMin > atMin)) continue;
    const next = blocksOn.filter((b) => b.startMin > atMin).sort((a, b) => a.startMin - b.startMin)[0];
    const nextClosed = (closed.get(t.id) || []).filter(([s]) => s > atMin).sort((a, b) => a[0] - b[0])[0];
    const until = Math.min(next ? next.startMin : 24 * 60, nextClosed ? nextClosed[0] : 24 * 60);
    const freeFor = until - atMin;
    const walkInOnly = (held.get(t.id) || []).some(([s, e]) => atMin >= s && atMin < e);
    if (t.area === "bar") continue;
    if (freeFor >= Math.min(windowMin, 75)) out.push({ tableId: t.id, label: t.label, capacity: t.capacity, area: t.area, freeFor, walkInOnly });
  }
  return out.sort((a, b) => Number(b.walkInOnly) - Number(a.walkInOnly) || b.freeFor - a.freeFor);
}
