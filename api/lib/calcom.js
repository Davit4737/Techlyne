// Cal.com scheduling helper — dependency-free (plain fetch against the Cal.com v2 API).
// Multi-tenant: every function takes a `cfg` object with that client's Cal.com credentials.
// Two auth modes coexist:
//   • Static key (default/legacy tenant): cfg = { apiKey, eventTypeId, username, eventSlug }
//   • Managed user (Platform auto-provisioned): cfg = { accessToken, calcomUserId, onTokenRefresh,
//       eventTypeId, username, eventSlug } — the access token is short-lived and gets
//       force-refreshed (via the OAuth client secret) and re-persisted on a 401.
// so one deployment can talk to many clients' Cal.com accounts. Callers build cfg from the
// business row (or env vars for the default tenant) — see resolveBusiness() in chat.js.
//
// NOTE: the /slots endpoint frequently 404s ("Event Type not found") when queried by
// numeric eventTypeId, even for events that exist and book fine. Querying by
// username + eventTypeSlug is the reliable path, so availability uses those. Booking
// still uses the numeric eventTypeId (that endpoint resolves it correctly).

import { refreshManagedUserToken } from "./calcom-provision.js";

const API_BASE = "https://api.cal.com/v2";

// Cal.com pins each endpoint family to its own dated API version.
const SLOTS_API_VERSION = "2024-09-04";
const BOOKINGS_API_VERSION = "2024-08-13";

// The bearer token for a tenant: a managed user's access token if present, else the static
// API key. Managed-user tenants have no apiKey; default tenants have no accessToken.
function bearer(cfg) {
  return cfg?.accessToken || cfg?.apiKey || "";
}

// True when cfg carries usable auth of either kind — replaces the old `cfg?.apiKey` guards.
function hasAuth(cfg) {
  return Boolean(cfg?.accessToken || cfg?.apiKey);
}

function headers(cfg, apiVersion) {
  return {
    Authorization: `Bearer ${bearer(cfg)}`,
    "cal-api-version": apiVersion,
    "content-type": "application/json",
  };
}

// fetch wrapper that transparently recovers from an expired managed-user access token: on a
// 401/498 it force-refreshes via the OAuth client secret, persists the new tokens through
// cfg.onTokenRefresh (so the DB row stays current), and retries once. Static-key (default)
// tenants have no calcomUserId, so they skip the refresh branch and behave exactly as before.
async function calFetch(cfg, url, init, apiVersion) {
  const build = () => ({ ...init, headers: headers(cfg, apiVersion) });
  let res = await fetch(url, build());
  if ((res.status === 401 || res.status === 498) && cfg?.accessToken && cfg?.calcomUserId) {
    const refreshed = await refreshManagedUserToken(cfg.calcomUserId);
    if (refreshed.ok) {
      cfg.accessToken = refreshed.accessToken;
      if (typeof cfg.onTokenRefresh === "function") {
        try {
          await cfg.onTokenRefresh(refreshed);
        } catch (e) {
          console.error("onTokenRefresh persist failed:", e);
        }
      }
      res = await fetch(url, build());
    }
  }
  return res;
}

// Returns available slots between two ISO dates for the client's event type.
// Prefers username + eventTypeSlug (reliable); falls back to numeric eventTypeId.
export async function getAvailableSlots(cfg, startISO, endISO, timeZone = "UTC") {
  if (!hasAuth(cfg) || (!cfg.eventTypeId && !(cfg.username && cfg.eventSlug))) {
    return { ok: false, error: "Calendar not configured" };
  }

  const url = new URL(`${API_BASE}/slots`);
  if (cfg.username && cfg.eventSlug) {
    url.searchParams.set("username", cfg.username);
    url.searchParams.set("eventTypeSlug", cfg.eventSlug);
  } else {
    url.searchParams.set("eventTypeId", cfg.eventTypeId);
  }
  url.searchParams.set("start", startISO);
  url.searchParams.set("end", endISO);
  url.searchParams.set("timeZone", timeZone);

  const res = await calFetch(cfg, url, {}, SLOTS_API_VERSION);
  if (!res.ok) {
    console.error("Cal.com slots error:", res.status, await res.text());
    return { ok: false, error: "Failed to fetch availability" };
  }
  const data = await res.json();
  return { ok: true, slots: data.data || {} };
}

// Creates a booking for the client's event type. `startISO` must be a real open slot.
export async function createBooking(cfg, { startISO, name, email, phone, timeZone = "UTC", notes }) {
  if (!hasAuth(cfg) || !cfg.eventTypeId) {
    return { ok: false, error: "Calendar not configured" };
  }

  const res = await calFetch(cfg, `${API_BASE}/bookings`, {
    method: "POST",
    body: JSON.stringify({
      start: startISO,
      eventTypeId: Number(cfg.eventTypeId),
      attendee: {
        name,
        email: email || "no-reply@example.com",
        phoneNumber: phone,
        timeZone,
      },
      metadata: notes ? { notes } : undefined,
    }),
  }, BOOKINGS_API_VERSION);

  if (!res.ok) {
    const bodyText = await res.text();
    console.error("Cal.com booking error:", res.status, bodyText);
    // A genuine slot conflict (someone else took it) vs. a config/other failure. Cal.com
    // signals conflicts with 409, or 4xx bodies mentioning availability/booked.
    const conflict =
      res.status === 409 ||
      /no longer available|already booked|not available|no_available|slot.*taken|booking.*conflict/i.test(bodyText);
    return { ok: false, error: conflict ? "slot_taken" : "Failed to create booking", conflict };
  }

  const data = await res.json();
  return { ok: true, booking: data.data };
}

// Cancels an existing booking by uid. Also removes the event from the connected calendar.
export async function cancelBooking(cfg, uid, reason = "Cancelled by patient via assistant") {
  if (!hasAuth(cfg) || !uid) return { ok: false, error: "Calendar not configured" };

  const res = await calFetch(cfg, `${API_BASE}/bookings/${uid}/cancel`, {
    method: "POST",
    body: JSON.stringify({ cancellationReason: reason }),
  }, BOOKINGS_API_VERSION);

  if (!res.ok) {
    console.error("Cal.com cancel error:", res.status, await res.text());
    return { ok: false, error: "Failed to cancel booking" };
  }
  return { ok: true };
}

// Reschedules a booking to a new start time. Cal.com creates a NEW booking with a NEW uid,
// which we return so the DB row can be re-pointed. `startISO` must be a real open slot.
export async function rescheduleBooking(cfg, uid, startISO, reason = "Rescheduled by patient via assistant") {
  if (!hasAuth(cfg) || !uid) return { ok: false, error: "Calendar not configured" };

  const res = await calFetch(cfg, `${API_BASE}/bookings/${uid}/reschedule`, {
    method: "POST",
    body: JSON.stringify({ start: startISO, reschedulingReason: reason }),
  }, BOOKINGS_API_VERSION);

  if (!res.ok) {
    console.error("Cal.com reschedule error:", res.status, await res.text());
    return { ok: false, error: "Failed to reschedule booking" };
  }

  const data = await res.json();
  return { ok: true, booking: data.data, newUid: data.data?.uid };
}
