import { getEnv } from '../lib/env';
import { updateSession } from '../memory/sessionManager';

export async function escalate(params: {
  sessionId: string;
  reason: 'low_confidence' | 'user_requested' | 'tool_failure' | 'out_of_scope' | 'payment_failure';
  channel: 'web' | 'whatsapp';
  lastMessage: string;
  clientId?: string | null;
  visitorName?: string | null;
  visitorContact?: string | null;
}): Promise<void> {
  const webhookUrl = getEnv('ESCALATION_WEBHOOK_URL');

  try {
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    } else {
      console.log('[escalation-mock]', params);
    }
  } catch (error) {
    console.error('Escalation webhook failed', error);
  }

  await updateSession(params.sessionId, { status: 'escalated' });
}
