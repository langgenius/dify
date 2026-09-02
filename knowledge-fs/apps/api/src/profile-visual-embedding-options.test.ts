import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
import type { KnowledgeSpaceEmbeddingProfile } from "@knowledge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiProfileVisualEmbeddingOptions } from "./profile-visual-embedding-options";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const profile: KnowledgeSpaceEmbeddingProfile = {
  dimension: 2,
  model: "tenant-vision-embedding",
  pluginId: "langgenius/vision",
  provider: "vision",
  revision: 3,
  vectorSpaceId: "vision-space-v3",
};

describe("createApiProfileVisualEmbeddingOptions", () => {
  it("routes image embeddings through the active space profile without model env", async () => {
    const objectStorage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 1024 * 1024,
    });
    await objectStorage.putObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      key: "assets/chart.png",
    });
    const payloads: Record<string, unknown>[] = [];
    globalThis.fetch = vi.fn(async (input, init) => {
      const request = new Request(input, init);
      payloads.push((await request.json()) as Record<string, unknown>);
      return Response.json({
        data: { embeddings: [[0.1, 0.9]], model: profile.model },
        error: "",
      });
    }) as typeof fetch;
    const options = createApiProfileVisualEmbeddingOptions({ env: {}, objectStorage });

    await expect(
      options.provider.embedAssets({
        assets: [
          {
            assetRef: { contentType: "image/png", objectKey: "assets/chart.png" },
            documentAssetId: "doc-1",
            metadata: {},
            modality: "image",
            nodeId: "node-1",
            sourceText: "chart",
          },
        ],
        embeddingProfile: profile,
        model: profile.model,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ dense: [[0.1, 0.9]], model: profile.model });
    expect(payloads).toEqual([
      expect.objectContaining({
        model: profile.model,
        provider: `${profile.pluginId}/${profile.provider}`,
      }),
    ]);
  });

  it("rejects ingestion calls without the immutable embedding profile", async () => {
    const objectStorage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 1024 * 1024,
    });
    const options = createApiProfileVisualEmbeddingOptions({ env: {}, objectStorage });

    await expect(
      options.provider.embedAssets({ assets: [], model: profile.model, tenantId: "tenant-1" }),
    ).rejects.toThrow("embeddingProfile is required");
  });

  it("propagates cancellation and validates resource-only bounds", async () => {
    const objectStorage = createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 1024 * 1024,
    });
    let requestSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal | undefined;
          requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
            once: true,
          });
        }),
    ) as typeof fetch;
    const options = createApiProfileVisualEmbeddingOptions({ env: {}, objectStorage });
    const controller = new AbortController();
    const canceled = new Error("compilation canceled");
    const pending = options.imageEmbeddingProviderFactory(profile).embedImages({
      images: [
        {
          assetRef: {},
          body: new Uint8Array([1]),
          documentAssetId: "doc-1",
          metadata: {},
          modality: "image",
          nodeId: "node-1",
          objectKey: "asset.png",
          sourceText: "",
        },
      ],
      model: profile.model,
      signal: controller.signal,
      tenantId: "tenant-1",
    });
    await vi.waitFor(() => expect(requestSignal).toBeDefined());

    controller.abort(canceled);

    await expect(pending).rejects.toBeDefined();
    expect(requestSignal?.reason).toBe(canceled);
    expect(() =>
      createApiProfileVisualEmbeddingOptions({
        env: { KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY: "9" },
        objectStorage,
      }),
    ).toThrow("must be between 1 and 8");
  });
});
