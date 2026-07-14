// Resend email helper — dependency-free (plain fetch against the Resend API).
// Requires env vars: RESEND_API_KEY, EMAIL_FROM (e.g. "BizAssist <reminders@yourdomain.com>")
// Until you verify a domain in Resend, you can only send FROM their shared
// "onboarding@resend.dev" address TO the email you signed up with — fine for testing.

export async function sendEmail(to, subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.error("sendEmail: Resend env vars not configured, skipping send");
    return { ok: false, error: "Email not configured" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Resend send error:", res.status, errText);
    return { ok: false, error: "Failed to send email" };
  }

  const data = await res.json();
  return { ok: true, id: data.id };
}
