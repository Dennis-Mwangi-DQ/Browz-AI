import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  DATABASE_URL: z.string().optional(),
  USE_MEMORY_STORE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  CORS_ORIGIN: z.string().default('*'),
  LLM_PROVIDER: z
    .enum(['ollama', 'openai', 'anthropic', 'openrouter'])
    .default('ollama'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('qwen/qwen3.5-397b-a17b'),
  OPENROUTER_MODEL_DEV: z.string().default('minimax/minimax-m2.5'),
  /** Comma-separated OpenRouter provider slugs to skip (Novita breaks Qwen 2.5 72B). */
  OPENROUTER_PROVIDER_IGNORE: z.string().default('Novita'),
  USE_PRODUCTION_MODEL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  OPENROUTER_BASE_URL: z
    .string()
    .url()
    .default('https://openrouter.ai/api/v1'),
  OLLAMA_API_URL: z
    .string()
    .url()
    .default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().default('qwen2.5:7b'),
  OLLAMA_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),
  AGENT_MAX_TOOL_ITERATIONS: z.coerce.number().default(5),
  AGENT_MAX_TOKENS: z.coerce.number().default(2048),
  AGENT_TEMPERATURE: z.coerce.number().default(0.1),
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_KEY: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  ESCALATION_WEBHOOK_URL: z.string().optional(),
  DEFAULT_BRANCH_ID: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  STRIPE_TEST_MODE: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function resetEnvCache(): void {
  cached = null;
}

export function getEnv(): Env;
export function getEnv(name: string): string | undefined;
export function getEnv(name?: string): Env | string | undefined {
  if (name) {
    const value = process.env[name];
    return value && value.trim().length > 0 ? value.trim() : undefined;
  }

  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        `Invalid env: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
      );
    }
    cached = parsed.data;
  }
  return cached;
}

export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function isConfigured(...names: string[]): boolean {
  return names.every((name) => Boolean(getEnv(name)));
}

export function getActiveModel(): string {
  const env = getEnv();
  if (env.USE_PRODUCTION_MODEL || env.NODE_ENV === 'production') {
    return env.OPENROUTER_MODEL;
  }
  return env.OPENROUTER_MODEL_DEV;
}

export function isLlmEnabled(): boolean {
  const env = getEnv();
  switch (env.LLM_PROVIDER) {
    case 'ollama':
      return Boolean(env.OLLAMA_API_URL);
    case 'openai':
      return Boolean(env.OPENAI_API_KEY);
    case 'anthropic':
      return Boolean(env.ANTHROPIC_API_KEY);
    case 'openrouter':
      return Boolean(env.OPENROUTER_API_KEY);
    default:
      return false;
  }
}

export function usesPostgres(): boolean {
  return !getEnv().USE_MEMORY_STORE;
}
