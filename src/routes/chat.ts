import { type Request, type Response, Router } from 'express';
import { runAgent } from '../agent/agent';
import { ChatRequest } from '../types';
import { generateSessionId } from '../lib/ids';

export const chatRouter = Router();

async function handleChat(req: Request, res: Response) {
  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await runAgent({
      message: parsed.data.message,
      sessionId: parsed.data.sessionId ?? generateSessionId(),
      channel: 'web',
      authToken: parsed.data.authToken,
    });

    return res.json(result);
  } catch (error) {
    console.error('POST /chat failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

chatRouter.post('/', handleChat);
