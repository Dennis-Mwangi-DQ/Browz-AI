# Demo Script 1 — Booking, Modification & Cancellation

**Persona:** Lina (new visitor, web chat — not authenticated)  
**Channel:** Web chat widget at `http://localhost:3001`  
**Runtime:** ~15 minutes  
**Wow moments:** Context memory across two bookings in one session · Automated screening gate · Silent identity verification before any mutation

---

## Pre-demo checks

- [ ] Open a fresh (incognito) browser tab to avoid a stale session
- [ ] Supabase `bookings` table open in a second tab
- [ ] Both **Gel Nail Extension (T1)** and **SPMU Lip Treatment (T2)** services exist in the DB
- [ ] At least one artist is available for each service at **JLT** branch

---

## Beat 1 — Book a Gel Nail Extension

> **Presenter:** "Lina visits the website, she's never been here before. She types a simple request."

**Lina types:**
```
Hi, I'd like to book a gel nail extension appointment
```

**Agent responds:** Lists branches offering Gel Nail Extension (e.g. JLT, DIFC). Asks Lina to pick one.

**Lina types:**
```
JLT please
```

**Agent responds:** Lists available artists at JLT for Gel Nail Extension. Asks Lina to choose one.

**Lina types:**
```
I'll go with the first one
```

**Agent responds:** Asks for preferred date and time.

**Lina types:**
```
This Saturday at 11 AM
```

**Agent responds:** Calls `search_availability`. Slot is available. Presents the slot. Before booking, collects visitor identity.

> **Presenter cue:** "Notice it hasn't booked yet — it's collecting identity first, because Lina is a visitor."

**Lina types:**
```
My name is Lina Al Rashid and my number is +971501234567
```

**Agent responds:** Calls `create_booking`. Returns a booking reference (e.g. `BRZ-2026-00001`). Surfaces the deposit payment link and deposit amount. Instructs Lina to save the booking reference.

> **Presenter cue:** Switch to Supabase Studio and refresh the `bookings` table. Point to the live record with `BRZ-2026-00001`. **Wow moment: real data, real booking.**

---

## Beat 2 — Book an SPMU Lip Treatment (same session)

> **Presenter:** "Lina, still in the same chat, decides to book a second treatment."

**Lina types:**
```
I'd also like to book a SPMU lip treatment while I'm here
```

**Agent responds:** Calls `list_branches_for_service` → `list_artists_for_service_at_branch`. Asks Lina to confirm branch and artist (or notes she's already at JLT and asks to confirm).

**Lina types:**
```
Same branch, whatever artist is available
```

**Agent responds:** Calls `check_pre_booking_requirements` → returns `medical_screening_required`. Calls `search_availability`. Confirms the slot. Then presents all six screening questions in **one** message:

> *"Before I can confirm your SPMU Lip Treatment booking, I need to ask you six quick medical questions:*
> *1. Are you pregnant or breastfeeding?*
> *2. Are you taking any blood-thinning medication (e.g. Aspirin, Warfarin)?*
> *3. Do you have any known allergies, particularly to injectable products?*
> *4. Have you had any prior injectable procedures or facial treatments?*
> *5. Do you have any active skin infections or inflammation in the treatment area?*
> *6. Do you have an autoimmune disease or are you on immunosuppressant medication?"*

> **Presenter cue:** "All six questions in one message — no back-and-forth. The widget has cleared the time picker because we're in screening mode now."

**Lina types:**
```
No, no, no, no, no, no
```

**Agent responds:** Calls `submit_screening` with all six answers as `false`. On success, immediately calls `create_booking`. Returns `BRZ-2026-00002`. Surfaces deposit payment link.

> **Presenter cue:** Refresh Supabase `bookings` — two rows now. Point to `BRZ-2026-00001` and `BRZ-2026-00002`. **Wow moment: two bookings, one session, different service tiers, screening enforced automatically.**

---

## Beat 3 — Reschedule the Gel Nail Extension

> **Presenter:** "Now Lina wants to move her gel nail appointment — and she has two booking references in the session."

**Lina types:**
```
Can I reschedule my gel nail booking? The reference is BRZ-2026-00001
```

**Agent responds:** Calls `fetch_booking` for `BRZ-2026-00001` silently. Does **not** reveal any details. Asks Lina to verify her identity.

> **Presenter cue:** "The agent already has `BRZ-2026-00002` as the last booking in focus — but Lina gave it `BRZ-2026-00001` explicitly, so it uses that. This is the disambiguation fix in action."

**Lina types:**
```
Lina Al Rashid, +971501234567
```

**Agent responds:** Name and contact match. Asks for new preferred date and time.

**Lina types:**
```
Next Sunday at 2 PM
```

**Agent responds:** Calls `search_availability` with the original service, branch, and artist. Slot is available. Presents the new slot. Asks Lina to confirm before changing.

**Lina types:**
```
Yes, please update it
```

**Agent responds:** Calls `modify_booking`. Confirms the reschedule. Shows updated date/time and tells Lina to keep her reference.

> **Presenter cue:** Refresh Supabase `bookings`. The `BRZ-2026-00001` row now shows the new slot and a `modified` status.

---

## Beat 4 — Cancel the SPMU Booking

> **Presenter:** "Lina has a change of heart about the lip treatment."

**Lina types:**
```
Actually, I want to cancel the SPMU booking — BRZ-2026-00002
```

**Agent responds:** Calls `lookup_faq` with topic `cancellation_policy`. Presents the cancellation policy (e.g. 24-hour window, deposit forfeiture). Asks Lina to explicitly confirm she still wants to cancel.

> **Presenter cue:** "The agent won't cancel on the first mention — it presents the policy and waits for explicit consent. That's the cancellation guardrail."

**Lina types:**
```
Yes, I'm sure, please cancel it
```

**Agent responds:** Calls `cancel_booking` for `BRZ-2026-00002`. Confirms cancellation. Reminds Lina that `BRZ-2026-00001` (the gel nails) remains confirmed.

> **Presenter cue:** Refresh Supabase `bookings`. `BRZ-2026-00002` is now `cancelled`. `BRZ-2026-00001` remains `modified`. **Wow moment: context memory — the agent knew which booking to cancel and which to leave alone.**

---

## Summary talking points

- New visitor → no account needed, identity collected inline
- Two different service tiers (T1 + T2) in one session — screening gate enforced automatically for T2
- Session context tracked both booking references; agent used the user-stated ref, not the "last seen" one
- Identity verification happened silently before every mutation (reschedule, cancel)
- Policy surfaced proactively before the cancel was executed
