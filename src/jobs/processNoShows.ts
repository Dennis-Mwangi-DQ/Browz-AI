import { emitBookingCancelled } from '../lib/events';
import { supabase } from '../db/supabaseClient';

export async function processNoShows(): Promise<void> {
  if (!supabase) {
    return;
  }

  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, slot_id, service_id, branch_id')
    .eq('status', 'confirmed')
    .not('slot_id', 'is', null);

  for (const booking of bookings ?? []) {
    if (!booking.slot_id) {
      continue;
    }

    const { data: slot } = await supabase
      .from('time_slots')
      .select('start_time')
      .eq('id', booking.slot_id)
      .maybeSingle();

    if (!slot || String(slot.start_time) > cutoff) {
      continue;
    }

    await supabase
      .from('bookings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', booking.id);

    await supabase
      .from('time_slots')
      .update({ status: 'available' })
      .eq('id', booking.slot_id);

    emitBookingCancelled({
      bookingId: String(booking.id),
      slotId: String(booking.slot_id),
      serviceId: String(booking.service_id),
      branchId: String(booking.branch_id),
      startTime: String(slot.start_time),
      cancellationSource: 'no_show',
    });
  }
}

export function startNoShowsJob(): void {
  const intervalMs = 5 * 60 * 1000;
  void processNoShows();
  setInterval(() => {
    void processNoShows();
  }, intervalMs);
}
