# Calendar + email setup

BizAssist's chat widget can now check real availability and book real appointments
(`api/chat.js`), send an email confirmation right when a booking is made (if the
patient shared one), and send a reminder email 24-48h before the visit
(`api/remind.js`, runs daily via Vercel Cron). Email is optional at booking time —
the assistant offers it but never blocks a booking over it.

Billing is now self-serve via Paddle — see the "Paddle billing" section below. SMS/Twilio
was considered and dropped in favor of email (simpler setup, works everywhere, no
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

### Self-serve accounts (client sign-up + own dashboard at `/app`)

Clients register, log in, and configure their own business at `/app` — no operator needed.
Auth is handled by **Supabase Auth**; the browser signs in and the server verifies the token.

**One-time Supabase dashboard setup:**
1. **Authentication → Providers → Email** — enabled by default. For frictionless testing you
   can turn OFF "Confirm email" (Auth → Providers → Email), or leave it on for production.
2. **Authentication → Providers → Google** — toggle on, then paste a Google OAuth **Client ID
   + Secret** (create them in Google Cloud Console → Credentials → OAuth client → Web app).
   In Google Cloud, set the authorized redirect URI to
   `https://kxahngxkpcuxlblmtdqz.supabase.co/auth/v1/callback`.
3. **Authentication → URL Configuration** — set Site URL to `https://bizzassist.xyz` and add
   `https://bizzassist.xyz/app` to the redirect allow-list.

**Env var (Vercel):**

| Variable | Where it comes from |
|---|---|
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon/public key (safe to expose; used to verify login tokens server-side) |

Email/password works the moment Email confirmation is sorted; Google works once step 2 is done.
New sign-ups create a business with `active = false` — it goes live automatically the moment
they check out via Paddle (see below), or an operator can still flip it manually from
`/onboard` if you'd rather activate someone by hand. The anon key is also embedded in
`app.html` (it's public by design, protected by the database's row-level security).

### Paddle billing (self-serve checkout + automatic activation)

A client picks a plan on the Subscription tab of `/app`, checks out in a Paddle overlay, and
Paddle's webhook flips their `active` + `subscription_status` the moment payment goes through
— no operator step. Until these env vars are set, the Subscription tab quietly falls back to
the old "email us to activate" copy, so nothing breaks on a fresh deploy.

**One-time Paddle dashboard setup** (Paddle Billing, not the older Paddle Classic):
1. Sign up at paddle.com, create your seller account. Use **Sandbox** first to test end-to-end
   for free — Sandbox and Production are separate accounts with separate keys.
2. **Catalog → Products** — create a "Standard" and a "Pro" product, each with one recurring
   monthly **Price**. Copy each price's id (`pri_...`) — those are `PADDLE_PRICE_ID_STANDARD`
   and `PADDLE_PRICE_ID_PRO`.
3. **Developer tools → Authentication** — create an **API key** (server-side, secret) — that's
   `PADDLE_API_KEY`. It's only used server-side (webhook lookups, billing-portal sessions);
   the browser never sees it.
4. **Developer tools → Client-side tokens** — create one for your domain — that's
   `PADDLE_CLIENT_TOKEN`. This one IS meant to be public (Paddle's equivalent of a Stripe
   publishable key); it's fetched from `/api/paddle-config` and embedded in the checkout the
   same way the Supabase anon key already is.
5. **Developer tools → Notifications** — add a destination pointing at
   `https://<your-domain>/api/paddle-webhook`, subscribed to the `subscription.*` events
   (created, activated, updated, canceled, past_due, paused — "select all subscription events"
   is fine). Copy the destination's **secret key** — that's `PADDLE_WEBHOOK_SECRET`.

**Env vars (Vercel):**

| Variable | Where it comes from |
|---|---|
| `PADDLE_API_KEY` | Paddle → Developer tools → Authentication → API key (secret, server-only) |
| `PADDLE_CLIENT_TOKEN` | Paddle → Developer tools → Client-side tokens (public — embedded in `/app`) |
| `PADDLE_WEBHOOK_SECRET` | Paddle → Developer tools → Notifications → your destination's secret key |
| `PADDLE_PRICE_ID_STANDARD` | Paddle → Catalog → Products → Standard → its price id (`pri_...`). Accepts a comma-separated list |
| `PADDLE_PRICE_ID_PRO` | Paddle → Catalog → Products → Pro → its price id (`pri_...`). Accepts a comma-separated list |
| `PADDLE_ENV` | `sandbox` while testing, unset (or `production`) once you switch to your live Paddle account |

Run `supabase/migrations/008_paddle.sql` once (adds `paddle_customer_id`, `paddle_subscription_id`,
`plan` to `businesses`) before setting these — the webhook writes to those columns.

**How it flows:** client clicks a plan → Paddle's overlay checkout opens with
`customData: { business_id }` so the webhook knows which row to update (Paddle copies that custom
data onto the subscription it creates, which is why the subscription events carry it) → on
`subscription.activated`/`subscription.updated`, `api/paddle-webhook.js` verifies the
`Paddle-Signature` header (HMAC over the raw body — this is the one endpoint that keeps body
parsing off, see the comment at the top of that file) and sets `active`,
`subscription_status` to Paddle's own status string, and `plan` from the price id. The
dashboard's "Manage billing" button (visible once a `paddle_customer_id` exists) opens Paddle's
hosted customer portal via `api/paddle-portal.js` for card updates, plan switches, and
cancellation — all self-serve, nothing to build.

**Activation does not depend on the webhook arriving.** The webhook is the fast path, not the
only path. Whenever the dashboard loads a business that is *not* live, `api/my-business.js` asks
Paddle directly whether that owner's email has a subscription (`findSubscriptionByEmail`) and
activates from the answer, writing back the customer/subscription ids and plan. So a destination
that is misconfigured, blocked, or still retrying delays activation by one page refresh instead
of stranding a paying customer. Live businesses skip the lookup entirely, so the normal case
costs nothing. If Paddle is unreachable the row is served as-is — billing trouble never takes
the dashboard down.

**Changing a price mints a NEW price id.** Paddle prices are immutable once used — editing the
amount creates a new `pri_...` and archives the old one. If the env var still holds the old id,
the subscription activates fine but its **plan silently stops updating**, so a client can be on
Pro while the dashboard shows Standard. Both price vars therefore accept a comma-separated list
(keep the old id and add the new one, e.g. a $1 test price alongside the list price), and any
unmapped price id is logged as a warning in the Vercel runtime logs so the mismatch is visible
instead of silent.

**Plan allowances are enforced, not just advertised.** Each tenant's conversations are metered
per calendar month in `business_usage` (run `supabase/migrations/010_business_usage.sql`) and
capped at 1,500 on Standard / 4,500 on Pro — see `PLAN_MONTHLY_LIMIT` in `api/chat.js`. Over the
cap, the widget returns a polite "reached its message limit this month" reply instead of calling
the model, so the Anthropic bill can't outrun revenue and one client's public widget can't be
hammered indefinitely. A tenant on no recognised plan gets the Standard allowance rather than
zero, and a metering failure fails **open** — a database blip must never take a paying clinic's
front desk offline.

**Cancellations are caught by a daily sweep.** Reconcile-on-read only rescues businesses that are
*not* live, so it can start a subscription but never end one. Cancellations, expired trials, and
exhausted dunning all happen to businesses that ARE live, and those owners have no reason to load
the dashboard again. `api/_lib/billing.js` therefore re-checks every business carrying a
`paddle_subscription_id` once a day (piggy-backed on the `/api/remind` cron, since Hobby allows
one daily trigger) and deactivates any whose subscription is no longer live. Businesses activated
by hand have no subscription id and are deliberately left alone, and a Paddle outage never
deactivates anyone — an unreachable billing API is not evidence that someone stopped paying.

**Failed payments get a grace period.** `past_due` counts as live, so a declined card does not
instantly silence a client's phone line — Paddle retries over several days (dunning), and the
dashboard shows an amber "update your card" prompt with a link to the billing portal meanwhile.
If dunning ultimately fails, Paddle moves the subscription to `canceled` and the webhook
deactivates the tenant then. To cut service off on the first failed charge instead, drop
`"past_due"` from `LIVE_STATUSES` in `api/paddle-webhook.js`.

The checkout deliberately sets **no `successUrl`**: redirecting on payment would navigate the
page away and kill the `checkout.completed` handler that polls for activation, leaving a paying
customer staring at "Not started yet". Staying put lets the dashboard show the switch-on live.

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
