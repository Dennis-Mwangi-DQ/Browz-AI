# Demo Script 2 — Cancellation Recovery

**Personas:** Yara (waitlist, web chat) · Hessa (waitlist, WhatsApp) · Staff portal (triggers cancel)  
**Channel:** Web chat + WhatsApp (Twilio sandbox) + Staff portal (Postman or curl)  
**Runtime:** ~15 minutes  
**Wow moments:** Real-time automated recovery · No human in the loop · WhatsApp cascade fallback · 15-minute response window

---

## Pre-demo checks

- [ ] **Lip Blush** (T2) slot exists at DIFC for this Saturday 10:00 AM — status `booked` (a confirmed client holds it)
- [ ] Yara's waitlist entry is in DB: service=Lip Blush, branch=DIFC, preferredDate=Saturday, notificationChannel=web, priority=1
- [ ] Hessa's waitlist entry is in DB: same slot, notificationChannel=whatsapp, priority=2
- [ ] A confirmed booking record exists for the slot (to be cancelled via event)
- [ ] Postman/curl command prepared: `POST /events/booking-cancelled` with the slot's `bookingId`, `slotId`, `serviceId`, `branchId`
- [ ] Twilio sandbox phone number configured; Hessa's number in the sandbox participants list
- [ ] WhatsApp sandbox open on the presenter's phone (or a second device)

---

## Beat 1 — Yara joins the waitlist (web chat)

> **Presenter:** "Saturday morning is fully booked. Yara wants Lip Blush at DIFC but can't get a slot. She opens the web chat."

**Yara types:**
```
I want to book a lip blush at the DIFC branch this Saturday at 10 AM
```

**Agent responds:** Calls `check_pre_booking_requirements` → `consultation_and_patch_test_required` (or `medical_screening_required` depending on seeded data). Also calls `search_availability`. Returns `slots: []`. Presents both paths: **alternative dates** and **join the waitlist**.

> **Presenter cue:** "See the two options the widget shows — 'Try another date' and 'Join waitlist'. The agent also says it in text. That's the waitlist proactive-offer fix."

**Yara types:**
```
I'd like to join the waitlist for Saturday 10 AM specifically
```

**Agent responds:** Collects contact details (Yara's name and phone/email) if not already provided.

**Yara types:**
```
Yara Hassan, +971509876543
```

**Agent responds:** Calls `add_to_waitlist` with service=Lip Blush, branch=DIFC, preferredDate=Saturday, preferredTimeStart=10:00, notificationChannel=web, visitorName=Yara Hassan, visitorContact=+971509876543. Returns a waitlist reference. Confirms the 15-minute response window rule.

> **Presenter cue:** Show Supabase `waitlist_entries` — Yara's row, status `waiting`, priority 1.

---

## Beat 2 — Hessa joins the waitlist (WhatsApp)

> **Presenter:** "Hessa hears about Browz from a friend. She messages on WhatsApp."

Simulate an incoming WhatsApp message to the Twilio webhook (or show it on the presenter's phone):

**Hessa's WhatsApp message:**
```
Hi, I want to get lip blush done at DIFC on Saturday around 10. Is anything available?
```

**Agent responds (via WhatsApp):** Same flow — `search_availability` returns empty. Presents alternative dates and waitlist option. Collects Hessa's contact. Calls `add_to_waitlist` with notificationChannel=whatsapp, priority=2.

> **Presenter cue:** Refresh `waitlist_entries`. Two rows — Yara (priority 1, web) and Hessa (priority 2, WhatsApp).

---

## Beat 3 — A confirmed booking is cancelled via the staff portal

> **Presenter:** "A confirmed client calls the salon and cancels. A staff member cancels it in the system — or it happens through the portal integration."

Fire the cancellation event (use Postman or terminal):

```bash
curl -X POST http://localhost:3000/events/booking-cancelled \
  -H "Content-Type: application/json" \
  -d '{
    "bookingId": "<confirmed-booking-id>",
    "slotId": "<saturday-10am-slot-id>",
    "serviceId": "<lip-blush-service-id>",
    "branchId": "<difc-branch-id>",
    "startTime": "2026-06-21T06:00:00Z",
    "cancellationSource": "staff"
  }'
```

> **Presenter cue:** "That's one API call. No manual waitlist check. No phone calls. Watch what happens next."

---

## Beat 4 — Recovery orchestrator contacts Yara (web notification)

**What happens automatically (show in server logs or Supabase):**

1. `booking-cancelled` event received → `SlotRecoveryOrchestrator` runs
2. Queries `waitlist_entries` ordered by priority → finds Yara (priority 1)
3. Updates Yara's entry to `offered`, sets `offerExpiresAt` = now + 15 minutes
4. Dispatches an offer notification to Yara's web channel

> **Presenter cue:** The web chat widget for Yara's session should now show the `slot_offer` widget — service, time, branch, and a 15-minute countdown. Refresh `waitlist_entries` — Yara's status is now `offered`.

**Yara's notification (web widget):**
> *"A slot has opened for Lip Blush at DIFC on Saturday 10:00 AM. This offer is reserved for you for 15 minutes. Would you like to confirm?"*

---

## Beat 5 — Yara declines (or times out), offer cascades to Hessa

**Yara types:**
```
No thanks, I've made other plans
```

**Agent responds:** Calls `decline_slot_offer` for Yara's waitlist ref. Confirms Yara remains on the waitlist for the next opening.

> **Presenter cue:** Refresh `waitlist_entries` — Yara's status is `declined`. The orchestrator immediately advances to Hessa (priority 2).

**What happens automatically:**
1. Yara's decline triggers cascade → Hessa's entry updated to `offered`
2. WhatsApp message sent to Hessa's number via Twilio:

> *"Hi Hessa! A Lip Blush slot has opened at our DIFC branch this Saturday at 10:00 AM. Reply YES to confirm your spot or NO to decline. This offer expires in 15 minutes."*

Show the message arriving on the demo phone / Twilio logs.

---

## Beat 6 — Hessa accepts via WhatsApp

**Hessa replies on WhatsApp:**
```
YES
```

**System processes:** `confirm_slot_offer` called for Hessa's waitlist ref → new booking created → slot status changed to `booked` → Hessa's waitlist entry updated to `confirmed` → `SlotRecoveryLog` outcome set to `waitlist_filled`.

**WhatsApp reply sent to Hessa:**
> *"Your Lip Blush appointment at DIFC is confirmed for Saturday 10:00 AM. Your booking reference is BRZ-2026-00047. Please save this reference — you'll need it to reschedule or cancel."*

> **Presenter cue:** Refresh `bookings` — new row for Hessa. Refresh `slot_recovery_logs` — `outcome: waitlist_filled`, `offersSent: 2`, `offersDeclined: 1`. **Wow moment: one cancellation → automatic offer to Yara → Yara declines → automatic cascade to Hessa → Hessa confirms. Zero human actions.**

---

## Beat 7 — Fallback: what if neither accepts?

> **Presenter (narrate, do not demo live):** "If neither Yara nor Hessa had accepted within the window, the system would mark the slot as `open_for_walkin`. The slot surfaces as a walk-in opportunity at the branch — no revenue is silently lost."

Show the `time_slots` table briefly with a `open_for_walkin` status row from a prior test run if available.

---

## Summary talking points

- Cancellation event → full recovery pipeline triggered in under 1 second
- Prioritised waitlist order respected automatically (Yara first, Hessa second)
- Channel-aware notifications: Yara via web widget, Hessa via WhatsApp
- 15-minute response window enforced; cascade on decline or timeout
- Outcome logged with full audit trail in `slot_recovery_logs`
- Zero human involvement from cancel to new confirmed booking
