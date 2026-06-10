import type { PendingSlotOffer } from '../types';

const offersByContact = new Map<string, PendingSlotOffer>();
const offersByClientId = new Map<string, PendingSlotOffer>();

function contactKey(contact: string): string {
  return contact.replace(/\s+/g, '').toLowerCase();
}

export function setPendingOffer(
  contact: string | null,
  clientId: string | null,
  offer: PendingSlotOffer,
): void {
  if (contact) {
    offersByContact.set(contactKey(contact), offer);
  }
  if (clientId) {
    offersByClientId.set(clientId, offer);
  }
}

export function getPendingOffer(params: {
  contact?: string | null;
  clientId?: string | null;
}): PendingSlotOffer | null {
  if (params.clientId) {
    const byClient = offersByClientId.get(params.clientId);
    if (byClient) {
      return byClient;
    }
  }
  if (params.contact) {
    return offersByContact.get(contactKey(params.contact)) ?? null;
  }
  return null;
}

export function clearPendingOffer(params: {
  contact?: string | null;
  clientId?: string | null;
}): void {
  if (params.contact) {
    offersByContact.delete(contactKey(params.contact));
  }
  if (params.clientId) {
    offersByClientId.delete(params.clientId);
  }
}
