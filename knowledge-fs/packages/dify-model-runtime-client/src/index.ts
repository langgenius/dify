import { z } from "zod";

export type DifyModelRuntimeModelType = "llm" | "rerank" | "text-embedding";
export type DifyEmbeddingInputType = "document" | "query";

export interface DifyModelRuntimeClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: typeof fetch | undefined;
  readonly maxResponseBytes?: number | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly userId?: string | undefined;
}

interface DifyModelSelection {
  readonly model: string;
  readonly pluginId: string;
  readonly provider: string;
}

interface DifyModelRequestContext extends DifyModelSelection {
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
}

export interface DifyTextEmbeddingInput extends DifyModelRequestContext {
  readonly inputType: DifyEmbeddingInputType;
  readonly texts: readonly string[];
}

export interface DifyMultimodalEmbeddingDocument {
  readonly content: string;
  readonly content_type: string;
  readonly file_id?: string | undefined;
}

export interface DifyMultimodalEmbeddingInput extends DifyModelRequestContext {
  readonly documents: readonly DifyMultimodalEmbeddingDocument[];
  readonly inputType: DifyEmbeddingInputType;
}

export interface DifyRerankInput extends DifyModelRequestContext {
  readonly docs: readonly string[];
  readonly query: string;
  readonly scoreThreshold?: number | undefined;
  readonly topN?: number | undefined;
}

export interface DifyLlmInput extends DifyModelRequestContext {
  readonly completionParams?: Readonly<Record<string, unknown>> | undefined;
  readonly promptMessages: readonly unknown[];
  readonly stop?: readonly string[] | undefined;
  readonly tools?: readonly unknown[] | undefined;
}

export interface DifyModelCatalogItem {
  readonly capabilities: Readonly<Record<string, unknown>>;
  readonly model: string;
  readonly model_type: DifyModelRuntimeModelType;
  readonly plugin_id: string;
  readonly plugin_unique_identifier: string;
  readonly provider: string;
}

export interface DifyListModelsInput {
  readonly limit: number;
  readonly model?: string | undefined;
  readonly modelType: DifyModelRuntimeModelType;
  readonly offset?: number | undefined;
  readonly pluginId?: string | undefined;
  readonly provider?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
}

export interface DifyListModelsResult {
  readonly items: readonly DifyModelCatalogItem[];
  readonly nextOffset?: number | undefined;
}

export interface DifyModelRuntimeClient {
  invokeLlm(input: DifyLlmInput): AsyncGenerator<unknown>;
  invokeMultimodalEmbedding(input: DifyMultimodalEmbeddingInput): Promise<unknown>;
  invokeRerank(input: DifyRerankInput): Promise<unknown>;
  invokeTextEmbedding(input: DifyTextEmbeddingInput): Promise<unknown>;
  listModels(input: DifyListModelsInput): Promise<DifyListModelsResult>;
}

export type DifyModelRuntimeErrorCode =
  | "dify_model_runtime_aborted"
  | "dify_model_runtime_input"
  | "dify_model_runtime_invocation_failed"
  | "dify_model_runtime_request_failed"
  | "dify_model_runtime_response_invalid"
  | "dify_model_runtime_response_too_large"
  | "dify_model_runtime_timeout";

export class DifyModelRuntimeError extends Error {
  readonly code: DifyModelRuntimeErrorCode;
  readonly retryable: boolean;
  readonly status?: number | undefined;

  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
      readonly code: DifyModelRuntimeErrorCode;
      readonly retryable?: boolean | undefined;
      readonly status?: number | undefined;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DifyModelRuntimeError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MAX_REQUEST_TIMEOUT_MS = 10 * 60_000;
const FRAME_MAGIC = 0x0f;
const FRAME_MIN_HEADER_LENGTH = 0x0a;

const EnvelopeSchema = z.object({
  data: z.unknown().nullable().optional(),
  error: z.string().optional().default(""),
});

const ModelCatalogItemSchema = z
  .object({
    capabilities: z.record(z.unknown()),
    model: z.string().min(1).max(256),
    model_type: z.enum(["llm", "rerank", "text-embedding"]),
    plugin_id: z.string().min(1).max(256),
    plugin_unique_identifier: z.string().min(1).max(1024),
    provider: z.string().min(1).max(256),
  })
  .strict();

const ModelCatalogPageSchema = z
  .object({
    items: z.array(ModelCatalogItemSchema).max(100),
    next_offset: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();

export function createDifyModelRuntimeClient(
  options: DifyModelRuntimeClientOptions,
): DifyModelRuntimeClient {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/u, "");
  const apiKey = options.apiKey.trim();
  const fetchImpl = options.fetch ?? fetch;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const userId = options.userId?.trim() || "knowledge-fs";

  if (!baseUrl || !/^https?:\/\//u.test(baseUrl)) {
    throw inputError("Dify model runtime baseUrl must be an absolute HTTP(S) URL");
  }
  if (!apiKey) {
    throw inputError("Dify model runtime apiKey is required");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw inputError("Dify model runtime maxResponseBytes must be a positive integer");
  }
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw inputError("Dify model runtime requestTimeoutMs is outside the supported range");
  }
  requiredIdentifier(userId, "userId", 512);

  const commonPayload = (input: DifyModelRequestContext): Record<string, unknown> => ({
    model: requiredIdentifier(input.model, "model", 256),
    provider: canonicalProvider(input.pluginId, input.provider),
    tenant_id: requiredIdentifier(input.tenantId, "tenantId", 512),
    user_id: userId,
  });

  const postUnary = async (
    path: string,
    payload: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const deadline = createDeadline(signal, requestTimeoutMs);
    try {
      const response = await request(
        fetchImpl,
        `${baseUrl}${path}`,
        apiKey,
        payload,
        deadline.signal,
      );
      const envelope = EnvelopeSchema.safeParse(await readBoundedJson(response, maxResponseBytes));
      if (!envelope.success) {
        throw responseInvalid(envelope.error);
      }
      return unwrapEnvelope(envelope.data);
    } finally {
      deadline.cleanup();
    }
  };

  return {
    async *invokeLlm(input) {
      const deadline = createDeadline(input.signal, requestTimeoutMs);
      try {
        const response = await request(
          fetchImpl,
          `${baseUrl}/inner/api/invoke/llm`,
          apiKey,
          {
            ...commonPayload(input),
            completion_params: { ...(input.completionParams ?? {}) },
            mode: "chat",
            model_type: "llm",
            prompt_messages: [...input.promptMessages],
            stop: [...(input.stop ?? [])],
            stream: true,
            tools: [...(input.tools ?? [])],
          },
          deadline.signal,
        );
        for await (const rawEnvelope of readLengthPrefixedFrames(response, maxResponseBytes)) {
          const envelope = EnvelopeSchema.safeParse(rawEnvelope);
          if (!envelope.success) {
            throw responseInvalid(envelope.error);
          }
          yield unwrapEnvelope(envelope.data);
        }
      } finally {
        deadline.cleanup();
      }
    },

    invokeMultimodalEmbedding(input) {
      if (input.documents.length === 0) {
        throw inputError("Dify multimodal embedding requires at least one document");
      }
      return postUnary(
        "/inner/api/invoke/multimodal-embedding",
        {
          ...commonPayload(input),
          documents: input.documents.map((document) => ({ ...document })),
          input_type: input.inputType,
          model_type: "text-embedding",
        },
        input.signal,
      );
    },

    invokeRerank(input) {
      if (input.docs.length === 0) {
        throw inputError("Dify rerank requires at least one document");
      }
      return postUnary(
        "/inner/api/invoke/rerank",
        {
          ...commonPayload(input),
          docs: [...input.docs],
          model_type: "rerank",
          query: input.query,
          ...(input.scoreThreshold === undefined ? {} : { score_threshold: input.scoreThreshold }),
          ...(input.topN === undefined ? {} : { top_n: input.topN }),
        },
        input.signal,
      );
    },

    invokeTextEmbedding(input) {
      if (input.texts.length === 0) {
        throw inputError("Dify text embedding requires at least one text");
      }
      return postUnary(
        "/inner/api/invoke/text-embedding",
        {
          ...commonPayload(input),
          input_type: input.inputType,
          model_type: "text-embedding",
          texts: [...input.texts],
        },
        input.signal,
      );
    },

    async listModels(input) {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw inputError("Dify model catalog limit must be between 1 and 100");
      }
      const offset = input.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0) {
        throw inputError("Dify model catalog offset must be a non-negative integer");
      }
      if (Boolean(input.pluginId) !== Boolean(input.provider)) {
        throw inputError(
          "Dify model catalog pluginId and provider filters must be supplied together",
        );
      }
      const data = await postUnary(
        "/inner/api/invoke/model-catalog",
        {
          limit: input.limit,
          model_type: input.modelType,
          offset,
          tenant_id: requiredIdentifier(input.tenantId, "tenantId", 512),
          user_id: userId,
          ...(input.model ? { model: requiredIdentifier(input.model, "model", 256) } : {}),
          ...(input.pluginId && input.provider
            ? { provider: canonicalProvider(input.pluginId, input.provider) }
            : {}),
        },
        input.signal,
      );
      const page = ModelCatalogPageSchema.safeParse(data);
      if (!page.success) {
        throw responseInvalid(page.error);
      }
      return {
        items: page.data.items,
        ...(page.data.next_offset === undefined || page.data.next_offset === null
          ? {}
          : { nextOffset: page.data.next_offset }),
      };
    },
  };
}

function canonicalProvider(pluginId: string, provider: string): string {
  const normalizedPluginId = requiredIdentifier(pluginId, "pluginId", 256);
  const normalizedProvider = requiredIdentifier(provider, "provider", 256);
  if (!/^[a-z0-9_-]+\/[a-z0-9_-]+$/u.test(normalizedPluginId)) {
    throw inputError("Dify model runtime pluginId must use organization/plugin format");
  }
  if (!/^[a-z0-9_-]+$/u.test(normalizedProvider)) {
    throw inputError("Dify model runtime provider must be a provider slug");
  }
  return `${normalizedPluginId}/${normalizedProvider}`;
}

function requiredIdentifier(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw inputError(`Dify model runtime ${name} is invalid`);
  }
  return normalized;
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
  payload: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      body: JSON.stringify(payload),
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "x-inner-api-key": apiKey,
      },
      method: "POST",
      signal,
    });
  } catch (cause) {
    if (signal.aborted) {
      throw deadlineError(signal.reason);
    }
    throw new DifyModelRuntimeError("Dify model runtime request failed", {
      cause,
      code: "dify_model_runtime_request_failed",
      retryable: true,
    });
  }
  if (!response.ok) {
    throw new DifyModelRuntimeError("Dify model runtime request failed", {
      code: "dify_model_runtime_request_failed",
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      status: response.status,
    });
  }
  return response;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw responseTooLarge();
  }
  if (!response.body) {
    throw responseInvalid();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw responseTooLarge();
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(new TextDecoder().decode(concatBytes(chunks, total)));
  } catch (cause) {
    throw responseInvalid(cause);
  }
}

async function* readLengthPrefixedFrames(
  response: Response,
  maxBytes: number,
): AsyncGenerator<unknown> {
  if (!response.body) {
    throw responseInvalid();
  }
  const reader = response.body.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw responseTooLarge();
    }
    pending = concatBytes([pending, value], pending.byteLength + value.byteLength);
    while (pending.byteLength >= 8) {
      const view = new DataView(pending.buffer, pending.byteOffset, pending.byteLength);
      const magic = view.getUint8(0);
      const headerLength = view.getUint16(2, true);
      const dataLength = view.getUint32(4, true);
      if (magic !== FRAME_MAGIC || headerLength < FRAME_MIN_HEADER_LENGTH) {
        throw responseInvalid();
      }
      const frameHeaderBytes = 4 + headerLength;
      const frameBytes = frameHeaderBytes + dataLength;
      if (frameBytes > maxBytes) {
        throw responseTooLarge();
      }
      if (pending.byteLength < frameBytes) break;
      const payload = pending.slice(frameHeaderBytes, frameBytes);
      pending = pending.slice(frameBytes);
      try {
        yield JSON.parse(new TextDecoder().decode(payload));
      } catch (cause) {
        throw responseInvalid(cause);
      }
    }
  }
  if (pending.byteLength !== 0) {
    throw responseInvalid();
  }
}

function concatBytes(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function unwrapEnvelope(envelope: z.infer<typeof EnvelopeSchema>): unknown {
  if (envelope.error || envelope.data === undefined || envelope.data === null) {
    throw new DifyModelRuntimeError("Dify model runtime invocation failed", {
      code: "dify_model_runtime_invocation_failed",
    });
  }
  return envelope.data;
}

function createDeadline(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): { readonly cleanup: () => void; readonly signal: AbortSignal } {
  if (externalSignal?.aborted) {
    throw new DifyModelRuntimeError("Dify model runtime request was aborted", {
      code: "dify_model_runtime_aborted",
    });
  }
  const controller = new AbortController();
  const timeoutReason = Symbol("dify-model-runtime-timeout");
  const timeout = setTimeout(() => controller.abort(timeoutReason), timeoutMs);
  const onAbort = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  return {
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onAbort);
    },
    signal: controller.signal,
  };
}

function deadlineError(reason: unknown): DifyModelRuntimeError {
  return typeof reason === "symbol"
    ? new DifyModelRuntimeError("Dify model runtime request timed out", {
        code: "dify_model_runtime_timeout",
        retryable: true,
      })
    : new DifyModelRuntimeError("Dify model runtime request was aborted", {
        code: "dify_model_runtime_aborted",
      });
}

function inputError(message: string): DifyModelRuntimeError {
  return new DifyModelRuntimeError(message, { code: "dify_model_runtime_input" });
}

function responseInvalid(cause?: unknown): DifyModelRuntimeError {
  return new DifyModelRuntimeError("Dify model runtime returned an invalid response", {
    cause,
    code: "dify_model_runtime_response_invalid",
  });
}

function responseTooLarge(): DifyModelRuntimeError {
  return new DifyModelRuntimeError("Dify model runtime response exceeded the configured limit", {
    code: "dify_model_runtime_response_too_large",
  });
}
