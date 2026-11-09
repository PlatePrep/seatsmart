# SeatSmart

Host-stand seating and big-party confirmations for The Chateau (Anna Maria, FL and Bolton Landing, NY).

## What it does

- **Seating plan.** Everyone sits inside when there is room; the patio is the fallback. Inside goes first to repeat guests (2+ visits), then to the latest bookings. Turn times: 1–2 guests 75 min, 3–6 guests 105 min, 7+ guests 120 min. Adjacent 2-tops and 4-tops in a merge group combine as needed. Each plan is shown twice: standard turns and with a +20 min cushion. Birthday rows are gold and patio rows are pink. Print-ready.
- **Floor plan.** Each location has rooms (e.g. Main dining, Patio, Ballroom). Upload a screenshot, photo or PDF of each room; it becomes the background you place tables on. **Read tables** uses an OpenAI vision model (key in Settings → Floor-plan reading) to pull table numbers, seats and positions from the image for review. Drag-and-drop tables. You can add, edit and delete tables and set merge groups and their order.
- **Tonight dashboard.** Shows covers, repeat guests, the next seatings, big parties at risk, and which tables can safely take a walk-in.
- **Reservations.** Day view, add/edit/cancel, and OpenTable CSV import (Date, Time, Guest, Party size, Phone, Email, Visits, Notes).
- **Big-party confirmations (parties of 10+).** Card on file through Stripe Checkout in setup mode (no pre-auth). The no-show fee is $25 per seat by default and can be changed.
  - Reminder schedule: T-72h SMS + email, T-48h email, T-24h SMS, T-4h Synthflow AI call, T-2h final SMS ("card not received, table may be released").
  - Reminders stop once a card is on file or the guest texts STOP. A CONFIRM reply confirms attendance, but card reminders keep going until a card is saved.
  - Host view shows a badge for each party (No card / Pending / On file / At risk), the step timeline, an activity log, send-now by channel, simulated replies, message previews, and a no-show charge button.
  - Guest page `/#/r/{token}`: add a card, change party size or time (closes 2 hours before), or cancel.
- **AI calls.** Synthflow card-reminder calls, plus "offer inside" calls for patio guests, with transcripts.
- **Multi-location.** Each location has its own rules and settings.

## Run

```bash
npm ci
npm run dev          # http://localhost:5000
npm run build && npm start
```

Data is stored in SQLite (`data.db`, or set `SEATSMART_DB=/path/file.db`). It seeds demo data when empty. Delete the file to reset.

## Staff password

The host app sits behind one shared staff password. Guest card pages (`/#/r/{token}`) and webhooks stay open.

- Set `APP_PASSWORD` before the first start. If it isn't set, the server generates a password and prints it to the console once.
- You can change the password in **Settings → Staff password**. Changing it signs out every device.
- Locked out? Restart with `APP_PASSWORD=new-password APP_PASSWORD_RESET=1`.
- The password is stored as a salted scrypt hash. Sessions last 14 days, and after 5 wrong tries login locks for a minute.

## Demo mode vs live

Demo mode is **on** by default. Texts, emails, calls and charges are simulated and logged, and the guest page shows a demo card form (use `4242 4242 4242 4242`, any future MM/YY). Only the brand and last 4 digits are stored.

To go live, open Settings for each location:

1. Set the **Public app URL** (used in guest links).
2. Add keys: Stripe secret and webhook secret, Twilio SID/token/from number, Resend key and from address, Synthflow key and agent IDs.
3. Point the webhooks at your server:
   - Stripe `checkout.session.completed` → `POST /api/webhooks/stripe/{locationId}`
   - Twilio incoming SMS → `POST /api/webhooks/sms`
   - Synthflow call results → `POST /api/webhooks/synthflow`
4. Turn off Demo mode and click **Test connections**.

Webhooks need a server with a public URL. A static-hosted demo can't receive them.

## Layout

```
shared/   schema.ts (Drizzle tables, types), time.ts (America/New_York helpers)
server/   routes.ts, storage.ts, seating.ts (plan engine), outreach.ts (campaigns + scheduler),
          providers.ts (Twilio, Resend, Synthflow, Stripe REST), seed.ts
client/   React + Tailwind + shadcn/ui, hash routing (wouter)
```

The scheduler runs every 30 seconds inside the server process. Steps whose time has already passed when a booking is made are skipped, except the most recent one, which is sent right away.
