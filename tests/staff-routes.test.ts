import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSupabaseClientMock, updates } = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}));

vi.mock('../src/db/supabaseClient', () => ({
  getSupabaseClient: getSupabaseClientMock,
}));

import { checkInBooking, liftNoShowFlag } from '../src/routes/staff';

function installSupabaseMock(response: Record<string, unknown>) {
  getSupabaseClientMock.mockReturnValue({
    from: (table: string) => {
      const query = {
        update: vi.fn((payload: Record<string, unknown>) => {
          updates.push({ table, payload });
          return query;
        }),
        eq: vi.fn(() => query),
        select: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: response, error: null })),
      };
      return query;
    },
  });
}

describe('staff routes operations', () => {
  beforeEach(() => {
    updates.length = 0;
    getSupabaseClientMock.mockReset();
  });

  it('checks in a booking and marks it completed', async () => {
    installSupabaseMock({
      id: 'BRZ-2026-00001',
      status: 'completed',
      check_in_recorded: true,
    });

    const result = await checkInBooking('BRZ-2026-00001');

    expect(result.success).toBe(true);
    expect(updates[0]).toMatchObject({
      table: 'bookings',
      payload: {
        check_in_recorded: true,
        status: 'completed',
      },
    });
  });

  it('lifts a client no-show flag', async () => {
    installSupabaseMock({
      id: '22222222-2222-4222-8222-222222222222',
      no_show_flag: 'lifted',
    });

    const result = await liftNoShowFlag('22222222-2222-4222-8222-222222222222');

    expect(result.success).toBe(true);
    expect(updates[0]).toMatchObject({
      table: 'clients',
      payload: {
        no_show_flag: 'lifted',
      },
    });
  });
});
