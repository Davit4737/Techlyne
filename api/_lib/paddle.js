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

// Maps a Paddle price id (from a subscription's `items[]`) to our internal plan name, via
// the PADDLE_PRICE_ID_* env vars. Unknown/unset price ids map to null (kept as-is, not
// overwritten) so an unrecognized price never silently blanks out a working plan.
export function planFromPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.PADDLE_PRICE_ID_STANDARD) return "standard";
  if (priceId === process.env.PADDLE_PRICE_ID_PRO) return "pro";
  return null;
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
