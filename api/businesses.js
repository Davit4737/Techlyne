// Operator onboarding API — create/edit client businesses without redeploying.
// Gated by the master ADMIN_SECRET env var (that's YOU, the operator — not a client).
// Powers onboard.html. Returns per-client Cal.com keys, so keep ADMIN_SECRET safe.

import { listBusinesses, createBusiness, updateBusiness } from "./_lib/db.js";
import { provisionCalcom, isProvisioningConfigured } from "./_lib/calcom-provision.js";

const FIELDS = [
  "slug", "name", "timezone", "hours", "address", "phone", "services", "industry",
  "availability", "slot_minutes",
  "calcom_api_key", "calcom_event_type_id", "calcom_username", "calcom_event_slug",
  "calcom_user_id", "calcom_access_token", "calcom_refresh_token", "provisioned",
  "admin_secret", "active",
];

// Turns the onboarding inputs into a Cal.com availability array. Accepts either a structured
// `availability` array (passed straight through) or simple working_days + open/close times.
// Returns undefined when nothing usable is given, so provisioning falls back to Cal.com's
// Mon–Fri 09:00–17:00 default rather than creating an empty (never-bookable) schedule.
function buildAvailability(body) {
  if (Array.isArray(body.availability) && body.availability.length) return body.availability;
  const days = Array.isArray(body.working_days) ? body.working_days : null;
  const start = body.open_time;
  const end = body.close_time;
  if (days && days.length && start && end) return [{ days, startTime: start, endTime: end }];
  return undefined;
}

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

    // Persist structured working hours + slot length for the native scheduler. Stored for
    // every tenant (the native scheduler uses them directly; provisioning also reads them).
    const avail = buildAvailability(body);
    if (avail) fields.availability = avail;
    if (body.duration_minutes) fields.slot_minutes = Number(body.duration_minutes);

    // Auto-provision an isolated Cal.com managed user (own calendar + availability + event
    // type) so the client never touches Cal.com. Skipped when the operator already pasted
    // Cal.com keys manually, or when Platform creds aren't configured — in both cases the
    // business is still created, just with provisioned=false. A provisioning failure is
    // surfaced as a warning but never blocks onboarding (the row can be fixed/retried later).
    let warning;
    const alreadyHasCalcom = fields.calcom_api_key || fields.calcom_access_token;
    if (isProvisioningConfigured() && !alreadyHasCalcom) {
      const service = (fields.services || "").split(/[,\n]/)[0].trim() || undefined;
      const location = fields.phone
        ? { type: "phone", value: fields.phone }
        : fields.address
        ? { type: "address", value: fields.address }
        : undefined;
      const prov = await provisionCalcom({
        name: fields.name,
        slug: fields.slug,
        timeZone: fields.timezone,
        availability: buildAvailability(body),
        service,
        durationMinutes: body.duration_minutes ? Number(body.duration_minutes) : undefined,
        location,
      });
      if (prov.ok) {
        fields.calcom_user_id = prov.calcom.userId;
        fields.calcom_username = prov.calcom.username;
        fields.calcom_access_token = prov.calcom.accessToken;
        fields.calcom_refresh_token = prov.calcom.refreshToken;
        fields.calcom_event_type_id = prov.calcom.eventTypeId;
        fields.calcom_event_slug = prov.calcom.eventSlug;
        fields.provisioned = true;
      } else {
        warning = `Business created, but Cal.com auto-setup failed: ${prov.error}. It can be retried or configured manually.`;
      }
    }

    const r = await createBusiness(fields);
    if (!r.ok) return res.status(400).json({ error: r.error });
    return res.status(200).json({ business: r.business, warning });
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
