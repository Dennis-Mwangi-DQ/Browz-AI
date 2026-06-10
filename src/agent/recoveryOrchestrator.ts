import { supabase } from '../db/supabaseClient';
import { onBookingCancelled } from '../lib/events';
import { notifyOfferExpired, notifySlotOffer } from '../lib/notify';
import {
  declineSlotOffer,
  dispatchOfferToCandidate,
  expireWaitlistOffer,
  findWaitlistMatches,
} from '../tools/waitlist';
import type { BookingCancelledEvent, CancellationSource, WaitlistEntry } from '../types';

const activeRecoveries = new Map<string, string>();

async function createRecoveryLog(
  event: BookingCancelledEvent,
): Promise<string | null> {
  if (!supabase) {
    return null;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('slot_recovery_log')
    .insert({
      booking_id: event.bookingId,
      slot_id: event.slotId,
      service_id: event.serviceId,
      branch_id: event.branchId,
      cancellation_source: event.cancellationSource,
      cancelled_at: now,
      recovery_started_at: now,
    })
    .select('id')
    .single();

  if (error) {
    console.error('createRecoveryLog failed', error);
    return null;
  }

  return String(data.id);
}

async function updateRecoveryLog(
  logId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!supabase) {
    return;
  }

  await supabase.from('slot_recovery_log').update(patch).eq('id', logId);
}

async function surfaceWalkinSlot(slotId: string, logId: string | null): Promise<void> {
  if (!supabase) {
    return;
  }

  await supabase.from('time_slots').update({ status: 'open_for_walkin' }).eq('id', slotId);

  if (logId) {
    await updateRecoveryLog(logId, {
      outcome: null,
      notes: 'Waitlist exhausted — slot open for walk-in',
    });
  }
}

export async function tryNextCandidate(
  slotId: string,
  serviceId: string,
  branchId: string,
  slotStartTime: string,
  logId: string | null,
  excludedRefs: string[] = [],
): Promise<void> {
  const matches = await findWaitlistMatches(
    slotId,
    serviceId,
    branchId,
    new Date(slotStartTime),
  );

  const candidate = matches.find((entry) => !excludedRefs.includes(entry.id));
  if (!candidate) {
    await surfaceWalkinSlot(slotId, logId);
    return;
  }

  const offerResult = await dispatchOfferToCandidate({
    entry: candidate,
    slotId,
  });

  if (!offerResult.success || !offerResult.data) {
    await surfaceWalkinSlot(slotId, logId);
    return;
  }

  if (logId) {
    await updateRecoveryLog(logId, {
      offers_sent: (await getLogCounter(logId, 'offers_sent')) + 1,
    });
  }

  const channel = offerResult.data.notificationChannel;
  await notifySlotOffer({
    entry: offerResult.data,
    slotId,
    slotStartTime,
    artistId: null,
    channel,
  });
}

async function getLogCounter(logId: string, field: string): Promise<number> {
  if (!supabase) {
    return 0;
  }

  const { data } = await supabase.from('slot_recovery_log').select(field).eq('id', logId).maybeSingle();
  if (!data || typeof data !== 'object') {
    return 0;
  }
  return Number((data as Record<string, unknown>)[field] ?? 0);
}

export async function handleCancellation(event: BookingCancelledEvent): Promise<void> {
  if (!supabase) {
    return;
  }

  if (activeRecoveries.has(event.slotId)) {
    return;
  }

  activeRecoveries.set(event.slotId, event.bookingId);

  try {
    const logId = await createRecoveryLog(event);
    if (logId) {
      activeRecoveries.set(`${event.slotId}:log`, logId);
    }

    const matches = await findWaitlistMatches(
      event.slotId,
      event.serviceId,
      event.branchId,
      new Date(event.startTime),
    );

    if (logId) {
      await updateRecoveryLog(logId, {
        waitlist_candidates_found: matches.length,
      });
    }

    if (matches.length === 0) {
      await surfaceWalkinSlot(event.slotId, logId);
      return;
    }

    const topCandidate = matches[0];
    if (!topCandidate) {
      await surfaceWalkinSlot(event.slotId, logId);
      return;
    }

    const offerResult = await dispatchOfferToCandidate({
      entry: topCandidate,
      slotId: event.slotId,
    });

    if (!offerResult.success || !offerResult.data) {
      await surfaceWalkinSlot(event.slotId, logId);
      return;
    }

    if (logId) {
      await updateRecoveryLog(logId, { offers_sent: 1 });
    }

    await notifySlotOffer({
      entry: offerResult.data,
      slotId: event.slotId,
      slotStartTime: event.startTime,
      channel: offerResult.data.notificationChannel,
    });
  } catch (error) {
    console.error('handleCancellation failed', error);
  } finally {
    activeRecoveries.delete(event.slotId);
  }
}

export async function handleOfferDeclined(
  waitlistRef: string,
  slotId: string | null,
): Promise<void> {
  if (!slotId || !supabase) {
    return;
  }

  const logId = activeRecoveries.get(`${slotId}:log`) ?? null;
  if (logId) {
    await updateRecoveryLog(logId, {
      offers_declined: (await getLogCounter(logId, 'offers_declined')) + 1,
    });
  }

  const { data: slot } = await supabase
    .from('time_slots')
    .select('service_id, branch_id, start_time')
    .eq('id', slotId)
    .maybeSingle();

  if (!slot) {
    return;
  }

  await tryNextCandidate(
    slotId,
    String(slot.service_id),
    String(slot.branch_id),
    String(slot.start_time),
    logId,
    [waitlistRef],
  );
}

export async function handleOfferExpired(
  waitlistRef: string,
  slotId: string | null,
  entry: WaitlistEntry,
): Promise<void> {
  await notifyOfferExpired(entry);

  if (!slotId || !supabase) {
    return;
  }

  const logId = activeRecoveries.get(`${slotId}:log`) ?? null;
  if (logId) {
    await updateRecoveryLog(logId, {
      offers_expired: (await getLogCounter(logId, 'offers_expired')) + 1,
    });
  }

  const { data: slot } = await supabase
    .from('time_slots')
    .select('service_id, branch_id, start_time')
    .eq('id', slotId)
    .maybeSingle();

  if (!slot) {
    return;
  }

  await tryNextCandidate(
    slotId,
    String(slot.service_id),
    String(slot.branch_id),
    String(slot.start_time),
    logId,
    [waitlistRef],
  );
}

export async function completeRecovery(
  slotId: string,
  outcome: 'waitlist_filled' | 'walkin_filled' | 'staff_assigned',
  recoveredBookingId: string,
): Promise<void> {
  const logId = activeRecoveries.get(`${slotId}:log`);
  if (!logId || !supabase) {
    return;
  }

  await updateRecoveryLog(logId, {
    outcome,
    recovered_booking_id: recoveredBookingId,
    recovery_completed_at: new Date().toISOString(),
  });
}

export function startRecoveryListener(): void {
  onBookingCancelled((event) => {
    void handleCancellation(event);
  });
}

export async function cancelBookingForRecovery(params: {
  bookingRef: string;
  clientId?: string | null;
  cancellationSource: CancellationSource;
}): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'supabase_not_configured' };
  }

  let query = supabase
    .from('bookings')
    .select('id, slot_id, service_id, branch_id, client_id')
    .eq('id', params.bookingRef);

  if (params.clientId) {
    query = query.eq('client_id', params.clientId);
  }

  const { data: booking } = await query.maybeSingle();
  if (!booking || !booking.slot_id) {
    return { success: false, error: 'booking_not_found' };
  }

  const { data: slot } = await supabase
    .from('time_slots')
    .select('id, service_id, branch_id, start_time')
    .eq('id', booking.slot_id)
    .maybeSingle();

  if (!slot) {
    return { success: false, error: 'slot_not_found' };
  }

  await supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', params.bookingRef);

  await supabase.from('time_slots').update({ status: 'available' }).eq('id', booking.slot_id);

  const { emitBookingCancelled } = await import('../lib/events');
  emitBookingCancelled({
    bookingId: params.bookingRef,
    slotId: String(booking.slot_id),
    serviceId: String(slot.service_id),
    branchId: String(slot.branch_id),
    startTime: String(slot.start_time),
    cancellationSource: params.cancellationSource,
  });

  return { success: true };
}

export { declineSlotOffer, expireWaitlistOffer };
