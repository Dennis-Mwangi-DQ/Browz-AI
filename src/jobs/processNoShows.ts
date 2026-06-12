import { supabase } from '../db/supabaseClient';
import { getEnv } from '../lib/env';
import { fail, ok } from '../lib/result';
import { recordNoShow } from '../tools/noShow';
import type { ToolResult } from '../types';

type BookingRow = Record<string, unknown>;

function subtractMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() - minutes * 60 * 1000);
}

export async function processNoShows(params: {
  now?: Date;
} = {}): Promise<ToolResult<{ processed: number }>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  const cutoff = subtractMinutes(
    params.now ?? new Date(),
    getEnv().NO_SHOW_GRACE_MINUTES,
  ).toISOString();

  const { data, error } = await supabase
    .from('bookings')
    .select('id, time_slots!inner(start_time)')
    .in('status', ['confirmed', 'no_show_risk'])
    .eq('check_in_recorded', false)
    .lt('time_slots.start_time', cutoff);

  if (error) {
    console.error('processNoShows lookup failed', error);
    return fail('no_show_processing_failed');
  }

  const rows = (data ?? []) as BookingRow[];
  for (const row of rows) {
    const result = await recordNoShow({ bookingId: String(row.id) });
    if (!result.success) {
      return fail(result.error ?? 'no_show_processing_failed');
    }
  }

  return ok({ processed: rows.length });
}
