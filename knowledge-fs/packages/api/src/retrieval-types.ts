import type { KnowledgeSpaceRetrievalProfile } from "@knowledge/core";
import type { PublishedProjectionReadSnapshot } from "./published-projection-read-snapshot";
import type { SearchDenseInput } from "./retrieval-candidates";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import type { RetrievalQueryLanguage } from "./retrieval-text-utils";

export interface HybridRetrievalResult {
  readonly items: HybridRetrievalItem[];
  readonly metrics?: HybridRetrievalMetrics | undefined;
  readonly plan?: RetrievalPlan | undefined;
}

export interface HybridRetrievalMetrics {
  readonly degradationFlags?: readonly string[] | undefined;
  readonly denseCandidates: number;
  readonly denseMs: number;
  readonly documentOutlineMatchedItems?: number | undefined;
  readonly ftsCandidates: number;
  readonly ftsMs: number;
  readonly fusedCandidates: number;
  readonly fusionMs: number;
  readonly metadataFilteredCandidates?: number | undefined;
  readonly multimodalCandidates?: number | undefined;
  readonly pageIndexMatchedNodes?: number | undefined;
  readonly pageIndexCandidateTruncated?: boolean | undefined;
  readonly pageIndexOpenedRanges?: number | undefined;
  readonly pageIndexScannedNodes?: number | undefined;
  readonly pageIndexScannedOutlines?: number | undefined;
  readonly pageIndexScoreVersion?: string | undefined;
  readonly permissionFilteredCandidates?: number | undefined;
  readonly rerankCandidates?: number | undefined;
  readonly rerankMs?: number | undefined;
  readonly scoreThresholdFilteredCandidates?: number | undefined;
  readonly reasoningTreeSearchNodes?: number | undefined;
  readonly graphExpansionCandidates?: number | undefined;
  readonly graphExpansionMs?: number | undefined;
  readonly graphExpansionTimedOut?: boolean | undefined;
  readonly graphExpansionRelations?: number | undefined;
  readonly graphExpansionSeeds?: number | undefined;
  readonly graphExpansionTraversedEntities?: number | undefined;
  readonly imageCandidates?: number | undefined;
  readonly projectionFilteredCandidates?: number | undefined;
  readonly summaryCandidates?: number | undefined;
  readonly summarySelectedSections?: number | undefined;
  readonly tableCandidates?: number | undefined;
  readonly totalMs: number;
  readonly visualEmbeddingCandidates?: number | undefined;
}

export type ResolvedRetrievalMode = "deep" | "fast" | "research";
export type RetrievalMode = "auto" | ResolvedRetrievalMode;
export type ProjectionSetReadMode = "evaluation" | "preview" | "published";

export interface RetrievalPlan {
  readonly denseTopK: number;
  readonly ftsTopK: number;
  readonly fusionLimit: number;
  readonly queryLanguage: RetrievalQueryLanguage;
  readonly requestedMode: RetrievalMode;
  readonly rerankCandidateLimit: number;
  readonly resolvedMode: ResolvedRetrievalMode;
  readonly strategyVersion: "retrieval-planner-v1";
  readonly topK: number;
}

export interface RetrieveHybridInput extends SearchDenseInput {
  readonly limit: number;
  /** Retrieval execution accepts only a mode already resolved at the request boundary. */
  readonly mode?: ResolvedRetrievalMode | undefined;
  readonly permissionScope?: readonly string[] | undefined;
  readonly projectionSnapshot?: PublishedProjectionReadSnapshot | undefined;
  readonly projectionSetCandidateFingerprint?: string | undefined;
  readonly projectionSetFingerprint?: string | undefined;
  readonly projectionSetReadMode?: ProjectionSetReadMode | undefined;
  readonly query: string;
  readonly retrievalProfile?: KnowledgeSpaceRetrievalProfile | undefined;
  readonly traceId?: string | undefined;
}

export interface BasicHybridRetriever {
  retrieve(input: RetrieveHybridInput): Promise<HybridRetrievalResult>;
}
