import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { chatRouter } from './routes/chat';
import { whatsappRouter } from './routes/whatsapp';
import { getHealthStatus } from './lib/healthCheck';
import { getEnv } from './lib/env';
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
app.use('/whatsapp', whatsappRouter);

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
      whatsapp: 'POST /whatsapp',
    },
  });
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  const mode = serveDevUi ? 'development (UI enabled)' : 'production (API only)';
  console.log(`Browz agent backend running on port ${port} [${mode}]`);
});
