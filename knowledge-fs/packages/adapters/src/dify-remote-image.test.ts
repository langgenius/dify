import { describe, expect, it, vi } from "vitest";

import { DifyRemoteImageRequestError, createDifyRemoteImageFetcher } from "./dify-remote-image";

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

describe("Dify remote image fetcher", () => {
  it("uses the authenticated SSRF-safe inner endpoint and returns bounded bytes", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(pngBytes, {
        headers: {
          "Content-Length": String(pngBytes.byteLength),
          "Content-Type": "image/png",
        },
      }),
    );
    const resolver = createDifyRemoteImageFetcher({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch,
    });

    await expect(
      resolver.fetch({ maxBytes: 1024, url: "https://cdn.example.test/a b.png?x=1&y=2" }),
    ).resolves.toEqual({ body: pngBytes, contentType: "image/png" });

    const requestUrl = fetch.mock.calls[0]?.[0].toString() ?? "";
    expect(requestUrl).toContain("/inner/api/knowledge-fs/remote-image?");
    expect(new URL(requestUrl).searchParams.get("url")).toBe(
      "https://cdn.example.test/a%20b.png?x=1&y=2",
    );
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("X-Inner-Api-Key")).toBe("inner-key");
  });

  it.each([400, 403, 404, 413, 415, 422])(
    "leaves terminally unavailable remote images inline for status %s",
    async (status) => {
      const resolver = createDifyRemoteImageFetcher({
        apiKey: "inner-key",
        baseUrl: "http://api:5001",
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status })),
      });

      await expect(
        resolver.fetch({ maxBytes: 1024, url: "https://cdn.example.test/missing.png" }),
      ).resolves.toBeNull();
    },
  );

  it("classifies transient responses, transport errors, and timeouts as retryable", async () => {
    const unavailable = createDifyRemoteImageFetcher({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(null, { status: 503 })),
    });
    await expect(
      unavailable.fetch({ maxBytes: 1024, url: "https://cdn.example.test/image.png" }),
    ).rejects.toMatchObject({ retryable: true, status: 503 });

    const offline = createDifyRemoteImageFetcher({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline")),
    });
    await expect(
      offline.fetch({ maxBytes: 1024, url: "https://cdn.example.test/image.png" }),
    ).rejects.toBeInstanceOf(DifyRemoteImageRequestError);

    const stalled = createDifyRemoteImageFetcher({
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
    await expect(
      stalled.fetch({ maxBytes: 1024, url: "https://cdn.example.test/image.png" }),
    ).rejects.toMatchObject({ retryable: true });
  });

  it("rejects oversized or invalid successful responses", async () => {
    const oversized = createDifyRemoteImageFetcher({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Length": "3", "Content-Type": "image/png" },
        }),
      ),
    });
    await expect(
      oversized.fetch({ maxBytes: 2, url: "https://cdn.example.test/image.png" }),
    ).rejects.toThrow("exceeds maxBytes=2");

    const invalidType = createDifyRemoteImageFetcher({
      apiKey: "inner-key",
      baseUrl: "http://api:5001",
      fetch: vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(new Response(pngBytes, { headers: { "Content-Type": "text/plain" } })),
    });
    await expect(
      invalidType.fetch({ maxBytes: 1024, url: "https://cdn.example.test/image.png" }),
    ).rejects.toThrow("content type is invalid");
  });
});
