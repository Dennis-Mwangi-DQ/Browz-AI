# Browz Concierge Agent

TypeScript/Express backend for the Browz Booking Concierge AI Agent.

## Architecture

Production chat uses a single LangChain agent (`runAgent` in `src/agent/agent.ts`):

1. `createAgentLlm()` selects the LLM from `LLM_PROVIDER` (Ollama, OpenAI, Anthropic, or OpenRouter)
2. Tools are bound with Zod schemas (`src/agent/tools.ts`)
3. A ReAct loop invokes tools and returns `ToolMessage` results until the model produces a final answer
4. Session context (`lastService`, `lastBranch`, `lastBookingRef`) is persisted on the session

```
POST /chat  →  runAgent  →  bindTools  →  tool loop  →  JSON response
```

Swap cloud providers by changing env only — no agent code changes required.

## What is included

- Express server with `/health`, `/chat`, and `/whatsapp`
- LangChain agent with native tool calling, gate checks, and persisted session context
- Ollama-first local development with cloud provider swap via `LLM_PROVIDER`
- Ollama embeddings for FAQ vector search when no OpenAI/OpenRouter key is set
- Tool layer for availability, bookings, consultations, screenings, clearances, notes, payments, and FAQs
- Supabase schema and seed scripts
- Vitest tests for `runAgent` and tools

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Copy the environment template:

```bash
cp .env.example .env
```

3. Configure Ollama (recommended for local development):

```text
LLM_PROVIDER=ollama
OLLAMA_API_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

Pull models once:

```bash
ollama pull qwen2.5:7b
ollama pull nomic-embed-text
```

4. Build and start:

```bash
npm run build
npm run dev
```

Open `http://localhost:3000` for the local dev chat UI (`public/`). Railway runs API-only in production — the `public/` folder is removed at deploy time and not served when `NODE_ENV=production`.

## LLM provider swap

Change `LLM_PROVIDER` only — the agent loop, tools, and prompts stay the same.

| Provider | Required env |
|----------|----------------|
| Ollama (default) | `OLLAMA_API_URL`, `OLLAMA_MODEL` |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` |

## Health check

`GET /health` returns LLM configuration and Ollama reachability:

```json
{
  "status": "ok",
  "llm": { "provider": "ollama", "model": "qwen2.5:7b", "enabled": true },
  "ollama": { "reachable": true, "url": "http://127.0.0.1:11434", "model": "qwen2.5:7b" },
  "embeddings": { "provider": "ollama", "model": "nomic-embed-text" }
}
```

Returns HTTP 503 when the LLM is not configured or Ollama is unreachable.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API index (production) or dev chat UI (local) |
| `/health` | GET | Service and LLM health |
| `/chat` | POST | Web chat — `{ message, sessionId?, authToken? }` |
| `/whatsapp` | POST | Twilio webhook |

## Notes

- FAQ vector search uses Ollama embeddings locally, or OpenAI/OpenRouter embeddings when API keys are set.
- Session `agentContext` (service/branch/booking focus) persists to Supabase when configured.
- For production, run [supabase/schema.sql](supabase/schema.sql), seed data, and configure Twilio/Stripe as needed.
- Historical design notes live in [browz-agent-backend-plan.md](browz-agent-backend-plan.md); the live agent is `runAgent`, not the removed pipeline.
