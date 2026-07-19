import { env } from "../config/env";

interface SupplierWindow {
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
}

interface GlobalDefaults {
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

/** "HH:MM" in env.dispatchTimezone — zero-padded, so plain string comparison
 * against the "HH:MM" window bounds works as a time-of-day comparison. */
function nowInTimezone(): string {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: env.dispatchTimezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function isWithinWindow(start: string, end: string, now: string): boolean {
  if (start <= end) return now >= start && now <= end;
  // Window wraps past midnight (e.g. "22:00"–"06:00") — not used by any
  // preset today, but a supplier's own custom values could be set this way.
  return now >= start || now <= end;
}

/**
 * Resolves the effective quiet-hours window and checks whether "now" falls
 * inside it: supplier's own workingHoursStart/End takes priority, then the
 * admin-tunable DispatchSettings.quietHoursStart/End, then env's hardcoded
 * fallback. A supplier who explicitly opted into round-the-clock delivery
 * during onboarding has both bounds set to "00:00"/"23:59", which always
 * evaluates true here — no special-casing needed.
 */
export function isSupplierReachableNow(supplier: SupplierWindow, globalDefaults: GlobalDefaults): boolean {
  const start = supplier.workingHoursStart ?? globalDefaults.quietHoursStart ?? env.dispatchQuietHoursStart;
  const end = supplier.workingHoursEnd ?? globalDefaults.quietHoursEnd ?? env.dispatchQuietHoursEnd;
  return isWithinWindow(start, end, nowInTimezone());
}
