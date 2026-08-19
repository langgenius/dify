import type {
  KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import type { PublishedProjectionReadSnapshot } from "./published-projection-read-snapshot";
import type { ResolvedQueryImage } from "./query-images";
import type { ResearchModelCallObserver } from "./research-model-usage";
import type { AnyResearchRetrievalSearchCheckpoint } from "./research-retrieval-checkpoint";
import type { ResearchRetrievalExecutionPolicy } from "./research-retrieval-policy";
import type { SearchDenseInput } from "./retrieval-candidates";
import type { HybridRetrievalItem } from "./retrieval-fusion";
import type { RetrievalQueryLanguage } from "./retrieval-text-utils";

export interface HybridRetrievalResult {
  readonly items: HybridRetrievalItem[];
  readonly metrics?: HybridRetrievalMetrics | undefined;
  readonly plan?: RetrievalPlan | undefined;
}

export interface ResearchRetrievalRoundCheckpoint {
  readonly result: HybridRetrievalResult;
  readonly round: number;
  readonly terminal: boolean;
}

export interface ResearchRetrievalSearchCheckpointBoundary {
  readonly checkpoint: AnyResearchRetrievalSearchCheckpoint;
  readonly result: HybridRetrievalResult;
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
  readonly pageIndexFallbackDocuments?: number | undefined;
  readonly pageIndexFlattenedLevels?: number | undefined;
  readonly pageIndexLayeredDocuments?: number | undefined;
  readonly pageIndexLayeredSteps?: number | undefined;
  readonly pageIndexOpenedRanges?: number | undefined;
  readonly pageIndexScannedNodes?: number | undefined;
  readonly pageIndexScannedOutlines?: number | undefined;
  readonly pageIndexScoreVersion?: string | undefined;
  readonly pageIndexSelectedDocuments?: number | undefined;
  readonly pageIndexSerializedTreeTokens?: number | undefined;
  readonly pageIndexWholeTreeDocuments?: number | undefined;
  readonly permissionFilteredCandidates?: number | undefined;
  readonly rerankCandidates?: number | undefined;
  readonly rerankMs?: number | undefined;
  readonly scoreThresholdFilteredCandidates?: number | undefined;
  readonly reasoningTreeSearchNodes?: number | undefined;
  readonly researchBudgetExhaustedReasons?: readonly string[] | undefined;
  readonly researchExecutionKind?: "durable" | "interactive" | undefined;
  readonly researchModelCalls?: number | undefined;
  readonly researchOpenedResources?: number | undefined;
  readonly researchRounds?: number | undefined;
  readonly researchRetrievalSteps?: number | undefined;
  readonly researchSufficiencyReached?: boolean | undefined;
  readonly researchSupplementalSearches?: number | undefined;
  readonly researchCandidateLists?: number | undefined;
  readonly researchEvidenceJudgeMs?: number | undefined;
  readonly researchOutlineLexicalCandidates?: number | undefined;
  readonly researchPlanMs?: number | undefined;
  readonly researchRrfCandidates?: number | undefined;
  readonly researchStrategyVersion?: "research-evidence-v3" | undefined;
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
  readonly strategyVersion: "retrieval-planner-v1" | "retrieval-planner-v2";
  readonly topK: number;
}

export interface RetrieveHybridInput extends SearchDenseInput {
  /** Frozen embedding identity used for Research supplemental-query embeddings. */
  readonly embeddingProfile?: KnowledgeSpaceEmbeddingProfile | undefined;
  readonly limit: number;
  /** Retrieval execution accepts only a mode already resolved at the request boundary. */
  readonly mode?: ResolvedRetrievalMode | undefined;
  readonly permissionScope?: readonly string[] | undefined;
  readonly projectionSnapshot?: PublishedProjectionReadSnapshot | undefined;
  readonly projectionSetCandidateFingerprint?: string | undefined;
  readonly projectionSetFingerprint?: string | undefined;
  readonly projectionSetReadMode?: ProjectionSetReadMode | undefined;
  readonly query: string;
  readonly queryImages?: readonly ResolvedQueryImage[] | undefined;
  /** Original request mode, retained only for low-cardinality operational aggregation. */
  readonly requestedMode?: RetrievalMode | undefined;
  /** Internal execution envelope. Public interactive requests omit it and use the safe default. */
  readonly researchExecutionPolicy?: ResearchRetrievalExecutionPolicy | undefined;
  /** Internal Research V3 routing decision; false suppresses the graph leg for direct queries. */
  readonly researchGraphEnabled?: boolean | undefined;
  readonly researchModelCallObserver?: ResearchModelCallObserver | undefined;
  /**
   * Durable Research progress boundary. V3 calls this after planning and after initial recall so
   * the task timeline measures the work that is actually running instead of inferring stages from
   * completed trace spans.
   */
  readonly onResearchStageChange?:
    | ((stage: "retrieving" | "analyzing", details?: Record<string, unknown>) => Promise<void>)
    | undefined;
  /** Durable-only replay boundary. Implementations call it after each safely opened evidence round. */
  readonly onResearchRound?:
    | ((checkpoint: ResearchRetrievalRoundCheckpoint) => Promise<void>)
    | undefined;
  /** Durable replay-safe writer for navigation frontiers and evidence queue progress. */
  readonly onResearchSearchCheckpoint?:
    | ((checkpoint: ResearchRetrievalSearchCheckpointBoundary) => Promise<void>)
    | undefined;
  /** Durable search state restored after a failed execution attempt. */
  readonly researchSearchCheckpoint?: AnyResearchRetrievalSearchCheckpoint | undefined;
  /** Evidence items paired with `researchSearchCheckpoint` at the same durable boundary. */
  readonly researchSearchCheckpointResult?: HybridRetrievalResult | undefined;
  readonly retrievalProfile?: KnowledgeSpaceRetrievalProfile | undefined;
  readonly traceId?: string | undefined;
}

export interface BasicHybridRetriever {
  retrieve(input: RetrieveHybridInput): Promise<HybridRetrievalResult>;
}
