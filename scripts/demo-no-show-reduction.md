# Demo Script 3 — No-Show Reduction

**Personas:** Omar (confirmed booking, then no-show) · Agent (reconfirmation + recovery)  
**Channel:** WhatsApp (outbound reconfirmation) + Web chat (future booking attempt)  
**Runtime:** ~15 minutes  
**Wow moments:** Proactive outreach before the appointment · Automatic policy enforcement without confrontational messaging · Slot recovery triggered by no-show, not just cancellations

---

## Pre-demo checks

- [ ] Omar has a confirmed booking: service=Gel Nail Extension, branch=JLT, slot=tomorrow at 11:00 AM, status=`confirmed`, reconfirmation_status=`pending`
- [ ] Omar's `client_id` is linked to a WhatsApp number in the sandbox
- [ ] The reconfirmation job (`sendReconfirmations`) can be triggered manually or is scheduled within the demo window
- [ ] The no-show grace period is set to a short value (e.g. 30 minutes) for demo purposes — document the real value in production
- [ ] `processNoShows` job can be triggered manually via a test endpoint or `ts-node` script
- [ ] A waitlist entry exists for the same slot (to show recovery after no-show)
- [ ] Web chat open in a second tab — logged in as Omar (or with Omar's `clientId` passed via auth token)

---

## Beat 1 — System sends a 24-hour reconfirmation

> **Presenter:** "It's the day before Omar's appointment. The system sends an automatic reconfirmation."

Trigger the reconfirmation job (or show it in the scheduler logs):

```bash
npx ts-node -e "import('./src/jobs/reconfirmation').then(m => m.sendReconfirmations())"
```

**WhatsApp message sent to Omar:**
> *"Hi Omar, this is a reminder that you have a Gel Nail Extension appointment at our JLT branch tomorrow at 11:00 AM. Reply YES to confirm your spot or NO to cancel. If we don't hear from you, we may release your slot."*

> **Presenter cue:** Show the message arriving on the demo phone. Show `bookings` table — `reconfirmation_status` is still `pending`.

---

## Beat 2 — Omar confirms via WhatsApp YES reply

**Omar replies:**
```
YES
```

**System processes:** WhatsApp webhook receives the YES reply → `handleReconfirmationReply` maps it to the booking → `reconfirmation_status` updated to `confirmed`.

**WhatsApp reply sent to Omar:**
> *"Thank you, Omar! Your appointment is confirmed. We look forward to seeing you tomorrow at 11:00 AM at our JLT branch."*

> **Presenter cue:** Refresh `bookings` — `reconfirmation_status` is now `confirmed`. **Wow moment: one-word reply locks in the appointment with zero staff action.**

---

## Beat 3 (second scenario) — Omar does not reply; appointment passes

> **Presenter:** "Let's rewind and play a different outcome. This time, Omar doesn't reply. The appointment time passes."

*(Reset Omar's booking to `reconfirmation_status: no_response`, `status: confirmed`. Manually advance the clock or use a test flag.)*

**Trigger the no-show job:**

```bash
npx ts-node -e "import('./src/jobs/noShow').then(m => m.processNoShows())"
```

**What happens automatically:**

1. Job finds bookings past the no-show grace window with `reconfirmation_status: no_response` (or `pending` past the appointment time)
2. Omar's booking updated: `status → no_show`, `no_show_count` incremented on his client profile
3. If `no_show_count` reaches the threshold, `no_show_flag` set to `active`
4. Slot freed → `booking-cancelled` event emitted with `cancellationSource: no_show`
5. Cancellation recovery pipeline triggers (same as Scenario 2)

> **Presenter cue:** Refresh `bookings` — Omar's row is now `no_show`. Refresh `clients` — `no_show_count` incremented, `no_show_flag: active`. Show `slot_recovery_logs` — a new recovery entry for this slot.

> **Presenter cue:** "The slot recovery from Scenario 2 fires again here — triggered by a no-show, not just an explicit cancellation. The revenue-recovery pipeline is agnostic to the reason the slot freed."

---

## Beat 4 — Waitlisted client receives the recovered slot

*(Same cascade as Scenario 2 — demonstrate briefly or narrate.)*

> **Presenter (narrate):** "Any client on the waitlist for this slot gets the same 15-minute WhatsApp offer we saw before. The system treats a no-show-triggered cancellation identically to a staff cancellation from the revenue-recovery perspective."

---

## Beat 5 — Omar tries to book again (full upfront payment policy)

> **Presenter:** "Some time later, Omar comes back to book another appointment. The system remembers."

**Omar types in web chat (authenticated session):**
```
Hi, I'd like to book a gel nail extension at JLT next week
```

**Agent responds:** Calls `list_branches_for_service` → `list_artists_for_service_at_branch`. Asks for date/time. Calls `search_availability`. Slot available. Calls `check_pre_booking_requirements` → gate cleared (T1, no screening). Proceeds to `create_booking`.

**Behind the scenes:** `create_booking` calls `resolve_deposit_rule`. Omar's `no_show_flag: active` triggers `full_upfront` payment type with `reason: no_show_flag`.

**Agent responds:** (Booking confirmed. Payment section:)
> *"Your Gel Nail Extension at JLT is confirmed for [date] at [time]. Your booking reference is BRZ-2026-00052.*
>
> *Full payment of AED [X] is required for your account at this time. [Payment link]. The link is valid for 24 hours.*
>
> *Please note: your payment is refundable if you cancel more than 24 hours before your appointment. Cancellations within 24 hours or no-shows will forfeit the full amount."*

> **Presenter cue:** "No mention of 'no-show', 'penalty', 'flag', or 'missed appointment'. The agent enforces the policy diplomatically — it's framed as the account's current payment requirement, full stop. **Wow moment: automated policy enforcement with zero confrontational language.**"

**Omar types:**
```
Why do I have to pay the full amount?
```

**Agent responds:**
> *"Full upfront payment is currently required for your account. If you have questions about this, our team can help — would you like me to connect you with reception?"*

> **Presenter cue:** The agent never explains the no-show reason. If Omar says yes to reception, it escalates via `escalate_human`. The no-show flag handling and the diplomatic framing are both automatic.

---

## Summary talking points

- Proactive WhatsApp reconfirmation sent 24 hours before the appointment — no staff action required
- Single-word YES reply locks in the appointment; NO reply or silence triggers the no-show pipeline
- No-show recording is automatic: status updated, count incremented, flag set if threshold reached
- Slot recovery fires on no-show exactly as it does on explicit cancellation — revenue recovery is always on
- Full-upfront payment policy applied silently on the next booking — no confrontational language, no policy lecture
- Every step is logged with a full audit trail in `bookings`, `clients`, and `slot_recovery_logs`
