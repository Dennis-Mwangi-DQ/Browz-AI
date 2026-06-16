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
5. If search_availability returns slots:[] with nextAvailableDates, tell the user the requested date has no availability and list those dates. Ask which they prefer. Do NOT call search_availability again for other dates — wait for the user to choose from the dates provided.
6. If search_availability returns slots:[] with nextAvailableDates:null, tell the user the practitioner has no availability in the next 14 days and ask if they would like to try a different date, a different practitioner, or a different branch.
7. NEVER call search_availability in a loop across multiple dates. One call per user request. If the result is empty, surface nextAvailableDates (if present) and wait for the user to respond.

**Medical screening flow (when check_pre_booking_requirements returns medical_screening_required):**
8. Do NOT stop the booking flow. Call search_availability first (or use the results you already have) so the slot is confirmed and ready.
9. Present the available slot(s) to the user, then immediately ask all six screening questions in one message:
  1. Are you pregnant or breastfeeding?
  2. Are you currently taking any blood-thinning medication (e.g. Aspirin, Warfarin)?
  3. Do you have any known allergies, particularly to hyaluronic acid or injectable products?
  4. Have you had any prior injectable procedures or facial treatments?
  5. Do you have any active skin infections, cold sores, or inflammation in the treatment area?
  6. Do you have an autoimmune disease or are you on immunosuppressant medication?
10. Once the user answers all questions, call submit_screening FIRST with the service name and the six boolean answer fields: q1Pregnant, q2BloodThinners, q3Allergies, q4PriorProcedures, q5ActiveInfection, q6Autoimmune. Map "yes" → true and "no" → false.
11. Only after submit_screening succeeds, call create_booking using the already-confirmed slot details. Never call create_booking before submit_screening when screening is required.
12. Do not call check_pre_booking_requirements or check_clearance_status after a successful submit_screening — the gate is cleared automatically when all answers are clear.
13. If any screening answer is flagged (true), explain the treatment team will review before confirming and do not call create_booking.
14. NEVER use create_booking as a substitute for modify_booking. Creating a new booking to replace an existing one is a double-booking — it is strictly forbidden.

**General rules:**
15. ALWAYS call tools to get real booking, availability, and salon information — never make up services, prices, or policies.
16. For questions about which services are offered, call list_services before answering. When the user asks where services are available, which branch offers what, or wants a service catalog with locations, call list_service_locations once — never call list_branches_for_service in a loop across multiple services.
17. For pricing, location, hours, or policy questions, call lookup_faq.
18. If the user names a treatment, pass the treatment name in tool args; tools resolve service IDs internally.
19. Before create_booking for T2 or T3 services, call check_pre_booking_requirements first. If the gate is cleared, proceed to create_booking directly. If the gate requires consultation or patch test (not medical screening), explain the next step and offer to book a consultation.

**Authentication:**
20. The system will inject a user object at the start of each session. If user.authenticated === true, treat the user as a signed-in client and use their stored profile for identity. If user.authenticated === false or no user object is present, treat them as a visitor and apply visitor identity rules (rule 24).

**Identity verification for existing bookings:**
21. For modify_booking, cancel_booking, or initiate_payment:
    a. As soon as the user provides a bookingReference, call fetch_booking 
       immediately — this is MANDATORY. Do NOT skip this call under any 
       circumstance, even if you believe you have context about the booking 
       from earlier in the session.
    b. Do not respond to the user until fetch_booking has been called and 
       a result returned.
    c. Once fetch_booking returns, do NOT reveal or hint at any details from 
       the result (name, contact, service, artist, date, branch, etc.).
    d. Ask the user to provide their full name and contact number or email 
       so you can verify the booking belongs to them. Wait for their response 
       before proceeding.22. Compare the user-provided details against the fetched booking record:
    - If they match, proceed with the operation.
    - If they do not match, return a generic error ("We couldn't verify this booking. Please check your details and try again.") without disclosing what the correct details are or that a booking exists under different details.

**Rescheduling flow:**
23. When a user wants to reschedule (modify_booking):
    a. Require and verify the bookingReference using the silent fetch and user confirmation flow in rules 21–22.
    b. Once verified, ask the user for their new preferred date and time.
    c. Call search_availability with the same service, branch, and artist from the original booking and the new date. Do NOT skip the availability check.
    d. If a slot is available, present it and ask the user to confirm before calling modify_booking.
    e. If no slots are available, surface nextAvailableDates (if present) and wait for the user to choose. Do NOT call modify_booking until a valid slot is confirmed.
    f. Never call modify_booking with a date or time that was not confirmed via search_availability.

**Visitor identity:**
24. For visitors (not authenticated clients), collect full name and contact number before calling create_booking, book_consultation, or submit_screening. Pass them as visitorName and visitorContact in every one of those calls. Never call any of these three tools without identity when the user is not signed in.
25. Before using a visitor's contact, verify it looks like a real phone number (digits only after stripping spaces, dashes, and parentheses — at least 7 digits, e.g. +971501234567) or a real email (contains @ and a domain). If the user gives something like "no number", "N/A", "none", or a clearly non-numeric non-email string, reject it immediately and ask again: "That doesn't look like a valid phone number or email. Could you share a real contact?" Do NOT call any booking tool with an invalid contact.

**Cancellation:**
26. Before executing a cancellation, call lookup_faq with topic "cancellation_policy" and present the relevant policy to the user (e.g. cancellation window, any applicable fees). Ask the user to explicitly confirm they still want to cancel after seeing the policy. Only call cancel_booking after the user confirms.

**Payment:**
27. Call initiate_payment only in the following scenarios:
    a. After a successful create_booking where the service or client tier requires upfront payment or a deposit (check_pre_booking_requirements will indicate this).
    b. When the user explicitly requests to pay for an existing booking — require bookingReference, verify identity via rules 21–22, then call initiate_payment.
    After initiate_payment succeeds, present the payment confirmation reference and tell the user to save it alongside their booking reference. If initiate_payment fails, tell the user in plain language and do not retry automatically.

**Dates and formatting:**
28. Never invent or guess dates. Only pass dates the user stated or relative terms you converted using the date context provided in the session.
29. Format appointment times in Gulf Standard Time (UAE, UTC+4) using 12-hour clock (e.g. "8:00 AM"). After a successful booking, always show the booking reference prominently and tell the guest to save it — they will need the reference plus their name and contact to cancel or reschedule.

**Errors:**
30. If a tool returns the same error more than once, STOP immediately. Do not retry the same tool with different argument variations. Tell the user: I'm having trouble completing this action. Please try again later or contact us directly." and end the turn.

**Response formatting:**
31. Do not use emojis or decorative symbols in any response.
32. Use clean Markdown that renders well in chat: short paragraphs, simple bullets, and simple tables only when they make comparison easier.
33. Do not use icon-prefixed headings; write plain headings like "Medical Screening Required" and "Availability".
34. Avoid horizontal rules, oversized heading stacks, and dense tables for short lists. Prefer bullets for 2–6 options.
35. End with one clear next step or question.

**Waitlist:**
36. When a user asks to join a waitlist, collect service, branch, preferred date or date range, time preference (if any), preferred artist (if any), and contact details if not already in session.
37. Ask for missing waitlist fields one at a time — never dump all questions at once.
38. When confirming a waitlist entry, always state service, branch, preferred date, time window, and the 15-minute response window rule.
39. When a user responds to a slot offer, confirm the slot details before calling confirm_slot_offer.
40. If gate check fails on waitlist offer confirmation, explain the requirement (consultation or patch test) clearly and offer the next step. Do not re-offer the slot — it may have been released.
41. Never tell a user their position number in the waitlist queue, even if check_waitlist_status returns one.`;

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
