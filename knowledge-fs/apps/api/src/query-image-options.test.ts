import { createHash } from "node:crypto";

import {
  QUERY_IMAGE_MAX_BYTES,
  QUERY_IMAGE_MAX_TOTAL_BYTES,
  QueryImageResolutionError,
} from "@knowledge/api";
import { describe, expect, it, vi } from "vitest";

import { createApiQueryImageResolver } from "./query-image-options";

const IMAGE_ID = "00000000-0000-4000-8000-000000000001";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("createApiQueryImageResolver", () => {
  it("loads a bounded image through Dify inner API and verifies its checksum", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.headers.get("x-inner-api-key")).toBe("inner-secret");
      const url = new URL(request.url);
      expect(url.pathname).toBe("/inner/api/knowledge-fs/query-image");
      expect(url.searchParams.get("uploadFileId")).toBe(IMAGE_ID);
      expect(url.searchParams.get("tenantId")).toBe("tenant-1");
      expect(url.searchParams.get("subjectId")).toBe("dify-account:actor-1");
      return new Response(PNG, {
        headers: {
          "content-length": String(PNG.byteLength),
          "content-type": "image/png",
          "x-query-image-sha256": createHash("sha256").update(PNG).digest("hex"),
        },
      });
    });
    const resolver = createApiQueryImageResolver({
      env: { DIFY_INNER_API_KEY: "inner-secret", DIFY_INNER_API_URL: "http://api:5001" },
      fetch: fetch as typeof globalThis.fetch,
    });

    await expect(
      resolver.resolve({
        references: [{ uploadFileId: IMAGE_ID }],
        subjectId: "dify-account:actor-1",
        tenantId: "tenant-1",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        body: PNG,
        byteSize: PNG.byteLength,
        mimeType: "image/png",
        uploadFileId: IMAGE_ID,
      }),
    ]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("forwards a workflow file grant in a header instead of the logged URL", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(new URL(request.url).searchParams.has("accessGrant")).toBe(false);
      expect(request.headers.get("x-knowledge-fs-query-image-grant")).toBe("short-lived-grant");
      return new Response(PNG, {
        headers: {
          "content-length": String(PNG.byteLength),
          "content-type": "image/png",
          "x-query-image-sha256": createHash("sha256").update(PNG).digest("hex"),
        },
      });
    });
    const resolver = createApiQueryImageResolver({
      env: { DIFY_INNER_API_KEY: "inner-secret", DIFY_INNER_API_URL: "http://api:5001" },
      fetch: fetch as typeof globalThis.fetch,
    });

    await resolver.resolve({
      references: [{ accessGrant: "short-lived-grant", uploadFileId: IMAGE_ID }],
      subjectId: "dify-app:app-1",
      tenantId: "tenant-1",
    });

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("maps hidden files, invalid MIME, and checksum drift to typed failures", async () => {
    const resolveWith = (response: Response) =>
      createApiQueryImageResolver({
        env: { DIFY_INNER_API_KEY: "key", DIFY_INNER_API_URL: "http://api:5001" },
        fetch: vi.fn(async () => response) as typeof globalThis.fetch,
      }).resolve({
        references: [{ uploadFileId: IMAGE_ID }],
        subjectId: "actor",
        tenantId: "tenant",
      });

    await expect(resolveWith(new Response(null, { status: 404 }))).rejects.toMatchObject({
      code: "QUERY_IMAGE_NOT_FOUND",
      status: 404,
    });
    await expect(
      resolveWith(
        new Response(PNG, {
          headers: { "content-type": "image/svg+xml", "x-query-image-sha256": "a".repeat(64) },
        }),
      ),
    ).rejects.toBeInstanceOf(QueryImageResolutionError);
    await expect(
      resolveWith(
        new Response(PNG, {
          headers: { "content-type": "image/png", "x-query-image-sha256": "a".repeat(64) },
        }),
      ),
    ).rejects.toMatchObject({ code: "QUERY_IMAGE_CHECKSUM_MISMATCH", status: 503 });
  });

  it("keeps aggregate overflow distinct from a single-image size violation", async () => {
    const fullImage = new Uint8Array(QUERY_IMAGE_MAX_BYTES).fill(1);
    const aggregateOverflow = new Uint8Array(
      QUERY_IMAGE_MAX_TOTAL_BYTES - 3 * QUERY_IMAGE_MAX_BYTES + 1,
    ).fill(2);
    const bodies = [fullImage, fullImage, fullImage, aggregateOverflow];
    const fetch = vi.fn(async () => {
      const body = bodies.shift();
      if (!body) throw new Error("unexpected request");
      return new Response(body, {
        headers: {
          "content-length": String(body.byteLength),
          "content-type": "image/png",
          "x-query-image-sha256": createHash("sha256").update(body).digest("hex"),
        },
      });
    });
    const resolver = createApiQueryImageResolver({
      env: { DIFY_INNER_API_KEY: "key", DIFY_INNER_API_URL: "http://api:5001" },
      fetch: fetch as typeof globalThis.fetch,
    });

    await expect(
      resolver.resolve({
        references: [1, 2, 3, 4].map((index) => ({
          uploadFileId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        })),
        subjectId: "actor",
        tenantId: "tenant",
      }),
    ).rejects.toMatchObject({ code: "QUERY_IMAGE_TOTAL_TOO_LARGE", status: 413 });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("rejects unsafe inner API URLs", () => {
    expect(() =>
      createApiQueryImageResolver({
        env: { DIFY_INNER_API_KEY: "key", DIFY_INNER_API_URL: "file:///tmp/image" },
      }),
    ).toThrow("DIFY_INNER_API_URL is invalid");
  });
});
