import { logTurn } from '../logger';
import type { IntentId, SessionContext } from '../types';

const TOOL_TO_INTENT: Record<string, IntentId> = {
  search_availability: 'check_availability',
  list_service_locations: 'check_availability',
  list_branches_for_service: 'check_availability',
  list_artists_for_service_at_branch: 'check_availability',
  add_to_waitlist: 'check_availability',
  check_waitlist_status: 'check_availability',
  create_booking: 'create_booking',
  confirm_slot_offer: 'create_booking',
  modify_booking: 'modify_booking',
  cancel_booking: 'cancel_booking',
  fetch_booking: 'confirm_appointment',
  confirm_appointment: 'confirm_appointment',
  add_notes: 'add_notes',
  initiate_payment: 'initiate_payment',
  lookup_faq: 'faq_general',
  list_services: 'faq_general',
  escalate_human: 'escalate_human',
  book_consultation: 'book_consultation',
  fetch_consultation: 'book_consultation',
  cancel_consultation: 'book_consultation',
  modify_consultation: 'book_consultation',
  check_clearance_status: 'check_clearance_status',
  check_pre_booking_requirements: 'check_clearance_status',
  submit_screening: 'check_clearance_status',
  check_frequency: 'check_frequency',
  resolve_deposit_rule: 'query_deposit_policy',
};

export function inferIntentFromToolCalls(toolCalls: { name: string }[]): IntentId {
  for (const tc of toolCalls) {
    const intent = TOOL_TO_INTENT[tc.name];
    if (intent) {
      return intent;
    }
  }
  return 'greeting_smalltalk';
}

export function extractEntitiesFromToolCalls(
  toolCalls: { name: string; args: Record<string, unknown> }[],
): Record<string, unknown> {
  const entities: Record<string, unknown> = {};

  for (const tc of toolCalls) {
    const args = tc.args ?? {};
    for (const key of ['service', 'branch', 'date', 'time', 'artistName', 'bookingReference', 'notes'] as const) {
      if (typeof args[key] === 'string' && args[key]) {
        entities[key] = args[key];
      }
    }
    if (typeof args.paymentRequested === 'boolean') {
      entities.paymentRequested = args.paymentRequested;
    }
  }

  return entities;
}

function normalizeToolResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { value: result };
}

function summarizeToolResult(
  toolCalls: { name: string }[],
  toolResults: { name: string; result: unknown }[],
): Record<string, unknown> {
  if (toolResults.length <= 1) {
    return normalizeToolResult(toolResults[0]?.result);
  }

  return {
    primaryTool: toolCalls[0]?.name ?? '',
    tools: toolResults.map((tr) => ({
      name: tr.name,
      result: normalizeToolResult(tr.result),
    })),
  };
}

export function logAgentTurn(params: {
  session: SessionContext;
  turn: number;
  userMessage: string;
  responseText: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  toolResults: { name: string; result: unknown }[];
  startedAt: number;
  escalated?: boolean;
}): void {
  const intent = inferIntentFromToolCalls(params.toolCalls);

  void logTurn({
    sessionId: params.session.sessionId,
    turn: params.turn,
    channel: params.session.channel,
    userMessage: params.userMessage,
    intent,
    confidence: params.toolCalls.length > 0 ? 0.95 : 0.7,
    entitiesExtracted: extractEntitiesFromToolCalls(params.toolCalls),
    toolCalled: params.toolCalls[0]?.name ?? '',
    toolResult: summarizeToolResult(params.toolCalls, params.toolResults),
    agentResponse: params.responseText,
    latencyMs: Date.now() - params.startedAt,
    escalated: params.escalated ?? false,
  });
}
