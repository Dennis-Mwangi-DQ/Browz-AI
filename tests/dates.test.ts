import { describe, expect, it } from 'vitest';
import {
  isoToSalonLocalTime,
  resolveBookingDate,
  salonDayBoundsUtc,
  slotMatchesSalonLocalTime,
} from '../src/lib/dates';

describe('resolveBookingDate', () => {
  it('requires an explicit date', () => {
    expect(resolveBookingDate(undefined)).toEqual({ ok: false, error: 'date_required' });
    expect(resolveBookingDate('')).toEqual({ ok: false, error: 'date_required' });
  });

  it('rejects past dates', () => {
    expect(resolveBookingDate('2023-10-05')).toEqual({ ok: false, error: 'date_in_past' });
  });

  it('accepts a future iso date', () => {
    const result = resolveBookingDate('2099-01-15');
    expect(result).toEqual({ ok: true, date: '2099-01-15' });
  });
});

describe('salon timezone helpers', () => {
  it('converts UTC instants to Dubai local HH:MM', () => {
    expect(isoToSalonLocalTime('2026-06-15T04:00:00.000Z')).toBe('08:00');
    expect(isoToSalonLocalTime('2026-06-15T08:00:00.000Z')).toBe('12:00');
  });

  it('matches requested times against salon-local slot starts', () => {
    expect(slotMatchesSalonLocalTime('2026-06-15T04:00:00.000Z', '08:00')).toBe(true);
    expect(slotMatchesSalonLocalTime('2026-06-15T04:00:00.000Z', '04:00')).toBe(false);
  });

  it('builds Dubai day bounds in UTC', () => {
    const { startIso, endIso } = salonDayBoundsUtc('2026-06-15');
    expect(startIso).toBe('2026-06-14T20:00:00.000Z');
    expect(endIso).toBe('2026-06-15T19:59:59.999Z');
  });
});
