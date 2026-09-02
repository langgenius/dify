import { describe, expect, it, vi } from "vitest";

import {
  DifyObjectStorageRequestError,
  createDifyObjectStorageAdapter,
} from "./dify-object-storage";

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

  it("caps object-list pages to the Dify inner API contract", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ objects: [] }));
    const adapter = createDifyObjectStorageAdapter({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch,
    });

    await adapter.listObjects({ limit: 1_000, prefix: "tenant-1/spaces/space-1/" });

    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("returns false when Dify storage health is unavailable", async () => {
    const adapter = createDifyObjectStorageAdapter({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline")),
    });

    await expect(adapter.health()).resolves.toBe(false);
  });

  it("classifies transient transport and HTTP failures as retryable", async () => {
    const offline = createDifyObjectStorageAdapter({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline")),
    });
    const offlineRequest = offline.headObject("tenant-1/offline");
    await expect(offlineRequest).rejects.toBeInstanceOf(DifyObjectStorageRequestError);
    await expect(offlineRequest).rejects.toMatchObject({ retryable: true });

    const statusFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }));
    const statuses = createDifyObjectStorageAdapter({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch: statusFetch,
    });
    await expect(statuses.deleteObject("tenant-1/transient")).rejects.toMatchObject({
      retryable: true,
      status: 503,
    });
    await expect(statuses.deleteObject("tenant-1/invalid")).rejects.toMatchObject({
      retryable: false,
      status: 400,
    });
  });

  it("bounds stalled Dify object-storage headers and response bodies", async () => {
    const stalledHeaders = createDifyObjectStorageAdapter({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch: async (input, init) => {
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return await new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      requestTimeoutMs: 10,
    });
    await expect(stalledHeaders.headObject("tenant-1/headers")).rejects.toMatchObject({
      retryable: true,
    });

    const stalledBody = createDifyObjectStorageAdapter({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch: async (input, init) => {
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        return new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              signal?.addEventListener("abort", () => controller.error(signal.reason), {
                once: true,
              });
            },
          }),
          { status: 200 },
        );
      },
      requestTimeoutMs: 10,
    });
    await expect(stalledBody.headObject("tenant-1/body")).rejects.toMatchObject({
      retryable: true,
    });
  });
});
