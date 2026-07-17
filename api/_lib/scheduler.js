// Scheduler dispatcher — picks a provider per tenant so the chat tool loop stays
// provider-agnostic. A business with Cal.com credentials (a static API key or a managed-user
// access token, plus an event type) uses the Cal.com provider; everything else uses the
// free native Supabase scheduler. chat.js imports these four functions instead of calcom.js.

import * as calcom from "./calcom.js";
import * as native from "./native-scheduler.js";

function providerFor(cfg) {
  const hasCalcom = Boolean((cfg?.apiKey || cfg?.accessToken) && cfg?.eventTypeId);
  return hasCalcom ? calcom : native;
}

export function getAvailableSlots(cfg, ...rest) {
  return providerFor(cfg).getAvailableSlots(cfg, ...rest);
}
export function createBooking(cfg, ...rest) {
  return providerFor(cfg).createBooking(cfg, ...rest);
}
export function cancelBooking(cfg, ...rest) {
  return providerFor(cfg).cancelBooking(cfg, ...rest);
}
export function rescheduleBooking(cfg, ...rest) {
  return providerFor(cfg).rescheduleBooking(cfg, ...rest);
}
