import { EventEmitter } from 'events';
import type { BookingCancelledEvent } from '../types';

const emitter = new EventEmitter();

export function emitBookingCancelled(payload: BookingCancelledEvent): void {
  emitter.emit('booking.cancelled', payload);
}

export function onBookingCancelled(
  handler: (event: BookingCancelledEvent) => void,
): void {
  emitter.on('booking.cancelled', handler);
}
