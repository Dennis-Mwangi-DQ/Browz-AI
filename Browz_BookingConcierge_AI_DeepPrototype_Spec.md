# Browz Booking Concierge AI Agent — Deep Prototype Specification
**Beauty & Wellness Booking | Visitor & Client Concierge**

| Field | Value |
|---|---|
| Document Type | Deep Prototype Specification |
| Domain | Beauty & Wellness (UAE) — Browz |
| Stage | Proof of Concept (POC) |
| Audience | Lead AI/ML Engineer + Integration Engineer |
| Version | v1.3 — June 2026 |

> **CONFIDENTIAL — FOR INTERNAL DQ USE ONLY**

---

## 1. Executive Summary

This document defines the detailed technical specifications for building a **Deep Prototype (Proof of Concept)** of the Browz Booking Concierge AI Agent — a conversational assistant that serves visitors and clients across web chat and WhatsApp.

The agent handles the end-to-end booking lifecycle for a multi-branch beauty and brow services business: availability enquiry, booking creation, modification and cancellation, payment initiation, and FAQ resolution. It operates across two user tiers — unauthenticated visitors and authenticated clients — with session-aware behaviour and a Supabase-backed booking store.

Critically, the agent enforces **service-level pre-booking rules** before any slot is offered. Browz operates three distinct service tiers — standard beauty, SPMU (semi-permanent makeup), and medical/injectable — each with different gating requirements: consultation bookings, patch tests, medical screening forms, and consent workflows. The agent must navigate these gates conversationally rather than silently blocking users. Payment rules (full upfront, 20% deposit, or package pricing) are applied at confirmation. Treatment frequency intervals are checked to prevent rebooking within clinically unsafe windows.

The booking flow itself is **guided and artist-aware**: when a user wants to book, the agent first surfaces the branches where the service is available, then presents the practitioners at the chosen branch who offer that service, confirms the selected artist's slot availability against the user's requested time, and — if unavailable — proactively suggests the next available times for that artist. This ensures every booking is tied to a specific branch and practitioner from the outset.

The deep prototype phase validates the core conversational pipeline, guided booking sequence, service gating logic, payment rule enforcement, and dual-channel (web + WhatsApp) delivery in a TypeScript-based environment.

### 1.1 Prototype Goals

| Dimension | Target |
|---|---|
| Pipeline completeness | Enquiry → booking → confirmation without manual breaks |
| Intent recognition accuracy | 70–85% on defined test scenarios |
| Visitor flow | Enquire + book without login |
| Client flow | Enquire + book + modify/cancel + pay (authenticated session) |
| Scenario coverage | 20–25 representative booking conversations (incl. gating flows) |
| Channels | Web chat widget + WhatsApp Business API (sandbox) |
| Backend | Node.js + Express.js + Supabase (availability, bookings, client profiles) |
| Environment | Local or sandboxed cloud (Railway) |
| Demo readiness | Stakeholder-demonstrable in a single live session |

---

## 2. System Overview & Agent Architecture

### 2.1 What the Agent Does

The agent orchestrates a conversational AI pipeline that performs the following in sequence:

1. Receives a message from visitor or client (web chat or WhatsApp)
2. Detects user tier (visitor = unauthenticated / client = authenticated via session token or phone number matching)
3. Classifies intent: enquiry, availability check, booking, modification, cancellation, payment, FAQ
4. Executes the appropriate workflow via tool calls against Supabase
5. Returns a structured, brand-aligned response with confirmation or follow-up prompt
6. Maintains session memory for multi-turn conversations
7. Escalates to human (receptionist) when confidence is low or request is out of scope

### 2.2 Architecture — Processing Stages

| Stage | Component | Technology |
|---|---|---|
| Channel Layer | Web chat + WhatsApp inbound/outbound | Vanilla HTML/CSS/JS widget (web) · Twilio WhatsApp sandbox |
| Intent Layer | Message classification + entity extraction | LLM (Claude Sonnet, GPT-4o, or Qwen) via LangChain tool-calling |
| Orchestration Layer | Agent controller — routes intent to workflow | LangChain (TypeScript) Agent Executor |
| Tool Layer | Booking actions — read/write against Supabase | TypeScript functions exposed as LangChain tools |
| Memory Layer | Session context (user tier, conversation state) | In-memory `Map` (cache) + Supabase session table |
| Response Layer | Branded, structured message generation | LLM with constrained output prompt |
| Escalation Layer | Handoff to human agent | Webhook to receptionist console (mock for prototype) |
| Backend | REST API | Node.js / Express.js / TypeScript |
| Database | Booking store + session logs | Supabase (PostgreSQL with `pgvector`) |
| Deployment | Prototype hosting | Railway or Local |

### 2.3 Agent Autonomy Level

| Autonomy Dimension | Prototype Setting |
|---|---|
| Intent classification | Automated |
| Availability query | Automated — reads Supabase |
| Booking creation | Automated — writes to Supabase; confirmation sent to user |
| Booking modification / cancellation | Automated for authenticated clients only |
| Payment | Initiates payment link (mock/Stripe test mode); does not execute charge autonomously |
| Notes / preferences capture | Automated — appended to booking record |
| Escalation to human | Triggered by agent when intent is unclear or out of scope |
| Human review | Not required for standard flows; mandatory for edge cases flagged by agent |

---

## 3. User Tier Specification

### 3.1 Visitor (Unauthenticated)

A visitor is any person who initiates a conversation without an active client session. Visitors may be walk-ins, prospective clients, or repeat customers who have not logged in.

| Capability | Visitor Access |
|---|---|
| Ask availability | Yes |
| Browse services / treatments | Yes |
| Ask pricing, location, hours | Yes (FAQ) |
| Create a booking | Yes — basic details collected via conversation (name, contact, service, time) |
| Modify or cancel a booking | No — must authenticate or contact reception |
| View booking history | No |
| Pay for a booking | No — payment link sent post-booking (out of prototype scope) |
| Add notes or preferences to booking | Yes — captured during booking flow |

### 3.2 Client (Authenticated)

A client is a returning user with an active Browz account. Authentication for prototype: JWT token passed in session context or WhatsApp phone number matched against client table.

| Capability | Client Access |
|---|---|
| All visitor capabilities | Yes |
| Modify an existing booking | Yes |
| Cancel a booking | Yes |
| View upcoming bookings | Yes |
| Pay for a booking | Yes — payment link generated and sent |
| Persistent preferences | Yes — pulled from client profile on session start |
| Named artist requests | Yes — matched against availability |

---

## 4. Intent Classification

### 4.1 Supported Intents — Prototype Scope

| Intent ID | Intent Name | Description | User Tier |
|---|---|---|---|
| I-01 | `check_availability` | Query available slots for a specific artist, service, branch, and date | Both |
| I-02 | `create_booking` | Confirm a booking for a chosen service, branch, artist, date, and time | Both |
| I-03 | `modify_booking` | Change date, time, service, or artist on an existing booking | Client only |
| I-04 | `cancel_booking` | Cancel an existing booking | Client only |
| I-05 | `add_notes` | Attach preferences or notes to a booking | Both |
| I-06 | `initiate_payment` | Request a payment link for a booking | Client only |
| I-07 | `faq_general` | Answer questions about services, pricing, locations, policies | Both |
| I-08 | `escalate_human` | Route to receptionist — triggered by agent or requested by user | Both |
| I-09 | `greeting_smalltalk` | Handle opening messages and small talk | Both |
| I-10 | `book_consultation` | Book a free consultation (required before SPMU or medical bookings) | Both |
| I-11 | `check_clearance_status` | Check whether a client's medical clearance or patch test is on file | Client only |
| I-12 | `check_frequency` | Check whether a service can be rebooked based on treatment interval rules | Both |
| I-13 | `list_branches` | Show which branches offer a given service | Both |
| I-14 | `list_artists` | Show practitioners at a chosen branch who offer a given service | Both |

### 4.2 Guided Booking Sequence

Every booking — regardless of service tier — follows a **mandatory guided sequence** before any slot is presented to the user. This ensures bookings are always tied to a specific branch and practitioner.

```
STEP 1 — Branch discovery
Agent calls list_branches_for_service(service)
→ Presents branches as a numbered list
→ Asks: "Which branch would you like to visit?"

STEP 2 — Artist discovery
User picks a branch.
Agent calls list_artists_for_service_at_branch(service, branch)
→ Presents practitioners with name and title
→ Asks: "Who would you like to book with?"

STEP 3 — Date & time collection
User selects a practitioner.
Agent asks: "What date and time works best for you?"

STEP 4 — Artist availability check
Agent calls search_availability(service, branch, date, artist)
→ If slot exists at requested time → proceed to gate check + booking
→ If artist is unavailable: tool returns nextAvailableTimes
  → Agent presents alternatives: "[Artist] isn't available at 2pm on Saturday —
     their next available times are 10:00 AM, 12:30 PM, and 4:00 PM. Would any of
     these work?"

STEP 5 — Pre-booking gate check (T2/T3 services only)
See Section 4A for gating rules.

STEP 6 — Booking confirmation
Agent calls create_booking(service, branch, artist, date, time)
→ Returns booking reference + payment rule
```

The agent never silently blocks — it always explains any gate or unavailability and offers a concrete path forward.

### 4.3 Pre-Booking Gate Logic

Before `create_booking` can proceed, the agent evaluates the service's **gating tier** (applied after branch and artist have been selected). This is the most critical non-obvious behaviour in the agent.

```
AGENT RULE: After artist and time are confirmed:
1. Resolve service → look up service_tier from service catalogue
2. Apply gating rules for that tier (Section 4A below)
3. Only confirm the booking if gate is cleared
4. If gate is not cleared: explain the requirement conversationally and offer the appropriate next step
```

### 4.4 Multi-Intent Handling (Prototype)

The prototype handles sequential multi-intent within a single turn only. Example: "Can you check if there's anything tomorrow at 3pm with Fatima and book it if so" — handled as `search_availability(artist=Fatima)` → (if available) gate check → `create_booking` in one chain.

Parallel multi-intent (two unrelated requests in one message) falls back to asking the user to clarify.

---

## 4A. Service Classification & Pre-Booking Rules

This section defines the three service tiers and their gating requirements. The agent must enforce these rules before offering availability or confirming any booking.

### 4A.1 Service Tier Definitions

| Tier | Label | Examples | Gate Required |
|---|---|---|---|
| **T1** | Standard Beauty | Brow threading, brow lamination, brow tint, lash tint, waxing | None — direct booking |
| **T2** | SPMU (Semi-Permanent Makeup) | Brow SPMU, Lip Blush, Eyeliner SPMU, Nano Brows | Consultation + patch test first |
| **T3** | Medical / Injectable | Anti-Wrinkle Injections, Lip Filler, Thread Lift, Laser, HydraFacial series, Chemical Peel series, Bio-Remodelling | Medical screening form + clearance by practitioner |

Service tier is stored as `service_tier: 'T1' | 'T2' | 'T3'` in the services table.

### 4A.2 Tier 1 — Standard Beauty (No Gate)

Direct booking. Agent checks availability and confirms immediately.

```
User: "Book me in for brow lamination at Dubai Mall, Saturday 2pm"
Agent: [check_availability] → if slot exists → [create_booking] → confirmation
```

### 4A.3 Tier 2 — SPMU (Consultation + Patch Test Required)

SPMU services require the client to attend a free consultation and patch test **at least 48 hours before** the main appointment. The agent checks whether this requirement is satisfied before offering a booking.

**Gate check logic (clients):**

```
check_pre_booking_requirements(client_id, service_id):
  → look up client's clearance_records (spmu_clearances table) for this service category
  → if clearance exists AND patch_test_done = true AND patch_test_cleared = true AND valid_until >= now:
      → gate cleared — proceed to availability
  → else:
      → gate not cleared — initiate consultation booking flow
```

**Gate check logic (visitors):**

Visitors have no stored record. Agent always offers consultation first.

**Agent conversation flow (gate not cleared):**

```
Agent: "Brow SPMU is a semi-permanent treatment — to make sure it's right for your skin, 
we start with a free consultation and patch test. The patch test needs to be done at least 
48 hours before your main appointment.

Would you like to book a free consultation first? It takes about 30 minutes and includes 
a patch test and design review."
```

**After consultation is booked:**

```
Agent: [create_booking for consultation, bookingType=consultation]
→ Booking ref: CON-YYYYMMDD-XXXX (no payment step — consultation is free)
→ Record consultation_booked = true in session
→ "Once your patch test is complete, message us back and we'll get you booked in for your 
   [service] — usually the earliest is 48 hours after your consultation."
```

**Patch test clearance window:** 6 months. If patch test on file is older than 6 months, gate re-triggers.

### 4A.4 Tier 3 — Medical / Injectable (Screening + Medical Clearance)

Medical services require a 6-question screening form, review by a medical practitioner, and explicit clearance before booking. The clearance window is 90 days. A digital consent form is sent 48 hours before the appointment.

**Gate check logic (clients):**

```
check_pre_booking_requirements(client_id, service_id):
  → look up client's medical_screenings for this service category
  → if screening exists AND status = 'APPROVED' AND approved_until >= today:
      → gate cleared — proceed to availability
  → else if screening exists AND status = 'PENDING':
      → inform client their screening is under review (24hr window)
  → else:
      → gate not cleared — offer to collect screening answers
```

**Gate check logic (visitors):**

Visitors must provide contact details before screening can be submitted. Agent collects name + WhatsApp number, then walks through the 6 screening questions.

**Screening questions (delivered conversationally by the agent):**

| # | Question | Flag condition |
|---|---|---|
| Q1 | Are you pregnant or breastfeeding? | Yes → flag |
| Q2 | Are you currently taking blood thinners or anticoagulants? | Yes → flag |
| Q3 | Do you have any known allergies to anaesthetics, lidocaine, or hyaluronic acid? | Yes → flag |
| Q4 | Have you had any facial surgery or aesthetic procedures in the last 6 months? | Yes → capture detail |
| Q5 | Do you have any active skin infections, cold sores, or open wounds on the treatment area? | Yes → flag |
| Q6 | Do you have any autoimmune conditions or are you on immunosuppressant medication? | Yes → flag |

**Agent conversation flow (screening):**

```
Agent: "Anti-Wrinkle Injections are a medical treatment performed by our qualified practitioners. 
Before I can book you in, we need to complete a short health screening — just 6 quick questions. 
Our medical team reviews your answers and usually responds within 24 hours.

Ready to start? I'll ask one at a time."

[Agent walks through Q1–Q6 conversationally, collects answers]
[Agent submits screening to Supabase]
[Agent sends confirmation]

"Your screening has been submitted. Our team will review it and message you 
on WhatsApp within 24 hours. Reference: SCR-2026-XXXX."
```

**After clearance is approved:**

The medical team approves via the practitioner console. Client gets a WhatsApp message: "You're cleared for [service]. Your clearance is valid for 90 days — book any time."

**Consent form:** Once the appointment is booked, a digital consent form is automatically sent via WhatsApp 48 hours before the appointment. The agent informs the client of this at confirmation.

**Clearance re-trigger conditions:**
- Clearance older than 90 days → full re-screen
- Service category changes (clearance for Lip Filler does not cover Thread Lift)
- Practitioner flags screening as requiring in-person consultation first

### 4A.5 Treatment Frequency Rules

Certain treatments have minimum intervals before they can be rebooked. The agent checks this when a client requests a repeat booking.

| Treatment Category | Minimum Interval | Agent Behaviour if Too Soon |
|---|---|---|
| Brow Lamination | 6–8 weeks | Warn; offer earliest eligible date |
| Chemical Peel | 4 weeks | Warn; offer earliest eligible date |
| Anti-Wrinkle Injections | 12 weeks | Hard block until interval passed; explain medically |
| Lip Filler | 12 weeks | Hard block until interval passed; explain medically |
| Bio-Remodelling | 4 weeks (between sessions) | Warn; offer next session date |
| Laser treatments | 4–6 weeks (per treatment plan) | Warn; offer next session date |
| SPMU (touch-up) | 6–8 weeks after initial | Inform; book as touch-up not full session |

**Soft warn:** Agent informs the client but allows them to proceed (e.g. lamination — the interval is a recommendation, not medically enforced).

**Hard block:** Agent cannot proceed with the booking. It explains why and offers the earliest eligible date (e.g. injectables — re-booking within 12 weeks carries clinical risk).

```
Agent (hard block example):
"Your last Anti-Wrinkle Injection appointment was on 14 April 2026. For safety, 
we recommend waiting at least 12 weeks between treatments — the earliest we'd 
recommend booking is 14 July 2026.

Would you like me to check availability from mid-July?"
```

---

## 4B. Payment Rules

The agent enforces payment rules at booking confirmation. The rule is applied based on service price and booking type.

### 4B.1 Payment Rule Matrix

| Booking Type | Price Range | Payment Required at Booking | Balance |
|---|---|---|---|
| Single service | ≤ AED 1,000 | 100% upfront | None |
| Single service | > AED 1,000 | 20% deposit | Balance due at branch |
| Package (any) | Any | 100% upfront | None |
| Consultation | Free | No payment | N/A |

**Deposit calculation:**
```
Single service ≤ AED 1,000: depositAmount = service.priceAed (full upfront)
Single service > AED 1,000: depositAmount = Math.ceil(service.priceAed × 0.20)
Package: depositAmount = package.total_price (full upfront)
```

### 4B.2 Agent Conversation at Payment Step

**Full upfront (≤ AED 1,000):**
```
"Here's your booking summary:

Service: Brow Lamination
Branch: Dubai Mall · Saturday, 5 July · 2:00 PM
Total: AED 180

Payment is required to confirm your booking. I'll send you a secure payment link now.
💳 Pay: [link] · Valid for 24 hours."
```

**Deposit (> AED 1,000):**
```
"Here's your booking summary:

Service: Nanoblading Full Session — AED 1,450
Branch: JBR · Thursday, 10 July · 11:00 AM

A 20% deposit of AED 290 is required to secure your booking. 
The remaining AED 1,160 is payable at the branch on the day.
💳 Pay deposit: [link] · Valid for 24 hours."
```

**Package:**
```
"Packages are paid in full at the time of booking.

Package: Brow Glow Package — 3 sessions · AED 450
First session: Saturday, 5 July · 10:00 AM at Dubai Mall

💳 Pay AED 450: [link] · Valid for 24 hours.
Your remaining 2 sessions can be booked any time from your account."
```

### 4B.3 Payment Tool

At prototype stage: Stripe test mode payment link API. No real charge. Agent generates the link and sends it in the confirmation message. Payment status is updated in Supabase on webhook receipt.

---

## 5. Input Specification

### 5.1 Supported Input Types

| Input Type | Web Chat | WhatsApp | Notes |
|---|---|---|---|
| Free text message | Yes | Yes | Primary input |
| Structured quick-reply buttons | Yes | Yes (WhatsApp list messages) | Agent may generate options as part of flow |
| Date / time picker | No | No | Captured via conversational text only |

### 5.2 Entity Extraction

The LLM extracts the following entities from user messages:

| Entity | Examples | Extraction Method |
|---|---|---|
| Service / treatment | "eyebrow threading", "brow lamination", "tinting" | LLM NER + service catalogue lookup |
| Branch / location | "Dubai Mall", "JBR", "nearest one" | LLM NER + branch table lookup |
| Date | "tomorrow", "Friday", "3rd July" | LLM → parsed to ISO date |
| Time | "3pm", "after 5", "morning" | LLM → parsed to time slot |
| Artist name | "Fatima", "the one I had last time" | LLM NER + client history (clients only) |
| Duration | Inferred from service type | Service catalogue |
| Notes / preferences | "I have sensitive skin", "prefer female artist" | LLM extraction → appended to booking |

### 5.3 Test Scenarios

Prepare the following representative conversations before prototype development begins. Scenarios are grouped by flow type.

**Group A — Standard Booking (T1 services, guided flow)**

| Scenario ID | Description | User Tier | Intents Covered |
|---|---|---|---|
| SC-01 | "I'd like to book brow lamination" → agent shows branches → user picks Dubai Mall → agent shows artists → user picks Fatima → agent checks Fatima's Saturday 2pm availability → books | Visitor | I-13, I-14, I-01, I-02 |
| SC-02 | User requests an artist who has no slots on requested date → agent presents Fatima's next 3 available times | Visitor | I-13, I-14, I-01 |
| SC-03 | Client rebooks usual service — jumps straight to artist selection at saved branch | Client | I-14, I-01, I-02 |
| SC-04 | Client modifies booking — changes time | Client | I-03 |
| SC-05 | Client cancels a booking | Client | I-04 |
| SC-06 | Client books, adds skin sensitivity note during booking flow | Client | I-02, I-05 |

**Group B — Payment Rules**

| Scenario ID | Description | User Tier | Intents Covered |
|---|---|---|---|
| SC-07 | Book T1 service ≤ AED 1,000 — full upfront payment link sent | Client | I-02, I-06 |
| SC-08 | Book T3 service > AED 1,000 — 20% deposit link sent, balance explained | Client | I-02, I-06 |
| SC-09 | Book a package — 100% upfront payment, session balance explained | Client | I-02, I-06 |
| SC-10 | Client requests payment link for existing unpaid booking | Client | I-06 |

**Group C — SPMU Gating (T2 services)**

| Scenario ID | Description | User Tier | Intents Covered |
|---|---|---|---|
| SC-11 | Visitor asks to book Brow SPMU — agent explains consultation + patch test requirement, offers to book consultation | Visitor | I-01, I-10 |
| SC-12 | Client asks to book Lip Blush — no clearance on file — agent books consultation | Client | I-10 |
| SC-13 | Client has valid patch test clearance on file — agent proceeds directly to booking | Client | I-01, I-02 |
| SC-14 | Client clearance is expired (>6 months) — agent flags expiry, offers new consultation | Client | I-11, I-10 |

**Group D — Medical Gating (T3 services)**

| Scenario ID | Description | User Tier | Intents Covered |
|---|---|---|---|
| SC-15 | Visitor asks to book Anti-Wrinkle Injections — agent explains medical screening requirement, collects Q1–Q6 conversationally | Visitor | I-01, I-10 |
| SC-16 | Client has valid medical clearance on file (within 90 days) — agent confirms and proceeds to availability | Client | I-11, I-01, I-02 |
| SC-17 | Client has pending screening (submitted, not yet reviewed) — agent informs them of 24hr review window | Client | I-11 |
| SC-18 | Screening flags a contraindication (e.g. blood thinners) — agent informs client that team will be in touch, cannot book | Both | I-10, I-08 |
| SC-19 | Client books medical service and agent confirms consent form will be sent 48hrs before | Client | I-02 |

**Group E — Frequency & Edge Cases**

| Scenario ID | Description | User Tier | Intents Covered |
|---|---|---|---|
| SC-20 | Client tries to rebook Brow Lamination after 3 weeks — agent soft-warns, offers to proceed or see earliest recommended date | Client | I-12, I-01 |
| SC-21 | Client tries to rebook Anti-Wrinkle Injections after 6 weeks — agent hard-blocks, explains medical reason, offers earliest eligible date | Client | I-12 |
| SC-22 | No availability for requested slot — agent offers alternatives (dates, artists, branch) | Both | I-01 |
| SC-23 | Visitor asks ambiguous "beauty treatment" — agent asks to clarify service type before checking gate | Visitor | I-09, I-01 |
| SC-24 | Out-of-scope request — escalates to human | Both | I-08 |
| SC-25 | Multi-intent: "check if there's a Saturday slot for lamination and book it if there is" | Visitor | I-01, I-02 |

---

## 6. Output Specification

### 6.1 Response Format

All agent responses must meet the following format constraints:

| Dimension | Constraint |
|---|---|
| Tone | Warm, professional, concise — consistent with Browz brand |
| Length | 1–4 sentences per turn; no long paragraphs |
| Structure | Plain text for WhatsApp; plain text + optional quick-reply buttons for web |
| Confirmation messages | Always include: service, branch, date, time, and booking reference |
| Error messages | Clear, non-technical, with a suggested next step |
| Escalation handoff | Explicit message: "Let me connect you with our team" |

### 6.2 Booking Confirmation Output

```
✅ Booking confirmed!

Service: Brow Lamination
Branch: Dubai Mall
Date: Saturday, 5 July 2026
Time: 2:00 PM
Artist: Any available
Reference: BRZ-2026-00412

We've sent a confirmation to your WhatsApp. See you soon!
```

### 6.3 Availability Response Output

```
We have the following slots available for Brow Lamination at Dubai Mall on Saturday:

• 10:00 AM
• 12:30 PM
• 3:00 PM
• 5:30 PM

Which time works for you?
```

### 6.4 Payment Link Output (Clients Only)

```
Here's your payment link for booking BRZ-2026-00412:

💳 Pay now: [link]

Total: AED 180 · Valid for 24 hours.
```

---

## 7. Deep Prototype Tech Stack

| Layer | Technology | Purpose | Notes |
|---|---|---|---|
| Web Chat UI | HTML, CSS, JavaScript | Embedded chat UI on Browz web app | Served from `public/` directory |
| WhatsApp Channel | Twilio WhatsApp Sandbox | Inbound/outbound WhatsApp messaging | Free sandbox — no production approval needed |
| LLM / Agent Brain | Claude Sonnet / GPT-4o / Ollama | Intent classification, entity extraction, response generation | Swappable model providers |
| Agent Orchestration | LangChain (TypeScript) | Connects intent → tool → response steps | Structured tool calling |
| Tool Layer | TypeScript functions | Booking CRUD, availability query, FAQ lookup | Invoked by LangChain executor |
| Backend API | Express.js + TypeScript | REST endpoints for chat widget and Twilio webhook | Runs on port 3001 |
| Database | Supabase (PostgreSQL) | Bookings, client profiles, services, branches, session logs | Single source of truth |
| Memory | Supabase `sessions` table + in-memory Map | Stores conversation state per session ID | Re-loaded on each turn |
| Payment | Stripe test mode (payment link API) | Generate mock payment links | Stripe Node SDK integration |
| Authentication | Client identification via JWT subject / WhatsApp number | Resolve clients table row | Visitor = no client_id; Client = associated client |
| Deployment | Railway | Host Express backend + static web widget | Configured via env variables |
| Logging | Console output + Supabase `sessions` table | Records active chats and messages | Essential for tracking state |
| Testing | Vitest | Validate tools, dates, session, and agent logic | Command: `npm test` |

### 7.1 Installation

```bash
# Clone and install NPM packages
npm install
```

---

## 8. Agent Processing Pipeline — Step by Step

### Step 1 — Message Intake

- Receive message from web chat (POST `/chat`) or WhatsApp webhook (POST `/whatsapp`)
- Extract: message text, channel, session ID (web) or WhatsApp phone number
- Resolve user tier: check session token (web) or phone number against Supabase `clients` table
- Load session context from memory store (conversation history, user tier, last intent)
- Log: message received, channel, session ID, user tier, timestamp

### Step 2 — Intent Classification & Guided Booking Sequence

Pass message + session context to LLM with structured tool-calling. The agent follows a fixed sequence for any booking intent:

**2a — Branch discovery**
```typescript
const branches = await listBranchesForService({ service: 'Brow Lamination' });
// → [{ id, name, city, address }, ...]
// Agent presents list, asks user to pick
```

**2b — Artist discovery**
```typescript
const artists = await listArtistsForServiceAtBranch({ service: 'Brow Lamination', branch: 'Dubai Mall' });
// → [{ id, name, role, title }, ...]
// Agent presents list, asks user to select
```

**2c — Date/time collection**
Agent asks for preferred date and time before checking availability.

**2d — Artist-scoped availability check**
```typescript
const availability = await search_availability({ service, branch, date, artist: 'Fatima' });
// → { slots: [...], artistResolved: { id, name } }
// If artist unavailable → { error: 'artist_unavailable_at_requested_time', nextAvailableTimes: ['10:00', '14:30', '16:00'] }
```

If `nextAvailableTimes` is returned, the agent presents them:
```
"Fatima isn't available at 2pm on Saturday — her next available times are:
• 10:00 AM
• 2:30 PM
• 4:00 PM
Would any of these work for you?"
```

If `escalate_human` → skip to Step 6.

### Step 2.5 — Pre-Booking Gate Check (for `create_booking`)

Before executing availability or booking tools, the agent runs a gate check:

```typescript
export async function checkPreBookingRequirements(serviceId: string, clientId: string | null): Promise<GateCheckResult> {
  const service = await getServiceById(serviceId);
  if (!service) {
    return { gateCleared: false, reason: 'consultation_and_patch_test_required' };
  }

  if (service.serviceTier === 'T1') {
    return { gateCleared: true };
  }

  if (service.serviceTier === 'T2') {
    if (!clientId || !supabase) {
      return { gateCleared: false, reason: 'consultation_and_patch_test_required' };
    }

    const { data } = await supabase
      .from('spmu_clearances')
      .select('*')
      .eq('client_id', clientId)
      .eq('service_category', service.gateCategory)
      .gte('valid_until', new Date().toISOString())
      .order('valid_until', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.patch_test_done && data?.patch_test_cleared) {
      return { gateCleared: true };
    }

    return { gateCleared: false, reason: 'consultation_and_patch_test_required' };
  }

  if (!clientId || !supabase) {
    return { gateCleared: false, reason: 'medical_screening_required' };
  }

  const { data } = await supabase
    .from('medical_screenings')
    .select('*')
    .eq('client_id', clientId)
    .eq('service_category', service.gateCategory)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return { gateCleared: false, reason: 'medical_screening_required' };
  }

  if (data.status === 'PENDING') {
    return { gateCleared: false, reason: 'screening_under_review' };
  }

  if (data.status === 'APPROVED' && data.approved_until && new Date(data.approved_until) >= startOfTodayUtc()) {
    return { gateCleared: true };
  }

  return { gateCleared: false, reason: 'medical_screening_required' };
}
```

**Frequency check (for rebooking clients):**

```typescript
export async function checkTreatmentFrequency(clientId: string, serviceId: string): Promise<FrequencyCheckResult> {
  const service = await getServiceById(serviceId);
  if (!service || service.minFrequencyWeeks == null || !supabase) {
    return { tooSoon: false };
  }

  const { data } = await supabase
    .from('bookings')
    .select('created_at, service_id')
    .eq('client_id', clientId)
    .in('status', ['completed', 'confirmed'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (!data || data.length === 0) {
    return { tooSoon: false };
  }

  const candidateDates = await Promise.all(
    data.map(async (booking) => {
      const bookedService = await getServiceById(String(booking.service_id));
      if (!bookedService || bookedService.gateCategory !== service.gateCategory) {
        return null;
      }
      return booking.created_at ? new Date(String(booking.created_at)) : null;
    }),
  );

  const lastAppointment = candidateDates.find(Boolean);
  if (!lastAppointment) {
    return { tooSoon: false };
  }

  const weeksSince = (Date.now() - lastAppointment.getTime()) / (1000 * 60 * 60 * 24 * 7);
  if (weeksSince >= service.minFrequencyWeeks) {
    return { tooSoon: false };
  }

  const earliestDate = addWeeks(lastAppointment, service.minFrequencyWeeks);
  return {
    tooSoon: true,
    hardBlock: service.frequencyHardBlock,
    earliestDate: toIsoDate(earliestDate),
    weeksRemaining: Number((service.minFrequencyWeeks - weeksSince).toFixed(1)),
  };
}
```

### Step 3 — Tool Execution

Route to the appropriate tool based on classified intent (after gate check is passed):

| Intent | Tool Called | Supabase Operation |
|---|---|---|
| `list_branches` | `list_branches_for_service(service)` | SELECT `branches` via `time_slots` + `artists.service_ids` |
| `list_artists` | `list_artists_for_service_at_branch(service, branch)` | SELECT `artists` filtered by `branch_id` + `service_ids` |
| `check_availability` | `search_availability(service, branch, date, artist?)` | SELECT from `time_slots` filtered by `artist_id` if provided |
| `create_booking` | `create_booking(service, branch, artist, date, time, ...)` | INSERT into `bookings` with resolved `artist_id` + `slot_id` |
| `modify_booking` | `modify_booking(bookingReference, new_slot_id)` | UPDATE `bookings` |
| `cancel_booking` | `cancel_booking(bookingReference)` | UPDATE `bookings` status = cancelled |
| `add_notes` | `add_notes(bookingReference, notes)` | UPDATE `bookings` notes field |
| `initiate_payment` | `generate_payment_link(bookingReference, amountAed, paymentType)` | Stripe SDK → store link in `bookings` |
| `lookup_faq` | `lookup_faq(query)` | SELECT/RPC match from `faqs` table (with text fallback) |
| `book_consultation` | `book_consultation(service, branch, date)` | INSERT into `consultation_requests` |
| `submit_screening` | `submit_screening(service, answers)` | INSERT into `medical_screenings` |
| `check_clearance_status` | `check_clearance_status(service)` | SELECT from `medical_screenings` / `spmu_clearances` |
| `check_frequency` | `check_frequency(service)` | SELECT from `bookings` |

### Step 4 — Response Generation

Pass tool result + session context to LLM for response generation:
- LLM returns final response text
- For web: client displays CSS-formatted bubbles.
- For WhatsApp: Twilio channel sends plain text response.

### Step 5 — Session Update & Logging

- Append turn (user message + agent response) to session context
- Update Supabase `sessions` table with latest conversation logs and history.

### Step 6 — Escalation (If Triggered)

- Triggered when: confidence < 0.60 after clarification, intent = `escalate_human`, tool fails twice, or user explicitly requests human
- Send handoff message to user: "Let me connect you with our team — they'll be with you shortly."

---

## 9. Key Data Models

### 9.1 Service Record (Supabase mapping)

```json
{
  "id": "svc-brow-spmu",
  "title": "Brow SPMU",
  "cat": "spmu",
  "service_tier": "T2",
  "duration_min": 120,
  "price_aed": 1200,
  "requires_consultation": true,
  "requires_patch_test": true,
  "requires_screening": false,
  "is_medical_gated": false,
  "min_frequency_weeks": 42,
  "frequency_hard_block": false,
  "description": "..."
}
```

### 9.2 Booking Record (Supabase)

```json
{
  "id": "BRZ-2026-00412",
  "client_id": "uuid-xxxx | null (visitor)",
  "visitor_name": "Sarah Al Mansoori",
  "visitor_contact": "+971501234567",
  "service_id": "svc-brow-lamination",
  "branch_id": "branch-dubai-mall",
  "slot_id": "slot-2026-07-05-1400",
  "artist_id": "artist-fatima | null",
  "status": "confirmed | modified | cancelled | pending_payment",
  "notes": "Sensitive skin",
  "booking_type": "single | consultation | package_first_session",
  "payment_type": "full_upfront | deposit | package | free",
  "deposit_amount_aed": 0,
  "balance_due_aed": 0,
  "payment_status": "unpaid | link_sent | deposit_paid | paid",
  "payment_link": "https://pay.stripe.com/...",
  "screening_ref": "SCR-2026-0047 | null",
  "clearance_ref": "CLR-2026-0023 | null",
  "consent_status": "not_required | pending | signed",
  "created_at": "2026-07-03T10:14:00Z",
  "updated_at": "2026-07-03T10:14:00Z",
  "channel": "web | whatsapp",
  "booking_source": "ai_concierge"
}
```

### 9.2A Consultation Request Record (Supabase)

```json
{
  "id": "CON-20260705-0031",
  "client_id": "uuid-xxxx | null",
  "visitor_name": "Sarah Al Mansoori",
  "visitor_contact": "+971501234567",
  "service_id": "svc-brow-spmu",
  "service_category": "spmu",
  "branch_id": "branch-dubai-mall",
  "slot_id": "slot-2026-07-05-1000",
  "status": "booked | completed | no_show",
  "patch_test_done": false,
  "patch_test_cleared": false,
  "clearance_valid_until": null,
  "created_at": "2026-07-03T10:14:00Z"
}
```

### 9.2B Medical Screening Record (Supabase)

```json
{
  "id": "SCR-2026-0047",
  "client_id": "uuid-xxxx | null",
  "visitor_name": "Sarah Al Mansoori",
  "visitor_contact": "+971501234567",
  "service_category": "injectable",
  "answers": {
    "q1_pregnant": false,
    "q2_blood_thinners": false,
    "q3_allergies": false,
    "q4_prior_procedures": true,
    "q4_detail": "Botox 8 months ago",
    "q5_active_infection": false,
    "q6_autoimmune": false
  },
  "flagged_questions": [],
  "status": "PENDING | APPROVED | FLAGGED | EXPIRED",
  "reviewed_by": null,
  "reviewed_at": null,
  "approved_until": null,
  "reviewer_note": null,
  "created_at": "2026-07-03T10:14:00Z"
}
```

---

## 10. Deep Prototype Success Criteria

### 10.1 Functional Success Criteria

| Criterion | Pass Threshold | Verification Method |
|---|---|---|
| Pipeline runs end-to-end without crash | 100% of test scenarios | Execute Vitest suites |
| Intent classification accuracy | ≥75% of test turns correctly classified | Chat tests |
| Availability check returns correct results | ≥90% accuracy against Supabase test data | Simulated tool call check |
| Booking creation completes and records in Supabase | 100% of confirmed booking attempts | Database validation |
| Booking modification updates correct record | ≥90% of modify test scenarios | Slot transfer checks |
| Cancellation updates status correctly | 100% of cancel scenarios | Status field checks |
| Notes appended to booking record | 100% of note-capture scenarios | Database presence verification |
| **T1 service — direct booking offered without gate** | 100% of T1 scenarios | Verification |
| **T2 service — consultation offered when clearance absent** | 100% of T2 gate scenarios | Scenario runs |
| **T2 service — proceeds directly when clearance on file** | 100% of cleared T2 scenarios | Clearance verification |
| **T3 service — screening collected conversationally (all 6 Qs)** | ≥90% completion rate | Screening sub-flow test |
| **T3 service — pending screening correctly communicated** | 100% of pending scenarios | Chat validation |
| **Frequency: hard block enforced for medical services** | 100% — block within 12 weeks | Interval logic tests |
| **Frequency: soft warn shown for recommended-interval services** | ≥90% of frequency-check scenarios | Output warning validation |
| **Payment rule applied correctly for all booking types** | 100% — correct deposit/package price calculated | Resolve logic check |
| Payment link generated and returned to user | 100% of payment intent scenarios | Stripe link presence |

---

## 11. Repository & Folder Structure

```
browz-concierge-agent/
├── src/
│   ├── server.ts                # Express.js entry point — web + WhatsApp routes
│   ├── agent/
│   │   ├── agent.ts             # Orchestration: runAgent loop
│   │   ├── tools.ts             # Tool binding and execution router
│   │   ├── gateChecker.ts       # Service gating and frequency rules
│   │   ├── paymentRules.ts      # Deposit and payment type resolution
│   │   └── agent-session.ts     # Helpers for retrieving session-specific context
│   ├── memory/
│   │   └── sessionManager.ts    # Session context getOrCreate, update, appendTurn, and identity resolution
│   ├── tools/
│   │   ├── availability.ts      # queryAvailability tool
│   │   ├── bookings.ts          # create, modify, cancel booking tools
│   │   ├── clearances.ts        # getClearanceStatus tool
│   │   ├── consultations.ts     # createConsultation tool
│   │   ├── faq.ts               # lookupFaq tool (semantic/vector search + substring fallback)
│   │   ├── notes.ts             # addNotes tool
│   │   ├── payment.ts           # generatePaymentLink tool (Stripe test)
│   │   ├── screenings.ts        # submitScreening tool
│   │   └── services.ts          # listServices tool
│   ├── lib/
│   │   ├── catalog.ts           # Service/branch resolution and mapping
│   │   ├── dates.ts             # Date helpers and parsing
│   │   ├── embeddings.ts        # Embedding generation (OpenAI/OpenRouter/Ollama)
│   │   ├── env.ts               # Env variables schema and verification
│   │   ├── ids.ts               # Sequence and UUID generator helpers
│   │   ├── phone.ts             # Phone number normalization helper
│   │   └── result.ts            # Standard result structure
│   └── types.ts                 # Type definitions
├── public/
│   ├── index.html               # Chat widget HTML page
│   ├── styles.css               # Premium CSS styles
│   └── client.js                # Frontend client and message processing logic
├── seed/
│   ├── generateSlots.ts         # Generates mock availability slots
│   └── generateEmbeddings.ts    # Generates FAQ embeddings
├── supabase/
│   └── schema.sql               # Full Supabase schema (tables + indexes)
├── tests/
│   ├── agent-session.test.ts    # Session metadata tests
│   ├── agent.test.ts            # LangChain agent loop mocks & testing
│   ├── dates.test.ts            # Date utility tests
│   ├── embeddings.test.ts       # Embedding function tests
│   ├── health.test.ts           # Health check endpoint tests
│   └── tools.test.ts            # Tool helper tests
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env                         # API keys and DB settings
└── README.md
```

---

## 12. Supabase Schema (Core Tables)

```sql
-- Create extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Branches
CREATE TABLE branches (
  id text PRIMARY KEY,
  name text NOT NULL,
  city text NOT NULL,
  address text,
  phone text,
  hours jsonb,
  categories text[],
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

-- Artists
CREATE TABLE artists (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text,
  title text,
  branch_id text REFERENCES branches(id),
  bio text,
  specialities text[],
  qualifications text[],
  years_exp integer,
  avg_rating numeric(3,2),
  review_count integer DEFAULT 0,
  service_ids text[],
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Services
CREATE TABLE services (
  id text PRIMARY KEY,
  title text NOT NULL,
  cat text NOT NULL,
  service_tier text NOT NULL DEFAULT 'T1' CHECK (service_tier IN ('T1', 'T2', 'T3')),
  city text,
  duration_min integer,
  price_aed numeric(8,2) NOT NULL DEFAULT 0,
  currency text DEFAULT 'AED',
  is_featured boolean DEFAULT false,
  tag text,
  rating numeric(3,2),
  review_count integer DEFAULT 0,
  description text,
  sessions_info text,
  maintenance text,
  prep text,
  aftercare text,
  contraindications text[],
  trust_signals text[],
  requires_consultation boolean DEFAULT false,
  requires_patch_test boolean DEFAULT false,
  requires_screening boolean DEFAULT false,
  is_medical_gated boolean DEFAULT false,
  min_frequency_weeks integer,
  frequency_hard_block boolean DEFAULT false,
  complementary_ids text[],
  package_ids text[],
  steps jsonb,
  service_reviews jsonb,
  faq jsonb,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Packages
CREATE TABLE packages (
  id text PRIMARY KEY,
  title text NOT NULL,
  service_ids text[],
  cat text,
  tag text,
  description text,
  session_count integer,
  rebook_weeks integer,
  price_per_session numeric(8,2),
  total_price numeric(8,2),
  single_price numeric(8,2),
  savings_pct integer,
  savings_amount numeric(8,2),
  currency text DEFAULT 'AED',
  validity text,
  includes text[],
  requires_consultation boolean DEFAULT false,
  sessions jsonb,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Clients
CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE,
  phone text UNIQUE,
  tier text DEFAULT 'STANDARD',
  auth_user_id uuid UNIQUE,
  preferences text,
  skin_notes text,
  allergies text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Time slots
CREATE TABLE time_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id text REFERENCES branches(id) ON DELETE CASCADE,
  service_id text REFERENCES services(id) ON DELETE CASCADE,
  artist_id text REFERENCES artists(id),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text DEFAULT 'available' CHECK (status IN ('available', 'booked', 'blocked')),
  created_at timestamptz DEFAULT now()
);

-- Bookings
CREATE TABLE bookings (
  id text PRIMARY KEY,
  client_id uuid REFERENCES clients(id) NULL,
  visitor_name text,
  visitor_contact text,
  service_id text REFERENCES services(id),
  branch_id text REFERENCES branches(id),
  slot_id uuid REFERENCES time_slots(id),
  artist_id text REFERENCES artists(id) NULL,
  status text DEFAULT 'confirmed' CHECK (status IN ('confirmed','modified','cancelled','pending_payment','completed')),
  notes text,
  booking_type text DEFAULT 'single' CHECK (booking_type IN ('single','consultation','package_first_session')),
  payment_type text DEFAULT 'full_upfront' CHECK (payment_type IN ('full_upfront','deposit','package','free')),
  deposit_amount_aed numeric(8,2) DEFAULT 0,
  balance_due_aed numeric(8,2) DEFAULT 0,
  payment_status text DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','link_sent','deposit_paid','paid')),
  payment_link text,
  screening_ref text,
  clearance_ref text,
  consent_status text DEFAULT 'not_required' CHECK (consent_status IN ('not_required','pending','signed')),
  channel text CHECK (channel IN ('web','whatsapp')),
  booking_source text DEFAULT 'ai_concierge',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- SPMU clearances
CREATE TABLE spmu_clearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES clients(id) NULL,
  visitor_contact text,
  service_category text NOT NULL,
  consultation_booking_id text REFERENCES bookings(id) NULL,
  patch_test_done boolean DEFAULT false,
  patch_test_cleared boolean DEFAULT false,
  cleared_at timestamptz,
  valid_until timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Medical screenings
CREATE TABLE medical_screenings (
  id text PRIMARY KEY,
  client_id uuid REFERENCES clients(id) NULL,
  visitor_name text,
  visitor_contact text,
  service_category text NOT NULL,
  answers jsonb NOT NULL,
  flagged_questions text[] DEFAULT '{}',
  status text DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','FLAGGED','EXPIRED','DECLINED','NEEDS_INFO')),
  reviewed_by text,
  reviewed_at timestamptz,
  approved_until timestamptz,
  reviewer_note text,
  created_at timestamptz DEFAULT now()
);

-- Consultation Requests
CREATE TABLE consultation_requests (
  id text PRIMARY KEY,
  client_id uuid REFERENCES clients(id) NULL,
  visitor_name text,
  visitor_contact text,
  service_id text REFERENCES services(id),
  service_category text,
  branch_id text REFERENCES branches(id),
  slot_id uuid REFERENCES time_slots(id) NULL,
  status text DEFAULT 'booked' CHECK (status IN ('booked','completed','no_show','cancelled')),
  patch_test_done boolean DEFAULT false,
  patch_test_cleared boolean DEFAULT false,
  clearance_valid_until timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Sessions table
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text CHECK (channel IN ('web','whatsapp')),
  user_tier text CHECK (user_tier IN ('visitor','client')),
  client_id uuid REFERENCES clients(id) NULL,
  whatsapp_number text,
  conversation_history jsonb DEFAULT '[]',
  screening_state jsonb,
  last_intent text,
  last_booking_ref text,
  agent_context jsonb,
  status text DEFAULT 'active' CHECK (status IN ('active','escalated','closed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- FAQs table
CREATE TABLE faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  category text,
  embedding vector(1536),
  created_at timestamptz DEFAULT now()
);
```

---

## 13. Environment Variables & Credentials Required

| Variable Name | Description | Where to Get |
|---|---|---|
| `PORT` | Local dev port (default `3001`) | Set to `3001` or `3000` |
| `LLM_PROVIDER` | LLM model vendor (`ollama` \| `openai` \| `anthropic` \| `openrouter`) | Env configuration |
| `SUPABASE_URL` | Supabase project URL | Supabase dashboard |
| `SUPABASE_KEY` / `SUPABASE_PUBLISHABLE_KEY` | Supabase client/service API key | Supabase dashboard |
| `TWILIO_ACCOUNT_SID` | Twilio account identifier | twilio.com/console |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | twilio.com/console |
| `TWILIO_WHATSAPP_NUMBER` | Twilio WhatsApp sandbox number | Twilio WhatsApp sandbox |
| `STRIPE_SECRET_KEY` | Stripe test mode secret key | dashboard.stripe.com |
| `STRIPE_TEST_MODE` | Set to `true` for prototype | Hardcode `true` |
| `SESSION_SECRET` | Secret key for session security | Random token |
| `DEFAULT_BRANCH_ID` | Default branch UUID fallback | Supabase seed table |
