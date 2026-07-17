// Stable per-browser id used for the trusted-device OTP skip (see
// apps/api/src/auth-otp/auth-otp.service.ts) — persisted in localStorage so
// it survives reloads but is unique per browser/device.
const DEVICE_ID_KEY = "az_device_id";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
