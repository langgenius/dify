import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import type { ParseArtifact } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";
import { extractDocumentMultimodalAssets } from "./document-multimodal-asset-extractor";
import { createDocumentRemoteMediaBudget } from "./document-remote-media-budget";

const options = () => ({
  knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
  objectStorage: createNodePlatformAdapter({ env: {} }).objectStorage,
  tenantId: "tenant-1",
});
function artifact(uris: string[]): ParseArtifact {
  return {
    artifactHash: "a".repeat(64),
    contentType: "mixed",
    createdAt: "2026-06-23T00:00:00.000Z",
    documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    elements: uris.map((uri, index) => ({
      id: `image-${index}`,
      type: "image",
      sectionPath: [],
      metadata: { assetRef: { uri }, caption: `Source ${index}` },
    })),
    metadata: {},
    parser: "native-markdown",
    version: 1,
  };
}

describe("document-wide media budgets", () => {
  it("validates the remote budget's per-image cap independently of its caller", () => {
    expect(() =>
      createDocumentRemoteMediaBudget({
        maxAttempts: 1,
        maxBytes: 0,
        maxTotalBytes: 1,
        timeoutMs: 1,
      }),
    ).toThrow("maxRemoteAssetBytes");
  });
  it("charges derived image bytes to the same document materialization budget", async () => {
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: artifact(["data:image/png;base64,AQIDBA=="]),
      maxTotalAssetBytes: 8,
      imageVariantGenerator: {
        generate: async () => [
          { name: "thumbnail", contentType: "image/png", body: new Uint8Array([1, 2, 3]) },
          { name: "analysis", contentType: "image/png", body: new Uint8Array([1, 2, 3]) },
        ],
      },
    });
    expect(result.artifact.elements[0]?.metadata.assetRef).not.toHaveProperty("variants");
    expect(result.artifact.elements[0]?.metadata.assetRef).toHaveProperty("analysisUnavailable", {
      reason: "materialized-byte-budget",
    });
    expect(result.artifact.metadata).toMatchObject({
      multimodalAssets: { materializedBytes: 4 },
      parseCoverage: { media: { reasons: ["materialized-byte-budget"] } },
    });
  });
  it.each([
    new Error("decoder transport unavailable"),
    Object.assign(new Error("retry decoder"), { code: "provider_input", retryable: true }),
    Object.assign(new Error("service unavailable"), {
      code: "provider_request_failed",
      retryable: false,
    }),
  ])("propagates transient or unrelated variant failures", async (error) => {
    await expect(
      extractDocumentMultimodalAssets({
        ...options(),
        artifact: artifact(["data:image/png;base64,AQIDBA=="]),
        imageVariantGenerator: {
          generate: async () => {
            throw error;
          },
        },
      }),
    ).rejects.toBe(error);
  });
  it("does not accept a variant returned after its deadline", async () => {
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: artifact(["data:image/png;base64,AQIDBA=="]),
      maxVariantDurationMs: 5,
      imageVariantGenerator: {
        generate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return [];
        },
      },
    });
    expect(result.artifact.metadata).toMatchObject({
      parseCoverage: { media: { reasons: ["variant-deadline"] } },
    });
  });
  it("propagates lease loss during variant generation", async () => {
    const controller = new AbortController();
    await expect(
      extractDocumentMultimodalAssets({
        ...options(),
        artifact: artifact(["data:image/png;base64,AQIDBA=="]),
        signal: controller.signal,
        imageVariantGenerator: {
          generate: async () => {
            controller.abort(new Error("lease lost during decode"));
            throw controller.signal.reason;
          },
        },
      }),
    ).rejects.toThrow("lease lost during decode");
  });
  it("does not materialize a single image larger than the remaining byte budget", async () => {
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: artifact(["data:image/png;base64,AQIDBA=="]),
      maxTotalAssetBytes: 3,
    });
    expect(result.extractedCount).toBe(0);
    expect(result.artifact.metadata).toMatchObject({
      parseCoverage: { media: { reasons: ["materialized-byte-budget"] } },
    });
  });
  it("ignores directory-shaped image paths and unavailable allowlisted roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "kfs-media-directory-"));
    try {
      const directory = join(root, "folder.png");
      await mkdir(directory);
      const result = await extractDocumentMultimodalAssets({
        ...options(),
        artifact: artifact([directory]),
        allowLocalAssetPaths: [root, join(root, "missing")],
      });
      expect(result.extractedCount).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("cancels variant work on its document deadline and does not start more decoders", async () => {
    const generate = vi.fn(
      async ({ signal }: { signal?: AbortSignal | undefined }) =>
        new Promise<never>((_resolve, reject) => {
          if (signal?.aborted) reject(signal.reason);
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: artifact(["data:image/png;base64,AQIDBA==", "data:image/png;base64,AQIDBA=="]),
      maxVariantDurationMs: 5,
      imageVariantGenerator: { generate },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.extractedCount).toBe(2);
    expect(result.artifact.elements[0]?.metadata.assetRef).toHaveProperty("analysisUnavailable", {
      reason: "variant-deadline",
    });
    expect(result.artifact.elements[1]?.metadata.assetRef).toHaveProperty("analysisUnavailable", {
      reason: "variant-deadline",
    });
    expect(result.artifact.metadata).toMatchObject({
      parseCoverage: { media: { status: "partial", reasons: ["variant-deadline"] } },
    });
  });
  it("propagates cancellation of in-flight downloads rather than treating it as missing media", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      controller.abort(new Error("lease lost during download"));
      return null;
    });
    await expect(
      extractDocumentMultimodalAssets({
        ...options(),
        artifact: artifact(["https://a.test/1.png"]),
        signal: controller.signal,
        remoteAssetFetcher: { fetch },
      }),
    ).rejects.toThrow("lease lost during download");
  });
  it.each([
    "maxRemoteAssetAttempts",
    "maxTotalRemoteAssetBytes",
    "remoteAssetTimeoutMs",
    "maxTotalAssetBytes",
    "maxVariantPixels",
    "maxTotalVariantPixels",
    "maxVariantDurationMs",
  ])("rejects invalid %s", async (field) => {
    await expect(
      extractDocumentMultimodalAssets({ ...options(), artifact: artifact([]), [field]: 0 }),
    ).rejects.toThrow("must be at least 1");
  });
  it("records unavailable remote capability without losing references or earlier coverage", async () => {
    const source = artifact(["https://a.test/image.png"]);
    source.metadata = {
      parseCoverage: {
        text: { status: "complete", reasons: [] },
        media: { status: "partial", reasons: ["unsupported-media"] },
      },
    };
    const result = await extractDocumentMultimodalAssets({ ...options(), artifact: source });
    expect(result.artifact.elements).toEqual(source.elements);
    expect(result.artifact.metadata).toMatchObject({
      parseCoverage: {
        text: { status: "complete" },
        media: { status: "partial", reasons: ["unsupported-media", "remote-fetcher-unavailable"] },
      },
    });
  });
  it("preserves originals without decoding variants beyond the aggregate pixel budget", async () => {
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 3,
    ]);
    const generate = vi.fn(async () => [
      { body: new Uint8Array([1]), contentType: "image/png", name: "thumbnail" },
    ]);
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: artifact([
        `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
        `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
      ]),
      maxTotalVariantPixels: 6,
      imageVariantGenerator: { generate },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.extractedCount).toBe(2);
    expect(result.artifact.elements[0]?.metadata.assetRef).not.toHaveProperty(
      "analysisUnavailable",
    );
    expect(result.artifact.elements[1]?.metadata.assetRef).toHaveProperty("analysisUnavailable", {
      reason: "variant-pixel-budget",
    });
    expect(result.artifact.metadata).toMatchObject({
      parseCoverage: { media: { status: "partial", reasons: ["variant-pixel-budget"] } },
    });
  });
  it("leaves images inline before exceeding the document's materialized byte cap", async () => {
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: artifact(["data:image/png;base64,AQIDBA==", "data:image/png;base64,AQIDBA=="]),
      maxTotalAssetBytes: 4,
    });
    expect(result.extractedCount).toBe(1);
    expect(result.artifact.elements[1]?.metadata.assetRef).toEqual({
      analysisUnavailable: { reason: "materialized-byte-budget" },
      uri: "data:image/png;base64,AQIDBA==",
    });
    expect(result.artifact.metadata).toMatchObject({
      parseCoverage: { media: { status: "partial", reasons: ["materialized-byte-budget"] } },
    });
  });
  it.each(["empty", "invalid"])("preserves the source when variants are %s", async (failure) => {
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: artifact(["data:image/png;base64,AQIDBA=="]),
      imageVariantGenerator: {
        generate: async () => {
          if (failure === "invalid")
            throw Object.assign(new Error("Image decoder rejected input"), {
              code: "provider_input",
              retryable: false,
            });
          return [];
        },
      },
    });
    expect(result.extractedCount).toBe(1);
    expect(result.artifact.elements[0]?.metadata.assetRef).toMatchObject({
      analysisUnavailable: {
        reason: failure === "empty" ? "variant-unavailable" : "variant-input-rejected",
      },
      objectKey: expect.any(String),
    });
    expect(result.artifact.metadata).toMatchObject({
      parseCoverage: {
        media: {
          status: "partial",
          reasons: [failure === "empty" ? "variant-unavailable" : "variant-input-rejected"],
        },
      },
    });
  });
  it("counts failed unique URL attempts and preserves unresolved references", async () => {
    const fetch = vi.fn(async () => null);
    const source = artifact([
      "https://a.test/1.png",
      "https://a.test/2.png",
      "https://a.test/3.png",
    ]);
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: source,
      maxRemoteAssetAttempts: 2,
      remoteAssetFetcher: { fetch },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.artifact.elements).toEqual(source.elements);
    expect(result.artifact.metadata).toMatchObject({
      parseCoverage: {
        media: {
          status: "partial",
          reasons: expect.arrayContaining(["remote-attempt-budget", "remote-unavailable"]),
        },
      },
      multimodalAssets: { remoteAttempts: 2, remoteDownloadedBytes: 0 },
    });
  });

  it("fetches repeated URLs once while preserving every element and caption", async () => {
    const fetch = vi.fn(async () => ({ body: new Uint8Array([1, 2]), contentType: "image/png" }));
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: artifact(["https://a.test/1.png", "https://a.test/1.png"]),
      remoteAssetFetcher: { fetch },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.extractedCount).toBe(2);
    expect(result.artifact.elements.map((element) => element.metadata.caption)).toEqual([
      "Source 0",
      "Source 1",
    ]);
    expect(result.artifact.metadata).toMatchObject({
      multimodalAssets: { remoteAttempts: 1, remoteDownloadedBytes: 2 },
    });
  });

  it("bounds aggregate remote bytes before requesting the next image", async () => {
    const fetch = vi.fn(async () => ({ body: new Uint8Array([1, 2]), contentType: "image/png" }));
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: artifact(["https://a.test/1.png", "https://a.test/2.png"]),
      maxTotalRemoteAssetBytes: 2,
      remoteAssetFetcher: { fetch },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.extractedCount).toBe(1);
    expect(result.artifact.metadata).toMatchObject({
      parseCoverage: { media: { status: "partial", reasons: ["remote-byte-budget"] } },
    });
  });

  it("aborts a stalled fetch on the document-wide deadline and reports partial media", async () => {
    const fetch = vi.fn(async () => new Promise<null>(() => {}));
    const result = await extractDocumentMultimodalAssets({
      ...options(),
      artifact: artifact(["https://a.test/1.png", "https://a.test/2.png"]),
      remoteAssetTimeoutMs: 10,
      remoteAssetFetcher: { fetch },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.artifact.metadata).toMatchObject({
      parseCoverage: { media: { status: "partial", reasons: ["remote-deadline"] } },
    });
  });

  it("does not start fetching after cancellation", async () => {
    const fetch = vi.fn(async () => null);
    const controller = new AbortController();
    controller.abort(new Error("lease lost"));
    await expect(
      extractDocumentMultimodalAssets({
        ...options(),
        artifact: artifact(["https://a.test/1.png"]),
        signal: controller.signal,
        remoteAssetFetcher: { fetch },
      }),
    ).rejects.toThrow("lease lost");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("denies symlinks escaping an allowed local root", async () => {
    const allowed = await mkdtemp(join(tmpdir(), "kfs-media-allowed-"));
    const outside = await mkdtemp(join(tmpdir(), "kfs-media-outside-"));
    try {
      const privatePath = join(outside, "secret.png");
      await writeFile(privatePath, new Uint8Array([1, 2]));
      const link = join(allowed, "image.png");
      await symlink(privatePath, link);
      const result = await extractDocumentMultimodalAssets({
        ...options(),
        artifact: artifact([link]),
        allowLocalAssetPaths: [allowed],
      });
      expect(result.extractedCount).toBe(0);
      expect(result.artifact.elements[0]?.metadata.assetRef).toEqual({ uri: link });
    } finally {
      await rm(allowed, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
