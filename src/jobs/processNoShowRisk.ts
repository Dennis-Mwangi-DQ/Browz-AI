import { supabase } from '../db/supabaseClient';
import { invokeCancellationRecovery } from '../lib/recoveryHook';
import { fail, ok } from '../lib/result';
import type { ToolResult } from '../types';

type BookingRow = Record<string, unknown>;

export async function processNoShowRisk(params: {
  now?: Date;
} = {}): Promise<ToolResult<{ processed: number }>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  const now = params.now ?? new Date();
  const nowIso = now.toISOString();

  const { data, error } = await supabase
    .from('bookings')
    .select('id, slot_id, service_id, branch_id')
    .eq('status', 'confirmed')
    .eq('reconfirmation_status', 'pending')
    .not('reconfirmation_sent_at', 'is', null)
    .lt('reconfirmation_deadline', nowIso);

  if (error) {
    console.error('processNoShowRisk lookup failed', error);
    return fail('no_show_risk_failed');
  }

  const rows = (data ?? []) as BookingRow[];
  for (const row of rows) {
    const bookingId = String(row.id);
    const { error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'no_show_risk',
        reconfirmation_status: 'no_response',
        updated_at: nowIso,
      })
      .eq('id', bookingId);

    if (updateError) {
      console.error('processNoShowRisk update failed', updateError);
      return fail('no_show_risk_failed');
    }

    await invokeCancellationRecovery({
      bookingId,
      slotId: row.slot_id ? String(row.slot_id) : null,
      serviceId: row.service_id ? String(row.service_id) : null,
      branchId: row.branch_id ? String(row.branch_id) : null,
      reason: 'no_show_risk',
    });
  }

  return ok({ processed: rows.length });
}
