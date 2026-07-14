// Temporary diagnostic endpoint — checks that each integration is wired up correctly
// and surfaces the real error from each provider instead of the generic chat message.
// Hit it in a browser at:  /api/diag?key=YOUR_CRON_SECRET
// Safe to delete once everything's confirmed working. Never exposes secret values.


export default async function handler(req, res) {
  const key = (req.query && req.query.key) || "";
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Add ?key=YOUR_CRON_SECRET to the URL" });
  }

  const out = {
    env_present: {
      ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
      CALCOM_API_KEY: Boolean(process.env.CALCOM_API_KEY),
      CALCOM_EVENT_TYPE_ID: process.env.CALCOM_EVENT_TYPE_ID || null,
      CALCOM_USERNAME: process.env.CALCOM_USERNAME || null,
      CALCOM_EVENT_SLUG: process.env.CALCOM_EVENT_SLUG || null,
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY),
      EMAIL_FROM: process.env.EMAIL_FROM || null,
      CLINIC_TIMEZONE: process.env.CLINIC_TIMEZONE || null,
    },
    calcom: null,
    supabase: null,
  };

  // Cal.com: hit the slots endpoint directly and report the RAW status + body so we
  // can tell a 401 (bad key) from a 429 (rate limit) from a 400 (bad params).
  try {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const url = new URL("https://api.cal.com/v2/slots");
    // Match the live logic: prefer username + slug, fall back to numeric id.
    if (process.env.CALCOM_USERNAME && process.env.CALCOM_EVENT_SLUG) {
      url.searchParams.set("username", process.env.CALCOM_USERNAME);
      url.searchParams.set("eventTypeSlug", process.env.CALCOM_EVENT_SLUG);
    } else {
      url.searchParams.set("eventTypeId", process.env.CALCOM_EVENT_TYPE_ID || "");
    }
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("timeZone", process.env.CLINIC_TIMEZONE || "UTC");

    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.CALCOM_API_KEY}`,
        "cal-api-version": "2024-09-04",
        "content-type": "application/json",
      },
    });
    const bodyText = await r.text();
    let dates = [];
    try {
      const parsed = JSON.parse(bodyText);
      dates = parsed?.data ? Object.keys(parsed.data) : [];
    } catch {}
    out.calcom = {
      ok: r.ok,
      http_status: r.status,
      raw_response: bodyText.slice(0, 500), // truncated so it stays readable
      dates_with_slots: dates,
    };
  } catch (err) {
    out.calcom = { ok: false, error: String(err) };
  }

  // Supabase: confirm the appointments table is reachable.
  try {
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const r = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/appointments?select=id&limit=1`,
        {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      out.supabase = { ok: r.ok, status: r.status, error: r.ok ? null : await r.text() };
    } else {
      out.supabase = { ok: false, error: "Supabase env vars missing" };
    }
  } catch (err) {
    out.supabase = { ok: false, error: String(err) };
  }

  return res.status(200).json(out);
}
