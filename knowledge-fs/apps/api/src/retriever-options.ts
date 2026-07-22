import {
  type BasicHybridRetriever,
  type DocumentOutlineRepository,
  type GraphIndexRepository,
  type HybridRetrievalItem,
  type HybridRetrievalRepository,
  type ProjectionSetPublicationMemberRepository,
  type PublishedGraphIndexRepository,
  type PublishedPageIndexRepository,
  type RetrievalCandidate,
  type RetrievalOperationalMetrics,
  type RetrievalPlanner,
  type TidbFtsPostingReadinessGate,
  createBasicHybridRetriever,
  createDocumentOutlineRetrievalPath,
  createFinalRerankRetrieval,
  createGraphExpandedRetrievalPath,
  createImageOcrRetrievalPath,
  createPublishedPageIndexRetrievalPath,
  createRequiredDeepGraphCapabilityGuard,
  createTableSpecificRetrievalPath,
  filterRetrievalCandidatesByMetadata,
  filterRetrievalCandidatesByPermission,
  filterRetrievalCandidatesByProjectionSet,
  normalizeRetrievalMetadataFilters,
  normalizeRetrievalPermissionScope,
  recordRetrievalOperationalMetric,
} from "@knowledge/api";
import type { EmbeddingProvider } from "@knowledge/embeddings";

import {
  type ApiGraphExpansionOptions,
  DEFAULT_GRAPH_EXPANSION_OPTIONS,
} from "./graph-expansion-options";
import type { ApiRerankerOptions } from "./reranker-options";

export interface ApiRetrieverOptions {
  /** Whether a dense embedding provider is configured; gates the dense leg. */
  readonly embeddingEnabled: boolean;
  /** Fail-closed latch for TiDB lexical postings. Research never depends on this index. */
  readonly ftsReadiness?: TidbFtsPostingReadinessGate | undefined;
  /**
   * Knowledge graph. When provided, wraps the stack with graph-expanded
   * retrieval (GraphRAG-style: seed entities from base hits -> traverse ->
   * re-retrieve boosted), which `shouldRunModeExtension` activates for `deep`
   * mode only. Omit to disable graph expansion entirely.
   */
  readonly graph?: GraphIndexRepository | undefined;
  /**
   * Graph-expansion tuning knobs (env-derived via `createApiGraphExpansionOptions`).
   * Falls back to `DEFAULT_GRAPH_EXPANSION_OPTIONS` when omitted. Ignored without `graph`.
   */
  readonly graphExpansion?: ApiGraphExpansionOptions | undefined;
  /** Aggregation-only retrieval result telemetry. */
  readonly metrics?: RetrievalOperationalMetrics | undefined;
  /** PageIndex-style document outline traversal, used only by research mode. */
  readonly outlines?: DocumentOutlineRepository | undefined;
  /** Strict publication-member scoped PageIndex used by production Research. */
  readonly pageIndex?: PublishedPageIndexRepository | undefined;
  /**
   * Mode-aware planner. Optional for compatibility with the underlying
   * `createBasicHybridRetriever`; when omitted the basic retriever falls back to
   * `defaultRetrievalPlan` ("fast" for every request). Pass one so fast/deep/
   * research resolve distinct fan-out — `index.ts` always does.
   */
  readonly planner?: RetrievalPlanner | undefined;
  /** Bounded defense-in-depth membership check for non-database repositories. */
  readonly publishedProjectionMembership?:
    | Pick<ProjectionSetPublicationMemberRepository, "filterComponentKeys">
    | undefined;
  /** Strict graph view bound to the immutable query-start publication snapshot. */
  readonly publishedGraph?: PublishedGraphIndexRepository | undefined;
  readonly repository: HybridRetrievalRepository;
  readonly rerankerOptions?: ApiRerankerOptions | undefined;
  /** Require a fixed published projection snapshot before any retrieval leg runs. */
  readonly strictPublishedReads?: boolean | undefined;
  /** Text-to-visual query embedding for the separate visual_vector search leg. */
  readonly visualQuery?:
    | {
        readonly model: string;
        readonly mode: "fallback" | "primary";
        readonly provider: EmbeddingProvider;
      }
    | undefined;
}

/**
 * Stable fail-closed signal for Fast/Deep requests when the text embedding
 * capability is unavailable. Those modes promise dense + FTS hybrid recall;
 * silently substituting FTS-only retrieval would change their product
 * semantics. Research is intentionally exempt because it opens PageIndex
 * Summary/Outline data without a query embedding.
 */
export class HybridEmbeddingCapabilityUnavailableError extends Error {
  constructor() {
    super("Fast and Deep retrieval require the configured text embedding capability");
    this.name = "HybridEmbeddingCapabilityUnavailableError";
  }
}

/**
 * Builds the wired retrieval stack: final-rerank -> graph-expansion ->
 * document-outline -> image-ocr -> table -> visual-dense + text-hybrid. The
 * mode gates keep graph expansion in deep mode and PageIndex-style
 * outline/summary traversal in research mode. Final reranking runs once for
 * fast/deep after all candidate extensions have been merged; research
 * intentionally skips it. `SummaryTree` is intentionally not composed here:
 * PageIndex summaries live on DocumentOutline nodes, while the separate
 * synthetic summary KnowledgeNode pipeline is not maintained by production
 * ingestion.
 *
 * The `planner` is threaded into the basic hybrid retriever so the requested
 * mode actually changes recall depth / fusion width / rerank gating. Without it
 * the basic retriever falls back to `defaultRetrievalPlan` ("fast" for every
 * request), collapsing fast/deep/research into one behaviour.
 */
export function createApiRetriever({
  embeddingEnabled,
  ftsReadiness,
  graph,
  graphExpansion,
  metrics,
  outlines,
  pageIndex,
  planner,
  publishedGraph,
  publishedProjectionMembership,
  repository,
  rerankerOptions,
  strictPublishedReads = false,
  visualQuery,
}: ApiRetrieverOptions): BasicHybridRetriever {
  if (strictPublishedReads && !pageIndex) {
    throw new Error(
      "Strict published retrieval requires the independent published PageIndex repository",
    );
  }

  const basicRetriever = createBasicHybridRetriever({
    planner,
    ...(publishedProjectionMembership ? { publishedProjectionMembership } : {}),
    repository: {
      ...(repository.publishedMembershipEnforced ? { publishedMembershipEnforced: true } : {}),
      searchDense: embeddingEnabled ? (input) => repository.searchDense(input) : async () => [],
      searchFts: (input) => repository.searchFts(input),
    },
    strictPublishedReads,
  });
  const searchVisualDense = repository.searchVisualDense;
  const visualAwareRetriever =
    visualQuery && searchVisualDense
      ? createVisualDenseRetrievalPath({
          planner,
          publishedMembershipEnforced: repository.publishedMembershipEnforced === true,
          ...(publishedProjectionMembership ? { publishedProjectionMembership } : {}),
          retriever: basicRetriever,
          searchVisualDense,
          strictPublishedReads,
          visualQuery,
        })
      : basicRetriever;
  const multimodalStack = createImageOcrRetrievalPath({
    imageBoost: 0.2,
    maxImageCandidates: 5,
    maxImageTopK: 10,
    retriever: createTableSpecificRetrievalPath({
      maxTableCandidates: 5,
      maxTableTopK: 10,
      retriever: visualAwareRetriever,
      tableBoost: 0.25,
    }),
  });
  let stack = multimodalStack;
  if (pageIndex) {
    const pageIndexPlanner = planner;
    if (!pageIndexPlanner) {
      throw new Error("Published PageIndex retrieval requires a mode-aware planner");
    }
    stack = createPublishedPageIndexRetrievalPath({
      maxConcurrentLeafOpens: 8,
      maxLeafEvidenceItems: 512,
      maxOutlineNodesScanned: 100_000,
      maxOutlinesScanned: 10_000,
      // RetrievalProfile.topK is bounded at 100. Keep the structural PageIndex selection budget
      // at least as wide so Research topK=100 is not capped by an unrelated internal default.
      maxSelectedSections: 100,
      outlinePageSize: 100,
      pageIndex,
      planner: pageIndexPlanner,
      retriever: multimodalStack,
    });
  } else if (outlines) {
    stack = createDocumentOutlineRetrievalPath({
      // This bounds outline I/O, not the final Top K. Research first keeps a
      // wider PageIndex candidate pool, then truncates after outline scoring.
      maxOutlinesPerQuery: 50,
      outlines,
      planner,
      retriever: multimodalStack,
    });
  }

  const publishedGraphAvailable = graph !== undefined && publishedGraph !== undefined;
  const extendedStack =
    graph && (!strictPublishedReads || publishedGraph)
      ? createGraphExpandedRetrievalPath({
          ...(graphExpansion ?? DEFAULT_GRAPH_EXPANSION_OPTIONS),
          graph,
          ...(publishedGraph ? { publishedGraph } : {}),
          retriever: stack,
          strictPublishedReads,
        })
      : createRequiredDeepGraphCapabilityGuard({
          available: !strictPublishedReads || publishedGraphAvailable,
          retriever: stack,
        });

  const legacyDefaultConfigured =
    rerankerOptions !== undefined && rerankerOptions.legacyDefaultConfigured !== false;

  // Always keep the final-rerank gate in the stack. An omitted/disabled
  // deployment capability must be observable as an error when a Fast/Deep
  // knowledge-space profile explicitly enables reranking; otherwise the query
  // would silently degrade to an un-reranked result. Legacy requests still use
  // the deployment default when one exists, and still skip reranking when it
  // does not.
  const finalRetriever = createFinalRerankRetrieval({
    planner,
    ...(rerankerOptions?.providerFactory
      ? { rerankerFactory: rerankerOptions.providerFactory }
      : {}),
    ...(rerankerOptions && legacyDefaultConfigured
      ? { reranker: rerankerOptions.provider, rerankerModel: rerankerOptions.model }
      : {}),
    retriever: extendedStack,
  });

  return {
    retrieve: async (input) => {
      const resolvedMode =
        planner?.plan({
          mode: input.mode,
          query: input.query,
          topK: input.topK,
          traceId: input.traceId,
        }).resolvedMode ?? (input.mode === "research" ? "research" : "fast");

      if (!embeddingEnabled && resolvedMode !== "research") {
        throw new HybridEmbeddingCapabilityUnavailableError();
      }

      if (ftsReadiness && resolvedMode !== "research") {
        if (!input.tenantId) {
          throw new Error("TiDB FTS readiness requires a tenant-scoped retrieval input");
        }
        await ftsReadiness.assertReady({
          knowledgeSpaceId: input.knowledgeSpaceId,
          tenantId: input.tenantId,
        });
      }

      const result = await finalRetriever.retrieve(input);
      recordRetrievalOperationalMetric(metrics, input, result);
      return result;
    },
  };
}

function createVisualDenseRetrievalPath({
  planner,
  publishedMembershipEnforced,
  publishedProjectionMembership,
  retriever,
  searchVisualDense,
  strictPublishedReads,
  visualQuery,
}: {
  readonly planner?: RetrievalPlanner | undefined;
  readonly publishedMembershipEnforced: boolean;
  readonly publishedProjectionMembership?:
    | Pick<ProjectionSetPublicationMemberRepository, "filterComponentKeys">
    | undefined;
  readonly retriever: BasicHybridRetriever;
  readonly searchVisualDense: NonNullable<HybridRetrievalRepository["searchVisualDense"]>;
  readonly strictPublishedReads: boolean;
  readonly visualQuery: NonNullable<ApiRetrieverOptions["visualQuery"]>;
}): BasicHybridRetriever {
  return {
    retrieve: async (input) => {
      const snapshot = input.projectionSnapshot;
      if (strictPublishedReads && !snapshot) {
        throw new Error("Hybrid retrieval requires a published projection snapshot");
      }
      if (snapshot && snapshot.knowledgeSpaceId !== input.knowledgeSpaceId) {
        throw new Error(
          "Published projection snapshot knowledgeSpaceId does not match retrieval input",
        );
      }
      if (snapshot && input.tenantId !== undefined && snapshot.tenantId !== input.tenantId) {
        throw new Error("Published projection snapshot tenantId does not match retrieval input");
      }
      if (snapshot && !publishedMembershipEnforced && !publishedProjectionMembership) {
        throw new Error(
          "Visual retrieval published snapshot requires authoritative repository filtering or a membership checker",
        );
      }
      const plan = planner?.plan({
        mode: input.mode,
        query: input.query,
        topK: input.topK,
        traceId: input.traceId,
      });
      const retrieveVisual = () =>
        visualQuery.provider
          .embed({
            inputType: "search_query",
            model: visualQuery.model,
            texts: [input.query],
            ...(snapshot
              ? { tenantId: snapshot.tenantId }
              : input.tenantId
                ? { tenantId: input.tenantId }
                : {}),
          })
          .then(async (embedding) => {
            if (embedding.dense.length !== 1) {
              throw new Error(
                `Visual query embedding provider returned ${embedding.dense.length} vectors for 1 query`,
              );
            }

            const queryVector = embedding.dense[0];

            if (!queryVector || queryVector.length === 0) {
              throw new Error("Visual query embedding provider returned no query vector");
            }

            if (!queryVector.every((value) => Number.isFinite(value))) {
              throw new Error("Visual query embedding provider returned a non-finite query vector");
            }

            const resolvedModel = embedding.model.trim();

            if (!resolvedModel) {
              throw new Error("Visual query embedding provider returned an empty model");
            }

            if (
              embedding.metadata.dimension !== undefined &&
              embedding.metadata.dimension !== queryVector.length
            ) {
              throw new Error(
                `Visual query embedding provider reported dimension=${embedding.metadata.dimension}; query vector has dimension=${queryVector.length}`,
              );
            }

            const candidates = await searchVisualDense({
              denseProjectionModel: resolvedModel,
              filters: input.filters,
              knowledgeSpaceId: input.knowledgeSpaceId,
              permissionScope: input.permissionScope,
              projectionSetCandidateFingerprint: input.projectionSetCandidateFingerprint,
              projectionSetFingerprint: input.projectionSetFingerprint,
              ...(snapshot ? { projectionSetPublicationId: snapshot.publicationId } : {}),
              projectionSetReadMode: input.projectionSetReadMode,
              queryVector,
              ...(snapshot
                ? { tenantId: snapshot.tenantId }
                : input.tenantId
                  ? { tenantId: input.tenantId }
                  : {}),
              topK: plan?.denseTopK ?? input.topK,
            });
            const metadataFiltered = filterRetrievalCandidatesByMetadata(
              candidates,
              normalizeRetrievalMetadataFilters(input.filters),
            );
            const permissionFiltered = filterRetrievalCandidatesByPermission(
              metadataFiltered,
              normalizeRetrievalPermissionScope(input.permissionScope),
            );

            const projectionFiltered = snapshot
              ? permissionFiltered
              : filterRetrievalCandidatesByProjectionSet(permissionFiltered, {
                  candidateFingerprint: input.projectionSetCandidateFingerprint,
                  mode: input.projectionSetReadMode,
                  publishedFingerprint: input.projectionSetFingerprint,
                });
            if (!snapshot || !publishedProjectionMembership) {
              return projectionFiltered;
            }

            const allowed = new Set(
              await publishedProjectionMembership.filterComponentKeys({
                componentKeys: [
                  ...new Set(projectionFiltered.map((candidate) => candidate.projectionId)),
                ],
                componentType: "index-projection",
                knowledgeSpaceId: snapshot.knowledgeSpaceId,
                publicationId: snapshot.publicationId,
                tenantId: snapshot.tenantId,
              }),
            );

            return projectionFiltered.filter((candidate) => allowed.has(candidate.projectionId));
          })
          .then(
            (candidates) => ({ candidates, ok: true as const }),
            () => ({ candidates: [] as RetrievalCandidate[], ok: false as const }),
          );
      const basePromise = retriever.retrieve(input);
      const [baseResult, visualResult] =
        visualQuery.mode === "fallback"
          ? await (async () => {
              const base = await basePromise;

              return base.items.length > 0
                ? [base, { candidates: [] as RetrievalCandidate[], ok: true as const }]
                : [base, await retrieveVisual()];
            })()
          : await Promise.all([basePromise, retrieveVisual()]);

      if (visualQuery.mode === "fallback" && baseResult.items.length > 0) {
        return baseResult;
      }

      if (!visualResult.ok) {
        return baseResult.metrics
          ? {
              ...baseResult,
              metrics: {
                ...baseResult.metrics,
                degradationFlags: [
                  ...(baseResult.metrics.degradationFlags ?? []),
                  "visual-dense-failed:skipped",
                ],
              },
            }
          : baseResult;
      }

      return {
        ...baseResult,
        items: mergeVisualDenseItems({
          baseItems: baseResult.items,
          limit: input.limit,
          visualCandidates: visualResult.candidates,
          visualWeight: visualQuery.mode === "primary" ? 1 : 0.5,
        }),
        metrics: baseResult.metrics
          ? {
              ...baseResult.metrics,
              visualEmbeddingCandidates: visualResult.candidates.length,
            }
          : undefined,
      };
    },
  };
}

function mergeVisualDenseItems({
  baseItems,
  limit,
  visualCandidates,
  visualWeight,
}: {
  readonly baseItems: readonly HybridRetrievalItem[];
  readonly limit: number;
  readonly visualCandidates: readonly RetrievalCandidate[];
  readonly visualWeight: number;
}): HybridRetrievalItem[] {
  const byNodeId = new Map<string, HybridRetrievalItem>();

  for (const item of baseItems) {
    byNodeId.set(item.nodeId, cloneHybridItem(item));
  }

  for (const [rank, candidate] of visualCandidates.entries()) {
    const contribution = visualWeight / (60 + rank + 1);
    const existing = byNodeId.get(candidate.nodeId);

    if (existing) {
      byNodeId.set(candidate.nodeId, {
        ...existing,
        metadata: { ...candidate.metadata, ...existing.metadata },
        projectionIds: uniqueStrings([...existing.projectionIds, candidate.projectionId]),
        score: existing.score + contribution,
        sources: uniqueStrings([...existing.sources, "visual"]) as HybridRetrievalItem["sources"],
      });
      continue;
    }

    byNodeId.set(candidate.nodeId, {
      citation: {
        ...candidate.citation,
        sectionPath: [...candidate.citation.sectionPath],
      },
      metadata: { ...candidate.metadata },
      nodeId: candidate.nodeId,
      permissionScope: [...candidate.permissionScope],
      projectionIds: [candidate.projectionId],
      score: contribution,
      sources: ["visual"],
    });
  }

  return [...byNodeId.values()]
    .sort(
      (first, second) => second.score - first.score || first.nodeId.localeCompare(second.nodeId),
    )
    .slice(0, limit);
}

function cloneHybridItem(item: HybridRetrievalItem): HybridRetrievalItem {
  return {
    ...item,
    citation: { ...item.citation, sectionPath: [...item.citation.sectionPath] },
    metadata: { ...item.metadata },
    permissionScope: item.permissionScope ? [...item.permissionScope] : undefined,
    projectionIds: [...item.projectionIds],
    sources: [...item.sources],
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
