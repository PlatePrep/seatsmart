import type { Server, Shift } from "./schema";
import { toMin } from "./time";

export const shiftTables = (s: Shift) => (s.tableIds ? s.tableIds.split(",").map(Number) : []);
export const shiftStart = (s: Shift) => toMin(s.startTime);
export const shiftEnd = (s: Shift) => (s.endTime ? toMin(s.endTime) : 24 * 60);

/** The shift covering a table at a minute of the day (latest start wins on overlap). */
export function shiftFor(shifts: Shift[], tableId: number, min: number): Shift | undefined {
  return shifts
    .filter((s) => shiftTables(s).includes(tableId) && shiftStart(s) <= min && shiftEnd(s) > min)
    .sort((a, b) => shiftStart(b) - shiftStart(a))[0];
}
export function serverFor(shifts: Shift[], servers: Server[], tableId: number, min: number): Server | undefined {
  const s = shiftFor(shifts, tableId, min);
  return s ? servers.find((x) => x.id === s.serverId) : undefined;
}
/** Pairs of shifts that hold the same table at overlapping times. */
export function shiftOverlaps(shifts: Shift[]): { a: Shift; b: Shift; tableIds: number[] }[] {
  const out: { a: Shift; b: Shift; tableIds: number[] }[] = [];
  for (let i = 0; i < shifts.length; i++) for (let j = i + 1; j < shifts.length; j++) {
    const a = shifts[i], b = shifts[j];
    if (a.serverId === b.serverId) continue;
    if (shiftStart(a) >= shiftEnd(b) || shiftStart(b) >= shiftEnd(a)) continue;
    const t = shiftTables(a).filter((x) => shiftTables(b).includes(x));
    if (t.length) out.push({ a, b, tableIds: t });
  }
  return out;
}
export function nameInitials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : p[0][1] || "")).toUpperCase() : "?";
}
