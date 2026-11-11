// Version history: point-in-time snapshots of one location's setup and book, restorable in one click.
// Covers rooms (minus the uploaded image), tables, reservations, rules, pacing-by-date, blocks, servers and shifts.
// Not covered on purpose: API keys/settings, sent texts/calls/emails and payment history (those happened for real).
import { createHash } from "node:crypto";
import { sqlite } from "./storage";

sqlite.exec(`
CREATE TABLE IF NOT EXISTS versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL, created_at TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'auto', hash TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '', data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_versions_loc ON versions(location_id, id);
`);

const TABLES = ["rooms", "dining_tables", "reservations", "rules", "pacing_overrides", "blocks", "servers", "shifts"] as const;
const KEEP = 300; // auto versions kept per location; manual ones are never pruned
const AUTO_GAP_MS = 2 * 60_000; // throttle for automatic "before change" snapshots

function cols(table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}
function capture(locationId: number): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const t of TABLES) {
    const c = cols(t).filter((x) => !(t === "rooms" && x === "image_data"));
    out[t] = sqlite.prepare(`SELECT ${c.join(",")} FROM ${t} WHERE location_id = ? ORDER BY id`).all(locationId);
  }
  return out;
}
function summarize(d: Record<string, any[]>) {
  const live = (d.reservations || []).filter((r) => !["cancelled", "no_show"].includes(r.status));
  return `${live.length} reservations · ${(d.dining_tables || []).length} tables · ${(d.blocks || []).length} blocks · ${(d.shifts || []).length} shifts`;
}

export type VersionRow = { id: number; locationId: number; createdAt: string; label: string; kind: string; summary: string };

/** Save a version. kind: auto (before a change) | manual (Save version) | system (import, assistant, restore). */
export function saveVersion(locationId: number, label: string, kind: "auto" | "manual" | "system" = "system"): VersionRow | null {
  const data = capture(locationId);
  const json = JSON.stringify(data);
  const hash = createHash("sha1").update(json).digest("hex");
  const last = sqlite.prepare(`SELECT id, hash, created_at, kind FROM versions WHERE location_id = ? ORDER BY id DESC LIMIT 1`).get(locationId) as any;
  if (kind === "auto") {
    if (last && last.hash === hash) return null; // nothing changed since the last version
    if (last && Date.now() - Date.parse(last.created_at) < AUTO_GAP_MS) return null;
  } else if (last && last.hash === hash && kind === "system") {
    // same state as the last version: just relabel nothing, keep history short
    return null;
  }
  const createdAt = new Date().toISOString();
  const summary = summarize(data);
  const info = sqlite.prepare(`INSERT INTO versions (location_id, created_at, label, kind, hash, summary, data) VALUES (?,?,?,?,?,?,?)`)
    .run(locationId, createdAt, label.slice(0, 160), kind, hash, summary, json);
  // prune old automatic versions
  sqlite.prepare(`DELETE FROM versions WHERE location_id = ? AND kind <> 'manual' AND id NOT IN (
    SELECT id FROM versions WHERE location_id = ? AND kind <> 'manual' ORDER BY id DESC LIMIT ${KEEP})`).run(locationId, locationId);
  return { id: Number(info.lastInsertRowid), locationId, createdAt, label, kind, summary };
}

export function listVersions(locationId: number): VersionRow[] {
  return (sqlite.prepare(`SELECT id, location_id, created_at, label, kind, summary FROM versions WHERE location_id = ? ORDER BY id DESC LIMIT 400`).all(locationId) as any[])
    .map((v) => ({ id: v.id, locationId: v.location_id, createdAt: v.created_at, label: v.label, kind: v.kind, summary: v.summary }));
}
export function getVersion(id: number) {
  return sqlite.prepare(`SELECT * FROM versions WHERE id = ?`).get(id) as any;
}
export function renameVersion(id: number, label: string) {
  sqlite.prepare(`UPDATE versions SET label = ?, kind = 'manual' WHERE id = ?`).run(label.slice(0, 160), id);
}

/** What would change if we restored this version (counts per area). */
export function diffVersion(id: number) {
  const v = getVersion(id);
  if (!v) return null;
  const then = JSON.parse(v.data) as Record<string, any[]>;
  const now = capture(v.location_id);
  const out: Record<string, { added: number; removed: number; changed: number }> = {};
  for (const t of TABLES) {
    const a = new Map((then[t] || []).map((r) => [r.id, JSON.stringify(r)]));
    const b = new Map((now[t] || []).map((r) => [r.id, JSON.stringify(r)]));
    let added = 0, removed = 0, changed = 0;
    a.forEach((val, k) => { if (!b.has(k)) added++; else if (b.get(k) !== val) changed++; });
    b.forEach((_v, k) => { if (!a.has(k)) removed++; });
    out[t] = { added, removed, changed };
  }
  return out;
}

/** Restore a version. Saves the current state first so the restore itself can be undone. */
export function restoreVersion(id: number): { ok: true; backupId: number | null } {
  const v = getVersion(id);
  if (!v) throw new Error("Version not found");
  const loc = v.location_id as number;
  const backup = saveVersion(loc, `Before restoring “${v.label || "version " + v.id}”`, "system");
  const data = JSON.parse(v.data) as Record<string, any[]>;
  const tx = sqlite.transaction(() => {
    // keep floor-plan images: they aren't stored in versions
    const images = new Map((sqlite.prepare(`SELECT id, image_data FROM rooms WHERE location_id = ?`).all(loc) as any[]).map((r) => [r.id, r.image_data]));
    for (const t of TABLES) {
      const live = new Set(cols(t));
      sqlite.prepare(`DELETE FROM ${t} WHERE location_id = ?`).run(loc);
      for (const row of data[t] || []) {
        const r: any = { ...row };
        if (t === "rooms") r.image_data = images.get(r.id) || "";
        const keys = Object.keys(r).filter((k) => live.has(k));
        sqlite.prepare(`INSERT INTO ${t} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((k) => r[k]));
      }
    }
    // reminders scheduled for reservations that no longer exist are dropped
    sqlite.prepare(`UPDATE campaign_steps SET status = 'cancelled' WHERE status = 'scheduled' AND reservation_id NOT IN (SELECT id FROM reservations)`).run();
  });
  tx();
  return { ok: true, backupId: backup?.id ?? null };
}
