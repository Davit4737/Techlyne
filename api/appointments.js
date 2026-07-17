// Bookings endpoint — powers the /admin dashboard. Multi-tenant.
// GET /api/appointments?key=SECRET&b=<slug>
//   - with ?b=<slug>: returns that client's bookings; auth = master ADMIN_SECRET OR that
//     client's own admin_secret (so each client sees only their own).
//   - without ?b: returns the default (env-var) tenant's bookings; auth = master ADMIN_SECRET.
// Returns customer contact info, so keep the secrets safe.

import { listAppointments, getBusiness } from "./_lib/db.js";

const DEFAULT_TZ = process.env.CLINIC_TIMEZONE || "America/New_York";
const DEFAULT_NAME = process.env.CLINIC_NAME || "Your business";

function localLabel(iso, timeZone) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default async function handler(req, res) {
  const key = (req.query && req.query.key) || (req.headers["authorization"] || "").replace(/^Bearer /, "");
  const slug = req.query && req.query.b;

  let businessId; // undefined = no scope; null = default tenant; number = a specific client
  let tz = DEFAULT_TZ;
  let name = DEFAULT_NAME;

  if (slug) {
    const r = await getBusiness(slug);
    if (!r.ok) return res.status(500).json({ error: r.error });
    if (!r.business) return res.status(404).json({ error: "Business not found" });
    const b = r.business;
    // Either the operator master key or this client's own dashboard password.
    const ok = (process.env.ADMIN_SECRET && key === process.env.ADMIN_SECRET) || (b.admin_secret && key === b.admin_secret);
    if (!ok) return res.status(401).json({ error: "Unauthorized" });
    businessId = b.id;
    tz = b.timezone || DEFAULT_TZ;
    name = b.name;
  } else {
    if (!process.env.ADMIN_SECRET || key !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    businessId = null; // the env-var default tenant
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await listAppointments(since, businessId);
  if (!result.ok) return res.status(500).json({ error: result.error });

  const appointments = result.appointments.map((a) => ({
    id: a.id,
    name: a.name,
    phone: a.phone,
    email: a.email,
    service: a.service,
    status: a.status,
    start_time: a.start_time,
    local_time: localLabel(a.start_time, tz),
  }));

  return res.status(200).json({ clinic_name: name, timezone: tz, count: appointments.length, appointments });
}
