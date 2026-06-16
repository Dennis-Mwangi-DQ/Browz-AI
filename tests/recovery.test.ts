import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { BookingCancelledEvent, WaitlistEntry } from '../src/types';

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
  notifyStaffUnfilledSlot: vi.fn(async () => undefined),
}));

function chainable(result: unknown, extras: Record<string, unknown> = {}) {
  const chain = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    gt: vi.fn(() => chain),
    lt: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
    ...extras,
  };
  return chain;
}

const sampleEntry: WaitlistEntry = {
  id: 'WL-2026-00001',
  clientId: null,
  visitorName: 'Sam',
  visitorContact: '+971500000001',
  serviceId: 's-001',
  branchId: 'br-dxb',
  preferredDate: '2026-07-05',
  preferredDateRangeStart: null,
  preferredDateRangeEnd: null,
  preferredTimeStart: null,
  preferredTimeEnd: null,
  preferredArtistId: null,
  notificationChannel: 'whatsapp',
  priority: 0,
  status: 'waiting',
  offerSentAt: null,
  offerExpiresAt: null,
  offeredSlotId: null,
  offeredBookingRef: null,
  notes: null,
  createdAt: '2026-06-01T10:00:00Z',
  updatedAt: '2026-06-01T10:00:00Z',
};

describe('recovery orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('SC-30: surfaces walk-in when no waitlist matches', async () => {
    const { findWaitlistMatches } = await import('../src/tools/waitlist');
    vi.mocked(findWaitlistMatches).mockResolvedValue([]);

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'slot_recovery_log') {
        return chainable({ data: { id: 'log-1' }, error: null });
      }
      return chainable({ data: null, error: null });
    });

    const { handleCancellation } = await import('../src/agent/recoveryOrchestrator');
    await handleCancellation({
      bookingId: 'BRZ-2026-00001',
      slotId: 'slot-abc',
      serviceId: 's-001',
      branchId: 'br-dxb',
      startTime: '2026-07-05T14:00:00Z',
      cancellationSource: 'agent',
    });

    const slotUpdates = mockSupabase.from.mock.calls.filter(([t]) => t === 'time_slots');
    expect(slotUpdates.length).toBeGreaterThan(0);
  });

  it('SC-26: dispatches offer and holds slot when waitlist match exists', async () => {
    const { findWaitlistMatches, dispatchOfferToCandidate } = await import('../src/tools/waitlist');
    const { notifySlotOffer } = await import('../src/lib/notify');

    vi.mocked(findWaitlistMatches).mockResolvedValue([sampleEntry]);
    vi.mocked(dispatchOfferToCandidate).mockResolvedValue({
      success: true,
      data: { ...sampleEntry, status: 'offered', offeredSlotId: 'slot-abc' },
    });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'slot_recovery_log') {
        return chainable({ data: { id: 'log-1' }, error: null });
      }
      return chainable({ data: null, error: null });
    });

    const { handleCancellation } = await import('../src/agent/recoveryOrchestrator');
    await handleCancellation({
      bookingId: 'BRZ-2026-00001',
      slotId: 'slot-abc',
      serviceId: 's-001',
      branchId: 'br-dxb',
      startTime: '2026-07-05T14:00:00Z',
      cancellationSource: 'agent',
    });

    expect(dispatchOfferToCandidate).toHaveBeenCalled();
    expect(notifySlotOffer).toHaveBeenCalled();
  });

  it('SC-28: cascades to next candidate after decline', async () => {
    const { findWaitlistMatches, dispatchOfferToCandidate } = await import('../src/tools/waitlist');

    vi.mocked(findWaitlistMatches).mockResolvedValue([
      { ...sampleEntry, id: 'WL-2026-00002' },
    ]);
    vi.mocked(dispatchOfferToCandidate).mockResolvedValue({
      success: true,
      data: { ...sampleEntry, id: 'WL-2026-00002', status: 'offered' },
    });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'slot_recovery_log') {
        return chainable({ data: { id: 'log-1', offers_declined: 0 }, error: null });
      }
      if (table === 'time_slots') {
        return chainable({
          data: {
            service_id: 's-001',
            branch_id: 'br-dxb',
            start_time: '2026-07-05T14:00:00Z',
          },
          error: null,
        });
      }
      return chainable({ data: null, error: null });
    });

    const { handleOfferDeclined } = await import('../src/agent/recoveryOrchestrator');
    await handleOfferDeclined('WL-2026-00001', 'slot-abc');

    expect(dispatchOfferToCandidate).toHaveBeenCalled();
  });

  it('completeRecovery updates log via DB lookup', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'slot_recovery_log') {
        return chainable({ data: { id: 'log-1' }, error: null });
      }
      return chainable({ data: null, error: null });
    });

    const { completeRecovery } = await import('../src/agent/recoveryOrchestrator');
    await completeRecovery('slot-abc', 'waitlist_filled', 'BRZ-2026-00099');

    const logUpdates = mockSupabase.from.mock.calls.filter(([t]) => t === 'slot_recovery_log');
    expect(logUpdates.length).toBeGreaterThan(0);
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

describe('processUnfilledSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('SC-34: flags open walk-in slots as unfilled and logs outcome', async () => {
    const slots = [
      {
        id: 'slot-walkin',
        branch_id: 'br-dxb',
        service_id: 's-001',
        artist_id: null,
        start_time: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      },
    ];

    function queryChain(data: unknown) {
      const chain = {
        select: vi.fn(() => chain),
        update: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        is: vi.fn(() => chain),
        lte: vi.fn(() => chain),
        gt: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({ data: { id: 'log-1' }, error: null })),
        then: (resolve: (v: unknown) => void) => resolve({ data, error: null }),
      };
      return chain;
    }

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'time_slots') {
        return queryChain(slots);
      }
      if (table === 'slot_recovery_log') {
        return queryChain({ id: 'log-1' });
      }
      return queryChain(null);
    });

    const { processUnfilledSlots } = await import('../src/jobs/processUnfilledSlots');
    const { notifyStaffUnfilledSlot } = await import('../src/lib/notify');

    await processUnfilledSlots();

    expect(notifyStaffUnfilledSlot).toHaveBeenCalled();
    const slotUpdates = mockSupabase.from.mock.calls.filter(([t]) => t === 'time_slots');
    expect(slotUpdates.length).toBeGreaterThan(0);
  });
});

describe('events route payload', () => {
  it('parseYesNo handles offer responses', async () => {
    const { parseYesNo } = await import('../src/lib/dates');
    expect(parseYesNo('YES')).toBe(true);
    expect(parseYesNo('no')).toBe(false);
    expect(parseYesNo('maybe')).toBeNull();
  });
});
