import { Buffer } from 'buffer';
import { supabase } from '../db/supabaseClient';
import { generateSessionId } from '../lib/ids';
import { normalizePhoneNumber } from '../lib/phone';
import type { AgentContextSnapshot, ConversationTurn, SessionContext } from '../types';

const sessionStore = new Map<string, SessionContext>();

function nowIso(): string {
  return new Date().toISOString();
}

function toSessionContext(row: Record<string, unknown>): SessionContext {
  return {
    sessionId: String(row.id),
    channel: (row.channel as SessionContext['channel']) ?? 'web',
    userTier: (row.user_tier as SessionContext['userTier']) ?? 'visitor',
    clientId: row.client_id ? String(row.client_id) : null,
    whatsappNumber: row.whatsapp_number ? String(row.whatsapp_number) : null,
    conversationHistory: Array.isArray(row.conversation_history) ? (row.conversation_history as ConversationTurn[]) : [],
    lastIntent: (row.last_intent as SessionContext['lastIntent']) ?? null,
    lastBookingRef: row.last_booking_ref ? String(row.last_booking_ref) : null,
    agentContext: (row.agent_context as AgentContextSnapshot | undefined) ?? undefined,
    status: (row.status as SessionContext['status']) ?? 'active',
    clarificationCount: 0,
    screeningState: row.screening_state as SessionContext['screeningState'],
    createdAt: String(row.created_at ?? nowIso()),
    updatedAt: String(row.updated_at ?? nowIso()),
  };
}

function toDbSession(session: SessionContext): Record<string, unknown> {
  return {
    id: session.sessionId,
    channel: session.channel,
    user_tier: session.userTier,
    client_id: session.clientId,
    whatsapp_number: session.whatsappNumber,
    conversation_history: session.conversationHistory,
    last_intent: session.lastIntent,
    last_booking_ref: session.lastBookingRef,
    agent_context: session.agentContext ?? null,
    status: session.status,
    screening_state: session.screeningState ?? null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}

function createSession(channel: SessionContext['channel'], sessionId?: string, clientId?: string | null, whatsappNumber?: string | null): SessionContext {
  const timestamp = nowIso();

  return {
    sessionId: sessionId ?? generateSessionId(),
    channel,
    userTier: 'visitor',
    clientId: clientId ?? null,
    whatsappNumber: whatsappNumber ?? null,
    conversationHistory: [],
    lastIntent: null,
    lastBookingRef: null,
    status: 'active',
    clarificationCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function decodeJwtSubject(authToken?: string): string | null {
  if (!authToken) {
    return null;
  }

  const parts = authToken.split('.');
  if (parts.length < 2 || !parts[1]) {
    return authToken;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export async function getOrCreateSession(
  sessionId: string | undefined,
  channel: SessionContext['channel'],
  clientId?: string | null,
  whatsappNumber?: string | null,
): Promise<SessionContext> {
  const resolvedId = sessionId ?? generateSessionId(whatsappNumber ?? undefined);
  const existing = sessionStore.get(resolvedId);
  if (existing) {
    return existing;
  }

  if (supabase) {
    const { data, error } = await supabase.from('sessions').select('*').eq('id', resolvedId).maybeSingle();
    if (!error && data) {
      const session = toSessionContext(data);
      sessionStore.set(session.sessionId, session);
      return session;
    }
  }

  const session = createSession(channel, resolvedId, clientId, whatsappNumber);
  sessionStore.set(session.sessionId, session);

  if (supabase) {
    void supabase.from('sessions').upsert(toDbSession(session));
  }

  return session;
}

export async function updateSession(sessionId: string, updates: Partial<SessionContext>): Promise<SessionContext | null> {
  const existing = sessionStore.get(sessionId);
  if (!existing) {
    return null;
  }

  const next: SessionContext = {
    ...existing,
    ...updates,
    updatedAt: nowIso(),
  };

  sessionStore.set(sessionId, next);

  if (supabase) {
    void supabase.from('sessions').upsert(toDbSession(next));
  }

  return next;
}

export async function appendTurn(sessionId: string, turn: ConversationTurn): Promise<void> {
  const session = sessionStore.get(sessionId);
  if (!session) {
    return;
  }

  await updateSession(sessionId, {
    conversationHistory: [...session.conversationHistory, turn],
  });
}

export async function resolveUserIdentity(authToken?: string, whatsappNumber?: string): Promise<{
  userTier: SessionContext['userTier'];
  clientId: string | null;
}> {
  if (!supabase) {
    return { userTier: 'visitor', clientId: null };
  }

  const authSubject = decodeJwtSubject(authToken);
  if (authSubject) {
    const { data } = await supabase
      .from('clients')
      .select('id, auth_user_id')
      .or(`auth_user_id.eq.${authSubject},id.eq.${authSubject}`)
      .limit(1)
      .maybeSingle();

    if (data?.id) {
      return { userTier: 'client', clientId: String(data.id) };
    }
  }

  if (whatsappNumber) {
    const normalizedPhone = normalizePhoneNumber(whatsappNumber);
    const candidates = [whatsappNumber, normalizedPhone].filter(
      (value): value is string => Boolean(value),
    );
    const { data } = await supabase.from('clients').select('id').in('phone', candidates).limit(1).maybeSingle();
    if (data?.id) {
      return { userTier: 'client', clientId: String(data.id) };
    }
  }

  return { userTier: 'visitor', clientId: null };
}

export async function resolveUserTier(authToken?: string, whatsappNumber?: string): Promise<SessionContext['userTier']> {
  const result = await resolveUserIdentity(authToken, whatsappNumber);
  return result.userTier;
}
