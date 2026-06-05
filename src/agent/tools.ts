import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { checkPreBookingRequirements, checkTreatmentFrequency } from './gateChecker';
import { createBooking, modifyBooking, cancelBooking } from '../tools/bookings';
import { queryAvailability } from '../tools/availability';
import { createConsultation } from '../tools/consultations';
import { getClearanceStatus } from '../tools/clearances';
import { addNotes } from '../tools/notes';
import { generatePaymentLink } from '../tools/payment';
import { lookupFaq } from '../tools/faq';
import { submitScreening } from '../tools/screenings';
import { findBranchByName, findServiceByName, getDefaultBranch } from '../lib/catalog';
import { toIsoDate } from '../lib/dates';
import type { ScreeningAnswers, SessionContext } from '../types';

type ToolResultRecord = Record<string, unknown>;

function resolveServiceName(service?: string) {
  if (!service) {
    return null;
  }
  return findServiceByName(service);
}

function resolveBranchName(branch?: string) {
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
    case 'search_availability': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      const branch = await resolveBranchName(String(safeArgs.branch ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      if (!branch) {
        return { success: false, error: 'branch_not_found' };
      }
      const date = String(safeArgs.date ?? toIsoDate(new Date(Date.now() + 86400000)));
      const availability = await queryAvailability({
        serviceId: service.id,
        branchId: branch.id,
        date,
        artistId: undefined,
      });
      return {
        success: availability.success,
        data: availability.data,
        error: availability.error,
      };
    }
    case 'create_booking': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      const branch = await resolveBranchName(String(safeArgs.branch ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      const gate = await checkPreBookingRequirements(service.id, session.clientId);
      if (!gate.gateCleared) {
        return { success: false, error: 'gate_blocked', reason: gate.reason };
      }
      const date = String(safeArgs.date ?? toIsoDate(new Date(Date.now() + 86400000)));
      if (!branch) {
        return { success: false, error: 'branch_not_found' };
      }
      const availability = await queryAvailability({
        serviceId: service.id,
        branchId: branch.id,
        date,
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
          return slot.startTime.slice(11, 16) === String(timeArg);
        }) ?? availability.data[0];
      if (!matchingSlot) {
        return { success: false, error: 'no_slots_available' };
      }

      const booking = await createBooking({
        clientId: session.clientId,
        visitorContact: session.whatsappNumber ?? undefined,
        serviceId: service.id,
        branchId: branch.id,
        slotId: matchingSlot.id,
        notes: String(safeArgs.notes ?? ''),
        channel: session.channel,
        bookingType: String(safeArgs.bookingType ?? 'single') as
          | 'single'
          | 'consultation'
          | 'package_first_session',
      });

      if (!booking.success || !booking.data) {
        return { success: false, error: booking.error ?? 'booking_failed' };
      }

      return {
        success: true,
        data: {
          bookingId: booking.data.bookingId,
          paymentRule: booking.data.paymentRule,
          service: service.name,
          branch: branch.name,
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
      const date = String(safeArgs.date ?? toIsoDate(new Date(Date.now() + 86400000)));
      const availability = await queryAvailability({
        serviceId: service.id,
        branchId: branch.id,
        date,
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
          return slot.startTime.slice(11, 16) === String(timeArg);
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
    case 'book_consultation': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      const branch = await resolveBranchName(String(safeArgs.branch ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      if (!branch) {
        return { success: false, error: 'branch_not_found' };
      }
      const date = String(safeArgs.date ?? toIsoDate(new Date(Date.now() + 86400000)));
      const availability = await queryAvailability({
        serviceId: service.id,
        branchId: branch.id,
        date,
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
        visitorContact: session.whatsappNumber ?? undefined,
        serviceId: service.id,
        serviceCategory: service.gateCategory,
        branchId: branch.id,
        slotId: slot.id,
      });
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
      const result = await submitScreening({
        clientId: session.clientId,
        visitorContact: session.whatsappNumber ?? undefined,
        serviceCategory: service.gateCategory,
        answers: answers as ScreeningAnswers,
      });
      return { success: result.success, data: result.data, error: result.error };
    }
    case 'check_pre_booking_requirements': {
      const service = await resolveServiceName(String(safeArgs.service ?? ''));
      if (!service) {
        return { success: false, error: 'service_not_found' };
      }
      const result = await checkPreBookingRequirements(service.id, session.clientId);
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
  const searchAvailabilityImpl = async ({
    service,
    branch,
    date,
    time,
  }: {
    service: string;
    branch?: string;
    date: string;
    time?: string;
  }) => executeToolImpl('search_availability', { service, branch, date, time }, session);

  const createBookingImpl = async ({
    service,
    branch,
    date,
    time,
    notes,
    bookingType,
  }: {
    service: string;
    branch?: string;
    date?: string;
    time?: string;
    notes?: string;
    bookingType?: string;
  }) =>
    executeToolImpl(
      'create_booking',
      { service, branch, date, time, notes, bookingType },
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

  const bookConsultationImpl = async ({
    service,
    branch,
    date,
  }: {
    service: string;
    branch?: string;
    date?: string;
  }) => executeToolImpl('book_consultation', { service, branch, date }, session);

  const checkClearanceStatusImpl = async ({ service }: { service: string }) =>
    executeToolImpl('check_clearance_status', { service }, session);

  const checkFrequencyImpl = async ({ service }: { service: string }) =>
    executeToolImpl('check_frequency', { service }, session);

  const submitScreeningImpl = async ({
    service,
    answers,
  }: {
    service: string;
    answers: Record<string, unknown>;
  }) => executeToolImpl('submit_screening', { service, answers }, session);

  const checkPreBookingRequirementsImpl = async ({ service }: { service: string }) =>
    executeToolImpl('check_pre_booking_requirements', { service }, session);

  const searchAvailability = tool(searchAvailabilityImpl, {
    name: 'search_availability',
    description:
      'Find available appointment slots by service, branch, date, and optional time.',
    schema: z.object({
      service: z.string().describe('Treatment name, e.g. Brow Threading'),
      branch: z.string().optional().describe('Branch or city name'),
      date: z.string().describe('ISO date YYYY-MM-DD'),
      time: z.string().optional().describe('Preferred time HH:MM 24h'),
    }),
  });

  const createBookingTool = tool(createBookingImpl, {
    name: 'create_booking',
    description:
      'Create a new booking for a service, branch, date, and time. If payment is required, return the payment details as part of the result.',
    schema: z.object({
      service: z.string().describe('Treatment name'),
      branch: z.string().optional().describe('Branch or city name'),
      date: z.string().optional().describe('ISO date YYYY-MM-DD'),
      time: z.string().optional().describe('Preferred time HH:MM 24h'),
      notes: z.string().optional().describe('Booking notes or preferences'),
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
      'Answer general questions about services, pricing, location, or salon policy.',
    schema: z.object({
      query: z.string().describe('User question about salon services or policy'),
    }),
  });

  const bookConsultationTool = tool(bookConsultationImpl, {
    name: 'book_consultation',
    description:
      'Book a consultation slot for a service that requires consultation or patch testing.',
    schema: z.object({
      service: z.string().describe('Treatment name'),
      branch: z.string().optional().describe('Branch or city name'),
      date: z.string().optional().describe('ISO date YYYY-MM-DD'),
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
      'Submit a medical screening questionnaire for T3 services and return whether questions were flagged.',
    schema: z.object({
      service: z.string().describe('Treatment name'),
      answers: z
        .record(z.unknown())
        .describe('Screening questionnaire answers keyed by question field'),
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
    searchAvailability,
    createBookingTool,
    modifyBookingTool,
    cancelBookingTool,
    addNotesTool,
    initiatePaymentTool,
    lookupFaqTool,
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
    search_availability: (args) => searchAvailabilityImpl(args as Parameters<typeof searchAvailabilityImpl>[0]),
    create_booking: (args) => createBookingImpl(args as Parameters<typeof createBookingImpl>[0]),
    modify_booking: (args) => modifyBookingImpl(args as Parameters<typeof modifyBookingImpl>[0]),
    cancel_booking: (args) => cancelBookingImpl(args as Parameters<typeof cancelBookingImpl>[0]),
    add_notes: (args) => addNotesImpl(args as Parameters<typeof addNotesImpl>[0]),
    initiate_payment: (args) =>
      initiatePaymentImpl(args as Parameters<typeof initiatePaymentImpl>[0]),
    lookup_faq: (args) => lookupFaqImpl(args as Parameters<typeof lookupFaqImpl>[0]),
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
