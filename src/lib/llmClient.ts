import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { getActiveModel, getEnv, isLlmEnabled } from './env';

export { isLlmEnabled as isAgentLlmEnabled };

export function createAgentLlm(): BaseChatModel {
  const env = getEnv();

  if (!isLlmEnabled()) {
    throw new Error(
      `LLM is not configured for provider "${env.LLM_PROVIDER}". Check environment variables.`,
    );
  }

  const temperature = env.AGENT_TEMPERATURE;
  const maxTokens = env.AGENT_MAX_TOKENS;

  switch (env.LLM_PROVIDER) {
    case 'ollama':
      return new ChatOpenAI({
        model: env.OLLAMA_MODEL,
        apiKey: env.OLLAMA_API_KEY ?? 'ollama',
        temperature,
        maxTokens,
        configuration: {
          baseURL: `${env.OLLAMA_API_URL.replace(/\/$/, '')}/v1`,
        },
      });

    case 'openai': {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
      }
      return new ChatOpenAI({
        model: env.OPENAI_MODEL,
        apiKey,
        temperature,
        maxTokens,
      });
    }

    case 'anthropic': {
      const apiKey = env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic',
        );
      }
      return new ChatAnthropic({
        model: env.ANTHROPIC_MODEL,
        apiKey,
        temperature,
        maxTokens,
      });
    }

    case 'openrouter': {
      const apiKey = env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error(
          'OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter',
        );
      }
      return new ChatOpenAI({
        model: getActiveModel(),
        apiKey,
        temperature,
        maxTokens,
        configuration: {
          baseURL: env.OPENROUTER_BASE_URL,
          defaultHeaders: {
            'HTTP-Referer': 'https://browz-concierge-ai.up.railway.app',
            'X-Title': 'Browz Concierge AI Agent',
          },
        },
      });
    }

    case 'deepseek': {
      const apiKey = env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        throw new Error(
          'DEEPSEEK_API_KEY is required when LLM_PROVIDER=deepseek',
        );
      }
      return new ChatOpenAI({
        model: env.DEEPSEEK_MODEL,
        apiKey,
        temperature,
        maxTokens,
        configuration: {
          baseURL: env.DEEPSEEK_BASE_URL,
        },
      });
    }

    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${env.LLM_PROVIDER}`);
  }
}
