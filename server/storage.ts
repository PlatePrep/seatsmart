import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { and, eq, inArray, lte, asc, desc } from "drizzle-orm";
import {
  locations, diningTables, rooms, blocks, type Block, type Room, type InsertRoom, reservations, rules, settings, calls, campaignSteps, outreachEvents,
  type Location, type InsertLocation, type DiningTable, type InsertDiningTable,
  type Reservation, type InsertReservation, type Rules, type Settings, type Call,
  type CampaignStep, type OutreachEvent,
} from "@shared/schema";

const sqlite = new Database(process.env.SEATSMART_DB || "data.db");
sqlite.pragma("journal_mode = WAL");

// Additive schema creation (never drops). New columns go through addColumn().
sqlite.exec(`
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS dining_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL, label TEXT NOT NULL,
  capacity INTEGER NOT NULL, area TEXT NOT NULL DEFAULT 'inside', shape TEXT NOT NULL DEFAULT 'square',
  x INTEGER NOT NULL DEFAULT 10, y INTEGER NOT NULL DEFAULT 10, merge_group TEXT NOT NULL DEFAULT '',
  merge_order INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
  guest_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  party_size INTEGER NOT NULL, visits INTEGER NOT NULL DEFAULT 0, booked_at TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '', birthday INTEGER NOT NULL DEFAULT 0, preference TEXT NOT NULL DEFAULT 'any',
  status TEXT NOT NULL DEFAULT 'booked', requires_card INTEGER NOT NULL DEFAULT 0,
  card_status TEXT NOT NULL DEFAULT 'not_required', payment_method_id TEXT NOT NULL DEFAULT '',
  card_brand TEXT NOT NULL DEFAULT '', card_last4 TEXT NOT NULL DEFAULT '',
  outreach_token TEXT NOT NULL DEFAULT '', opted_out INTEGER NOT NULL DEFAULT 0,
  no_show_charged INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL UNIQUE,
  turn_small INTEGER NOT NULL DEFAULT 75, turn_mid INTEGER NOT NULL DEFAULT 105, turn_large INTEGER NOT NULL DEFAULT 120,
  vip_min_visits INTEGER NOT NULL DEFAULT 2, priority_policy TEXT NOT NULL DEFAULT 'repeat_then_later',
  cushion_min INTEGER NOT NULL DEFAULT 20, card_threshold INTEGER NOT NULL DEFAULT 10,
  no_show_fee_cents INTEGER NOT NULL DEFAULT 2500, cadence TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL UNIQUE, mock_mode INTEGER NOT NULL DEFAULT 1,
  restaurant_name TEXT NOT NULL DEFAULT '', synthflow_key TEXT NOT NULL DEFAULT '', synthflow_agent_id TEXT NOT NULL DEFAULT '',
  synthflow_card_agent_id TEXT NOT NULL DEFAULT '', stripe_secret_key TEXT NOT NULL DEFAULT '',
  stripe_webhook_secret TEXT NOT NULL DEFAULT '', twilio_sid TEXT NOT NULL DEFAULT '', twilio_token TEXT NOT NULL DEFAULT '',
  twilio_from TEXT NOT NULL DEFAULT '', resend_key TEXT NOT NULL DEFAULT '', email_from TEXT NOT NULL DEFAULT '',
  public_base_url TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL, reservation_id INTEGER NOT NULL,
  intent TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', outcome TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL DEFAULT '', provider_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS campaign_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id INTEGER NOT NULL, offset_hours INTEGER NOT NULL,
  channel TEXT NOT NULL, send_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled',
  provider_id TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', sent_at TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS outreach_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id INTEGER NOT NULL, type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL, name TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'inside', sort_order INTEGER NOT NULL DEFAULT 0,
  image_data TEXT NOT NULL DEFAULT '', image_w INTEGER NOT NULL DEFAULT 0, image_h INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL, date TEXT NOT NULL,
  room_id INTEGER NOT NULL DEFAULT 0, table_id INTEGER NOT NULL DEFAULT 0, start_time TEXT NOT NULL DEFAULT '',
  end_time TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'walkin', note TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS idx_res_loc_date ON reservations(location_id, date);
CREATE INDEX IF NOT EXISTS idx_steps_due ON campaign_steps(status, send_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_res_token ON reservations(outreach_token) WHERE outreach_token <> '';
`);

function addColumn(table: string, col: string, ddl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}
addColumn("dining_tables", "room_id", "INTEGER NOT NULL DEFAULT 0");
addColumn("reservations", "assigned_tables", "TEXT NOT NULL DEFAULT ''");
addColumn("dining_tables", "w", "INTEGER NOT NULL DEFAULT 0");
addColumn("dining_tables", "h", "INTEGER NOT NULL DEFAULT 0");
addColumn("rules", "pacing_covers", "INTEGER NOT NULL DEFAULT 30");
addColumn("rules", "avg_spend_cents", "INTEGER NOT NULL DEFAULT 7500");
addColumn("rules", "reset_min", "INTEGER NOT NULL DEFAULT 10");
addColumn("rules", "use_ballroom", "INTEGER NOT NULL DEFAULT 1");
addColumn("rules", "service_start", "TEXT NOT NULL DEFAULT ''");
addColumn("rules", "last_seating", "TEXT NOT NULL DEFAULT ''");
addColumn("settings", "openai_key", "TEXT NOT NULL DEFAULT ''");
addColumn("settings", "vision_model", "TEXT NOT NULL DEFAULT 'gpt-4o'");

export const db = drizzle(sqlite);
export const rawDb = sqlite;

export const storage = {
  // locations
  listLocations: (): Location[] => db.select().from(locations).orderBy(asc(locations.id)).all(),
  getLocation: (id: number) => db.select().from(locations).where(eq(locations.id, id)).get(),
  createLocation: (data: InsertLocation): Location => {
    const loc = db.insert(locations).values(data).returning().get();
    db.insert(rules).values({ locationId: loc.id }).run();
    db.insert(settings).values({ locationId: loc.id, restaurantName: loc.name }).run();
    return loc;
  },
  updateLocation: (id: number, data: Partial<InsertLocation>) =>
    db.update(locations).set(data).where(eq(locations.id, id)).returning().get(),

  // rooms
  listRooms: (locationId: number): Room[] =>
    db.select().from(rooms).where(eq(rooms.locationId, locationId)).orderBy(asc(rooms.sortOrder), asc(rooms.id)).all(),
  getRoom: (id: number) => db.select().from(rooms).where(eq(rooms.id, id)).get(),
  createRoom: (data: InsertRoom): Room => db.insert(rooms).values(data).returning().get(),
  updateRoom: (id: number, data: Partial<InsertRoom>) => db.update(rooms).set(data).where(eq(rooms.id, id)).returning().get(),
  deleteRoom: (id: number) => {
    db.delete(diningTables).where(eq(diningTables.roomId, id)).run();
    return db.delete(rooms).where(eq(rooms.id, id)).run();
  },

  // blocks
  listBlocks: (locationId: number, date: string): Block[] =>
    db.select().from(blocks).where(and(eq(blocks.locationId, locationId), eq(blocks.date, date))).orderBy(asc(blocks.id)).all(),
  getBlock: (id: number) => db.select().from(blocks).where(eq(blocks.id, id)).get(),
  createBlock: (data: Omit<Block, "id">) => db.insert(blocks).values(data).returning().get(),
  deleteBlock: (id: number) => db.delete(blocks).where(eq(blocks.id, id)).run(),

  // tables
  listTables: (locationId: number): DiningTable[] =>
    db.select().from(diningTables).where(eq(diningTables.locationId, locationId)).orderBy(asc(diningTables.id)).all(),
  getTable: (id: number) => db.select().from(diningTables).where(eq(diningTables.id, id)).get(),
  createTable: (data: InsertDiningTable) => db.insert(diningTables).values(data).returning().get(),
  updateTable: (id: number, data: Partial<InsertDiningTable>) =>
    db.update(diningTables).set(data).where(eq(diningTables.id, id)).returning().get(),
  deleteTable: (id: number) => db.delete(diningTables).where(eq(diningTables.id, id)).run(),

  // reservations
  listReservations: (locationId: number, date?: string): Reservation[] =>
    db.select().from(reservations)
      .where(date ? and(eq(reservations.locationId, locationId), eq(reservations.date, date)) : eq(reservations.locationId, locationId))
      .orderBy(asc(reservations.date), asc(reservations.time)).all(),
  listBigParties: (locationId: number): Reservation[] =>
    db.select().from(reservations)
      .where(and(eq(reservations.locationId, locationId), eq(reservations.requiresCard, true)))
      .orderBy(asc(reservations.date), asc(reservations.time)).all(),
  getReservation: (id: number) => db.select().from(reservations).where(eq(reservations.id, id)).get(),
  getReservationByToken: (token: string) =>
    token ? db.select().from(reservations).where(eq(reservations.outreachToken, token)).get() : undefined,
  createReservation: (data: InsertReservation) => db.insert(reservations).values(data).returning().get(),
  updateReservation: (id: number, data: Partial<InsertReservation>) =>
    db.update(reservations).set(data).where(eq(reservations.id, id)).returning().get(),
  deleteReservation: (id: number) => {
    db.delete(campaignSteps).where(eq(campaignSteps.reservationId, id)).run();
    db.delete(outreachEvents).where(eq(outreachEvents.reservationId, id)).run();
    return db.delete(reservations).where(eq(reservations.id, id)).run();
  },
  findUpcomingByPhone: (digits: string): Reservation | undefined => {
    const all = db.select().from(reservations).where(inArray(reservations.status, ["booked", "confirmed"])).all();
    return all.filter((r) => r.phone.replace(/\D/g, "").endsWith(digits.slice(-10)))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  },

  // rules / settings
  getRules: (locationId: number): Rules => {
    let r = db.select().from(rules).where(eq(rules.locationId, locationId)).get();
    if (!r) r = db.insert(rules).values({ locationId }).returning().get();
    return r;
  },
  updateRules: (locationId: number, data: Partial<Rules>) => {
    storage.getRules(locationId);
    const { id: _i, locationId: _l, ...rest } = data as any;
    return db.update(rules).set(rest).where(eq(rules.locationId, locationId)).returning().get();
  },
  getSettings: (locationId: number): Settings => {
    let s = db.select().from(settings).where(eq(settings.locationId, locationId)).get();
    if (!s) s = db.insert(settings).values({ locationId }).returning().get();
    return s;
  },
  updateSettings: (locationId: number, data: Partial<Settings>) => {
    storage.getSettings(locationId);
    const { id: _i, locationId: _l, ...rest } = data as any;
    return db.update(settings).set(rest).where(eq(settings.locationId, locationId)).returning().get();
  },

  // calls
  listCalls: (locationId: number): Call[] =>
    db.select().from(calls).where(eq(calls.locationId, locationId)).orderBy(desc(calls.id)).all(),
  createCall: (data: Omit<Call, "id">) => db.insert(calls).values(data).returning().get(),
  updateCall: (id: number, data: Partial<Call>) => db.update(calls).set(data).where(eq(calls.id, id)).returning().get(),
  getCallByProvider: (pid: string) => db.select().from(calls).where(eq(calls.providerId, pid)).get(),

  // campaign
  listSteps: (reservationId: number): CampaignStep[] =>
    db.select().from(campaignSteps).where(eq(campaignSteps.reservationId, reservationId)).orderBy(asc(campaignSteps.sendAt), asc(campaignSteps.id)).all(),
  getStep: (id: number) => db.select().from(campaignSteps).where(eq(campaignSteps.id, id)).get(),
  createStep: (data: Omit<CampaignStep, "id">) => db.insert(campaignSteps).values(data).returning().get(),
  updateStep: (id: number, data: Partial<CampaignStep>) =>
    db.update(campaignSteps).set(data).where(eq(campaignSteps.id, id)).returning().get(),
  dueSteps: (nowIso: string): CampaignStep[] =>
    db.select().from(campaignSteps).where(and(eq(campaignSteps.status, "scheduled"), lte(campaignSteps.sendAt, nowIso))).all(),
  cancelScheduledSteps: (reservationId: number, why: string) =>
    db.update(campaignSteps).set({ status: "cancelled", detail: why })
      .where(and(eq(campaignSteps.reservationId, reservationId), eq(campaignSteps.status, "scheduled"))).run(),

  listEvents: (reservationId: number): OutreachEvent[] =>
    db.select().from(outreachEvents).where(eq(outreachEvents.reservationId, reservationId)).orderBy(desc(outreachEvents.id)).all(),
  addEvent: (reservationId: number, type: string, channel: string, body: string) =>
    db.insert(outreachEvents).values({ reservationId, type, channel, body, at: new Date().toISOString() }).returning().get(),
};
