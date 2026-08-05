// Twilio browser dialer backend — BOTH endpoints in one serverless function.
//
// Why they share a file: Vercel's Hobby plan allows 12 serverless functions per deployment and
// this project was already at the ceiling. Two more (token + voice) failed the build outright.
// vercel.json rewrites /api/token and /api/voice onto this single function, so the PUBLIC URLs
// are unchanged — dialer.html still fetches /api/token, and the Twilio TwiML App still points at
// /api/voice. Nothing external needs to know these share a handler.
//
// The dispatch is on ?action=, supplied by the rewrite. A request with no recognised action is a
// 404 rather than a third undocumented endpoint.
//
// Every Twilio credential here is server-side. Nothing in this file may be echoed to the client;
// the browser receives the minted JWT and nothing else.

import twilio from "twilio";

// ─────────────────────────── /api/token ───────────────────────────
// Mints a short-lived Voice access token, gated behind DIALER_PASSCODE.
function handleToken(req, res) {
  // --- gate 1: passcode ---
  const expected = process.env.DIALER_PASSCODE;
  const supplied =
    (req.headers && req.headers["x-dialer-code"]) ||
    (req.query && req.query.code) ||
    "";

  if (!expected) {
    return res.status(500).json({ error: "DIALER_PASSCODE is not set on the server." });
  }
  // Both sides are trimmed. Pasting a value into a dashboard env-var box picks up a trailing
  // space or newline almost invisibly, and the browser already trims what the user types — so
  // an exact comparison rejects a passcode that looks identical to the person entering it, with
  // no way to tell from the error. Whitespace at either end is never meaningful in a passcode.
  if (String(supplied).trim() !== String(expected).trim()) {
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
    return res.status(200).json({ token: token.toJwt() });
  } catch (err) {
    // Deliberately generic: a detailed error would confirm which credentials exist.
    console.error("dialer token failed:", err);
    return res.status(500).json({ error: "Token generation failed. Check environment variables." });
  }
}

// ─────────────────────────── /api/voice ───────────────────────────
// Toll-fraud guard: only ordinary US/Canada numbers.
// Blocks international premium-rate destinations, which is how open
// dialers get drained. Also blocks US premium (900) and directory (976).
//
// DO NOT loosen this. An endpoint that will dial anything gets found by bots that call expensive
// international premium lines and drain the account balance within hours.
function allowed(raw) {
  const d = String(raw).replace(/\D/g, "");
  if (d.length !== 11) return false;      // must be 1 + 10 digits
  if (d[0] !== "1") return false;         // North America only
  const area = d.slice(1, 4);
  if (area[0] === "0" || area[0] === "1") return false;
  if (area === "900") return false;       // premium rate
  if (d.slice(4, 7) === "976") return false;
  return true;
}

function handleVoice(req, res) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const to =
    (req.body && (req.body.To || req.body.to)) ||
    (req.query && (req.query.To || req.query.to));

  if (to && allowed(to)) {
    const dial = twiml.dial({
      callerId: process.env.TWILIO_CALLER_ID,
      answerOnBridge: true,
      timeout: 25,
    });
    dial.number("+" + String(to).replace(/\D/g, ""));
  } else {
    twiml.say("That destination is not allowed.");
  }

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twiml.toString());
}

export default function handler(req, res) {
  const action = req.query && req.query.action;
  if (action === "token") return handleToken(req, res);
  if (action === "voice") return handleVoice(req, res);
  return res.status(404).json({ error: "Not found" });
}

// Exported for the toll-fraud guard tests. Not part of the HTTP surface.
export { allowed };
