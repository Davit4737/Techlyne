// Cal.com Platform auto-provisioning — dependency-free (plain fetch against the Cal.com v2 API).
//
// Turns a client's onboarding form into a working, ISOLATED Cal.com setup with zero manual
// steps: it creates a "managed user" (their own Cal.com account under our Platform OAuth
// client — own calendar, own availability, no cross-tenant blocking), then that user's
// availability schedule and a bookable event type. The returned ids + tokens get written
// onto the business row, and from then on the chat books against them exactly like the
// hand-configured tenants used to work.
//
// Requires two env vars (from the Cal.com Platform dashboard → your OAuth client):
//   CAL_OAUTH_CLIENT_ID      — the OAuth client id
//   CAL_OAUTH_CLIENT_SECRET  — the OAuth client secret (server-only; never exposed to the browser)
//
// NOTE: managed users require a Cal.com Platform plan. Until CAL_OAUTH_CLIENT_ID/SECRET are
// set, isProvisioningConfigured() returns false and onboarding falls back to storing the
// client with provisioned=false (an operator can still paste keys manually via /onboard).

const API_BASE = "https://api.cal.com/v2";

// Cal.com pins each endpoint family to its own dated API version.
const SCHEDULES_API_VERSION = "2024-06-11";
const EVENT_TYPES_API_VERSION = "2024-06-14";

const CLIENT_ID = () => process.env.CAL_OAUTH_CLIENT_ID;
const CLIENT_SECRET = () => process.env.CAL_OAUTH_CLIENT_SECRET;

export function isProvisioningConfigured() {
  return Boolean(CLIENT_ID() && CLIENT_SECRET());
}

// Turns a business name into a URL/username-safe base, e.g. "Bright Smile Dental" → "bright-smile-dental".
function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "client";
}

// Managed-user emails must be unique within the OAuth client. We never send to them (the
// booking attendee's own email gets the confirmation), so a deterministic, namespaced
// address per tenant slug is fine and keeps re-provisioning idempotent-ish.
function managedEmail(slug) {
  return `${slugify(slug)}@managed.bizzassist.xyz`;
}

async function readError(res, label) {
  let body = "";
  try {
    body = await res.text();
  } catch (_) {
    /* ignore */
  }
  console.error(`Cal.com provision ${label} error:`, res.status, body);
  return body;
}

// 1) Create the managed user under our OAuth client. Authenticated with the client SECRET
//    (x-cal-secret-key), NOT a bearer token. Returns the new user's id + a fresh access/refresh
//    token pair we act on their behalf with afterwards.
async function createManagedUser({ name, slug, timeZone }) {
  const res = await fetch(`${API_BASE}/oauth-clients/${CLIENT_ID()}/users`, {
    method: "POST",
    headers: {
      "x-cal-secret-key": CLIENT_SECRET(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: managedEmail(slug),
      name,
      timeFormat: 12,
      weekStart: "Monday",
      timeZone: timeZone || "UTC",
      locale: "en",
    }),
  });
  if (!res.ok) return { ok: false, error: await readError(res, "createManagedUser") };
  const data = await res.json();
  const d = data.data || data;
  const user = d.user || d;
  return {
    ok: true,
    userId: user.id,
    username: user.username,
    accessToken: d.accessToken,
    refreshToken: d.refreshToken,
  };
}

// 2) Create the managed user's availability schedule. Runs AS the managed user (bearer their
//    access token). `availability` is [{ days:[...], startTime:'09:00', endTime:'17:00' }];
//    when omitted Cal.com defaults to Mon–Fri 09:00–17:00.
async function createSchedule(accessToken, { timeZone, availability }) {
  const body = { name: "Working hours", timeZone: timeZone || "UTC", isDefault: true };
  if (Array.isArray(availability) && availability.length) body.availability = availability;

  const res = await fetch(`${API_BASE}/schedules`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "cal-api-version": SCHEDULES_API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: await readError(res, "createSchedule") };
  const data = await res.json();
  return { ok: true, scheduleId: (data.data || data).id };
}

// 3) Create the bookable event type, pinned to the schedule from step 2. One event type per
//    tenant matches the rest of the app (a business row carries a single eventTypeId/slug).
async function createEventType(accessToken, { title, durationMinutes, scheduleId, location, minimumBookingNotice }) {
  const body = {
    title: title || "Appointment",
    slug: "appointment",
    lengthInMinutes: durationMinutes || 30,
    minimumBookingNotice: minimumBookingNotice ?? 120,
  };
  if (scheduleId) body.scheduleId = scheduleId;
  // A phone location matches how the default tenant is set up; omit to fall back to Cal Video.
  if (location && location.type === "phone" && location.value) {
    body.locations = [{ type: "phone", phone: location.value, public: false }];
  } else if (location && location.type === "address" && location.value) {
    body.locations = [{ type: "inPerson", address: location.value, public: true }];
  }

  const res = await fetch(`${API_BASE}/event-types`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "cal-api-version": EVENT_TYPES_API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: await readError(res, "createEventType") };
  const data = await res.json();
  const et = data.data || data;
  return { ok: true, eventTypeId: et.id, eventSlug: et.slug };
}

// Force-mints a fresh access/refresh token pair for a managed user using the OAuth client
// secret (no old refresh token needed). Called by the booking layer when a stored access
// token has expired. Exported so calcom.js can retry a 401 and re-persist the new tokens.
export async function refreshManagedUserToken(userId) {
  if (!isProvisioningConfigured() || !userId) {
    return { ok: false, error: "Provisioning not configured" };
  }
  const res = await fetch(`${API_BASE}/oauth-clients/${CLIENT_ID()}/users/${userId}/force-refresh`, {
    method: "POST",
    headers: { "x-cal-secret-key": CLIENT_SECRET(), "content-type": "application/json" },
  });
  if (!res.ok) return { ok: false, error: await readError(res, "refreshManagedUserToken") };
  const data = await res.json();
  const d = data.data || data;
  return { ok: true, accessToken: d.accessToken, refreshToken: d.refreshToken };
}

// Orchestrates the full provision for one new client. Best-effort atomic: if a later step
// fails, earlier ones (the managed user) are left in place but the business is stored with
// provisioned=false so an operator can see it needs attention — we never half-write the
// Cal.com fields onto the row.
//
// Returns { ok, calcom: { userId, username, accessToken, refreshToken, eventTypeId, eventSlug } }.
export async function provisionCalcom({ name, slug, timeZone, availability, service, durationMinutes, location, minimumBookingNotice }) {
  if (!isProvisioningConfigured()) {
    return { ok: false, error: "Cal.com Platform not configured (set CAL_OAUTH_CLIENT_ID / CAL_OAUTH_CLIENT_SECRET)" };
  }

  const user = await createManagedUser({ name, slug, timeZone });
  if (!user.ok) return { ok: false, error: `Could not create Cal.com account: ${user.error}` };

  const schedule = await createSchedule(user.accessToken, { timeZone, availability });
  if (!schedule.ok) return { ok: false, error: `Cal.com account created but scheduling failed: ${schedule.error}` };

  const eventType = await createEventType(user.accessToken, {
    title: service || "Appointment",
    durationMinutes,
    scheduleId: schedule.scheduleId,
    location,
    minimumBookingNotice,
  });
  if (!eventType.ok) return { ok: false, error: `Cal.com account created but event type failed: ${eventType.error}` };

  return {
    ok: true,
    calcom: {
      userId: user.userId,
      username: user.username,
      accessToken: user.accessToken,
      refreshToken: user.refreshToken,
      eventTypeId: String(eventType.eventTypeId),
      eventSlug: eventType.eventSlug,
    },
  };
}
