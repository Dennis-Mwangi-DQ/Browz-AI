import { z } from 'zod';
import { supabase } from '../db/supabaseClient';
import { resolvePaymentRule } from '../agent/paymentRules';
import { getServiceById } from '../lib/catalog';
import { emitBookingCancelled } from '../lib/events';
import { generateSequenceId } from '../lib/ids';
import { normalizePhoneNumber } from '../lib/phone';
import { fail, ok } from '../lib/result';
import { generatePaymentLink } from './payment';
import { getClientNoShowFlag } from './noShow';
import type { BookingRecord, BookingSource, PaymentRule, TimeSlot, ToolResult } from '../types';

const CreateBookingParams = z.object({
  clientId: z.string().uuid().nullable(),
  visitorName: z.string().optional(),
  visitorContact: z.string().optional(),
  serviceId: z.string().min(1),
  branchId: z.string().min(1),
  slotId: z.string().min(1),
  artistId: z.string().optional(),
  notes: z.string().optional(),
  screeningRef: z.string().optional(),
  clearanceRef: z.string().optional(),
  channel: z.enum(['web', 'whatsapp']),
  bookingType: z.enum(['single', 'consultation', 'package_first_session']).optional(),
  bookingSource: z
    .enum(['ai_concierge', 'waitlist_recovery', 'walkin_agent', 'walkin_staff'])
    .optional(),
  waitlistRef: z.string().optional(),
});

const ModifyBookingParams = z.object({
  bookingRef: z.string().min(1),
  newSlotId: z.string().min(1),
  clientId: z.string().uuid().nullable(),
});

const CancelBookingParams = z.object({
  bookingRef: z.string().min(1),
  clientId: z.string().uuid().nullable(),
});

const FetchBookingParams = z.object({
  bookingRef: z.string().min(1),
});

function yearPart() {
  return new Date().getUTCFullYear().toString();
}

async function nextBookingSequence(): Promise<number> {
  if (!supabase) {
    return Math.floor(Math.random() * 90000) + 10000;
  }

  const prefix = `BRZ-${yearPart()}-`;
  const { data } = await supabase
    .from('bookings')
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

async function fetchSlot(slotId: string): Promise<TimeSlot | null> {
  if (!supabase) {
    return {
      id: slotId,
      branchId: 'br-dxb',
      serviceId: 's-001',
      artistId: null,
      startTime: new Date().toISOString(),
      endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: 'available',
    };
  }

  const { data } = await supabase.from('time_slots').select('*').eq('id', slotId).maybeSingle();
  if (!data) {
    return null;
  }

  return {
    id: String(data.id),
    branchId: String(data.branch_id),
    serviceId: String(data.service_id),
    artistId: data.artist_id ? String(data.artist_id) : null,
    startTime: String(data.start_time),
    endTime: String(data.end_time),
    status: String(data.status) as TimeSlot['status'],
    isWalkin: String(data.status) === 'open_for_walkin',
  };
}

async function isSlotBookable(
  slot: TimeSlot,
  bookingSource?: BookingSource,
  waitlistRef?: string,
): Promise<boolean> {
  if (slot.status === 'available') {
    return true;
  }

  if (slot.status === 'open_for_walkin' || slot.status === 'unfilled') {
    return bookingSource === 'walkin_agent' || bookingSource === 'walkin_staff';
  }

  if (slot.status === 'hold' && bookingSource === 'waitlist_recovery' && waitlistRef && supabase) {
    const { data } = await supabase
      .from('waitlist')
      .select('id')
      .eq('id', waitlistRef)
      .eq('status', 'offered')
      .eq('offered_slot_id', slot.id)
      .maybeSingle();
    return Boolean(data);
  }

  return false;
}

export async function createBooking(params: {
  clientId: string | null;
  visitorName?: string;
  visitorContact?: string;
  serviceId: string;
  branchId: string;
  slotId: string;
  artistId?: string;
  notes?: string;
  screeningRef?: string;
  clearanceRef?: string;
  channel: 'web' | 'whatsapp';
  bookingType?: 'single' | 'consultation' | 'package_first_session';
  bookingSource?: BookingSource;
  waitlistRef?: string;
}): Promise<ToolResult<{ bookingId: string; paymentRule: PaymentRule; paymentLink?: string }>> {
  const parsed = CreateBookingParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_create_booking_params');
  }

  try {
    const service = await getServiceById(params.serviceId);
    if (!service) {
      return fail('service_not_found');
    }

    const slot = await fetchSlot(params.slotId);
    const bookingSource = params.bookingSource ?? 'ai_concierge';
    if (!slot || !(await isSlotBookable(slot, bookingSource, params.waitlistRef))) {
      return fail('slot_unavailable');
    }

    if (
      !params.clientId &&
      (!params.visitorName?.trim() || !params.visitorContact?.trim())
    ) {
      return fail('visitor_details_required');
    }

    const bookingId = generateSequenceId('BRZ', yearPart(), await nextBookingSequence(), 5);
    const noShowFlag = await getClientNoShowFlag(params.clientId);
    const paymentRule = resolvePaymentRule(service, params.bookingType ?? 'single', noShowFlag);
    const requiresPayment = paymentRule.paymentType !== 'free';

    if (supabase) {
      const { error } = await supabase.from('bookings').insert({
        id: bookingId,
        client_id: params.clientId,
        visitor_name: params.visitorName,
        visitor_contact: normalizePhoneNumber(params.visitorContact),
        service_id: params.serviceId,
        branch_id: params.branchId,
        slot_id: params.slotId,
        artist_id: params.artistId,
        status: requiresPayment ? 'pending_payment' : 'confirmed',
        notes: params.notes,
        booking_type: params.bookingType ?? 'single',
        payment_type: paymentRule.paymentType,
        deposit_amount_aed: paymentRule.depositAmountAed,
        balance_due_aed: paymentRule.balanceDueAed,
        payment_status: requiresPayment ? 'unpaid' : 'paid',
        screening_ref: params.screeningRef,
        clearance_ref: params.clearanceRef,
        consent_status: service.serviceTier === 'T3' ? 'pending' : 'not_required',
        channel: params.channel,
        booking_source: bookingSource,
      });

      if (error) {
        console.error('createBooking insert failed', error);
        return fail('booking_create_failed');
      }

      await supabase.from('time_slots').update({ status: 'booked' }).eq('id', params.slotId);

      let paymentLinkUrl: string | undefined;
      if (requiresPayment) {
        const paymentLink = await generatePaymentLink({
          bookingRef: bookingId,
          amountAed: paymentRule.depositAmountAed,
          paymentType: paymentRule.paymentType as 'full_upfront' | 'deposit' | 'package',
          description: `${service.name} booking ${bookingId}`,
        });

        if (!paymentLink.success) {
          return fail(paymentLink.error ?? 'payment_link_failed');
        }
        paymentLinkUrl = paymentLink.data?.paymentLink;
      }

      return ok({ bookingId, paymentRule, paymentLink: paymentLinkUrl });
    }

    if (bookingSource === 'waitlist_recovery' || bookingSource === 'walkin_agent' || bookingSource === 'walkin_staff') {
      const { completeRecovery } = await import('../agent/recoveryOrchestrator');
      await completeRecovery(
        params.slotId,
        bookingSource === 'waitlist_recovery' ? 'waitlist_filled' : 'walkin_filled',
        bookingId,
      );
    }

    return ok({ bookingId, paymentRule });
  } catch (error) {
    console.error('createBooking failed', error);
    return fail('booking_create_failed');
  }
}

export async function modifyBooking(params: {
  bookingRef: string;
  newSlotId: string;
  clientId: string | null;
}): Promise<ToolResult<{ bookingId: string; newSlot: TimeSlot }>> {
  const parsed = ModifyBookingParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_modify_booking_params');
  }

  try {
    const slot = await fetchSlot(params.newSlotId);
    if (!slot || slot.status !== 'available') {
      return fail('slot_unavailable');
    }

    if (supabase) {
      const query = supabase
  .from('bookings')
  .select('id, slot_id, client_id, visitor_name, visitor_contact, service_id, branch_id, artist_id, status, payment_status, payment_type, deposit_amount_aed, balance_due_aed')
  .eq('id', params.bookingRef);
 const { data: booking } = params.clientId
  ? await query.eq('client_id', params.clientId).maybeSingle()
  : await query.is('client_id', null).maybeSingle();

      if (!booking) {
        return fail('booking_not_found');
      }

      await supabase.from('time_slots').update({ status: 'available' }).eq('id', booking.slot_id);
      await supabase.from('time_slots').update({ status: 'booked' }).eq('id', params.newSlotId);
      await supabase
        .from('bookings')
        .update({ slot_id: params.newSlotId, status: 'modified', updated_at: new Date().toISOString() })
        .eq('id', params.bookingRef);
    }

    return ok({ bookingId: params.bookingRef, newSlot: slot });
  } catch (error) {
    console.error('modifyBooking failed', error);
    return fail('booking_modify_failed');
  }
}

export async function cancelBooking(params: {
  bookingRef: string;
  clientId: string | null;
}): Promise<ToolResult<{ bookingId: string }>> {
  const parsed = CancelBookingParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_cancel_booking_params');
  }

  try {
    if (supabase) {
       const query = supabase
  .from('bookings')
  .select('id, slot_id, client_id, visitor_name, visitor_contact, service_id, branch_id, artist_id, status, payment_status, payment_type, deposit_amount_aed, balance_due_aed')
  .eq('id', params.bookingRef);
 const { data: booking } = params.clientId
  ? await query.eq('client_id', params.clientId).maybeSingle()
  : await query.is('client_id', null).maybeSingle();

      if (!booking) {
        return fail('booking_not_found');
      }

      let slotStartTime = new Date().toISOString();
      let serviceId = String(booking.service_id);
      let branchId = String(booking.branch_id);

      if (booking.slot_id) {
        const { data: slot } = await supabase
          .from('time_slots')
          .select('id, service_id, branch_id, start_time')
          .eq('id', booking.slot_id)
          .maybeSingle();

        if (slot) {
          slotStartTime = String(slot.start_time);
          serviceId = String(slot.service_id);
          branchId = String(slot.branch_id);
        }

        await supabase.from('time_slots').update({ status: 'available' }).eq('id', booking.slot_id);
      }

      await supabase
        .from('bookings')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', params.bookingRef);

      if (booking.slot_id) {
        emitBookingCancelled({
          bookingId: params.bookingRef,
          slotId: String(booking.slot_id),
          serviceId,
          branchId,
          startTime: slotStartTime,
          cancellationSource: 'agent',
        });
      }
    }

    return ok({ bookingId: params.bookingRef });
  } catch (error) {
    console.error('cancelBooking failed', error);
    return fail('booking_cancel_failed');
  }
}

export async function fetchBooking(params: {
  bookingRef: string;
}): Promise<ToolResult<{ booking: BookingRecord }>> {
  const parsed = FetchBookingParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_fetch_booking_params');
  }

  try {
    if (supabase) {
const { data: booking } = await supabase
  .from('bookings')
  .select(`
    id,
    visitor_name,
    visitor_contact,
    client_id,
    service_id,
    status,
    payment_status,
    payment_type,
    deposit_amount_aed,
    balance_due_aed,
    branch:branches ( id, name, city ),
    artist:artists ( id, name, role ),
    slot:time_slots ( id, start_time, end_time )
  `)
  .eq('id', params.bookingRef)
  .maybeSingle();

      if (!booking) {
        return fail('booking_not_found');
      }

      return ok({ booking: booking as unknown as BookingRecord });
    }

    return fail('booking_not_found');
  } catch (error) {
    console.error('fetchBooking failed', error);
    return fail('booking_fetch_failed');
  }
}
