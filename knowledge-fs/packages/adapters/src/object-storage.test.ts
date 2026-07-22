import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createMemoryObjectStorageAdapter, createS3ObjectStorageAdapter } from "./object-storage";

describe("memory object storage adapter", () => {
  it("advertises that local memory storage cannot issue direct-upload URLs", () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 64 });

    expect(storage.directUpload).toBeUndefined();
  });

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

  it("rejects invalid capacity bounds", () => {
    expect(() => createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 0 })).toThrow(
      "Object storage maxObjectBytes must be at least 1",
    );
    expect(() =>
      createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 1, maxObjects: 0 }),
    ).toThrow("Object storage maxObjects must be at least 1");
    expect(() =>
      createMemoryObjectStorageAdapter({
        kind: "memory",
        maxObjectBytes: 1,
        maxTotalBytes: 0,
      }),
    ).toThrow("Object storage maxTotalBytes must be at least 1");
  });

  it("accounts for replacement bytes and preserves optional checksums", async () => {
    const storage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 4,
      maxObjects: 1,
      maxTotalBytes: 2,
    });

    await storage.putObject({ body: new Uint8Array([1, 2]), key: "object" });
    await expect(
      storage.putObject({
        body: new Uint8Array([3]),
        checksumSha256Base64: "checksum",
        key: "object",
      }),
    ).resolves.toEqual({
      checksumSha256Base64: "checksum",
      key: "object",
      metadata: {},
      sizeBytes: 1,
    });
  });
});

describe("S3-compatible object storage adapter", () => {
  it("presigns bounded single-part uploads without sending object bytes through the adapter", async () => {
    const client = new FakeS3Client();
    const presigner = new FakeS3Presigner("https://objects.example/upload?signature=redacted");
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
      maxDirectUploadBytes: 1_024,
      now: () => 2_000_000,
      presign: presigner.presign,
    });

    const upload = await storage.directUpload?.presignPutObject({
      checksumSha256Base64: "checksum-base64",
      contentLength: 512,
      contentType: "application/pdf",
      expiresInSeconds: 60,
      key: "namespaces/ns-1/spaces/space-1/uploads/session-1/source.pdf",
      metadata: { upload_session_id: "session-1" },
    });

    expect(upload).toEqual({
      expiresAt: 2_060_000,
      headers: {
        "content-type": "application/pdf",
        "x-amz-checksum-sha256": "checksum-base64",
      },
      method: "PUT",
      url: "https://objects.example/upload?signature=redacted",
    });
    expect(client.commands).toEqual([]);
    expect(presigner.requests).toEqual([
      {
        expiresInSeconds: 60,
        input: {
          Bucket: "knowledge-bucket",
          ChecksumSHA256: "checksum-base64",
          ContentLength: 512,
          ContentType: "application/pdf",
          Key: "namespaces/ns-1/spaces/space-1/uploads/session-1/source.pdf",
          Metadata: { upload_session_id: "session-1" },
        },
        name: "PutObjectCommand",
      },
    ]);
  });

  it("creates, presigns, completes, and aborts multipart uploads with fixed keys", async () => {
    const client = new FakeS3Client({
      AbortMultipartUploadCommand: [{}],
      CompleteMultipartUploadCommand: [{}],
      CreateMultipartUploadCommand: [{ UploadId: "multipart-1" }],
    });
    const presigner = new FakeS3Presigner("https://objects.example/part?signature=redacted");
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "r2",
      now: () => 3_000_000,
      presign: presigner.presign,
    });
    const directUpload = storage.directUpload;

    if (!directUpload) throw new Error("Expected S3 direct upload support");
    const created = await directUpload.createMultipartUpload({
      contentType: "application/octet-stream",
      key: "namespaces/ns-1/spaces/space-1/uploads/session-2/archive.bin",
      metadata: { upload_session_id: "session-2" },
    });
    const part = await directUpload.presignMultipartPart({
      checksumSha256Base64: "part-checksum",
      contentLength: 8 * 1024 * 1024,
      expiresInSeconds: 45,
      key: created.key,
      partNumber: 7,
      uploadId: created.uploadId,
    });
    await directUpload.completeMultipartUpload({
      key: created.key,
      parts: [{ checksumSha256Base64: "part-checksum", etag: '"etag-7"', partNumber: 7 }],
      uploadId: created.uploadId,
    });
    await directUpload.abortMultipartUpload({
      key: created.key,
      uploadId: created.uploadId,
    });

    expect(created).toEqual({ key: created.key, uploadId: "multipart-1" });
    expect(part).toEqual({
      expiresAt: 3_045_000,
      headers: { "x-amz-checksum-sha256": "part-checksum" },
      method: "PUT",
      url: "https://objects.example/part?signature=redacted",
    });
    expect(presigner.requests).toEqual([
      {
        expiresInSeconds: 45,
        input: {
          Bucket: "knowledge-bucket",
          ChecksumSHA256: "part-checksum",
          ContentLength: 8 * 1024 * 1024,
          Key: created.key,
          PartNumber: 7,
          UploadId: "multipart-1",
        },
        name: "UploadPartCommand",
      },
    ]);
    expect(client.commands).toEqual([
      {
        input: {
          Bucket: "knowledge-bucket",
          ChecksumAlgorithm: "SHA256",
          ContentType: "application/octet-stream",
          Key: created.key,
          Metadata: { upload_session_id: "session-2" },
        },
        name: "CreateMultipartUploadCommand",
      },
      {
        input: {
          Bucket: "knowledge-bucket",
          Key: created.key,
          MultipartUpload: {
            Parts: [
              {
                ChecksumSHA256: "part-checksum",
                ETag: '"etag-7"',
                PartNumber: 7,
              },
            ],
          },
          UploadId: "multipart-1",
        },
        name: "CompleteMultipartUploadCommand",
      },
      {
        input: { Bucket: "knowledge-bucket", Key: created.key, UploadId: "multipart-1" },
        name: "AbortMultipartUploadCommand",
      },
    ]);
  });

  it("streams the completed object to verify its full SHA-256 without buffering multipart data", async () => {
    const body = new TextEncoder().encode("multipart-body");
    const checksumSha256Base64 = createHash("sha256").update(body).digest("base64");
    const streamedBody = async function* () {
      yield body.slice(0, 5);
      yield body.slice(5);
    };
    const client = new FakeS3Client({
      GetObjectCommand: [
        {
          Body: streamedBody(),
          ContentLength: body.byteLength,
        },
        {
          Body: streamedBody(),
          ContentLength: body.byteLength,
        },
      ],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });
    const directUpload = storage.directUpload;

    if (!directUpload) throw new Error("Expected S3 direct upload support");
    await expect(
      directUpload.verifyObjectSha256({
        checksumSha256Base64,
        expectedSizeBytes: body.byteLength,
        key: "namespaces/ns-1/spaces/space-1/uploads/session-2/source",
      }),
    ).resolves.toBe(true);
    await expect(
      directUpload.verifyObjectSha256({
        checksumSha256Base64: "wrong-checksum",
        expectedSizeBytes: body.byteLength,
        key: "namespaces/ns-1/spaces/space-1/uploads/session-2/source",
      }),
    ).resolves.toBe(false);
    expect(client.commands).toEqual([
      {
        input: {
          Bucket: "knowledge-bucket",
          Key: "namespaces/ns-1/spaces/space-1/uploads/session-2/source",
        },
        name: "GetObjectCommand",
      },
      {
        input: {
          Bucket: "knowledge-bucket",
          Key: "namespaces/ns-1/spaces/space-1/uploads/session-2/source",
        },
        name: "GetObjectCommand",
      },
    ]);
  });

  it("best-effort cancels and releases verification bodies on metadata size mismatch", async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled += 1;
        throw new Error("verification cleanup failed");
      },
      start() {},
    });
    const client = new FakeS3Client({
      GetObjectCommand: [{ Body: body, ContentLength: 9 }],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    await expect(
      storage.directUpload?.verifyObjectSha256({
        checksumSha256Base64: "unused-checksum",
        expectedSizeBytes: 10,
        key: "namespaces/ns-1/spaces/space-1/uploads/session-3/source",
      }),
    ).resolves.toBe(false);
    expect(cancelled).toBe(1);
    expect(body.locked).toBe(false);
  });

  it("does not mask a streamed size mismatch when verification cleanup fails", async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled += 1;
        throw new Error("verification cleanup failed");
      },
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
    });
    const client = new FakeS3Client({ GetObjectCommand: [{ Body: body }] });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    await expect(
      storage.directUpload?.verifyObjectSha256({
        checksumSha256Base64: "unused-checksum",
        expectedSizeBytes: 1,
        key: "namespaces/ns-1/spaces/space-1/uploads/session-4/source",
      }),
    ).resolves.toBe(false);
    expect(cancelled).toBe(1);
    expect(body.locked).toBe(false);
  });

  it("rejects unsafe direct-upload bounds before signing or sending a command", async () => {
    const client = new FakeS3Client({ CreateMultipartUploadCommand: [{}] });
    const presigner = new FakeS3Presigner("https://objects.example/upload");
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
      maxDirectUploadBytes: 10,
      presign: presigner.presign,
    });
    const directUpload = storage.directUpload;

    if (!directUpload) throw new Error("Expected S3 direct upload support");
    await expect(
      directUpload.presignPutObject({
        contentLength: 11,
        expiresInSeconds: 60,
        key: "fixed-key",
      }),
    ).rejects.toThrow("exceeds maxDirectUploadBytes=10");
    await expect(
      directUpload.presignMultipartPart({
        contentLength: 1,
        expiresInSeconds: 0,
        key: "fixed-key",
        partNumber: 0,
        uploadId: "upload-1",
      }),
    ).rejects.toThrow("expiresInSeconds must be between 1 and 900");
    await expect(directUpload.createMultipartUpload({ key: "fixed-key" })).rejects.toThrow(
      "did not return an upload id",
    );
    expect(presigner.requests).toEqual([]);
  });

  it("installs an abort-only multipart lifecycle rule without replacing bucket retention", async () => {
    const retainedRule = {
      Expiration: { Days: 365 },
      Filter: { Prefix: "archive/" },
      ID: "archive-retention",
      Status: "Enabled",
    };
    const client = new FakeS3Client({
      GetBucketLifecycleConfigurationCommand: [{ Rules: [retainedRule] }],
      PutBucketLifecycleConfigurationCommand: [{}],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });
    const directUpload = storage.directUpload;

    if (!directUpload) throw new Error("Expected S3 direct upload support");
    await directUpload.ensureIncompleteMultipartUploadLifecycle({ daysAfterInitiation: 2 });

    expect(client.commands).toEqual([
      {
        input: { Bucket: "knowledge-bucket" },
        name: "GetBucketLifecycleConfigurationCommand",
      },
      {
        input: {
          Bucket: "knowledge-bucket",
          LifecycleConfiguration: {
            Rules: [
              retainedRule,
              {
                AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 },
                Filter: { Prefix: "" },
                ID: "knowledge-fs-incomplete-multipart",
                Status: "Enabled",
              },
            ],
          },
        },
        name: "PutBucketLifecycleConfigurationCommand",
      },
    ]);
  });

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

  it("closes an async-iterable S3 body exactly once after a normal stream read", async () => {
    let nextCalls = 0;
    let returnCalls = 0;
    const iterator: AsyncIterator<unknown> = {
      next: async () => {
        nextCalls += 1;
        return nextCalls === 1
          ? { done: false, value: new Uint8Array([1, 2]) }
          : { done: true, value: undefined };
      },
      return: async () => {
        returnCalls += 1;
        return { done: true, value: undefined };
      },
    };
    const body: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => iterator,
    };
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client({ GetObjectCommand: [{ Body: body }] }),
      kind: "s3-compatible",
      maxObjectBytes: 64,
    });

    await expect(readStream(await storage.getObjectStream("tenant-1/stream.bin"))).resolves.toEqual(
      new Uint8Array([1, 2]),
    );
    expect(returnCalls).toBe(1);
  });

  it("closes an async-iterable S3 body without masking a stream size error", async () => {
    let returnCalls = 0;
    const body: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: new Uint8Array([1, 2, 3]) }),
        return: async () => {
          returnCalls += 1;
          throw new Error("iterator cleanup failed");
        },
      }),
    };
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client({ GetObjectCommand: [{ Body: body }] }),
      kind: "s3-compatible",
      maxObjectBytes: 2,
    });

    await expect(
      readStream(await storage.getObjectStream("tenant-1/too-large-stream.bin")),
    ).rejects.toThrow("Object tenant-1/too-large-stream.bin exceeds maxObjectBytes=2");
    expect(returnCalls).toBe(1);
  });

  it("releases a readable S3 body reader after a normal stream read", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.close();
      },
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client({ GetObjectCommand: [{ Body: body }] }),
      kind: "s3-compatible",
      maxObjectBytes: 64,
    });

    await expect(readStream(await storage.getObjectStream("tenant-1/stream.bin"))).resolves.toEqual(
      new Uint8Array([1, 2]),
    );
    expect(body.locked).toBe(false);
  });

  it("cancels and releases a readable S3 body without masking a stream size error", async () => {
    const cancelReasons: unknown[] = [];
    const body = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelReasons.push(reason);
        throw new Error("reader cleanup failed");
      },
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client({ GetObjectCommand: [{ Body: body }] }),
      kind: "s3-compatible",
      maxObjectBytes: 2,
    });

    await expect(
      readStream(await storage.getObjectStream("tenant-1/too-large-stream.bin")),
    ).rejects.toThrow("Object tenant-1/too-large-stream.bin exceeds maxObjectBytes=2");
    expect(cancelReasons).toHaveLength(1);
    expect(cancelReasons[0]).toMatchObject({
      message: "Object tenant-1/too-large-stream.bin exceeds maxObjectBytes=2",
    });
    expect(body.locked).toBe(false);
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

  it("best-effort cancels an oversized readable body without masking metadata failure", async () => {
    const cancelReasons: unknown[] = [];
    const body = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelReasons.push(reason);
        throw new Error("readable cleanup failed");
      },
      start() {},
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client({
        GetObjectCommand: [{ Body: body, ContentLength: 3 }],
      }),
      kind: "s3-compatible",
      maxObjectBytes: 2,
    });

    await expect(storage.getObject("tenant-1/too-large-readable.bin")).rejects.toThrow(
      "Object tenant-1/too-large-readable.bin exceeds maxObjectBytes=2",
    );
    expect(cancelReasons).toHaveLength(1);
    expect(cancelReasons[0]).toMatchObject({
      message: "Object tenant-1/too-large-readable.bin exceeds maxObjectBytes=2",
    });
  });

  it("best-effort returns an oversized async body without reading or masking metadata failure", async () => {
    let iteratorCalls = 0;
    let nextCalls = 0;
    let returnCalls = 0;
    const body: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]() {
        iteratorCalls += 1;
        return {
          next: async () => {
            nextCalls += 1;
            return { done: false, value: new Uint8Array([1]) };
          },
          return: async () => {
            returnCalls += 1;
            throw new Error("iterator cleanup failed");
          },
        };
      },
    };
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client({
        GetObjectCommand: [{ Body: body, ContentLength: 3 }],
      }),
      kind: "s3-compatible",
      maxObjectBytes: 2,
    });

    await expect(storage.getObjectStream("tenant-1/too-large-iterable.bin")).rejects.toThrow(
      "Object tenant-1/too-large-iterable.bin exceeds maxObjectBytes=2",
    );
    expect(iteratorCalls).toBe(1);
    expect(nextCalls).toBe(0);
    expect(returnCalls).toBe(1);
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
          ChecksumSHA256: "checksum-base64",
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
      checksumSha256Base64: "checksum-base64",
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
    expect(client.commands[0]).toEqual({
      input: {
        Bucket: "knowledge-bucket",
        ChecksumMode: "ENABLED",
        Key: "tenant-1/documents/object.txt",
      },
      name: "HeadObjectCommand",
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

  it("puts sparse S3 objects without optional content fields", async () => {
    const client = new FakeS3Client();
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    await expect(
      storage.putObject({
        body: new Uint8Array([1]),
        checksumSha256Base64: "checksum",
        key: "tenant-1/sparse.bin",
      }),
    ).resolves.toEqual({
      checksumSha256Base64: "checksum",
      key: "tenant-1/sparse.bin",
      metadata: {},
      sizeBytes: 1,
    });
    expect(client.commands).toEqual([
      {
        input: {
          Body: new Uint8Array([1]),
          Bucket: "knowledge-bucket",
          ChecksumSHA256: "checksum",
          Key: "tenant-1/sparse.bin",
          Metadata: {},
        },
        name: "PutObjectCommand",
      },
    ]);
  });

  it("streams empty, byte, and string S3 bodies and handles missing stream objects", async () => {
    const client = new FakeS3Client({
      GetObjectCommand: [
        {},
        { Body: new Uint8Array([1, 2]) },
        { Body: "text" },
        { Body: 123 },
        s3Error("OtherS3Error", 404),
      ],
    });
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
    });

    await expect(readStream(await storage.getObjectStream("empty"))).resolves.toEqual(
      new Uint8Array(),
    );
    await expect(readStream(await storage.getObjectStream("bytes"))).resolves.toEqual(
      new Uint8Array([1, 2]),
    );
    await expect(readStream(await storage.getObjectStream("string"))).resolves.toEqual(
      new TextEncoder().encode("text"),
    );
    await expect(storage.getObjectStream("unsupported")).rejects.toThrow(
      "Unsupported S3 object body type",
    );
    await expect(storage.getObjectStream("missing")).resolves.toBeNull();
  });

  it("omits optional fields from sparse direct-upload commands", async () => {
    const client = new FakeS3Client({ CompleteMultipartUploadCommand: [{}] });
    const presigner = new FakeS3Presigner("https://objects.example/upload");
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client,
      kind: "s3-compatible",
      presign: presigner.presign,
    });
    const directUpload = storage.directUpload;

    if (!directUpload) throw new Error("Expected S3 direct upload support");
    await directUpload.completeMultipartUpload({
      key: "fixed-key",
      parts: [{ etag: "etag-1", partNumber: 1 }],
      uploadId: "upload-1",
    });
    await directUpload.presignMultipartPart({
      contentLength: 1,
      expiresInSeconds: 60,
      key: "fixed-key",
      partNumber: 1,
      uploadId: "upload-1",
    });
    await directUpload.presignPutObject({
      contentLength: 1,
      expiresInSeconds: 60,
      key: "fixed-key",
    });

    expect(presigner.requests).toHaveLength(2);
    expect(client.commands[0]).toMatchObject({
      input: {
        MultipartUpload: { Parts: [{ ETag: "etag-1", PartNumber: 1 }] },
      },
      name: "CompleteMultipartUploadCommand",
    });
  });

  it("rejects invalid direct-upload identities, parts, lifecycle bounds, and metadata", async () => {
    expect(() =>
      createS3ObjectStorageAdapter({
        bucket: " ",
        client: new FakeS3Client(),
        kind: "s3-compatible",
      }),
    ).toThrow("Object storage direct upload bucket is required");
    expect(() =>
      createS3ObjectStorageAdapter({
        bucket: "knowledge-bucket",
        client: new FakeS3Client(),
        kind: "s3-compatible",
        maxDirectUploadBytes: 0,
      }),
    ).toThrow("maxDirectUploadBytes must be a positive safe integer");

    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client(),
      kind: "s3-compatible",
      presign: new FakeS3Presigner("https://objects.example/upload").presign,
    });
    const directUpload = storage.directUpload;

    if (!directUpload) throw new Error("Expected S3 direct upload support");
    await expect(
      directUpload.ensureIncompleteMultipartUploadLifecycle({ daysAfterInitiation: 0 }),
    ).rejects.toThrow("daysAfterInitiation must be between 1 and 365");
    await expect(
      directUpload.presignMultipartPart({
        contentLength: 1,
        expiresInSeconds: 60,
        key: "fixed-key",
        partNumber: 0,
        uploadId: "upload-1",
      }),
    ).rejects.toThrow("partNumber must be between 1 and 10000");
    await expect(
      directUpload.completeMultipartUpload({ key: "fixed-key", parts: [], uploadId: "upload-1" }),
    ).rejects.toThrow("requires 1-10000 parts");
    await expect(
      directUpload.completeMultipartUpload({
        key: "fixed-key",
        parts: [
          { etag: "etag-1", partNumber: 1 },
          { etag: "etag-2", partNumber: 1 },
        ],
        uploadId: "upload-1",
      }),
    ).rejects.toThrow("parts must be strictly increasing");
    await expect(directUpload.createMultipartUpload({ key: "invalid\0key" })).rejects.toThrow(
      "direct upload key is invalid",
    );
    await expect(
      directUpload.presignPutObject({
        contentLength: 1,
        expiresInSeconds: 60,
        key: "fixed-key",
        metadata: { "invalid key": "value" },
      }),
    ).rejects.toThrow("direct upload metadata is invalid");
  });

  it("rejects invalid clocks and presigner URLs", async () => {
    const input = { contentLength: 1, expiresInSeconds: 60, key: "fixed-key" };
    const invalidClock = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client(),
      kind: "s3-compatible",
      now: () => -1,
      presign: new FakeS3Presigner("https://objects.example/upload").presign,
    });
    const malformedUrl = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client(),
      kind: "s3-compatible",
      presign: new FakeS3Presigner("not-a-url").presign,
    });
    const unsafeUrl = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: new FakeS3Client(),
      kind: "s3-compatible",
      presign: new FakeS3Presigner("ftp://user:password@objects.example/upload").presign,
    });

    await expect(invalidClock.directUpload?.presignPutObject(input)).rejects.toThrow(
      "clock must return a non-negative integer",
    );
    await expect(malformedUrl.directUpload?.presignPutObject(input)).rejects.toThrow(
      "presigner returned an invalid URL",
    );
    await expect(unsafeUrl.directUpload?.presignPutObject(input)).rejects.toThrow(
      "presigner returned an invalid URL",
    );
  });

  it("ignores missing multipart aborts and rethrows other abort failures", async () => {
    const noSuchUpload = new Error("missing");
    Object.defineProperty(noSuchUpload, "name", { value: "NoSuchUpload" });
    const failures: unknown[] = [
      noSuchUpload,
      s3Error("OtherS3Error", 404),
      {},
      new Error("abort failed"),
    ];
    const storage = createS3ObjectStorageAdapter({
      bucket: "knowledge-bucket",
      client: {
        async send() {
          throw failures.shift();
        },
      },
      kind: "s3-compatible",
    });
    const directUpload = storage.directUpload;
    const input = { key: "fixed-key", uploadId: "upload-1" };

    if (!directUpload) throw new Error("Expected S3 direct upload support");
    await expect(directUpload.abortMultipartUpload(input)).resolves.toBeUndefined();
    await expect(directUpload.abortMultipartUpload(input)).resolves.toBeUndefined();
    await expect(directUpload.abortMultipartUpload(input)).rejects.toEqual({});
    await expect(directUpload.abortMultipartUpload(input)).rejects.toThrow("abort failed");
  });

  it("recovers from missing lifecycle configuration and replaces its own rule", async () => {
    const missing = new Error("missing lifecycle");
    Object.defineProperty(missing, "name", { value: "NoSuchLifecycleConfiguration" });
    const missingClient = new FakeS3Client({
      GetBucketLifecycleConfigurationCommand: [missing],
      PutBucketLifecycleConfigurationCommand: [{}],
    });
    const replacementClient = new FakeS3Client({
      GetBucketLifecycleConfigurationCommand: [
        {
          Rules: [
            null,
            {
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
              ID: "knowledge-fs-incomplete-multipart",
              Status: "Enabled",
            },
          ],
        },
      ],
      PutBucketLifecycleConfigurationCommand: [{}],
    });
    const malformedClient = new FakeS3Client({
      GetBucketLifecycleConfigurationCommand: [{ Rules: "invalid" }],
      PutBucketLifecycleConfigurationCommand: [{}],
    });

    for (const client of [missingClient, replacementClient, malformedClient]) {
      const storage = createS3ObjectStorageAdapter({
        bucket: "knowledge-bucket",
        client,
        kind: "s3-compatible",
      });
      await storage.directUpload?.ensureIncompleteMultipartUploadLifecycle({
        daysAfterInitiation: 3,
      });
    }

    expect(replacementClient.commands[1]).toMatchObject({
      input: {
        LifecycleConfiguration: {
          Rules: [
            {
              AbortIncompleteMultipartUpload: { DaysAfterInitiation: 3 },
              ID: "knowledge-fs-incomplete-multipart",
            },
          ],
        },
      },
    });
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

class FakeS3Presigner {
  readonly requests: { expiresInSeconds: number; input: unknown; name: string }[] = [];
  readonly presign: (input: {
    readonly command: { readonly input: unknown; readonly constructor: { readonly name: string } };
    readonly expiresInSeconds: number;
  }) => Promise<string>;

  constructor(url: string) {
    this.presign = async ({ command, expiresInSeconds }) => {
      this.requests.push({
        expiresInSeconds,
        input: command.input,
        name: command.constructor.name,
      });
      return url;
    };
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
