import { randomUUID } from "node:crypto";

import {
  type DeletionLifecycleFenceGuard,
  type DeletionObjectWriteAdmission,
  type DocumentAssetRepository,
  type DocumentChunkRepository,
  type DocumentCompilationAttemptRepository,
  type DocumentCompilationJobStateMachine,
  type DocumentCompilationOutboxDispatcher,
  type DocumentCompilationRuntime,
  type DocumentMultimodalManifestRepository,
  type DocumentOutlineRepository,
  type DocumentProcessingTaskRepository,
  type DocumentSettingsRepository,
  type GraphIndexRepository,
  type IndexProjectionRepository,
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
  type PageIndexUpgradeBackfillRepository,
  type PageIndexUpgradeBackfillRuntime,
  type PageIndexUpgradeBackfillService,
  type ParseArtifactRepository,
  type ProjectionSetPublicationMemberRepository,
  type ProjectionSetPublicationRepository,
  createDatabaseDocumentCompilationCandidateValidator,
  createDatabaseDocumentCompilationIndexOverrideResolver,
  createDatabaseDocumentLogicalMutationReconciler,
  createDatabaseDocumentRevisionPublicationFenceResolver,
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
  createDocumentSettingsChangeCoordinator,
  createDurableDocumentCompilationJobStateMachine,
  createEntityExtractionFlow,
  createExtractionQualityControlFlow,
  createFtsProjectionBuilder,
  createIncrementalReindexer,
  createKnowledgeSpaceProfileMigrationRuntime,
  createLegacySpacePublicationBootstrapRuntime,
  createLegacySpacePublicationBootstrapService,
  createPageIndexUpgradeBackfillRuntime,
  createPageIndexUpgradeBackfillService,
  createRelationExtractionFlow,
  createRepositoryDocumentCompilationCandidateEvaluator,
  createRepositoryDocumentCompilationFingerprintMaterialResolver,
  createRepositoryKnowledgeSpaceProfileMigrationCandidateBuilder,
  createRepositoryKnowledgeSpaceProfileMigrationEvaluator,
  createSemanticIngestionPostProcessor,
  createSourceCompilationPublicationExecutor,
  createVisualEmbeddingProjectionBuilder,
} from "@knowledge/api";
import type { ComputeRuntime } from "@knowledge/compute";
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
  readonly deletionFence?: DeletionLifecycleFenceGuard | undefined;
  readonly objectWriteAdmission?: DeletionObjectWriteAdmission | undefined;
  readonly embeddingResolver: KnowledgeSpaceEmbeddingResolver | undefined;
  readonly initialProfileActivations?:
    | KnowledgeSpaceUnpublishedProfileActivationRepository
    | undefined;
  readonly modelCapabilityPreflight?: ModelCapabilityPreflight | undefined;
  readonly outlineSummaryEnhancer?:
    | Parameters<typeof createDocumentCompilationWorker>[0]["outlineSummaryEnhancer"]
    | undefined;
  readonly parser: ParserAdapter;
  readonly profileMigration?:
    | {
        readonly access: Pick<KnowledgeSpaceAccessService, "revalidatePermissionSnapshot">;
        readonly bindings: KnowledgeSpaceProfilePublicationRepository;
        readonly repository: KnowledgeSpaceProfileMigrationRepository;
      }
    | undefined;
  readonly multimodal?:
    | Pick<
        KnowledgeGatewayOptions,
        | "documentMultimodalImageVariantGenerator"
        | "documentMultimodalLocalAssetAllowlist"
        | "documentMultimodalMaxExtractedAssets"
        | "documentMultimodalMaxLocalAssetBytes"
        | "documentMultimodalMaxPdfRasterizedAssets"
        | "documentPdfRasterizer"
      >
    | undefined;
  readonly repositories: Partial<ApiDocumentCompilationRuntimeRepositories>;
  readonly semantic?:
    | Pick<
        KnowledgeGatewayOptions,
        | "semanticEntityExtractionMaxEntitiesPerNode"
        | "semanticEntityExtractionMaxNodesPerRun"
        | "semanticEntityExtractionModel"
        | "semanticEntityExtractionProvider"
        | "semanticRelationExtractionMaxRelationsPerNode"
        | "semanticRelationExtractionModel"
        | "semanticRelationExtractionProvider"
      >
    | undefined;
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
  deletionFence,
  objectWriteAdmission,
  embeddingResolver,
  initialProfileActivations,
  modelCapabilityPreflight,
  multimodal,
  outlineSummaryEnhancer,
  parser,
  profileMigration,
  repositories: partialRepositories,
  semantic,
  visual,
}: CreateApiDocumentCompilationRuntimeOptions): ApiDocumentCompilationRuntimeAssembly | undefined {
  if (!config) {
    return undefined;
  }
  if (!compute) {
    throw new Error("Document compilation runtime requires an in-process compute runtime");
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

  const compilationJobs = createDurableDocumentCompilationJobStateMachine({
    assertCompilationAdmission: (input) =>
      repositories.legacyBootstraps.assertCompilationAdmission(input),
    attempts: repositories.attempts,
    generateAttemptId: randomUUID,
    generateOutboxId: randomUUID,
    generatePublicationGenerationId: randomUUID,
    jobs: adapter.jobs,
    maxExecutionAttempts: config.maxAttempts,
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
      chunkerVersion: "knowledge-compute-chunker-v1",
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
    ...(visual
      ? {
          visualBuilder: createVisualEmbeddingProjectionBuilder({
            maxBatchSize: embeddingBatchSize,
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
            profiles: repositories.profiles,
            projections: {
              getMany: repositories.projections.getMany.bind(repositories.projections),
            },
            publications: repositories.publications,
            reindexer,
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
  const semanticPostProcessor = createCandidateSemanticPostProcessor({
    graph: repositories.graph,
    nodes: repositories.nodes,
    semantic,
  });
  const initialProfiles = createDocumentCompilationInitialProfileCoordinator({
    activations: initialProfileActivations,
    manifests: repositories.manifests,
    preflight: modelCapabilityPreflight,
    profiles: repositories.profiles,
  });
  const compileCandidate = createDocumentCompilationWorkerAttemptProcessor({
    coordinator,
    createWorker: ({ candidateComposer, frozenEmbeddingProfile, frozenRetrievalProfile, jobs }) =>
      createDocumentCompilationWorker({
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
        indexOverrides: documentIndexOverrides,
        knowledgePaths: repositories.paths,
        ...(multimodal?.documentMultimodalImageVariantGenerator
          ? {
              multimodalImageVariantGenerator: multimodal.documentMultimodalImageVariantGenerator,
            }
          : {}),
        ...(multimodal?.documentMultimodalLocalAssetAllowlist
          ? { multimodalLocalAssetAllowlist: multimodal.documentMultimodalLocalAssetAllowlist }
          : {}),
        ...(multimodal?.documentMultimodalMaxExtractedAssets
          ? { multimodalMaxExtractedAssets: multimodal.documentMultimodalMaxExtractedAssets }
          : {}),
        ...(multimodal?.documentMultimodalMaxLocalAssetBytes
          ? { multimodalMaxLocalAssetBytes: multimodal.documentMultimodalMaxLocalAssetBytes }
          : {}),
        ...(multimodal?.documentMultimodalMaxPdfRasterizedAssets
          ? {
              multimodalMaxPdfRasterizedAssets: multimodal.documentMultimodalMaxPdfRasterizedAssets,
            }
          : {}),
        multimodalManifests: repositories.multimodalManifests,
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
        ...(semanticPostProcessor ? { semanticPostProcessor } : {}),
        ...(visual ? { visualEmbeddingModel: visual.model } : {}),
      }),
    fingerprintMaterial,
    initialProfiles,
    profiles: repositories.profiles,
  });
  const processor = createDocumentCompilationPublicationProcessor({
    assets: repositories.assets,
    compileCandidate,
    coordinator,
    evaluator,
  });
  const workerId = `${process.pid}-${randomUUID()}`;
  const runtime = createDocumentCompilationRuntime({
    attempts: repositories.attempts,
    heartbeatIntervalMs: Math.max(1, Math.floor(config.leaseMs / 3)),
    initialRetryDelayMs: config.retryBaseMs,
    intervalMs: config.tickMs,
    jobs: adapter.jobs,
    leaseMs: config.leaseMs,
    maxBatchSize: config.batchSize,
    maxRetryDelayMs: config.retryMaxMs,
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

function createCandidateSemanticPostProcessor({
  graph,
  nodes,
  semantic,
}: {
  readonly graph?: GraphIndexRepository | undefined;
  readonly nodes: KnowledgeNodeRepository;
  readonly semantic: CreateApiDocumentCompilationRuntimeOptions["semantic"];
}) {
  if (!semantic?.semanticEntityExtractionProvider) {
    return undefined;
  }
  if (!graph) {
    throw new Error(
      "Document compilation semantic candidate processing requires the graph repository",
    );
  }
  const maxNodes = semantic.semanticEntityExtractionMaxNodesPerRun ?? 100;
  const entityExtraction = createEntityExtractionFlow({
    maxBatchSize: maxNodes,
    maxEntitiesPerNode: semantic.semanticEntityExtractionMaxEntitiesPerNode ?? 50,
    model: semantic.semanticEntityExtractionModel ?? "gpt-4.1-mini",
    nodes,
    now: () => new Date().toISOString(),
    provider: semantic.semanticEntityExtractionProvider,
  });
  const extractionQuality = createExtractionQualityControlFlow({
    maxBatchSize: maxNodes,
    maxEligibleEntitiesPerNode: semantic.semanticEntityExtractionMaxEntitiesPerNode ?? 50,
    nodes,
    now: () => new Date().toISOString(),
  });
  const relationExtraction = semantic.semanticRelationExtractionProvider
    ? createRelationExtractionFlow({
        maxBatchSize: maxNodes,
        maxRelationsPerNode: semantic.semanticRelationExtractionMaxRelationsPerNode ?? 50,
        model:
          semantic.semanticRelationExtractionModel ??
          semantic.semanticEntityExtractionModel ??
          "gpt-4.1-mini",
        nodes,
        now: () => new Date().toISOString(),
        provider: semantic.semanticRelationExtractionProvider,
      })
    : undefined;

  return createSemanticIngestionPostProcessor({
    entityExtraction,
    extractionQuality,
    graph,
    maxNodesPerArtifact: maxNodes,
    nodes,
    ...(relationExtraction ? { relationExtraction } : {}),
  });
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
