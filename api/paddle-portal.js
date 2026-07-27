// Authenticated endpoint: returns a Paddle-hosted billing portal URL for the caller's own
// business, so an owner can update their card, switch plans, or cancel without us building
// any billing UI. Same auth pattern as api/my-business.js — verifies the caller's Supabase
// session, then scopes strictly to the business THEY own.

import { getBusinessByOwner, updateBusiness } from "./_lib/db.js";
import { bearerFromReq, getUserFromToken } from "./_lib/auth.js";
import { createPortalSession, findCustomerByEmail } from "./_lib/paddle.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getUserFromToken(bearerFromReq(req));
  if (!user) return res.status(401).json({ error: "Please sign in again." });

  const { business } = await getBusinessByOwner(user.id);
  if (!business) return res.status(404).json({ error: "No business to bill yet." });

  // Prefer the id the webhook stored, but never depend on it: if the webhook was missed or is
  // still in flight, fall back to asking Paddle who this email belongs to. Someone who has paid
  // must always be able to reach the portal to cancel, even when our own plumbing failed.
  let customerId = business.paddle_customer_id;
  if (!customerId) {
    const lookup = await findCustomerByEmail(user.email);
    if (!lookup.ok) return res.status(400).json({ error: lookup.error });
    customerId = lookup.customerId;
    if (!customerId) {
      return res.status(400).json({ error: "No subscription yet — start a checkout first." });
    }
    // Self-heal the row so the dashboard stops relying on this lookup next time.
    await updateBusiness(business.id, { paddle_customer_id: customerId });
  }

  const r = await createPortalSession(customerId);
  if (!r.ok) return res.status(400).json({ error: r.error });
  return res.status(200).json({ url: r.url });
}
