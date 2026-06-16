import { supabase } from '../db/supabaseClient';
import { getEnv } from '../lib/env';
import { notifyStaffUnfilledSlot } from '../lib/notify';
import { completeRecoveryLog } from '../lib/recoveryLog';

export async function processUnfilledSlots(): Promise<void> {
  if (!supabase) {
    return;
  }

  const leadMin = getEnv().WALKIN_SLOT_NOTIFY_LEAD_MIN;
  const now = Date.now();
  const windowEnd = new Date(now + leadMin * 60 * 1000).toISOString();

  const { data: slots } = await supabase
    .from('time_slots')
    .select('id, branch_id, service_id, artist_id, start_time')
    .eq('status', 'open_for_walkin')
    .lte('start_time', windowEnd)
    .gt('start_time', new Date(now).toISOString());

  for (const slot of slots ?? []) {
    const slotId = String(slot.id);

    await supabase.from('time_slots').update({ status: 'unfilled' }).eq('id', slotId);

    await completeRecoveryLog(
      slotId,
      'unfilled',
      null,
      `Slot unfilled — flagged ${leadMin} minutes before appointment`,
    );

    await notifyStaffUnfilledSlot({
      slotId,
      branchId: String(slot.branch_id),
      serviceId: String(slot.service_id),
      artistId: slot.artist_id ? String(slot.artist_id) : null,
      startTime: String(slot.start_time),
      leadMinutes: leadMin,
    });
  }
}

export function startUnfilledSlotsJob(): void {
  const intervalMs = getEnv().RECOVERY_JOB_INTERVAL_MS;
  void processUnfilledSlots();
  setInterval(() => {
    void processUnfilledSlots();
  }, intervalMs);
}
