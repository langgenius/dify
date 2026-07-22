import { type LlmProvider, createDifyModelRuntimeLlmProvider } from "@knowledge/generation";

import {
  type DifyModelRuntimeClientEnv,
  createApiDifyModelRuntimeClient,
} from "./dify-model-runtime-options";

export interface ChatProviderEnv extends DifyModelRuntimeClientEnv {}

/** Per-capability Dify model route (pluginId/provider/model differ per call site). */
export interface ChatProviderDifyModelConfig {
  readonly model: string;
  readonly pluginId: string;
  readonly provider: string;
}

export interface ResolvedChatProvider {
  readonly defaultModel: string;
  readonly provider: LlmProvider;
}

/**
 * Builds a chat provider that delegates credential-bound invocation to Dify.
 */
export function createChatProvider(
  env: ChatProviderEnv,
  route: ChatProviderDifyModelConfig,
): ResolvedChatProvider {
  return {
    defaultModel: route.model,
    provider: createDifyModelRuntimeLlmProvider({
      client: createApiDifyModelRuntimeClient(env),
      model: route.model,
      pluginId: route.pluginId,
      provider: route.provider,
    }),
  };
}

export function positiveIntegerEnv(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const raw = trimmed(value);
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

export function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}
