import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { getSupabaseClient } from '../db/supabaseClient';

export const staffRouter = Router();

const FlagBody = z.object({
  status: z.literal('lifted'),
});

export async function checkInBooking(bookingId: string): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  statusCode: number;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { success: false, error: 'supabase_not_configured', statusCode: 503 };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('bookings')
    .update({
      check_in_recorded: true,
      check_in_at: now,
      status: 'completed',
      updated_at: now,
    })
    .eq('id', bookingId)
    .select('id, status, check_in_recorded, check_in_at')
    .maybeSingle();

  if (error) {
    console.error('checkInBooking failed', error);
    return { success: false, error: 'check_in_failed', statusCode: 500 };
  }
  if (!data) {
    return { success: false, error: 'booking_not_found', statusCode: 404 };
  }

  return { success: true, data, statusCode: 200 };
}

export async function liftNoShowFlag(clientId: string): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  statusCode: number;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { success: false, error: 'supabase_not_configured', statusCode: 503 };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('clients')
    .update({
      no_show_flag: 'lifted',
      no_show_flag_lifted_at: now,
      updated_at: now,
    })
    .eq('id', clientId)
    .select('id, no_show_flag, no_show_flag_lifted_at')
    .maybeSingle();

  if (error) {
    console.error('liftNoShowFlag failed', error);
    return { success: false, error: 'no_show_flag_update_failed', statusCode: 500 };
  }
  if (!data) {
    return { success: false, error: 'client_not_found', statusCode: 404 };
  }

  return { success: true, data, statusCode: 200 };
}

staffRouter.patch('/bookings/:id/check-in', async (req: Request, res: Response) => {
  const bookingId = typeof req.params.id === 'string' ? req.params.id : '';
  if (!bookingId) {
    return res.status(400).json({ error: 'booking_id_required' });
  }

  const result = await checkInBooking(bookingId);
  if (!result.success) {
    return res.status(result.statusCode).json({ error: result.error });
  }

  return res.json({ data: result.data });
});

staffRouter.patch('/clients/:id/no-show-flag', async (req: Request, res: Response) => {
  const parsed = FlagBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
  }

  const clientId = typeof req.params.id === 'string' ? req.params.id : '';
  if (!clientId) {
    return res.status(400).json({ error: 'client_id_required' });
  }

  const result = await liftNoShowFlag(clientId);
  if (!result.success) {
    return res.status(result.statusCode).json({ error: result.error });
  }

  return res.json({ data: result.data });
});
