import {
  assertKnowledgeSpaceRetrievalProfileForMode,
  hasRequiredKnowledgeSpaceRetrievalModels,
} from "@knowledge/core";
import type { RerankerProvider } from "@knowledge/embeddings";

import type { KnowledgeSpaceModelSelection } from "@knowledge/core";
import { createConcurrencyGate, runWithAbortSignal } from "./bounded-concurrency";
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
import { RESEARCH_MAX_RERANK_CANDIDATES } from "./research-retrieval-limits";
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
    readonly signal?: AbortSignal | undefined;
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
 * planned subqueries, reranks every list against the query that recalled it, and merges duplicate
 * evidence by its strongest query-specific relevance. The reasoning model then judges the evidence
 * set as a whole. An insufficient set may run exactly one focused supplemental retrieval, scored
 * against that supplemental query. No document or tree node invokes an LLM.
 */
export function createResearchEvidenceRetrieval({
  legacyResearchRetriever,
  maxCandidateLists = 4,
  maxRerankCandidates = RESEARCH_MAX_RERANK_CANDIDATES,
  now = Date.now,
  planner,
  queryVectorizer,
  reasoning,
  rerankerFactory,
  retriever,
}: ResearchEvidenceRetrievalOptions): BasicHybridRetriever {
  positiveInteger(maxCandidateLists, "maxCandidateLists");
  positiveInteger(maxRerankCandidates, "maxRerankCandidates");
  if (maxRerankCandidates > RESEARCH_MAX_RERANK_CANDIDATES) {
    throw new Error(
      `Research retrieval maxRerankCandidates must not exceed ${RESEARCH_MAX_RERANK_CANDIDATES}`,
    );
  }

  return {
    retrieve: async (input) => {
      input.signal?.throwIfAborted();
      if (input.mode !== "research") {
        return runWithAbortSignal(() => retriever.retrieve(input), input.signal);
      }

      // V2 checkpoints contain a PageIndex tree frontier. Keep in-flight tasks replayable until
      // their retained checkpoints expire; all fresh Research requests enter V3 below.
      if (input.researchSearchCheckpoint?.version === ResearchRetrievalCheckpointVersion) {
        if (!legacyResearchRetriever) {
          throw new Error("Legacy Research checkpoint cannot be resumed without the V2 retriever");
        }
        return runWithAbortSignal(() => legacyResearchRetriever.retrieve(input), input.signal);
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
      const remainingWallClockMs =
        policy.wallClockMs - (restored?.checkpoint.budget.elapsedMs ?? 0);
      if (remainingWallClockMs <= 0) {
        throw new Error("Research retrieval wall-clock budget was exhausted before execution");
      }
      const deadlineSignal = AbortSignal.timeout(Math.max(1, Math.ceil(remainingWallClockMs)));
      const executionSignal = input.signal
        ? AbortSignal.any([input.signal, deadlineSignal])
        : deadlineSignal;
      const executionInput: RetrieveHybridInput = { ...input, signal: executionSignal };
      const budget = createResearchRetrievalBudget(
        policy,
        now,
        restored?.checkpoint.budget,
        executionSignal,
      );
      const researchOpenGate =
        input.researchOpenGate ?? createConcurrencyGate(policy.maxConcurrentTreeSelections);
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
            signal: executionSignal,
            tenantId,
            traceId: input.traceId,
          });
      const planMs = restored ? 0 : Math.max(0, now() - planStartedAt);
      executionSignal.throwIfAborted();
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
      executionSignal.throwIfAborted();
      const candidateLimit = Math.min(
        maxRerankCandidates,
        Math.max(input.limit, retrievalPlan.rerankCandidateLimit),
      );
      const rerankCandidateBudget = maxRerankCandidates;
      // Supplemental fusion may reorder any reranked candidate, so replay-safe boundaries retain
      // the complete, globally bounded pool rather than only the public result or maxFinalItems.
      const checkpointCandidateLimit = candidateLimit;
      const rerankRuntime = resolveFinalRerankRuntime({
        input,
        reranker: undefined,
        rerankerFactory,
        rerankerModel: undefined,
      });
      if (!rerankRuntime) throw new Error("Research retrieval reranker is unavailable");
      const scoreThreshold = rerankRuntime.scoreThreshold;
      let rerankMs = restored?.result?.metrics?.rerankMs ?? 0;
      let rerankCandidates = restored?.result?.metrics?.rerankCandidates ?? 0;
      let scoreThresholdFilteredCandidates =
        restored?.result?.metrics?.scoreThresholdFilteredCandidates ?? 0;
      const rerankListCandidates = [
        ...(restored?.result?.metrics?.researchRerankListCandidates ?? []),
      ];
      const rerankLists = async (lists: readonly ResearchQueryRerankList[]) => {
        executionSignal.throwIfAborted();
        const rerankStartedAt = now();
        rerankCandidates += lists.reduce((total, list) => total + list.items.length, 0);
        rerankListCandidates.push(...lists.map((list) => list.items.length));
        try {
          return await Promise.all(
            lists.map(async (list) => {
              const rerankedItems = await rerankHybridRetrievalItems({
                items: list.items,
                limit: list.items.length,
                model: rerankRuntime.model,
                query: list.query,
                reranker: rerankRuntime.provider,
                signal: executionSignal,
                tenantId,
              });
              const thresholded = thresholdItems(rerankedItems, scoreThreshold);
              scoreThresholdFilteredCandidates += rerankedItems.length - thresholded.length;
              return { ...list, items: thresholded };
            }),
          );
        } finally {
          // Calls in one intent batch run concurrently, so this is user-visible wall time rather
          // than the sum of provider durations.
          rerankMs += Math.max(0, now() - rerankStartedAt);
        }
      };
      let recalled: HybridRetrievalResult[] = [];
      let fused: Awaited<ReturnType<typeof rerankHybridRetrievalItems>>;
      let reranked: Awaited<ReturnType<typeof rerankHybridRetrievalItems>>;
      let judgement = restored?.checkpoint.judgement;
      let judgeMs = 0;
      let queryEmbeddingMs = restored?.result?.metrics?.researchQueryEmbeddingMs ?? 0;
      const shouldRecall = !restored || restored.checkpoint.phase === "planned";
      const checkpointMetrics = (): HybridRetrievalMetrics | undefined => {
        const recallMetrics = aggregateRecallMetrics(
          recalled,
          shouldRecall ? undefined : restored?.result?.metrics,
        );
        return recallMetrics
          ? {
              ...recallMetrics,
              rerankCandidates,
              rerankMs,
              researchQueryEmbeddingMs: queryEmbeddingMs,
              researchRerankCandidateBudget: rerankCandidateBudget,
              researchRerankListCandidates: [...rerankListCandidates],
              ...(scoreThresholdFilteredCandidates > 0 ? { scoreThresholdFilteredCandidates } : {}),
            }
          : undefined;
      };
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
        const queryInputCount = 1 + subqueries.length;
        if (!budget.consume("rounds") || !budget.consume("retrievalSteps", queryInputCount)) {
          throw new Error("Research retrieval step budget was exhausted before candidate recall");
        }
        const subqueryEmbeddingStartedAt = now();
        const vectors = await vectorizeSubqueries({
          embeddingProfile,
          input: executionInput,
          queries: subqueries,
          queryVectorizer,
          tenantId,
        });
        queryEmbeddingMs += Math.max(0, now() - subqueryEmbeddingStartedAt);
        const queryInputs = [
          { query: input.query, vector: input.queryVector, weight: 1 },
          ...subqueries.map((query, index) => ({
            query,
            vector: vectors[index] ?? [],
            weight: 0.85,
          })),
        ];
        recalled = await Promise.all(
          queryInputs.map(({ query, vector }, index) =>
            runWithAbortSignal(
              () =>
                retriever.retrieve({
                  ...executionInput,
                  limit: candidateLimit,
                  query,
                  queryVector: vector,
                  researchExecutionPolicy: policy,
                  researchBudget: budget,
                  // Graph is a single knowledge-space-wide recall leg, not one traversal per rewrite.
                  researchGraphEnabled: queryPlan.useGraph && index === 0,
                  researchOpenGate,
                  topK: candidateLimit,
                }),
              executionSignal,
            ),
          ),
        );
        executionSignal.throwIfAborted();
        fused = fuseRankedHybridRetrievalLists({
          limit: candidateLimit,
          lists: recalled.map((result, index) => ({
            items: result.items,
            label: `query:${index}`,
            weight: queryInputs[index]?.weight ?? 0.85,
          })),
        });
        const queryRerankedLists = await rerankLists(
          boundResearchQueryRerankLists({
            limit: rerankCandidateBudget,
            lists: recalled.map((result, index) => ({
              items: result.items,
              label: `query:${index}`,
              query: queryInputs[index]?.query ?? input.query,
              weight: queryInputs[index]?.weight ?? 0.85,
            })),
          }),
        );
        reranked = mergeResearchQueryRerankedLists({
          limit: candidateLimit,
          lists: queryRerankedLists,
        });
        const initialResult: HybridRetrievalResult = {
          // Durable resume needs the bounded candidate tail, not only the final public Top K.
          items: reranked.slice(0, checkpointCandidateLimit),
          metrics: checkpointMetrics(),
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
      executionSignal.throwIfAborted();
      // Interactive retrieval cannot act on a supplemental query. Avoid paying for a diagnostic
      // model call whose control-flow output is intentionally disabled by policy.
      if (!judgement && policy.maxSupplementalSearches > 0) {
        const judgeStartedAt = now();
        const evaluatedJudgement = await reasoning.judge({
          evidence: reranked.slice(0, input.limit),
          evidenceDimensions: queryPlan.evidenceDimensions,
          query: input.query,
          reasoningModel,
          reserveModelCall,
          researchModelCallObserver: input.researchModelCallObserver,
          signal: executionSignal,
          tenantId,
          traceId: input.traceId,
        });
        judgement = evaluatedJudgement;
        judgeMs = Math.max(0, now() - judgeStartedAt);
      }
      let supplementalSearches = 0;

      if (
        judgement &&
        !judgement.sufficient &&
        judgement.supplementalQuery &&
        policy.maxSupplementalSearches > 0
      ) {
        const supplementalQuery = judgement.supplementalQuery;
        if (restored?.checkpoint.phase !== "supplemental") {
          const initialResult: HybridRetrievalResult = {
            items: reranked.slice(0, checkpointCandidateLimit),
            metrics: checkpointMetrics(),
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
        const supplementalEmbeddingStartedAt = now();
        const [supplementalVector] = await queryVectorizer.vectorize({
          embeddingProfile,
          knowledgeSpaceId: input.knowledgeSpaceId,
          queries: [supplementalQuery],
          signal: executionSignal,
          tenantId,
        });
        queryEmbeddingMs += Math.max(0, now() - supplementalEmbeddingStartedAt);
        assertVector(supplementalVector, "supplemental query");
        const supplemental = await runWithAbortSignal(
          () =>
            retriever.retrieve({
              ...executionInput,
              limit: candidateLimit,
              query: supplementalQuery,
              queryVector: supplementalVector,
              researchExecutionPolicy: policy,
              researchBudget: budget,
              researchGraphEnabled: false,
              researchOpenGate,
              topK: candidateLimit,
            }),
          executionSignal,
        );
        supplementalSearches = 1;
        recalled = [...recalled, supplemental];
        const [supplementalReranked] = await rerankLists([
          {
            items: supplemental.items,
            label: "supplemental",
            query: supplementalQuery,
            weight: 0.9,
          },
        ]);
        if (!supplementalReranked) {
          throw new Error("Research supplemental rerank result is unavailable");
        }
        const supplementalFusionLists = [
          { items: reranked, label: "initial", weight: 1 },
          { items: supplemental.items, label: "supplemental", weight: 0.9 },
        ] as const;
        fused = fuseRankedHybridRetrievalLists({
          limit: uniqueResearchCandidateCount(supplementalFusionLists),
          lists: supplementalFusionLists,
        });
        reranked = mergeResearchQueryRerankedLists({
          limit: candidateLimit,
          lists: [
            { items: reranked, label: "initial", query: input.query, weight: 1 },
            supplementalReranked,
          ],
        });
      }

      const items = reranked.slice(0, input.limit);
      executionSignal.throwIfAborted();
      const snapshot = budget.snapshot();
      const metrics = combineResearchMetrics({
        base: aggregateRecallMetrics(
          recalled,
          shouldRecall ? undefined : restored?.result?.metrics,
        ),
        budgetExhaustedReasons: snapshot.exhaustedReasons,
        candidateLists:
          1 + Math.min(queryPlan.subqueries.length, maxCandidateLists - 1) + supplementalSearches,
        fusedCandidates: fused.length,
        judgeMs,
        modelCalls: snapshot.modelCalls,
        openedResources: snapshot.openedResources,
        planMs,
        queryEmbeddingMs,
        rerankCandidateBudget,
        rerankCandidates,
        rerankListCandidates,
        rerankMs,
        retrievalSteps: snapshot.retrievalSteps,
        rounds: snapshot.rounds,
        ...(scoreThreshold === undefined ? {} : { scoreThresholdFilteredCandidates }),
        sufficiencyReached: judgement?.sufficient,
        supplementalSearches,
        totalMs: Math.max(snapshot.elapsedMs, Math.max(0, now() - startedAt)),
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
    ...(input.signal ? { signal: input.signal } : {}),
    tenantId,
  });
  input.signal?.throwIfAborted();
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

interface ResearchQueryRerankList {
  readonly items: readonly HybridRetrievalItem[];
  readonly label: string;
  readonly query: string;
  readonly weight: number;
}

interface ResearchQueryRerankMatch {
  readonly label: string;
  readonly query: string;
  readonly score: number;
  readonly weight: number;
}

/**
 * Gives every query intent ranked candidates while keeping the total provider documents bounded by
 * the existing Research rerank candidate limit. Duplicate nodes intentionally remain in separate
 * lists because they need an independent relevance score for each query that recalled them.
 */
function boundResearchQueryRerankLists({
  limit,
  lists,
}: {
  readonly limit: number;
  readonly lists: readonly ResearchQueryRerankList[];
}): ResearchQueryRerankList[] {
  const selected = lists.map((list) => ({ ...list, items: [] as HybridRetrievalItem[] }));
  let count = 0;
  let rank = 0;
  while (count < limit) {
    let found = false;
    for (const [index, list] of lists.entries()) {
      const item = list.items[rank];
      if (!item) continue;
      found = true;
      selected[index]?.items.push(item);
      count += 1;
      if (count >= limit) break;
    }
    if (!found) break;
    rank += 1;
  }
  return selected.filter((list) => list.items.length > 0);
}

/**
 * Combines independently reranked query lists without averaging incomparable intent scores.
 *
 * A passage that answers one part of a compound question should keep that strong cross-encoder
 * score even when it is weak against the broader wording. RRF remains the deterministic tie-break
 * and provenance union; the user-facing score is the strongest raw reranker relevance.
 */
function mergeResearchQueryRerankedLists({
  limit,
  lists,
}: {
  readonly limit: number;
  readonly lists: readonly ResearchQueryRerankList[];
}): HybridRetrievalItem[] {
  const fused = fuseRankedHybridRetrievalLists({
    // RRF supplies provenance and a deterministic tie-break. It must not pre-filter candidates
    // that have already paid for a query-specific reranker score.
    limit: uniqueResearchCandidateCount(lists),
    lists: lists.map((list) => ({
      items: list.items,
      label: list.label,
      weight: list.weight,
    })),
  });
  const fusedRank = new Map(fused.map((item, index) => [item.nodeId, index]));
  const candidates = new Map<
    string,
    {
      matches: ResearchQueryRerankMatch[];
      winner: HybridRetrievalItem;
      winnerMatch: ResearchQueryRerankMatch;
    }
  >();

  for (const list of lists) {
    for (const item of list.items) {
      const matches = queryRerankMatches(item, list);
      const strongest = matches.reduce((best, candidate) =>
        compareQueryRerankMatches(candidate, best) < 0 ? candidate : best,
      );
      const existing = candidates.get(item.nodeId);
      if (!existing) {
        candidates.set(item.nodeId, {
          matches: [...matches],
          winner: item,
          winnerMatch: strongest,
        });
        continue;
      }
      existing.matches.push(...matches);
      if (compareQueryRerankMatches(strongest, existing.winnerMatch) < 0) {
        existing.winner = item;
        existing.winnerMatch = strongest;
      }
    }
  }

  return fused
    .flatMap((item): HybridRetrievalItem[] => {
      const candidate = candidates.get(item.nodeId);
      if (!candidate) return [];
      const matches = dedupeQueryRerankMatches(candidate.matches);
      return [
        {
          ...item,
          metadata: {
            ...item.metadata,
            ...candidate.winner.metadata,
            // Keep the RRF provenance from this merge rather than an earlier merge checkpoint.
            researchRrf: item.metadata.researchRrf,
            rerankScore: candidate.winnerMatch.score,
            researchRerank: {
              matches,
              query: candidate.winnerMatch.query,
              score: candidate.winnerMatch.score,
              version: "query-aware-max-v1",
            },
          },
          score: candidate.winnerMatch.score,
        },
      ];
    })
    .sort(
      (first, second) =>
        second.score - first.score ||
        (fusedRank.get(first.nodeId) ?? Number.MAX_SAFE_INTEGER) -
          (fusedRank.get(second.nodeId) ?? Number.MAX_SAFE_INTEGER) ||
        first.nodeId.localeCompare(second.nodeId),
    )
    .slice(0, limit);
}

function uniqueResearchCandidateCount(
  lists: readonly { readonly items: readonly HybridRetrievalItem[] }[],
): number {
  return Math.max(1, new Set(lists.flatMap((list) => list.items.map((item) => item.nodeId))).size);
}

function queryRerankMatches(
  item: HybridRetrievalItem,
  list: ResearchQueryRerankList,
): ResearchQueryRerankMatch[] {
  const value = item.metadata.researchRerank;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const matches = (value as { readonly matches?: unknown }).matches;
    if (Array.isArray(matches)) {
      const parsed = matches.flatMap((match): ResearchQueryRerankMatch[] => {
        if (!match || typeof match !== "object" || Array.isArray(match)) return [];
        const candidate = match as Record<string, unknown>;
        if (
          typeof candidate.label !== "string" ||
          !candidate.label.trim() ||
          typeof candidate.query !== "string" ||
          !candidate.query.trim() ||
          typeof candidate.score !== "number" ||
          !Number.isFinite(candidate.score) ||
          candidate.score < 0 ||
          candidate.score > 1 ||
          typeof candidate.weight !== "number" ||
          !Number.isFinite(candidate.weight) ||
          candidate.weight <= 0
        ) {
          return [];
        }
        return [
          {
            label: candidate.label.trim(),
            query: candidate.query.trim(),
            score: candidate.score,
            weight: candidate.weight,
          },
        ];
      });
      if (parsed.length > 0) return parsed;
    }
  }
  return [{ label: list.label, query: list.query, score: item.score, weight: list.weight }];
}

function dedupeQueryRerankMatches(
  matches: readonly ResearchQueryRerankMatch[],
): ResearchQueryRerankMatch[] {
  const byQuery = new Map<string, ResearchQueryRerankMatch>();
  for (const match of matches) {
    const key = `${match.label}\u0000${match.query}`;
    const existing = byQuery.get(key);
    if (!existing || compareQueryRerankMatches(match, existing) < 0) {
      byQuery.set(key, match);
    }
  }
  return [...byQuery.values()].sort(compareQueryRerankMatches);
}

function compareQueryRerankMatches(
  first: ResearchQueryRerankMatch,
  second: ResearchQueryRerankMatch,
): number {
  return (
    second.score - first.score ||
    second.weight - first.weight ||
    first.label.localeCompare(second.label) ||
    first.query.localeCompare(second.query)
  );
}

function thresholdItems(
  items: Awaited<ReturnType<typeof rerankHybridRetrievalItems>>,
  threshold: number | undefined,
) {
  return threshold === undefined ? items : items.filter((item) => item.score >= threshold);
}

function combineResearchMetrics({
  base,
  budgetExhaustedReasons,
  candidateLists,
  fusedCandidates,
  judgeMs,
  modelCalls,
  openedResources,
  planMs,
  queryEmbeddingMs,
  rerankCandidateBudget,
  rerankCandidates,
  rerankListCandidates,
  rerankMs,
  retrievalSteps,
  rounds,
  scoreThresholdFilteredCandidates,
  sufficiencyReached,
  supplementalSearches,
  totalMs,
}: {
  readonly base: HybridRetrievalMetrics | undefined;
  readonly budgetExhaustedReasons: readonly string[];
  readonly candidateLists: number;
  readonly fusedCandidates: number;
  readonly judgeMs: number;
  readonly modelCalls: number;
  readonly openedResources: number;
  readonly planMs: number;
  readonly queryEmbeddingMs: number;
  readonly rerankCandidateBudget: number;
  readonly rerankCandidates: number;
  readonly rerankListCandidates: readonly number[];
  readonly rerankMs: number;
  readonly retrievalSteps: number;
  readonly rounds: number;
  readonly scoreThresholdFilteredCandidates?: number | undefined;
  readonly sufficiencyReached?: boolean | undefined;
  readonly supplementalSearches: number;
  readonly totalMs: number;
}): HybridRetrievalMetrics {
  const observedStageMaxMs = Math.max(
    base?.denseMs ?? 0,
    base?.ftsMs ?? 0,
    base?.fusionMs ?? 0,
    base?.graphExpansionMs ?? 0,
    judgeMs,
    planMs,
    queryEmbeddingMs,
    rerankMs,
  );
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
    ...(budgetExhaustedReasons.length > 0
      ? { researchBudgetExhaustedReasons: [...budgetExhaustedReasons] }
      : {}),
    researchEvidenceJudgeMs: judgeMs,
    ...(base?.researchExecutionKind ? { researchExecutionKind: base.researchExecutionKind } : {}),
    researchModelCalls: modelCalls,
    researchOpenedResources: openedResources,
    researchPlanMs: planMs,
    researchQueryEmbeddingMs: queryEmbeddingMs,
    researchRerankCandidateBudget: rerankCandidateBudget,
    researchRerankListCandidates: [...rerankListCandidates],
    researchRetrievalSteps: retrievalSteps,
    researchRounds: rounds,
    researchRrfCandidates: fusedCandidates,
    researchStrategyVersion: "research-evidence-v3",
    ...(sufficiencyReached === undefined ? {} : { researchSufficiencyReached: sufficiencyReached }),
    researchSupplementalSearches: supplementalSearches,
    ...(scoreThresholdFilteredCandidates === undefined ? {} : { scoreThresholdFilteredCandidates }),
    // Provider telemetry may be rounded independently from the local clock. Never publish a
    // component duration greater than the end-to-end duration shown beside it.
    totalMs: Math.max(totalMs, observedStageMaxMs),
  };
}

function aggregateRecallMetrics(
  results: readonly HybridRetrievalResult[],
  prior?: HybridRetrievalMetrics | undefined,
): HybridRetrievalMetrics | undefined {
  const metrics = [
    ...(prior ? [prior] : []),
    ...results.flatMap((result) => (result.metrics ? [result.metrics] : [])),
  ];
  if (metrics.length === 0) return undefined;
  const sum = (field: keyof HybridRetrievalMetrics) =>
    metrics.reduce((total, metric) => {
      const value = metric[field];
      return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
    }, 0);
  const maximum = (field: keyof HybridRetrievalMetrics) =>
    metrics.reduce((largest, metric) => {
      const value = metric[field];
      return typeof value === "number" && Number.isFinite(value)
        ? Math.max(largest, value)
        : largest;
    }, 0);
  const has = (field: keyof HybridRetrievalMetrics) =>
    metrics.some((metric) => metric[field] !== undefined);
  const aggregateResearchWork = (
    aggregateField: "researchRecallDenseCandidates" | "researchRecallFtsCandidates",
    fallbackField: "denseCandidates" | "ftsCandidates",
  ) =>
    metrics.reduce((total, metric) => {
      const value = metric[aggregateField] ?? metric[fallbackField];
      return total + (Number.isFinite(value) ? value : 0);
    }, 0);
  return {
    degradationFlags: [...new Set(metrics.flatMap((metric) => metric.degradationFlags ?? []))],
    denseCandidates: maximum("denseCandidates"),
    denseMs: maximum("denseMs"),
    ...(has("documentOutlineMatchedItems")
      ? { documentOutlineMatchedItems: sum("documentOutlineMatchedItems") }
      : {}),
    ftsCandidates: maximum("ftsCandidates"),
    ftsMs: maximum("ftsMs"),
    fusedCandidates: sum("fusedCandidates"),
    fusionMs: maximum("fusionMs"),
    ...(has("graphExpansionCandidates")
      ? { graphExpansionCandidates: sum("graphExpansionCandidates") }
      : {}),
    ...(has("graphExpansionMs") ? { graphExpansionMs: maximum("graphExpansionMs") } : {}),
    ...(has("graphExpansionRelations")
      ? { graphExpansionRelations: sum("graphExpansionRelations") }
      : {}),
    ...(has("graphExpansionSeeds") ? { graphExpansionSeeds: sum("graphExpansionSeeds") } : {}),
    ...(has("graphExpansionTraversedEntities")
      ? { graphExpansionTraversedEntities: sum("graphExpansionTraversedEntities") }
      : {}),
    ...(has("pageIndexMatchedNodes")
      ? { pageIndexMatchedNodes: sum("pageIndexMatchedNodes") }
      : {}),
    ...(has("pageIndexOpenedRanges")
      ? { pageIndexOpenedRanges: sum("pageIndexOpenedRanges") }
      : {}),
    ...(has("pageIndexScannedOutlines")
      ? { pageIndexScannedOutlines: sum("pageIndexScannedOutlines") }
      : {}),
    ...(has("researchOutlineLexicalCandidates")
      ? { researchOutlineLexicalCandidates: sum("researchOutlineLexicalCandidates") }
      : {}),
    // A restored boundary already contains aggregate work from its original parallel legs. Do not
    // collapse that total back to the standard per-leg maximum when a supplemental result joins it.
    researchRecallDenseCandidates: aggregateResearchWork(
      "researchRecallDenseCandidates",
      "denseCandidates",
    ),
    researchRecallFtsCandidates: aggregateResearchWork(
      "researchRecallFtsCandidates",
      "ftsCandidates",
    ),
    // Query legs run concurrently. Standard durations/counts describe the user-visible critical
    // path; explicitly named researchRecall* counters retain aggregate provider work.
    totalMs: maximum("totalMs"),
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
