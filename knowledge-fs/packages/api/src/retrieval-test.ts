import {
  type AuthSubject,
  type KnowledgeSpaceEmbeddingProfile,
  type KnowledgeSpaceModelSelection,
  type KnowledgeSpaceRetrievalProfile,
  validateKnowledgeSpaceRetrievalProfileForMode,
} from "@knowledge/core";
import type { EmbeddingProvider } from "@knowledge/embeddings";

import { candidatePermissionScopeAllows } from "./candidate-content-authorization";
import {
  type KnowledgeSpaceEmbeddingResolver,
  assertEmbeddingModelMatchesProfile,
  assertObservedEmbeddingDimension,
} from "./knowledge-space-embedding-resolver";
import { ModelCapabilitySnapshotSchema } from "./model-capability-preflight";
import type { PublishedProjectionReadSnapshot } from "./published-projection-read-snapshot";
import type { RetrievalSource } from "./retrieval-candidates";
import { createRetrievalPlanner } from "./retrieval-planner";
import type {
  BasicHybridRetriever,
  HybridRetrievalMetrics,
  RetrievalPlan,
} from "./retrieval-types";

const retrievalTestPlanner = createRetrievalPlanner({ maxTopK: 100 });

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
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly knowledgeSpaceId: string;
  readonly mode: "deep" | "fast" | "research";
  readonly permissionScope: readonly string[];
  readonly projectionSnapshot: PublishedProjectionReadSnapshot;
  readonly query: string;
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

  if (input.mode !== "research" && input.retrievalProfile.rerank.enabled) {
    const rerankSelection = input.retrievalProfile.rerank.model;
    if (!rerankSelection) {
      throw new RetrievalTestUnavailableError(
        "The active retrieval profile is missing its rerank model",
      );
    }
    assertCapabilityMatchesSelection({
      capability: input.retrievalCapabilitySnapshot.rerank,
      expectedKind: "rerank",
      selection: rerankSelection,
    });
  }

  if (input.mode === "research") {
    return;
  }
  if (!input.embeddingProfile || !input.embeddingCapabilitySnapshot) {
    throw new RetrievalTestUnavailableError(
      "Fast and Deep retrieval tests require a verified embedding profile",
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
        const plan = retrievalTestPlanner.plan({
          mode: input.mode,
          query: input.query,
          topK: input.retrievalProfile.topK,
          traceId: input.traceId,
        });
        const embeddingStartedAt = Date.now();
        const queryVector =
          input.mode === "research"
            ? ([0] as const)
            : await resolveRetrievalTestEmbedding({
                embeddingModel,
                embeddingProfile: input.embeddingProfile,
                embeddingResolver,
                embeddings,
                knowledgeSpaceId: input.knowledgeSpaceId,
                query: input.query,
                signal: input.signal,
                tenantId: input.subject.tenantId,
              });
        const embeddingMs = Math.max(0, Date.now() - embeddingStartedAt);
        const retrieval = await retriever.retrieve({
          ...(input.mode !== "research" && input.embeddingProfile
            ? { denseProjectionModel: input.embeddingProfile.vectorSpaceId }
            : {}),
          knowledgeSpaceId: input.knowledgeSpaceId,
          limit: input.retrievalProfile.topK,
          mode: input.mode,
          permissionScope: input.permissionScope,
          projectionSnapshot: input.projectionSnapshot,
          query: input.query,
          queryVector,
          retrievalProfile: input.retrievalProfile,
          tenantId: input.subject.tenantId,
          topK: input.retrievalProfile.topK,
          traceId: input.traceId,
        });
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
        assertRetrievalTestModeEvidence({
          items: retrieval.items,
          metrics: retrieval.metrics,
          mode: input.mode,
          permissionScope: input.permissionScope,
          profile: input.retrievalProfile,
        });
        return {
          items: retrieval.items.map(safeRetrievalTestItem),
          metrics: cloneRetrievalTestMetrics(retrieval.metrics),
          plan: {
            ...retrieval.plan,
            requestedMode: input.mode,
            resolvedMode: input.mode,
          },
          stages: retrievalTestStages({
            embeddingMs,
            metrics: retrieval.metrics,
            mode: input.mode,
            profile: input.retrievalProfile,
            resultCount: retrieval.items.length,
          }),
        };
      } catch (error) {
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
  if (!embeddingProfile) {
    throw new RetrievalTestUnavailableError(
      "Fast and Deep retrieval tests require an active embedding profile",
    );
  }
  const resolved = embeddingResolver
    ? await embeddingResolver.resolve({
        profile: embeddingProfile,
        knowledgeSpaceId,
        tenantId,
      })
    : null;
  const provider = resolved?.providerInstance ?? embeddings;
  const model = resolved?.model ?? embeddingModel;
  if (!provider || !model?.trim()) {
    throw new RetrievalTestUnavailableError("Embedding capability is unavailable");
  }
  const response = await provider.embed({
    inputType: "search_query",
    model,
    ...(signal ? { signal } : {}),
    tenantId,
    texts: [query],
  });
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
  const ordinary = mode !== "research";
  const research = mode === "research";
  const deep = mode === "deep";
  const rerank = ordinary && profile.rerank.enabled;
  return [
    stage("embedding", ordinary, undefined, embeddingMs),
    stage("dense", ordinary, metrics.denseCandidates, metrics.denseMs),
    stage("fts", ordinary, metrics.ftsCandidates, metrics.ftsMs),
    stage("fusion", ordinary, metrics.fusedCandidates, metrics.fusionMs),
    stage("summary", research, metrics.summaryCandidates),
    stage("outline", research, metrics.documentOutlineMatchedItems),
    stage(
      "pageindex",
      research,
      metrics.pageIndexMatchedNodes ?? metrics.documentOutlineMatchedItems ?? 0,
    ),
    stage("graph", deep, metrics.graphExpansionCandidates ?? 0, metrics.graphExpansionMs),
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
  if (items.length > profile.topK || (metrics.degradationFlags?.length ?? 0) > 0) {
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
      metrics.denseCandidates !== 0 ||
      metrics.ftsCandidates !== 0 ||
      metrics.pageIndexMatchedNodes === undefined ||
      !metrics.pageIndexScoreVersion ||
      metrics.graphExpansionCandidates !== undefined ||
      metrics.rerankCandidates !== undefined
    ) {
      throw new RetrievalTestUnavailableError(
        "Research retrieval did not use the independent Summary/Outline/PageIndex path",
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
): RetrievalTestResult["items"][number] {
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
  };
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
