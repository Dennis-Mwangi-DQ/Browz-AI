import { z } from 'zod';
import { supabase } from '../db/supabaseClient';
import { fail, ok } from '../lib/result';
import type { TimeSlot, ToolResult } from '../types';

const AvailabilityParams = z.object({
  serviceId: z.string().min(1),
  branchId: z.string().min(1),
  date: z.string().min(1),
  artistId: z.string().optional(),
});

function mapSlot(row: Record<string, unknown>): TimeSlot {
  return {
    id: String(row.id),
    branchId: String(row.branch_id),
    serviceId: String(row.service_id),
    artistId: row.artist_id ? String(row.artist_id) : null,
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    status: String(row.status ?? 'available') as TimeSlot['status'],
  };
}

export async function queryAvailability(params: {
  serviceId: string;
  branchId: string;
  date: string;
  artistId?: string;
}): Promise<ToolResult<TimeSlot[]>> {
  const parsed = AvailabilityParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_availability_params');
  }

  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    let query = supabase
      .from('time_slots')
      .select('*')
      .eq('status', 'available')
      .eq('service_id', params.serviceId)
      .eq('branch_id', params.branchId)
      .gte('start_time', `${params.date}T00:00:00.000Z`)
      .lt('start_time', `${params.date}T23:59:59.999Z`)
      .order('start_time', { ascending: true })
      .limit(6);

    if (params.artistId) {
      query = query.eq('artist_id', params.artistId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('queryAvailability failed', error);
      return fail('availability_lookup_failed');
    }

    return ok((data ?? []).map((slot) => mapSlot(slot)));
  } catch (error) {
    console.error('queryAvailability failed', error);
    return fail('availability_lookup_failed');
  }
}
