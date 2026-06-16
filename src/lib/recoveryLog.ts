import { supabase } from '../db/supabaseClient';
import type { RecoveryOutcome } from '../types';

export async function findActiveRecoveryLogId(slotId: string): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  const { data } = await supabase
    .from('slot_recovery_log')
    .select('id')
    .eq('slot_id', slotId)
    .is('recovery_completed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? String(data.id) : null;
}

export async function getLogCounter(logId: string, field: string): Promise<number> {
  if (!supabase) {
    return 0;
  }

  const { data } = await supabase
    .from('slot_recovery_log')
    .select(field)
    .eq('id', logId)
    .maybeSingle();

  if (!data || typeof data !== 'object') {
    return 0;
  }
  return Number((data as Record<string, unknown>)[field] ?? 0);
}

export async function updateRecoveryLog(
  logId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!supabase) {
    return;
  }

  await supabase.from('slot_recovery_log').update(patch).eq('id', logId);
}

export async function incrementRecoveryLogCounter(
  logId: string,
  field: 'offers_sent' | 'offers_declined' | 'offers_expired',
): Promise<void> {
  const current = await getLogCounter(logId, field);
  await updateRecoveryLog(logId, { [field]: current + 1 });
}

export async function completeRecoveryLog(
  slotId: string,
  outcome: RecoveryOutcome,
  recoveredBookingId?: string | null,
  notes?: string,
): Promise<void> {
  const logId = await findActiveRecoveryLogId(slotId);
  if (!logId) {
    return;
  }

  await updateRecoveryLog(logId, {
    outcome,
    ...(recoveredBookingId ? { recovered_booking_id: recoveredBookingId } : {}),
    recovery_completed_at: new Date().toISOString(),
    ...(notes ? { notes } : {}),
  });
}
