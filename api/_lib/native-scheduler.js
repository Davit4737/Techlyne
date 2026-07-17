// Native scheduler — Cal.com-free, dependency-free. Computes availability and books entirely
// against our own Supabase data, so a tenant needs no external scheduling account and costs
// nothing to run. Exposes the SAME four functions as calcom.js (getAvailableSlots,
// createBooking, cancelBooking, rescheduleBooking) so the chat tool loop is provider-agnostic
// — scheduler.js picks this provider for any business without Cal.com credentials.
//
// Model: availability = the business's working hours (cfg.availability) sliced into
// cfg.slotMinutes slots, MINUS slots already held by a confirmed appointment for THIS
// business_id (tenants never block each other). The appointment row itself is written by the
// caller (chat.js insertAppointment); this module owns slot math + the booking race-check.
//
// cfg carries: { businessId, availability, slotMinutes, timeZone }.

import { getConfirmedAppointments } from "./db.js";

const DEFAULT_SLOT_MINUTES = 30;
const MIN_NOTICE_MINUTES = 120; // earliest a slot can be booked from now — mirrors Cal.com's default
const MAX_SLOTS = 500; // safety cap on a single availability response
const DEFAULT_AVAILABILITY = [
  { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], startTime: "09:00", endTime: "17:00" },
];

// ─────────────────────────── timezone helpers (Intl only, no deps) ───────────────────────────

// Offset in ms between wall-clock time in `timeZone` and true UTC, at instant `ts`.
function tzOffsetMs(ts, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const map = {};
  for (const p of dtf.formatToParts(new Date(ts))) map[p.type] = p.value;
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return asUTC - ts;
}

// The UTC instant for a wall-clock time (y, mo, d, h, mi) in `timeZone`. Refines once so DST
// boundaries resolve correctly.
function wallToUtcMs(y, mo, d, h, mi, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(guess, timeZone);
  let ts = guess - off1;
  const off2 = tzOffsetMs(ts, timeZone);
  if (off2 !== off1) ts = guess - off2;
  return ts;
}

// Local calendar date {y, mo, d} of instant `ts` in `timeZone`.
function localDateParts(ts, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const map = {};
  for (const p of dtf.formatToParts(new Date(ts))) map[p.type] = p.value;
  return { y: +map.year, mo: +map.month, d: +map.day };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function pad2(n) { return String(n).padStart(2, "0"); }
function parseHM(hm) {
  const m = String(hm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { h: +m[1], mi: +m[2] };
}

function normalizeAvailability(availability) {
  if (Array.isArray(availability) && availability.length) return availability;
  return DEFAULT_AVAILABILITY;
}

// ─────────────────────────── provider interface ───────────────────────────

// Open slots in [startISO, endISO], as { 'YYYY-MM-DD': [{ start: <utc ISO> }, ...] } — the
// exact shape chat.js's check_availability handler already consumes from Cal.com.
export async function getAvailableSlots(cfg, startISO, endISO, timeZone = "UTC") {
  const tz = cfg?.timeZone || timeZone || "UTC";
  const rules = normalizeAvailability(cfg?.availability);
  // Defense in depth: a zero/negative slot length would make the slot loop below spin
  // forever. The API clamps on write, but never trust a stored value with a hot loop.
  const rawSlot = Math.round(Number(cfg?.slotMinutes)) || DEFAULT_SLOT_MINUTES;
  const slot = Math.min(Math.max(rawSlot, 5), 480);
  const rangeStart = Date.parse(startISO);
  const rangeEnd = Date.parse(endISO);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) {
    return { ok: false, error: "Invalid date range" };
  }
  const earliest = Date.now() + MIN_NOTICE_MINUTES * 60000;

  // Slots already taken by confirmed appointments for this tenant, keyed by epoch ms.
  const booked = await getConfirmedAppointments({ businessId: cfg?.businessId, fromISO: startISO, toISO: endISO });
  if (!booked.ok) return { ok: false, error: booked.error };
  const taken = new Set((booked.appointments || []).map((a) => Date.parse(a.start_time)));

  // Iterate each calendar date in the range (bounds taken from the local date of each end).
  const from = localDateParts(rangeStart, tz);
  const to = localDateParts(rangeEnd, tz);
  let dayCursor = Date.UTC(from.y, from.mo - 1, from.d);
  const lastDay = Date.UTC(to.y, to.mo - 1, to.d);

  const days = {};
  let count = 0;
  while (dayCursor <= lastDay && count < MAX_SLOTS) {
    const dt = new Date(dayCursor);
    const Y = dt.getUTCFullYear(), Mo = dt.getUTCMonth() + 1, D = dt.getUTCDate();
    const weekday = WEEKDAYS[dt.getUTCDay()]; // weekday of the calendar date (tz-independent)
    const dateKey = `${Y}-${pad2(Mo)}-${pad2(D)}`;

    for (const rule of rules) {
      if (!Array.isArray(rule?.days) || !rule.days.includes(weekday)) continue;
      const open = parseHM(rule.startTime);
      const close = parseHM(rule.endTime);
      if (!open || !close) continue;
      const openMin = open.h * 60 + open.mi;
      const closeMin = close.h * 60 + close.mi;

      for (let t = openMin; t + slot <= closeMin && count < MAX_SLOTS; t += slot) {
        const ms = wallToUtcMs(Y, Mo, D, Math.floor(t / 60), t % 60, tz);
        if (ms < earliest) continue;      // too soon (past or inside the notice window)
        if (taken.has(ms)) continue;       // already booked
        (days[dateKey] = days[dateKey] || []).push({ start: new Date(ms).toISOString() });
        count += 1;
      }
    }
    dayCursor += 86400000;
  }

  return { ok: true, slots: days };
}

// "Books" a slot: the durable record is the appointments row the caller inserts, so this only
// guards against a race (someone else grabbing the exact slot between availability and confirm)
// and returns a stable synthetic uid for calcom_booking_uid. Same-phone re-calls are handled
// upstream (idempotency), so any confirmed appointment at this exact start is a real conflict.
export async function createBooking(cfg, { startISO }) {
  const ms = Date.parse(startISO);
  if (!Number.isFinite(ms)) return { ok: false, error: "Invalid start time" };

  const check = await getConfirmedAppointments({
    businessId: cfg?.businessId,
    fromISO: new Date(ms).toISOString(),
    toISO: new Date(ms + 60000).toISOString(),
  });
  if (check.ok && (check.appointments || []).some((a) => Date.parse(a.start_time) === ms)) {
    return { ok: false, error: "slot_taken", conflict: true };
  }
  return { ok: true, booking: { uid: `native_${ms}_${Math.random().toString(36).slice(2, 10)}` } };
}

// Native bookings have no external system to cancel — the row's status is flipped by the
// caller (chat.js doCancel → cancelAppointment). Nothing to do here.
export async function cancelBooking() {
  return { ok: true };
}

// Re-validates the new slot is open, then hands the same uid back for the caller to re-point
// the row's start_time onto. No external booking to move.
export async function rescheduleBooking(cfg, uid, startISO) {
  const ms = Date.parse(startISO);
  if (!Number.isFinite(ms)) return { ok: false, error: "Invalid start time" };

  const check = await getConfirmedAppointments({
    businessId: cfg?.businessId,
    fromISO: new Date(ms).toISOString(),
    toISO: new Date(ms + 60000).toISOString(),
  });
  if (check.ok && (check.appointments || []).some((a) => Date.parse(a.start_time) === ms)) {
    return { ok: false, error: "That time is no longer available." };
  }
  return { ok: true, booking: { uid }, newUid: uid };
}
