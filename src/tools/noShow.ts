import { z } from 'zod';
import { resolvePaymentRule, type BookingType } from '../agent/paymentRules';
import { supabase } from '../db/supabaseClient';
import { getEnv } from '../lib/env';
import { getServiceById } from '../lib/catalog';
import { sendWhatsAppMessage } from '../lib/messaging';
import { normalizePhoneNumber } from '../lib/phone';
import { fail, ok } from '../lib/result';
import { invokeCancellationRecovery } from '../lib/recoveryHook';
import type { NoShowFlag, PaymentRule, SessionContext, ToolResult } from '../types';

const ResolveDepositParams = z.object({
  serviceId: z.string().min(1),
  bookingType: z.enum(['single', 'consultation', 'package_first_session']).default('single'),
  clientId: z.string().uuid().optional().nullable(),
});

const ConfirmAppointmentParams = z.object({
  bookingRef: z.string().min(1),
  clientId: z.string().uuid().optional().nullable(),
  visitorContact: z.string().optional().nullable(),
});

const RecordNoShowParams = z.object({
  bookingId: z.string().min(1),
});

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

function contactCandidates(contact?: string | null): string[] {
  if (!contact) {
    return [];
  }

  return [contact, normalizePhoneNumber(contact)].filter(
    (value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index,
  );
}

function money(value: unknown): number {
  return Number(value ?? 0);
}

function isForfeitedAt(appointmentTime: string, now = new Date()): boolean {
  const forfeitureMs = getEnv().DEPOSIT_FORFEITURE_WINDOW_HOURS * 60 * 60 * 1000;
  return now.getTime() >= new Date(appointmentTime).getTime() - forfeitureMs;
}

function canForfeitDeposit(row: BookingRow): boolean {
  const paymentStatus = String(row.payment_status ?? '');
  return (
    money(row.deposit_amount_aed) > 0 &&
    (paymentStatus === 'deposit_paid' || paymentStatus === 'paid')
  );
}

async function fetchBookingForNoShow(bookingId: string): Promise<BookingRow | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('bookings')
    .select(
      [
        '*',
        'time_slots(start_time,end_time)',
        'clients(name,phone,no_show_count,no_show_flag)',
        'services(title)',
        'branches(name)',
      ].join(','),
    )
    .eq('id', bookingId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error('fetchBookingForNoShow failed', error);
    }
    return null;
  }

  return data as unknown as BookingRow;
}

export async function getClientNoShowFlag(clientId?: string | null): Promise<NoShowFlag | null> {
  if (!clientId || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('clients')
    .select('no_show_count, no_show_flag, no_show_flag_set_at, no_show_flag_lifted_at')
    .eq('id', clientId)
    .maybeSingle();

  if (error || !data) {
    if (error) {
      console.error('getClientNoShowFlag failed', error);
    }
    return null;
  }

  return {
    status: String(data.no_show_flag ?? 'none') as NoShowFlag['status'],
    noShowCount: Number(data.no_show_count ?? 0),
    setAt: data.no_show_flag_set_at ? String(data.no_show_flag_set_at) : null,
    liftedAt: data.no_show_flag_lifted_at ? String(data.no_show_flag_lifted_at) : null,
  };
}

export async function getNoShowFlag(
  clientId: string,
): Promise<ToolResult<NoShowFlag | null>> {
  if (!clientId) {
    return fail('client_id_required');
  }

  return ok(await getClientNoShowFlag(clientId));
}

export async function resolveDepositRule(params: {
  serviceId: string;
  bookingType?: BookingType;
  clientId?: string | null;
}): Promise<ToolResult<PaymentRule>> {
  const parsed = ResolveDepositParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_resolve_deposit_rule_params');
  }

  const service = await getServiceById(parsed.data.serviceId);
  if (!service) {
    return fail('service_not_found');
  }

  const flag = await getClientNoShowFlag(parsed.data.clientId);
  return ok(resolvePaymentRule(service, parsed.data.bookingType, flag));
}

export async function confirmAppointment(params: {
  bookingRef: string;
  clientId?: string | null;
  visitorContact?: string | null;
}): Promise<ToolResult<{ bookingId: string }>> {
  const parsed = ConfirmAppointmentParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_confirm_appointment_params');
  }

  if (!supabase) {
    return fail('supabase_not_configured');
  }

  let query = supabase.from('bookings').select('id').eq('id', parsed.data.bookingRef);
  if (parsed.data.clientId) {
    query = query.eq('client_id', parsed.data.clientId);
  } else {
    const contacts = contactCandidates(parsed.data.visitorContact);
    if (!contacts.length) {
      return fail('booking_identity_required');
    }
    query = query.in('visitor_contact', contacts);
  }

  const { data: booking, error: lookupError } = await query.maybeSingle();
  if (lookupError) {
    console.error('confirmAppointment lookup failed', lookupError);
    return fail('confirm_appointment_failed');
  }
  if (!booking) {
    return fail('booking_not_found');
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('bookings')
    .update({
      reconfirmation_status: 'confirmed',
      reconfirmed_at: now,
      updated_at: now,
    })
    .eq('id', parsed.data.bookingRef);

  if (error) {
    console.error('confirmAppointment update failed', error);
    return fail('confirm_appointment_failed');
  }

  await supabase.from('reminder_log').insert({
    booking_id: parsed.data.bookingRef,
    client_id: parsed.data.clientId ?? null,
    channel: 'whatsapp',
    reminder_type: 'reconfirmation_nudge',
    sent_at: now,
    delivered: true,
    response: 'YES',
    responded_at: now,
  });

  return ok({ bookingId: parsed.data.bookingRef });
}

export async function findPendingReconfirmation(params: {
  clientId?: string | null;
  contact?: string | null;
}): Promise<ToolResult<{ bookingId: string } | null>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  let query = supabase
    .from('bookings')
    .select('id')
    .eq('reconfirmation_status', 'pending')
    .in('status', ['confirmed', 'no_show_risk'])
    .limit(2);

  if (params.clientId) {
    query = query.eq('client_id', params.clientId);
  } else {
    const contacts = contactCandidates(params.contact);
    if (!contacts.length) {
      return ok(null);
    }
    query = query.in('visitor_contact', contacts);
  }

  const { data, error } = await query;
  if (error) {
    console.error('findPendingReconfirmation failed', error);
    return fail('pending_reconfirmation_lookup_failed');
  }

  if (!data || data.length !== 1) {
    return ok(null);
  }

  const first = data[0] as { id: unknown } | undefined;
  return first ? ok({ bookingId: String(first.id) }) : ok(null);
}

export async function cancelFromReconfirmation(params: {
  bookingRef: string;
  clientId?: string | null;
  visitorContact?: string | null;
  now?: Date;
}): Promise<ToolResult<{
  bookingId: string;
  depositAmountAed: number;
  depositForfeited: boolean;
}>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  const row = await fetchBookingForNoShow(params.bookingRef);
  if (!row) {
    return fail('booking_not_found');
  }

  if (params.clientId && String(row.client_id ?? '') !== params.clientId) {
    return fail('booking_not_found');
  }

  if (!params.clientId) {
    const contacts = contactCandidates(params.visitorContact);
    if (!contacts.includes(String(row.visitor_contact ?? ''))) {
      return fail('booking_not_found');
    }
  }

  const slot = related(row, 'time_slots');
  const appointmentTime = String(slot?.start_time ?? '');
  const depositForfeited = appointmentTime
    ? canForfeitDeposit(row) && isForfeitedAt(appointmentTime, params.now)
    : false;
  const now = new Date().toISOString();

  const update: Record<string, unknown> = {
    status: 'cancelled',
    deposit_forfeited: depositForfeited,
    updated_at: now,
  };
  if (depositForfeited) {
    update.payment_status = 'forfeited';
  }

  const { error } = await supabase
    .from('bookings')
    .update(update)
    .eq('id', params.bookingRef);
  if (error) {
    console.error('cancelFromReconfirmation update failed', error);
    return fail('booking_cancel_failed');
  }

  const slotId = row.slot_id ? String(row.slot_id) : null;
  if (slotId) {
    await supabase.from('time_slots').update({ status: 'available' }).eq('id', slotId);
  }

  await supabase.from('reminder_log').insert({
    booking_id: params.bookingRef,
    client_id: params.clientId ?? null,
    channel: 'whatsapp',
    reminder_type: 'reconfirmation_nudge',
    sent_at: now,
    delivered: true,
    response: 'NO',
    responded_at: now,
  });

  await invokeCancellationRecovery({
    bookingId: params.bookingRef,
    slotId,
    serviceId: row.service_id ? String(row.service_id) : null,
    branchId: row.branch_id ? String(row.branch_id) : null,
    reason: 'cancelled',
  });

  return ok({
    bookingId: params.bookingRef,
    depositAmountAed: money(row.deposit_amount_aed),
    depositForfeited,
  });
}

export async function handleReconfirmationReply(params: {
  message: string;
  session: SessionContext;
}): Promise<{ handled: boolean; response?: string }> {
  const normalized = params.message.trim().toLowerCase();
  const isYes = ['yes', 'y', 'confirm', "confirm i'll be there", 'i will be there'].includes(normalized);
  const isNo = ['no', 'n', 'cancel', 'i need to cancel'].includes(normalized);

  if (!isYes && !isNo) {
    return { handled: false };
  }

  const contact =
    params.session.whatsappNumber ??
    params.session.agentContext?.visitorContact ??
    null;
  const pending = await findPendingReconfirmation({
    clientId: params.session.clientId,
    contact,
  });

  if (!pending.success || !pending.data) {
    return { handled: false };
  }

  if (isYes) {
    const result = await confirmAppointment({
      bookingRef: pending.data.bookingId,
      clientId: params.session.clientId,
      visitorContact: contact,
    });
    if (!result.success) {
      return { handled: false };
    }

    return {
      handled: true,
      response: "You're all set - see you at your appointment. If anything changes, just message us here.",
    };
  }

  const result = await cancelFromReconfirmation({
    bookingRef: pending.data.bookingId,
    clientId: params.session.clientId,
    visitorContact: contact,
  });
  if (!result.success || !result.data) {
    return { handled: false };
  }

  const depositText = result.data.depositAmountAed > 0
    ? result.data.depositForfeited
      ? ` As your appointment is within the cancellation window, the deposit of AED ${result.data.depositAmountAed} is non-refundable per our cancellation policy.`
      : ` Your deposit of AED ${result.data.depositAmountAed} will be flagged for refund by the team.`
    : '';

  return {
    handled: true,
    response: `No problem - your booking has been cancelled.${depositText}`,
  };
}

export async function recordNoShow(params: {
  bookingId: string;
}): Promise<ToolResult<{
  bookingId: string;
  noShowCountAtEvent: number | null;
  flagTriggered: boolean;
  followUpSent: boolean;
}>> {
  const parsed = RecordNoShowParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_record_no_show_params');
  }

  if (!supabase) {
    return fail('supabase_not_configured');
  }

  const row = await fetchBookingForNoShow(parsed.data.bookingId);
  if (!row) {
    return fail('booking_not_found');
  }

  const clientId = row.client_id ? String(row.client_id) : null;
  const visitorContact = row.visitor_contact ? String(row.visitor_contact) : null;
  const slot = related(row, 'time_slots');
  const client = related(row, 'clients');
  const service = related(row, 'services');
  const appointmentTime = String(slot?.start_time ?? new Date().toISOString());
  const depositForfeited = canForfeitDeposit(row);
  const now = new Date().toISOString();

  const update: Record<string, unknown> = {
    status: 'no_show',
    deposit_forfeited: depositForfeited,
    updated_at: now,
  };
  if (depositForfeited) {
    update.payment_status = 'forfeited';
  }

  const { error: bookingUpdateError } = await supabase
    .from('bookings')
    .update(update)
    .eq('id', parsed.data.bookingId);
  if (bookingUpdateError) {
    console.error('recordNoShow booking update failed', bookingUpdateError);
    return fail('record_no_show_failed');
  }

  let noShowCountAtEvent: number | null = null;
  let flagTriggered = false;

  if (clientId) {
    const currentCount = Number(client?.no_show_count ?? 0);
    const nextCount = currentCount + 1;
    const clientUpdate: Record<string, unknown> = {
      no_show_count: nextCount,
      updated_at: now,
    };

    if (nextCount >= getEnv().NO_SHOW_FLAG_THRESHOLD) {
      clientUpdate.no_show_flag = 'active';
      clientUpdate.no_show_flag_set_at = now;
      flagTriggered = true;
    }

    const { error: clientUpdateError } = await supabase
      .from('clients')
      .update(clientUpdate)
      .eq('id', clientId);
    if (clientUpdateError) {
      console.error('recordNoShow client update failed', clientUpdateError);
      return fail('record_no_show_failed');
    }

    noShowCountAtEvent = nextCount;
  }

  const followUpBody = flagTriggered
    ? `Hi ${String(client?.name ?? 'there')}, this is the second appointment you've missed with us.\n\nGoing forward, full payment will be required at the time of booking. This helps us keep slots available for all our clients.\n\nWe'd love to have you back - just message us here when you're ready to book.`
    : `Hi ${String(client?.name ?? 'there')}, we noticed you weren't able to make your ${String(service?.title ?? 'Browz')} appointment today.\n\nWe hope everything is okay. When you're ready to rebook, just message us here.${depositForfeited ? `\n\nPlease note: your deposit of AED ${money(row.deposit_amount_aed)} has been forfeited as per our cancellation policy.` : ''}`;

  const contact = String(client?.phone ?? visitorContact ?? '');
  const followUp = contact
    ? await sendWhatsAppMessage({ to: contact, body: followUpBody })
    : { sent: false };

  await supabase.from('no_show_log').insert({
    booking_id: parsed.data.bookingId,
    client_id: clientId,
    visitor_contact: visitorContact,
    service_id: row.service_id ? String(row.service_id) : null,
    branch_id: row.branch_id ? String(row.branch_id) : null,
    appointment_time: appointmentTime,
    reconfirmation_status: row.reconfirmation_status ? String(row.reconfirmation_status) : null,
    deposit_amount_aed: money(row.deposit_amount_aed),
    deposit_forfeited: depositForfeited,
    flag_triggered: flagTriggered,
    no_show_count_at_event: noShowCountAtEvent,
    follow_up_sent: followUp.sent,
    follow_up_sent_at: followUp.sent ? now : null,
  });

  if (followUp.sent) {
    await supabase.from('reminder_log').insert({
      booking_id: parsed.data.bookingId,
      client_id: clientId,
      channel: 'whatsapp',
      reminder_type: 'no_show_followup',
      sent_at: now,
      delivered: true,
    });
  }

  await invokeCancellationRecovery({
    bookingId: parsed.data.bookingId,
    slotId: row.slot_id ? String(row.slot_id) : null,
    serviceId: row.service_id ? String(row.service_id) : null,
    branchId: row.branch_id ? String(row.branch_id) : null,
    reason: 'no_show',
  });

  return ok({
    bookingId: parsed.data.bookingId,
    noShowCountAtEvent,
    flagTriggered,
    followUpSent: followUp.sent,
  });
}
