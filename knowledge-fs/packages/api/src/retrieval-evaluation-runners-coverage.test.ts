import type { GoldenQuestion } from "@knowledge/core";
import type { EmbedTextsInput, EmbeddingProvider } from "@knowledge/embeddings";
import { describe, expect, it } from "vitest";

import type {
  GoldenQuestionRepository,
  ListGoldenQuestionsResult,
} from "./golden-question-repository";
import type { HybridRetrievalRepository, RetrievalCandidate } from "./retrieval-candidates";
import {
  createAbRetrievalStrategyComparisonRunner,
  createAdvancedRetrievalEvaluationRunner,
  createRetrievalEvaluationRunner,
  createRetrievalImpactEvaluationRunner,
  createRetrievalStrategyComparisonRunner,
} from "./retrieval-evaluation-runners";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import type { BasicHybridRetriever } from "./retrieval-types";

const KNOWLEDGE_SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const QUESTION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e01";
const EVIDENCE_NODE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2e02";
const CURSOR = { createdAt: "2026-01-01T00:00:00.000Z", id: QUESTION_ID };
const NEXT_CURSOR = { createdAt: "2026-01-02T00:00:00.000Z", id: EVIDENCE_NODE_ID };

function goldenQuestion(overrides: Partial<GoldenQuestion> = {}): GoldenQuestion {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    expectedEvidenceIds: [EVIDENCE_NODE_ID],
    id: QUESTION_ID,
    knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
    metadata: {},
    question: "What is the refund policy?",
    tags: ["policy"],
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function questionRepository(page: ListGoldenQuestionsResult): GoldenQuestionRepository & {
  readonly listCalls: Parameters<GoldenQuestionRepository["listTrusted"]>[0][];
} {
  const listCalls: Parameters<GoldenQuestionRepository["listTrusted"]>[0][] = [];

  return {
    create: async () => {
      throw new Error("create is not used by evaluation runners");
    },
    delete: async () => {
      throw new Error("delete is not used by evaluation runners");
    },
    get: async () => {
      throw new Error("get is not used by evaluation runners");
    },
    getTrusted: async () => {
      throw new Error("getTrusted is not used by evaluation runners");
    },
    list: async () => {
      throw new Error("list is not used by evaluation runners");
    },
    listTrusted: async (input) => {
      listCalls.push(input);

      return page;
    },
    listCalls,
    update: async () => {
      throw new Error("update is not used by evaluation runners");
    },
  };
}

/**
 * An embedding provider that reports the right number of vectors but leaves every slot
 * unset (a holey array), so runners must fall back to empty query vectors.
 */
function sparseEmbeddings({
  returnHoles = false,
}: {
  readonly returnHoles?: boolean;
} = {}): EmbeddingProvider & { readonly embedCalls: EmbedTextsInput[] } {
  const embedCalls: EmbedTextsInput[] = [];

  return {
    embed: async (input) => {
      embedCalls.push(input);

      return {
        dense: returnHoles
          ? new Array<number[]>(input.texts.length)
          : input.texts.map(() => [0.1, 0.2]),
        metadata: {
          ...(returnHoles ? {} : { dimension: 2 }),
          model: input.model,
          provider: "static",
        },
        model: input.model,
      };
    },
    embedCalls,
    kind: "static",
    models: async () => [],
  };
}

function retrievalItem(overrides: Partial<HybridRetrievalItem> = {}): HybridRetrievalItem {
  return {
    citation: {
      artifactHash: "b".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      documentVersion: 1,
      sectionPath: ["Guide"],
    },
    metadata: { text: "Refunds require approval." },
    nodeId: EVIDENCE_NODE_ID,
    permissionScope: [],
    projectionIds: ["projection-1"],
    score: 0.9,
    sources: ["dense"],
    ...overrides,
  };
}

function recordingRetriever(items: readonly HybridRetrievalItem[]): BasicHybridRetriever & {
  readonly retrieveCalls: Parameters<BasicHybridRetriever["retrieve"]>[0][];
} {
  const retrieveCalls: Parameters<BasicHybridRetriever["retrieve"]>[0][] = [];

  return {
    retrieve: async (input) => {
      retrieveCalls.push({ ...input, queryVector: [...input.queryVector] });

      return { items: items.map((item) => ({ ...item })) };
    },
    retrieveCalls,
  };
}

function retrievalCandidate(overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return {
    citation: {
      artifactHash: "b".repeat(64),
      documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      documentVersion: 1,
      sectionPath: ["Guide"],
    },
    metadata: { text: "Refunds require approval." },
    nodeId: EVIDENCE_NODE_ID,
    permissionScope: [],
    projectionId: "projection-1",
    score: 0.8,
    source: "dense",
    ...overrides,
  };
}

const RUNNER_BOUNDS = { maxQuestions: 10, maxTopK: 10 };
const RUN_INPUT = { cursor: CURSOR, knowledgeSpaceId: KNOWLEDGE_SPACE_ID, limit: 5, topK: 3 };
const EMPTY_PAGE: ListGoldenQuestionsResult = { items: [], nextCursor: NEXT_CURSOR };

describe("retrieval evaluation runners branch coverage", () => {
  it("passes the cursor through and returns an empty paged report", async () => {
    const goldenQuestions = questionRepository(EMPTY_PAGE);
    const runner = createRetrievalEvaluationRunner({
      embeddingModel: "embed-1",
      embeddings: sparseEmbeddings(),
      goldenQuestions,
      retriever: recordingRetriever([]),
      ...RUNNER_BOUNDS,
    });

    const report = await runner.run(RUN_INPUT);

    expect(goldenQuestions.listCalls[0]).toMatchObject({ cursor: CURSOR, limit: 5 });
    expect(report.items).toEqual([]);
    expect(report.metrics.totalQuestions).toBe(0);
    expect(report.nextCursor).toEqual(NEXT_CURSOR);
  });

  it("fails closed when the embedding provider returns a hole", async () => {
    const retriever = recordingRetriever([retrievalItem()]);
    const runner = createRetrievalEvaluationRunner({
      embeddingModel: "embed-1",
      embeddings: sparseEmbeddings({ returnHoles: true }),
      goldenQuestions: questionRepository({ items: [goldenQuestion()] }),
      retriever,
      ...RUNNER_BOUNDS,
    });

    await expect(
      runner.run({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, limit: 5, topK: 3 }),
    ).rejects.toThrow("Retrieval evaluation embedding provider returned an empty query vector");
    expect(retriever.retrieveCalls).toEqual([]);
  });

  it("evaluates a candidate model against only its building projection version", async () => {
    const embeddings = sparseEmbeddings();
    const retriever = recordingRetriever([retrievalItem()]);
    const runner = createRetrievalEvaluationRunner({
      embeddingModel: "published@1",
      embeddings,
      goldenQuestions: questionRepository({ items: [goldenQuestion()] }),
      retriever,
      ...RUNNER_BOUNDS,
    });

    await runner.run({
      denseProjectionModel: "candidate@2",
      denseProjectionStatuses: ["building"],
      denseProjectionVersion: 2,
      embeddingModel: "candidate@2",
      knowledgeSpaceId: KNOWLEDGE_SPACE_ID,
      limit: 1,
      topK: 1,
    });

    expect(embeddings.embedCalls[0]?.model).toBe("candidate@2");
    expect(retriever.retrieveCalls[0]).toMatchObject({
      denseProjectionModel: "candidate@2",
      denseProjectionStatuses: ["building"],
      denseProjectionVersion: 2,
    });
  });

  it("judges advanced retrieval items and skips blank citation evidence ids", async () => {
    const judgeInputs: unknown[] = [];
    const retriever = recordingRetriever([
      retrievalItem({
        citation: {
          artifactHash: "b".repeat(64),
          documentAssetId: "",
          documentVersion: 1,
          sectionPath: ["Guide"],
        },
      }),
      retrievalItem({
        citation: {
          artifactHash: "b".repeat(64),
          documentAssetId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          documentVersion: 1,
          sectionPath: ["Guide", "Refunds"],
        },
        nodeId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2e03",
        score: 0.5,
      }),
    ]);
    const runner = createAdvancedRetrievalEvaluationRunner({
      embeddingModel: "embed-1",
      embeddings: sparseEmbeddings(),
      goldenQuestions: questionRepository({ items: [goldenQuestion()] }),
      judge: {
        evaluateBatch: async (input) => {
          judgeInputs.push(input);

          return {
            items: [
              {
                citationAccuracyScore: 0.75,
                faithfulnessScore: 0.9,
                goldenQuestionId: QUESTION_ID,
                relevanceScore: 0.8,
                relevantEvidenceIds: [EVIDENCE_NODE_ID],
              },
            ],
          };
        },
      },
      retriever,
      ...RUNNER_BOUNDS,
    });

    const report = await runner.run({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, limit: 5, topK: 3 });

    expect(judgeInputs).toHaveLength(1);
    expect(report.items[0]).toMatchObject({
      citationAccuracy: 0.75,
      contextPrecision: 0.5,
      faithfulnessScore: 0.9,
      judgedRelevantEvidenceIds: [EVIDENCE_NODE_ID],
      relevanceScore: 0.8,
      status: "hit",
    });
    // The blank documentAssetId is dropped from citation evidence ids entirely.
    expect(report.items[0]?.citationEvidenceIds).toEqual(["018f0d60-7a49-7cc2-9c1b-5b36f18f2c43"]);
  });

  it("returns an empty paged strategy comparison report with the cursor applied", async () => {
    const goldenQuestions = questionRepository(EMPTY_PAGE);
    const repository: HybridRetrievalRepository = {
      searchDense: async () => [],
      searchFts: async () => [],
    };
    const runner = createRetrievalStrategyComparisonRunner({
      embeddingModel: "embed-1",
      embeddings: sparseEmbeddings(),
      goldenQuestions,
      hybridRetriever: recordingRetriever([]),
      repository,
      ...RUNNER_BOUNDS,
    });

    const report = await runner.run(RUN_INPUT);

    expect(goldenQuestions.listCalls[0]).toMatchObject({ cursor: CURSOR });
    expect(report.nextCursor).toEqual(NEXT_CURSOR);
    expect(report.strategies.hybrid.metrics.totalQuestions).toBe(0);
  });

  it("compares dense, fts, and hybrid strategies over a paged question set", async () => {
    const hybridRetriever = recordingRetriever([retrievalItem()]);
    const repository: HybridRetrievalRepository = {
      searchDense: async () => [retrievalCandidate()],
      searchFts: async () => [],
    };
    const runner = createRetrievalStrategyComparisonRunner({
      embeddingModel: "embed-1",
      embeddings: sparseEmbeddings(),
      goldenQuestions: questionRepository({ items: [goldenQuestion()], nextCursor: NEXT_CURSOR }),
      hybridRetriever,
      repository,
      ...RUNNER_BOUNDS,
    });

    const report = await runner.run({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, limit: 5, topK: 3 });

    expect(hybridRetriever.retrieveCalls[0]?.queryVector).toEqual([0.1, 0.2]);
    expect(report.nextCursor).toEqual(NEXT_CURSOR);
    expect(report.strategies["dense-only"].metrics.recallAtK).toBe(1);
    expect(report.strategies["fts-only"].metrics.noAnswerRate).toBe(1);
    expect(report.strategies.hybrid.metrics.recallAtK).toBe(1);
    expect(report.impact.hybridVsFts.recallAtK).toBeGreaterThan(0);
  });

  it("returns an empty paged A/B comparison report with the cursor applied", async () => {
    const goldenQuestions = questionRepository(EMPTY_PAGE);
    const runner = createAbRetrievalStrategyComparisonRunner({
      embeddingModel: "embed-1",
      embeddings: sparseEmbeddings(),
      goldenQuestions,
      strategies: [
        { name: "baseline", retriever: recordingRetriever([]) },
        { name: "challenger", retriever: recordingRetriever([]) },
      ],
      ...RUNNER_BOUNDS,
    });

    const report = await runner.run(RUN_INPUT);

    expect(goldenQuestions.listCalls[0]).toMatchObject({ cursor: CURSOR });
    expect(report).toMatchObject({
      baselineStrategy: "baseline",
      challengerStrategy: "challenger",
      winner: "tie",
    });
    expect(report.nextCursor).toEqual(NEXT_CURSOR);
  });

  it("declares a challenger win when the challenger recalls expected evidence", async () => {
    const baseline = recordingRetriever([]);
    const challenger = recordingRetriever([retrievalItem()]);
    const runner = createAbRetrievalStrategyComparisonRunner({
      embeddingModel: "embed-1",
      embeddings: sparseEmbeddings(),
      goldenQuestions: questionRepository({ items: [goldenQuestion()], nextCursor: NEXT_CURSOR }),
      strategies: [
        { name: "baseline", retriever: baseline },
        { name: "challenger", retriever: challenger },
      ],
      ...RUNNER_BOUNDS,
    });

    const report = await runner.run({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, limit: 5, topK: 3 });

    expect(baseline.retrieveCalls[0]?.queryVector).toEqual([0.1, 0.2]);
    expect(report.winner).toBe("challenger");
    expect(report.strategies.challenger?.metrics.recallAtK).toBe(1);
    expect(report.nextCursor).toEqual(NEXT_CURSOR);
  });

  it("returns an empty paged impact report with the cursor applied", async () => {
    const goldenQuestions = questionRepository(EMPTY_PAGE);
    const runner = createRetrievalImpactEvaluationRunner({
      baselineRetriever: recordingRetriever([]),
      embeddingModel: "embed-1",
      embeddings: sparseEmbeddings(),
      enrichedRetriever: recordingRetriever([]),
      goldenQuestions,
      summaryTreeRetriever: recordingRetriever([]),
      ...RUNNER_BOUNDS,
    });

    const report = await runner.run(RUN_INPUT);

    expect(goldenQuestions.listCalls[0]).toMatchObject({ cursor: CURSOR });
    expect(report.nextCursor).toEqual(NEXT_CURSOR);
    expect(report.variants.baseline.metrics.totalQuestions).toBe(0);
  });

  it("compares baseline, enriched, and summary-tree variants over a paged question set", async () => {
    const baselineRetriever = recordingRetriever([]);
    const enrichedRetriever = recordingRetriever([retrievalItem()]);
    const summaryTreeRetriever = recordingRetriever([retrievalItem()]);
    const runner = createRetrievalImpactEvaluationRunner({
      baselineRetriever,
      embeddingModel: "embed-1",
      embeddings: sparseEmbeddings(),
      enrichedRetriever,
      goldenQuestions: questionRepository({ items: [goldenQuestion()], nextCursor: NEXT_CURSOR }),
      summaryTreeRetriever,
      ...RUNNER_BOUNDS,
    });

    const report = await runner.run({ knowledgeSpaceId: KNOWLEDGE_SPACE_ID, limit: 5, topK: 3 });

    expect(baselineRetriever.retrieveCalls[0]?.queryVector).toEqual([0.1, 0.2]);
    expect(report.nextCursor).toEqual(NEXT_CURSOR);
    expect(report.variants.enriched.metrics.recallAtK).toBe(1);
    expect(report.variants["summary-tree"].metrics.recallAtK).toBe(1);
    expect(report.impact.enrichedVsBaseline.recallAtK).toBeGreaterThan(0);
    expect(report.impact.summaryTreeVsEnriched.recallAtK).toBe(0);
  });
});
