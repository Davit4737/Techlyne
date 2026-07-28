// Daily billing sweep — the half of reconciliation that a dashboard visit can never do.
//
// api/my-business.js reconciles on read, but only for businesses that are NOT live: it exists to
// rescue someone who paid and is stuck looking inactive. That direction alone is not enough to
// bill people. Cancellations, expired trials, and exhausted dunning all happen to businesses
// that ARE live, and nobody reloads a dashboard to tell us they left. Without this sweep, a
// clinic that cancels in Paddle keeps its AI running for free until the webhook happens to work.
//
// Runs once a day from the existing cron (see api/remind.js — Vercel's Hobby plan allows one
// daily trigger, so the two jobs share it rather than competing for the slot).
//
// Only touches businesses carrying a paddle_subscription_id. Rows activated by hand by an
// operator have no subscription to check and are deliberately left alone — an operator's
// decision should not be silently undone by a billing job.

import { listBusinesses, updateBusiness } from "./db.js";
import { getSubscription, planFromPriceId, isPaddleConfigured, LIVE_STATUSES } from "./paddle.js";

export async function syncActiveSubscriptions() {
  if (!isPaddleConfigured()) return { ok: true, checked: 0, changed: 0, skipped: "paddle not configured" };

  const list = await listBusinesses();
  if (!list.ok) return { ok: false, error: list.error };

  let checked = 0;
  let changed = 0;

  for (const business of list.businesses) {
    if (!business.paddle_subscription_id) continue;
    checked++;

    try {
      const r = await getSubscription(business.paddle_subscription_id);
      // Paddle unreachable: leave the row alone. Failing to reach the billing API is never a
      // reason to switch off a paying customer's phone line.
      if (!r.ok) continue;

      // Subscription is gone from Paddle entirely — treat as canceled.
      const status = r.subscription ? r.subscription.status : "canceled";
      const active = LIVE_STATUSES.has(status);

      const fields = {};
      if (status !== business.subscription_status) fields.subscription_status = status;
      if (active !== business.active) fields.active = active;
      const plan = r.subscription ? planFromPriceId(r.subscription.priceId) : null;
      if (plan && plan !== business.plan) fields.plan = plan;

      if (!Object.keys(fields).length) continue;

      const upd = await updateBusiness(business.id, fields);
      if (upd.ok) {
        changed++;
        console.log("Billing sweep updated business:", { businessId: business.id, ...fields });
      }
    } catch (e) {
      console.error("Billing sweep failed for business", business.id, e);
    }
  }

  return { ok: true, checked, changed };
}
