import { getEnv } from './env';

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

type EmbeddingProvider = 'openai' | 'openrouter' | 'deepseek' | 'ollama';

function resolveEmbeddingProvider(): EmbeddingProvider | null {
  const env = getEnv();

  if (env.EMBEDDING_PROVIDER !== 'auto') {
    return env.EMBEDDING_PROVIDER;
  }

  if (env.OPENAI_API_KEY) {
    return 'openai';
  }

  if (env.OPENROUTER_API_KEY) {
    return 'openrouter';
  }

  if (env.LLM_PROVIDER === 'ollama' || env.OLLAMA_API_URL) {
    return 'ollama';
  }

  return null;
}

async function fetchOpenAiCompatibleEmbedding(
  input: string,
  apiKey: string,
  model: string,
  baseUrl: string,
): Promise<number[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/embeddings`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, input }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Embedding request failed with ${response.status}: ${errorBody}`,
    );
  }

  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };

  const embedding = payload.data?.[0]?.embedding;
  if (!embedding) {
    throw new Error('Embedding response did not include a vector.');
  }

  return embedding;
}

async function generateOllamaEmbedding(input: string): Promise<number[]> {
  const env = getEnv();
  const url = `${env.OLLAMA_API_URL.replace(/\/$/, '')}/api/embeddings`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.OLLAMA_API_KEY ? { Authorization: `Bearer ${env.OLLAMA_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: env.OLLAMA_EMBEDDING_MODEL,
      prompt: input,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Ollama embedding request failed with ${response.status}: ${errorBody}. ` +
        `Pull the model with: ollama pull ${env.OLLAMA_EMBEDDING_MODEL}`,
    );
  }

  const payload = (await response.json()) as { embedding?: number[] };
  if (!payload.embedding) {
    throw new Error('Ollama embedding response did not include a vector.');
  }

  return payload.embedding;
}

export async function generateEmbedding(input: string): Promise<number[]> {
  const env = getEnv();
  const provider = resolveEmbeddingProvider();

  switch (provider) {
    case 'openai':
      if (!env.OPENAI_API_KEY) {
        throw new Error('EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY.');
      }
      return fetchOpenAiCompatibleEmbedding(
        input,
        env.OPENAI_API_KEY,
        OPENAI_EMBEDDING_MODEL,
        'https://api.openai.com',
      );
    case 'openrouter':
      if (!env.OPENROUTER_API_KEY) {
        throw new Error('EMBEDDING_PROVIDER=openrouter requires OPENROUTER_API_KEY.');
      }
      return fetchOpenAiCompatibleEmbedding(
        input,
        env.OPENROUTER_API_KEY,
        OPENAI_EMBEDDING_MODEL,
        env.OPENROUTER_BASE_URL,
      );
    case 'deepseek':
      if (!env.DEEPSEEK_API_KEY) {
        throw new Error('EMBEDDING_PROVIDER=deepseek requires DEEPSEEK_API_KEY.');
      }
      return fetchOpenAiCompatibleEmbedding(
        input,
        env.DEEPSEEK_API_KEY,
        env.DEEPSEEK_EMBEDDING_MODEL,
        env.DEEPSEEK_BASE_URL,
      );
    case 'ollama':
      return generateOllamaEmbedding(input);
    default:
      throw new Error(
        'No embedding provider configured. DeepSeek chat API does not expose embeddings. ' +
          'Set OPENAI_API_KEY or OPENROUTER_API_KEY, set EMBEDDING_PROVIDER=ollama and pull ' +
          `${env.OLLAMA_EMBEDDING_MODEL}, or run Ollama locally.`,
      );
  }
}

export async function generateQueryEmbedding(input: string): Promise<number[] | null> {
  try {
    return await generateEmbedding(input);
  } catch (error) {
    console.error('generateQueryEmbedding failed', error);
    return null;
  }
}
