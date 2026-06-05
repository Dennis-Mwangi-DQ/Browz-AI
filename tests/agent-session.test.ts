import { describe, expect, it } from 'vitest';
import { getContextSnapshot, learnFromToolCalls } from '../src/agent/agent-session';
import type { SessionContext } from '../src/types';

describe('agent session context', () => {
  const baseSession: SessionContext = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    channel: 'web',
    userTier: 'visitor',
    clientId: null,
    whatsappNumber: null,
    conversationHistory: [],
    lastIntent: null,
    lastBookingRef: 'BK-100',
    agentContext: {
      lastService: 'Brow Threading',
      lastBranch: 'Dubai Marina',
      recentTopics: ['search_availability'],
    },
    status: 'active',
    clarificationCount: 0,
    createdAt: '2026-06-05T11:47:00.000Z',
    updatedAt: '2026-06-05T11:47:00.000Z',
  };

  it('reads persisted context from the session', () => {
    expect(getContextSnapshot(baseSession)).toEqual({
      lastService: 'Brow Threading',
      lastBranch: 'Dubai Marina',
      recentTopics: ['search_availability'],
    });
  });

  it('learns service and booking fields from tool calls', () => {
    const next = learnFromToolCalls(getContextSnapshot(baseSession), [
      {
        name: 'create_booking',
        args: {
          service: 'Brow Lamination',
          branch: 'JBR',
          bookingReference: 'BK-200',
        },
      },
    ]);

    expect(next.lastService).toBe('Brow Lamination');
    expect(next.lastBranch).toBe('JBR');
    expect(next.lastBookingRef).toBe('BK-200');
    expect(next.recentTopics).toContain('create_booking');
    expect(next.recentTopics).toContain('bookings');
  });
});
