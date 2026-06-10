import { getArtistById, getBranchById, getServiceById } from './catalog';
import { setPendingOffer } from './pendingOffers';
import { getTwilioClient } from './twilioClient';
import { getEnv } from './env';
import type { NotificationChannel, PendingSlotOffer, WaitlistEntry } from '../types';

function formatOfferTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString('en-AE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Dubai',
  });
}

function formatOfferDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-AE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Dubai',
  });
}

function buildWhatsAppMessage(params: {
  name: string;
  branchName: string;
  serviceName: string;
  date: string;
  time: string;
  artistName: string;
  expiresAt: string;
}): string {
  return (
    `Hi ${params.name} 👋 A slot just opened up at Browz ${params.branchName}!\n\n` +
    `Service: ${params.serviceName}\n` +
    `Date: ${params.date}\n` +
    `Time: ${params.time}\n` +
    `Artist: ${params.artistName}\n\n` +
    `Would you like to book this slot? Reply YES to confirm or NO to pass.\n` +
    `This offer is held for you until ${formatOfferTime(params.expiresAt)} — 15 minutes from now.`
  );
}

export async function notifySlotOffer(params: {
  entry: WaitlistEntry;
  slotId: string;
  slotStartTime: string;
  artistId?: string | null;
  channel: NotificationChannel;
}): Promise<PendingSlotOffer | null> {
  const service = await getServiceById(params.entry.serviceId);
  const branch = await getBranchById(params.entry.branchId);
  const artist = params.artistId ? await getArtistById(params.artistId) : null;

  const name = params.entry.visitorName ?? 'there';
  const expiresAt =
    params.entry.offerExpiresAt ??
    new Date(Date.now() + getEnv().OFFER_WINDOW_MINUTES * 60 * 1000).toISOString();

  const offer: PendingSlotOffer = {
    waitlistRef: params.entry.id,
    slotId: params.slotId,
    serviceId: params.entry.serviceId,
    branchId: params.entry.branchId,
    serviceName: service?.name ?? params.entry.serviceId,
    branchName: branch?.name ?? params.entry.branchId,
    startTime: params.slotStartTime,
    artistName: artist?.name ?? null,
    expiresAt,
  };

  const sendWhatsApp =
    params.channel === 'whatsapp' || params.channel === 'both';
  const sendWeb = params.channel === 'web' || params.channel === 'both';

  if (sendWhatsApp) {
    const client = getTwilioClient();
    const from = getEnv('TWILIO_WHATSAPP_NUMBER');
    if (client && from) {
      const to = params.entry.visitorContact.startsWith('whatsapp:')
        ? params.entry.visitorContact
        : `whatsapp:${params.entry.visitorContact}`;

      try {
        await client.messages.create({
          from,
          to,
          body: buildWhatsAppMessage({
            name,
            branchName: offer.branchName,
            serviceName: offer.serviceName,
            date: formatOfferDate(params.slotStartTime),
            time: formatOfferTime(params.slotStartTime),
            artistName: offer.artistName ?? 'Any available',
            expiresAt,
          }),
        });
      } catch (error) {
        console.error('WhatsApp offer notification failed', error);
      }
    }
  }

  if (sendWeb) {
    setPendingOffer(
      params.entry.visitorContact,
      params.entry.clientId,
      offer,
    );
  }

  return offer;
}

export async function notifyOfferExpired(entry: WaitlistEntry): Promise<void> {
  const client = getTwilioClient();
  const from = getEnv('TWILIO_WHATSAPP_NUMBER');
  if (!client || !from) {
    return;
  }

  const to = entry.visitorContact.startsWith('whatsapp:')
    ? entry.visitorContact
    : `whatsapp:${entry.visitorContact}`;

  try {
    await client.messages.create({
      from,
      to,
      body:
        "Sorry, your held slot has expired. You're still on the waitlist for the next available opening.",
    });
  } catch (error) {
    console.error('WhatsApp expiry notification failed', error);
  }
}
