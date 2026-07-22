import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type KnowledgeGatewayOptions,
  createInMemoryKnowledgeSpaceManifestRepository,
  createInMemoryKnowledgeSpaceProfileMigrationRepository,
  createInMemoryKnowledgeSpaceProfileRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";

const writeToken = "assembly-write";

type GatewayPort<Name extends keyof KnowledgeGatewayOptions> = NonNullable<
  KnowledgeGatewayOptions[Name]
>;

function uninvokedPort<Name extends keyof KnowledgeGatewayOptions>(): GatewayPort<Name> {
  return {} as GatewayPort<Name>;
}

function adapter() {
  return createNodePlatformAdapter({ env: {} });
}

function auth() {
  return createStaticAuthVerifier({
    subjectsByToken: {
      [writeToken]: {
        scopes: ["knowledge-spaces:*"],
        subjectId: "user:assembly-owner",
        tenantId: "tenant-1",
      },
    },
  });
}

function bearer(contentType = false) {
  return {
    authorization: `Bearer ${writeToken}`,
    ...(contentType ? { "content-type": "application/json" } : {}),
  };
}

async function createSpace(app: ReturnType<typeof createKnowledgeGateway>, name: string) {
  const response = await app.request("/knowledge-spaces", {
    body: JSON.stringify({ name, slug: name.toLowerCase().replaceAll(" ", "-") }),
    headers: bearer(true),
    method: "POST",
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()).id as string;
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("knowledge gateway assembly coverage", () => {
  it("assembles the opt-in production ports and exposes their managed runtimes", async () => {
    vi.useFakeTimers();
    const stops: Array<() => Promise<void> | void> = [];
    const profileMigrations = createInMemoryKnowledgeSpaceProfileMigrationRepository({
      maxRuns: 10,
    });
    const profiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 10,
    });

    const app = createKnowledgeGateway({
      adapter: adapter(),
      allowLegacyResearchTaskProfileFallback: true,
      answerTraces: uninvokedPort<"answerTraces">(),
      autoRetrievalModeResolver: uninvokedPort<"autoRetrievalModeResolver">(),
      bulkOperations: uninvokedPort<"bulkOperations">(),
      capabilityGrantProvenance: uninvokedPort<"capabilityGrantProvenance">(),
      denseEmbeddingModel: "dense-v1",
      denseEmbeddingProvider: uninvokedPort<"denseEmbeddingProvider">(),
      deletionLifecycleFence: uninvokedPort<"deletionLifecycleFence">(),
      deletionObjectWriteAdmission: uninvokedPort<"deletionObjectWriteAdmission">(),
      difyCapabilityV2Auth: uninvokedPort<"difyCapabilityV2Auth">(),
      difyIntegrationFreezes: uninvokedPort<"difyIntegrationFreezes">(),
      difyIntegrationStates: uninvokedPort<"difyIntegrationStates">(),
      directUploadAllowedOrigins: ["https://app.example.com"],
      documentChunkState: uninvokedPort<"documentChunkState">(),
      documentChunks: uninvokedPort<"documentChunks">(),
      documentCompilationJobs: uninvokedPort<"documentCompilationJobs">(),
      documentMultimodalImageVariantGenerator:
        uninvokedPort<"documentMultimodalImageVariantGenerator">(),
      documentMultimodalLocalAssetAllowlist: ["https://assets.example.com"],
      documentMultimodalManifestEnhancer: uninvokedPort<"documentMultimodalManifestEnhancer">(),
      documentMultimodalMaxExtractedAssets: 2,
      documentMultimodalMaxLocalAssetBytes: 1_024,
      documentMultimodalMaxPdfRasterizedAssets: 2,
      documentOutlineSummaryEnhancer: uninvokedPort<"documentOutlineSummaryEnhancer">(),
      documentPdfRasterizer: uninvokedPort<"documentPdfRasterizer">(),
      documentProcessingTasks: uninvokedPort<"documentProcessingTasks">(),
      documentRevisionRollbacks: uninvokedPort<"documentRevisionRollbacks">(),
      documentSettings: uninvokedPort<"documentSettings">(),
      documentSettingsChanges: uninvokedPort<"documentSettingsChanges">(),
      durableDeletionRepository: uninvokedPort<"durableDeletionRepository">(),
      embeddingProvider: uninvokedPort<"embeddingProvider">(),
      embeddingResolver: uninvokedPort<"embeddingResolver">(),
      failedQueryLowConfidenceScoreFloor: 0.25,
      integratedKnowledgeSpaceProvisioning: {
        ...uninvokedPort<"integratedKnowledgeSpaceProvisioning">(),
        provisioningMode: "integrated",
      },
      knowledgeSpaceProfileMigrationRepository: profileMigrations,
      knowledgeSpaceProfilePublications: uninvokedPort<"knowledgeSpaceProfilePublications">(),
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaceProvisioning: uninvokedPort<"knowledgeSpaceProvisioning">(),
      knowledgeSpaceUnpublishedProfileActivations:
        uninvokedPort<"knowledgeSpaceUnpublishedProfileActivations">(),
      legacySpacePublicationBootstraps: uninvokedPort<"legacySpacePublicationBootstraps">(),
      logicalDocuments: uninvokedPort<"logicalDocuments">(),
      modelCapabilityCatalog: uninvokedPort<"modelCapabilityCatalog">(),
      modelCapabilityPreflight: uninvokedPort<"modelCapabilityPreflight">(),
      onlineDocumentConnector: uninvokedPort<"onlineDocumentConnector">(),
      onlineDriveConnector: uninvokedPort<"onlineDriveConnector">(),
      pageIndexUpgradeBackfills: uninvokedPort<"pageIndexUpgradeBackfills">(),
      projectionSetPublications: uninvokedPort<"projectionSetPublications">(),
      publishedGraph: uninvokedPort<"publishedGraph">(),
      qualityControl: {
        onRuntime: (runtime) => stops.push(() => runtime.stop()),
        repository: uninvokedPort<"qualityControl">().repository,
        workerId: "quality-worker",
        workerIntervalMs: 60_000,
      },
      relevanceTriageSignals: uninvokedPort<"relevanceTriageSignals">(),
      researchTaskDeletionVisibility: uninvokedPort<"researchTaskDeletionVisibility">(),
      researchTaskDirectStream: {
        allowedOrigins: ["https://app.example.com"],
        maxConnectionMs: 60_000,
      },
      retrievalExecutionLeases: uninvokedPort<"retrievalExecutionLeases">(),
      retrievalTestExecutor: uninvokedPort<"retrievalTestExecutor">(),
      runtimeSnapshotResolver: uninvokedPort<"runtimeSnapshotResolver">(),
      semanticCommunitySummaryProvider: uninvokedPort<"semanticCommunitySummaryProvider">(),
      semanticEntityExtractionProvider: uninvokedPort<"semanticEntityExtractionProvider">(),
      semanticRelationExtractionProvider: uninvokedPort<"semanticRelationExtractionProvider">(),
      sourceCredentials: uninvokedPort<"sourceCredentials">(),
      sourceProduct: {
        bulkRemoval: uninvokedPort<"sourceProduct">().bulkRemoval,
        connections: uninvokedPort<"sourceProduct">().connections,
        logicalRevisions: uninvokedPort<"sourceProduct">().logicalRevisions,
        onSyncPolicyRuntime: (runtime) => stops.push(() => runtime.stop()),
        onWorkflowRuntime: (runtime) => stops.push(() => runtime.stop()),
        providers: uninvokedPort<"sourceProduct">().providers,
        repository: uninvokedPort<"sourceProduct">().repository,
        workerId: "source-worker",
      },
      tidbFtsPostingReadiness: uninvokedPort<"tidbFtsPostingReadiness">(),
      uploadSessions: uninvokedPort<"uploadSessions">(),
      visualEmbeddingModel: "vision-v1",
      visualEmbeddingProvider: uninvokedPort<"visualEmbeddingProvider">(),
      websiteCrawlConnector: uninvokedPort<"websiteCrawlConnector">(),
    });

    expect(app).toBeDefined();
    expect(stops).toHaveLength(3);
    for (const stop of stops) await stop();
  });

  it("assembles the legacy source scheduler with every connector", () => {
    vi.useFakeTimers();
    const schedulers: unknown[] = [];

    const app = createKnowledgeGateway({
      adapter: adapter(),
      onlineDocumentConnector: uninvokedPort<"onlineDocumentConnector">(),
      onlineDriveConnector: uninvokedPort<"onlineDriveConnector">(),
      sourceCredentials: uninvokedPort<"sourceCredentials">(),
      sourceSync: {
        intervalMs: 1_000,
        maxSourcesPerTick: 10,
        onScheduler: (scheduler) => schedulers.push(scheduler),
      },
      websiteCrawlConnector: uninvokedPort<"websiteCrawlConnector">(),
    });

    expect(app).toBeDefined();
    expect(schedulers).toHaveLength(1);
  });

  it("assembles the bounded local-query fallback outside production", () => {
    const app = createKnowledgeGateway({
      adapter: adapter(),
      allowLocalQueryFallback: true,
      maxLocalQueryAnswerChars: 128,
      maxLocalQueryNodes: 16,
    });

    expect(app).toBeDefined();
  });

  it("repairs a transiently missing manifest before admitting an asset", async () => {
    const repository = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    let manifestReads = 0;
    const manifests: GatewayPort<"knowledgeSpaceManifests"> = {
      ...repository,
      get: async (input) => {
        manifestReads += 1;
        if (manifestReads === 2) return null;
        return repository.get(input);
      },
    };
    const app = createKnowledgeGateway({
      adapter: adapter(),
      auth: auth(),
      knowledgeSpaceManifests: manifests,
    });
    const spaceId = await createSpace(app, "Manifest Repair");
    manifestReads = 0;
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "repair.md", { type: "text/markdown" }));

    const response = await app.request(`/knowledge-spaces/${spaceId}/documents`, {
      body: form,
      headers: bearer(),
      method: "POST",
    });

    expect(response.status, await response.clone().text()).toBe(201);
    expect(manifestReads).toBeGreaterThanOrEqual(4);
  });

  it("replays a workspace command through the gateway-owned shell runner", async () => {
    const app = createKnowledgeGateway({ adapter: adapter(), auth: auth() });
    const spaceId = await createSpace(app, "Workspace Runner");
    const created = await app.request("/agent-workspace-snapshots", {
      body: JSON.stringify({
        commandLog: [
          {
            command: "ls /knowledge/docs --limit 2",
            input: { path: "/knowledge/docs" },
            outputSummary: "no documents",
            startedAt: "2026-07-21T12:00:00.000Z",
          },
        ],
        evidenceBundles: [],
        indexProjection: { fingerprint: "projection-v1", projectionIds: [] },
        knowledgeSpaceId: spaceId,
      }),
      headers: bearer(true),
      method: "POST",
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const snapshotId = ((await created.json()) as { id: string }).id;

    const replayed = await app.request(`/agent-workspace-snapshots/${snapshotId}/replay`, {
      headers: bearer(),
      method: "POST",
    });

    expect(replayed.status, await replayed.clone().text()).toBe(200);
    await expect(replayed.json()).resolves.toMatchObject({
      snapshotId,
      summary: { total: 1 },
    });
  });

  it("uses the gateway clock when authorizing a durable deletion request", async () => {
    const getJobByIdempotency = vi.fn(async () => null);
    const durableDeletionRepository: GatewayPort<"durableDeletionRepository"> = {
      ...uninvokedPort<"durableDeletionRepository">(),
      getJobByIdempotency,
    };
    const now = vi.fn(() => "2026-07-21T12:00:00.000Z");
    const app = createKnowledgeGateway({
      adapter: adapter(),
      auth: auth(),
      deletionLifecycleFence: uninvokedPort<"deletionLifecycleFence">(),
      deletionObjectWriteAdmission: uninvokedPort<"deletionObjectWriteAdmission">(),
      durableDeletionRepository,
      logicalDocuments: uninvokedPort<"logicalDocuments">(),
      now,
    });
    const spaceId = await createSpace(app, "Deletion Clock");

    const response = await app.request(`/knowledge-spaces/${spaceId}`, {
      body: JSON.stringify({ challenge: "wrong-name", expectedRevision: 1 }),
      headers: { ...bearer(true), "idempotency-key": "assembly-delete-1" },
      method: "DELETE",
    });

    expect(response.status, await response.clone().text()).toBe(409);
    expect(getJobByIdempotency).toHaveBeenCalledOnce();
    expect(now).toHaveBeenCalled();
  });

  it.each([
    [{ maxBulkOperations: 0 }, "Bulk operation maxBulkOperations must be at least 1"],
    [{ maxLocalQueryNodes: 0 }, "Local node query maxLocalQueryNodes must be at least 1"],
    [
      { maxLocalQueryAnswerChars: 0 },
      "Local node query maxLocalQueryAnswerChars must be at least 1",
    ],
    [
      { maxSynchronousUploadNodes: 0 },
      "Synchronous upload maxSynchronousUploadNodes must be at least 1",
    ],
    [
      { embeddingProvider: uninvokedPort<"embeddingProvider">() },
      "Knowledge gateway denseEmbeddingModel is required when embeddingProvider is configured",
    ],
    [
      { denseEmbeddingProvider: uninvokedPort<"denseEmbeddingProvider">() },
      "Knowledge gateway denseEmbeddingModel is required",
    ],
    [
      { visualEmbeddingProvider: uninvokedPort<"visualEmbeddingProvider">() },
      "Knowledge gateway visualEmbeddingModel is required",
    ],
  ] satisfies ReadonlyArray<readonly [Partial<KnowledgeGatewayOptions>, string]>)(
    "rejects invalid late assembly option %#",
    (overrides, message) => {
      expect(() => createKnowledgeGateway({ adapter: adapter(), ...overrides })).toThrow(message);
    },
  );

  it("fails closed for incompatible optional service combinations", () => {
    expect(() =>
      createKnowledgeGateway({
        adapter: adapter(),
        auth: uninvokedPort<"auth">(),
        difyCapabilityV2Auth: uninvokedPort<"difyCapabilityV2Auth">(),
      }),
    ).toThrow("Configure either legacy auth or Dify Capability v2 auth, not both");

    expect(() =>
      createKnowledgeGateway({
        adapter: adapter(),
        uploadSessions: uninvokedPort<"uploadSessions">(),
      }),
    ).toThrow("Direct upload sessions require Capability v2 and durable grant provenance");

    expect(() =>
      createKnowledgeGateway({
        adapter: adapter(),
        researchTaskDirectStream: { allowedOrigins: [], maxConnectionMs: 1_000 },
      }),
    ).toThrow("Direct Research streams require Capability v2 and durable grant provenance");

    expect(() =>
      createKnowledgeGateway({
        adapter: adapter(),
        knowledgeSpaceProfileMigrationRepository:
          createInMemoryKnowledgeSpaceProfileMigrationRepository({ maxRuns: 1 }),
        knowledgeSpaceProfileMigrations: uninvokedPort<"knowledgeSpaceProfileMigrations">(),
      }),
    ).toThrow(
      "Configure either knowledgeSpaceProfileMigrations or knowledgeSpaceProfileMigrationRepository, not both",
    );

    expect(() =>
      createKnowledgeGateway({
        adapter: adapter(),
        knowledgeSpaceProfileMigrationRepository:
          createInMemoryKnowledgeSpaceProfileMigrationRepository({ maxRuns: 1 }),
      }),
    ).toThrow(
      "Profile migration repository requires profile and projection publication repositories",
    );

    expect(() =>
      createKnowledgeGateway({
        adapter: adapter(),
        durableDeletionRepository: uninvokedPort<"durableDeletionRepository">(),
        durableDeletions: uninvokedPort<"durableDeletions">(),
      }),
    ).toThrow("Configure either durableDeletions or durableDeletionRepository, not both");

    expect(() =>
      createKnowledgeGateway({
        adapter: adapter(),
        qualityControl: {
          repository: uninvokedPort<"qualityControl">().repository,
          workerId: "quality-worker",
        },
      }),
    ).toThrow(
      "Quality replay requires the production retrieval-test executor and published runtime snapshot resolver",
    );
  });

  it("requires production-only provenance and browser origin dependencies", () => {
    vi.stubEnv("NODE_ENV", "production");
    const provisioning = uninvokedPort<"knowledgeSpaceProvisioning">();

    expect(() =>
      createKnowledgeGateway({
        adapter: adapter(),
        difyCapabilityV2Auth: uninvokedPort<"difyCapabilityV2Auth">(),
        knowledgeSpaceProvisioning: provisioning,
      }),
    ).toThrow("Durable Capability grant provenance is required for Capability v2 in production");

    expect(() =>
      createKnowledgeGateway({
        adapter: adapter(),
        capabilityGrantProvenance: uninvokedPort<"capabilityGrantProvenance">(),
        difyCapabilityV2Auth: uninvokedPort<"difyCapabilityV2Auth">(),
        difyIntegrationFreezes: uninvokedPort<"difyIntegrationFreezes">(),
        difyIntegrationStates: uninvokedPort<"difyIntegrationStates">(),
        knowledgeSpaceProvisioning: provisioning,
        uploadSessions: uninvokedPort<"uploadSessions">(),
      }),
    ).toThrow("Direct upload sessions require exact browser CORS origins in production");
  });
});
