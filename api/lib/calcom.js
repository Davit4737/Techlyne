// Cal.com scheduling helper — dependency-free (plain fetch against the Cal.com v2 API).
// Requires env vars: CALCOM_API_KEY, CALCOM_EVENT_TYPE_ID, CALCOM_USERNAME, CALCOM_EVENT_SLUG
// Cal.com handles availability, timezone math, and the actual Google/Outlook calendar
// sync once the clinic connects their calendar inside Cal.com — we just call the API.
//
// NOTE: the /slots endpoint frequently 404s ("Event Type not found") when queried by
// numeric eventTypeId, even for events that exist and book fine. Querying by
// username + eventTypeSlug is the reliable path, so availability uses those. Booking
// still uses the numeric eventTypeId (that endpoint resolves it correctly).
// username + slug come straight from the booking link: cal.com/<username>/<slug>

const API_BASE = "https://api.cal.com/v2";

// Cal.com pins each endpoint family to its own dated API version. Using the wrong
// one makes the request silently fall back to an older, incompatible shape — so the
// slots and bookings endpoints get their own version strings.
const SLOTS_API_VERSION = "2024-09-04";
const BOOKINGS_API_VERSION = "2024-08-13";

function headers(apiVersion) {
  return {
    Authorization: `Bearer ${process.env.CALCOM_API_KEY}`,
    "cal-api-version": apiVersion,
    "content-type": "application/json",
  };
}

// Returns available slots between two ISO dates for the configured event type.
// Prefers username + eventTypeSlug (reliable); falls back to numeric eventTypeId.
export async function getAvailableSlots(startISO, endISO, timeZone = "UTC") {
  const username = process.env.CALCOM_USERNAME;
  const slug = process.env.CALCOM_EVENT_SLUG;
  const eventTypeId = process.env.CALCOM_EVENT_TYPE_ID;
  if (!process.env.CALCOM_API_KEY || (!eventTypeId && !(username && slug))) {
    return { ok: false, error: "Calendar not configured" };
  }

  const url = new URL(`${API_BASE}/slots`);
  if (username && slug) {
    url.searchParams.set("username", username);
    url.searchParams.set("eventTypeSlug", slug);
  } else {
    url.searchParams.set("eventTypeId", eventTypeId);
  }
  url.searchParams.set("start", startISO);
  url.searchParams.set("end", endISO);
  url.searchParams.set("timeZone", timeZone);

  const res = await fetch(url, { headers: headers(SLOTS_API_VERSION) });
  if (!res.ok) {
    console.error("Cal.com slots error:", res.status, await res.text());
    return { ok: false, error: "Failed to fetch availability" };
  }
  const data = await res.json();
  return { ok: true, slots: data.data || {} };
}

// Creates a booking for the configured event type. `startISO` must be one of the
// slots returned by getAvailableSlots (Cal.com rejects times that aren't actually free).
export async function createBooking({ startISO, name, email, phone, timeZone = "UTC", notes }) {
  const eventTypeId = process.env.CALCOM_EVENT_TYPE_ID;
  if (!process.env.CALCOM_API_KEY || !eventTypeId) {
    return { ok: false, error: "Calendar not configured" };
  }

  const res = await fetch(`${API_BASE}/bookings`, {
    method: "POST",
    headers: headers(BOOKINGS_API_VERSION),
    body: JSON.stringify({
      start: startISO,
      eventTypeId: Number(eventTypeId),
      attendee: {
        name,
        email: email || "no-reply@example.com",
        phoneNumber: phone,
        timeZone,
      },
      metadata: notes ? { notes } : undefined,
    }),
  });

  if (!res.ok) {
    console.error("Cal.com booking error:", res.status, await res.text());
    return { ok: false, error: "Failed to create booking" };
  }

  const data = await res.json();
  return { ok: true, booking: data.data };
}

// Cancels an existing booking by its Cal.com uid. This also removes the event from the
// connected Google/Outlook calendar automatically.
export async function cancelBooking(uid, reason = "Cancelled by patient via assistant") {
  if (!process.env.CALCOM_API_KEY || !uid) {
    return { ok: false, error: "Calendar not configured" };
  }

  const res = await fetch(`${API_BASE}/bookings/${uid}/cancel`, {
    method: "POST",
    headers: headers(BOOKINGS_API_VERSION),
    body: JSON.stringify({ cancellationReason: reason }),
  });

  if (!res.ok) {
    console.error("Cal.com cancel error:", res.status, await res.text());
    return { ok: false, error: "Failed to cancel booking" };
  }

  return { ok: true };
}

// Reschedules an existing booking to a new start time. Cal.com cancels the old booking
// and creates a NEW one with a NEW uid, which we return so the DB row can be updated.
// `startISO` must be a real open slot (from getAvailableSlots), same as a fresh booking.
export async function rescheduleBooking(uid, startISO, reason = "Rescheduled by patient via assistant") {
  if (!process.env.CALCOM_API_KEY || !uid) {
    return { ok: false, error: "Calendar not configured" };
  }

  const res = await fetch(`${API_BASE}/bookings/${uid}/reschedule`, {
    method: "POST",
    headers: headers(BOOKINGS_API_VERSION),
    body: JSON.stringify({ start: startISO, reschedulingReason: reason }),
  });

  if (!res.ok) {
    console.error("Cal.com reschedule error:", res.status, await res.text());
    return { ok: false, error: "Failed to reschedule booking" };
  }

  const data = await res.json();
  return { ok: true, booking: data.data, newUid: data.data?.uid };
}
