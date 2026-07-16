# Calendar + email setup

BizAssist's chat widget can now check real availability and book real appointments
(`api/chat.js`), send an email confirmation right when a booking is made (if the
patient shared one), and send a reminder email 24-48h before the visit
(`api/remind.js`, runs daily via Vercel Cron). Email is optional at booking time —
the assistant offers it but never blocks a booking over it.

Payments on Paddle stay manual for now — nothing here touches that. SMS/Twilio was
considered and dropped in favor of email (simpler setup, works everywhere, no
per-country restrictions) — can revisit later if you want texts too.

## What you need to create

### 1. Cal.com (calendar / availability / booking)
1. Sign up at cal.com (the hosted version is fine to start).
2. In Settings → Availability, set the clinic's real hours.
3. Under **Apps → Google Calendar** (or Outlook), connect the clinic's actual calendar so
   bookings show up there automatically — this is the "calendar sync."
4. Create one Event Type for the bookable appointment (e.g. "Appointment — 30 min").
   Open it and copy the **Event Type ID** from the URL (`/event-types/12345`) — that's `CALCOM_EVENT_TYPE_ID`.
5. From your public booking link `cal.com/<username>/<slug>`, note the **username** and
   **slug** — those are `CALCOM_USERNAME` and `CALCOM_EVENT_SLUG`. (The /slots API often
   404s when queried by numeric ID, so availability is looked up by username + slug;
   booking still uses the numeric ID.)
6. Settings → Developer → API Keys → create a key — that's `CALCOM_API_KEY`.

### 2. Supabase (stores appointment records so reminders know who to email)
1. Sign up at supabase.com, create a new project.
2. Project Settings → API: copy the **Project URL** (`SUPABASE_URL`) and the
   **service_role key** (`SUPABASE_SERVICE_ROLE_KEY`) — NOT the anon/public key, the
   service role key, since only our server ever talks to this table.
3. SQL Editor → New query → paste the contents of `supabase/schema.sql` → Run.

### 3. Resend (sends the confirmation + reminder emails)
1. Sign up at resend.com.
2. Grab an **API Key** from the dashboard — that's `RESEND_API_KEY`.
3. Until you verify your own domain (Domains → Add Domain, then add the DNS records
   they give you), you can only send FROM `onboarding@resend.dev` TO the email address
   you signed up with — fine for testing the flow yourself.
4. Once you verify a domain, set `EMAIL_FROM` to something like
   `BizAssist <reminders@yourdomain.com>` and you can email anyone.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Where it comes from |
|---|---|
| `ANTHROPIC_API_KEY` | already set — Claude chat |
| `CALCOM_API_KEY` | Cal.com → Settings → Developer → API Keys |
| `CALCOM_EVENT_TYPE_ID` | the numeric ID from your Cal.com event type URL |
| `CALCOM_USERNAME` | from your booking link `cal.com/<username>/<slug>` |
| `CALCOM_EVENT_SLUG` | from your booking link `cal.com/<username>/<slug>` |
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (service_role, keep secret) |
| `RESEND_API_KEY` | Resend → API Keys |
| `EMAIL_FROM` | `onboarding@resend.dev` for testing, or your verified domain address once set up |
| `CRON_SECRET` | any random string you make up — locks down `/api/remind` so only Vercel Cron can trigger it |
| `CLINIC_NAME` | e.g. `Bright Smile Dental` — used in emails, the dashboard, and tool descriptions |
| `CLINIC_TIMEZONE` | e.g. `America/New_York` — IANA timezone the clinic operates in |
| `ADMIN_SECRET` | any random string you make up — the password for the `/admin` bookings dashboard |

### Scheduling: built-in by default, Cal.com optional

Clients created in `/onboard` **need no Cal.com account at all**: leave the Cal.com fields
blank and the built-in scheduler computes their open slots from the working hours on the
form, minus what's already booked in Supabase (isolated per business — tenants never block
each other). Booking, cancel, and reschedule all work the same; bookings show up in that
client's `/admin` dashboard. Zero external accounts, zero extra cost.

A business gets Cal.com behavior only when its row carries Cal.com credentials — pasted
manually, or created by auto-provisioning below. The env-var "default" tenant works the
same way: with `CALCOM_API_KEY` set it books through Cal.com, without it the built-in
scheduler takes over.

### Cal.com auto-provisioning (optional — Cal.com accounts without manual setup)

Set these two and creating a client in `/onboard` automatically spins up an **isolated**
Cal.com account (managed user) for that client — own calendar, own availability, own event
type — with no manual Cal.com setup and no key-pasting. Requires a **Cal.com Platform** plan.
Leave them unset and onboarding still works; the operator just pastes Cal.com keys manually
(the four `calcom_*` fields), exactly as before.

| Variable | Where it comes from |
|---|---|
| `CAL_OAUTH_CLIENT_ID` | Cal.com Platform → your OAuth client → Client ID |
| `CAL_OAUTH_CLIENT_SECRET` | Cal.com Platform → your OAuth client → Client Secret (server-only, keep secret) |

> Not yet smoke-tested end-to-end — needs a live Platform OAuth client to verify the
> managed-user, schedule, and event-type calls against the current API. The schedule and
> event-type request shapes match the verified Cal.com v2 contract; the managed-user create
> and force-refresh endpoints follow the Platform docs and should be confirmed on first run.

### Optional (make the bot smarter about your business)

Set any of these and the bot will answer those questions confidently instead of deferring.
Leave them unset and it falls back to "the clinic will confirm."

| Variable | Example |
|---|---|
| `CLINIC_HOURS` | `Mon–Fri 9am–6pm, Sat 10am–2pm, closed Sunday` |
| `CLINIC_ADDRESS` | `123 Main St, Springfield` |
| `CLINIC_PHONE` | `+1 555 123 4567` |
| `CLINIC_SERVICES` | `cleanings, checkups, fillings, whitening, emergency visits` |

After adding the env vars, redeploy so the functions pick them up.

## How it flows

1. Patient chats with the widget and asks to book.
2. The model calls `check_availability`, which asks Cal.com for real open slots — it
   never invents a time.
3. Once the patient picks a slot and gives their name + phone, the model asks (once,
   casually) if they want an email reminder. Whatever they answer, it calls
   `book_appointment`, which: creates the Cal.com booking (shows up on the clinic's
   connected Google/Outlook calendar), saves a row in Supabase, and — only if an email
   was given — sends a confirmation via Resend.
4. Once a day, `/api/remind` (Vercel Cron) checks Supabase for appointments with an
   email on file starting in the next 24-48h that haven't been reminded yet, emails
   them, and marks them reminded. Appointments booked without an email are skipped —
   there's nothing to send.
5. To **cancel or reschedule**, the customer just tells the chat. The bot asks for the
   phone/email they booked with, finds the appointment, and does it — cancelling removes
   the calendar event and emails them; rescheduling moves it to a new open slot. No staff
   needed.
6. The owner can see everything at **`/admin`** (enter `ADMIN_SECRET`): upcoming, past, and
   cancelled bookings with names, contact info, and times.

## Notes / limits

- Vercel's Hobby plan only runs cron jobs once a day, which is why `/api/remind` checks
  a 24-48h window instead of a tight 24h one. On a Pro plan, switch the schedule in
  `vercel.json` to hourly (`0 * * * *`) and narrow the window in `api/remind.js` to
  24-25h for a more precise reminder time.
- The chat's rate limiter (20 msgs / 10 min per IP) is in-memory per warm serverless
  instance — fine for now, swap for a real store if traffic grows.
- `book_appointment` trusts whatever `start_time` the model passes, but Cal.com itself
  rejects times that aren't actually free, so a double-book can't slip through.
- Phone number is still always collected (staff can call a patient even without email
  on file) — email is purely for automated reminders.
