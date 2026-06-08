import { describe, expect, it } from 'vitest';
import { resolveBookingDate } from '../src/lib/dates';

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
