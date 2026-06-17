import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import {
  formatContextForPrompt,
  getContextSnapshot,
  learnFromToolCalls,
} from './agent-session';
import { createSessionTools } from './tools';
import { getEnv } from '../lib/env';
import { createAgentLlm, isAgentLlmEnabled } from '../lib/llmClient';
import { addDays, startOfTodayUtc, toIsoDate } from '../lib/dates';
import { getPendingOffer } from '../lib/pendingOffers';
import { appendTurn, getOrCreateSession, resolveUserIdentity, updateSession } from '../memory/sessionManager';
import { inferIntentFromToolCalls, logAgentTurn } from './turnLogging';
import { escalate } from '../escalation/escalationHandler';
import { getClientNoShowFlag, handleReconfirmationReply } from '../tools/noShow';
import type { PendingSlotOffer, SessionContext } from '../types';
import { SYSTEM_PROMPT } from '../prompts/systemPrompt';

function buildDateContext(): string {
  const today = startOfTodayUtc();
  return `## Date context
Today: ${toIsoDate(today)}
Tomorrow: ${toIsoDate(addDays(today, 1))}`;
}

function buildSystemContent(session: SessionContext): string {
  const snapshot = getContextSnapshot(session);
  const seeded: typeof snapshot = {
    ...snapshot,
    lastBookingRef: snapshot.lastBookingRef ?? session.lastBookingRef ?? undefined,
  };
  const sessionContext = formatContextForPrompt(seeded);

  const dateContext = buildDateContext();

  if (!sessionContext) {
    return `${SYSTEM_PROMPT}\n\n${dateContext}`;
  }

  return `${SYSTEM_PROMPT}

${dateContext}

## Active session context
${sessionContext}

Use this context for follow-up questions (e.g. "this", "that slot", "book it") without asking the user to repeat themselves unless something is ambiguous.`;
}

function buildConversationMessages(
  session: SessionContext,
  userMessage: string,
): Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> {
  const messages: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage> = [
    new SystemMessage(buildSystemContent(session)),
  ];

  for (const turn of session.conversationHistory.slice(-8)) {
    messages.push(
      turn.role === 'agent'
        ? new AIMessage(turn.content)
        : new HumanMessage(turn.content),
    );
  }

  messages.push(new HumanMessage(userMessage));
  return messages;
}

function extractResponseText(content: AIMessage['content']): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: string }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return JSON.stringify(content);
}

function sanitizeAssistantResponse(text: string): string {
  return text
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]\u{FE0F}?/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const TOOL_STATUS_MESSAGES: Record<string, string> = {
  search_availability: 'Checking availability…',
  list_services: 'Looking up services…',
  list_service_locations: 'Finding service locations…',
  list_branches_for_service: 'Finding branches…',
  list_artists_for_service_at_branch: 'Finding specialists…',
  create_booking: 'Creating your booking…',
  modify_booking: 'Updating your booking…',
  cancel_booking: 'Cancelling your booking…',
  fetch_booking: 'Looking up your booking…',
  lookup_faq: 'Checking salon information…',
  check_pre_booking_requirements: 'Checking booking requirements…',
  submit_screening: 'Saving screening answers…',
  book_consultation: 'Booking your consultation…',
  initiate_payment: 'Starting payment…',
};

function toolStatusMessage(toolName: string): string {
  return TOOL_STATUS_MESSAGES[toolName] ?? 'Working on your request…';
}

export type AgentRunParams = {
  message: string;
  sessionId?: string;
  channel: 'web' | 'whatsapp';
  authToken?: string;
  whatsappNumber?: string;
  clientId?: string;
  visitorName?: string;
  visitorContact?: string;
};

export type AgentRunResult = {
  response: string;
  sessionId: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  toolResults: { name: string; result: unknown }[];
};

export type AgentStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'token'; text: string }
  | { type: 'done'; result: AgentRunResult };

type LlmWithTools = {
  invoke: (
    input: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage>,
  ) => Promise<AIMessage>;
  stream?: (
    input: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage>,
  ) => Promise<AsyncIterable<AIMessageChunk>>;
};

async function invokeLlmTurn(
  llmWithTools: LlmWithTools,
  messages: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage>,
  onToken?: (text: string) => void,
): Promise<AIMessage> {
  if (!onToken || !llmWithTools.stream) {
    return llmWithTools.invoke(messages);
  }

  const stream = await llmWithTools.stream(messages);
  let gathered: AIMessageChunk | undefined;

  for await (const chunk of stream) {
    gathered = gathered ? gathered.concat(chunk) : chunk;
    if (!gathered.tool_calls?.length) {
      const delta = extractResponseText(chunk.content);
      if (delta) onToken(delta);
    }
  }

  if (!gathered) {
    return new AIMessage({ content: '' });
  }

  return new AIMessage({
    content: gathered.content,
    tool_calls: gathered.tool_calls,
  });
}

async function finalizeAgentTurn(params: {
  sessionId: string;
  userMessage: string;
  responseText: string;
  activeSession: SessionContext;
  executedToolCalls: { name: string; args: Record<string, unknown> }[];
  executedToolResults?: { name: string; result: unknown }[];
  startedAt: number;
  escalated?: boolean;
}): Promise<void> {
  const turnNumber = Math.floor(params.activeSession.conversationHistory.length / 2) + 1;
  const inferredIntent = inferIntentFromToolCalls(params.executedToolCalls);

  await appendTurn(params.sessionId, {
    role: 'user',
    content: params.userMessage,
    intent: inferredIntent,
    timestamp: new Date().toISOString(),
  });
  await appendTurn(params.sessionId, {
    role: 'agent',
    content: params.responseText,
    timestamp: new Date().toISOString(),
  });

  const nextSnapshot = learnFromToolCalls(
    getContextSnapshot(params.activeSession),
    params.executedToolCalls,
    params.executedToolResults,
  );
  await updateSession(params.sessionId, {
    agentContext: nextSnapshot,
    lastIntent: inferredIntent,
    ...(nextSnapshot.lastBookingRef ? { lastBookingRef: nextSnapshot.lastBookingRef } : {}),
    ...(params.escalated ? { status: 'escalated' as const } : {}),
  });

  logAgentTurn({
    session: params.activeSession,
    turn: turnNumber,
    userMessage: params.userMessage,
    responseText: params.responseText,
    toolCalls: params.executedToolCalls,
    toolResults: params.executedToolResults ?? [],
    startedAt: params.startedAt,
    escalated: params.escalated,
  });
}

export async function runAgent(params: {
  message: string;
  sessionId?: string;
  channel: 'web' | 'whatsapp';
  authToken?: string;
  whatsappNumber?: string;
  clientId?: string;
  visitorName?: string;
  visitorContact?: string;
}): Promise<{
  response: string;
  sessionId: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  toolResults: { name: string; result: unknown }[];
  pendingOffer?: PendingSlotOffer | null;
}> {
  if (!isAgentLlmEnabled()) {
    return {
      response:
        'LLM is not configured. Set LLM_PROVIDER and the required credentials for that provider, then try again.',
      sessionId: params.sessionId ?? 'unknown',
      toolCalls: [],
      toolResults: [],
    };
  }

  const identity = await resolveUserIdentity(params.authToken, params.whatsappNumber);
  const resolvedClientId = params.clientId ?? identity.clientId;
  const session = await getOrCreateSession(
    params.sessionId,
    params.channel,
    resolvedClientId,
    params.whatsappNumber ?? null,
  );
  const priorContext = getContextSnapshot(session);
  const nextContext = {
    ...priorContext,
    ...(params.visitorName?.trim() ? { visitorName: params.visitorName.trim() } : {}),
    ...(params.visitorContact?.trim()
      ? { visitorContact: params.visitorContact.trim() }
      : {}),
  };
  const enrichedSession = await updateSession(session.sessionId, {
    clientId: resolvedClientId,
    userTier: resolvedClientId ? 'client' : identity.userTier,
    whatsappNumber: params.whatsappNumber ?? session.whatsappNumber,
    agentContext: nextContext,
  });

  const activeSession = enrichedSession ?? session;
  const startedAt = Date.now();

  const reconfirmation = await handleReconfirmationReply({
    message: params.message,
    session: activeSession,
  });
  if (reconfirmation.handled && reconfirmation.response) {
    await finalizeAgentTurn({
      sessionId: activeSession.sessionId,
      userMessage: params.message,
      responseText: reconfirmation.response,
      activeSession,
      executedToolCalls: [],
      startedAt,
    });

    return {
      response: reconfirmation.response,
      sessionId: activeSession.sessionId,
      toolCalls: [],
      toolResults: [],
    };
  }

  const lowerMessage = params.message.toLowerCase();
  const trimmedMessage = params.message.trim().toLowerCase();
  const asksWhyFullPayment =
    lowerMessage.includes('why') &&
    (lowerMessage.includes('full payment') ||
      lowerMessage.includes('full upfront') ||
      lowerMessage.includes('pay upfront'));
  const lastAgentTurn = [...activeSession.conversationHistory]
    .reverse()
    .find((turn) => turn.role === 'agent');
  const offeredReception = lastAgentTurn?.content.includes('connect you with reception');
  const acceptsReception =
    offeredReception &&
    /^(yes|yeah|yep|please|ok|okay|sure|connect me|speak to reception)\b/.test(trimmedMessage);
  const requestsHuman =
    /\b(speak to (a |someone|reception)|talk to (a |someone|reception)|connect me|human|reception)\b/.test(
      lowerMessage,
    );

  if (activeSession.clientId && (asksWhyFullPayment || acceptsReception || requestsHuman)) {
    const flag = await getClientNoShowFlag(activeSession.clientId);
    if (flag?.status === 'active') {
      if (acceptsReception || (requestsHuman && !asksWhyFullPayment)) {
        await escalate({
          sessionId: activeSession.sessionId,
          reason: 'user_requested',
          channel: activeSession.channel,
          lastMessage: params.message,
        });
        const response =
          'I have connected you with reception. A team member will follow up with you shortly.';
        await finalizeAgentTurn({
          sessionId: activeSession.sessionId,
          userMessage: params.message,
          responseText: response,
          activeSession,
          executedToolCalls: [{ name: 'escalate_human', args: { reason: 'user_requested' } }],
          executedToolResults: [
            { name: 'escalate_human', result: { success: true, data: { escalated: true } } },
          ],
          startedAt,
          escalated: true,
        });

        return {
          response,
          sessionId: activeSession.sessionId,
          toolCalls: [{ name: 'escalate_human', args: { reason: 'user_requested' } }],
          toolResults: [{ name: 'escalate_human', result: { success: true, data: { escalated: true } } }],
        };
      }

      if (asksWhyFullPayment) {
        const response =
          'Full upfront payment is currently required for your account. If you have questions about this, our team can help - would you like me to connect you with reception?';
        await finalizeAgentTurn({
          sessionId: activeSession.sessionId,
          userMessage: params.message,
          responseText: response,
          activeSession,
          executedToolCalls: [],
          startedAt,
        });

        return {
          response,
          sessionId: activeSession.sessionId,
          toolCalls: [],
          toolResults: [],
        };
      }
    }
  }

  if (!isAgentLlmEnabled()) {
    return {
      response:
        'LLM is not configured. Set LLM_PROVIDER and the required credentials (e.g. OLLAMA_API_URL for local Ollama) and try again.',
      sessionId: activeSession.sessionId,
      toolCalls: [],
      toolResults: [],
    };
  }

  const { allTools, toolImplementations } = createSessionTools(activeSession);
  const llm = createAgentLlm();
  if (!llm.bindTools) {
    throw new Error('Configured LLM does not support tool calling.');
  }
  const llmWithTools = llm.bindTools(allTools);
  const messages = buildConversationMessages(activeSession, params.message);
  const executedToolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const executedToolResults: { name: string; result: unknown }[] = [];
  const maxIterations = getEnv().AGENT_MAX_TOOL_ITERATIONS;

  for (let i = 0; i < maxIterations; i += 1) {
    const response = await llmWithTools.invoke(messages);
    messages.push(response);

    const toolCalls = response.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const responseText = sanitizeAssistantResponse(extractResponseText(response.content));

      await finalizeAgentTurn({
        sessionId: activeSession.sessionId,
        userMessage: params.message,
        responseText,
        activeSession,
        executedToolCalls,
        executedToolResults,
        startedAt,
      });

      const snapshot = getContextSnapshot(activeSession);
      const pendingOffer = getPendingOffer({
        contact: params.visitorContact ?? snapshot.visitorContact ?? params.whatsappNumber,
        clientId: resolvedClientId,
      });

      return {
        response: responseText,
        sessionId: activeSession.sessionId,
        toolCalls: executedToolCalls,
        toolResults: executedToolResults,
        pendingOffer,
      };
    }

    for (const tc of toolCalls) {
      executedToolCalls.push({
        name: tc.name,
        args: tc.args as Record<string, unknown>,
      });

      try {
        const impl = toolImplementations[tc.name];
        if (!impl) {
          const errResult = { error: `Unknown tool: ${tc.name}` };
          executedToolResults.push({ name: tc.name, result: errResult });
          messages.push(
            new ToolMessage({
              content: JSON.stringify(errResult),
              tool_call_id: tc.id ?? '',
            }),
          );
          continue;
        }

        const result = await impl(tc.args as Record<string, unknown>);
        executedToolResults.push({ name: tc.name, result });
        messages.push(
          new ToolMessage({
            content: typeof result === 'string' ? result : JSON.stringify(result),
            tool_call_id: tc.id ?? '',
          }),
        );
      } catch (err) {
        const errResult = { error: err instanceof Error ? err.message : 'Unknown error' };
        executedToolResults.push({ name: tc.name, result: errResult });
        messages.push(
          new ToolMessage({
            content: JSON.stringify(errResult),
            tool_call_id: tc.id ?? '',
          }),
        );
      }
    }
  }

  const fallback =
    "I've reached the maximum number of tool calls while trying to answer your question. Please try rephrasing or asking a more specific question.";

  await finalizeAgentTurn({
    sessionId: activeSession.sessionId,
    userMessage: params.message,
    responseText: fallback,
    activeSession,
    executedToolCalls,
    executedToolResults,
    startedAt,
  });

  const snapshot = getContextSnapshot(activeSession);
  const pendingOffer = getPendingOffer({
    contact: params.visitorContact ?? snapshot.visitorContact ?? params.whatsappNumber,
    clientId: resolvedClientId,
  });

  return {
    response: fallback,
    sessionId: activeSession.sessionId,
    toolCalls: executedToolCalls,
    toolResults: executedToolResults,
    pendingOffer,
  };
}

export async function runAgentStream(
  params: AgentRunParams,
  emit: (event: AgentStreamEvent) => void,
): Promise<AgentRunResult> {
  if (!isAgentLlmEnabled()) {
    const result: AgentRunResult = {
      response:
        'LLM is not configured. Set LLM_PROVIDER and the required credentials for that provider, then try again.',
      sessionId: params.sessionId ?? 'unknown',
      toolCalls: [],
      toolResults: [],
    };
    emit({ type: 'token', text: result.response });
    emit({ type: 'done', result });
    return result;
  }

  const identity = await resolveUserIdentity(params.authToken, params.whatsappNumber);
  const resolvedClientId = params.clientId ?? identity.clientId;
  const session = await getOrCreateSession(
    params.sessionId,
    params.channel,
    resolvedClientId,
    params.whatsappNumber ?? null,
  );
  const priorContext = getContextSnapshot(session);
  const nextContext = {
    ...priorContext,
    ...(params.visitorName?.trim() ? { visitorName: params.visitorName.trim() } : {}),
    ...(params.visitorContact?.trim()
      ? { visitorContact: params.visitorContact.trim() }
      : {}),
  };
  const enrichedSession = await updateSession(session.sessionId, {
    clientId: resolvedClientId,
    userTier: resolvedClientId ? 'client' : identity.userTier,
    whatsappNumber: params.whatsappNumber ?? session.whatsappNumber,
    agentContext: nextContext,
  });

  const activeSession = enrichedSession ?? session;
  const startedAt = Date.now();
  const { allTools, toolImplementations } = createSessionTools(activeSession);
  const llm = createAgentLlm();
  if (!llm.bindTools) {
    throw new Error('Configured LLM does not support tool calling.');
  }
  const llmWithTools = llm.bindTools(allTools) as LlmWithTools;
  const messages = buildConversationMessages(activeSession, params.message);
  const executedToolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const executedToolResults: { name: string; result: unknown }[] = [];
  const maxIterations = getEnv().AGENT_MAX_TOOL_ITERATIONS;

  for (let i = 0; i < maxIterations; i += 1) {
    const response = await invokeLlmTurn(llmWithTools, messages, (text) => {
      emit({ type: 'token', text });
    });
    messages.push(response);

    const toolCalls = response.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      const responseText = sanitizeAssistantResponse(extractResponseText(response.content));

      await finalizeAgentTurn({
        sessionId: activeSession.sessionId,
        userMessage: params.message,
        responseText,
        activeSession,
        executedToolCalls,
        executedToolResults,
        startedAt,
      });

      const result: AgentRunResult = {
        response: responseText,
        sessionId: activeSession.sessionId,
        toolCalls: executedToolCalls,
        toolResults: executedToolResults,
      };
      emit({ type: 'done', result });
      return result;
    }

    for (const tc of toolCalls) {
      emit({ type: 'status', message: toolStatusMessage(tc.name) });
      executedToolCalls.push({
        name: tc.name,
        args: tc.args as Record<string, unknown>,
      });

      try {
        const impl = toolImplementations[tc.name];
        if (!impl) {
          const errResult = { error: `Unknown tool: ${tc.name}` };
          executedToolResults.push({ name: tc.name, result: errResult });
          messages.push(
            new ToolMessage({
              content: JSON.stringify(errResult),
              tool_call_id: tc.id ?? '',
            }),
          );
          continue;
        }

        const result = await impl(tc.args as Record<string, unknown>);
        executedToolResults.push({ name: tc.name, result });
        messages.push(
          new ToolMessage({
            content: typeof result === 'string' ? result : JSON.stringify(result),
            tool_call_id: tc.id ?? '',
          }),
        );
      } catch (err) {
        const errResult = { error: err instanceof Error ? err.message : 'Unknown error' };
        executedToolResults.push({ name: tc.name, result: errResult });
        messages.push(
          new ToolMessage({
            content: JSON.stringify(errResult),
            tool_call_id: tc.id ?? '',
          }),
        );
      }
    }
  }

  const fallback =
    "I've reached the maximum number of tool calls while trying to answer your question. Please try rephrasing or asking a more specific question.";

  emit({ type: 'token', text: fallback });

  await finalizeAgentTurn({
    sessionId: activeSession.sessionId,
    userMessage: params.message,
    responseText: fallback,
    activeSession,
    executedToolCalls,
    executedToolResults,
    startedAt,
  });

  const result: AgentRunResult = {
    response: fallback,
    sessionId: activeSession.sessionId,
    toolCalls: executedToolCalls,
    toolResults: executedToolResults,
  };
  emit({ type: 'done', result });
  return result;
}
