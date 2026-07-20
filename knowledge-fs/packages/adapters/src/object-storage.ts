import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type {
  ListObjectsInput,
  ListObjectsResult,
  ObjectMetadata,
  ObjectStorageAdapter,
  PutObjectInput,
} from "@knowledge/core";

export interface MemoryObjectStorageOptions {
  readonly kind: ObjectStorageAdapter["kind"];
  readonly maxObjectBytes: number;
  readonly maxObjects?: number;
  readonly maxTotalBytes?: number;
}

export interface S3ObjectStorageOptions {
  readonly bucket: string;
  readonly client?: S3ObjectStorageClient;
  readonly kind: Extract<ObjectStorageAdapter["kind"], "r2" | "s3-compatible">;
  readonly maxObjectBytes?: number;
}

export interface S3ObjectStorageClient {
  send(command: object): Promise<unknown>;
}

interface StoredObject {
  readonly body: Uint8Array;
  readonly metadata: ObjectMetadata;
}

const defaultMaxObjectBytes = 64 * 1024 * 1024;

export function createMemoryObjectStorageAdapter({
  kind,
  maxObjectBytes,
  maxObjects = 1_000,
  maxTotalBytes = maxObjectBytes * maxObjects,
}: MemoryObjectStorageOptions): ObjectStorageAdapter {
  if (maxObjectBytes < 1) {
    throw new Error("Object storage maxObjectBytes must be at least 1");
  }

  if (maxObjects < 1) {
    throw new Error("Object storage maxObjects must be at least 1");
  }

  if (maxTotalBytes < 1) {
    throw new Error("Object storage maxTotalBytes must be at least 1");
  }

  const objects = new Map<string, StoredObject>();
  let totalBytes = 0;

  return {
    kind,
    deleteObject: async (key) => {
      const stored = objects.get(key);

      if (stored) {
        totalBytes -= stored.body.byteLength;
        objects.delete(key);
      }
    },
    getObject: async (key) => {
      const stored = objects.get(key);

      return stored ? copyBytes(stored.body) : null;
    },
    getObjectStream: async (key) => {
      const stored = objects.get(key);

      return stored ? bytesToStream(copyBytes(stored.body)) : null;
    },
    health: async () => true,
    headObject: async (key) => {
      const stored = objects.get(key);

      return stored ? cloneObjectMetadata(stored.metadata) : null;
    },
    listObjects: async (input) => listObjects(objects, input),
    putObject: async (input) => {
      if (input.body.byteLength > maxObjectBytes) {
        throw new Error(`Object ${input.key} exceeds maxObjectBytes=${maxObjectBytes}`);
      }

      const body = copyBytes(input.body);
      const existing = objects.get(input.key);
      const nextObjectCount = objects.size + (existing ? 0 : 1);
      const nextTotalBytes = totalBytes - (existing?.body.byteLength ?? 0) + body.byteLength;

      if (nextObjectCount > maxObjects) {
        throw new Error(`Object storage maxObjects=${maxObjects} exceeded`);
      }

      if (nextTotalBytes > maxTotalBytes) {
        throw new Error(`Object storage maxTotalBytes=${maxTotalBytes} exceeded`);
      }

      const metadata = {
        key: input.key,
        metadata: cloneMetadata(input.metadata),
        sizeBytes: body.byteLength,
        ...(input.contentType ? { contentType: input.contentType } : {}),
      };

      objects.set(input.key, {
        body,
        metadata,
      });
      totalBytes = nextTotalBytes;

      return cloneObjectMetadata(metadata);
    },
  };
}

export function createS3ObjectStorageAdapter({
  bucket,
  client = new S3Client({}),
  kind,
  maxObjectBytes = defaultMaxObjectBytes,
}: S3ObjectStorageOptions): ObjectStorageAdapter {
  return {
    kind,
    deleteObject: async (key) => {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    },
    getObject: async (key) => {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );
        const body = getRecordField(result, "Body");
        const contentLength = readNumber(result, "ContentLength");

        if (contentLength !== undefined) {
          assertObjectSize(key, contentLength, maxObjectBytes);
        }

        if (body === undefined || body === null) {
          return new Uint8Array();
        }

        return copyBytes(await bodyToBytes(body, key, maxObjectBytes));
      } catch (error) {
        if (isMissingObjectError(error)) {
          return null;
        }

        throw error;
      }
    },
    getObjectStream: async (key) => {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );
        const body = getRecordField(result, "Body");
        const contentLength = readNumber(result, "ContentLength");

        if (contentLength !== undefined) {
          assertObjectSize(key, contentLength, maxObjectBytes);
        }

        return bodyToStream(body, key, maxObjectBytes);
      } catch (error) {
        if (isMissingObjectError(error)) {
          return null;
        }

        throw error;
      }
    },
    health: async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
        return true;
      } catch {
        return false;
      }
    },
    headObject: async (key) => {
      try {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );

        const contentType = readString(result, "ContentType");

        return {
          key,
          metadata: readMetadata(result),
          sizeBytes: readNumber(result, "ContentLength") ?? 0,
          ...(contentType ? { contentType } : {}),
        };
      } catch (error) {
        if (isMissingObjectError(error)) {
          return null;
        }

        throw error;
      }
    },
    listObjects: async (input) => {
      if (input.limit < 1) {
        throw new Error("Object list limit must be at least 1");
      }

      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ...(input.cursor ? { ContinuationToken: input.cursor } : {}),
          MaxKeys: input.limit,
          Prefix: input.prefix,
        }),
      );

      const objects = readContents(result).map((object) => ({
        key: object.key,
        metadata: {},
        sizeBytes: object.sizeBytes,
      }));
      const nextCursor = readString(result, "NextContinuationToken");

      return {
        objects,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    putObject: async (input) => {
      if (input.body.byteLength > maxObjectBytes) {
        throw new Error(`Object ${input.key} exceeds maxObjectBytes=${maxObjectBytes}`);
      }

      await client.send(
        new PutObjectCommand({
          Body: input.body,
          Bucket: bucket,
          ...(input.contentType ? { ContentType: input.contentType } : {}),
          Key: input.key,
          Metadata: input.metadata ?? {},
        }),
      );

      return {
        key: input.key,
        metadata: cloneMetadata(input.metadata),
        sizeBytes: input.body.byteLength,
        ...(input.contentType ? { contentType: input.contentType } : {}),
      };
    },
  };
}

function listObjects(
  objects: ReadonlyMap<string, StoredObject>,
  { cursor, limit, prefix }: ListObjectsInput,
): ListObjectsResult {
  if (limit < 1) {
    throw new Error("Object list limit must be at least 1");
  }

  const keys = [...objects.keys()]
    .filter((key) => key.startsWith(prefix))
    .filter((key) => (cursor ? key > cursor : true))
    .sort()
    .slice(0, limit + 1);
  const pageKeys = keys.slice(0, limit);
  const pageObjects = pageKeys
    .map((key) => objects.get(key)?.metadata)
    .filter(isObjectMetadata)
    .map(cloneObjectMetadata);

  const nextCursor = keys.length > limit ? pageKeys.at(-1) : undefined;

  return {
    objects: pageObjects,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function cloneMetadata(
  metadata: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  return { ...(metadata ?? {}) };
}

function cloneObjectMetadata(metadata: ObjectMetadata): ObjectMetadata {
  return {
    key: metadata.key,
    metadata: cloneMetadata(metadata.metadata),
    sizeBytes: metadata.sizeBytes,
    ...(metadata.contentType ? { contentType: metadata.contentType } : {}),
  };
}

function isObjectMetadata(value: ObjectMetadata | undefined): value is ObjectMetadata {
  return Boolean(value);
}

async function bodyToBytes(
  body: unknown,
  key: string,
  maxObjectBytes: number,
): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    assertObjectSize(key, body.byteLength, maxObjectBytes);
    return body;
  }

  if (typeof body === "string") {
    const bytes = new TextEncoder().encode(body);
    assertObjectSize(key, bytes.byteLength, maxObjectBytes);

    return bytes;
  }

  const transformToByteArray = getFunctionField(body, "transformToByteArray");

  if (transformToByteArray) {
    const bytes = await transformToByteArray.call(body);
    assertObjectSize(key, bytes.byteLength, maxObjectBytes);

    return bytes;
  }

  if (isAsyncIterable(body)) {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    for await (const chunk of body) {
      const bytes = chunk instanceof Uint8Array ? chunk : new TextEncoder().encode(String(chunk));
      totalBytes += bytes.byteLength;
      assertObjectSize(key, totalBytes, maxObjectBytes);
      chunks.push(bytes);
    }

    return concatenateBytes(chunks);
  }

  throw new Error("Unsupported S3 object body type");
}

function bodyToStream(
  body: unknown,
  key: string,
  maxObjectBytes: number,
): ReadableStream<Uint8Array> {
  if (body === undefined || body === null) {
    return bytesToStream(new Uint8Array());
  }

  if (body instanceof ReadableStream) {
    return limitReadableStream(body, key, maxObjectBytes);
  }

  if (body instanceof Uint8Array) {
    assertObjectSize(key, body.byteLength, maxObjectBytes);
    return bytesToStream(copyBytes(body));
  }

  if (typeof body === "string") {
    const bytes = new TextEncoder().encode(body);
    assertObjectSize(key, bytes.byteLength, maxObjectBytes);
    return bytesToStream(bytes);
  }

  if (isAsyncIterable(body)) {
    return asyncIterableToReadableStream(body, key, maxObjectBytes);
  }

  throw new Error("Unsupported S3 object body type");
}

function asyncIterableToReadableStream(
  iterable: AsyncIterable<unknown>,
  key: string,
  maxObjectBytes: number,
): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]();
  let totalBytes = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();

      if (next.done) {
        controller.close();
        return;
      }

      const chunk =
        next.value instanceof Uint8Array
          ? copyBytes(next.value)
          : new TextEncoder().encode(String(next.value));
      totalBytes += chunk.byteLength;
      assertObjectSize(key, totalBytes, maxObjectBytes);
      controller.enqueue(chunk);
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function limitReadableStream(
  stream: ReadableStream<Uint8Array>,
  key: string,
  maxObjectBytes: number,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let totalBytes = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await reader.read();

      if (result.done) {
        controller.close();
        return;
      }

      totalBytes += result.value.byteLength;
      assertObjectSize(key, totalBytes, maxObjectBytes);
      controller.enqueue(copyBytes(result.value));
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

function assertObjectSize(key: string, sizeBytes: number, maxObjectBytes: number): void {
  if (sizeBytes > maxObjectBytes) {
    throw new Error(`Object ${key} exceeds maxObjectBytes=${maxObjectBytes}`);
  }
}

function concatenateBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function isMissingObjectError(error: unknown): boolean {
  const record = asRecord(error);
  const metadata = asRecord(record?.$metadata);

  return (
    record?.name === "NoSuchKey" ||
    record?.name === "NotFound" ||
    record?.Code === "NoSuchKey" ||
    metadata?.httpStatusCode === 404
  );
}

function readContents(
  value: unknown,
): readonly { readonly key: string; readonly sizeBytes: number }[] {
  const contents = getRecordField(value, "Contents");

  if (!Array.isArray(contents)) {
    return [];
  }

  return contents
    .map((item) => {
      const key = readString(item, "Key");

      if (!key) {
        return null;
      }

      return {
        key,
        sizeBytes: readNumber(item, "Size") ?? 0,
      };
    })
    .filter(isListedObject);
}

function readMetadata(value: unknown): Readonly<Record<string, string>> {
  const metadata = getRecordField(value, "Metadata");

  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(metadata).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function readNumber(value: unknown, key: string): number | undefined {
  const field = getRecordField(value, key);

  return typeof field === "number" ? field : undefined;
}

function readString(value: unknown, key: string): string | undefined {
  const field = getRecordField(value, key);

  return typeof field === "string" ? field : undefined;
}

function getFunctionField(
  value: unknown,
  key: string,
): ((this: unknown) => Promise<Uint8Array>) | undefined {
  const field = getRecordField(value, key);

  return typeof field === "function"
    ? (field as (this: unknown) => Promise<Uint8Array>)
    : undefined;
}

function getRecordField(value: unknown, key: string): unknown {
  return asRecord(value)?.[key];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function isListedObject(
  value: { readonly key: string; readonly sizeBytes: number } | null,
): value is { readonly key: string; readonly sizeBytes: number } {
  return value !== null;
}
