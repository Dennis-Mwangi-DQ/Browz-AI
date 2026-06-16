export function normalizePhoneNumber(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/^whatsapp:/i, '');
}

/**
 * Returns true when the string looks like a real phone number (≥7 digits) or
 * a real email address. Rejects freeform strings like "no number", "n/a", etc.
 */
export function isValidContact(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  // Email: something@something.tld
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
    return true;
  }

  // Phone: strip common formatting chars and require at least 7 digits
  const digitsOnly = trimmed.replace(/[\s\-().+]/g, '');
  return /^\d{7,}$/.test(digitsOnly);
}
