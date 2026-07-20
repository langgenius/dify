import { describe, expect, it } from "vitest";

import {
  ProviderInputError,
  createCachedEmbeddingProvider,
  createCachedRerankerProvider,
  createPluginDaemonRerankerProvider,
  createStaticEmbeddingProvider,
  createStaticRerankerProvider,
} from "./index";

interface RecordingCache {
  readonly getCalls: string[];
  readonly setCalls: Array<{
    readonly key: string;
    readonly options?: { readonly ttlMs?: number };
  }>;
  readonly values: Map<string, Uint8Array>;
  delete(key: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array, options?: { readonly ttlMs?: number }): Promise<void>;
}

function createRecordingCache(): RecordingCache {
  const values = new Map<string, Uint8Array>();
  const getCalls: string[] = [];
  const setCalls: Array<{ readonly key: string; readonly options?: { readonly ttlMs?: number } }> =
    [];

  return {
    delete: async (key) => {
      values.delete(key);
    },
    get: async (key) => {
      getCalls.push(key);
      const value = values.get(key);

      return value ? new Uint8Array(value) : null;
    },
    getCalls,
    set: async (key, value, options) => {
      setCalls.push({ key, ...(options ? { options } : {}) });
      values.set(key, new Uint8Array(value));
    },
    setCalls,
    values,
  };
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Expected test value to exist");
  }

  return value;
}

describe("embedding providers", () => {
  it("caches embedding results by model version and tokenizer version", async () => {
    const cache = createRecordingCache();
    let embedCalls = 0;
    const provider = createCachedEmbeddingProvider({
      cache,
      cacheVersion: "embedding-cache-v1",
      provider: {
        kind: "static",
        embed: async (input) => {
          embedCalls += 1;

          return {
            dense: input.texts.map((_, index) => [embedCalls, index]),
            metadata: { model: input.model, provider: "static" },
            model: input.model,
          };
        },
        models: async () => [
          {
            dimension: 2,
            distanceMetric: "cosine",
            id: "dense-model",
            maxInputTokens: 8191,
            provider: "static",
            recommendedBatchSize: 128,
            supportsDense: true,
            supportsMultiVector: false,
            supportsSparse: false,
            tokenizerVersion: "tok-v1",
            version: "model-v1",
          },
        ],
      },
      ttlMs: 60_000,
    });

    const input = { inputType: "search_query" as const, model: "dense-model", texts: ["alpha"] };
    const first = await provider.embed(input);
    const second = await provider.embed(input);

    expect(embedCalls).toBe(1);
    expect(second).toEqual(first);
    first.dense[0]?.push(99);
    await expect(provider.embed(input)).resolves.toEqual(second);
    expect(cache.setCalls[0]?.key).toContain("embedding:embedding-cache-v1:");
    expect(cache.setCalls[0]?.key).not.toContain("alpha");
    expect(cache.setCalls[0]?.options).toEqual({ ttlMs: 60_000 });
    const firstCacheKey = requireValue(cache.setCalls[0]?.key);
    cache.values.set(firstCacheKey, new TextEncoder().encode("{"));
    await expect(provider.embed(input)).resolves.toEqual({
      dense: [[2, 0]],
      metadata: { model: "dense-model", provider: "static" },
      model: "dense-model",
    });
    expect(embedCalls).toBe(2);
    const secondCacheKey = requireValue(cache.setCalls[1]?.key);
    cache.values.set(secondCacheKey, new TextEncoder().encode('{"model":"dense-model"}'));
    await expect(provider.embed(input)).resolves.toEqual({
      dense: [[3, 0]],
      metadata: { model: "dense-model", provider: "static" },
      model: "dense-model",
    });
    expect(embedCalls).toBe(3);

    const newVersionProvider = createCachedEmbeddingProvider({
      cache,
      provider: {
        kind: "static",
        embed: async (newInput) => ({
          dense: newInput.texts.map((_, index) => [2, index]),
          metadata: { model: newInput.model, provider: "static" },
          model: newInput.model,
        }),
        models: async () => [
          {
            dimension: 2,
            distanceMetric: "cosine",
            id: "dense-model",
            maxInputTokens: 8191,
            provider: "static",
            recommendedBatchSize: 128,
            supportsDense: true,
            supportsMultiVector: false,
            supportsSparse: false,
            tokenizerVersion: "tok-v2",
            version: "model-v2",
          },
        ],
      },
    });

    await expect(newVersionProvider.embed(input)).resolves.toEqual({
      dense: [[2, 0]],
      metadata: { model: "dense-model", provider: "static" },
      model: "dense-model",
    });
  });

  it("builds stable cache keys for nullable metadata without throwing", async () => {
    const cache = createRecordingCache();
    const reranker = createCachedRerankerProvider({
      cache,
      reranker: createStaticRerankerProvider({ model: "rerank-model" }),
    });

    await expect(
      reranker.rerank({
        documents: [{ id: "doc-1", metadata: { optional: null }, text: "Alpha evidence" }],
        model: "rerank-model",
        query: "alpha",
      }),
    ).resolves.toMatchObject({
      model: "rerank-model",
    });
    expect(cache.setCalls[0]?.key).toContain("rerank:");
  });

  it("caches rerank results by model version and bounded document digests", async () => {
    const cache = createRecordingCache();
    let rerankCalls = 0;
    const provider = createCachedRerankerProvider({
      cache,
      cacheVersion: "rerank-cache-v1",
      reranker: {
        kind: "static",
        models: async () => [
          {
            id: "rerank-model",
            maxDocuments: 128,
            maxInputTokens: 8191,
            provider: "static",
            version: "rerank-v1",
          },
        ],
        rerank: async (input) => {
          rerankCalls += 1;

          return {
            items: input.documents
              .slice(0, input.topN ?? input.documents.length)
              .map((document, index) => ({
                document: {
                  id: document.id,
                  metadata: document.metadata ?? {},
                  text: document.text,
                },
                index,
                score: rerankCalls - index / 10,
              })),
            metadata: { model: input.model, provider: "static" },
            model: input.model,
          };
        },
      },
      ttlMs: 60_000,
    });
    const input = {
      documents: [{ id: "doc-1", metadata: { permission: "tenant" }, text: "Alpha evidence" }],
      model: "rerank-model",
      query: "alpha",
      topN: 1,
    };

    const first = await provider.rerank(input);
    const second = await provider.rerank(input);

    expect(rerankCalls).toBe(1);
    expect(second).toEqual(first);
    const rerankedItem = requireValue(second.items[0]);
    rerankedItem.document.metadata.permission = "mutated";
    await expect(provider.rerank(input)).resolves.toEqual(first);
    expect(cache.setCalls[0]?.key).toContain("rerank:rerank-cache-v1:");
    expect(cache.setCalls[0]?.key).not.toContain("Alpha evidence");
    const firstRerankCacheKey = requireValue(cache.setCalls[0]?.key);
    cache.values.set(firstRerankCacheKey, new TextEncoder().encode("{"));
    await expect(provider.rerank(input)).resolves.toEqual({
      items: [
        {
          document: { id: "doc-1", metadata: { permission: "tenant" }, text: "Alpha evidence" },
          index: 0,
          score: 2,
        },
      ],
      metadata: { model: "rerank-model", provider: "static" },
      model: "rerank-model",
    });
    const secondRerankCacheKey = requireValue(cache.setCalls[1]?.key);
    cache.values.set(secondRerankCacheKey, new TextEncoder().encode('{"model":"rerank-model"}'));
    await expect(provider.rerank(input)).resolves.toEqual({
      items: [
        {
          document: { id: "doc-1", metadata: { permission: "tenant" }, text: "Alpha evidence" },
          index: 0,
          score: 3,
        },
      ],
      metadata: { model: "rerank-model", provider: "static" },
      model: "rerank-model",
    });

    await expect(provider.rerank({ ...input, query: "alpha refined" })).resolves.not.toEqual(first);
    expect(rerankCalls).toBe(4);
  });

  it("rejects invalid embedding and rerank cache bounds", () => {
    const cache = createRecordingCache();
    const embeddingProvider = createStaticEmbeddingProvider({ dimension: 2, model: "dense-model" });
    const reranker = createStaticRerankerProvider({ model: "rerank-model" });

    expect(() =>
      createCachedEmbeddingProvider({
        cache,
        cacheVersion: " ",
        provider: embeddingProvider,
      }),
    ).toThrow("Embedding cache cacheVersion is required");
    expect(() =>
      createCachedEmbeddingProvider({
        cache,
        maxEntryBytes: 0,
        provider: embeddingProvider,
      }),
    ).toThrow("Embedding cache maxEntryBytes must be at least 1");
    expect(() =>
      createCachedRerankerProvider({
        cache,
        reranker,
        ttlMs: 0,
      }),
    ).toThrow("Rerank cache ttlMs must be at least 1");
  });
});

describe("static embedding provider", () => {
  it("produces deterministic dense vectors of the configured dimension", async () => {
    const provider = createStaticEmbeddingProvider({ dimension: 4, model: "dense-model" });

    const result = await provider.embed({ model: "dense-model", texts: ["alpha", "beta"] });

    expect(provider.kind).toBe("static");
    expect(result.model).toBe("dense-model");
    expect(result.metadata).toEqual({ model: "dense-model", provider: "static" });
    expect(result.dense).toHaveLength(2);
    expect(result.dense[0]).toHaveLength(4);

    const repeat = await provider.embed({ model: "dense-model", texts: ["alpha"] });
    expect(repeat.dense[0]).toEqual(result.dense[0]);
    await expect(provider.models()).resolves.toEqual([
      expect.objectContaining({ dimension: 4, id: "dense-model", provider: "static" }),
    ]);
  });

  it("rejects a bad dimension, an unsupported model, and invalid input", async () => {
    expect(() => createStaticEmbeddingProvider({ dimension: 0, model: "dense-model" })).toThrow(
      "Static embedding dimension must be a positive integer",
    );

    const provider = createStaticEmbeddingProvider({ dimension: 2, model: "dense-model" });
    await expect(provider.embed({ model: "other", texts: ["x"] })).rejects.toThrow(
      "Embedding model other is not supported by static provider",
    );
    await expect(provider.embed({ model: "dense-model", texts: [] })).rejects.toBeInstanceOf(
      ProviderInputError,
    );
    await expect(provider.embed({ model: "", texts: ["x"] })).rejects.toBeInstanceOf(
      ProviderInputError,
    );
  });
});

describe("static reranker provider", () => {
  it("scores documents by query-term overlap and honors topN", async () => {
    const provider = createStaticRerankerProvider({ model: "rerank-model" });

    const result = await provider.rerank({
      documents: [
        { id: "doc-1", text: "beta gamma" },
        { id: "doc-2", text: "alpha beta" },
        { id: "doc-3", text: "nothing relevant" },
      ],
      model: "rerank-model",
      query: "alpha beta",
      topN: 2,
    });

    expect(provider.kind).toBe("static");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.document.id).toBe("doc-2");
    expect(result.items[0]?.score).toBeGreaterThanOrEqual(result.items[1]?.score ?? 0);
  });

  it("rejects an unsupported model and invalid input", async () => {
    const provider = createStaticRerankerProvider({ model: "rerank-model" });

    await expect(
      provider.rerank({ documents: [{ id: "d", text: "x" }], model: "other", query: "q" }),
    ).rejects.toThrow("Reranker model other is not supported by static provider");
    await expect(
      provider.rerank({ documents: [], model: "rerank-model", query: "q" }),
    ).rejects.toBeInstanceOf(ProviderInputError);
    await expect(
      provider.rerank({ documents: [{ id: "d", text: "x" }], model: "rerank-model", query: "  " }),
    ).rejects.toBeInstanceOf(ProviderInputError);
  });
});

describe("input validation and cache bounds", () => {
  const nullCache = {
    get: async () => null,
    set: async () => undefined,
  };

  it("rejects invalid embed inputs", async () => {
    const provider = createStaticEmbeddingProvider({ dimension: 2, model: "dense-model" });

    await expect(provider.embed({ inputType: "search_query", model: "dense-model", texts: [] }))
      .rejects.toThrow("must include at least one text");
    await expect(
      provider.embed({
        inputType: "search_query",
        model: "dense-model",
        texts: Array.from({ length: 129 }, () => "t"),
      }),
    ).rejects.toThrow("exceeds maxBatchSize=128");
    await expect(
      provider.embed({ inputType: "search_query", model: "dense-model", texts: [""] }),
    ).rejects.toThrow("text at index 0 is empty");
    await expect(
      provider.embed({
        inputType: "search_query",
        model: "dense-model",
        texts: ["x".repeat(70 * 1024)],
      }),
    ).rejects.toThrow("exceeds maxTextBytes=65536");
    await expect(
      provider.embed({ inputType: "search_query", model: "other-model", texts: ["hello"] }),
    ).rejects.toThrow("not supported by static provider");
  });

  it("rejects invalid rerank inputs", async () => {
    const reranker = createStaticRerankerProvider({ model: "rerank-model" });
    const document = { id: "d1", text: "refund policy" };

    await expect(
      reranker.rerank({ documents: [document], model: "  ", query: "refund" }),
    ).rejects.toThrow("model is required");
    await expect(
      reranker.rerank({ documents: [document], model: "rerank-model", query: " " }),
    ).rejects.toThrow("query is required");
    await expect(
      reranker.rerank({ documents: [], model: "rerank-model", query: "refund" }),
    ).rejects.toThrow("must include at least one document");
    await expect(
      reranker.rerank({
        documents: Array.from({ length: 129 }, (_, index) => ({ id: `d${index}`, text: "t" })),
        model: "rerank-model",
        query: "refund",
      }),
    ).rejects.toThrow("exceeds maxDocuments=128");
    await expect(
      reranker.rerank({
        documents: [document],
        model: "rerank-model",
        query: "refund",
        topN: 0,
      }),
    ).rejects.toThrow("topN must be a positive integer");
    await expect(
      reranker.rerank({
        documents: [{ id: " ", text: "t" }],
        model: "rerank-model",
        query: "refund",
      }),
    ).rejects.toThrow("must include an id");
    await expect(
      reranker.rerank({
        documents: [{ id: "d1", text: " " }],
        model: "rerank-model",
        query: "refund",
      }),
    ).rejects.toThrow("document at index 0 is empty");
    await expect(
      reranker.rerank({
        documents: [{ id: "d1", text: "x".repeat(70 * 1024) }],
        model: "rerank-model",
        query: "refund",
      }),
    ).rejects.toThrow("exceeds maxTextBytes=65536");
  });

  it("refuses cache entries larger than maxEntryBytes for embeddings and reranks", async () => {
    const embedding = createCachedEmbeddingProvider({
      cache: nullCache,
      maxEntryBytes: 8,
      provider: createStaticEmbeddingProvider({ dimension: 2, model: "dense-model" }),
    });
    await expect(
      embedding.embed({ inputType: "search_query", model: "dense-model", texts: ["hello"] }),
    ).rejects.toThrow("exceeds maxEntryBytes=8");

    const reranker = createCachedRerankerProvider({
      cache: nullCache,
      maxEntryBytes: 8,
      reranker: createStaticRerankerProvider({ model: "rerank-model" }),
    });
    await expect(
      reranker.rerank({
        documents: [{ id: "d1", text: "refund policy" }],
        model: "rerank-model",
        query: "refund",
      }),
    ).rejects.toThrow("exceeds maxEntryBytes=8");
    // Unknown models fail model resolution before caching.
    await expect(
      reranker.rerank({
        documents: [{ id: "d1", text: "t" }],
        model: "missing-model",
        query: "refund",
      }),
    ).rejects.toThrow("not supported by static provider");
  });

  it("validates plugin-daemon reranker construction", () => {
    const client = {
      dispatchDatasourceStream: async function* () {},
      dispatchStream: async function* () {},
      dispatchUnary: async () => ({}),
    };

    expect(() =>
      createPluginDaemonRerankerProvider({
        client,
        model: "rerank-1",
        pluginId: " ",
        provider: "cohere",
      }),
    ).toThrow("pluginId is required");
    expect(() =>
      createPluginDaemonRerankerProvider({
        client,
        model: "rerank-1",
        pluginId: "langgenius/cohere",
        provider: " ",
      }),
    ).toThrow("provider is required");
    expect(() =>
      createPluginDaemonRerankerProvider({
        client,
        model: " ",
        pluginId: "langgenius/cohere",
        provider: "cohere",
      }),
    ).toThrow("model is required");
  });
});
