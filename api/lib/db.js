// Supabase (Postgres) helper — dependency-free (plain fetch against the PostgREST API).
// Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Run supabase/schema.sql once in the Supabase SQL editor to create the `appointments` table.

function headers() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
}

function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function insertAppointment({ name, phone, email, service, startISO, calcomBookingUid }) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };

  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/appointments`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify([
      {
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

// Appointments starting within [windowStartISO, windowEndISO) that haven't had a reminder sent yet.
export async function getAppointmentsNeedingReminder(windowStartISO, windowEndISO) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };

  const url = new URL(`${process.env.SUPABASE_URL}/rest/v1/appointments`);
  url.searchParams.set("reminder_sent", "eq.false");
  url.searchParams.set("start_time", `gte.${windowStartISO}`);
  url.searchParams.append("start_time", `lt.${windowEndISO}`);
  url.searchParams.set("select", "*");

  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    console.error("Supabase query error:", res.status, await res.text());
    return { ok: false, error: "Failed to query appointments" };
  }
  const appointments = await res.json();
  return { ok: true, appointments };
}

export async function markReminderSent(id) {
  if (!isConfigured()) return { ok: false, error: "Database not configured" };

  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/appointments?id=eq.${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({ reminder_sent: true }),
  });

  if (!res.ok) {
    console.error("Supabase update error:", res.status, await res.text());
    return { ok: false, error: "Failed to mark reminder sent" };
  }
  return { ok: true };
}
