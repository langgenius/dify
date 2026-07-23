import type {
  ListObjectsInput,
  ListObjectsResult,
  ObjectMetadata,
  ObjectStorageAdapter,
} from "@knowledge/core";

export interface MemoryObjectStorageOptions {
  readonly kind: Extract<ObjectStorageAdapter["kind"], "local" | "memory">;
  readonly maxObjectBytes: number;
  readonly maxObjects?: number;
  readonly maxTotalBytes?: number;
}

interface StoredObject {
  readonly body: Uint8Array;
  readonly metadata: ObjectMetadata;
}

/** In-process object storage for bounded unit tests; production Node assembly always uses Dify. */
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

      const metadata: ObjectMetadata = {
        ...(input.checksumSha256Base64 ? { checksumSha256Base64: input.checksumSha256Base64 } : {}),
        ...(input.contentType ? { contentType: input.contentType } : {}),
        key: input.key,
        metadata: cloneMetadata(input.metadata),
        sizeBytes: body.byteLength,
      };
      objects.set(input.key, { body, metadata });
      totalBytes = nextTotalBytes;
      return cloneObjectMetadata(metadata);
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
    .filter((key) => key.startsWith(prefix) && (!cursor || key > cursor))
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
    ...(metadata.checksumSha256Base64
      ? { checksumSha256Base64: metadata.checksumSha256Base64 }
      : {}),
    ...(metadata.contentType ? { contentType: metadata.contentType } : {}),
    key: metadata.key,
    metadata: cloneMetadata(metadata.metadata),
    sizeBytes: metadata.sizeBytes,
  };
}

function isObjectMetadata(value: ObjectMetadata | undefined): value is ObjectMetadata {
  return Boolean(value);
}
