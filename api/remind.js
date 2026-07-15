// Appointment reminder cron — runs once daily (see vercel.json crons, Vercel's Hobby
// plan only allows daily cron triggers) and emails anyone whose appointment starts in
// the next 24-48 hours and hasn't been reminded yet. On a Pro plan you can switch the
// vercel.json schedule to hourly and narrow this window to 24-25h for a tighter reminder time.
// Appointments booked without an email are never queued here (see api/lib/db.js).

import { getAppointmentsNeedingReminder, markReminderSent } from "./lib/db.js";
import { sendEmail, senderFor, reminderEmail } from "./lib/email.js";

// Fallbacks for appointments on the default (env-var) tenant, where business is null.
const DEFAULT_NAME = process.env.CLINIC_NAME || "the clinic";
const DEFAULT_TIMEZONE = process.env.CLINIC_TIMEZONE || "America/New_York";
const DEFAULT_FROM = process.env.EMAIL_FROM || null;

export default async function handler(req, res) {
  // Vercel Cron authenticates via the Authorization header on its own invocations.
  // A ?key= query param is also accepted so the endpoint can be triggered manually
  // from a browser for testing. Either way, block anyone without the secret from
  // triggering mass email sends.
  const headerSecret = req.headers["authorization"];
  const querySecret = (req.query && req.query.key) || "";
  const authorized =
    process.env.CRON_SECRET &&
    (headerSecret === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!authorized) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = Date.now();
  const windowStart = new Date(now + 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(now + 48 * 60 * 60 * 1000).toISOString();

  const result = await getAppointmentsNeedingReminder(windowStart, windowEnd);
  if (!result.ok) {
    return res.status(500).json({ error: result.error });
  }

  let sent = 0;
  for (const appt of result.appointments) {
    if (!appt.email) continue; // shouldn't happen — insertAppointment marks these reminded already

    // Per-tenant name/timezone/sender from the embedded business; env fallback if none.
    const name = appt.business?.name || DEFAULT_NAME;
    const timeZone = appt.business?.timezone || DEFAULT_TIMEZONE;
    const from = appt.business ? senderFor(name) : DEFAULT_FROM;

    const when = new Date(appt.start_time).toLocaleString("en-US", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    const em = reminderEmail(name, { when, service: appt.service });
    const emailResult = await sendEmail({ from, to: appt.email, subject: em.subject, text: em.text, html: em.html });
    if (emailResult.ok) {
      await markReminderSent(appt.id);
      sent += 1;
    }
  }

  return res.status(200).json({ checked: result.appointments.length, sent });
}
