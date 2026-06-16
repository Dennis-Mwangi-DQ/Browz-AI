import { z } from 'zod';
import { addDays, salonDayBoundsUtc, toIsoDate, SALON_TIMEZONE } from '../lib/dates';
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
  const status = String(row.status ?? 'available') as TimeSlot['status'];
  return {
    id: String(row.id),
    branchId: String(row.branch_id),
    serviceId: String(row.service_id),
    artistId: row.artist_id ? String(row.artist_id) : null,
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    status,
    isWalkin: status === 'open_for_walkin',
  };
}

/** Convert a UTC ISO instant to a salon-local YYYY-MM-DD string. */
function toSalonLocalDate(isoTime: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SALON_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoTime));
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
    const { startIso, endIso } = salonDayBoundsUtc(params.date);

    let query = supabase
      .from('time_slots')
      .select('*')
      .in('status', ['available', 'open_for_walkin'])
      .eq('service_id', params.serviceId)
      .eq('branch_id', params.branchId)
      .gte('start_time', startIso)
      .lte('start_time', endIso)
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

/**
 * Scan the next `lookAheadDays` days (starting the day after `fromDate`) and
 * return up to `maxDates` distinct salon-local dates that have available slots.
 * Used by search_availability to give the agent a "next available" hint instead
 * of letting it loop day by day.
 */
export async function queryNextAvailableDates(params: {
  serviceId: string;
  branchId: string;
  fromDate: string;
  artistId?: string;
  lookAheadDays?: number;
  maxDates?: number;
}): Promise<string[]> {
  if (!supabase) return [];

  const lookAhead = params.lookAheadDays ?? 14;
  const maxDates = params.maxDates ?? 3;

  const startDate = new Date(`${params.fromDate}T00:00:00Z`);
  const rangeStart = salonDayBoundsUtc(toIsoDate(addDays(startDate, 1))).startIso;
  const rangeEnd = salonDayBoundsUtc(toIsoDate(addDays(startDate, lookAhead))).endIso;

  try {
    let query = supabase
      .from('time_slots')
      .select('start_time')
      .in('status', ['available', 'open_for_walkin'])
      .eq('service_id', params.serviceId)
      .eq('branch_id', params.branchId)
      .gte('start_time', rangeStart)
      .lte('start_time', rangeEnd)
      .order('start_time', { ascending: true })
      .limit(lookAhead * 4);

    if (params.artistId) {
      query = query.eq('artist_id', params.artistId);
    }

    const { data } = await query;
    if (!data?.length) return [];

    const seen = new Set<string>();
    for (const row of data) {
      const localDate = toSalonLocalDate(String(row.start_time));
      seen.add(localDate);
      if (seen.size >= maxDates) break;
    }

    return [...seen];
  } catch {
    return [];
  }
}
