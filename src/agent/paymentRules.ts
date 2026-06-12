import type { NoShowFlag, PaymentRule, Service } from '../types';

export type BookingType = 'single' | 'consultation' | 'package_first_session';

function fullUpfront(service: Service, reason: PaymentRule['reason']): PaymentRule {
  return {
    paymentType: 'full_upfront',
    depositAmountAed: service.priceAed,
    balanceDueAed: 0,
    depositPercent: service.priceAed > 0 ? 100 : 0,
    reason,
  };
}

function percentageDeposit(
  service: Service,
  percent: number,
  reason: PaymentRule['reason'],
): PaymentRule {
  const deposit = Math.ceil(service.priceAed * percent);
  return {
    paymentType: 'deposit',
    depositAmountAed: deposit,
    balanceDueAed: service.priceAed - deposit,
    depositPercent: Math.round(percent * 100),
    reason,
  };
}

export function resolvePaymentRule(
  service: Service,
  bookingType: BookingType = 'single',
  clientFlag: NoShowFlag | null = null,
): PaymentRule {
  if (clientFlag?.status === 'active') {
    return {
      ...fullUpfront(service, 'no_show_flag'),
      reason: 'no_show_flag',
    };
  }

  if (bookingType === 'consultation') {
    return {
      paymentType: 'free',
      depositAmountAed: 0,
      balanceDueAed: 0,
      depositPercent: 0,
      reason: 'consultation',
    };
  }

  if (bookingType === 'package_first_session') {
    return {
      paymentType: 'package',
      depositAmountAed: service.priceAed,
      balanceDueAed: 0,
      depositPercent: service.priceAed > 0 ? 100 : 0,
      reason: 'package',
    };
  }

  if (service.serviceTier === 'T2') {
    return percentageDeposit(service, 0.3, 't2_30_percent');
  }

  if (service.serviceTier === 'T3' && service.priceAed > 1000) {
    return percentageDeposit(service, 0.3, 't3_high_value_30_percent');
  }

  if (service.serviceTier === 'T1' && service.priceAed > 1000) {
    return percentageDeposit(service, 0.2, 't1_high_value_20_percent');
  }

  if (service.serviceTier === 'T1' && service.priceAed > 200) {
    return percentageDeposit(service, 0.2, 't1_mid_value_20_percent');
  }

  return fullUpfront(service, 'full_upfront_threshold');
}

export const resolveDepositRule = resolvePaymentRule;
