// Resend email helper — dependency-free (plain fetch against the Resend API).
// Requires env vars: RESEND_API_KEY, EMAIL_FROM (default-tenant sender), and optionally
// EMAIL_SENDER (bare address like "bookings@bizzassist.xyz") used to build per-tenant
// senders. Multi-tenant: all clients send from the ONE verified domain, each with their own
// display name — "<Business Name> <bookings@yourdomain>" — so no per-client domain setup.

// Builds the "From" header for a given business name off the verified domain.
export function senderFor(name) {
  const addr =
    process.env.EMAIL_SENDER ||
    // Fall back to the address inside EMAIL_FROM, e.g. "X <a@b.com>" -> "a@b.com".
    (process.env.EMAIL_FROM && (process.env.EMAIL_FROM.match(/<([^>]+)>/)?.[1] || process.env.EMAIL_FROM)) ||
    "onboarding@resend.dev";
  return `${name} <${addr}>`;
}

export async function sendEmail({ from, to, subject, text, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  const sender = from || process.env.EMAIL_FROM;

  if (!apiKey || !sender) {
    console.error("sendEmail: Resend env vars not configured, skipping send");
    return { ok: false, error: "Email not configured" };
  }

  const payload = { from: sender, to, subject, text };
  if (html) payload.html = html; // Resend accepts text + html together; clients pick the best.

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
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

// Wraps content in a simple, email-client-safe branded shell (all inline styles).
function shell({ clinicName, heading, paragraphs, accent = "#2E6B4F" }) {
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
            <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.2px;">${clinicName}</span>
          </td></tr>
          <tr><td style="padding:28px;">
            <h1 style="margin:0 0 16px;font-size:19px;color:#211C13;">${heading}</h1>
            ${body}
          </td></tr>
          <tr><td style="padding:0 28px 26px;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:#7C7361;">This is an automated message from ${clinicName}. If anything looks wrong, just reply and a team member will help.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

// ── Ready-made templates. Each takes the business name and returns { subject, text, html }. ──

export function confirmationEmail(clinicName, { when, service }) {
  const svc = service ? ` (${service})` : "";
  return {
    subject: `Your appointment at ${clinicName}`,
    text: `You're booked at ${clinicName} for ${when}${svc}. If you need to change anything, just let us know.`,
    html: shell({
      clinicName,
      heading: "You're booked! 🎉",
      paragraphs: [
        `Your appointment at <strong>${clinicName}</strong> is confirmed for:`,
        `<strong>${when}</strong>${svc}`,
        "We'll send you a reminder before your visit. Need to change anything? Just reach out.",
      ],
    }),
  };
}

export function reminderEmail(clinicName, { when, service }) {
  const svc = service ? ` (${service})` : "";
  return {
    subject: `Reminder: your appointment at ${clinicName}`,
    text: `Reminder: you have an appointment at ${clinicName} on ${when}${svc}. Contact us if you need to reschedule.`,
    html: shell({
      clinicName,
      heading: "See you soon 👋",
      paragraphs: [
        `Just a reminder about your upcoming appointment at <strong>${clinicName}</strong>:`,
        `<strong>${when}</strong>${svc}`,
        "If you need to reschedule or cancel, contact us and we'll sort it out.",
      ],
    }),
  };
}

export function cancellationEmail(clinicName, { when }) {
  return {
    subject: `Your appointment at ${clinicName} was cancelled`,
    text: `Your appointment at ${clinicName} on ${when} has been cancelled. Feel free to book again anytime.`,
    html: shell({
      clinicName,
      accent: "#8A5A2B",
      heading: "Appointment cancelled",
      paragraphs: [
        `Your appointment at <strong>${clinicName}</strong> on <strong>${when}</strong> has been cancelled.`,
        "Feel free to book again anytime — we're here when you need us.",
      ],
    }),
  };
}

export function rescheduleEmail(clinicName, { when }) {
  return {
    subject: `Your appointment at ${clinicName} was moved`,
    text: `Your appointment at ${clinicName} has been rescheduled to ${when}. See you then!`,
    html: shell({
      clinicName,
      heading: "New time confirmed ✅",
      paragraphs: [
        `Your appointment at <strong>${clinicName}</strong> has been rescheduled to:`,
        `<strong>${when}</strong>`,
        "We'll remind you before your visit. See you then!",
      ],
    }),
  };
}
