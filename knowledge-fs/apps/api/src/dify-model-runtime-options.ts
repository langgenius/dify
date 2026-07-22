import {
  type DifyModelRuntimeClient,
  createDifyModelRuntimeClient,
} from "@knowledge/dify-model-runtime-client";

export interface DifyModelRuntimeClientEnv {
  readonly DIFY_INNER_API_KEY?: string | undefined;
  readonly DIFY_INNER_API_URL?: string | undefined;
  readonly DIFY_MODEL_RUNTIME_MAX_RESPONSE_BYTES?: string | undefined;
  readonly DIFY_MODEL_RUNTIME_REQUEST_TIMEOUT_MS?: string | undefined;
}

const DEFAULT_DIFY_INNER_API_URL = "http://localhost:5001";
const DEFAULT_DIFY_INNER_API_KEY = "QaHbTe77CtuXmsfyhR7+vRjI/+XbV1AaFy691iy+kGDv2Jvy0/eAh8Y1";

/** Builds the model client that calls Dify, where ModelManager owns credential resolution. */
export function createApiDifyModelRuntimeClient(
  env: DifyModelRuntimeClientEnv,
): DifyModelRuntimeClient {
  const maxResponseBytes = optionalPositiveInteger(
    env.DIFY_MODEL_RUNTIME_MAX_RESPONSE_BYTES,
    "DIFY_MODEL_RUNTIME_MAX_RESPONSE_BYTES",
  );
  const requestTimeoutMs = optionalPositiveInteger(
    env.DIFY_MODEL_RUNTIME_REQUEST_TIMEOUT_MS,
    "DIFY_MODEL_RUNTIME_REQUEST_TIMEOUT_MS",
  );

  return createDifyModelRuntimeClient({
    apiKey: difyModelRuntimeTrimmed(env.DIFY_INNER_API_KEY) ?? DEFAULT_DIFY_INNER_API_KEY,
    baseUrl: difyModelRuntimeTrimmed(env.DIFY_INNER_API_URL) ?? DEFAULT_DIFY_INNER_API_URL,
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  });
}

export interface DifyLlmCompletionInput {
  readonly client: DifyModelRuntimeClient;
  readonly maxOutputTokens?: number | undefined;
  readonly model: string;
  readonly pluginId: string;
  readonly promptMessages: readonly unknown[];
  readonly provider: string;
  readonly signal?: AbortSignal | undefined;
  readonly temperature?: number | undefined;
  readonly tenantId: string;
}

export interface DifyLlmCompletionResult {
  readonly finishReason?: string | undefined;
  readonly model?: string | undefined;
  readonly text: string;
}

/** Aggregates Dify's ModelInstance LLM stream for multimodal adapters. */
export async function difyLlmCompletion(
  input: DifyLlmCompletionInput,
): Promise<DifyLlmCompletionResult> {
  let text = "";
  let finishReason: string | undefined;
  let model: string | undefined;

  for await (const chunk of input.client.invokeLlm({
    completionParams: {
      ...(input.maxOutputTokens === undefined ? {} : { max_tokens: input.maxOutputTokens }),
      ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
    },
    model: input.model,
    pluginId: input.pluginId,
    promptMessages: input.promptMessages,
    provider: input.provider,
    tenantId: input.tenantId,
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
    if (!delta || typeof delta !== "object") {
      continue;
    }
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

  return {
    text,
    ...(finishReason ? { finishReason } : {}),
    ...(model ? { model } : {}),
  };
}

export function difyModelRuntimeRequired(
  value: string | undefined,
  name: string,
  capability: string,
): string {
  const text = difyModelRuntimeTrimmed(value);
  if (!text) {
    throw new Error(`${name} is required for ${capability} when using the Dify model runtime`);
  }
  return text;
}

export function difyModelRuntimeTrimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function optionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  const raw = difyModelRuntimeTrimmed(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
