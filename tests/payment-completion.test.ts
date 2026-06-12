import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock, updates } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}));

vi.mock('../src/db/supabaseClient', () => ({
  supabase: { from: fromMock },
}));

vi.mock('../src/lib/stripeClient', () => ({
  stripe: null,
}));

import { completeBookingPayment } from '../src/tools/payment';

describe('completeBookingPayment', () => {
  beforeEach(() => {
    updates.length = 0;
    fromMock.mockReset();
    fromMock.mockImplementation((table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: { id: 'BRZ-2026-00001', payment_type: 'deposit' },
          error: null,
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          updates.push({ table, payload });
          return query;
        }),
        then: (
          resolve: (value: { error: null }) => unknown,
          reject: (reason?: unknown) => unknown,
        ) => Promise.resolve({ error: null }).then(resolve, reject),
      };
      return query;
    });
  });

  it('marks deposit bookings as confirmed and deposit paid', async () => {
    const result = await completeBookingPayment({ bookingRef: 'BRZ-2026-00001' });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      bookingId: 'BRZ-2026-00001',
      paymentStatus: 'deposit_paid',
    });
    expect(updates[0]?.payload).toMatchObject({
      status: 'confirmed',
      payment_status: 'deposit_paid',
    });
  });
});
