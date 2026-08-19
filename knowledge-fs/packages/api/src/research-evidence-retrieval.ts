import {
  assertKnowledgeSpaceRetrievalProfileForMode,
  hasRequiredKnowledgeSpaceRetrievalModels,
} from "@knowledge/core";
import type { RerankerProvider } from "@knowledge/embeddings";

import type { KnowledgeSpaceModelSelection } from "@knowledge/core";
import { resolveFinalRerankRuntime } from "./final-rerank-retrieval";
import type {
  ResearchEvidenceJudgement,
  ResearchEvidenceReasoning,
  ResearchQueryPlan,
} from "./research-evidence-reasoning";
import {
  ResearchEvidenceRetrievalCheckpointVersion,
  type ResearchEvidenceRetrievalSearchCheckpoint,
  ResearchRetrievalCheckpointVersion,
  validateAnyResearchRetrievalSearchCheckpointScope,
} from "./research-retrieval-checkpoint";
import {
  InteractiveResearchEvidenceRetrievalPolicy,
  type ResearchRetrievalBudgetSnapshot,
  createResearchRetrievalBudget,
  validateResearchRetrievalPolicy,
} from "./research-retrieval-policy";
import { type HybridRetrievalItem, fuseRankedHybridRetrievalLists } from "./retrieval-fusion";
import { type RetrievalPlanner, defaultRetrievalPlan } from "./retrieval-planner";
import { rerankHybridRetrievalItems } from "./retrieval-rerank";
import type {
  BasicHybridRetriever,
  HybridRetrievalMetrics,
  HybridRetrievalResult,
  RetrieveHybridInput,
} from "./retrieval-types";

export interface ResearchQueryVectorizer {
  vectorize(input: {
    readonly embeddingProfile: NonNullable<RetrieveHybridInput["embeddingProfile"]>;
    readonly knowledgeSpaceId: string;
    readonly queries: readonly string[];
    readonly tenantId: string;
  }): Promise<readonly (readonly number[])[]>;
}

export interface ResearchEvidenceRetrievalOptions {
  readonly legacyResearchRetriever?: BasicHybridRetriever | undefined;
  readonly maxCandidateLists?: number | undefined;
  readonly maxRerankCandidates?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly planner?: RetrievalPlanner | undefined;
  readonly queryVectorizer: ResearchQueryVectorizer;
  readonly reasoning: ResearchEvidenceReasoning;
  readonly rerankerFactory: (selection: KnowledgeSpaceModelSelection) => RerankerProvider;
  readonly retriever: BasicHybridRetriever;
}

/**
 * Online Research V3 orchestration.
 *
 * It performs knowledge-space-wide candidate retrieval for the original query and at most three
 * planned subqueries, rank-fuses those lists, applies the configured reranker once, then asks the
 * reasoning model to judge the evidence set as a whole. An insufficient set may run exactly one
 * focused supplemental retrieval and a final rerank. No document or tree node invokes an LLM.
 */
export function createResearchEvidenceRetrieval({
  legacyResearchRetriever,
  maxCandidateLists = 4,
  maxRerankCandidates = 200,
  now = Date.now,
  planner,
  queryVectorizer,
  reasoning,
  rerankerFactory,
  retriever,
}: ResearchEvidenceRetrievalOptions): BasicHybridRetriever {
  positiveInteger(maxCandidateLists, "maxCandidateLists");
  positiveInteger(maxRerankCandidates, "maxRerankCandidates");

  return {
    retrieve: async (input) => {
      if (input.mode !== "research") return retriever.retrieve(input);

      // V2 checkpoints contain a PageIndex tree frontier. Keep in-flight tasks replayable until
      // their retained checkpoints expire; all fresh Research requests enter V3 below.
      if (input.researchSearchCheckpoint?.version === ResearchRetrievalCheckpointVersion) {
        if (!legacyResearchRetriever) {
          throw new Error("Legacy Research checkpoint cannot be resumed without the V2 retriever");
        }
        return legacyResearchRetriever.retrieve(input);
      }

      const startedAt = now();
      const tenantId = requiredText(input.tenantId, "tenantId");
      const profile = input.retrievalProfile;
      if (!profile) throw new Error("Research retrieval requires a frozen retrieval profile");
      assertKnowledgeSpaceRetrievalProfileForMode(profile, "research");
      if (!hasRequiredKnowledgeSpaceRetrievalModels(profile)) {
        throw new Error("Research retrieval requires reasoning and rerank models");
      }
      const reasoningModel = profile.reasoningModel;
      if (!reasoningModel) throw new Error("Research retrieval requires a reasoning model");
      const embeddingProfile = input.embeddingProfile;
      if (!embeddingProfile) {
        throw new Error("Research retrieval requires a frozen embedding profile");
      }
      if (input.denseProjectionModel !== embeddingProfile.vectorSpaceId) {
        throw new Error(
          "Research retrieval embedding profile does not match the query vector space",
        );
      }

      const policy = validateResearchRetrievalPolicy(
        input.researchExecutionPolicy ?? InteractiveResearchEvidenceRetrievalPolicy,
      );
      const restored = restoreV3Checkpoint(input);
      if (restored?.checkpoint.phase === "complete") {
        if (!restored.result) {
          throw new Error("Completed Research V3 checkpoint is missing its evidence result");
        }
        await input.onResearchStageChange?.("retrieving", {
          checkpointed: true,
          questions: [input.query],
          topK: input.topK ?? input.limit,
        });
        await input.onResearchStageChange?.("analyzing", {
          checkpointed: true,
          results: [{ chunkCount: restored.result.items.length, question: input.query }],
          retrievalCount:
            restored.result.metrics?.rerankCandidates ??
            restored.result.metrics?.fusedCandidates ??
            restored.result.items.length,
        });
        return restored.result;
      }
      const budget = createResearchRetrievalBudget(policy, now, restored?.checkpoint.budget);
      const reserveModelCall = () => {
        if (!budget.consume("modelCalls")) {
          throw new Error("Research retrieval model-call budget was exhausted");
        }
      };
      const planStartedAt = now();
      const queryPlan = restored
        ? { ...restored.checkpoint.queryPlan, modelCalled: false }
        : await reasoning.plan({
            query: input.query,
            reasoningModel,
            reserveModelCall,
            researchModelCallObserver: input.researchModelCallObserver,
            tenantId,
            traceId: input.traceId,
          });
      const planMs = restored ? 0 : Math.max(0, now() - planStartedAt);
      const retrievalPlan =
        planner?.plan({
          hasQueryImages: (input.queryImages?.length ?? 0) > 0,
          mode: "research",
          query: input.query,
          topK: input.topK,
          traceId: input.traceId,
        }) ?? defaultRetrievalPlan({ query: input.query, topK: input.topK });
      if (!restored) {
        await persistV3Boundary({
          budget: budget.snapshot(),
          input,
          phase: "planned",
          queryPlan,
          result: {
            items: [],
            plan: { ...retrievalPlan, strategyVersion: "retrieval-planner-v2" },
          },
          sequence: 0,
        });
      }
      await input.onResearchStageChange?.("retrieving", {
        ...(restored ? { checkpointed: true } : {}),
        questions: [input.query, ...queryPlan.subqueries],
        topK: input.topK ?? input.limit,
      });
      const candidateLimit = Math.min(
        maxRerankCandidates,
        Math.max(input.limit, retrievalPlan.rerankCandidateLimit),
      );
      const rerankRuntime = resolveFinalRerankRuntime({
        input,
        reranker: undefined,
        rerankerFactory,
        rerankerModel: undefined,
      });
      if (!rerankRuntime) throw new Error("Research retrieval reranker is unavailable");
      let rerankMs = 0;
      const rerank = async (items: readonly HybridRetrievalItem[]) => {
        const rerankStartedAt = now();
        const result = await rerankHybridRetrievalItems({
          items,
          limit: items.length,
          model: rerankRuntime.model,
          query: input.query,
          reranker: rerankRuntime.provider,
          tenantId,
        });
        rerankMs += Math.max(0, now() - rerankStartedAt);
        return thresholdItems(result, rerankRuntime.scoreThreshold);
      };
      let recalled: HybridRetrievalResult[] = [];
      let fused: Awaited<ReturnType<typeof rerankHybridRetrievalItems>>;
      let reranked: Awaited<ReturnType<typeof rerankHybridRetrievalItems>>;
      let judgement = restored?.checkpoint.judgement;
      let judgeMs = 0;
      const shouldRecall = !restored || restored.checkpoint.phase === "planned";
      if (!shouldRecall) {
        if (!restored) {
          throw new Error("Research V3 restore state is unavailable");
        }
        if (!restored.result) {
          throw new Error(
            `Research V3 ${restored.checkpoint.phase} checkpoint is missing its evidence result`,
          );
        }
        fused = [...restored.result.items];
        reranked = [...restored.result.items];
      } else {
        const subqueries = queryPlan.subqueries.slice(0, Math.max(0, maxCandidateLists - 1));
        const vectors = await vectorizeSubqueries({
          embeddingProfile,
          input,
          queries: subqueries,
          queryVectorizer,
          tenantId,
        });
        const queryInputs = [
          { query: input.query, vector: input.queryVector, weight: 1 },
          ...subqueries.map((query, index) => ({
            query,
            vector: vectors[index] ?? [],
            weight: 0.85,
          })),
        ];
        if (!budget.consume("rounds") || !budget.consume("retrievalSteps", queryInputs.length)) {
          throw new Error("Research retrieval step budget was exhausted before candidate recall");
        }
        recalled = await Promise.all(
          queryInputs.map(({ query, vector }, index) =>
            retriever.retrieve({
              ...input,
              limit: candidateLimit,
              query,
              queryVector: vector,
              researchExecutionPolicy: policy,
              // Graph is a single knowledge-space-wide recall leg, not one traversal per rewrite.
              researchGraphEnabled: queryPlan.useGraph && index === 0,
              topK: candidateLimit,
            }),
          ),
        );
        fused = fuseRankedHybridRetrievalLists({
          limit: candidateLimit,
          lists: recalled.map((result, index) => ({
            items: result.items,
            label: `query:${index}`,
            weight: queryInputs[index]?.weight ?? 0.85,
          })),
        });
        reranked = await rerank(fused);
        const initialResult: HybridRetrievalResult = {
          items: reranked.slice(0, input.limit),
          metrics: aggregateRecallMetrics(recalled),
          plan: { ...retrievalPlan, strategyVersion: "retrieval-planner-v2" },
        };
        await persistV3Boundary({
          budget: budget.snapshot(),
          input,
          phase: "initial",
          queryPlan,
          result: initialResult,
          sequence: 1,
        });
      }
      await input.onResearchStageChange?.("analyzing", {
        results: [
          {
            chunkCount: Math.min(reranked.length, input.limit),
            question: input.query,
          },
        ],
        retrievalCount: fused.length,
      });
      if (!judgement) {
        const judgeStartedAt = now();
        const evaluatedJudgement = await reasoning.judge({
          evidence: reranked.slice(0, input.limit),
          evidenceDimensions: queryPlan.evidenceDimensions,
          query: input.query,
          reasoningModel,
          reserveModelCall,
          researchModelCallObserver: input.researchModelCallObserver,
          tenantId,
          traceId: input.traceId,
        });
        judgement = evaluatedJudgement;
        judgeMs = Math.max(0, now() - judgeStartedAt);
      }
      let supplementalSearches = 0;

      if (
        !judgement.sufficient &&
        judgement.supplementalQuery &&
        policy.maxSupplementalSearches > 0
      ) {
        if (restored?.checkpoint.phase !== "supplemental") {
          const initialResult: HybridRetrievalResult = {
            items: reranked.slice(0, input.limit),
            plan: { ...retrievalPlan, strategyVersion: "retrieval-planner-v2" },
          };
          await persistV3Boundary({
            budget: budget.snapshot(),
            input,
            judgement,
            phase: "supplemental",
            queryPlan,
            result: initialResult,
            sequence: 2,
          });
          await input.onResearchRound?.({ result: initialResult, round: 1, terminal: false });
        }
        if (
          !budget.consume("rounds") ||
          !budget.consume("supplementalSearches") ||
          !budget.consume("retrievalSteps")
        ) {
          throw new Error("Research retrieval budget was exhausted before supplemental search");
        }
        const [supplementalVector] = await queryVectorizer.vectorize({
          embeddingProfile,
          knowledgeSpaceId: input.knowledgeSpaceId,
          queries: [judgement.supplementalQuery],
          tenantId,
        });
        assertVector(supplementalVector, "supplemental query");
        const supplemental = await retriever.retrieve({
          ...input,
          limit: candidateLimit,
          query: judgement.supplementalQuery,
          queryVector: supplementalVector,
          researchExecutionPolicy: policy,
          researchGraphEnabled: false,
          topK: candidateLimit,
        });
        supplementalSearches = 1;
        fused = fuseRankedHybridRetrievalLists({
          limit: candidateLimit,
          lists: [
            { items: reranked.slice(0, input.limit), label: "initial", weight: 1 },
            { items: supplemental.items, label: "supplemental", weight: 0.9 },
          ],
        });
        reranked = await rerank(fused);
      }

      const items = reranked.slice(0, input.limit);
      const snapshot = budget.snapshot();
      const metrics = combineResearchMetrics({
        base: aggregateRecallMetrics(recalled) ?? restored?.result?.metrics,
        candidateLists:
          1 + Math.min(queryPlan.subqueries.length, maxCandidateLists - 1) + supplementalSearches,
        fusedCandidates: fused.length,
        judgeMs,
        modelCalls: snapshot.modelCalls,
        planMs,
        rerankCandidates: fused.length,
        rerankMs,
        rounds: snapshot.rounds,
        sufficiencyReached: judgement.sufficient,
        supplementalSearches,
        totalMs: Math.max(0, now() - startedAt),
      });
      const result: HybridRetrievalResult = {
        items,
        metrics,
        plan: { ...retrievalPlan, strategyVersion: "retrieval-planner-v2" },
      };
      await persistV3Boundary({
        budget: snapshot,
        input,
        judgement,
        phase: "complete",
        queryPlan,
        result,
        sequence: supplementalSearches > 0 ? 3 : 2,
      });
      await input.onResearchRound?.({
        result,
        round: supplementalSearches + 1,
        terminal: true,
      });
      return result;
    },
  };
}

function restoreV3Checkpoint(input: RetrieveHybridInput):
  | {
      readonly checkpoint: ResearchEvidenceRetrievalSearchCheckpoint;
      readonly result: HybridRetrievalResult | undefined;
    }
  | undefined {
  if (input.researchSearchCheckpoint?.version !== ResearchEvidenceRetrievalCheckpointVersion) {
    return undefined;
  }
  const snapshot = input.projectionSnapshot;
  const tenantId = input.tenantId?.trim();
  const traceId = input.traceId?.trim();
  if (!snapshot || !tenantId || !traceId) {
    throw new Error("Research V3 checkpoint requires a published snapshot, tenant, and trace id");
  }
  const checkpoint = validateAnyResearchRetrievalSearchCheckpointScope({
    checkpoint: input.researchSearchCheckpoint,
    fingerprint: snapshot.fingerprint,
    knowledgeSpaceId: input.knowledgeSpaceId,
    publicationId: snapshot.publicationId,
    query: input.query,
    tenantId,
    traceId,
  });
  if (checkpoint.version !== ResearchEvidenceRetrievalCheckpointVersion) {
    throw new Error("Research V3 checkpoint parser returned an incompatible version");
  }
  return { checkpoint, result: input.researchSearchCheckpointResult };
}

async function persistV3Boundary({
  budget,
  input,
  judgement,
  phase,
  queryPlan,
  result,
  sequence,
}: {
  readonly budget: ResearchRetrievalBudgetSnapshot;
  readonly input: RetrieveHybridInput;
  readonly judgement?: ResearchEvidenceJudgement | undefined;
  readonly phase: ResearchEvidenceRetrievalSearchCheckpoint["phase"];
  readonly queryPlan: ResearchQueryPlan;
  readonly result: HybridRetrievalResult;
  readonly sequence: number;
}): Promise<void> {
  if (!input.onResearchSearchCheckpoint) return;
  const snapshot = input.projectionSnapshot;
  const tenantId = input.tenantId?.trim();
  const traceId = input.traceId?.trim();
  if (!snapshot || !tenantId || !traceId) {
    throw new Error("Research V3 durable checkpoint requires a published snapshot and trace id");
  }
  const checkpoint: ResearchEvidenceRetrievalSearchCheckpoint = {
    budget,
    fingerprint: snapshot.fingerprint,
    ...(judgement
      ? {
          judgement: {
            coverage: judgement.coverage,
            coveredDimensions: [...judgement.coveredDimensions],
            missingDimensions: [...judgement.missingDimensions],
            sufficient: judgement.sufficient,
            ...(judgement.supplementalQuery
              ? { supplementalQuery: judgement.supplementalQuery }
              : {}),
          },
        }
      : {}),
    knowledgeSpaceId: input.knowledgeSpaceId,
    phase,
    publicationId: snapshot.publicationId,
    query: input.query.trim(),
    queryPlan: {
      evidenceDimensions: [...queryPlan.evidenceDimensions],
      intent: queryPlan.intent,
      subqueries: [...queryPlan.subqueries],
      useGraph: queryPlan.useGraph,
    },
    sequence,
    tenantId,
    traceId,
    version: ResearchEvidenceRetrievalCheckpointVersion,
  };
  await input.onResearchSearchCheckpoint({ checkpoint, result });
}

async function vectorizeSubqueries({
  embeddingProfile,
  input,
  queries,
  queryVectorizer,
  tenantId,
}: {
  readonly embeddingProfile: NonNullable<RetrieveHybridInput["embeddingProfile"]>;
  readonly input: RetrieveHybridInput;
  readonly queries: readonly string[];
  readonly queryVectorizer: ResearchQueryVectorizer;
  readonly tenantId: string;
}): Promise<readonly (readonly number[])[]> {
  if (queries.length === 0) return [];
  const vectors = await queryVectorizer.vectorize({
    embeddingProfile,
    knowledgeSpaceId: input.knowledgeSpaceId,
    queries,
    tenantId,
  });
  if (vectors.length !== queries.length) {
    throw new Error(
      `Research query vectorizer returned ${vectors.length} vectors for ${queries.length} queries`,
    );
  }
  vectors.forEach((vector, index) => assertVector(vector, `subquery ${index + 1}`));
  return vectors;
}

function assertVector(
  vector: readonly number[] | undefined,
  label: string,
): asserts vector is readonly number[] {
  if (!vector || vector.length === 0 || !vector.every(Number.isFinite)) {
    throw new Error(`Research ${label} embedding must be a non-empty finite vector`);
  }
}

function thresholdItems(
  items: Awaited<ReturnType<typeof rerankHybridRetrievalItems>>,
  threshold: number | undefined,
) {
  return threshold === undefined ? items : items.filter((item) => item.score >= threshold);
}

function combineResearchMetrics({
  base,
  candidateLists,
  fusedCandidates,
  judgeMs,
  modelCalls,
  planMs,
  rerankCandidates,
  rerankMs,
  rounds,
  sufficiencyReached,
  supplementalSearches,
  totalMs,
}: {
  readonly base: HybridRetrievalMetrics | undefined;
  readonly candidateLists: number;
  readonly fusedCandidates: number;
  readonly judgeMs: number;
  readonly modelCalls: number;
  readonly planMs: number;
  readonly rerankCandidates: number;
  readonly rerankMs: number;
  readonly rounds: number;
  readonly sufficiencyReached: boolean;
  readonly supplementalSearches: number;
  readonly totalMs: number;
}): HybridRetrievalMetrics {
  return {
    ...(base ?? {}),
    denseCandidates: base?.denseCandidates ?? 0,
    denseMs: base?.denseMs ?? 0,
    ftsCandidates: base?.ftsCandidates ?? 0,
    ftsMs: base?.ftsMs ?? 0,
    fusedCandidates,
    fusionMs: base?.fusionMs ?? 0,
    rerankCandidates,
    rerankMs,
    researchCandidateLists: candidateLists,
    researchEvidenceJudgeMs: judgeMs,
    researchExecutionKind: base?.researchExecutionKind,
    researchModelCalls: modelCalls,
    researchPlanMs: planMs,
    researchRounds: rounds,
    researchRrfCandidates: fusedCandidates,
    researchStrategyVersion: "research-evidence-v3",
    researchSufficiencyReached: sufficiencyReached,
    researchSupplementalSearches: supplementalSearches,
    totalMs,
  };
}

function aggregateRecallMetrics(
  results: readonly HybridRetrievalResult[],
): HybridRetrievalMetrics | undefined {
  const metrics = results.flatMap((result) => (result.metrics ? [result.metrics] : []));
  if (metrics.length === 0) return undefined;
  const sum = (field: keyof HybridRetrievalMetrics) =>
    metrics.reduce((total, metric) => {
      const value = metric[field];
      return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
    }, 0);
  return {
    degradationFlags: [...new Set(metrics.flatMap((metric) => metric.degradationFlags ?? []))],
    denseCandidates: sum("denseCandidates"),
    denseMs: sum("denseMs"),
    ftsCandidates: sum("ftsCandidates"),
    ftsMs: sum("ftsMs"),
    fusedCandidates: sum("fusedCandidates"),
    fusionMs: sum("fusionMs"),
    graphExpansionCandidates: sum("graphExpansionCandidates"),
    graphExpansionMs: sum("graphExpansionMs"),
    graphExpansionRelations: sum("graphExpansionRelations"),
    graphExpansionSeeds: sum("graphExpansionSeeds"),
    graphExpansionTraversedEntities: sum("graphExpansionTraversedEntities"),
    pageIndexMatchedNodes: sum("pageIndexMatchedNodes"),
    pageIndexOpenedRanges: sum("pageIndexOpenedRanges"),
    pageIndexScannedOutlines: sum("pageIndexScannedOutlines"),
    researchOutlineLexicalCandidates: sum("researchOutlineLexicalCandidates"),
    totalMs: sum("totalMs"),
  };
}

function requiredText(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Research retrieval ${label} is required`);
  return normalized;
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Research evidence retrieval ${label} must be at least 1`);
  }
}
