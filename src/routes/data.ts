import { type Request, type Response, Router } from 'express';
import { queryAvailability } from '../tools/availability';
import { getSupabaseClient } from '../db/supabaseClient';

export const dataRouter = Router();

// GET /data/services — full service list from Supabase (richer than list_services tool)
dataRouter.get('/services', async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ error: 'supabase_not_configured' });
    }
    const { data, error } = await supabase
      .from('services')
      .select(
        'id, title, cat, price_aed, duration_min, service_tier, currency, requires_consultation, is_medical_gated',
      )
      .eq('active', true)
      .order('cat', { ascending: true })
      .order('title', { ascending: true });

    if (error) {
      console.error('GET /data/services failed', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      data: (data ?? []).map((row) => ({
        id: String(row.id),
        title: String(row.title ?? ''),
        cat: String(row.cat ?? ''),
        priceAed: Number(row.price_aed ?? 0),
        durationMin: row.duration_min != null ? Number(row.duration_min) : null,
        serviceTier: String(row.service_tier ?? 'T1'),
        currency: String(row.currency ?? 'AED'),
        requiresConsultation: Boolean(row.requires_consultation),
        isMedicalGated: Boolean(row.is_medical_gated),
      })),
    });
  } catch (err) {
    console.error('GET /data/services failed', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /data/branches — active branches from Supabase
dataRouter.get('/branches', async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ error: 'supabase_not_configured' });
    }
    const { data, error } = await supabase
      .from('branches')
      .select('id, name, city, address, phone, hours, categories, status')
      .neq('status', 'closed')
      .order('name', { ascending: true });

    if (error) {
      console.error('GET /data/branches failed', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ data: data ?? [] });
  } catch (err) {
    console.error('GET /data/branches failed', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /data/availability?serviceId=&branchId=&date= — available slots for a specific date
dataRouter.get('/availability', async (req: Request, res: Response) => {
  try {
    const { serviceId, branchId, date } = req.query;
    if (!serviceId || !branchId || !date) {
      return res
        .status(400)
        .json({ error: 'serviceId, branchId, and date are required' });
    }

    const result = await queryAvailability({
      serviceId: String(serviceId),
      branchId: String(branchId),
      date: String(date),
    });

    if (!result.success) {
      return res
        .status(500)
        .json({ error: result.error ?? 'availability_lookup_failed' });
    }

    return res.json({ data: result.data ?? [] });
  } catch (err) {
    console.error('GET /data/availability failed', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});
