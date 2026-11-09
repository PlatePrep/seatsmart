import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const locations = sqliteTable("locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  phone: text("phone").notNull().default(""),
});

// area: inside | patio | bar | ballroom
export const diningTables = sqliteTable("dining_tables", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  locationId: integer("location_id").notNull(),
  label: text("label").notNull(),
  capacity: integer("capacity").notNull(),
  area: text("area").notNull().default("inside"),
  shape: text("shape").notNull().default("square"),
  x: integer("x").notNull().default(10),
  y: integer("y").notNull().default(10),
  // tables sharing a merge group + adjacent order can be pushed together
  mergeGroup: text("merge_group").notNull().default(""),
  mergeOrder: integer("merge_order").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  roomId: integer("room_id").notNull().default(0),
  // size on the room canvas, % of width / height (0 = auto)
  w: integer("w").notNull().default(0),
  h: integer("h").notNull().default(0),
});

// A room (dining room, patio, ballroom...) with an optional uploaded floor-plan image.
export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  locationId: integer("location_id").notNull(),
  name: text("name").notNull(),
  area: text("area").notNull().default("inside"), // default area for new tables
  sortOrder: integer("sort_order").notNull().default(0),
  imageData: text("image_data").notNull().default(""), // data URL
  imageW: integer("image_w").notNull().default(0),
  imageH: integer("image_h").notNull().default(0),
});

// status: booked | confirmed | seated | completed | cancelled | no_show
// cardStatus: not_required | none | pending | on_file | failed
export const reservations = sqliteTable("reservations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  locationId: integer("location_id").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  time: text("time").notNull(), // HH:MM 24h
  guestName: text("guest_name").notNull(),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  partySize: integer("party_size").notNull(),
  visits: integer("visits").notNull().default(0),
  bookedAt: text("booked_at").notNull(), // ISO
  notes: text("notes").notNull().default(""),
  birthday: integer("birthday", { mode: "boolean" }).notNull().default(false),
  preference: text("preference").notNull().default("any"), // any | inside | patio
  status: text("status").notNull().default("booked"),
  requiresCard: integer("requires_card", { mode: "boolean" }).notNull().default(false),
  cardStatus: text("card_status").notNull().default("not_required"),
  paymentMethodId: text("payment_method_id").notNull().default(""),
  cardBrand: text("card_brand").notNull().default(""),
  cardLast4: text("card_last4").notNull().default(""),
  outreachToken: text("outreach_token").notNull().default(""),
  optedOut: integer("opted_out", { mode: "boolean" }).notNull().default(false),
  noShowCharged: integer("no_show_charged").notNull().default(0), // cents
});

export const rules = sqliteTable("rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  locationId: integer("location_id").notNull().unique(),
  turnSmall: integer("turn_small").notNull().default(75), // 1-2
  turnMid: integer("turn_mid").notNull().default(105), // 3-6
  turnLarge: integer("turn_large").notNull().default(120), // 7+
  vipMinVisits: integer("vip_min_visits").notNull().default(2),
  priorityPolicy: text("priority_policy").notNull().default("repeat_then_later"),
  cushionMin: integer("cushion_min").notNull().default(20),
  // big-party confirmation defaults
  cardThreshold: integer("card_threshold").notNull().default(10),
  noShowFeeCents: integer("no_show_fee_cents").notNull().default(2500),
  cadence: text("cadence").notNull().default(
    JSON.stringify([
      { offsetHours: 72, channel: "sms_email" },
      { offsetHours: 48, channel: "email" },
      { offsetHours: 24, channel: "sms" },
      { offsetHours: 4, channel: "voice" },
      { offsetHours: 2, channel: "sms_final" },
    ]),
  ),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  locationId: integer("location_id").notNull().unique(),
  mockMode: integer("mock_mode", { mode: "boolean" }).notNull().default(true),
  restaurantName: text("restaurant_name").notNull().default(""),
  synthflowKey: text("synthflow_key").notNull().default(""),
  synthflowAgentId: text("synthflow_agent_id").notNull().default(""),
  synthflowCardAgentId: text("synthflow_card_agent_id").notNull().default(""),
  stripeSecretKey: text("stripe_secret_key").notNull().default(""),
  stripeWebhookSecret: text("stripe_webhook_secret").notNull().default(""),
  twilioSid: text("twilio_sid").notNull().default(""),
  twilioToken: text("twilio_token").notNull().default(""),
  twilioFrom: text("twilio_from").notNull().default(""),
  resendKey: text("resend_key").notNull().default(""),
  emailFrom: text("email_from").notNull().default(""),
  publicBaseUrl: text("public_base_url").notNull().default(""),
  openaiKey: text("openai_key").notNull().default(""),
  visionModel: text("vision_model").notNull().default("gpt-4o"),
});

// Patio "offer inside" calls (v2 feature)
export const calls = sqliteTable("calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  locationId: integer("location_id").notNull(),
  reservationId: integer("reservation_id").notNull(),
  intent: text("intent").notNull(), // offer_inside | card_capture
  status: text("status").notNull().default("queued"),
  outcome: text("outcome").notNull().default(""),
  transcript: text("transcript").notNull().default(""),
  providerId: text("provider_id").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

// status: scheduled | sent | skipped | cancelled | failed
export const campaignSteps = sqliteTable("campaign_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reservationId: integer("reservation_id").notNull(),
  offsetHours: integer("offset_hours").notNull(),
  channel: text("channel").notNull(), // sms_email | email | sms | voice | sms_final | confirm
  sendAt: text("send_at").notNull(), // ISO
  status: text("status").notNull().default("scheduled"),
  providerId: text("provider_id").notNull().default(""),
  detail: text("detail").notNull().default(""),
  sentAt: text("sent_at").notNull().default(""),
});

// inbound + system events
export const outreachEvents = sqliteTable("outreach_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reservationId: integer("reservation_id").notNull(),
  type: text("type").notNull(), // sms_out | email_out | call_out | reply_confirm | reply_stop | card_saved | modified | cancelled | no_show_charge | note
  channel: text("channel").notNull().default(""),
  body: text("body").notNull().default(""),
  at: text("at").notNull(),
});

export const insertLocationSchema = createInsertSchema(locations).omit({ id: true });
export const insertRoomSchema = createInsertSchema(rooms).omit({ id: true });
export const insertTableSchema = createInsertSchema(diningTables).omit({ id: true });
export const insertReservationSchema = createInsertSchema(reservations).omit({ id: true });
export const reservationInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  guestName: z.string().min(1),
  phone: z.string().default(""),
  email: z.string().default(""),
  partySize: z.coerce.number().int().min(1).max(60),
  visits: z.coerce.number().int().min(0).default(0),
  notes: z.string().default(""),
  birthday: z.boolean().default(false),
  preference: z.enum(["any", "inside", "patio"]).default("any"),
  bookedAt: z.string().optional(),
});

export type Location = typeof locations.$inferSelect;
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Room = typeof rooms.$inferSelect;
export type InsertRoom = z.infer<typeof insertRoomSchema>;
export type DiningTable = typeof diningTables.$inferSelect;
export type InsertDiningTable = z.infer<typeof insertTableSchema>;
export type Reservation = typeof reservations.$inferSelect;
export type InsertReservation = z.infer<typeof insertReservationSchema>;
export type ReservationInput = z.infer<typeof reservationInputSchema>;
export type Rules = typeof rules.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Call = typeof calls.$inferSelect;
export type CampaignStep = typeof campaignSteps.$inferSelect;
export type OutreachEvent = typeof outreachEvents.$inferSelect;

export type CadenceStep = { offsetHours: number; channel: string };

export type SeatAssignment = {
  reservationId: number;
  tableIds: number[];
  labels: string;
  area: string;
  startMin: number;
  endMin: number;
  reason: string;
};
export type SeatingPlan = {
  date: string;
  cushion: number;
  assignments: SeatAssignment[];
  unseated: { reservationId: number; reason: string }[];
};
