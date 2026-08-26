import { randomUUID } from "node:crypto";

import {
  type CapabilityGrantProvenanceRepository,
  type ConcurrencyGate,
  type DeletionLifecycleFenceGuard,
  type DeletionObjectWriteAdmission,
  type DocumentAssetRepository,
  type DocumentChunkRepository,
  type DocumentCompilationAttemptRepository,
  type DocumentCompilationJobStateMachine,
  type DocumentCompilationOutboxDispatcher,
  DocumentCompilationProcessingError,
  type DocumentCompilationRuntime,
  type DocumentModelBudget,
  type DocumentMultimodalManifestRepository,
  type DocumentOutlineRepository,
  type DocumentProcessingTaskRepository,
  type DocumentSemanticEnrichmentGenerationGuard,
  type DocumentSemanticEnrichmentOperationalMetrics,
  type DocumentSettingsRepository,
  type DurableTaskOperationalMetrics,
  type GoldenQuestionRepository,
  type GraphIndexRepository,
  type IndexProjectionRepository,
  type IngestionModelCallOperationalMetrics,
  type KnowledgeGatewayOptions,
  type KnowledgeNodeRepository,
  type KnowledgePathRepository,
  type KnowledgeSpaceAccessService,
  type KnowledgeSpaceEmbeddingResolver,
  type KnowledgeSpaceManifestRepository,
  type KnowledgeSpaceProfileMigrationRepository,
  type KnowledgeSpaceProfileMigrationRuntime,
  type KnowledgeSpaceProfilePublicationRepository,
  type KnowledgeSpaceProfileRepository,
  type KnowledgeSpaceUnpublishedProfileActivationRepository,
  type LegacySpacePublicationBootstrapRepository,
  type LegacySpacePublicationBootstrapRuntime,
  type LegacySpacePublicationBootstrapService,
  type LogicalDocumentRepository,
  type ModelCapabilityPreflight,
  type PageIndexFindabilityEvaluator,
  type PageIndexFindabilityRepository,
  type PageIndexFindabilityRuntime,
  type PageIndexSummaryRepairRuntime,
  type PageIndexUpgradeBackfillRepository,
  type PageIndexUpgradeBackfillRuntime,
  type PageIndexUpgradeBackfillService,
  type ParseArtifactRepository,
  type ProjectionSetPublicationMemberRepository,
  type ProjectionSetPublicationRepository,
  type SemanticChunker,
  createConcurrencyGate,
  createDatabaseDocumentCompilationCandidateValidator,
  createDatabaseDocumentCompilationIndexOverrideResolver,
  createDatabaseDocumentLogicalMutationReconciler,
  createDatabaseDocumentRevisionPublicationFenceResolver,
  createDatabaseDocumentSemanticEnrichmentRepository,
  createDatabaseDocumentSemanticExtractionCheckpointRepository,
  createDatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepository,
  createDatabasePublishedPageIndexBuildRepository,
  createDenseVectorProjectionBuilder,
  createDocumentChunkStateService,
  createDocumentCompilationInitialProfileCoordinator,
  createDocumentCompilationOutboxDispatcher,
  createDocumentCompilationPublicationCoordinator,
  createDocumentCompilationPublicationProcessor,
  createDocumentCompilationRuntime,
  createDocumentCompilationWorker,
  createDocumentCompilationWorkerAttemptProcessor,
  createDocumentOutlineBuilder,
  createDocumentRevisionRollbackCoordinator,
  createDocumentSemanticEnrichmentProcessor,
  createDocumentSemanticEnrichmentRuntime,
  createDocumentSettingsChangeCoordinator,
  createDurableDocumentCompilationJobStateMachine,
  createFtsProjectionBuilder,
  createIncrementalReindexer,
  createJointSemanticGraphMaterializer,
  createKnowledgeSpaceProfileMigrationRuntime,
  createLegacySpacePublicationBootstrapRuntime,
  createLegacySpacePublicationBootstrapService,
  createPageIndexFindabilityPublicationEvaluator,
  createPageIndexFindabilityRuntime,
  createPageIndexSummaryRepairRuntime,
  createPageIndexUpgradeBackfillRuntime,
  createPageIndexUpgradeBackfillService,
  createRepositoryDocumentCompilationCandidateEvaluator,
  createRepositoryDocumentCompilationFingerprintMaterialResolver,
  createRepositoryKnowledgeSpaceProfileMigrationCandidateBuilder,
  createRepositoryKnowledgeSpaceProfileMigrationEvaluator,
  createSourceCompilationPublicationExecutor,
  createVisualEmbeddingProjectionBuilder,
} from "@knowledge/api";
import type { ComputeRuntime } from "@knowledge/compute";
import { KnowledgeSpaceRetrievalProfileSchema } from "@knowledge/core";
import type { ParserAdapter } from "@knowledge/parsers";

import type { ApiDocumentCompilationOptions } from "./document-compilation-options";

export interface ApiDocumentCompilationRuntimeRepositories {
  readonly artifacts: ParseArtifactRepository;
  readonly assets: DocumentAssetRepository;
  readonly attempts: DocumentCompilationAttemptRepository;
  readonly chunks: DocumentChunkRepository;
  readonly graph?: GraphIndexRepository | undefined;
  readonly legacyBootstraps: LegacySpacePublicationBootstrapRepository;
  readonly pageIndexUpgradeBackfills: PageIndexUpgradeBackfillRepository;
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly members: ProjectionSetPublicationMemberRepository;
  readonly multimodalManifests: DocumentMultimodalManifestRepository;
  readonly logicalDocuments: LogicalDocumentRepository;
  readonly nodes: KnowledgeNodeRepository;
  readonly outlines: DocumentOutlineRepository;
  readonly paths: KnowledgePathRepository;
  readonly profiles: KnowledgeSpaceProfileRepository;
  readonly projections: IndexProjectionRepository;
  readonly publications: ProjectionSetPublicationRepository;
  readonly settings: DocumentSettingsRepository;
  readonly tasks: DocumentProcessingTaskRepository;
}

export interface CreateApiDocumentCompilationRuntimeOptions {
  readonly adapter: KnowledgeGatewayOptions["adapter"];
  readonly compute: ComputeRuntime | undefined;
  readonly config: ApiDocumentCompilationOptions | undefined;
  readonly createModelBudget?: (() => DocumentModelBudget) | undefined;
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly objectWriteAdmission?: DeletionObjectWriteAdmission | undefined;
  readonly embeddingResolver: KnowledgeSpaceEmbeddingResolver | undefined;
  readonly findability?:
    | {
        readonly evaluator: PageIndexFindabilityEvaluator;
        readonly goldenQuestions: Pick<GoldenQuestionRepository, "listTrusted">;
        readonly onError?: ((error: unknown) => void) | undefined;
        readonly repository: PageIndexFindabilityRepository;
      }
    | undefined;
  readonly initialProfileActivations?:
    | KnowledgeSpaceUnpublishedProfileActivationRepository
    | undefined;
  readonly modelCapabilityPreflight?: ModelCapabilityPreflight | undefined;
  readonly modelCallMetrics?: IngestionModelCallOperationalMetrics | undefined;
  readonly metrics?: DurableTaskOperationalMetrics | undefined;
  readonly outlineSummaryEnhancer?:
    | Parameters<typeof createDocumentCompilationWorker>[0]["outlineSummaryEnhancer"]
    | undefined;
  readonly parser: ParserAdapter;
  readonly profileMigration?:
    | {
        readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
        readonly bindings: KnowledgeSpaceProfilePublicationRepository;
        readonly capabilityGrants?:
          | Pick<CapabilityGrantProvenanceRepository, "assertPublicationAllowed">
          | undefined;
        readonly repository: KnowledgeSpaceProfileMigrationRepository;
      }
    | undefined;
  readonly multimodal?:
    | (Pick<
        KnowledgeGatewayOptions,
        | "documentMultimodalImageVariantGenerator"
        | "documentMultimodalLocalAssetAllowlist"
        | "documentMultimodalMaxExtractedAssets"
        | "documentMultimodalMaxLocalAssetBytes"
        | "documentMultimodalMaxPdfRasterizedAssets"
        | "documentMultimodalRemoteAssetFetcher"
        | "documentPdfRasterizer"
      > & { readonly documentMultimodalMaxConcurrency?: number | undefined })
    | undefined;
  readonly repositories: Partial<ApiDocumentCompilationRuntimeRepositories>;
  readonly semantic?:
    | ((Pick<
        KnowledgeGatewayOptions,
        | "semanticEntityExtractionMaxEntitiesPerNode"
        | "semanticEntityExtractionMaxNodesPerRun"
        | "semanticRelationExtractionMaxRelationsPerNode"
        | "semanticReasoningMaxOutputTokens"
        | "semanticReasoningProviderFactory"
      > & { readonly modelRequestGate?: ConcurrencyGate | undefined }) & {
        readonly modelCallMetrics?: IngestionModelCallOperationalMetrics | undefined;
        readonly semanticExtractionBatchSize?: number | undefined;
        readonly semanticExtractionMaxConcurrency?: number | undefined;
      })
    | undefined;
  readonly semanticMetrics?: DocumentSemanticEnrichmentOperationalMetrics | undefined;
  readonly semanticChunker?: SemanticChunker | undefined;
  readonly visual?:
    | {
        readonly model: string;
        readonly provider: Parameters<typeof createVisualEmbeddingProjectionBuilder>[0]["provider"];
      }
    | undefined;
}

export interface ApiDocumentCompilationRuntimeAssembly {
  readonly compilationJobs: DocumentCompilationJobStateMachine;
  readonly documentChunkState: NonNullable<KnowledgeGatewayOptions["documentChunkState"]>;
  readonly documentRevisionRollbacks: NonNullable<
    KnowledgeGatewayOptions["documentRevisionRollbacks"]
  >;
  readonly documentSettingsChanges: NonNullable<KnowledgeGatewayOptions["documentSettingsChanges"]>;
  readonly dispatcher: DocumentCompilationOutboxDispatcher;
  readonly legacyBootstrapRuntime: LegacySpacePublicationBootstrapRuntime;
  readonly legacyBootstrapService: LegacySpacePublicationBootstrapService;
  readonly pageIndexUpgradeBackfillRuntime: PageIndexUpgradeBackfillRuntime;
  readonly pageIndexUpgradeBackfillService: PageIndexUpgradeBackfillService;
  readonly pageIndexSummaryRepairRuntime?: PageIndexSummaryRepairRuntime | undefined;
  readonly pageIndexFindabilityRuntime?: PageIndexFindabilityRuntime | undefined;
  readonly profileMigrationRuntime?: KnowledgeSpaceProfileMigrationRuntime | undefined;
  readonly runtime: DocumentCompilationRuntime;
  readonly sourceCompilationPublication: ReturnType<
    typeof createSourceCompilationPublicationExecutor
  >;
  start(): void;
  stop(): void;
}

/**
 * Admission routes are exposed only with the worker that can consume their durable runs. Keeping
 * this gate beside the runtime assembly prevents a database-only configuration from accepting a
 * migration that will remain queued forever.
 */
export function createApiProfileMigrationGatewayOptions(input: {
  readonly assembly: ApiDocumentCompilationRuntimeAssembly | undefined;
  readonly bindings: KnowledgeSpaceProfilePublicationRepository | undefined;
  readonly repository: KnowledgeSpaceProfileMigrationRepository | undefined;
}): Pick<
  KnowledgeGatewayOptions,
  "knowledgeSpaceProfileMigrationRepository" | "knowledgeSpaceProfilePublications"
> {
  return input.assembly?.profileMigrationRuntime && input.repository && input.bindings
    ? {
        knowledgeSpaceProfileMigrationRepository: input.repository,
        knowledgeSpaceProfilePublications: input.bindings,
      }
    : {};
}

const maxCandidateComponents = 100_000;
const maxDocumentNodes = 20_000;
const maxProjectionBatchSize = 1_000;
const maxPageIndexTermRowsPerOutline = 1_000_000;
const embeddingBatchSize = 128;

/**
 * Production-only durable compilation assembly. `off` means no control plane and no timers. `on`
 * requires every durable database repository, compute, and a space-aware embedding resolver;
 * missing capability fails startup instead of falling back to legacy in-memory compilation.
 */
export function createApiDocumentCompilationRuntime({
  adapter,
  compute,
  config,
  createModelBudget,
  deletionFence,
  objectWriteAdmission,
  embeddingResolver,
  findability,
  initialProfileActivations,
  modelCapabilityPreflight,
  modelCallMetrics,
  metrics,
  multimodal,
  outlineSummaryEnhancer,
  parser,
  profileMigration,
  repositories: partialRepositories,
  semantic,
  semanticMetrics,
  semanticChunker,
  visual,
}: CreateApiDocumentCompilationRuntimeOptions): ApiDocumentCompilationRuntimeAssembly | undefined {
  if (!config) {
    return undefined;
  }
  if (!compute) {
    throw new Error("Document compilation runtime requires an in-process compute runtime");
  }
  if (!semanticChunker) {
    throw new Error("Document compilation runtime requires the Reasoning-model semantic chunker");
  }
  if (!embeddingResolver) {
    throw new Error(
      "Document compilation runtime requires the per-space plugin embedding resolver",
    );
  }
  if (!initialProfileActivations) {
    throw new Error(
      "Document compilation runtime requires the atomic initial profile activation repository",
    );
  }
  if (!modelCapabilityPreflight) {
    throw new Error("Document compilation runtime requires model capability preflight");
  }
  const repositories = requireRuntimeRepositories(partialRepositories);
  if (!repositories.projections.getMany || !repositories.projections.updateStatusByIds) {
    throw new Error(
      "Document compilation runtime requires bounded projection getMany and status updates",
    );
  }
  const multimodalMaterializationGate = createConcurrencyGate(
    multimodal?.documentMultimodalMaxConcurrency ?? 2,
  );

  const compilationJobs = createDurableDocumentCompilationJobStateMachine({
    assertCompilationAdmission: (input) =>
      repositories.legacyBootstraps.assertCompilationAdmission(input),
    attempts: repositories.attempts,
    generateAttemptId: randomUUID,
    generateOutboxId: randomUUID,
    generatePublicationGenerationId: randomUUID,
    jobs: adapter.jobs,
    maxExecutionAttempts: config.maxAttempts,
    ...(metrics ? { metrics } : {}),
    resolveBaseHeadRevision: async (scope) =>
      (
        await repositories.publications.getPublished({
          knowledgeSpaceId: scope.knowledgeSpaceId,
          tenantId: scope.tenantId,
        })
      )?.headRevision ?? 0,
  });
  const documentChunkState = createDocumentChunkStateService({
    chunks: repositories.chunks,
    compilationJobs,
    logicalDocuments: repositories.logicalDocuments,
  });
  const documentRevisionRollbacks = createDocumentRevisionRollbackCoordinator({
    compilationJobs,
    logicalDocuments: repositories.logicalDocuments,
    tasks: repositories.tasks,
  });
  const documentSettingsChanges = createDocumentSettingsChangeCoordinator({
    compilationJobs,
    logicalDocuments: repositories.logicalDocuments,
    settings: repositories.settings,
  });
  const sourceCompilationPublication = createSourceCompilationPublicationExecutor({
    compilationJobs,
  });
  const documentMutationReconciler = createDatabaseDocumentLogicalMutationReconciler({
    chunks: repositories.chunks,
    database: adapter.database,
    logicalDocuments: repositories.logicalDocuments,
    settings: repositories.settings,
  });
  const documentIndexOverrides = createDatabaseDocumentCompilationIndexOverrideResolver(
    adapter.database,
  );
  const validator = createDatabaseDocumentCompilationCandidateValidator({
    database: adapter.database,
    manifests: repositories.manifests,
    maxBatchSize: maxProjectionBatchSize,
  });
  const coordinator = createDocumentCompilationPublicationCoordinator({
    ...(deletionFence ? { deletionFence } : {}),
    logicalDocumentFences: createDatabaseDocumentRevisionPublicationFenceResolver(adapter.database),
    maxComponents: maxCandidateComponents,
    members: repositories.members,
    publications: repositories.publications,
    validator,
  });
  const findabilityPublication = findability
    ? createPageIndexFindabilityPublicationEvaluator({
        evaluator: findability.evaluator,
        findability: findability.repository,
        goldenQuestions: findability.goldenQuestions,
        maxEvidenceIds: 1_000,
        maxQuestions: 20,
        nodes: repositories.nodes,
        outlines: repositories.outlines,
        profiles: repositories.profiles,
      })
    : undefined;
  const workerId = `${process.pid}-${randomUUID()}`;
  const findabilityAsync = findabilityPublication
    ? createPageIndexFindabilityRuntime({
        attempts: repositories.attempts,
        evaluator: findabilityPublication,
        intervalMs: config.tickMs,
        jobs: adapter.jobs,
        leaseMs: config.leaseMs,
        maxAttempts: Math.min(3, config.maxAttempts),
        maxBatchSize: config.batchSize,
        ...(findability?.onError ? { onError: findability.onError } : {}),
        retryBaseMs: config.retryBaseMs,
        retryMaxMs: config.retryMaxMs,
        workerId: `page-index-findability-${workerId}`,
      })
    : undefined;
  const fingerprintMaterial = createRepositoryDocumentCompilationFingerprintMaterialResolver({
    artifacts: repositories.artifacts,
    assets: repositories.assets,
    maxComponents: maxCandidateComponents,
    maxProjectionBatchSize,
    members: repositories.members,
    outlines: repositories.outlines,
    projections: {
      getMany: repositories.projections.getMany.bind(repositories.projections),
    },
    publications: repositories.publications,
    versions: {
      chunkerVersion: "knowledge-llm-semantic-chunker-v1",
      indexVersion: "knowledge-index-v1",
      nodeSchemaVersion: 1,
      parserPolicyVersion: "configured-parser-v1",
      projectionSetVersion: "projection-set-v1",
    },
  });
  const pageIndexBuild = createDatabasePublishedPageIndexBuildRepository({
    database: adapter.database,
    maxNodesPerOutline: maxDocumentNodes,
    maxTermRowsPerOutline: maxPageIndexTermRowsPerOutline,
    writeBatchSize: maxProjectionBatchSize,
  });
  const evaluator = createRepositoryDocumentCompilationCandidateEvaluator({
    indexOverrides: documentIndexOverrides,
    maxProjectionBatchSize,
    outlines: repositories.outlines,
    pageIndexBuild,
    profiles: repositories.profiles,
    projections: {
      getMany: repositories.projections.getMany.bind(repositories.projections),
    },
  });
  const reindexer = createIncrementalReindexer({
    artifacts: repositories.artifacts,
    compute,
    denseBuilder: createDenseVectorProjectionBuilder({
      embeddingResolver,
      maxBatchSize: embeddingBatchSize,
      ...(modelCallMetrics ? { metrics: modelCallMetrics } : {}),
      projections: repositories.projections,
    }),
    ftsBuilder: createFtsProjectionBuilder({
      maxBatchSize: embeddingBatchSize,
      projections: repositories.projections,
    }),
    maxNodes: maxDocumentNodes,
    maxProjectionBatchSize: embeddingBatchSize,
    nodes: repositories.nodes,
    projections: repositories.projections,
    semanticChunker,
    ...(visual
      ? {
          visualBuilder: createVisualEmbeddingProjectionBuilder({
            maxBatchSize: embeddingBatchSize,
            ...(modelCallMetrics ? { metrics: modelCallMetrics } : {}),
            projections: repositories.projections,
            provider: visual.provider,
          }),
        }
      : {}),
  });
  const outlineBuilder = createDocumentOutlineBuilder({
    maxElements: maxDocumentNodes,
    maxNodes: maxDocumentNodes,
    maxSummaryChars: 2_000,
  });
  const jointSemanticGraph =
    semanticChunker && repositories.graph
      ? createJointSemanticGraphMaterializer({
          graph: repositories.graph,
          maxEntitiesPerNode: semantic?.semanticEntityExtractionMaxEntitiesPerNode ?? 50,
          maxNodesPerArtifact: maxDocumentNodes,
          maxRelationsPerNode: semantic?.semanticRelationExtractionMaxRelationsPerNode ?? 50,
          nodes: repositories.nodes,
        })
      : undefined;
  if (semanticChunker && !jointSemanticGraph) {
    throw new Error("Semantic document compilation requires the graph repository");
  }
  if (profileMigration && !outlineSummaryEnhancer) {
    throw new Error(
      "Profile migration runtime requires the profile-aware PageIndex Summary enhancer",
    );
  }
  const profileMigrationRuntime =
    profileMigration && outlineSummaryEnhancer
      ? createKnowledgeSpaceProfileMigrationRuntime({
          access: profileMigration.access,
          bindings: profileMigration.bindings,
          ...(profileMigration.capabilityGrants
            ? { capabilityGrants: profileMigration.capabilityGrants }
            : {}),
          builder: createRepositoryKnowledgeSpaceProfileMigrationCandidateBuilder({
            artifacts: repositories.artifacts,
            assets: repositories.assets,
            maxDocuments: maxCandidateComponents,
            maxMembers: maxCandidateComponents,
            maxProjectionBatchSize,
            members: repositories.members,
            outlineBuilder,
            outlineSummaryEnhancer,
            outlines: repositories.outlines,
            pageIndexBuild,
            paths: repositories.paths,
            profiles: repositories.profiles,
            projections: {
              getMany: repositories.projections.getMany.bind(repositories.projections),
            },
            publications: repositories.publications,
            reindexer,
            ...(jointSemanticGraph ? { semanticGraph: jointSemanticGraph } : {}),
            snapshots: createDatabaseKnowledgeSpaceProfileMigrationCandidateSnapshotRepository({
              database: adapter.database,
              maxMembers: maxCandidateComponents,
              writeBatchSize: maxProjectionBatchSize,
            }),
          }),
          claimLimit: config.batchSize,
          ...(deletionFence ? { deletionFence } : {}),
          evaluator: createRepositoryKnowledgeSpaceProfileMigrationEvaluator({
            maxProjectionBatchSize,
            members: repositories.members,
            outlines: repositories.outlines,
            pageIndexBuild,
            profiles: repositories.profiles,
            projections: {
              getMany: repositories.projections.getMany.bind(repositories.projections),
            },
          }),
          heartbeatIntervalMs: Math.max(1, Math.floor(config.leaseMs / 3)),
          leaseMs: config.leaseMs,
          repository: profileMigration.repository,
          workerId: `profile-migration-runtime-${process.pid}-${randomUUID()}`,
        })
      : undefined;
  const semanticEnrichment = createCandidateSemanticEnrichment({
    adapter,
    attempts: repositories.attempts,
    graph: repositories.graph,
    members: repositories.members,
    nodes: repositories.nodes,
    outlines: repositories.outlines,
    publications: repositories.publications,
    runtimeConfig: config,
    semantic,
    semanticMetrics,
  });
  const initialProfiles = createDocumentCompilationInitialProfileCoordinator({
    activations: initialProfileActivations,
    manifests: repositories.manifests,
    preflight: modelCapabilityPreflight,
    profiles: repositories.profiles,
  });
  const compileCandidate = createDocumentCompilationWorkerAttemptProcessor({
    coordinator,
    createWorker: ({
      baseHeadRevision,
      candidateComposer,
      frozenEmbeddingProfile,
      frozenRetrievalProfile,
      jobs,
    }) =>
      createDocumentCompilationWorker({
        assertDocumentAvailable: async (input) => {
          if (!(await repositories.logicalDocuments.isAssetEnabled?.(input)))
            throw new DocumentCompilationProcessingError(
              "Document was disabled before compilation started",
              { code: "DOCUMENT_DISABLED", retryable: false },
            );
        },
        assets: repositories.assets,
        candidateComposer,
        ...(deletionFence ? { deletionFence } : {}),
        ...(objectWriteAdmission ? { objectWriteAdmission } : {}),
        embeddingResolver,
        ...(frozenEmbeddingProfile ? { frozenEmbeddingProfile } : {}),
        ...(frozenRetrievalProfile ? { frozenRetrievalProfile } : {}),
        failureManagement: "caller",
        generateKnowledgePathId: randomUUID,
        jobs,
        ...(jointSemanticGraph ? { jointSemanticGraph } : {}),
        indexOverrides: documentIndexOverrides,
        knowledgePaths: repositories.paths,
        ...(multimodal?.documentMultimodalImageVariantGenerator
          ? {
              multimodalImageVariantGenerator: multimodal.documentMultimodalImageVariantGenerator,
            }
          : {}),
        multimodalMaterializationGate,
        ...(multimodal?.documentMultimodalLocalAssetAllowlist
          ? {
              multimodalLocalAssetAllowlist: multimodal.documentMultimodalLocalAssetAllowlist,
            }
          : {}),
        ...(multimodal?.documentMultimodalMaxExtractedAssets
          ? {
              multimodalMaxExtractedAssets: multimodal.documentMultimodalMaxExtractedAssets,
            }
          : {}),
        ...(multimodal
          ? { multimodalMaxConcurrency: multimodal.documentMultimodalMaxConcurrency }
          : {}),
        ...(multimodal?.documentMultimodalMaxLocalAssetBytes
          ? {
              multimodalMaxLocalAssetBytes: multimodal.documentMultimodalMaxLocalAssetBytes,
            }
          : {}),
        ...(multimodal?.documentMultimodalMaxPdfRasterizedAssets
          ? {
              multimodalMaxPdfRasterizedAssets: multimodal.documentMultimodalMaxPdfRasterizedAssets,
            }
          : {}),
        ...(multimodal?.documentMultimodalRemoteAssetFetcher
          ? {
              multimodalRemoteAssetFetcher: multimodal.documentMultimodalRemoteAssetFetcher,
            }
          : {}),
        multimodalManifests: repositories.multimodalManifests,
        ...(createModelBudget ? { modelBudget: createModelBudget() } : {}),
        objectStorage: adapter.objectStorage,
        outlineBuilder,
        ...(outlineSummaryEnhancer ? { outlineSummaryEnhancer } : {}),
        outlines: repositories.outlines,
        pageIndexBuild,
        parser,
        ...(multimodal?.documentPdfRasterizer
          ? { pdfRasterizer: multimodal.documentPdfRasterizer }
          : {}),
        reindexer,
        ...(semanticEnrichment
          ? {
              semanticEnrichmentAdmission: {
                enqueue: (input) =>
                  semanticEnrichment.admission.enqueue({ ...input, baseHeadRevision }),
              },
            }
          : {}),
        ...(visual ? { visualEmbeddingModel: visual.model } : {}),
      }),
    fingerprintMaterial,
    initialProfiles,
    profiles: repositories.profiles,
  });
  const processor = createDocumentCompilationPublicationProcessor({
    ...(findabilityPublication
      ? {
          afterPublished: ({ attempt, publication }) =>
            findabilityAsync?.admission.enqueue({
              compilationAttemptId: attempt.id,
              publicationFingerprint: publication.published.fingerprint,
            }) ?? Promise.resolve(),
          ...(findability?.onError ? { onAfterPublishedError: findability.onError } : {}),
        }
      : {}),
    assets: repositories.assets,
    compileCandidate,
    coordinator,
    evaluator,
  });
  const runtime = createDocumentCompilationRuntime({
    attempts: repositories.attempts,
    heartbeatIntervalMs: Math.max(1, Math.floor(config.leaseMs / 3)),
    initialRetryDelayMs: config.retryBaseMs,
    intervalMs: config.tickMs,
    jobs: adapter.jobs,
    leaseMs: config.leaseMs,
    maxBatchSize: config.batchSize,
    maxRetryDelayMs: config.retryMaxMs,
    ...(metrics ? { metrics } : {}),
    processor,
    workerId: `document-compilation-runtime-${workerId}`,
  });
  const dispatcher = createDocumentCompilationOutboxDispatcher({
    attempts: repositories.attempts,
    initialRetryDelayMs: config.retryBaseMs,
    intervalMs: config.tickMs,
    jobs: adapter.jobs,
    lockMs: config.outboxVisibilityMs,
    maxBatchSize: config.batchSize,
    maxDispatchAttempts: config.maxAttempts,
    maxRetryDelayMs: config.retryMaxMs,
    visibilityMs: config.outboxVisibilityMs,
    workerId: `document-compilation-outbox-${workerId}`,
  });
  const legacyBootstrapRuntime = createLegacySpacePublicationBootstrapRuntime({
    compilationJobs,
    intervalMs: config.tickMs,
    leaseMs: config.leaseMs,
    maxBatchSize: config.batchSize,
    repository: repositories.legacyBootstraps,
    workerId: `legacy-publication-bootstrap-${workerId}`,
  });
  const legacyBootstrapService = createLegacySpacePublicationBootstrapService({
    repository: repositories.legacyBootstraps,
  });
  const pageIndexUpgradeBackfillRuntime = createPageIndexUpgradeBackfillRuntime({
    builds: pageIndexBuild,
    intervalMs: config.tickMs,
    leaseMs: config.leaseMs,
    maxBatchSize: config.batchSize,
    mutationLeases: repositories.legacyBootstraps,
    repository: repositories.pageIndexUpgradeBackfills,
    workerId: `page-index-upgrade-${workerId}`,
  });
  const pageIndexUpgradeBackfillService = createPageIndexUpgradeBackfillService({
    repository: repositories.pageIndexUpgradeBackfills,
  });
  const pageIndexSummaryRepairRuntime = findability
    ? createPageIndexSummaryRepairRuntime({
        attempts: repositories.attempts,
        intervalMs: config.tickMs,
        leaseMs: config.leaseMs,
        maxAttempts: Math.min(3, config.maxAttempts),
        maxBatchSize: config.batchSize,
        ...(findability.onError ? { onError: findability.onError } : {}),
        repository: findability.repository,
        repair: async ({ evaluation, source }) => {
          if (!outlineSummaryEnhancer) {
            throw new Error("PageIndex summary component repair requires an outline enhancer");
          }
          const profileReference = source.retrievalProfile;
          const [artifact, outline, profileRevision] = await Promise.all([
            repositories.artifacts.getByDocumentVersion({
              documentAssetId: evaluation.documentAssetId,
              version: evaluation.documentVersion,
            }),
            repositories.outlines.getById({ id: evaluation.outlineId }),
            profileReference
              ? repositories.profiles.getRevision({
                  kind: "retrieval",
                  knowledgeSpaceId: evaluation.knowledgeSpaceId,
                  revision: profileReference.revision,
                  tenantId: evaluation.tenantId,
                })
              : Promise.resolve(null),
          ]);
          if (!artifact || !outline) {
            throw new Error("PageIndex summary component repair source artifacts are unavailable");
          }
          if (
            outline.publicationGenerationId !== evaluation.generationId ||
            outline.documentAssetId !== evaluation.documentAssetId ||
            outline.version !== evaluation.documentVersion
          ) {
            throw new Error("PageIndex summary component repair source identity changed");
          }
          if (
            profileReference &&
            (!profileRevision ||
              profileRevision.id !== profileReference.revisionId ||
              profileRevision.snapshotDigest !== profileReference.snapshotDigest)
          ) {
            throw new Error("PageIndex summary component repair retrieval profile changed");
          }
          await outlineSummaryEnhancer.enhance({
            ...(createModelBudget ? { modelBudget: createModelBudget() } : {}),
            outline,
            parseArtifact: artifact,
            ...(profileRevision
              ? {
                  retrievalProfile: KnowledgeSpaceRetrievalProfileSchema.parse(
                    profileRevision.snapshot,
                  ),
                }
              : {}),
            tenantId: evaluation.tenantId,
            traceId: evaluation.id,
          });
        },
        retryBaseMs: config.retryBaseMs,
        retryMaxMs: config.retryMaxMs,
        workerId: `page-index-summary-repair-${workerId}`,
      })
    : undefined;
  let started = false;
  let documentMutationTimer: ReturnType<typeof setInterval> | undefined;
  let profileMigrationTimer: ReturnType<typeof setInterval> | undefined;

  const tickProfileMigrations = () => {
    void profileMigrationRuntime?.tick().catch(() => undefined);
  };

  return {
    compilationJobs,
    documentChunkState,
    documentRevisionRollbacks,
    documentSettingsChanges,
    dispatcher,
    legacyBootstrapRuntime,
    legacyBootstrapService,
    pageIndexUpgradeBackfillRuntime,
    pageIndexUpgradeBackfillService,
    ...(findabilityAsync ? { pageIndexFindabilityRuntime: findabilityAsync.runtime } : {}),
    ...(pageIndexSummaryRepairRuntime ? { pageIndexSummaryRepairRuntime } : {}),
    ...(profileMigrationRuntime ? { profileMigrationRuntime } : {}),
    runtime,
    sourceCompilationPublication,
    start: () => {
      if (started) {
        return;
      }
      started = true;
      dispatcher.start();
      runtime.start();
      legacyBootstrapRuntime.start();
      pageIndexUpgradeBackfillRuntime.start();
      findabilityAsync?.runtime.start();
      pageIndexSummaryRepairRuntime?.start();
      semanticEnrichment?.runtime.start();
      void documentMutationReconciler.tick().catch(() => undefined);
      documentMutationTimer = setInterval(
        () => void documentMutationReconciler.tick().catch(() => undefined),
        config.tickMs,
      );
      documentMutationTimer.unref?.();
      if (profileMigrationRuntime) {
        tickProfileMigrations();
        profileMigrationTimer = setInterval(tickProfileMigrations, config.tickMs);
        profileMigrationTimer.unref?.();
      }
    },
    stop: () => {
      if (!started) {
        return;
      }
      pageIndexUpgradeBackfillRuntime.stop();
      findabilityAsync?.runtime.stop();
      pageIndexSummaryRepairRuntime?.stop();
      semanticEnrichment?.runtime.stop();
      if (documentMutationTimer) {
        clearInterval(documentMutationTimer);
        documentMutationTimer = undefined;
      }
      if (profileMigrationTimer) {
        clearInterval(profileMigrationTimer);
        profileMigrationTimer = undefined;
      }
      legacyBootstrapRuntime.stop();
      runtime.stop();
      dispatcher.stop();
      started = false;
    },
  };
}

function createCandidateSemanticEnrichment({
  adapter,
  attempts,
  graph,
  members,
  nodes,
  outlines,
  publications,
  runtimeConfig,
  semantic,
  semanticMetrics,
}: {
  readonly adapter: CreateApiDocumentCompilationRuntimeOptions["adapter"];
  readonly attempts: DocumentCompilationAttemptRepository;
  readonly graph?: GraphIndexRepository | undefined;
  readonly members: ProjectionSetPublicationMemberRepository;
  readonly nodes: KnowledgeNodeRepository;
  readonly outlines: DocumentOutlineRepository;
  readonly publications: ProjectionSetPublicationRepository;
  readonly runtimeConfig: ApiDocumentCompilationOptions;
  readonly semantic: CreateApiDocumentCompilationRuntimeOptions["semantic"];
  readonly semanticMetrics: CreateApiDocumentCompilationRuntimeOptions["semanticMetrics"];
}) {
  if (!semantic?.semanticReasoningProviderFactory) {
    return undefined;
  }
  if (!graph) {
    throw new Error("Document compilation semantic enrichment requires the graph repository");
  }
  const maxNodes = semantic.semanticEntityExtractionMaxNodesPerRun ?? 100;
  const repository = createDatabaseDocumentSemanticEnrichmentRepository({
    database: adapter.database,
    generateLeaseToken: randomUUID,
    maxClaimBatchSize: runtimeConfig.batchSize,
  });
  const checkpoints = createDatabaseDocumentSemanticExtractionCheckpointRepository({
    database: adapter.database,
    maxBatchSize: maxNodes,
  });
  const processor = createDocumentSemanticEnrichmentProcessor({
    checkpoints,
    graph,
    maxConcurrentBatches: semantic.semanticExtractionMaxConcurrency ?? 4,
    maxEntitiesPerNode: semantic.semanticEntityExtractionMaxEntitiesPerNode ?? 50,
    maxNodesPerArtifact: maxNodes,
    maxOutputTokens: semantic.semanticReasoningMaxOutputTokens ?? 1_500,
    maxRelationsPerNode: semantic.semanticRelationExtractionMaxRelationsPerNode ?? 50,
    ...(semantic.modelRequestGate ? { modelRequestGate: semantic.modelRequestGate } : {}),
    ...(semantic.modelCallMetrics ? { modelCallMetrics: semantic.modelCallMetrics } : {}),
    nodes,
    providerFactory: semantic.semanticReasoningProviderFactory,
    providerBatchSize: semantic.semanticExtractionBatchSize ?? 8,
  });
  const generationGuard = createDocumentSemanticEnrichmentGenerationGuard({
    attempts,
    members,
    outlines,
    publications,
  });
  const runtime = createDocumentSemanticEnrichmentRuntime({
    claimLimit: runtimeConfig.batchSize,
    generationGuard,
    heartbeatIntervalMs: Math.max(1, Math.floor(runtimeConfig.leaseMs / 3)),
    intervalMs: runtimeConfig.tickMs,
    leaseMs: runtimeConfig.leaseMs,
    ...(semanticMetrics ? { metrics: semanticMetrics } : {}),
    processor,
    repository,
    retryBaseMs: runtimeConfig.retryBaseMs,
    workerId: `document-semantic-enrichment-${process.pid}-${randomUUID()}`,
  });

  return {
    admission: {
      enqueue: async (
        input: Parameters<
          NonNullable<
            Parameters<typeof createDocumentCompilationWorker>[0]["semanticEnrichmentAdmission"]
          >["enqueue"]
        >[0] & { readonly baseHeadRevision: number },
      ) => {
        // No reasoning route means graph enrichment is explicitly disabled for this profile.
        if (!input.retrievalProfile.reasoningModel) return;
        const createdAt = new Date().toISOString();
        await repository.enqueue({
          ...input,
          availableAt: createdAt,
          createdAt,
          id: randomUUID(),
          maxExecutionAttempts: runtimeConfig.maxAttempts,
        });
      },
    },
    runtime,
  };
}

export function createDocumentSemanticEnrichmentGenerationGuard({
  attempts,
  members,
  outlines,
  publications,
}: {
  readonly attempts: Pick<DocumentCompilationAttemptRepository, "get">;
  readonly members: Pick<ProjectionSetPublicationMemberRepository, "filterComponentKeys">;
  readonly outlines: Pick<DocumentOutlineRepository, "getByDocumentVersion">;
  readonly publications: Pick<ProjectionSetPublicationRepository, "getPublished">;
}): DocumentSemanticEnrichmentGenerationGuard {
  return {
    status: async (job) => {
      const attempt = await attempts.get(job.compilationAttemptId);
      if (
        !attempt ||
        attempt.publicationGenerationId !== job.publicationGenerationId ||
        attempt.runState === "failed" ||
        attempt.runState === "canceled" ||
        attempt.runState === "superseded"
      ) {
        return "superseded";
      }

      const published = await publications.getPublished({
        knowledgeSpaceId: job.knowledgeSpaceId,
        tenantId: job.tenantId,
      });
      if (published && published.headRevision > job.baseHeadRevision) {
        const outline = await outlines.getByDocumentVersion({
          documentAssetId: job.documentAssetId,
          publicationGenerationId: job.publicationGenerationId,
          version: job.documentVersion,
        });
        if (outline) {
          const [member] = await members.filterComponentKeys({
            componentKeys: [outline.id],
            componentType: "document-outline",
            knowledgeSpaceId: job.knowledgeSpaceId,
            publicationId: published.id,
            tenantId: job.tenantId,
          });
          if (member === outline.id) return "current";
        }
      }

      // Another document can advance the shared space head while this compilation is still
      // running. Missing membership is therefore conclusive only after this attempt succeeds;
      // otherwise the job must wait for its own candidate publication instead of being lost.
      return attempt.runState === "succeeded" ? "superseded" : "pending";
    },
  };
}

function requireRuntimeRepositories(
  repositories: Partial<ApiDocumentCompilationRuntimeRepositories>,
): ApiDocumentCompilationRuntimeRepositories {
  const required = [
    "artifacts",
    "assets",
    "attempts",
    "chunks",
    "legacyBootstraps",
    "pageIndexUpgradeBackfills",
    "manifests",
    "members",
    "multimodalManifests",
    "logicalDocuments",
    "nodes",
    "outlines",
    "paths",
    "profiles",
    "projections",
    "publications",
    "settings",
    "tasks",
  ] as const;
  for (const name of required) {
    if (!repositories[name]) {
      throw new Error(`Document compilation runtime requires database repository: ${name}`);
    }
  }
  return repositories as ApiDocumentCompilationRuntimeRepositories;
}
