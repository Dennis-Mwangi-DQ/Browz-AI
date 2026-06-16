# Browz AI Concierge — Demo Agenda

**Total runtime:** ~45 minutes  
**Audience:** Product stakeholders, potential salon partners, technical reviewers  
**Format:** Live walk-through, screen-shared from a single laptop  

---

## Setup Checklist

Complete all steps **before** the demo starts. Do not attempt these on the day with an audience.

### Environment

- [ ] `.env` has a valid `LLM_PROVIDER` + credentials (e.g. `ANTHROPIC_API_KEY`)
- [ ] `AGENT_MAX_TOOL_ITERATIONS` is set to at least `12`
- [ ] Backend is running locally on `http://localhost:3000` (or the Railway staging URL)
- [ ] `browz_dbp` Next.js frontend is running on `http://localhost:3001`
- [ ] Supabase project is connected and migrations are applied (`supabase db push`)

### Seed Data

Run each seed script once against the demo database (reset between full rehearsals):

```bash
npx ts-node seed/seed-branches.ts
npx ts-node seed/seed-services.ts
npx ts-node seed/seed-artists.ts
npx ts-node seed/seed-slots.ts
```

Confirm via Supabase Studio that:

- [ ] At least **2 branches** exist (e.g. JLT and DIFC)
- [ ] **Gel Nail Extension** (T1) service is available at both branches
- [ ] **SPMU Lip Treatment** (T2, screening required) is available at JLT
- [ ] **Lip Blush** (T2) slot is available at DIFC on Saturday 10:00 AM
- [ ] A **confirmed booking** exists for a client named Omar (for no-show scenario)
- [ ] At least two waitlist entries exist for the Lip Blush Saturday slot (Yara via web, Hessa via WhatsApp)

### Browser Tabs to Open (in order)

1. **Concierge web chat** — `http://localhost:3001` (fresh session, no auth)
2. **Supabase Studio** → `bookings` table (to show real-time confirmation)
3. **Supabase Studio** → `waitlist_entries` table (for cancellation-recovery demo)
4. **Staff portal / Postman** — ready to fire `POST /events/booking-cancelled`
5. **WhatsApp sandbox** or Twilio logs (for WhatsApp demo legs)

### Presenter Notes

- Use a **font size ≥ 18 pt** in the browser; zoom to 125%
- Keep the Supabase Studio table refreshed — use `Ctrl+R` at key moments for the live data reveal
- Speak to the **Wow moments** listed in each script; those are the demo's emotional peaks
- Keep answers concise when playing the "user" role; the agent's responses are the star

---

## Scenario Summaries

| # | Script | Personas | Runtime | Key Capability |
|---|--------|----------|---------|----------------|
| 1 | [demo-booking-modification-cancellation.md](./demo-booking-modification-cancellation.md) | Lina (web chat) | ~15 min | Multi-booking in one session, screening gate, identity verification, reschedule + cancel |
| 2 | [demo-cancellation-recovery.md](./demo-cancellation-recovery.md) | Yara + Hessa (waitlist), Staff portal | ~15 min | Real-time cancellation recovery, WhatsApp cascade, no human in the loop |
| 3 | [demo-no-show-reduction.md](./demo-no-show-reduction.md) | Omar (confirmed → no-show), Agent | ~15 min | Proactive reconfirmation, no-show recording, slot recovery, policy enforcement |

---

## Presenter Talking Points

### Opening (2 min)

> "What you're about to see isn't a prototype. Every tool call hits a real database, every booking reference is persisted, every WhatsApp message goes through Twilio. The AI concierge is a production-grade agent that enforces your salon's policies automatically — so your front desk team doesn't have to."

### Between Scenario 1 → 2

> "Lina made two bookings in one conversation and managed to reschedule and cancel the right one each time. That's context memory at work. Now let's see what happens when a confirmed booking falls away unexpectedly — and how the system recovers revenue in minutes, not hours."

### Between Scenario 2 → 3

> "A cancellation opened a slot and we filled it without a single human action. Now let's look at the other side of the no-show problem — stopping it from happening in the first place, and what the system does when it does happen anyway."

### Closing (2 min)

> "Three scenarios, three different capabilities — booking intelligence, cancellation recovery, and no-show reduction — all running on the same agent, the same database, the same event system. This is what AI-native operations looks like for a beauty salon."

---

## Timing Guide

| Segment | Duration |
|---------|----------|
| Setup verification (private) | 10 min |
| Opening remarks | 2 min |
| Scenario 1 | 15 min |
| Transition + Q&A buffer | 2 min |
| Scenario 2 | 15 min |
| Transition + Q&A buffer | 2 min |
| Scenario 3 | 15 min |
| Closing remarks | 2 min |
| **Total** | **~63 min incl. buffers** |

> Trim Q&A buffers to hit 45 minutes if the audience is time-constrained.
