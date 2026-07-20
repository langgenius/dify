import { describe, expect, it } from "vitest";

import { createMemoryObjectStorageAdapter, createS3ObjectStorageAdapter } from "./object-storage";

describe("memory object storage adapter", () => {
  it("stores, reads, heads, and deletes immutable object bytes", async () => {
    const storage = createMemoryObjectStorageAdapter({
      kind: "local",
      maxObjectBytes: 64,
    });
    const body = new TextEncoder().encode("knowledge object");

    await storage.putObject({
      body,
      contentType: "text/plain",
      key: "tenant-1/documents/object.txt",
      metadata: { sha256: "a".repeat(64) },
    });

    await expect(storage.headObject("tenant-1/documents/object.txt")).resolves.toMatchObject({
      contentType: "text/plain",
      key: "tenant-1/documents/object.txt",
      metadata: { sha256: "a".repeat(64) },
      sizeBytes: body.byteLength,
    });
    await expect(storage.getObject("tenant-1/documents/object.txt")).resolves.toEqual(body);

    await storage.deleteObject("tenant-1/documents/object.txt");

    await expect(storage.headObject("tenant-1/documents/object.txt")).resolves.toBeNull();
    await expect(storage.getObject("tenant-1/documents/object.txt")).resolves.toBeNull();
  });

  it("lists objects with explicit limits and stable cursors", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "s3-compatible", maxObjectBytes: 64 });

    await storage.putObject({ body: new Uint8Array([1]), key: "tenant-1/a.txt" });
    await storage.putObject({ body: new Uint8Array([2]), key: "tenant-1/b.txt" });
    await storage.putObject({ body: new Uint8Array([3]), key: "tenant-1/c.txt" });
    await storage.putObject({ body: new Uint8Array([4]), key: "tenant-2/a.txt" });

    const firstPage = await storage.listObjects({ limit: 2, prefix: "tenant-1/" });
    const cursor = firstPage.nextCursor;

    if (!cursor) {
      throw new Error("Expected first page to include a next cursor");
    }

    const secondPage = await storage.listObjects({
      cursor,
      limit: 2,
      prefix: "tenant-1/",
    });

    expect(firstPage.objects.map((object) => object.key)).toEqual([
      "tenant-1/a.txt",
      "tenant-1/b.txt",
    ]);
    expect(firstPage.nextCursor).toBe("tenant-1/b.txt");
    expect(secondPage.objects.map((object) => object.key)).toEqual(["tenant-1/c.txt"]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("rejects objects larger than the configured memory cap", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "local", maxObjectBytes: 2 });

    await expect(
      storage.putObject({ body: new Uint8Array([1, 2, 3]), key: "tenant-1/too-large.bin" }),
    ).rejects.toThrow("Object tenant-1/too-large.bin exceeds maxObjectBytes=2");
  });

  it("can stream memory objects without forcing callers through getObject", async () => {
    const storage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 64,
    });

    await storage.putObject({
      body: new TextEncoder().encode("stream me"),
      key: "tenant-1/stream.txt",
    });

    const stream = await storage.getObjectStream("tenant-1/stream.txt");
    const missing = await storage.getObjectStream("tenant-1/missing.txt");

    expect(missing).toBeNull();
    await expect(readStream(stream)).resolves.toEqual(new TextEncoder().encode("stream me"));
  });

  it("copies memory metadata so callers cannot mutate retained object state", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "local", maxObjectBytes: 64 });
    const metadata = { sha256: "original" };

    const putMetadata = await storage.putObject({
      body: new Uint8Array([1]),
      key: "tenant-1/object.bin",
      metadata,
    });
    metadata.sha256 = "mutated";
    (putMetadata.metadata as Record<string, string>).sha256 = "returned-mutation";

    const firstHead = await storage.headObject("tenant-1/object.bin");
    expect(firstHead?.metadata).toEqual({ sha256: "original" });

    if (firstHead) {
      (firstHead.metadata as Record<string, string>).sha256 = "head-mutation";
    }

    await expect(storage.headObject("tenant-1/object.bin")).resolves.toMatchObject({
      metadata: { sha256: "original" },
    });
  });

  it("rejects memory writes that would exceed object count or total byte bounds", async () => {
    const countBounded = createMemoryObjectStorageAdapter({
      kind: "local",
      maxObjectBytes: 64,
      maxObjects: 1,
    });

    await countBounded.putObject({ body: new Uint8Array([1]), key: "tenant-1/a.bin" });
    await expect(
      countBounded.putObject({ body: new Uint8Array([1]), key: "tenant-1/b.bin" }),
    ).rejects.toThrow("Object storage maxObjects=1 exceeded");

    const byteBounded = createMemoryObjectStorageAdapter({
      kind: "local",
      maxObjectBytes: 64,
      maxTotalBytes: 2,
    });

    await byteBounded.putObject({ body: new Uint8Array([1, 2]), key: "tenant-1/a.bin" });
    await expect(
      byteBounded.putObject({ body: new Uint8Array([3]), key: "tenant-1/b.bin" }),
    ).rejects.toThrow("Object storage maxTotalBytes=2 exceeded");
  });

  it("rejects unbounded list requests", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "local", maxObjectBytes: 64 });

    await expect(storage.listObjects({ limit: 0, prefix: "tenant-1/" })).rejects.toThrow(
      "Object list limit must be at least 1",
    );
  });
});

describe("S3-compatible object storage adapter", () => {
  it("puts objects through the S3 API and returns object metadata", async () => {
    const client = new FakeS3Client();
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
      maxObjectBytes: 64,
    });
    const body = new Uint8Array([1, 2, 3]);

    const metadata = await storage.putObject({
      body,
      contentType: "application/octet-stream",
      key: "tenant-1/documents/object.bin",
      metadata: { sha256: "abc" },
    });

    expect(metadata).toEqual({
      contentType: "application/octet-stream",
      key: "tenant-1/documents/object.bin",
      metadata: { sha256: "abc" },
      sizeBytes: 3,
    });
    expect(client.commands).toEqual([
      {
        input: {
          Body: body,
          Bucket: "knowledge-bucket",
          ContentType: "application/octet-stream",
          Key: "tenant-1/documents/object.bin",
          Metadata: { sha256: "abc" },
        },
        name: "PutObjectCommand",
      },
    ]);
  });

  it("rejects oversized objects before sending an S3 command", async () => {
    const client = new FakeS3Client();
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
      maxObjectBytes: 2,
    });

    await expect(
      storage.putObject({
        body: new Uint8Array([1, 2, 3]),
        key: "tenant-1/too-large.bin",
      }),
    ).rejects.toThrow("Object tenant-1/too-large.bin exceeds maxObjectBytes=2");
    expect(client.commands).toEqual([]);
  });

  it("gets object bytes as copies so callers cannot mutate retained state", async () => {
    const storedBody = new Uint8Array([1, 2, 3]);
    const client = new FakeS3Client({
      GetObjectCommand: [{ Body: storedBody }],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    const first = await storage.getObject("tenant-1/documents/object.bin");

    expect(first).toEqual(new Uint8Array([1, 2, 3]));

    if (first) {
      first[0] = 9;
    }

    expect(storedBody).toEqual(new Uint8Array([1, 2, 3]));
    expect(client.commands[0]).toEqual({
      input: {
        Bucket: "knowledge-bucket",
        Key: "tenant-1/documents/object.bin",
      },
      name: "GetObjectCommand",
    });
  });

  it("reads S3 body variants without leaking mutable buffers", async () => {
    const client = new FakeS3Client({
      GetObjectCommand: [
        {
          Body: "plain text",
        },
        {
          Body: {
            async *[Symbol.asyncIterator]() {
              yield new Uint8Array([1]);
              yield "2";
            },
          },
        },
        {
          Body: {
            transformToByteArray: async () => new Uint8Array([3, 4]),
          },
        },
        {},
      ],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    await expect(storage.getObject("tenant-1/text.txt")).resolves.toEqual(
      new TextEncoder().encode("plain text"),
    );
    await expect(storage.getObject("tenant-1/stream.bin")).resolves.toEqual(
      new Uint8Array([1, 50]),
    );
    await expect(storage.getObject("tenant-1/blob.bin")).resolves.toEqual(new Uint8Array([3, 4]));
    await expect(storage.getObject("tenant-1/empty.bin")).resolves.toEqual(new Uint8Array());
  });

  it("can return an S3 object stream for streaming consumers", async () => {
    const client = new FakeS3Client({
      GetObjectCommand: [
        {
          Body: {
            async *[Symbol.asyncIterator]() {
              yield new Uint8Array([1, 2]);
              yield new Uint8Array([3]);
            },
          },
        },
      ],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
      maxObjectBytes: 64,
    });

    const stream = await storage.getObjectStream("tenant-1/stream.bin");

    await expect(readStream(stream)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects externally oversized S3 reads before retaining unbounded bytes", async () => {
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client({
        GetObjectCommand: [
          {
            Body: new Uint8Array([1]),
            ContentLength: 3,
          },
          {
            Body: {
              async *[Symbol.asyncIterator]() {
                yield new Uint8Array([1, 2]);
                yield new Uint8Array([3]);
              },
            },
          },
        ],
      }),
      kind: "s3-compatible",
      maxObjectBytes: 2,
    });

    await expect(storage.getObject("tenant-1/too-large-by-head.bin")).rejects.toThrow(
      "Object tenant-1/too-large-by-head.bin exceeds maxObjectBytes=2",
    );
    await expect(storage.getObject("tenant-1/too-large-stream.bin")).rejects.toThrow(
      "Object tenant-1/too-large-stream.bin exceeds maxObjectBytes=2",
    );
  });

  it("returns null when getObject or headObject receives a missing-key S3 error", async () => {
    const client = new FakeS3Client({
      GetObjectCommand: [s3Error("NoSuchKey", 404)],
      HeadObjectCommand: [s3Error("NotFound", 404)],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "r2",
    });

    await expect(storage.getObject("tenant-1/missing.txt")).resolves.toBeNull();
    await expect(storage.headObject("tenant-1/missing.txt")).resolves.toBeNull();
  });

  it("rethrows non-missing S3 read errors and unsupported bodies", async () => {
    const client = new FakeS3Client({
      GetObjectCommand: [{ Body: 123 }, new Error("s3 unavailable")],
      HeadObjectCommand: [new Error("s3 unavailable")],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    await expect(storage.getObject("tenant-1/bad-body.bin")).rejects.toThrow(
      "Unsupported S3 object body type",
    );
    await expect(storage.getObject("tenant-1/error.bin")).rejects.toThrow("s3 unavailable");
    await expect(storage.headObject("tenant-1/error.bin")).rejects.toThrow("s3 unavailable");
  });

  it("heads and deletes objects through S3", async () => {
    const client = new FakeS3Client({
      HeadObjectCommand: [
        {
          ContentLength: 42,
          ContentType: "text/plain",
          Metadata: { sha256: "abc" },
        },
      ],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    await expect(storage.headObject("tenant-1/documents/object.txt")).resolves.toEqual({
      contentType: "text/plain",
      key: "tenant-1/documents/object.txt",
      metadata: { sha256: "abc" },
      sizeBytes: 42,
    });

    await storage.deleteObject("tenant-1/documents/object.txt");

    expect(client.commands.at(-1)).toEqual({
      input: {
        Bucket: "knowledge-bucket",
        Key: "tenant-1/documents/object.txt",
      },
      name: "DeleteObjectCommand",
    });
  });

  it("maps sparse S3 head and list responses to safe object metadata defaults", async () => {
    const client = new FakeS3Client({
      HeadObjectCommand: [{ Metadata: { sha256: "abc", ignored: 123 } }],
      ListObjectsV2Command: [{ Contents: [{ Size: 7 }, { Key: "tenant-1/a.txt" }] }, {}],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    await expect(storage.headObject("tenant-1/object.txt")).resolves.toEqual({
      key: "tenant-1/object.txt",
      metadata: { sha256: "abc" },
      sizeBytes: 0,
    });
    await expect(storage.listObjects({ limit: 10, prefix: "tenant-1/" })).resolves.toEqual({
      objects: [{ key: "tenant-1/a.txt", metadata: {}, sizeBytes: 0 }],
    });
    await expect(storage.listObjects({ limit: 10, prefix: "tenant-2/" })).resolves.toEqual({
      objects: [],
    });
  });

  it("lists objects with explicit limits and S3 continuation cursors", async () => {
    const client = new FakeS3Client({
      ListObjectsV2Command: [
        {
          Contents: [
            { Key: "tenant-1/a.txt", Size: 1 },
            { Key: "tenant-1/b.txt", Size: 2 },
          ],
          NextContinuationToken: "token-2",
        },
      ],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    await expect(
      storage.listObjects({
        cursor: "token-1",
        limit: 2,
        prefix: "tenant-1/",
      }),
    ).resolves.toEqual({
      nextCursor: "token-2",
      objects: [
        { key: "tenant-1/a.txt", metadata: {}, sizeBytes: 1 },
        { key: "tenant-1/b.txt", metadata: {}, sizeBytes: 2 },
      ],
    });
    expect(client.commands[0]).toEqual({
      input: {
        Bucket: "knowledge-bucket",
        ContinuationToken: "token-1",
        MaxKeys: 2,
        Prefix: "tenant-1/",
      },
      name: "ListObjectsV2Command",
    });
  });

  it("rejects unbounded S3 list requests", async () => {
    const client = new FakeS3Client();
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    await expect(storage.listObjects({ limit: 0, prefix: "tenant-1/" })).rejects.toThrow(
      "Object list limit must be at least 1",
    );
    expect(client.commands).toEqual([]);
  });

  it("reports S3 bucket health from HeadBucket", async () => {
    const healthy = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client({ HeadBucketCommand: [{}] }),
      kind: "s3-compatible",
    });
    const unhealthy = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client({ HeadBucketCommand: [new Error("offline")] }),
      kind: "s3-compatible",
    });

    await expect(healthy.health()).resolves.toBe(true);
    await expect(unhealthy.health()).resolves.toBe(false);
  });
});

type FakeS3Response = Error | unknown;

class FakeS3Client {
  readonly commands: { input: unknown; name: string }[] = [];
  private readonly responses: Record<string, FakeS3Response[]>;

  constructor(responses: Record<string, FakeS3Response[]> = {}) {
    this.responses = responses;
  }

  async send(command: {
    readonly input: unknown;
    readonly constructor: { readonly name: string };
  }) {
    const name = command.constructor.name;
    this.commands.push({ input: command.input, name });

    const response = this.responses[name]?.shift() ?? {};

    if (response instanceof Error) {
      throw response;
    }

    return response;
  }
}

function s3Error(name: string, statusCode: number): Error {
  const error = new Error(name) as Error & {
    readonly $metadata: { readonly httpStatusCode: number };
    readonly name: string;
  };

  Object.defineProperty(error, "name", { value: name });
  Object.defineProperty(error, "$metadata", {
    value: { httpStatusCode: statusCode },
  });

  return error;
}

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!stream) {
    throw new Error("Expected stream");
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const result = await reader.read();

    if (result.done) {
      break;
    }

    chunks.push(result.value);
    totalBytes += result.value.byteLength;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}
