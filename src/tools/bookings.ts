import { z } from 'zod';
import { supabase } from '../db/supabaseClient';
import { resolvePaymentRule } from '../agent/paymentRules';
import { getServiceById } from '../lib/catalog';
import { generateSequenceId } from '../lib/ids';
import { normalizePhoneNumber } from '../lib/phone';
import { fail, ok } from '../lib/result';
import { generatePaymentLink } from './payment';
import { getClientNoShowFlag } from './noShow';
import type { PaymentRule, TimeSlot, ToolResult } from '../types';

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
});

const ModifyBookingParams = z.object({
  bookingRef: z.string().min(1),
  newSlotId: z.string().min(1),
  clientId: z.string().uuid(),
});

const CancelBookingParams = z.object({
  bookingRef: z.string().min(1),
  clientId: z.string().uuid(),
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
  };
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
}): Promise<ToolResult<{ bookingId: string; paymentRule: PaymentRule }>> {
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
    if (!slot || slot.status !== 'available') {
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
      });

      if (error) {
        console.error('createBooking insert failed', error);
        return fail('booking_create_failed');
      }

      await supabase.from('time_slots').update({ status: 'booked' }).eq('id', params.slotId);

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
      }
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
  clientId: string;
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
      const { data: booking } = await supabase
        .from('bookings')
        .select('id, slot_id, client_id')
        .eq('id', params.bookingRef)
        .eq('client_id', params.clientId)
        .maybeSingle();

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
  clientId: string;
}): Promise<ToolResult<{ bookingId: string }>> {
  const parsed = CancelBookingParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_cancel_booking_params');
  }

  try {
    if (supabase) {
      const { data: booking } = await supabase
        .from('bookings')
        .select('id, slot_id')
        .eq('id', params.bookingRef)
        .eq('client_id', params.clientId)
        .maybeSingle();

      if (!booking) {
        return fail('booking_not_found');
      }

      await supabase.from('bookings').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', params.bookingRef);
      if (booking.slot_id) {
        await supabase.from('time_slots').update({ status: 'available' }).eq('id', booking.slot_id);
      }
    }

    return ok({ bookingId: params.bookingRef });
  } catch (error) {
    console.error('cancelBooking failed', error);
    return fail('booking_cancel_failed');
  }
}
