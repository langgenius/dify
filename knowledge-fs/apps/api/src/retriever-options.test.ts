import {
  type DocumentOutlineRepository,
  type GraphIndexRepository,
  type PageIndexWholeTreeSelector,
  type PublishedPageIndexRepository,
  type ScorePageIndexSemanticCandidatesInput,
  createRetrievalPlanner,
} from "@knowledge/api";
import type {
  EmbeddingProvider,
  RerankDocumentsInput,
  RerankerProvider,
} from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import { HybridEmbeddingCapabilityUnavailableError, createApiRetriever } from "./retriever-options";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

/**
 * Regression guard for the apps/api retrieval wiring.
 *
 * The bug: `createBasicHybridRetriever` was wired without a `planner`, so every
 * request fell back to `defaultRetrievalPlan` ("fast"), making fast/deep/research
 * identical. With the planner threaded in, Deep expands dense recall while Research
 * reserves a wider dense fanout for semantic Value Search and skips FTS/fusion.
 */
async function maxDenseTopKForMode(mode: "deep" | "fast" | "research"): Promise<number> {
  const denseTopKs: number[] = [];
  const retriever = createApiRetriever({
    embeddingEnabled: true,
    planner: createRetrievalPlanner({ maxTopK: 100 }),
    repository: {
      searchDense: async (input) => {
        denseTopKs.push(input.topK);
        return [];
      },
      searchFts: async () => [],
    },
  });

  await retriever.retrieve({
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    limit: 5,
    mode,
    query: "policy renewal",
    queryVector: [0.1, 0.2, 0.3],
    topK: 10,
  });

  return denseTopKs.length === 0 ? 0 : Math.max(...denseTopKs);
}

describe("createApiRetriever planner wiring", () => {
  it("scales dense recall with the requested mode (topK=10, cap=100)", async () => {
    expect(await maxDenseTopKForMode("fast")).toBe(10);
    expect(await maxDenseTopKForMode("deep")).toBe(50);
    expect(await maxDenseTopKForMode("research")).toBe(100);
  });

  it("does not collapse Deep or Research semantic expansion into the Fast plan", async () => {
    const fast = await maxDenseTopKForMode("fast");

    expect(await maxDenseTopKForMode("deep")).toBeGreaterThan(fast);
    expect(await maxDenseTopKForMode("research")).toBeGreaterThan(fast);
  });

  it("emits one sanitized result metric for an Auto request at the outer retrieval boundary", async () => {
    const record = vi.fn();
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      metrics: { record },
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async () => [],
        searchFts: async () => [],
      },
    });

    await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      mode: "deep",
      query: "policy renewal",
      queryVector: [0.1, 0.2, 0.3],
      requestedMode: "auto",
      tenantId: "tenant-1",
      topK: 10,
      traceId: "trace-1",
    });

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith({
      candidateCount: 0,
      filteredCount: 0,
      mode: "auto",
      rerankMs: 0,
      resolvedMode: "deep",
      resultCount: 0,
      zeroResult: true,
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain("tenant-1");
    expect(JSON.stringify(record.mock.calls)).not.toContain(KNOWLEDGE_SPACE_ID);
    expect(JSON.stringify(record.mock.calls)).not.toContain("trace-1");
  });
});

describe("createApiRetriever embedding capability", () => {
  it.each(["fast", "deep", "research"] as const)(
    "fails %s closed before retrieval when dense embeddings are unavailable",
    async (mode) => {
      const searchDense = vi.fn(async () => []);
      const searchFts = vi.fn(async () => []);
      const retriever = createApiRetriever({
        embeddingEnabled: false,
        planner: createRetrievalPlanner({ maxTopK: 100 }),
        repository: { searchDense, searchFts },
      });

      await expect(
        retriever.retrieve({
          knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
          limit: 5,
          mode,
          query: "policy renewal",
          queryVector: [0],
          topK: 10,
        }),
      ).rejects.toBeInstanceOf(HybridEmbeddingCapabilityUnavailableError);
      expect(searchDense).not.toHaveBeenCalled();
      expect(searchFts).not.toHaveBeenCalled();
    },
  );
});

describe("createApiRetriever TiDB FTS readiness defense", () => {
  it("gates Fast/Deep before hybrid legs and keeps Research independent", async () => {
    const assertReady = vi.fn(async () => {
      throw new Error("posting repair pending");
    });
    const searchDense = vi.fn(async () => []);
    const searchFts = vi.fn(async () => []);
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      ftsReadiness: { assertReady },
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: { searchDense, searchFts },
    });
    const input = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      query: "policy renewal",
      queryVector: [0.1],
      tenantId: "tenant-1",
      topK: 10,
    } as const;

    for (const mode of ["fast", "deep"] as const) {
      await expect(retriever.retrieve({ ...input, mode })).rejects.toThrow(
        "posting repair pending",
      );
    }
    expect(assertReady).toHaveBeenCalledTimes(2);
    expect(searchDense).not.toHaveBeenCalled();
    expect(searchFts).not.toHaveBeenCalled();

    await expect(retriever.retrieve({ ...input, mode: "research" })).resolves.toMatchObject({
      items: [],
    });
    expect(assertReady).toHaveBeenCalledTimes(2);
  });
});

describe("createApiRetriever final rerank wiring", () => {
  it("reranks the full Fast fusion candidate set once without a fusion runtime", async () => {
    const denseSecond = {
      ...candidateWithGraphSeed(),
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      projectionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
    };
    const ftsPreferred = {
      ...candidateWithGraphSeed(),
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      projectionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
      source: "fts" as const,
    };
    const rerankCalls: string[][] = [];
    const reranker = preferredReranker(ftsPreferred.nodeId, rerankCalls);
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async () => [candidateWithGraphSeed(), denseSecond],
        searchFts: async () => [ftsPreferred],
      },
      rerankerOptions: { model: "rerank-model", provider: reranker },
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "fast",
      query: "policy renewal",
      queryVector: [0.1, 0.2, 0.3],
      topK: 3,
    });

    expect(rerankCalls).toHaveLength(1);
    expect(rerankCalls[0]).toHaveLength(3);
    expect(rerankCalls[0]).toEqual(
      expect.arrayContaining([
        candidateWithGraphSeed().nodeId,
        denseSecond.nodeId,
        ftsPreferred.nodeId,
      ]),
    );
    expect(result.items[0]).toMatchObject({
      metadata: { rerankModel: "rerank-model", rerankScore: 1 },
      nodeId: ftsPreferred.nodeId,
    });
    expect(result.metrics).toMatchObject({ rerankCandidates: 3 });
  });

  it("does not rerank Research retrieval", async () => {
    const rerankCalls: string[][] = [];
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async () => [candidateWithGraphSeed()],
        searchFts: async () => [],
      },
      rerankerOptions: {
        model: "rerank-model",
        provider: preferredReranker(candidateWithGraphSeed().nodeId, rerankCalls),
      },
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "research",
      query: "research policy renewal",
      queryVector: [0.1, 0.2, 0.3],
      topK: 3,
    });

    expect(rerankCalls).toEqual([]);
    expect(result.items[0]?.metadata.rerankScore).toBeUndefined();
    expect(result.metrics?.rerankCandidates).toBeUndefined();
  });

  it("selects the knowledge-space reranker and applies its threshold before final Top K", async () => {
    const firstCandidate = candidateWithGraphSeed();
    const secondCandidate = candidateWithId("018f0d60-7a49-7cc2-9c1b-5b36f18f2c51", "45");
    const thirdCandidate = candidateWithId("018f0d60-7a49-7cc2-9c1b-5b36f18f2c52", "46");
    const candidates = [firstCandidate, secondCandidate, thirdCandidate];
    const defaultReranker = preferredReranker(firstCandidate.nodeId, []);
    const defaultRerank = vi.spyOn(defaultReranker, "rerank");
    const selectedRerank = vi.fn(async (input: RerankDocumentsInput) => {
      const [firstDocument, secondDocument, thirdDocument] = input.documents;
      if (!firstDocument || !secondDocument || !thirdDocument) {
        throw new Error("Expected three rerank candidates");
      }

      return {
        // Deliberately put a below-threshold result between two passing results.
        // Filtering after an early `slice(0, limit)` would incorrectly lose the
        // third result, so this also guards the threshold/Top-K ordering.
        items: [
          rerankItem(firstDocument, 0, 0.95),
          rerankItem(secondDocument, 1, 0.4),
          rerankItem(thirdDocument, 2, 0.9),
        ],
        metadata: {
          model: input.model,
          provider: "dify-model-runtime" as const,
        },
        model: input.model,
      };
    });
    const selectedProvider = {
      kind: "dify-model-runtime",
      models: async () => [],
      rerank: selectedRerank,
    } satisfies RerankerProvider;
    const providerFactory = vi.fn(() => selectedProvider);
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async () => candidates,
        searchFts: async () => [],
      },
      rerankerOptions: {
        legacyDefaultConfigured: false,
        model: "deployment-default-reranker",
        provider: defaultReranker,
        providerFactory,
      },
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 2,
      mode: "fast",
      query: "policy renewal",
      queryVector: [0.1, 0.2, 0.3],
      retrievalProfile: retrievalProfile({
        rerank: {
          enabled: true,
          model: {
            model: "space-reranker-v2",
            pluginId: "vendor/reranker",
            provider: "vendor",
          },
        },
        scoreThreshold: { enabled: true, stage: "rerank", value: 0.8 },
      }),
      topK: 3,
    });

    expect(providerFactory).toHaveBeenCalledOnce();
    expect(providerFactory).toHaveBeenCalledWith({
      model: "space-reranker-v2",
      pluginId: "vendor/reranker",
      provider: "vendor",
    });
    expect(defaultRerank).not.toHaveBeenCalled();
    expect(selectedRerank).toHaveBeenCalledOnce();
    expect(selectedRerank.mock.calls[0]?.[0]).toMatchObject({
      model: "space-reranker-v2",
      topN: 3,
    });
    expect(result.items.map((item) => item.nodeId)).toEqual([
      firstCandidate.nodeId,
      thirdCandidate.nodeId,
    ]);
    expect(result.items.map((item) => item.score)).toEqual([0.95, 0.9]);
    expect(result.metrics).toMatchObject({
      rerankCandidates: 3,
      scoreThresholdFilteredCandidates: 1,
    });
  });

  it.each(["fast", "deep"] as const)(
    "fails closed when a %s profile enables reranking but no capability is installed",
    async (mode) => {
      const retriever = createApiRetriever({
        embeddingEnabled: true,
        planner: createRetrievalPlanner({ maxTopK: 100 }),
        repository: {
          searchDense: async () => [candidateWithGraphSeed()],
          searchFts: async () => [],
        },
      });

      await expect(
        retriever.retrieve({
          knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
          limit: 1,
          mode,
          query: "policy renewal",
          queryVector: [0.1, 0.2, 0.3],
          retrievalProfile: retrievalProfile({
            rerank: {
              enabled: true,
              model: {
                model: "space-reranker",
                pluginId: "vendor/reranker",
                provider: "vendor",
              },
            },
            scoreThreshold: { enabled: false, stage: "rerank" },
          }),
          topK: 3,
        }),
      ).rejects.toThrow(
        "Knowledge-space rerank is enabled, but the reranker capability is unavailable",
      );
    },
  );

  it("keeps Research independent of reranker capability even when the profile enables it", async () => {
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async () => [candidateWithGraphSeed()],
        searchFts: async () => [],
      },
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "research",
      query: "research policy renewal",
      queryVector: [0.1, 0.2, 0.3],
      retrievalProfile: retrievalProfile({
        rerank: {
          enabled: true,
          model: {
            model: "space-reranker",
            pluginId: "vendor/reranker",
            provider: "vendor",
          },
        },
        scoreThreshold: { enabled: false, stage: "rerank" },
      }),
      topK: 3,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.metadata.rerankScore).toBeUndefined();
  });

  it("rejects a Fast profile that explicitly turns mandatory reranking off", async () => {
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async () => [candidateWithGraphSeed()],
        searchFts: async () => [],
      },
    });

    await expect(
      retriever.retrieve({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 1,
        mode: "fast",
        query: "policy renewal",
        queryVector: [0.1, 0.2, 0.3],
        retrievalProfile: retrievalProfile({
          rerank: { enabled: false },
          scoreThreshold: { enabled: false, stage: "rerank" },
        }),
        topK: 3,
      }),
    ).rejects.toThrow("Knowledge-space Fast/Deep retrieval requires an enabled rerank model");
  });

  it("rejects a disabled knowledge-space rerank profile before resolving a provider", async () => {
    const defaultReranker = preferredReranker(candidateWithGraphSeed().nodeId, []);
    const defaultRerank = vi.spyOn(defaultReranker, "rerank");
    const providerFactory = vi.fn(() => defaultReranker);
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async () => [candidateWithGraphSeed()],
        searchFts: async () => [],
      },
      rerankerOptions: {
        model: "deployment-default-reranker",
        provider: defaultReranker,
        providerFactory,
      },
    });

    await expect(
      retriever.retrieve({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 1,
        mode: "fast",
        query: "policy renewal",
        queryVector: [0.1, 0.2, 0.3],
        retrievalProfile: retrievalProfile({
          rerank: { enabled: false },
          scoreThreshold: { enabled: false, stage: "rerank" },
        }),
        topK: 3,
      }),
    ).rejects.toThrow("Knowledge-space Fast/Deep retrieval requires an enabled rerank model");

    expect(providerFactory).not.toHaveBeenCalled();
    expect(defaultRerank).not.toHaveBeenCalled();
  });
});

describe("createApiRetriever dense and visual wiring", () => {
  it("embeds each query image as a query and fuses independent visual searches", async () => {
    const dense = vi.fn(async () => []);
    const fts = vi.fn(async () => []);
    const visualVectors: (readonly number[])[] = [];
    const embedImages = vi.fn(async (input) => {
      expect(input.inputType).toBe("query");
      expect(input.images).toHaveLength(2);
      return {
        dense: [
          [1, 0],
          [0, 1],
        ],
        metadata: { model: "clip", provider: "dify-model-runtime" as const },
        model: "clip",
      };
    });
    const retriever = createApiRetriever({
      embeddingEnabled: false,
      imageQuery: {
        mode: "fallback",
        model: "clip",
        provider: { embedImages, kind: "dify-model-runtime" },
      },
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: dense,
        searchFts: fts,
        searchVisualDense: async (input) => {
          visualVectors.push(input.queryVector);
          const suffix = input.queryVector[0] === 1 ? "51" : "52";
          return [
            {
              ...candidateWithId(`018f0d60-7a49-7cc2-9c1b-5b36f18f2c${suffix}`, suffix),
              source: "visual" as const,
            },
          ];
        },
      },
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      mode: "fast",
      query: "",
      queryImages: [resolvedQueryImage("01", [1]), resolvedQueryImage("02", [2])],
      queryVector: [],
      tenantId: "tenant-1",
      topK: 10,
    });

    expect(embedImages).toHaveBeenCalledOnce();
    expect(visualVectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(dense).not.toHaveBeenCalled();
    expect(fts).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item.sources.includes("visual"))).toBe(true);
    expect(result.metrics?.visualEmbeddingCandidates).toBe(2);
  });

  it("does not transfer an empty image result list's weight to another image", async () => {
    const retriever = createApiRetriever({
      embeddingEnabled: false,
      imageQuery: {
        mode: "fallback",
        model: "clip",
        provider: {
          embedImages: async () => ({
            dense: [
              [1, 0],
              [0, 1],
            ],
            metadata: { model: "clip", provider: "dify-model-runtime" as const },
            model: "clip",
          }),
          kind: "dify-model-runtime",
        },
      },
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async () => [],
        searchFts: async () => [],
        searchVisualDense: async (input) =>
          input.queryVector[0] === 1
            ? [
                {
                  ...candidateWithId("018f0d60-7a49-7cc2-9c1b-5b36f18f2c51", "51"),
                  source: "visual" as const,
                },
              ]
            : [],
      },
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      mode: "fast",
      query: "",
      queryImages: [resolvedQueryImage("01", [1]), resolvedQueryImage("02", [2])],
      queryVector: [],
      topK: 10,
    });

    expect(result.items[0]?.score).toBe(0.25);
  });

  it("reports a typed degradation when query-image visual retrieval is unavailable", async () => {
    const retriever = createApiRetriever({
      embeddingEnabled: false,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: { searchDense: async () => [], searchFts: async () => [] },
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      mode: "fast",
      query: "",
      queryImages: [resolvedQueryImage("01", [1])],
      queryVector: [],
      topK: 10,
    });

    expect(result.metrics?.degradationFlags).toContain("query-image-visual-leg-unavailable");
  });

  it("passes the fixed publication id to dense, FTS, and visual legs", async () => {
    const publicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
    const tenantId = "tenant-1";
    const projectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
    const denseScopes: unknown[] = [];
    const ftsScopes: unknown[] = [];
    const visualScopes: unknown[] = [];
    const visualEmbeddingScopes: unknown[] = [];
    let visualEmbedCalls = 0;
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      pageIndex: {
        listOutlines: async () => ({ items: [] }),
        openLeafEvidence: async () => {
          throw new Error("unused");
        },
      },
      pageIndexSemanticTreeSearch: { score: async () => [] },
      pageIndexWholeTreeSelector: wholeTreeSelectorStub(),
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      publishedProjectionMembership: {
        filterComponentKeys: async (input) =>
          input.componentKeys.filter((componentKey) => componentKey === projectionId),
      },
      repository: {
        searchDense: async (input) => {
          denseScopes.push(input);
          return [];
        },
        searchFts: async (input) => {
          ftsScopes.push(input);
          return [];
        },
        searchVisualDense: async (input) => {
          visualScopes.push(input);
          return [
            {
              ...candidateWithGraphSeed(),
              nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
              projectionId,
              source: "visual" as const,
            },
          ];
        },
      },
      strictPublishedReads: true,
      visualQuery: {
        mode: "fallback",
        model: "clip",
        provider: {
          embed: async (input) => {
            visualEmbedCalls += 1;
            visualEmbeddingScopes.push(input);
            return {
              dense: [[0.9, 0.8]],
              metadata: { model: "clip", provider: "static" as const },
              model: "clip",
            };
          },
          kind: "static",
          models: async () => [],
        },
      },
    });

    await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      mode: "fast",
      projectionSnapshot: {
        fingerprint: `projection-set-sha256:${"a".repeat(64)}`,
        headRevision: 1,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        projectionVersion: 1,
        publicationId,
        tenantId,
      },
      permissionScope: [],
      query: "architecture diagram",
      queryVector: [0.1, 0.2, 0.3],
      topK: 10,
    });

    expect(denseScopes[0]).toMatchObject({
      projectionSetPublicationId: publicationId,
      tenantId,
    });
    expect(ftsScopes[0]).toMatchObject({
      projectionSetPublicationId: publicationId,
      tenantId,
    });
    expect(visualScopes[0]).toMatchObject({
      projectionSetPublicationId: publicationId,
      tenantId,
    });
    expect(visualEmbeddingScopes[0]).toMatchObject({ tenantId });
    expect(visualEmbedCalls).toBe(1);

    await expect(
      retriever.retrieve({
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        limit: 1,
        mode: "fast",
        query: "missing snapshot",
        queryVector: [0.1],
        tenantId,
        topK: 1,
      }),
    ).rejects.toThrow("requires a published projection snapshot");
    expect(visualEmbedCalls).toBe(1);
  });

  it("rejects a strict production stack without the independent published PageIndex", () => {
    expect(() =>
      createApiRetriever({
        embeddingEnabled: true,
        repository: {
          searchDense: async () => [],
          searchFts: async () => [],
        },
        strictPublishedReads: true,
      }),
    ).toThrow("requires the independent published PageIndex repository");
  });

  it("keeps text and visual query vectors in their matching vector spaces", async () => {
    const textVectors: (readonly number[])[] = [];
    const visualModels: string[] = [];
    const visualVectors: (readonly number[])[] = [];
    const visualProvider = {
      embed: async () => ({
        dense: [[0.9, 0.8]],
        metadata: { model: "clip", provider: "static" as const },
        model: "clip",
      }),
      kind: "static" as const,
      models: async () => [],
    } satisfies EmbeddingProvider;
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async (input) => {
          textVectors.push(input.queryVector);
          return [];
        },
        searchFts: async () => [],
        searchVisualDense: async (input) => {
          visualModels.push(input.denseProjectionModel ?? "");
          visualVectors.push(input.queryVector);
          return [
            {
              ...candidateWithGraphSeed(),
              metadata: {
                multimodal: { projectionRole: "visual-asset" },
                nodeKind: "image",
              },
              nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
              projectionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
              source: "visual" as const,
            },
          ];
        },
      },
      visualQuery: {
        model: "clip",
        mode: "fallback",
        provider: visualProvider,
      },
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      mode: "fast",
      query: "architecture diagram",
      queryVector: [0.1, 0.2, 0.3],
      topK: 10,
    });

    expect(textVectors).toEqual([[0.1, 0.2, 0.3]]);
    expect(visualModels).toEqual(["clip"]);
    expect(visualVectors).toEqual([[0.9, 0.8]]);
    expect(result.items[0]?.score).toBe(0.5);
    expect(result.items[0]?.sources).toEqual(["visual"]);
    expect(result.metrics?.visualEmbeddingCandidates).toBe(1);
  });

  it("uses fallback visual retrieval only when text retrieval has no evidence", async () => {
    let visualEmbedCalls = 0;
    const visualProvider = {
      embed: async () => {
        visualEmbedCalls += 1;
        return {
          dense: [[0.9, 0.8]],
          metadata: { model: "clip", provider: "static" as const },
          model: "clip",
        };
      },
      kind: "static" as const,
      models: async () => [],
    } satisfies EmbeddingProvider;
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      repository: {
        searchDense: async () => [candidateWithGraphSeed()],
        searchFts: async () => [],
        searchVisualDense: async () => [],
      },
      visualQuery: {
        model: "clip",
        mode: "fallback",
        provider: visualProvider,
      },
    });

    await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      mode: "fast",
      query: "policy renewal",
      queryVector: [0.1, 0.2, 0.3],
      topK: 10,
    });

    expect(visualEmbedCalls).toBe(0);
  });
});

function resolvedQueryImage(suffix: string, bytes: number[]) {
  const body = new Uint8Array(bytes);
  return {
    body,
    byteSize: body.byteLength,
    mimeType: "image/png" as const,
    sha256: suffix.padEnd(64, "a"),
    uploadFileId: `00000000-0000-4000-8000-0000000000${suffix}`,
  };
}

describe("createApiRetriever PageIndex outline wiring", () => {
  it("uses saved outlines for research but not deep retrieval", async () => {
    const outlineLookups: unknown[] = [];
    const outlines = {
      getByDocumentVersion: async (input: unknown) => {
        outlineLookups.push(input);
        return {
          artifactHash: "a".repeat(64),
          createdAt: "2026-05-12T12:00:00.000Z",
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d81",
          knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
          metadata: {},
          nodes: [
            {
              childNodeIds: [],
              children: [],
              id: "outline-guide",
              level: 1,
              metadata: {},
              sectionPath: ["Guide"],
              sourceElementIds: [],
              sourceNodeIds: [],
              summary: "Guide section",
              title: "Guide",
              tocSource: "parser-heading",
            },
          ],
          outlineVersion: "document-outline-v1",
          parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
          version: 1,
        };
      },
    } as unknown as DocumentOutlineRepository;
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      outlines,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async (input) =>
          input.filters?.nodeKinds?.includes("summary")
            ? []
            : [
                {
                  ...candidateWithGraphSeed(),
                  metadata: { nodeKind: "chunk" },
                },
              ],
        searchFts: async () => [],
      },
    });
    const input = {
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      query: "policy renewal",
      queryVector: [0.1, 0.2, 0.3],
      topK: 10,
    } as const;

    const research = await retriever.retrieve({ ...input, mode: "research" });
    expect(research.items[0]?.metadata.reasoningTreeSearch).toMatchObject({
      selectedNodeId: "outline-guide",
      strategy: "document-outline-guided-v1",
    });
    expect(outlineLookups).toHaveLength(1);

    const deep = await retriever.retrieve({ ...input, mode: "deep" });
    expect(deep.items[0]?.metadata.documentOutline).toBeUndefined();
    expect(outlineLookups).toHaveLength(1);
  });

  it("uses published semantic Value Search plus LLM PageIndex scoring without FTS, Graph, or reranking", async () => {
    const denseCandidate = {
      ...candidateWithGraphSeed(),
      metadata: { text: "Published camera warranty evidence" },
      score: 0.92,
    };
    const dense = vi.fn(async () => [denseCandidate]);
    const fts = vi.fn(async () => []);
    const rerankCalls: string[][] = [];
    const traverse = vi.fn(async () => ({
      entities: [],
      relations: [],
      timedOut: false,
    }));
    const graph = { traverse } as unknown as GraphIndexRepository;
    const pageIndex = publishedPageIndexFixture();
    const score = vi.fn(async (input: ScorePageIndexSemanticCandidatesInput) =>
      input.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        reason: "Direct warranty evidence",
        score: 0.96,
      })),
    );
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      graph,
      pageIndex,
      pageIndexSemanticTreeSearch: { score },
      pageIndexWholeTreeSelector: wholeTreeSelectorStub(0.96, "Direct warranty evidence"),
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        publishedMembershipEnforced: true,
        searchDense: dense,
        searchFts: fts,
      },
      rerankerOptions: {
        model: "rerank-model",
        provider: preferredReranker("irrelevant", rerankCalls),
      },
    });

    const result = await retriever.retrieve({
      denseProjectionModel: "embedding-space-v1",
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      mode: "research",
      permissionScope: [],
      projectionSnapshot: {
        fingerprint: `projection-set-sha256:${"b".repeat(64)}`,
        headRevision: 2,
        knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
        projectionVersion: 1,
        publicationId: "publication-1",
        tenantId: "tenant-1",
      },
      query: "camera warranty sensor",
      queryVector: [0.1, 0.2],
      retrievalProfile: {
        defaultMode: "research",
        reasoningModel: {
          model: "chat",
          pluginId: "vendor/chat",
          provider: "vendor",
        },
        rerank: {
          enabled: true,
          model: {
            model: "rerank",
            pluginId: "vendor/rerank",
            provider: "vendor",
          },
        },
        revision: 1,
        scoreThreshold: { enabled: false, stage: "mode-final" },
        topK: 5,
      },
      tenantId: "tenant-1",
      topK: 5,
    });

    expect(dense).toHaveBeenCalledOnce();
    expect(score).not.toHaveBeenCalled();
    expect(fts).not.toHaveBeenCalled();
    expect(traverse).not.toHaveBeenCalled();
    expect(rerankCalls).toEqual([]);
    expect(result.items[0]).toMatchObject({
      metadata: {
        pageIndex: {
          llmReason: "Direct warranty evidence",
          scoreVersion: "pageindex-semantic-llm-v1",
        },
      },
      score: 0.96,
      sources: ["pageindex", "dense"],
    });
  });
});

function wholeTreeSelectorStub(score = 0.8, reason = "semantic match"): PageIndexWholeTreeSelector {
  return {
    select: async (input) => ({
      estimatedPromptTokens: 100,
      nodeCount: input.outline.nodes.length,
      selections: input.outline.nodes[0]
        ? [{ nodeId: input.outline.nodes[0].id, reason, score }]
        : [],
      strategy: "whole-tree",
      summaryCoverage: 1,
    }),
  };
}

function publishedPageIndexFixture(): PublishedPageIndexRepository {
  const denseCandidate = candidateWithGraphSeed();
  const outlineNode = {
    childNodeIds: [],
    children: [],
    endOffset: 10,
    id: "outline-guide",
    level: 1,
    metadata: {},
    sectionPath: ["Guide"],
    sourceElementIds: [],
    sourceNodeIds: [],
    startOffset: 0,
    summary: "Published camera warranty guide",
    title: "Guide",
    tocSource: "parser-heading" as const,
  };
  const outline = {
    artifactHash: denseCandidate.citation.artifactHash,
    createdAt: "2026-08-05T00:00:00.000Z",
    documentAssetId: denseCandidate.citation.documentAssetId,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c60",
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    metadata: {},
    nodes: [outlineNode],
    outlineVersion: "outline-v1",
    parseArtifactId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c61",
    publicationGenerationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c62",
    version: 1,
  };
  return {
    listOutlines: async (input) => ({
      items: input.documentAssetIds?.includes(outline.documentAssetId)
        ? [
            {
              documentAssetId: outline.documentAssetId,
              generationId: outline.publicationGenerationId,
              outline,
              publicationId: input.publicationId,
            },
          ]
        : [],
    }),
    openLeafEvidence: async (input) => ({
      items: [
        {
          citation: denseCandidate.citation,
          node: {
            artifactHash: denseCandidate.citation.artifactHash,
            documentAssetId: denseCandidate.citation.documentAssetId,
            endOffset: 10,
            id: denseCandidate.nodeId,
            kind: "chunk",
            knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
            metadata: denseCandidate.metadata,
            parseArtifactId: outline.parseArtifactId,
            permissionScope: denseCandidate.permissionScope,
            publicationGenerationId: outline.publicationGenerationId,
            sourceLocation: denseCandidate.citation,
            startOffset: 0,
            text: "Published camera warranty evidence",
          },
          outlineId: outline.id,
          outlineNodeId: input.outlineNodeId,
          projections: [{ id: denseCandidate.projectionId, type: "dense-vector" }],
        },
      ],
      openedRange: { endOffset: 10, startOffset: 0 },
      outline,
      selectedNode: outlineNode,
      truncated: false,
    }),
  };
}

/** A base dense hit that carries a graph entity id, so graph expansion can seed from it. */
function candidateWithGraphSeed() {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      documentVersion: 1,
      endOffset: 10,
      sectionPath: ["Guide"],
      startOffset: 0,
    },
    metadata: { nodeMetadata: { graphEntityIds: ["entity-1"] } },
    nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    permissionScope: [] as string[],
    projectionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    score: 0.9,
    source: "dense" as const,
  };
}

function candidateWithId(nodeId: string, projectionSuffix: string) {
  return {
    ...candidateWithGraphSeed(),
    nodeId,
    projectionId: `018f0d60-7a49-7cc2-9c1b-5b36f18f2c${projectionSuffix}`,
  };
}

function rerankItem(
  document: {
    readonly id: string;
    readonly metadata?: Record<string, unknown>;
    readonly text: string;
  },
  index: number,
  score: number,
) {
  return {
    document: {
      ...document,
      metadata: { ...(document.metadata ?? {}) },
    },
    index,
    score,
  };
}

function retrievalProfile({
  rerank,
  scoreThreshold,
}: {
  readonly rerank:
    | { readonly enabled: false }
    | {
        readonly enabled: true;
        readonly model: {
          readonly model: string;
          readonly pluginId: string;
          readonly provider: string;
        };
      };
  readonly scoreThreshold:
    | { readonly enabled: false; readonly stage: "rerank" }
    | {
        readonly enabled: true;
        readonly stage: "rerank";
        readonly value: number;
      };
}) {
  return {
    defaultMode: "fast" as const,
    reasoningModel: {
      model: "space-reasoning-model",
      pluginId: "vendor/chat",
      provider: "vendor",
    },
    rerank,
    revision: 3,
    scoreThreshold,
    topK: 3,
  };
}

function traversalEntity(overrides: Record<string, unknown>) {
  return {
    aliases: [] as string[],
    canonicalKey: "term:related",
    confidence: 0.9,
    createdAt: "2026-05-12T12:00:00.000Z",
    depth: 1,
    extractionVersion: 1,
    knowledgeSpaceId: "space-1",
    metadata: {},
    name: "Related",
    permissionScope: [] as string[],
    sourceNodeIds: [] as string[],
    type: "term",
    updatedAt: "2026-05-12T12:00:00.000Z",
    ...overrides,
  };
}

type TraverseInput = {
  fanout: number;
  knowledgeSpaceId: string;
  maxDepth: number;
  maxNodes: number;
  startEntityId: string;
  timeoutMs: number;
};

describe("createApiRetriever graph expansion", () => {
  function graphSpy() {
    const traverseCalls: TraverseInput[] = [];
    const graph = {
      traverse: async (input: TraverseInput) => {
        traverseCalls.push(input);

        return {
          entities: [traversalEntity({ id: "entity-2" })],
          metrics: {
            depthReached: 1,
            elapsedMs: 1,
            exploredRelations: 0,
            fanout: 20,
            maxDepth: 2,
            maxNodes: 50,
            timedOut: false,
          },
          relations: [],
          truncated: false,
        };
      },
    } as unknown as GraphIndexRepository;

    return { graph, traverseCalls };
  }

  async function retrieve(
    mode: "deep" | "fast" | "research",
    graph: GraphIndexRepository,
    graphExpansion?: Parameters<typeof createApiRetriever>[0]["graphExpansion"],
  ) {
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      graph,
      ...(graphExpansion ? { graphExpansion } : {}),
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async () => [candidateWithGraphSeed()],
        searchFts: async () => [],
      },
    });

    return retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 5,
      mode,
      query: "acme refund",
      queryVector: [0.1, 0.2, 0.3],
      topK: 10,
    });
  }

  it("seeds graph traversal from matched entities in deep mode", async () => {
    const { graph, traverseCalls } = graphSpy();

    const result = await retrieve("deep", graph);

    expect(traverseCalls.map((call) => call.startEntityId)).toContain("entity-1");
    // Expansion observability lands in the retrieval metrics.
    expect(result.metrics).toMatchObject({
      graphExpansionSeeds: 1,
      graphExpansionTimedOut: false,
    });
    expect(typeof result.metrics?.graphExpansionMs).toBe("number");
  });

  it("does not run graph traversal in fast mode", async () => {
    const { graph, traverseCalls } = graphSpy();

    await retrieve("fast", graph);

    expect(traverseCalls).toEqual([]);
  });

  it("does not run graph traversal in research mode", async () => {
    const { graph, traverseCalls } = graphSpy();

    await retrieve("research", graph);

    expect(traverseCalls).toEqual([]);
  });

  it("threads env-derived graphExpansion knobs into the traversal", async () => {
    const { graph, traverseCalls } = graphSpy();

    await retrieve("deep", graph, {
      fanout: 7,
      graphBoost: 0.4,
      graphTopK: 3,
      maxDepth: 1,
      maxSeedEntities: 2,
      maxTraversalNodes: 9,
      timeoutMs: 111,
    });

    expect(traverseCalls[0]).toMatchObject({
      fanout: 7,
      maxDepth: 1,
      maxNodes: 9,
      timeoutMs: 111,
    });
  });

  it("reranks ordinary and graph-only Deep candidates together in one final pass", async () => {
    const { graph } = graphSpy();
    const graphOnly = {
      ...candidateWithGraphSeed(),
      metadata: { nodeMetadata: { graphEntityIds: ["entity-2"] } },
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
      projectionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
    };
    const rerankCalls: string[][] = [];
    const retriever = createApiRetriever({
      embeddingEnabled: true,
      graph,
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      repository: {
        searchDense: async (input) =>
          input.filters?.entities?.includes("entity-2") ? [graphOnly] : [candidateWithGraphSeed()],
        searchFts: async () => [],
      },
      rerankerOptions: {
        model: "rerank-model",
        provider: preferredReranker(graphOnly.nodeId, rerankCalls),
      },
    });

    const result = await retriever.retrieve({
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      mode: "deep",
      query: "acme refund",
      queryVector: [0.1, 0.2, 0.3],
      topK: 2,
    });

    expect(rerankCalls).toEqual([
      expect.arrayContaining([candidateWithGraphSeed().nodeId, graphOnly.nodeId]),
    ]);
    expect(rerankCalls[0]).toHaveLength(2);
    expect(result.items[0]?.nodeId).toBe(graphOnly.nodeId);
    expect(result.metrics).toMatchObject({
      graphExpansionCandidates: 1,
      rerankCandidates: 2,
    });
  });
});

function preferredReranker(preferredNodeId: string, calls: string[][]): RerankerProvider {
  return {
    kind: "static",
    models: async () => [],
    rerank: async (input) => {
      calls.push(input.documents.map((document) => document.id));
      const documents = [...input.documents].sort((first, second) =>
        first.id === preferredNodeId ? -1 : second.id === preferredNodeId ? 1 : 0,
      );

      return {
        items: documents.map((document, rank) => ({
          document: {
            ...document,
            metadata: { ...(document.metadata ?? {}) },
          },
          index: input.documents.findIndex((candidate) => candidate.id === document.id),
          score: 1 - rank / 10,
        })),
        metadata: { model: input.model, provider: "static" },
        model: input.model,
      };
    },
  };
}
