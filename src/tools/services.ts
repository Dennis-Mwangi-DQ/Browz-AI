import { supabase } from '../db/supabaseClient';
import { fail, ok } from '../lib/result';
import type { ToolResult } from '../types';
import { findServiceByName, findBranchByName } from '../lib/catalog';

type BranchSummary = { id: string; name: string; city: string; address: string };

function artistOffersService(serviceIds: unknown, serviceId: string): boolean {
  if (!Array.isArray(serviceIds)) {
    return false;
  }
  return serviceIds.map(String).includes(serviceId);
}

async function fetchBookableBranches(): Promise<BranchSummary[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from('branches')
    .select('id, name, city, address')
    .neq('status', 'closed')
    .order('name', { ascending: true });

  if (error) {
    console.error('fetchBookableBranches failed', error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    city: String(row.city),
    address: String(row.address ?? ''),
  }));
}

async function resolveBranchesForService(serviceId: string): Promise<BranchSummary[]> {
  if (!supabase) {
    return [];
  }

  const branchIds = new Set<string>();

  const { data: artists, error: artistError } = await supabase
    .from('artists')
    .select('branch_id, service_ids')
    .eq('active', true);

  if (artistError) {
    console.error('resolveBranchesForService artists lookup failed', artistError);
    return [];
  }

  for (const artist of artists ?? []) {
    if (!artistOffersService(artist.service_ids, serviceId)) {
      continue;
    }
    const branchId = String(artist.branch_id ?? '');
    if (branchId) {
      branchIds.add(branchId);
    }
  }

  const { data: slots, error: slotError } = await supabase
    .from('time_slots')
    .select('branch_id')
    .eq('service_id', serviceId)
    .eq('status', 'available');

  if (slotError) {
    console.error('resolveBranchesForService slots lookup failed', slotError);
  } else {
    for (const slot of slots ?? []) {
      const branchId = String(slot.branch_id ?? '');
      if (branchId) {
        branchIds.add(branchId);
      }
    }
  }

  if (!branchIds.size) {
    return [];
  }

  const bookableBranches = await fetchBookableBranches();
  return bookableBranches.filter((branch) => branchIds.has(branch.id));
}

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
}): Promise<ToolResult<BranchSummary[]>> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const service = await findServiceByName(params.service);
    if (!service) {
      return fail('service_not_found');
    }

    return ok(await resolveBranchesForService(service.id));
  } catch (error) {
    console.error('listBranchesForService failed', error);
    return fail('branches_lookup_failed');
  }
}

export async function listServiceLocations(): Promise<
  ToolResult<
    Array<{
      serviceId: string;
      serviceName: string;
      category: string;
      priceAed: number;
      branches: BranchSummary[];
    }>
  >
> {
  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const [{ data: services, error: serviceError }, { data: artists, error: artistError }] =
      await Promise.all([
        supabase
          .from('services')
          .select('id, title, cat, price_aed')
          .eq('active', true)
          .order('title', { ascending: true }),
        supabase.from('artists').select('branch_id, service_ids').eq('active', true),
      ]);

    if (serviceError) {
      console.error('listServiceLocations services lookup failed', serviceError);
      return fail('services_lookup_failed');
    }

    if (artistError) {
      console.error('listServiceLocations artists lookup failed', artistError);
      return fail('branches_lookup_failed');
    }

    const bookableBranches = await fetchBookableBranches();
    const branchMap = new Map(bookableBranches.map((branch) => [branch.id, branch]));
    const serviceBranchIds = new Map<string, Set<string>>();

    for (const artist of artists ?? []) {
      const branchId = String(artist.branch_id ?? '');
      if (!branchId || !branchMap.has(branchId)) {
        continue;
      }

      const offeredServiceIds = Array.isArray(artist.service_ids)
        ? artist.service_ids.map(String)
        : [];

      for (const serviceId of offeredServiceIds) {
        const existing = serviceBranchIds.get(serviceId) ?? new Set<string>();
        existing.add(branchId);
        serviceBranchIds.set(serviceId, existing);
      }
    }

    return ok(
      (services ?? []).map((row) => {
        const serviceId = String(row.id);
        const branchIds = serviceBranchIds.get(serviceId) ?? new Set<string>();
        const branches = [...branchIds]
          .map((branchId) => branchMap.get(branchId))
          .filter((branch): branch is BranchSummary => Boolean(branch));

        return {
          serviceId,
          serviceName: String(row.title ?? ''),
          category: String(row.cat ?? ''),
          priceAed: Number(row.price_aed ?? 0),
          branches,
        };
      }),
    );
  } catch (error) {
    console.error('listServiceLocations failed', error);
    return fail('service_locations_lookup_failed');
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
      .select('id, name, role, title, service_ids')
      .eq('branch_id', branch.id)
      .eq('active', true);

    if (error) {
      console.error('listArtistsForServiceAtBranch failed', error);
      return fail('artists_lookup_failed');
    }

    return ok(
      (artists ?? [])
        .filter((row) => artistOffersService(row.service_ids, service.id))
        .map((row) => ({
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
