import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  createApiDocumentCompilationRuntime,
  createApiProfileMigrationGatewayOptions,
  createDocumentSemanticEnrichmentGenerationGuard,
} from "./document-compilation-runtime-options";
import { createApiDatabaseRepositories } from "./repository-options";

const config = {
  batchSize: 5,
  leaseMs: 60_000,
  maxAttempts: 3,
  outboxVisibilityMs: 60_000,
  retryBaseMs: 1_000,
  retryMaxMs: 30_000,
  tickMs: 1_000,
};

describe("createApiDocumentCompilationRuntime", () => {
  it("does no capability validation and creates no consumers when runtime is off", () => {
    const assembly = createApiDocumentCompilationRuntime({
      adapter: undefined as never,
      compute: undefined,
      config: undefined,
      embeddingResolver: undefined,
      parser: undefined as never,
      repositories: {},
    });
    expect(assembly).toBeUndefined();
    expect(
      createApiProfileMigrationGatewayOptions({
        assembly,
        bindings: {} as never,
        repository: {} as never,
      }),
    ).toEqual({});
  });

  it("fails startup instead of falling back when required production capabilities are absent", () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    expect(() =>
      createApiDocumentCompilationRuntime({
        adapter,
        compute: undefined,
        config,
        embeddingResolver: undefined,
        parser: {} as never,
        repositories: {},
      }),
    ).toThrow("requires an in-process compute runtime");

    expect(() =>
      createApiDocumentCompilationRuntime({
        adapter,
        compute: {} as never,
        config,
        embeddingResolver: undefined,
        parser: {} as never,
        repositories: {},
      }),
    ).toThrow("requires the Reasoning-model semantic chunker");

    expect(() =>
      createApiDocumentCompilationRuntime({
        adapter,
        compute: {} as never,
        config,
        embeddingResolver: undefined,
        parser: {} as never,
        repositories: {},
        semanticChunker: {} as never,
      }),
    ).toThrow("requires the per-space plugin embedding resolver");

    expect(() =>
      createApiDocumentCompilationRuntime({
        adapter,
        compute: {} as never,
        config,
        embeddingResolver: {} as never,
        modelCapabilityPreflight: {} as never,
        parser: {} as never,
        repositories: {},
        semanticChunker: {} as never,
      }),
    ).toThrow("requires the atomic initial profile activation repository");

    expect(() =>
      createApiDocumentCompilationRuntime({
        adapter,
        compute: {} as never,
        config,
        embeddingResolver: {} as never,
        initialProfileActivations: {} as never,
        parser: {} as never,
        repositories: {},
        semanticChunker: {} as never,
      }),
    ).toThrow("requires model capability preflight");

    expect(() =>
      createApiDocumentCompilationRuntime({
        adapter,
        compute: {} as never,
        config,
        embeddingResolver: {} as never,
        initialProfileActivations: {} as never,
        modelCapabilityPreflight: {} as never,
        parser: {} as never,
        repositories: {},
        semanticChunker: {} as never,
      }),
    ).toThrow("requires database repository: artifacts");
  });

  it("assembles the durable control plane, outbox, worker, evaluator, and runtime", () => {
    const adapter = createNodePlatformAdapter({ env: {} });
    const databaseRepositories = createApiDatabaseRepositories({
      database: adapter.database,
      env: { DATABASE_URL: "postgresql://runtime-test/knowledge_fs" },
    });
    const gateway = databaseRepositories.gatewayOptions;
    const assembly = createApiDocumentCompilationRuntime({
      adapter,
      compute: {} as never,
      config,
      embeddingResolver: {} as never,
      initialProfileActivations: required(
        databaseRepositories.knowledgeSpaceUnpublishedProfileActivations,
      ),
      modelCapabilityPreflight: {} as never,
      parser: {} as never,
      repositories: {
        artifacts: required(gateway.parseArtifacts),
        assets: required(gateway.documentAssets),
        attempts: required(databaseRepositories.documentCompilationAttempts),
        chunks: required(gateway.documentChunks),
        graph: required(gateway.graphIndex),
        legacyBootstraps: required(databaseRepositories.legacySpacePublicationBootstraps),
        pageIndexUpgradeBackfills: required(databaseRepositories.pageIndexUpgradeBackfills),
        logicalDocuments: required(gateway.logicalDocuments),
        manifests: required(gateway.knowledgeSpaceManifests),
        members: required(gateway.projectionSetPublicationMembers),
        multimodalManifests: required(gateway.documentMultimodalManifests),
        nodes: required(gateway.knowledgeNodes),
        outlines: required(gateway.documentOutlines),
        paths: required(gateway.knowledgePaths),
        profiles: required(databaseRepositories.knowledgeSpaceProfiles),
        projections: required(gateway.projections),
        publications: required(gateway.projectionSetPublications),
        settings: required(gateway.documentSettings),
        tasks: required(gateway.documentProcessingTasks),
      },
      semanticChunker: {} as never,
    });

    expect(assembly).toMatchObject({
      compilationJobs: expect.any(Object),
      documentChunkState: expect.objectContaining({ request: expect.any(Function) }),
      documentRevisionRollbacks: expect.objectContaining({ request: expect.any(Function) }),
      documentSettingsChanges: expect.objectContaining({ request: expect.any(Function) }),
      dispatcher: expect.objectContaining({
        start: expect.any(Function),
        tick: expect.any(Function),
      }),
      legacyBootstrapRuntime: expect.objectContaining({
        start: expect.any(Function),
        tick: expect.any(Function),
      }),
      legacyBootstrapService: expect.objectContaining({
        get: expect.any(Function),
        start: expect.any(Function),
      }),
      pageIndexUpgradeBackfillRuntime: expect.objectContaining({
        start: expect.any(Function),
        tick: expect.any(Function),
      }),
      pageIndexUpgradeBackfillService: expect.objectContaining({
        get: expect.any(Function),
        start: expect.any(Function),
      }),
      runtime: expect.objectContaining({ start: expect.any(Function), tick: expect.any(Function) }),
      sourceCompilationPublication: expect.objectContaining({
        publishAndWait: expect.any(Function),
      }),
      start: expect.any(Function),
      stop: expect.any(Function),
    });
    assembly?.stop();
  });
});

describe("createDocumentSemanticEnrichmentGenerationGuard", () => {
  it("waits when another document advances the space head before this compilation publishes", async () => {
    const guard = semanticGenerationGuard({ attemptRunState: "running", memberKeys: [] });

    await expect(guard.status(semanticJob())).resolves.toBe("pending");
  });

  it("accepts the exact outline generation once it is part of the current publication", async () => {
    const guard = semanticGenerationGuard({
      attemptRunState: "running",
      memberKeys: [outlineId],
    });

    await expect(guard.status(semanticJob())).resolves.toBe("current");
  });

  it("supersedes a successful generation that is absent from the current publication", async () => {
    const guard = semanticGenerationGuard({ attemptRunState: "succeeded", memberKeys: [] });

    await expect(guard.status(semanticJob())).resolves.toBe("superseded");
  });
});

const attemptId = "018f0d60-7a49-7cc2-9c1b-000000000001";
const assetId = "018f0d60-7a49-7cc2-9c1b-000000000002";
const generationId = "018f0d60-7a49-7cc2-9c1b-000000000003";
const outlineId = "018f0d60-7a49-7cc2-9c1b-000000000004";
const publicationId = "018f0d60-7a49-7cc2-9c1b-000000000005";
const spaceId = "018f0d60-7a49-7cc2-9c1b-000000000006";

function semanticGenerationGuard({
  attemptRunState,
  memberKeys,
}: {
  readonly attemptRunState: "running" | "succeeded";
  readonly memberKeys: readonly string[];
}) {
  return createDocumentSemanticEnrichmentGenerationGuard({
    attempts: {
      get: async () => ({
        id: attemptId,
        publicationGenerationId: generationId,
        runState: attemptRunState,
      }),
    } as never,
    members: {
      filterComponentKeys: async () => [...memberKeys],
    } as never,
    outlines: {
      getByDocumentVersion: async () => ({ id: outlineId }),
    } as never,
    publications: {
      getPublished: async () => ({ headRevision: 8, id: publicationId }),
    } as never,
  });
}

function semanticJob() {
  return {
    baseHeadRevision: 7,
    compilationAttemptId: attemptId,
    documentAssetId: assetId,
    documentVersion: 1,
    knowledgeSpaceId: spaceId,
    publicationGenerationId: generationId,
    tenantId: "tenant-1",
  } as never;
}

function required<T>(value: T | undefined): T {
  if (!value) {
    throw new Error("Expected database repository fixture");
  }
  return value;
}
