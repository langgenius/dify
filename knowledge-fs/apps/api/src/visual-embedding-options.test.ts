import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { afterEach, describe, expect, it } from "vitest";

import { createApiVisualEmbeddingOptions } from "./visual-embedding-options";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const PLUGIN_ENV = {
  KNOWLEDGE_VISUAL_EMBEDDING_MODEL: "clip-multimodal",
  KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_ID: "langgenius/clip",
  KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_PROVIDER: "clip",
  KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER: "dify-model-runtime",
} as const;

describe("createApiVisualEmbeddingOptions", () => {
  it("leaves image-byte visual embeddings disabled by default or explicitly off", () => {
    const adapter = createNodePlatformAdapter({ env: {} });

    expect(
      createApiVisualEmbeddingOptions({ env: {}, objectStorage: adapter.objectStorage }),
    ).toBeUndefined();
    expect(
      createApiVisualEmbeddingOptions({
        env: { KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER: "off" },
        objectStorage: adapter.objectStorage,
      }),
    ).toBeUndefined();
  });

  it("routes image and text embeddings through Dify", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const requests: Request[] = [];
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      key: "tenant/spaces/space/documents/doc/assets/chart-thumbnail.png",
    });
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      requests.push(request.clone());

      if (request.url.endsWith("/inner/api/invoke/multimodal-embedding")) {
        expect(request.url).toBe("http://localhost:5001/inner/api/invoke/multimodal-embedding");

        return Response.json({
          data: {
            embeddings: [[0.1, 0.9]],
            model: "clip-multimodal@1",
            usage: { tokens: 3, total_tokens: 3 },
          },
          error: "",
        });
      }

      expect(request.url).toBe("http://localhost:5001/inner/api/invoke/text-embedding");

      return Response.json({
        data: { embeddings: [[0.2, 0.8]], model: "clip-multimodal@1" },
        error: "",
      });
    }) as typeof fetch;

    const options = createApiVisualEmbeddingOptions({
      env: {
        ...PLUGIN_ENV,
        // The daemon response below is authoritative; a stale configured value is ignored.
        KNOWLEDGE_VISUAL_EMBEDDING_DIMENSION: "999",
        KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE: "primary",
      },
      objectStorage: adapter.objectStorage,
    });

    await expect(
      options?.provider?.embedAssets({
        assets: [
          {
            assetRef: {
              contentType: "image/png",
              objectKey: "tenant/spaces/space/documents/doc/assets/chart.png",
              variants: {
                thumbnail: {
                  contentType: "image/png",
                  objectKey: "tenant/spaces/space/documents/doc/assets/chart-thumbnail.png",
                },
              },
            },
            documentAssetId: "doc-1",
            metadata: { pageNumber: 3 },
            modality: "image",
            nodeId: "node-1",
            sourceText: "chart",
          },
        ],
        model: options.model,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      dense: [[0.1, 0.9]],
      metadata: {
        model: "clip-multimodal@1",
        provider: "dify-model-runtime:dify-model-runtime:image-bytes",
      },
      model: "clip-multimodal@1",
    });

    const payload = (await requests[0]?.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      documents: [
        {
          content: "AQID",
          content_type: "image",
          file_id: "tenant/spaces/space/documents/doc/assets/chart-thumbnail.png",
        },
      ],
      input_type: "document",
      model: "clip-multimodal",
      model_type: "text-embedding",
      provider: "langgenius/clip/clip",
    });
    expect(payload).not.toHaveProperty("credentials");

    await expect(
      options?.queryEmbeddingProvider?.embed({
        inputType: "search_query",
        model: options.queryEmbeddingModel ?? "",
        tenantId: "tenant-1",
        texts: ["revenue chart"],
      }),
    ).resolves.toMatchObject({
      dense: [[0.2, 0.8]],
      metadata: { model: "clip-multimodal@1", provider: "dify-model-runtime" },
      model: "clip-multimodal@1",
    });

    const queryPayload = (await requests[1]?.json()) as Record<string, unknown>;
    expect(queryPayload).toMatchObject({
      input_type: "query",
      model: "clip-multimodal",
      model_type: "text-embedding",
      provider: "langgenius/clip/clip",
      texts: ["revenue chart"],
    });
    await expect(options?.queryEmbeddingProvider?.models()).resolves.toMatchObject([
      { dimension: 2, id: "clip-multimodal", provider: "dify-model-runtime" },
    ]);
    expect(options?.queryMode).toBe("primary");
  });

  it("requires a tenantId for image-byte embedding calls", async () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    // A readable asset so the wrapper reaches the daemon call (empty/unreadable assets are
    // deliberately skipped with an empty result before any tenant validation).
    await adapter.objectStorage.putObject({
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
      key: "assets/img-1.png",
    });
    const options = createApiVisualEmbeddingOptions({
      env: PLUGIN_ENV,
      objectStorage: adapter.objectStorage,
    });

    await expect(
      options?.provider?.embedAssets({
        assets: [
          {
            assetRef: { objectKey: "assets/img-1.png" },
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
            metadata: {},
            modality: "image",
            nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d02",
            sourceText: "revenue chart",
          },
        ],
        model: options.model,
      }),
    ).rejects.toThrow("Dify model runtime visual embedding requires a tenantId");
  });

  it("validates visual embedding environment values", () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    expect(() =>
      createApiVisualEmbeddingOptions({
        env: { KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER: "dify-model-runtime" },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_VISUAL_EMBEDDING_MODEL is required for visual embeddings");
    expect(() =>
      createApiVisualEmbeddingOptions({
        env: {
          KNOWLEDGE_VISUAL_EMBEDDING_MODEL: "clip-multimodal",
          KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER: "dify-model-runtime",
        },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_VISUAL_EMBEDDING_PLUGIN_ID is required for visual embeddings");
    expect(() =>
      createApiVisualEmbeddingOptions({
        env: { KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER: "http" },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_VISUAL_EMBEDDING_PROVIDER must be dify-model-runtime");
    expect(() =>
      createApiVisualEmbeddingOptions({
        env: {
          ...PLUGIN_ENV,
          KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE: "sometimes",
        },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE must be primary, fallback, or off");
  });
});
