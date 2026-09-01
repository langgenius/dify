import type { KnowledgeSpaceRetrievalProfile } from "@knowledge/core";

import {
  type PageIndexDocumentSelection,
  selectPageIndexDocuments,
} from "./page-index-document-selection";
import type { PageIndexFindabilityRepository } from "./page-index-findability-repository";
import {
  type PageIndexLayeredTreeCheckpoint,
  type PageIndexLayeredTreeSearch,
  PageIndexLayeredTreeSearchContractError,
  createInitialPageIndexLayeredTreeCheckpoint,
} from "./page-index-layered-tree-search";
import {
  type PageIndexNodeQueueItem,
  buildPageIndexNodeQueue,
  openPageIndexEvidenceQueue,
} from "./page-index-node-queue";
import { buildPageIndexNodeValues } from "./page-index-node-values";
import {
  type PageIndexSemanticCandidate,
  PageIndexSemanticScoreContractError,
  PageIndexSemanticScoreVersion,
  type PageIndexSemanticTreeSearch,
} from "./page-index-semantic-tree-search";
import {
  type PageIndexWholeTreeNodeSelection,
  PageIndexWholeTreeSelectionContractError,
  type PageIndexWholeTreeSelectionResult,
  type PageIndexWholeTreeSelector,
} from "./page-index-whole-tree-selection";
import type {
  PublishedPageIndexOutlineItem,
  PublishedPageIndexRepository,
} from "./published-page-index-repository";
import { ResearchModelCallObserverError } from "./research-model-usage";
import {
  type ResearchRetrievalCheckpointMetrics,
  type ResearchRetrievalCheckpointNavigation,
  ResearchRetrievalCheckpointVersion,
  type ResearchRetrievalSearchCheckpoint,
  parseResearchRetrievalSearchCheckpoint,
  validateResearchRetrievalSearchCheckpointScope,
} from "./research-retrieval-checkpoint";
import {
  InteractiveResearchRetrievalPolicy,
  type ResearchRetrievalBudget,
  type ResearchRetrievalExecutionPolicy,
  createResearchRetrievalBudget,
  validateResearchRetrievalPolicy,
} from "./research-retrieval-policy";
import {
  type HybridRetrievalRepository,
  type RetrievalCandidate,
  filterRetrievalCandidatesByMetadata,
  filterRetrievalCandidatesByPermission,
  normalizeRetrievalPermissionScope,
} from "./retrieval-candidates";
import { normalizeRetrievalMetadataFilters } from "./retrieval-filter-utils";
import type { RetrievalPlanner } from "./retrieval-planner";
import { evidenceTextFromHybridItem } from "./retrieval-rerank";
import type {
  BasicHybridRetriever,
  HybridRetrievalMetrics,
  HybridRetrievalResult,
  RetrievalPlan,
  RetrieveHybridInput,
} from "./retrieval-types";

export interface PublishedPageIndexRetrievalOptions {
  /** Exact-generation quality routes; failed findability bypasses layered LLM navigation. */
  readonly findability?: Pick<PageIndexFindabilityRepository, "getManyRoutes"> | undefined;
  /** Primary book-like navigator. When configured, Research traverses sibling levels in order. */
  readonly layeredTreeSearch?: PageIndexLayeredTreeSearch | undefined;
  /** Maximum dense candidates retained for the bounded flattening fallback. */
  readonly maxSemanticCandidates: number;
  /** Must match the semantic scorer's provider batch bound for runtime call accounting. */
  readonly maxSemanticCandidatesPerCall?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly pageIndex: Pick<PublishedPageIndexRepository, "listOutlines" | "openLeafEvidence">;
  readonly planner: RetrievalPlanner;
  readonly retriever: BasicHybridRetriever;
  /** Bounded semantic fallback for generations that cannot safely use layered navigation. */
  readonly semanticTreeSearch: PageIndexSemanticTreeSearch;
  readonly valueSearch: Pick<
    HybridRetrievalRepository,
    "publishedMembershipEnforced" | "searchDense"
  >;
  /** Compatibility selector used only when the layered navigator is not installed. */
  readonly wholeTreeSelector: PageIndexWholeTreeSelector;
}

export class PublishedPageIndexCapabilityUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishedPageIndexCapabilityUnavailableError";
  }
}

interface PageIndexOutlineRuntime {
  readonly document: PageIndexDocumentSelection;
  readonly item: PublishedPageIndexOutlineItem;
  readonly nodeValues: ReturnType<typeof buildPageIndexNodeValues>;
}

interface PageIndexTreeDecision {
  readonly context: PageIndexOutlineRuntime;
  readonly degradation?: string | undefined;
  readonly estimatedPromptTokens?: number | undefined;
  readonly flattenedLevels?: number | undefined;
  readonly layeredSteps?: number | undefined;
  readonly layeredCheckpoint?: PageIndexLayeredTreeCheckpoint | undefined;
  readonly result?: PageIndexWholeTreeSelectionResult | undefined;
  readonly scannedNodes?: number | undefined;
  readonly selections: readonly PageIndexWholeTreeNodeSelection[];
  readonly strategy: "candidate-flattening" | "layered" | "value-only" | "whole-tree";
}

interface FlattenedFallbackCandidate {
  readonly candidate: PageIndexSemanticCandidate;
  readonly context: PageIndexOutlineRuntime;
  readonly outlineNodeId: string;
}

type OpenedPageIndexEvidence = Awaited<ReturnType<typeof openPageIndexEvidenceQueue>>;

/**
 * Fast and Deep stay on the ordinary stack. Research selects documents from immutable dense
 * projections, loads only those outlines, descends each title/summary tree one visible level at a
 * time, merges LLM and Value decisions, then opens only the bounded selected ranges.
 */
export function createPublishedPageIndexRetrievalPath({
  findability,
  layeredTreeSearch,
  maxSemanticCandidates,
  maxSemanticCandidatesPerCall = 5,
  now = Date.now,
  pageIndex,
  planner,
  retriever,
  semanticTreeSearch,
  valueSearch,
  wholeTreeSelector,
}: PublishedPageIndexRetrievalOptions): BasicHybridRetriever {
  validatePositiveInteger(maxSemanticCandidates, "maxSemanticCandidates");
  validatePositiveInteger(maxSemanticCandidatesPerCall, "maxSemanticCandidatesPerCall");

  return {
    retrieve: async (input) => {
      const plan = planner.plan({
        hasQueryImages: (input.queryImages?.length ?? 0) > 0,
        mode: input.mode,
        query: input.query,
        topK: input.topK,
        traceId: input.traceId,
      });
      if (plan.resolvedMode !== "research") {
        return retriever.retrieve(input);
      }
      return retrievePublishedPageIndex({
        findability,
        input,
        layeredTreeSearch,
        maxSemanticCandidates,
        maxSemanticCandidatesPerCall,
        now,
        pageIndex,
        plan,
        semanticTreeSearch,
        valueSearch,
        wholeTreeSelector,
      });
    },
  };
}

async function retrievePublishedPageIndex({
  findability,
  input,
  layeredTreeSearch,
  maxSemanticCandidates,
  maxSemanticCandidatesPerCall,
  now,
  pageIndex,
  plan,
  semanticTreeSearch,
  valueSearch,
  wholeTreeSelector,
}: {
  readonly findability?: Pick<PageIndexFindabilityRepository, "getManyRoutes"> | undefined;
  readonly input: RetrieveHybridInput;
  readonly layeredTreeSearch?: PageIndexLayeredTreeSearch | undefined;
  readonly maxSemanticCandidates: number;
  readonly maxSemanticCandidatesPerCall: number;
  readonly now: () => number;
  readonly pageIndex: Pick<PublishedPageIndexRepository, "listOutlines" | "openLeafEvidence">;
  readonly plan: RetrievalPlan;
  readonly semanticTreeSearch: PageIndexSemanticTreeSearch;
  readonly valueSearch: Pick<
    HybridRetrievalRepository,
    "publishedMembershipEnforced" | "searchDense"
  >;
  readonly wholeTreeSelector: PageIndexWholeTreeSelector;
}): Promise<HybridRetrievalResult> {
  const startedAt = now();
  const prerequisites = researchPrerequisites(input, valueSearch);
  const policy = validateResearchRetrievalPolicy(
    input.researchExecutionPolicy ?? InteractiveResearchRetrievalPolicy,
  );
  const traceId = input.traceId?.trim();
  if ((input.researchSearchCheckpoint || input.onResearchSearchCheckpoint) && !traceId) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Durable Research retrieval checkpoints require a trace id",
    );
  }
  const restoredCheckpoint = input.researchSearchCheckpoint
    ? validateResearchRetrievalSearchCheckpointScope({
        checkpoint: input.researchSearchCheckpoint,
        fingerprint: prerequisites.snapshot.fingerprint,
        knowledgeSpaceId: input.knowledgeSpaceId,
        publicationId: prerequisites.snapshot.publicationId,
        query: input.query,
        tenantId: prerequisites.snapshot.tenantId,
        traceId: traceId ?? "",
      })
    : undefined;
  const budget = createResearchRetrievalBudget(
    policy,
    now,
    restoredCheckpoint?.budget,
    input.signal,
  );
  const degradationFlags = new Set<string>(restoredCheckpoint?.metrics.degradationFlags ?? []);

  if (restoredCheckpoint && restoredCheckpoint.phase !== "navigation") {
    return resumeResearchEvidenceCheckpoint({
      budget,
      checkpoint: restoredCheckpoint,
      degradationFlags,
      input,
      now,
      pageIndex,
      plan,
      policy,
      prerequisites,
      startedAt,
    });
  }

  if (!budget.consume("retrievalSteps")) {
    degradationFlags.add("research-budget-exhausted");
    return emptyResearchResult({
      degradationFlags,
      denseCandidates: 0,
      input,
      now,
      plan,
      policy,
      startedAt,
      valueMs: 0,
      budget,
    });
  }

  const valueStartedAt = now();
  const rawValueCandidates = await valueSearch.searchDense({
    denseProjectionModel: input.denseProjectionModel,
    denseProjectionStatuses: input.denseProjectionStatuses,
    denseProjectionVersion: input.denseProjectionVersion,
    filters: input.filters,
    knowledgeSpaceId: input.knowledgeSpaceId,
    permissionScope: input.permissionScope,
    projectionSetCandidateFingerprint: input.projectionSetCandidateFingerprint,
    projectionSetFingerprint: input.projectionSetFingerprint,
    projectionSetPublicationId: prerequisites.snapshot.publicationId,
    projectionSetReadMode: input.projectionSetReadMode,
    queryVector: input.queryVector,
    tenantId: prerequisites.snapshot.tenantId,
    topK: Math.max(1, plan.denseTopK),
  });
  const valueMs = Math.max(0, now() - valueStartedAt);
  const metadataFiltered = filterRetrievalCandidatesByMetadata(
    rawValueCandidates,
    normalizeRetrievalMetadataFilters(input.filters),
  );
  const permissionFiltered = filterRetrievalCandidatesByPermission(
    metadataFiltered,
    normalizeRetrievalPermissionScope(input.permissionScope),
  );
  const selectedDocuments = selectPageIndexDocuments({
    candidates: permissionFiltered,
    maxDocuments: policy.maxDocuments,
    maxHitsPerDocument: policy.maxHitsPerDocument,
  });
  const candidateTruncated =
    permissionFiltered.length >
    selectedDocuments.reduce((total, document) => total + document.hits.length, 0);

  if (selectedDocuments.length === 0) {
    return emptyResearchResult({
      candidateTruncated,
      degradationFlags,
      denseCandidates: rawValueCandidates.length,
      input,
      metadataFilteredCandidates: rawValueCandidates.length - metadataFiltered.length,
      now,
      permissionFilteredCandidates: metadataFiltered.length - permissionFiltered.length,
      plan,
      policy,
      startedAt,
      valueMs,
      budget,
    });
  }

  if (!budget.consume("retrievalSteps")) {
    degradationFlags.add("research-budget-exhausted");
    return emptyResearchResult({
      candidateTruncated,
      degradationFlags,
      denseCandidates: rawValueCandidates.length,
      input,
      metadataFilteredCandidates: rawValueCandidates.length - metadataFiltered.length,
      now,
      permissionFilteredCandidates: metadataFiltered.length - permissionFiltered.length,
      plan,
      policy,
      selectedDocuments: selectedDocuments.length,
      startedAt,
      valueMs,
      budget,
    });
  }

  const outlines = await pageIndex.listOutlines({
    documentAssetIds: selectedDocuments.map((document) => document.documentAssetId),
    fingerprint: prerequisites.snapshot.fingerprint,
    knowledgeSpaceId: input.knowledgeSpaceId,
    limit: policy.maxDocuments,
    permissionScope: prerequisites.permissionScope,
    publicationId: prerequisites.snapshot.publicationId,
    tenantId: prerequisites.snapshot.tenantId,
  });
  const selectedByDocument = new Map(
    selectedDocuments.map((document) => [document.documentAssetId, document]),
  );
  const seenDocuments = new Set<string>();
  const contexts: PageIndexOutlineRuntime[] = [];
  for (const item of outlines.items) {
    const document = selectedByDocument.get(item.documentAssetId);
    if (!document || seenDocuments.has(item.documentAssetId)) {
      continue;
    }
    seenDocuments.add(item.documentAssetId);
    contexts.push({
      document,
      item,
      nodeValues: buildPageIndexNodeValues({
        hits: document.hits,
        maxHitsPerNode: policy.maxHitsPerDocument,
        outline: item.outline,
      }),
    });
  }
  if (contexts.length < selectedDocuments.length) {
    degradationFlags.add("pageindex-outline-missing");
  }
  if (contexts.length === 0) {
    return emptyResearchResult({
      candidateTruncated,
      degradationFlags,
      denseCandidates: rawValueCandidates.length,
      input,
      metadataFilteredCandidates: rawValueCandidates.length - metadataFiltered.length,
      now,
      permissionFilteredCandidates: metadataFiltered.length - permissionFiltered.length,
      plan,
      policy,
      selectedDocuments: selectedDocuments.length,
      startedAt,
      valueMs,
      budget,
    });
  }

  const findabilityRoutes = findability
    ? await findability.getManyRoutes({
        documents: contexts.map((context) => ({
          documentAssetId: context.item.documentAssetId,
          generationId: context.item.generationId,
        })),
        knowledgeSpaceId: input.knowledgeSpaceId,
        limit: policy.maxDocuments,
        tenantId: prerequisites.snapshot.tenantId,
      })
    : [];
  const hybridFindabilityGenerations = new Set(
    findabilityRoutes
      .filter((route) => route.status === "failed" && route.recommendedRoute === "hybrid")
      .map((route) => `${route.documentAssetId}\u001f${route.generationId}`),
  );

  const restoredNavigationByOutline = new Map(
    (restoredCheckpoint?.navigation ?? []).map((entry) => [entry.outlineId, entry]),
  );
  const navigationByOutline = new Map<string, ResearchRetrievalCheckpointNavigation>();
  if (layeredTreeSearch) {
    for (const context of contexts) {
      const restored = restoredNavigationByOutline.get(context.item.outline.id);
      if (
        restored &&
        (restored.documentAssetId !== context.item.documentAssetId ||
          restored.generationId !== context.item.generationId)
      ) {
        throw new Error("Research retrieval search checkpoint navigation scope mismatch");
      }
      const qualityKey = `${context.item.documentAssetId}\u001f${context.item.generationId}`;
      if (hybridFindabilityGenerations.has(qualityKey) && !restored) {
        continue;
      }
      navigationByOutline.set(context.item.outline.id, {
        documentAssetId: context.item.documentAssetId,
        documentScore: context.document.score,
        estimatedPromptTokens: restored?.estimatedPromptTokens ?? 0,
        generationId: context.item.generationId,
        layeredCheckpoint:
          restored?.layeredCheckpoint ??
          createInitialPageIndexLayeredTreeCheckpoint({
            outline: context.item.outline,
            query: input.query,
          }),
        outlineId: context.item.outline.id,
        scannedNodeIds: restored?.scannedNodeIds ?? [],
      });
    }
    if (restoredNavigationByOutline.size > navigationByOutline.size) {
      throw new Error("Research retrieval search checkpoint contains stale navigation state");
    }
  } else if (restoredCheckpoint?.navigation.length) {
    throw new Error("Research retrieval search checkpoint requires layered tree search");
  }

  let checkpointSequence = restoredCheckpoint?.sequence ?? 0;
  let checkpointWrite = Promise.resolve();
  const persistNavigationCheckpoint = async (): Promise<void> => {
    if (!input.onResearchSearchCheckpoint || !traceId) return;
    const navigation = cloneNavigationStates(navigationByOutline);
    const checkpoint = researchSearchCheckpoint({
      budget: budget.snapshot(),
      fingerprint: prerequisites.snapshot.fingerprint,
      knowledgeSpaceId: input.knowledgeSpaceId,
      metrics: {
        candidateTruncated,
        degradationFlags: [...degradationFlags].sort(),
        denseCandidates: rawValueCandidates.length,
        fallbackDocuments: 0,
        flattenedLevels: navigation.reduce(
          (total, entry) => total + entry.layeredCheckpoint.flattenedNodeIds.length,
          0,
        ),
        layeredDocuments: navigation.length,
        layeredSteps: navigation.reduce((total, entry) => total + entry.layeredCheckpoint.depth, 0),
        metadataFilteredCandidates: rawValueCandidates.length - metadataFiltered.length,
        openedRanges: 0,
        permissionFilteredCandidates: metadataFiltered.length - permissionFiltered.length,
        scannedNodes: navigation.reduce(
          (total, entry) => total + entry.layeredCheckpoint.visitedNodeIds.length,
          0,
        ),
        selectedDocuments: selectedDocuments.length,
        serializedTreeTokens: navigation.reduce(
          (total, entry) => total + entry.estimatedPromptTokens,
          0,
        ),
        valueMs,
        wholeTreeDocuments: 0,
      },
      missingAspects: ["evidence ranges have not been opened"],
      navigation,
      openedRangeCount: 0,
      openedTruncated: false,
      phase: "navigation",
      publicationId: prerequisites.snapshot.publicationId,
      query: input.query,
      queue: [],
      queueOffset: 0,
      researchSufficiencyReached: false,
      sequence: ++checkpointSequence,
      tenantId: prerequisites.snapshot.tenantId,
      traceId,
      version: ResearchRetrievalCheckpointVersion,
    });
    checkpointWrite = checkpointWrite.then(() =>
      input.onResearchSearchCheckpoint?.({
        checkpoint,
        result: { items: [], plan },
      }),
    );
    await checkpointWrite;
  };

  const initialDecisions = await mapWithConcurrency(
    contexts,
    policy.maxConcurrentTreeSelections,
    async (context) =>
      hybridFindabilityGenerations.has(
        `${context.item.documentAssetId}\u001f${context.item.generationId}`,
      ) && !restoredNavigationByOutline.has(context.item.outline.id)
        ? {
            context,
            degradation: "pageindex-findability-hybrid",
            selections: [],
            strategy: "candidate-flattening" as const,
          }
        : layeredTreeSearch
          ? selectLayeredTreeWithRetry({
              budget,
              context,
              layeredTreeSearch,
              policy,
              query: input.query,
              reasoningModel: prerequisites.profile.reasoningModel,
              researchModelCallObserver: input.researchModelCallObserver,
              tenantId: prerequisites.snapshot.tenantId,
              initialCheckpoint: navigationByOutline.get(context.item.outline.id)
                ?.layeredCheckpoint,
              initialEstimatedPromptTokens: navigationByOutline.get(context.item.outline.id)
                ?.estimatedPromptTokens,
              initialScannedNodeIds: navigationByOutline.get(context.item.outline.id)
                ?.scannedNodeIds,
              onStep: async (checkpoint, progress) => {
                navigationByOutline.set(context.item.outline.id, {
                  documentAssetId: context.item.documentAssetId,
                  documentScore: context.document.score,
                  estimatedPromptTokens: progress.estimatedPromptTokens,
                  generationId: context.item.generationId,
                  layeredCheckpoint: checkpoint,
                  outlineId: context.item.outline.id,
                  scannedNodeIds: progress.scannedNodeIds,
                });
                await persistNavigationCheckpoint();
              },
            })
          : selectWholeTreeWithRetry({
              budget,
              context,
              policy,
              query: input.query,
              reasoningModel: prerequisites.profile.reasoningModel,
              researchModelCallObserver: input.researchModelCallObserver,
              tenantId: prerequisites.snapshot.tenantId,
              wholeTreeSelector,
            }),
  );
  for (const decision of initialDecisions) {
    if (decision.degradation) {
      degradationFlags.add(decision.degradation);
    }
  }
  const decisions = await applyCandidateFlatteningFallback({
    budget,
    decisions: initialDecisions,
    maxSemanticCandidates,
    maxSemanticCandidatesPerCall,
    query: input.query,
    reasoningModel: prerequisites.profile.reasoningModel,
    researchModelCallObserver: input.researchModelCallObserver,
    semanticTreeSearch,
    tenantId: prerequisites.snapshot.tenantId,
  });
  for (const decision of decisions) {
    if (decision.degradation) {
      degradationFlags.add(decision.degradation);
    }
  }

  const queue = buildPageIndexNodeQueue({
    maxQueueItems: policy.maxQueueItems,
    maxValueNodesPerOutline: policy.maxValueNodesPerOutline,
    outlines: decisions.map((decision) => ({
      documentScore: decision.context.document.score,
      generationId: decision.context.item.generationId,
      llmSelections: decision.selections,
      outline: decision.context.item.outline,
      rankedValueNodeIds: decision.context.nodeValues.rankedOpenableNodeIds,
      valuesByNodeId: decision.context.nodeValues.valuesByNodeId,
    })),
  });
  for (const decision of decisions) {
    if (decision.layeredCheckpoint) {
      navigationByOutline.set(decision.context.item.outline.id, {
        documentAssetId: decision.context.item.documentAssetId,
        documentScore: decision.context.document.score,
        estimatedPromptTokens: decision.estimatedPromptTokens ?? 0,
        generationId: decision.context.item.generationId,
        layeredCheckpoint: decision.layeredCheckpoint,
        outlineId: decision.context.item.outline.id,
        scannedNodeIds: decision.layeredCheckpoint.visitedNodeIds,
      });
    }
  }
  const wholeTreeDocuments = decisions.filter(
    (decision) => decision.strategy === "whole-tree",
  ).length;
  const layeredDocuments = decisions.filter((decision) => decision.strategy === "layered").length;
  const fallbackDocuments = decisions.length - wholeTreeDocuments - layeredDocuments;
  const serializedTreeTokens = decisions.reduce(
    (total, decision) =>
      total + (decision.estimatedPromptTokens ?? decision.result?.estimatedPromptTokens ?? 0),
    0,
  );
  const scannedNodes = decisions.reduce(
    (total, decision) => total + (decision.scannedNodes ?? decision.result?.nodeCount ?? 0),
    0,
  );
  const layeredSteps = decisions.reduce(
    (total, decision) => total + (decision.layeredSteps ?? 0),
    0,
  );
  const flattenedLevels = decisions.reduce(
    (total, decision) => total + (decision.flattenedLevels ?? 0),
    0,
  );
  const checkpointMetricsBase: ResearchRetrievalCheckpointMetrics = {
    candidateTruncated,
    degradationFlags: [...degradationFlags].sort(),
    denseCandidates: rawValueCandidates.length,
    fallbackDocuments,
    flattenedLevels,
    layeredDocuments,
    layeredSteps,
    metadataFilteredCandidates: rawValueCandidates.length - metadataFiltered.length,
    openedRanges: 0,
    permissionFilteredCandidates: metadataFiltered.length - permissionFiltered.length,
    scannedNodes,
    selectedDocuments: selectedDocuments.length,
    serializedTreeTokens,
    valueMs,
    wholeTreeDocuments,
  };
  const threshold = scoreThreshold(prerequisites.profile);
  let opened: Awaited<ReturnType<typeof openPageIndexEvidenceQueue>> = {
    items: [],
    openedRangeCount: 0,
    truncated: false,
  };
  let queueOffset = 0;
  let researchSufficiencyReached = false;
  const persistEvidenceCheckpoint = async ({
    openedState,
    phase,
    preparedItems,
    sufficiencyReached,
  }: {
    readonly openedState: OpenedPageIndexEvidence;
    readonly phase: ResearchRetrievalSearchCheckpoint["phase"];
    readonly preparedItems: HybridRetrievalResult["items"];
    readonly sufficiencyReached: boolean;
  }): Promise<void> => {
    if (!input.onResearchSearchCheckpoint || !traceId) return;
    const checkpoint = researchSearchCheckpoint({
      budget: budget.snapshot(),
      fingerprint: prerequisites.snapshot.fingerprint,
      knowledgeSpaceId: input.knowledgeSpaceId,
      metrics: {
        ...checkpointMetricsBase,
        degradationFlags: [...degradationFlags].sort(),
        openedRanges: openedState.openedRangeCount,
      },
      missingAspects: missingAspectsForCheckpoint({
        items: preparedItems,
        requestedItems: input.limit,
        sufficiencyReached,
      }),
      navigation: cloneNavigationStates(navigationByOutline),
      openedRangeCount: openedState.openedRangeCount,
      openedTruncated: openedState.truncated,
      phase,
      publicationId: prerequisites.snapshot.publicationId,
      query: input.query,
      queue,
      queueOffset,
      researchSufficiencyReached: sufficiencyReached,
      sequence: ++checkpointSequence,
      tenantId: prerequisites.snapshot.tenantId,
      traceId,
      version: ResearchRetrievalCheckpointVersion,
    });
    await input.onResearchSearchCheckpoint({
      checkpoint,
      result: { items: [...preparedItems], plan },
    });
  };
  await persistEvidenceCheckpoint({
    openedState: opened,
    phase: queue.length === 0 ? "complete" : "evidence",
    preparedItems: [],
    sufficiencyReached: false,
  });
  const queueItemsPerRound =
    policy.kind === "durable"
      ? Math.max(1, Math.ceil(queue.length / policy.maxRounds))
      : Math.max(1, queue.length);
  while (queueOffset < queue.length) {
    if (!budget.consume("rounds")) {
      degradationFlags.add("research-budget-exhausted");
      break;
    }
    const round = budget.snapshot().rounds;
    if (round > 1 && !budget.consume("supplementalSearches")) {
      degradationFlags.add("research-budget-exhausted");
      break;
    }
    const roundQueue: (typeof queue)[number][] = [];
    while (
      roundQueue.length < queueItemsPerRound &&
      queueOffset < queue.length &&
      budget.consume("openedResources")
    ) {
      const queued = queue[queueOffset];
      queueOffset += 1;
      if (queued) roundQueue.push(queued);
    }
    if (roundQueue.length === 0) {
      degradationFlags.add("research-budget-exhausted");
      break;
    }
    if (!budget.consume("retrievalSteps")) {
      degradationFlags.add("research-budget-exhausted");
      break;
    }
    const openedRound = await openPageIndexEvidenceQueue({
      maxConcurrentOpens: policy.maxConcurrentTreeSelections,
      maxEvidencePerRange: policy.maxEvidencePerRange,
      maxFinalItems: policy.maxFinalItems,
      permissionScope: prerequisites.permissionScope,
      queue: roundQueue,
      repository: pageIndex,
      ...(input.signal ? { signal: input.signal } : {}),
      scope: {
        fingerprint: prerequisites.snapshot.fingerprint,
        knowledgeSpaceId: input.knowledgeSpaceId,
        publicationId: prerequisites.snapshot.publicationId,
        tenantId: prerequisites.snapshot.tenantId,
      },
    });
    opened = mergeOpenedEvidence(opened, openedRound, policy.maxFinalItems);
    const prepared = prepareResearchItems({
      items: opened.items,
      limit: input.limit,
      snapshot: prerequisites.snapshot,
      threshold,
    });
    researchSufficiencyReached = researchEvidenceIsSufficient({
      availableQueueItems: queue.length,
      items: prepared.items,
      requestedItems: input.limit,
      threshold,
    });
    const terminal =
      researchSufficiencyReached ||
      queueOffset >= queue.length ||
      round >= policy.maxRounds ||
      budget.snapshot().exhaustedReasons.length > 0;
    await persistEvidenceCheckpoint({
      openedState: opened,
      phase: terminal ? "complete" : "evidence",
      preparedItems: prepared.items,
      sufficiencyReached: researchSufficiencyReached,
    });
    await input.onResearchRound?.({
      result: { items: prepared.items, plan },
      round,
      terminal,
    });
    if (terminal) break;
  }

  const prepared = prepareResearchItems({
    items: opened.items,
    limit: input.limit,
    snapshot: prerequisites.snapshot,
    threshold,
  });
  const { items, relevantItems, thresholded } = prepared;
  const budgetSnapshot = budget.snapshot();
  if (budgetSnapshot.exhaustedReasons.length > 0) {
    degradationFlags.add("research-budget-exhausted");
  }
  return {
    items,
    metrics: researchMetrics({
      budgetSnapshot,
      candidateTruncated: candidateTruncated || opened.truncated,
      degradationFlags,
      denseCandidates: rawValueCandidates.length,
      fallbackDocuments,
      flattenedLevels,
      finalItems: items.length,
      metadataFilteredCandidates: rawValueCandidates.length - metadataFiltered.length,
      openedRanges: opened.openedRangeCount,
      layeredDocuments,
      layeredSteps,
      permissionFilteredCandidates: metadataFiltered.length - permissionFiltered.length,
      policy,
      researchSufficiencyReached,
      scannedNodes,
      scoredNodes: queue.length,
      selectedDocuments: selectedDocuments.length,
      serializedTreeTokens,
      thresholdFiltered: relevantItems.length - thresholded.length,
      totalMs: Math.max(0, now() - startedAt),
      valueMs,
      wholeTreeDocuments,
    }),
    plan,
  };
}

async function resumeResearchEvidenceCheckpoint({
  budget,
  checkpoint,
  degradationFlags,
  input,
  now,
  pageIndex,
  plan,
  policy,
  prerequisites,
  startedAt,
}: {
  readonly budget: ResearchRetrievalBudget;
  readonly checkpoint: ResearchRetrievalSearchCheckpoint;
  readonly degradationFlags: Set<string>;
  readonly input: RetrieveHybridInput;
  readonly now: () => number;
  readonly pageIndex: Pick<PublishedPageIndexRepository, "openLeafEvidence">;
  readonly plan: RetrievalPlan;
  readonly policy: ResearchRetrievalExecutionPolicy;
  readonly prerequisites: ReturnType<typeof researchPrerequisites>;
  readonly startedAt: number;
}): Promise<HybridRetrievalResult> {
  const queue = checkpoint.queue;
  let queueOffset = checkpoint.queueOffset;
  let researchSufficiencyReached = checkpoint.researchSufficiencyReached;
  let sequence = checkpoint.sequence;
  let opened: OpenedPageIndexEvidence = {
    items: [...(input.researchSearchCheckpointResult?.items ?? [])],
    openedRangeCount: checkpoint.openedRangeCount,
    truncated: checkpoint.openedTruncated,
  };
  const threshold = scoreThreshold(prerequisites.profile);
  const queueItemsPerRound =
    policy.kind === "durable"
      ? Math.max(1, Math.ceil(queue.length / policy.maxRounds))
      : Math.max(1, queue.length);
  while (
    checkpoint.phase !== "complete" &&
    !researchSufficiencyReached &&
    queueOffset < queue.length
  ) {
    if (!budget.consume("rounds")) {
      degradationFlags.add("research-budget-exhausted");
      break;
    }
    const round = budget.snapshot().rounds;
    if (round > 1 && !budget.consume("supplementalSearches")) {
      degradationFlags.add("research-budget-exhausted");
      break;
    }
    const roundQueue: PageIndexNodeQueueItem[] = [];
    while (
      roundQueue.length < queueItemsPerRound &&
      queueOffset < queue.length &&
      budget.consume("openedResources")
    ) {
      const queued = queue[queueOffset];
      queueOffset += 1;
      if (queued) roundQueue.push(queued);
    }
    if (roundQueue.length === 0 || !budget.consume("retrievalSteps")) {
      degradationFlags.add("research-budget-exhausted");
      break;
    }
    const openedRound = await openPageIndexEvidenceQueue({
      maxConcurrentOpens: policy.maxConcurrentTreeSelections,
      maxEvidencePerRange: policy.maxEvidencePerRange,
      maxFinalItems: policy.maxFinalItems,
      permissionScope: prerequisites.permissionScope,
      queue: roundQueue,
      repository: pageIndex,
      ...(input.signal ? { signal: input.signal } : {}),
      scope: {
        fingerprint: prerequisites.snapshot.fingerprint,
        knowledgeSpaceId: input.knowledgeSpaceId,
        publicationId: prerequisites.snapshot.publicationId,
        tenantId: prerequisites.snapshot.tenantId,
      },
    });
    opened = mergeOpenedEvidence(opened, openedRound, policy.maxFinalItems);
    const prepared = prepareResearchItems({
      items: opened.items,
      limit: input.limit,
      snapshot: prerequisites.snapshot,
      threshold,
    });
    researchSufficiencyReached = researchEvidenceIsSufficient({
      availableQueueItems: queue.length,
      items: prepared.items,
      requestedItems: input.limit,
      threshold,
    });
    const terminal =
      researchSufficiencyReached ||
      queueOffset >= queue.length ||
      round >= policy.maxRounds ||
      budget.snapshot().exhaustedReasons.length > 0;
    if (input.onResearchSearchCheckpoint) {
      const nextCheckpoint = researchSearchCheckpoint({
        ...checkpoint,
        budget: budget.snapshot(),
        metrics: {
          ...checkpoint.metrics,
          degradationFlags: [...degradationFlags].sort(),
          openedRanges: opened.openedRangeCount,
        },
        missingAspects: missingAspectsForCheckpoint({
          items: prepared.items,
          requestedItems: input.limit,
          sufficiencyReached: researchSufficiencyReached,
        }),
        openedRangeCount: opened.openedRangeCount,
        openedTruncated: opened.truncated,
        phase: terminal ? "complete" : "evidence",
        queueOffset,
        researchSufficiencyReached,
        sequence: ++sequence,
      });
      await input.onResearchSearchCheckpoint({
        checkpoint: nextCheckpoint,
        result: { items: prepared.items, plan },
      });
    }
    await input.onResearchRound?.({
      result: { items: prepared.items, plan },
      round,
      terminal,
    });
    if (terminal) break;
  }

  const prepared = prepareResearchItems({
    items: opened.items,
    limit: input.limit,
    snapshot: prerequisites.snapshot,
    threshold,
  });
  const budgetSnapshot = budget.snapshot();
  if (budgetSnapshot.exhaustedReasons.length > 0) {
    degradationFlags.add("research-budget-exhausted");
  }
  return {
    items: prepared.items,
    metrics: researchMetrics({
      budgetSnapshot,
      candidateTruncated: checkpoint.metrics.candidateTruncated || opened.truncated,
      degradationFlags,
      denseCandidates: checkpoint.metrics.denseCandidates,
      fallbackDocuments: checkpoint.metrics.fallbackDocuments,
      flattenedLevels: checkpoint.metrics.flattenedLevels,
      finalItems: prepared.items.length,
      layeredDocuments: checkpoint.metrics.layeredDocuments,
      layeredSteps: checkpoint.metrics.layeredSteps,
      metadataFilteredCandidates: checkpoint.metrics.metadataFilteredCandidates,
      openedRanges: opened.openedRangeCount,
      permissionFilteredCandidates: checkpoint.metrics.permissionFilteredCandidates,
      policy,
      researchSufficiencyReached,
      scannedNodes: checkpoint.metrics.scannedNodes,
      scoredNodes: queue.length,
      selectedDocuments: checkpoint.metrics.selectedDocuments,
      serializedTreeTokens: checkpoint.metrics.serializedTreeTokens,
      thresholdFiltered: prepared.relevantItems.length - prepared.thresholded.length,
      totalMs: Math.max(0, now() - startedAt),
      valueMs: checkpoint.metrics.valueMs,
      wholeTreeDocuments: checkpoint.metrics.wholeTreeDocuments,
    }),
    plan,
  };
}

function researchSearchCheckpoint(
  checkpoint: ResearchRetrievalSearchCheckpoint,
): ResearchRetrievalSearchCheckpoint {
  return parseResearchRetrievalSearchCheckpoint(checkpoint);
}

function cloneNavigationStates(
  values: ReadonlyMap<string, ResearchRetrievalCheckpointNavigation>,
): ResearchRetrievalCheckpointNavigation[] {
  return [...values.values()]
    .sort((left, right) => left.outlineId.localeCompare(right.outlineId))
    .map((entry) => ({
      ...entry,
      layeredCheckpoint: {
        ...entry.layeredCheckpoint,
        flattenedNodeIds: [...entry.layeredCheckpoint.flattenedNodeIds],
        frontier: entry.layeredCheckpoint.frontier.map((item) => ({
          ...item,
          pathReason: [...item.pathReason],
        })),
        openSelections: entry.layeredCheckpoint.openSelections.map((selection) => ({
          ...selection,
        })),
        visitedNodeIds: [...entry.layeredCheckpoint.visitedNodeIds],
      },
      scannedNodeIds: [...entry.scannedNodeIds],
    }));
}

function missingAspectsForCheckpoint({
  items,
  requestedItems,
  sufficiencyReached,
}: {
  readonly items: readonly HybridRetrievalResult["items"][number][];
  readonly requestedItems: number;
  readonly sufficiencyReached: boolean;
}): readonly string[] {
  if (sufficiencyReached) return [];
  if (items.length === 0) return ["no supporting evidence opened yet"];
  if (items.length < requestedItems) return ["additional supporting evidence"];
  return ["evidence sufficiency threshold not reached"];
}

async function selectLayeredTreeWithRetry({
  budget,
  context,
  initialCheckpoint,
  initialEstimatedPromptTokens = 0,
  initialScannedNodeIds = [],
  layeredTreeSearch,
  onStep,
  policy,
  query,
  reasoningModel,
  researchModelCallObserver,
  tenantId,
}: {
  readonly budget: ResearchRetrievalBudget;
  readonly context: PageIndexOutlineRuntime;
  readonly initialCheckpoint?: PageIndexLayeredTreeCheckpoint | undefined;
  readonly initialEstimatedPromptTokens?: number | undefined;
  readonly initialScannedNodeIds?: readonly string[] | undefined;
  readonly layeredTreeSearch: PageIndexLayeredTreeSearch;
  readonly onStep?:
    | ((
        checkpoint: PageIndexLayeredTreeCheckpoint,
        progress: {
          readonly estimatedPromptTokens: number;
          readonly scannedNodeIds: readonly string[];
        },
      ) => Promise<void>)
    | undefined;
  readonly policy: ResearchRetrievalExecutionPolicy;
  readonly query: string;
  readonly reasoningModel: KnowledgeSpaceRetrievalProfile["reasoningModel"];
  readonly researchModelCallObserver?: RetrieveHybridInput["researchModelCallObserver"];
  readonly tenantId: string;
}): Promise<PageIndexTreeDecision> {
  let checkpoint: PageIndexLayeredTreeCheckpoint =
    initialCheckpoint ??
    createInitialPageIndexLayeredTreeCheckpoint({
      outline: context.item.outline,
      query,
    });
  let estimatedPromptTokens = initialEstimatedPromptTokens;
  const scannedNodeIds = new Set<string>(initialScannedNodeIds);
  let degradation: string | undefined;

  while (!checkpoint.completed && checkpoint.depth < policy.maxTreeDepth) {
    let stepSucceeded = false;
    for (let attempt = 0; attempt < policy.maxTreeSelectionAttempts; attempt += 1) {
      if (!budget.consume("modelCalls")) {
        degradation = "research-budget-exhausted";
        break;
      }
      let completedStep: Awaited<ReturnType<PageIndexLayeredTreeSearch["step"]>>;
      try {
        completedStep = await layeredTreeSearch.step({
          checkpoint,
          modelCallAttempt: attempt + 1,
          outline: context.item.outline,
          query,
          reasoningModel,
          researchModelCallObserver,
          tenantId,
          valuesByNodeId: context.nodeValues.valuesByNodeId,
        });
      } catch (error) {
        if (error instanceof ResearchModelCallObserverError) {
          throw error;
        }
        if (
          error instanceof PageIndexLayeredTreeSearchContractError &&
          error.failureKind === "integrity"
        ) {
          throw error;
        }
        if (attempt + 1 >= policy.maxTreeSelectionAttempts) {
          degradation = "pageindex-layered-provider-failed";
        }
        continue;
      }
      checkpoint = completedStep.checkpoint;
      estimatedPromptTokens += completedStep.estimatedPromptTokens;
      for (const nodeId of completedStep.visibleNodeIds) scannedNodeIds.add(nodeId);
      // Durable checkpoint writes are execution-fence operations, not provider work. A storage or
      // lease failure must propagate and must never be hidden as a recoverable model failure.
      await onStep?.(checkpoint, {
        estimatedPromptTokens,
        scannedNodeIds: [...scannedNodeIds].sort(),
      });
      stepSucceeded = true;
      break;
    }
    if (!stepSucceeded) break;
  }

  if (!checkpoint.completed && checkpoint.depth >= policy.maxTreeDepth) {
    degradation = "pageindex-layered-depth-exhausted";
  } else if (checkpoint.frontierTruncated && !degradation) {
    degradation = "pageindex-layered-frontier-truncated";
  }
  return {
    context,
    ...(degradation ? { degradation } : {}),
    estimatedPromptTokens,
    flattenedLevels: checkpoint.flattenedNodeIds.length,
    layeredCheckpoint: checkpoint,
    layeredSteps: checkpoint.depth,
    scannedNodes: scannedNodeIds.size,
    selections: checkpoint.openSelections,
    strategy: "layered",
  };
}

function researchPrerequisites(
  input: RetrieveHybridInput,
  valueSearch: Pick<HybridRetrievalRepository, "publishedMembershipEnforced">,
): {
  readonly permissionScope: readonly string[];
  readonly profile: KnowledgeSpaceRetrievalProfile;
  readonly snapshot: NonNullable<RetrieveHybridInput["projectionSnapshot"]>;
} {
  const snapshot = input.projectionSnapshot;
  if (!snapshot) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research retrieval requires a published projection snapshot",
    );
  }
  if (
    snapshot.knowledgeSpaceId !== input.knowledgeSpaceId ||
    (input.tenantId !== undefined && snapshot.tenantId !== input.tenantId)
  ) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research retrieval projection snapshot does not match the query scope",
    );
  }
  if (input.permissionScope === undefined) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research retrieval requires a server-issued permission scope",
    );
  }
  if (!input.retrievalProfile) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research semantic tree search requires a frozen retrieval profile",
    );
  }
  if (!input.denseProjectionModel?.trim()) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research semantic Value Search requires a frozen embedding vector space",
    );
  }
  if (input.queryVector.length === 0 || !input.queryVector.every(Number.isFinite)) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research semantic Value Search requires a finite query embedding",
    );
  }
  if (valueSearch.publishedMembershipEnforced !== true) {
    throw new PublishedPageIndexCapabilityUnavailableError(
      "Research semantic Value Search requires authoritative published-membership filtering",
    );
  }
  return {
    permissionScope: [...input.permissionScope],
    profile: input.retrievalProfile,
    snapshot,
  };
}

async function selectWholeTreeWithRetry({
  budget,
  context,
  policy,
  query,
  reasoningModel,
  researchModelCallObserver,
  tenantId,
  wholeTreeSelector,
}: {
  readonly budget: ResearchRetrievalBudget;
  readonly context: PageIndexOutlineRuntime;
  readonly policy: ResearchRetrievalExecutionPolicy;
  readonly query: string;
  readonly reasoningModel: KnowledgeSpaceRetrievalProfile["reasoningModel"];
  readonly researchModelCallObserver?: RetrieveHybridInput["researchModelCallObserver"];
  readonly tenantId: string;
  readonly wholeTreeSelector: PageIndexWholeTreeSelector;
}): Promise<PageIndexTreeDecision> {
  for (let attempt = 0; attempt < policy.maxTreeSelectionAttempts; attempt += 1) {
    if (!budget.consume("modelCalls")) {
      return {
        context,
        degradation: "research-budget-exhausted",
        selections: [],
        strategy: "value-only",
      };
    }
    try {
      const result = await wholeTreeSelector.select({
        outline: context.item.outline,
        modelCallAttempt: attempt + 1,
        query,
        reasoningModel,
        researchModelCallObserver,
        tenantId,
        valuesByNodeId: context.nodeValues.valuesByNodeId,
      });
      if (result.strategy === "fallback") {
        // The selector did not call the provider when it made a local budget/quality decision.
        budget.refund("modelCalls");
        return {
          context,
          result,
          selections: [],
          strategy: "candidate-flattening",
        };
      }
      return {
        context,
        result,
        selections: result.selections,
        strategy: "whole-tree",
      };
    } catch (error) {
      if (error instanceof ResearchModelCallObserverError) {
        throw error;
      }
      if (
        error instanceof PageIndexWholeTreeSelectionContractError &&
        error.failureKind === "integrity"
      ) {
        throw error;
      }
      if (attempt + 1 >= policy.maxTreeSelectionAttempts) {
        return {
          context,
          degradation: "pageindex-whole-tree-provider-failed",
          selections: [],
          strategy: "value-only",
        };
      }
    }
  }
  return { context, selections: [], strategy: "value-only" };
}

async function applyCandidateFlatteningFallback({
  budget,
  decisions,
  maxSemanticCandidates,
  maxSemanticCandidatesPerCall,
  query,
  reasoningModel,
  researchModelCallObserver,
  semanticTreeSearch,
  tenantId,
}: {
  readonly budget: ResearchRetrievalBudget;
  readonly decisions: readonly PageIndexTreeDecision[];
  readonly maxSemanticCandidates: number;
  readonly maxSemanticCandidatesPerCall: number;
  readonly query: string;
  readonly reasoningModel: KnowledgeSpaceRetrievalProfile["reasoningModel"];
  readonly researchModelCallObserver?: RetrieveHybridInput["researchModelCallObserver"];
  readonly semanticTreeSearch: PageIndexSemanticTreeSearch;
  readonly tenantId: string;
}): Promise<readonly PageIndexTreeDecision[]> {
  const fallback = decisions.filter((decision) => decision.strategy === "candidate-flattening");
  if (fallback.length === 0) {
    return decisions;
  }
  const candidates: FlattenedFallbackCandidate[] = [];
  for (const decision of fallback) {
    const assignmentByCandidateNodeId = new Map(
      decision.context.nodeValues.assignments.map((assignment) => [
        assignment.candidateNodeId,
        assignment.outlineNodeId,
      ]),
    );
    for (const hit of decision.context.document.hits) {
      const outlineNodeId = assignmentByCandidateNodeId.get(hit.candidate.nodeId);
      if (!outlineNodeId || candidates.length >= maxSemanticCandidates) {
        continue;
      }
      const value = decision.context.nodeValues.valuesByNodeId.get(outlineNodeId);
      candidates.push({
        candidate: {
          candidateId: `f${candidates.length + 1}`,
          documentAssetId: hit.candidate.citation.documentAssetId,
          nodeId: hit.candidate.nodeId,
          sectionPath: [...hit.candidate.citation.sectionPath],
          sectionValueScore: value?.breadthValue ?? decision.context.document.score,
          text: evidenceTextFromCandidate(hit.candidate),
          valueScore: hit.normalizedScore,
        },
        context: decision.context,
        outlineNodeId,
      });
    }
  }
  if (candidates.length === 0) {
    return decisions.map((decision) =>
      decision.strategy === "candidate-flattening"
        ? {
            ...decision,
            degradation: "pageindex-tree-fallback-empty",
            strategy: "value-only",
          }
        : decision,
    );
  }
  const requiredCalls = Math.ceil(candidates.length / maxSemanticCandidatesPerCall);
  if (!budget.consume("modelCalls", requiredCalls)) {
    return decisions.map((decision) =>
      decision.strategy === "candidate-flattening"
        ? {
            ...decision,
            degradation: "research-budget-exhausted",
            strategy: "value-only",
          }
        : decision,
    );
  }

  try {
    const scored = await semanticTreeSearch.score({
      candidates: candidates.map((entry) => entry.candidate),
      query,
      reasoningModel,
      researchModelCallObserver,
      tenantId,
    });
    const scoresById = new Map(scored.map((score) => [score.candidateId, score]));
    const selectionsByOutline = new Map<string, Map<string, PageIndexWholeTreeNodeSelection>>();
    for (const entry of candidates) {
      const score = scoresById.get(entry.candidate.candidateId);
      if (!score) {
        throw new PageIndexSemanticScoreContractError(
          `PageIndex fallback omitted candidate=${entry.candidate.candidateId}`,
        );
      }
      const selections = selectionsByOutline.get(entry.context.item.outline.id) ?? new Map();
      const existing = selections.get(entry.outlineNodeId);
      if (!existing || score.score > existing.score) {
        selections.set(entry.outlineNodeId, {
          nodeId: entry.outlineNodeId,
          reason: score.reason,
          score: score.score,
        });
      }
      selectionsByOutline.set(entry.context.item.outline.id, selections);
    }
    return decisions.map((decision) =>
      decision.strategy === "candidate-flattening"
        ? {
            ...decision,
            selections: [
              ...(selectionsByOutline.get(decision.context.item.outline.id)?.values() ?? []),
            ],
          }
        : decision,
    );
  } catch (error) {
    if (error instanceof ResearchModelCallObserverError) {
      throw error;
    }
    if (error instanceof PageIndexSemanticScoreContractError && error.failureKind === "integrity") {
      throw error;
    }
    return decisions.map((decision) =>
      decision.strategy === "candidate-flattening"
        ? {
            ...decision,
            degradation: "pageindex-tree-fallback-provider-failed",
            selections: [],
            strategy: "value-only",
          }
        : decision,
    );
  }
}

function evidenceTextFromCandidate(candidate: RetrievalCandidate): string {
  return evidenceTextFromHybridItem({
    citation: candidate.citation,
    metadata: candidate.metadata,
    nodeId: candidate.nodeId,
    permissionScope: candidate.permissionScope,
    projectionIds: [candidate.projectionId],
    score: candidate.score,
    sources: [candidate.source],
  });
}

function emptyResearchResult({
  budget,
  candidateTruncated = false,
  degradationFlags,
  denseCandidates,
  metadataFilteredCandidates = 0,
  now,
  permissionFilteredCandidates = 0,
  plan,
  policy,
  selectedDocuments = 0,
  startedAt,
  valueMs,
}: {
  readonly budget: ResearchRetrievalBudget;
  readonly candidateTruncated?: boolean;
  readonly degradationFlags: ReadonlySet<string>;
  readonly denseCandidates: number;
  readonly input: RetrieveHybridInput;
  readonly metadataFilteredCandidates?: number;
  readonly now: () => number;
  readonly permissionFilteredCandidates?: number;
  readonly plan: RetrievalPlan;
  readonly policy: ResearchRetrievalExecutionPolicy;
  readonly selectedDocuments?: number;
  readonly startedAt: number;
  readonly valueMs: number;
}): HybridRetrievalResult {
  const budgetSnapshot = budget.snapshot();
  const flags = new Set(degradationFlags);
  if (budgetSnapshot.exhaustedReasons.length > 0) {
    flags.add("research-budget-exhausted");
  }
  return {
    items: [],
    metrics: researchMetrics({
      budgetSnapshot,
      candidateTruncated,
      degradationFlags: flags,
      denseCandidates,
      fallbackDocuments: 0,
      finalItems: 0,
      metadataFilteredCandidates,
      openedRanges: 0,
      permissionFilteredCandidates,
      policy,
      scannedNodes: 0,
      scoredNodes: 0,
      selectedDocuments,
      serializedTreeTokens: 0,
      thresholdFiltered: 0,
      totalMs: Math.max(0, now() - startedAt),
      valueMs,
      wholeTreeDocuments: 0,
    }),
    plan,
  };
}

function researchMetrics({
  budgetSnapshot,
  candidateTruncated,
  degradationFlags,
  denseCandidates,
  fallbackDocuments,
  flattenedLevels = 0,
  finalItems,
  metadataFilteredCandidates,
  openedRanges,
  layeredDocuments = 0,
  layeredSteps = 0,
  permissionFilteredCandidates,
  policy,
  researchSufficiencyReached = false,
  scannedNodes,
  scoredNodes,
  selectedDocuments,
  serializedTreeTokens,
  thresholdFiltered,
  totalMs,
  valueMs,
  wholeTreeDocuments,
}: {
  readonly budgetSnapshot: ReturnType<ResearchRetrievalBudget["snapshot"]>;
  readonly candidateTruncated: boolean;
  readonly degradationFlags: ReadonlySet<string>;
  readonly denseCandidates: number;
  readonly fallbackDocuments: number;
  readonly flattenedLevels?: number;
  readonly finalItems: number;
  readonly metadataFilteredCandidates: number;
  readonly openedRanges: number;
  readonly layeredDocuments?: number;
  readonly layeredSteps?: number;
  readonly permissionFilteredCandidates: number;
  readonly policy: ResearchRetrievalExecutionPolicy;
  readonly researchSufficiencyReached?: boolean;
  readonly scannedNodes: number;
  readonly scoredNodes: number;
  readonly selectedDocuments: number;
  readonly serializedTreeTokens: number;
  readonly thresholdFiltered: number;
  readonly totalMs: number;
  readonly valueMs: number;
  readonly wholeTreeDocuments: number;
}): HybridRetrievalMetrics {
  return {
    ...(degradationFlags.size > 0 ? { degradationFlags: [...degradationFlags].sort() } : {}),
    denseCandidates,
    denseMs: valueMs,
    documentOutlineMatchedItems: finalItems,
    ftsCandidates: 0,
    ftsMs: 0,
    fusedCandidates: scoredNodes,
    fusionMs: 0,
    metadataFilteredCandidates,
    pageIndexCandidateTruncated: candidateTruncated,
    pageIndexFallbackDocuments: fallbackDocuments,
    pageIndexFlattenedLevels: flattenedLevels,
    pageIndexLayeredDocuments: layeredDocuments,
    pageIndexLayeredSteps: layeredSteps,
    pageIndexMatchedNodes: scoredNodes,
    pageIndexOpenedRanges: openedRanges,
    pageIndexScannedNodes: scannedNodes,
    pageIndexScannedOutlines: wholeTreeDocuments + fallbackDocuments,
    pageIndexScoreVersion: PageIndexSemanticScoreVersion,
    pageIndexSelectedDocuments: selectedDocuments,
    pageIndexSerializedTreeTokens: serializedTreeTokens,
    pageIndexWholeTreeDocuments: wholeTreeDocuments,
    permissionFilteredCandidates,
    reasoningTreeSearchNodes: scoredNodes,
    researchBudgetExhaustedReasons: [...budgetSnapshot.exhaustedReasons],
    researchExecutionKind: policy.kind,
    researchModelCalls: budgetSnapshot.modelCalls,
    researchOpenedResources: budgetSnapshot.openedResources,
    researchRounds: budgetSnapshot.rounds,
    researchRetrievalSteps: budgetSnapshot.retrievalSteps,
    researchSufficiencyReached,
    researchSupplementalSearches: budgetSnapshot.supplementalSearches,
    scoreThresholdFilteredCandidates: thresholdFiltered,
    summaryCandidates: 0,
    summarySelectedSections: openedRanges,
    totalMs,
  };
}

function mergeOpenedEvidence(
  current: OpenedPageIndexEvidence,
  next: OpenedPageIndexEvidence,
  maxItems: number,
): OpenedPageIndexEvidence {
  const byNodeId = new Map(current.items.map((item) => [item.nodeId, item]));
  for (const item of next.items) {
    const existing = byNodeId.get(item.nodeId);
    if (!existing || item.score > existing.score) {
      byNodeId.set(item.nodeId, item);
    }
  }
  const ranked = [...byNodeId.values()].sort(
    (left, right) => right.score - left.score || left.nodeId.localeCompare(right.nodeId),
  );
  return {
    items: ranked.slice(0, maxItems),
    openedRangeCount: current.openedRangeCount + next.openedRangeCount,
    truncated: current.truncated || next.truncated || ranked.length > maxItems,
  };
}

function prepareResearchItems({
  items,
  limit,
  snapshot,
  threshold,
}: {
  readonly items: readonly HybridRetrievalResult["items"][number][];
  readonly limit: number;
  readonly snapshot: NonNullable<RetrieveHybridInput["projectionSnapshot"]>;
  readonly threshold: number | undefined;
}): {
  readonly items: HybridRetrievalResult["items"];
  readonly relevantItems: HybridRetrievalResult["items"];
  readonly thresholded: HybridRetrievalResult["items"];
} {
  const relevantItems = items
    .map((item) => ({
      ...item,
      metadata: {
        ...item.metadata,
        pageIndex: {
          ...(isPlainObject(item.metadata.pageIndex) ? item.metadata.pageIndex : {}),
          scoreVersion: PageIndexSemanticScoreVersion,
        },
        projectionSnapshot: {
          fingerprint: snapshot.fingerprint,
          headRevision: snapshot.headRevision,
          publicationId: snapshot.publicationId,
        },
      },
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.nodeId.localeCompare(right.nodeId));
  const thresholded =
    threshold === undefined
      ? relevantItems
      : relevantItems.filter((item) => item.score >= threshold);
  return { items: thresholded.slice(0, limit), relevantItems, thresholded };
}

function researchEvidenceIsSufficient({
  availableQueueItems,
  items,
  requestedItems,
  threshold,
}: {
  readonly availableQueueItems: number;
  readonly items: readonly HybridRetrievalResult["items"][number][];
  readonly requestedItems: number;
  readonly threshold: number | undefined;
}): boolean {
  const targetItems = Math.max(1, Math.min(3, requestedItems, availableQueueItems));
  const scoreFloor = threshold ?? 0.5;
  return items.length >= targetItems && items.some((item) => item.score >= scoreFloor);
}

function scoreThreshold(profile: KnowledgeSpaceRetrievalProfile): number | undefined {
  return profile.scoreThreshold.enabled ? profile.scoreThreshold.value : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  map: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const outputs = new Array<Output>(inputs.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index];
      if (input !== undefined) {
        outputs[index] = await map(input, index);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => worker()),
  );
  return outputs;
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Published PageIndex retrieval ${name} must be a positive integer`);
  }
}
