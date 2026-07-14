// Appointment reminder cron — runs once daily (see vercel.json crons, Vercel's Hobby
// plan only allows daily cron triggers) and emails anyone whose appointment starts in
// the next 24-48 hours and hasn't been reminded yet. On a Pro plan you can switch the
// vercel.json schedule to hourly and narrow this window to 24-25h for a tighter reminder time.
// Appointments booked without an email are never queued here (see api/lib/db.js).

import { getAppointmentsNeedingReminder, markReminderSent } from "./lib/db.js";
import { sendEmail } from "./lib/email.js";

const CLINIC_NAME = process.env.CLINIC_NAME || "the clinic";
const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || "America/New_York";

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

    const when = new Date(appt.start_time).toLocaleString("en-US", {
      timeZone: CLINIC_TIMEZONE,
      dateStyle: "medium",
      timeStyle: "short",
    });
    const emailResult = await sendEmail(
      appt.email,
      `Reminder: your appointment at ${CLINIC_NAME}`,
      `Reminder: you have an appointment at ${CLINIC_NAME} tomorrow, ${when}${appt.service ? ` (${appt.service})` : ""}. Contact the clinic directly if you need to reschedule.`
    );
    if (emailResult.ok) {
      await markReminderSent(appt.id);
      sent += 1;
    }
  }

  return res.status(200).json({ checked: result.appointments.length, sent });
}
