import { describe, expect, it, vi } from 'vitest';
import { resolvePaymentRule } from '../src/agent/paymentRules';
import { queryAvailability } from '../src/tools/availability';
import type { Service } from '../src/types';

const highValueService: Service = {
  id: 's-007',
  name: 'Profhilo',
  category: 'Medical',
  serviceTier: 'T3',
  city: 'Dubai',
  durationMinutes: 30,
  priceAed: 2500,
  requiresConsultation: true,
  requiresPatchTest: false,
  requiresScreening: true,
  isMedicalGated: true,
  minFrequencyWeeks: 24,
  frequencyHardBlock: true,
  description: 'Injectable skin treatment',
  gateCategory: 'injectables',
};

describe('tool helpers', () => {
  it('resolves a deposit rule for higher-priced services', () => {
    const result = resolvePaymentRule(highValueService, 'single');
    expect(result.paymentType).toBe('deposit');
    expect(result.depositAmountAed).toBeGreaterThan(0);
  });

  it('fails availability lookup when Supabase is not configured', async () => {
    vi.doUnmock('../src/db/supabaseClient');
    vi.resetModules();
    vi.mock('../src/db/supabaseClient', () => ({
      supabase: null,
      hasSupabaseConfig: false,
      getSupabaseClient: () => null,
    }));

    const { queryAvailability: queryWithoutSupabase } = await import('../src/tools/availability');
    const slots = await queryWithoutSupabase({
      serviceId: 's-001',
      branchId: 'br-dxb',
      date: '2026-06-06',
    });

    expect(slots.success).toBe(false);
    expect(slots.error).toBe('supabase_not_configured');
  });
});
