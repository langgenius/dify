import { randomUUID } from "node:crypto";

export * from "./a2a-adapter";
export * from "./agent-workspace-snapshot";
export * from "./agent-workspace-snapshot-handlers";
export * from "./agent-workspace-snapshot-routes";
export * from "./agent-workspace-snapshot-schemas";
export * from "./answer-trace-access";
export * from "./answer-trace-handlers";
export * from "./answer-trace-idempotency";
export * from "./answer-trace-repository";
export * from "./answer-trace-routes";
export * from "./answer-trace-recorder";
export * from "./api-shared-utils";
export * from "./artifact-segment-repository";
export * from "./auth";
export * from "./auto-retrieval-mode-resolver";
export * from "./backpressure-automation";
export * from "./bulk-operation";
export * from "./bulk-operation-summary";
export * from "./capability-grant-admission-middleware";
export * from "./capability-grant-provenance";
export * from "./capability-grant-provenance-database-repository";
export * from "./capability-revocation-handlers";
export * from "./capability-revocation-routes";
import {
  type AgentWorkspaceReplayService,
  type AgentWorkspaceSnapshotRepository,
  createAgentWorkspaceReplayService,
  createInMemoryAgentWorkspaceSnapshotRepository,
} from "./agent-workspace-snapshot";
import { registerAgentWorkspaceSnapshotHandlers } from "./agent-workspace-snapshot-handlers";
import { registerAnswerTraceHandlers } from "./answer-trace-handlers";
import { createAnswerTraceRecorder } from "./answer-trace-recorder";
import {
  type AnswerTraceRepository,
  createInMemoryAnswerTraceRepository,
} from "./answer-trace-repository";
import { deterministicChildId } from "./api-shared-utils";
import { createInMemoryArtifactSegmentRepository } from "./artifact-segment-repository";
import { type AuthVerifier, createAuthMiddleware, createStaticAuthVerifier } from "./auth";
import { createInMemoryBulkOperationRepository } from "./bulk-operation";
import { createCapabilityGrantAdmissionMiddleware } from "./capability-grant-admission-middleware";
import { registerCapabilityRevocationHandlers } from "./capability-revocation-handlers";
import { createDifyCapabilityV2GatewayMiddleware } from "./dify-capability-v2";
import { registerDifyIntegrationActivationHandlers } from "./dify-integration-activation-handlers";
import { createDifyIntegrationFreezeMiddleware } from "./dify-integration-freeze";
import { registerDifyIntegrationFreezeHandlers } from "./dify-integration-freeze-handlers";
import { createDifyIntegrationStateMiddleware } from "./dify-integration-state";
import { registerGoldenQuestionHandlers } from "./golden-question-handlers";
import {
  type GoldenQuestionRepository,
  createInMemoryGoldenQuestionRepository,
} from "./golden-question-repository";
export * from "./conflict-detection";
export * from "./contextual-enrichment-flow";
export * from "./core-resource-response-schemas";
export * from "./cursor-utils";
export * from "./dify-capability-v2";
export * from "./dify-integration-activation-handlers";
export * from "./dify-integration-activation-routes";
export * from "./dify-integration-freeze";
export * from "./dify-integration-freeze-database-repository";
export * from "./dify-integration-freeze-handlers";
export * from "./dify-integration-freeze-routes";
export * from "./dify-integration-state";
export * from "./dify-integration-state-database-repository";
export * from "./integrated-knowledge-space-deletion-handlers";
export * from "./integrated-knowledge-space-deletion-routes";
export * from "./integrated-knowledge-space-provisioning-handlers";
export * from "./integrated-knowledge-space-provisioning-routes";
export * from "./database-row-utils";
export * from "./database-sql-utils";
export * from "./document-compilation-handlers";
export * from "./document-compilation-attempt-job";
export * from "./document-compilation-attempt-repository";
export * from "./document-compilation-profile-snapshot";
export * from "./document-compilation-candidate-validator";
export * from "./document-compilation-candidate-runtime";
export * from "./document-compilation-initial-profile-coordinator";
export * from "./document-compilation-job";
export * from "./document-compilation-outbox-dispatcher";
export * from "./document-compilation-publication-coordinator";
export * from "./document-compilation-publication-processor";
export * from "./document-compilation-pipeline";
export * from "./document-compilation-routes";
export * from "./document-chunk-repository";
export * from "./document-logical-mutation-runtime";
export * from "./document-processing-task-repository";
export * from "./document-settings-repository";
export * from "./document-compilation-runtime";
export * from "./document-compilation-worker";
export * from "./document-asset-repository";
export * from "./document-asset-embedding-profile-guard";
export * from "./durable-deletion-repository";
export * from "./document-image-variant-generator";
export * from "./document-multimodal-enrichment-providers";
export * from "./document-multimodal-candidate-resolver";
export * from "./document-multimodal-evaluation";
export * from "./document-multimodal-manifest-enhancer";
export * from "./document-multimodal-manifest-builder";
export * from "./document-multimodal-manifest-repository";
export * from "./document-pdf-rasterizer";
export * from "./document-outline-builder";
export * from "./document-outline-evaluation";
export * from "./document-outline-repository";
export * from "./document-offsets";
export * from "./document-outline-summary-enhancer";
export * from "./document-knowledge-paths";
export * from "./document-read-handlers";
export * from "./document-read-routes";
export * from "./document-request-schemas";
export * from "./document-response-schemas";
export * from "./document-upload-utils";
export * from "./logical-document-handlers";
export * from "./logical-document-repository";
export * from "./logical-document-routes";
export * from "./logical-document-schemas";
export * from "./source-logical-document-version-adapter";
export * from "./source-durable-deletion-bulk-removal";
export * from "./database-deletion-lifecycle-fence-reader";
export * from "./database-deletion-object-write-admission";
export * from "./database-durable-deletion-target-capabilities";
export * from "./deletion-lifecycle-fence";
export * from "./direct-stream-cors";
export * from "./deletion-object-write-admission";
export * from "./deletion-object-write-storage";
export * from "./deletion-residue-cleanup";
export * from "./durable-deletion-handlers";
export * from "./durable-deletion-outbox-dispatcher";
export * from "./durable-deletion-fingerprinter";
export * from "./durable-deletion-publication-gc";
export * from "./durable-deletion-request-schemas";
export * from "./durable-deletion-response-schemas";
export * from "./durable-deletion-routes";
export * from "./durable-deletion-runtime";
export * from "./durable-deletion-service";
export * from "./durable-deletion-target-processors";
export * from "./upload-session";
export * from "./upload-session-completion-publisher";
export * from "./upload-session-database-repository";
export * from "./upload-session-handlers";
export * from "./upload-session-routes";
export * from "./profile-aware-query-generator";
export * from "./model-capability-handlers";
export * from "./model-capability-preflight";
export * from "./model-capability-routes";
export * from "./knowledge-space-creation";
export * from "./knowledge-space-profile-backfill";
export * from "./knowledge-space-profile-backfill-runtime";
export * from "./knowledge-space-profile-memory-repository";
export * from "./knowledge-space-profile-repository";
export * from "./knowledge-space-profile-publication-repository";
export * from "./knowledge-space-provisioning-repository";
export * from "./knowledge-space-profile-aware-manifest-repository";
export * from "./knowledge-space-profile-audit-handlers";
export * from "./knowledge-space-profile-audit-routes";
export * from "./knowledge-space-profile-audit-schemas";
export * from "./knowledge-space-profile-migration";
export * from "./knowledge-space-profile-migration-candidate-builder";
export * from "./knowledge-space-profile-migration-database-repository";
export * from "./knowledge-space-profile-migration-handlers";
export * from "./knowledge-space-profile-migration-routes";
export * from "./knowledge-space-profile-migration-runtime";
export * from "./knowledge-space-profile-migration-schemas";
export * from "./knowledge-space-profile-migration-service";
export * from "./vector-index-capability";
export * from "./document-write-handlers";
export * from "./document-write-routes";
export * from "./embedding-model-registry";
export * from "./embedding-model-upgrade-workflow";
export * from "./entity-extraction-flow";
export * from "./evidence-bundle-assembler";
export * from "./evidence-bundle-database-repository";
export * from "./evidence-bundle-visibility";
export * from "./extraction-quality-control-flow";
export * from "./extraction-types";
export * from "./failed-query-clustering";
export * from "./failed-query-handlers";
export * from "./failed-query-recorder";
export * from "./failed-query-repository";
export * from "./failed-query-routes";
export * from "./final-rerank-retrieval";
export * from "./freshness-checking";
export * from "./gateway-app";
export * from "./gateway-defaults";
export * from "./gateway-error-handlers";
export * from "./gateway-health";
export * from "./gateway-openapi-contracts";
export * from "./gateway-openapi-document";
export * from "./gateway-options";
export * from "./gateway-route-schemas";
export * from "./gateway-sse-responses";
export * from "./generation-immutability";
export * from "./gateway-system-handlers";
export * from "./gateway-system-routes";
export * from "./graph-index-repository";
export * from "./graph-index-writer";
export * from "./published-graph-index-repository";
export * from "./graph-handlers";
export * from "./graph-routes";
export * from "./graph-traversal-responses";
export * from "./golden-question-annotation";
export * from "./golden-question-handlers";
export * from "./golden-question-repository";
export * from "./golden-question-routes";
export * from "./knowledge-space-access-control";
export * from "./knowledge-space-access-handlers";
export * from "./knowledge-space-access-routes";
export * from "./knowledge-space-api-key-authentication";
export * from "./knowledge-space-authorization";
export * from "./knowledge-space-authorization-middleware";
export * from "./http-tracing";
export * from "./hybrid-retrieval";
export * from "./hybrid-query-generator";
export * from "./index-projection-builders";
export * from "./index-projection-repository";
export * from "./index-reindexer";
export * from "./job-payload-utils";
export * from "./json-utils";
export * from "./llm-answer-query-generator";
export * from "./llm-community-summary-provider";
export * from "./llm-entity-extraction-provider";
export * from "./llm-multimodal-answer-provider";
export * from "./llm-relation-extraction-provider";
export * from "./knowledge-fs-errors";
export * from "./knowledge-fs-handlers";
export * from "./knowledge-fs-command-registry";
export * from "./knowledge-fs-fsck";
export * from "./knowledge-fs-gc";
export * from "./knowledge-fs-request-schemas";
export * from "./knowledge-fs-response-schemas";
export * from "./knowledge-fs-routes";
export * from "./knowledge-fs-lease-repository";
export * from "./knowledge-fs-operation-leases";
export * from "./knowledge-fs-session-repository";
export * from "./knowledge-fs-runtime-cleanup-worker";
export * from "./knowledge-fs-types";
export * from "./knowledge-fs-path-utils";
export * from "./knowledge-mcp-types";
export * from "./knowledge-mcp-server";
export * from "./knowledge-node-repository";
export * from "./knowledge-path-resolution-cache";
export * from "./knowledge-path-repository";
export * from "./knowledge-space-golden-question-schemas";
export * from "./knowledge-space-embedding-resolver";
export * from "./knowledge-space-handlers";
export * from "./knowledge-space-manifest-repository";
export * from "./knowledge-space-outline-summary-enhancer";
export * from "./knowledge-space-overview";
export * from "./knowledge-space-overview-database-repository";
export * from "./knowledge-space-overview-handlers";
export * from "./knowledge-space-overview-routes";
export * from "./knowledge-space-overview-schemas";
export * from "./knowledge-space-quota-admission";
export * from "./knowledge-space-quota-usage";
export * from "./knowledge-space-repository";
export * from "./knowledge-space-routes";
export * from "./legacy-space-publication-bootstrap";
export * from "./legacy-space-publication-bootstrap-handlers";
export * from "./legacy-space-publication-bootstrap-routes";
export * from "./legacy-space-publication-bootstrap-runtime";
export * from "./local-node-query-generator";
export * from "./multimodal-evidence";
export * from "./online-document-connector";
export * from "./online-drive-connector";
export * from "./openapi-handler-utils";
export * from "./operation-policy-handlers";
export * from "./operation-policy-response-schemas";
export * from "./operation-policy-routes";
export * from "./operational-metrics";
export * from "./parse-artifact-repository";
export * from "./page-index-scoring";
export * from "./page-index-build-repository";
export * from "./page-index-upgrade-backfill";
export * from "./page-index-upgrade-backfill-runtime";
export * from "./page-index-upgrade-backfill-handlers";
export * from "./page-index-upgrade-backfill-routes";
export * from "./projection-publication-gc";
export * from "./projection-publication-member-repository";
export * from "./projection-publication-repository";
export * from "./projection-publication-workflow";
export * from "./published-page-index-repository";
export * from "./published-page-index-retrieval";
export * from "./published-projection-read-snapshot";
export * from "./published-knowledge-space-runtime-snapshot";
export * from "./query-handlers";
export * from "./query-virtual-entries";
export * from "./query-routes";
export * from "./quality-control";
export * from "./quality-control-database-repository";
export * from "./quality-control-handlers";
export * from "./quality-control-routes";
export * from "./rate-limit";
export * from "./resource-mount-repository";
export * from "./retention-policy";
export * from "./research-task-handlers";
export * from "./research-task-durable-repository";
export * from "./research-task-deletion-cleanup";
export * from "./research-task-deletion-visibility";
export * from "./research-task-job";
export * from "./research-task-outbox-dispatcher";
export * from "./research-task-partial-result-database-repository";
export * from "./research-task-progress";
export * from "./research-task-progress-database-repository";
export * from "./research-task-planning";
export * from "./research-task-request-schemas";
export * from "./research-task-response-schemas";
export * from "./retrieval-test";
export * from "./retrieval-test-handlers";
export * from "./retrieval-test-routes";
export * from "./research-task-routes";
export * from "./research-task-runtime";
export * from "./research-task-runtime-snapshot";
export * from "./research-workflow";
export * from "./relation-extraction-flow";
export * from "./relevance-triage";
export * from "./retrieval-cache";
export * from "./retrieval-evidence";
export * from "./retrieval-evaluation-reports";
export * from "./retrieval-evaluation-runners";
export * from "./retrieval-evaluation-utils";
export * from "./retrieval-execution-lease";
export * from "./retrieval-filter-utils";
export * from "./retrieval-fusion";
export * from "./retrieval-paths";
export * from "./retrieval-planner";
export * from "./retrieval-rerank";
export * from "./retrieval-text-utils";
export * from "./retrieval-types";
export * from "./route-classification";
export * from "./safe-shell";
export * from "./semantic-community-materializer";
export * from "./semantic-ingestion-postprocessor";
export * from "./semantic-operator-actions";
export * from "./semantic-operator-handlers";
export * from "./semantic-operator-routes";
export * from "./semantic-operator-schemas";
export * from "./retrieval-candidates";
export * from "./session-context-repository";
export * from "./source-cas-update";
export * from "./source-comparison";
export * from "./source-crawl-sync";
export * from "./source-credential-backfill";
export * from "./source-credential-backfill-runtime";
export * from "./source-credential-service";
export * from "./source-credential-tester";
export * from "./source-fs-command-registry";
export * from "./source-document-materializer";
export * from "./source-document-stale-write-scrubber";
export * from "./source-fs-types";
export * from "./source-handlers";
export * from "./source-operation-error";
export * from "./source-connection";
export * from "./source-connection-database-repository";
export * from "./source-connection-secret-cleanup-runtime";
export * from "./source-logical-revision-publisher";
export * from "./source-product-handlers";
export * from "./source-product-routes";
export * from "./source-product-workflow";
export * from "./source-product-workflow-database-repository";
export * from "./source-product-workflow-memory-repository";
export * from "./source-product-workflow-runtime";
export * from "./source-provider-catalog";
export * from "./source-sync-policy-runtime";
export * from "./source-repository";
export * from "./source-retired-secret-cleanup";
export * from "./source-retired-secret-cleanup-runtime";
export * from "./source-request-schemas";
export * from "./source-routes";
export * from "./source-secret-store";
export * from "./source-sync-policy";
export * from "./source-sync-runner";
export * from "./source-sync-scheduler";
export * from "./sse-events";
export * from "./staged-commit-repository";
export * from "./storage-path-utils";
export * from "./storage-quota";
export * from "./summary-tree";
export * from "./tidb-fts-posting-backfill";
export * from "./tidb-fts-posting-backfill-handlers";
export * from "./tidb-fts-posting-backfill-routes";
export * from "./tidb-fts-posting-backfill-runtime";
export * from "./tidb-fts-postings";
export * from "./topic-view-materializer";
export * from "./trace-async";
export * from "./tracing";
export * from "./tracing-exporters";
export * from "./website-crawl-connector";
import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  indexProjectionInsertPlaceholder,
  jsonInsertPlaceholder,
  qualifiedDatabaseIdentifier,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { createDirectStreamCorsMiddleware } from "./direct-stream-cors";
import { createEmbeddingProfileFreezingDocumentAssetRepository } from "./document-asset-embedding-profile-guard";
import {
  type DocumentAssetRepository,
  createInMemoryDocumentAssetRepository,
} from "./document-asset-repository";
import { registerDocumentCompilationHandlers } from "./document-compilation-handlers";
import { createDocumentMultimodalManifestBuilder } from "./document-multimodal-manifest-builder";
import { createCachedDocumentMultimodalManifestEnhancer } from "./document-multimodal-manifest-enhancer";
import { createInMemoryDocumentMultimodalManifestRepository } from "./document-multimodal-manifest-repository";
import { createDocumentOutlineBuilder } from "./document-outline-builder";
import { createInMemoryDocumentOutlineRepository } from "./document-outline-repository";
import { registerDocumentReadHandlers } from "./document-read-handlers";
import {
  DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_BYTES,
  DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_FILES,
  DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES,
  HARD_BULK_DOCUMENT_UPLOAD_MAX_BYTES,
  HARD_BULK_DOCUMENT_UPLOAD_MAX_FILES,
  HARD_DOCUMENT_UPLOAD_MAX_BYTES,
} from "./document-upload-utils";
import { registerDocumentWriteHandlers } from "./document-write-handlers";
import { registerDurableDeletionHandlers } from "./durable-deletion-handlers";
import { createDurableDeletionService } from "./durable-deletion-service";
import { createEntityExtractionFlow } from "./entity-extraction-flow";
import {
  type AnswerabilityEvaluator,
  type EvidenceBundleAssembler,
  createAnswerabilityEvaluator,
  createEvidenceBundleAssembler,
} from "./evidence-bundle-assembler";
import { createExtractionQualityControlFlow } from "./extraction-quality-control-flow";
import { registerFailedQueryHandlers } from "./failed-query-handlers";
import { createFailedQueryRecorder } from "./failed-query-recorder";
import { createInMemoryFailedQueryRepository } from "./failed-query-repository";
import { createKnowledgeGatewayApp } from "./gateway-app";
import { createDefaultComputeRuntime, createDefaultParser } from "./gateway-defaults";
import {
  completeKnowledgeGatewayOpenApiDocument,
  knowledgeGatewayOpenApiDocument,
} from "./gateway-openapi-document";
import type { KnowledgeGatewayOptions } from "./gateway-options";
import { registerGatewaySystemHandlers } from "./gateway-system-handlers";
import { registerGraphHandlers } from "./graph-handlers";
import {
  type GraphEntity,
  type GraphIndexRepository,
  type GraphRelation,
  cloneGraphRelation,
  createInMemoryGraphIndexRepository,
} from "./graph-index-repository";
import { createGraphIndexWriter } from "./graph-index-writer";
import { createTraceMiddleware } from "./http-tracing";
import {
  createDenseVectorProjectionBuilder,
  createFtsProjectionBuilder,
  createVisualEmbeddingProjectionBuilder,
} from "./index-projection-builders";
import {
  type IndexProjectionRepository,
  createInMemoryIndexProjectionRepository,
} from "./index-projection-repository";
import { createIncrementalReindexer } from "./index-reindexer";
import { registerIntegratedKnowledgeSpaceDeletionHandlers } from "./integrated-knowledge-space-deletion-handlers";
import { registerIntegratedKnowledgeSpaceProvisioningHandlers } from "./integrated-knowledge-space-provisioning-handlers";
import { cloneJsonObject, jsonArrayColumn, jsonObjectColumn } from "./json-utils";
import { createKnowledgeFsCommandRegistry } from "./knowledge-fs-command-registry";
import { registerKnowledgeFsHandlers } from "./knowledge-fs-handlers";
import { createInMemoryKnowledgeFsLeaseRepository } from "./knowledge-fs-lease-repository";
import { createInMemoryKnowledgeFsSessionRepository } from "./knowledge-fs-session-repository";
import type { SemanticDiffProvider } from "./knowledge-fs-types";
import {
  type DeleteKnowledgeNodesByDocumentAssetInput,
  type DeleteKnowledgeNodesResult,
  type GetManyKnowledgeNodesInput,
  type KnowledgeNodeCursor,
  type KnowledgeNodeLookupInput,
  type KnowledgeNodeRepository,
  type ListKnowledgeNodesByArtifactInput,
  type ListKnowledgeNodesResult,
  type UpdateKnowledgeNodeMetadataManyInput,
  type UpdateKnowledgeNodeMetadataPatch,
  compareKnowledgeNodesByArtifactOffset,
  createInMemoryKnowledgeNodeRepository,
  validateKnowledgeNodeBatchIds,
} from "./knowledge-node-repository";
import {
  DuplicateKnowledgePathError,
  type KnowledgePathRepository,
  createInMemoryKnowledgePathRepository,
} from "./knowledge-path-repository";
import {
  type KnowledgePathResolutionCache,
  createKnowledgePathResolutionCache,
} from "./knowledge-path-resolution-cache";
import {
  createInMemoryKnowledgeSpaceAccessRepository,
  createKnowledgeSpaceAccessService,
} from "./knowledge-space-access-control";
import { registerKnowledgeSpaceAccessHandlers } from "./knowledge-space-access-handlers";
import { createKnowledgeSpaceApiKeyAuthenticator } from "./knowledge-space-api-key-authentication";
import { createKnowledgeSpaceAuthorizationGuard } from "./knowledge-space-authorization";
import { createKnowledgeSpaceAuthorizationMiddleware } from "./knowledge-space-authorization-middleware";
import type { KnowledgeSpaceEmbeddingResolver } from "./knowledge-space-embedding-resolver";
import {
  GoldenQuestionParamsSchema,
  KnowledgeSpaceParamsSchema,
} from "./knowledge-space-golden-question-schemas";
import { registerKnowledgeSpaceHandlers } from "./knowledge-space-handlers";
import {
  createInMemoryKnowledgeSpaceManifestRepository,
  ensureKnowledgeSpaceManifest,
} from "./knowledge-space-manifest-repository";
import { createInMemoryKnowledgeSpaceOverviewRepository } from "./knowledge-space-overview";
import { registerKnowledgeSpaceOverviewHandlers } from "./knowledge-space-overview-handlers";
import { registerKnowledgeSpaceProductSummaryHandlers } from "./knowledge-space-product-summary-handlers";
import { registerKnowledgeSpaceProfileAuditHandlers } from "./knowledge-space-profile-audit-handlers";
import { registerKnowledgeSpaceProfileMigrationHandlers } from "./knowledge-space-profile-migration-handlers";
import { createKnowledgeSpaceProfileMigrationService } from "./knowledge-space-profile-migration-service";
import { createKnowledgeSpaceQuotaUsageReader } from "./knowledge-space-quota-usage";
import {
  type KnowledgeSpaceRepository,
  createInMemoryKnowledgeSpaceRepository,
} from "./knowledge-space-repository";
import { registerLegacySpacePublicationBootstrapHandlers } from "./legacy-space-publication-bootstrap-handlers";
import { createLocalNodeQueryGenerator } from "./local-node-query-generator";
import { registerLogicalDocumentHandlers } from "./logical-document-handlers";
import { registerModelCapabilityHandlers } from "./model-capability-handlers";
import { registerOperationPolicyHandlers } from "./operation-policy-handlers";
import { registerPageIndexUpgradeBackfillHandlers } from "./page-index-upgrade-backfill-handlers";
import {
  type ParseArtifactRepository,
  createInMemoryParseArtifactRepository,
} from "./parse-artifact-repository";
import { createPublishedProjectionReadSnapshotResolver } from "./published-projection-read-snapshot";
import { createQualityReplayRuntime } from "./quality-control";
import { registerQualityControlHandlers } from "./quality-control-handlers";
import { registerQueryHandlers } from "./query-handlers";
import { type RateLimiter, createNoopRateLimiter, createRateLimitMiddleware } from "./rate-limit";
import { createRelationExtractionFlow } from "./relation-extraction-flow";
import { createFailedQueryTriageRunner, createRelevanceTriage } from "./relevance-triage";
import { createDatabaseResearchTaskDeletionVisibility } from "./research-task-deletion-visibility";
import { registerResearchTaskHandlers } from "./research-task-handlers";
import {
  type ResearchTaskJobStateMachine,
  type ResearchTaskPartialResultRepository,
  createInMemoryResearchTaskJobRepository,
  createInMemoryResearchTaskPartialResultRepository,
  createResearchTaskJobStateMachine,
} from "./research-task-job";
import {
  type ResearchTaskDryRunPlanner,
  createResearchTaskDryRunPlanner,
} from "./research-task-planning";
import {
  type ResearchTaskProgressRepository,
  createInMemoryResearchTaskProgressRepository,
  createResearchTaskProgressPublisher,
} from "./research-task-progress";
import {
  type RetentionPolicy,
  type RetentionPolicyPatch,
  createInMemoryRetentionPolicyRepository,
} from "./retention-policy";
import {
  type EvidenceBundleCache,
  type EvidenceBundleCacheKeyInput,
  type NormalizeQueryInput,
  type NormalizedQueryResult,
  type QueryNormalizationCache,
  createEvidenceBundleCache,
  createQueryNormalizationCache,
} from "./retrieval-cache";
import { createRetrievalPlanner } from "./retrieval-planner";
import { registerRetrievalTestHandlers } from "./retrieval-test-handlers";
import { type RetrievalQueryLanguage, detectRetrievalQueryLanguage } from "./retrieval-text-utils";
import type {
  BasicHybridRetriever,
  HybridRetrievalMetrics,
  HybridRetrievalResult,
  RetrievalMode,
  RetrievalPlan,
  RetrieveHybridInput,
} from "./retrieval-types";
import { createSafeShell, summarizeWorkspaceReplayOutput } from "./safe-shell";
import { createSemanticCommunityMaterializer } from "./semantic-community-materializer";
import { createSemanticIngestionPostProcessor } from "./semantic-ingestion-postprocessor";
import { createSemanticOperator } from "./semantic-operator-actions";
import { registerSemanticOperatorHandlers } from "./semantic-operator-handlers";
import { createCacheSessionContextRepository } from "./session-context-repository";
import { createSourceDocumentMaterializer } from "./source-document-materializer";
import { createSourceDocumentStaleWriteScrubber } from "./source-document-stale-write-scrubber";
import { registerSourceHandlers } from "./source-handlers";
import { registerSourceProductHandlers } from "./source-product-handlers";
import { createSourceProductWorkflowService } from "./source-product-workflow";
import {
  createObjectStorageSourceWorkflowContentStore,
  createSourceProductWorkflowRuntime,
} from "./source-product-workflow-runtime";
import { createInMemorySourceRepository } from "./source-repository";
import { createSourceSyncPolicyRuntime } from "./source-sync-policy-runtime";
import { createSourceSyncRunner } from "./source-sync-runner";
import { createSourceSyncScheduler } from "./source-sync-scheduler";
import { createInMemoryStagedCommitRepository } from "./staged-commit-repository";
import { type StorageQuotaRepository, createStaticStorageQuotaRepository } from "./storage-quota";
import { registerTidbFtsPostingBackfillHandlers } from "./tidb-fts-posting-backfill-handlers";
import { type TraceRecorder, createNoopTraceRecorder } from "./tracing";
import { registerUploadSessionHandlers } from "./upload-session-handlers";

import type { ComputeRuntime } from "@knowledge/compute";
import {
  type CacheAdapter,
  type DatabaseAdapter,
  type IndexProjection,
  IndexProjectionSchema,
  type JobPayload,
  type KnowledgeNode,
  KnowledgeNodeSchema,
  type KnowledgeSpace,
  type ParseArtifact,
  type PlatformAdapter,
} from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";
import type { MiddlewareHandler } from "hono";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";

export {
  createRetrievalRegressionGate,
  type RetrievalRegressionDeltas,
  type RetrievalRegressionEvaluationInput,
  type RetrievalRegressionGate,
  type RetrievalRegressionMetrics,
  type RetrievalRegressionResult,
  type RetrievalRegressionThresholds,
} from "./retrieval-regression";

export function createDifyCapabilityV2OrLegacyApiKeyMiddleware(
  capabilityV2: MiddlewareHandler<KnowledgeGatewayEnv>,
  legacyApiKey: MiddlewareHandler<KnowledgeGatewayEnv>,
): MiddlewareHandler<KnowledgeGatewayEnv> {
  return async (context, next) => {
    const authorization = context.req.header("authorization")?.trim() ?? "";
    const selected = /^Bearer\s+kfs_/i.test(authorization) ? legacyApiKey : capabilityV2;
    return selected(context, next);
  };
}

export function createKnowledgeGateway({
  adapter,
  allowLegacyPermissionSnapshotAdmission,
  allowLegacyResearchTaskProfileFallback = false,
  allowLocalQueryFallback = false,
  answerTraces,
  autoRetrievalModeResolver,
  agentWorkspaceReplay,
  agentWorkspaceSnapshots,
  artifactSegments,
  auth,
  bulkOperations,
  capabilityGrantProvenance,
  componentHealth,
  compute,
  denseEmbeddingModel,
  denseEmbeddingProvider,
  deletionLifecycleFence,
  deletionObjectWriteAdmission,
  directUploadAllowedOrigins,
  documentAssets,
  durableDeletionRepository,
  durableDeletions,
  difyCapabilityV2Auth,
  difyIntegrationFreezes,
  difyIntegrationStates,
  documentCompilationJobs,
  documentChunks,
  documentChunkState,
  documentProcessingTasks,
  documentRevisionRollbacks,
  documentSettings,
  documentSettingsChanges,
  documentMultimodalManifestEnhancer,
  documentMultimodalManifests,
  documentMultimodalImageVariantGenerator,
  documentMultimodalLocalAssetAllowlist,
  documentMultimodalMaxExtractedAssets,
  documentMultimodalMaxLocalAssetBytes,
  documentMultimodalMaxPdfRasterizedAssets,
  documentPdfRasterizer,
  documentOutlineSummaryEnhancer,
  documentOutlines,
  logicalDocuments,
  failedQueries,
  failedQueryLowConfidenceScoreFloor,
  relevanceTriageSignals,
  generateArtifactSegmentId = randomUUID,
  generateBulkUploadId = randomUUID,
  generateAgentWorkspaceSnapshotId = randomUUID,
  generateDocumentAssetId = randomUUID,
  generateKnowledgeFsGcDryRunId = randomUUID,
  generateKnowledgeSpaceManifestId = randomUUID,
  generateKnowledgeSpaceProvisioningKey = randomUUID,
  generateQueryRunId = randomUUID,
  generateResearchTaskJobId = randomUUID,
  embeddingProvider,
  embeddingResolver,
  goldenQuestions,
  graphIndex,
  knowledgeFsLeases,
  knowledgeFsSessions,
  knowledgeNodes,
  knowledgePaths,
  integratedKnowledgeSpaceProvisioning,
  knowledgeSpaceManifests,
  knowledgeSpaceOverview,
  knowledgeSpaceProfiles,
  knowledgeSpaceProvisioning,
  knowledgeSpaceUnpublishedProfileActivations,
  knowledgeSpaceProfileMigrationRepository,
  knowledgeSpaceProfileMigrations,
  knowledgeSpaceProfilePublications,
  knowledgeSpaceAccess,
  knowledgeSpaces,
  legacySpacePublicationBootstraps,
  legacySpacePublicationBootstrapService,
  legacyAccessMutationsReadOnly = false,
  legacyAuthorizationRemoved = false,
  legacyAuthorizationTrafficMetrics,
  pageIndexUpgradeBackfills,
  pageIndexUpgradeBackfillService,
  maxBulkDeleteDocuments = 100,
  maxBulkOperations = 1_000,
  maxCascadeDeleteArtifacts = 100,
  maxCascadeDeleteNodes = 10_000,
  maxCascadeDeleteProjections = 20_000,
  maxBulkReindexDocuments = 100,
  maxBulkUploadBytes = DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_BYTES,
  maxBulkUploadFiles = DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_FILES,
  maxKnowledgeFsTreeDepth = 8,
  maxLocalQueryAnswerChars = 2_000,
  maxLocalQueryNodes = 1_000,
  maxResearchTaskJobs = 10_000,
  maxSynchronousUploadNodes = 20_000,
  maxUploadBytes = DEFAULT_DOCUMENT_UPLOAD_MAX_BYTES,
  modelCapabilityCatalog,
  modelCapabilityPreflight,
  now = () => new Date().toISOString(),
  onlineDocumentConnector,
  onlineDriveConnector,
  operationLeases,
  parseArtifacts,
  parser,
  projections,
  publishedGraph,
  runtimeSnapshotResolver,
  projectionSetPublications,
  queryGenerator,
  qualityControl,
  rateLimiter = createNoopRateLimiter(),
  readinessChecks,
  researchTaskPlanner,
  researchTaskDeletionVisibility,
  researchTaskDirectStream,
  researchTaskPartials,
  researchTaskProgress,
  researchTasks,
  retentionPolicies,
  retrievalExecutionLeases,
  retrievalTestExecutor,
  semanticDiffProvider,
  semanticEntityExtractionMaxEntitiesPerNode = 50,
  semanticEntityExtractionMaxNodesPerRun = 100,
  semanticEntityExtractionModel = "gpt-4.1-mini",
  semanticEntityExtractionProvider,
  semanticRelationExtractionMaxRelationsPerNode = 50,
  semanticRelationExtractionModel = semanticEntityExtractionModel,
  semanticRelationExtractionProvider,
  semanticCommunitySummaryProvider,
  sessions,
  inlineSourceCredentialsAllowed = true,
  sourceCredentialTester,
  sourceCredentials,
  sourceProduct,
  sourceSync,
  sources,
  stagedCommits,
  storageQuotas,
  tidbFtsPostingBackfillService,
  tidbFtsPostingReadiness,
  traces = createNoopTraceRecorder(),
  uploadSessions,
  visualEmbeddingModel,
  visualEmbeddingProvider,
  websiteCrawlConnector,
}: KnowledgeGatewayOptions) {
  if (allowLocalQueryFallback && process.env.NODE_ENV === "production") {
    throw new Error("Local query fallback is forbidden in production");
  }
  if (allowLegacyResearchTaskProfileFallback && process.env.NODE_ENV === "production") {
    throw new Error("Legacy Research profile fallback is forbidden in production");
  }
  if (!knowledgeSpaceProvisioning && process.env.NODE_ENV === "production") {
    throw new Error("Atomic knowledge-space provisioning is required in production");
  }
  if (sourceProduct && sourceSync) {
    throw new Error(
      "Legacy Source sync scheduler cannot run alongside durable Source product workflows",
    );
  }
  if (auth && difyCapabilityV2Auth) {
    throw new Error("Configure either legacy auth or Dify Capability v2 auth, not both");
  }
  if (difyCapabilityV2Auth && process.env.NODE_ENV === "production" && !capabilityGrantProvenance) {
    throw new Error(
      "Durable Capability grant provenance is required for Capability v2 in production",
    );
  }
  if (difyCapabilityV2Auth && process.env.NODE_ENV === "production" && !difyIntegrationStates) {
    throw new Error("Durable per-Workspace integration activation is required for Capability v2");
  }
  if (difyCapabilityV2Auth && process.env.NODE_ENV === "production" && !difyIntegrationFreezes) {
    throw new Error("Durable per-Workspace integration freeze is required for Capability v2");
  }
  if (
    integratedKnowledgeSpaceProvisioning &&
    (!difyCapabilityV2Auth || !difyIntegrationFreezes || !difyIntegrationStates)
  ) {
    throw new Error(
      "Integrated provisioning requires Capability v2, durable freeze, and per-Workspace activation",
    );
  }
  if (
    legacyAuthorizationRemoved &&
    (!difyCapabilityV2Auth ||
      !difyIntegrationFreezes ||
      !difyIntegrationStates ||
      !legacyAccessMutationsReadOnly)
  ) {
    throw new Error(
      "Legacy authorization removal requires Capability v2, durable freeze/activation, and read-only legacy mutations",
    );
  }
  if (uploadSessions && (!difyCapabilityV2Auth || !capabilityGrantProvenance)) {
    throw new Error("Direct upload sessions require Capability v2 and durable grant provenance");
  }
  if (
    uploadSessions &&
    process.env.NODE_ENV === "production" &&
    !directUploadAllowedOrigins?.length
  ) {
    throw new Error("Direct upload sessions require exact browser CORS origins in production");
  }
  if (researchTaskDirectStream && (!difyCapabilityV2Auth || !capabilityGrantProvenance)) {
    throw new Error("Direct Research streams require Capability v2 and durable grant provenance");
  }

  const app = createKnowledgeGatewayApp();

  const spaces =
    knowledgeSpaces ??
    createInMemoryKnowledgeSpaceRepository({
      maxListLimit: 100,
      maxSpaces: 1_000,
    });
  const manifests =
    knowledgeSpaceManifests ??
    createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 100,
      maxManifests: 1_000,
    });
  const overviewRepository =
    knowledgeSpaceOverview ??
    createInMemoryKnowledgeSpaceOverviewRepository({
      maxEvents: 100_000,
      maxListLimit: 100,
    });
  const segments =
    artifactSegments ??
    createInMemoryArtifactSegmentRepository({
      maxBatchSize: 1_000,
      maxListLimit: 100,
      maxSegments: 1_000_000,
    });
  const stagedCommitRepository =
    stagedCommits ??
    createInMemoryStagedCommitRepository({
      maxCommits: 100_000,
      maxListLimit: 100,
    });
  const unguardedAssets =
    documentAssets ??
    createInMemoryDocumentAssetRepository({
      maxAssets: 10_000,
    });
  // Document asset admission and embedding-profile mutation contend on the same manifestVersion
  // CAS. Whichever wins first establishes the profile seen by every later projection build.
  const assets = createEmbeddingProfileFreezingDocumentAssetRepository({
    assets: unguardedAssets,
    ensureManifest: async ({ knowledgeSpaceId, tenantId }) => {
      const space = await spaces.get({ id: knowledgeSpaceId, tenantId });
      if (!space) {
        return;
      }

      // Legacy spaces intentionally keep their historical raw-model projection key. Create the
      // missing manifest without synthesizing a canonical profile, then freeze that legacy route.
      await ensureKnowledgeSpaceManifest({
        generateId: generateKnowledgeSpaceManifestId,
        manifests,
        now,
        space,
      });
    },
    manifests,
    now,
  });
  const sourceRepository =
    sources ??
    createInMemorySourceRepository({
      maxSources: 10_000,
    });
  const artifacts =
    parseArtifacts ??
    createInMemoryParseArtifactRepository({
      maxArtifacts: 10_000,
    });
  const questions =
    goldenQuestions ??
    createInMemoryGoldenQuestionRepository({
      maxListLimit: 100,
      maxQuestions: 10_000,
    });
  const paths =
    knowledgePaths ??
    createInMemoryKnowledgePathRepository({
      maxListLimit: 100,
      maxPaths: 100_000,
    });
  const nodes =
    knowledgeNodes ??
    createInMemoryKnowledgeNodeRepository({
      maxBatchSize: 1_000,
      maxListLimit: 100,
      maxNodes: 100_000,
    });
  const indexProjections =
    projections ??
    createInMemoryIndexProjectionRepository({
      maxBatchSize: 1_000,
      maxListLimit: 100,
      maxProjections: 200_000,
    });
  const knowledgeFsSessionRepository =
    knowledgeFsSessions ??
    createInMemoryKnowledgeFsSessionRepository({
      maxListLimit: 100,
      maxSessions: 100_000,
    });
  const knowledgeFsLeaseRepository =
    knowledgeFsLeases ??
    createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 100_000,
      maxListLimit: 100,
    });
  const quotaUsageReader = createKnowledgeSpaceQuotaUsageReader({
    artifactSegments: segments,
    assets,
    maxAssetsPerRead: 100,
    maxNodesPerRead: 100,
    maxSegmentsPerArtifact: 100,
    nodes,
    parseArtifacts: artifacts,
    projections: indexProjections,
  });
  const graphRepository =
    graphIndex ??
    createInMemoryGraphIndexRepository({
      maxBatchSize: 1_000,
      maxEntities: 100_000,
      maxRelations: 200_000,
    });
  const answerTraceRepository =
    answerTraces ??
    createInMemoryAnswerTraceRepository({
      maxSteps: 1_000,
      maxTraces: 10_000,
    });
  const answerTraceRecorder = createAnswerTraceRecorder({
    maxSteps: 1_000,
    repository: answerTraceRepository,
  });
  const failedQueryRepository =
    failedQueries ??
    createInMemoryFailedQueryRepository({
      goldenQuestions: questions,
      maxFailedQueries: 100_000,
    });
  const failedQueryRecorder = createFailedQueryRecorder({
    repository: failedQueryRepository,
  });
  const failedQueryTriageRunner = relevanceTriageSignals
    ? createFailedQueryTriageRunner({
        failedQueries: failedQueryRepository,
        triage: createRelevanceTriage({ signals: relevanceTriageSignals }),
      })
    : undefined;
  const sessionRepository =
    sessions ??
    createCacheSessionContextRepository({
      cache: adapter.cache,
    });
  const documentParser = parser ?? createDefaultParser();
  const retentionPolicyRepository =
    retentionPolicies ??
    createInMemoryRetentionPolicyRepository({
      maxPolicies: 10_000,
    });
  const storageQuotaRepository =
    storageQuotas ?? createStaticStorageQuotaRepository({ maxRawDocumentBytes: null });
  const outlineRepository =
    documentOutlines ??
    createInMemoryDocumentOutlineRepository({
      maxOutlines: 10_000,
    });
  const multimodalManifestRepository =
    documentMultimodalManifests ??
    createInMemoryDocumentMultimodalManifestRepository({
      maxManifests: 100_000,
    });
  const outlineBuilder = createDocumentOutlineBuilder({
    maxElements: 20_000,
    maxNodes: 10_000,
    maxSummaryChars: 2_000,
    now,
  });
  const multimodalManifestBuilder = createDocumentMultimodalManifestBuilder();
  const effectiveDocumentMultimodalManifestEnhancer = documentMultimodalManifestEnhancer
    ? createCachedDocumentMultimodalManifestEnhancer({
        enhancer: documentMultimodalManifestEnhancer,
        manifests: multimodalManifestRepository,
      })
    : undefined;
  const computeRuntime = compute ?? createDefaultComputeRuntime();
  const accessService =
    knowledgeSpaceAccess ??
    createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 1_000,
        maxListLimit: 100,
        maxMembersPerSpace: 10_000,
        now,
      }),
    });
  const spaceAuthorization = createKnowledgeSpaceAuthorizationGuard({ access: accessService });
  if (knowledgeSpaceProfileMigrations && knowledgeSpaceProfileMigrationRepository) {
    throw new Error(
      "Configure either knowledgeSpaceProfileMigrations or knowledgeSpaceProfileMigrationRepository, not both",
    );
  }
  const profileMigrationService =
    knowledgeSpaceProfileMigrations ??
    (knowledgeSpaceProfileMigrationRepository && knowledgeSpaceProfiles && projectionSetPublications
      ? createKnowledgeSpaceProfileMigrationService({
          access: accessService,
          authorization: spaceAuthorization,
          ...(deletionLifecycleFence ? { deletionFence: deletionLifecycleFence } : {}),
          now: () => {
            const timestamp = Date.parse(now());
            if (!Number.isFinite(timestamp)) {
              throw new Error("Knowledge gateway now() returned an invalid timestamp");
            }
            return timestamp;
          },
          profiles: knowledgeSpaceProfiles,
          publications: projectionSetPublications,
          repository: knowledgeSpaceProfileMigrationRepository,
        })
      : undefined);
  if (knowledgeSpaceProfileMigrationRepository && !profileMigrationService) {
    throw new Error(
      "Profile migration repository requires profile and projection publication repositories",
    );
  }
  if (durableDeletions && durableDeletionRepository) {
    throw new Error("Configure either durableDeletions or durableDeletionRepository, not both");
  }
  if (durableDeletionRepository && !logicalDocuments) {
    throw new Error("Durable deletion repository requires the logical document repository");
  }
  if (durableDeletions || durableDeletionRepository) {
    if (!deletionLifecycleFence) {
      throw new Error("Durable deletion requires a deletion lifecycle fence");
    }
    if (!deletionObjectWriteAdmission) {
      throw new Error("Durable deletion requires object-write admission");
    }
  }
  const durableDeletionService =
    durableDeletions ??
    (durableDeletionRepository
      ? createDurableDeletionService({
          access: accessService,
          assets,
          authorization: spaceAuthorization,
          logicalDocuments,
          now: () => {
            const timestamp = Date.parse(now());
            if (!Number.isFinite(timestamp)) {
              throw new Error("Knowledge gateway now() returned an invalid timestamp");
            }
            return timestamp;
          },
          repository: durableDeletionRepository,
          sources: sourceRepository,
          spaces,
        })
      : undefined);
  const apiKeyAuthenticator = createKnowledgeSpaceApiKeyAuthenticator({
    access: accessService,
    authorization: spaceAuthorization,
    now,
  });
  const researchTaskPartialResults =
    researchTaskPartials ??
    createInMemoryResearchTaskPartialResultRepository({
      maxListLimit: 100,
      maxResults: 100_000,
    });
  const researchTaskProgressEvents =
    researchTaskProgress ??
    createInMemoryResearchTaskProgressRepository({
      maxEvents: 100_000,
      maxListLimit: 100,
      maxSubscribers: 1_000,
    });
  const researchTaskJobs =
    researchTasks ??
    createResearchTaskJobStateMachine({
      generateId: generateResearchTaskJobId,
      jobs: adapter.jobs,
      progress: createResearchTaskProgressPublisher({ repository: researchTaskProgressEvents }),
      repository: createInMemoryResearchTaskJobRepository({
        ...(capabilityGrantProvenance ? { capabilityGrants: capabilityGrantProvenance } : {}),
        maxJobs: maxResearchTaskJobs,
      }),
    });
  const dryRunResearchPlanner =
    researchTaskPlanner ??
    createResearchTaskDryRunPlanner({
      retrievalPlanner: createRetrievalPlanner({
        maxTopK: 100,
        traces,
      }),
    });
  const workspaceSnapshotRepository =
    agentWorkspaceSnapshots ??
    createInMemoryAgentWorkspaceSnapshotRepository({
      maxCommandLogEntries: 1_000,
      maxEvidenceBundles: 1_000,
      maxMounts: 1_000,
      maxSnapshots: 10_000,
      maxSourceVersions: 10_000,
    });
  const fsCommands = createKnowledgeFsCommandRegistry({
    artifactSegments: segments,
    assets,
    compute: computeRuntime,
    ...(deletionLifecycleFence ? { deletionFence: deletionLifecycleFence } : {}),
    ...(legacySpacePublicationBootstraps
      ? { documentMutationAdmissionGuard: legacySpacePublicationBootstraps }
      : {}),
    documentMutationLeaseNow: now,
    graph: graphRepository,
    ...(effectiveDocumentMultimodalManifestEnhancer
      ? { multimodalManifestEnhancer: effectiveDocumentMultimodalManifestEnhancer }
      : {}),
    nodes,
    ...(deletionObjectWriteAdmission ? { objectWriteAdmission: deletionObjectWriteAdmission } : {}),
    objectStorage: adapter.objectStorage,
    outlines: outlineRepository,
    maxTreeDepth: maxKnowledgeFsTreeDepth,
    parseArtifacts: artifacts,
    paths,
    semanticDiffProvider,
  });
  const semanticEntityExtraction = semanticEntityExtractionProvider
    ? createEntityExtractionFlow({
        maxBatchSize: semanticEntityExtractionMaxNodesPerRun,
        maxEntitiesPerNode: semanticEntityExtractionMaxEntitiesPerNode,
        model: semanticEntityExtractionModel,
        nodes,
        now,
        provider: semanticEntityExtractionProvider,
      })
    : undefined;
  const semanticExtractionQuality = semanticEntityExtraction
    ? createExtractionQualityControlFlow({
        maxBatchSize: semanticEntityExtractionMaxNodesPerRun,
        maxEligibleEntitiesPerNode: semanticEntityExtractionMaxEntitiesPerNode,
        nodes,
        now,
      })
    : undefined;
  const semanticRelationExtraction =
    semanticEntityExtraction && semanticRelationExtractionProvider
      ? createRelationExtractionFlow({
          maxBatchSize: semanticEntityExtractionMaxNodesPerRun,
          maxRelationsPerNode: semanticRelationExtractionMaxRelationsPerNode,
          model: semanticRelationExtractionModel,
          nodes,
          now,
          provider: semanticRelationExtractionProvider,
        })
      : undefined;
  const semanticCommunityMaterializer = createSemanticCommunityMaterializer({
    graph: graphRepository,
    maxCommunitiesPerRun: 20,
    maxEntitiesPerRun: semanticEntityExtractionMaxNodesPerRun,
    maxSourceNodesPerRun: semanticEntityExtractionMaxNodesPerRun,
    nodes,
    now,
    paths,
    ...(semanticCommunitySummaryProvider
      ? { summaryProvider: semanticCommunitySummaryProvider }
      : {}),
  });
  const semanticPostProcessor =
    semanticEntityExtraction && semanticExtractionQuality
      ? createSemanticIngestionPostProcessor({
          communityMaterializer: semanticCommunityMaterializer,
          entityExtraction: semanticEntityExtraction,
          extractionQuality: semanticExtractionQuality,
          graph: graphRepository,
          maxNodesPerArtifact: semanticEntityExtractionMaxNodesPerRun,
          nodes,
          ...(semanticRelationExtraction ? { relationExtraction: semanticRelationExtraction } : {}),
        })
      : undefined;
  const semanticOperator = createSemanticOperator({
    assets,
    ...(semanticEntityExtraction ? { entityExtraction: semanticEntityExtraction } : {}),
    ...(semanticExtractionQuality ? { extractionQuality: semanticExtractionQuality } : {}),
    generatePathId: randomUUID,
    graph: graphRepository,
    maxDocumentsPerRun: 100,
    maxNodesPerRun: semanticEntityExtractionMaxNodesPerRun,
    nodes,
    now,
    paths,
    ...(semanticRelationExtraction ? { relationExtraction: semanticRelationExtraction } : {}),
  });
  const workspaceReplayService =
    agentWorkspaceReplay ??
    createAgentWorkspaceReplayService({
      maxCommands: 1_000,
      maxOutputSummaryBytes: 4_000,
      runner: {
        run: async ({ command, snapshot, traceId }) => {
          const shell = createSafeShell({
            knowledgeSpaceId: snapshot.knowledgeSpaceId,
            registries: { workspace: fsCommands },
            subject: {
              scopes: [...snapshot.permissionSnapshot.scopes],
              subjectId: snapshot.permissionSnapshot.subjectId,
              tenantId: snapshot.permissionSnapshot.tenantId,
            },
            ...(traceId ? { traceId } : {}),
          });
          const result = await shell.execute(command.command);

          return {
            outputSummary: summarizeWorkspaceReplayOutput(result.output),
          };
        },
      },
      snapshots: workspaceSnapshotRepository,
    });

  if (maxUploadBytes < 1 || maxUploadBytes > HARD_DOCUMENT_UPLOAD_MAX_BYTES) {
    throw new Error(
      `Document upload maxUploadBytes must be between 1 and ${HARD_DOCUMENT_UPLOAD_MAX_BYTES}`,
    );
  }

  for (const [name, value] of Object.entries({
    maxBulkDeleteDocuments,
    maxCascadeDeleteArtifacts,
    maxCascadeDeleteNodes,
    maxCascadeDeleteProjections,
  })) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Bulk document delete ${name} must be at least 1`);
    }
  }

  if (!Number.isInteger(maxBulkReindexDocuments) || maxBulkReindexDocuments < 1) {
    throw new Error("Bulk document reindex maxBulkReindexDocuments must be at least 1");
  }

  if (!Number.isInteger(maxBulkOperations) || maxBulkOperations < 1) {
    throw new Error("Bulk operation maxBulkOperations must be at least 1");
  }

  if (maxBulkUploadFiles < 1 || maxBulkUploadFiles > HARD_BULK_DOCUMENT_UPLOAD_MAX_FILES) {
    throw new Error(
      `Bulk document upload maxBulkUploadFiles must be between 1 and ${HARD_BULK_DOCUMENT_UPLOAD_MAX_FILES}`,
    );
  }

  const effectiveMaxBulkUploadBytes = maxBulkUploadBytes;

  if (
    effectiveMaxBulkUploadBytes < 1 ||
    effectiveMaxBulkUploadBytes > HARD_BULK_DOCUMENT_UPLOAD_MAX_BYTES
  ) {
    throw new Error(
      `Bulk document upload maxBulkUploadBytes must be between 1 and ${HARD_BULK_DOCUMENT_UPLOAD_MAX_BYTES}`,
    );
  }

  if (maxKnowledgeFsTreeDepth < 1) {
    throw new Error("KnowledgeFS tree max depth must be at least 1");
  }

  if (!Number.isInteger(maxLocalQueryNodes) || maxLocalQueryNodes < 1) {
    throw new Error("Local node query maxLocalQueryNodes must be at least 1");
  }

  if (!Number.isInteger(maxLocalQueryAnswerChars) || maxLocalQueryAnswerChars < 1) {
    throw new Error("Local node query maxLocalQueryAnswerChars must be at least 1");
  }

  if (!Number.isInteger(maxSynchronousUploadNodes) || maxSynchronousUploadNodes < 1) {
    throw new Error("Synchronous upload maxSynchronousUploadNodes must be at least 1");
  }
  if (embeddingProvider && !denseEmbeddingModel?.trim() && !embeddingResolver) {
    throw new Error(
      "Knowledge gateway denseEmbeddingModel is required when embeddingProvider is configured",
    );
  }

  if (denseEmbeddingProvider && !denseEmbeddingModel?.trim() && !embeddingResolver) {
    throw new Error("Knowledge gateway denseEmbeddingModel is required");
  }

  if (visualEmbeddingProvider && !visualEmbeddingModel?.trim()) {
    throw new Error("Knowledge gateway visualEmbeddingModel is required");
  }

  const bulkOperationRepository =
    bulkOperations ??
    createInMemoryBulkOperationRepository({
      maxItems: Math.max(maxBulkDeleteDocuments, maxBulkReindexDocuments, maxBulkUploadFiles),
      maxOperations: maxBulkOperations,
    });
  // EmbeddingProvider's bounded contract accepts at most 128 texts per request. Keep every
  // projection builder on the same safe batch size so large documents do not fail after node 128.
  const synchronousUploadProjectionBatchSize = Math.min(maxSynchronousUploadNodes, 128);
  const denseProjectionBuilder =
    (denseEmbeddingProvider && denseEmbeddingModel) || embeddingResolver
      ? createDenseVectorProjectionBuilder({
          ...(denseEmbeddingProvider ? { embeddings: denseEmbeddingProvider } : {}),
          ...(embeddingResolver ? { embeddingResolver } : {}),
          maxBatchSize: synchronousUploadProjectionBatchSize,
          projections: indexProjections,
        })
      : undefined;
  const visualProjectionBuilder =
    visualEmbeddingProvider && visualEmbeddingModel
      ? createVisualEmbeddingProjectionBuilder({
          maxBatchSize: synchronousUploadProjectionBatchSize,
          projections: indexProjections,
          provider: visualEmbeddingProvider,
        })
      : undefined;
  const synchronousUploadReindexer = createIncrementalReindexer({
    artifacts,
    compute: computeRuntime,
    ...(denseProjectionBuilder ? { denseBuilder: denseProjectionBuilder } : {}),
    ftsBuilder: createFtsProjectionBuilder({
      maxBatchSize: synchronousUploadProjectionBatchSize,
      projections: indexProjections,
    }),
    maxNodes: maxSynchronousUploadNodes,
    maxProjectionBatchSize: synchronousUploadProjectionBatchSize,
    nodes,
    operationLeases,
    projections: indexProjections,
    ...(visualProjectionBuilder ? { visualBuilder: visualProjectionBuilder } : {}),
  });
  const effectiveQueryGenerator =
    queryGenerator ??
    (allowLocalQueryFallback
      ? createLocalNodeQueryGenerator({
          maxAnswerChars: maxLocalQueryAnswerChars,
          maxNodes: maxLocalQueryNodes,
          nodes,
        })
      : undefined);
  const projectionSnapshotResolver = projectionSetPublications
    ? createPublishedProjectionReadSnapshotResolver({
        publications: projectionSetPublications,
        ...(legacySpacePublicationBootstraps || pageIndexUpgradeBackfills
          ? {
              readiness: [
                ...(legacySpacePublicationBootstraps ? [legacySpacePublicationBootstraps] : []),
                ...(pageIndexUpgradeBackfills ? [pageIndexUpgradeBackfills] : []),
              ],
            }
          : {}),
      })
    : undefined;

  const legacyAuthMiddleware = createAuthMiddleware<KnowledgeGatewayEnv>(
    auth ?? createStaticAuthVerifier({ subjectsByToken: {} }),
    { apiKeys: apiKeyAuthenticator },
  );
  const authMiddleware: MiddlewareHandler<KnowledgeGatewayEnv> = difyCapabilityV2Auth
    ? legacyAuthorizationRemoved
      ? createDifyCapabilityV2GatewayMiddleware(difyCapabilityV2Auth)
      : createDifyCapabilityV2OrLegacyApiKeyMiddleware(
          createDifyCapabilityV2GatewayMiddleware(difyCapabilityV2Auth),
          legacyAuthMiddleware,
        )
    : legacyAuthMiddleware;
  app.use("*", createTraceMiddleware(traces));
  if (researchTaskDirectStream) {
    app.use(
      "/research-tasks/:id/events",
      createDirectStreamCorsMiddleware({
        allowedOrigins: researchTaskDirectStream.allowedOrigins,
      }),
    );
    app.use(
      "/queries",
      createDirectStreamCorsMiddleware({
        allowedHeaders: ["Authorization", "Content-Type"],
        allowedMethods: ["POST"],
        allowedOrigins: researchTaskDirectStream.allowedOrigins,
      }),
    );
  }
  if (uploadSessions && directUploadAllowedOrigins?.length) {
    const uploadCors = createDirectStreamCorsMiddleware({
      allowedHeaders: ["Authorization", "Content-Type"],
      allowedMethods: ["POST"],
      allowedOrigins: directUploadAllowedOrigins,
    });
    app.use("/knowledge-spaces/:id/upload-sessions", uploadCors);
    app.use("/upload-sessions/:id/*", uploadCors);
  }
  app.use("/knowledge-spaces/*", authMiddleware);
  app.use("/internal/knowledge-spaces/*", authMiddleware);
  app.use("/internal/capability-grants/*", authMiddleware);
  app.use("/internal/dify-integration/*", authMiddleware);
  app.use("/queries/*", authMiddleware);
  app.use("/jobs/*", authMiddleware);
  app.use("/research-tasks/*", authMiddleware);
  app.use("/upload-sessions/*", authMiddleware);
  app.use("/agent-workspace-snapshots/*", authMiddleware);
  app.use("/bulk-jobs/*", authMiddleware);
  app.use("/deletion-jobs/*", authMiddleware);
  app.use("/retention-policy", authMiddleware);
  app.use("/source-providers", authMiddleware);
  app.use("/source-oauth/callback", authMiddleware);
  if (difyIntegrationFreezes) {
    app.use(
      "*",
      createDifyIntegrationFreezeMiddleware(
        difyIntegrationFreezes,
        legacyAuthorizationTrafficMetrics,
      ),
    );
  }
  if (difyIntegrationStates) {
    app.use("*", createDifyIntegrationStateMiddleware(difyIntegrationStates));
  }
  if (capabilityGrantProvenance) {
    app.use("*", createCapabilityGrantAdmissionMiddleware(capabilityGrantProvenance));
  }
  app.use(
    "/knowledge-spaces/*",
    createKnowledgeSpaceAuthorizationMiddleware({
      authorization: spaceAuthorization,
      spaces,
    }),
  );
  app.use("/knowledge-spaces/*", createRateLimitMiddleware(rateLimiter));
  app.use("/queries/*", createRateLimitMiddleware(rateLimiter));
  app.use("/jobs/*", createRateLimitMiddleware(rateLimiter));
  app.use("/research-tasks/*", createRateLimitMiddleware(rateLimiter));
  app.use("/upload-sessions/*", createRateLimitMiddleware(rateLimiter));
  app.use("/agent-workspace-snapshots/*", createRateLimitMiddleware(rateLimiter));
  app.use("/bulk-jobs/*", createRateLimitMiddleware(rateLimiter));
  app.use("/deletion-jobs/*", createRateLimitMiddleware(rateLimiter));
  app.use("/retention-policy", createRateLimitMiddleware(rateLimiter));
  app.use("/source-providers", createRateLimitMiddleware(rateLimiter));
  app.use("/source-oauth/callback", createRateLimitMiddleware(rateLimiter));

  registerGatewaySystemHandlers({
    adapter,
    app,
    componentHealth,
    computeRuntime,
    documentParser,
    readinessChecks,
  });

  if (difyIntegrationFreezes && difyCapabilityV2Auth) {
    registerDifyIntegrationFreezeHandlers({ app, repository: difyIntegrationFreezes });
  }
  if (difyIntegrationStates && difyIntegrationFreezes && difyCapabilityV2Auth) {
    registerDifyIntegrationActivationHandlers({
      app,
      freezes: difyIntegrationFreezes,
      repository: difyIntegrationStates,
    });
  }

  if (integratedKnowledgeSpaceProvisioning) {
    registerIntegratedKnowledgeSpaceProvisioningHandlers({
      app,
      provisioning: integratedKnowledgeSpaceProvisioning,
    });
  }
  if (capabilityGrantProvenance && difyCapabilityV2Auth) {
    registerCapabilityRevocationHandlers({ app, grants: capabilityGrantProvenance });
  }
  if (
    capabilityGrantProvenance &&
    difyCapabilityV2Auth &&
    durableDeletionRepository &&
    durableDeletionService
  ) {
    registerIntegratedKnowledgeSpaceDeletionHandlers({
      app,
      durableDeletions: durableDeletionService,
      jobs: durableDeletionRepository,
      spaces,
    });
  }
  if (uploadSessions) {
    registerUploadSessionHandlers({ app, sessions: uploadSessions });
  }

  registerKnowledgeSpaceHandlers({
    access: accessService,
    adapter,
    app,
    artifactSegments: segments,
    authorization: spaceAuthorization,
    assets,
    generateGcDryRunId: generateKnowledgeFsGcDryRunId,
    generateManifestId: generateKnowledgeSpaceManifestId,
    generateProvisioningKey: generateKnowledgeSpaceProvisioningKey,
    knowledgeFsLeases: knowledgeFsLeaseRepository,
    knowledgeFsSessions: knowledgeFsSessionRepository,
    manifests,
    ...(knowledgeSpaceProfiles ? { profiles: knowledgeSpaceProfiles } : {}),
    ...(knowledgeSpaceProvisioning ? { provisioning: knowledgeSpaceProvisioning } : {}),
    ...(knowledgeSpaceUnpublishedProfileActivations
      ? { unpublishedProfileActivations: knowledgeSpaceUnpublishedProfileActivations }
      : {}),
    ...(profileMigrationService ? { profileMigrations: profileMigrationService } : {}),
    ...(knowledgeSpaceProfilePublications
      ? { profilePublicationBindings: knowledgeSpaceProfilePublications }
      : {}),
    ...(projectionSetPublications ? { publishedPublications: projectionSetPublications } : {}),
    ...(modelCapabilityPreflight ? { modelCapabilityPreflight } : {}),
    nodes,
    now,
    operationLeases,
    parseArtifacts: artifacts,
    paths,
    parser: documentParser,
    projections: indexProjections,
    spaces,
    stagedCommits: stagedCommitRepository,
  });
  registerKnowledgeSpaceProductSummaryHandlers({ app, assets, manifests, spaces });

  registerKnowledgeSpaceOverviewHandlers({
    access: accessService,
    app,
    authorization: spaceAuthorization,
    now,
    overview: overviewRepository,
    spaces,
  });

  registerKnowledgeSpaceProfileMigrationHandlers({
    app,
    ...(profileMigrationService ? { service: profileMigrationService } : {}),
  });

  registerDurableDeletionHandlers({
    app,
    maxBulkDeleteDocuments,
    ...(durableDeletionService ? { service: durableDeletionService } : {}),
  });

  if (!legacyAuthorizationRemoved) {
    registerKnowledgeSpaceAccessHandlers({
      access: accessService,
      app,
      authorization: spaceAuthorization,
      legacyMutationsReadOnly: legacyAccessMutationsReadOnly,
      spaces,
    });
  }

  registerModelCapabilityHandlers({
    app,
    ...(modelCapabilityCatalog ? { catalog: modelCapabilityCatalog } : {}),
    ...(modelCapabilityPreflight ? { preflight: modelCapabilityPreflight } : {}),
    spaces,
  });

  registerKnowledgeSpaceProfileAuditHandlers({
    app,
    ...(knowledgeSpaceProfiles ? { profiles: knowledgeSpaceProfiles } : {}),
    spaces,
  });

  registerGoldenQuestionHandlers({
    access: accessService,
    answerTraceRepository,
    app,
    assets,
    authorization: spaceAuthorization,
    nodes,
    now,
    questions,
    spaces,
  });

  let qualityReplayRuntime: ReturnType<typeof createQualityReplayRuntime> | undefined;
  if (qualityControl) {
    if (!retrievalTestExecutor || !runtimeSnapshotResolver) {
      throw new Error(
        "Quality replay requires the production retrieval-test executor and published runtime snapshot resolver",
      );
    }
    qualityReplayRuntime = createQualityReplayRuntime({
      access: accessService,
      answerTraces: answerTraceRepository,
      ...(capabilityGrantProvenance ? { capabilityGrants: capabilityGrantProvenance } : {}),
      executor: retrievalTestExecutor,
      ...(qualityControl.workerIntervalMs ? { intervalMs: qualityControl.workerIntervalMs } : {}),
      now,
      repository: qualityControl.repository,
      runtimeSnapshots: runtimeSnapshotResolver,
      workerId: qualityControl.workerId,
    });
    qualityReplayRuntime.start();
    qualityControl.onRuntime?.(qualityReplayRuntime);
  }

  registerQualityControlHandlers({
    access: accessService,
    answerTraces: answerTraceRepository,
    app,
    assets,
    goldenQuestions: questions,
    nodes,
    ...(qualityControl ? { repository: qualityControl.repository } : {}),
    ...(runtimeSnapshotResolver ? { runtimeSnapshots: runtimeSnapshotResolver } : {}),
    spaces,
  });

  registerDocumentReadHandlers({
    app,
    artifacts,
    assets,
    ...(effectiveDocumentMultimodalManifestEnhancer
      ? { multimodalManifestEnhancer: effectiveDocumentMultimodalManifestEnhancer }
      : {}),
    multimodalManifestBuilder,
    multimodalManifests: multimodalManifestRepository,
    objectStorage: adapter.objectStorage,
    outlines: outlineRepository,
    spaces,
  });

  registerLogicalDocumentHandlers({
    access: accessService,
    app,
    assets,
    authorization: spaceAuthorization,
    ...(documentChunks ? { chunks: documentChunks } : {}),
    ...(documentChunkState ? { chunkState: documentChunkState } : {}),
    ...(documentCompilationJobs ? { compilationJobs: documentCompilationJobs } : {}),
    ...(logicalDocuments ? { logicalDocuments } : {}),
    now,
    ...(documentRevisionRollbacks ? { rollbackCoordinator: documentRevisionRollbacks } : {}),
    ...(documentSettings ? { settings: documentSettings } : {}),
    ...(documentSettingsChanges ? { settingsChangeCoordinator: documentSettingsChanges } : {}),
    spaces,
    ...(documentProcessingTasks ? { tasks: documentProcessingTasks } : {}),
  });

  registerDocumentCompilationHandlers({
    access: accessService,
    app,
    assets,
    authorization: spaceAuthorization,
    documentCompilationJobs,
  });

  registerLegacySpacePublicationBootstrapHandlers({
    app,
    service: legacySpacePublicationBootstrapService,
    spaces,
  });

  registerPageIndexUpgradeBackfillHandlers({
    app,
    service: pageIndexUpgradeBackfillService,
    spaces,
  });

  registerTidbFtsPostingBackfillHandlers({
    app,
    service: tidbFtsPostingBackfillService,
    spaces,
  });

  registerGraphHandlers({
    app,
    ...(projectionSnapshotResolver ? { projectionSnapshotResolver } : {}),
    ...(runtimeSnapshotResolver ? { runtimeSnapshotResolver } : {}),
    ...(publishedGraph ? { publishedGraph } : {}),
    spaces,
  });

  registerAnswerTraceHandlers({
    access: accessService,
    answerTraceRepository,
    app,
    assets,
    authorization: spaceAuthorization,
    nodes,
    spaces,
  });

  registerOperationPolicyHandlers({
    access: accessService,
    app,
    authorization: spaceAuthorization,
    assets,
    bulkOperationRepository,
    documentCompilationJobs,
    ...(deletionLifecycleFence ? { deletionFence: deletionLifecycleFence } : {}),
    retentionPolicyRepository,
    spaces,
  });

  registerQueryHandlers({
    access: accessService,
    answerTraceRecorder,
    app,
    ...(autoRetrievalModeResolver ? { autoRetrievalModeResolver } : {}),
    authorization: spaceAuthorization,
    ...(failedQueryLowConfidenceScoreFloor !== undefined
      ? { failedQueryLowConfidenceScoreFloor }
      : {}),
    failedQueryRecorder,
    generateQueryRunId,
    manifests,
    overview: overviewRepository,
    now: () => Date.parse(now()),
    ...(projectionSnapshotResolver ? { projectionSnapshotResolver } : {}),
    queryGenerator: effectiveQueryGenerator,
    ...(retrievalExecutionLeases ? { retrievalExecutionLeases } : {}),
    ...(runtimeSnapshotResolver ? { runtimeSnapshotResolver } : {}),
    sessionRepository,
    spaces,
    ...(tidbFtsPostingReadiness ? { tidbFtsPostingReadiness } : {}),
  });

  registerRetrievalTestHandlers({
    app,
    ...(retrievalTestExecutor ? { executor: retrievalTestExecutor } : {}),
    ...(retrievalExecutionLeases ? { retrievalExecutionLeases } : {}),
    ...(runtimeSnapshotResolver ? { runtimeSnapshotResolver } : {}),
    spaces,
  });

  registerFailedQueryHandlers({
    access: accessService,
    app,
    assets,
    failedQueries: failedQueryRepository,
    ...(failedQueryTriageRunner ? { failedQueryTriageRunner } : {}),
    now,
    nodes,
    spaces,
  });

  registerAgentWorkspaceSnapshotHandlers({
    access: accessService,
    app,
    assets,
    authorization: spaceAuthorization,
    generateAgentWorkspaceSnapshotId,
    now: () => Date.parse(now()),
    spaces,
    workspaceReplayService,
    workspaceSnapshotRepository,
  });

  registerResearchTaskHandlers({
    access: accessService,
    allowLegacyPermissionSnapshotAdmission:
      allowLegacyPermissionSnapshotAdmission ?? difyCapabilityV2Auth === undefined,
    ...(allowLegacyResearchTaskProfileFallback ? { allowLegacyProfileFallback: true } : {}),
    app,
    assets,
    ...(autoRetrievalModeResolver ? { autoRetrievalModeResolver } : {}),
    authorization: spaceAuthorization,
    ...(capabilityGrantProvenance ? { capabilityGrants: capabilityGrantProvenance } : {}),
    ...(researchTaskDirectStream ? { directStream: researchTaskDirectStream } : {}),
    dryRunResearchPlanner,
    ...(researchTaskDeletionVisibility
      ? { deletionVisibility: researchTaskDeletionVisibility }
      : deletionLifecycleFence
        ? {
            deletionVisibility: createDatabaseResearchTaskDeletionVisibility(adapter.database),
          }
        : {}),
    now: () => Date.parse(now()),
    researchTaskJobs,
    researchTaskPartialResults,
    researchTaskProgressEvents,
    ...(runtimeSnapshotResolver ? { runtimeSnapshotResolver } : {}),
    spaces,
  });

  registerKnowledgeFsHandlers({
    app,
    fsCommands,
    spaces,
  });

  registerSemanticOperatorHandlers({
    app,
    operator: semanticOperator,
    spaces,
  });

  const sourceDocumentStaleWriteScrubber = deletionLifecycleFence
    ? createSourceDocumentStaleWriteScrubber({
        artifactSegments: segments,
        artifacts,
        assets,
        bounds: {
          maxArtifacts: maxCascadeDeleteArtifacts,
          maxGraphGenerations: maxCascadeDeleteArtifacts,
          maxManifests: maxCascadeDeleteArtifacts,
          maxNodes: maxCascadeDeleteNodes,
          maxObjects: maxCascadeDeleteProjections,
          maxOutlines: maxCascadeDeleteArtifacts,
          maxPaths: maxCascadeDeleteNodes,
          maxProjections: maxCascadeDeleteProjections,
          maxSegments: maxCascadeDeleteNodes,
        },
        deletionFence: deletionLifecycleFence,
        graph: graphRepository,
        manifests,
        ...(logicalDocuments ? { logicalDocuments } : {}),
        multimodalManifests: multimodalManifestRepository,
        nodes,
        objectStorage: adapter.objectStorage,
        outlines: outlineRepository,
        paths,
        projections: indexProjections,
      })
    : undefined;

  registerDocumentWriteHandlers({
    access: accessService,
    adapter,
    app,
    artifacts,
    artifactSegments: segments,
    assets,
    authorization: spaceAuthorization,
    bulkOperationRepository,
    documentCompilationJobs,
    ...(deletionLifecycleFence ? { deletionFence: deletionLifecycleFence } : {}),
    ...(legacySpacePublicationBootstraps
      ? { documentMutationAdmissionGuard: legacySpacePublicationBootstraps }
      : {}),
    ...(denseEmbeddingModel ? { denseEmbeddingModel } : {}),
    ...(embeddingResolver ? { embeddingResolver } : {}),
    ...(documentMultimodalLocalAssetAllowlist ? { documentMultimodalLocalAssetAllowlist } : {}),
    ...(documentMultimodalMaxExtractedAssets ? { documentMultimodalMaxExtractedAssets } : {}),
    ...(documentMultimodalImageVariantGenerator ? { documentMultimodalImageVariantGenerator } : {}),
    ...(documentMultimodalMaxLocalAssetBytes ? { documentMultimodalMaxLocalAssetBytes } : {}),
    ...(documentMultimodalMaxPdfRasterizedAssets
      ? { documentMultimodalMaxPdfRasterizedAssets }
      : {}),
    documentMultimodalManifests: multimodalManifestRepository,
    documentParser,
    ...(documentPdfRasterizer ? { documentPdfRasterizer } : {}),
    effectiveMaxBulkUploadBytes,
    generateArtifactSegmentId,
    generateBulkUploadId,
    generateDocumentAssetId,
    generateKnowledgePathId: randomUUID,
    indexProjections,
    knowledgePaths: paths,
    knowledgeSpaceManifests: manifests,
    knowledgeSpaceQuotaUsageReader: quotaUsageReader,
    ...(logicalDocuments ? { logicalDocuments } : {}),
    generateKnowledgeSpaceManifestId,
    maxBulkReindexDocuments,
    maxBulkUploadFiles,
    maxUploadBytes,
    nodes,
    now,
    operationLeases,
    ...(deletionObjectWriteAdmission ? { objectWriteAdmission: deletionObjectWriteAdmission } : {}),
    outlineBuilder,
    ...(documentOutlineSummaryEnhancer
      ? { outlineSummaryEnhancer: documentOutlineSummaryEnhancer }
      : {}),
    outlines: outlineRepository,
    ...(semanticPostProcessor ? { semanticPostProcessor } : {}),
    ...(sourceDocumentStaleWriteScrubber
      ? { staleWriteScrubber: sourceDocumentStaleWriteScrubber }
      : {}),
    spaces,
    stagedCommits: stagedCommitRepository,
    storageQuotaRepository,
    synchronousUploadReindexer,
    ...(embeddingProvider && denseEmbeddingModel
      ? { synchronousUploadDenseModel: denseEmbeddingModel }
      : {}),
    traces,
    ...(visualEmbeddingModel ? { visualEmbeddingModel } : {}),
  });

  const sourceDocumentMaterializer = createSourceDocumentMaterializer({
    artifacts,
    artifactSegments: segments,
    assets,
    ...(deletionLifecycleFence ? { deletionFence: deletionLifecycleFence } : {}),
    ...(legacySpacePublicationBootstraps
      ? { documentMutationAdmissionGuard: legacySpacePublicationBootstraps }
      : {}),
    denseEmbeddingModel,
    embeddingResolver,
    documentMultimodalImageVariantGenerator,
    documentMultimodalLocalAssetAllowlist,
    documentMultimodalMaxExtractedAssets,
    documentMultimodalMaxLocalAssetBytes,
    documentMultimodalMaxPdfRasterizedAssets,
    documentMultimodalManifests: multimodalManifestRepository,
    documentParser,
    documentPdfRasterizer,
    generateArtifactSegmentId,
    generateDocumentAssetId,
    generateKnowledgePathId: randomUUID,
    knowledgePaths: paths,
    now,
    objectStorage: adapter.objectStorage,
    ...(deletionObjectWriteAdmission ? { objectWriteAdmission: deletionObjectWriteAdmission } : {}),
    outlineBuilder,
    outlineSummaryEnhancer: documentOutlineSummaryEnhancer,
    outlines: outlineRepository,
    semanticPostProcessor,
    synchronousUploadDenseModel:
      embeddingProvider && denseEmbeddingModel ? denseEmbeddingModel : undefined,
    synchronousUploadReindexer,
    ...(sourceDocumentStaleWriteScrubber
      ? { staleWriteScrubber: sourceDocumentStaleWriteScrubber }
      : {}),
    traces,
    visualEmbeddingModel,
  });
  let sourceProductWorkflows: ReturnType<typeof createSourceProductWorkflowService> | undefined;
  if (sourceProduct) {
    if (!deletionLifecycleFence) {
      throw new Error("Source product workflows require the deletion lifecycle fence");
    }
    if (!logicalDocuments) {
      throw new Error("Source product workflows require durable logical documents");
    }
    if (sourceSync) {
      throw new Error("Legacy source sync scheduler cannot run with durable source workflows");
    }
    sourceProductWorkflows = createSourceProductWorkflowService({
      access: accessService,
      authorization: spaceAuthorization,
      repository: sourceProduct.repository,
      sources: sourceRepository,
    });
    const sourceWorkflowRuntime = createSourceProductWorkflowRuntime({
      access: accessService,
      ...(capabilityGrantProvenance ? { capabilityGrants: capabilityGrantProvenance } : {}),
      bulkRemoval: sourceProduct.bulkRemoval,
      contentStore: createObjectStorageSourceWorkflowContentStore({
        storage: adapter.objectStorage,
      }),
      deletionFence: deletionLifecycleFence,
      logicalInventory: logicalDocuments,
      logicalRevisions: sourceProduct.logicalRevisions,
      materializer: sourceDocumentMaterializer,
      ...(onlineDocumentConnector ? { onlineDocuments: onlineDocumentConnector } : {}),
      ...(onlineDriveConnector ? { onlineDrive: onlineDriveConnector } : {}),
      repository: sourceProduct.repository,
      sourceConnections: sourceProduct.connections,
      sourceProviders: sourceProduct.providers,
      ...(sourceCredentials ? { sourceCredentials } : {}),
      sources: sourceRepository,
      ...(websiteCrawlConnector ? { websiteCrawl: websiteCrawlConnector } : {}),
      workerId: sourceProduct.workerId,
    });
    const sourceSyncPolicyRuntime = createSourceSyncPolicyRuntime({
      repository: sourceProduct.repository,
    });
    sourceWorkflowRuntime.start();
    sourceSyncPolicyRuntime.start();
    sourceProduct.onWorkflowRuntime?.(sourceWorkflowRuntime);
    sourceProduct.onSyncPolicyRuntime?.(sourceSyncPolicyRuntime);
    registerSourceProductHandlers({
      app,
      authorization: spaceAuthorization,
      connections: sourceProduct.connections,
      providers: sourceProduct.providers,
      repository: sourceProduct.repository,
      workflows: sourceProductWorkflows,
    });
  }
  registerSourceHandlers({
    app,
    inlineSourceCredentialsAllowed,
    ...(onlineDocumentConnector ? { onlineDocumentConnector } : {}),
    ...(onlineDriveConnector ? { onlineDriveConnector } : {}),
    ...(sourceCredentialTester ? { sourceCredentialTester } : {}),
    ...(sourceCredentials ? { sourceCredentials } : {}),
    ...(sourceProduct ? { sourceConnections: sourceProduct.connections } : {}),
    legacyMutationEndpointsEnabled: sourceProduct === undefined,
    sourceDocumentMaterializer,
    sources: sourceRepository,
    spaces,
    ...(websiteCrawlConnector ? { websiteCrawlConnector } : {}),
  });

  if (sourceSync) {
    const sourceSyncScheduler = createSourceSyncScheduler({
      intervalMs: sourceSync.intervalMs,
      maxSourcesPerTick: sourceSync.maxSourcesPerTick,
      runner: createSourceSyncRunner({
        ...(onlineDocumentConnector ? { onlineDocumentConnector } : {}),
        ...(onlineDriveConnector ? { onlineDriveConnector } : {}),
        ...(sourceCredentials ? { sourceCredentials } : {}),
        sourceDocumentMaterializer,
        sources: sourceRepository,
        ...(websiteCrawlConnector ? { websiteCrawlConnector } : {}),
      }),
      sources: sourceRepository,
    });
    sourceSyncScheduler.start();
    sourceSync.onScheduler?.(sourceSyncScheduler);
  }

  app.get("/openapi.json", (context) =>
    context.json(
      completeKnowledgeGatewayOpenApiDocument(
        app.getOpenAPI31Document(knowledgeGatewayOpenApiDocument),
      ),
    ),
  );

  return app;
}
