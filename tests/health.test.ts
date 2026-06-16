import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvCache } from '../src/lib/env';

describe('getHealthStatus', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('reports ollama provider and reachability', async () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_API_URL = 'http://127.0.0.1:11434';
    process.env.OLLAMA_MODEL = 'qwen2.5:7b';
    process.env.OLLAMA_EMBEDDING_MODEL = 'nomic-embed-text';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })),
    );

    const { getHealthStatus } = await import('../src/lib/healthCheck');
    const health = await getHealthStatus();

    expect(health.status).toBe('ok');
    expect(health.llm).toEqual({
      provider: 'ollama',
      model: 'qwen2.5:7b',
      enabled: true,
    });
    expect(health.ollama?.reachable).toBe(true);
    expect(health.embeddings).toEqual({
      provider: 'ollama',
      model: 'nomic-embed-text',
    });
  });

  it('returns degraded when ollama is unreachable', async () => {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.OLLAMA_API_URL = 'http://127.0.0.1:11434';
    process.env.OLLAMA_MODEL = 'qwen2.5:7b';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );

    const { getHealthStatus } = await import('../src/lib/healthCheck');
    const health = await getHealthStatus();

    expect(health.status).toBe('degraded');
    expect(health.ollama?.reachable).toBe(false);
  });

  it('reports deepseek provider when configured', async () => {
    process.env.LLM_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    process.env.DEEPSEEK_MODEL = 'deepseek-v4-pro';

    const { getHealthStatus } = await import('../src/lib/healthCheck');
    const health = await getHealthStatus();

    expect(health.status).toBe('ok');
    expect(health.llm).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      enabled: true,
    });
    expect(health.ollama).toBeUndefined();
    expect(health.embeddings).toEqual({
      provider: 'ollama',
      model: 'nomic-embed-text',
    });
  });
});
