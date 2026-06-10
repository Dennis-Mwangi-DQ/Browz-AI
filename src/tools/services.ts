import { supabase } from '../db/supabaseClient';
import { fail, ok } from '../lib/result';
import type { ToolResult } from '../types';
import { findServiceByName, findBranchByName } from '../lib/catalog';

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

export async function listBranchesForService(params: {
  service: string;
}): Promise<ToolResult<Array<{ id: string; name: string; city: string; address: string }>>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const service = await findServiceByName(params.service);
    if (!service) {
      return fail('service_not_found');
    }

    // 1. Query active artists offering this service to find branches
    const { data: artists, error: aErr } = await supabase
      .from('artists')
      .select('branch_id')
      .eq('active', true)
      .filter('service_ids', 'cs', `{"${service.id}"}`);

    if (aErr) {
      console.error('listBranchesForService artists lookup failed', aErr);
      return fail('branches_lookup_failed');
    }

    // 2. Query time slots offering this service to find branches
    const { data: slots, error: sErr } = await supabase
      .from('time_slots')
      .select('branch_id')
      .eq('service_id', service.id)
      .eq('status', 'available');

    if (sErr) {
      console.error('listBranchesForService slots lookup failed', sErr);
      return fail('branches_lookup_failed');
    }

    const artistBranchIds = (artists ?? []).map((a) => String(a.branch_id)).filter(Boolean);
    const slotBranchIds = (slots ?? []).map((s) => String(s.branch_id)).filter(Boolean);
    const branchIds = Array.from(new Set([...artistBranchIds, ...slotBranchIds]));

    if (!branchIds.length) {
      return ok([]);
    }

    const { data: branches, error: bErr } = await supabase
      .from('branches')
      .select('id, name, city, address')
      .in('id', branchIds)
      .eq('status', 'open');

    if (bErr) {
      console.error('listBranchesForService branches fetch failed', bErr);
      return fail('branches_lookup_failed');
    }

    return ok(
      (branches ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        city: String(row.city),
        address: String(row.address ?? ''),
      })),
    );
  } catch (error) {
    console.error('listBranchesForService failed', error);
    return fail('branches_lookup_failed');
  }
}

export async function listArtistsForServiceAtBranch(params: {
  service: string;
  branch: string;
}): Promise<ToolResult<Array<{ id: string; name: string; role: string | null; title: string | null }>>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const service = await findServiceByName(params.service);
    if (!service) {
      return fail('service_not_found');
    }

    const branch = await findBranchByName(params.branch);
    if (!branch) {
      return fail('branch_not_found');
    }

    const { data: artists, error } = await supabase
      .from('artists')
      .select('id, name, role, title')
      .eq('branch_id', branch.id)
      .eq('active', true)
      .filter('service_ids', 'cs', `{"${service.id}"}`);

    if (error) {
      console.error('listArtistsForServiceAtBranch failed', error);
      return fail('artists_lookup_failed');
    }

    return ok(
      (artists ?? []).map((row) => ({
        id: String(row.id),
        name: String(row.name),
        role: row.role ? String(row.role) : null,
        title: row.title ? String(row.title) : null,
      })),
    );
  } catch (error) {
    console.error('listArtistsForServiceAtBranch failed', error);
    return fail('artists_lookup_failed');
  }
}
