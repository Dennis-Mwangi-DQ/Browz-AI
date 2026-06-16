# Browz Booking Concierge — Cancellation Recovery Spec
**Dayboard Slot Recovery | Waitlist & Walk-in Backfill**

| Field | Value |
|---|---|
| Document Type | Feature Specification |
| Domain | Beauty & Wellness (UAE) — Browz |
| Parent Spec | Browz_BookingConcierge_AI_DeepPrototype_Spec v1.2 |
| Stage | Proof of Concept (POC) — Extension |
| Audience | Lead AI/ML Engineer + Integration Engineer |
| Version | v1.0 — June 2026 |

> **CONFIDENTIAL — FOR INTERNAL DQ USE ONLY**

---

## 1. Executive Summary

This document specifies the **Cancellation Recovery** feature for the Browz Booking Concierge. When a booking is cancelled — whether by a client, visitor, staff, or the agent — the system must detect the open slot, attempt to fill it automatically, and surface the outcome on the dayboard.

Recovery follows a strict two-stage priority order: **waitlist first, walk-ins second**. Waitlisted clients are notified via WhatsApp, web, or both (configurable per branch) and given a 15-minute response window. If no waitlist match is available or confirmed, the open slot is surfaced on the dayboard for staff to assign to a walk-in — either registered manually at the desk or booked digitally through the agent. If the slot remains unfilled after both stages, staff are notified and make the final call.

The waitlist is a new table, designed from scratch as part of this spec.

---

## 2. System Overview

### 2.1 What This Feature Does

1. Detects a booking cancellation event (agent, client portal, or staff action)
2. Marks the freed `time_slot` as `available` in Supabase
3. Searches the waitlist for matching entries (service, branch, date window)
4. If matches found: notifies the top-ranked candidate and starts a 15-minute offer window
5. If offer is accepted: creates a new booking, marks slot `booked`, updates dayboard
6. If offer expires or is declined: moves to next waitlist candidate or falls through to walk-in stage
7. If waitlist exhausted: flags slot as `open_for_walkin` on the dayboard for staff decision
8. Logs all recovery attempts and outcomes to Supabase

### 2.2 Scope Boundaries

| In Scope | Out of Scope |
|---|---|
| Cancellations from the AI agent | Cancellations from third-party booking platforms |
| Cancellations from staff via dayboard | Automatic rescheduling of the cancelled client |
| Waitlist matching and notification | Proactive promotion to clients not on the waitlist |
| Walk-in surfacing on dayboard | Walk-in payment processing (handled by existing payment flow) |
| Recovery logging and audit trail | Practitioner / medical-gating re-validation for recovered slots |

> **Note:** Pre-booking gate checks (T1/T2/T3) still apply when a waitlisted client confirms. The agent must verify clearance status before finalising the recovered booking.

---

## 3. Cancellation Trigger Points

A recovery flow is initiated any time a booking transitions to `cancelled` status, regardless of who cancelled it.

| Trigger Source | Mechanism | Notes |
|---|---|---|
| AI agent (`cancel_booking` tool) | Tool sets `bookings.status = 'cancelled'` → emits `booking.cancelled` event | Standard client-initiated flow |
| Staff via dayboard | PATCH `/bookings/:id/cancel` REST call | Staff may cancel on behalf of client or due to operational reasons |
| Client via self-service portal | Direct Supabase update via authenticated API | Triggers same event as agent cancellation |
| No-show auto-cancellation | Scheduled job marks confirmed bookings as `no_show` after appointment start + 15 min | Same recovery pipeline applies |

All four paths emit the same internal `booking.cancelled` event that the recovery service listens to.

---

## 4. Waitlist Design

### 4.1 Waitlist Table (New — Supabase)

```sql
CREATE TABLE waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) NULL,
  visitor_name text,
  visitor_contact text NOT NULL,
  service_id text REFERENCES services(id) NOT NULL,
  branch_id text REFERENCES branches(id) NOT NULL,
  preferred_date date,
  preferred_date_range_start date,
  preferred_date_range_end date,
  preferred_time_start time,
  preferred_time_end time,
  preferred_artist_id text REFERENCES artists(id) NULL,
  notification_channel text DEFAULT 'whatsapp' CHECK (notification_channel IN ('whatsapp', 'web', 'both')),
  priority integer DEFAULT 0,
  status text DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'confirmed', 'declined', 'expired', 'cancelled')),
  offer_sent_at timestamptz,
  offer_expires_at timestamptz,
  offered_slot_id uuid REFERENCES time_slots(id) NULL,
  offered_booking_ref text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for fast slot-match queries
CREATE INDEX idx_waitlist_branch_service ON waitlist(branch_id, service_id, status);
CREATE INDEX idx_waitlist_status ON waitlist(status);
CREATE INDEX idx_waitlist_offer_expires ON waitlist(offer_expires_at) WHERE status = 'offered';
```

### 4.2 Waitlist Entry Fields

| Field | Purpose |
|---|---|
| `preferred_date` | Single target date (optional if range is set) |
| `preferred_date_range_start/end` | Date flexibility window — matched against freed slot date |
| `preferred_time_start/end` | Time-of-day window preference |
| `preferred_artist_id` | Named artist preference — matched if possible, not required |
| `notification_channel` | Per-entry channel preference; overridden by branch default if `both` |
| `priority` | Sort order for offer queue. Lower number = higher priority. Default = insertion order (0). Staff can manually boost entries. |
| `offer_expires_at` | Set to `offer_sent_at + 15 minutes` when offer is dispatched |

### 4.3 Waitlist Entry — Agent Conversation Flow

A client or visitor can join the waitlist via the AI agent when no availability exists for their requested slot.

```
User: "Can I get brow lamination at Dubai Mall this Saturday at 2pm?"
Agent: [check_availability] → no slots found

Agent: "There's no availability for Brow Lamination at Dubai Mall this Saturday at 2pm.

Would you like me to add you to the waitlist? If a slot opens up, I'll send you a 
message straight away and hold it for 15 minutes."

User: "Yes please"
Agent: "Done — you're on the waitlist for Brow Lamination at Dubai Mall on Saturday.

Is there a time window that works best for you? For example, 'mornings only' or 
'anytime after 12pm'."
```

**Agent tool called:** `add_to_waitlist(serviceId, branchId, preferredDate, preferredTimeStart, preferredTimeEnd, visitorName, visitorContact, preferredArtistId?)`

**Confirmation output:**
```
✅ You're on the waitlist!

Service: Brow Lamination
Branch: Dubai Mall
Preferred date: Saturday, 5 July 2026
Time preference: After 12:00 PM

I'll message you on WhatsApp if a slot opens up. You'll have 15 minutes to confirm.
Reference: WL-2026-00089
```

---

## 5. Recovery Pipeline — Step by Step

### Step 1 — Cancellation Detected

- Event `booking.cancelled` is emitted with `{ bookingId, slotId, serviceId, branchId, startTime }`
- `time_slots.status` is set to `available`
- Dayboard entry updated: slot shown as `Open` (amber state)
- Recovery service is invoked asynchronously — does not block the cancellation response

### Step 2 — Waitlist Match Query

```typescript
export async function findWaitlistMatches(
  slotId: string,
  serviceId: string,
  branchId: string,
  slotStartTime: Date
): Promise<WaitlistEntry[]> {
  const slotDate = toIsoDate(slotStartTime);
  const slotTime = slotStartTime.toTimeString().slice(0, 5); // 'HH:MM'

  const { data } = await supabase
    .from('waitlist')
    .select('*')
    .eq('service_id', serviceId)
    .eq('branch_id', branchId)
    .eq('status', 'waiting')
    .or(`preferred_date.eq.${slotDate},and(preferred_date_range_start.lte.${slotDate},preferred_date_range_end.gte.${slotDate})`)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });

  if (!data) return [];

  // Filter by time preference if set
  return data.filter(entry => {
    if (!entry.preferred_time_start && !entry.preferred_time_end) return true;
    const start = entry.preferred_time_start ?? '00:00';
    const end = entry.preferred_time_end ?? '23:59';
    return slotTime >= start && slotTime <= end;
  });
}
```

**Match criteria:**
- Same `service_id`
- Same `branch_id`
- Freed slot date falls within the entry's preferred date or date range
- Freed slot time falls within the entry's preferred time window (if set)
- Entry `status = 'waiting'`

**Sort order:** `priority ASC`, then `created_at ASC` (FIFO within same priority tier)

### Step 3 — Offer Dispatch (Waitlist Candidate)

For the top-ranked match:

1. Set `waitlist.status = 'offered'`
2. Set `waitlist.offer_sent_at = now()`
3. Set `waitlist.offer_expires_at = now() + 15 minutes`
4. Set `waitlist.offered_slot_id = slotId`
5. Mark `time_slots.status = 'hold'` (prevents double-offers)
6. Send notification per `notification_channel` config

**Notification message (WhatsApp):**
```
Hi [Name] 👋 A slot just opened up at Browz [Branch]!

Service: [Service Name]
Date: [Day, Date]
Time: [Time]
Artist: [Artist Name or 'Any available']

Would you like to book this slot? Reply YES to confirm or NO to pass.
This offer is held for you until [HH:MM] — 15 minutes from now.
```

**Notification message (Web — in-chat widget):**
```
A slot opened up that matches your waitlist request:

📅 [Service] · [Branch] · [Date] · [Time]

[Confirm this slot] [No thanks]
```

If `notification_channel = 'both'`: WhatsApp message sent AND in-chat notification shown if the user has an active web session.

### Step 4 — Offer Response Handling

**Path A — Client confirms (YES / button tap):**

1. Set `waitlist.status = 'confirmed'`
2. Run pre-booking gate check (`checkPreBookingRequirements`) — T1 proceeds immediately; T2/T3 gate logic applies as per main spec
3. If gate cleared: call `createBooking(...)` with `booking_source = 'waitlist_recovery'`
4. Set `time_slots.status = 'booked'`
5. Send booking confirmation to client (same format as standard confirmation)
6. Update dayboard: slot shown as `Filled` (green, with `[Recovered]` tag)
7. Log recovery event to `slot_recovery_log`

**Path B — Client declines (NO / button tap):**

1. Set `waitlist.status = 'declined'`
2. Set `time_slots.status = 'available'` (release hold)
3. Move to next waitlist candidate (repeat Step 3)
4. If no more candidates: proceed to Step 5

**Path C — Offer expires (no response within 15 minutes):**

1. Scheduled job (`processExpiredOffers`) runs every 5 minutes
2. Finds entries where `status = 'offered'` AND `offer_expires_at < now()`
3. Sets `waitlist.status = 'expired'`
4. Releases slot hold: `time_slots.status = 'available'`
5. Sends follow-up to client: "Sorry, your held slot has expired. You're still on the waitlist for the next available opening."
6. Moves to next waitlist candidate (repeat Step 3)

### Step 5 — Walk-in Stage (Waitlist Exhausted or Empty)

If no waitlist match is found or all offers expire/decline:

1. Set `time_slots.status = 'open_for_walkin'`
2. Dayboard entry updated: slot shown as `Walk-in Available` (blue state)
3. Staff are notified via dayboard alert

**Walk-in registration — two paths:**

**Path A — In-person (Staff registers on dayboard):**
- Staff taps the open slot on the dayboard
- Enters walk-in name and contact
- Selects service (pre-filled from the slot) and confirms
- System calls `createBooking(...)` with `booking_type = 'single'`, `booking_source = 'walkin_staff'`, `client_id = null`
- Slot marked `booked`, dayboard updated

**Path B — Digital walk-in (Agent handles via chat or WhatsApp):**
- A user contacts the agent requesting a same-day appointment
- Agent calls `check_availability`, which surfaces `open_for_walkin` slots in results
- Standard booking flow proceeds with `booking_source = 'walkin_agent'`
- Slot marked `booked`, dayboard updated

### Step 6 — No Fill Outcome

If walk-in stage produces no booking before appointment time:

1. Slot remains `open_for_walkin` on dayboard
2. Staff see it flagged as `Unfilled` 15 minutes before start time
3. Staff decide: assign manually, keep open, or close it
4. Outcome logged to `slot_recovery_log` with `outcome = 'unfilled'`

No automated action is taken beyond notification — staff own the final decision.

---

## 6. Dayboard States

| Slot State | Dayboard Display | Colour | Triggered By |
|---|---|---|---|
| `booked` | Confirmed booking | Green | Normal booking flow |
| `available` | Open (just cancelled) | Amber | Cancellation detected |
| `hold` | Offer pending | Amber + spinner | Waitlist offer dispatched |
| `open_for_walkin` | Walk-in Available | Blue | Waitlist exhausted |
| `booked` (recovered) | Filled — Recovered | Green + `[R]` badge | Waitlist or walk-in fill |
| `unfilled` | Unfilled | Grey | Appointment time passed, no fill |

---

## 7. Intent & Tool Extensions

### 7.1 New Intents

| Intent ID | Intent Name | Description | User Tier |
|---|---|---|---|
| I-13 | `join_waitlist` | Add client or visitor to waitlist for a service/branch/date | Both |
| I-14 | `check_waitlist_status` | Check position or status of an existing waitlist entry | Both |
| I-15 | `cancel_waitlist` | Remove an entry from the waitlist | Both |
| I-16 | `confirm_waitlist_offer` | Accept an open slot offer dispatched by recovery system | Both |
| I-17 | `decline_waitlist_offer` | Decline a slot offer and remain on (or exit) the waitlist | Both |

### 7.2 New Tools

| Tool | Function Signature | Supabase Operation |
|---|---|---|
| `add_to_waitlist` | `addToWaitlist(serviceId, branchId, preferredDate, timeStart?, timeEnd?, clientId?, visitorName?, visitorContact?, artistId?)` | INSERT into `waitlist` |
| `check_waitlist_status` | `checkWaitlistStatus(waitlistRef, visitorContact?)` | SELECT from `waitlist` |
| `cancel_waitlist_entry` | `cancelWaitlistEntry(waitlistRef)` | UPDATE `waitlist.status = 'cancelled'` |
| `confirm_slot_offer` | `confirmSlotOffer(waitlistRef, slotId)` | Runs gate check → INSERT into `bookings`, UPDATE `waitlist` + `time_slots` |
| `decline_slot_offer` | `declineSlotOffer(waitlistRef)` | UPDATE `waitlist.status = 'declined'`, release slot hold |
| `find_waitlist_matches` | `findWaitlistMatches(slotId, serviceId, branchId, slotStartTime)` | SELECT from `waitlist` (internal — not agent-facing) |
| `register_walkin` | `registerWalkin(slotId, visitorName, visitorContact, serviceId, branchId, notes?)` | INSERT into `bookings` with `booking_source = 'walkin_staff'` |

---

## 8. Recovery Logging

### 8.1 New Table: `slot_recovery_log`

```sql
CREATE TABLE slot_recovery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id text REFERENCES bookings(id),
  slot_id uuid REFERENCES time_slots(id),
  service_id text REFERENCES services(id),
  branch_id text REFERENCES branches(id),
  cancellation_source text CHECK (cancellation_source IN ('agent', 'staff', 'portal', 'no_show')),
  cancelled_at timestamptz NOT NULL,
  recovery_started_at timestamptz NOT NULL,
  waitlist_candidates_found integer DEFAULT 0,
  offers_sent integer DEFAULT 0,
  offers_declined integer DEFAULT 0,
  offers_expired integer DEFAULT 0,
  outcome text CHECK (outcome IN ('waitlist_filled', 'walkin_filled', 'unfilled', 'staff_assigned')),
  recovered_booking_id text REFERENCES bookings(id) NULL,
  recovery_completed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);
```

Every cancellation that triggers the recovery pipeline creates one `slot_recovery_log` row, updated as the pipeline progresses.

---

## 9. Branch Notification Configuration

Notification channel defaults are configurable per branch. Add the following to the `branches` table:

```sql
ALTER TABLE branches
  ADD COLUMN waitlist_notification_default text DEFAULT 'whatsapp'
    CHECK (waitlist_notification_default IN ('whatsapp', 'web', 'both')),
  ADD COLUMN offer_window_minutes integer DEFAULT 15;
```

Individual waitlist entries can override the branch default via `waitlist.notification_channel`.

---

## 10. Test Scenarios

**Group F — Cancellation Recovery**

| Scenario ID | Description | Expected Outcome |
|---|---|---|
| SC-26 | Client cancels T1 booking; waitlist match exists with matching date + time → offer sent | Offer dispatched within 30s; slot in `hold` state |
| SC-27 | Waitlisted client confirms offer within 15 min | New booking created; slot `booked`; dayboard shows `[R]` badge |
| SC-28 | Waitlisted client declines; next candidate exists | Second offer dispatched immediately |
| SC-29 | Offer expires (no response in 15 min) | Expiry job runs ≤5 min later; follow-up sent; next candidate offered |
| SC-30 | No waitlist matches for cancelled slot | Slot immediately surfaced as `Walk-in Available` on dayboard |
| SC-31 | All waitlist candidates exhaust (decline/expire) | Slot falls through to walk-in stage |
| SC-32 | Staff registers walk-in via dayboard | Booking created with `booking_source = 'walkin_staff'`; slot marked `booked` |
| SC-33 | Walk-in books digitally via agent on same day | Agent surfaces `open_for_walkin` slot; booking confirmed with `booking_source = 'walkin_agent'` |
| SC-34 | Slot unfilled at appointment time | Dayboard flags `Unfilled`; staff notified; no automated action |
| SC-35 | Waitlisted client for T2 service confirms offer but has no patch test clearance | Gate check fires; agent explains consultation requirement; booking not confirmed until gate cleared |
| SC-36 | Visitor joins waitlist via agent (no account) | Entry created with `client_id = null`, `visitor_name` + `visitor_contact` stored |
| SC-37 | Client checks waitlist status via agent | Agent returns position and offered slot details if active |
| SC-38 | No-show triggers recovery pipeline | Treated identically to cancellation; `cancellation_source = 'no_show'` in log |

---

## 11. Success Criteria

| Criterion | Pass Threshold | Verification Method |
|---|---|---|
| Cancellation event triggers recovery pipeline | 100% of cancellations | Event listener test |
| Waitlist match query returns correct candidates | ≥95% accuracy against seed data | Unit test against Supabase test data |
| Offer dispatched within 30 seconds of cancellation | ≥95% of triggered recoveries | Timestamp delta in `slot_recovery_log` |
| Slot hold released within 5 min of expiry | 100% — no stuck holds | Expiry job test |
| Booking created correctly on confirmed offer | 100% of confirmations | Database validation |
| Pre-booking gate check runs on waitlist confirmation | 100% — T2/T3 never bypassed | Gate check unit test |
| Dayboard state accurate throughout recovery pipeline | 100% — no stale states | State transition tests |
| Walk-in slot surfaced after waitlist exhausted | 100% of fallthrough cases | Scenario run SC-31 |
| Recovery outcome logged in `slot_recovery_log` | 100% of events | Row presence check |

---

## 12. Tech Stack

This feature extends the existing Browz Booking Concierge stack. No new infrastructure layers are introduced.

| Layer | Technology | Role in This Feature |
|---|---|---|
| LLM / Agent Brain | Claude Sonnet (via Anthropic API) | Handles waitlist intents (I-13 to I-17) conversationally; extracts date/time/service entities from natural language; generates offer and confirmation messages in Browz brand tone |
| Agent Orchestration | LangChain (TypeScript) Agent Executor | Routes waitlist intents to the correct tool; chains `add_to_waitlist` → `generate_payment_link` if service requires deposit; executes `confirm_slot_offer` gate-check sub-chain for T2/T3 services |
| Backend API | Express.js + TypeScript | New route: `POST /events/booking-cancelled` receives internal cancellation events and invokes `recoveryOrchestrator.ts` |
| Recovery Orchestrator | `recoveryOrchestrator.ts` (new) | Event-driven coordinator — not LLM-invoked; pure TypeScript logic that queries waitlist, dispatches offers, manages state transitions, and falls through to walk-in stage |
| Notification Dispatch | `notify.ts` (new) + Twilio WhatsApp Sandbox + Supabase session push | Sends offer messages on the channel configured per waitlist entry (`whatsapp`, `web`, or `both`) |
| Scheduled Jobs | Node.js `setInterval` (prototype) | `processExpiredOffers` — runs every 5 min; finds stale `offered` entries and cascades to next candidate |
| Database | Supabase (PostgreSQL) | New tables: `waitlist`, `slot_recovery_log`; new columns on `branches` |
| Dayboard Interface | REST PATCH endpoints on `time_slots` + `bookings` | Slot state changes (`available`, `hold`, `open_for_walkin`, `booked`) are written to Supabase and polled or pushed to the dayboard UI |
| Testing | Vitest | `recovery.test.ts` and `waitlist.test.ts` cover SC-26 to SC-38 |

### 12.1 AI Pipeline — Recovery Context

The LLM is involved in two distinct moments within the recovery feature:

**Moment 1 — Waitlist join (agent-initiated, conversational):**

```
User turn → LangChain Agent Executor
  → LLM classifies intent as I-13 (join_waitlist)
  → LLM extracts entities: service, branch, preferred date, time window, artist preference
  → Tool call: add_to_waitlist(...)
  → LLM generates confirmation message in Browz tone
  → Response returned to user (web or WhatsApp)
```

**Moment 2 — Offer confirmation (agent-initiated, conversational):**

```
User reply (YES / button tap) → LangChain Agent Executor
  → LLM classifies intent as I-16 (confirm_waitlist_offer)
  → Tool call: confirm_slot_offer(waitlistRef, slotId)
    → Sub-chain: checkPreBookingRequirements(serviceId, clientId)
      → T1: proceed directly → createBooking(...)
      → T2/T3: gate check → if not cleared, LLM explains requirement conversationally
  → LLM generates booking confirmation or gate explanation
  → Response returned to user
```

**Non-LLM moments (orchestrator-only):**

The `recoveryOrchestrator.ts` module operates without LLM involvement. It is a deterministic TypeScript state machine triggered by the `booking.cancelled` event:

```
booking.cancelled event
  → findWaitlistMatches() — SQL query, no LLM
  → dispatchOffer() — Twilio/session push, no LLM
  → processExpiredOffers() job — state transition, no LLM
  → Slot fallthrough to open_for_walkin — Supabase write, no LLM
```

LLM is only invoked when a human is in the loop — joining the waitlist or responding to an offer.

### 12.2 LLM Configuration

| Parameter | Value |
|---|---|
| Active model | Ollama (local) — default for prototype |
| Switchable providers | OpenAI (GPT-4o) · Anthropic (Claude Sonnet) — configured and ready, swappable via env |
| Orchestration | LangChain TypeScript Agent Executor with structured tool-calling |
| Max tokens | 1,024 per turn |
| Temperature | 0.3 — low variance for consistent booking confirmations |
| Tool schema | TypeScript-typed LangChain tools with Zod input validation |

**Provider switching** is handled via the `LLM_PROVIDER` environment variable. The LangChain abstraction layer means no tool or prompt code changes are required when switching providers — only credentials and model name resolve differently.

```typescript
// lib/llm.ts — provider resolution
const provider = process.env.LLM_PROVIDER ?? 'ollama';

export const llm =
  provider === 'anthropic'
    ? new ChatAnthropic({ model: 'claude-sonnet-4-20250514', temperature: 0.3 })
    : provider === 'openai'
    ? new ChatOpenAI({ model: 'gpt-4o', temperature: 0.3 })
    : new ChatOllama({ model: process.env.OLLAMA_MODEL ?? 'llama3', temperature: 0.3 });
```

### 12.3 Prompt Design — Waitlist Intents

The system prompt governing waitlist intents is an extension of the parent agent system prompt. The following block is appended:

```
WAITLIST RULES:
- When a user asks to join a waitlist, collect: service, branch, preferred date or date range, 
  time preference (if any), preferred artist (if any), and contact details if not already in session.
- Ask for missing fields one at a time — never dump all questions at once.
- When confirming a waitlist entry, always state: service, branch, preferred date, time window, 
  and the 15-minute response window rule.
- When a user responds to a slot offer, confirm the slot details before calling confirm_slot_offer.
- If gate check fails on confirmation, explain the requirement (consultation / screening) clearly 
  and offer the next step. Do not re-offer the slot — it may have been released.
- Never tell a user their position number in the waitlist queue.
```

---

## 13. Repository — New Files

The following files extend the existing `browz-concierge-agent/` structure:

```
src/
├── agent/
│   └── recoveryOrchestrator.ts     # Cancellation event handler; coordinates recovery pipeline
├── tools/
│   ├── waitlist.ts                 # add, check, cancel waitlist tools
│   └── walkin.ts                   # register walk-in tool (staff path)
├── jobs/
│   └── processExpiredOffers.ts     # Scheduled job — runs every 5 min; expires stale offers
├── lib/
│   └── notify.ts                   # Notification dispatch (WhatsApp via Twilio, web via session push)
supabase/
│   └── schema_recovery.sql         # Waitlist + slot_recovery_log tables; branch column additions
tests/
│   ├── recovery.test.ts            # Pipeline integration tests (SC-26 to SC-38)
│   └── waitlist.test.ts            # Waitlist tool unit tests
```

---

## 13. Environment Variables — Additions

No new third-party credentials required. Recovery uses existing Twilio and Supabase credentials.

| Variable Name | Description | Notes |
|---|---|---|
| `LLM_PROVIDER` | Active LLM provider | `ollama` (default) · `openai` · `anthropic` |
| `OLLAMA_MODEL` | Ollama model name to use | Default `llama3`; only read when `LLM_PROVIDER=ollama` |
| `OPENAI_API_KEY` | OpenAI API key | Only required when `LLM_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` | Anthropic API key | Only required when `LLM_PROVIDER=anthropic` |
| `OFFER_WINDOW_MINUTES` | Default offer hold duration in minutes | Defaults to `15`; overridden by `branches.offer_window_minutes` |
| `RECOVERY_JOB_INTERVAL_MS` | Interval for `processExpiredOffers` job | Default `300000` (5 min) |
| `WALKIN_SLOT_NOTIFY_LEAD_MIN` | Minutes before appointment to send unfilled alert to staff | Default `15` |
