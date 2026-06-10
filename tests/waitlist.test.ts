import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockSupabase = {
  from: vi.fn(),
};

vi.mock('../src/db/supabaseClient', () => ({
  supabase: mockSupabase,
  hasSupabaseConfig: true,
  getSupabaseClient: () => mockSupabase,
}));

vi.mock('../src/lib/catalog', () => ({
  getServiceById: vi.fn(async () => ({
    id: 's-001',
    name: 'Brow Lamination',
    category: 'Brows',
    gateCategory: 'brows',
    serviceTier: 'T1',
    city: 'Dubai',
    durationMinutes: 60,
    priceAed: 250,
    requiresConsultation: false,
    requiresPatchTest: false,
    requiresScreening: false,
    isMedicalGated: false,
    minFrequencyWeeks: null,
    frequencyHardBlock: false,
    description: '',
  })),
  getBranchById: vi.fn(async () => ({
    id: 'br-dxb',
    name: 'Dubai Mall',
    city: 'Dubai',
    address: '',
    phone: '',
  })),
}));

function chainable(result: unknown, terminal: 'promise' | 'single' = 'single') {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const self = () => chain;
  for (const method of [
    'select',
    'insert',
    'update',
    'eq',
    'or',
    'like',
    'limit',
    'in',
    'lte',
    'lt',
  ]) {
    chain[method] = vi.fn(self);
  }
  let orderCalls = 0;
  chain.order = vi.fn(() => {
    if (terminal === 'promise') {
      orderCalls += 1;
      if (orderCalls >= 2) {
        return Promise.resolve(result);
      }
    }
    return chain;
  });
  chain.maybeSingle = vi.fn(async () => result);
  chain.single = vi.fn(async () => result);
  return chain;
}

describe('waitlist tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findWaitlistMatches filters by time window', async () => {
    const { findWaitlistMatches } = await import('../src/tools/waitlist');

    const rows = [
      {
        id: 'WL-2026-00001',
        client_id: null,
        visitor_name: 'Sam',
        visitor_contact: '+971500000001',
        service_id: 's-001',
        branch_id: 'br-dxb',
        preferred_date: '2026-07-05',
        preferred_date_range_start: null,
        preferred_date_range_end: null,
        preferred_time_start: '12:00',
        preferred_time_end: '18:00',
        preferred_artist_id: null,
        notification_channel: 'whatsapp',
        priority: 0,
        status: 'waiting',
        offer_sent_at: null,
        offer_expires_at: null,
        offered_slot_id: null,
        offered_booking_ref: null,
        notes: null,
        created_at: '2026-06-01T10:00:00Z',
        updated_at: '2026-06-01T10:00:00Z',
      },
      {
        id: 'WL-2026-00002',
        client_id: null,
        visitor_name: 'Alex',
        visitor_contact: '+971500000002',
        service_id: 's-001',
        branch_id: 'br-dxb',
        preferred_date: '2026-07-05',
        preferred_date_range_start: null,
        preferred_date_range_end: null,
        preferred_time_start: '08:00',
        preferred_time_end: '10:00',
        preferred_artist_id: null,
        notification_channel: 'whatsapp',
        priority: 0,
        status: 'waiting',
        offer_sent_at: null,
        offer_expires_at: null,
        offered_slot_id: null,
        offered_booking_ref: null,
        notes: null,
        created_at: '2026-06-01T11:00:00Z',
        updated_at: '2026-06-01T11:00:00Z',
      },
    ];

    mockSupabase.from.mockReturnValue(
      chainable({ data: rows, error: null }, 'promise'),
    );

    const matches = await findWaitlistMatches(
      'slot-1',
      's-001',
      'br-dxb',
      new Date('2026-07-05T14:00:00Z'),
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe('WL-2026-00001');
  });

  it('addToWaitlist generates WL reference format', async () => {
    const { addToWaitlist } = await import('../src/tools/waitlist');

    const waitlistRow = {
      id: 'WL-2026-00089',
      client_id: null,
      visitor_name: 'Guest',
      visitor_contact: '+971500000099',
      service_id: 's-001',
      branch_id: 'br-dxb',
      preferred_date: '2026-07-05',
      preferred_date_range_start: null,
      preferred_date_range_end: null,
      preferred_time_start: null,
      preferred_time_end: null,
      preferred_artist_id: null,
      notification_channel: 'whatsapp',
      priority: 0,
      status: 'waiting',
      offer_sent_at: null,
      offer_expires_at: null,
      offered_slot_id: null,
      offered_booking_ref: null,
      notes: null,
      created_at: '2026-06-01T10:00:00Z',
      updated_at: '2026-06-01T10:00:00Z',
    };

    let call = 0;
    mockSupabase.from.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return chainable({ data: [], error: null });
      }
      if (call === 2) {
        return chainable({ data: { offer_window_minutes: 15 }, error: null });
      }
      return chainable({ data: waitlistRow, error: null });
    });

    const result = await addToWaitlist({
      serviceId: 's-001',
      branchId: 'br-dxb',
      preferredDate: '2026-07-05',
      visitorName: 'Guest',
      visitorContact: '+971500000099',
    });

    expect(result.success).toBe(true);
    expect(result.data?.waitlistRef).toMatch(/^WL-2026-\d{5}$/);
  });
});
