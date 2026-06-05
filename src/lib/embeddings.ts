import { getEnv } from './env';

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

async function generateOpenAiEmbedding(
  input: string,
  apiKey: string,
  baseUrl?: string,
): Promise<number[] | null> {
  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/v1/embeddings`
    : 'https://api.openai.com/v1/embeddings';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('generateOpenAiEmbedding failed', response.status, body);
      return null;
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };

    return payload.data?.[0]?.embedding ?? null;
  } catch (error) {
    console.error('generateOpenAiEmbedding failed', error);
    return null;
  }
}

async function generateOllamaEmbedding(input: string): Promise<number[] | null> {
  const env = getEnv();
  const url = `${env.OLLAMA_API_URL.replace(/\/$/, '')}/api/embeddings`;

  try {
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
      const body = await response.text();
      console.error('generateOllamaEmbedding failed', response.status, body);
      return null;
    }

    const payload = (await response.json()) as { embedding?: number[] };
    return payload.embedding ?? null;
  } catch (error) {
    console.error('generateOllamaEmbedding failed', error);
    return null;
  }
}

export async function generateQueryEmbedding(input: string): Promise<number[] | null> {
  const env = getEnv();
  const openAiKey = env.OPENAI_API_KEY;
  const openRouterKey = env.OPENROUTER_API_KEY;

  if (openAiKey) {
    return generateOpenAiEmbedding(input, openAiKey);
  }

  if (openRouterKey) {
    return generateOpenAiEmbedding(input, openRouterKey, env.OPENROUTER_BASE_URL);
  }

  if (env.LLM_PROVIDER === 'ollama' || env.OLLAMA_API_URL) {
    return generateOllamaEmbedding(input);
  }

  return null;
}
