import type { ComputeRuntime } from "@knowledge/compute";
import type { PlatformAdapter } from "@knowledge/core";
import type { EmbeddingProvider } from "@knowledge/embeddings";
import type { ParserAdapter } from "@knowledge/parsers";

import type {
  AgentWorkspaceReplayService,
  AgentWorkspaceSnapshotRepository,
} from "./agent-workspace-snapshot";
import type { AnswerTraceRepository } from "./answer-trace-repository";
import type { ArtifactSegmentRepository } from "./artifact-segment-repository";
import type { AuthVerifier } from "./auth";
import type { AutoRetrievalModeResolver } from "./auto-retrieval-mode-resolver";
import type { BulkOperationRepository } from "./bulk-operation";
import type { DeletionLifecycleFenceGuard } from "./deletion-lifecycle-fence";
import type { DeletionObjectWriteAdmission } from "./deletion-object-write-admission";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type {
  DocumentChunkRepository,
  DocumentChunkStateService,
} from "./document-chunk-repository";
import type { DocumentCompilationJobStateMachine } from "./document-compilation-job";
import type { DocumentImageVariantGenerator } from "./document-image-variant-generator";
import type { DocumentMultimodalManifestEnhancer } from "./document-multimodal-manifest-enhancer";
import type { DocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import type { DocumentOutlineRepository } from "./document-outline-repository";
import type { DocumentOutlineSummaryEnhancer } from "./document-outline-summary-enhancer";
import type { DocumentPdfRasterizer } from "./document-pdf-rasterizer";
import type { DocumentProcessingTaskRepository } from "./document-processing-task-repository";
import type { DocumentSettingsRepository } from "./document-settings-repository";
import type { DurableDeletionRepository } from "./durable-deletion-repository";
import type { DurableDeletionService } from "./durable-deletion-service";
import type { EntityExtractionProvider } from "./entity-extraction-flow";
import type { FailedQueryRepository } from "./failed-query-repository";
import type { GatewayComponentHealthOptions } from "./gateway-health";
import type { QueryGenerator } from "./gateway-sse-responses";
import type { GoldenQuestionRepository } from "./golden-question-repository";
import type { GraphIndexRepository } from "./graph-index-repository";
import type { VisualEmbeddingProvider } from "./index-projection-builders";
import type { IndexProjectionRepository } from "./index-projection-repository";
import type { KnowledgeFsLeaseRepository } from "./knowledge-fs-lease-repository";
import type { KnowledgeFsOperationLeaseCoordinator } from "./knowledge-fs-operation-leases";
import type { KnowledgeFsSessionRepository } from "./knowledge-fs-session-repository";
import type { SemanticDiffProvider } from "./knowledge-fs-types";
import type { KnowledgeNodeRepository } from "./knowledge-node-repository";
import type { KnowledgePathRepository } from "./knowledge-path-repository";
import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import type { KnowledgeSpaceEmbeddingResolver } from "./knowledge-space-embedding-resolver";
import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import type { KnowledgeSpaceOverviewRepository } from "./knowledge-space-overview";
import type { KnowledgeSpaceProfileMigrationRepository } from "./knowledge-space-profile-migration";
import type { KnowledgeSpaceProfileMigrationService } from "./knowledge-space-profile-migration-service";
import type { KnowledgeSpaceProfilePublicationRepository } from "./knowledge-space-profile-publication-repository";
import type {
  KnowledgeSpaceProfileRepository,
  KnowledgeSpaceUnpublishedProfileActivationRepository,
} from "./knowledge-space-profile-repository";
import type { KnowledgeSpaceProvisioningRepository } from "./knowledge-space-provisioning-repository";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import type { LegacySpacePublicationBootstrapRepository } from "./legacy-space-publication-bootstrap";
import type { LegacySpacePublicationBootstrapService } from "./legacy-space-publication-bootstrap-runtime";
import type {
  DocumentRevisionRollbackCoordinator,
  DocumentSettingsChangeCoordinator,
} from "./logical-document-handlers";
import type { LogicalDocumentRepository } from "./logical-document-repository";
import type {
  ModelCapabilityCatalog,
  ModelCapabilityPreflight,
} from "./model-capability-preflight";
import type { OnlineDocumentConnector } from "./online-document-connector";
import type { OnlineDriveConnector } from "./online-drive-connector";
import type { PageIndexUpgradeBackfillRepository } from "./page-index-upgrade-backfill";
import type { PageIndexUpgradeBackfillService } from "./page-index-upgrade-backfill-runtime";
import type { ParseArtifactRepository } from "./parse-artifact-repository";
import type { ProjectionSetPublicationMemberRepository } from "./projection-publication-member-repository";
import type { ProjectionSetPublicationRepository } from "./projection-publication-repository";
import type { PublishedGraphIndexRepository } from "./published-graph-index-repository";
import type { PublishedKnowledgeSpaceRuntimeSnapshotResolver } from "./published-knowledge-space-runtime-snapshot";
import type { QualityControlRepository, QualityReplayRuntime } from "./quality-control";
import type { RateLimiter } from "./rate-limit";
import type { RelationExtractionProvider } from "./relation-extraction-flow";
import type { RelevanceTriageSignals } from "./relevance-triage";
import type { ResearchTaskDeletionVisibility } from "./research-task-deletion-visibility";
import type {
  ResearchTaskJobStateMachine,
  ResearchTaskPartialResultRepository,
} from "./research-task-job";
import type { ResearchTaskDryRunPlanner } from "./research-task-planning";
import type { ResearchTaskProgressRepository } from "./research-task-progress";
import type { RetentionPolicyRepository } from "./retention-policy";
import type { RetrievalExecutionLeaseCoordinator } from "./retrieval-execution-lease";
import type { RetrievalTestExecutor } from "./retrieval-test";
import type { SemanticCommunitySummaryProvider } from "./semantic-community-materializer";
import type { SessionContextRepository } from "./session-context-repository";
import type { SourceConnectionService } from "./source-connection";
import type { SourceCredentialService } from "./source-credential-service";
import type { SourceCredentialTester } from "./source-credential-tester";
import type { SourceLogicalRevisionPublisher } from "./source-logical-revision-publisher";
import type { SourceProductWorkflowRepository } from "./source-product-workflow";
import type {
  SourceBulkRemovalRequester,
  SourceProductWorkflowRuntime,
} from "./source-product-workflow-runtime";
import type { SourceProviderCatalog } from "./source-provider-catalog";
import type { SourceRepository } from "./source-repository";
import type { SourceSyncPolicyRuntime } from "./source-sync-policy-runtime";
import type { SourceSyncScheduler } from "./source-sync-scheduler";
import type { StagedCommitRepository } from "./staged-commit-repository";
import type { StorageQuotaRepository } from "./storage-quota";
import type { TidbFtsPostingReadinessGate } from "./tidb-fts-posting-backfill";
import type { TidbFtsPostingBackfillService } from "./tidb-fts-posting-backfill-runtime";
import type { TraceRecorder } from "./tracing";
import type { WebsiteCrawlConnector } from "./website-crawl-connector";

export interface KnowledgeGatewayOptions {
  adapter: PlatformAdapter;
  /**
   * Explicitly enables the development-only local node query fallback when no query generator is
   * injected. Disabled by default because the fallback does not implement the production retrieval
   * planner or document-level permission filtering.
   */
  allowLocalQueryFallback?: boolean;
  /**
   * Explicit non-production compatibility switch for legacy/test spaces that have no published
   * retrieval profile. Disabled by default and rejected in production.
   */
  allowLegacyResearchTaskProfileFallback?: boolean;
  answerTraces?: AnswerTraceRepository;
  /** Resolves the public `auto` request mode with the space-selected reasoning model. */
  autoRetrievalModeResolver?: AutoRetrievalModeResolver;
  agentWorkspaceReplay?: AgentWorkspaceReplayService;
  agentWorkspaceSnapshots?: AgentWorkspaceSnapshotRepository;
  artifactSegments?: ArtifactSegmentRepository;
  auth?: AuthVerifier;
  bulkOperations?: BulkOperationRepository;
  componentHealth?: GatewayComponentHealthOptions;
  compute?: ComputeRuntime;
  denseEmbeddingModel?: string;
  denseEmbeddingProvider?: EmbeddingProvider;
  deletionLifecycleFence?: DeletionLifecycleFenceGuard;
  deletionObjectWriteAdmission?: DeletionObjectWriteAdmission;
  documentAssets?: DocumentAssetRepository;
  durableDeletions?: DurableDeletionService;
  /** Builds the deletion service with this gateway's exact access service and authorization guard. */
  durableDeletionRepository?: DurableDeletionRepository;
  documentCompilationJobs?: DocumentCompilationJobStateMachine;
  documentChunks?: DocumentChunkRepository;
  documentChunkState?: DocumentChunkStateService;
  documentProcessingTasks?: DocumentProcessingTaskRepository;
  documentSettings?: DocumentSettingsRepository;
  documentRevisionRollbacks?: DocumentRevisionRollbackCoordinator;
  documentSettingsChanges?: DocumentSettingsChangeCoordinator;
  documentMultimodalManifestEnhancer?: DocumentMultimodalManifestEnhancer;
  documentMultimodalManifests?: DocumentMultimodalManifestRepository;
  documentMultimodalImageVariantGenerator?: DocumentImageVariantGenerator;
  documentMultimodalMaxExtractedAssets?: number;
  documentMultimodalLocalAssetAllowlist?: readonly string[];
  documentMultimodalMaxLocalAssetBytes?: number;
  documentMultimodalMaxPdfRasterizedAssets?: number;
  documentPdfRasterizer?: DocumentPdfRasterizer;
  documentOutlineSummaryEnhancer?: DocumentOutlineSummaryEnhancer;
  documentOutlines?: DocumentOutlineRepository;
  logicalDocuments?: LogicalDocumentRepository;
  generateArtifactSegmentId?: () => string;
  generateBulkUploadId?: () => string;
  generateAgentWorkspaceSnapshotId?: () => string;
  generateDocumentAssetId?: () => string;
  generateKnowledgeFsGcDryRunId?: () => string;
  generateKnowledgeSpaceManifestId?: () => string;
  generateKnowledgeSpaceProvisioningKey?: () => string;
  /** Server-owned durable query/AnswerTrace identity; never derived from x-trace-id. */
  generateQueryRunId?: () => string;
  generateResearchTaskJobId?: () => string;
  embeddingProvider?: EmbeddingProvider;
  embeddingResolver?: KnowledgeSpaceEmbeddingResolver;
  failedQueries?: FailedQueryRepository;
  failedQueryLowConfidenceScoreFloor?: number;
  goldenQuestions?: GoldenQuestionRepository;
  graphIndex?: GraphIndexRepository;
  knowledgeNodes?: KnowledgeNodeRepository;
  knowledgePaths?: KnowledgePathRepository;
  knowledgeFsLeases?: KnowledgeFsLeaseRepository;
  knowledgeFsSessions?: KnowledgeFsSessionRepository;
  knowledgeSpaceManifests?: KnowledgeSpaceManifestRepository;
  knowledgeSpaceOverview?: KnowledgeSpaceOverviewRepository;
  knowledgeSpaceProfiles?: KnowledgeSpaceProfileRepository;
  knowledgeSpaceProvisioning?: KnowledgeSpaceProvisioningRepository;
  knowledgeSpaceUnpublishedProfileActivations?: KnowledgeSpaceUnpublishedProfileActivationRepository;
  knowledgeSpaceProfileMigrationRepository?: KnowledgeSpaceProfileMigrationRepository;
  knowledgeSpaceProfileMigrations?: KnowledgeSpaceProfileMigrationService;
  knowledgeSpaceProfilePublications?: KnowledgeSpaceProfilePublicationRepository;
  knowledgeSpaceAccess?: KnowledgeSpaceAccessService;
  knowledgeSpaces?: KnowledgeSpaceRepository;
  legacySpacePublicationBootstraps?: LegacySpacePublicationBootstrapRepository;
  legacySpacePublicationBootstrapService?: LegacySpacePublicationBootstrapService;
  maxBulkDeleteDocuments?: number;
  maxBulkOperations?: number;
  maxCascadeDeleteArtifacts?: number;
  maxCascadeDeleteNodes?: number;
  maxCascadeDeleteProjections?: number;
  maxBulkReindexDocuments?: number;
  maxBulkUploadBytes?: number;
  maxBulkUploadFiles?: number;
  maxKnowledgeFsTreeDepth?: number;
  maxLocalQueryAnswerChars?: number;
  maxLocalQueryNodes?: number;
  maxResearchTaskJobs?: number;
  maxSynchronousUploadNodes?: number;
  maxUploadBytes?: number;
  modelCapabilityCatalog?: ModelCapabilityCatalog;
  modelCapabilityPreflight?: ModelCapabilityPreflight;
  now?: () => string;
  onlineDocumentConnector?: OnlineDocumentConnector;
  onlineDriveConnector?: OnlineDriveConnector;
  operationLeases?: KnowledgeFsOperationLeaseCoordinator;
  pageIndexUpgradeBackfills?: PageIndexUpgradeBackfillRepository;
  pageIndexUpgradeBackfillService?: PageIndexUpgradeBackfillService;
  parseArtifacts?: ParseArtifactRepository;
  parser?: ParserAdapter;
  projections?: IndexProjectionRepository;
  projectionSetPublicationMembers?: ProjectionSetPublicationMemberRepository;
  projectionSetPublications?: ProjectionSetPublicationRepository;
  publishedGraph?: PublishedGraphIndexRepository;
  runtimeSnapshotResolver?: PublishedKnowledgeSpaceRuntimeSnapshotResolver;
  queryGenerator?: QueryGenerator;
  qualityControl?: {
    readonly onRuntime?: ((runtime: QualityReplayRuntime) => void) | undefined;
    readonly repository: QualityControlRepository;
    readonly workerId: string;
    readonly workerIntervalMs?: number | undefined;
  };
  rateLimiter?: RateLimiter;
  relevanceTriageSignals?: RelevanceTriageSignals;
  researchTaskPlanner?: ResearchTaskDryRunPlanner;
  researchTaskDeletionVisibility?: ResearchTaskDeletionVisibility;
  researchTaskPartials?: ResearchTaskPartialResultRepository;
  researchTaskProgress?: ResearchTaskProgressRepository;
  researchTasks?: ResearchTaskJobStateMachine;
  retentionPolicies?: RetentionPolicyRepository;
  retrievalExecutionLeases?: RetrievalExecutionLeaseCoordinator;
  retrievalTestExecutor?: RetrievalTestExecutor;
  semanticDiffProvider?: SemanticDiffProvider;
  semanticEntityExtractionMaxEntitiesPerNode?: number;
  semanticEntityExtractionMaxNodesPerRun?: number;
  semanticEntityExtractionModel?: string;
  semanticEntityExtractionProvider?: EntityExtractionProvider;
  semanticRelationExtractionMaxRelationsPerNode?: number;
  semanticRelationExtractionModel?: string;
  semanticRelationExtractionProvider?: RelationExtractionProvider;
  semanticCommunitySummaryModel?: string;
  semanticCommunitySummaryProvider?: SemanticCommunitySummaryProvider;
  sessions?: SessionContextRepository;
  sourceCredentialTester?: SourceCredentialTester;
  sourceCredentials?: SourceCredentialService;
  sourceProduct?: {
    readonly bulkRemoval: SourceBulkRemovalRequester;
    readonly connections: SourceConnectionService;
    readonly logicalRevisions: SourceLogicalRevisionPublisher;
    readonly onSyncPolicyRuntime?: (runtime: SourceSyncPolicyRuntime) => void;
    readonly onWorkflowRuntime?: (runtime: SourceProductWorkflowRuntime) => void;
    readonly providers: SourceProviderCatalog;
    readonly repository: SourceProductWorkflowRepository;
    readonly workerId: string;
  };
  /**
   * Enables the background scheduled-sync scheduler for sources with a `metadata.syncPolicy`.
   * The gateway builds the sync runner from its wired connectors + materializer, starts the
   * scheduler, and passes it to `onScheduler` (observability / tests / manual stop).
   */
  sourceSync?: {
    readonly intervalMs: number;
    readonly maxSourcesPerTick: number;
    readonly onScheduler?: (scheduler: SourceSyncScheduler) => void;
  };
  sources?: SourceRepository;
  stagedCommits?: StagedCommitRepository;
  storageQuotas?: StorageQuotaRepository;
  tidbFtsPostingBackfillService?: TidbFtsPostingBackfillService;
  tidbFtsPostingReadiness?: TidbFtsPostingReadinessGate;
  traces?: TraceRecorder;
  visualEmbeddingModel?: string;
  visualEmbeddingProvider?: VisualEmbeddingProvider;
  websiteCrawlConnector?: WebsiteCrawlConnector;
}
