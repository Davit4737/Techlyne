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
// Toll-fraud guard: only ordinary US/Canada numbers, plus Armenia by request.
// Blocks every other international destination, which is how open dialers get drained by bots
// hunting for premium-rate lines. Also blocks US premium (900) and directory (976).
//
// DO NOT loosen this without adding an equally specific carve-out. An endpoint that will dial
// anything gets found and drains the account balance within hours.
function allowedNANP(d) {
  if (d.length !== 11) return false;      // must be 1 + 10 digits
  if (d[0] !== "1") return false;         // North America only
  const area = d.slice(1, 4);
  if (area[0] === "0" || area[0] === "1") return false;
  if (area === "900") return false;       // premium rate
  if (d.slice(4, 7) === "976") return false;
  return true;
}

// Armenia: country code 374 + an 8-digit national number (confirmed against this account's own
// verified caller ID, and against independent numbering-plan references — Yerevan uses a 2-digit
// area code + 6 digits, provincial areas a 3-digit code + 5 digits, mobiles a 2-digit prefix + 6
// digits; all three shapes are exactly 8 digits). Numbers starting 80 (toll-free) or 90
// (premium-rate, per the same references) are excluded, mirroring how the US branch excludes 900
// and 976 rather than trying to allowlist every valid prefix individually.
function allowedArmenia(d) {
  if (d.length !== 11) return false;      // 374 + 8
  if (!d.startsWith("374")) return false;
  const nsn = d.slice(3);
  if (nsn.startsWith("80") || nsn.startsWith("90")) return false;
  return true;
}

function allowed(raw) {
  const d = String(raw).replace(/\D/g, "");
  return allowedNANP(d) || allowedArmenia(d);
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

// ─────────────────────────── /api/dialer?action=calls ───────────────────────────
// Passcode-gated. When Twilio's gateway hangs up (error 31005), the browser only ever learns
// "the gateway hung up" — the actual reason lives in Twilio's Monitor Alerts, which record the
// specific error code and a human description for every failed call. This asks for exactly
// that, plus the call records themselves and the account balance, so the cause is a fact rather
// than another guess.
async function handleCalls(req, res) {
  const expected = process.env.DIALER_PASSCODE;
  const supplied = (req.headers && req.headers["x-dialer-code"]) || (req.query && req.query.code) || "";
  if (!expected || String(supplied).trim() !== String(expected).trim()) {
    return res.status(401).json({ error: "Wrong passcode." });
  }

  const sid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const key = (process.env.TWILIO_API_KEY || "").trim();
  const secret = (process.env.TWILIO_API_SECRET || "").trim();
  const auth = "Basic " + Buffer.from(`${key}:${secret}`).toString("base64");
  const get = async (url) => {
    const r = await fetch(url, { headers: { Authorization: auth } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  const out = { verdicts: [] };
  try {
    // Balance first: an exhausted balance hangs calls up immediately and looks exactly like
    // this, and it is the one cause the caller can fix without touching any settings.
    const bal = await get(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`);
    if (bal.status === 200 && bal.body) {
      out.balance = `${bal.body.balance} ${bal.body.currency || ""}`.trim();
      const n = parseFloat(bal.body.balance);
      out.verdicts.push(Number.isFinite(n) && n <= 0
        ? `FAIL account balance is ${out.balance} — Twilio drops outbound calls with no funds. Add credit.`
        : `PASS account balance: ${out.balance}`);
    }

    const calls = await get(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json?PageSize=5`);
    if (calls.status === 200 && calls.body && Array.isArray(calls.body.calls)) {
      out.recentCalls = calls.body.calls.map((c) => ({
        to: c.to, from: c.from, status: c.status, duration: c.duration,
        price: c.price, started: c.start_time,
      }));
      if (!out.recentCalls.length) {
        out.verdicts.push("WARN Twilio has no record of ANY outbound call on this account — the call never got past the gateway.");
      }
    }

    // The Monitor Alerts API is where the real reason lives.
    // Trust Hub: for a +1 destination this is the thing 13225 is usually complaining about, so
    // report what Twilio actually thinks the profile's status is rather than trusting the
    // dashboard's "approved" banner. Only `twilio-approved` unblocks US calling; a profile can
    // sit in in-review or come back rejected while still looking submitted in the console.
    const profiles = await get("https://trusthub.twilio.com/v1/CustomerProfiles?PageSize=5");
    if (profiles.status === 200 && profiles.body && Array.isArray(profiles.body.results)) {
      out.customerProfiles = profiles.body.results.map((p) => ({
        sid: p.sid, friendlyName: p.friendly_name, status: p.status, updated: p.date_updated,
      }));
      if (!out.customerProfiles.length) {
        out.verdicts.push("FAIL no Customer Profile exists on this account. US (+1) calling stays blocked until one is created and approved: Console → Trust Hub → Customer Profiles.");
      } else {
        for (const p of out.customerProfiles) {
          if (p.status === "twilio-approved") {
            out.verdicts.push(`PASS Customer Profile "${p.friendlyName}" is APPROVED (updated ${p.updated}). If +1 calls still fail, approval may not have propagated yet — retry in a few minutes.`);
          } else if (p.status === "twilio-rejected") {
            out.verdicts.push(`FAIL Customer Profile "${p.friendlyName}" was REJECTED. Open it in Trust Hub for the reason and resubmit.`);
          } else {
            out.verdicts.push(`FAIL Customer Profile "${p.friendlyName}" is "${p.status}", not "twilio-approved" — US (+1) calling stays blocked until it is approved.`);
          }
        }
      }
    } else if (profiles.status === 401 || profiles.status === 403) {
      out.verdicts.push("WARN this API key cannot read Trust Hub. Check the profile status manually: Console → Trust Hub → Customer Profiles.");
    }

    // Individual vs Business matters, and nothing in the profile record says which outright.
    // Twilio requires a BUSINESS profile for +1 calling on accounts created outside the US/Canada
    // after 2025-10-08 — an approved INDIVIDUAL profile satisfies nothing and still returns
    // 13225, which is indistinguishable from "not approved yet" from the outside. Resolve it by
    // reading the entities actually attached to the profile.
    const approvedProfile = (out.customerProfiles || []).find((p) => p.status === "twilio-approved");
    if (approvedProfile && approvedProfile.sid) {
      const asg = await get(`https://trusthub.twilio.com/v1/CustomerProfiles/${encodeURIComponent(approvedProfile.sid)}/EntityAssignments?PageSize=20`);
      if (asg.status === 200 && asg.body && Array.isArray(asg.body.results)) {
        const types = [];
        for (const a of asg.body.results) {
          if (!a.object_sid || !String(a.object_sid).startsWith("IT")) continue;
          const eu = await get(`https://trusthub.twilio.com/v1/EndUsers/${encodeURIComponent(a.object_sid)}`);
          if (eu.status === 200 && eu.body && eu.body.type) types.push(eu.body.type);
        }
        out.profileEntityTypes = types;
        const isBusiness = types.some((t) => /business/i.test(t));
        const isIndividual = types.some((t) => /individual/i.test(t));
        if (isBusiness) {
          out.verdicts.push("PASS the approved profile is a BUSINESS profile, which is the type +1 calling requires.");
        } else if (isIndividual) {
          out.verdicts.push("FAIL the approved profile is an INDIVIDUAL profile. Twilio does NOT accept an Individual profile for +1 calling on accounts created outside the US/Canada after 2025-10-08 — this is why the calls are still blocked despite the approval. Create a BUSINESS Primary Customer Profile: Console → Trust Hub → Customer Profiles → new profile, business type.");
        } else if (types.length) {
          out.verdicts.push(`INFO profile entity types: ${types.join(", ")} — confirm in Trust Hub that this is a Business profile, which +1 calling requires.`);
        }
      }
    }

    const alerts = await get("https://monitor.twilio.com/v1/Alerts?PageSize=5");
    if (alerts.status === 200 && alerts.body && Array.isArray(alerts.body.alerts)) {
      out.recentAlerts = alerts.body.alerts.map((a) => ({
        errorCode: a.error_code,
        message: (a.alert_text || "").slice(0, 400),
        date: a.date_created,
        url: a.more_info,
      }));
      for (const a of out.recentAlerts) {
        // The codes that actually explain a 31005 hangup, translated into the fix.
        const known = {
          13225: "Twilio BLOCKED the call before dialling. For a +1 (US/Canada) destination this almost always means the account has no approved PRIMARY CUSTOMER PROFILE in Trust Hub — a regulatory prerequisite for calling US numbers. Console → Trust Hub → Customer Profiles. (It can also mean Twilio flagged that specific destination as high-risk, which only Twilio Support can lift.)",
          13224: "Twilio will not dial this number: VOICE GEOGRAPHIC PERMISSIONS block the destination country. Enable it in Console → Voice → Settings → Geo Permissions.",
          13227: "Twilio will not dial this number: geographic permissions block the destination country. Enable it in Console → Voice → Settings → Geo Permissions.",
          21215: "Geo permissions: this account is not enabled to call that country. Console → Voice → Settings → Geo Permissions.",
          21210: "The caller ID is not verified/owned for outbound use on this account.",
          21212: "Invalid caller ID — it must be a Twilio number you own or a verified caller ID.",
          20003: "Authentication failed against the Twilio API.",
          31005: "Gateway hangup — check the alerts above this one for the underlying cause.",
        };
        if (known[a.errorCode]) out.verdicts.push(`FAIL ${a.errorCode}: ${known[a.errorCode]}`);
        else if (a.errorCode) out.verdicts.push(`INFO Twilio alert ${a.errorCode}: ${a.message.slice(0, 200)}`);
      }
      if (!out.recentAlerts.length) out.verdicts.push("INFO no recent Twilio alerts recorded.");

      // Distinguish "still broken" from "you are reading errors from before the fix". Alerts
      // stay in the list for days, so a freshly-approved profile plus stale failures looks
      // identical to nothing having changed.
      const approved = (out.customerProfiles || []).find((p) => p.status === "twilio-approved");
      const newestAlert = out.recentAlerts[0] && out.recentAlerts[0].date;
      if (approved && approved.updated && newestAlert) {
        const okAt = Date.parse(approved.updated), alertAt = Date.parse(newestAlert);
        if (Number.isFinite(okAt) && Number.isFinite(alertAt)) {
          out.verdicts.push(alertAt <= okAt
            ? "PASS every failure above predates the profile approval — these are stale. Place a fresh call and re-run this check."
            : "FAIL a call failed AFTER the profile was approved, so the profile is not the remaining blocker. Check the newest alert code above.");
        }
      }
    } else if (alerts.status === 401) {
      out.verdicts.push("WARN could not read Twilio Alerts with this API key (401). Check Console → Monitor → Alerts manually for the error code.");
    }
  } catch (e) {
    console.error("dialer calls diagnostic failed:", e);
    out.verdicts.push("FAIL could not reach the Twilio API: " + (e.message || e));
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(out);
}

export default function handler(req, res) {
  const action = req.query && req.query.action;
  if (action === "token") return handleToken(req, res);
  if (action === "voice") return handleVoice(req, res);
  if (action === "check") return handleCheck(req, res);
  if (action === "calls") return handleCalls(req, res);
  return res.status(404).json({ error: "Not found" });
}

// Exported for the toll-fraud guard tests. Not part of the HTTP surface.
export { allowed };
