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

import { getBusinessByOwner, createBusiness, updateBusiness, deleteBusinessCascade } from "./_lib/db.js";
import { bearerFromReq, getUserFromToken, deleteAuthUser } from "./_lib/auth.js";

// Config fields a client may set on their own business. Deliberately excludes owner_id,
// active, subscription_status, slug, admin_secret, and all calcom_* (operator/advanced).
const OWNER_FIELDS = [
  "name", "timezone", "hours", "address", "phone", "services", "industry",
  "availability", "slot_minutes", "staff", "services_list", "default_language",
];

const WEEKDAYS = new Set(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
const HM = /^\d{1,2}:\d{2}$/;

// The row also carries server-side credentials (admin_secret, calcom_* keys/tokens) that the
// owner's BROWSER must never see — an XSS or a curious devtools user could lift them. Rebuild
// every response from this explicit allowlist instead of returning the row verbatim.
const OWNER_VIEW_FIELDS = [
  "id", "slug", "name", "timezone", "hours", "address", "phone", "services", "industry",
  "availability", "slot_minutes", "staff", "services_list", "default_language", "active", "subscription_status", "plan",
  "paddle_customer_id", "created_at",
];
function ownerView(business) {
  if (!business) return null;
  const out = {};
  for (const f of OWNER_VIEW_FIELDS) if (business[f] !== undefined) out[f] = business[f];
  return out;
}

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
  for (const f of ["name", "timezone", "hours", "address", "phone", "industry", "default_language"]) {
    if (typeof out[f] === "string") out[f] = out[f].slice(0, 200);
  }
  if (typeof out.services === "string") out.services = out.services.slice(0, 1000);

  // Timezone must be a real IANA name ("Asia/Yerevan"), not an abbreviation ("PST") —
  // an invalid one is stored forever and then throws RangeError inside every
  // toLocaleString(..., { timeZone }) call, taking the bookings list down with it.
  if (out.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: out.timezone });
    } catch {
      delete out.timezone; // keep whatever valid value the row already has
    }
  }

  // slot_minutes drives the native scheduler's slot loop — a zero/negative value would spin
  // it forever (DoS), so clamp to a sane range instead of trusting the client.
  if (out.slot_minutes !== undefined) {
    const n = Math.round(Number(out.slot_minutes));
    out.slot_minutes = Number.isFinite(n) ? Math.min(Math.max(n, 5), 480) : 30;
  }

  // Services & prices: rebuild from scratch — max 40 entries of { name, price, duration }.
  // Strings capped; duration is optional positive minutes (feeds the AI prompt, so bounded).
  if (out.services_list !== undefined) {
    if (Array.isArray(out.services_list)) {
      out.services_list = out.services_list
        .slice(0, 40)
        .map((s) => {
          const item = { name: String(s?.name || "").slice(0, 80), price: String(s?.price || "").slice(0, 40) };
          const d = Math.round(Number(s?.duration));
          if (Number.isFinite(d) && d > 0) item.duration = Math.min(d, 1440);
          return item;
        })
        .filter((s) => s.name);
    } else {
      delete out.services_list;
    }
  }

  // Staff: rebuild from scratch — max 20 entries of { name, role }, strings capped.
  if (out.staff !== undefined) {
    if (Array.isArray(out.staff)) {
      out.staff = out.staff
        .slice(0, 20)
        .map((m) => {
          const entry = { name: String(m?.name || "").slice(0, 80), role: String(m?.role || "").slice(0, 80) };
          // Optional per-person working days. Empty/absent = follows the business's days.
          if (Array.isArray(m?.days)) {
            const days = m.days.filter((d) => WEEKDAYS.has(d)).slice(0, 7);
            if (days.length) entry.days = days;
          }
          return entry;
        })
        .filter((m) => m.name);
    } else {
      delete out.staff;
    }
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await getUserFromToken(bearerFromReq(req));
  if (!user) return res.status(401).json({ error: "Please sign in again." });

  if (req.method === "GET") {
    const r = await getBusinessByOwner(user.id);
    if (!r.ok) return res.status(500).json({ error: r.error });
    return res.status(200).json({ business: ownerView(r.business) });
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
      return res.status(200).json({ business: ownerView(upd.business) });
    }

    const fields = pick(body);
    if (!fields.name) return res.status(400).json({ error: "Business name is required" });
    fields.owner_id = user.id;
    fields.active = false;                 // goes live after payment (operator flips it)
    fields.subscription_status = "inactive";

    // Derive a unique slug from the business name; append a short suffix on collision.
    const base = slugify(fields.name) || "business";
    let created = null;
    // Up to 4 candidates: the clean slug, then random suffixes. One suffix retry proved
    // not enough in production (409s logged when popular names collide twice).
    const candidates = [base];
    while (candidates.length < 4) candidates.push(`${base}-${Math.random().toString(36).slice(2, 6)}`);
    for (const candidate of candidates) {
      const r = await createBusiness({ ...fields, slug: candidate });
      if (r.ok) { created = r.business; break; }
      // Race backstop: a concurrent request may have already created this owner's business
      // (enforced by a unique index on owner_id). If so, update that row instead of erroring.
      const owned = await getBusinessByOwner(user.id);
      if (owned.ok && owned.business) {
        const upd = await updateBusiness(owned.business.id, pick(body));
        if (upd.ok) return res.status(200).json({ business: ownerView(upd.business) });
      }
      if (r.error !== "That slug is already taken") return res.status(400).json({ error: r.error });
    }
    if (!created) return res.status(400).json({ error: "Could not generate a unique link — try a different business name." });
    return res.status(200).json({ business: ownerView(created) });
  }

  if (req.method === "PATCH") {
    const existing = await getBusinessByOwner(user.id);
    if (!existing.ok) return res.status(500).json({ error: existing.error });
    if (!existing.business) return res.status(404).json({ error: "No business to update yet." });
    const fields = pick(body);
    const upd = await updateBusiness(existing.business.id, fields);
    if (!upd.ok) return res.status(400).json({ error: upd.error });
    return res.status(200).json({ business: ownerView(upd.business) });
  }

  // Delete the caller's account: their business + appointments, then the auth user itself.
  // Scoped to the verified user, so it can only ever delete the caller's own data.
  if (req.method === "DELETE") {
    const existing = await getBusinessByOwner(user.id);
    if (!existing.ok) return res.status(500).json({ error: existing.error });
    if (existing.business) {
      const del = await deleteBusinessCascade(existing.business.id);
      if (!del.ok) return res.status(500).json({ error: del.error });
    }
    const delUser = await deleteAuthUser(user.id);
    if (!delUser.ok) return res.status(500).json({ error: delUser.error });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
