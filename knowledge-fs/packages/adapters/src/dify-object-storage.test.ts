import { describe, expect, it, vi } from "vitest";

import { createDifyObjectStorageAdapter } from "./dify-object-storage";

const metadata = {
  checksumSha256Base64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  contentType: "text/plain",
  key: "tenant-1/spaces/space-1/file.txt",
  metadata: { tenantId: "tenant-1" },
  sizeBytes: 4,
};

describe("Dify object storage adapter", () => {
  it("uses the authenticated Dify inner API for object operations", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json({ nextCursor: metadata.key, objects: [metadata] }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4])))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const adapter = createDifyObjectStorageAdapter({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch,
    });

    await expect(
      adapter.putObject({
        body: new Uint8Array([1, 2, 3, 4]),
        contentType: "text/plain",
        key: metadata.key,
        metadata: { tenantId: "tenant-1" },
      }),
    ).resolves.toEqual(metadata);
    await expect(adapter.headObject(metadata.key)).resolves.toEqual(metadata);
    await expect(
      adapter.listObjects({ limit: 1, prefix: "tenant-1/spaces/space-1/" }),
    ).resolves.toEqual({ nextCursor: metadata.key, objects: [metadata] });
    await expect(adapter.getObject(metadata.key)).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
    await expect(adapter.deleteObject(metadata.key)).resolves.toBeUndefined();
    await expect(adapter.health()).resolves.toBe(true);

    expect(adapter.kind).toBe("dify");
    expect(adapter.directUpload).toBeUndefined();
    for (const call of fetch.mock.calls) {
      expect(new Headers(call[1]?.headers).get("X-Inner-Api-Key")).toBe("inner-key");
    }
    expect(fetch.mock.calls[0]?.[0].toString()).toContain(
      "/inner/api/knowledge-fs/storage/object?key=tenant-1%2Fspaces%2Fspace-1%2Ffile.txt",
    );
  });

  it("maps missing objects to null and rejects oversized response bodies", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Length": "3" },
        }),
      );
    const adapter = createDifyObjectStorageAdapter({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch,
      maxObjectBytes: 2,
    });

    await expect(adapter.getObject("tenant-1/missing")).resolves.toBeNull();
    await expect(adapter.getObject("tenant-1/large")).rejects.toThrow("exceeds maxObjectBytes=2");
  });

  it("returns false when Dify storage health is unavailable", async () => {
    const adapter = createDifyObjectStorageAdapter({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline")),
    });

    await expect(adapter.health()).resolves.toBe(false);
  });
});
