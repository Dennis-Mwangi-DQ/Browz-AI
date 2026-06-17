import { z } from 'zod';
import { supabase } from '../db/supabaseClient';
import { generateSequenceId } from '../lib/ids';
import { normalizePhoneNumber } from '../lib/phone';
import { fail, ok } from '../lib/result';
import type { ConsultationRecord, TimeSlot, ToolResult } from '../types';

const ConsultationParams = z.object({
  clientId: z.string().uuid().nullable(),
  visitorName: z.string().optional(),
  visitorContact: z.string().optional(),
  serviceId: z.string().min(1),
  serviceCategory: z.string().min(1),
  branchId: z.string().min(1),
  slotId: z.string().min(1),
});

const FetchConsultationParams = z.object({
  consultationRef: z.string().min(1),
});

const CancelConsultationParams = z.object({
  consultationRef: z.string().min(1),
  clientId: z.string().uuid().nullable(),
});

const ModifyConsultationParams = z.object({
  consultationRef: z.string().min(1),
  newSlotId: z.string().min(1),
  clientId: z.string().uuid().nullable(),
});

const FetchTimeSlotParams = z.object({
  slotId: z.string().min(1),
});

async function fetchTimeSlot(slotId: string): Promise<TimeSlot | null> {
  if (!supabase) {
    return null;
  }
  const { data: slot } = await supabase.from('time_slots').select('*').eq('id', slotId).single();
  return slot;
}

export async function createConsultation(params: {
  clientId: string | null;
  visitorName?: string;
  visitorContact?: string;
  serviceId: string;
  serviceCategory: string;
  branchId: string;
  slotId: string;
}): Promise<ToolResult<{ consultationId: string }>> {
  const parsed = ConsultationParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_consultation_params');
  }

  try {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const consultationId = generateSequenceId('CON', datePart, Math.floor(Math.random() * 10000), 4);

    if (supabase) {
      const { error } = await supabase.from('consultation_requests').insert({
        id: consultationId,
        client_id: params.clientId,
        visitor_name: params.visitorName,
        visitor_contact: normalizePhoneNumber(params.visitorContact),
        service_id: params.serviceId,
        service_category: params.serviceCategory,
        branch_id: params.branchId,
        slot_id: params.slotId,
        status: 'booked',
      });

      if (error) {
        console.error('createConsultation insert failed', error);
        return fail('consultation_create_failed');
      }
    }

    return ok({ consultationId });
  } catch (error) {
    console.error('createConsultation failed', error);
    return fail('consultation_create_failed');
  }
}

export async function fetchConsultation(params: {
  consultationRef: string;
}): Promise<ToolResult<{ consultation: ConsultationRecord }>> {
  const parsed = FetchConsultationParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_consultation_params');
  }
  try {
    if (supabase) {
      const { data: consultation } = await supabase.from('consultation_requests').select('*').eq('id', params.consultationRef).single();
      return ok({ consultation });
    }
    return fail('consultation_not_found');
  } catch (error) {
    console.error('fetchConsultation failed', error);
    return fail('consultation_fetch_failed');
  }
}

export async function cancelConsultation(params: {
  consultationRef: string;
  clientId: string | null;
}): Promise<ToolResult<{ consultationRef: string }>> {
  const parsed = CancelConsultationParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_consultation_params');
  }
  try {
    if (supabase) {
      const { error } = await supabase.from('consultation_requests').update({ status: 'cancelled' }).eq('id', params.consultationRef).single();
      if (error) {
        console.error('cancelConsultation update failed', error);
        return fail('consultation_cancel_failed');
      }
    }
    return ok({ consultationRef: params.consultationRef });
  } catch (error) {
    console.error('cancelConsultation failed', error);
    return fail('consultation_cancel_failed');
  }
}

export async function modifyConsultation(params: {
  consultationRef: string;
  newSlotId: string;
  clientId: string | null;
}): Promise<ToolResult<{ consultationRef: string; newSlot: TimeSlot }>> {
  const parsed = ModifyConsultationParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_consultation_params');
  }
  const slot = await fetchTimeSlot(params.newSlotId);
    if (!slot || slot.status !== 'available') {
      return fail('slot_unavailable');
    }

  try {
    if (supabase) {
      const { data: consultation } = await supabase.from('consultation_requests').select('*').eq('id', params.consultationRef).single();
      if (!consultation) {
        return fail('consultation_not_found');
      }
      await supabase.from('time_slots').update({ status: 'available' }).eq('id', consultation.slot_id);
      await supabase.from('time_slots').update({ status: 'booked' }).eq('id', params.newSlotId); 
      await supabase.from('consultation_requests').update({ slot_id: params.newSlotId }).eq('id', params.consultationRef).single();
    }
    return ok({ consultationRef: params.consultationRef, newSlot: slot });
  } catch (error) {
    console.error('modifyConsultation failed', error);
    return fail('consultation_modify_failed');
  }
}