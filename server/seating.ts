import type { DiningTable, Reservation, Rules, SeatingPlan, SeatAssignment } from "@shared/schema";
import { toMin } from "@shared/time";

export function turnFor(party: number, r: Rules): number {
  if (party <= 2) return r.turnSmall;
  if (party <= 6) return r.turnMid;
  return r.turnLarge;
}

type Unit = { tableIds: number[]; labels: string; capacity: number; area: string; size: number };

/** Single tables plus every contiguous run inside a merge group. */
export function buildUnits(tables: DiningTable[]): Unit[] {
  const seatable = tables.filter((t) => t.active && (t.area === "inside" || t.area === "patio"));
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

export function priorityOrder(list: Reservation[], r: Rules): Reservation[] {
  const vip = (x: Reservation) => (x.visits >= r.vipMinVisits ? 1 : 0);
  return [...list].sort((a, b) => {
    if (vip(b) !== vip(a)) return vip(b) - vip(a);
    const cmp = a.bookedAt.localeCompare(b.bookedAt);
    if (cmp !== 0) return r.priorityPolicy === "repeat_then_earlier" ? cmp : -cmp;
    return toMin(a.time) - toMin(b.time);
  });
}

export function generatePlan(
  date: string, tables: DiningTable[], resList: Reservation[], r: Rules, cushion = 0,
): SeatingPlan {
  const units = buildUnits(tables);
  const busy = new Map<number, [number, number][]>();
  const isFree = (u: Unit, s: number, e: number) =>
    u.tableIds.every((id) => (busy.get(id) || []).every(([bs, be]) => e <= bs || s >= be));
  const book = (u: Unit, s: number, e: number) =>
    u.tableIds.forEach((id) => busy.set(id, [...(busy.get(id) || []), [s, e]]));

  const active = resList.filter((x) => !["cancelled", "no_show"].includes(x.status));
  const assignments: SeatAssignment[] = [];
  const unseated: SeatingPlan["unseated"] = [];
  const vipSet = new Set(active.filter((x) => x.visits >= r.vipMinVisits).map((x) => x.id));

  for (const res of priorityOrder(active, r)) {
    const start = toMin(res.time);
    const end = start + turnFor(res.partySize, r) + cushion;
    const areaOrder = res.preference === "patio" ? ["patio", "inside"] : ["inside", "patio"];
    let placed: Unit | undefined;
    for (const area of areaOrder) {
      const cands = units
        .filter((u) => u.area === area && u.capacity >= res.partySize && isFree(u, start, end))
        .sort((a, b) => (a.capacity - res.partySize) - (b.capacity - res.partySize) || a.size - b.size);
      if (cands.length) { placed = cands[0]; break; }
    }
    if (!placed) { unseated.push({ reservationId: res.id, reason: `No free table for ${res.partySize} at ${res.time}` }); continue; }
    book(placed, start, end);
    const reason = placed.area === "patio" && res.preference !== "patio"
      ? "Inside full at this time — patio fallback"
      : vipSet.has(res.id) ? `Repeat guest (${res.visits} visits) — inside priority`
      : placed.size > 1 ? `Merged ${placed.labels} to fit ${res.partySize}` : "Best-fit table";
    assignments.push({ reservationId: res.id, tableIds: placed.tableIds, labels: placed.labels, area: placed.area, startMin: start, endMin: end, reason });
  }
  assignments.sort((a, b) => a.startMin - b.startMin);
  return { date, cushion, assignments, unseated };
}

/** Tables free from `at` for at least windowMin, given a plan. */
export function walkInAvailability(tables: DiningTable[], plan: SeatingPlan, atMin: number, windowMin: number) {
  const out: { tableId: number; label: string; capacity: number; area: string; freeFor: number }[] = [];
  for (const t of tables.filter((t) => t.active && (t.area === "inside" || t.area === "patio"))) {
    const blocks = plan.assignments.filter((a) => a.tableIds.includes(t.id));
    if (blocks.some((b) => b.startMin <= atMin && b.endMin > atMin)) continue;
    const next = blocks.filter((b) => b.startMin > atMin).sort((a, b) => a.startMin - b.startMin)[0];
    const freeFor = next ? next.startMin - atMin : 24 * 60;
    if (freeFor >= Math.min(windowMin, 75)) out.push({ tableId: t.id, label: t.label, capacity: t.capacity, area: t.area, freeFor });
  }
  return out.sort((a, b) => b.freeFor - a.freeFor);
}
