// Public config for Paddle.js checkout, embedded client-side (app.html). Everything here is
// meant to be public — the client-side token and price ids are the Paddle equivalent of a
// Stripe publishable key, not a secret. The actual charge only ever happens through Paddle's
// own hosted checkout; nothing here can move money on its own.

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const configured = Boolean(process.env.PADDLE_CLIENT_TOKEN && process.env.PADDLE_PRICE_ID_STANDARD);
  return res.status(200).json({
    configured,
    clientToken: process.env.PADDLE_CLIENT_TOKEN || null,
    environment: process.env.PADDLE_ENV === "sandbox" ? "sandbox" : "production",
    prices: {
      standard: process.env.PADDLE_PRICE_ID_STANDARD || null,
      pro: process.env.PADDLE_PRICE_ID_PRO || null,
    },
  });
}
