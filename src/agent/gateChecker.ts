import { addWeeks, startOfTodayUtc, toIsoDate } from '../lib/dates';
import { getServiceById } from '../lib/catalog';
import { normalizePhoneNumber } from '../lib/phone';
import { supabase } from '../db/supabaseClient';
import type { FrequencyCheckResult, GateCheckResult } from '../types';

export type GateCheckContext = {
  visitorContact?: string | null;
  visitorName?: string | null;
  screeningRef?: string | null;
};

type MedicalScreeningRow = {
  status: string;
  approved_until: string | null;
  service_category: string;
};

function contactCandidates(contact?: string | null): string[] {
  if (!contact?.trim()) {
    return [];
  }
  const trimmed = contact.trim();
  const normalized = normalizePhoneNumber(trimmed);
  return [...new Set([trimmed, normalized].filter((value): value is string => Boolean(value)))];
}

function evaluateMedicalScreening(data: MedicalScreeningRow | null): GateCheckResult {
  if (!data) {
    return { gateCleared: false, reason: 'medical_screening_required' };
  }

  if (data.status === 'PENDING' || data.status === 'FLAGGED' || data.status === 'NEEDS_INFO') {
    return { gateCleared: false, reason: 'screening_under_review' };
  }

  if (
    data.status === 'APPROVED' &&
    data.approved_until &&
    new Date(data.approved_until) >= startOfTodayUtc()
  ) {
    return { gateCleared: true };
  }

  return { gateCleared: false, reason: 'medical_screening_required' };
}

async function findMedicalScreening(params: {
  clientId: string | null;
  serviceCategory: string;
  gateContext?: GateCheckContext;
}): Promise<MedicalScreeningRow | null> {
  if (!supabase) {
    return null;
  }

  const { clientId, serviceCategory, gateContext } = params;

  if (gateContext?.screeningRef) {
    const { data } = await supabase
      .from('medical_screenings')
      .select('status, approved_until, service_category')
      .eq('id', gateContext.screeningRef)
      .maybeSingle();

    if (data && String(data.service_category) === serviceCategory) {
      return data as MedicalScreeningRow;
    }
  }

  if (clientId) {
    const { data } = await supabase
      .from('medical_screenings')
      .select('status, approved_until, service_category')
      .eq('client_id', clientId)
      .eq('service_category', serviceCategory)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      return data as MedicalScreeningRow;
    }
  }

  const contacts = contactCandidates(gateContext?.visitorContact);
  if (contacts.length > 0) {
    const { data } = await supabase
      .from('medical_screenings')
      .select('status, approved_until, service_category')
      .in('visitor_contact', contacts)
      .eq('service_category', serviceCategory)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      return data as MedicalScreeningRow;
    }
  }

  return null;
}

export async function checkPreBookingRequirements(
  serviceId: string,
  clientId: string | null,
  gateContext?: GateCheckContext,
): Promise<GateCheckResult> {
  const service = await getServiceById(serviceId);
  if (!service) {
    return { gateCleared: false, reason: 'consultation_and_patch_test_required' };
  }

  if (service.serviceTier === 'T1') {
    return { gateCleared: true };
  }

  if (service.serviceTier === 'T2') {
    if (!clientId || !supabase) {
      return { gateCleared: false, reason: 'consultation_and_patch_test_required' };
    }

    const { data } = await supabase
      .from('spmu_clearances')
      .select('*')
      .eq('client_id', clientId)
      .eq('service_category', service.gateCategory)
      .gte('valid_until', new Date().toISOString())
      .order('valid_until', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.patch_test_done && data?.patch_test_cleared) {
      return { gateCleared: true };
    }

    return { gateCleared: false, reason: 'consultation_and_patch_test_required' };
  }

  const screening = await findMedicalScreening({
    clientId,
    serviceCategory: service.gateCategory,
    gateContext,
  });

  return evaluateMedicalScreening(screening);
}

export async function checkTreatmentFrequency(clientId: string, serviceId: string): Promise<FrequencyCheckResult> {
  const service = await getServiceById(serviceId);
  if (!service || service.minFrequencyWeeks == null || !supabase) {
    return { tooSoon: false };
  }

  const { data } = await supabase
    .from('bookings')
    .select('created_at, service_id')
    .eq('client_id', clientId)
    .in('status', ['completed', 'confirmed'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (!data || data.length === 0) {
    return { tooSoon: false };
  }

  const candidateDates = await Promise.all(
    data.map(async (booking) => {
      const bookedService = await getServiceById(String(booking.service_id));
      if (!bookedService || bookedService.gateCategory !== service.gateCategory) {
        return null;
      }
      return booking.created_at ? new Date(String(booking.created_at)) : null;
    }),
  );

  const lastAppointment = candidateDates.find(Boolean);
  if (!lastAppointment) {
    return { tooSoon: false };
  }

  const weeksSince = (Date.now() - lastAppointment.getTime()) / (1000 * 60 * 60 * 24 * 7);
  if (weeksSince >= service.minFrequencyWeeks) {
    return { tooSoon: false };
  }

  const earliestDate = addWeeks(lastAppointment, service.minFrequencyWeeks);
  return {
    tooSoon: true,
    hardBlock: service.frequencyHardBlock,
    earliestDate: toIsoDate(earliestDate),
    weeksRemaining: Number((service.minFrequencyWeeks - weeksSince).toFixed(1)),
  };
}
