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

export async function getAvailableSlots(cfg, ...rest) {
  const provider = providerFor(cfg);
  const r = await provider.getAvailableSlots(cfg, ...rest);
  // Config rot: Cal.com credentials that once worked but now 400/404 (deleted event type,
  // malformed id — both seen in production). Rather than leaving the tenant unbookable,
  // serve availability from the native scheduler; its defaults (Mon–Fri 9–17) apply if the
  // row has no structured availability. Transient Cal.com outages (5xx/network) are NOT
  // rerouted — mixing engines mid-outage could offer slots Cal.com later rejects.
  if (!r.ok && provider === calcom && (r.status === 400 || r.status === 404)) {
    console.warn("Cal.com availability config error — falling back to native scheduler for this request");
    return native.getAvailableSlots(cfg, ...rest);
  }
  return r;
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
