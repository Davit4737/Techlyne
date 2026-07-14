# SMS + Calendar setup

BizAssist's chat widget can now check real availability and book real appointments
(`api/chat.js`), send SMS confirmations right when a booking is made, and send a
reminder text 24-48h before the visit (`api/remind.js`, runs daily via Vercel Cron).

Payments on Paddle stay manual for now — nothing here touches that.

## What you need to create

### 1. Twilio (SMS)
1. Sign up at twilio.com, verify your identity.
2. Buy a phone number that supports SMS (Twilio Console → Phone Numbers → Buy a number).
3. Grab your **Account SID** and **Auth Token** from the Twilio Console dashboard.
4. Note the phone number you bought in E.164 format, e.g. `+15551234567`.

### 2. Cal.com (calendar / availability / booking)
1. Sign up at cal.com (the hosted version is fine to start).
2. In Settings → Availability, set the clinic's real hours.
3. Under **Apps → Google Calendar** (or Outlook), connect the clinic's actual calendar so
   bookings show up there automatically — this is the "calendar sync."
4. Create one Event Type for the bookable appointment (e.g. "Appointment — 30 min").
   Open it and copy the **Event Type ID** from the URL (`/event-types/12345`) — that's `CALCOM_EVENT_TYPE_ID`.
5. Settings → Developer → API Keys → create a key — that's `CALCOM_API_KEY`.

### 3. Supabase (stores appointment records so reminders know what to text)
1. Sign up at supabase.com, create a new project.
2. Project Settings → API: copy the **Project URL** (`SUPABASE_URL`) and the
   **service_role key** (`SUPABASE_SERVICE_ROLE_KEY`) — NOT the anon/public key, the
   service role key, since only our server ever talks to this table.
3. SQL Editor → New query → paste the contents of `supabase/schema.sql` → Run.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | already set — Claude chat |
| `TWILIO_ACCOUNT_SID` | Twilio Console |
| `TWILIO_AUTH_TOKEN` | Twilio Console |
| `TWILIO_FROM_NUMBER` | the Twilio number you bought, e.g. `+15551234567` |
| `CALCOM_API_KEY` | Cal.com → Settings → Developer → API Keys |
| `CALCOM_EVENT_TYPE_ID` | the numeric ID from your Cal.com event type URL |
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (service_role, keep secret) |
| `CRON_SECRET` | any random string you make up — locks down `/api/remind` so only Vercel Cron can trigger it |
| `CLINIC_NAME` | e.g. `Bright Smile Dental` — used in the SMS text and tool description |
| `CLINIC_TIMEZONE` | e.g. `America/New_York` — IANA timezone the clinic operates in |

After adding the env vars, redeploy so the functions pick them up.

## How it flows

1. Patient chats with the widget and asks to book.
2. The model calls `check_availability`, which asks Cal.com for real open slots — it
   never invents a time.
3. Once the patient picks a slot and gives their name + phone, the model calls
   `book_appointment`, which: creates the Cal.com booking (shows up on the clinic's
   connected Google/Outlook calendar), saves a row in Supabase, and texts the patient
   a confirmation via Twilio.
4. Once a day, `/api/remind` (Vercel Cron) checks Supabase for appointments starting in
   the next 24-48h that haven't been reminded yet, texts them, and marks them reminded.

## Notes / limits

- Vercel's Hobby plan only runs cron jobs once a day, which is why `/api/remind` checks
  a 24-48h window instead of a tight 24h one. On a Pro plan, switch the schedule in
  `vercel.json` to hourly (`0 * * * *`) and narrow the window in `api/remind.js` to
  24-25h for a more precise reminder time.
- The chat's rate limiter (20 msgs / 10 min per IP) is in-memory per warm serverless
  instance — fine for now, swap for a real store if traffic grows.
- `book_appointment` trusts whatever `start_time` the model passes, but Cal.com itself
  rejects times that aren't actually free, so a double-book can't slip through.
