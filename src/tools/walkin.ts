import { z } from 'zod';
import { supabase } from '../db/supabaseClient';
import { fail, ok } from '../lib/result';
import { normalizePhoneNumber } from '../lib/phone';
import { createBooking } from './bookings';
import type { ToolResult } from '../types';

const RegisterWalkinParams = z.object({
  slotId: z.string().uuid(),
  visitorName: z.string().min(1),
  visitorContact: z.string().min(1),
  serviceId: z.string().min(1),
  branchId: z.string().min(1),
  notes: z.string().optional(),
});

export async function registerWalkin(params: {
  slotId: string;
  visitorName: string;
  visitorContact: string;
  serviceId: string;
  branchId: string;
  notes?: string;
}): Promise<ToolResult<{ bookingId: string }>> {
  const parsed = RegisterWalkinParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_walkin_params');
  }

  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const { data: slot } = await supabase
      .from('time_slots')
      .select('status, artist_id')
      .eq('id', params.slotId)
      .maybeSingle();

    if (!slot) {
      return fail('slot_not_found');
    }

    const status = String(slot.status);
    if (status !== 'open_for_walkin' && status !== 'available') {
      return fail('slot_not_available_for_walkin');
    }

    const result = await createBooking({
      clientId: null,
      visitorName: params.visitorName,
      visitorContact: normalizePhoneNumber(params.visitorContact) ?? params.visitorContact,
      serviceId: params.serviceId,
      branchId: params.branchId,
      slotId: params.slotId,
      artistId: slot.artist_id ? String(slot.artist_id) : undefined,
      notes: params.notes,
      channel: 'web',
      bookingSource: 'walkin_staff',
    });

    if (!result.success || !result.data) {
      return fail(result.error ?? 'walkin_registration_failed');
    }

    return ok({ bookingId: result.data.bookingId });
  } catch (error) {
    console.error('registerWalkin failed', error);
    return fail('walkin_registration_failed');
  }
}
