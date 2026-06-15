import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  checkPreBookingRequirements,
  checkTreatmentFrequency,
  type GateCheckContext,
} from './gateChecker';
import { createBooking, modifyBooking, cancelBooking } from '../tools/bookings';
import { queryAvailability, queryNextAvailableDates } from '../tools/availability';
import { createConsultation } from '../tools/consultations';
import { getClearanceStatus } from '../tools/clearances';
import { addNotes } from '../tools/notes';
import { generatePaymentLink } from '../tools/payment';
import { getContextSnapshot } from './agent-session';
import { lookupFaq } from '../tools/faq';
import {
  listServices,
  listBranchesForService,
  listArtistsForServiceAtBranch,
  listServiceLocations,
} from '../tools/services';
import { submitScreening } from '../tools/screenings';
import { findArtistByName, findBranchByName, findServiceByName, getDefaultBranch } from '../lib/catalog';
import { isValidContact } from '../lib/phone';
import { isoToSalonLocalTime, resolveBookingDate, slotMatchesSalonLocalTime } from '../lib/dates';
import { updateSession } from '../memory/sessionManager';
import type { AgentContextSnapshot, ScreeningAnswers, SessionContext } from '../types';

type ToolResultRecord = Record<string, unknown>;

function buildGateContext(session: SessionContext): GateCheckContext {
  const snapshot = getContextSnapshot(session);
  return {
    visitorContact: snapshot.visitorContact ?? session.whatsappNumber,
    visitorName: snapshot.visitorName,
    screeningRef: snapshot.lastScreeningRef,
  };
}

async function persistAgentContext(session: SessionContext, patch: Partial<AgentContextSnapshot>) {
  const nextContext: AgentContextSnapshot = {
    ...getContextSnapshot(session),
    ...patch,
  };
  session.agentContext = nextContext;
  await updateSession(session.sessionId, { agentContext: nextContext });
}

function resolveServiceName(service?: string) {
  if (!service) {
    return null;
  }
  return findServiceByName(service);
}

async function resolveBranchName(branch?: string) {
  if (!branch) {
    return getDefaultBranch();
  }
  return findBranchByName(branch);
}

async function executeToolImpl(
  name: string,
  args: Record<string, unknown>,
  session: SessionContext,
): Promise<ToolResultRecord> {
  const safeArgs = { ...args };

  switch (name) {
    case 'list_branches_for_service': {
      const result = await listBranchesForService({ service: String(safeArgs.service ?? '') });
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'list_artists_for_service_at_branch': {
      const result = await listArtistsForServiceAtBranch({
        service: String(safeArgs.service ?? ''),
        branch: String(safeArgs.branch ?? ''),
      });
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'search_availability': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      const branch = await resolveBranchName(String(safeArgs.branch ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      if (!branch) {
        return { success: false, error: 'branch_not_found' };
      }
      const resolvedDate = resolveBookingDate(safeArgs.date);
      if (!resolvedDate.ok) {
        return { success: false, error: resolvedDate.error };
      }
      // Resolve optional artist filter
      const artistName = safeArgs.artist ? String(safeArgs.artist) : undefined;
      const artist = artistName ? await findArtistByName(artistName, branch.id) : null;
      const availability = await queryAvailability({
        serviceId: service.id,
        branchId: branch.id,
        date: resolvedDate.date,
        artistId: artist?.id ?? undefined,
      });

      const slots = availability.data ?? [];

      // When the requested day has no slots, scan ahead so the agent can present
      // next available dates without looping day by day.
      if (availability.success && slots.length === 0) {
        const nextDates = await queryNextAvailableDates({
          serviceId: service.id,
          branchId: branch.id,
          fromDate: resolvedDate.date,
          artistId: artist?.id ?? undefined,
        });
        return {
          success: true,
          data: {
            slots: [],
            artistResolved: artist ? { id: artist.id, name: artist.name } : null,
            nextAvailableDates: nextDates.length > 0 ? nextDates : null,
          },
        };
      }

      return {
        success: availability.success,
        data: availability.data ? {
          slots,
          artistResolved: artist ? { id: artist.id, name: artist.name } : null,
        } : undefined,
        error: availability.error,
      };
    }
    case 'create_booking': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      const branch = await resolveBranchName(String(safeArgs.branch ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      const gate = await checkPreBookingRequirements(
        service.id,
        session.clientId,
        buildGateContext(session),
      );
      if (!gate.gateCleared) {
        return { success: false, error: 'gate_blocked', reason: gate.reason };
      }
      const resolvedDate = resolveBookingDate(safeArgs.date);
      if (!resolvedDate.ok) {
        return { success: false, error: resolvedDate.error };
      }
      if (!branch) {
        return { success: false, error: 'branch_not_found' };
      }

      // Resolve the requested artist (if any) and lock availability to them
      const artistName = safeArgs.artist ? String(safeArgs.artist) : undefined;
      const requestedArtist = artistName ? await findArtistByName(artistName, branch.id) : null;

      const availability = await queryAvailability({
        serviceId: service.id,
        branchId: branch.id,
        date: resolvedDate.date,
        artistId: requestedArtist?.id ?? undefined,
      });

      // If artist was requested but has no slots, surface alternatives
      if (requestedArtist && (!availability.success || !availability.data?.length)) {
        // Fall back to any artist so we can suggest alternative times
        const anyAvailability = await queryAvailability({
          serviceId: service.id,
          branchId: branch.id,
          date: resolvedDate.date,
        });
        const nextSlots = (anyAvailability.data ?? [])
          .slice(0, 3)
          .map((s) => isoToSalonLocalTime(s.startTime));
        return {
          success: false,
          error: 'artist_unavailable_at_requested_time',
          artist: requestedArtist.name,
          nextAvailableTimes: nextSlots,
        };
      }

      if (!availability.success || !availability.data?.length) {
        return { success: false, error: 'no_slots_available' };
      }

      const matchingSlot =
        availability.data.find((slot) => {
          const timeArg = safeArgs.time;
          if (!timeArg) return true;
          return slotMatchesSalonLocalTime(slot.startTime, String(timeArg));
        }) ?? null;

      // Requested time doesn't match — suggest alternatives
      if (!matchingSlot) {
        const nextSlots = availability.data
          .slice(0, 3)
          .map((s) => isoToSalonLocalTime(s.startTime));
        return {
          success: false,
          error: 'requested_time_unavailable',
          artist: requestedArtist?.name ?? null,
          nextAvailableTimes: nextSlots,
        };
      }

      const snapshot = getContextSnapshot(session);
      const visitorName =
        (typeof safeArgs.visitorName === 'string' && safeArgs.visitorName.trim()) ||
        snapshot.visitorName;
      const visitorContact =
        (typeof safeArgs.visitorContact === 'string' && safeArgs.visitorContact.trim()) ||
        session.whatsappNumber ||
        snapshot.visitorContact;

      if (!session.clientId && (!visitorName || !visitorContact)) {
        return {
          success: false,
          error: 'visitor_details_required',
          message:
            'Please collect the visitor full name and contact number before creating the booking.',
        };
      }

      if (!session.clientId && visitorContact && !isValidContact(visitorContact)) {
        return {
          success: false,
          error: 'invalid_contact',
          message:
            'The contact provided does not look like a valid phone number or email. Please ask the user to provide a real phone number (e.g. +971501234567) or email address.',
        };
      }

      const screeningRef = getContextSnapshot(session).lastScreeningRef;
      const booking = await createBooking({
        clientId: session.clientId,
        visitorName: session.clientId ? undefined : visitorName,
        visitorContact: session.clientId ? undefined : visitorContact,
        serviceId: service.id,
        branchId: branch.id,
        slotId: matchingSlot.id,
        artistId: matchingSlot.artistId ?? requestedArtist?.id ?? undefined,
        notes: String(safeArgs.notes ?? ''),
        screeningRef,
        channel: session.channel,
        bookingType: String(safeArgs.bookingType ?? 'single') as
          | 'single'
          | 'consultation'
          | 'package_first_session',
      });

      if (!booking.success || !booking.data) {
        return { success: false, error: booking.error ?? 'booking_failed' };
      }

      const { bookingId, paymentRule } = booking.data;

      return {
        success: true,
        data: {
          bookingId,
          paymentRule,
          service: service.name,
          branch: branch.name,
          artist: requestedArtist?.name ?? matchingSlot.artistId ?? null,
          slotStart: matchingSlot.startTime,
        },
      };
    }
    case 'modify_booking': {
      const bookingRef = String(safeArgs.bookingReference ?? '');
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      if (!bookingRef) {
        return { success: false, error: 'booking_reference_required' };
      }
      if (!session.clientId) {
        return { success: false, error: 'client_required' };
      }
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      const branch = await resolveBranchName(String(safeArgs.branch ?? ''));
      if (!branch) {
        return { success: false, error: 'branch_not_found' };
      }
      const resolvedDate = resolveBookingDate(safeArgs.date);
      if (!resolvedDate.ok) {
        return { success: false, error: resolvedDate.error };
      }
      const availability = await queryAvailability({
        serviceId: service.id,
        branchId: branch.id,
        date: resolvedDate.date,
      });
      if (!availability.success || !availability.data?.length) {
        return { success: false, error: 'no_slots_available' };
      }
      const matchingSlot =
        availability.data.find((slot) => {
          const timeArg = safeArgs.time;
          if (!timeArg) {
            return true;
          }
          return slotMatchesSalonLocalTime(slot.startTime, String(timeArg));
        }) ?? availability.data[0];
      if (!matchingSlot) {
        return { success: false, error: 'no_slots_available' };
      }

      const result = await modifyBooking({
        bookingRef,
        newSlotId: matchingSlot.id,
        clientId: session.clientId,
      });
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'cancel_booking': {
      const bookingRef = String(safeArgs.bookingReference ?? '');
      if (!bookingRef) {
        return { success: false, error: 'booking_reference_required' };
      }
      if (!session.clientId) {
        return { success: false, error: 'client_required' };
      }
      const result = await cancelBooking({ bookingRef, clientId: session.clientId });
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'add_notes': {
      const bookingRef = String(safeArgs.bookingReference ?? '');
      const notes = String(safeArgs.notes ?? '');
      if (!bookingRef || !notes) {
        return { success: false, error: 'booking_reference_or_notes_missing' };
      }
      const result = await addNotes({ bookingRef, notes });
      return { success: result.success, error: result.error };
    }
    case 'initiate_payment': {
      const bookingRef = String(safeArgs.bookingReference ?? '');
      if (!bookingRef) {
        return { success: false, error: 'booking_reference_required' };
      }
      if (!session.clientId) {
        return { success: false, error: 'client_required' };
      }
      const result = await generatePaymentLink({
        bookingRef,
        amountAed: Number(safeArgs.amountAed ?? 0),
        paymentType: String(safeArgs.paymentType ?? 'deposit') as
          | 'full_upfront'
          | 'deposit'
          | 'package',
        description: String(safeArgs.description ?? `Booking ${bookingRef}`),
      });
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'lookup_faq': {
      const query = String(safeArgs.query ?? safeArgs.question ?? '');
      if (!query) {
        return { success: false, error: 'query_required' };
      }
      const result = await lookupFaq({ query });
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'list_services': {
      const result = await listServices();
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'list_service_locations': {
      const result = await listServiceLocations();
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'book_consultation': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      const branch = await resolveBranchName(String(safeArgs.branch ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      if (!branch) {
        return { success: false, error: 'branch_not_found' };
      }
      const resolvedDate = resolveBookingDate(safeArgs.date);
      if (!resolvedDate.ok) {
        return { success: false, error: resolvedDate.error };
      }

      // Require visitor details for unauthenticated sessions
      const consultSnapshot = getContextSnapshot(session);
      const consultVisitorName =
        (typeof safeArgs.visitorName === 'string' && safeArgs.visitorName.trim()) ||
        consultSnapshot.visitorName;
      const consultVisitorContact =
        (typeof safeArgs.visitorContact === 'string' && safeArgs.visitorContact.trim()) ||
        session.whatsappNumber ||
        consultSnapshot.visitorContact;
      if (!session.clientId && (!consultVisitorName || !consultVisitorContact)) {
        return { success: false, error: 'visitor_details_required' };
      }

      if (!session.clientId && consultVisitorContact && !isValidContact(consultVisitorContact)) {
        return {
          success: false,
          error: 'invalid_contact',
          message:
            'The contact provided does not look like a valid phone number or email. Please ask the user to provide a real phone number or email address.',
        };
      }

      const availability = await queryAvailability({
        serviceId: service.id,
        branchId: branch.id,
        date: resolvedDate.date,
      });
      if (!availability.success || !availability.data?.length) {
        return { success: false, error: 'no_slots_available' };
      }
      const slot = availability.data[0];
      if (!slot) {
        return { success: false, error: 'no_slots_available' };
      }
      const result = await createConsultation({
        clientId: session.clientId,
        visitorName: consultVisitorName ?? undefined,
        visitorContact: consultVisitorContact ?? undefined,
        serviceId: service.id,
        serviceCategory: service.gateCategory,
        branchId: branch.id,
        slotId: slot.id,
      });
      if (result.success) {
        await persistAgentContext(session, {
          ...(consultVisitorName ? { visitorName: consultVisitorName } : {}),
          ...(consultVisitorContact ? { visitorContact: consultVisitorContact } : {}),
        });
      }
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'check_clearance_status': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      if (!session.clientId) {
        return { success: false, error: 'client_required' };
      }
      const result = await getClearanceStatus({
        clientId: session.clientId,
        serviceId: service.id,
        serviceTier: service.serviceTier as 'T2' | 'T3',
      });
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'check_frequency': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      if (!session.clientId) {
        return { success: false, error: 'client_required' };
      }
      const result = await checkTreatmentFrequency(session.clientId, service.id);
      return { success: true, data: result };
    }
    case 'submit_screening': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      const answers = safeArgs.answers as Record<string, unknown> | undefined;
      if (!answers) {
        return { success: false, error: 'answers_required' };
      }
      const screeningSnapshot = getContextSnapshot(session);
      const visitorName =
        (typeof safeArgs.visitorName === 'string' && safeArgs.visitorName.trim()) ||
        screeningSnapshot.visitorName;
      const visitorContact =
        (typeof safeArgs.visitorContact === 'string' && safeArgs.visitorContact.trim()) ||
        screeningSnapshot.visitorContact ||
        session.whatsappNumber ||
        undefined;

      // Require identity for unauthenticated sessions — screening must be linkable
      if (!session.clientId && (!visitorName || !visitorContact)) {
        return { success: false, error: 'visitor_details_required' };
      }

      if (!session.clientId && visitorContact && !isValidContact(visitorContact)) {
        return {
          success: false,
          error: 'invalid_contact',
          message:
            'The contact provided does not look like a valid phone number or email. Please ask the user to provide a real phone number or email address.',
        };
      }

      const result = await submitScreening({
        clientId: session.clientId,
        visitorName: visitorName ?? undefined,
        visitorContact,
        serviceCategory: service.gateCategory,
        answers: answers as ScreeningAnswers,
      });
      if (result.success && result.data?.screeningId) {
        await persistAgentContext(session, {
          lastScreeningRef: result.data.screeningId,
          lastService: service.name,
          ...(visitorName ? { visitorName } : {}),
          ...(visitorContact ? { visitorContact } : {}),
        });
      }
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'check_pre_booking_requirements': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      const result = await checkPreBookingRequirements(
        service.id,
        session.clientId,
        buildGateContext(session),
      );
      return {
        success: result.gateCleared,
        data: result,
        error: result.gateCleared ? undefined : result.reason,
      };
    }
    default:
      return { success: false, error: `unknown_tool:${name}` };
  }
}

export function createSessionTools(session: SessionContext) {
  const listBranchesForServiceImpl = async ({ service }: { service: string }) =>
    executeToolImpl('list_branches_for_service', { service }, session);

  const listArtistsForServiceAtBranchImpl = async ({
    service,
    branch,
  }: {
    service: string;
    branch: string;
  }) => executeToolImpl('list_artists_for_service_at_branch', { service, branch }, session);

  const searchAvailabilityImpl = async ({
    service,
    branch,
    date,
    time,
    artist,
  }: {
    service: string;
    branch?: string;
    date: string;
    time?: string;
    artist?: string;
  }) => executeToolImpl('search_availability', { service, branch, date, time, artist }, session);

  const createBookingImpl = async ({
    service,
    branch,
    date,
    time,
    artist,
    notes,
    bookingType,
    visitorName,
    visitorContact,
  }: {
    service: string;
    branch?: string;
    date?: string;
    time?: string;
    artist?: string;
    notes?: string;
    bookingType?: string;
    visitorName?: string;
    visitorContact?: string;
  }) =>
    executeToolImpl(
      'create_booking',
      { service, branch, date, time, artist, notes, bookingType, visitorName, visitorContact },
      session,
    );

  const modifyBookingImpl = async ({
    bookingReference,
    service,
    branch,
    date,
    time,
  }: {
    bookingReference: string;
    service?: string;
    branch?: string;
    date?: string;
    time?: string;
  }) =>
    executeToolImpl(
      'modify_booking',
      { bookingReference, service, branch, date, time },
      session,
    );

  const cancelBookingImpl = async ({ bookingReference }: { bookingReference: string }) =>
    executeToolImpl('cancel_booking', { bookingReference }, session);

  const addNotesImpl = async ({
    bookingReference,
    notes,
  }: {
    bookingReference: string;
    notes: string;
  }) => executeToolImpl('add_notes', { bookingReference, notes }, session);

  const initiatePaymentImpl = async ({
    bookingReference,
    amountAed,
    paymentType,
    description,
  }: {
    bookingReference: string;
    amountAed?: number;
    paymentType?: string;
    description?: string;
  }) =>
    executeToolImpl(
      'initiate_payment',
      { bookingReference, amountAed, paymentType, description },
      session,
    );

  const lookupFaqImpl = async ({ query }: { query: string }) =>
    executeToolImpl('lookup_faq', { query }, session);

  const listServicesImpl = async () => executeToolImpl('list_services', {}, session);

  const listServiceLocationsImpl = async () =>
    executeToolImpl('list_service_locations', {}, session);

  const bookConsultationImpl = async ({
    service,
    branch,
    date,
    visitorName,
    visitorContact,
  }: {
    service: string;
    branch?: string;
    date?: string;
    visitorName?: string;
    visitorContact?: string;
  }) => executeToolImpl('book_consultation', { service, branch, date, visitorName, visitorContact }, session);

  const checkClearanceStatusImpl = async ({ service }: { service: string }) =>
    executeToolImpl('check_clearance_status', { service }, session);

  const checkFrequencyImpl = async ({ service }: { service: string }) =>
    executeToolImpl('check_frequency', { service }, session);

  const submitScreeningImpl = async ({
    service,
    answers,
    visitorName,
    visitorContact,
  }: {
    service: string;
    answers: Record<string, unknown>;
    visitorName?: string;
    visitorContact?: string;
  }) => executeToolImpl('submit_screening', { service, answers, visitorName, visitorContact }, session);

  const checkPreBookingRequirementsImpl = async ({ service }: { service: string }) =>
    executeToolImpl('check_pre_booking_requirements', { service }, session);

  const listBranchesForServiceTool = tool(listBranchesForServiceImpl, {
    name: 'list_branches_for_service',
    description:
      'Return all branches where a given service is available. Call this first when a user wants to book, before asking for a date or artist.',
    schema: z.object({
      service: z.string().describe('Treatment name, e.g. Brow Threading'),
    }),
  });

  const listArtistsForServiceAtBranchTool = tool(listArtistsForServiceAtBranchImpl, {
    name: 'list_artists_for_service_at_branch',
    description:
      'Return all artists/practitioners at a specific branch who offer a given service. Call this after the user has picked a branch.',
    schema: z.object({
      service: z.string().describe('Treatment name'),
      branch: z.string().describe('Branch or city name'),
    }),
  });

  const searchAvailability = tool(searchAvailabilityImpl, {
    name: 'search_availability',
    description:
      'Find available appointment slots by service, branch, date, and optional artist. Always call this after the user has selected an artist to confirm their availability at a given time.',
    schema: z.object({
      service: z.string().describe('Treatment name, e.g. Brow Threading'),
      branch: z.string().optional().describe('Branch or city name'),
      date: z
        .string()
        .optional()
        .describe(
          'ISO date YYYY-MM-DD from the user request only. Omit entirely if the user did not specify a date.',
        ),
      time: z.string().optional().describe('Preferred time HH:MM 24h'),
      artist: z.string().optional().describe('Artist or practitioner name selected by the user'),
    }),
  });

  const createBookingTool = tool(createBookingImpl, {
    name: 'create_booking',
    description:
      'Create a new booking for a service, branch, artist, date, and time. For visitors, pass visitorName and visitorContact. Payment link is generated automatically when required. If the artist is unavailable at the requested time, the tool returns nextAvailableTimes — present these to the user.',
    schema: z.object({
      service: z.string().describe('Treatment name'),
      branch: z.string().optional().describe('Branch or city name'),
      artist: z.string().optional().describe('Artist or practitioner name selected by the user'),
      date: z.string().optional().describe('ISO date YYYY-MM-DD'),
      time: z.string().optional().describe('Preferred time HH:MM 24h'),
      notes: z.string().optional().describe('Booking notes or preferences'),
      visitorName: z.string().optional().describe('Visitor full name (required for non-authenticated users)'),
      visitorContact: z
        .string()
        .optional()
        .describe('Visitor phone or email (required for non-authenticated users)'),
      bookingType: z
        .string()
        .optional()
        .describe('Booking type: single, consultation, or package_first_session'),
    }),
  });

  const modifyBookingTool = tool(modifyBookingImpl, {
    name: 'modify_booking',
    description: 'Move an existing booking to a new available slot.',
    schema: z.object({
      bookingReference: z.string().describe('Existing booking reference'),
      service: z.string().optional().describe('Treatment name'),
      branch: z.string().optional().describe('Branch or city name'),
      date: z.string().optional().describe('ISO date YYYY-MM-DD'),
      time: z.string().optional().describe('Preferred time HH:MM 24h'),
    }),
  });

  const cancelBookingTool = tool(cancelBookingImpl, {
    name: 'cancel_booking',
    description: 'Cancel a booking using a booking reference.',
    schema: z.object({
      bookingReference: z.string().describe('Booking reference to cancel'),
    }),
  });

  const addNotesTool = tool(addNotesImpl, {
    name: 'add_notes',
    description: 'Add notes, preferences, or health details to an existing booking.',
    schema: z.object({
      bookingReference: z.string().describe('Booking reference'),
      notes: z.string().describe('Notes to add'),
    }),
  });

  const initiatePaymentTool = tool(initiatePaymentImpl, {
    name: 'initiate_payment',
    description: 'Generate a Stripe payment link for an existing booking reference.',
    schema: z.object({
      bookingReference: z.string().describe('Booking reference'),
      amountAed: z.number().optional().describe('Amount in AED'),
      paymentType: z
        .string()
        .optional()
        .describe('Payment type: full_upfront, deposit, or package'),
      description: z.string().optional().describe('Payment description'),
    }),
  });

  const lookupFaqTool = tool(lookupFaqImpl, {
    name: 'lookup_faq',
    description:
      'Answer general questions about pricing, location, hours, or salon policy from the FAQ database.',
    schema: z.object({
      query: z.string().describe('User question about salon services or policy'),
    }),
  });

  const listServicesTool = tool(listServicesImpl, {
    name: 'list_services',
    description:
      'List all active treatments and services offered by the salon from the database. Does not include branch locations — use list_service_locations when the user asks where services are offered.',
    schema: z.object({}),
  });

  const listServiceLocationsTool = tool(listServiceLocationsImpl, {
    name: 'list_service_locations',
    description:
      'Return every active service with the branches that offer it in a single call. Use this for catalog or location overview questions instead of calling list_branches_for_service repeatedly.',
    schema: z.object({}),
  });

  const bookConsultationTool = tool(bookConsultationImpl, {
    name: 'book_consultation',
    description:
      'Book a consultation slot for a service that requires consultation or patch testing. For unauthenticated users, visitorName and visitorContact are required.',
    schema: z.object({
      service: z.string().describe('Treatment name'),
      branch: z.string().optional().describe('Branch or city name'),
      date: z.string().optional().describe('ISO date YYYY-MM-DD'),
      visitorName: z.string().optional().describe('Full name — required for non-signed-in users'),
      visitorContact: z.string().optional().describe('Phone number — required for non-signed-in users'),
    }),
  });

  const checkClearanceStatusTool = tool(checkClearanceStatusImpl, {
    name: 'check_clearance_status',
    description:
      'Check a client clearance or medical screening status for a given service.',
    schema: z.object({
      service: z.string().describe('Treatment name'),
    }),
  });

  const checkFrequencyTool = tool(checkFrequencyImpl, {
    name: 'check_frequency',
    description: 'Check whether a client can rebook a service based on frequency rules.',
    schema: z.object({
      service: z.string().describe('Treatment name'),
    }),
  });

  const submitScreeningTool = tool(submitScreeningImpl, {
    name: 'submit_screening',
    description:
      'Submit a completed medical screening questionnaire for a T3 service. Call this once you have collected all six answers from the user. All answer fields are required booleans. For unauthenticated users, visitorName and visitorContact are required.',
    schema: z.object({
      service: z.string().describe('Treatment name, e.g. Profhilo'),
      visitorName: z.string().optional().describe('Full name — required for non-signed-in users'),
      visitorContact: z.string().optional().describe('Phone number — required for non-signed-in users'),
      answers: z.object({
        q1Pregnant: z
          .boolean()
          .describe('Are you pregnant or breastfeeding? true = yes, false = no'),
        q2BloodThinners: z
          .boolean()
          .describe(
            'Are you currently taking any blood-thinning medication (e.g. Aspirin, Warfarin)? true = yes, false = no',
          ),
        q3Allergies: z
          .boolean()
          .describe(
            'Do you have any known allergies, particularly to hyaluronic acid or injectable products? true = yes, false = no',
          ),
        q4PriorProcedures: z
          .boolean()
          .describe(
            'Have you had any prior injectable procedures or facial treatments? true = yes, false = no',
          ),
        q4Detail: z
          .string()
          .optional()
          .describe('If q4PriorProcedures is true, brief description of prior procedures'),
        q5ActiveInfection: z
          .boolean()
          .describe(
            'Do you have any active skin infections, cold sores, or inflammation in the treatment area? true = yes, false = no',
          ),
        q6Autoimmune: z
          .boolean()
          .describe(
            'Do you have an autoimmune disease or are you on immunosuppressant medication? true = yes, false = no',
          ),
      }).describe('Medical screening answers — all boolean fields are required'),
    }),
  });

  const checkPreBookingRequirementsTool = tool(checkPreBookingRequirementsImpl, {
    name: 'check_pre_booking_requirements',
    description:
      'Verify whether a client is cleared to book a service or whether consultation/screening is required.',
    schema: z.object({
      service: z.string().describe('Treatment name'),
    }),
  });

  const allTools = [
    listBranchesForServiceTool,
    listArtistsForServiceAtBranchTool,
    searchAvailability,
    createBookingTool,
    modifyBookingTool,
    cancelBookingTool,
    addNotesTool,
    initiatePaymentTool,
    lookupFaqTool,
    listServicesTool,
    listServiceLocationsTool,
    bookConsultationTool,
    checkClearanceStatusTool,
    checkFrequencyTool,
    submitScreeningTool,
    checkPreBookingRequirementsTool,
  ];

  const toolImplementations: Record<
    string,
    (args: Record<string, unknown>) => Promise<ToolResultRecord>
  > = {
    list_branches_for_service: (args) =>
      listBranchesForServiceImpl(args as Parameters<typeof listBranchesForServiceImpl>[0]),
    list_artists_for_service_at_branch: (args) =>
      listArtistsForServiceAtBranchImpl(args as Parameters<typeof listArtistsForServiceAtBranchImpl>[0]),
    search_availability: (args) => searchAvailabilityImpl(args as Parameters<typeof searchAvailabilityImpl>[0]),
    create_booking: (args) => createBookingImpl(args as Parameters<typeof createBookingImpl>[0]),
    modify_booking: (args) => modifyBookingImpl(args as Parameters<typeof modifyBookingImpl>[0]),
    cancel_booking: (args) => cancelBookingImpl(args as Parameters<typeof cancelBookingImpl>[0]),
    add_notes: (args) => addNotesImpl(args as Parameters<typeof addNotesImpl>[0]),
    initiate_payment: (args) =>
      initiatePaymentImpl(args as Parameters<typeof initiatePaymentImpl>[0]),
    lookup_faq: (args) => lookupFaqImpl(args as Parameters<typeof lookupFaqImpl>[0]),
    list_services: () => listServicesImpl(),
    list_service_locations: () => listServiceLocationsImpl(),
    book_consultation: (args) =>
      bookConsultationImpl(args as Parameters<typeof bookConsultationImpl>[0]),
    check_clearance_status: (args) =>
      checkClearanceStatusImpl(args as Parameters<typeof checkClearanceStatusImpl>[0]),
    check_frequency: (args) => checkFrequencyImpl(args as Parameters<typeof checkFrequencyImpl>[0]),
    submit_screening: (args) =>
      submitScreeningImpl(args as Parameters<typeof submitScreeningImpl>[0]),
    check_pre_booking_requirements: (args) =>
      checkPreBookingRequirementsImpl(
        args as Parameters<typeof checkPreBookingRequirementsImpl>[0],
      ),
  };

  return { allTools, toolImplementations };
}
