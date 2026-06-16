import { getActiveModel, getEnv, isLlmEnabled } from './env';

export type HealthStatus = {
  status: 'ok' | 'degraded';
  llm: {
    provider: string;
    model: string;
    enabled: boolean;
  };
  ollama?: {
    reachable: boolean;
    url: string;
    model: string;
    error?: string;
  };
  embeddings: {
    provider: 'openai' | 'openrouter' | 'deepseek' | 'ollama' | 'none';
    model: string | null;
  };
};

function getConfiguredChatModel(): string {
  const env = getEnv();
  switch (env.LLM_PROVIDER) {
    case 'ollama':
      return env.OLLAMA_MODEL;
    case 'openai':
      return env.OPENAI_MODEL;
    case 'anthropic':
      return env.ANTHROPIC_MODEL;
    case 'openrouter':
      return getActiveModel();
    case 'deepseek':
      return env.DEEPSEEK_MODEL;
    default:
      return 'unknown';
  }
}

function getEmbeddingProvider(): HealthStatus['embeddings'] {
  const env = getEnv();

  if (env.EMBEDDING_PROVIDER !== 'auto') {
    switch (env.EMBEDDING_PROVIDER) {
      case 'openai':
        return { provider: 'openai', model: 'text-embedding-3-small' };
      case 'openrouter':
        return { provider: 'openrouter', model: 'text-embedding-3-small' };
      case 'deepseek':
        return { provider: 'deepseek', model: env.DEEPSEEK_EMBEDDING_MODEL };
      case 'ollama':
        return { provider: 'ollama', model: env.OLLAMA_EMBEDDING_MODEL };
    }
  }

  if (env.OPENAI_API_KEY) {
    return { provider: 'openai', model: 'text-embedding-3-small' };
  }
  if (env.OPENROUTER_API_KEY) {
    return { provider: 'openrouter', model: 'text-embedding-3-small' };
  }
  if (env.LLM_PROVIDER === 'ollama' || env.OLLAMA_API_URL) {
    return { provider: 'ollama', model: env.OLLAMA_EMBEDDING_MODEL };
  }
  return { provider: 'none', model: null };
}

async function checkOllamaReachability(): Promise<HealthStatus['ollama']> {
  const env = getEnv();
  const url = env.OLLAMA_API_URL.replace(/\/$/, '');

  try {
    const response = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return {
        reachable: false,
        url,
        model: env.OLLAMA_MODEL,
        error: `HTTP ${response.status}`,
      };
    }

    return {
      reachable: true,
      url,
      model: env.OLLAMA_MODEL,
    };
  } catch (error) {
    return {
      reachable: false,
      url,
      model: env.OLLAMA_MODEL,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const env = getEnv();
  const llmEnabled = isLlmEnabled();
  const ollama =
    env.LLM_PROVIDER === 'ollama' ? await checkOllamaReachability() : undefined;

  const degraded =
    !llmEnabled || (env.LLM_PROVIDER === 'ollama' && ollama && !ollama.reachable);

  return {
    status: degraded ? 'degraded' : 'ok',
    llm: {
      provider: env.LLM_PROVIDER,
      model: getConfiguredChatModel(),
      enabled: llmEnabled,
    },
    ...(ollama ? { ollama } : {}),
    embeddings: getEmbeddingProvider(),
  };
}
