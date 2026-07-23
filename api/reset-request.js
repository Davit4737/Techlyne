// Password-reset request — branded, sent through OUR Resend instead of Supabase's mailer.
//
// Why this exists: Supabase's built-in auth mailer sends from noreply@mail.app.supabase.io
// (no branding, lands in spam) and is rate-limited to a few emails/hour project-wide, which
// made "forgot password" silently fail during real use. This endpoint instead asks Supabase's
// admin API to GENERATE the recovery link (without sending anything), then delivers it via our
// own verified Resend domain with a BizAssist-branded email. Deliverability + trust, no
// dashboard change. The link itself is a normal Supabase recovery link, so the existing
// client-side PASSWORD_RECOVERY flow (the "set a new password" screen) is unchanged.
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, EMAIL_FROM.

import { sendEmail, senderFor } from "./_lib/email.js";

// Light per-warm-instance rate limit (best-effort on serverless; raises the cost of abuse).
const RATE = 5; // reset requests per IP per window
const WINDOW_MS = 15 * 60 * 1000;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > RATE;
}

function resetEmailHtml(link) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F0E6;margin:0;padding:32px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:92%;background:#FFFDF7;border:1px solid #E3DAC6;border-radius:18px;overflow:hidden;">
      <tr><td style="padding:30px 36px 8px;"><span style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#211C13;">BizAssist<span style="color:#2E6B4F;">.</span></span></td></tr>
      <tr><td style="padding:8px 36px 4px;">
        <h1 style="margin:0 0 12px;font-size:23px;font-weight:800;letter-spacing:-0.5px;color:#211C13;line-height:1.2;">Reset your password</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#5C5645;">We got a request to reset the password for your BizAssist account. Click the button below to choose a new one. This link expires in 60 minutes.</p>
      </td></tr>
      <tr><td style="padding:4px 36px 24px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#2E6B4F;">
          <a href="${link}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:700;color:#FFFDF7;text-decoration:none;border-radius:999px;">Set a new password</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0 36px 26px;">
        <p style="margin:0 0 6px;font-size:12.5px;line-height:1.6;color:#8A8069;">If the button doesn't work, paste this link into your browser:</p>
        <p style="margin:0;font-size:12.5px;line-height:1.5;word-break:break-all;"><a href="${link}" style="color:#2E6B4F;">${link}</a></p>
      </td></tr>
      <tr><td style="padding:20px 36px 28px;border-top:1px solid #EFE7D6;">
        <p style="margin:0 0 4px;font-size:12.5px;line-height:1.6;color:#8A8069;">Didn't ask for this? You can safely ignore this email. Your password won't change.</p>
        <p style="margin:0;font-size:12px;color:#A79D8A;">&copy; BizAssist &middot; The front desk that never sleeps.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests. Please wait a few minutes and try again." });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("reset-request: Supabase admin env not configured");
    return res.status(500).json({ error: "Password reset is temporarily unavailable." });
  }

  // Where the reset link lands (the dashboard, which shows the "set new password" screen).
  const origin = pickOrigin(req.headers.origin || req.headers.referer);
  const redirectTo = origin + "/app";

  // Ask Supabase to GENERATE (not send) a recovery link for this email.
  let actionLink = null;
  try {
    const gl = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ type: "recovery", email, options: { redirect_to: redirectTo }, redirect_to: redirectTo }),
    });
    if (gl.ok) {
      const data = await gl.json();
      actionLink = data.action_link || (data.properties && data.properties.action_link) || null;
    } else {
      const t = await gl.text();
      console.warn("reset-request: generate_link non-ok", gl.status, t.slice(0, 300));
      // 404/422 = no account for this email → stay silent (no email enumeration).
      // Anything else (401/403 bad key, 5xx) is a real server/config problem — surface it
      // instead of pretending we sent a link (which hides broken admin credentials).
      if (gl.status !== 404 && gl.status !== 422) {
        return res.status(502).json({ error: "Password reset is temporarily unavailable. Please try again shortly." });
      }
    }
  } catch (e) {
    console.error("reset-request: generate_link error", e);
    return res.status(500).json({ error: "Could not start the reset. Please try again." });
  }

  if (actionLink) {
    const sent = await sendEmail({
      from: senderFor("BizAssist"),
      to: email,
      subject: "Reset your BizAssist password",
      text: `We got a request to reset your BizAssist password. Open this link to set a new one (expires in 60 minutes):\n\n${actionLink}\n\nDidn't ask for this? You can safely ignore this email.`,
      html: resetEmailHtml(actionLink),
    });
    if (!sent.ok) {
      console.error("reset-request: email send failed", sent.error);
      return res.status(500).json({ error: "Could not send the reset email. Please try again." });
    }
  }

  // Always the same response whether or not the account exists (no email enumeration).
  return res.status(200).json({ ok: true });
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// Only honour a bizzassist.xyz origin; anything else falls back to the canonical apex so the
// reset link can't be pointed at an attacker's page.
function pickOrigin(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:" && /(^|\.)bizzassist\.xyz$/.test(u.hostname)) return u.origin;
  } catch {}
  return "https://bizzassist.xyz";
}
