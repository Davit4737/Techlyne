// Supabase (Postgres) helper — dependency-free (plain fetch against the PostgREST API).
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Run supabase/schema.sql once in the Supabase SQL editor to create the tables.

function headers(extra) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    ...extra,
  };
}

function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

const REST = () => `${process.env.SUPABASE_URL}/rest/v1`;

// Phones arrive in whatever format the model relayed ("98818318", "+98 81-83-18"…).
// Compare digits only so format drift can never break dedupe or cancel lookups.
function phoneDigits(p) {
  return String(p || "").replace(/\D/g, "");
}
function samePhone(a, b) {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  return Boolean(da) && da === db;
}

// ─────────────────────────── Businesses (tenants) ───────────────────────────

// Fetches one client's config by its slug. Returns { ok, business|null }.
export async function getBusiness(slug) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };
  if (!slug) return { ok: true, business: null };

  const url = new URL(`${REST()}/businesses`);
  url.searchParams.set("slug", `eq.${slug}`);
  url.searchParams.set("active", "eq.true");
  url.searchParams.set("limit", "1");
  url.searchParams.set("select", "*");

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    console.error("Supabase getBusiness error:", res.status, await res.text());
    return { ok: false, error: "Failed to load business" };
  }
  const rows = await res.json();
  return { ok: true, business: rows[0] || null };
}

export async function listBusinesses() {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };
  const url = new URL(`${REST()}/businesses`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("select", "*");
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    console.error("Supabase listBusinesses error:", res.status, await res.text());
    return { ok: false, error: "Failed to list businesses" };
  }
  return { ok: true, businesses: await res.json() };
}

export async function createBusiness(fields) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };
  const res = await fetch(`${REST()}/businesses`, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify([fields]),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("Supabase createBusiness error:", res.status, txt);
    // Surface a unique-slug clash cleanly for the onboarding form.
    if (txt.includes("duplicate key")) return { ok: false, error: "That slug is already taken" };
    return { ok: false, error: "Failed to create business" };
  }
  const rows = await res.json();
  return { ok: true, business: rows[0] };
}

export async function updateBusiness(id, fields) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };
  const res = await fetch(`${REST()}/businesses?id=eq.${id}`, {
    method: "PATCH",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    console.error("Supabase updateBusiness error:", res.status, await res.text());
    return { ok: false, error: "Failed to update business" };
  }
  const rows = await res.json();
  return { ok: true, business: rows[0] };
}

// ─────────────────────────── Appointments ───────────────────────────

export async function insertAppointment({ businessId, name, phone, email, service, startISO, calcomBookingUid }) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };

  const res = await fetch(`${REST()}/appointments`, {
    method: "POST",
    headers: headers({ Prefer: "return=representation" }),
    body: JSON.stringify([
      {
        business_id: businessId || null,
        name,
        phone,
        email: email || null,
        service,
        start_time: startISO,
        calcom_booking_uid: calcomBookingUid,
        // No email on file means there's nothing for the reminder cron to send —
        // mark it reminded up front so it doesn't sit in the queue forever.
        reminder_sent: !email,
      },
    ]),
  });

  if (!res.ok) {
    console.error("Supabase insert error:", res.status, await res.text());
    return { ok: false, error: "Failed to save appointment" };
  }
  const data = await res.json();
  return { ok: true, appointment: data[0] };
}

// Appointments starting within [windowStartISO, windowEndISO) that haven't had a reminder
// sent yet. Cancelled appointments are excluded. Each row embeds its business (name +
// timezone) so the cron can send with the right per-tenant sender and local time.
export async function getAppointmentsNeedingReminder(windowStartISO, windowEndISO) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };

  const url = new URL(`${REST()}/appointments`);
  url.searchParams.set("reminder_sent", "eq.false");
  url.searchParams.set("status", "eq.confirmed");
  url.searchParams.set("start_time", `gte.${windowStartISO}`);
  url.searchParams.append("start_time", `lt.${windowEndISO}`);
  url.searchParams.set("select", "*,business:businesses(name,timezone)");

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    console.error("Supabase query error:", res.status, await res.text());
    return { ok: false, error: "Failed to query appointments" };
  }
  const appointments = await res.json();
  return { ok: true, appointments };
}

export async function markReminderSent(id) {
  return updateAppointment(id, { reminder_sent: true });
}

// Finds a caller's upcoming, still-confirmed appointments by the phone or email they give,
// scoped to their business. Used to verify identity before a cancel/reschedule.
export async function findAppointmentsByContact({ businessId, phone, email }) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };
  if (!phone && !email) return { ok: false, error: "Need a phone or email to look up" };

  // Pull the tenant's upcoming confirmed rows (a small set) and match the contact in JS:
  // phones compare on digits only, emails case-insensitively — so the format the model
  // relays can't break the lookup.
  const url = new URL(`${REST()}/appointments`);
  url.searchParams.set("status", "eq.confirmed");
  url.searchParams.set("start_time", `gte.${new Date().toISOString()}`);
  // Scope to this tenant: business_id equals the caller's, or is null for the default tenant.
  url.searchParams.set("business_id", businessId ? `eq.${businessId}` : "is.null");
  url.searchParams.set("order", "start_time.asc");
  url.searchParams.set("select", "*");

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    console.error("Supabase lookup error:", res.status, await res.text());
    return { ok: false, error: "Failed to look up appointment" };
  }
  const rows = await res.json();
  const emailNorm = (email || "").trim().toLowerCase();
  const appointments = rows.filter(
    (r) => samePhone(r.phone, phone) || (emailNorm && (r.email || "").trim().toLowerCase() === emailNorm)
  );
  return { ok: true, appointments };
}

// Idempotency guard for booking: finds an existing confirmed appointment for the same
// tenant + slot + phone. If book_appointment is called twice for the same person+slot
// (e.g. once before the email is given, once after), the second call finds this row
// instead of creating a duplicate Cal.com booking.
export async function findConfirmedBySlot({ businessId, startISO, phone }) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };

  // Query by tenant+slot+status only (a slot holds at most a handful of rows), then match
  // the phone in JS on digits so a reformatted number still deduplicates.
  const url = new URL(`${REST()}/appointments`);
  url.searchParams.set("status", "eq.confirmed");
  url.searchParams.set("start_time", `eq.${startISO}`);
  url.searchParams.set("business_id", businessId ? `eq.${businessId}` : "is.null");
  url.searchParams.set("select", "*");

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    console.error("Supabase findConfirmedBySlot error:", res.status, await res.text());
    return { ok: false, error: "Failed to check existing booking" };
  }
  const rows = await res.json();
  const appointment = rows.find((r) => samePhone(r.phone, phone)) || null;
  return { ok: true, appointment };
}

export async function updateAppointment(id, fields) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };

  const res = await fetch(`${REST()}/appointments?id=eq.${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(fields),
  });

  if (!res.ok) {
    console.error("Supabase update error:", res.status, await res.text());
    return { ok: false, error: "Failed to update appointment" };
  }
  return { ok: true };
}

export async function cancelAppointment(id) {
  return updateAppointment(id, { status: "cancelled" });
}

// Lists appointments for the admin dashboard from `sinceISO` onward, optionally scoped to
// one business. Returns all statuses so the owner sees cancellations too.
export async function listAppointments(sinceISO, businessId) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };

  const url = new URL(`${REST()}/appointments`);
  if (sinceISO) url.searchParams.set("start_time", `gte.${sinceISO}`);
  if (businessId !== undefined) {
    url.searchParams.set("business_id", businessId ? `eq.${businessId}` : "is.null");
  }
  url.searchParams.set("order", "start_time.asc");
  url.searchParams.set("select", "*");

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    console.error("Supabase list error:", res.status, await res.text());
    return { ok: false, error: "Failed to list appointments" };
  }
  return { ok: true, appointments: await res.json() };
}
