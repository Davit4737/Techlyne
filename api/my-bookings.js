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

// UTC instant of local midnight today in `timeZone`. Two-pass offset refinement handles DST.
function startOfTodayUTC(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
  const [y, mo, d] = parts.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d);
  const offAt = (ts) => {
    const m = {};
    for (const p of new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts))) m[p.type] = p.value;
    return Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second) - ts;
  };
  let ts = guess - offAt(guess);
  ts = guess - offAt(ts);
  return new Date(ts).toISOString();
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

  // Optional explicit range (?from=ISO&to=ISO) — the calendar uses this to load whole
  // months, including past ones. Values are parsed strictly; garbage falls back to the
  // default window. Default: start of TODAY in the business's timezone (not a rolling
  // -24h, which used to leak yesterday's bookings into the list and inflate stats).
  const parseISO = (v) => {
    const t = Date.parse(String(v || ""));
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  };
  const from = parseISO(req.query?.from) || startOfTodayUTC(tz);
  const to = parseISO(req.query?.to) || undefined;

  const r = await listAppointments(from, biz.business.id, to);
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
  // slot_minutes lets the calendar draw each booking as a block of the right length.
  return res.status(200).json({ bookings, timezone: tz, slot_minutes: biz.business.slot_minutes || 30 });
}
