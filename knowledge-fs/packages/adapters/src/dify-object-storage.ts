import type {
  ListObjectsResult,
  ObjectMetadata,
  ObjectStorageAdapter,
  PutObjectInput,
} from "@knowledge/core";

export interface DifyObjectStorageOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly maxObjectBytes?: number;
  readonly requestTimeoutMs?: number;
}

const defaultMaxObjectBytes = 64 * 1024 * 1024;
const defaultRequestTimeoutMs = 60_000;
const metadataHeader = "X-Knowledge-FS-Metadata";
const checksumHeader = "X-Knowledge-FS-Checksum-Sha256";
const contentTypeHeader = "X-Knowledge-FS-Content-Type";

export class DifyObjectStorageRequestError extends Error {
  readonly code = "dify_object_storage_request_failed";
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
    this.name = "DifyObjectStorageRequestError";
    this.retryable = options.retryable;
    if (options.status !== undefined) this.status = options.status;
  }
}

/**
 * Uses Dify's authenticated inner API as the only physical object-storage owner. The adapter
 * deliberately omits direct-upload capabilities because Dify's portable
 * storage contract does not expose provider-specific multipart or presign primitives.
 */
export function createDifyObjectStorageAdapter({
  apiKey,
  baseUrl,
  fetch = globalThis.fetch,
  maxObjectBytes = defaultMaxObjectBytes,
  requestTimeoutMs = defaultRequestTimeoutMs,
}: DifyObjectStorageOptions): ObjectStorageAdapter {
  const normalizedBaseUrl = requiredBaseUrl(baseUrl);
  const normalizedApiKey = requiredString(apiKey, "Dify inner API key");
  positiveSafeInteger(maxObjectBytes, "maxObjectBytes");
  positiveSafeInteger(requestTimeoutMs, "requestTimeoutMs");

  const request = async (path: string, init: RequestInit = {}) => {
    const deadline = createRequestDeadline(requestTimeoutMs);
    try {
      const response = await fetch(new URL(path, normalizedBaseUrl), {
        ...init,
        headers: {
          ...headersRecord(init.headers),
          "X-Inner-Api-Key": normalizedApiKey,
        },
        signal: deadline.signal,
      });
      return { deadline, response };
    } catch (error) {
      deadline.dispose();
      throw requestTransportError(error, deadline.expired(), requestTimeoutMs);
    }
  };

  const withResponse = async <T>(
    path: string,
    init: RequestInit,
    consume: (response: Response) => Promise<T> | T,
  ): Promise<T> => {
    const { deadline, response } = await request(path, init);
    try {
      const result = await consume(response);
      deadline.throwIfExpired();
      return result;
    } catch (error) {
      if (deadline.expired()) {
        throw requestTransportError(error, true, requestTimeoutMs);
      }
      throw error;
    } finally {
      deadline.dispose();
    }
  };

  return {
    kind: "dify",
    deleteObject: async (key) => {
      await withResponse(
        objectPath("/inner/api/knowledge-fs/storage/object", { key }),
        {
          method: "DELETE",
        },
        (response) => assertStatus(response, [204]),
      );
    },
    getObject: async (key) => {
      return withResponse(
        objectPath("/inner/api/knowledge-fs/storage/object", { key }),
        {},
        async (response) => {
          if (response.status === 404) return null;
          assertStatus(response, [200]);
          return readBoundedBody(response, maxObjectBytes);
        },
      );
    },
    getObjectStream: async (key) => {
      const { deadline, response } = await request(
        objectPath("/inner/api/knowledge-fs/storage/object", { key }),
      );
      if (response.status === 404) {
        deadline.dispose();
        return null;
      }
      try {
        assertStatus(response, [200]);
        return boundedResponseStream(response, maxObjectBytes, deadline, requestTimeoutMs);
      } catch (error) {
        deadline.dispose();
        throw error;
      }
    },
    health: async () => {
      try {
        return await withResponse(
          "/inner/api/knowledge-fs/storage/health",
          {},
          async (response) => {
            if (!response.ok) return false;
            const payload = asRecord(await response.json());
            return payload?.ok === true;
          },
        );
      } catch {
        return false;
      }
    },
    headObject: async (key) => {
      return withResponse(
        objectPath("/inner/api/knowledge-fs/storage/object/metadata", { key }),
        {},
        async (response) => {
          if (response.status === 404) return null;
          assertStatus(response, [200]);
          return parseObjectMetadata(await response.json());
        },
      );
    },
    listObjects: async ({ cursor, limit, prefix }) => {
      return withResponse(
        objectPath("/inner/api/knowledge-fs/storage/objects", {
          ...(cursor ? { cursor } : {}),
          limit: String(limit),
          prefix,
        }),
        {},
        async (response) => {
          assertStatus(response, [200]);
          return parseObjectList(await response.json());
        },
      );
    },
    putObject: async (input) => {
      if (input.body.byteLength > maxObjectBytes) {
        throw new Error(`Object ${input.key} exceeds maxObjectBytes=${maxObjectBytes}`);
      }
      return withResponse(
        objectPath("/inner/api/knowledge-fs/storage/object", { key: input.key }),
        {
          body: requestBody(input.body),
          headers: {
            ...(input.checksumSha256Base64 ? { [checksumHeader]: input.checksumSha256Base64 } : {}),
            ...(input.contentType ? { [contentTypeHeader]: input.contentType } : {}),
            [metadataHeader]: Buffer.from(JSON.stringify(input.metadata ?? {})).toString(
              "base64url",
            ),
          },
          method: "PUT",
        },
        async (response) => {
          assertStatus(response, [200]);
          return parseObjectMetadata(await response.json());
        },
      );
    },
  };
}

function requestBody(body: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy.buffer;
}

function objectPath(path: string, query: Readonly<Record<string, string>>): string {
  const search = new URLSearchParams(query);
  return `${path}?${search.toString()}`;
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

function headersRecord(headers: HeadersInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(headers).entries());
}

function assertStatus(response: Response, expected: readonly number[]): void {
  if (!expected.includes(response.status)) {
    throw new DifyObjectStorageRequestError(
      `Dify object storage request failed with status ${response.status}`,
      { retryable: isRetryableStatus(response.status), status: response.status },
    );
  }
}

function parseObjectList(value: unknown): ListObjectsResult {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.objects)) {
    throw new Error("Dify object storage list response is invalid");
  }
  const objects = record.objects.map(parseObjectMetadata);
  const nextCursor = optionalString(record.nextCursor);
  return {
    objects,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function parseObjectMetadata(value: unknown): ObjectMetadata {
  const record = asRecord(value);
  const metadata = asStringRecord(record?.metadata);
  const key = optionalString(record?.key);
  const sizeBytes = record?.sizeBytes;
  if (
    !record ||
    !metadata ||
    !key ||
    !Number.isSafeInteger(sizeBytes) ||
    typeof sizeBytes !== "number" ||
    sizeBytes < 0
  ) {
    throw new Error("Dify object storage metadata response is invalid");
  }
  const checksumSha256Base64 = optionalString(record.checksumSha256Base64);
  const contentType = optionalString(record.contentType);
  return {
    ...(checksumSha256Base64 ? { checksumSha256Base64 } : {}),
    ...(contentType ? { contentType } : {}),
    key,
    metadata,
    sizeBytes,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record || Object.values(record).some((item) => typeof item !== "string")) return undefined;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, item as string]));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function readBoundedBody(response: Response, maxObjectBytes: number): Promise<Uint8Array> {
  const stream = boundedResponseStream(response, maxObjectBytes);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
    totalBytes += chunk.value.byteLength;
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function boundedResponseStream(
  response: Response,
  maxObjectBytes: number,
  deadline?: RequestDeadline,
  requestTimeoutMs = defaultRequestTimeoutMs,
): ReadableStream<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxObjectBytes) {
    throw new Error(`Dify object storage response exceeds maxObjectBytes=${maxObjectBytes}`);
  }
  const source = response.body;
  if (!source) {
    deadline?.dispose();
    return new ReadableStream({ start: (controller) => controller.close() });
  }
  const reader = source.getReader();
  let totalBytes = 0;
  return new ReadableStream<Uint8Array>({
    cancel: async (reason) => {
      try {
        await reader.cancel(reason);
      } finally {
        deadline?.dispose();
      }
    },
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          deadline?.throwIfExpired();
          deadline?.dispose();
          controller.close();
          return;
        }
        totalBytes += chunk.value.byteLength;
        if (totalBytes > maxObjectBytes) {
          await reader.cancel();
          deadline?.dispose();
          controller.error(
            new Error(`Dify object storage response exceeds maxObjectBytes=${maxObjectBytes}`),
          );
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        const timedOut = deadline?.expired() === true;
        deadline?.dispose();
        controller.error(timedOut ? requestTransportError(error, true, requestTimeoutMs) : error);
      }
    },
  });
}

interface RequestDeadline {
  readonly signal: AbortSignal;
  dispose(): void;
  expired(): boolean;
  throwIfExpired(): void;
}

function createRequestDeadline(requestTimeoutMs: number): RequestDeadline {
  const controller = new AbortController();
  const timeoutReason = new Error("Dify object storage request deadline exceeded");
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutReason);
  }, requestTimeoutMs);
  (timer as { unref?: () => void }).unref?.();

  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
    expired: () => timedOut,
    throwIfExpired: () => {
      if (timedOut) throw timeoutReason;
    },
  };
}

function requestTransportError(
  cause: unknown,
  timedOut: boolean,
  requestTimeoutMs: number,
): DifyObjectStorageRequestError {
  if (cause instanceof DifyObjectStorageRequestError) return cause;
  return new DifyObjectStorageRequestError(
    timedOut
      ? `Dify object storage request timed out after requestTimeoutMs=${requestTimeoutMs}`
      : "Dify object storage request failed",
    { cause, retryable: true },
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}
