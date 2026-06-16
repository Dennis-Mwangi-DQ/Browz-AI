import { type Request, type Response, Router } from 'express';
import { runAgent, runAgentStream, type AgentStreamEvent } from '../agent/agent';
import { ChatRequest } from '../types';
import { generateSessionId } from '../lib/ids';
import { endSseResponse, initSseResponse, writeSseEvent } from '../lib/sse';

export const chatRouter = Router();

function writeAgentStreamEvent(res: Response, event: AgentStreamEvent): void {
  switch (event.type) {
    case 'status':
      writeSseEvent(res, 'status', { message: event.message });
      return;
    case 'token':
      writeSseEvent(res, 'token', { text: event.text });
      return;
    case 'done':
      writeSseEvent(res, 'done', event.result);
      return;
    default:
      return;
  }
}

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
      clientId: parsed.data.clientId,
      visitorName: parsed.data.visitorName,
      visitorContact: parsed.data.visitorContact,
    });

    return res.json(result);
  } catch (error) {
    console.error('POST /chat failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function handleChatStream(req: Request, res: Response) {
  const parsed = ChatRequest.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      details: parsed.error.flatten(),
    });
  }

  initSseResponse(res);

  try {
    await runAgentStream(
      {
        message: parsed.data.message,
        sessionId: parsed.data.sessionId ?? generateSessionId(),
        channel: 'web',
        authToken: parsed.data.authToken,
        clientId: parsed.data.clientId,
        visitorName: parsed.data.visitorName,
        visitorContact: parsed.data.visitorContact,
      },
      (event) => writeAgentStreamEvent(res, event),
    );
    endSseResponse(res);
  } catch (error) {
    console.error('POST /chat/stream failed', error);
    writeSseEvent(res, 'error', { message: 'Internal server error' });
    endSseResponse(res);
  }
}

chatRouter.post('/', handleChat);
chatRouter.post('/stream', handleChatStream);
