/** BROWZ branches operate on Gulf Standard Time (UTC+4, no DST). */
export const SALON_TIMEZONE = 'Asia/Dubai';
const SALON_UTC_OFFSET = '+04:00';

export function toIsoDate(input: Date): string {
  return input.toISOString().slice(0, 10);
}

function salonTimeParts(isoTime: string): { hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SALON_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoTime));

  return {
    hour: parts.find((part) => part.type === 'hour')?.value ?? '00',
    minute: parts.find((part) => part.type === 'minute')?.value ?? '00',
  };
}

/** Convert an ISO instant to salon-local HH:MM (Asia/Dubai). */
export function isoToSalonLocalTime(isoTime: string): string {
  const { hour, minute } = salonTimeParts(isoTime);
  return `${hour}:${minute}`;
}

/** UTC ISO bounds for one salon calendar day (YYYY-MM-DD in Dubai). */
export function salonDayBoundsUtc(isoDate: string): { startIso: string; endIso: string } {
  const start = new Date(`${isoDate}T00:00:00${SALON_UTC_OFFSET}`);
  const end = new Date(`${isoDate}T23:59:59.999${SALON_UTC_OFFSET}`);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function slotMatchesSalonLocalTime(slotStartIso: string, timeHHMM: string): boolean {
  return isoToSalonLocalTime(slotStartIso) === timeHHMM;
}

/** 24h HH:MM → "8:00 AM" in salon-local phrasing for agent responses. */
export function formatSalonLocalTime12h(timeHHMM: string): string {
  const [hourPart, minutePart = '00'] = timeHHMM.split(':');
  const hour = Number(hourPart);
  if (Number.isNaN(hour)) {
    return timeHHMM;
  }
  const minute = minutePart.padStart(2, '0');
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute} ${period}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

export function parseYesNo(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (['yes', 'y', 'yeah', 'yep', 'true'].includes(normalized)) {
    return true;
  }
  if (['no', 'n', 'nope', 'false'].includes(normalized)) {
    return false;
  }
  return null;
}

export function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function isPastIsoDate(date: string): boolean {
  return date < toIsoDate(startOfTodayUtc());
}

export type ResolvedBookingDate =
  | { ok: true; date: string }
  | { ok: false; error: 'date_required' | 'invalid_date' | 'date_in_past' };

export function resolveBookingDate(dateArg: unknown): ResolvedBookingDate {
  if (dateArg == null || String(dateArg).trim() === '') {
    return { ok: false, error: 'date_required' };
  }

  const date = String(dateArg).trim();
  if (!isIsoDate(date)) {
    return { ok: false, error: 'invalid_date' };
  }

  if (isPastIsoDate(date)) {
    return { ok: false, error: 'date_in_past' };
  }

  return { ok: true, date };
}
