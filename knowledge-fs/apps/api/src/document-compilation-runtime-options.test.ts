import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  createApiDocumentCompilationRuntime,
  createApiProfileMigrationGatewayOptions,
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

function required<T>(value: T | undefined): T {
  if (!value) {
    throw new Error("Expected database repository fixture");
  }
  return value;
}
