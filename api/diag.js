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

  // Cal.com test matrix: both documented v2 lookups 404 for this account, so try
  // every plausible request shape in one pass and report which (if any) returns slots.
  // Once a winner is found, api/lib/calcom.js gets wired to use it and this shrinks back.
  try {
    const apiKey = process.env.CALCOM_API_KEY;
    const id = process.env.CALCOM_EVENT_TYPE_ID || "";
    const username = process.env.CALCOM_USERNAME || "";
    const slug = process.env.CALCOM_EVENT_SLUG || "";
    const tz = process.env.CLINIC_TIMEZONE || "UTC";
    const startISO = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const endISO = new Date(Date.now() + 96 * 60 * 60 * 1000).toISOString();
    const startDate = startISO.slice(0, 10);
    const endDate = endISO.slice(0, 10);

    const v2Auth = { Authorization: `Bearer ${apiKey}`, "cal-api-version": "2024-09-04" };
    const v2NoAuth = { "cal-api-version": "2024-09-04" };

    function v2Url(params) {
      const u = new URL("https://api.cal.com/v2/slots");
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return u;
    }

    const variants = [
      {
        name: "v2 username+slug (auth)",
        url: v2Url({ username, eventTypeSlug: slug, start: startISO, end: endISO, timeZone: tz }),
        headers: v2Auth,
      },
      {
        name: "v2 username+slug (no auth)",
        url: v2Url({ username, eventTypeSlug: slug, start: startDate, end: endDate, timeZone: tz }),
        headers: v2NoAuth,
      },
      {
        name: "v2 eventTypeId (auth)",
        url: v2Url({ eventTypeId: id, start: startISO, end: endISO, timeZone: tz }),
        headers: v2Auth,
      },
      {
        name: "v2 eventTypeId (no auth)",
        url: v2Url({ eventTypeId: id, start: startDate, end: endDate, timeZone: tz }),
        headers: v2NoAuth,
      },
      {
        name: "v1 slots (apiKey param)",
        url: (() => {
          const u = new URL("https://api.cal.com/v1/slots");
          u.searchParams.set("apiKey", apiKey || "");
          u.searchParams.set("eventTypeId", id);
          u.searchParams.set("startTime", startISO);
          u.searchParams.set("endTime", endISO);
          return u;
        })(),
        headers: {},
      },
    ];

    out.calcom = [];
    for (const v of variants) {
      try {
        const r = await fetch(v.url, { headers: v.headers });
        const bodyText = await r.text();
        let dates = [];
        try {
          const parsed = JSON.parse(bodyText);
          const slotsObj = parsed?.data?.slots || parsed?.data || parsed?.slots;
          if (slotsObj && typeof slotsObj === "object") dates = Object.keys(slotsObj);
        } catch {}
        out.calcom.push({
          variant: v.name,
          http_status: r.status,
          dates_found: dates.slice(0, 5),
          body_preview: r.ok ? bodyText.slice(0, 200) : bodyText.slice(0, 160),
        });
      } catch (err) {
        out.calcom.push({ variant: v.name, error: String(err) });
      }
    }
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
