---
name: Demo Feedback Fixes + Scripts
overview: Fix three agent/UI bugs surfaced in the demo (multi-booking confusion, missing waitlist option, screening phase sync) and produce three polished demo scripts with an agenda document.
todos:
  - id: fix-1-types
    content: Add sessionBookingRefs to AgentContextSnapshotSchema in src/types/index.ts
    status: pending
  - id: fix-1-session
    content: Update learnFromToolCalls to capture bookingId from create_booking/modify_booking results; update formatContextForPrompt to list all session refs
    status: pending
  - id: fix-1-prompt
    content: Strengthen rule 21 in SYSTEM_PROMPT to always use explicit user-provided ref over session context
    status: pending
  - id: fix-2-prompt
    content: Update SYSTEM_PROMPT rules 5, 6 to proactively offer waitlist alongside alternative dates
    status: pending
  - id: fix-3-widget
    content: Add check_pre_booking_requirements case in tool-to-widget.ts to clear widget when screening is required
    status: pending
  - id: demo-agenda
    content: Create scripts/demo-agenda.md with setup checklist, scenario summaries, and presenter talking points
    status: pending
  - id: demo-script-1
    content: Create scripts/demo-booking-modification-cancellation.md with full conversation script
    status: pending
  - id: demo-script-2
    content: Create scripts/demo-cancellation-recovery.md with full conversation script
    status: pending
  - id: demo-script-3
    content: Create scripts/demo-no-show-reduction.md with full conversation script
    status: pending
isProject: false
---

# Demo Feedback: 4 Issues — Plan

## Bug 1 — Multi-booking disambiguation (wrong booking surfaced)

**Root cause:** [`src/agent/agent-session.ts`](src/agent/agent-session.ts) stores only `lastBookingRef` (a single string). It is only updated when a tool receives `bookingReference` in its **args** — not from `create_booking` results. After two bookings in one session, the LLM has `"Booking reference in focus: BRZ-…-00002"` in its system prompt, which can override even an explicit ref the user typed.

**Changes:**

1. **[`src/types/index.ts`](src/types/index.ts)** — add `sessionBookingRefs: z.array(z.string()).optional()` to `AgentContextSnapshotSchema`.

2. **[`src/agent/agent-session.ts`](src/agent/agent-session.ts)** — in `learnFromToolCalls`, capture `bookingId` from successful `create_booking` and `modify_booking` results into `sessionBookingRefs`. In `formatContextForPrompt`, when the array has 2+ entries emit:
   ```
   Bookings created this session: BRZ-2026-00001, BRZ-2026-00002
   ```

3. **[`src/agent/agent.ts`](src/agent/agent.ts)** — add one sentence to rule 21:
   > "If the user explicitly states a bookingReference in their message, use that exact ref. Never substitute it with the Booking reference in focus from session context."

---

## Bug 2 — Proactive waitlist option when no slots available

**Root cause:** System prompt rules 5 & 6 (lines 32–33) only tell the agent to surface `nextAvailableDates` or suggest a different date/practitioner/branch. Waitlist (rule 36) is reactive — only triggered when the user explicitly asks. The frontend widget already shows a "Join waitlist" chip from `tool-to-widget.ts` lines 220–222, but the agent text never mentions it, creating a mismatch.

**Change:**

- **[`src/agent/agent.ts`](src/agent/agent.ts)** — update rules 5 and 6 to always present waitlist alongside alternatives:
  - Rule 5 (after listing `nextAvailableDates`): add "…and offer the option to join the waitlist for their original preferred date."
  - Rule 6 (no availability in 14 days): add "…or join the waitlist for when a slot opens."
  - Add a short bridging rule (e.g. rule 5b): "Whenever no slots are found, always give the user two paths: (a) an alternative date from nextAvailableDates, and (b) joining the waitlist."

---

## Bug 3 — Widget stays on time selection during screening flow

**Root cause:** After `check_pre_booking_requirements` returns `medical_screening_required`, the frontend mapper ([`browz_dbp/lib/concierge/tool-to-widget.ts`](browz_dbp/lib/concierge/tool-to-widget.ts)) falls to the `default: break` no-op at line 399. The `times` widget — set earlier by `search_availability` — remains visible while the agent is asking screening questions.

**Change:**

- **[`browz_dbp/lib/concierge/tool-to-widget.ts`](browz_dbp/lib/concierge/tool-to-widget.ts)** — add a case for `check_pre_booking_requirements` before the `default` branch:
  ```ts
  case "check_pre_booking_requirements": {
    if (r.error === "medical_screening_required") {
      statePatch = { ...statePatch, widget: null, widgetData: null };
    }
    break;
  }
  ```
  When gate is cleared (`success: true`) leave widget untouched so the booking flow continues normally.

---

## Issue 4 — Demo scripts & agenda

Four new markdown files under `scripts/`:

### `scripts/demo-agenda.md`
- Overview of the 3 demo scenarios and what capability each highlights
- Setup checklist (seed data, env vars, tabs to open)
- Suggested presenter talking points per scenario
- Total runtime estimate (~45 min)

### `scripts/demo-booking-modification-cancellation.md`
Personas: **Lina** (new visitor, web chat)

Key beats:
1. Books a gel nail appointment → branch/artist/date/time guided flow, deposit payment link surfaced
2. In the same session, books a SPMU lip treatment → agent calls `check_pre_booking_requirements`, asks all 6 screening questions in one message, submits screening, confirms booking
3. Lina wants to reschedule the gel nails → provides `BRZ-…` ref → agent calls `fetch_booking`, verifies identity, finds new slot, confirms via `modify_booking`
4. Lina cancels the SPMU → agent presents cancellation policy, waits for explicit confirm, calls `cancel_booking`

**Wow moments to call out:** context memory (same session, two different services), automated gate enforcement, identity verification before any mutation.

### `scripts/demo-cancellation-recovery.md`
Personas: **Yara** (waitlist, web chat), **Staff portal** (triggers cancel), **Hessa** (second waitlist, WhatsApp)

Key beats:
1. Yara joins waitlist for Saturday 10 AM lip blush via web chat
2. Hessa joins waitlist for the same slot via WhatsApp
3. A confirmed client's booking is cancelled via the staff portal (`POST /events/booking-cancelled`)
4. Recovery orchestrator runs: finds Yara first, dispatches WhatsApp offer with 15-min window
5. Yara declines (or times out) → offer cascades to Hessa
6. Hessa accepts via WhatsApp YES reply → booking confirmed, slot closed
7. If neither accepts → slot surfaces as walk-in

**Wow moments:** real-time automated recovery, no human in the loop, WhatsApp integration, cascade fallback.

### `scripts/demo-no-show-reduction.md`
Personas: **Omar** (confirmed booking, then no-show), **Agent** (reconfirmation + recovery)

Key beats:
1. Omar has a confirmed appointment in 24h → system sends WhatsApp reconfirmation
2. Omar confirms via YES reply → booking marked reconfirmed
3. Second scenario: Omar does not reply, appointment passes the no-show grace window
4. `processNoShows` job runs → records no-show, increments `no_show_count`, may set flag
5. Slot freed → cancellation recovery triggers for any waitlisted clients
6. Omar later tries to book again → agent applies full-upfront payment policy diplomatically (no mention of no-show penalty)

**Wow moments:** proactive outreach before the appointment, automatic policy enforcement without confrontational messaging, slot recovery triggered by no-show (not just cancellations).