import {
  type BasicHybridRetriever,
  type DocumentOutlineRepository,
  type GraphIndexRepository,
  type HybridRetrievalItem,
  type HybridRetrievalRepository,
  type ImageBytesVisualEmbeddingProvider,
  type PageIndexFindabilityRepository,
  type PageIndexLayeredTreeSearch,
  type PageIndexSemanticTreeSearch,
  type PageIndexWholeTreeSelector,
  type ProjectionSetPublicationMemberRepository,
  type PublishedGraphIndexRepository,
  type PublishedPageIndexRepository,
  QUERY_IMAGE_VISUAL_LEG_UNAVAILABLE,
  RETRIEVAL_MAX_TOP_K,
  type ResearchEvidenceReasoning,
  type ResearchQueryVectorizer,
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
  createResearchEvidenceRetrieval,
  createResearchOutlineEvidenceRetrieval,
  createTableSpecificRetrievalPath,
  filterRetrievalCandidatesByMetadata,
  filterRetrievalCandidatesByPermission,
  filterRetrievalCandidatesByProjectionSet,
  fuseRetrievalCandidates,
  normalizeRetrievalMetadataFilters,
  normalizeRetrievalPermissionScope,
  recordRetrievalOperationalMetric,
  runWithAbortSignal,
} from "@knowledge/api";
import type { KnowledgeSpaceEmbeddingProfile } from "@knowledge/core";
import type { EmbeddingProvider } from "@knowledge/embeddings";

import {
  type ApiGraphExpansionOptions,
  DEFAULT_GRAPH_EXPANSION_OPTIONS,
} from "./graph-expansion-options";
import type { ApiRerankerOptions } from "./reranker-options";

export interface ApiRetrieverOptions {
  /** Whether a dense embedding provider is configured; gates the dense leg. */
  readonly embeddingEnabled: boolean;
  /** Fail-closed latch for TiDB lexical postings used by every online retrieval mode. */
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
  /** Compatibility outline path used when the strict published PageIndex repository is absent. */
  readonly outlines?: DocumentOutlineRepository | undefined;
  /** Strict publication-member scoped PageIndex capability used by production Research. */
  readonly pageIndex?: PublishedPageIndexRepository | undefined;
  readonly pageIndexFindability?: Pick<PageIndexFindabilityRepository, "getManyRoutes"> | undefined;
  /** V2-only profile-scoped LLM scorer retained for replaying old Research checkpoints. */
  readonly pageIndexSemanticTreeSearch?: PageIndexSemanticTreeSearch | undefined;
  /** V2-only sibling-level traversal retained for replaying old Research checkpoints. */
  readonly pageIndexLayeredTreeSearch?: PageIndexLayeredTreeSearch | undefined;
  /** Compatibility selector used only if a lower-level caller omits layered navigation. */
  readonly pageIndexWholeTreeSelector?: PageIndexWholeTreeSelector | undefined;
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
  /** Online Research V3. Omission retains the V2 path for lower-level compatibility tests. */
  readonly researchEvidence?:
    | {
        readonly maxRerankCandidates?: number | undefined;
        readonly queryVectorizer: ResearchQueryVectorizer;
        readonly reasoning: ResearchEvidenceReasoning;
      }
    | undefined;
  readonly rerankerOptions?: ApiRerankerOptions | undefined;
  /** Require a fixed published projection snapshot before any retrieval leg runs. */
  readonly strictPublishedReads?: boolean | undefined;
  /** Text-to-visual query embedding for the separate visual_vector search leg. */
  readonly visualQuery?:
    | {
        readonly model?: string | undefined;
        readonly mode: "fallback" | "primary";
        readonly provider?: EmbeddingProvider | undefined;
        readonly providerFactory?:
          | ((profile: KnowledgeSpaceEmbeddingProfile) => EmbeddingProvider)
          | undefined;
        /** Reuse the already profile-bound text query vector instead of invoking the same model twice. */
        readonly useInputQueryVector?: boolean | undefined;
      }
    | undefined;
  /** Query-image embeddings in the same visual vector space; separately feature-gated. */
  readonly imageQuery?:
    | {
        readonly model?: string | undefined;
        readonly mode: "fallback" | "primary";
        readonly provider?: ImageBytesVisualEmbeddingProvider | undefined;
        readonly providerFactory?:
          | ((profile: KnowledgeSpaceEmbeddingProfile) => ImageBytesVisualEmbeddingProvider)
          | undefined;
      }
    | undefined;
}

/**
 * Stable fail-closed signal when the text embedding capability is unavailable.
 * Fast/Deep use dense hybrid recall, while Research uses the same immutable
 * dense projections as its semantic Value Search leg.
 */
export class HybridEmbeddingCapabilityUnavailableError extends Error {
  constructor() {
    super("Fast, Deep, and Research retrieval require the configured text embedding capability");
    this.name = "HybridEmbeddingCapabilityUnavailableError";
  }
}

/**
 * Builds the wired retrieval stack: final-rerank -> Research Evidence V3 ->
 * graph-expansion -> deterministic published-outline expansion -> image-ocr ->
 * table -> visual-dense + text-hybrid. Research V3 combines dense, FTS, outline,
 * and optionally Graph candidates across the knowledge space, applies weighted
 * RRF, then uses the profile reranker for comparable final scores. The reasoning
 * model is called only for bounded query planning and one evidence-set judgement;
 * retained V2 checkpoints alone use PageIndex LLM tree traversal.
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
  imageQuery,
  outlines,
  pageIndex,
  pageIndexFindability,
  pageIndexSemanticTreeSearch,
  pageIndexLayeredTreeSearch,
  pageIndexWholeTreeSelector,
  planner,
  publishedGraph,
  publishedProjectionMembership,
  repository,
  researchEvidence,
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
    (visualQuery || imageQuery) && searchVisualDense
      ? createVisualDenseRetrievalPath({
          ...(imageQuery ? { imageQuery } : {}),
          planner,
          publishedMembershipEnforced: repository.publishedMembershipEnforced === true,
          ...(publishedProjectionMembership ? { publishedProjectionMembership } : {}),
          retriever: basicRetriever,
          searchVisualDense,
          strictPublishedReads,
          ...(visualQuery ? { visualQuery } : {}),
        })
      : createUnavailableQueryImageVisualRetrievalPath(basicRetriever);
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
  let legacyResearchStack: BasicHybridRetriever | undefined;
  if (pageIndex) {
    if (!pageIndexSemanticTreeSearch) {
      throw new Error("Published PageIndex retrieval requires semantic LLM tree search");
    }
    if (!pageIndexWholeTreeSelector) {
      throw new Error("Published PageIndex retrieval requires its compatibility tree selector");
    }
    const pageIndexPlanner = planner;
    if (!pageIndexPlanner) {
      throw new Error("Published PageIndex retrieval requires a mode-aware planner");
    }
    // Keep V2 assembled behind a compatibility boundary so retained durable checkpoints remain
    // replayable. Fresh V3 requests never enter this per-document LLM traversal.
    legacyResearchStack = createPublishedPageIndexRetrievalPath({
      ...(pageIndexFindability ? { findability: pageIndexFindability } : {}),
      ...(pageIndexLayeredTreeSearch ? { layeredTreeSearch: pageIndexLayeredTreeSearch } : {}),
      // Research's planner already caps semantic recall at RETRIEVAL_MAX_TOP_K.
      maxSemanticCandidates: RETRIEVAL_MAX_TOP_K,
      maxSemanticCandidatesPerCall: 5,
      pageIndex,
      planner: pageIndexPlanner,
      retriever: multimodalStack,
      semanticTreeSearch: pageIndexSemanticTreeSearch,
      valueSearch: repository,
      wholeTreeSelector: pageIndexWholeTreeSelector,
    });
    stack = researchEvidence
      ? createResearchOutlineEvidenceRetrieval({
          pageIndex,
          retriever: multimodalStack,
        })
      : legacyResearchStack;
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
  const researchRetriever = researchEvidence
    ? createResearchEvidenceRetrieval({
        ...(legacyResearchStack ? { legacyResearchRetriever: legacyResearchStack } : {}),
        ...(researchEvidence.maxRerankCandidates === undefined
          ? {}
          : { maxRerankCandidates: researchEvidence.maxRerankCandidates }),
        planner,
        queryVectorizer: researchEvidence.queryVectorizer,
        reasoning: researchEvidence.reasoning,
        rerankerFactory: (selection) => {
          if (!rerankerOptions?.providerFactory) {
            throw new Error("Research retrieval requires the reranker provider factory");
          }
          return rerankerOptions.providerFactory(selection);
        },
        retriever: extendedStack,
      })
    : extendedStack;
  const finalRetriever = createFinalRerankRetrieval({
    planner,
    ...(rerankerOptions?.providerFactory
      ? { rerankerFactory: rerankerOptions.providerFactory }
      : {}),
    ...(rerankerOptions && legacyDefaultConfigured
      ? {
          reranker: rerankerOptions.provider,
          rerankerModel: rerankerOptions.model,
        }
      : {}),
    retriever: researchRetriever,
  });

  return {
    retrieve: async (input) => {
      const resolvedMode =
        planner?.plan({
          hasQueryImages: (input.queryImages?.length ?? 0) > 0,
          mode: input.mode,
          query: input.query,
          topK: input.topK,
          traceId: input.traceId,
        }).resolvedMode ?? (input.mode === "research" ? "research" : "fast");

      if (!embeddingEnabled && input.query.trim()) {
        throw new HybridEmbeddingCapabilityUnavailableError();
      }

      if (ftsReadiness && input.query.trim()) {
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

function createUnavailableQueryImageVisualRetrievalPath(
  retriever: BasicHybridRetriever,
): BasicHybridRetriever {
  return {
    retrieve: async (input) => {
      const result = await retriever.retrieve(input);
      if ((input.queryImages?.length ?? 0) === 0) return result;
      return {
        ...result,
        metrics: result.metrics
          ? {
              ...result.metrics,
              degradationFlags: [
                ...(result.metrics.degradationFlags ?? []),
                QUERY_IMAGE_VISUAL_LEG_UNAVAILABLE,
              ],
            }
          : undefined,
      };
    },
  };
}

function createVisualDenseRetrievalPath({
  imageQuery,
  planner,
  publishedMembershipEnforced,
  publishedProjectionMembership,
  retriever,
  searchVisualDense,
  strictPublishedReads,
  visualQuery,
}: {
  readonly imageQuery?: NonNullable<ApiRetrieverOptions["imageQuery"]> | undefined;
  readonly planner?: RetrievalPlanner | undefined;
  readonly publishedMembershipEnforced: boolean;
  readonly publishedProjectionMembership?:
    | Pick<ProjectionSetPublicationMemberRepository, "filterComponentKeys">
    | undefined;
  readonly retriever: BasicHybridRetriever;
  readonly searchVisualDense: NonNullable<HybridRetrievalRepository["searchVisualDense"]>;
  readonly strictPublishedReads: boolean;
  readonly visualQuery?: NonNullable<ApiRetrieverOptions["visualQuery"]> | undefined;
}): BasicHybridRetriever {
  return {
    retrieve: async (input) => {
      input.signal?.throwIfAborted();
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
        hasQueryImages: (input.queryImages?.length ?? 0) > 0,
        mode: input.mode,
        query: input.query,
        topK: input.topK,
        traceId: input.traceId,
      });
      const searchVector = async (
        queryVector: readonly number[],
        resolvedModel: string,
      ): Promise<RetrievalCandidate[]> => {
        if (queryVector.length === 0 || !queryVector.every((value) => Number.isFinite(value))) {
          throw new Error("Visual query embedding provider returned an invalid query vector");
        }
        if (!resolvedModel.trim()) {
          throw new Error("Visual query embedding provider returned an empty model");
        }
        const candidates = await runWithAbortSignal(
          () =>
            searchVisualDense({
              denseProjectionModel: resolvedModel,
              filters: input.filters,
              knowledgeSpaceId: input.knowledgeSpaceId,
              permissionScope: input.permissionScope,
              projectionSetCandidateFingerprint: input.projectionSetCandidateFingerprint,
              projectionSetFingerprint: input.projectionSetFingerprint,
              ...(snapshot ? { projectionSetPublicationId: snapshot.publicationId } : {}),
              projectionSetReadMode: input.projectionSetReadMode,
              queryVector,
              ...(input.signal ? { signal: input.signal } : {}),
              ...(snapshot
                ? { tenantId: snapshot.tenantId }
                : input.tenantId
                  ? { tenantId: input.tenantId }
                  : {}),
              topK: plan?.denseTopK ?? input.topK,
            }),
          input.signal,
        );
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
          await runWithAbortSignal(
            () =>
              publishedProjectionMembership.filterComponentKeys({
                componentKeys: [
                  ...new Set(projectionFiltered.map((candidate) => candidate.projectionId)),
                ],
                componentType: "index-projection",
                knowledgeSpaceId: snapshot.knowledgeSpaceId,
                publicationId: snapshot.publicationId,
                tenantId: snapshot.tenantId,
              }),
            input.signal,
          ),
        );

        return projectionFiltered.filter((candidate) => allowed.has(candidate.projectionId));
      };
      const retrieveVisual = async () => {
        try {
          const profileDriven = Boolean(
            visualQuery?.providerFactory ||
              visualQuery?.useInputQueryVector ||
              imageQuery?.providerFactory,
          );
          const embeddingProfile = input.embeddingProfile;
          if (
            profileDriven &&
            (!embeddingProfile || !input.embeddingInputModalities?.includes("image"))
          ) {
            if ((input.queryImages?.length ?? 0) === 0) {
              return { candidateLists: [] as RetrievalCandidate[][], ok: true as const };
            }
            return {
              candidateLists: [] as RetrievalCandidate[][],
              degradationFlag: QUERY_IMAGE_VISUAL_LEG_UNAVAILABLE,
              ok: false as const,
            };
          }
          if ((input.queryImages?.length ?? 0) > 0) {
            if (!imageQuery) {
              return {
                candidateLists: [] as RetrievalCandidate[][],
                degradationFlag: QUERY_IMAGE_VISUAL_LEG_UNAVAILABLE,
                ok: false as const,
              };
            }
            const images = input.queryImages ?? [];
            const imageProvider = imageQuery.providerFactory
              ? imageQuery.providerFactory(assertEmbeddingProfile(embeddingProfile))
              : imageQuery.provider;
            const imageModel = imageQuery.providerFactory
              ? assertEmbeddingProfile(embeddingProfile).model
              : imageQuery.model;
            if (!imageProvider || !imageModel?.trim()) {
              throw new Error("Visual image query provider is unavailable");
            }
            const embedding = await runWithAbortSignal(
              () =>
                imageProvider.embedImages({
                  images: images.map((image) => ({
                    assetRef: { uploadFileId: image.uploadFileId },
                    body: image.body,
                    contentType: image.mimeType,
                    documentAssetId: image.uploadFileId,
                    metadata: { queryImage: true, sha256: image.sha256 },
                    modality: "image",
                    nodeId: image.uploadFileId,
                    objectKey: image.uploadFileId,
                    sourceText: "",
                  })),
                  inputType: "query",
                  model: imageModel,
                  ...(input.signal ? { signal: input.signal } : {}),
                  ...(snapshot
                    ? { tenantId: snapshot.tenantId }
                    : input.tenantId
                      ? { tenantId: input.tenantId }
                      : {}),
                }),
              input.signal,
            );
            if (embedding.dense.length !== images.length) {
              throw new Error(
                `Visual query embedding provider returned ${embedding.dense.length} vectors for ${images.length} images`,
              );
            }
            const resolvedModel = embedding.model.trim();
            const candidateLists = await Promise.all(
              embedding.dense.map((vector) => searchVector(vector, resolvedModel)),
            );
            return { candidateLists, ok: true as const };
          }

          if (!visualQuery || !input.query.trim()) {
            return { candidateLists: [] as RetrievalCandidate[][], ok: true as const };
          }
          if (visualQuery.useInputQueryVector) {
            return {
              candidateLists: [
                await searchVector(
                  input.queryVector,
                  assertEmbeddingProfile(embeddingProfile).model,
                ),
              ],
              ok: true as const,
            };
          }
          const queryProvider = visualQuery.providerFactory
            ? visualQuery.providerFactory(assertEmbeddingProfile(embeddingProfile))
            : visualQuery.provider;
          const queryModel = visualQuery.providerFactory
            ? assertEmbeddingProfile(embeddingProfile).model
            : visualQuery.model;
          if (!queryProvider || !queryModel?.trim()) {
            throw new Error("Visual text query provider is unavailable");
          }
          const embedding = await runWithAbortSignal(
            () =>
              queryProvider.embed({
                inputType: "search_query",
                model: queryModel,
                ...(input.signal ? { signal: input.signal } : {}),
                texts: [input.query],
                ...(snapshot
                  ? { tenantId: snapshot.tenantId }
                  : input.tenantId
                    ? { tenantId: input.tenantId }
                    : {}),
              }),
            input.signal,
          );
          if (embedding.dense.length !== 1) {
            throw new Error(
              `Visual query embedding provider returned ${embedding.dense.length} vectors for 1 query`,
            );
          }
          const queryVector = embedding.dense[0];
          if (!queryVector) {
            throw new Error("Visual query embedding provider returned no query vector");
          }
          if (
            embedding.metadata.dimension !== undefined &&
            embedding.metadata.dimension !== queryVector.length
          ) {
            throw new Error(
              `Visual query embedding provider reported dimension=${embedding.metadata.dimension}; query vector has dimension=${queryVector.length}`,
            );
          }
          return {
            candidateLists: [await searchVector(queryVector, embedding.model)],
            ok: true as const,
          };
        } catch {
          input.signal?.throwIfAborted();
          return {
            candidateLists: [] as RetrievalCandidate[][],
            degradationFlag:
              (input.queryImages?.length ?? 0) > 0
                ? QUERY_IMAGE_VISUAL_LEG_UNAVAILABLE
                : "visual-dense-failed:skipped",
            ok: false as const,
          };
        }
      };
      const basePromise = runWithAbortSignal(() => retriever.retrieve(input), input.signal);
      const visualMode =
        (input.queryImages?.length ?? 0) > 0 ? imageQuery?.mode : visualQuery?.mode;
      const [baseResult, visualResult] =
        visualMode === "fallback" && (input.queryImages?.length ?? 0) === 0
          ? await (async () => {
              const base = await basePromise;

              return base.items.length > 0
                ? [
                    base,
                    {
                      candidateLists: [] as RetrievalCandidate[][],
                      ok: true as const,
                    },
                  ]
                : [base, await retrieveVisual()];
            })()
          : await Promise.all([basePromise, retrieveVisual()]);
      input.signal?.throwIfAborted();

      if (
        visualMode === "fallback" &&
        (input.queryImages?.length ?? 0) === 0 &&
        baseResult.items.length > 0
      ) {
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
                  visualResult.degradationFlag,
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
          visualCandidateLists: visualResult.candidateLists,
          visualWeight: visualMode === "primary" ? 1 : 0.5,
        }),
        metrics: baseResult.metrics
          ? {
              ...baseResult.metrics,
              visualEmbeddingCandidates: visualResult.candidateLists.reduce(
                (total, candidates) => total + candidates.length,
                0,
              ),
            }
          : undefined,
      };
    },
  };
}

function assertEmbeddingProfile(
  value: KnowledgeSpaceEmbeddingProfile | undefined,
): KnowledgeSpaceEmbeddingProfile {
  if (!value) throw new Error("Profile visual query requires an embedding profile");
  return value;
}

function mergeVisualDenseItems({
  baseItems,
  limit,
  visualCandidateLists,
  visualWeight,
}: {
  readonly baseItems: readonly HybridRetrievalItem[];
  readonly limit: number;
  readonly visualCandidateLists: readonly (readonly RetrievalCandidate[])[];
  readonly visualWeight: number;
}): HybridRetrievalItem[] {
  const byNodeId = new Map<string, HybridRetrievalItem>();

  for (const item of baseItems) {
    byNodeId.set(item.nodeId, cloneHybridItem(item));
  }

  const nonEmptyLists = visualCandidateLists.filter((candidates) => candidates.length > 0);
  const perImageWeight =
    visualCandidateLists.length > 0 ? visualWeight / visualCandidateLists.length : 0;
  for (const visualCandidates of nonEmptyLists) {
    const normalizedVisualItems = fuseRetrievalCandidates({
      dense: visualCandidates,
      fts: [],
      limit: visualCandidates.length,
    });

    for (const visualItem of normalizedVisualItems) {
      const contribution = visualItem.score * perImageWeight;
      const existing = byNodeId.get(visualItem.nodeId);

      if (existing) {
        byNodeId.set(visualItem.nodeId, {
          ...existing,
          metadata: { ...visualItem.metadata, ...existing.metadata },
          projectionIds: uniqueStrings([...existing.projectionIds, ...visualItem.projectionIds]),
          score: existing.score + contribution,
          sources: uniqueStrings([...existing.sources, "visual"]) as HybridRetrievalItem["sources"],
        });
        continue;
      }

      byNodeId.set(visualItem.nodeId, {
        citation: {
          ...visualItem.citation,
          sectionPath: [...visualItem.citation.sectionPath],
        },
        metadata: { ...visualItem.metadata },
        nodeId: visualItem.nodeId,
        permissionScope: visualItem.permissionScope ? [...visualItem.permissionScope] : undefined,
        projectionIds: [...visualItem.projectionIds],
        score: contribution,
        sources: ["visual"],
      });
    }
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
