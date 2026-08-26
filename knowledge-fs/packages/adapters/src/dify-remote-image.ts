export interface RemoteDocumentImageFetchInput {
  readonly maxBytes: number;
  readonly signal?: AbortSignal | undefined;
  readonly url: string;
}

export interface ResolvedRemoteDocumentImage {
  readonly body: Uint8Array;
  readonly contentType: string;
}

export interface RemoteDocumentImageFetcher {
  fetch(input: RemoteDocumentImageFetchInput): Promise<ResolvedRemoteDocumentImage | null>;
}

export interface DifyRemoteImageFetcherOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly requestTimeoutMs?: number;
}

const defaultRequestTimeoutMs = 30_000;
const terminalUnavailableStatuses = new Set([400, 403, 404, 413, 415, 422]);
const supportedContentTypes = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export class DifyRemoteImageRequestError extends Error {
  readonly code = "dify_remote_image_request_failed";
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    message: string,
    options: {
      readonly cause?: unknown;
      readonly retryable: boolean;
      readonly status?: number;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DifyRemoteImageRequestError";
    this.retryable = options.retryable;
    if (options.status !== undefined) this.status = options.status;
  }
}

export function createDifyRemoteImageFetcher({
  apiKey,
  baseUrl,
  fetch = globalThis.fetch,
  requestTimeoutMs = defaultRequestTimeoutMs,
}: DifyRemoteImageFetcherOptions): RemoteDocumentImageFetcher {
  const normalizedBaseUrl = requiredBaseUrl(baseUrl);
  const normalizedApiKey = requiredString(apiKey, "Dify inner API key");
  positiveSafeInteger(requestTimeoutMs, "requestTimeoutMs");

  return {
    async fetch({ maxBytes, signal, url }) {
      positiveSafeInteger(maxBytes, "maxBytes");
      const remoteUrl = validRemoteUrl(url);
      const timeout = AbortSignal.timeout(requestTimeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await fetch(
          new URL(
            `/inner/api/knowledge-fs/remote-image?${new URLSearchParams({ url: remoteUrl }).toString()}`,
            normalizedBaseUrl,
          ),
          {
            headers: { "X-Inner-Api-Key": normalizedApiKey },
            signal: requestSignal,
          },
        );
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw new DifyRemoteImageRequestError("Dify remote image request failed", {
          cause: error,
          retryable: true,
        });
      }

      if (terminalUnavailableStatuses.has(response.status)) {
        await response.body?.cancel();
        return null;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new DifyRemoteImageRequestError(
          `Dify remote image request failed with status ${response.status}`,
          { retryable: isRetryableStatus(response.status), status: response.status },
        );
      }

      const contentType = normalizedImageContentType(response.headers.get("content-type"));
      if (!contentType) {
        await response.body?.cancel();
        throw new DifyRemoteImageRequestError("Dify remote image content type is invalid", {
          retryable: false,
        });
      }
      const body = await readBoundedBody(response, maxBytes, signal);
      return { body, contentType };
    },
  };
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  callerSignal: AbortSignal | undefined,
): Promise<Uint8Array> {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new DifyRemoteImageRequestError(`Dify remote image exceeds maxBytes=${maxBytes}`, {
      retryable: false,
    });
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new DifyRemoteImageRequestError(`Dify remote image exceeds maxBytes=${maxBytes}`, {
          retryable: false,
        });
      }
      chunks.push(value);
    }
  } catch (error) {
    if (callerSignal?.aborted) throw callerSignal.reason;
    if (error instanceof DifyRemoteImageRequestError) throw error;
    throw new DifyRemoteImageRequestError("Dify remote image response failed", {
      cause: error,
      retryable: true,
    });
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function normalizedImageContentType(value: string | null): string | null {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return supportedContentTypes.has(normalized) ? normalized : null;
}

function validRemoteUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Remote image URL is invalid");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Remote image URL is invalid");
  }
  return url.href;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function requiredBaseUrl(value: string): string {
  const normalized = requiredString(value, "Dify inner API URL");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Dify inner API URL is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Dify inner API URL is invalid");
  }
  return parsed.href.endsWith("/") ? parsed.href : `${parsed.href}/`;
}

function requiredString(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function positiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
