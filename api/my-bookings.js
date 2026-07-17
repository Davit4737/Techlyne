// Owner-facing bookings API. Returns the appointments for the logged-in client's business,
// authenticated by their Supabase token — so bookings live INSIDE the client dashboard
// instead of the separate secret-gated /admin page. Read-only.

import { getBusinessByOwner, listAppointments } from "./_lib/db.js";
import { bearerFromReq, getUserFromToken } from "./_lib/auth.js";

function localLabel(iso, timeZone) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await getUserFromToken(bearerFromReq(req));
  if (!user) return res.status(401).json({ error: "Please sign in again." });

  const biz = await getBusinessByOwner(user.id);
  if (!biz.ok) return res.status(500).json({ error: biz.error });
  if (!biz.business) return res.status(200).json({ bookings: [] });

  const tz = biz.business.timezone || "UTC";
  // From the start of today onward, so the dashboard shows upcoming bookings.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const r = await listAppointments(since, biz.business.id);
  if (!r.ok) return res.status(500).json({ error: r.error });

  const bookings = (r.appointments || []).map((a) => ({
    name: a.name,
    phone: a.phone,
    email: a.email,
    service: a.service,
    when: localLabel(a.start_time, tz),
    start_time: a.start_time,
    status: a.status,
  }));
  return res.status(200).json({ bookings, timezone: tz });
}
