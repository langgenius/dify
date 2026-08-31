import { randomUUID } from "node:crypto";

import {
  createNodePlatformAdapter,
  createNodeRemoteDocumentImageFetcher,
} from "@knowledge/adapters/node";
import {
  type KnowledgeSpaceEmbeddingResolver,
  createDatabaseDeletionObjectWriteAdmission,
  createDatabaseHybridRetrievalRepository,
  createDatabasePublishedGraphIndexRepository,
  createDatabasePublishedKnowledgeSpaceRuntimeSnapshotResolver,
  createDatabasePublishedPageIndexRepository,
  createDatabaseRetrievalExecutionLeaseRepository,
  createDeletionLifecycleFenceGuard,
  createDocumentMultimodalCandidateResolver,
  createGoldenQuestionEvidenceMatcher,
  createHybridQueryGenerator,
  createInMemoryKnowledgeSpaceManifestRepository,
  createJointCasSourceLogicalRevisionPublisher,
  createKnowledgeGateway,
  createKnowledgeSpaceAuthorizationGuard,
  createKnowledgeSpaceEmbeddingResolver,
  createKnowledgeSpaceOutlineSummaryEnhancer,
  createLlmAnswerQueryGenerator,
  createLlmAutoRetrievalModeResolver,
  createLlmSemanticChunker,
  createModelCapabilityPreflight,
  createPageIndexFindabilityEvaluator,
  createPageIndexLayeredTreeSearch,
  createPageIndexSemanticTreeSearch,
  createPageIndexWholeTreeSelector,
  createProfileAwareKnowledgeSpaceManifestRepository,
  createProfileAwareQueryGenerator,
  createPublishedProjectionReadSnapshotResolver,
  createQueryImageAwareQueryGenerator,
  createResearchAwareQueryGenerator,
  createResearchEvidenceReasoning,
  createResearchQueryVectorizer,
  createRetrievalExecutionLeaseCoordinator,
  createRetrievalPlanner,
  createRetrievalTestExecutor,
  createSourceConnectionService,
  createStaticSourceProviderCatalog,
} from "@knowledge/api";

import { createApiProfileReasoningCapability } from "./answer-generation-options";
import { createApiAuthVerifier } from "./auth-options";
import {
  createApiBufferedDocumentUploadAdmission,
  createApiBufferedDocumentUploadOptions,
} from "./buffered-document-upload-options";
import { createApiCapabilityV2Assembly } from "./capability-v2-options";
import { createApiComputeRuntime } from "./compute-options";
import {
  assertApiDatabaseConnectionReady,
  waitForApiDatabaseStartup,
} from "./database-startup-options";
import { createApiDatasourceInvocationClient } from "./datasource-runtime-options";
import { createDifyModelCapabilityCatalog } from "./dify-model-capability-catalog";
import { createApiDifyModelRuntimeClient } from "./dify-model-runtime-options";
import { createApiResearchTaskDirectStreamAssembly } from "./direct-stream-options";
import {
  assertApiDocumentWriteSafety,
  createApiDocumentCompilationOptions,
} from "./document-compilation-options";
import {
  createApiDocumentCompilationRuntime,
  createApiProfileMigrationGatewayOptions,
} from "./document-compilation-runtime-options";
import {
  assertApiDurableDeletionDataReadiness,
  createApiDurableDeletionAssembly,
} from "./durable-deletion-options";
import { createApiEmbeddingOptions } from "./embedding-options";
import { createApiGraphExpansionOptions } from "./graph-expansion-options";
import { createApiIngestionModelRuntimeOptions } from "./ingestion-model-runtime-options";
import { createApiKnowledgeSpaceProfileBackfillAssembly } from "./knowledge-space-profile-backfill-options";
import {
  createApiKnowledgeSpaceSemanticIngestionOptions,
  createApiSemanticEntityExtractionOptions,
} from "./llm-options";
import { createApiMultimodalAnswerOptions } from "./multimodal-answer-options";
import { createApiMultimodalEnrichmentOptions } from "./multimodal-enrichment-options";
import { createApiMultimodalOptions } from "./multimodal-options";
import { createApiOnlineDocumentOptions } from "./online-document-options";
import { createApiOnlineDriveOptions } from "./online-drive-options";
import { createApiKnowledgeFsOperationalMetrics } from "./operational-metrics";
import { createApiDocumentParser } from "./parser-options";
import { createApiQueryImageExpansionProvider } from "./query-image-expansion-options";
import { createApiQueryImageResolver } from "./query-image-options";
import { createApiDeploymentReadinessChecks } from "./readiness-options";
import {
  createApiRelevanceTriageOptions,
  createApiTriageCorpusLoader,
  createApiWorkflowFailedRetrievalTriage,
} from "./relevance-triage-signals";
import {
  assertApiAgentWorkspaceSnapshotDurability,
  assertApiKnowledgeFsDurability,
  createApiDatabaseRepositories,
} from "./repository-options";
import { createApiRerankerOptions } from "./reranker-options";
import { createApiResearchEvidenceReasoningOptions } from "./research-evidence-reasoning-options";
import {
  assertApiResearchTaskDurability,
  createApiResearchTaskRuntime,
} from "./research-task-runtime-options";
import { createApiRetriever } from "./retriever-options";
import { createApiSourceCredentialTesterOptions } from "./source-credential-options";
import { createApiSourceBulkRemovalRequester } from "./source-product-options";
import { createApiTidbFtsPostingBackfillAssembly } from "./tidb-fts-posting-backfill-options";
import { createApiTracingOptions } from "./tracing-options";
import {
  createApiUploadSessionAssembly,
  createApiUploadSessionOptions,
} from "./upload-session-options";
import { createApiVisualEmbeddingOptions } from "./visual-embedding-options";
import { createApiWebsiteCrawlOptions } from "./website-crawl-options";

const RETRIEVAL_MAX_TOP_K = 100;

const documentCompilationOptions = createApiDocumentCompilationOptions();
const bufferedDocumentUploadOptions = createApiBufferedDocumentUploadOptions();
const bufferedDocumentUploadAdmission = createApiBufferedDocumentUploadAdmission();
const uploadSessionOptions = createApiUploadSessionOptions();
const researchTaskDirectStream = createApiResearchTaskDirectStreamAssembly({
  emit: (metric) => process.stdout.write(`${JSON.stringify(metric)}\n`),
  env: process.env,
});

const adapter = createNodePlatformAdapter();
const documentRemoteAssetFetcher = createNodeRemoteDocumentImageFetcher();
const queryImageResolver = createApiQueryImageResolver({ env: process.env });
const queryImageExpansionProvider = createApiQueryImageExpansionProvider(process.env);
const operationalMetrics = createApiKnowledgeFsOperationalMetrics({
  emit: (metric) => {
    process.stdout.write(`${JSON.stringify(metric)}\n`);
  },
});
const ingestionModelRuntimeOptions = createApiIngestionModelRuntimeOptions(
  process.env,
  operationalMetrics.ingestionModel,
);
const capabilityV2 = createApiCapabilityV2Assembly({
  audit: {
    record(event) {
      process.stdout.write(
        `${JSON.stringify({ event: "knowledge_fs.capability_v2.authorized", ...event })}\n`,
      );
    },
  },
  env: process.env,
  metrics: operationalMetrics.capabilityV2,
});
const auth = capabilityV2.selected ? undefined : createApiAuthVerifier();
const baseReadinessChecks = createApiDeploymentReadinessChecks({
  authVerifierConfigured: auth !== undefined || capabilityV2.authenticator !== undefined,
  env: process.env,
});
const legacyAccessMutationsReadOnly =
  process.env.KNOWLEDGE_LEGACY_ACL_READ_ONLY?.trim().toLowerCase() === "true";
const legacyAuthorizationRemoved =
  process.env.KNOWLEDGE_LEGACY_AUTHORIZATION_REMOVED?.trim().toLowerCase() === "true";
const integratedModeEnabled =
  process.env.KNOWLEDGE_INTEGRATED_MODE_ENABLED?.trim().toLowerCase() === "true";
const compute = createApiComputeRuntime();
const embeddingOptions = createApiEmbeddingOptions(
  process.env,
  operationalMetrics.embeddingRequests,
  ingestionModelRuntimeOptions.modelRequestGate,
);
const parser = createApiDocumentParser();
const visualEmbeddingOptions = createApiVisualEmbeddingOptions({
  modelRequestGate: ingestionModelRuntimeOptions.modelRequestGate,
  objectStorage: adapter.objectStorage,
});
const multimodalOptions = {
  ...createApiMultimodalOptions(),
  documentMultimodalRemoteAssetFetcher: documentRemoteAssetFetcher,
};
const multimodalAnswerOptions = createApiMultimodalAnswerOptions({
  objectStorage: adapter.objectStorage,
});
const multimodalEnrichmentOptions = createApiMultimodalEnrichmentOptions({
  objectStorage: adapter.objectStorage,
});
const rerankerOptions = createApiRerankerOptions();
const semanticEntityExtractionOptions = createApiSemanticEntityExtractionOptions(process.env, {
  metrics: operationalMetrics.ingestionModelCalls,
  modelRequestGate: ingestionModelRuntimeOptions.modelRequestGate,
});
const profileReasoningCapability = createApiProfileReasoningCapability();
const researchEvidenceReasoningOptions = createApiResearchEvidenceReasoningOptions();
const pageIndexSemanticTreeSearch = createPageIndexSemanticTreeSearch({
  batchSize: 5,
  maxConcurrentBatches: 4,
  maxOutputTokens: profileReasoningCapability.maxOutputTokens,
  maxTextCharsPerCandidate: 1_500,
  modelRequestGate: ingestionModelRuntimeOptions.modelRequestGate,
  providerFactory: profileReasoningCapability.providerFactory,
  timeoutMs: 20_000,
});
const pageIndexLayeredTreeSearch = createPageIndexLayeredTreeSearch({
  maxFrontierNodes: 40,
  maxOutputTokens: profileReasoningCapability.maxOutputTokens,
  maxPromptTokens: 8_000,
  maxResponseChars: 32_000,
  maxSelectedNodesPerStep: 8,
  maxSummaryChars: 600,
  maxTitleChars: 200,
  maxTreeNodes: 10_000,
  modelRequestGate: ingestionModelRuntimeOptions.modelRequestGate,
  providerFactory: profileReasoningCapability.providerFactory,
  timeoutMs: 20_000,
});
const pageIndexFindabilityEvaluator = createPageIndexFindabilityEvaluator({
  evaluatorVersion: "pageindex-layered-findability-v1",
  layeredTreeSearch: pageIndexLayeredTreeSearch,
  maxConsecutiveModelFailures: 3,
  maxQuestions: 20,
  maxTreeDepth: 8,
  minMeanReciprocalRank: 0.5,
  minPathRecallAtK: 0.8,
  minQuestions: 3,
  minRecallAtK: 0.7,
  metrics: operationalMetrics.ingestionModelCalls,
  topK: 5,
});
const pageIndexWholeTreeSelector = createPageIndexWholeTreeSelector({
  maxOutputTokens: profileReasoningCapability.maxOutputTokens,
  maxPromptTokens: 24_000,
  maxResponseChars: 64_000,
  maxSelectedNodes: 8,
  maxSummaryChars: 600,
  maxTitleChars: 200,
  maxTreeNodes: 2_000,
  minimumSummaryCoverage: 0.5,
  modelRequestGate: ingestionModelRuntimeOptions.modelRequestGate,
  providerFactory: profileReasoningCapability.providerFactory,
  timeoutMs: 20_000,
});
const knowledgeSpaceSemanticIngestionOptions = createApiKnowledgeSpaceSemanticIngestionOptions({
  providerFactory: profileReasoningCapability.providerFactory,
});
const modelCapabilityCatalog = createDifyModelCapabilityCatalog({
  client: createApiDifyModelRuntimeClient(process.env),
});
const modelCapabilityPreflight = createModelCapabilityPreflight({
  catalog: modelCapabilityCatalog,
  embeddingProviderFactory: (selection) => {
    if (!("knowledgeSpaceEmbeddingProviderFactory" in embeddingOptions)) {
      throw new Error("Dynamic embedding capability is unavailable");
    }
    return embeddingOptions.knowledgeSpaceEmbeddingProviderFactory(selection);
  },
  reasoningProviderFactory: profileReasoningCapability.providerFactory,
  rerankerProviderFactory: (selection) => {
    if (!rerankerOptions?.providerFactory) {
      throw new Error("Dynamic rerank capability is unavailable");
    }
    return rerankerOptions.providerFactory(selection);
  },
  vectorStorageDialect: adapter.database.dialect,
});
const datasourceInvocationClient = createApiDatasourceInvocationClient(process.env);
const websiteCrawlOptions = createApiWebsiteCrawlOptions({
  client: datasourceInvocationClient,
});
const onlineDocumentOptions = createApiOnlineDocumentOptions({
  client: datasourceInvocationClient,
});
const onlineDriveOptions = createApiOnlineDriveOptions({
  client: datasourceInvocationClient,
});
const sourceCredentialTesterOptions = createApiSourceCredentialTesterOptions({
  client: datasourceInvocationClient,
});
const difyManagedDatasourceFields = [
  {
    name: "credentialId",
    required: true,
    secret: false,
    type: "string" as const,
  },
  { name: "pluginId", required: true, secret: false, type: "string" as const },
  { name: "provider", required: true, secret: false, type: "string" as const },
  {
    name: "datasource",
    required: true,
    secret: false,
    type: "string" as const,
  },
  {
    name: "providerKind",
    required: true,
    secret: false,
    type: "string" as const,
  },
] as const;
const sourceOAuthProviders = { get: (_providerId: string) => undefined };
// These IDs are persisted contract values. Their runtime and credential owner is always Dify.
const sourceProviderCatalog = createStaticSourceProviderCatalog([
  {
    authKinds: ["endpoint"],
    available: true,
    capabilities: ["website-crawl"],
    configuration: difyManagedDatasourceFields,
    displayName: "Dify website crawl",
    id: "plugin-daemon-website",
  },
  {
    authKinds: ["endpoint"],
    available: true,
    capabilities: ["online-document"],
    configuration: difyManagedDatasourceFields,
    displayName: "Dify online document",
    id: "plugin-daemon-online-document",
  },
  {
    authKinds: ["endpoint"],
    available: true,
    capabilities: ["online-drive"],
    configuration: difyManagedDatasourceFields,
    displayName: "Dify online drive",
    id: "plugin-daemon-online-drive",
  },
]);
const tracingOptions = createApiTracingOptions();
const autoRetrievalModeResolver = createLlmAutoRetrievalModeResolver({
  providerFactory: profileReasoningCapability.providerFactory,
  ...(tracingOptions ? { traces: tracingOptions.traces } : {}),
});
const databaseRepositories = createApiDatabaseRepositories({
  database: adapter.database,
});
const retrievalExecutionLeases =
  databaseRepositories.durableDeletionEnabled && databaseRepositories.usesDatabaseRepositories
    ? createRetrievalExecutionLeaseCoordinator({
        leaseTtlMs: 60_000,
        repository: createDatabaseRetrievalExecutionLeaseRepository({
          database: adapter.database,
        }),
      })
    : undefined;
await waitForApiDatabaseStartup({
  env: process.env,
  onRetry: ({ attempt, code, delayMs }) => {
    process.stderr.write(
      `${JSON.stringify({
        attempt,
        code,
        delayMs,
        event: "knowledge_fs.database.startup_retry",
      })}\n`,
    );
  },
  operation: async () => {
    await assertApiDatabaseConnectionReady(adapter.database);
    // The 0017 migration intentionally leaves ambiguous legacy bundles quarantined as NULL scope.
    // Do not expose destructive routes until operators have run the bounded purge to zero.
    await assertApiDurableDeletionDataReadiness({
      database: adapter.database,
      enabled: databaseRepositories.durableDeletionEnabled,
    });
  },
});
const durableDeletion = createApiDurableDeletionAssembly({
  adapter,
  credentialMode: "dify-managed",
  enabled: databaseRepositories.durableDeletionEnabled,
  production: process.env.NODE_ENV === "production",
  repository: databaseRepositories.durableDeletionRepository,
  usesDatabaseRepositories: databaseRepositories.usesDatabaseRepositories,
});
const deletionLifecycleFence = databaseRepositories.deletionLifecycleFenceReader
  ? createDeletionLifecycleFenceGuard(databaseRepositories.deletionLifecycleFenceReader)
  : undefined;
const deletionObjectWriteAdmission =
  databaseRepositories.durableDeletionEnabled && databaseRepositories.usesDatabaseRepositories
    ? createDatabaseDeletionObjectWriteAdmission(adapter.database)
    : undefined;
const tidbFtsPostingBackfill = createApiTidbFtsPostingBackfillAssembly({
  repository: databaseRepositories.tidbFtsPostingBackfills,
});
assertApiDocumentWriteSafety({
  durableCompilationEnabled: documentCompilationOptions !== undefined,
  production: process.env.NODE_ENV === "production",
  usesDatabaseRepositories: databaseRepositories.usesDatabaseRepositories,
});
const repositoryOptions = databaseRepositories.gatewayOptions;
const integratedProvisioningReady = Boolean(
  integratedModeEnabled &&
    capabilityV2.authenticator &&
    databaseRepositories.capabilityGrantProvenance &&
    databaseRepositories.difyIntegrationFreezes &&
    databaseRepositories.difyIntegrationStates &&
    databaseRepositories.integratedKnowledgeSpaceProvisioning,
);
let directUploadReady = false;
let researchDirectStreamReady = false;
const readinessChecks = {
  ...baseReadinessChecks,
  ...(integratedModeEnabled
    ? {
        "integrated-provisioning.configuration": () => integratedProvisioningReady,
      }
    : {}),
  ...(uploadSessionOptions ? { "direct-upload.configuration": () => directUploadReady } : {}),
  ...(researchTaskDirectStream
    ? {
        "research-direct-stream.configuration": () => researchDirectStreamReady,
      }
    : {}),
};
assertApiAgentWorkspaceSnapshotDurability({
  production: process.env.NODE_ENV === "production",
  repository: databaseRepositories.agentWorkspaceSnapshots,
});
assertApiKnowledgeFsDurability({
  leases: databaseRepositories.knowledgeFsLeases,
  production: process.env.NODE_ENV === "production",
  sessions: databaseRepositories.knowledgeFsSessions,
});
const sourceRepository = repositoryOptions.sources;
const knowledgeSpaceProfileBackfill = createApiKnowledgeSpaceProfileBackfillAssembly({
  preflight: modelCapabilityPreflight,
  publicationBindings: databaseRepositories.knowledgeSpaceProfilePublications,
  repository: databaseRepositories.knowledgeSpaceProfileBackfills,
});
// Keep one manifest repository instance shared by the control plane, ingestion, and query paths.
// In database mode this is the durable repository; local mode uses the same in-memory instance
// rather than allowing the gateway and resolver to create disconnected stores.
const rawKnowledgeSpaceManifests =
  repositoryOptions.knowledgeSpaceManifests ??
  createInMemoryKnowledgeSpaceManifestRepository({
    maxListLimit: 100,
    maxManifests: 1_000,
  });
const knowledgeSpaceManifests = databaseRepositories.knowledgeSpaceProfiles
  ? createProfileAwareKnowledgeSpaceManifestRepository({
      manifests: rawKnowledgeSpaceManifests,
      profiles: databaseRepositories.knowledgeSpaceProfiles,
    })
  : rawKnowledgeSpaceManifests;
const documentOutlineSummaryEnhancer = createKnowledgeSpaceOutlineSummaryEnhancer({
  ...(databaseRepositories.documentOutlineSummaryCheckpoints
    ? { checkpoints: databaseRepositories.documentOutlineSummaryCheckpoints }
    : {}),
  manifests: knowledgeSpaceManifests,
  maxBatchInputChars: ingestionModelRuntimeOptions.outlineSummaryBatchMaxInputChars,
  maxBatchSize: ingestionModelRuntimeOptions.outlineSummaryBatchSize,
  maxConcurrentSummaries: ingestionModelRuntimeOptions.outlineSummaryMaxConcurrency,
  maxInputChars: 12_000,
  maxOutputTokens: profileReasoningCapability.maxOutputTokens,
  maxSummaryChars: 2_000,
  metrics: operationalMetrics.outlineSummary,
  modelCallMetrics: operationalMetrics.ingestionModelCalls,
  modelRequestGate: ingestionModelRuntimeOptions.modelRequestGate,
  providerFactory: profileReasoningCapability.providerFactory,
});
const documentSemanticChunker = createLlmSemanticChunker({
  ...(databaseRepositories.documentSemanticWindowCheckpoints
    ? { checkpoints: databaseRepositories.documentSemanticWindowCheckpoints }
    : {}),
  maxConcurrentWindows: ingestionModelRuntimeOptions.semanticExtractionMaxConcurrency,
  maxNodes: 20_000,
  maxProviderOutputRetries: 1,
  maxWindowChars: ingestionModelRuntimeOptions.semanticChunkingMaxWindowChars,
  metrics: operationalMetrics.ingestionModelCalls,
  modelRequestGate: ingestionModelRuntimeOptions.modelRequestGate,
  reasoningProviderFactory: profileReasoningCapability.providerFactory,
});
const relevanceTriageOptions = createApiRelevanceTriageOptions({
  ...(repositoryOptions.documentAssets ? { documentAssets: repositoryOptions.documentAssets } : {}),
  ...(repositoryOptions.documentOutlines
    ? { documentOutlines: repositoryOptions.documentOutlines }
    : {}),
  ...(repositoryOptions.graphIndex ? { graphIndex: repositoryOptions.graphIndex } : {}),
});
const workflowFailedRetrievalTriage = createApiWorkflowFailedRetrievalTriage({
  loadCorpus: createApiTriageCorpusLoader({
    ...(repositoryOptions.documentAssets
      ? { documentAssets: repositoryOptions.documentAssets }
      : {}),
    ...(repositoryOptions.documentOutlines
      ? { documentOutlines: repositoryOptions.documentOutlines }
      : {}),
    ...(repositoryOptions.graphIndex ? { graphIndex: repositoryOptions.graphIndex } : {}),
  }),
  manifests: knowledgeSpaceManifests,
  maxOutputTokens: Math.min(profileReasoningCapability.maxOutputTokens, 32),
  providerFactory: profileReasoningCapability.providerFactory,
});
const publishedPageIndex =
  repositoryOptions.projectionSetPublications && repositoryOptions.projectionSetPublicationMembers
    ? createDatabasePublishedPageIndexRepository({
        database: adapter.database,
        maxLeafLimit: RETRIEVAL_MAX_TOP_K,
        maxOutlinePageSize: RETRIEVAL_MAX_TOP_K,
        maxProjectionRows: 1_000,
      })
    : undefined;
const publishedGraph =
  process.env.DATABASE_URL?.trim() && repositoryOptions.graphIndex
    ? createDatabasePublishedGraphIndexRepository({
        database: adapter.database,
        maxSeedLookupSize: 1_000,
      })
    : undefined;
// The strict production query stack is one capability: head resolver, publication members,
// ordinary hybrid joins, and independent PageIndex must come up together. Merely having a
// DATABASE_URL is insufficient when durable repositories were explicitly disabled.
const retrievalRepository = publishedPageIndex
  ? createDatabaseHybridRetrievalRepository({
      database: adapter.database,
      maxTopK: RETRIEVAL_MAX_TOP_K,
      requirePublishedSnapshot: true,
    })
  : undefined;
const embeddingResolver =
  "knowledgeSpaceEmbeddingProviderFactory" in embeddingOptions
    ? createKnowledgeSpaceEmbeddingResolver({
        // Production assembly deliberately has no deployment-level fallback. A space without a
        // persisted embedding profile fails closed and must be configured or explicitly migrated.
        manifests: knowledgeSpaceManifests,
        providerFactory: embeddingOptions.knowledgeSpaceEmbeddingProviderFactory,
      })
    : undefined;
const researchEvidenceReasoning = createResearchEvidenceReasoning({
  maxOutputTokens: researchEvidenceReasoningOptions.maxOutputTokens,
  modelRequestGate: ingestionModelRuntimeOptions.modelRequestGate,
  providerFactory: profileReasoningCapability.providerFactory,
  timeoutMs: researchEvidenceReasoningOptions.timeoutMs,
});
const documentCompilationRuntime = createApiDocumentCompilationRuntime({
  adapter,
  compute,
  config: documentCompilationOptions,
  createModelBudget: ingestionModelRuntimeOptions.createDocumentModelBudget,
  ...(deletionLifecycleFence ? { deletionFence: deletionLifecycleFence } : {}),
  ...(deletionObjectWriteAdmission ? { objectWriteAdmission: deletionObjectWriteAdmission } : {}),
  embeddingResolver,
  ...(databaseRepositories.pageIndexFindability && repositoryOptions.goldenQuestions
    ? {
        findability: {
          evaluator: pageIndexFindabilityEvaluator,
          goldenQuestions: repositoryOptions.goldenQuestions,
          onError: (error) => {
            process.stderr.write(
              `${JSON.stringify({
                error:
                  error instanceof Error ? error.message : "unknown PageIndex findability error",
                event: "knowledge_fs.page_index.findability_error",
              })}\n`,
            );
          },
          repository: databaseRepositories.pageIndexFindability,
        },
      }
    : {}),
  ...(databaseRepositories.knowledgeSpaceUnpublishedProfileActivations
    ? {
        initialProfileActivations: databaseRepositories.knowledgeSpaceUnpublishedProfileActivations,
      }
    : {}),
  ...(parser.heavyWorkloadMaxConcurrency === undefined
    ? {}
    : { heavyMaterializationMaxConcurrency: parser.heavyWorkloadMaxConcurrency }),
  modelCallMetrics: operationalMetrics.ingestionModelCalls,
  modelCapabilityPreflight,
  metrics: operationalMetrics.durableTasks,
  multimodal: multimodalOptions,
  outlineSummaryEnhancer: documentOutlineSummaryEnhancer,
  parser,
  ...(repositoryOptions.knowledgeSpaceAccess &&
  databaseRepositories.knowledgeSpaceProfileMigrations &&
  databaseRepositories.knowledgeSpaceProfilePublications
    ? {
        profileMigration: {
          access: repositoryOptions.knowledgeSpaceAccess,
          bindings: databaseRepositories.knowledgeSpaceProfilePublications,
          ...(databaseRepositories.capabilityGrantProvenance
            ? {
                capabilityGrants: databaseRepositories.capabilityGrantProvenance,
              }
            : {}),
          repository: databaseRepositories.knowledgeSpaceProfileMigrations,
        },
      }
    : {}),
  repositories: {
    ...(repositoryOptions.parseArtifacts ? { artifacts: repositoryOptions.parseArtifacts } : {}),
    ...(repositoryOptions.documentAssets ? { assets: repositoryOptions.documentAssets } : {}),
    ...(databaseRepositories.documentCompilationAttempts
      ? { attempts: databaseRepositories.documentCompilationAttempts }
      : {}),
    ...(repositoryOptions.documentChunks ? { chunks: repositoryOptions.documentChunks } : {}),
    ...(repositoryOptions.graphIndex ? { graph: repositoryOptions.graphIndex } : {}),
    ...(databaseRepositories.legacySpacePublicationBootstraps
      ? {
          legacyBootstraps: databaseRepositories.legacySpacePublicationBootstraps,
        }
      : {}),
    ...(databaseRepositories.pageIndexUpgradeBackfills
      ? {
          pageIndexUpgradeBackfills: databaseRepositories.pageIndexUpgradeBackfills,
        }
      : {}),
    manifests: knowledgeSpaceManifests,
    ...(repositoryOptions.logicalDocuments
      ? { logicalDocuments: repositoryOptions.logicalDocuments }
      : {}),
    ...(repositoryOptions.projectionSetPublicationMembers
      ? { members: repositoryOptions.projectionSetPublicationMembers }
      : {}),
    ...(repositoryOptions.documentMultimodalManifests
      ? { multimodalManifests: repositoryOptions.documentMultimodalManifests }
      : {}),
    ...(repositoryOptions.knowledgeNodes ? { nodes: repositoryOptions.knowledgeNodes } : {}),
    ...(repositoryOptions.documentOutlines ? { outlines: repositoryOptions.documentOutlines } : {}),
    ...(repositoryOptions.knowledgePaths ? { paths: repositoryOptions.knowledgePaths } : {}),
    ...(repositoryOptions.projections ? { projections: repositoryOptions.projections } : {}),
    ...(databaseRepositories.knowledgeSpaceProfiles
      ? { profiles: databaseRepositories.knowledgeSpaceProfiles }
      : {}),
    ...(repositoryOptions.projectionSetPublications
      ? { publications: repositoryOptions.projectionSetPublications }
      : {}),
    ...(repositoryOptions.documentSettings ? { settings: repositoryOptions.documentSettings } : {}),
    ...(repositoryOptions.documentProcessingTasks
      ? { tasks: repositoryOptions.documentProcessingTasks }
      : {}),
  },
  semantic: {
    ...knowledgeSpaceSemanticIngestionOptions,
    modelCallMetrics: operationalMetrics.ingestionModelCalls,
    modelRequestGate: ingestionModelRuntimeOptions.modelRequestGate,
    semanticExtractionBatchSize: ingestionModelRuntimeOptions.semanticExtractionBatchSize,
    semanticExtractionMaxConcurrency: ingestionModelRuntimeOptions.semanticExtractionMaxConcurrency,
  },
  semanticMetrics: operationalMetrics.semanticEnrichment,
  semanticChunker: documentSemanticChunker,
  ...(visualEmbeddingOptions
    ? {
        visual: {
          model: visualEmbeddingOptions.model,
          provider: visualEmbeddingOptions.provider,
        },
      }
    : {}),
});
const sourceProductAuthorization = repositoryOptions.knowledgeSpaceAccess
  ? createKnowledgeSpaceAuthorizationGuard({
      access: repositoryOptions.knowledgeSpaceAccess,
    })
  : undefined;
const sourceConnectionService =
  sourceProductAuthorization &&
  repositoryOptions.knowledgeSpaceAccess &&
  databaseRepositories.sourceConnections
    ? createSourceConnectionService({
        access: repositoryOptions.knowledgeSpaceAccess,
        allowDevelopmentLoopbackOAuthRedirects:
          process.env.NODE_ENV !== "production" &&
          process.env.SOURCE_OAUTH_ALLOW_LOOPBACK === "true",
        allowedOAuthRedirectUris: (process.env.SOURCE_OAUTH_REDIRECT_URIS ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        authorization: sourceProductAuthorization,
        catalog: sourceProviderCatalog,
        credentialMode: "dify-managed",
        oauth: sourceOAuthProviders,
        repository: databaseRepositories.sourceConnections,
      })
    : undefined;
const sourceLogicalRevisions =
  documentCompilationRuntime?.sourceCompilationPublication &&
  repositoryOptions.logicalDocuments &&
  databaseRepositories.durableDeletionRepository
    ? createJointCasSourceLogicalRevisionPublisher({
        compilationPublication: documentCompilationRuntime.sourceCompilationPublication,
        logicalDocuments: repositoryOptions.logicalDocuments,
        remoteDeletions: databaseRepositories.durableDeletionRepository,
      })
    : undefined;
const sourceBulkRemoval = createApiSourceBulkRemovalRequester({
  production: process.env.NODE_ENV === "production",
  repository: databaseRepositories.durableDeletionRepository,
});
const sourceProduct =
  sourceConnectionService &&
  sourceLogicalRevisions &&
  sourceBulkRemoval &&
  databaseRepositories.sourceProductWorkflows
    ? {
        bulkRemoval: sourceBulkRemoval,
        connections: sourceConnectionService,
        logicalRevisions: sourceLogicalRevisions,
        providers: sourceProviderCatalog,
        repository: databaseRepositories.sourceProductWorkflows,
        workerId: `source-product-workflow:${randomUUID()}`,
      }
    : undefined;
if (process.env.NODE_ENV === "production" && !sourceProduct) {
  throw new Error(
    "Production Source product requires durable connections/workflows, credential ownership, logical documents, and compilation publication",
  );
}
const visualQueryEmbeddingOptions = visualEmbeddingOptions?.queryEmbeddingProvider
  ? {
      embeddingModel: visualEmbeddingOptions.queryEmbeddingModel ?? visualEmbeddingOptions.model,
      embeddings: visualEmbeddingOptions.queryEmbeddingProvider,
    }
  : undefined;
const retrievalPlanner = createRetrievalPlanner({
  maxTopK: RETRIEVAL_MAX_TOP_K,
});
// Undefined when KNOWLEDGE_GRAPH_EXPANSION=off — the retriever then skips the graph wrapper.
const graphExpansionOptions = createApiGraphExpansionOptions();
const retriever = retrievalRepository
  ? createApiRetriever({
      embeddingEnabled: embeddingResolver !== undefined,
      ...(databaseRepositories.tidbFtsPostingBackfills
        ? { ftsReadiness: databaseRepositories.tidbFtsPostingBackfills }
        : {}),
      ...(repositoryOptions.graphIndex && graphExpansionOptions
        ? {
            graph: repositoryOptions.graphIndex,
            graphExpansion: graphExpansionOptions,
            ...(publishedGraph ? { publishedGraph } : {}),
          }
        : {}),
      ...(publishedPageIndex
        ? {
            pageIndex: publishedPageIndex,
            ...(databaseRepositories.pageIndexFindability
              ? {
                  pageIndexFindability: databaseRepositories.pageIndexFindability,
                }
              : {}),
            pageIndexLayeredTreeSearch,
            pageIndexSemanticTreeSearch,
            pageIndexWholeTreeSelector,
          }
        : repositoryOptions.documentOutlines
          ? { outlines: repositoryOptions.documentOutlines }
          : {}),
      planner: retrievalPlanner,
      metrics: operationalMetrics.retrieval,
      ...(embeddingResolver
        ? {
            researchEvidence: {
              queryVectorizer: createResearchQueryVectorizer(embeddingResolver),
              reasoning: researchEvidenceReasoning,
            },
          }
        : {}),
      repository: retrievalRepository,
      ...(visualEmbeddingOptions?.queryImageEmbeddingProvider &&
      visualEmbeddingOptions.queryMode !== "off"
        ? {
            imageQuery: {
              model: visualEmbeddingOptions.model,
              mode: visualEmbeddingOptions.queryMode,
              provider: visualEmbeddingOptions.queryImageEmbeddingProvider,
            },
          }
        : {}),
      // Production retrieval is profile-only. Keep the provider factory, but never expose the
      // optional deployment compatibility provider as an implicit rerank fallback.
      rerankerOptions: rerankerOptions
        ? { ...rerankerOptions, legacyDefaultConfigured: false }
        : undefined,
      strictPublishedReads: true,
      ...(visualQueryEmbeddingOptions && visualEmbeddingOptions?.queryMode !== "off"
        ? {
            visualQuery: {
              model: visualQueryEmbeddingOptions.embeddingModel,
              mode: visualEmbeddingOptions?.queryMode ?? "fallback",
              provider: visualQueryEmbeddingOptions.embeddings,
            },
          }
        : {}),
    })
  : undefined;
// Text dense and visual dense are separate vector spaces. Query generators produce only the
// text-space vector; createApiRetriever embeds the query independently for the visual leg.
const embeddingGeneratorOptions = {
  ...(embeddingResolver ? { embeddingResolver } : {}),
};
const retrievalTestExecutor = retriever
  ? createRetrievalTestExecutor({
      ...(embeddingResolver ? { embeddingResolver } : {}),
      retriever,
    })
  : undefined;
// Resolves multimodal citations (manifest item id, asset route, page/bbox) without invoking a
// model. Available in database-repository mode, which is also when the retriever exists.
const multimodalCandidateResolver =
  repositoryOptions.documentAssets && repositoryOptions.parseArtifacts
    ? createDocumentMultimodalCandidateResolver({
        assets: repositoryOptions.documentAssets,
        ...(repositoryOptions.documentMultimodalManifests
          ? { manifests: repositoryOptions.documentMultimodalManifests }
          : {}),
        parseArtifacts: repositoryOptions.parseArtifacts,
      })
    : undefined;
const multimodalCitationOptions = {
  ...(multimodalCandidateResolver ? { multimodalCandidateResolver } : {}),
};
const researchAnswerMultimodalOptions = {
  ...multimodalAnswerOptions,
  ...multimodalCitationOptions,
};
// Fast and Deep query-stream requests return bounded evidence and citations without answer
// synthesis. Research uses the same retrieval foundation, then performs one final LLM synthesis.
const retrievalEvidenceQueryGenerator = retriever
  ? createHybridQueryGenerator({
      limit: 5,
      maxAnswerChars: 2_000,
      retriever,
      topK: 10,
      ...embeddingGeneratorOptions,
      ...multimodalCitationOptions,
    })
  : undefined;
const profileLlmAnswerQueryGenerator = retriever
  ? createLlmAnswerQueryGenerator({
      limit: 5,
      maxAnswerChars: 2_000,
      maxOutputTokens: profileReasoningCapability.maxOutputTokens,
      reasoningProviderFactory: profileReasoningCapability.providerFactory,
      retriever,
      temperature: 0,
      topK: 10,
      ...embeddingGeneratorOptions,
      ...researchAnswerMultimodalOptions,
    })
  : undefined;
const researchAnswerQueryGenerator =
  retrievalEvidenceQueryGenerator && profileLlmAnswerQueryGenerator
    ? createProfileAwareQueryGenerator({
        extractiveGenerator: retrievalEvidenceQueryGenerator,
        profileLlmGenerator: profileLlmAnswerQueryGenerator,
      })
    : undefined;
const baseInteractiveQueryGenerator =
  retrievalEvidenceQueryGenerator && researchAnswerQueryGenerator
    ? createResearchAwareQueryGenerator({
        researchGenerator: researchAnswerQueryGenerator,
        retrievalGenerator: retrievalEvidenceQueryGenerator,
      })
    : undefined;
const interactiveQueryGenerator = baseInteractiveQueryGenerator
  ? createQueryImageAwareQueryGenerator({
      generator: baseInteractiveQueryGenerator,
      provider: queryImageExpansionProvider,
    })
  : undefined;
const durableResearchAnswerQueryGenerator = researchAnswerQueryGenerator
  ? createQueryImageAwareQueryGenerator({
      generator: researchAnswerQueryGenerator,
      provider: queryImageExpansionProvider,
    })
  : undefined;
const researchProjectionSnapshotResolver = repositoryOptions.projectionSetPublications
  ? createPublishedProjectionReadSnapshotResolver({
      publications: repositoryOptions.projectionSetPublications,
      ...(databaseRepositories.legacySpacePublicationBootstraps ||
      databaseRepositories.pageIndexUpgradeBackfills
        ? {
            readiness: [
              ...(databaseRepositories.legacySpacePublicationBootstraps
                ? [databaseRepositories.legacySpacePublicationBootstraps]
                : []),
              ...(databaseRepositories.pageIndexUpgradeBackfills
                ? [databaseRepositories.pageIndexUpgradeBackfills]
                : []),
            ],
          }
        : {}),
    })
  : undefined;
const runtimeSnapshotResolver =
  repositoryOptions.projectionSetPublications && databaseRepositories.knowledgeSpaceProfiles
    ? createDatabasePublishedKnowledgeSpaceRuntimeSnapshotResolver({
        database: adapter.database,
        ...(databaseRepositories.legacySpacePublicationBootstraps ||
        databaseRepositories.pageIndexUpgradeBackfills
          ? {
              readiness: [
                ...(databaseRepositories.legacySpacePublicationBootstraps
                  ? [databaseRepositories.legacySpacePublicationBootstraps]
                  : []),
                ...(databaseRepositories.pageIndexUpgradeBackfills
                  ? [databaseRepositories.pageIndexUpgradeBackfills]
                  : []),
              ],
            }
          : {}),
      })
    : undefined;
const goldenQuestionEvidenceMatcher =
  embeddingResolver && retrievalRepository && runtimeSnapshotResolver
    ? createGoldenQuestionEvidenceMatcher({
        embeddings: embeddingResolver,
        repository: retrievalRepository,
        runtimeSnapshots: runtimeSnapshotResolver,
      })
    : undefined;
const researchTaskRuntime =
  databaseRepositories.researchTaskDurableRepository &&
  databaseRepositories.researchTaskPartialResults &&
  databaseRepositories.researchTaskProgressEvents &&
  repositoryOptions.knowledgeSpaceAccess &&
  durableResearchAnswerQueryGenerator
    ? createApiResearchTaskRuntime({
        access: repositoryOptions.knowledgeSpaceAccess,
        adapter,
        ...(databaseRepositories.capabilityGrantProvenance
          ? { capabilityGrants: databaseRepositories.capabilityGrantProvenance }
          : {}),
        ...(deletionLifecycleFence ? { deletionFence: deletionLifecycleFence } : {}),
        generator: durableResearchAnswerQueryGenerator,
        manifests: knowledgeSpaceManifests,
        metrics: operationalMetrics.durableTasks,
        onError: ({ error, researchTaskJob }) => {
          process.stderr.write(
            `${JSON.stringify({
              errorClass: error instanceof Error ? error.name : typeof error,
              errorCode:
                error && typeof error === "object" && "code" in error
                  ? String(error.code)
                  : undefined,
              errorMessage:
                error instanceof Error ? error.message : "Unknown Research task runtime error",
              event: "knowledge_fs.research_task.error",
              ...(researchTaskJob
                ? { researchTaskId: researchTaskJob.id, stage: researchTaskJob.stage }
                : {}),
            })}\n`,
          );
        },
        partials: databaseRepositories.researchTaskPartialResults,
        progress: databaseRepositories.researchTaskProgressEvents,
        ...(researchProjectionSnapshotResolver
          ? { projectionSnapshotResolver: researchProjectionSnapshotResolver }
          : {}),
        queryImageResolver,
        repository: databaseRepositories.researchTaskDurableRepository,
      })
    : undefined;
assertApiResearchTaskDurability({
  production: process.env.NODE_ENV === "production",
  runtimeConfigured: researchTaskRuntime !== undefined,
  usesDatabaseRepositories: databaseRepositories.usesDatabaseRepositories,
});
researchDirectStreamReady = Boolean(
  researchTaskDirectStream &&
    capabilityV2.authenticator &&
    databaseRepositories.capabilityGrantProvenance &&
    researchTaskRuntime,
);
const uploadSessions = await createApiUploadSessionAssembly({
  adapter,
  capabilityV2Configured: capabilityV2.authenticator !== undefined,
  config: uploadSessionOptions,
  metrics: operationalMetrics.uploadSessions,
  onError: (error) => {
    process.stderr.write(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : "unknown direct-upload assembly error",
        event: "knowledge_fs.direct_upload.unavailable",
      })}\n`,
    );
  },
  repositories: {
    ...(repositoryOptions.documentAssets ? { assets: repositoryOptions.documentAssets } : {}),
    ...(databaseRepositories.capabilityGrantProvenance
      ? { capabilityGrants: databaseRepositories.capabilityGrantProvenance }
      : {}),
    ...(documentCompilationRuntime
      ? { compilationJobs: documentCompilationRuntime.compilationJobs }
      : {}),
    ...(repositoryOptions.logicalDocuments
      ? { logicalDocuments: repositoryOptions.logicalDocuments }
      : {}),
    manifests: knowledgeSpaceManifests,
    ...(databaseRepositories.uploadSessions
      ? { sessions: databaseRepositories.uploadSessions }
      : {}),
    usesDatabaseRepositories: databaseRepositories.usesDatabaseRepositories,
  },
});
directUploadReady = uploadSessions?.ready === true;
const app = createKnowledgeGateway({
  adapter,
  autoRetrievalModeResolver,
  bufferedDocumentUploadAdmission,
  bufferedDocumentUploadIdleTimeoutMs: bufferedDocumentUploadOptions.idleTimeoutMs,
  bufferedDocumentUploadTotalTimeoutMs: bufferedDocumentUploadOptions.totalTimeoutMs,
  readinessChecks,
  ...(retrievalExecutionLeases ? { retrievalExecutionLeases } : {}),
  ...(databaseRepositories.qualityControl
    ? {
        qualityControl: {
          repository: databaseRepositories.qualityControl,
          workerId: `quality-replay:${randomUUID()}`,
        },
      }
    : {}),
  ...(deletionLifecycleFence ? { deletionLifecycleFence } : {}),
  ...(deletionObjectWriteAdmission ? { deletionObjectWriteAdmission } : {}),
  ...(auth ? { auth } : {}),
  ...(capabilityV2.authenticator ? { difyCapabilityV2Auth: capabilityV2.authenticator } : {}),
  compute,
  ...(embeddingResolver ? { embeddingResolver } : {}),
  ...(goldenQuestionEvidenceMatcher ? { goldenQuestionEvidenceMatcher } : {}),
  // Deployment embedding configuration supplies Dify model runtime capability only. Creation
  // never copies it into a space; every space persists only its user-submitted selection.
  // Without a dedicated visual model, the regular dense builder already embeds OCR/caption/image
  // nodes through the space-selected text profile. A global text-surrogate visual builder would
  // write those nodes under the deployment model instead of the space's canonical vectorSpaceId.
  ...(visualEmbeddingOptions
    ? {
        visualEmbeddingModel: visualEmbeddingOptions.model,
        visualEmbeddingProvider: visualEmbeddingOptions.provider,
      }
    : {}),
  parser,
  ...(documentCompilationRuntime
    ? {
        documentCompilationJobs: documentCompilationRuntime.compilationJobs,
        documentChunkState: documentCompilationRuntime.documentChunkState,
        documentRevisionRollbacks: documentCompilationRuntime.documentRevisionRollbacks,
        documentSettingsChanges: documentCompilationRuntime.documentSettingsChanges,
        legacySpacePublicationBootstrapService: documentCompilationRuntime.legacyBootstrapService,
        pageIndexUpgradeBackfillService: documentCompilationRuntime.pageIndexUpgradeBackfillService,
      }
    : {}),
  ...(tidbFtsPostingBackfill
    ? { tidbFtsPostingBackfillService: tidbFtsPostingBackfill.service }
    : {}),
  ...(databaseRepositories.tidbFtsPostingBackfills
    ? { tidbFtsPostingReadiness: databaseRepositories.tidbFtsPostingBackfills }
    : {}),
  documentOutlineSummaryEnhancer,
  ...multimodalOptions,
  ...("embeddingProvider" in embeddingOptions || rerankerOptions
    ? {
        componentHealth: {
          ...("embeddingProvider" in embeddingOptions
            ? { embedding: embeddingOptions.embeddingProvider }
            : {}),
          ...(rerankerOptions ? { reranker: rerankerOptions.provider } : {}),
        },
      }
    : {}),
  ...(interactiveQueryGenerator ? { queryGenerator: interactiveQueryGenerator } : {}),
  queryImageResolver,
  ...(retrievalTestExecutor ? { retrievalTestExecutor } : {}),
  ...(publishedGraph ? { publishedGraph } : {}),
  ...(researchTaskRuntime
    ? {
        researchTaskPartials: researchTaskRuntime.partials,
        researchTaskProgress: researchTaskRuntime.progress,
        researchTasks: researchTaskRuntime.jobs,
      }
    : {}),
  ...(researchDirectStreamReady && researchTaskDirectStream
    ? { researchTaskDirectStream: researchTaskDirectStream.options }
    : {}),
  ...(uploadSessions?.sessions ? { uploadSessions: uploadSessions.sessions } : {}),
  ...(uploadSessions?.fallbackAdmission
    ? {
        uploadSmallFileFallbackAdmission: uploadSessions.fallbackAdmission,
        uploadSmallFileFallbackIdleTimeoutMs: bufferedDocumentUploadOptions.idleTimeoutMs,
        uploadSmallFileFallbackTotalTimeoutMs: bufferedDocumentUploadOptions.totalTimeoutMs,
      }
    : {}),
  ...(uploadSessions?.storageQuotas ? { storageQuotas: uploadSessions.storageQuotas } : {}),
  ...repositoryOptions,
  ...(integratedProvisioningReady && databaseRepositories.integratedKnowledgeSpaceProvisioning
    ? {
        integratedKnowledgeSpaceProvisioning:
          databaseRepositories.integratedKnowledgeSpaceProvisioning,
      }
    : {}),
  ...createApiProfileMigrationGatewayOptions({
    assembly: documentCompilationRuntime,
    bindings: databaseRepositories.knowledgeSpaceProfilePublications,
    repository: databaseRepositories.knowledgeSpaceProfileMigrations,
  }),
  ...(sourceRepository ? { sources: sourceRepository } : {}),
  ...(sourceProduct ? { sourceProduct } : {}),
  inlineSourceCredentialsAllowed: false,
  knowledgeSpaceManifests,
  legacyAccessMutationsReadOnly,
  legacyAuthorizationRemoved,
  legacyAuthorizationTrafficMetrics: operationalMetrics.legacyAuthorization,
  modelCapabilityCatalog,
  modelCapabilityPreflight,
  ...(runtimeSnapshotResolver ? { runtimeSnapshotResolver } : {}),
  ...multimodalEnrichmentOptions,
  ...semanticEntityExtractionOptions,
  ...knowledgeSpaceSemanticIngestionOptions,
  ...websiteCrawlOptions,
  ...onlineDocumentOptions,
  ...onlineDriveOptions,
  ...sourceCredentialTesterOptions,
  ...relevanceTriageOptions,
  workflowFailedRetrievalTriage,
  ...(tracingOptions ?? {}),
});

documentCompilationRuntime?.start();
tidbFtsPostingBackfill?.start();
researchTaskRuntime?.start();
durableDeletion?.start();
knowledgeSpaceProfileBackfill?.start();
uploadSessions?.start();

export default app;
