import {
  type AgentWorkspaceSnapshotRepository,
  type BulkOperationRepository,
  type CapabilityGrantProvenanceRepository,
  type DeletionLifecycleFenceReader,
  type DifyIntegrationFreezeRepository,
  type DifyIntegrationStateRepository,
  type DocumentCompilationAttemptRepository,
  type DurableDeletionRepository,
  type IntegratedKnowledgeSpaceProvisioningRepository,
  type KnowledgeFsLeaseRepository,
  type KnowledgeFsSessionRepository,
  type KnowledgeGatewayOptions,
  type KnowledgeSpaceProfileBackfillRepository,
  type KnowledgeSpaceProfileMigrationRepository,
  type KnowledgeSpaceProfilePublicationRepository,
  type KnowledgeSpaceProfileRepository,
  type KnowledgeSpaceProvisioningRepository,
  type KnowledgeSpaceUnpublishedProfileActivationRepository,
  type LegacySpacePublicationBootstrapRepository,
  type PageIndexUpgradeBackfillRepository,
  type QualityControlRepository,
  type ResearchTaskDurableRepository,
  type ResearchTaskPartialResultRepository,
  type ResearchTaskProgressRepository,
  type SourceConnectionRepository,
  type SourceCredentialBackfillRepository,
  type SourceCredentialFingerprinter,
  type SourceProductWorkflowRepository,
  type SourceRetiredSecretCleanupRepository,
  type TidbFtsPostingBackfillRepository,
  type UploadSessionRepository,
  createDatabaseAgentWorkspaceSnapshotRepository,
  createDatabaseAnswerTraceRepository,
  createDatabaseArtifactSegmentRepository,
  createDatabaseBulkOperationRepository,
  createDatabaseCapabilityGrantProvenanceRepository,
  createDatabaseDeletionLifecycleFenceReader,
  createDatabaseDifyIntegrationFreezeRepository,
  createDatabaseDifyIntegrationStateRepository,
  createDatabaseDocumentAssetRepository,
  createDatabaseDocumentChunkRepository,
  createDatabaseDocumentCompilationAttemptRepository,
  createDatabaseDocumentMultimodalManifestRepository,
  createDatabaseDocumentOutlineRepository,
  createDatabaseDocumentProcessingTaskRepository,
  createDatabaseDocumentSettingsRepository,
  createDatabaseDurableDeletionRepository,
  createDatabaseFailedQueryRepository,
  createDatabaseGoldenQuestionRepository,
  createDatabaseGraphIndexRepository,
  createDatabaseIndexProjectionRepository,
  createDatabaseIntegratedKnowledgeSpaceProvisioningRepository,
  createDatabaseKnowledgeFsLeaseRepository,
  createDatabaseKnowledgeFsSessionRepository,
  createDatabaseKnowledgeNodeRepository,
  createDatabaseKnowledgePathRepository,
  createDatabaseKnowledgeSpaceAccessRepository,
  createDatabaseKnowledgeSpaceManifestRepository,
  createDatabaseKnowledgeSpaceOverviewRepository,
  createDatabaseKnowledgeSpaceProfileBackfillRepository,
  createDatabaseKnowledgeSpaceProfileMigrationRepository,
  createDatabaseKnowledgeSpaceProfilePublicationRepository,
  createDatabaseKnowledgeSpaceProfileRepository,
  createDatabaseKnowledgeSpaceProvisioningRepository,
  createDatabaseKnowledgeSpaceRepository,
  createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository,
  createDatabaseLegacySpacePublicationBootstrapRepository,
  createDatabaseLogicalDocumentRepository,
  createDatabasePageIndexUpgradeBackfillRepository,
  createDatabaseParseArtifactRepository,
  createDatabaseProjectionSetPublicationMemberRepository,
  createDatabaseProjectionSetPublicationRepository,
  createDatabaseQualityControlRepository,
  createDatabaseResearchTaskDurableRepository,
  createDatabaseResearchTaskPartialResultRepository,
  createDatabaseResearchTaskProgressRepository,
  createDatabaseSourceConnectionRepository,
  createDatabaseSourceCredentialBackfillRepository,
  createDatabaseSourceProductWorkflowRepository,
  createDatabaseSourceRepository,
  createDatabaseSourceRetiredSecretCleanupRepository,
  createDatabaseStagedCommitRepository,
  createDatabaseTidbFtsPostingBackfillRepository,
  createDatabaseUploadSessionRepository,
  createDurableDeletionFingerprinter,
  createKnowledgeSpaceAccessService,
} from "@knowledge/api";

export interface ApiRepositoryEnv {
  readonly DATABASE_URL?: string | undefined;
  readonly DURABLE_DELETION_ENABLED?: string | undefined;
  readonly KNOWLEDGE_DATABASE_REPOSITORIES?: string | undefined;
  /** Base64-encoded deployment secret; decoding must yield at least 32 bytes. */
  readonly DURABLE_DELETION_HMAC_KEY_BASE64?: string | undefined;
  /** Migration/writer compatibility declaration required before destructive routes are enabled. */
  readonly DURABLE_DELETION_WRITER_FENCE_VERSION?: string | undefined;
}

export interface CreateApiDatabaseRepositoriesOptions {
  readonly database: KnowledgeGatewayOptions["adapter"]["database"];
  readonly env?: ApiRepositoryEnv | undefined;
  readonly sourceCredentialFingerprinter?: SourceCredentialFingerprinter | undefined;
}

export interface ApiDatabaseRepositoryBundle {
  readonly agentWorkspaceSnapshots?: AgentWorkspaceSnapshotRepository | undefined;
  readonly bulkOperations?: BulkOperationRepository | undefined;
  readonly capabilityGrantProvenance?: CapabilityGrantProvenanceRepository | undefined;
  readonly deletionLifecycleFenceReader?: DeletionLifecycleFenceReader | undefined;
  readonly difyIntegrationFreezes?: DifyIntegrationFreezeRepository | undefined;
  readonly difyIntegrationStates?: DifyIntegrationStateRepository | undefined;
  readonly documentCompilationAttempts?: DocumentCompilationAttemptRepository | undefined;
  readonly durableDeletionRepository?: DurableDeletionRepository | undefined;
  readonly durableDeletionEnabled: boolean;
  readonly gatewayOptions: Partial<KnowledgeGatewayOptions>;
  readonly knowledgeFsLeases?: KnowledgeFsLeaseRepository | undefined;
  readonly knowledgeFsSessions?: KnowledgeFsSessionRepository | undefined;
  readonly knowledgeSpaceProfileBackfills?: KnowledgeSpaceProfileBackfillRepository | undefined;
  readonly knowledgeSpaceProfileMigrations?: KnowledgeSpaceProfileMigrationRepository | undefined;
  readonly knowledgeSpaceProfilePublications?:
    | KnowledgeSpaceProfilePublicationRepository
    | undefined;
  readonly knowledgeSpaceProfiles?: KnowledgeSpaceProfileRepository | undefined;
  readonly integratedKnowledgeSpaceProvisioning?:
    | IntegratedKnowledgeSpaceProvisioningRepository
    | undefined;
  readonly knowledgeSpaceProvisioning?: KnowledgeSpaceProvisioningRepository | undefined;
  readonly knowledgeSpaceUnpublishedProfileActivations?:
    | KnowledgeSpaceUnpublishedProfileActivationRepository
    | undefined;
  readonly legacySpacePublicationBootstraps?: LegacySpacePublicationBootstrapRepository | undefined;
  readonly pageIndexUpgradeBackfills?: PageIndexUpgradeBackfillRepository | undefined;
  readonly researchTaskDurableRepository?: ResearchTaskDurableRepository | undefined;
  readonly researchTaskPartialResults?: ResearchTaskPartialResultRepository | undefined;
  readonly researchTaskProgressEvents?: ResearchTaskProgressRepository | undefined;
  readonly qualityControl?: QualityControlRepository | undefined;
  readonly sourceCredentialBackfills?: SourceCredentialBackfillRepository | undefined;
  readonly sourceConnections?: SourceConnectionRepository | undefined;
  readonly sourceProductWorkflows?: SourceProductWorkflowRepository | undefined;
  readonly sourceRetiredSecretCleanups?: SourceRetiredSecretCleanupRepository | undefined;
  readonly tidbFtsPostingBackfills?: TidbFtsPostingBackfillRepository | undefined;
  readonly uploadSessions?: UploadSessionRepository | undefined;
  readonly usesDatabaseRepositories: boolean;
}

const maxListLimit = 100;
const maxBatchSize = 1_000;
const maxPublicationMemberSnapshot = 100_000;
const maxLegacyBootstrapDocuments = 100_000;
const maxPageIndexUpgradeItems = 100_000;
const maxTidbFtsBackfillDiscoveryBatch = 100;
const maxSourceCredentialBackfillDiscoveryBatch = 100;
const maxAgentWorkspaceCollectionSize = 1_000;
const maxProfileBackfillDiscoveryBatch = 100;

export function createApiDatabaseRepositories({
  database,
  env = process.env,
  sourceCredentialFingerprinter,
}: CreateApiDatabaseRepositoriesOptions): ApiDatabaseRepositoryBundle {
  // Parse and validate the rollout declaration before selecting the repository backend. An
  // explicitly enabled destructive surface must not be silently rewritten to "disabled" merely
  // because DATABASE_URL is missing or database repositories were disabled; the production
  // assembly can then fail closed on the missing durable dependency.
  const durableDeletionEnabled = durableDeletionRolloutEnabled(env);
  const durableDeletionKey = durableDeletionEnabled
    ? requireDurableDeletionKey(env.DURABLE_DELETION_HMAC_KEY_BASE64)
    : undefined;
  if (!shouldUseDatabaseRepositories(env)) {
    return {
      durableDeletionEnabled,
      gatewayOptions: {},
      usesDatabaseRepositories: false,
    };
  }

  const documentCompilationAttempts = createDatabaseDocumentCompilationAttemptRepository({
    database,
    maxOutboxClaimBatchSize: maxListLimit,
  });
  const bulkOperations = createDatabaseBulkOperationRepository({
    database,
    maxItems: maxBatchSize,
    maxListLimit,
  });
  const deletionLifecycleFenceReader = createDatabaseDeletionLifecycleFenceReader(database);
  const durableDeletionRepository = durableDeletionKey
    ? createDatabaseDurableDeletionRepository({
        database,
        fingerprinter: createDurableDeletionFingerprinter(durableDeletionKey),
        maxClaimBatchSize: maxListLimit,
        maxInventoryBatchSize: maxBatchSize,
      })
    : undefined;
  const legacySpacePublicationBootstraps = createDatabaseLegacySpacePublicationBootstrapRepository({
    database,
    maxClaimBatchSize: maxListLimit,
    maxDocuments: maxLegacyBootstrapDocuments,
    maxInsertBatchSize: maxBatchSize,
  });
  const pageIndexUpgradeBackfills = createDatabasePageIndexUpgradeBackfillRepository({
    database,
    maxClaimBatchSize: maxListLimit,
    maxItemsPerJob: maxPageIndexUpgradeItems,
  });
  const tidbFtsPostingBackfills =
    database.dialect === "tidb"
      ? createDatabaseTidbFtsPostingBackfillRepository({
          database,
          maxClaimBatchSize: maxListLimit,
          maxDiscoveryBatchSize: maxTidbFtsBackfillDiscoveryBatch,
        })
      : undefined;
  const researchTaskDurableRepository = createDatabaseResearchTaskDurableRepository({
    database,
    maxOutboxClaimBatchSize: maxListLimit,
  });
  const researchTaskPartialResults = createDatabaseResearchTaskPartialResultRepository({
    database,
    maxListLimit,
  });
  const researchTaskProgressEvents = createDatabaseResearchTaskProgressRepository({
    database,
    maxListLimit,
    maxPollBatchSize: maxListLimit,
    maxSubscribers: 1_000,
    pollIntervalMs: 250,
  });
  const qualityControl = createDatabaseQualityControlRepository({
    database,
    maxListLimit,
  });
  const sourceCredentialBackfills = sourceCredentialFingerprinter
    ? createDatabaseSourceCredentialBackfillRepository({
        database,
        credentialFingerprinter: sourceCredentialFingerprinter,
        maxClaimBatchSize: maxListLimit,
        maxDiscoveryBatchSize: maxSourceCredentialBackfillDiscoveryBatch,
      })
    : undefined;
  const sourceRetiredSecretCleanups = createDatabaseSourceRetiredSecretCleanupRepository({
    database,
    maxClaimBatchSize: maxListLimit,
  });
  const sourceConnections = createDatabaseSourceConnectionRepository({
    database,
    maxListLimit: 200,
  });
  const sourceProductWorkflows = createDatabaseSourceProductWorkflowRepository({
    database,
    maxClaimBatchSize: maxListLimit,
    maxListLimit: 200,
  });
  const knowledgeSpaceAccess = createKnowledgeSpaceAccessService({
    repository: createDatabaseKnowledgeSpaceAccessRepository({
      database,
      maxListLimit,
      maxMembersPerSpace: 10_000,
    }),
  });
  const agentWorkspaceSnapshots = createDatabaseAgentWorkspaceSnapshotRepository({
    database,
    maxCommandLogEntries: maxAgentWorkspaceCollectionSize,
    maxEvidenceBundles: maxAgentWorkspaceCollectionSize,
    maxMounts: maxAgentWorkspaceCollectionSize,
    maxPathVersions: maxAgentWorkspaceCollectionSize,
    maxSourceVersions: 10_000,
  });
  const knowledgeFsLeases = createDatabaseKnowledgeFsLeaseRepository({
    database,
    maxListLimit,
  });
  const knowledgeFsSessions = createDatabaseKnowledgeFsSessionRepository({
    database,
    maxListLimit,
  });
  const uploadSessions = createDatabaseUploadSessionRepository({ database });
  const knowledgeSpaceProfiles = createDatabaseKnowledgeSpaceProfileRepository({
    database,
    maxListLimit,
  });
  const knowledgeSpaceProvisioning = createDatabaseKnowledgeSpaceProvisioningRepository({
    database,
  });
  const integratedKnowledgeSpaceProvisioning =
    createDatabaseIntegratedKnowledgeSpaceProvisioningRepository({ database });
  const capabilityGrantProvenance = createDatabaseCapabilityGrantProvenanceRepository({ database });
  const difyIntegrationFreezes = createDatabaseDifyIntegrationFreezeRepository({ database });
  const difyIntegrationStates = createDatabaseDifyIntegrationStateRepository({ database });
  const knowledgeSpaceUnpublishedProfileActivations =
    createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({ database });
  const knowledgeSpaceProfileBackfills = createDatabaseKnowledgeSpaceProfileBackfillRepository({
    database,
    maxClaimBatchSize: maxListLimit,
    maxDiscoveryBatchSize: maxProfileBackfillDiscoveryBatch,
    maxExecutionAttempts: 10,
  });
  // One joint-CAS repository instance is shared by legacy binding and profile migration workers.
  // Creating per-runtime instances would make test overrides and lifecycle wiring diverge.
  const knowledgeSpaceProfilePublications =
    createDatabaseKnowledgeSpaceProfilePublicationRepository({ database });
  const knowledgeSpaceProfileMigrations = createDatabaseKnowledgeSpaceProfileMigrationRepository({
    database,
    maxClaimBatchSize: maxListLimit,
  });

  return {
    agentWorkspaceSnapshots,
    bulkOperations,
    capabilityGrantProvenance,
    deletionLifecycleFenceReader,
    difyIntegrationFreezes,
    difyIntegrationStates,
    documentCompilationAttempts,
    durableDeletionEnabled,
    ...(durableDeletionRepository ? { durableDeletionRepository } : {}),
    gatewayOptions: {
      agentWorkspaceSnapshots,
      bulkOperations,
      capabilityGrantProvenance,
      difyIntegrationFreezes,
      difyIntegrationStates,
      answerTraces: createDatabaseAnswerTraceRepository({ database }),
      artifactSegments: createDatabaseArtifactSegmentRepository({
        database,
        maxBatchSize,
        maxListLimit,
      }),
      documentAssets: createDatabaseDocumentAssetRepository({ database }),
      documentChunks: createDatabaseDocumentChunkRepository({
        database,
        maxBatchSize,
        maxListLimit,
      }),
      documentProcessingTasks: createDatabaseDocumentProcessingTaskRepository({
        database,
        maxListLimit,
      }),
      documentSettings: createDatabaseDocumentSettingsRepository({ database }),
      ...(durableDeletionRepository ? { durableDeletionRepository } : {}),
      documentMultimodalManifests: createDatabaseDocumentMultimodalManifestRepository({ database }),
      documentOutlines: createDatabaseDocumentOutlineRepository({ database }),
      failedQueries: createDatabaseFailedQueryRepository({ database }),
      goldenQuestions: createDatabaseGoldenQuestionRepository({
        database,
        maxListLimit,
      }),
      graphIndex: createDatabaseGraphIndexRepository({ database, maxBatchSize }),
      knowledgeNodes: createDatabaseKnowledgeNodeRepository({
        database,
        maxBatchSize,
        maxListLimit,
      }),
      knowledgePaths: createDatabaseKnowledgePathRepository({
        database,
        maxBatchSize,
        maxListLimit,
      }),
      knowledgeFsLeases,
      knowledgeFsSessions,
      knowledgeSpaces: createDatabaseKnowledgeSpaceRepository({
        database,
        maxListLimit,
      }),
      knowledgeSpaceManifests: createDatabaseKnowledgeSpaceManifestRepository({
        database,
        maxListLimit,
      }),
      knowledgeSpaceOverview: createDatabaseKnowledgeSpaceOverviewRepository({
        database,
        maxListLimit,
        maxRuleItems: maxListLimit,
      }),
      knowledgeSpaceProfiles,
      knowledgeSpaceProvisioning,
      knowledgeSpaceUnpublishedProfileActivations,
      logicalDocuments: createDatabaseLogicalDocumentRepository({
        database,
        maxListLimit,
      }),
      knowledgeSpaceAccess,
      legacySpacePublicationBootstraps,
      pageIndexUpgradeBackfills,
      parseArtifacts: createDatabaseParseArtifactRepository({ database }),
      projections: createDatabaseIndexProjectionRepository({
        database,
        maxBatchSize,
        maxListLimit,
      }),
      researchTaskPartials: researchTaskPartialResults,
      projectionSetPublications: createDatabaseProjectionSetPublicationRepository({
        database,
        maxListLimit,
      }),
      projectionSetPublicationMembers: createDatabaseProjectionSetPublicationMemberRepository({
        database,
        maxBatchSize,
        // Candidate evaluation and publication CAS intentionally compare the complete immutable
        // member snapshot. Keep this separate from user-facing list pagination.
        maxListLimit: maxPublicationMemberSnapshot,
      }),
      sources: createDatabaseSourceRepository({ database }),
      stagedCommits: createDatabaseStagedCommitRepository({
        database,
        maxListLimit,
      }),
    },
    legacySpacePublicationBootstraps,
    knowledgeFsLeases,
    knowledgeFsSessions,
    knowledgeSpaceProfileBackfills,
    knowledgeSpaceProfileMigrations,
    knowledgeSpaceProfilePublications,
    knowledgeSpaceProfiles,
    integratedKnowledgeSpaceProvisioning,
    knowledgeSpaceProvisioning,
    knowledgeSpaceUnpublishedProfileActivations,
    pageIndexUpgradeBackfills,
    researchTaskDurableRepository,
    researchTaskPartialResults,
    researchTaskProgressEvents,
    qualityControl,
    sourceCredentialBackfills,
    sourceConnections,
    sourceProductWorkflows,
    sourceRetiredSecretCleanups,
    ...(tidbFtsPostingBackfills ? { tidbFtsPostingBackfills } : {}),
    uploadSessions,
    usesDatabaseRepositories: true,
  };
}

export function assertApiAgentWorkspaceSnapshotDurability(input: {
  readonly production: boolean;
  readonly repository: AgentWorkspaceSnapshotRepository | undefined;
}): void {
  if (input.production && !input.repository) {
    throw new Error("Production Agent workspace snapshots require the durable database repository");
  }
}

export function assertApiKnowledgeFsDurability(input: {
  readonly leases: KnowledgeFsLeaseRepository | undefined;
  readonly production: boolean;
  readonly sessions: KnowledgeFsSessionRepository | undefined;
}): void {
  if (input.production && (!input.leases || !input.sessions)) {
    throw new Error(
      "Production KnowledgeFS sessions and leases require durable database repositories",
    );
  }
}

function decodeDurableDeletionKey(value: string | undefined): Uint8Array | undefined {
  const encoded = value?.trim();
  if (!encoded) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error("DURABLE_DELETION_HMAC_KEY_BASE64 must be canonical base64");
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.byteLength < 32 || decoded.toString("base64") !== encoded) {
    throw new Error(
      "DURABLE_DELETION_HMAC_KEY_BASE64 must decode to at least 32 bytes and be canonical",
    );
  }
  return Uint8Array.from(decoded);
}

function requireDurableDeletionKey(value: string | undefined): Uint8Array {
  const key = decodeDurableDeletionKey(value);
  if (!key) {
    throw new Error(
      "DURABLE_DELETION_HMAC_KEY_BASE64 is required when DURABLE_DELETION_ENABLED=true",
    );
  }
  return key;
}

function durableDeletionRolloutEnabled(env: ApiRepositoryEnv): boolean {
  const raw = env.DURABLE_DELETION_ENABLED?.trim().toLowerCase();
  if (!raw || ["0", "false", "off"].includes(raw)) return false;
  if (!["1", "true", "on"].includes(raw)) {
    throw new Error("DURABLE_DELETION_ENABLED must be true/on/1 or false/off/0");
  }
  if (env.DURABLE_DELETION_WRITER_FENCE_VERSION?.trim() !== "0017") {
    throw new Error(
      "DURABLE_DELETION_WRITER_FENCE_VERSION=0017 is required after every writer supports permanent deletion fences",
    );
  }
  return true;
}

function shouldUseDatabaseRepositories(env: ApiRepositoryEnv): boolean {
  if (isDisabled(env.KNOWLEDGE_DATABASE_REPOSITORIES)) {
    return false;
  }

  return Boolean(env.DATABASE_URL?.trim());
}

function isDisabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();

  return normalized === "0" || normalized === "false" || normalized === "off";
}
