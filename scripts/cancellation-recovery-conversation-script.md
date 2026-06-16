# Cancellation Recovery — Conversation Test Script

Use this script in the **Browz chat UI** at `http://localhost:3000` (or via `POST /chat`).  
It is written as a play: you type the **You** lines; the agent should respond in the spirit of the **Expect** notes.

---

## Before you start

1. Backend running: `npm run dev`
2. Supabase configured in `.env` and recovery schema applied (`supabase/schema_recovery.sql`)
3. Slots seeded: `npm run seed:generate-slots`
4. Open **two browser tabs** (or use **New chat** between acts):
   - **Tab A — Sam** (waitlist client) — contact `+971501111001`
   - **Tab B — Jordan** (books then cancels) — contact `+971502222002`

Use real phone-style contacts every time you book or join the waitlist. The recovery system matches offers by contact.

**Tip:** Say **tomorrow** for dates so the agent resolves them from session context. Pick a time that exists in your seed data (e.g. **2:00 PM**).

---

## Cast

| Persona | Role | Contact |
|---------|------|---------|
| **Sam** | Joins waitlist, receives slot offer | `+971501111001` |
| **Jordan** | Books the same slot, then cancels to trigger recovery | `+971502222002` |
| **Alex** *(optional, Story C)* | Second waitlist client | `+971503333003` |

---

## Story A — Join the waitlist (SC-36, SC-37)

*Tab A · Sam · New chat*

**You:**  
I’d like Brow Lamination at Browz 1 tomorrow around 2pm.

*Expect:* Agent checks availability. If the slot is free, it may offer to book — for this story, either book Jordan first (Story B) or pick a time that is already taken so the agent offers the waitlist.

**You:**  
There’s no availability? Please add me to the waitlist.

*Expect:* Agent asks for missing details one at a time (contact, time preference, etc.).

**You:**  
My name is Sam Ahmed and my number is +971501111001.

**You:**  
Anytime after 12pm is fine.

*Expect:* Confirmation with service, branch, date, 15-minute offer rule, and a reference like `WL-2026-00089`.

**You:**  
What’s the status of my waitlist request?

*Expect:* Active entry or position context. The agent should **not** quote a queue position number.

✓ **Check:** Note the waitlist reference (`WL-…`) and the exact date/time Sam is waiting for.

---

## Story B — Book the slot (setup for recovery)

*Tab B · Jordan · New chat*

**You:**  
I want to book Brow Lamination at Browz 1 tomorrow at 2pm.

*Expect:* Agent lists branch/artist steps, checks availability, collects visitor details.

**You:**  
Dr Zack Ally is fine.

**You:**  
My name is Jordan Lee and my contact is +971502222002.

*Expect:* Agent confirms the slot and gives a booking reference `BRZ-2026-…`.

✓ **Check:** Jordan’s slot should match Sam’s waitlisted service, branch, date, and time window.

---

## Story C — Cancel and trigger recovery (SC-26, SC-30)

*Tab B · Jordan · same chat session*

**You:**  
I need to cancel my appointment.

*Expect:* Agent looks up cancellation policy and asks you to confirm.

**You:**  
Yes, I still want to cancel.

*Expect:* Agent asks for the booking reference if not already known.

**You:**  
The reference is BRZ-2026-XXXXX.

*(Replace with Jordan’s real reference from Story B.)*

*Expect:* Agent calls `fetch_booking` and asks you to verify identity — it must **not** reveal booking details yet.

**You:**  
Jordan Lee, +971502222002.

*Expect:* Cancellation confirmed. Slot freed. Recovery runs in the background (waitlist first).

✓ **Check (within ~30 seconds):**

```bash
# Slot should be hold (offer pending) or open_for_walkin if no waitlist match
curl "http://localhost:3000/data/slots?branchId=br-dxb&date=YYYY-MM-DD"

# Recovery audit trail
curl "http://localhost:3000/data/recovery-log?slotId=SLOT_UUID"
```

If Sam was on the waitlist for that slot: status should become **`hold`** while the offer is active.

---

## Story D — Accept the waitlist offer (SC-27)

*Tab A · Sam · same chat session as Story A*

**You:**  
I got a message about a slot opening up — I’d like to confirm it.

*Expect:* Agent restates slot details (service, branch, date, time), then confirms the offer.

**You:**  
Yes, please book that slot for me.

*Expect:* New booking reference, slot status **`booked`**, recovery outcome `waitlist_filled`.

✓ **Check:** In `/data/slots`, the slot shows `isRecovered: true` for recovered bookings.

---

## Story E — Decline the offer (SC-28)

*Replay Stories A + B with a different time, or reset test data.*

When Sam receives an offer (web notification is in-memory — stay in the **same server process** and use the **same contact**):

**You:**  
A slot opened up for my waitlist entry but I can’t make it.

**You:**  
No thanks, I’ll pass on this one.

*Expect:* Offer declined, slot released, next waitlist candidate offered if Alex is waiting (see Story F).

---

## Story F — Two waitlist clients (SC-28 cascade)

1. **Tab A · Sam** — join waitlist for Brow Lamination, Browz 1, tomorrow 2pm, `+971501111001`
2. **Tab C · Alex · New chat** — join waitlist for the **same** service, branch, date, and time, `+971503333003`
3. **Tab B · Jordan** — book and cancel that slot (Story B + C)

When Sam declines (Story E), Alex should receive the next offer.

**Alex · when prompted:**

**You:**  
Yes, I’ll take that slot. My name is Alex Rivera, +971503333003.

---

## Story G — No waitlist match → walk-in (SC-30, SC-33)

Skip Story A (no one on the waitlist).

1. **Jordan** books Brow Lamination tomorrow 3pm at Browz 1, then cancels (Story B + C).
2. *Expect:* Slot moves to **`open_for_walkin`** on the dayboard.

**Tab D · New visitor · New chat**

**You:**  
Do you have any walk-in slots for Brow Lamination at Browz 1 tomorrow?

*Expect:* Agent surfaces `open_for_walkin` availability.

**You:**  
I’ll take the 3pm slot. I’m Casey Wong, +971504444004.

*Expect:* Booking with `walkin_agent` source.

---

## Story H — Gate blocked on confirm (SC-35)

Use a **T2 service** that requires a patch test (e.g. a tinted brow service at Browz 1 — ask the agent which services need clearance).

1. Join waitlist for that T2 service (Sam, no clearance on file).
2. Jordan books and cancels the same slot.
3. Sam tries to confirm:

**You:**  
I want to accept the waitlist slot offer.

*Expect:* Agent explains consultation/patch test is required. **No booking** until clearance exists.

---

## Story I — Check waitlist status mid-flow (SC-37)

*Tab A · Sam*

**You:**  
Can you check my waitlist status? My number is +971501111001.

*Expect:* Status (`waiting`, `offered`, etc.) and offer details if an offer is active.

---

## Story J — Leave the waitlist

**You:**  
Please remove me from the waitlist. My reference is WL-2026-XXXXX.

*Expect:* Entry cancelled. If an offer was active, slot hold released.

---

## Staff-only beats (not chat, but part of the full spec)

These are not conversational, but you may need them to complete SC-32 or portal cancel:

**Staff walk-in (SC-32)** — after slot is `open_for_walkin`:

```bash
curl -X POST http://localhost:3000/bookings/walkin \
  -H "Content-Type: application/json" \
  -d '{
    "slotId": "SLOT_UUID",
    "visitorName": "Desk Walk-in",
    "visitorContact": "+971505555005",
    "serviceId": "s-011",
    "branchId": "br-dxb"
  }'
```

**Portal cancel (SC-38 companion)** — same effect as staff cancel with portal source:

```bash
curl -X POST http://localhost:3000/bookings/BRZ-2026-XXXXX/cancel \
  -H "Content-Type: application/json" \
  -d '{ "cancellationSource": "portal", "clientId": "CLIENT_UUID" }'
```

**Unfilled alert (SC-34)** — walk-in slot still empty ~15 minutes before start: the background job flags it `unfilled` and logs `outcome: unfilled`. Watch server logs or re-query `/data/slots`.

---

## Quick reference — what you should see

| Stage | Slot status | Who acts |
|-------|-------------|----------|
| Just cancelled | `available` → recovery starts | System |
| Waitlist offer sent | `hold` | Sam/Alex via chat |
| Offer accepted | `booked` + `isRecovered` | Sam via chat |
| Offer declined/expired | next candidate or walk-in | System |
| No waitlist | `open_for_walkin` | Walk-in client or staff |
| Unfilled before appt | `unfilled` | Staff decides |

---

## Troubleshooting

| Problem | What to try |
|---------|-------------|
| No waitlist offer after cancel | Same service, branch, date, and time window? Server running? Check `/data/recovery-log`. |
| Sam doesn’t see offer in chat | Web offers are tied to **contact** — use the same number and don’t restart the server mid-test. |
| Agent won’t cancel | Provide booking ref **and** matching name + contact for verification. |
| “Slot unavailable” on confirm | Offer may have expired (15 min). Re-run cancel to trigger a new offer. |
| LLM slow or off-topic | Set `LLM_PROVIDER` and keys in `.env`; keep messages close to the **You** lines above. |

---

## Suggested test order (30–45 min)

1. Story A → B → C → D *(happy path)*
2. Story F *(decline cascade)*
3. Story G *(walk-in)*
4. Story I + J *(status + cancel waitlist)*

Copy each **You** block into the chat as a single message unless the script shows multiple lines meant as separate turns.
