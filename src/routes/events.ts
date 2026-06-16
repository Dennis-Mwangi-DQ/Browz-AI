import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { emitBookingCancelled } from '../lib/events';

const BookingCancelledBody = z.object({
  bookingId: z.string().min(1),
  slotId: z.string().min(1),
  serviceId: z.string().min(1),
  branchId: z.string().min(1),
  startTime: z.string().min(1),
  cancellationSource: z.enum(['agent', 'staff', 'portal', 'no_show']).default('portal'),
});

export const eventsRouter = Router();

eventsRouter.post('/booking-cancelled', (req: Request, res: Response) => {
  const parsed = BookingCancelledBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() });
  }

  emitBookingCancelled(parsed.data);
  return res.status(202).json({ accepted: true });
});
