import {
  type KnowledgeSpaceRetrievalProfile,
  KnowledgeSpaceRetrievalProfileModeError,
} from "@knowledge/core";
import type { RerankerProvider } from "@knowledge/embeddings";
import { describe, expect, it, vi } from "vitest";

import { createFinalRerankRetrieval } from "./final-rerank-retrieval";
import { createRetrievalPlanner } from "./retrieval-planner";
import type { BasicHybridRetriever, RetrieveHybridInput } from "./retrieval-types";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

describe("final rerank capability gating", () => {
  it("uses a knowledge-space factory without requiring a legacy deployment default", async () => {
    const factory = vi.fn(() => passThroughReranker());
    const retriever = createFinalRerankRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      rerankerFactory: factory,
      retriever: baseRetriever(),
    });

    const result = await retriever.retrieve(input("fast", enabledProfile()));

    expect(factory).toHaveBeenCalledWith({
      model: "space-reranker",
      pluginId: "vendor/reranker",
      provider: "vendor",
    });
    expect(result.items[0]?.metadata).toMatchObject({
      rerankModel: "space-reranker",
      rerankScore: 0.9,
    });
  });

  it.each(["fast", "deep"] as const)(
    "fails closed for %s when the profile requires an unavailable capability",
    async (mode) => {
      const retriever = createFinalRerankRetrieval({
        planner: createRetrievalPlanner({ maxTopK: 100 }),
        retriever: baseRetriever(),
      });

      await expect(retriever.retrieve(input(mode, enabledProfile()))).rejects.toThrow(
        "Knowledge-space rerank is enabled, but the reranker capability is unavailable",
      );
    },
  );

  it("propagates a space-selected Deep reranker failure without retrying or returning unreranked candidates", async () => {
    const base = baseRetriever();
    const baseRetrieve = vi.spyOn(base, "retrieve");
    const rerank = vi.fn(async () => {
      throw new Error("space reranker unavailable");
    });
    const factory = vi.fn(
      (): RerankerProvider => ({
        kind: "static",
        models: async () => [],
        rerank,
      }),
    );
    const retriever = createFinalRerankRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      rerankerFactory: factory,
      retriever: base,
    });

    await expect(retriever.retrieve(input("deep", enabledProfile()))).rejects.toThrow(
      "space reranker unavailable",
    );
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith({
      model: "space-reranker",
      pluginId: "vendor/reranker",
      provider: "vendor",
    });
    expect(baseRetrieve).toHaveBeenCalledOnce();
    expect(rerank).toHaveBeenCalledOnce();
  });

  it("does not require or resolve reranking for Research", async () => {
    const base = baseRetriever();
    const retriever = createFinalRerankRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: base,
    });

    const result = await retriever.retrieve(input("research", enabledProfile()));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.metadata.rerankScore).toBeUndefined();
  });

  it("does not require a capability when the profile explicitly disables reranking", async () => {
    const retriever = createFinalRerankRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: baseRetriever(),
    });

    const result = await retriever.retrieve(input("fast", disabledProfile()));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.metadata.rerankScore).toBeUndefined();
  });

  it.each(["fast", "deep"] as const)(
    "fails closed for %s when a mode-final threshold has no reranker",
    async (mode) => {
      const base = baseRetriever();
      const baseRetrieve = vi.spyOn(base, "retrieve");
      const retriever = createFinalRerankRetrieval({
        planner: createRetrievalPlanner({ maxTopK: 100 }),
        retriever: base,
      });

      const promise = retriever.retrieve(
        input(mode, {
          ...disabledProfile(),
          defaultMode: mode,
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.5 },
        }),
      );
      await expect(promise).rejects.toMatchObject({
        code: "RETRIEVAL_PROFILE_SCORE_THRESHOLD_REQUIRES_RERANK",
        mode,
      });
      await expect(promise).rejects.toBeInstanceOf(KnowledgeSpaceRetrievalProfileModeError);
      expect(baseRetrieve).not.toHaveBeenCalled();
    },
  );

  it("allows the same threshold-without-rerank profile for Research runtime calls", async () => {
    const base = baseRetriever();
    const baseRetrieve = vi.spyOn(base, "retrieve");
    const retriever = createFinalRerankRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      retriever: base,
    });

    await expect(
      retriever.retrieve(
        input("research", {
          ...disabledProfile(),
          defaultMode: "research",
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.5 },
        }),
      ),
    ).resolves.toMatchObject({ items: expect.any(Array) });
    expect(baseRetrieve).toHaveBeenCalledOnce();
  });

  it("preserves the configured legacy default for requests without a profile", async () => {
    const reranker = passThroughReranker();
    const rerank = vi.spyOn(reranker, "rerank");
    const retriever = createFinalRerankRetrieval({
      planner: createRetrievalPlanner({ maxTopK: 100 }),
      reranker,
      rerankerModel: "legacy-reranker",
      retriever: baseRetriever(),
    });

    const result = await retriever.retrieve(input("fast"));

    expect(rerank).toHaveBeenCalledOnce();
    expect(result.items[0]?.metadata.rerankModel).toBe("legacy-reranker");
  });
});

function baseRetriever(): BasicHybridRetriever {
  return {
    retrieve: async () => ({
      items: [
        {
          citation: {
            artifactHash: "a".repeat(64),
            documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
            documentVersion: 1,
            sectionPath: ["Policy"],
          },
          metadata: { text: "Policy renewal" },
          nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
          permissionScope: [],
          projectionIds: ["projection-a"],
          score: 0.5,
          sources: ["dense"],
        },
      ],
    }),
  };
}

function passThroughReranker(): RerankerProvider {
  return {
    kind: "static",
    models: async () => [],
    rerank: async (rerankInput) => ({
      items: rerankInput.documents.map((document, index) => ({
        document: {
          ...document,
          metadata: { ...(document.metadata ?? {}) },
        },
        index,
        score: 0.9 - index / 10,
      })),
      metadata: { model: rerankInput.model, provider: "static" },
      model: rerankInput.model,
    }),
  };
}

function input(
  mode: "deep" | "fast" | "research",
  retrievalProfile?: KnowledgeSpaceRetrievalProfile,
): RetrieveHybridInput {
  return {
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    limit: 1,
    mode,
    query: "policy renewal",
    queryVector: [0.1],
    ...(retrievalProfile ? { retrievalProfile } : {}),
    topK: 3,
  };
}

function enabledProfile(): KnowledgeSpaceRetrievalProfile {
  return {
    defaultMode: "fast",
    reasoningModel: {
      model: "space-reasoning",
      pluginId: "vendor/chat",
      provider: "vendor",
    },
    rerank: {
      enabled: true,
      model: {
        model: "space-reranker",
        pluginId: "vendor/reranker",
        provider: "vendor",
      },
    },
    revision: 1,
    scoreThreshold: { enabled: false, stage: "rerank" },
    topK: 3,
  };
}

function disabledProfile(): KnowledgeSpaceRetrievalProfile {
  return {
    ...enabledProfile(),
    rerank: { enabled: false },
  };
}
