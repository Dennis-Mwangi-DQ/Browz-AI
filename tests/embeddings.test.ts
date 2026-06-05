import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../src/lib/env';

describe('generateQueryEmbedding', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('uses ollama embeddings when configured without cloud keys', async () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_API_URL = 'http://127.0.0.1:11434';
    process.env.OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        expect(String(url)).toContain('/api/embeddings');
        return new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }), {
          status: 200,
        });
      }),
    );

    const { generateQueryEmbedding } = await import('../src/lib/embeddings');
    const embedding = await generateQueryEmbedding('What services do you offer?');

    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });
});
