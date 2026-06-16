import { type Request, Router } from 'express';
import twilio from 'twilio';
import { runAgent } from '../agent/agent';
import { handleOfferDeclined } from '../agent/recoveryOrchestrator';
import { getEnv } from '../lib/env';
import { generateSessionId } from '../lib/ids';
import { getPendingOffer, clearPendingOffer } from '../lib/pendingOffers';
import { parseYesNo } from '../lib/dates';
import { confirmSlotOffer, declineSlotOffer } from '../tools/waitlist';
import { WhatsAppWebhookBody } from '../types';

export const whatsappRouter = Router();

function isTwilioRequestValid(req: Request, body: Record<string, string>): boolean {
  const authToken = getEnv('TWILIO_AUTH_TOKEN');
  const signature = req.get('x-twilio-signature');

  if (!authToken || !signature) {
    return true;
  }

  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  return twilio.validateRequest(authToken, signature, fullUrl, body);
}

whatsappRouter.post('/', async (req, res) => {
  const parsed = WhatsAppWebhookBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).send('Invalid Twilio webhook payload');
  }

  if (!isTwilioRequestValid(req, req.body as Record<string, string>)) {
    return res.status(403).send('Invalid signature');
  }

  try {
    const from = parsed.data.From;
    const body = parsed.data.Body.trim();
    const sessionId = generateSessionId(from);
    const twiml = new twilio.twiml.MessagingResponse();

    const pendingOffer = getPendingOffer({ contact: from });
    const yesNo = parseYesNo(body);

    if (pendingOffer && yesNo !== null) {
      if (yesNo) {
        const result = await confirmSlotOffer({
          waitlistRef: pendingOffer.waitlistRef,
          slotId: pendingOffer.slotId,
          channel: 'whatsapp',
        });
        clearPendingOffer({ contact: from });
        if (result.success && result.data) {
          twiml.message(
            `Your slot is confirmed! Booking reference: ${result.data.bookingId}. We look forward to seeing you.`,
          );
        } else if (result.error === 'gate_blocked') {
          twiml.message(
            'This service requires a consultation or patch test before booking. Please contact the salon to complete clearance, then join the waitlist again for the next opening.',
          );
        } else {
          twiml.message(
            'Sorry, we could not confirm that slot. Please contact the salon or try again.',
          );
        }
      } else {
        const result = await declineSlotOffer(pendingOffer.waitlistRef);
        clearPendingOffer({ contact: from });
        if (result.success && result.data?.slotId) {
          void handleOfferDeclined(pendingOffer.waitlistRef, result.data.slotId);
        }
        twiml.message('No problem — you remain on the waitlist for the next opening.');
      }
      return res.type('text/xml').send(twiml.toString());
    }

    const result = await runAgent({
      message: body,
      sessionId,
      channel: 'whatsapp',
      whatsappNumber: from,
    });

    twiml.message(result.response);

    return res.type('text/xml').send(twiml.toString());
  } catch (error) {
    console.error('POST /whatsapp failed', error);
    return res.status(500).send('Internal server error');
  }
});
