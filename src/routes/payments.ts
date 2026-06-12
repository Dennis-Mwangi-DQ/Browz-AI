import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { completeBookingPayment } from '../tools/payment';

export const paymentsRouter = Router();

const CompletePaymentBody = z.object({
  bookingRef: z.string().min(1),
});

function extractBookingRefFromStripeEvent(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const event = body as {
    type?: string;
    data?: { object?: { metadata?: Record<string, unknown> } };
  };
  const metadata = event.data?.object?.metadata;
  const bookingRef = metadata?.bookingRef ?? metadata?.booking_ref;
  return bookingRef ? String(bookingRef) : null;
}

paymentsRouter.post('/complete', async (req: Request, res: Response) => {
  const parsed = CompletePaymentBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
  }

  const result = await completeBookingPayment({ bookingRef: parsed.data.bookingRef });
  if (!result.success) {
    return res.status(result.error === 'booking_not_found' ? 404 : 500).json({ error: result.error });
  }

  return res.json(result.data);
});

paymentsRouter.post('/webhook', async (req: Request, res: Response) => {
  const bookingRef = extractBookingRefFromStripeEvent(req.body);
  if (!bookingRef) {
    return res.status(400).json({ error: 'booking_ref_missing' });
  }

  const result = await completeBookingPayment({ bookingRef });
  if (!result.success) {
    return res.status(result.error === 'booking_not_found' ? 404 : 500).json({ error: result.error });
  }

  return res.json({ received: true, ...result.data });
});
