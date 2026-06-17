import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { runAgent, runAgentStream, type AgentStreamEvent } from '../agent/agent';
import { getLatestActiveSession, getSessionById } from '../memory/sessionManager';
import { ChatRequest } from '../types';
import { generateSessionId } from '../lib/ids';
import { endSseResponse, initSseResponse, writeSseEvent } from '../lib/sse';

export const chatRouter = Router();

const sessionIdParam = z.string().uuid();
const latestSessionQuery = z.object({
  clientId: z.string().uuid(),
  channel: z.enum(['web', 'whatsapp']).default('web'),
});

function toSessionHistoryResponse(session: NonNullable<Awaited<ReturnType<typeof getSessionById>>>) {
  return {
    sessionId: session.sessionId,
    channel: session.channel,
    status: session.status,
    lastIntent: session.lastIntent,
    lastBookingRef: session.lastBookingRef,
    conversationHistory: session.conversationHistory,
    agentContext: session.agentContext ?? null,
  };
}

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

chatRouter.get('/session/latest', async (req, res) => {
  const parsed = latestSessionQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid query',
      details: parsed.error.flatten(),
    });
  }

  try {
    const session = await getLatestActiveSession(parsed.data.channel, parsed.data.clientId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json(toSessionHistoryResponse(session));
  } catch (error) {
    console.error('GET /chat/session/latest failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

chatRouter.get('/session/:sessionId', async (req, res) => {
  const parsed = sessionIdParam.safeParse(req.params.sessionId);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid session id' });
  }

  try {
    const session = await getSessionById(parsed.data);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json(toSessionHistoryResponse(session));
  } catch (error) {
    console.error('GET /chat/session/:sessionId failed', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
