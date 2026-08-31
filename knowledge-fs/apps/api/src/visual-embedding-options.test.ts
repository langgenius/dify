import { createMemoryObjectStorageAdapter } from "@knowledge/adapters";
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

function createTestPlatformAdapter() {
  return {
    objectStorage: createMemoryObjectStorageAdapter({
      kind: "memory",
      maxObjectBytes: 128 * 1024 * 1024,
    }),
  };
}

describe("createApiVisualEmbeddingOptions", () => {
  it("leaves image-byte visual embeddings disabled by default or explicitly off", () => {
    const adapter = createTestPlatformAdapter();

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
    const adapter = createTestPlatformAdapter();
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
        KNOWLEDGE_QUERY_IMAGE_RETRIEVAL_ENABLED: "true",
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
      metadata: { model: "clip-multimodal", provider: "dify-model-runtime" },
      model: "clip-multimodal",
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

    await expect(
      options?.queryImageEmbeddingProvider?.embedImages({
        images: [
          {
            assetRef: { uploadFileId: "00000000-0000-4000-8000-000000000001" },
            body: new Uint8Array([4, 5, 6]),
            contentType: "image/png",
            documentAssetId: "00000000-0000-4000-8000-000000000001",
            metadata: { queryImage: true },
            modality: "image",
            nodeId: "00000000-0000-4000-8000-000000000001",
            objectKey: "00000000-0000-4000-8000-000000000001",
            sourceText: "",
          },
        ],
        inputType: "query",
        model: options.model ?? "",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ dense: [[0.1, 0.9]] });
    const imageQueryPayload = (await requests[2]?.json()) as Record<string, unknown>;
    expect(imageQueryPayload).toMatchObject({
      documents: [{ content: "BAUG", content_type: "image" }],
      input_type: "query",
    });
    expect(options?.queryMode).toBe("primary");
  });

  it("keeps query-image embedding disabled when query mode is off", () => {
    const adapter = createTestPlatformAdapter();
    const options = createApiVisualEmbeddingOptions({
      env: {
        ...PLUGIN_ENV,
        KNOWLEDGE_QUERY_IMAGE_RETRIEVAL_ENABLED: "true",
        KNOWLEDGE_VISUAL_EMBEDDING_QUERY_MODE: "off",
      },
      objectStorage: adapter.objectStorage,
    });

    expect(options?.queryImageEmbeddingProvider).toBeUndefined();
    expect(options?.queryEmbeddingProvider).toBeUndefined();
  });

  it("requires a tenantId for image-byte embedding calls", async () => {
    const adapter = createTestPlatformAdapter();
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

  it("applies configured visual embedding microbatch bounds to Dify requests", async () => {
    const adapter = createTestPlatformAdapter();
    for (const [index, size] of [1, 2, 1].entries()) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array(size).fill(index + 1),
        contentType: "image/png",
        key: `assets/batched-${index + 1}.png`,
      });
    }
    const requestDocumentCounts: number[] = [];
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      const payload = (await request.json()) as {
        readonly documents: readonly { readonly content: string }[];
      };
      requestDocumentCounts.push(payload.documents.length);

      return Response.json({
        data: {
          embeddings: payload.documents.map((_, index) => [index + 0.1, 0.9]),
          model: "clip-multimodal@1",
          usage: { total_tokens: payload.documents.length },
        },
        error: "",
      });
    }) as typeof fetch;
    const options = createApiVisualEmbeddingOptions({
      env: {
        ...PLUGIN_ENV,
        KNOWLEDGE_VISUAL_EMBEDDING_MAX_ASSET_BYTES: "2",
        KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_ASSETS: "2",
        KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_BYTES: "3",
      },
      objectStorage: adapter.objectStorage,
    });

    const result = await options?.provider.embedAssets({
      assets: [1, 2, 3].map((index) => ({
        assetRef: { objectKey: `assets/batched-${index}.png` },
        documentAssetId: "doc-1",
        metadata: {},
        modality: "image",
        nodeId: `node-${index}`,
        sourceText: `image ${index}`,
      })),
      model: options.model,
      tenantId: "tenant-1",
    });

    expect(requestDocumentCounts).toEqual([2, 1]);
    expect(result?.embeddedNodeIds).toEqual(["node-1", "node-2", "node-3"]);
    expect(result?.metadata).toMatchObject({
      providerCalls: 2,
      usage: { totalTokens: 3 },
    });
  });

  it("shares one visual lifecycle gate across concurrent documents before reading objects", async () => {
    const adapter = createTestPlatformAdapter();
    for (const index of [1, 2, 3]) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array([index]),
        contentType: "image/png",
        key: `assets/concurrent-${index}.png`,
      });
    }
    const readKeys: string[] = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let resolveTwoStarted: (() => void) | undefined;
    const twoStarted = new Promise<void>((resolve) => {
      resolveTwoStarted = resolve;
    });
    let releaseRequests: (() => void) | undefined;
    const requestsBlocked = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      const payload = (await request.json()) as {
        readonly documents: readonly unknown[];
      };
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      if (activeRequests === 2) resolveTwoStarted?.();
      await requestsBlocked;
      activeRequests -= 1;

      return Response.json({
        data: {
          embeddings: payload.documents.map(() => [0.1, 0.9]),
          model: "clip-multimodal@1",
        },
        error: "",
      });
    }) as typeof fetch;
    const options = createApiVisualEmbeddingOptions({
      env: PLUGIN_ENV,
      objectStorage: {
        ...adapter.objectStorage,
        getObjectStream: async (key) => {
          readKeys.push(key);
          return adapter.objectStorage.getObjectStream(key);
        },
      },
    });

    const calls = [1, 2, 3].map((index) =>
      options?.provider.embedAssets({
        assets: [visualAsset(`assets/concurrent-${index}.png`, index)],
        model: options.model,
        tenantId: "tenant-1",
      }),
    );

    await twoStarted;
    expect(activeRequests).toBe(2);
    expect(readKeys).toHaveLength(2);
    releaseRequests?.();
    await Promise.all(calls);

    expect(maxActiveRequests).toBe(2);
    expect(readKeys).toHaveLength(3);
  });

  it("cancels a queued visual document before any object is read", async () => {
    const adapter = createTestPlatformAdapter();
    for (const index of [1, 2]) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array([index]),
        contentType: "image/png",
        key: `assets/abort-${index}.png`,
      });
    }
    const readKeys: string[] = [];
    let resolveFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    globalThis.fetch = (async () => {
      resolveFirstStarted?.();
      await firstBlocked;
      return Response.json({
        data: { embeddings: [[0.1, 0.9]], model: "clip-multimodal@1" },
        error: "",
      });
    }) as typeof fetch;
    const options = createApiVisualEmbeddingOptions({
      env: { ...PLUGIN_ENV, KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY: "1" },
      objectStorage: {
        ...adapter.objectStorage,
        getObjectStream: async (key) => {
          readKeys.push(key);
          return adapter.objectStorage.getObjectStream(key);
        },
      },
    });
    const first = options?.provider.embedAssets({
      assets: [visualAsset("assets/abort-1.png", 1)],
      model: options.model,
      tenantId: "tenant-1",
    });
    await firstStarted;
    const controller = new AbortController();
    const queued = options?.provider.embedAssets({
      assets: [visualAsset("assets/abort-2.png", 2)],
      model: options.model,
      signal: controller.signal,
      tenantId: "tenant-1",
    });
    controller.abort(new Error("visual compilation cancelled while queued"));

    await expect(queued).rejects.toThrow("visual compilation cancelled while queued");
    expect(readKeys).toEqual(["assets/abort-1.png"]);
    releaseFirst?.();
    await expect(first).resolves.toBeDefined();
  });

  it("releases the visual lifecycle slot when a document fails", async () => {
    const adapter = createTestPlatformAdapter();
    for (const index of [1, 2]) {
      await adapter.objectStorage.putObject({
        body: new Uint8Array([index]),
        contentType: "image/png",
        key: `assets/failure-${index}.png`,
      });
    }
    const readKeys: string[] = [];
    let requestCount = 0;
    let resolveFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve;
    });
    let rejectFirst: ((reason: Error) => void) | undefined;
    const firstBlocked = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    });
    globalThis.fetch = (async () => {
      requestCount += 1;
      if (requestCount === 1) {
        resolveFirstStarted?.();
        await firstBlocked;
      }
      return Response.json({
        data: { embeddings: [[0.1, 0.9]], model: "clip-multimodal@1" },
        error: "",
      });
    }) as typeof fetch;
    const options = createApiVisualEmbeddingOptions({
      env: { ...PLUGIN_ENV, KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY: "1" },
      objectStorage: {
        ...adapter.objectStorage,
        getObjectStream: async (key) => {
          readKeys.push(key);
          return adapter.objectStorage.getObjectStream(key);
        },
      },
    });
    const first = options?.provider.embedAssets({
      assets: [visualAsset("assets/failure-1.png", 1)],
      model: options.model,
      tenantId: "tenant-1",
    });
    await firstStarted;
    const queued = options?.provider.embedAssets({
      assets: [visualAsset("assets/failure-2.png", 2)],
      model: options.model,
      tenantId: "tenant-1",
    });
    expect(readKeys).toEqual(["assets/failure-1.png"]);
    rejectFirst?.(new Error("visual provider failed"));

    await expect(first).rejects.toThrow("Dify model runtime request failed");
    await expect(queued).resolves.toBeDefined();
    expect(readKeys).toEqual(["assets/failure-1.png", "assets/failure-2.png"]);
  });

  it("validates visual embedding environment values", () => {
    const adapter = createTestPlatformAdapter();
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
    expect(() =>
      createApiVisualEmbeddingOptions({
        env: {
          ...PLUGIN_ENV,
          KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_ASSETS: "0",
        },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_ASSETS must be a positive integer");
    expect(() =>
      createApiVisualEmbeddingOptions({
        env: {
          ...PLUGIN_ENV,
          KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_BYTES: "many",
        },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_VISUAL_EMBEDDING_MAX_BATCH_BYTES must be a positive integer");
    expect(() =>
      createApiVisualEmbeddingOptions({
        env: {
          ...PLUGIN_ENV,
          KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY: "0",
        },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY must be between 1 and 8");
    expect(() =>
      createApiVisualEmbeddingOptions({
        env: {
          ...PLUGIN_ENV,
          KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY: "9",
        },
        objectStorage: adapter.objectStorage,
      }),
    ).toThrow("KNOWLEDGE_VISUAL_EMBEDDING_MAX_CONCURRENCY must be between 1 and 8");
  });
});

function visualAsset(objectKey: string, index: number) {
  return {
    assetRef: { objectKey },
    documentAssetId: `doc-${index}`,
    metadata: {},
    modality: "image",
    nodeId: `node-${index}`,
    sourceText: `image ${index}`,
  };
}
