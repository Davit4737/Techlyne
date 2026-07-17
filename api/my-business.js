// Owner-facing self-serve API. Unlike /api/businesses (operator-gated by ADMIN_SECRET), this
// authenticates the logged-in client via their Supabase Auth token and scopes every action to
// the business THEY own. Powers the client dashboard (app.html).
//
//   GET   → the caller's business (or null if they haven't set one up yet)
//   POST  → create the caller's business on first setup (one per owner)
//   PATCH → update the caller's business config
//
// Billing/activation fields (active, subscription_status) are intentionally NOT editable here
// — those stay operator-controlled until Paddle automation lands. New businesses start
// inactive; an operator flips them live after payment.

import { getBusinessByOwner, createBusiness, updateBusiness } from "./_lib/db.js";
import { bearerFromReq, getUserFromToken } from "./_lib/auth.js";

// Config fields a client may set on their own business. Deliberately excludes owner_id,
// active, subscription_status, slug, admin_secret, and all calcom_* (operator/advanced).
const OWNER_FIELDS = [
  "name", "timezone", "hours", "address", "phone", "services", "industry",
  "availability", "slot_minutes",
];

const WEEKDAYS = new Set(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
const HM = /^\d{1,2}:\d{2}$/;

// Availability comes from an authenticated but untrusted browser — rebuild it from scratch
// rather than storing whatever arrived. Max 7 rules of { days:[known weekday], startTime,
// endTime as HH:MM }. Anything malformed is dropped; an empty result means "not provided".
function sanitizeAvailability(raw) {
  if (!Array.isArray(raw)) return undefined;
  const rules = [];
  for (const r of raw.slice(0, 7)) {
    const days = Array.isArray(r?.days) ? r.days.filter((d) => WEEKDAYS.has(d)).slice(0, 7) : [];
    const startTime = String(r?.startTime || "");
    const endTime = String(r?.endTime || "");
    if (days.length && HM.test(startTime) && HM.test(endTime)) rules.push({ days, startTime, endTime });
  }
  return rules.length ? rules : undefined;
}

function pick(body) {
  const out = {};
  for (const f of OWNER_FIELDS) if (body[f] !== undefined && body[f] !== "") out[f] = body[f];

  // Free-text fields: cap lengths so no one can stuff megabytes into a row (they also feed
  // the chat prompt, so this bounds token burn too).
  for (const f of ["name", "timezone", "hours", "address", "phone", "industry"]) {
    if (typeof out[f] === "string") out[f] = out[f].slice(0, 200);
  }
  if (typeof out.services === "string") out.services = out.services.slice(0, 1000);

  // slot_minutes drives the native scheduler's slot loop — a zero/negative value would spin
  // it forever (DoS), so clamp to a sane range instead of trusting the client.
  if (out.slot_minutes !== undefined) {
    const n = Math.round(Number(out.slot_minutes));
    out.slot_minutes = Number.isFinite(n) ? Math.min(Math.max(n, 5), 480) : 30;
  }

  if (out.availability !== undefined) {
    const clean = sanitizeAvailability(out.availability);
    if (clean) out.availability = clean;
    else delete out.availability;
  }
  return out;
}

function slugify(str) {
  return String(str || "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await getUserFromToken(bearerFromReq(req));
  if (!user) return res.status(401).json({ error: "Please sign in again." });

  if (req.method === "GET") {
    const r = await getBusinessByOwner(user.id);
    if (!r.ok) return res.status(500).json({ error: r.error });
    return res.status(200).json({ business: r.business });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  if (req.method === "POST") {
    // One business per owner for now — if they already have one, treat this as an update.
    const existing = await getBusinessByOwner(user.id);
    if (!existing.ok) return res.status(500).json({ error: existing.error });
    if (existing.business) {
      const fields = pick(body);
      const upd = await updateBusiness(existing.business.id, fields);
      if (!upd.ok) return res.status(400).json({ error: upd.error });
      return res.status(200).json({ business: upd.business });
    }

    const fields = pick(body);
    if (!fields.name) return res.status(400).json({ error: "Business name is required" });
    fields.owner_id = user.id;
    fields.active = false;                 // goes live after payment (operator flips it)
    fields.subscription_status = "inactive";

    // Derive a unique slug from the business name; append a short suffix on collision.
    const base = slugify(fields.name) || "business";
    let created = null;
    for (const candidate of [base, `${base}-${Math.random().toString(36).slice(2, 6)}`]) {
      const r = await createBusiness({ ...fields, slug: candidate });
      if (r.ok) { created = r.business; break; }
      // Race backstop: a concurrent request may have already created this owner's business
      // (enforced by a unique index on owner_id). If so, update that row instead of erroring.
      const owned = await getBusinessByOwner(user.id);
      if (owned.ok && owned.business) {
        const upd = await updateBusiness(owned.business.id, pick(body));
        if (upd.ok) return res.status(200).json({ business: upd.business });
      }
      if (r.error !== "That slug is already taken") return res.status(400).json({ error: r.error });
    }
    if (!created) return res.status(400).json({ error: "Could not generate a unique link — try a different business name." });
    return res.status(200).json({ business: created });
  }

  if (req.method === "PATCH") {
    const existing = await getBusinessByOwner(user.id);
    if (!existing.ok) return res.status(500).json({ error: existing.error });
    if (!existing.business) return res.status(404).json({ error: "No business to update yet." });
    const fields = pick(body);
    const upd = await updateBusiness(existing.business.id, fields);
    if (!upd.ok) return res.status(400).json({ error: upd.error });
    return res.status(200).json({ business: upd.business });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
