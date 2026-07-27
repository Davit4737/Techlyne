// Paddle Billing helper — dependency-free (plain fetch + Node's built-in crypto).
// Requires env vars: PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET. See SETUP.md for the full list.

import crypto from "node:crypto";

export function isPaddleConfigured() {
  return Boolean(process.env.PADDLE_API_KEY);
}

function apiBase() {
  return process.env.PADDLE_ENV === "sandbox" ? "https://sandbox-api.paddle.com" : "https://api.paddle.com";
}

// Paddle signs webhooks as `Paddle-Signature: ts=<unix>;h1=<hex hmac>`, where the hmac is
// over the literal string `${ts}:${rawBody}`. Verifying needs the RAW request body — a
// framework that auto-parses JSON before we see it would break this, which is why
// api/paddle-webhook.js disables body parsing and reads the raw bytes itself.
export function verifyPaddleSignature(rawBody, signatureHeader, secret) {
  if (!rawBody || !signatureHeader || !secret) return false;
  const parts = Object.fromEntries(
    String(signatureHeader)
      .split(";")
      .map((kv) => kv.split("="))
      .filter((kv) => kv.length === 2)
  );
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!ts || !h1) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(h1, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Paddle subscription statuses that mean the AI should be answering. Shared by the webhook
// (push) and the dashboard reconcile (pull) so the two can never disagree about who is live.
//
// `past_due` is deliberately included: Paddle marks a subscription past_due on the first failed
// charge, then retries over several days (dunning). Killing a clinic's phone line over a bank
// blip that clears on retry #2 is worse than carrying them — and if dunning ultimately fails,
// Paddle moves the subscription to `canceled`, which deactivates through both paths anyway.
export const LIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

// Maps a Paddle price id (from a subscription's `items[]`) to our internal plan name, via
// the PADDLE_PRICE_ID_* env vars. Unknown/unset price ids map to null (kept as-is, not
// overwritten) so an unrecognized price never silently blanks out a working plan.
export function planFromPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.PADDLE_PRICE_ID_STANDARD) return "standard";
  if (priceId === process.env.PADDLE_PRICE_ID_PRO) return "pro";
  return null;
}

// Looks up a Paddle customer by email address. This is the safety net behind "Manage billing":
// normally we know the customer id because the webhook stored it, but if that webhook was
// missed, misconfigured, or is simply still in flight, the owner would otherwise have paid us
// with no way to reach the cancel button. Billing access must never depend on our own webhook
// health. Returns { ok, customerId|null }.
export async function findCustomerByEmail(email) {
  if (!isPaddleConfigured()) return { ok: false, error: "Paddle is not configured" };
  if (!email) return { ok: true, customerId: null };

  const url = new URL(`${apiBase()}/customers`);
  url.searchParams.set("email", email);
  url.searchParams.set("status", "active");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY}` } });
  if (!res.ok) {
    console.error("Paddle findCustomerByEmail error:", res.status, await res.text());
    return { ok: false, error: "Could not look up your billing account" };
  }
  const data = await res.json();
  return { ok: true, customerId: data?.data?.[0]?.id || null };
}

// Asks Paddle directly what subscription an email address has, rather than waiting to be told.
//
// Webhooks are best-effort: they can be misconfigured, blocked, retried for hours, or replayed
// out of order, and while any of that is happening a customer who has genuinely paid sits
// looking inactive. This is the pull-based counterpart — the dashboard reconciles against
// Paddle on read, so activation is correct even when no webhook ever arrives.
//
// Returns { ok, subscription: { customerId, subscriptionId, status, priceId } | null }.
export async function findSubscriptionByEmail(email) {
  if (!isPaddleConfigured()) return { ok: false, error: "Paddle is not configured" };

  const customer = await findCustomerByEmail(email);
  if (!customer.ok) return { ok: false, error: customer.error };
  if (!customer.customerId) return { ok: true, subscription: null };

  const url = new URL(`${apiBase()}/subscriptions`);
  url.searchParams.set("customer_id", customer.customerId);
  // Every state that means "this person is paying us", including the dunning window.
  url.searchParams.set("status", "active,trialing,past_due");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.PADDLE_API_KEY}` } });
  if (!res.ok) {
    console.error("Paddle findSubscriptionByEmail error:", res.status, await res.text());
    return { ok: false, error: "Could not check your subscription" };
  }
  const data = await res.json();
  const sub = data?.data?.[0];
  if (!sub) return { ok: true, subscription: null };

  return {
    ok: true,
    subscription: {
      customerId: customer.customerId,
      subscriptionId: sub.id || null,
      status: sub.status || null,
      priceId: sub.items?.[0]?.price?.id || null,
    },
  };
}

// Creates a Paddle-hosted "customer portal" session so an owner can update payment details,
// swap plans, or cancel — without us building any billing UI. Returns the URL to redirect
// to, scoped to this one customer.
export async function createPortalSession(customerId) {
  if (!isPaddleConfigured()) return { ok: false, error: "Paddle is not configured" };
  if (!customerId) return { ok: false, error: "No Paddle customer on file yet" };

  const res = await fetch(`${apiBase()}/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PADDLE_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    console.error("Paddle createPortalSession error:", res.status, await res.text());
    return { ok: false, error: "Failed to open billing portal" };
  }
  const data = await res.json();
  const url = data?.data?.urls?.general?.overview;
  if (!url) return { ok: false, error: "Billing portal did not return a URL" };
  return { ok: true, url };
}
