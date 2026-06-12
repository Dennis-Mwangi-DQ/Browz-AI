import { describe, expect, it } from 'vitest';
import { resolvePaymentRule } from '../src/agent/paymentRules';
import type { NoShowFlag, Service } from '../src/types';

function service(overrides: Partial<Service>): Service {
  return {
    id: 'svc',
    name: 'Service',
    category: 'Beauty',
    gateCategory: 'beauty',
    serviceTier: 'T1',
    city: 'Dubai',
    durationMinutes: 30,
    priceAed: 100,
    requiresConsultation: false,
    requiresPatchTest: false,
    requiresScreening: false,
    isMedicalGated: false,
    minFrequencyWeeks: null,
    frequencyHardBlock: false,
    description: '',
    ...overrides,
  };
}

describe('no-show payment policy', () => {
  it('applies 20% deposit to T1 services over AED 200', () => {
    const result = resolvePaymentRule(service({ serviceTier: 'T1', priceAed: 350 }));

    expect(result).toMatchObject({
      paymentType: 'deposit',
      depositAmountAed: 70,
      balanceDueAed: 280,
      depositPercent: 20,
    });
  });

  it('applies 30% deposit to T2 services', () => {
    const result = resolvePaymentRule(service({ serviceTier: 'T2', priceAed: 1200 }));

    expect(result.depositAmountAed).toBe(360);
    expect(result.balanceDueAed).toBe(840);
    expect(result.depositPercent).toBe(30);
  });

  it('applies 30% deposit to T3 services over AED 1000', () => {
    const result = resolvePaymentRule(service({ serviceTier: 'T3', priceAed: 1500 }));

    expect(result.depositAmountAed).toBe(450);
    expect(result.reason).toBe('t3_high_value_30_percent');
  });

  it('keeps consultations free', () => {
    const result = resolvePaymentRule(service({ priceAed: 0 }), 'consultation');

    expect(result).toMatchObject({
      paymentType: 'free',
      depositAmountAed: 0,
      balanceDueAed: 0,
    });
  });

  it('forces full upfront payment for active no-show flags', () => {
    const flag: NoShowFlag = { status: 'active', noShowCount: 2 };
    const result = resolvePaymentRule(service({ priceAed: 280 }), 'single', flag);

    expect(result).toMatchObject({
      paymentType: 'full_upfront',
      depositAmountAed: 280,
      balanceDueAed: 0,
      reason: 'no_show_flag',
    });
  });
});
