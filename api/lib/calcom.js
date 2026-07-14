// Cal.com scheduling helper — dependency-free (plain fetch against the Cal.com v2 API).
// Requires env vars: CALCOM_API_KEY, CALCOM_EVENT_TYPE_ID
// Cal.com handles availability, timezone math, and the actual Google/Outlook calendar
// sync once the clinic connects their calendar inside Cal.com — we just call the API.

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
export async function getAvailableSlots(startISO, endISO, timeZone = "UTC") {
  const eventTypeId = process.env.CALCOM_EVENT_TYPE_ID;
  if (!process.env.CALCOM_API_KEY || !eventTypeId) {
    return { ok: false, error: "Calendar not configured" };
  }

  const url = new URL(`${API_BASE}/slots`);
  url.searchParams.set("eventTypeId", eventTypeId);
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
