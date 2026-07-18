// Stable per-browser id used for the trusted-device OTP skip (see
// apps/api/src/auth-otp/auth-otp.service.ts) — persisted in localStorage so
// it survives reloads but is unique per browser/device.
const DEVICE_ID_KEY = "az_device_id";

// crypto.randomUUID() only exists in "secure contexts" (HTTPS or localhost) —
// on a plain http:// deployment (no domain/TLS yet) it's simply undefined on
// most mobile browsers, so this can't be the only path. Falls back to
// crypto.getRandomValues() (available everywhere) and finally Math.random();
// none of this needs to be cryptographically strong, it's just a device
// fingerprint for a UX convenience (skip OTP on a remembered device), not a
// security boundary.
function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = generateId();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
