// TwiML endpoint that bridges an outbound call from the browser dialer (dialer.html).
// Twilio POSTs here (form-encoded) when the Device places a call; the TwiML App's Voice URL
// must point at this path.
//
// Converted from the supplied CommonJS handler to ESM only — this project is "type": "module",
// so a `require`/`module.exports` file would fail to load at all. The allow-list below is
// byte-for-byte the original logic and must stay that way.

import twilio from "twilio";

// Toll-fraud guard: only ordinary US/Canada numbers.
// Blocks international premium-rate destinations, which is how open
// dialers get drained. Also blocks US premium (900) and directory (976).
//
// DO NOT loosen this. An endpoint that will dial anything gets found by bots that call
// expensive international premium lines and drain the account balance within hours.
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

export default function handler(req, res) {
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
  res.status(200).send(twiml.toString());
}

// Exported for the toll-fraud guard tests. Not part of the HTTP surface.
export { allowed };
