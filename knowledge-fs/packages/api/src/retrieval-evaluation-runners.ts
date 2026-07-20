import type { GoldenQuestion } from "@knowledge/core";
import type { EmbedTextsResult, EmbeddingProvider } from "@knowledge/embeddings";

import type { GoldenQuestionCursor, GoldenQuestionRepository } from "./golden-question-repository";
import { cloneJsonObject, jsonByteLength } from "./json-utils";
import {
  type HybridRetrievalRepository,
  type RetrievalCandidate,
  cloneRetrievalCitation,
} from "./retrieval-candidates";
import {
  type AdvancedRetrievalEvaluationItem,
  type AdvancedRetrievalEvaluationReport,
  type RetrievalEvaluationItem,
  type RetrievalEvaluationItemStatus,
  type RetrievalEvaluationMetricDelta,
  type RetrievalEvaluationMetrics,
  type RetrievalEvaluationReport,
  advancedRetrievalEvaluationReportFromItems,
  cloneRetrievalEvaluationItem,
  emptyAdvancedRetrievalEvaluationReport,
  emptyRetrievalEvaluationReport,
  retrievalEvaluationDelta,
  retrievalEvaluationReportFromItems,
  zeroRetrievalEvaluationDelta,
} from "./retrieval-evaluation-reports";
import {
  abRetrievalWinner,
  validateAbRetrievalStrategies,
  validatePositiveIntegerBound,
  validateRetrievalEvaluationBounds,
  validateRetrievalEvaluationRunnerOptions,
  validateZeroToOne,
} from "./retrieval-evaluation-utils";
import { evidenceTextFromHybridItem } from "./retrieval-rerank";
import type { BasicHybridRetriever, HybridRetrievalResult } from "./retrieval-types";

export interface AdvancedRetrievalJudgeContextItem {
  readonly citationEvidenceId?: string | undefined;
  readonly nodeId: string;
  readonly score: number;
  readonly sectionPath: readonly string[];
  readonly text: string;
}

export interface AdvancedRetrievalJudgeInputItem {
  readonly expectedEvidenceIds: readonly string[];
  readonly goldenQuestionId: string;
  readonly question: string;
  readonly retrievedContext: readonly AdvancedRetrievalJudgeContextItem[];
  readonly tags: readonly string[];
}

export interface AdvancedRetrievalMetricJudgeInput {
  readonly items: readonly AdvancedRetrievalJudgeInputItem[];
}

export interface AdvancedRetrievalMetricJudgeItem {
  readonly citationAccuracyScore: number;
  readonly faithfulnessScore: number;
  readonly goldenQuestionId: string;
  readonly relevanceScore: number;
  readonly relevantEvidenceIds: readonly string[];
}

export interface AdvancedRetrievalMetricJudgeResult {
  readonly items: readonly AdvancedRetrievalMetricJudgeItem[];
}

export interface AdvancedRetrievalMetricJudge {
  evaluateBatch(
    input: AdvancedRetrievalMetricJudgeInput,
  ): Promise<AdvancedRetrievalMetricJudgeResult>;
}

export type RetrievalEvaluationStrategy = "dense-only" | "fts-only" | "hybrid";

export interface RetrievalStrategyComparisonImpact {
  readonly hybridVsDense: RetrievalEvaluationMetricDelta;
  readonly hybridVsFts: RetrievalEvaluationMetricDelta;
}

export interface RetrievalStrategyComparisonReport {
  readonly impact: RetrievalStrategyComparisonImpact;
  readonly nextCursor?: GoldenQuestionCursor | undefined;
  readonly strategies: Record<RetrievalEvaluationStrategy, RetrievalEvaluationReport>;
}

export interface AbRetrievalStrategy {
  readonly name: string;
  readonly retriever: BasicHybridRetriever;
}

export type AbRetrievalStrategyWinner = "baseline" | "challenger" | "tie";

export interface AbRetrievalStrategyComparisonReport {
  readonly baselineStrategy: string;
  readonly challengerStrategy: string;
  readonly delta: RetrievalEvaluationMetricDelta;
  readonly nextCursor?: GoldenQuestionCursor | undefined;
  readonly strategies: Record<string, RetrievalEvaluationReport>;
  readonly winner: AbRetrievalStrategyWinner;
}

export type RetrievalImpactVariant = "baseline" | "enriched" | "summary-tree";

export interface RetrievalImpactEvaluationImpact {
  readonly enrichedVsBaseline: RetrievalEvaluationMetricDelta;
  readonly summaryTreeVsBaseline: RetrievalEvaluationMetricDelta;
  readonly summaryTreeVsEnriched: RetrievalEvaluationMetricDelta;
}

export interface RetrievalImpactEvaluationReport {
  readonly impact: RetrievalImpactEvaluationImpact;
  readonly nextCursor?: GoldenQuestionCursor | undefined;
  readonly variants: Record<RetrievalImpactVariant, RetrievalEvaluationReport>;
}

export interface RunRetrievalEvaluationInput {
  readonly cursor?: GoldenQuestionCursor | undefined;
  readonly denseProjectionModel?: string | undefined;
  readonly denseProjectionStatuses?: readonly ("building" | "ready")[] | undefined;
  readonly denseProjectionVersion?: number | undefined;
  readonly embeddingModel?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly topK: number;
}

export interface RetrievalEvaluationRunner {
  run(input: RunRetrievalEvaluationInput): Promise<RetrievalEvaluationReport>;
}

export interface AdvancedRetrievalEvaluationRunner {
  run(input: RunRetrievalEvaluationInput): Promise<AdvancedRetrievalEvaluationReport>;
}

export interface RetrievalStrategyComparisonRunner {
  run(input: RunRetrievalEvaluationInput): Promise<RetrievalStrategyComparisonReport>;
}

export interface AbRetrievalStrategyComparisonRunner {
  run(input: RunRetrievalEvaluationInput): Promise<AbRetrievalStrategyComparisonReport>;
}

export interface RetrievalImpactEvaluationRunner {
  run(input: RunRetrievalEvaluationInput): Promise<RetrievalImpactEvaluationReport>;
}

export interface RetrievalEvaluationRunnerOptions {
  readonly embeddingModel: string;
  readonly embeddings: EmbeddingProvider;
  readonly goldenQuestions: GoldenQuestionRepository;
  readonly maxQuestions: number;
  readonly maxTopK: number;
  readonly retriever: BasicHybridRetriever;
}

export interface AdvancedRetrievalEvaluationRunnerOptions extends RetrievalEvaluationRunnerOptions {
  readonly judge: AdvancedRetrievalMetricJudge;
  readonly maxJudgeContextBytes?: number | undefined;
}

export interface RetrievalStrategyComparisonRunnerOptions {
  readonly embeddingModel: string;
  readonly embeddings: EmbeddingProvider;
  readonly goldenQuestions: GoldenQuestionRepository;
  readonly hybridRetriever: BasicHybridRetriever;
  readonly maxQuestions: number;
  readonly maxTopK: number;
  readonly repository: HybridRetrievalRepository;
}

export interface AbRetrievalStrategyComparisonRunnerOptions {
  readonly embeddingModel: string;
  readonly embeddings: EmbeddingProvider;
  readonly goldenQuestions: GoldenQuestionRepository;
  readonly maxQuestions: number;
  readonly maxTopK: number;
  readonly strategies: readonly AbRetrievalStrategy[];
}

export interface RetrievalImpactEvaluationRunnerOptions {
  readonly baselineRetriever: BasicHybridRetriever;
  readonly embeddingModel: string;
  readonly embeddings: EmbeddingProvider;
  readonly enrichedRetriever: BasicHybridRetriever;
  readonly goldenQuestions: GoldenQuestionRepository;
  readonly maxQuestions: number;
  readonly maxTopK: number;
  readonly summaryTreeRetriever: BasicHybridRetriever;
}

export function createRetrievalEvaluationRunner({
  embeddingModel,
  embeddings,
  goldenQuestions,
  maxQuestions,
  maxTopK,
  retriever,
}: RetrievalEvaluationRunnerOptions): RetrievalEvaluationRunner {
  validateRetrievalEvaluationRunnerOptions({ embeddingModel, maxQuestions, maxTopK });

  return {
    run: async ({
      cursor,
      denseProjectionModel,
      denseProjectionStatuses,
      denseProjectionVersion,
      embeddingModel: embeddingModelOverride,
      knowledgeSpaceId,
      limit,
      topK,
    }) => {
      validateRetrievalEvaluationBounds({ limit, maxQuestions, maxTopK, topK });

      const page = await goldenQuestions.listTrusted({
        ...(cursor ? { cursor } : {}),
        knowledgeSpaceId,
        limit,
      });

      if (page.items.length === 0) {
        return {
          items: [],
          metrics: {
            citationHitRate: 0,
            noAnswerRate: 0,
            recallAtK: 0,
            totalQuestions: 0,
          },
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        };
      }

      const questions = page.items;
      const embedded = await embeddings.embed({
        inputType: "search_query",
        model: embeddingModelOverride?.trim() || embeddingModel,
        texts: questions.map((question) => question.question),
      });

      const embeddedModel = validateEvaluationEmbeddingResult(
        embedded,
        questions.length,
        "Retrieval evaluation",
      );
      const resolvedProjectionModel = denseProjectionModel?.trim() || embeddedModel;

      const retrievals = await Promise.all(
        questions.map((question, index) =>
          retriever.retrieve({
            denseProjectionModel: resolvedProjectionModel,
            ...(denseProjectionStatuses ? { denseProjectionStatuses } : {}),
            ...(denseProjectionVersion === undefined ? {} : { denseProjectionVersion }),
            knowledgeSpaceId,
            limit: topK,
            query: question.question,
            queryVector: embedded.dense[index] ?? [],
            topK,
          }),
        ),
      );
      const items = questions.map((question, index) =>
        evaluateGoldenQuestionRetrieval(question, retrievals[index] ?? { items: [] }, topK),
      );
      return retrievalEvaluationReportFromItems(items, page.nextCursor);
    },
  };
}

export function createAdvancedRetrievalEvaluationRunner({
  embeddingModel,
  embeddings,
  goldenQuestions,
  judge,
  maxJudgeContextBytes = 64 * 1024,
  maxQuestions,
  maxTopK,
  retriever,
}: AdvancedRetrievalEvaluationRunnerOptions): AdvancedRetrievalEvaluationRunner {
  validateRetrievalEvaluationRunnerOptions({ embeddingModel, maxQuestions, maxTopK });
  validatePositiveIntegerBound(
    maxJudgeContextBytes,
    "Advanced retrieval evaluation maxJudgeContextBytes",
  );

  return {
    run: async ({ cursor, denseProjectionModel, knowledgeSpaceId, limit, topK }) => {
      validateRetrievalEvaluationBounds({ limit, maxQuestions, maxTopK, topK });

      const page = await goldenQuestions.listTrusted({
        ...(cursor ? { cursor } : {}),
        knowledgeSpaceId,
        limit,
      });

      if (page.items.length === 0) {
        return emptyAdvancedRetrievalEvaluationReport(page.nextCursor);
      }

      const questions = page.items;
      const embedded = await embeddings.embed({
        inputType: "search_query",
        model: embeddingModel,
        texts: questions.map((question) => question.question),
      });

      const embeddedModel = validateEvaluationEmbeddingResult(
        embedded,
        questions.length,
        "Advanced retrieval evaluation",
      );
      const resolvedProjectionModel = denseProjectionModel?.trim() || embeddedModel;

      const retrievals = await Promise.all(
        questions.map((question, index) =>
          retriever.retrieve({
            denseProjectionModel: resolvedProjectionModel,
            knowledgeSpaceId,
            limit: topK,
            query: question.question,
            queryVector: embedded.dense[index] ?? [],
            topK,
          }),
        ),
      );
      const baseItems = questions.map((question, index) =>
        evaluateGoldenQuestionRetrieval(question, retrievals[index] ?? { items: [] }, topK),
      );
      const judgeInput = buildAdvancedRetrievalJudgeInput({
        questions,
        retrievals,
        topK,
      });

      if (jsonByteLength(judgeInput) > maxJudgeContextBytes) {
        throw new Error(
          `Advanced retrieval evaluation judge context exceeds maxJudgeContextBytes=${maxJudgeContextBytes}`,
        );
      }

      const judgeResult = await judge.evaluateBatch(judgeInput);
      const judgeItemsByQuestionId = validateAdvancedRetrievalJudgeResult(judgeInput, judgeResult);
      const items = baseItems.map((item) =>
        advancedRetrievalEvaluationItemFromJudge(
          item,
          judgeItemsByQuestionId.get(item.goldenQuestionId),
        ),
      );

      return advancedRetrievalEvaluationReportFromItems(items, page.nextCursor);
    },
  };
}

export function createRetrievalStrategyComparisonRunner({
  embeddingModel,
  embeddings,
  goldenQuestions,
  hybridRetriever,
  maxQuestions,
  maxTopK,
  repository,
}: RetrievalStrategyComparisonRunnerOptions): RetrievalStrategyComparisonRunner {
  validateRetrievalEvaluationRunnerOptions({ embeddingModel, maxQuestions, maxTopK });

  return {
    run: async ({ cursor, denseProjectionModel, knowledgeSpaceId, limit, topK }) => {
      validateRetrievalEvaluationBounds({ limit, maxQuestions, maxTopK, topK });

      const page = await goldenQuestions.listTrusted({
        ...(cursor ? { cursor } : {}),
        knowledgeSpaceId,
        limit,
      });

      if (page.items.length === 0) {
        const emptyReport = emptyRetrievalEvaluationReport(page.nextCursor);

        return {
          impact: {
            hybridVsDense: zeroRetrievalEvaluationDelta(),
            hybridVsFts: zeroRetrievalEvaluationDelta(),
          },
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          strategies: {
            "dense-only": emptyReport,
            "fts-only": emptyReport,
            hybrid: emptyReport,
          },
        };
      }

      const questions = page.items;
      const embedded = await embeddings.embed({
        inputType: "search_query",
        model: embeddingModel,
        texts: questions.map((question) => question.question),
      });

      const embeddedModel = validateEvaluationEmbeddingResult(
        embedded,
        questions.length,
        "Retrieval strategy comparison",
      );
      const resolvedProjectionModel = denseProjectionModel?.trim() || embeddedModel;

      const results = await Promise.all(
        questions.map(async (question, index) => {
          const queryVector = embedded.dense[index] ?? [];
          const [dense, fts, hybrid] = await Promise.all([
            repository.searchDense({
              denseProjectionModel: resolvedProjectionModel,
              knowledgeSpaceId,
              queryVector,
              topK,
            }),
            repository.searchFts({
              knowledgeSpaceId,
              query: question.question,
              topK,
            }),
            hybridRetriever.retrieve({
              denseProjectionModel: resolvedProjectionModel,
              knowledgeSpaceId,
              limit: topK,
              query: question.question,
              queryVector,
              topK,
            }),
          ]);

          return {
            dense: evaluateGoldenQuestionRetrieval(
              question,
              retrievalCandidatesToHybridResult(dense, topK),
              topK,
            ),
            fts: evaluateGoldenQuestionRetrieval(
              question,
              retrievalCandidatesToHybridResult(fts, topK),
              topK,
            ),
            hybrid: evaluateGoldenQuestionRetrieval(question, hybrid, topK),
          };
        }),
      );
      const denseReport = retrievalEvaluationReportFromItems(
        results.map((result) => result.dense),
        page.nextCursor,
      );
      const ftsReport = retrievalEvaluationReportFromItems(
        results.map((result) => result.fts),
        page.nextCursor,
      );
      const hybridReport = retrievalEvaluationReportFromItems(
        results.map((result) => result.hybrid),
        page.nextCursor,
      );

      return {
        impact: {
          hybridVsDense: retrievalEvaluationDelta(hybridReport.metrics, denseReport.metrics),
          hybridVsFts: retrievalEvaluationDelta(hybridReport.metrics, ftsReport.metrics),
        },
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        strategies: {
          "dense-only": denseReport,
          "fts-only": ftsReport,
          hybrid: hybridReport,
        },
      };
    },
  };
}

export function createAbRetrievalStrategyComparisonRunner({
  embeddingModel,
  embeddings,
  goldenQuestions,
  maxQuestions,
  maxTopK,
  strategies,
}: AbRetrievalStrategyComparisonRunnerOptions): AbRetrievalStrategyComparisonRunner {
  validateRetrievalEvaluationRunnerOptions({ embeddingModel, maxQuestions, maxTopK });
  const [baseline, challenger] = validateAbRetrievalStrategies(strategies);

  return {
    run: async ({ cursor, denseProjectionModel, knowledgeSpaceId, limit, topK }) => {
      validateRetrievalEvaluationBounds({ limit, maxQuestions, maxTopK, topK });

      const page = await goldenQuestions.listTrusted({
        ...(cursor ? { cursor } : {}),
        knowledgeSpaceId,
        limit,
      });

      if (page.items.length === 0) {
        const emptyReport = emptyRetrievalEvaluationReport(page.nextCursor);

        return {
          baselineStrategy: baseline.name,
          challengerStrategy: challenger.name,
          delta: zeroRetrievalEvaluationDelta(),
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          strategies: {
            [baseline.name]: emptyReport,
            [challenger.name]: emptyReport,
          },
          winner: "tie",
        };
      }

      const questions = page.items;
      const embedded = await embeddings.embed({
        inputType: "search_query",
        model: embeddingModel,
        texts: questions.map((question) => question.question),
      });

      const embeddedModel = validateEvaluationEmbeddingResult(
        embedded,
        questions.length,
        "A/B retrieval strategy comparison",
      );
      const resolvedProjectionModel = denseProjectionModel?.trim() || embeddedModel;

      const results = await Promise.all(
        questions.map(async (question, index) => {
          const request = {
            denseProjectionModel: resolvedProjectionModel,
            knowledgeSpaceId,
            limit: topK,
            query: question.question,
            queryVector: embedded.dense[index] ?? [],
            topK,
          };
          const [baselineResult, challengerResult] = await Promise.all([
            baseline.retriever.retrieve(request),
            challenger.retriever.retrieve(request),
          ]);

          return {
            baseline: evaluateGoldenQuestionRetrieval(question, baselineResult, topK),
            challenger: evaluateGoldenQuestionRetrieval(question, challengerResult, topK),
          };
        }),
      );
      const baselineReport = retrievalEvaluationReportFromItems(
        results.map((result) => result.baseline),
        page.nextCursor,
      );
      const challengerReport = retrievalEvaluationReportFromItems(
        results.map((result) => result.challenger),
        page.nextCursor,
      );
      const delta = retrievalEvaluationDelta(challengerReport.metrics, baselineReport.metrics);

      return {
        baselineStrategy: baseline.name,
        challengerStrategy: challenger.name,
        delta,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        strategies: {
          [baseline.name]: baselineReport,
          [challenger.name]: challengerReport,
        },
        winner: abRetrievalWinner(baselineReport.metrics, challengerReport.metrics),
      };
    },
  };
}

export function createRetrievalImpactEvaluationRunner({
  baselineRetriever,
  embeddingModel,
  embeddings,
  enrichedRetriever,
  goldenQuestions,
  maxQuestions,
  maxTopK,
  summaryTreeRetriever,
}: RetrievalImpactEvaluationRunnerOptions): RetrievalImpactEvaluationRunner {
  validateRetrievalEvaluationRunnerOptions({ embeddingModel, maxQuestions, maxTopK });

  return {
    run: async ({ cursor, denseProjectionModel, knowledgeSpaceId, limit, topK }) => {
      validateRetrievalEvaluationBounds({ limit, maxQuestions, maxTopK, topK });

      const page = await goldenQuestions.listTrusted({
        ...(cursor ? { cursor } : {}),
        knowledgeSpaceId,
        limit,
      });

      if (page.items.length === 0) {
        const emptyReport = emptyRetrievalEvaluationReport(page.nextCursor);

        return {
          impact: {
            enrichedVsBaseline: zeroRetrievalEvaluationDelta(),
            summaryTreeVsBaseline: zeroRetrievalEvaluationDelta(),
            summaryTreeVsEnriched: zeroRetrievalEvaluationDelta(),
          },
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          variants: {
            baseline: emptyReport,
            enriched: emptyReport,
            "summary-tree": emptyReport,
          },
        };
      }

      const questions = page.items;
      const embedded = await embeddings.embed({
        inputType: "search_query",
        model: embeddingModel,
        texts: questions.map((question) => question.question),
      });

      const embeddedModel = validateEvaluationEmbeddingResult(
        embedded,
        questions.length,
        "Retrieval impact evaluation",
      );
      const resolvedProjectionModel = denseProjectionModel?.trim() || embeddedModel;

      const results = await Promise.all(
        questions.map(async (question, index) => {
          const request = {
            denseProjectionModel: resolvedProjectionModel,
            knowledgeSpaceId,
            limit: topK,
            query: question.question,
            queryVector: embedded.dense[index] ?? [],
            topK,
          };
          const [baseline, enriched, summaryTree] = await Promise.all([
            baselineRetriever.retrieve(request),
            enrichedRetriever.retrieve(request),
            summaryTreeRetriever.retrieve(request),
          ]);

          return {
            baseline: evaluateGoldenQuestionRetrieval(question, baseline, topK),
            enriched: evaluateGoldenQuestionRetrieval(question, enriched, topK),
            summaryTree: evaluateGoldenQuestionRetrieval(question, summaryTree, topK),
          };
        }),
      );
      const baselineReport = retrievalEvaluationReportFromItems(
        results.map((result) => result.baseline),
        page.nextCursor,
      );
      const enrichedReport = retrievalEvaluationReportFromItems(
        results.map((result) => result.enriched),
        page.nextCursor,
      );
      const summaryTreeReport = retrievalEvaluationReportFromItems(
        results.map((result) => result.summaryTree),
        page.nextCursor,
      );

      return {
        impact: {
          enrichedVsBaseline: retrievalEvaluationDelta(
            enrichedReport.metrics,
            baselineReport.metrics,
          ),
          summaryTreeVsBaseline: retrievalEvaluationDelta(
            summaryTreeReport.metrics,
            baselineReport.metrics,
          ),
          summaryTreeVsEnriched: retrievalEvaluationDelta(
            summaryTreeReport.metrics,
            enrichedReport.metrics,
          ),
        },
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        variants: {
          baseline: baselineReport,
          enriched: enrichedReport,
          "summary-tree": summaryTreeReport,
        },
      };
    },
  };
}

function validateEvaluationEmbeddingResult(
  result: EmbedTextsResult,
  expectedCount: number,
  label: string,
): string {
  if (result.dense.length !== expectedCount) {
    throw new Error(
      `${label} embedding provider returned ${result.dense.length} vectors for ${expectedCount} questions`,
    );
  }

  const dimension = result.dense[0]?.length ?? 0;

  if (dimension < 1) {
    throw new Error(`${label} embedding provider returned an empty query vector`);
  }

  for (const [index, vector] of result.dense.entries()) {
    if (vector.length !== dimension) {
      throw new Error(
        `${label} embedding provider returned inconsistent dimension=${vector.length} at index ${index}; expected ${dimension}`,
      );
    }

    if (!vector.every((value) => Number.isFinite(value))) {
      throw new Error(`${label} embedding provider returned a non-finite vector at index ${index}`);
    }
  }

  if (result.metadata.dimension !== undefined && result.metadata.dimension !== dimension) {
    throw new Error(
      `${label} embedding provider reported dimension=${result.metadata.dimension}; response vectors have dimension=${dimension}`,
    );
  }

  const model = result.model.trim();

  if (!model) {
    throw new Error(`${label} embedding provider returned an empty model`);
  }

  return model;
}

function evaluateGoldenQuestionRetrieval(
  question: GoldenQuestion,
  result: HybridRetrievalResult,
  topK: number,
): RetrievalEvaluationItem {
  const expected = new Set(question.expectedEvidenceIds);
  const topItems = result.items.slice(0, topK);
  const retrievedEvidenceIds = uniqueStrings(topItems.map((item) => item.nodeId));
  const citationEvidenceIds = uniqueStrings(
    topItems.map((item) => item.citation.documentAssetId).filter(Boolean),
  );
  const matchedEvidenceIds = retrievedEvidenceIds.filter((id) => expected.has(id));
  const matchedCitationIds = citationEvidenceIds.filter((id) => expected.has(id));
  const status: RetrievalEvaluationItemStatus =
    topItems.length === 0 ? "no-answer" : matchedEvidenceIds.length > 0 ? "hit" : "miss";

  return {
    citationEvidenceIds,
    expectedEvidenceIds: [...question.expectedEvidenceIds],
    goldenQuestionId: question.id,
    matchedCitationIds,
    matchedEvidenceIds,
    question: question.question,
    retrievedEvidenceIds,
    status,
    tags: [...question.tags],
  };
}

function buildAdvancedRetrievalJudgeInput({
  questions,
  retrievals,
  topK,
}: {
  readonly questions: readonly GoldenQuestion[];
  readonly retrievals: readonly HybridRetrievalResult[];
  readonly topK: number;
}): AdvancedRetrievalMetricJudgeInput {
  return {
    items: questions.map((question, index) => ({
      expectedEvidenceIds: [...question.expectedEvidenceIds],
      goldenQuestionId: question.id,
      question: question.question,
      retrievedContext: (retrievals[index]?.items ?? []).slice(0, topK).map((item) => ({
        citationEvidenceId: item.citation.documentAssetId,
        nodeId: item.nodeId,
        score: item.score,
        sectionPath: [...item.citation.sectionPath],
        text: evidenceTextFromHybridItem(item),
      })),
      tags: [...question.tags],
    })),
  };
}

function validateAdvancedRetrievalJudgeResult(
  input: AdvancedRetrievalMetricJudgeInput,
  result: AdvancedRetrievalMetricJudgeResult,
): Map<string, AdvancedRetrievalMetricJudgeItem> {
  if (result.items.length !== input.items.length) {
    throw new Error(
      `Advanced retrieval evaluation judge returned ${result.items.length} results for ${input.items.length} questions`,
    );
  }

  const inputById = new Map(input.items.map((item) => [item.goldenQuestionId, item]));
  const byId = new Map<string, AdvancedRetrievalMetricJudgeItem>();

  for (const item of result.items) {
    const inputItem = inputById.get(item.goldenQuestionId);

    if (!inputItem) {
      throw new Error("Advanced retrieval evaluation judge returned an unknown goldenQuestionId");
    }

    if (byId.has(item.goldenQuestionId)) {
      throw new Error("Advanced retrieval evaluation judge returned duplicate goldenQuestionId");
    }

    validateZeroToOne(
      item.citationAccuracyScore,
      "Advanced retrieval evaluation judge citationAccuracyScore",
    );
    validateZeroToOne(
      item.faithfulnessScore,
      "Advanced retrieval evaluation judge faithfulnessScore",
    );
    validateZeroToOne(item.relevanceScore, "Advanced retrieval evaluation judge relevanceScore");

    const retrievedEvidenceIds = new Set(
      inputItem.retrievedContext.flatMap((contextItem) => [
        contextItem.nodeId,
        ...(contextItem.citationEvidenceId ? [contextItem.citationEvidenceId] : []),
      ]),
    );

    for (const evidenceId of item.relevantEvidenceIds) {
      if (!retrievedEvidenceIds.has(evidenceId)) {
        throw new Error(
          "Advanced retrieval evaluation judge relevantEvidenceIds must reference retrieved context",
        );
      }
    }

    byId.set(item.goldenQuestionId, {
      citationAccuracyScore: item.citationAccuracyScore,
      faithfulnessScore: item.faithfulnessScore,
      goldenQuestionId: item.goldenQuestionId,
      relevanceScore: item.relevanceScore,
      relevantEvidenceIds: uniqueStrings([...item.relevantEvidenceIds]),
    });
  }

  return byId;
}

function advancedRetrievalEvaluationItemFromJudge(
  item: RetrievalEvaluationItem,
  judgeItem: AdvancedRetrievalMetricJudgeItem | undefined,
): AdvancedRetrievalEvaluationItem {
  if (!judgeItem) {
    throw new Error("Advanced retrieval evaluation judge result is missing a golden question");
  }

  const retrievedNodeIds = new Set(item.retrievedEvidenceIds);
  const judgedRelevantEvidenceIds = uniqueStrings(
    judgeItem.relevantEvidenceIds.filter((evidenceId) => retrievedNodeIds.has(evidenceId)),
  );
  const contextPrecision =
    item.retrievedEvidenceIds.length === 0
      ? 0
      : judgedRelevantEvidenceIds.length / item.retrievedEvidenceIds.length;

  return {
    ...cloneRetrievalEvaluationItem(item),
    citationAccuracy: judgeItem.citationAccuracyScore,
    contextPrecision,
    faithfulnessScore: judgeItem.faithfulnessScore,
    judgedRelevantEvidenceIds,
    relevanceScore: judgeItem.relevanceScore,
  };
}

function retrievalCandidatesToHybridResult(
  candidates: readonly RetrievalCandidate[],
  topK: number,
): HybridRetrievalResult {
  return {
    items: candidates.slice(0, topK).map((candidate) => ({
      citation: cloneRetrievalCitation(candidate.citation),
      metadata: cloneJsonObject(candidate.metadata),
      nodeId: candidate.nodeId,
      permissionScope: [...candidate.permissionScope],
      projectionIds: [candidate.projectionId],
      score: candidate.score,
      sources: [candidate.source],
    })),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
