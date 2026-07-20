import type { RerankDocumentsInput, RerankerProvider } from "@knowledge/embeddings";
import { describe, expect, it } from "vitest";

import type { HybridRetrievalItem } from "./retrieval-fusion";
import {
  RerankScoreContractError,
  evidenceTextFromHybridItem,
  rerankHybridRetrievalItems,
  rerankTextForHybridItem,
} from "./retrieval-rerank";

function item(overrides: Partial<HybridRetrievalItem> = {}): HybridRetrievalItem {
  return {
    citation: {
      artifactHash: "a".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41",
      documentVersion: 1,
      sectionPath: ["Handbook", "Policy"],
    },
    metadata: { text: "Plain text", ftsText: "FTS text" },
    nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
    permissionScope: ["tenant:tenant-1"],
    projectionIds: ["projection-a"],
    score: 0.42,
    sources: ["dense"],
    ...overrides,
  };
}

describe("retrieval rerank", () => {
  it("reranks hybrid items while preserving original citation data and clone isolation", async () => {
    const first = item({
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c81",
      projectionIds: ["projection-a"],
    });
    const second = item({
      metadata: { text: "Second text" },
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
      projectionIds: ["projection-b"],
      score: 0.21,
      sources: ["fts"],
    });
    const calls: RerankDocumentsInput[] = [];
    const reranker: RerankerProvider = {
      kind: "static",
      models: async () => [],
      rerank: async (input) => {
        calls.push(JSON.parse(JSON.stringify(input)));
        return {
          items: [
            {
              document: { id: second.nodeId, metadata: {}, text: "Second text" },
              index: 1,
              score: 0.97,
            },
            {
              document: { id: first.nodeId, metadata: {}, text: "Plain text" },
              index: 0,
              score: 0.44,
            },
          ],
          metadata: { model: "rerank-model", provider: "static" },
          model: "rerank-model",
        };
      },
    };

    const reranked = await rerankHybridRetrievalItems({
      items: [first, second],
      limit: 2,
      model: "rerank-model",
      query: "policy",
      reranker,
    });

    expect(calls).toEqual([
      {
        documents: [
          {
            id: first.nodeId,
            metadata: { projectionIds: ["projection-a"], sources: ["dense"] },
            text: "FTS text",
          },
          {
            id: second.nodeId,
            metadata: { projectionIds: ["projection-b"], sources: ["fts"] },
            text: "Second text",
          },
        ],
        model: "rerank-model",
        query: "policy",
        topN: 2,
      },
    ]);
    expect(reranked).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          rerankModel: "rerank-model",
          rerankScore: 0.97,
          retrievalScore: 0.21,
        }),
        nodeId: second.nodeId,
        score: 0.97,
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          rerankScore: 0.44,
          retrievalScore: 0.42,
        }),
        nodeId: first.nodeId,
        score: 0.44,
      }),
    ]);

    reranked[0]?.citation.sectionPath.push("mutated");
    expect(second.citation.sectionPath).toEqual(["Handbook", "Policy"]);
  });

  it("selects bounded text fallbacks for reranking and evidence snippets", async () => {
    expect(
      rerankTextForHybridItem(item({ metadata: { text: "Text fallback", ftsText: " " } })),
    ).toBe("Text fallback");
    expect(rerankTextForHybridItem(item({ metadata: {} }))).toBe("Handbook Policy");
    expect(
      rerankTextForHybridItem(
        item({ citation: { ...item().citation, sectionPath: [] }, metadata: {} }),
      ),
    ).toBe("018f0d60-7a49-7cc2-9c1b-5b36f18f2c81");
    expect(evidenceTextFromHybridItem(item({ metadata: { ftsText: "FTS fallback" } }))).toBe(
      "FTS fallback",
    );
    expect(
      evidenceTextFromHybridItem(
        item({ citation: { ...item().citation, sectionPath: [] }, metadata: {} }),
      ),
    ).toBe("018f0d60-7a49-7cc2-9c1b-5b36f18f2c81");
    await expect(
      rerankHybridRetrievalItems({
        items: [],
        limit: 2,
        model: "rerank-model",
        query: "policy",
        reranker: {
          kind: "static",
          models: async () => [],
          rerank: async () => {
            throw new Error("should not be called");
          },
        },
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    {
      label: "an out-of-range score",
      mutate: (result: RerankResultFixture) => ({
        ...result,
        items: [{ ...requiredFirstRerankItem(result), score: 1.01 }],
      }),
    },
    {
      label: "a non-finite score",
      mutate: (result: RerankResultFixture) => ({
        ...result,
        items: [{ ...requiredFirstRerankItem(result), score: Number.NaN }],
      }),
    },
    {
      label: "an unknown document",
      mutate: (result: RerankResultFixture) => ({
        ...result,
        items: [
          {
            ...requiredFirstRerankItem(result),
            document: { ...requiredFirstRerankItem(result).document, id: "unknown" },
          },
        ],
      }),
    },
    {
      label: "a duplicate document",
      mutate: (result: RerankResultFixture) => ({
        ...result,
        items: [requiredFirstRerankItem(result), requiredFirstRerankItem(result)],
      }),
    },
    {
      label: "an inconsistent source index",
      mutate: (result: RerankResultFixture) => ({
        ...result,
        items: [{ ...requiredFirstRerankItem(result), index: 1 }],
      }),
    },
    {
      label: "a different model identity",
      mutate: (result: RerankResultFixture) => ({ ...result, model: "other-model" }),
    },
  ])("fails closed when the provider returns $label", async ({ mutate }) => {
    const candidate = item();
    const result: RerankResultFixture = {
      items: [
        {
          document: { id: candidate.nodeId, metadata: {}, text: "Plain text" },
          index: 0,
          score: 0.75,
        },
      ],
      metadata: { model: "rerank-model", provider: "static" },
      model: "rerank-model",
    };

    await expect(
      rerankHybridRetrievalItems({
        items: [candidate],
        limit: 1,
        model: "rerank-model",
        query: "policy",
        reranker: {
          kind: "static",
          models: async () => [],
          rerank: async () => mutate(result),
        },
      }),
    ).rejects.toBeInstanceOf(RerankScoreContractError);
  });

  it("sorts valid normalized scores before final Top K", async () => {
    const first = item();
    const second = item({
      nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c82",
    });

    await expect(
      rerankHybridRetrievalItems({
        items: [first, second],
        limit: 2,
        model: "rerank-model",
        query: "policy",
        reranker: {
          kind: "static",
          models: async () => [],
          rerank: async () => ({
            items: [
              { document: { id: first.nodeId, metadata: {}, text: "first" }, index: 0, score: 0.2 },
              {
                document: { id: second.nodeId, metadata: {}, text: "second" },
                index: 1,
                score: 0.8,
              },
            ],
            metadata: { model: "rerank-model", provider: "static" },
            model: "rerank-model",
          }),
        },
      }),
    ).resolves.toMatchObject([{ nodeId: second.nodeId }, { nodeId: first.nodeId }]);
  });
});

type RerankResultFixture = Awaited<ReturnType<RerankerProvider["rerank"]>>;

function requiredFirstRerankItem(
  result: RerankResultFixture,
): RerankResultFixture["items"][number] {
  const first = result.items[0];
  if (!first) {
    throw new Error("rerank result fixture requires one item");
  }
  return first;
}
