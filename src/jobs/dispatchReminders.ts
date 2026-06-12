import { supabase } from '../db/supabaseClient';
import { getEnv } from '../lib/env';
import { sendWhatsAppMessage } from '../lib/messaging';
import type { ToolResult } from '../types';
import { fail, ok } from '../lib/result';

type BookingRow = Record<string, unknown>;

function related(row: BookingRow, key: string): Record<string, unknown> | null {
  const value = row[key];
  if (Array.isArray(value)) {
    return (value[0] as Record<string, unknown> | undefined) ?? null;
  }
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function formatTime(value?: string): string {
  if (!value) {
    return 'your scheduled time';
  }

  return new Date(value).toLocaleString('en-AE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Dubai',
  });
}

function buildReminderMessage(row: BookingRow, deadlineIso: string): string {
  const client = related(row, 'clients');
  const service = related(row, 'services');
  const branch = related(row, 'branches');
  const artist = related(row, 'artists');
  const slot = related(row, 'time_slots');
  const name = String(client?.name ?? row.visitor_name ?? 'there');
  const serviceName = String(service?.title ?? 'your appointment');
  const branchName = String(branch?.name ?? 'Browz');
  const artistName = String(artist?.name ?? 'Any available');
  const appointmentTime = formatTime(slot?.start_time ? String(slot.start_time) : undefined);
  const deadline = formatTime(deadlineIso);

  return [
    `Hi ${name}, just a reminder about your appointment tomorrow at ${branchName}.`,
    '',
    `Service: ${serviceName}`,
    `Time: ${appointmentTime}`,
    `Artist: ${artistName}`,
    '',
    'Can you confirm you are still coming? Reply YES to confirm or NO to cancel.',
    `If we do not hear from you by ${deadline}, we may release your slot.`,
  ].join('\n');
}

export async function dispatchReminders(params: {
  now?: Date;
} = {}): Promise<ToolResult<{ processed: number; sent: number }>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  const env = getEnv();
  const now = params.now ?? new Date();
  const windowStart = addHours(now, env.RECONFIRMATION_WINDOW_HOURS);
  const windowEnd = addHours(windowStart, 1);

  const { data, error } = await supabase
    .from('bookings')
    .select(
      [
        '*',
        'time_slots!inner(start_time,end_time)',
        'clients(name,phone)',
        'services(title)',
        'branches(name)',
        'artists(name)',
      ].join(','),
    )
    .eq('status', 'confirmed')
    .in('payment_status', ['deposit_paid', 'paid'])
    .is('reconfirmation_sent_at', null)
    .gte('time_slots.start_time', windowStart.toISOString())
    .lt('time_slots.start_time', windowEnd.toISOString());

  if (error) {
    console.error('dispatchReminders lookup failed', error);
    return fail('reminder_dispatch_failed');
  }

  let sent = 0;
  const rows = (data ?? []) as unknown as BookingRow[];
  for (const row of rows) {
    const bookingId = String(row.id);
    const client = related(row, 'clients');
    const channel = String(row.channel ?? 'web') as 'web' | 'whatsapp';
    const contact = String(client?.phone ?? row.visitor_contact ?? '');
    const sentAt = now.toISOString();
    const deadline = addHours(now, env.RECONFIRMATION_RESPONSE_DEADLINE_HOURS);
    const message = buildReminderMessage(row, deadline.toISOString());
    const outbound = channel === 'whatsapp'
      ? await sendWhatsAppMessage({ to: contact, body: message })
      : { sent: false };

    if (outbound.sent) {
      sent += 1;
    }

    await supabase.from('reminder_log').insert({
      booking_id: bookingId,
      client_id: row.client_id ? String(row.client_id) : null,
      channel,
      reminder_type: 'reconfirmation_nudge',
      sent_at: sentAt,
      delivered: outbound.sent,
    });

    await supabase
      .from('bookings')
      .update({
        reconfirmation_sent_at: sentAt,
        reconfirmation_deadline: deadline.toISOString(),
        reconfirmation_status: 'pending',
        updated_at: sentAt,
      })
      .eq('id', bookingId);
  }

  return ok({ processed: rows.length, sent });
}
