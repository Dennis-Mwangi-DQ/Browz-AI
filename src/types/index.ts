import { z } from 'zod';

export const ServiceTier = z.enum(['T1', 'T2', 'T3']);
export const UserTier = z.enum(['visitor', 'client']);
export const Channel = z.enum(['web', 'whatsapp']);
export const BookingStatus = z.enum(['confirmed', 'modified', 'cancelled', 'pending_payment', 'completed']);
export const PaymentType = z.enum(['full_upfront', 'deposit', 'package', 'free']);
export const ScreeningStatus = z.enum(['PENDING', 'APPROVED', 'FLAGGED', 'EXPIRED', 'DECLINED', 'NEEDS_INFO']);

export const IntentId = z.enum([
  'check_availability',
  'create_booking',
  'modify_booking',
  'cancel_booking',
  'add_notes',
  'initiate_payment',
  'faq_general',
  'escalate_human',
  'greeting_smalltalk',
  'book_consultation',
  'check_clearance_status',
  'check_frequency',
]);
export type IntentId = z.infer<typeof IntentId>;

export const ClassificationResult = z.object({
  intent: IntentId,
  entities: z.object({
    service: z.string().optional(),
    branch: z.string().optional(),
    date: z.string().optional(),
    time: z.string().optional(),
    artistName: z.string().optional(),
    bookingReference: z.string().optional(),
    notes: z.string().optional(),
    paymentRequested: z.boolean().optional(),
  }),
  confidence: z.number().min(0).max(1),
});
export type ClassificationResult = z.infer<typeof ClassificationResult>;

export const ConversationTurn = z.object({
  role: z.enum(['user', 'agent']),
  content: z.string(),
  intent: IntentId.optional(),
  confidence: z.number().optional(),
  timestamp: z.string(),
});
export type ConversationTurn = z.infer<typeof ConversationTurn>;

export const ScreeningAnswersSchema = z.object({
  q1Pregnant: z.boolean(),
  q2BloodThinners: z.boolean(),
  q3Allergies: z.boolean(),
  q4PriorProcedures: z.boolean(),
  q4Detail: z.string().optional(),
  q5ActiveInfection: z.boolean(),
  q6Autoimmune: z.boolean(),
});
export type ScreeningAnswers = z.infer<typeof ScreeningAnswersSchema>;

export const ScreeningStateSchema = z.object({
  active: z.boolean(),
  serviceCategory: z.string(),
  currentQuestion: z.number().int().min(0).max(5),
  answers: ScreeningAnswersSchema.partial(),
});
export type ScreeningState = z.infer<typeof ScreeningStateSchema>;

export const AgentContextSnapshotSchema = z.object({
  lastService: z.string().optional(),
  lastBranch: z.string().optional(),
  lastBookingRef: z.string().optional(),
  lastWaitlistRef: z.string().optional(),
  lastScreeningRef: z.string().optional(),
  visitorName: z.string().optional(),
  visitorContact: z.string().optional(),
  recentTopics: z.array(z.string()).optional(),
});
export type AgentContextSnapshot = z.infer<typeof AgentContextSnapshotSchema>;

export const SessionContext = z.object({
  sessionId: z.string().uuid(),
  channel: Channel,
  userTier: UserTier,
  clientId: z.string().uuid().nullable(),
  whatsappNumber: z.string().nullable(),
  conversationHistory: z.array(ConversationTurn),
  lastIntent: IntentId.nullable(),
  lastBookingRef: z.string().nullable(),
  agentContext: AgentContextSnapshotSchema.optional(),
  status: z.enum(['active', 'escalated', 'closed']),
  screeningState: ScreeningStateSchema.optional(),
  clarificationCount: z.number().int().min(0).default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionContext = z.infer<typeof SessionContext>;

export const GateCheckResult = z.discriminatedUnion('gateCleared', [
  z.object({ gateCleared: z.literal(true) }),
  z.object({
    gateCleared: z.literal(false),
    reason: z.enum([
      'consultation_and_patch_test_required',
      'screening_under_review',
      'medical_screening_required',
    ]),
  }),
]);
export type GateCheckResult = z.infer<typeof GateCheckResult>;

export const FrequencyCheckResult = z.discriminatedUnion('tooSoon', [
  z.object({ tooSoon: z.literal(false) }),
  z.object({
    tooSoon: z.literal(true),
    hardBlock: z.boolean(),
    earliestDate: z.string(),
    weeksRemaining: z.number(),
  }),
]);
export type FrequencyCheckResult = z.infer<typeof FrequencyCheckResult>;

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  gateCategory: string;
  serviceTier: 'T1' | 'T2' | 'T3';
  city: string | null;
  durationMinutes: number;
  priceAed: number;
  requiresConsultation: boolean;
  requiresPatchTest: boolean;
  requiresScreening: boolean;
  isMedicalGated: boolean;
  minFrequencyWeeks: number | null;
  frequencyHardBlock: boolean;
  description: string;
}

export interface Branch {
  id: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  hours?: Record<string, string>;
  categories?: string[];
  status?: string;
}

export interface Artist {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
  branchId: string;
  serviceIds: string[];
}

export type TimeSlotStatus =
  | 'available'
  | 'booked'
  | 'blocked'
  | 'hold'
  | 'open_for_walkin';

export interface TimeSlot {
  id: string;
  branchId: string;
  serviceId: string;
  artistId?: string | null;
  startTime: string;
  endTime: string;
  status: TimeSlotStatus;
  isWalkin?: boolean;
}

export type WaitlistStatus =
  | 'waiting'
  | 'offered'
  | 'confirmed'
  | 'declined'
  | 'expired'
  | 'cancelled';

export type NotificationChannel = 'whatsapp' | 'web' | 'both';

export interface WaitlistEntry {
  id: string;
  clientId: string | null;
  visitorName: string | null;
  visitorContact: string;
  serviceId: string;
  branchId: string;
  preferredDate: string | null;
  preferredDateRangeStart: string | null;
  preferredDateRangeEnd: string | null;
  preferredTimeStart: string | null;
  preferredTimeEnd: string | null;
  preferredArtistId: string | null;
  notificationChannel: NotificationChannel;
  priority: number;
  status: WaitlistStatus;
  offerSentAt: string | null;
  offerExpiresAt: string | null;
  offeredSlotId: string | null;
  offeredBookingRef: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RecoveryOutcome =
  | 'waitlist_filled'
  | 'walkin_filled'
  | 'unfilled'
  | 'staff_assigned';

export type CancellationSource = 'agent' | 'staff' | 'portal' | 'no_show';

export interface SlotRecoveryLog {
  id: string;
  bookingId: string;
  slotId: string;
  serviceId: string;
  branchId: string;
  cancellationSource: CancellationSource;
  cancelledAt: string;
  recoveryStartedAt: string;
  waitlistCandidatesFound: number;
  offersSent: number;
  offersDeclined: number;
  offersExpired: number;
  outcome: RecoveryOutcome | null;
  recoveredBookingId: string | null;
  recoveryCompletedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export type BookingCancelledEvent = {
  bookingId: string;
  slotId: string;
  serviceId: string;
  branchId: string;
  startTime: string;
  cancellationSource: CancellationSource;
};

export type BookingSource =
  | 'ai_concierge'
  | 'waitlist_recovery'
  | 'walkin_agent'
  | 'walkin_staff';

export interface PendingSlotOffer {
  waitlistRef: string;
  slotId: string;
  serviceId: string;
  branchId: string;
  serviceName: string;
  branchName: string;
  startTime: string;
  artistName: string | null;
  expiresAt: string;
}

export interface PaymentRule {
  paymentType: 'full_upfront' | 'deposit' | 'package' | 'free';
  depositAmountAed: number;
  balanceDueAed: number;
}

export interface BookingRecord {
  id: string;
  clientId: string | null;
  visitorName?: string;
  visitorContact?: string;
  serviceId: string;
  branchId: string;
  slotId: string;
  artistId?: string | null;
  status: string;
  notes?: string;
  bookingType: string;
  paymentType: PaymentRule['paymentType'];
  depositAmountAed: number;
  balanceDueAed: number;
  paymentStatus: string;
  paymentLink?: string | null;
  screeningRef?: string | null;
  clearanceRef?: string | null;
  consentStatus: string;
  channel: z.infer<typeof Channel>;
  createdAt: string;
  updatedAt: string;
}

export const ChatRequest = z.object({
  message: z.string().min(1),
  sessionId: z.string().uuid().optional(),
  authToken: z.string().optional(),
  clientId: z.string().uuid().optional(),
  visitorName: z.string().optional(),
  visitorContact: z.string().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const WhatsAppWebhookBody = z.object({
  Body: z.string(),
  From: z.string(),
  To: z.string(),
  MessageSid: z.string(),
});
export type WhatsAppWebhookBody = z.infer<typeof WhatsAppWebhookBody>;

export interface ServiceLookupResult {
  service: Service | null;
  branch: Branch | null;
}
