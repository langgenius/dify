import { describe, expect, it } from "vitest";

import { createMemoryObjectStorageAdapter } from "./memory-object-storage";

describe("memory object storage adapter", () => {
  it("advertises that test storage cannot issue direct-upload URLs", () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 64 });
    expect(storage.directUpload).toBeUndefined();
  });

  it("stores, streams, heads, lists, and deletes copied object state", async () => {
    const storage = createMemoryObjectStorageAdapter({ kind: "memory", maxObjectBytes: 64 });
    const body = new TextEncoder().encode("knowledge object");
    const metadata = { sha256: "original" };

    const stored = await storage.putObject({
      body,
      checksumSha256Base64: "checksum",
      contentType: "text/plain",
      key: "tenant-1/b.txt",
      metadata,
    });
    metadata.sha256 = "mutated";
    (stored.metadata as Record<string, string>).sha256 = "returned-mutation";
    await storage.putObject({ body: new Uint8Array([1]), key: "tenant-1/a.txt" });

    await expect(storage.getObject("tenant-1/b.txt")).resolves.toEqual(body);
    await expect(readStream(await storage.getObjectStream("tenant-1/b.txt"))).resolves.toEqual(
      body,
    );
    await expect(storage.getObjectStream("tenant-1/missing.txt")).resolves.toBeNull();
    await expect(storage.headObject("tenant-1/b.txt")).resolves.toEqual({
      checksumSha256Base64: "checksum",
      contentType: "text/plain",
      key: "tenant-1/b.txt",
      metadata: { sha256: "original" },
      sizeBytes: body.byteLength,
    });
    await expect(storage.listObjects({ limit: 1, prefix: "tenant-1/" })).resolves.toMatchObject({
      nextCursor: "tenant-1/a.txt",
      objects: [{ key: "tenant-1/a.txt" }],
    });

    await storage.deleteObject("tenant-1/b.txt");
    await expect(storage.getObject("tenant-1/b.txt")).resolves.toBeNull();
  });

  it("enforces object, count, total-byte, and list bounds", async () => {
    const storage = createMemoryObjectStorageAdapter({
      kind: "local",
      maxObjectBytes: 2,
      maxObjects: 1,
      maxTotalBytes: 2,
    });

    await expect(
      storage.putObject({ body: new Uint8Array([1, 2, 3]), key: "too-large" }),
    ).rejects.toThrow("Object too-large exceeds maxObjectBytes=2");
    await storage.putObject({ body: new Uint8Array([1, 2]), key: "first" });
    await expect(storage.putObject({ body: new Uint8Array([1]), key: "second" })).rejects.toThrow(
      "Object storage maxObjects=1 exceeded",
    );
    await expect(storage.listObjects({ limit: 0, prefix: "" })).rejects.toThrow(
      "Object list limit must be at least 1",
    );
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
});

async function readStream(stream: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!stream) throw new Error("Expected stream");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
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
