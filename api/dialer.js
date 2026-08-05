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

// ─────────────────────────── /api/dialer?action=check ───────────────────────────
// Passcode-gated diagnostic. The browser dialer fails BEFORE our server is involved (Twilio
// never fetches /api/voice), so nothing in our logs can explain a dead call — but the server
// holds the same credentials the token is minted from, and Twilio's REST API will happily say
// whether they're valid, whether the account is a restricted trial, where the TwiML app really
// points, and which numbers are usable. One URL replaces a guessing game.
async function handleCheck(req, res) {
  const expected = process.env.DIALER_PASSCODE;
  const supplied = (req.headers && req.headers["x-dialer-code"]) || (req.query && req.query.code) || "";
  if (!expected || String(supplied).trim() !== String(expected).trim()) {
    return res.status(401).json({ error: "Wrong passcode." });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const key = process.env.TWILIO_API_KEY || "";
  const secret = process.env.TWILIO_API_SECRET || "";
  const appSid = process.env.TWILIO_TWIML_APP_SID || "";
  const callerId = process.env.TWILIO_CALLER_ID || "";

  const out = { verdicts: [] };
  const envShape = [
    ["TWILIO_ACCOUNT_SID", sid, /^AC[0-9a-f]{32}$/i],
    ["TWILIO_API_KEY", key, /^SK[0-9a-f]{32}$/i],
    ["TWILIO_TWIML_APP_SID", appSid, /^AP[0-9a-f]{32}$/i],
    ["TWILIO_CALLER_ID", callerId, /^\+\d{8,15}$/],
  ];
  for (const [name, val, re] of envShape) {
    if (!val) out.verdicts.push(`FAIL ${name} is not set`);
    else if (!re.test(val.trim())) out.verdicts.push(`FAIL ${name} has the wrong shape (got "${val.slice(0, 4)}...", length ${val.length})`);
  }
  if (!secret) out.verdicts.push("FAIL TWILIO_API_SECRET is not set");

  const auth = "Basic " + Buffer.from(`${key.trim()}:${secret.trim()}`).toString("base64");
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid.trim())}`;
  const get = async (url) => {
    const r = await fetch(url, { headers: { Authorization: auth } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  try {
    // A Standard API key is NOT permitted to read the account record — Twilio 401s that one
    // endpoint even when the key is perfectly valid. Treating that as "bad credentials" is
    // wrong, and it hides the answer that matters (trial vs full). So a 401 here is only
    // damning if the other calls fail too; that is decided after they have all run.
    const acct = await get(`${base}.json`);
    if (acct.status === 401) {
      out.accountReadable = false;
    } else if (acct.status === 404) {
      out.verdicts.push("FAIL TWILIO_ACCOUNT_SID doesn't match any account (404).");
    } else if (acct.body) {
      out.account = { status: acct.body.status, type: acct.body.type };
      out.verdicts.push(`PASS credentials valid — account status "${acct.body.status}", type "${acct.body.type}"`);
      if (acct.body.type === "Trial") {
        out.verdicts.push("WARN TRIAL ACCOUNT: it can ONLY call numbers listed under Verified Caller IDs, and plays a trial message first. Upgrade the account (add a payment method) to call clinics.");
      }
      if (acct.body.status !== "active") {
        out.verdicts.push(`FAIL account status is "${acct.body.status}" — calls are blocked until it's active.`);
      }
    }

    const app = await get(`${base}/Applications/${encodeURIComponent(appSid.trim())}.json`);
    if (app.status === 404) {
      out.verdicts.push("FAIL TWILIO_TWIML_APP_SID doesn't match any TwiML app on this account.");
    } else if (app.status === 200 && app.body) {
      out.twimlApp = { voiceUrl: app.body.voice_url, voiceMethod: app.body.voice_method };
      const ok = /^https:\/\/(www\.)?bizzassist\.xyz\/api\/voice$/.test(app.body.voice_url || "");
      out.verdicts.push(ok
        ? `PASS TwiML app voice URL is "${app.body.voice_url}" (${app.body.voice_method})`
        : `FAIL TwiML app voice URL is "${app.body.voice_url || "(empty)"}" — it must be https://bizzassist.xyz/api/voice`);
    }

    const nums = await get(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(callerId.trim())}`);
    const owned = Boolean(nums.status === 200 && nums.body && Array.isArray(nums.body.incoming_phone_numbers) && nums.body.incoming_phone_numbers.length);
    if (nums.status === 200) {
      out.verdicts.push(owned
        ? `PASS caller ID ${callerId.trim()} is a number this account owns`
        : `FAIL caller ID ${callerId.trim()} is NOT owned by this account — outbound <Dial> will be rejected.`);
    }

    // Trial detection that survives the account-record 401: a trial account's Balance endpoint
    // is readable by a Standard key, and trials run on prepaid credit.
    if (out.accountReadable === false) {
      const bal = await get(`${base}/Balance.json`);
      if (bal.status === 200 && bal.body && bal.body.balance !== undefined) {
        out.balance = `${bal.body.balance} ${bal.body.currency || ""}`.trim();
        out.verdicts.push(`INFO account balance: ${out.balance}`);
      }
    }

    const vids = await get(`${base}/OutgoingCallerIds.json`);
    if (vids.status === 200 && vids.body && Array.isArray(vids.body.outgoing_caller_ids)) {
      out.verifiedCallerIds = vids.body.outgoing_caller_ids.map((v) => v.phone_number);
    }

    // Now judge the credentials on evidence rather than on one endpoint's refusal: if any other
    // authenticated call came back, the key/secret pair is valid and the account 401 was just
    // the Standard-key permission limit.
    const otherCallsWorked = Boolean(out.twimlApp) || owned || Array.isArray(out.verifiedCallerIds);
    if (out.accountReadable === false && otherCallsWorked) {
      out.verdicts.unshift("PASS credentials valid — the account-record 401 is normal for a Standard API key and can be ignored.");
      out.verdicts.push("WARN could not read account type. If calls fail with error 13224/21215, the account is a TRIAL: it can only dial numbers under Verified Caller IDs. Upgrade it (add a payment method) to call clinics.");
    } else if (out.accountReadable === false) {
      out.verdicts.unshift("FAIL Twilio rejected the API key/secret pair (401) on every request. Re-create the API key and paste BOTH values fresh.");
    }

    if (out.verifiedCallerIds && out.verifiedCallerIds.length) {
      out.verdicts.push(`INFO verified caller IDs on this account: ${out.verifiedCallerIds.join(", ")}. If this is a trial, these are the ONLY numbers it can call.`);
    } else if (Array.isArray(out.verifiedCallerIds)) {
      // An empty list is only fatal on a trial, but it is worth flagging either way: on a trial
      // it means the account cannot legally dial a single number.
      out.verdicts.push("WARN no verified caller IDs on this account. If it is a trial, it cannot call ANY number — verify one under Phone Numbers → Verified Caller IDs, or upgrade.");
    }
  } catch (e) {
    console.error("dialer check failed:", e);
    out.verdicts.push("FAIL could not reach the Twilio API from the server: " + (e.message || e));
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(out);
}

export default function handler(req, res) {
  const action = req.query && req.query.action;
  if (action === "token") return handleToken(req, res);
  if (action === "voice") return handleVoice(req, res);
  if (action === "check") return handleCheck(req, res);
  return res.status(404).json({ error: "Not found" });
}

// Exported for the toll-fraud guard tests. Not part of the HTTP surface.
export { allowed };
