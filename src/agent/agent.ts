import {
  AIMessage,
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
import type { PendingSlotOffer, SessionContext } from '../types';

const SYSTEM_PROMPT = `You are a Browz booking concierge assistant for a beauty salon in the UAE.

Your job is to help users book appointments, check availability, and answer salon questions by calling the available tools to fetch real data. Follow these rules:

**Booking sequence — always follow this order:**
1. When a user wants to book a service, call list_branches_for_service to show which branches offer it. Ask the user to pick one.
2. Once a branch is chosen, call list_artists_for_service_at_branch to show the practitioners available at that branch. Ask the user to select one.
3. Once an artist is chosen, ask the user for their preferred date and time. Then call search_availability with the service, branch, artist, and date to confirm the artist's availability.
4. If the artist is available at the requested time, call create_booking with service, branch, artist, date, and time to confirm.
5. If the artist is unavailable (tool returns nextAvailableTimes), present those alternative times to the user and ask if they'd like one of them instead.

**General rules:**
6. ALWAYS call tools to get real booking, availability, and salon information — never make up services, prices, or policies.
7. For questions about which services are offered, call list_services before answering. For pricing, location, hours, or policy, call lookup_faq.
8. If the user names a treatment, pass the treatment name in tool args; tools resolve service IDs internally.
9. Before create_booking for T2 or T3 services, call check_pre_booking_requirements first.
10. For modify_booking, cancel_booking, or initiate_payment, require a bookingReference from the user.
11. Format times clearly (e.g. "2:00 PM") and include booking references in final answers when available.
12. If gates block a booking, explain the next step (consultation, patch test, or medical screening).
13. Never invent or guess dates. Only pass dates the user stated or relative terms you converted using the date context below.
14. For visitors (not authenticated clients), collect full name and contact number before create_booking and pass them as visitorName and visitorContact.
15. Provide concise, helpful answers using the data returned from tools only.

**Waitlist & recovery:**
16. When search_availability returns no slots, offer to add the user to the waitlist via add_to_waitlist.
17. Collect visitor name and contact before add_to_waitlist for unauthenticated users.
18. When a user has an active waitlist offer, guide them to confirm_slot_offer or decline_slot_offer.
19. Before confirm_slot_offer for T2/T3 services, call check_pre_booking_requirements first.
20. Walk-in slots (open_for_walkin) can be booked via the normal create_booking flow.`;

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
        'LLM is not configured. Set LLM_PROVIDER and the required credentials (e.g. OLLAMA_API_URL for local Ollama) and try again.',
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
      const responseText = extractResponseText(response.content);

      await appendTurn(activeSession.sessionId, {
        role: 'user',
        content: params.message,
        timestamp: new Date().toISOString(),
      });
      await appendTurn(activeSession.sessionId, {
        role: 'agent',
        content: responseText,
        timestamp: new Date().toISOString(),
      });

      const nextSnapshot = learnFromToolCalls(
        getContextSnapshot(activeSession),
        executedToolCalls,
        executedToolResults,
      );
      await updateSession(activeSession.sessionId, {
        agentContext: nextSnapshot,
        ...(nextSnapshot.lastBookingRef
          ? { lastBookingRef: nextSnapshot.lastBookingRef }
          : {}),
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

  await appendTurn(activeSession.sessionId, {
    role: 'user',
    content: params.message,
    timestamp: new Date().toISOString(),
  });
  await appendTurn(activeSession.sessionId, {
    role: 'agent',
    content: fallback,
    timestamp: new Date().toISOString(),
  });

  const nextSnapshot = learnFromToolCalls(
    getContextSnapshot(activeSession),
    executedToolCalls,
    executedToolResults,
  );
  await updateSession(activeSession.sessionId, {
    agentContext: nextSnapshot,
    ...(nextSnapshot.lastBookingRef
      ? { lastBookingRef: nextSnapshot.lastBookingRef }
      : {}),
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
