import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { BookingCancelledEvent } from '../src/types';

const mockSupabase = {
  from: vi.fn(),
};

vi.mock('../src/db/supabaseClient', () => ({
  supabase: mockSupabase,
  hasSupabaseConfig: true,
  getSupabaseClient: () => mockSupabase,
}));

vi.mock('../src/tools/waitlist', () => ({
  findWaitlistMatches: vi.fn(async () => []),
  dispatchOfferToCandidate: vi.fn(),
  declineSlotOffer: vi.fn(),
  expireWaitlistOffer: vi.fn(),
}));

vi.mock('../src/lib/notify', () => ({
  notifySlotOffer: vi.fn(async () => null),
  notifyOfferExpired: vi.fn(async () => undefined),
}));

function chainable(result: unknown) {
  const chain = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
  };
  return chain;
}

describe('recovery orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('creates recovery log and surfaces walk-in when no waitlist matches', async () => {
    const { findWaitlistMatches } = await import('../src/tools/waitlist');
    vi.mocked(findWaitlistMatches).mockResolvedValue([]);

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'slot_recovery_log') {
        return chainable({ data: { id: 'log-1' }, error: null });
      }
      if (table === 'time_slots') {
        return chainable({ data: null, error: null });
      }
      return chainable({ data: null, error: null });
    });

    const { handleCancellation } = await import('../src/agent/recoveryOrchestrator');

    const event: BookingCancelledEvent = {
      bookingId: 'BRZ-2026-00001',
      slotId: 'slot-abc',
      serviceId: 's-001',
      branchId: 'br-dxb',
      startTime: '2026-07-05T14:00:00Z',
      cancellationSource: 'agent',
    };

    await handleCancellation(event);

    const updateCalls = mockSupabase.from.mock.calls.filter(([t]) => t === 'time_slots');
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it('emitBookingCancelled invokes registered listener', async () => {
    const { emitBookingCancelled, onBookingCancelled } = await import('../src/lib/events');
    const handler = vi.fn();
    onBookingCancelled(handler);

    const payload: BookingCancelledEvent = {
      bookingId: 'BRZ-2026-00002',
      slotId: 'slot-xyz',
      serviceId: 's-001',
      branchId: 'br-dxb',
      startTime: '2026-07-05T15:00:00Z',
      cancellationSource: 'staff',
    };

    emitBookingCancelled(payload);

    expect(handler).toHaveBeenCalledWith(payload);
  });
});

describe('events', () => {
  it('parseYesNo handles offer responses', async () => {
    const { parseYesNo } = await import('../src/lib/dates');
    expect(parseYesNo('YES')).toBe(true);
    expect(parseYesNo('no')).toBe(false);
    expect(parseYesNo('maybe')).toBeNull();
  });
});
