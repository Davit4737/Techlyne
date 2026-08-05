// Twilio Voice access token for the browser dialer (dialer.html).
//
// Converted from the supplied CommonJS handler to ESM only — this project is "type": "module",
// so a `require`/`module.exports` file would fail to load at all. The logic below is unchanged:
// passcode gate first, short-lived token, no-store, outgoing-only.
//
// Every credential here is server-side. Nothing in this file may ever be echoed to the client;
// the browser receives the minted JWT and nothing else.

import twilio from "twilio";

export default function handler(req, res) {
  // --- gate 1: passcode ---
  const expected = process.env.DIALER_PASSCODE;
  const supplied =
    (req.headers && req.headers["x-dialer-code"]) ||
    (req.query && req.query.code) ||
    "";

  if (!expected) {
    return res.status(500).json({ error: "DIALER_PASSCODE is not set on the server." });
  }
  if (String(supplied) !== String(expected)) {
    return res.status(401).json({ error: "Wrong passcode." });
  }

  try {
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity: "bizassist-console", ttl: 3600 }
    );

    token.addGrant(
      new VoiceGrant({
        outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
        incomingAllow: false,
      })
    );

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ token: token.toJwt() });
  } catch (err) {
    // Deliberately generic: the caller is unauthenticated until the gate above passes, and a
    // detailed error would confirm which credentials exist.
    console.error("token.js failed:", err);
    res.status(500).json({ error: "Token generation failed. Check environment variables." });
  }
}
