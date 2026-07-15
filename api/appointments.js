// Admin bookings endpoint — powers the /admin dashboard.
// GET /api/appointments?key=ADMIN_SECRET  → JSON list of recent + upcoming bookings.
// Gated by the ADMIN_SECRET env var. Returns customer contact info, so keep that secret safe.

import { listAppointments } from "./lib/db.js";

const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || "America/New_York";

function localLabel(iso) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: CLINIC_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function handler(req, res) {
  const key = (req.query && req.query.key) || (req.headers["authorization"] || "").replace(/^Bearer /, "");
  if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Show everything from a week ago onward: recent history + all upcoming.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await listAppointments(since);
  if (!result.ok) return res.status(500).json({ error: result.error });

  const appointments = result.appointments.map((a) => ({
    id: a.id,
    name: a.name,
    phone: a.phone,
    email: a.email,
    service: a.service,
    status: a.status,
    start_time: a.start_time,
    local_time: localLabel(a.start_time),
  }));

  return res.status(200).json({
    clinic_name: process.env.CLINIC_NAME || "Your business",
    timezone: CLINIC_TIMEZONE,
    count: appointments.length,
    appointments,
  });
}
