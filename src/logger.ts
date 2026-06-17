import { supabase } from './db/supabaseClient';

export interface AgentLogEntry {
  sessionId: string;
  turn: number;
  channel: string;
  userMessage: string;
  intent: string;
  confidence: number;
  entitiesExtracted: Record<string, unknown>;
  toolCalled: string;
  toolResult: Record<string, unknown>;
  agentResponse: string;
  latencyMs: number;
  escalated: boolean;
}

export async function logTurn(entry: AgentLogEntry): Promise<void> {
  console.log('[agent-log]', JSON.stringify(entry));

  if (!supabase) {
    return;
  }

  const { error } = await supabase.from('agent_logs').insert({
    session_id: entry.sessionId,
    turn: entry.turn,
    channel: entry.channel,
    user_message: entry.userMessage,
    intent: entry.intent,
    confidence: entry.confidence,
    entities_extracted: entry.entitiesExtracted,
    tool_called: entry.toolCalled,
    tool_result: entry.toolResult,
    agent_response: entry.agentResponse,
    latency_ms: Math.round(entry.latencyMs),
    escalated: entry.escalated,
  });

  if (error) {
    console.error('[agent-log] Failed to persist turn', {
      sessionId: entry.sessionId,
      turn: entry.turn,
      error: error.message,
    });
  }
}
