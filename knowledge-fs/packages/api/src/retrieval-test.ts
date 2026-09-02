import {
  type AuthSubject,
  type KnowledgeSpaceEmbeddingProfile,
  type KnowledgeSpaceModelSelection,
  type KnowledgeSpaceRetrievalProfile,
  validateKnowledgeSpaceRetrievalProfileForMode,
} from "@knowledge/core";
import type { EmbeddingProvider } from "@knowledge/embeddings";

import { runWithAbortSignal } from "./bounded-concurrency";
import { candidatePermissionScopeAllows } from "./candidate-content-authorization";
import {
  type KnowledgeSpaceEmbeddingResolver,
  assertEmbeddingModelMatchesProfile,
  assertObservedEmbeddingDimension,
} from "./knowledge-space-embedding-resolver";
import {
  ModelCapabilitySnapshotSchema,
  type ModelInputModality,
} from "./model-capability-preflight";
import type { PublishedProjectionReadSnapshot } from "./published-projection-read-snapshot";
import {
  type QueryImageExpansionProvider,
  QueryImageExpansionTimeoutError,
  formatQueryImageExpansionResult,
} from "./query-image-expansion";
import {
  QUERY_IMAGE_EXPANSION_TIMEOUT,
  QUERY_IMAGE_IGNORED_NO_VISION_MODEL,
  QUERY_IMAGE_MAX_COUNT,
  QueryImageDegradationReasonSchema,
  type ResolvedQueryImage,
} from "./query-images";
import type { RetrievalMetadataFilters } from "./retrieval-candidates";
import type { RetrievalSource } from "./retrieval-candidates";
import { normalizeRetrievalMetadataFilters } from "./retrieval-filter-utils";
import { RETRIEVAL_MAX_TOP_K, createRetrievalPlanner } from "./retrieval-planner";
import type {
  BasicHybridRetriever,
  HybridRetrievalMetrics,
  RetrievalPlan,
} from "./retrieval-types";

const retrievalTestPlanner = createRetrievalPlanner({ maxTopK: RETRIEVAL_MAX_TOP_K });

export const RetrievalTestStageNames = [
  "embedding",
  "dense",
  "fts",
  "fusion",
  "summary",
  "outline",
  "pageindex",
  "graph",
  "rerank",
  "permission_filter",
  "publication_filter",
  "threshold",
  "top_k",
] as const;
export type RetrievalTestStageName = (typeof RetrievalTestStageNames)[number];

export interface RetrievalTestStage {
  readonly candidateCount?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly filteredCount?: number | undefined;
  readonly name: RetrievalTestStageName;
  readonly status: "executed" | "skipped";
}

export interface RetrievalTestResult {
  readonly items: readonly {
    readonly citation: {
      readonly artifactHash: string;
      readonly documentAssetId: string;
      readonly documentVersion: number;
      readonly endOffset?: number | undefined;
      readonly pageNumber?: number | undefined;
      readonly sectionPath: readonly string[];
      readonly startOffset?: number | undefined;
    };
    readonly nodeId: string;
    readonly projectionIds: readonly string[];
    readonly score: number;
    readonly sources: readonly RetrievalSource[];
    readonly text?: string | undefined;
  }[];
  readonly metrics: HybridRetrievalMetrics;
  readonly plan: RetrievalTestPlan;
  readonly stages: readonly RetrievalTestStage[];
}

export type RetrievalTestPlan = Omit<RetrievalPlan, "requestedMode" | "resolvedMode"> & {
  readonly requestedMode: "deep" | "fast" | "research";
  readonly resolvedMode: "deep" | "fast" | "research";
};

export interface RetrievalTestRuntimeCapabilitiesInput {
  readonly embeddingCapabilitySnapshot?: Readonly<Record<string, unknown>> | undefined;
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly mode: "deep" | "fast" | "research";
  readonly retrievalCapabilitySnapshot: Readonly<Record<string, unknown>>;
  readonly retrievalProfile: KnowledgeSpaceRetrievalProfile;
}

export interface RetrievalTestExecutorInput {
  readonly embeddingInputModalities?: readonly ModelInputModality[] | undefined;
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly filters?: RetrievalMetadataFilters | undefined;
  readonly includeText?: boolean | undefined;
  readonly knowledgeSpaceId: string;
  readonly mode: "deep" | "fast" | "research";
  readonly permissionScope: readonly string[];
  readonly projectionSnapshot: PublishedProjectionReadSnapshot;
  readonly query: string;
  /** Number of validated wire references, retained even when a text-only space skips byte I/O. */
  readonly queryImageReferenceCount?: number | undefined;
  readonly queryImages?: readonly ResolvedQueryImage[] | undefined;
  readonly reasoningInputModalities?: readonly ModelInputModality[] | undefined;
  readonly retrievalProfile: KnowledgeSpaceRetrievalProfile;
  readonly subject: AuthSubject;
  readonly signal?: AbortSignal | undefined;
  readonly traceId: string;
}

export interface RetrievalTestExecutor {
  execute(input: RetrievalTestExecutorInput): Promise<RetrievalTestResult>;
}

export interface RetrievalTestExecutorOptions {
  readonly embeddingModel?: string | undefined;
  readonly embeddingResolver?: KnowledgeSpaceEmbeddingResolver | undefined;
  readonly embeddings?: EmbeddingProvider | undefined;
  readonly queryImageExpansionProvider?: QueryImageExpansionProvider | undefined;
  readonly retriever: BasicHybridRetriever;
}

export class RetrievalTestUnavailableError extends Error {
  readonly code = "RETRIEVAL_TEST_UNAVAILABLE";

  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "RetrievalTestUnavailableError";
  }
}

/**
 * Verifies that the immutable profile snapshot was activated from a matching successful
 * preflight. The raw capability payload is never returned by the retrieval-test endpoint.
 */
export function assertRetrievalTestRuntimeCapabilities(
  input: RetrievalTestRuntimeCapabilitiesInput,
): void {
  if (input.retrievalCapabilitySnapshot.verification !== "verified") {
    throw new RetrievalTestUnavailableError(
      "The active retrieval profile does not have verified model capabilities",
    );
  }

  assertCapabilityMatchesSelection({
    capability: input.retrievalCapabilitySnapshot.reasoning,
    expectedKind: "reasoning",
    selection: input.retrievalProfile.reasoningModel,
  });

  const rerankSelection = input.retrievalProfile.rerank.model;
  if (!input.retrievalProfile.rerank.enabled || !rerankSelection) {
    throw new RetrievalTestUnavailableError(
      "The active retrieval profile is missing its mandatory rerank model",
    );
  }
  assertCapabilityMatchesSelection({
    capability: input.retrievalCapabilitySnapshot.rerank,
    expectedKind: "rerank",
    selection: rerankSelection,
  });

  if (!input.embeddingProfile || !input.embeddingCapabilitySnapshot) {
    throw new RetrievalTestUnavailableError(
      "Fast, Deep, and Research retrieval tests require a verified embedding profile",
    );
  }
  const capability = assertCapabilityMatchesSelection({
    capability: input.embeddingCapabilitySnapshot,
    expectedKind: "embedding",
    selection: input.embeddingProfile,
  });
  if (
    input.embeddingProfile.dimension === undefined ||
    capability.dimension !== input.embeddingProfile.dimension ||
    capability.distanceMetric === undefined
  ) {
    throw new RetrievalTestUnavailableError(
      "The active embedding profile dimension does not match its capability snapshot",
    );
  }
}

/** Executes the production retriever without invoking answer synthesis. */
export function createRetrievalTestExecutor({
  embeddingModel,
  embeddingResolver,
  embeddings,
  queryImageExpansionProvider,
  retriever,
}: RetrievalTestExecutorOptions): RetrievalTestExecutor {
  return {
    execute: async (input) => {
      try {
        const profileError = validateKnowledgeSpaceRetrievalProfileForMode(
          input.retrievalProfile,
          input.mode,
        );
        if (profileError) {
          throw new RetrievalTestUnavailableError(`${profileError.code}: ${profileError.message}`);
        }
        if (input.signal?.aborted) {
          throw new RetrievalTestUnavailableError("Retrieval test execution lease is unavailable");
        }
        const preparedQuery = await prepareRetrievalTestQuery({
          input,
          provider: queryImageExpansionProvider,
        });
        const plan = retrievalTestPlanner.plan({
          hasQueryImages: preparedQuery.queryImages.length > 0,
          mode: input.mode,
          query: preparedQuery.query,
          topK: input.retrievalProfile.topK,
          traceId: input.traceId,
        });
        const embeddingStartedAt = Date.now();
        const queryVector = await resolveRetrievalTestEmbedding({
          embeddingModel,
          embeddingProfile: input.embeddingProfile,
          embeddingResolver,
          embeddings,
          knowledgeSpaceId: input.knowledgeSpaceId,
          query: preparedQuery.query,
          signal: input.signal,
          tenantId: input.subject.tenantId,
        });
        const embeddingMs = Math.max(0, Date.now() - embeddingStartedAt);
        const retrieval = await runWithAbortSignal(
          () =>
            retriever.retrieve({
              ...(input.embeddingProfile
                ? {
                    denseProjectionModel: input.embeddingProfile.vectorSpaceId,
                    embeddingProfile: input.embeddingProfile,
                  }
                : {}),
              ...(input.embeddingInputModalities
                ? { embeddingInputModalities: input.embeddingInputModalities }
                : {}),
              knowledgeSpaceId: input.knowledgeSpaceId,
              ...(input.filters === undefined
                ? {}
                : { filters: normalizeRetrievalMetadataFilters(input.filters) }),
              limit: input.retrievalProfile.topK,
              mode: input.mode,
              permissionScope: input.permissionScope,
              projectionSnapshot: input.projectionSnapshot,
              query: preparedQuery.query,
              ...(preparedQuery.queryImages.length > 0
                ? { queryImages: preparedQuery.queryImages }
                : {}),
              queryVector,
              retrievalProfile: input.retrievalProfile,
              ...(input.signal ? { signal: input.signal } : {}),
              tenantId: input.subject.tenantId,
              topK: input.retrievalProfile.topK,
              traceId: input.traceId,
            }),
          input.signal,
        );
        if (!retrieval.plan || !retrieval.metrics) {
          throw new RetrievalTestUnavailableError(
            "Production retrieval did not return the required plan and stage metrics",
          );
        }
        if (!sameRetrievalTestPlan(retrieval.plan, plan, input.mode)) {
          throw new RetrievalTestUnavailableError(
            "Production retrieval returned a plan that does not match the active profile",
          );
        }
        const metrics = appendQueryImageDegradationFlags(
          retrieval.metrics,
          preparedQuery.degradationFlags,
        );
        assertRetrievalTestModeEvidence({
          items: retrieval.items,
          metrics,
          mode: input.mode,
          permissionScope: input.permissionScope,
          profile: input.retrievalProfile,
        });
        return {
          items: retrieval.items.map((item) =>
            safeRetrievalTestItem(item, input.includeText === true),
          ),
          metrics: cloneRetrievalTestMetrics(metrics),
          plan: {
            ...retrieval.plan,
            requestedMode: input.mode,
            resolvedMode: input.mode,
          },
          stages: retrievalTestStages({
            embeddingMs,
            metrics,
            mode: input.mode,
            profile: input.retrievalProfile,
            resultCount: retrieval.items.length,
          }),
        };
      } catch (error) {
        if (input.signal?.aborted) {
          throw input.signal.reason;
        }
        if (error instanceof RetrievalTestUnavailableError) {
          throw error;
        }
        throw new RetrievalTestUnavailableError("Production retrieval test is unavailable", {
          cause: error,
        });
      }
    },
  };
}

async function resolveRetrievalTestEmbedding({
  embeddingModel,
  embeddingProfile,
  embeddingResolver,
  embeddings,
  knowledgeSpaceId,
  query,
  signal,
  tenantId,
}: {
  readonly embeddingModel?: string | undefined;
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly embeddingResolver?: KnowledgeSpaceEmbeddingResolver | undefined;
  readonly embeddings?: EmbeddingProvider | undefined;
  readonly knowledgeSpaceId: string;
  readonly query: string;
  readonly signal?: AbortSignal | undefined;
  readonly tenantId: string;
}): Promise<readonly number[]> {
  if (!query.trim()) return [];
  if (!embeddingProfile) {
    throw new RetrievalTestUnavailableError(
      "Fast, Deep, and Research retrieval tests require an active embedding profile",
    );
  }
  const resolved = embeddingResolver
    ? await runWithAbortSignal(
        () => embeddingResolver.resolve({ profile: embeddingProfile, knowledgeSpaceId, tenantId }),
        signal,
      )
    : null;
  const provider = resolved?.providerInstance ?? embeddings;
  const model = resolved?.model ?? embeddingModel;
  if (!provider || !model?.trim()) {
    throw new RetrievalTestUnavailableError("Embedding capability is unavailable");
  }
  const response = await runWithAbortSignal(
    () =>
      provider.embed({
        inputType: "search_query",
        model,
        ...(signal ? { signal } : {}),
        tenantId,
        texts: [query],
      }),
    signal,
  );
  const vector = response.dense[0];
  if (
    response.dense.length !== 1 ||
    !vector ||
    vector.length === 0 ||
    !vector.every(Number.isFinite)
  ) {
    throw new RetrievalTestUnavailableError("Embedding provider returned an invalid query vector");
  }
  assertEmbeddingModelMatchesProfile({ observedModel: response.model, profile: embeddingProfile });
  assertObservedEmbeddingDimension({
    observedDimension: vector.length,
    profile: embeddingProfile,
  });
  return [...vector];
}

async function prepareRetrievalTestQuery({
  input,
  provider,
}: {
  readonly input: RetrievalTestExecutorInput;
  readonly provider?: QueryImageExpansionProvider | undefined;
}): Promise<{
  readonly degradationFlags: readonly string[];
  readonly query: string;
  readonly queryImages: readonly ResolvedQueryImage[];
}> {
  const images = input.queryImages ?? [];
  const requestedImageCount = input.queryImageReferenceCount ?? images.length;
  const query = input.query.trim();
  if (
    !Number.isInteger(requestedImageCount) ||
    requestedImageCount < images.length ||
    requestedImageCount > QUERY_IMAGE_MAX_COUNT
  ) {
    throw new RetrievalTestUnavailableError("Query image reference count is invalid");
  }
  if (requestedImageCount === 0) {
    return { degradationFlags: [], query, queryImages: [] };
  }

  const embeddingSupportsImages = input.embeddingInputModalities?.includes("image") === true;
  const reasoningSupportsImages = input.reasoningInputModalities?.includes("image") === true;
  if (
    (embeddingSupportsImages || reasoningSupportsImages) &&
    images.length !== requestedImageCount
  ) {
    throw new RetrievalTestUnavailableError(
      "Query image bytes were not resolved for a vision-capable space",
    );
  }
  const queryImages = embeddingSupportsImages ? images : [];
  const shouldExpand =
    !(input.mode === "fast" && embeddingSupportsImages) &&
    reasoningSupportsImages &&
    provider !== undefined;
  if (!shouldExpand) {
    if (embeddingSupportsImages) {
      return { degradationFlags: [], query, queryImages };
    }
    if (!query) {
      throw new RetrievalTestUnavailableError(
        "Pure-image retrieval requires a vision-capable embedding or reasoning model",
      );
    }
    return {
      degradationFlags: [QUERY_IMAGE_IGNORED_NO_VISION_MODEL],
      query,
      queryImages: [],
    };
  }

  try {
    const result = await runWithAbortSignal(
      () =>
        provider.expand({
          images,
          model: input.retrievalProfile.reasoningModel,
          query,
          ...(input.signal ? { signal: input.signal } : {}),
          tenantId: input.subject.tenantId,
          traceId: input.traceId,
        }),
      input.signal,
    );
    const expansion = formatQueryImageExpansionResult(result);
    if (!expansion) {
      throw new RetrievalTestUnavailableError("Query image expansion returned no usable text");
    }
    return {
      degradationFlags: [],
      query: [query, expansion].filter(Boolean).join("\n\n"),
      queryImages,
    };
  } catch (error) {
    input.signal?.throwIfAborted();
    if (!query && !embeddingSupportsImages) {
      throw new RetrievalTestUnavailableError(
        "Pure-image retrieval requires a vision-capable embedding or reasoning model",
        { cause: error },
      );
    }
    return {
      degradationFlags: [
        error instanceof QueryImageExpansionTimeoutError
          ? QUERY_IMAGE_EXPANSION_TIMEOUT
          : QUERY_IMAGE_IGNORED_NO_VISION_MODEL,
      ],
      query,
      queryImages,
    };
  }
}

function appendQueryImageDegradationFlags(
  metrics: HybridRetrievalMetrics,
  flags: readonly string[],
): HybridRetrievalMetrics {
  const degradationFlags = [...new Set([...(metrics.degradationFlags ?? []), ...flags])];
  return degradationFlags.length > 0 ? { ...metrics, degradationFlags } : metrics;
}

function retrievalTestStages({
  embeddingMs,
  metrics,
  mode,
  profile,
  resultCount,
}: {
  readonly embeddingMs: number;
  readonly metrics: HybridRetrievalMetrics;
  readonly mode: "deep" | "fast" | "research";
  readonly profile: KnowledgeSpaceRetrievalProfile;
  readonly resultCount: number;
}): RetrievalTestStage[] {
  const research = mode === "research";
  const deep = mode === "deep";
  const graph = deep || metrics.graphExpansionCandidates !== undefined;
  const rerank = profile.rerank.enabled;
  return [
    stage("embedding", true, undefined, embeddingMs + (metrics.researchQueryEmbeddingMs ?? 0)),
    stage("dense", true, metrics.denseCandidates, metrics.denseMs),
    stage("fts", true, metrics.ftsCandidates, metrics.ftsMs),
    stage("fusion", true, metrics.fusedCandidates, metrics.fusionMs),
    stage("summary", false, metrics.summaryCandidates),
    stage(
      "outline",
      research,
      metrics.documentOutlineMatchedItems ?? metrics.pageIndexScannedOutlines,
    ),
    stage(
      "pageindex",
      research,
      metrics.pageIndexMatchedNodes ?? metrics.documentOutlineMatchedItems ?? 0,
    ),
    stage("graph", graph, metrics.graphExpansionCandidates ?? 0, metrics.graphExpansionMs),
    stage("rerank", rerank, metrics.rerankCandidates ?? 0, metrics.rerankMs),
    {
      ...(metrics.permissionFilteredCandidates === undefined
        ? {}
        : { filteredCount: metrics.permissionFilteredCandidates }),
      name: "permission_filter",
      status: "executed",
    },
    {
      ...(metrics.projectionFilteredCandidates === undefined
        ? {}
        : { filteredCount: metrics.projectionFilteredCandidates }),
      name: "publication_filter",
      status: "executed",
    },
    {
      ...(metrics.scoreThresholdFilteredCandidates === undefined
        ? {}
        : { filteredCount: metrics.scoreThresholdFilteredCandidates }),
      name: "threshold",
      status: profile.scoreThreshold.enabled ? "executed" : "skipped",
    },
    stage("top_k", true, resultCount),
  ];
}

function stage(
  name: RetrievalTestStageName,
  executed: boolean,
  candidateCount?: number,
  durationMs?: number,
): RetrievalTestStage {
  return {
    ...(candidateCount === undefined ? {} : { candidateCount }),
    ...(durationMs === undefined ? {} : { durationMs }),
    name,
    status: executed ? "executed" : "skipped",
  };
}

function assertCapabilityMatchesSelection({
  capability,
  expectedKind,
  selection,
}: {
  readonly capability: unknown;
  readonly expectedKind: "embedding" | "reasoning" | "rerank";
  readonly selection: KnowledgeSpaceModelSelection;
}) {
  const parsed = ModelCapabilitySnapshotSchema.safeParse(capability);
  if (
    !parsed.success ||
    parsed.data.kind !== expectedKind ||
    parsed.data.selection.model !== selection.model ||
    parsed.data.selection.pluginId !== selection.pluginId ||
    parsed.data.selection.provider !== selection.provider
  ) {
    throw new RetrievalTestUnavailableError(
      `The active ${expectedKind} capability does not match its profile`,
    );
  }
  return parsed.data;
}

function assertRetrievalTestModeEvidence({
  items,
  metrics,
  mode,
  permissionScope,
  profile,
}: {
  readonly items: Awaited<ReturnType<BasicHybridRetriever["retrieve"]>>["items"];
  readonly metrics: HybridRetrievalMetrics;
  readonly mode: "deep" | "fast" | "research";
  readonly permissionScope: readonly string[];
  readonly profile: KnowledgeSpaceRetrievalProfile;
}): void {
  const unexpectedDegradation = (metrics.degradationFlags ?? []).filter(
    (flag) => !QueryImageDegradationReasonSchema.safeParse(flag).success,
  );
  if (items.length > profile.topK || unexpectedDegradation.length > 0) {
    throw new RetrievalTestUnavailableError(
      "Production retrieval did not satisfy the active profile without degradation",
    );
  }
  if (profile.scoreThreshold.enabled && metrics.scoreThresholdFilteredCandidates === undefined) {
    throw new RetrievalTestUnavailableError(
      "Production retrieval did not report the configured score-threshold stage",
    );
  }
  const threshold = profile.scoreThreshold.enabled ? profile.scoreThreshold.value : undefined;
  if (
    items.some((item) => !Number.isFinite(item.score)) ||
    (threshold !== undefined && items.some((item) => item.score < threshold))
  ) {
    throw new RetrievalTestUnavailableError(
      "Production retrieval returned an invalid mode-final candidate score",
    );
  }
  if (
    items.some((item) => !candidatePermissionScopeAllows(item.permissionScope, permissionScope))
  ) {
    throw new RetrievalTestUnavailableError(
      "Production retrieval returned a candidate outside the server-issued permission scope",
    );
  }

  if (mode === "research") {
    if (
      metrics.researchStrategyVersion !== "research-evidence-v3" ||
      metrics.ftsCandidates === undefined ||
      metrics.fusedCandidates === undefined ||
      metrics.rerankCandidates === undefined ||
      metrics.rerankMs === undefined ||
      metrics.pageIndexScoreVersion !== undefined
    ) {
      throw new RetrievalTestUnavailableError(
        "Research retrieval did not satisfy the Evidence V3 recall, fusion, and rerank contract",
      );
    }
    return;
  }

  if (
    metrics.pageIndexMatchedNodes !== undefined ||
    metrics.pageIndexScoreVersion !== undefined ||
    (profile.rerank.enabled &&
      (metrics.rerankCandidates === undefined || metrics.rerankMs === undefined)) ||
    (!profile.rerank.enabled && metrics.rerankCandidates !== undefined)
  ) {
    throw new RetrievalTestUnavailableError(
      "Ordinary hybrid retrieval did not satisfy its configured final rerank contract",
    );
  }
  if (mode === "deep" && metrics.graphExpansionCandidates === undefined) {
    throw new RetrievalTestUnavailableError(
      "Deep retrieval did not report its Graph expansion stage",
    );
  }
  if (mode === "fast" && metrics.graphExpansionCandidates !== undefined) {
    throw new RetrievalTestUnavailableError("Fast retrieval unexpectedly used Graph expansion");
  }
}

function sameRetrievalTestPlan(
  actual: RetrievalPlan,
  expected: RetrievalPlan,
  mode: "deep" | "fast" | "research",
): boolean {
  return (
    actual.denseTopK === expected.denseTopK &&
    actual.ftsTopK === expected.ftsTopK &&
    actual.fusionLimit === expected.fusionLimit &&
    actual.queryLanguage === expected.queryLanguage &&
    actual.requestedMode === mode &&
    actual.rerankCandidateLimit === expected.rerankCandidateLimit &&
    actual.resolvedMode === mode &&
    actual.strategyVersion === expected.strategyVersion &&
    actual.topK === expected.topK
  );
}

function safeRetrievalTestItem(
  item: Awaited<ReturnType<BasicHybridRetriever["retrieve"]>>["items"][number],
  includeText: boolean,
): RetrievalTestResult["items"][number] {
  const text = typeof item.metadata.text === "string" ? item.metadata.text : "";
  return {
    citation: {
      artifactHash: boundedString(item.citation.artifactHash, 128),
      documentAssetId: boundedString(item.citation.documentAssetId, 512),
      documentVersion: item.citation.documentVersion,
      ...(item.citation.endOffset === undefined ? {} : { endOffset: item.citation.endOffset }),
      ...(item.citation.pageNumber === undefined ? {} : { pageNumber: item.citation.pageNumber }),
      sectionPath: item.citation.sectionPath
        .slice(0, 64)
        .map((segment) => boundedString(segment, 512)),
      ...(item.citation.startOffset === undefined
        ? {}
        : { startOffset: item.citation.startOffset }),
    },
    nodeId: boundedString(item.nodeId, 512),
    projectionIds: item.projectionIds.slice(0, 128).map((id) => boundedString(id, 512)),
    score: item.score,
    sources: [...new Set(item.sources)].slice(0, 4),
    ...(includeText ? { text: boundedUnicodeString(text, 8_192) } : {}),
  };
}

function boundedUnicodeString(value: string, maxCharacters: number): string {
  return Array.from(value).slice(0, maxCharacters).join("");
}

function cloneRetrievalTestMetrics(metrics: HybridRetrievalMetrics): HybridRetrievalMetrics {
  return {
    ...metrics,
    ...(metrics.degradationFlags
      ? {
          degradationFlags: metrics.degradationFlags
            .slice(0, 32)
            .map((flag) => boundedString(flag, 256)),
        }
      : {}),
  };
}

function boundedString(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}
