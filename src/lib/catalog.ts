import { getEnv } from './env';
import { resolveGateCategory } from './serviceMetadata';
import { supabase } from '../db/supabaseClient';
import type { Artist, Branch, Service } from '../types';

function mapService(row: Record<string, unknown>): Service {
  const baseService = {
    id: String(row.id),
    name: String(row.title ?? row.name ?? ''),
    category: String(row.cat ?? row.category ?? ''),
    serviceTier: String(row.service_tier ?? 'T1') as Service['serviceTier'],
    city: row.city ? String(row.city) : null,
    durationMinutes: Number(row.duration_min ?? row.duration_minutes ?? 0),
    priceAed: Number(row.price_aed ?? 0),
    requiresConsultation: Boolean(row.requires_consultation),
    requiresPatchTest: Boolean(row.requires_patch_test),
    requiresScreening: Boolean(row.requires_screening),
    isMedicalGated: Boolean(row.is_medical_gated ?? row.is_medical),
    minFrequencyWeeks: row.min_frequency_weeks == null ? null : Number(row.min_frequency_weeks),
    frequencyHardBlock: Boolean(row.frequency_hard_block),
    description: String(row.description ?? ''),
  } satisfies Omit<Service, 'gateCategory'>;

  return {
    ...baseService,
    gateCategory: resolveGateCategory(baseService),
  };
}

function mapBranch(row: Record<string, unknown>): Branch {
  return {
    id: String(row.id),
    name: String(row.name),
    city: String(row.city ?? row.location ?? ''),
    address: String(row.address ?? ''),
    phone: String(row.phone ?? ''),
    hours: (row.hours as Record<string, string> | undefined) ?? {},
    categories: Array.isArray(row.categories) ? (row.categories as string[]) : [],
    status: row.status ? String(row.status) : 'open',
  };
}

export async function getServiceById(serviceId: string): Promise<Service | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('services')
    .select('*')
    .eq('id', serviceId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapService(data);
}

export async function findServiceByName(name?: string): Promise<Service | null> {
  if (!name || !supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('services')
    .select('*')
    .ilike('title', `%${name}%`)
    .limit(1);

  if (error || !data?.length) {
    return null;
  }

  return mapService(data[0] as Record<string, unknown>);
}

export async function getBranchById(branchId: string): Promise<Branch | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('id', branchId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return mapBranch(data);
}

export async function getDefaultBranch(): Promise<Branch | null> {
  if (!supabase) {
    return null;
  }

  const configured = getEnv('DEFAULT_BRANCH_ID');
  if (configured) {
    const branch = await getBranchById(configured);
    if (branch) {
      return branch;
    }
  }

  const { data, error } = await supabase.from('branches').select('*').limit(1).maybeSingle();
  if (error || !data) {
    return null;
  }

  return mapBranch(data);
}

export async function findBranchByName(name?: string): Promise<Branch | null> {
  if (!supabase) {
    return null;
  }

  if (!name) {
    return getDefaultBranch();
  }

  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .or(`name.ilike.%${name}%,city.ilike.%${name}%`)
    .limit(1);

  if (error || !data?.length) {
    return getDefaultBranch();
  }

  return mapBranch(data[0] as Record<string, unknown>);
}

function mapArtist(row: Record<string, unknown>): Artist {
  return {
    id: String(row.id),
    name: String(row.name),
    role: row.role ? String(row.role) : null,
    title: row.title ? String(row.title) : null,
    branchId: String(row.branch_id),
    serviceIds: Array.isArray(row.service_ids) ? (row.service_ids as string[]) : [],
  };
}

export async function findArtistByName(name?: string, branchId?: string): Promise<Artist | null> {
  if (!name || !supabase) {
    return null;
  }

  let query = supabase
    .from('artists')
    .select('*')
    .ilike('name', `%${name}%`)
    .eq('active', true);

  if (branchId) {
    query = query.eq('branch_id', branchId);
  }

  const { data, error } = await query.limit(1);
  if (error || !data?.length) {
    return null;
  }

  return mapArtist(data[0] as Record<string, unknown>);
}
