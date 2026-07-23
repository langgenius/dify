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
}

const defaultMaxObjectBytes = 64 * 1024 * 1024;
const metadataHeader = "X-Knowledge-FS-Metadata";
const checksumHeader = "X-Knowledge-FS-Checksum-Sha256";
const contentTypeHeader = "X-Knowledge-FS-Content-Type";

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
}: DifyObjectStorageOptions): ObjectStorageAdapter {
  const normalizedBaseUrl = requiredBaseUrl(baseUrl);
  const normalizedApiKey = requiredString(apiKey, "Dify inner API key");
  positiveSafeInteger(maxObjectBytes, "maxObjectBytes");

  const request = (path: string, init: RequestInit = {}) =>
    fetch(new URL(path, normalizedBaseUrl), {
      ...init,
      headers: {
        ...headersRecord(init.headers),
        "X-Inner-Api-Key": normalizedApiKey,
      },
    });

  return {
    kind: "dify",
    deleteObject: async (key) => {
      const response = await request(
        objectPath("/inner/api/knowledge-fs/storage/object", { key }),
        {
          method: "DELETE",
        },
      );
      assertStatus(response, [204]);
    },
    getObject: async (key) => {
      const response = await request(objectPath("/inner/api/knowledge-fs/storage/object", { key }));
      if (response.status === 404) return null;
      assertStatus(response, [200]);
      return readBoundedBody(response, maxObjectBytes);
    },
    getObjectStream: async (key) => {
      const response = await request(objectPath("/inner/api/knowledge-fs/storage/object", { key }));
      if (response.status === 404) return null;
      assertStatus(response, [200]);
      return boundedResponseStream(response, maxObjectBytes);
    },
    health: async () => {
      try {
        const response = await request("/inner/api/knowledge-fs/storage/health");
        if (!response.ok) return false;
        const payload = asRecord(await response.json());
        return payload?.ok === true;
      } catch {
        return false;
      }
    },
    headObject: async (key) => {
      const response = await request(
        objectPath("/inner/api/knowledge-fs/storage/object/metadata", { key }),
      );
      if (response.status === 404) return null;
      assertStatus(response, [200]);
      return parseObjectMetadata(await response.json());
    },
    listObjects: async ({ cursor, limit, prefix }) => {
      const response = await request(
        objectPath("/inner/api/knowledge-fs/storage/objects", {
          ...(cursor ? { cursor } : {}),
          limit: String(limit),
          prefix,
        }),
      );
      assertStatus(response, [200]);
      return parseObjectList(await response.json());
    },
    putObject: async (input) => {
      if (input.body.byteLength > maxObjectBytes) {
        throw new Error(`Object ${input.key} exceeds maxObjectBytes=${maxObjectBytes}`);
      }
      const response = await request(
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
      );
      assertStatus(response, [200]);
      return parseObjectMetadata(await response.json());
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
    throw new Error(`Dify object storage request failed with status ${response.status}`);
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
): ReadableStream<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxObjectBytes) {
    throw new Error(`Dify object storage response exceeds maxObjectBytes=${maxObjectBytes}`);
  }
  const source = response.body;
  if (!source) return new ReadableStream({ start: (controller) => controller.close() });
  const reader = source.getReader();
  let totalBytes = 0;
  return new ReadableStream<Uint8Array>({
    cancel: (reason) => reader.cancel(reason),
    async pull(controller) {
      const chunk = await reader.read();
      if (chunk.done) {
        controller.close();
        return;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxObjectBytes) {
        await reader.cancel();
        controller.error(
          new Error(`Dify object storage response exceeds maxObjectBytes=${maxObjectBytes}`),
        );
        return;
      }
      controller.enqueue(chunk.value);
    },
  });
}
