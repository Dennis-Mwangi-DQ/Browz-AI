import { getEnv } from './env';
import { normalizePhoneNumber } from './phone';
import { getTwilioClient } from './twilioClient';

function ensureWhatsappAddress(value?: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('whatsapp:')) {
    return trimmed;
  }

  const normalized = normalizePhoneNumber(trimmed) ?? trimmed;
  return `whatsapp:${normalized}`;
}

export async function sendWhatsAppMessage(params: {
  to?: string | null;
  body: string;
}): Promise<{ sent: boolean; messageSid?: string; skippedReason?: string }> {
  const client = getTwilioClient();
  const from = ensureWhatsappAddress(getEnv('TWILIO_WHATSAPP_NUMBER'));
  const to = ensureWhatsappAddress(params.to);

  if (!client || !from || !to) {
    return { sent: false, skippedReason: 'twilio_not_configured' };
  }

  const message = await client.messages.create({
    from,
    to,
    body: params.body,
  });

  return { sent: true, messageSid: message.sid };
}
