import { Buffer } from 'buffer';
import { supabase } from '../db/supabaseClient';
import { generateSessionId } from '../lib/ids';
import { normalizePhoneNumber } from '../lib/phone';
import type { AgentContextSnapshot, ConversationTurn, SessionContext } from '../types';

const sessionStore = new Map<string, SessionContext>();

function nowIso(): string {
  return new Date().toISOString();
}

async function persistSession(session: SessionContext): Promise<void> {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.from('sessions').upsert(toDbSession(session));
  if (error) {
    console.error('[sessionManager] Failed to persist session', {
      sessionId: session.sessionId,
      error: error.message,
    });
  }
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

function createSession(
  channel: SessionContext['channel'],
  sessionId?: string,
  clientId?: string | null,
  whatsappNumber?: string | null,
): SessionContext {
  const timestamp = nowIso();

  return {
    sessionId: sessionId ?? generateSessionId(),
    channel,
    userTier: clientId ? 'client' : 'visitor',
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

async function loadSessionById(sessionId: string): Promise<SessionContext | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle();
  if (error || !data) {
    return null;
  }

  return toSessionContext(data);
}

export async function getSessionById(sessionId: string): Promise<SessionContext | null> {
  const cached = sessionStore.get(sessionId);
  if (cached) {
    return cached;
  }

  const persisted = await loadSessionById(sessionId);
  if (persisted) {
    sessionStore.set(persisted.sessionId, persisted);
  }
  return persisted;
}

export async function getLatestActiveSession(
  channel: SessionContext['channel'],
  clientId: string,
): Promise<SessionContext | null> {
  const persisted = await loadLatestSessionByClient(channel, clientId);
  if (persisted) {
    sessionStore.set(persisted.sessionId, persisted);
  }
  return persisted;
}

async function loadLatestSessionByWhatsApp(
  channel: SessionContext['channel'],
  whatsappNumber?: string | null,
): Promise<SessionContext | null> {
  if (!supabase || !whatsappNumber) {
    return null;
  }

  const normalizedPhone = normalizePhoneNumber(whatsappNumber);
  const candidates = [...new Set([whatsappNumber, normalizedPhone].filter((value): value is string => Boolean(value)))];
  if (candidates.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('channel', channel)
    .eq('status', 'active')
    .in('whatsapp_number', candidates)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error || !data?.[0]) {
    return null;
  }

  return toSessionContext(data[0]);
}

async function loadLatestSessionByClient(
  channel: SessionContext['channel'],
  clientId?: string | null,
): Promise<SessionContext | null> {
  if (!supabase || !clientId) {
    return null;
  }

  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('channel', channel)
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error || !data?.[0]) {
    return null;
  }

  return toSessionContext(data[0]);
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

  const persistedById = await loadSessionById(resolvedId);
  if (persistedById) {
    sessionStore.set(persistedById.sessionId, persistedById);
    return persistedById;
  }

  if (!sessionId) {
    const persistedByWhatsApp = await loadLatestSessionByWhatsApp(channel, whatsappNumber);
    if (persistedByWhatsApp) {
      sessionStore.set(persistedByWhatsApp.sessionId, persistedByWhatsApp);
      return persistedByWhatsApp;
    }

    const persistedByClient = await loadLatestSessionByClient(channel, clientId);
    if (persistedByClient) {
      sessionStore.set(persistedByClient.sessionId, persistedByClient);
      return persistedByClient;
    }
  }

  const session = createSession(channel, resolvedId, clientId, whatsappNumber);
  sessionStore.set(session.sessionId, session);
  await persistSession(session);

  return session;
}

export async function updateSession(sessionId: string, updates: Partial<SessionContext>): Promise<SessionContext | null> {
  let existing = sessionStore.get(sessionId);
  if (!existing) {
    existing = await loadSessionById(sessionId);
    if (existing) {
      sessionStore.set(sessionId, existing);
    }
  }
  if (!existing) {
    return null;
  }

  const next: SessionContext = {
    ...existing,
    ...updates,
    updatedAt: nowIso(),
  };

  sessionStore.set(sessionId, next);
  await persistSession(next);

  return next;
}

export async function appendTurn(sessionId: string, turn: ConversationTurn): Promise<void> {
  const session = sessionStore.get(sessionId) ?? (await loadSessionById(sessionId));
  if (!session) {
    return;
  }
  if (!sessionStore.has(sessionId)) {
    sessionStore.set(sessionId, session);
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
