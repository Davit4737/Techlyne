// Resend email helper — dependency-free (plain fetch against the Resend API).
// Requires env vars: RESEND_API_KEY, EMAIL_FROM (e.g. "BizAssist <reminders@yourdomain.com>")
// Until you verify a domain in Resend, you can only send FROM their shared
// "onboarding@resend.dev" address TO the email you signed up with — fine for testing.

const CLINIC_NAME = process.env.CLINIC_NAME || "the clinic";

export async function sendEmail(to, subject, text, html) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.error("sendEmail: Resend env vars not configured, skipping send");
    return { ok: false, error: "Email not configured" };
  }

  const payload = { from, to, subject, text };
  if (html) payload.html = html; // Resend accepts text + html together; clients pick the best.

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Resend send error:", res.status, errText);
    return { ok: false, error: "Failed to send email" };
  }

  const data = await res.json();
  return { ok: true, id: data.id };
}

// Wraps content in a simple, email-client-safe branded shell (all inline styles — email
// clients strip <style> tags and don't support external CSS). `accent` colours the header.
function shell({ heading, paragraphs, accent = "#2E6B4F" }) {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#211C13;">${p}</p>`)
    .join("");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#F5F1EA;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EA;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;max-width:480px;width:100%;">
          <tr><td style="background:${accent};padding:20px 28px;">
            <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">${CLINIC_NAME}</span>
          </td></tr>
          <tr><td style="padding:28px;">
            <h1 style="margin:0 0 16px;font-size:19px;color:#211C13;">${heading}</h1>
            ${body}
          </td></tr>
          <tr><td style="padding:0 28px 26px;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:#7C7361;">This is an automated message from ${CLINIC_NAME}. If anything looks wrong, just reply and a team member will help.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// ── Ready-made templates. Each returns { subject, text, html } for sendEmail. ──

export function confirmationEmail({ when, service }) {
  const svc = service ? ` (${service})` : "";
  return {
    subject: `Your appointment at ${CLINIC_NAME}`,
    text: `You're booked at ${CLINIC_NAME} for ${when}${svc}. If you need to change anything, just let us know.`,
    html: shell({
      heading: "You're booked! 🎉",
      paragraphs: [
        `Your appointment at <strong>${CLINIC_NAME}</strong> is confirmed for:`,
        `<strong>${when}</strong>${svc}`,
        "We'll send you a reminder before your visit. Need to change anything? Just reach out.",
      ],
    }),
  };
}

export function reminderEmail({ when, service }) {
  const svc = service ? ` (${service})` : "";
  return {
    subject: `Reminder: your appointment at ${CLINIC_NAME}`,
    text: `Reminder: you have an appointment at ${CLINIC_NAME} on ${when}${svc}. Contact us if you need to reschedule.`,
    html: shell({
      heading: "See you soon 👋",
      paragraphs: [
        `Just a reminder about your upcoming appointment at <strong>${CLINIC_NAME}</strong>:`,
        `<strong>${when}</strong>${svc}`,
        "If you need to reschedule or cancel, contact us and we'll sort it out.",
      ],
    }),
  };
}

export function cancellationEmail({ when }) {
  return {
    subject: `Your appointment at ${CLINIC_NAME} was cancelled`,
    text: `Your appointment at ${CLINIC_NAME} on ${when} has been cancelled. Feel free to book again anytime.`,
    html: shell({
      accent: "#8A5A2B",
      heading: "Appointment cancelled",
      paragraphs: [
        `Your appointment at <strong>${CLINIC_NAME}</strong> on <strong>${when}</strong> has been cancelled.`,
        "Feel free to book again anytime — we're here when you need us.",
      ],
    }),
  };
}

export function rescheduleEmail({ when }) {
  return {
    subject: `Your appointment at ${CLINIC_NAME} was moved`,
    text: `Your appointment at ${CLINIC_NAME} has been rescheduled to ${when}. See you then!`,
    html: shell({
      heading: "New time confirmed ✅",
      paragraphs: [
        `Your appointment at <strong>${CLINIC_NAME}</strong> has been rescheduled to:`,
        `<strong>${when}</strong>`,
        "We'll remind you before your visit. See you then!",
      ],
    }),
  };
}
