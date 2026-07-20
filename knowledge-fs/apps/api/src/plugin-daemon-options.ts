import {
  type PluginDaemonClient,
  type PluginDaemonClientWithManagement,
  createPluginDaemonClient,
} from "@knowledge/plugin-daemon-client";

export interface PluginDaemonClientEnv {
  readonly PLUGIN_DAEMON_KEY?: string | undefined;
  readonly PLUGIN_DAEMON_MAX_RESPONSE_BYTES?: string | undefined;
  readonly PLUGIN_DAEMON_MAX_RETRIES?: string | undefined;
  readonly PLUGIN_DAEMON_RETRY_DELAY_MS?: string | undefined;
  readonly PLUGIN_DAEMON_URL?: string | undefined;
}

const DEFAULT_PLUGIN_DAEMON_URL = "http://localhost:5002";
const DEFAULT_PLUGIN_DAEMON_KEY = "plugin-api-key";

/** Builds the shared plugin-daemon transport client from environment configuration. */
export function createApiPluginDaemonClient(
  env: PluginDaemonClientEnv,
): PluginDaemonClientWithManagement {
  const maxResponseBytes = optionalNonNegativeInt(
    env.PLUGIN_DAEMON_MAX_RESPONSE_BYTES,
    "PLUGIN_DAEMON_MAX_RESPONSE_BYTES",
    1,
  );
  const maxRetries = optionalNonNegativeInt(
    env.PLUGIN_DAEMON_MAX_RETRIES,
    "PLUGIN_DAEMON_MAX_RETRIES",
  );
  const retryDelayMs = optionalNonNegativeInt(
    env.PLUGIN_DAEMON_RETRY_DELAY_MS,
    "PLUGIN_DAEMON_RETRY_DELAY_MS",
  );

  return createPluginDaemonClient({
    apiKey: pluginDaemonTrimmed(env.PLUGIN_DAEMON_KEY) ?? DEFAULT_PLUGIN_DAEMON_KEY,
    baseUrl: pluginDaemonTrimmed(env.PLUGIN_DAEMON_URL) ?? DEFAULT_PLUGIN_DAEMON_URL,
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    ...(maxRetries === undefined ? {} : { maxRetries }),
    ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
  });
}

export interface PluginDaemonLlmCompletionInput {
  readonly client: PluginDaemonClient;
  readonly credentials?: Record<string, unknown> | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly model: string;
  readonly pluginId: string;
  /** Already mapped to the plugin-daemon `prompt_messages` wire shape. */
  readonly promptMessages: readonly unknown[];
  readonly provider: string;
  readonly signal?: AbortSignal | undefined;
  readonly temperature?: number | undefined;
  readonly tenantId: string;
  readonly userId?: string | undefined;
}

export interface PluginDaemonLlmCompletionResult {
  readonly finishReason?: string | undefined;
  readonly model?: string | undefined;
  readonly text: string;
}

/**
 * Aggregates the plugin-daemon `llm` SSE stream into a single completion. Shared by the multimodal
 * answer and enrichment adapters, which build their own (vision) `prompt_messages`.
 */
export async function pluginDaemonLlmCompletion(
  input: PluginDaemonLlmCompletionInput,
): Promise<PluginDaemonLlmCompletionResult> {
  let text = "";
  let finishReason: string | undefined;
  let model: string | undefined;

  for await (const chunk of input.client.dispatchStream({
    data: {
      credentials: input.credentials ?? {},
      model: input.model,
      model_parameters: {
        ...(input.maxOutputTokens === undefined ? {} : { max_tokens: input.maxOutputTokens }),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
      },
      model_type: "llm",
      prompt_messages: input.promptMessages,
      provider: input.provider,
      stream: true,
    },
    op: "llm",
    pluginId: input.pluginId,
    tenantId: input.tenantId,
    ...(input.userId ? { userId: input.userId } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  })) {
    if (!chunk || typeof chunk !== "object") {
      continue;
    }

    const record = chunk as Record<string, unknown>;

    if (typeof record.model === "string") {
      model = record.model;
    }

    const delta = record.delta;

    if (delta && typeof delta === "object") {
      const deltaRecord = delta as Record<string, unknown>;
      const message = deltaRecord.message;

      if (message && typeof message === "object") {
        const content = (message as Record<string, unknown>).content;

        if (typeof content === "string") {
          text += content;
        }
      }

      if (typeof deltaRecord.finish_reason === "string" && deltaRecord.finish_reason) {
        finishReason = deltaRecord.finish_reason;
      }
    }
  }

  return {
    text,
    ...(finishReason ? { finishReason } : {}),
    ...(model ? { model } : {}),
  };
}

export function pluginDaemonRequired(
  value: string | undefined,
  name: string,
  capability: string,
): string {
  const text = pluginDaemonTrimmed(value);

  if (!text) {
    throw new Error(`${name} is required for ${capability} when using the plugin-daemon provider`);
  }

  return text;
}

/** Parses an optional `*_PLUGIN_CREDENTIALS_JSON` value (defaults to daemon-resolved credentials). */
export function parsePluginDaemonCredentials(
  value: string | undefined,
  name: string,
): Record<string, unknown> | undefined {
  const raw = pluginDaemonTrimmed(value);

  if (!raw) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${name} must be a JSON object`, { cause });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object`);
  }

  return parsed as Record<string, unknown>;
}

export function pluginDaemonTrimmed(value: string | undefined): string | undefined {
  const text = value?.trim();

  return text ? text : undefined;
}

function optionalNonNegativeInt(
  value: string | undefined,
  name: string,
  min = 0,
): number | undefined {
  const raw = pluginDaemonTrimmed(value);

  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }

  return parsed;
}
