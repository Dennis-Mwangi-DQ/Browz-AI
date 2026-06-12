import { z } from 'zod';
import { supabase } from '../db/supabaseClient';
import { stripe } from '../lib/stripeClient';
import { fail, ok } from '../lib/result';
import type { ToolResult } from '../types';

const PaymentParams = z.object({
  bookingRef: z.string().min(1),
  amountAed: z.number().positive(),
  paymentType: z.enum(['full_upfront', 'deposit', 'package']),
  description: z.string().min(1),
});

const CompletePaymentParams = z.object({
  bookingRef: z.string().min(1),
});

export async function generatePaymentLink(params: {
  bookingRef: string;
  amountAed: number;
  paymentType: 'full_upfront' | 'deposit' | 'package';
  description: string;
}): Promise<ToolResult<{ paymentLink: string }>> {
  const parsed = PaymentParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_payment_params');
  }

  try {
    let paymentLink = `https://payments.browz.test/${encodeURIComponent(params.bookingRef)}`;

    if (stripe) {
      const paymentLinkResponse = await stripe.paymentLinks.create({
        line_items: [
          {
            price_data: {
              currency: 'aed',
              product_data: {
                name: params.description,
              },
              unit_amount: Math.round(params.amountAed * 100),
            },
            quantity: 1,
          },
        ],
        metadata: {
          bookingRef: params.bookingRef,
          paymentType: params.paymentType,
        },
      });

      paymentLink = paymentLinkResponse.url;
    }

    if (supabase) {
      await supabase
        .from('bookings')
        .update({
          payment_link: paymentLink,
          payment_status: 'link_sent',
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.bookingRef);
    }

    return ok({ paymentLink });
  } catch (error) {
    console.error('generatePaymentLink failed', error);
    return fail('payment_link_failed');
  }
}

export async function completeBookingPayment(params: {
  bookingRef: string;
}): Promise<ToolResult<{ bookingId: string; paymentStatus: 'deposit_paid' | 'paid' }>> {
  const parsed = CompletePaymentParams.safeParse(params);
  if (!parsed.success) {
    return fail('invalid_payment_completion_params');
  }

  if (!supabase) {
    return fail('supabase_not_configured');
  }

  try {
    const { data: booking, error: fetchError } = await supabase
      .from('bookings')
      .select('id, payment_type')
      .eq('id', params.bookingRef)
      .maybeSingle();

    if (fetchError) {
      console.error('completeBookingPayment lookup failed', fetchError);
      return fail('payment_completion_failed');
    }

    if (!booking) {
      return fail('booking_not_found');
    }

    const paymentStatus = booking.payment_type === 'deposit' ? 'deposit_paid' : 'paid';

    const { error } = await supabase
      .from('bookings')
      .update({
        status: 'confirmed',
        payment_status: paymentStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.bookingRef);

    if (error) {
      console.error('completeBookingPayment update failed', error);
      return fail('payment_completion_failed');
    }

    return ok({ bookingId: params.bookingRef, paymentStatus });
  } catch (error) {
    console.error('completeBookingPayment failed', error);
    return fail('payment_completion_failed');
  }
}
