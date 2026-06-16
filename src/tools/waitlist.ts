import { z } from 'zod';
import { checkPreBookingRequirements } from '../agent/gateChecker';
import { supabase } from '../db/supabaseClient';
import { getBranchById, getServiceById } from '../lib/catalog';
import { getEnv } from '../lib/env';
import { isoToSalonLocalDate, isoToSalonLocalTime } from '../lib/dates';
import { generateSequenceId } from '../lib/ids';
import { normalizePhoneNumber } from '../lib/phone';
import { fail, ok } from '../lib/result';
import { createBooking } from './bookings';
import type { NotificationChannel, ToolResult, WaitlistEntry } from '../types';

function yearPart() {
  return new Date().getUTCFullYear().toString();
}

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
    notificationChannel: String(row.notification_channel ?? 'whatsapp') as NotificationChannel,
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

async function nextWaitlistSequence(): Promise<number> {
  if (!supabase) {
    return Math.floor(Math.random() * 90000) + 10000;
  }

  const prefix = `WL-${yearPart()}-`;
  const { data } = await supabase
    .from('waitlist')
    .select('id')
    .like('id', `${prefix}%`)
    .order('id', { ascending: false })
    .limit(50);

  let maxSequence = 0;
  for (const row of data ?? []) {
    const suffix = String(row.id).slice(prefix.length);
    if (/^\d+$/.test(suffix)) {
      maxSequence = Math.max(maxSequence, Number(suffix));
    }
  }

  return maxSequence + 1;
}

async function getBranchOfferWindowMinutes(branchId: string): Promise<number> {
  if (!supabase) {
    return getEnv().OFFER_WINDOW_MINUTES;
  }

  const { data } = await supabase
    .from('branches')
    .select('offer_window_minutes')
    .eq('id', branchId)
    .maybeSingle();

  return data?.offer_window_minutes != null
    ? Number(data.offer_window_minutes)
    : getEnv().OFFER_WINDOW_MINUTES;
}

async function getBranchNotificationDefault(branchId: string): Promise<NotificationChannel> {
  if (!supabase) {
    return 'whatsapp';
  }

  const { data } = await supabase
    .from('branches')
    .select('waitlist_notification_default')
    .eq('id', branchId)
    .maybeSingle();

  return (data?.waitlist_notification_default as NotificationChannel) ?? 'whatsapp';
}

function matchesTimeWindow(
  entry: WaitlistEntry,
  slotTime: string,
): boolean {
  if (!entry.preferredTimeStart && !entry.preferredTimeEnd) {
    return true;
  }
  const start = entry.preferredTimeStart ?? '00:00';
  const end = entry.preferredTimeEnd ?? '23:59';
  return slotTime >= start && slotTime <= end;
}

const AddToWaitlistParams = z.object({
  serviceId: z.string().min(1),
  branchId: z.string().min(1),
  preferredDate: z.string().optional(),
  preferredTimeStart: z.string().optional(),
  preferredTimeEnd: z.string().optional(),
  clientId: z.string().uuid().nullable().optional(),
  visitorName: z.string().optional(),
  visitorContact: z.string().min(1),
  preferredArtistId: z.string().optional(),
  notificationChannel: z.enum(['whatsapp', 'web', 'both']).optional(),
});

export async function addToWaitlist(params: {
  serviceId: string;
  branchId: string;
  preferredDate?: string;
  preferredTimeStart?: string;
  preferredTimeEnd?: string;
  clientId?: string | null;
  visitorName?: string;
  visitorContact: string;
  preferredArtistId?: string;
  notificationChannel?: NotificationChannel;
}): Promise<ToolResult<{ waitlistRef: string; entry: WaitlistEntry }>> {
  const parsed = AddToWaitlistParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_waitlist_params');
  }

  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const branchDefault = await getBranchNotificationDefault(params.branchId);
    const channel = params.notificationChannel ?? branchDefault;
    const waitlistRef = generateSequenceId('WL', yearPart(), await nextWaitlistSequence(), 5);
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('waitlist')
      .insert({
        id: waitlistRef,
        client_id: params.clientId ?? null,
        visitor_name: params.visitorName ?? null,
        visitor_contact: normalizePhoneNumber(params.visitorContact),
        service_id: params.serviceId,
        branch_id: params.branchId,
        preferred_date: params.preferredDate ?? null,
        preferred_time_start: params.preferredTimeStart ?? null,
        preferred_time_end: params.preferredTimeEnd ?? null,
        preferred_artist_id: params.preferredArtistId ?? null,
        notification_channel: channel,
        status: 'waiting',
        created_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (error || !data) {
      console.error('addToWaitlist failed', error);
      return fail('waitlist_add_failed');
    }

    return ok({ waitlistRef, entry: mapWaitlistRow(data) });
  } catch (error) {
    console.error('addToWaitlist failed', error);
    return fail('waitlist_add_failed');
  }
}

export async function findWaitlistMatches(
  slotId: string,
  serviceId: string,
  branchId: string,
  slotStartTime: Date,
): Promise<WaitlistEntry[]> {
  if (!supabase) {
    return [];
  }

  const slotIso = slotStartTime.toISOString();
  const slotDate = isoToSalonLocalDate(slotIso);
  const slotTime = isoToSalonLocalTime(slotIso);

  const { data } = await supabase
    .from('waitlist')
    .select('*')
    .eq('service_id', serviceId)
    .eq('branch_id', branchId)
    .eq('status', 'waiting')
    .or(
      `preferred_date.eq.${slotDate},and(preferred_date_range_start.lte.${slotDate},preferred_date_range_end.gte.${slotDate})`,
    )
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });

  if (!data) {
    return [];
  }

  return data
    .map((row) => mapWaitlistRow(row as Record<string, unknown>))
    .filter((entry) => matchesTimeWindow(entry, slotTime));
}

export async function checkWaitlistStatus(params: {
  waitlistRef?: string;
  visitorContact?: string;
}): Promise<
  ToolResult<{
    entry: WaitlistEntry;
    position: number | null;
    serviceName: string;
    branchName: string;
  }>
> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    let query = supabase.from('waitlist').select('*');

    if (params.waitlistRef) {
      query = query.eq('id', params.waitlistRef);
    } else if (params.visitorContact) {
      query = query
        .eq('visitor_contact', normalizePhoneNumber(params.visitorContact))
        .in('status', ['waiting', 'offered'])
        .order('created_at', { ascending: false })
        .limit(1);
    } else {
      return fail('waitlist_ref_or_contact_required');
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) {
      return fail('waitlist_entry_not_found');
    }

    const entry = mapWaitlistRow(data);

    let position: number | null = null;
    if (entry.status === 'waiting') {
      const { count } = await supabase
        .from('waitlist')
        .select('*', { count: 'exact', head: true })
        .eq('service_id', entry.serviceId)
        .eq('branch_id', entry.branchId)
        .eq('status', 'waiting')
        .lte('priority', entry.priority)
        .lte('created_at', entry.createdAt);
      position = count ?? null;
    }

    const service = await getServiceById(entry.serviceId);
    const branch = await getBranchById(entry.branchId);

    return ok({
      entry,
      position,
      serviceName: service?.name ?? entry.serviceId,
      branchName: branch?.name ?? entry.branchId,
    });
  } catch (error) {
    console.error('checkWaitlistStatus failed', error);
    return fail('waitlist_status_failed');
  }
}

export async function cancelWaitlistEntry(
  waitlistRef: string,
): Promise<ToolResult<{ waitlistRef: string }>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const { data } = await supabase
      .from('waitlist')
      .select('id, status, offered_slot_id')
      .eq('id', waitlistRef)
      .maybeSingle();

    if (!data) {
      return fail('waitlist_entry_not_found');
    }

    if (data.status === 'offered' && data.offered_slot_id) {
      await supabase
        .from('time_slots')
        .update({ status: 'available' })
        .eq('id', data.offered_slot_id);
    }

    await supabase
      .from('waitlist')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', waitlistRef);

    return ok({ waitlistRef });
  } catch (error) {
    console.error('cancelWaitlistEntry failed', error);
    return fail('waitlist_cancel_failed');
  }
}

export async function dispatchOfferToCandidate(params: {
  entry: WaitlistEntry;
  slotId: string;
  offerWindowMinutes?: number;
}): Promise<ToolResult<WaitlistEntry>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  const windowMinutes =
    params.offerWindowMinutes ?? (await getBranchOfferWindowMinutes(params.entry.branchId));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMinutes * 60 * 1000);

  const { data, error } = await supabase
    .from('waitlist')
    .update({
      status: 'offered',
      offer_sent_at: now.toISOString(),
      offer_expires_at: expiresAt.toISOString(),
      offered_slot_id: params.slotId,
      updated_at: now.toISOString(),
    })
    .eq('id', params.entry.id)
    .eq('status', 'waiting')
    .select('*')
    .maybeSingle();

  if (error || !data) {
    return fail('offer_dispatch_failed');
  }

  await supabase.from('time_slots').update({ status: 'hold' }).eq('id', params.slotId);

  return ok(mapWaitlistRow(data));
}

export async function confirmSlotOffer(params: {
  waitlistRef: string;
  slotId?: string;
  clientId?: string | null;
  channel: 'web' | 'whatsapp';
}): Promise<
  ToolResult<{
    bookingId: string;
    waitlistRef: string;
  }>
> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const { data: entry } = await supabase
      .from('waitlist')
      .select('*')
      .eq('id', params.waitlistRef)
      .eq('status', 'offered')
      .maybeSingle();

    if (!entry) {
      return fail('no_active_offer');
    }

    const slotId = params.slotId ?? (entry.offered_slot_id ? String(entry.offered_slot_id) : null);
    if (!slotId) {
      return fail('slot_not_found');
    }

    if (entry.offer_expires_at && new Date(String(entry.offer_expires_at)) < new Date()) {
      return fail('offer_expired');
    }

    const clientId = params.clientId ?? (entry.client_id ? String(entry.client_id) : null);
    const gate = await checkPreBookingRequirements(String(entry.service_id), clientId);
    if (!gate.gateCleared) {
      return fail('gate_blocked');
    }

    const { data: slot } = await supabase
      .from('time_slots')
      .select('*')
      .eq('id', slotId)
      .maybeSingle();

    if (!slot || slot.status !== 'hold') {
      return fail('slot_unavailable');
    }

    const booking = await createBooking({
      clientId,
      visitorName: entry.visitor_name ? String(entry.visitor_name) : undefined,
      visitorContact: String(entry.visitor_contact),
      serviceId: String(entry.service_id),
      branchId: String(entry.branch_id),
      slotId,
      artistId: slot.artist_id ? String(slot.artist_id) : undefined,
      channel: params.channel,
      bookingSource: 'waitlist_recovery',
      waitlistRef: params.waitlistRef,
    });

    if (!booking.success || !booking.data) {
      return fail(booking.error ?? 'booking_failed');
    }

    await supabase
      .from('waitlist')
      .update({
        status: 'confirmed',
        offered_booking_ref: booking.data.bookingId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.waitlistRef);

    return ok({ bookingId: booking.data.bookingId, waitlistRef: params.waitlistRef });
  } catch (error) {
    console.error('confirmSlotOffer failed', error);
    return fail('offer_confirm_failed');
  }
}

export async function declineSlotOffer(
  waitlistRef: string,
): Promise<ToolResult<{ waitlistRef: string; slotId: string | null }>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const { data: entry } = await supabase
      .from('waitlist')
      .select('*')
      .eq('id', waitlistRef)
      .eq('status', 'offered')
      .maybeSingle();

    if (!entry) {
      return fail('no_active_offer');
    }

    const slotId = entry.offered_slot_id ? String(entry.offered_slot_id) : null;

    await supabase
      .from('waitlist')
      .update({ status: 'declined', updated_at: new Date().toISOString() })
      .eq('id', waitlistRef);

    if (slotId) {
      await supabase.from('time_slots').update({ status: 'available' }).eq('id', slotId);
    }

    return ok({ waitlistRef, slotId });
  } catch (error) {
    console.error('declineSlotOffer failed', error);
    return fail('offer_decline_failed');
  }
}

export async function expireWaitlistOffer(
  waitlistRef: string,
): Promise<ToolResult<{ waitlistRef: string; slotId: string | null }>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const { data: entry } = await supabase
      .from('waitlist')
      .select('*')
      .eq('id', waitlistRef)
      .eq('status', 'offered')
      .maybeSingle();

    if (!entry) {
      return fail('no_active_offer');
    }

    const slotId = entry.offered_slot_id ? String(entry.offered_slot_id) : null;

    await supabase
      .from('waitlist')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', waitlistRef);

    if (slotId) {
      await supabase.from('time_slots').update({ status: 'available' }).eq('id', slotId);
    }

    return ok({ waitlistRef, slotId });
  } catch (error) {
    console.error('expireWaitlistOffer failed', error);
    return fail('offer_expire_failed');
  }
}
