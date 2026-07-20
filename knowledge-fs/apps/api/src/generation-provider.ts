import { type LlmProvider, createPluginDaemonLlmProvider } from "@knowledge/generation";

import { type PluginDaemonClientEnv, createApiPluginDaemonClient } from "./plugin-daemon-options";

export interface ChatProviderEnv extends PluginDaemonClientEnv {}

/** Per-capability plugin-daemon config (pluginId/provider/model differ per call site). */
export interface ChatProviderPluginDaemonConfig {
  readonly credentials?: Record<string, unknown> | undefined;
  readonly model: string;
  readonly pluginId: string;
  readonly provider: string;
}

export interface ResolvedChatProvider {
  readonly defaultModel: string;
  readonly provider: LlmProvider;
}

/**
 * Builds the chat LLM provider. knowledge-fs runs as a Dify subproject, so all LLM calls route
 * through the plugin-daemon; the caller supplies the per-capability `pluginDaemon` config.
 */
export function createChatProvider(
  env: ChatProviderEnv,
  pluginDaemon: ChatProviderPluginDaemonConfig,
): ResolvedChatProvider {
  return {
    defaultModel: pluginDaemon.model,
    provider: createPluginDaemonLlmProvider({
      client: createApiPluginDaemonClient(env),
      ...(pluginDaemon.credentials ? { credentials: pluginDaemon.credentials } : {}),
      model: pluginDaemon.model,
      pluginId: pluginDaemon.pluginId,
      provider: pluginDaemon.provider,
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
