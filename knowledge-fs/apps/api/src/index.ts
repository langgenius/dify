import { randomUUID } from "node:crypto";

import { createNodePlatformAdapter } from "@knowledge/adapters/node";
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
  createHybridQueryGenerator,
  createInMemoryKnowledgeSpaceManifestRepository,
  createInMemorySourceRepository,
  createInMemorySourceRetiredSecretCleanupRepository,
  createJointCasSourceLogicalRevisionPublisher,
  createKnowledgeGateway,
  createKnowledgeSpaceAuthorizationGuard,
  createKnowledgeSpaceEmbeddingResolver,
  createKnowledgeSpaceOutlineSummaryEnhancer,
  createLlmAnswerQueryGenerator,
  createLlmAutoRetrievalModeResolver,
  createModelCapabilityPreflight,
  createProfileAwareKnowledgeSpaceManifestRepository,
  createProfileAwareQueryGenerator,
  createPublishedProjectionReadSnapshotResolver,
  createRetrievalExecutionLeaseCoordinator,
  createRetrievalPlanner,
  createRetrievalTestExecutor,
  createSourceConnectionSecretCleanupRuntime,
  createSourceConnectionService,
  createSourceCredentialService,
  createSourceRetiredSecretCleanupRuntime,
  createStaticSourceProviderCatalog,
} from "@knowledge/api";

import { createApiProfileReasoningCapability } from "./answer-generation-options";
import { createApiAuthVerifier } from "./auth-options";
import { createApiComputeRuntime } from "./compute-options";
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
import { createApiKnowledgeSpaceProfileBackfillAssembly } from "./knowledge-space-profile-backfill-options";
import { createApiSemanticEntityExtractionOptions } from "./llm-options";
import { createApiMultimodalAnswerOptions } from "./multimodal-answer-options";
import { createApiMultimodalEnrichmentOptions } from "./multimodal-enrichment-options";
import { createApiMultimodalOptions } from "./multimodal-options";
import { createApiOnlineDocumentOptions } from "./online-document-options";
import { createApiOnlineDriveOptions } from "./online-drive-options";
import { createApiDocumentParser } from "./parser-options";
import { createPluginDaemonModelCapabilityCatalog } from "./plugin-daemon-model-capability-catalog";
import { createApiPluginDaemonClient } from "./plugin-daemon-options";
import { createApiRelevanceTriageOptions } from "./relevance-triage-signals";
import {
  assertApiAgentWorkspaceSnapshotDurability,
  assertApiKnowledgeFsDurability,
  createApiDatabaseRepositories,
} from "./repository-options";
import { createApiRerankerOptions } from "./reranker-options";
import {
  assertApiResearchTaskDurability,
  createApiResearchTaskRuntime,
} from "./research-task-runtime-options";
import { createApiRetriever } from "./retriever-options";
import { createApiSourceCredentialBackfillAssembly } from "./source-credential-backfill-options";
import { createApiSourceCredentialTesterOptions } from "./source-credential-options";
import { createApiSourceOAuthProviderOptions } from "./source-oauth-provider-options";
import { createApiSourceBulkRemovalRequester } from "./source-product-options";
import {
  assertApiSourceSecretDurability,
  createApiSourceSecretStore,
} from "./source-secret-options";
import { createApiTidbFtsPostingBackfillAssembly } from "./tidb-fts-posting-backfill-options";
import { createApiTracingOptions } from "./tracing-options";
import { createApiVisualEmbeddingOptions } from "./visual-embedding-options";
import { createApiWebsiteCrawlOptions } from "./website-crawl-options";

const RETRIEVAL_MAX_TOP_K = 100;

const documentCompilationOptions = createApiDocumentCompilationOptions();

const adapter = createNodePlatformAdapter();
const auth = createApiAuthVerifier();
const compute = createApiComputeRuntime();
const embeddingOptions = createApiEmbeddingOptions();
const parser = createApiDocumentParser();
const visualEmbeddingOptions = createApiVisualEmbeddingOptions({
  objectStorage: adapter.objectStorage,
});
const multimodalOptions = createApiMultimodalOptions();
const multimodalAnswerOptions = createApiMultimodalAnswerOptions({
  objectStorage: adapter.objectStorage,
});
const multimodalEnrichmentOptions = createApiMultimodalEnrichmentOptions({
  objectStorage: adapter.objectStorage,
});
const rerankerOptions = createApiRerankerOptions();
const semanticEntityExtractionOptions = createApiSemanticEntityExtractionOptions();
const profileReasoningCapability = createApiProfileReasoningCapability();
const pluginDaemonManagementClient = createApiPluginDaemonClient(process.env);
const modelCapabilityCatalog = createPluginDaemonModelCapabilityCatalog({
  client: pluginDaemonManagementClient,
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
const websiteCrawlOptions = createApiWebsiteCrawlOptions();
const onlineDocumentOptions = createApiOnlineDocumentOptions();
const onlineDriveOptions = createApiOnlineDriveOptions();
const sourceCredentialTesterOptions = createApiSourceCredentialTesterOptions();
const commonPluginSourceFields = [
  { name: "pluginId", required: true, secret: false, type: "string" as const },
  { name: "provider", required: true, secret: false, type: "string" as const },
  { name: "datasource", required: true, secret: false, type: "string" as const },
  {
    format: "password" as const,
    name: "apiKey",
    required: false,
    secret: true,
    type: "string" as const,
  },
  {
    format: "password" as const,
    name: "token",
    required: false,
    secret: true,
    type: "string" as const,
  },
  {
    format: "password" as const,
    name: "accessToken",
    required: false,
    secret: true,
    type: "string" as const,
  },
  {
    format: "password" as const,
    name: "clientId",
    required: false,
    secret: true,
    type: "string" as const,
  },
  {
    format: "password" as const,
    name: "clientSecret",
    required: false,
    secret: true,
    type: "string" as const,
  },
  {
    format: "password" as const,
    name: "accessKeyId",
    required: false,
    secret: true,
    type: "string" as const,
  },
  {
    format: "password" as const,
    name: "secretAccessKey",
    required: false,
    secret: true,
    type: "string" as const,
  },
  {
    format: "password" as const,
    name: "sessionToken",
    required: false,
    secret: true,
    type: "string" as const,
  },
] as const;
const sourceOAuthOptions = createApiSourceOAuthProviderOptions(process.env);
const supportedSourceProviderIds = new Set([
  "plugin-daemon-website",
  "plugin-daemon-online-document",
  "plugin-daemon-online-drive",
]);
for (const providerId of sourceOAuthOptions.providerIds) {
  if (!supportedSourceProviderIds.has(providerId)) {
    throw new Error(`OAuth source provider ${providerId} is not present in the source catalog`);
  }
}
const sourceAuthKinds = (providerId: string) => [
  "api-key" as const,
  "endpoint" as const,
  ...(sourceOAuthOptions.providerIds.has(providerId) ? ["oauth2" as const] : []),
];
const sourceProviderCatalog = createStaticSourceProviderCatalog([
  {
    authKinds: sourceAuthKinds("plugin-daemon-website"),
    available: true,
    capabilities: ["website-crawl"],
    configuration: commonPluginSourceFields,
    displayName: "Plugin daemon website crawl",
    id: "plugin-daemon-website",
  },
  {
    authKinds: sourceAuthKinds("plugin-daemon-online-document"),
    available: true,
    capabilities: ["online-document"],
    configuration: commonPluginSourceFields,
    displayName: "Plugin daemon online document",
    id: "plugin-daemon-online-document",
  },
  {
    authKinds: sourceAuthKinds("plugin-daemon-online-drive"),
    available: true,
    capabilities: ["online-drive"],
    configuration: commonPluginSourceFields,
    displayName: "Plugin daemon online drive",
    id: "plugin-daemon-online-drive",
  },
]);
const sourceOAuthProviders = sourceOAuthOptions.registry;
const tracingOptions = createApiTracingOptions();
const autoRetrievalModeResolver = createLlmAutoRetrievalModeResolver({
  providerFactory: profileReasoningCapability.providerFactory,
  ...(tracingOptions ? { traces: tracingOptions.traces } : {}),
});
const sourceSecretStore = createApiSourceSecretStore(adapter.objectStorage);
const databaseRepositories = createApiDatabaseRepositories({
  database: adapter.database,
  sourceCredentialFingerprinter: sourceSecretStore?.fingerprint,
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
// The 0017 migration intentionally leaves ambiguous legacy bundles quarantined as NULL scope.
// Do not expose destructive routes until operators have run the bounded purge to zero.
await assertApiDurableDeletionDataReadiness({
  database: adapter.database,
  enabled: databaseRepositories.durableDeletionEnabled,
});
const durableDeletion = createApiDurableDeletionAssembly({
  adapter,
  enabled: databaseRepositories.durableDeletionEnabled,
  production: process.env.NODE_ENV === "production",
  repository: databaseRepositories.durableDeletionRepository,
  secretStore: sourceSecretStore,
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
assertApiAgentWorkspaceSnapshotDurability({
  production: process.env.NODE_ENV === "production",
  repository: databaseRepositories.agentWorkspaceSnapshots,
});
assertApiKnowledgeFsDurability({
  leases: databaseRepositories.knowledgeFsLeases,
  production: process.env.NODE_ENV === "production",
  sessions: databaseRepositories.knowledgeFsSessions,
});
assertApiSourceSecretDurability({
  objectStorageKind: adapter.objectStorage.kind,
  production: process.env.NODE_ENV === "production",
  secretStoreConfigured: sourceSecretStore !== undefined,
  usesDatabaseLifecycleLedger: databaseRepositories.sourceRetiredSecretCleanups !== undefined,
});
const sourceRepository =
  repositoryOptions.sources ??
  (sourceSecretStore ? createInMemorySourceRepository({ maxSources: 1_000 }) : undefined);
const sourceRetiredSecretCleanups =
  databaseRepositories.sourceRetiredSecretCleanups ??
  (sourceSecretStore && sourceRepository
    ? createInMemorySourceRetiredSecretCleanupRepository({
        maxClaimBatchSize: 25,
        maxJobs: 10_000,
        sources: sourceRepository,
      })
    : undefined);
const sourceCredentials =
  sourceSecretStore && sourceRepository && sourceRetiredSecretCleanups
    ? createSourceCredentialService({
        retiredSecrets: sourceRetiredSecretCleanups,
        secretStore: sourceSecretStore,
        sources: sourceRepository,
      })
    : undefined;
const sourceRetiredSecretCleanup =
  sourceSecretStore && sourceRetiredSecretCleanups
    ? createSourceRetiredSecretCleanupRuntime({
        intervalMs: 10_000,
        leaseMs: 30_000,
        maxClaimBatchSize: 25,
        maxRetryCount: 20,
        repository: sourceRetiredSecretCleanups,
        secretStore: sourceSecretStore,
        workerId: `source-retired-secret-cleanup:${randomUUID()}`,
      })
    : undefined;
const sourceCredentialBackfill = createApiSourceCredentialBackfillAssembly({
  repository: databaseRepositories.sourceCredentialBackfills,
  secretStore: sourceSecretStore,
  sources: databaseRepositories.sourceCredentialBackfills ? sourceRepository : undefined,
});
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
  manifests: knowledgeSpaceManifests,
  maxInputChars: 12_000,
  maxOutputTokens: profileReasoningCapability.maxOutputTokens,
  maxSummaryChars: 2_000,
  providerFactory: profileReasoningCapability.providerFactory,
});
const relevanceTriageOptions = createApiRelevanceTriageOptions({
  ...(repositoryOptions.documentAssets ? { documentAssets: repositoryOptions.documentAssets } : {}),
  ...(repositoryOptions.documentOutlines
    ? { documentOutlines: repositoryOptions.documentOutlines }
    : {}),
  ...(repositoryOptions.graphIndex ? { graphIndex: repositoryOptions.graphIndex } : {}),
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
const documentCompilationRuntime = createApiDocumentCompilationRuntime({
  adapter,
  compute,
  config: documentCompilationOptions,
  ...(deletionLifecycleFence ? { deletionFence: deletionLifecycleFence } : {}),
  ...(deletionObjectWriteAdmission ? { objectWriteAdmission: deletionObjectWriteAdmission } : {}),
  embeddingResolver,
  ...(databaseRepositories.knowledgeSpaceUnpublishedProfileActivations
    ? {
        initialProfileActivations: databaseRepositories.knowledgeSpaceUnpublishedProfileActivations,
      }
    : {}),
  modelCapabilityPreflight,
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
      ? { legacyBootstraps: databaseRepositories.legacySpacePublicationBootstraps }
      : {}),
    ...(databaseRepositories.pageIndexUpgradeBackfills
      ? { pageIndexUpgradeBackfills: databaseRepositories.pageIndexUpgradeBackfills }
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
  semantic: semanticEntityExtractionOptions,
  ...(visualEmbeddingOptions
    ? { visual: { model: visualEmbeddingOptions.model, provider: visualEmbeddingOptions.provider } }
    : {}),
});
const sourceProductAuthorization = repositoryOptions.knowledgeSpaceAccess
  ? createKnowledgeSpaceAuthorizationGuard({ access: repositoryOptions.knowledgeSpaceAccess })
  : undefined;
const sourceConnectionService =
  sourceSecretStore &&
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
        oauth: sourceOAuthProviders,
        repository: databaseRepositories.sourceConnections,
        secrets: sourceSecretStore,
      })
    : undefined;
const sourceConnectionSecretCleanup =
  sourceSecretStore && databaseRepositories.sourceConnections
    ? createSourceConnectionSecretCleanupRuntime({
        oauth: sourceOAuthProviders,
        repository: databaseRepositories.sourceConnections,
        secrets: sourceSecretStore,
        workerId: `source-connection-secret-cleanup:${randomUUID()}`,
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
    "Production Source product requires durable connections/workflows, SecretStore, logical documents, and compilation publication",
  );
}
const visualQueryEmbeddingOptions = visualEmbeddingOptions?.queryEmbeddingProvider
  ? {
      embeddingModel: visualEmbeddingOptions.queryEmbeddingModel ?? visualEmbeddingOptions.model,
      embeddings: visualEmbeddingOptions.queryEmbeddingProvider,
    }
  : undefined;
const retrievalPlanner = createRetrievalPlanner({ maxTopK: RETRIEVAL_MAX_TOP_K });
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
        ? { pageIndex: publishedPageIndex }
        : repositoryOptions.documentOutlines
          ? { outlines: repositoryOptions.documentOutlines }
          : {}),
      planner: retrievalPlanner,
      repository: retrievalRepository,
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
// Resolves multimodal citations (manifest item id, asset route, page/bbox) and is shared by both
// query generators. Available in database-repository mode, which is also when the retriever exists.
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
const multimodalGeneratorOptions = {
  ...multimodalAnswerOptions,
  ...(multimodalCandidateResolver ? { multimodalCandidateResolver } : {}),
};
const extractiveQueryGenerator = retriever
  ? createHybridQueryGenerator({
      limit: 5,
      maxAnswerChars: 2_000,
      retriever,
      topK: 10,
      ...embeddingGeneratorOptions,
      ...multimodalGeneratorOptions,
    })
  : undefined;
const llmAnswerQueryGenerator = retriever
  ? createLlmAnswerQueryGenerator({
      limit: 5,
      maxAnswerChars: 2_000,
      maxOutputTokens: profileReasoningCapability.maxOutputTokens,
      reasoningProviderFactory: profileReasoningCapability.providerFactory,
      retriever,
      temperature: 0,
      topK: 10,
      ...embeddingGeneratorOptions,
      ...multimodalGeneratorOptions,
    })
  : undefined;
const queryGenerator =
  extractiveQueryGenerator && llmAnswerQueryGenerator
    ? createProfileAwareQueryGenerator({
        extractiveGenerator: extractiveQueryGenerator,
        profileLlmGenerator: llmAnswerQueryGenerator,
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
const researchTaskRuntime =
  databaseRepositories.researchTaskDurableRepository &&
  databaseRepositories.researchTaskPartialResults &&
  databaseRepositories.researchTaskProgressEvents &&
  repositoryOptions.knowledgeSpaceAccess &&
  queryGenerator
    ? createApiResearchTaskRuntime({
        access: repositoryOptions.knowledgeSpaceAccess,
        adapter,
        ...(deletionLifecycleFence ? { deletionFence: deletionLifecycleFence } : {}),
        generator: queryGenerator,
        manifests: knowledgeSpaceManifests,
        partials: databaseRepositories.researchTaskPartialResults,
        progress: databaseRepositories.researchTaskProgressEvents,
        ...(researchProjectionSnapshotResolver
          ? { projectionSnapshotResolver: researchProjectionSnapshotResolver }
          : {}),
        repository: databaseRepositories.researchTaskDurableRepository,
      })
    : undefined;
assertApiResearchTaskDurability({
  production: process.env.NODE_ENV === "production",
  runtimeConfigured: researchTaskRuntime !== undefined,
  usesDatabaseRepositories: databaseRepositories.usesDatabaseRepositories,
});
const app = createKnowledgeGateway({
  adapter,
  autoRetrievalModeResolver,
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
  compute,
  ...(embeddingResolver ? { embeddingResolver } : {}),
  // Deployment embedding configuration supplies plugin-daemon runtime capability only. Creation
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
  ...(queryGenerator ? { queryGenerator } : {}),
  ...(retrievalTestExecutor ? { retrievalTestExecutor } : {}),
  ...(publishedGraph ? { publishedGraph } : {}),
  ...(researchTaskRuntime
    ? {
        researchTaskPartials: researchTaskRuntime.partials,
        researchTaskProgress: researchTaskRuntime.progress,
        researchTasks: researchTaskRuntime.jobs,
      }
    : {}),
  ...repositoryOptions,
  ...createApiProfileMigrationGatewayOptions({
    assembly: documentCompilationRuntime,
    bindings: databaseRepositories.knowledgeSpaceProfilePublications,
    repository: databaseRepositories.knowledgeSpaceProfileMigrations,
  }),
  ...(sourceRepository ? { sources: sourceRepository } : {}),
  ...(sourceCredentials ? { sourceCredentials } : {}),
  ...(sourceProduct ? { sourceProduct } : {}),
  knowledgeSpaceManifests,
  modelCapabilityCatalog,
  modelCapabilityPreflight,
  ...(runtimeSnapshotResolver ? { runtimeSnapshotResolver } : {}),
  ...multimodalEnrichmentOptions,
  ...semanticEntityExtractionOptions,
  ...websiteCrawlOptions,
  ...onlineDocumentOptions,
  ...onlineDriveOptions,
  ...sourceCredentialTesterOptions,
  ...relevanceTriageOptions,
  ...(tracingOptions ?? {}),
});

documentCompilationRuntime?.start();
tidbFtsPostingBackfill?.start();
researchTaskRuntime?.start();
durableDeletion?.start();
sourceCredentialBackfill?.start();
sourceRetiredSecretCleanup?.start();
sourceConnectionSecretCleanup?.start();
knowledgeSpaceProfileBackfill?.start();

export default app;
