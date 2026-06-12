export async function invokeCancellationRecovery(params: {
  bookingId: string;
  slotId?: string | null;
  serviceId?: string | null;
  branchId?: string | null;
  reason: 'cancelled' | 'no_show_risk' | 'no_show';
}): Promise<void> {
  console.log('[recovery-hook:noop]', params);
}
