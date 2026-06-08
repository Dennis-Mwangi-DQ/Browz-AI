import { supabase } from '../db/supabaseClient';
import { fail, ok } from '../lib/result';
import type { ToolResult } from '../types';

export async function listServices(): Promise<
  ToolResult<Array<{ id: string; name: string; category: string; priceAed: number }>>
> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const { data, error } = await supabase
      .from('services')
      .select('id, title, cat, price_aed')
      .eq('active', true)
      .order('title', { ascending: true });

    if (error) {
      console.error('listServices failed', error);
      return fail('services_lookup_failed');
    }

    return ok(
      (data ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.title ?? ''),
        category: String(row.cat ?? ''),
        priceAed: Number(row.price_aed ?? 0),
      })),
    );
  } catch (error) {
    console.error('listServices failed', error);
    return fail('services_lookup_failed');
  }
}
