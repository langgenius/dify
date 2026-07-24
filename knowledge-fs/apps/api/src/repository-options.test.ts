import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import { createSourceCredentialFingerprinter } from "@knowledge/api";
import { describe, expect, it } from "vitest";

import {
  assertApiAgentWorkspaceSnapshotDurability,
  assertApiKnowledgeFsDurability,
  createApiDatabaseRepositories,
} from "./repository-options";

const sourceCredentialFingerprinter = createSourceCredentialFingerprinter(
  new Uint8Array(32).fill(44),
);
const durableDeletionKey = Buffer.alloc(32, 73).toString("base64");

describe("createApiDatabaseRepositories", () => {
  it("keeps the bounded gateway memory fallback when DATABASE_URL is absent", () => {
    const repositories = createApiDatabaseRepositories({
      database: createSchemaDatabaseAdapter({ kind: "postgres" }),
      env: {},
    });

    expect(repositories).toEqual({
      durableDeletionEnabled: false,
      gatewayOptions: {},
      usesDatabaseRepositories: false,
    });
  });

  it("creates a database-backed core repository bundle when DATABASE_URL is configured", async () => {
    const calls: unknown[] = [];
    const database = createSchemaDatabaseAdapter({
      kind: "postgres",
      executor: async (input) => {
        calls.push(input);

        return { rows: [], rowsAffected: 0 };
      },
    });

    const repositories = createApiDatabaseRepositories({
      database,
      env: { DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs" },
      sourceCredentialFingerprinter,
    });

    expect(repositories).toEqual({
      agentWorkspaceSnapshots: expect.any(Object),
      bulkOperations: expect.any(Object),
      capabilityGrantProvenance: expect.any(Object),
      deletionLifecycleFenceReader: expect.any(Object),
      difyIntegrationFreezes: expect.any(Object),
      difyIntegrationStates: expect.any(Object),
      documentCompilationAttempts: expect.any(Object),
      durableDeletionEnabled: false,
      gatewayOptions: {
        agentWorkspaceSnapshots: expect.any(Object),
        bulkOperations: expect.any(Object),
        capabilityGrantProvenance: expect.any(Object),
        difyIntegrationFreezes: expect.any(Object),
        difyIntegrationStates: expect.any(Object),
        answerTraces: expect.any(Object),
        artifactSegments: expect.any(Object),
        documentAssets: expect.any(Object),
        documentChunks: expect.any(Object),
        documentMultimodalManifests: expect.any(Object),
        documentOutlines: expect.any(Object),
        documentProcessingTasks: expect.any(Object),
        documentSettings: expect.any(Object),
        failedQueries: expect.any(Object),
        goldenQuestions: expect.any(Object),
        graphIndex: expect.any(Object),
        knowledgeFsLeases: expect.any(Object),
        knowledgeFsSessions: expect.any(Object),
        knowledgeNodes: expect.any(Object),
        knowledgePaths: expect.any(Object),
        knowledgeSpaceAccess: expect.any(Object),
        knowledgeSpaceManifests: expect.any(Object),
        knowledgeSpaceOverview: expect.any(Object),
        knowledgeSpaceProfiles: expect.any(Object),
        knowledgeSpaceProvisioning: expect.any(Object),
        knowledgeSpaceUnpublishedProfileActivations: expect.any(Object),
        logicalDocuments: expect.any(Object),
        knowledgeSpaces: expect.any(Object),
        legacySpacePublicationBootstraps: expect.any(Object),
        pageIndexUpgradeBackfills: expect.any(Object),
        parseArtifacts: expect.any(Object),
        projections: expect.any(Object),
        projectionSetPublicationMembers: expect.any(Object),
        projectionSetPublications: expect.any(Object),
        researchTaskPartials: expect.any(Object),
        sources: expect.any(Object),
        stagedCommits: expect.any(Object),
      },
      knowledgeFsLeases: expect.any(Object),
      knowledgeFsSessions: expect.any(Object),
      integratedKnowledgeSpaceProvisioning: expect.objectContaining({
        provisioningMode: "integrated",
      }),
      knowledgeSpaceProfileBackfills: expect.any(Object),
      knowledgeSpaceProfileMigrations: expect.any(Object),
      knowledgeSpaceProfilePublications: expect.any(Object),
      knowledgeSpaceProfiles: expect.any(Object),
      knowledgeSpaceProvisioning: expect.any(Object),
      knowledgeSpaceUnpublishedProfileActivations: expect.any(Object),
      legacySpacePublicationBootstraps: expect.any(Object),
      pageIndexUpgradeBackfills: expect.any(Object),
      qualityControl: expect.any(Object),
      researchTaskDurableRepository: expect.any(Object),
      researchTaskPartialResults: expect.any(Object),
      researchTaskProgressEvents: expect.any(Object),
      sourceCredentialBackfills: expect.any(Object),
      sourceConnections: expect.any(Object),
      sourceProductWorkflows: expect.any(Object),
      sourceRetiredSecretCleanups: expect.any(Object),
      uploadSessions: expect.any(Object),
      usesDatabaseRepositories: true,
    });

    await repositories.gatewayOptions.knowledgeSpaces?.list({
      limit: 5,
      tenantId: "tenant-1",
    });
    await repositories.gatewayOptions.knowledgeSpaceManifests?.list({
      limit: 5,
      tenantId: "tenant-1",
    });
    await repositories.gatewayOptions.goldenQuestions?.list({
      candidateGrants: ["tenant:tenant-1"],
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 5,
      tenantId: "tenant-1",
    });
    await repositories.gatewayOptions.answerTraces?.getById("018f0d60-7a49-7cc2-9c1b-5b36f18f8a01");
    await repositories.gatewayOptions.knowledgePaths?.listSemanticDescendants({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      limit: 5,
      parentPath: "/knowledge/by-topic",
      viewName: "by-topic",
    });
    await repositories.gatewayOptions.stagedCommits?.get({
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f8a10",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      tenantId: "tenant-1",
    });

    expect(calls).toEqual([
      expect.objectContaining({
        maxRows: 6,
        operation: "select",
        params: ["tenant-1", 6],
        tableName: "knowledge_spaces",
      }),
      expect.objectContaining({
        maxRows: 6,
        operation: "select",
        params: ["tenant-1", 6],
        tableName: "knowledge_space_manifests",
      }),
      expect.objectContaining({
        maxRows: 6,
        operation: "select",
        params: ["tenant-1", "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42", '["tenant:tenant-1"]', 6],
        tableName: "golden_questions",
      }),
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: ["018f0d60-7a49-7cc2-9c1b-5b36f18f8a01"],
        tableName: "answer_traces",
      }),
      expect.objectContaining({
        maxRows: 6,
        operation: "select",
        params: [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
          "semantic",
          "by-topic",
          "/knowledge/by-topic/%",
          6,
        ],
        tableName: "knowledge_paths",
      }),
      expect.objectContaining({
        maxRows: 1,
        operation: "select",
        params: [
          "018f0d60-7a49-7cc2-9c1b-5b36f18f8a10",
          "tenant-1",
          "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        ],
        tableName: "knowledge_space_staged_commits",
      }),
    ]);
  });

  it("allows database repository wiring to be disabled explicitly", () => {
    const repositories = createApiDatabaseRepositories({
      database: createSchemaDatabaseAdapter({ kind: "postgres" }),
      env: {
        DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs",
        KNOWLEDGE_DATABASE_REPOSITORIES: "off",
      },
    });

    expect(repositories).toEqual({
      durableDeletionEnabled: false,
      gatewayOptions: {},
      usesDatabaseRepositories: false,
    });
  });

  it("forbids replica-local Agent workspace snapshots in production", () => {
    expect(() =>
      assertApiAgentWorkspaceSnapshotDurability({ production: true, repository: undefined }),
    ).toThrow("durable database repository");
    expect(() =>
      assertApiAgentWorkspaceSnapshotDurability({
        production: true,
        repository: createApiDatabaseRepositories({
          database: createSchemaDatabaseAdapter({ kind: "postgres" }),
          env: { DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs" },
        }).agentWorkspaceSnapshots,
      }),
    ).not.toThrow();
    expect(() =>
      assertApiAgentWorkspaceSnapshotDurability({ production: false, repository: undefined }),
    ).not.toThrow();
  });

  it("forbids replica-local KnowledgeFS sessions and leases in production", () => {
    expect(() =>
      assertApiKnowledgeFsDurability({
        leases: undefined,
        production: true,
        sessions: undefined,
      }),
    ).toThrow("durable database repositories");
    const repositories = createApiDatabaseRepositories({
      database: createSchemaDatabaseAdapter({ kind: "postgres" }),
      env: { DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs" },
    });
    expect(() =>
      assertApiKnowledgeFsDurability({
        leases: repositories.knowledgeFsLeases,
        production: true,
        sessions: repositories.knowledgeFsSessions,
      }),
    ).not.toThrow();
  });

  it("does not assemble credential backfill without the SecretStore keyed fingerprinter", () => {
    const repositories = createApiDatabaseRepositories({
      database: createSchemaDatabaseAdapter({ kind: "postgres" }),
      env: { DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs" },
    });

    expect(repositories.usesDatabaseRepositories).toBe(true);
    expect(repositories.sourceCredentialBackfills).toBeUndefined();
  });

  it("creates the durable FTS posting backfill repository only for TiDB", () => {
    const env = { DATABASE_URL: "mysql://root@localhost:4000/knowledge_fs" };
    const tidb = createApiDatabaseRepositories({
      database: createSchemaDatabaseAdapter({ kind: "tidb" }),
      env,
      sourceCredentialFingerprinter,
    });
    const postgres = createApiDatabaseRepositories({
      database: createSchemaDatabaseAdapter({ kind: "postgres" }),
      env,
      sourceCredentialFingerprinter,
    });

    expect(tidb.tidbFtsPostingBackfills).toEqual(expect.any(Object));
    expect(postgres.tidbFtsPostingBackfills).toBeUndefined();
    expect(tidb.sourceCredentialBackfills).toEqual(expect.any(Object));
    expect(postgres.sourceCredentialBackfills).toEqual(expect.any(Object));
  });

  it("keeps durable deletion off unless the rollout declaration is explicit", () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres" });
    const repositories = createApiDatabaseRepositories({
      database,
      env: {
        DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs",
        DURABLE_DELETION_HMAC_KEY_BASE64: durableDeletionKey,
        DURABLE_DELETION_WRITER_FENCE_VERSION: "0017",
      },
    });

    expect(repositories.durableDeletionEnabled).toBe(false);
    expect(repositories.durableDeletionRepository).toBeUndefined();
    expect(repositories.gatewayOptions.durableDeletionRepository).toBeUndefined();
  });

  it("requires an exact writer-fence declaration and stable HMAC key when enabled", () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres" });
    const base = {
      DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs",
      DURABLE_DELETION_ENABLED: "true",
    };

    expect(() => createApiDatabaseRepositories({ database, env: base })).toThrow(
      "DURABLE_DELETION_WRITER_FENCE_VERSION=0017",
    );
    expect(() =>
      createApiDatabaseRepositories({
        database,
        env: { ...base, DURABLE_DELETION_WRITER_FENCE_VERSION: "0016" },
      }),
    ).toThrow("DURABLE_DELETION_WRITER_FENCE_VERSION=0017");
    expect(() =>
      createApiDatabaseRepositories({
        database,
        env: { ...base, DURABLE_DELETION_WRITER_FENCE_VERSION: "0017" },
      }),
    ).toThrow("DURABLE_DELETION_HMAC_KEY_BASE64 is required");
    expect(() =>
      createApiDatabaseRepositories({
        database,
        env: {
          ...base,
          DURABLE_DELETION_HMAC_KEY_BASE64: Buffer.alloc(31, 1).toString("base64"),
          DURABLE_DELETION_WRITER_FENCE_VERSION: "0017",
        },
      }),
    ).toThrow("at least 32 bytes");
    expect(() =>
      createApiDatabaseRepositories({
        database,
        env: {
          ...base,
          DURABLE_DELETION_HMAC_KEY_BASE64: "not canonical base64",
          DURABLE_DELETION_WRITER_FENCE_VERSION: "0017",
        },
      }),
    ).toThrow("canonical base64");
  });

  it("assembles and injects the deletion repository only after every rollout gate passes", () => {
    const repositories = createApiDatabaseRepositories({
      database: createSchemaDatabaseAdapter({ kind: "postgres" }),
      env: {
        DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs",
        DURABLE_DELETION_ENABLED: "on",
        DURABLE_DELETION_HMAC_KEY_BASE64: durableDeletionKey,
        DURABLE_DELETION_WRITER_FENCE_VERSION: "0017",
      },
    });

    expect(repositories.durableDeletionEnabled).toBe(true);
    expect(repositories.durableDeletionRepository).toEqual(expect.any(Object));
    expect(repositories.gatewayOptions.durableDeletionRepository).toBe(
      repositories.durableDeletionRepository,
    );
  });

  it("does not hide an explicitly enabled rollout when durable database wiring is absent", () => {
    const repositories = createApiDatabaseRepositories({
      database: createSchemaDatabaseAdapter({ kind: "postgres" }),
      env: {
        DURABLE_DELETION_ENABLED: "1",
        DURABLE_DELETION_HMAC_KEY_BASE64: durableDeletionKey,
        DURABLE_DELETION_WRITER_FENCE_VERSION: "0017",
      },
    });

    expect(repositories).toEqual({
      durableDeletionEnabled: true,
      gatewayOptions: {},
      usesDatabaseRepositories: false,
    });
  });

  it("rejects ambiguous rollout flag values", () => {
    expect(() =>
      createApiDatabaseRepositories({
        database: createSchemaDatabaseAdapter({ kind: "postgres" }),
        env: { DURABLE_DELETION_ENABLED: "enabled" },
      }),
    ).toThrow("DURABLE_DELETION_ENABLED");
  });
});

describe("API app repository wiring", () => {
  it("injects database repositories into the gateway options", () => {
    const source = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const repositorySource = readFileSync(
      resolve(import.meta.dirname, "repository-options.ts"),
      "utf8",
    );

    expect(source).toContain("createApiDatabaseRepositories");
    expect(source).toContain("databaseRepositories.gatewayOptions");
    expect(source).toContain("assertApiDocumentWriteSafety");
    expect(source).toContain("assertApiAgentWorkspaceSnapshotDurability");
    expect(source).toContain("assertApiKnowledgeFsDurability");
    expect(source).not.toContain("createApiSourceCredentialBackfillAssembly");
    expect(source).toContain("createApiSourceBulkRemovalRequester");
    expect(source).toContain("createApiUploadSessionAssembly");
    expect(source).not.toContain("sourceCredentialBackfill?.start()");
    expect(source).toContain("uploadSessions?.start()");
    expect(source).toContain("uploadSessions: uploadSessions.sessions");
    expect(source).toContain('"direct-upload.configuration"');
    expect(source).toContain("bulkRemoval: sourceBulkRemoval");
    expect(source).toContain("...repositoryOptions");
    expect(source).toContain("manifests: repositoryOptions.documentMultimodalManifests");
    expect(source).not.toContain("defaultEmbeddingSelection");
    expect(repositorySource).toContain("const maxPublicationMemberSnapshot = 100_000;");
    expect(repositorySource).toContain("maxListLimit: maxPublicationMemberSnapshot");
    expect(repositorySource).toContain("createDatabaseLegacySpacePublicationBootstrapRepository");
    expect(repositorySource).toContain("createDatabaseKnowledgeFsSessionRepository");
    expect(repositorySource).toContain("createDatabaseKnowledgeFsLeaseRepository");
    expect(repositorySource).toContain("createDatabaseKnowledgeSpaceProvisioningRepository");
    expect(repositorySource).toContain("createDatabaseUploadSessionRepository");
  });

  it("assembles the durable candidate runtime and injects its control plane", () => {
    const source = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
    const optionOffset = source.indexOf("createApiDocumentCompilationOptions()");
    const adapterOffset = source.indexOf("createNodePlatformAdapter()");
    const assemblyOffset = source.indexOf("createApiDocumentCompilationRuntime({");
    const gatewayOffset = source.indexOf("createKnowledgeGateway({");
    const startOffset = source.indexOf("documentCompilationRuntime?.start();");

    expect(optionOffset).toBeGreaterThanOrEqual(0);
    expect(adapterOffset).toBeGreaterThan(optionOffset);
    expect(assemblyOffset).toBeGreaterThan(adapterOffset);
    expect(gatewayOffset).toBeGreaterThan(assemblyOffset);
    expect(source).toContain("documentCompilationJobs: documentCompilationRuntime.compilationJobs");
    expect(source).toContain("documentCompilationRuntime.legacyBootstrapService");
    expect(startOffset).toBeGreaterThan(gatewayOffset);
  });
});
