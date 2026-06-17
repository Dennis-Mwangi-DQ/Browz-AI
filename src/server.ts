import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { startRecoveryListener } from './agent/recoveryOrchestrator';
import { startExpiredOffersJob } from './jobs/processExpiredOffers';
import { startNoShowsJob } from './jobs/processNoShows';
import { startUnfilledSlotsJob } from './jobs/processUnfilledSlots';
import { chatRouter } from './routes/chat';
import { bookingsRouter } from './routes/bookings';
import { dataRouter } from './routes/data';
import { paymentsRouter } from './routes/payments';
import { staffRouter } from './routes/staff';
import { eventsRouter } from './routes/events';
import { whatsappRouter } from './routes/whatsapp';
import { getHealthStatus } from './lib/healthCheck';
import { getEnv } from './lib/env';
import { startScheduledJobs } from './jobs/scheduler';
import path from 'path';

const app = express();
const serveDevUi = getEnv().NODE_ENV !== 'production';
const publicPath = path.join(__dirname, '..', 'public');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (serveDevUi) {
  app.use(express.static(publicPath));
}

app.use('/chat', chatRouter);
app.use('/bookings', bookingsRouter);
app.use('/data', dataRouter);
app.use('/payments', paymentsRouter);
app.use('/staff', staffRouter);
app.use('/', staffRouter);
app.use('/events', eventsRouter);
app.use('/whatsapp', whatsappRouter);

startRecoveryListener();
startExpiredOffersJob();
startNoShowsJob();
startUnfilledSlotsJob();

app.get('/health', async (_req, res) => {
  try {
    const health = await getHealthStatus();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  } catch (error) {
    console.error('GET /health failed', error);
    res.status(500).json({ status: 'error', message: 'Health check failed' });
  }
});

app.get('/', (_req, res) => {
  if (serveDevUi) {
    return res.sendFile(path.join(publicPath, 'index.html'));
  }

  return res.json({
    service: 'Browz Concierge Agent',
    endpoints: {
      health: 'GET /health',
      chat: 'POST /chat',
      chatStream: 'POST /chat/stream',
      session: 'GET /chat/session/:sessionId',
      sessionLatest: 'GET /chat/session/latest?clientId=',
      whatsapp: 'POST /whatsapp',
      paymentComplete: 'POST /payments/complete',
      staffCheckIn: 'PATCH /bookings/:id/check-in',
      staffNoShowFlag: 'PATCH /clients/:id/no-show-flag',
      bookingCancelled: 'POST /events/booking-cancelled',
      services: 'GET /data/services',
      branches: 'GET /data/branches',
      availability: 'GET /data/availability?serviceId=&branchId=&date=',
    },
  });
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  const mode = serveDevUi ? 'development (UI enabled)' : 'production (API only)';
  console.log(`Browz agent backend running on port ${port} [${mode}]`);
  startScheduledJobs();
});
