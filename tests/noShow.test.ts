import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContext } from '../src/types';

const {
  fromMock,
  insertions,
  maybeSingles,
  pendingResponses,
  recoveryMock,
  sendWhatsAppMock,
  updates,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  insertions: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  maybeSingles: [] as Array<{ data: unknown; error: null }>,
  pendingResponses: [] as Array<{ data: unknown[]; error: null }>,
  recoveryMock: vi.fn(),
  sendWhatsAppMock: vi.fn(),
  updates: [] as Array<{ table: string; payload: Record<string, unknown> }>,
}));

vi.mock('../src/db/supabaseClient', () => ({
  supabase: { from: fromMock },
}));

vi.mock('../src/lib/messaging', () => ({
  sendWhatsAppMessage: sendWhatsAppMock,
}));

vi.mock('../src/lib/recoveryHook', () => ({
  invokeCancellationRecovery: recoveryMock,
}));

import {
  cancelFromReconfirmation,
  handleReconfirmationReply,
  recordNoShow,
} from '../src/tools/noShow';

function installSupabaseMock() {
  fromMock.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      limit: vi.fn(() => query),
      not: vi.fn(() => query),
      lt: vi.fn(() => query),
      gte: vi.fn(() => query),
      is: vi.fn(() => query),
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        return query;
      }),
      insert: vi.fn((payload: Record<string, unknown>) => {
        insertions.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      }),
      maybeSingle: vi.fn(async () => maybeSingles.shift() ?? { data: null, error: null }),
      then: (
        resolve: (value: { data: unknown[]; error: null }) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(pendingResponses.shift() ?? { data: [], error: null }).then(resolve, reject),
    };
    return query;
  });
}

function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    sessionId: '11111111-1111-4111-8111-111111111111',
    channel: 'whatsapp',
    userTier: 'client',
    clientId: '22222222-2222-4222-8222-222222222222',
    whatsappNumber: 'whatsapp:+971500000001',
    conversationHistory: [],
    lastIntent: null,
    lastBookingRef: null,
    status: 'active',
    clarificationCount: 0,
    createdAt: '2026-06-12T00:00:00.000Z',
    updatedAt: '2026-06-12T00:00:00.000Z',
    ...overrides,
  };
}

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'BRZ-2026-00001',
    client_id: '22222222-2222-4222-8222-222222222222',
    visitor_contact: '+971500000001',
    slot_id: 'slot-1',
    service_id: 'svc-1',
    branch_id: 'br-1',
    deposit_amount_aed: 100,
    payment_status: 'deposit_paid',
    reconfirmation_status: 'pending',
    time_slots: { start_time: '2026-06-13T10:00:00.000Z' },
    clients: {
      name: 'Aisha',
      phone: '+971500000001',
      no_show_count: 1,
      no_show_flag: 'none',
    },
    services: { title: 'Brow Lamination' },
    branches: { name: 'Dubai Mall' },
    ...overrides,
  };
}

describe('no-show tools', () => {
  beforeEach(() => {
    insertions.length = 0;
    maybeSingles.length = 0;
    pendingResponses.length = 0;
    updates.length = 0;
    fromMock.mockReset();
    recoveryMock.mockReset();
    sendWhatsAppMock.mockReset();
    sendWhatsAppMock.mockResolvedValue({ sent: true, messageSid: 'SM1' });
    recoveryMock.mockResolvedValue(undefined);
    installSupabaseMock();
  });

  it('handles a YES reconfirmation reply for a client booking', async () => {
    pendingResponses.push({ data: [{ id: 'BRZ-2026-00001' }], error: null });
    maybeSingles.push({ data: { id: 'BRZ-2026-00001' }, error: null });

    const result = await handleReconfirmationReply({
      message: 'YES',
      session: session(),
    });

    expect(result.handled).toBe(true);
    expect(updates.find((entry) => entry.table === 'bookings')?.payload).toMatchObject({
      reconfirmation_status: 'confirmed',
    });
    expect(insertions.find((entry) => entry.table === 'reminder_log')?.payload).toMatchObject({
      response: 'YES',
    });
  });

  it('handles a NO reconfirmation reply for a visitor booking', async () => {
    pendingResponses.push({ data: [{ id: 'BRZ-2026-00002' }], error: null });
    maybeSingles.push({
      data: bookingRow({
        id: 'BRZ-2026-00002',
        client_id: null,
        time_slots: { start_time: '2020-01-01T10:00:00.000Z' },
      }),
      error: null,
    });

    const result = await handleReconfirmationReply({
      message: 'NO',
      session: session({
        userTier: 'visitor',
        clientId: null,
        agentContext: { visitorContact: '+971500000001' },
      }),
    });

    expect(result.handled).toBe(true);
    expect(updates.find((entry) => entry.table === 'bookings')?.payload).toMatchObject({
      status: 'cancelled',
      deposit_forfeited: true,
      payment_status: 'forfeited',
    });
    expect(recoveryMock).toHaveBeenCalledWith(expect.objectContaining({ reason: 'cancelled' }));
  });

  it('records no-show, increments counter, triggers flag, and logs the event', async () => {
    maybeSingles.push({ data: bookingRow(), error: null });

    const result = await recordNoShow({ bookingId: 'BRZ-2026-00001' });

    expect(result.success).toBe(true);
    expect(updates.find((entry) => entry.table === 'bookings')?.payload).toMatchObject({
      status: 'no_show',
      deposit_forfeited: true,
      payment_status: 'forfeited',
    });
    expect(updates.find((entry) => entry.table === 'clients')?.payload).toMatchObject({
      no_show_count: 2,
      no_show_flag: 'active',
    });
    expect(insertions.find((entry) => entry.table === 'no_show_log')?.payload).toMatchObject({
      booking_id: 'BRZ-2026-00001',
      flag_triggered: true,
      no_show_count_at_event: 2,
    });
    expect(sendWhatsAppMock).toHaveBeenCalled();
  });

  it('does not apply client flags to visitor no-shows', async () => {
    maybeSingles.push({
      data: bookingRow({ client_id: null, clients: null }),
      error: null,
    });

    const result = await recordNoShow({ bookingId: 'BRZ-2026-00001' });

    expect(result.success).toBe(true);
    expect(updates.some((entry) => entry.table === 'clients')).toBe(false);
    expect(insertions.find((entry) => entry.table === 'no_show_log')?.payload).toMatchObject({
      client_id: null,
      no_show_count_at_event: null,
    });
  });

  it('keeps deposits refundable before the forfeiture cutoff', async () => {
    maybeSingles.push({
      data: bookingRow({
        time_slots: { start_time: '2026-06-13T10:00:00.000Z' },
      }),
      error: null,
    });

    const result = await cancelFromReconfirmation({
      bookingRef: 'BRZ-2026-00001',
      clientId: '22222222-2222-4222-8222-222222222222',
      now: new Date('2026-06-12T09:00:00.000Z'),
    });

    expect(result.success).toBe(true);
    expect(result.data?.depositForfeited).toBe(false);
    expect(updates.find((entry) => entry.table === 'bookings')?.payload).toMatchObject({
      status: 'cancelled',
      deposit_forfeited: false,
    });
  });
});
