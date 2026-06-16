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

// GET /data/slots?branchId=&date= — all slot states for staff dayboard
dataRouter.get('/slots', async (req: Request, res: Response) => {
  try {
    const { branchId, date } = req.query;
    if (!branchId || !date) {
      return res.status(400).json({ error: 'branchId and date are required' });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ error: 'supabase_not_configured' });
    }

    const { data, error } = await supabase
      .from('time_slots')
      .select('id, branch_id, service_id, artist_id, start_time, end_time, status')
      .eq('branch_id', String(branchId))
      .gte('start_time', `${String(date)}T00:00:00.000Z`)
      .lt('start_time', `${String(date)}T23:59:59.999Z`)
      .order('start_time', { ascending: true });

    if (error) {
      console.error('GET /data/slots failed', error);
      return res.status(500).json({ error: error.message });
    }

    const slotIds = (data ?? []).map((row) => String(row.id));
    const recoveredSources = new Set(['waitlist_recovery', 'walkin_agent', 'walkin_staff']);
    const recoveredSlotIds = new Set<string>();

    if (slotIds.length > 0) {
      const { data: bookings } = await supabase
        .from('bookings')
        .select('slot_id, booking_source')
        .in('slot_id', slotIds)
        .in('status', ['confirmed', 'modified']);

      for (const booking of bookings ?? []) {
        if (booking.slot_id && recoveredSources.has(String(booking.booking_source))) {
          recoveredSlotIds.add(String(booking.slot_id));
        }
      }
    }

    return res.json({
      data: (data ?? []).map((row) => {
        const status = String(row.status);
        return {
          id: String(row.id),
          branchId: String(row.branch_id),
          serviceId: String(row.service_id),
          artistId: row.artist_id ? String(row.artist_id) : null,
          startTime: String(row.start_time),
          endTime: String(row.end_time),
          status,
          isWalkin: status === 'open_for_walkin',
          isUnfilled: status === 'unfilled',
          isRecovered: status === 'booked' && recoveredSlotIds.has(String(row.id)),
        };
      }),
    });
  } catch (err) {
    console.error('GET /data/slots failed', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});

// GET /data/recovery-log?slotId= — recovery audit for a slot
dataRouter.get('/recovery-log', async (req: Request, res: Response) => {
  try {
    const { slotId } = req.query;
    if (!slotId) {
      return res.status(400).json({ error: 'slotId is required' });
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(503).json({ error: 'supabase_not_configured' });
    }

    const { data, error } = await supabase
      .from('slot_recovery_log')
      .select('*')
      .eq('slot_id', String(slotId))
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('GET /data/recovery-log failed', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({ data: data ?? [] });
  } catch (err) {
    console.error('GET /data/recovery-log failed', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});
