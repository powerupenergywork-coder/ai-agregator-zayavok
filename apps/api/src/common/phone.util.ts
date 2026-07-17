/** Normalizes Kazakhstan/CIS-style phone input to a bare "+7XXXXXXXXXX" form. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `+7${digits}`;
  }
  if (raw.startsWith("+")) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

export function isValidPhone(phone: string): boolean {
  return /^\+7\d{10}$/.test(phone);
}

/** Masks a phone for anywhere it might leak before contacts are meant to be revealed. */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}
