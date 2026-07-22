import { z } from "zod";

export type DifyDatasourceType = "online_document" | "online_drive" | "website_crawl";

export interface DifyDatasourceRuntimeClientOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: typeof fetch | undefined;
  readonly maxResponseBytes?: number | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly userId?: string | undefined;
}

interface DifyDatasourceSelection {
  readonly credentialId: string;
  readonly datasource: string;
  readonly pluginId: string;
  readonly provider: string;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
  readonly userId?: string | undefined;
}

export interface DifyWebsiteCrawlInput extends DifyDatasourceSelection {
  readonly datasourceParameters: Readonly<Record<string, unknown>>;
}

export interface DifyOnlineDocumentPagesInput extends DifyDatasourceSelection {
  readonly datasourceParameters: Readonly<Record<string, unknown>>;
}

export interface DifyOnlineDocumentPageContentInput extends DifyDatasourceSelection {
  readonly page: {
    readonly pageId: string;
    readonly type: string;
    readonly workspaceId: string;
  };
}

export interface DifyOnlineDriveBrowseInput extends DifyDatasourceSelection {
  readonly bucket?: string | undefined;
  readonly maxKeys?: number | undefined;
  readonly nextPageParameters?: Readonly<Record<string, unknown>> | undefined;
  readonly prefix: string;
}

export interface DifyOnlineDriveDownloadInput extends DifyDatasourceSelection {
  readonly file: {
    readonly bucket?: string | undefined;
    readonly id: string;
  };
}

export interface DifyDatasourceCredentialValidationInput extends DifyDatasourceSelection {
  readonly datasourceType: DifyDatasourceType;
}

export interface DifyDatasourceRuntimeClient {
  browseOnlineDrive(input: DifyOnlineDriveBrowseInput): AsyncGenerator<unknown>;
  downloadOnlineDriveFile(input: DifyOnlineDriveDownloadInput): AsyncGenerator<unknown>;
  getOnlineDocumentPageContent(input: DifyOnlineDocumentPageContentInput): AsyncGenerator<unknown>;
  getOnlineDocumentPages(input: DifyOnlineDocumentPagesInput): AsyncGenerator<unknown>;
  getWebsiteCrawl(input: DifyWebsiteCrawlInput): AsyncGenerator<unknown>;
  validateCredentials(input: DifyDatasourceCredentialValidationInput): Promise<boolean>;
}

export type DifyDatasourceRuntimeErrorCode =
  | "dify_datasource_runtime_aborted"
  | "dify_datasource_runtime_input"
  | "dify_datasource_runtime_invocation_failed"
  | "dify_datasource_runtime_request_failed"
  | "dify_datasource_runtime_response_invalid"
  | "dify_datasource_runtime_response_too_large"
  | "dify_datasource_runtime_timeout";

export class DifyDatasourceRuntimeError extends Error {
  readonly code: DifyDatasourceRuntimeErrorCode;
  readonly retryable: boolean;
  readonly status?: number | undefined;

  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
      readonly code: DifyDatasourceRuntimeErrorCode;
      readonly retryable?: boolean | undefined;
      readonly status?: number | undefined;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DifyDatasourceRuntimeError";
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

const CredentialValidationSchema = z.object({ result: z.boolean() }).strict();

export function createDifyDatasourceRuntimeClient(
  options: DifyDatasourceRuntimeClientOptions,
): DifyDatasourceRuntimeClient {
  const baseUrl = options.baseUrl.trim().replace(/\/+$/u, "");
  const apiKey = options.apiKey.trim();
  const fetchImpl = options.fetch ?? fetch;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const userId = options.userId?.trim() || "knowledge-fs";

  if (!baseUrl || !/^https?:\/\//u.test(baseUrl)) {
    throw inputError("Dify datasource runtime baseUrl must be an absolute HTTP(S) URL");
  }
  if (!apiKey) {
    throw inputError("Dify datasource runtime apiKey is required");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw inputError("Dify datasource runtime maxResponseBytes must be a positive integer");
  }
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > MAX_REQUEST_TIMEOUT_MS
  ) {
    throw inputError("Dify datasource runtime requestTimeoutMs is outside the supported range");
  }
  requiredIdentifier(userId, "userId", 512);

  const commonPayload = (
    input: DifyDatasourceSelection,
    datasourceType: DifyDatasourceType,
    operation: string,
  ): Record<string, unknown> => ({
    credential_id: requiredIdentifier(input.credentialId, "credentialId", 512),
    datasource: requiredIdentifier(input.datasource, "datasource", 256),
    datasource_type: datasourceType,
    operation,
    provider: canonicalProvider(input.pluginId, input.provider),
    tenant_id: requiredIdentifier(input.tenantId, "tenantId", 512),
    user_id: requiredIdentifier(input.userId?.trim() || userId, "userId", 512),
  });

  const invoke = (
    input: DifyDatasourceSelection,
    payload: Readonly<Record<string, unknown>>,
  ): AsyncGenerator<unknown> => {
    const deadline = createDeadline(input.signal, requestTimeoutMs);
    return (async function* () {
      try {
        const response = await request(
          fetchImpl,
          `${baseUrl}/inner/api/invoke/datasource`,
          apiKey,
          payload,
          deadline.signal,
        );
        for await (const rawEnvelope of readLengthPrefixedFrames(response, maxResponseBytes)) {
          const envelope = EnvelopeSchema.safeParse(rawEnvelope);
          if (!envelope.success) throw responseInvalid(envelope.error);
          yield unwrapEnvelope(envelope.data);
        }
      } finally {
        deadline.cleanup();
      }
    })();
  };

  return {
    browseOnlineDrive(input) {
      const maxKeys = input.maxKeys ?? 20;
      if (!Number.isSafeInteger(maxKeys) || maxKeys < 1 || maxKeys > 1_000) {
        throw inputError("Dify datasource runtime maxKeys must be between 1 and 1000");
      }
      return invoke(input, {
        ...commonPayload(input, "online_drive", "online_drive_browse_files"),
        request: {
          ...(input.bucket === undefined ? {} : { bucket: input.bucket }),
          max_keys: maxKeys,
          ...(input.nextPageParameters === undefined
            ? {}
            : { next_page_parameters: { ...input.nextPageParameters } }),
          prefix: input.prefix,
        },
      });
    },

    downloadOnlineDriveFile(input) {
      return invoke(input, {
        ...commonPayload(input, "online_drive", "online_drive_download_file"),
        request: {
          bucket: input.file.bucket ?? "",
          id: requiredIdentifier(input.file.id, "file.id", 4096),
        },
      });
    },

    getOnlineDocumentPageContent(input) {
      return invoke(input, {
        ...commonPayload(input, "online_document", "get_online_document_page_content"),
        page: {
          page_id: requiredIdentifier(input.page.pageId, "page.pageId", 4096),
          type: requiredIdentifier(input.page.type, "page.type", 256),
          workspace_id: requiredIdentifier(input.page.workspaceId, "page.workspaceId", 4096),
        },
      });
    },

    getOnlineDocumentPages(input) {
      return invoke(input, {
        ...commonPayload(input, "online_document", "get_online_document_pages"),
        datasource_parameters: { ...input.datasourceParameters },
      });
    },

    getWebsiteCrawl(input) {
      return invoke(input, {
        ...commonPayload(input, "website_crawl", "get_website_crawl"),
        datasource_parameters: { ...input.datasourceParameters },
      });
    },

    async validateCredentials(input) {
      let valid: boolean | undefined;
      for await (const value of invoke(input, {
        ...commonPayload(input, input.datasourceType, "validate_credentials"),
      })) {
        const parsed = CredentialValidationSchema.safeParse(value);
        if (!parsed.success) throw responseInvalid(parsed.error);
        valid = parsed.data.result;
      }
      if (valid === undefined) throw responseInvalid();
      return valid;
    },
  };
}

function canonicalProvider(pluginId: string, provider: string): string {
  const normalizedPluginId = requiredIdentifier(pluginId, "pluginId", 512);
  const normalizedProvider = requiredIdentifier(provider, "provider", 256);
  if (!/^[a-z0-9_-]+\/[a-z0-9_-]+$/u.test(normalizedPluginId)) {
    throw inputError("Dify datasource runtime pluginId must use organization/plugin format");
  }
  if (!/^[a-z0-9_-]+$/u.test(normalizedProvider)) {
    throw inputError("Dify datasource runtime provider must be a provider slug");
  }
  return `${normalizedPluginId}/${normalizedProvider}`;
}

function requiredIdentifier(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw inputError(`Dify datasource runtime ${name} is invalid`);
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
        accept: "text/event-stream",
        "content-type": "application/json",
        "x-inner-api-key": apiKey,
      },
      method: "POST",
      signal,
    });
  } catch (cause) {
    if (signal.aborted) throw deadlineError(signal.reason);
    throw new DifyDatasourceRuntimeError("Dify datasource runtime request failed", {
      cause,
      code: "dify_datasource_runtime_request_failed",
      retryable: true,
    });
  }
  if (!response.ok) {
    throw new DifyDatasourceRuntimeError("Dify datasource runtime request failed", {
      code: "dify_datasource_runtime_request_failed",
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
      status: response.status,
    });
  }
  return response;
}

async function* readLengthPrefixedFrames(
  response: Response,
  maxBytes: number,
): AsyncGenerator<unknown> {
  if (!response.body) throw responseInvalid();
  const reader = response.body.getReader();
  let pending = new Uint8Array(0);
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
      if (frameBytes > maxBytes) throw responseTooLarge();
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

  if (pending.byteLength !== 0) throw responseInvalid();
}

function concatBytes(
  chunks: readonly Uint8Array<ArrayBufferLike>[],
  total: number,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function unwrapEnvelope(envelope: z.infer<typeof EnvelopeSchema>): unknown {
  if (envelope.error || envelope.data === undefined || envelope.data === null) {
    throw new DifyDatasourceRuntimeError("Dify datasource runtime invocation failed", {
      code: "dify_datasource_runtime_invocation_failed",
    });
  }
  return envelope.data;
}

function createDeadline(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): { readonly cleanup: () => void; readonly signal: AbortSignal } {
  if (externalSignal?.aborted) {
    throw new DifyDatasourceRuntimeError("Dify datasource runtime request was aborted", {
      code: "dify_datasource_runtime_aborted",
    });
  }
  const controller = new AbortController();
  const timeoutReason = Symbol("dify-datasource-runtime-timeout");
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

function deadlineError(reason: unknown): DifyDatasourceRuntimeError {
  return typeof reason === "symbol"
    ? new DifyDatasourceRuntimeError("Dify datasource runtime request timed out", {
        code: "dify_datasource_runtime_timeout",
        retryable: true,
      })
    : new DifyDatasourceRuntimeError("Dify datasource runtime request was aborted", {
        code: "dify_datasource_runtime_aborted",
      });
}

function inputError(message: string): DifyDatasourceRuntimeError {
  return new DifyDatasourceRuntimeError(message, { code: "dify_datasource_runtime_input" });
}

function responseInvalid(cause?: unknown): DifyDatasourceRuntimeError {
  return new DifyDatasourceRuntimeError("Dify datasource runtime returned an invalid response", {
    cause,
    code: "dify_datasource_runtime_response_invalid",
  });
}

function responseTooLarge(): DifyDatasourceRuntimeError {
  return new DifyDatasourceRuntimeError(
    "Dify datasource runtime response exceeded the configured limit",
    { code: "dify_datasource_runtime_response_too_large" },
  );
}
