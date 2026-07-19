// Paddle Billing webhook. Automates activation: when a client checks out (or their
// subscription changes state), Paddle POSTs here and we flip `active` / `subscription_status`
// on their business row — no operator involved. Gated by HMAC signature, not ADMIN_SECRET
// (Paddle isn't carrying our secret, it's carrying its own).
//
// Body parsing MUST stay off: signature verification needs the exact raw bytes Paddle sent,
// and Vercel's default JSON parser would re-serialize the body before we ever saw the
// original — a byte-for-byte reformat (key order, spacing) is enough to break the HMAC.
export const config = { api: { bodyParser: false } };

import { verifyPaddleSignature, planFromPriceId } from "./_lib/paddle.js";
import { getBusinessById, getBusinessByPaddleCustomer, updateBusiness } from "./_lib/db.js";

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Paddle's subscription statuses map straight onto whether the AI should be answering:
// trialing/active are live, everything else pauses the tenant until it's resolved.
const LIVE_STATUSES = new Set(["trialing", "active"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const secret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("PADDLE_WEBHOOK_SECRET is not set — refusing all webhook events");
    return res.status(500).json({ error: "Not configured" });
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers["paddle-signature"];
  if (!verifyPaddleSignature(rawBody, signature, secret)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const type = event?.event_type || "";
  const data = event?.data || {};

  // Only subscription lifecycle events change activation; transaction/customer events are
  // acknowledged (200) but otherwise ignored — nothing else in the product reads them yet.
  if (!type.startsWith("subscription.")) return res.status(200).json({ received: true });

  const businessId = data?.custom_data?.business_id;
  let business = null;
  if (businessId) {
    const r = await getBusinessById(businessId);
    if (!r.ok) return res.status(500).json({ error: r.error });
    business = r.business;
  }
  if (!business && data.customer_id) {
    const r = await getBusinessByPaddleCustomer(data.customer_id);
    if (!r.ok) return res.status(500).json({ error: r.error });
    business = r.business;
  }
  if (!business) {
    // Nothing to match yet (e.g. a stray retry after the business was deleted). Acknowledge
    // so Paddle doesn't keep retrying a webhook we can never resolve.
    console.warn("Paddle webhook: no matching business", { type, businessId, customerId: data.customer_id });
    return res.status(200).json({ received: true, matched: false });
  }

  const status = data.status; // 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled'
  const priceId = data.items?.[0]?.price?.id;
  const plan = planFromPriceId(priceId);

  const fields = {
    subscription_status: status,
    active: LIVE_STATUSES.has(status),
    paddle_customer_id: data.customer_id || business.paddle_customer_id,
    paddle_subscription_id: data.id || business.paddle_subscription_id,
  };
  if (plan) fields.plan = plan;

  const upd = await updateBusiness(business.id, fields);
  if (!upd.ok) return res.status(500).json({ error: upd.error });

  return res.status(200).json({ received: true, matched: true });
}
