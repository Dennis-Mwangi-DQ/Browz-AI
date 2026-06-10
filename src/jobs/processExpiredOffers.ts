import { handleOfferExpired } from '../agent/recoveryOrchestrator';
import { supabase } from '../db/supabaseClient';
import { getEnv } from '../lib/env';
import { expireWaitlistOffer } from '../tools/waitlist';
import type { WaitlistEntry } from '../types';

function mapWaitlistRow(row: Record<string, unknown>): WaitlistEntry {
  return {
    id: String(row.id),
    clientId: row.client_id ? String(row.client_id) : null,
    visitorName: row.visitor_name ? String(row.visitor_name) : null,
    visitorContact: String(row.visitor_contact),
    serviceId: String(row.service_id),
    branchId: String(row.branch_id),
    preferredDate: row.preferred_date ? String(row.preferred_date) : null,
    preferredDateRangeStart: row.preferred_date_range_start
      ? String(row.preferred_date_range_start)
      : null,
    preferredDateRangeEnd: row.preferred_date_range_end
      ? String(row.preferred_date_range_end)
      : null,
    preferredTimeStart: row.preferred_time_start
      ? String(row.preferred_time_start).slice(0, 5)
      : null,
    preferredTimeEnd: row.preferred_time_end
      ? String(row.preferred_time_end).slice(0, 5)
      : null,
    preferredArtistId: row.preferred_artist_id ? String(row.preferred_artist_id) : null,
    notificationChannel: String(row.notification_channel ?? 'whatsapp') as WaitlistEntry['notificationChannel'],
    priority: Number(row.priority ?? 0),
    status: String(row.status ?? 'waiting') as WaitlistEntry['status'],
    offerSentAt: row.offer_sent_at ? String(row.offer_sent_at) : null,
    offerExpiresAt: row.offer_expires_at ? String(row.offer_expires_at) : null,
    offeredSlotId: row.offered_slot_id ? String(row.offered_slot_id) : null,
    offeredBookingRef: row.offered_booking_ref ? String(row.offered_booking_ref) : null,
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export async function processExpiredOffers(): Promise<void> {
  if (!supabase) {
    return;
  }

  const now = new Date().toISOString();
  const { data } = await supabase
    .from('waitlist')
    .select('*')
    .eq('status', 'offered')
    .lt('offer_expires_at', now);

  for (const row of data ?? []) {
    const entry = mapWaitlistRow(row as Record<string, unknown>);
    const result = await expireWaitlistOffer(entry.id);
    if (result.success) {
      await handleOfferExpired(entry.id, result.data?.slotId ?? null, entry);
    }
  }
}

export function startExpiredOffersJob(): void {
  const intervalMs = getEnv().RECOVERY_JOB_INTERVAL_MS;
  void processExpiredOffers();
  setInterval(() => {
    void processExpiredOffers();
  }, intervalMs);
}
