// Appointment reminder cron — runs once daily (see vercel.json crons, Vercel's Hobby
// plan only allows daily cron triggers) and texts anyone whose appointment starts in
// the next 24-48 hours and hasn't been reminded yet. On a Pro plan you can switch the
// vercel.json schedule to hourly and narrow this window to 24-25h for a tighter reminder time.

import { getAppointmentsNeedingReminder, markReminderSent } from "./lib/db.js";
import { sendSms } from "./lib/twilio.js";

const CLINIC_NAME = process.env.CLINIC_NAME || "the clinic";
const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || "America/New_York";

export default async function handler(req, res) {
  // Vercel Cron sends this header on its own invocations; block anyone else from
  // triggering mass SMS sends by hitting the endpoint directly.
  const secret = req.headers["authorization"];
  if (process.env.CRON_SECRET && secret !== `Bearer ${process.env.CRON_SECRET}`) {
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
    const when = new Date(appt.start_time).toLocaleString("en-US", {
      timeZone: CLINIC_TIMEZONE,
      dateStyle: "medium",
      timeStyle: "short",
    });
    const smsResult = await sendSms(
      appt.phone,
      `Reminder: you have an appointment at ${CLINIC_NAME} tomorrow, ${when}${appt.service ? ` (${appt.service})` : ""}. Reply to this number if you need to reschedule.`
    );
    if (smsResult.ok) {
      await markReminderSent(appt.id);
      sent += 1;
    }
  }

  return res.status(200).json({ checked: result.appointments.length, sent });
}
