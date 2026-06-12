import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fromMock,
  insertions,
  queryResponses,
  recoveryMock,
  sendWhatsAppMock,
  updates,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  insertions: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  queryResponses: [] as Array<{ data: unknown[]; error: null }>,
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

import { dispatchReminders } from '../src/jobs/dispatchReminders';
import { processNoShowRisk } from '../src/jobs/processNoShowRisk';

function installSupabaseMock() {
  fromMock.mockImplementation((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      is: vi.fn(() => query),
      not: vi.fn(() => query),
      gte: vi.fn(() => query),
      lt: vi.fn(() => query),
      update: vi.fn((payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        return query;
      }),
      insert: vi.fn((payload: Record<string, unknown>) => {
        insertions.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      }),
      then: (
        resolve: (value: { data: unknown[]; error: null }) => unknown,
        reject: (reason?: unknown) => unknown,
      ) => Promise.resolve(queryResponses.shift() ?? { data: [], error: null }).then(resolve, reject),
    };
    return query;
  });
}

describe('no-show reminder jobs', () => {
  beforeEach(() => {
    insertions.length = 0;
    queryResponses.length = 0;
    updates.length = 0;
    fromMock.mockReset();
    recoveryMock.mockReset();
    sendWhatsAppMock.mockReset();
    sendWhatsAppMock.mockResolvedValue({ sent: true, messageSid: 'SM1' });
    recoveryMock.mockResolvedValue(undefined);
    installSupabaseMock();
  });

  it('dispatches reminder and reconfirmation nudges in the same message', async () => {
    queryResponses.push({
      data: [
        {
          id: 'BRZ-2026-00001',
          client_id: '22222222-2222-4222-8222-222222222222',
          visitor_contact: null,
          channel: 'whatsapp',
          time_slots: { start_time: '2026-06-13T10:00:00.000Z' },
          clients: { name: 'Aisha', phone: '+971500000001' },
          services: { title: 'Brow SPMU' },
          branches: { name: 'JBR' },
          artists: { name: 'Maya' },
        },
      ],
      error: null,
    });

    const result = await dispatchReminders({
      now: new Date('2026-06-12T10:00:00.000Z'),
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ processed: 1, sent: 1 });
    expect(sendWhatsAppMock.mock.calls[0]?.[0].body).toContain('Reply YES to confirm or NO to cancel');
    expect(insertions[0]).toMatchObject({
      table: 'reminder_log',
      payload: {
        booking_id: 'BRZ-2026-00001',
        reminder_type: 'reconfirmation_nudge',
        delivered: true,
      },
    });
    expect(updates[0]?.payload).toMatchObject({
      reconfirmation_status: 'pending',
    });
  });

  it('marks no-response bookings as no-show risk and invokes recovery hook', async () => {
    queryResponses.push({
      data: [
        {
          id: 'BRZ-2026-00001',
          slot_id: 'slot-1',
          service_id: 'svc-1',
          branch_id: 'br-1',
        },
      ],
      error: null,
    });

    const result = await processNoShowRisk({
      now: new Date('2026-06-12T11:05:00.000Z'),
    });

    expect(result.success).toBe(true);
    expect(updates[0]?.payload).toMatchObject({
      status: 'no_show_risk',
      reconfirmation_status: 'no_response',
    });
    expect(recoveryMock).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: 'BRZ-2026-00001',
      reason: 'no_show_risk',
    }));
  });
});
