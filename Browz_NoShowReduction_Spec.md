# Browz Booking Concierge — No-Show Reduction Spec
**Deposit Enforcement | Reminders | Reconfirmation | Repeat Offender Management**

| Field | Value |
|---|---|
| Document Type | Feature Specification |
| Domain | Beauty & Wellness (UAE) — Browz |
| Parent Spec | Browz_BookingConcierge_AI_DeepPrototype_Spec v1.2 |
| Related Spec | Browz_CancellationRecovery_Spec v1.0 |
| Stage | Proof of Concept (POC) — Extension |
| Audience | Lead AI/ML Engineer + Integration Engineer |
| Version | v1.0 — June 2026 |

> **CONFIDENTIAL — FOR INTERNAL DQ USE ONLY**

---

## 1. Executive Summary

This document specifies the **No-Show Reduction** feature for the Browz Booking Concierge. No-shows represent lost revenue and wasted practitioner time. This feature attacks the problem across four layers:

1. **Deposit enforcement** — Extending the existing payment matrix so that more booking types require upfront payment, giving clients financial skin in the game
2. **Reminder sequence** — A scheduled 24-hour-before reminder sent via WhatsApp and/or web, keeping the appointment top of mind
3. **Reconfirmation nudge** — A confirmation request sent alongside the reminder, requiring the client to actively confirm or cancel before a deadline
4. **Repeat offender management** — Clients who no-show twice or more are automatically flagged; all future bookings require full prepayment until the flag is lifted by staff

The AI agent plays a central role across all four layers: enforcing deposit rules at booking time, dispatching reminders and nudges via the messaging channels, processing reconfirmation responses conversationally, and applying prepayment rules transparently when a flagged client attempts to book.

---

## 2. System Overview

### 2.1 What This Feature Does

1. Applies extended deposit rules at booking creation based on service tier and client flag status
2. Schedules a reminder + reconfirmation job 24 hours before every confirmed appointment
3. Dispatches reminder and reconfirmation nudge via WhatsApp and/or web
4. Processes reconfirmation responses (confirm / cancel) conversationally via the agent
5. If no response by deadline: triggers the cancellation recovery pipeline and marks booking as `no_show_risk`
6. After appointment time passes without check-in: marks booking `no_show`, increments client no-show counter
7. If counter reaches 2: flags client for mandatory full prepayment on all future bookings
8. Logs all reminder, reconfirmation, and no-show events to Supabase

### 2.2 Scope Boundaries

| In Scope | Out of Scope |
|---|---|
| Deposit rule enforcement at booking (agent) | Automated refund processing for deposits on cancellations |
| 24-hour reminder dispatch (WhatsApp + web) | SMS reminders (Twilio SMS, not WhatsApp) |
| Reconfirmation nudge and response handling | In-app push notifications (mobile app) |
| Repeat offender flagging + prepayment enforcement | Legal or collections action on forfeited deposits |
| No-show counter increment and audit trail | Staff-facing no-show dispute resolution UI |

> **Note:** When a booking is not reconfirmed and transitions to `no_show_risk`, the Cancellation Recovery pipeline (Browz_CancellationRecovery_Spec v1.0) is automatically invoked to attempt slot backfill.

---

## 3. Extended Deposit Rules

### 3.1 Revised Payment Matrix

The existing payment matrix is extended. The new column — **No-Show Deposit** — applies a mandatory deposit to service tiers and booking types that previously had none or a lower threshold.

| Booking Type | Price Range | Standard Rule (existing) | No-Show Deposit Rule (new) | Balance |
|---|---|---|---|---|
| T1 — Standard Beauty | ≤ AED 200 | Full upfront | Full upfront | None |
| T1 — Standard Beauty | AED 201–1,000 | Full upfront | **20% deposit** | Balance at branch |
| T1 — Standard Beauty | > AED 1,000 | 20% deposit | 20% deposit | Balance at branch |
| T2 — SPMU | Any | 20% deposit | **30% deposit** | Balance at branch |
| T3 — Medical / Injectable | ≤ AED 1,000 | Full upfront | Full upfront | None |
| T3 — Medical / Injectable | > AED 1,000 | 20% deposit | **30% deposit** | Balance at branch |
| Package (any tier) | Any | Full upfront | Full upfront | None |
| Consultation | Free | No payment | No payment | N/A |
| **Flagged client (any service)** | **Any** | **Per above** | **100% upfront** | **None** |

**Deposit calculation:**

```typescript
export function resolveDepositRule(
  service: Service,
  bookingType: BookingType,
  clientFlag: NoShowFlag | null
): PaymentRule {
  // Flagged clients always pay full upfront
  if (clientFlag?.status === 'active') {
    return {
      paymentType: 'full_upfront',
      depositAmount: service.priceAed,
      balanceDue: 0,
      reason: 'no_show_flag'
    };
  }

  if (bookingType === 'consultation') {
    return { paymentType: 'free', depositAmount: 0, balanceDue: 0 };
  }

  if (bookingType === 'package') {
    return { paymentType: 'package', depositAmount: service.totalPrice, balanceDue: 0 };
  }

  // T2 — SPMU: 30% deposit
  if (service.serviceTier === 'T2') {
    const deposit = Math.ceil(service.priceAed * 0.30);
    return { paymentType: 'deposit', depositAmount: deposit, balanceDue: service.priceAed - deposit };
  }

  // T3 — Medical > AED 1,000: 30% deposit
  if (service.serviceTier === 'T3' && service.priceAed > 1000) {
    const deposit = Math.ceil(service.priceAed * 0.30);
    return { paymentType: 'deposit', depositAmount: deposit, balanceDue: service.priceAed - deposit };
  }

  // T1 AED 201–1,000: 20% deposit
  if (service.serviceTier === 'T1' && service.priceAed > 200 && service.priceAed <= 1000) {
    const deposit = Math.ceil(service.priceAed * 0.20);
    return { paymentType: 'deposit', depositAmount: deposit, balanceDue: service.priceAed - deposit };
  }

  // T1 ≤ AED 200 or T3 ≤ AED 1,000: full upfront
  return {
    paymentType: 'full_upfront',
    depositAmount: service.priceAed,
    balanceDue: 0
  };
}
```

### 3.2 Agent Conversation — Deposit Communication

The agent communicates deposit requirements clearly and without jargon. The `reason` field in `PaymentRule` drives the explanation.

**Standard deposit (T2 — SPMU, 30%):**
```
Here's your booking summary:

Service: Brow SPMU — AED 1,200
Branch: JBR · Thursday, 10 July · 11:00 AM

A 30% deposit of AED 360 is required to secure your booking.
The remaining AED 840 is payable at the branch on the day.

💳 Pay deposit: [link] · Valid for 24 hours.
```

**Flagged client — full prepayment:**
```
Here's your booking summary:

Service: Brow Lamination — AED 280
Branch: Dubai Mall · Saturday, 5 July · 2:00 PM

As a courtesy heads-up: full payment is required upfront for this booking.
Total: AED 280

💳 Pay now: [link] · Valid for 24 hours.
```

> The agent does not mention the no-show flag explicitly to the client — it frames full prepayment as policy, not punishment. Staff can see the flag reason on the dayboard.

### 3.3 Deposit Forfeiture Policy

Deposits are non-refundable if a client no-shows without cancelling at least 24 hours before the appointment. The agent informs clients of this at booking confirmation:

```
Please note: your deposit is refundable if you cancel more than 24 hours 
before your appointment. Cancellations within 24 hours or no-shows will 
forfeit the deposit.
```

Deposit forfeiture is logged but not automatically processed in the prototype — marked as `forfeited` in `bookings.payment_status` for staff to action via Stripe dashboard.

---

## 4. Reminder & Reconfirmation Sequence

### 4.1 Timing

All confirmed bookings with `status = 'confirmed'` and `payment_status IN ('deposit_paid', 'paid')` trigger a single scheduled job: **24 hours before appointment start time**.

| T-minus | Action |
|---|---|
| 24 hours | Reminder + reconfirmation nudge dispatched |
| 23 hours | Reconfirmation deadline — if no response, booking flagged `no_show_risk` |
| Appointment start + 15 min | If no check-in recorded: booking marked `no_show`, recovery pipeline invoked |

The 1-hour response window (T-24hr to T-23hr) gives clients time to respond without leaving the slot in limbo too close to the appointment.

### 4.2 Reminder Message

**WhatsApp:**
```
Hi [Name] 👋 Just a reminder about your appointment tomorrow at Browz [Branch]!

📅 [Service Name]
🕐 [Time] · [Date]
💅 Artist: [Artist Name or 'Any available']

Need to cancel or reschedule? Reply CANCEL or message us here and we'll 
sort it out — no hassle. Cancellations before [deadline time] won't forfeit 
your deposit.

See you tomorrow! ✨
```

**Web (in-chat widget):**
```
Reminder: your appointment is tomorrow!

📅 [Service] · [Branch] · [Date] · [Time]

[Confirm I'll be there] [I need to cancel]
```

### 4.3 Reconfirmation Nudge

The reminder and reconfirmation are sent in the **same message**. The client is asked to actively respond — this is the friction that reduces no-shows.

**WhatsApp (appended to reminder):**
```
Can you confirm you're still coming? Just reply:

YES — to confirm your appointment ✅
NO — to cancel and keep your deposit (if cancelling 24hrs+ before) ❌

If we don't hear from you by [deadline time], we may release your slot.
```

**Web (quick-reply buttons under reminder):**

`[Confirm I'll be there]` → triggers `I-18 confirm_appointment`
`[I need to cancel]` → triggers `I-04 cancel_booking`

### 4.4 Reconfirmation Response Handling

**Path A — Client confirms (YES / button):**

1. Set `bookings.reconfirmation_status = 'confirmed'`
2. Set `bookings.reconfirmed_at = now()`
3. Agent responds:
```
You're all set — see you tomorrow at [Time]! 🎉

If anything changes, just message us here.
```

**Path B — Client cancels (NO / button):**

1. Standard `cancel_booking` flow initiated
2. Deposit forfeiture rule evaluated (>24hrs = refundable; <24hrs = forfeited)
3. Slot released; Cancellation Recovery pipeline invoked
4. Agent responds:
```
No problem — your booking has been cancelled.

[If >24hrs before]: Your deposit of AED [amount] will be refunded within 5–7 business days.
[If <24hrs before]: As your appointment is within 24 hours, the deposit of AED [amount] 
is non-refundable per our cancellation policy. If you'd like to reschedule, I can help with that.
```

**Path C — No response within 1 hour:**

1. Scheduled job (`processNoShowRisk`) sets `bookings.reconfirmation_status = 'no_response'`
2. Sets `bookings.status = 'no_show_risk'`
3. Dayboard updates: slot flagged `⚠️ No Response` in amber
4. Cancellation Recovery pipeline invoked (waitlist backfill attempt begins)
5. Slot is NOT yet released — held until appointment start + 15 min in case client shows up
6. Staff notified via dayboard alert

> Slots in `no_show_risk` remain on the dayboard and recovery runs in parallel. If the client does show up, staff mark the booking as `completed` and recovery is cancelled.

---

## 5. No-Show Recording & Counter

### 5.1 No-Show Detection

A scheduled job (`processNoShows`) runs every 15 minutes. It finds bookings where:

```typescript
status IN ('confirmed', 'no_show_risk')
AND slot start_time < now() - 15 minutes
AND check_in_recorded = false
```

For each match:

1. Set `bookings.status = 'no_show'`
2. Set `bookings.payment_status = 'forfeited'` (if deposit was paid)
3. Increment `clients.no_show_count` by 1
4. Log event to `no_show_log`
5. If `clients.no_show_count >= 2`: set `clients.no_show_flag = 'active'`
6. Trigger post-no-show follow-up message (Section 5.2)
7. If slot was not already in recovery: invoke Cancellation Recovery pipeline

### 5.2 Post No-Show Follow-Up

Sent via WhatsApp to the client after the missed appointment:

**First no-show:**
```
Hi [Name], we noticed you weren't able to make your [Service] appointment 
today at [Time].

We hope everything is okay! When you're ready to rebook, just message us here.

Please note: your deposit of AED [amount] has been forfeited as per our 
cancellation policy.
```

**Second no-show (flag triggered):**
```
Hi [Name], this is the second appointment you've missed with us.

Going forward, full payment will be required at the time of booking. 
This helps us keep slots available for all our clients.

We'd love to have you back — just message us here when you're ready to book.
```

The agent does not send the second-no-show message unprompted mid-conversation. It is only sent as part of the post-no-show job. If the client subsequently contacts the agent to book, the prepayment requirement is applied and explained at that point.

---

## 6. Repeat Offender Management

### 6.1 No-Show Flag

| Flag State | Trigger | Effect on Future Bookings |
|---|---|---|
| `none` | Default | Normal payment rules apply |
| `active` | `no_show_count >= 2` | Full prepayment required on all bookings |
| `lifted` | Staff manually lifts flag | Normal payment rules restored |

The flag is stored on the `clients` table (see Section 9). Visitors (unauthenticated) cannot be flagged — the flag requires a `client_id`. Repeat visitor no-shows are logged but not automatically actioned; staff see them in the `no_show_log`.

### 6.2 Agent Behaviour for Flagged Clients

When a flagged client initiates a booking, the agent detects the flag during session resolution and applies the full-prepayment rule silently via `resolveDepositRule`. The agent does not call out the flag directly — it frames full prepayment as the current policy for their account.

If the client asks why full payment is required:

```
Full upfront payment is currently required for your account. If you have 
questions about this, our team can help — would you like me to connect you 
with reception?
```

This routes to `I-08 escalate_human` for staff to review and potentially lift the flag.

### 6.3 Flag Lift

Staff lift the flag via the dayboard (PATCH `/clients/:id/no-show-flag` with `status: 'lifted'`). Once lifted:

- `clients.no_show_flag = 'lifted'`
- `clients.no_show_flag_lifted_at = now()`
- Normal payment rules resume immediately
- Client is not notified automatically — staff may choose to inform them

---

## 7. New Intents

| Intent ID | Intent Name | Description | User Tier |
|---|---|---|---|
| I-18 | `confirm_appointment` | Client actively confirms they will attend their upcoming appointment | Client |
| I-19 | `query_deposit_policy` | Client asks about deposit rules or why a deposit is being charged | Both |
| I-20 | `query_cancellation_policy` | Client asks about the cancellation and forfeiture policy | Both |

---

## 8. New Tools

| Tool | Function Signature | Supabase Operation |
|---|---|---|
| `confirm_appointment` | `confirmAppointment(bookingRef, clientId)` | UPDATE `bookings.reconfirmation_status = 'confirmed'` |
| `get_no_show_flag` | `getNoShowFlag(clientId)` | SELECT `clients.no_show_flag, no_show_count` |
| `record_no_show` | `recordNoShow(bookingId, clientId)` | UPDATE `bookings.status = 'no_show'`; INCREMENT `clients.no_show_count`; SET flag if threshold reached |
| `resolve_deposit_rule` | `resolveDepositRule(serviceId, bookingType, clientId?)` | Pure function — no DB write; returns `PaymentRule` |

---

## 9. Data Model Changes

### 9.1 `clients` Table — New Columns

```sql
ALTER TABLE clients
  ADD COLUMN no_show_count integer DEFAULT 0,
  ADD COLUMN no_show_flag text DEFAULT 'none'
    CHECK (no_show_flag IN ('none', 'active', 'lifted')),
  ADD COLUMN no_show_flag_set_at timestamptz,
  ADD COLUMN no_show_flag_lifted_at timestamptz,
  ADD COLUMN check_in_recorded boolean DEFAULT false;
```

### 9.2 `bookings` Table — New Columns

```sql
ALTER TABLE bookings
  ADD COLUMN reconfirmation_status text DEFAULT 'pending'
    CHECK (reconfirmation_status IN ('pending', 'confirmed', 'no_response', 'not_required')),
  ADD COLUMN reconfirmation_sent_at timestamptz,
  ADD COLUMN reconfirmation_deadline timestamptz,
  ADD COLUMN reconfirmed_at timestamptz,
  ADD COLUMN check_in_recorded boolean DEFAULT false,
  ADD COLUMN check_in_at timestamptz,
  ADD COLUMN deposit_forfeited boolean DEFAULT false;
```

### 9.3 New Table: `no_show_log`

```sql
CREATE TABLE no_show_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id text REFERENCES bookings(id),
  client_id uuid REFERENCES clients(id) NULL,
  visitor_contact text,
  service_id text REFERENCES services(id),
  branch_id text REFERENCES branches(id),
  appointment_time timestamptz NOT NULL,
  reconfirmation_status text,
  deposit_amount_aed numeric(8,2) DEFAULT 0,
  deposit_forfeited boolean DEFAULT false,
  flag_triggered boolean DEFAULT false,
  no_show_count_at_event integer,
  follow_up_sent boolean DEFAULT false,
  follow_up_sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

### 9.4 New Table: `reminder_log`

```sql
CREATE TABLE reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id text REFERENCES bookings(id),
  client_id uuid REFERENCES clients(id) NULL,
  channel text CHECK (channel IN ('whatsapp', 'web', 'both')),
  reminder_type text CHECK (reminder_type IN ('reminder', 'reconfirmation_nudge', 'no_show_followup')),
  sent_at timestamptz NOT NULL,
  delivered boolean DEFAULT false,
  response text,
  responded_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

---

## 10. Scheduled Jobs

| Job | File | Interval | Purpose |
|---|---|---|---|
| `dispatchReminders` | `src/jobs/dispatchReminders.ts` | Every 15 min | Finds bookings with appointment in 24–25hrs; sends reminder + nudge if not yet sent |
| `processNoShowRisk` | `src/jobs/processNoShowRisk.ts` | Every 5 min | Finds bookings with no reconfirmation response past deadline; sets `no_show_risk` |
| `processNoShows` | `src/jobs/processNoShows.ts` | Every 15 min | Finds appointments past start + 15min with no check-in; marks `no_show`, increments counter |

---

## 11. Test Scenarios

**Group G — No-Show Reduction**

| Scenario ID | Description | Expected Outcome |
|---|---|---|
| SC-39 | Client books T1 service at AED 350 — deposit rule applies (20%) | AED 70 deposit link sent; balance AED 280 noted |
| SC-40 | Client books T2 SPMU at AED 1,200 — 30% deposit rule applies | AED 360 deposit link sent; balance AED 840 noted |
| SC-41 | Client books T3 medical service > AED 1,000 — 30% deposit applies | Correct deposit calculated and communicated |
| SC-42 | Consultation booking — no deposit | Booking confirmed; no payment link sent |
| SC-43 | Reminder sent 24 hours before appointment | WhatsApp message dispatched; `reminder_log` row created |
| SC-44 | Client confirms via WhatsApp (YES) | `reconfirmation_status = 'confirmed'`; agent sends confirmation |
| SC-45 | Client confirms via web button | Same outcome as SC-44 via web channel |
| SC-46 | Client cancels via reconfirmation (NO, >24hrs before) | Booking cancelled; deposit refund flagged; recovery pipeline invoked |
| SC-47 | Client cancels via reconfirmation (NO, <24hrs before) | Booking cancelled; deposit forfeited; agent explains policy |
| SC-48 | No response within 1 hour of nudge | `no_show_risk` set; dayboard flagged; recovery pipeline invoked |
| SC-49 | Client shows up despite `no_show_risk` | Staff marks `check_in_recorded = true`; booking = `completed`; recovery cancelled |
| SC-50 | Appointment passes with no check-in | `no_show` recorded; deposit forfeited; follow-up sent; counter incremented |
| SC-51 | Client reaches 2 no-shows — flag triggered | `no_show_flag = 'active'`; second follow-up message sent |
| SC-52 | Flagged client attempts to book | Full prepayment applied; agent explains without mentioning flag |
| SC-53 | Flagged client asks why full payment is required | Agent offers to escalate to reception; `escalate_human` triggered |
| SC-54 | Staff lifts no-show flag | `no_show_flag = 'lifted'`; next booking reverts to standard deposit rules |
| SC-55 | Visitor (unauthenticated) no-shows | `no_show_log` row created; no flag applied (no `client_id`); staff see in log |

---

## 12. Success Criteria

| Criterion | Pass Threshold | Verification Method |
|---|---|---|
| Correct deposit amount calculated for all service tiers | 100% accuracy | Unit tests on `resolveDepositRule` |
| Flagged client always gets full-prepayment rule | 100% — no bypass | Flag check unit test |
| Reminder dispatched 24hrs before appointment | ≥95% of eligible bookings within ±15min window | Timestamp delta in `reminder_log` |
| Reconfirmation nudge included in same message as reminder | 100% | Message content assertion |
| `no_show_risk` set within 5min of deadline passing | ≥95% of non-responding bookings | Job timing test |
| No-show counter incremented correctly | 100% of no-show events | Counter assertion |
| Flag triggered at exactly 2 no-shows | 100% | Threshold test |
| Flagged client prepayment rule applied on next booking | 100% | Booking flow test with flagged client fixture |
| All no-show events logged to `no_show_log` | 100% | Row presence check |
| Deposit forfeiture correctly evaluated based on cancellation timing | 100% — no incorrect refunds or forfeitures | Timing boundary tests |

---

## 13. Repository — New Files

```
src/
├── agent/
│   └── noShowPolicy.ts             # Flag checks, deposit rule resolution, forfeiture logic
├── jobs/
│   ├── dispatchReminders.ts        # 24hr reminder + reconfirmation nudge dispatcher
│   ├── processNoShowRisk.ts        # Marks no_show_risk for non-responding bookings
│   └── processNoShows.ts           # Marks no_show after appointment window passes
├── tools/
│   └── noShow.ts                   # confirmAppointment, getNoShowFlag, recordNoShow tools
supabase/
│   └── schema_noshow.sql           # New columns on clients + bookings; no_show_log; reminder_log
tests/
│   ├── noShowPolicy.test.ts        # Deposit rule + flag logic unit tests
│   ├── reminders.test.ts           # Reminder dispatch and reconfirmation flow tests
│   └── noShow.test.ts              # No-show recording, counter, and flag tests (SC-39 to SC-55)
```

---

## 14. Environment Variables — Additions

| Variable Name | Description | Default |
|---|---|---|
| `NO_SHOW_FLAG_THRESHOLD` | Number of no-shows before mandatory prepayment flag triggers | `2` |
| `RECONFIRMATION_WINDOW_HOURS` | Hours before appointment to send reminder + nudge | `24` |
| `RECONFIRMATION_RESPONSE_DEADLINE_HOURS` | Hours client has to respond before `no_show_risk` is set | `1` |
| `NO_SHOW_GRACE_MINUTES` | Minutes after appointment start before `no_show` is recorded | `15` |
| `DEPOSIT_FORFEITURE_WINDOW_HOURS` | Hours before appointment inside which cancellation forfeits deposit | `24` |
| `REMINDER_JOB_INTERVAL_MS` | Interval for `dispatchReminders` job | `900000` (15 min) |
| `NO_SHOW_RISK_JOB_INTERVAL_MS` | Interval for `processNoShowRisk` job | `300000` (5 min) |
| `NO_SHOW_JOB_INTERVAL_MS` | Interval for `processNoShows` job | `900000` (15 min) |
