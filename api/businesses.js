// Operator onboarding API — create/edit client businesses without redeploying.
// Gated by the master ADMIN_SECRET env var (that's YOU, the operator — not a client).
// Powers onboard.html. Returns per-client Cal.com keys, so keep ADMIN_SECRET safe.

import { listBusinesses, createBusiness, updateBusiness } from "./lib/db.js";

const FIELDS = [
  "slug", "name", "timezone", "hours", "address", "phone", "services", "industry",
  "calcom_api_key", "calcom_event_type_id", "calcom_username", "calcom_event_slug",
  "admin_secret", "active",
];

function authed(req) {
  const key = (req.query && req.query.key) || (req.headers["authorization"] || "").replace(/^Bearer /, "");
  return Boolean(process.env.ADMIN_SECRET) && key === process.env.ADMIN_SECRET;
}

function pick(body) {
  const out = {};
  for (const f of FIELDS) if (body[f] !== undefined && body[f] !== "") out[f] = body[f];
  return out;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!authed(req)) return res.status(401).json({ error: "Unauthorized" });

  if (req.method === "GET") {
    const r = await listBusinesses();
    if (!r.ok) return res.status(500).json({ error: r.error });
    return res.status(200).json({ businesses: r.businesses });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

  if (req.method === "POST") {
    const fields = pick(body);
    if (!fields.slug || !fields.name) return res.status(400).json({ error: "Slug and name are required" });
    // Normalize the slug into a clean URL-safe tenant id.
    fields.slug = String(fields.slug).toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    const r = await createBusiness(fields);
    if (!r.ok) return res.status(400).json({ error: r.error });
    return res.status(200).json({ business: r.business });
  }

  if (req.method === "PATCH" || req.method === "PUT") {
    if (!body.id) return res.status(400).json({ error: "id required" });
    const fields = pick(body);
    const r = await updateBusiness(body.id, fields);
    if (!r.ok) return res.status(400).json({ error: r.error });
    return res.status(200).json({ business: r.business });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
