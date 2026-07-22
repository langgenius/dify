import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  type LifecycleRule,
  ListObjectsV2Command,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type {
  CompleteMultipartObjectUploadInput,
  CreateMultipartObjectUploadInput,
  ListObjectsInput,
  ListObjectsResult,
  ObjectMetadata,
  ObjectStorageAdapter,
  ObjectStorageDirectUploadAdapter,
  PresignMultipartObjectPartInput,
  PresignPutObjectInput,
  PresignedObjectUpload,
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
  readonly maxDirectUploadBytes?: number;
  readonly maxObjectBytes?: number;
  readonly now?: () => number;
  readonly presign?: S3ObjectStoragePresigner;
}

export interface S3ObjectStorageClient {
  send(command: object): Promise<unknown>;
}

export interface S3ObjectStoragePresignInput {
  readonly client: S3ObjectStorageClient;
  readonly command: {
    readonly input: unknown;
    readonly constructor: { readonly name: string };
  };
  readonly expiresInSeconds: number;
}

export type S3ObjectStoragePresigner = (input: S3ObjectStoragePresignInput) => Promise<string>;

interface StoredObject {
  readonly body: Uint8Array;
  readonly metadata: ObjectMetadata;
}

const defaultMaxObjectBytes = 64 * 1024 * 1024;
const defaultMaxDirectUploadBytes = 5 * 1024 * 1024 * 1024 * 1024;
const maxPresignTtlSeconds = 15 * 60;
const incompleteMultipartLifecycleRuleId = "knowledge-fs-incomplete-multipart";

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
        ...(input.checksumSha256Base64 ? { checksumSha256Base64: input.checksumSha256Base64 } : {}),
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
  maxDirectUploadBytes = defaultMaxDirectUploadBytes,
  maxObjectBytes = defaultMaxObjectBytes,
  now = Date.now,
  presign = defaultS3ObjectStoragePresigner,
}: S3ObjectStorageOptions): ObjectStorageAdapter {
  const normalizedBucket = requiredDirectUploadString(bucket, "bucket");
  positiveSafeInteger(maxDirectUploadBytes, "maxDirectUploadBytes");
  const directUpload = createS3DirectUploadAdapter({
    bucket: normalizedBucket,
    client,
    maxDirectUploadBytes,
    now,
    presign,
  });

  return {
    kind,
    directUpload,
    deleteObject: async (key) => {
      await client.send(
        new DeleteObjectCommand({
          Bucket: normalizedBucket,
          Key: key,
        }),
      );
    },
    getObject: async (key) => {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: normalizedBucket,
            Key: key,
          }),
        );
        const body = getRecordField(result, "Body");
        const contentLength = readNumber(result, "ContentLength");

        await assertObjectMetadataSize(body, key, contentLength, maxObjectBytes);

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
            Bucket: normalizedBucket,
            Key: key,
          }),
        );
        const body = getRecordField(result, "Body");
        const contentLength = readNumber(result, "ContentLength");

        await assertObjectMetadataSize(body, key, contentLength, maxObjectBytes);

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
        await client.send(new HeadBucketCommand({ Bucket: normalizedBucket }));
        return true;
      } catch {
        return false;
      }
    },
    headObject: async (key) => {
      try {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: normalizedBucket,
            ChecksumMode: "ENABLED",
            Key: key,
          }),
        );

        const checksumSha256Base64 = readString(result, "ChecksumSHA256");
        const contentType = readString(result, "ContentType");

        return {
          ...(checksumSha256Base64 ? { checksumSha256Base64 } : {}),
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
          Bucket: normalizedBucket,
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
          Bucket: normalizedBucket,
          ...(input.checksumSha256Base64 ? { ChecksumSHA256: input.checksumSha256Base64 } : {}),
          ...(input.contentType ? { ContentType: input.contentType } : {}),
          Key: input.key,
          Metadata: input.metadata ?? {},
        }),
      );

      return {
        ...(input.checksumSha256Base64 ? { checksumSha256Base64: input.checksumSha256Base64 } : {}),
        key: input.key,
        metadata: cloneMetadata(input.metadata),
        sizeBytes: input.body.byteLength,
        ...(input.contentType ? { contentType: input.contentType } : {}),
      };
    },
  };
}

function createS3DirectUploadAdapter({
  bucket,
  client,
  maxDirectUploadBytes,
  now,
  presign,
}: {
  readonly bucket: string;
  readonly client: S3ObjectStorageClient;
  readonly maxDirectUploadBytes: number;
  readonly now: () => number;
  readonly presign: S3ObjectStoragePresigner;
}): ObjectStorageDirectUploadAdapter {
  return {
    abortMultipartUpload: async (rawInput) => {
      const input = normalizeMultipartIdentity(rawInput);
      try {
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: input.key,
            UploadId: input.uploadId,
          }),
        );
      } catch (error) {
        if (!isMissingMultipartUploadError(error)) throw error;
      }
    },
    completeMultipartUpload: async (rawInput) => {
      const input = normalizeCompleteMultipartInput(rawInput);
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: input.key,
          MultipartUpload: {
            Parts: input.parts.map((part) => ({
              ...(part.checksumSha256Base64 ? { ChecksumSHA256: part.checksumSha256Base64 } : {}),
              ETag: part.etag,
              PartNumber: part.partNumber,
            })),
          },
          UploadId: input.uploadId,
        }),
      );
    },
    createMultipartUpload: async (rawInput) => {
      const input = normalizeCreateMultipartInput(rawInput);
      const result = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          ChecksumAlgorithm: "SHA256",
          ...(input.contentType ? { ContentType: input.contentType } : {}),
          Key: input.key,
          Metadata: input.metadata,
        }),
      );
      const uploadId = readString(result, "UploadId");
      if (!uploadId) {
        throw new Error("Object storage create multipart did not return an upload id");
      }
      return { key: input.key, uploadId };
    },
    ensureIncompleteMultipartUploadLifecycle: async ({ daysAfterInitiation }) => {
      if (
        !Number.isSafeInteger(daysAfterInitiation) ||
        daysAfterInitiation < 1 ||
        daysAfterInitiation > 365
      ) {
        throw new Error(
          "Object storage incomplete multipart lifecycle daysAfterInitiation must be between 1 and 365",
        );
      }
      let rules: LifecycleRule[] = [];
      try {
        const current = await client.send(
          new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
        );
        rules = lifecycleRules(current).filter(
          (rule) => rule.ID !== incompleteMultipartLifecycleRuleId,
        );
      } catch (error) {
        if (!isMissingLifecycleConfigurationError(error)) throw error;
      }
      rules.push({
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: daysAfterInitiation },
        Filter: { Prefix: "" },
        ID: incompleteMultipartLifecycleRuleId,
        Status: "Enabled",
      });
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: bucket,
          LifecycleConfiguration: { Rules: rules },
        }),
      );
    },
    presignMultipartPart: async (rawInput) => {
      const input = normalizePresignMultipartPartInput(rawInput, maxDirectUploadBytes);
      const command = new UploadPartCommand({
        Bucket: bucket,
        ...(input.checksumSha256Base64 ? { ChecksumSHA256: input.checksumSha256Base64 } : {}),
        ContentLength: input.contentLength,
        Key: input.key,
        PartNumber: input.partNumber,
        UploadId: input.uploadId,
      });
      return presignedUploadResponse({
        command,
        expiresInSeconds: input.expiresInSeconds,
        headers: input.checksumSha256Base64
          ? { "x-amz-checksum-sha256": input.checksumSha256Base64 }
          : {},
        client,
        now,
        presign,
      });
    },
    presignPutObject: async (rawInput) => {
      const input = normalizePresignPutInput(rawInput, maxDirectUploadBytes);
      const command = new PutObjectCommand({
        Bucket: bucket,
        ...(input.checksumSha256Base64 ? { ChecksumSHA256: input.checksumSha256Base64 } : {}),
        ContentLength: input.contentLength,
        ...(input.contentType ? { ContentType: input.contentType } : {}),
        Key: input.key,
        Metadata: input.metadata,
      });
      return presignedUploadResponse({
        command,
        expiresInSeconds: input.expiresInSeconds,
        headers: {
          ...(input.contentType ? { "content-type": input.contentType } : {}),
          ...(input.checksumSha256Base64
            ? { "x-amz-checksum-sha256": input.checksumSha256Base64 }
            : {}),
        },
        client,
        now,
        presign,
      });
    },
    verifyObjectSha256: async (rawInput) => {
      const key = directUploadKey(rawInput.key);
      const checksumSha256Base64 = requiredDirectUploadString(
        rawInput.checksumSha256Base64,
        "checksum",
      );
      const expectedSizeBytes = directUploadContentLength(
        rawInput.expectedSizeBytes,
        maxDirectUploadBytes,
      );
      let result: unknown;
      try {
        result = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
          }),
        );
      } catch (error) {
        if (isMissingObjectError(error)) return false;
        throw error;
      }
      const stream = bodyToStream(getRecordField(result, "Body"), key, maxDirectUploadBytes);
      const reader = stream.getReader();
      const contentLength = readNumber(result, "ContentLength");
      if (contentLength !== undefined && contentLength !== expectedSizeBytes) {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        return false;
      }

      const hash = createHash("sha256");
      let sizeBytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          sizeBytes += chunk.value.byteLength;
          if (sizeBytes > expectedSizeBytes) {
            await reader.cancel().catch(() => undefined);
            return false;
          }
          hash.update(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      return sizeBytes === expectedSizeBytes && hash.digest("base64") === checksumSha256Base64;
    },
  };
}

async function defaultS3ObjectStoragePresigner({
  client,
  command,
  expiresInSeconds,
}: S3ObjectStoragePresignInput): Promise<string> {
  return getSignedUrl(client as S3Client, command as PutObjectCommand, {
    expiresIn: expiresInSeconds,
  });
}

async function presignedUploadResponse(input: {
  readonly client: S3ObjectStorageClient;
  readonly command: S3ObjectStoragePresignInput["command"];
  readonly expiresInSeconds: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly now: () => number;
  readonly presign: S3ObjectStoragePresigner;
}): Promise<PresignedObjectUpload> {
  const timestamp = input.now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error("Object storage direct upload clock must return a non-negative integer");
  }
  const url = await input.presign({
    client: input.client,
    command: input.command,
    expiresInSeconds: input.expiresInSeconds,
  });
  validatePresignedUrl(url);
  return {
    expiresAt: timestamp + input.expiresInSeconds * 1_000,
    headers: { ...input.headers },
    method: "PUT",
    url,
  };
}

function normalizePresignPutInput(
  input: PresignPutObjectInput,
  maxDirectUploadBytes: number,
): PresignPutObjectInput {
  const contentLength = directUploadContentLength(input.contentLength, maxDirectUploadBytes);
  const expiresInSeconds = directUploadExpiration(input.expiresInSeconds);
  return {
    ...(input.checksumSha256Base64
      ? { checksumSha256Base64: requiredDirectUploadString(input.checksumSha256Base64, "checksum") }
      : {}),
    contentLength,
    ...(input.contentType
      ? { contentType: requiredDirectUploadString(input.contentType, "contentType") }
      : {}),
    expiresInSeconds,
    key: directUploadKey(input.key),
    metadata: normalizeDirectUploadMetadata(input.metadata),
  };
}

function normalizePresignMultipartPartInput(
  input: PresignMultipartObjectPartInput,
  maxDirectUploadBytes: number,
): PresignMultipartObjectPartInput {
  const expiresInSeconds = directUploadExpiration(input.expiresInSeconds);
  const contentLength = directUploadContentLength(input.contentLength, maxDirectUploadBytes);
  if (
    !Number.isSafeInteger(input.partNumber) ||
    input.partNumber < 1 ||
    input.partNumber > 10_000
  ) {
    throw new Error("Object storage direct upload partNumber must be between 1 and 10000");
  }
  return {
    ...(input.checksumSha256Base64
      ? { checksumSha256Base64: requiredDirectUploadString(input.checksumSha256Base64, "checksum") }
      : {}),
    contentLength,
    expiresInSeconds,
    key: directUploadKey(input.key),
    partNumber: input.partNumber,
    uploadId: requiredDirectUploadString(input.uploadId, "uploadId"),
  };
}

function normalizeCreateMultipartInput(
  input: CreateMultipartObjectUploadInput,
): CreateMultipartObjectUploadInput {
  return {
    ...(input.contentType
      ? { contentType: requiredDirectUploadString(input.contentType, "contentType") }
      : {}),
    key: directUploadKey(input.key),
    metadata: normalizeDirectUploadMetadata(input.metadata),
  };
}

function normalizeCompleteMultipartInput(
  input: CompleteMultipartObjectUploadInput,
): CompleteMultipartObjectUploadInput {
  const identity = normalizeMultipartIdentity(input);
  if (input.parts.length < 1 || input.parts.length > 10_000) {
    throw new Error("Object storage multipart completion requires 1-10000 parts");
  }
  let previousPartNumber = 0;
  const parts = input.parts.map((part) => {
    if (
      !Number.isSafeInteger(part.partNumber) ||
      part.partNumber < 1 ||
      part.partNumber > 10_000 ||
      part.partNumber <= previousPartNumber
    ) {
      throw new Error("Object storage multipart completion parts must be strictly increasing");
    }
    previousPartNumber = part.partNumber;
    return {
      ...(part.checksumSha256Base64
        ? {
            checksumSha256Base64: requiredDirectUploadString(
              part.checksumSha256Base64,
              "part checksum",
            ),
          }
        : {}),
      etag: requiredDirectUploadString(part.etag, "part etag"),
      partNumber: part.partNumber,
    };
  });
  return {
    ...identity,
    parts,
  };
}

function normalizeMultipartIdentity(input: {
  readonly key: string;
  readonly uploadId: string;
}): { readonly key: string; readonly uploadId: string } {
  return {
    key: directUploadKey(input.key),
    uploadId: requiredDirectUploadString(input.uploadId, "uploadId"),
  };
}

function directUploadContentLength(value: number, maxDirectUploadBytes: number): number {
  positiveSafeInteger(value, "contentLength");
  if (value > maxDirectUploadBytes) {
    throw new Error(`Object direct upload exceeds maxDirectUploadBytes=${maxDirectUploadBytes}`);
  }
  return value;
}

function directUploadExpiration(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxPresignTtlSeconds) {
    throw new Error(
      `Object storage direct upload expiresInSeconds must be between 1 and ${maxPresignTtlSeconds}`,
    );
  }
  return value;
}

function directUploadKey(value: string): string {
  const key = requiredDirectUploadString(value, "key");
  if (new TextEncoder().encode(key).byteLength > 1_024 || key.includes("\0")) {
    throw new Error("Object storage direct upload key is invalid");
  }
  return key;
}

function normalizeDirectUploadMetadata(
  input: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const metadata: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input ?? {})) {
    const key = requiredDirectUploadString(rawKey, "metadata key").toLowerCase();
    const value = requiredDirectUploadString(rawValue, `metadata ${key}`);
    if (!/^[a-z0-9_-]+$/.test(key) || key.length > 64 || value.length > 1_024) {
      throw new Error("Object storage direct upload metadata is invalid");
    }
    metadata[key] = value;
  }
  return metadata;
}

function requiredDirectUploadString(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Object storage direct upload ${field} is required`);
  }
  return normalized;
}

function positiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Object storage direct upload ${field} must be a positive safe integer`);
  }
}

function validatePresignedUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Object storage presigner returned an invalid URL");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Object storage presigner returned an invalid URL");
  }
}

function isMissingMultipartUploadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "NoSuchUpload") return true;
  const metadata = getRecordField(error, "$metadata");
  return readNumber(metadata, "httpStatusCode") === 404;
}

function isMissingLifecycleConfigurationError(error: unknown): boolean {
  const record = asRecord(error);
  return (
    record?.name === "NoSuchLifecycleConfiguration" ||
    record?.Code === "NoSuchLifecycleConfiguration"
  );
}

function lifecycleRules(value: unknown): LifecycleRule[] {
  const rules = getRecordField(value, "Rules");
  return Array.isArray(rules)
    ? rules.filter((rule): rule is LifecycleRule => asRecord(rule) !== undefined)
    : [];
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
    ...(metadata.checksumSha256Base64
      ? { checksumSha256Base64: metadata.checksumSha256Base64 }
      : {}),
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
  let iteratorClosed = false;
  let totalBytes = 0;

  const closeIterator = async (): Promise<void> => {
    if (iteratorClosed) return;
    iteratorClosed = true;
    await iterator.return?.();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();

        if (next.done) {
          await closeIterator();
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
      } catch (error) {
        await closeIterator().catch(() => undefined);
        throw error;
      }
    },
    async cancel() {
      await closeIterator();
    },
  });
}

function limitReadableStream(
  stream: ReadableStream<Uint8Array>,
  key: string,
  maxObjectBytes: number,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  let readerClosed = false;
  let totalBytes = 0;

  const releaseReader = (): void => {
    if (readerClosed) return;
    readerClosed = true;
    reader.releaseLock();
  };

  const cancelReader = async (reason?: unknown): Promise<void> => {
    if (readerClosed) return;
    readerClosed = true;
    try {
      await reader.cancel(reason);
    } finally {
      reader.releaseLock();
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();

        if (result.done) {
          releaseReader();
          controller.close();
          return;
        }

        totalBytes += result.value.byteLength;
        assertObjectSize(key, totalBytes, maxObjectBytes);
        controller.enqueue(copyBytes(result.value));
      } catch (error) {
        await cancelReader(error).catch(() => undefined);
        throw error;
      }
    },
    async cancel(reason) {
      await cancelReader(reason);
    },
  });
}

function assertObjectSize(key: string, sizeBytes: number, maxObjectBytes: number): void {
  if (sizeBytes > maxObjectBytes) {
    throw new Error(`Object ${key} exceeds maxObjectBytes=${maxObjectBytes}`);
  }
}

async function assertObjectMetadataSize(
  body: unknown,
  key: string,
  sizeBytes: number | undefined,
  maxObjectBytes: number,
): Promise<void> {
  if (sizeBytes === undefined) return;
  try {
    assertObjectSize(key, sizeBytes, maxObjectBytes);
  } catch (error) {
    await closeObjectBodyBestEffort(body, error);
    throw error;
  }
}

async function closeObjectBodyBestEffort(body: unknown, reason: unknown): Promise<void> {
  try {
    if (body instanceof ReadableStream) {
      await body.cancel(reason);
      return;
    }
    if (isAsyncIterable(body)) {
      await body[Symbol.asyncIterator]().return?.();
    }
  } catch {
    return;
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
