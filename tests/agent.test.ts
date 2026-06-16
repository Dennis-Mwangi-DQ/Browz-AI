import { AIMessage } from '@langchain/core/messages';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toIsoDate } from '../src/lib/dates';

const {
  appendTurnMock,
  createAgentLlmMock,
  getOrCreateSessionMock,
  invokeMock,
  isAgentLlmEnabledMock,
  lookupFaqMock,
  resolveUserIdentityMock,
  updateSessionMock,
} = vi.hoisted(() => ({
  appendTurnMock: vi.fn(),
  createAgentLlmMock: vi.fn(),
  getOrCreateSessionMock: vi.fn(),
  invokeMock: vi.fn(),
  isAgentLlmEnabledMock: vi.fn(() => true),
  lookupFaqMock: vi.fn(),
  resolveUserIdentityMock: vi.fn(),
  updateSessionMock: vi.fn(),
}));

vi.mock('../src/lib/llmClient', () => ({
  isAgentLlmEnabled: isAgentLlmEnabledMock,
  createAgentLlm: createAgentLlmMock,
}));

vi.mock('../src/tools/faq', () => ({
  lookupFaq: lookupFaqMock,
}));

vi.mock('../src/memory/sessionManager', () => ({
  appendTurn: appendTurnMock,
  getOrCreateSession: getOrCreateSessionMock,
  resolveUserIdentity: resolveUserIdentityMock,
  updateSession: updateSessionMock,
}));

import { runAgent } from '../src/agent/agent';

describe('runAgent', () => {
  const baseSession = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    channel: 'web' as const,
    userTier: 'visitor' as const,
    clientId: null,
    whatsappNumber: null,
    conversationHistory: [],
    lastIntent: null,
    lastBookingRef: null,
    status: 'active' as const,
    clarificationCount: 0,
    createdAt: '2026-06-05T11:47:00.000Z',
    updatedAt: '2026-06-05T11:47:00.000Z',
  };

  beforeEach(() => {
    appendTurnMock.mockReset();
    createAgentLlmMock.mockReset();
    getOrCreateSessionMock.mockReset();
    invokeMock.mockReset();
    isAgentLlmEnabledMock.mockReset();
    isAgentLlmEnabledMock.mockReturnValue(true);
    lookupFaqMock.mockReset();
    resolveUserIdentityMock.mockReset();
    updateSessionMock.mockReset();

    resolveUserIdentityMock.mockResolvedValue({
      userTier: 'visitor',
      clientId: null,
    });
    getOrCreateSessionMock.mockResolvedValue(baseSession);
    updateSessionMock.mockResolvedValue(baseSession);
    appendTurnMock.mockResolvedValue(undefined);

    createAgentLlmMock.mockReturnValue({
      bindTools: vi.fn(() => ({
        invoke: invokeMock,
      })),
    });
  });

  it('dispatches native tool calls and returns the model final response', async () => {
    invokeMock
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'lookup_faq',
              args: { query: 'services offered' },
              id: 'call_1',
              type: 'tool_call',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new AIMessage({
          content:
            'We offer brow, lash, skin, and injectable services across our branches.',
        }),
      );

    lookupFaqMock.mockResolvedValue({
      success: true,
      data: {
        answer: 'We offer brow, lash, skin, and injectable services across our branches.',
      },
    });

    const result = await runAgent({
      message: 'What services do you offer?',
      sessionId: baseSession.sessionId,
      channel: 'web',
    });

    expect(result.toolCalls).toEqual([
      {
        name: 'lookup_faq',
        args: { query: 'services offered' },
      },
    ]);
    expect(result.response).toBe(
      'We offer brow, lash, skin, and injectable services across our branches.',
    );
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('returns a usable greeting response', async () => {
    invokeMock.mockResolvedValueOnce(
      new AIMessage({
        content:
          'Welcome to Browz. I can help with availability, bookings, consultations, payments, and treatment questions.',
      }),
    );

    const result = await runAgent({
      message: 'Hello there',
      sessionId: baseSession.sessionId,
      channel: 'web',
    });

    expect(result.response.toLowerCase()).toContain('browz');
    expect(result.toolCalls).toEqual([]);
  });

  it('strips emoji characters from model responses', async () => {
    invokeMock.mockResolvedValueOnce(
      new AIMessage({
        content:
          '### 🚫 Medical Screening Required\n\nProfhilo needs screening first. ✅',
      }),
    );

    const result = await runAgent({
      message: 'Can I book Profhilo?',
      sessionId: baseSession.sessionId,
      channel: 'web',
    });

    expect(result.response).toBe(
      '### Medical Screening Required\n\nProfhilo needs screening first.',
    );
    expect(result.response).not.toContain('🚫');
    expect(result.response).not.toContain('✅');
  });

  it('returns availability results for an in-scope message', async () => {
    const tomorrow = toIsoDate(new Date(Date.now() + 86400000));

    invokeMock
      .mockResolvedValueOnce(
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'search_availability',
              args: {
                service: 'Brow Threading',
                date: tomorrow,
              },
              id: 'call_avail',
              type: 'tool_call',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new AIMessage({
          content:
            'Here are the available times I found for Brow Threading tomorrow: 09:00, 10:00, 11:30, 13:00, 15:00, 17:30.',
        }),
      );

    const result = await runAgent({
      message: 'Can you check Brow Threading availability tomorrow?',
      sessionId: baseSession.sessionId,
      channel: 'web',
    });

    expect(result.toolCalls).toEqual([
      {
        name: 'search_availability',
        args: {
          service: 'Brow Threading',
          date: tomorrow,
        },
      },
    ]);
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.response.toLowerCase()).toContain('available');
  });

  it('returns a clear message when the LLM is not configured', async () => {
    isAgentLlmEnabledMock.mockReturnValue(false);

    const result = await runAgent({
      message: 'Hello',
      sessionId: baseSession.sessionId,
      channel: 'web',
    });

    expect(result.response).toContain('LLM is not configured');
    expect(result.toolCalls).toEqual([]);
    expect(createAgentLlmMock).not.toHaveBeenCalled();
  });
});
