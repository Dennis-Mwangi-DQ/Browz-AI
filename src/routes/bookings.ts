import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { cancelBookingForRecovery } from '../agent/recoveryOrchestrator';
import { registerWalkin } from '../tools/walkin';
import type { CancellationSource } from '../types';

export const bookingsRouter = Router();

const CancelBody = z.object({
  clientId: z.string().uuid().optional(),
  cancellationSource: z.enum(['staff', 'portal']).optional(),
});

bookingsRouter.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const bookingRef = String(req.params.id);
    const parsed = CancelBody.safeParse(req.body ?? {});
    const clientId = parsed.success && parsed.data.clientId ? parsed.data.clientId : undefined;
    const cancellationSource: CancellationSource =
      parsed.success && parsed.data.cancellationSource
        ? parsed.data.cancellationSource
        : 'staff';

    const result = await cancelBookingForRecovery({
      bookingRef,
      clientId,
      cancellationSource,
    });

    if (!result.success) {
      return res.status(404).json({ error: result.error ?? 'cancel_failed' });
    }

    return res.json({ success: true, bookingId: bookingRef });
  } catch (error) {
    console.error('POST /bookings/:id/cancel failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});

bookingsRouter.post('/walkin', async (req: Request, res: Response) => {
  try {
    const { slotId, visitorName, visitorContact, serviceId, branchId, notes } = req.body ?? {};

    if (!slotId || !visitorName || !visitorContact || !serviceId || !branchId) {
      return res.status(400).json({ error: 'missing_required_fields' });
    }

    const result = await registerWalkin({
      slotId: String(slotId),
      visitorName: String(visitorName),
      visitorContact: String(visitorContact),
      serviceId: String(serviceId),
      branchId: String(branchId),
      notes: notes ? String(notes) : undefined,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error ?? 'walkin_failed' });
    }

    return res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('POST /bookings/walkin failed', error);
    return res.status(500).json({ error: 'internal_error' });
  }
});
