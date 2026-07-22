import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  type KnowledgeSpaceProvisioningRepository,
  ModelCapabilityPreflightError,
  createInMemoryKnowledgeFsLeaseRepository,
  createInMemoryKnowledgeSpaceAccessRepository,
  createInMemoryKnowledgeSpaceManifestRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryStagedCommitRepository,
  createKnowledgeGateway,
  createKnowledgeSpaceAccessService,
  createStaticAuthVerifier,
} from "./index";

const readToken = "read-token";
const writeToken = "write-token";
const unknownSpaceId = "00000000-0000-4000-8000-00000000dead";

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function json(token: string) {
  return { ...bearer(token), "content-type": "application/json" };
}

function createAuth() {
  return createStaticAuthVerifier({
    subjectsByToken: {
      [readToken]: { scopes: ["knowledge-spaces:read"], subjectId: "u1", tenantId: "tenant-1" },
      [writeToken]: { scopes: ["knowledge-spaces:*"], subjectId: "u1", tenantId: "tenant-1" },
    },
  });
}

type GatewayOptions = Omit<Parameters<typeof createKnowledgeGateway>[0], "adapter" | "auth"> & {
  adapter?: Parameters<typeof createKnowledgeGateway>[0]["adapter"];
};

function createApp(options: GatewayOptions = {}) {
  const { adapter, ...rest } = options;
  return createKnowledgeGateway({
    adapter: adapter ?? createNodePlatformAdapter({ env: {} }),
    auth: createAuth(),
    ...rest,
  });
}

async function createSpace(app: ReturnType<typeof createApp>, slug = "space"): Promise<string> {
  const response = await app.request("/knowledge-spaces", {
    body: JSON.stringify({ name: `Space ${slug}`, slug }),
    headers: json(writeToken),
    method: "POST",
  });
  expect(response.status).toBe(201);

  return (await response.json()).id;
}

describe("knowledge space operator handlers coverage", () => {
  it("returns handler-level not-found responses after authorization succeeds", async () => {
    const access = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 100,
        maxMembersPerSpace: 10,
      }),
    });
    await access.initialize({
      knowledgeSpaceId: unknownSpaceId,
      ownerSubjectId: "u1",
      tenantId: "tenant-1",
    });
    const app = createApp({ knowledgeSpaceAccess: access });
    const retrieval = {
      defaultMode: "research",
      reasoningModel: { model: "reasoning", pluginId: "plugin", provider: "provider" },
      rerank: { enabled: false },
      scoreThreshold: { enabled: false, stage: "mode-final" },
      topK: 8,
    } as const;
    const requests: [string, RequestInit][] = [
      [`/knowledge-spaces/${unknownSpaceId}`, { headers: bearer(readToken) }],
      [`/knowledge-spaces/${unknownSpaceId}/manifest`, { headers: bearer(readToken) }],
      [`/knowledge-spaces/${unknownSpaceId}/product-settings`, { headers: bearer(readToken) }],
      [`/knowledge-spaces/${unknownSpaceId}/status`, { headers: bearer(readToken) }],
      [`/knowledge-spaces/${unknownSpaceId}/stats`, { headers: bearer(readToken) }],
      [`/knowledge-spaces/${unknownSpaceId}/fsck`, { headers: bearer(readToken) }],
      [`/knowledge-spaces/${unknownSpaceId}/gc/staged-objects`, { headers: bearer(readToken) }],
      [`/knowledge-spaces/${unknownSpaceId}/leases/active`, { headers: bearer(readToken) }],
      [`/knowledge-spaces/${unknownSpaceId}/staged-commits`, { headers: bearer(readToken) }],
      [
        `/knowledge-spaces/${unknownSpaceId}/product-settings`,
        {
          body: JSON.stringify({ expectedRevision: 1, retrieval }),
          headers: json(writeToken),
          method: "PATCH",
        },
      ],
      [
        `/knowledge-spaces/${unknownSpaceId}/embedding-profile`,
        {
          body: JSON.stringify({ model: "embedding", pluginId: "plugin", provider: "provider" }),
          headers: json(writeToken),
          method: "PUT",
        },
      ],
      [
        `/knowledge-spaces/${unknownSpaceId}/retrieval-profile`,
        {
          body: JSON.stringify({ expectedRevision: 0, profile: retrieval }),
          headers: json(writeToken),
          method: "PUT",
        },
      ],
      [
        `/knowledge-spaces/${unknownSpaceId}/gc/staged-objects/execute`,
        {
          body: JSON.stringify({ candidates: [] }),
          headers: json(writeToken),
          method: "POST",
        },
      ],
      [
        `/knowledge-spaces/${unknownSpaceId}`,
        {
          body: JSON.stringify({ expectedRevision: 1, name: "Missing" }),
          headers: json(writeToken),
          method: "PATCH",
        },
      ],
    ];

    for (const [path, init] of requests) {
      const response = await app.request(path, init);
      expect(response.status, path).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Knowledge space not found" });
    }
  });

  it("rejects a mode-incompatible retrieval profile on an existing space", async () => {
    const app = createApp();
    const spaceId = await createSpace(app, "invalid-retrieval-update");
    const response = await app.request(`/knowledge-spaces/${spaceId}/retrieval-profile`, {
      body: JSON.stringify({
        expectedRevision: 0,
        profile: {
          defaultMode: "deep",
          reasoningModel: { model: "reasoning", pluginId: "plugin", provider: "provider" },
          rerank: { enabled: false },
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.25 },
          topK: 8,
        },
      }),
      headers: json(writeToken),
      method: "PUT",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "RETRIEVAL_PROFILE_SCORE_THRESHOLD_REQUIRES_RERANK",
      mode: "deep",
    });
  });

  it("paginates the authorization fallback and hides inaccessible spaces", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({ maxListLimit: 100, maxSpaces: 100 });
    await spaces.create({ name: "Hidden", slug: "a-hidden", tenantId: "tenant-1" });
    const app = createApp({ knowledgeSpaces: spaces });
    await createSpace(app, "b-visible");
    await createSpace(app, "c-visible");
    await createSpace(app, "d-visible");

    const firstPage = await app.request("/knowledge-spaces?limit=2", {
      headers: bearer(readToken),
    });
    expect(firstPage.status).toBe(200);
    await expect(firstPage.json()).resolves.toMatchObject({
      items: [{ slug: "b-visible" }, { slug: "c-visible" }],
      nextCursor: "c-visible",
    });

    const secondPage = await app.request("/knowledge-spaces?limit=2&cursor=c-visible", {
      headers: bearer(readToken),
    });
    expect(secondPage.status).toBe(200);
    await expect(secondPage.json()).resolves.toMatchObject({
      items: [{ slug: "d-visible" }],
    });
  });

  it("uses a repository-native authorized list when one is available", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({ maxListLimit: 100, maxSpaces: 100 });
    const app = createApp({
      knowledgeSpaces: {
        ...spaces,
        listAuthorized: async () => ({ items: [] }),
      },
    });

    const response = await app.request("/knowledge-spaces?limit=3", {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ items: [] });
  });

  it("forwards optional provisioning fields and records generated versus explicit slugs", async () => {
    const inputs: Parameters<KnowledgeSpaceProvisioningRepository["provision"]>[0][] = [];
    const provisioning: KnowledgeSpaceProvisioningRepository = {
      provision: async (input) => {
        inputs.push(input);
        const sequence = inputs.length.toString().padStart(12, "0");
        return {
          configurationStatus: "setup-required",
          replayed: false,
          space: {
            createdAt: "2026-07-21T00:00:00.000Z",
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.iconRef === undefined ? {} : { iconRef: input.iconRef }),
            id: `00000000-0000-4000-8000-${sequence}`,
            name: input.name,
            revision: 1,
            slug: input.slug,
            tenantId: input.tenantId,
            updatedAt: "2026-07-21T00:00:00.000Z",
          },
        };
      },
    };
    const app = createApp({
      generateKnowledgeSpaceProvisioningKey: () => "generated-idempotency-key",
      knowledgeSpaceProvisioning: provisioning,
    });

    const explicit = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        description: "Provisioned description",
        iconRef: "builtin:folder",
        name: "Explicit",
        slug: "explicit-space",
      }),
      headers: json(writeToken),
      method: "POST",
    });
    const generated = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Generated Space" }),
      headers: json(writeToken),
      method: "POST",
    });

    expect(explicit.status).toBe(201);
    expect(generated.status).toBe(201);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      description: "Provisioned description",
      iconRef: "builtin:folder",
      idempotencyKey: "generated-idempotency-key",
      slug: "explicit-space",
      slugSource: "explicit",
    });
    expect(inputs[1]).toMatchObject({ slugSource: "generated" });
    expect(inputs[1]?.slug).toBe("generated-space");
  });

  it("rejects invalid retrieval intent and preserves model-preflight retryability", async () => {
    const invalidProfile = {
      defaultMode: "deep",
      reasoningModel: { model: "reasoning", pluginId: "plugin", provider: "provider" },
      rerank: { enabled: false },
      scoreThreshold: { enabled: true, stage: "mode-final", value: 0.5 },
      topK: 8,
    } as const;
    const invalid = await createApp().request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Invalid retrieval", retrievalProfile: invalidProfile }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(invalid.status).toBe(400);

    const deepWithoutEmbedding = await createApp().request("/knowledge-spaces", {
      body: JSON.stringify({
        name: "Deep without embedding",
        retrievalProfile: {
          ...invalidProfile,
          scoreThreshold: { enabled: false, stage: "mode-final" },
        },
      }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(deepWithoutEmbedding.status).toBe(422);

    const retryable = await createApp({
      knowledgeSpaceProvisioning: {
        provision: async () => {
          throw new ModelCapabilityPreflightError(
            "MODEL_PREFLIGHT_UNAVAILABLE",
            "preflight unavailable",
            { retryable: true },
          );
        },
      },
    }).request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Retry later" }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(retryable.status).toBe(503);
  });

  it("compensates every legacy provisioning aggregate after access initialization fails", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({ maxListLimit: 100, maxSpaces: 100 });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 100,
      maxManifests: 100,
    });
    const baseAccess = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 100,
        maxMembersPerSpace: 10,
      }),
    });
    const app = createApp({
      knowledgeSpaceAccess: {
        ...baseAccess,
        deleteAggregate: async () => {
          throw new Error("access compensation failed");
        },
        initialize: async () => {
          throw new Error("access initialization failed");
        },
      },
      knowledgeSpaceManifests: {
        ...manifests,
        delete: async () => {
          throw new Error("manifest compensation failed");
        },
      },
      knowledgeSpaces: {
        ...spaces,
        rollbackCreate: async () => {
          throw new Error("space compensation failed");
        },
      },
    });

    const response = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Compensate me" }),
      headers: json(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(500);
  });

  it("updates pending product settings and reports semantic and concurrent conflicts", async () => {
    const retrieval = {
      defaultMode: "research",
      reasoningModel: { model: "reasoning", pluginId: "plugin", provider: "provider" },
      rerank: { enabled: false },
      scoreThreshold: { enabled: true, stage: "mode-final", value: 0.25 },
      topK: 8,
    } as const;
    const app = createApp();
    const spaceId = await createSpace(app, "product-settings");
    const initial = await app.request(`/knowledge-spaces/${spaceId}/product-settings`, {
      headers: bearer(readToken),
    });
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toMatchObject({
      configurationState: "setup-required",
      embedding: null,
      retrieval: null,
      revision: 1,
    });

    const retrievalUpdate = await app.request(`/knowledge-spaces/${spaceId}/product-settings`, {
      body: JSON.stringify({ expectedRevision: 1, retrieval }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(retrievalUpdate.status).toBe(200);
    await expect(retrievalUpdate.json()).resolves.toMatchObject({
      configurationState: "pending-validation",
      retrieval,
      revision: 2,
    });

    const embeddingUpdate = await app.request(`/knowledge-spaces/${spaceId}/product-settings`, {
      body: JSON.stringify({
        embedding: { model: "embedding", pluginId: "plugin", provider: "provider" },
        expectedRevision: 2,
      }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(embeddingUpdate.status).toBe(200);
    await expect(embeddingUpdate.json()).resolves.toMatchObject({
      configurationState: "pending-validation",
      revision: 3,
    });

    const missingEmbeddingApp = createApp();
    const missingEmbeddingSpaceId = await createSpace(missingEmbeddingApp, "missing-embedding");
    const missingEmbedding = await missingEmbeddingApp.request(
      `/knowledge-spaces/${missingEmbeddingSpaceId}/product-settings`,
      {
        body: JSON.stringify({
          expectedRevision: 1,
          retrieval: {
            ...retrieval,
            defaultMode: "deep",
            scoreThreshold: { enabled: false, stage: "mode-final" },
          },
        }),
        headers: json(writeToken),
        method: "PATCH",
      },
    );
    expect(missingEmbedding.status).toBe(409);
    await expect(missingEmbedding.json()).resolves.toMatchObject({
      code: "EMBEDDING_MODEL_REQUIRED",
    });

    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 100,
      maxManifests: 100,
    });
    const conflictApp = createApp({
      knowledgeSpaceManifests: {
        ...manifests,
        update: async () => null,
      },
    });
    const conflictSpaceId = await createSpace(conflictApp, "manifest-conflict");
    const conflict = await conflictApp.request(
      `/knowledge-spaces/${conflictSpaceId}/product-settings`,
      {
        body: JSON.stringify({ expectedRevision: 1, retrieval }),
        headers: json(writeToken),
        method: "PATCH",
      },
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "PRODUCT_SETTINGS_REVISION_CONFLICT",
    });

    const embeddingOnlyApp = createApp();
    const embeddingOnlySpaceId = await createSpace(embeddingOnlyApp, "embedding-only");
    const embeddingSelection = {
      model: "embedding-only",
      pluginId: "plugin",
      provider: "provider",
    };
    const embeddingOnly = await embeddingOnlyApp.request(
      `/knowledge-spaces/${embeddingOnlySpaceId}/product-settings`,
      {
        body: JSON.stringify({ embedding: embeddingSelection, expectedRevision: 1 }),
        headers: json(writeToken),
        method: "PATCH",
      },
    );
    expect(embeddingOnly.status).toBe(200);
    await expect(embeddingOnly.json()).resolves.toMatchObject({
      embedding: embeddingSelection,
      retrieval: null,
    });
    const embeddingReplay = await embeddingOnlyApp.request(
      `/knowledge-spaces/${embeddingOnlySpaceId}/embedding-profile`,
      {
        body: JSON.stringify(embeddingSelection),
        headers: json(writeToken),
        method: "PUT",
      },
    );
    expect(embeddingReplay.status).toBe(202);
    await expect(embeddingReplay.json()).resolves.toMatchObject({
      configurationStatus: "setup-required",
      operation: "initial-validation-pending",
    });
    const addRetrieval = await embeddingOnlyApp.request(
      `/knowledge-spaces/${embeddingOnlySpaceId}/product-settings`,
      {
        body: JSON.stringify({ expectedRevision: 2, retrieval }),
        headers: json(writeToken),
        method: "PATCH",
      },
    );
    expect(addRetrieval.status).toBe(200);
    await expect(addRetrieval.json()).resolves.toMatchObject({
      embedding: embeddingSelection,
      retrieval,
    });
  });

  it("retries a failed pending embedding selection with a new validation revision", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 100,
      maxManifests: 100,
    });
    const app = createApp({ knowledgeSpaceManifests: manifests });
    const spaceId = await createSpace(app, "retry-failed-pending");
    const manifest = await manifests.get({ knowledgeSpaceId: spaceId, tenantId: "tenant-1" });
    if (!manifest) throw new Error("test manifest missing");
    const embeddingSelection = {
      model: "embedding-retry",
      pluginId: "plugin",
      provider: "provider",
    };
    const failed = await manifests.update({
      expectedManifestVersion: manifest.manifestVersion,
      knowledgeSpaceId: spaceId,
      patch: {
        manifestVersion: manifest.manifestVersion + 1,
        pendingModelConfiguration: {
          digest: "f".repeat(64),
          embeddingSelection,
          failure: {
            code: "MODEL_PROBE_FAILED",
            failedAt: "2026-07-21T00:00:00.000Z",
            retryable: true,
          },
          revision: 1,
          state: "validation-failed",
        },
      },
      tenantId: "tenant-1",
    });
    expect(failed).not.toBeNull();

    const response = await app.request(`/knowledge-spaces/${spaceId}/embedding-profile`, {
      body: JSON.stringify(embeddingSelection),
      headers: json(writeToken),
      method: "PUT",
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ revision: 2 });
  });

  it("returns successful empty operator pages and applies a regular space update", async () => {
    const app = createApp();
    const spaceId = await createSpace(app, "operator-success");

    const executeGc = await app.request(`/knowledge-spaces/${spaceId}/gc/staged-objects/execute`, {
      body: JSON.stringify({ candidates: [] }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(executeGc.status).toBe(200);
    await expect(executeGc.json()).resolves.toMatchObject({ deleted: 0, items: [], skipped: 0 });

    const commits = await app.request(`/knowledge-spaces/${spaceId}/staged-commits`, {
      headers: bearer(readToken),
    });
    expect(commits.status).toBe(200);
    await expect(commits.json()).resolves.toEqual({ items: [] });

    const update = await app.request(`/knowledge-spaces/${spaceId}`, {
      body: JSON.stringify({ expectedRevision: 1, name: "Updated operator space" }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(update.status).toBe(200);
    await expect(update.json()).resolves.toMatchObject({
      name: "Updated operator space",
      revision: 2,
    });
  });

  it("treats malformed reserved pending configuration metadata as validation failure", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 100,
      maxManifests: 100,
    });
    const app = createApp({ knowledgeSpaceManifests: manifests });
    const spaceId = await createSpace(app, "invalid-pending");
    const current = await manifests.get({ knowledgeSpaceId: spaceId, tenantId: "tenant-1" });
    if (!current) throw new Error("test manifest missing");

    const malformedCandidates: unknown[] = [
      "not-an-object",
      { digest: "a".repeat(64), failure: { code: "E" }, revision: 1, state: "validating" },
      { digest: "b".repeat(64), revision: 1, state: "validation-failed" },
    ];
    let manifestVersion = current.manifestVersion;
    for (const candidate of malformedCandidates) {
      const updated = await manifests.update({
        expectedManifestVersion: manifestVersion,
        knowledgeSpaceId: spaceId,
        patch: {
          manifestVersion: manifestVersion + 1,
          metadata: { __knowledgeFsPendingModelConfiguration: candidate },
        },
        tenantId: "tenant-1",
      });
      if (!updated) throw new Error("test manifest update failed");
      manifestVersion = updated.manifestVersion;

      const response = await app.request(`/knowledge-spaces/${spaceId}/status`, {
        headers: bearer(readToken),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        configuration: { status: "validation-failed" },
      });
    }
  });

  it("returns 404 for operator diagnostics on unknown spaces", async () => {
    const app = createApp();
    await createSpace(app);

    const notFoundRequests: [string, RequestInit | undefined][] = [
      [`/knowledge-spaces/${unknownSpaceId}/manifest`, undefined],
      [`/knowledge-spaces/${unknownSpaceId}/status`, undefined],
      [`/knowledge-spaces/${unknownSpaceId}/stats`, undefined],
      [`/knowledge-spaces/${unknownSpaceId}/gc/staged-objects`, undefined],
      [`/knowledge-spaces/${unknownSpaceId}/leases/active`, undefined],
      [`/knowledge-spaces/${unknownSpaceId}/staged-commits`, undefined],
      [
        `/knowledge-spaces/${unknownSpaceId}/gc/staged-objects/execute`,
        {
          body: JSON.stringify({ candidates: [] }),
          headers: json(writeToken),
          method: "POST",
        },
      ],
    ];

    for (const [path, init] of notFoundRequests) {
      const response = await app.request(path, init ?? { headers: bearer(writeToken) });
      expect(response.status, path).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: "Knowledge space not found" });
    }
  });

  it("rejects diagnostic list limits beyond the repository bounds", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);

    const spaceList = await app.request("/knowledge-spaces?limit=101", {
      headers: bearer(readToken),
    });
    expect(spaceList.status).toBe(400);
    await expect(spaceList.json()).resolves.toEqual({
      error: "Knowledge space list limit exceeds maxListLimit=100",
    });

    const leaseList = await app.request(`/knowledge-spaces/${spaceId}/leases/active?limit=101`, {
      headers: bearer(readToken),
    });
    expect(leaseList.status).toBe(400);

    const commitList = await app.request(`/knowledge-spaces/${spaceId}/staged-commits?limit=101`, {
      headers: bearer(readToken),
    });
    expect(commitList.status).toBe(400);
  });

  it("rejects slug updates that collide with another space", async () => {
    const app = createApp();
    await createSpace(app, "space-a");
    const spaceBId = await createSpace(app, "space-b");

    const response = await app.request(`/knowledge-spaces/${spaceBId}`, {
      body: JSON.stringify({ expectedRevision: 1, slug: "space-a" }),
      headers: json(writeToken),
      method: "PATCH",
    });

    expect(response.status).toBe(409);
  });

  it("surfaces failed staged commits with optional error codes and expirations", async () => {
    const stagedCommits = createInMemoryStagedCommitRepository({
      maxCommits: 100,
      maxListLimit: 100,
    });
    const app = createApp({ stagedCommits });
    const spaceId = await createSpace(app);
    const recentIso = new Date().toISOString();
    const commitBase = {
      createdAt: recentIso,
      idempotencyKey: "commit-key",
      knowledgeSpaceId: spaceId,
      operationType: "document-upload" as const,
      tenantId: "tenant-1",
    };
    await stagedCommits.create({
      ...commitBase,
      errorCode: "E_RETRY",
      expiresAt: "2030-01-01T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000101",
      idempotencyKey: "commit-key-1",
      status: "failed-retryable",
      updatedAt: recentIso,
    });
    await stagedCommits.create({
      ...commitBase,
      id: "00000000-0000-4000-8000-000000000102",
      idempotencyKey: "commit-key-2",
      status: "failed-terminal",
      updatedAt: recentIso,
    });
    await stagedCommits.create({
      ...commitBase,
      createdAt: "2020-01-01T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000103",
      idempotencyKey: "commit-key-3",
      status: "failed-terminal",
      updatedAt: "2020-01-01T00:00:00.000Z",
    });

    const statusResponse = await app.request(`/knowledge-spaces/${spaceId}/status`, {
      headers: bearer(readToken),
    });
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json();
    expect(status.failedCommits.count).toBe(3);
    expect(status.failedCommits.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          errorCode: "E_RETRY",
          expiresAt: "2030-01-01T00:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000101",
          status: "failed-retryable",
        }),
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000102",
          status: "failed-terminal",
        }),
      ]),
    );
    const terminalItem = status.failedCommits.items.find(
      (item: { id: string }) => item.id === "00000000-0000-4000-8000-000000000102",
    );
    expect(terminalItem).not.toHaveProperty("errorCode");
    expect(terminalItem).not.toHaveProperty("expiresAt");

    const statsResponse = await app.request(`/knowledge-spaces/${spaceId}/stats`, {
      headers: bearer(readToken),
    });
    expect(statsResponse.status).toBe(200);
    const stats = await statsResponse.json();
    expect(stats.commits).toMatchObject({
      failedRetryable: 1,
      failedTerminal: 1,
      sampled: 3,
    });
  });

  it("falls back to projection version 1 for manifests without a numeric set version", async () => {
    const knowledgeSpaceManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 100,
      maxManifests: 100,
    });
    const app = createApp({ knowledgeSpaceManifests });
    const spaceId = await createSpace(app);

    const manifestResponse = await app.request(`/knowledge-spaces/${spaceId}/manifest`, {
      headers: bearer(readToken),
    });
    expect(manifestResponse.status).toBe(200);
    await knowledgeSpaceManifests.update({
      knowledgeSpaceId: spaceId,
      patch: { projectionSetVersion: "legacy" },
      tenantId: "tenant-1",
    });

    const statusResponse = await app.request(`/knowledge-spaces/${spaceId}/status`, {
      headers: bearer(readToken),
    });
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json();
    expect(status.index).toMatchObject({
      projectionSetVersion: "legacy",
      projectionVersion: 1,
    });
  });

  it("runs every fsck checker variant including cursored raw object scans", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);

    const segments = await app.request(
      `/knowledge-spaces/${spaceId}/fsck?check=artifact-segments`,
      { headers: bearer(readToken) },
    );
    expect(segments.status).toBe(200);
    await expect(segments.json()).resolves.toMatchObject({
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
    });

    const references = await app.request(`/knowledge-spaces/${spaceId}/fsck?check=references`, {
      headers: bearer(readToken),
    });
    expect(references.status).toBe(200);
    await expect(references.json()).resolves.toMatchObject({
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
    });

    const cursor = Buffer.from(JSON.stringify({ id: "0" })).toString("base64url");
    const rawObjects = await app.request(`/knowledge-spaces/${spaceId}/fsck?cursor=${cursor}`, {
      headers: bearer(readToken),
    });
    expect(rawObjects.status).toBe(200);
    await expect(rawObjects.json()).resolves.toMatchObject({
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
    });
  });

  it("accepts staged object GC dry-run cursors", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    const cursor = Buffer.from(JSON.stringify({})).toString("base64url");

    const response = await app.request(
      `/knowledge-spaces/${spaceId}/gc/staged-objects?cursor=${cursor}`,
      { headers: bearer(readToken) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
    });
  });

  it("reports the cache as unavailable when cache stats fail", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const adapter = {
      ...baseAdapter,
      cache: {
        ...baseAdapter.cache,
        stats: async (): Promise<{ entries: number; totalBytes: number }> => {
          throw new Error("cache offline");
        },
      },
    };
    const app = createApp({ adapter });
    const spaceId = await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${spaceId}/stats`, {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cache: { available: false, entries: 0, totalBytes: 0 },
    });
  });

  it("lets unexpected repository failures escape to the gateway error handler", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({ maxListLimit: 100, maxSpaces: 100 });
    const knowledgeFsLeases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 100,
      maxListLimit: 100,
    });
    const stagedCommits = createInMemoryStagedCommitRepository({
      maxCommits: 100,
      maxListLimit: 100,
    });
    const app = createApp({
      knowledgeFsLeases: {
        ...knowledgeFsLeases,
        listActive: async () => {
          throw new Error("lease backend down");
        },
      },
      knowledgeSpaces: {
        ...spaces,
        list: async () => {
          throw new Error("space list backend down");
        },
        update: async () => {
          throw new Error("space update backend down");
        },
      },
      stagedCommits: {
        ...stagedCommits,
        list: async () => {
          throw new Error("staged commit backend down");
        },
      },
    });
    const spaceId = await createSpace(app);

    const list = await app.request("/knowledge-spaces", { headers: bearer(readToken) });
    expect(list.status).toBe(500);

    const update = await app.request(`/knowledge-spaces/${spaceId}`, {
      body: JSON.stringify({ expectedRevision: 1, name: "Renamed" }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(update.status).toBe(500);

    const leases = await app.request(`/knowledge-spaces/${spaceId}/leases/active`, {
      headers: bearer(readToken),
    });
    expect(leases.status).toBe(500);

    const commits = await app.request(`/knowledge-spaces/${spaceId}/staged-commits`, {
      headers: bearer(readToken),
    });
    expect(commits.status).toBe(500);
  });

  it("lets unexpected staged object GC delete failures escape to the gateway error handler", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const adapter = {
      ...baseAdapter,
      objectStorage: {
        ...baseAdapter.objectStorage,
        deleteObject: async () => {
          throw new Error("object storage delete outage");
        },
      },
    };
    const app = createApp({ adapter });
    const spaceId = await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${spaceId}/gc/staged-objects/execute`, {
      body: JSON.stringify({
        candidates: [
          {
            candidateType: "staged-object",
            count: 1,
            estimatedBytes: 8,
            idempotencyKey: `gc:tenant-1:${spaceId}:staged-object:doomed`,
            reason: "staged object is under the configured cleanup prefix",
            target: {
              objectKey: `tenant-1/spaces/${spaceId}/staging/doomed.bin`,
              type: "staged-commit",
            },
          },
        ],
      }),
      headers: json(writeToken),
      method: "POST",
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Internal server error" });
  });

  it("paginates active lease diagnostics", async () => {
    const knowledgeFsLeases = createInMemoryKnowledgeFsLeaseRepository({
      maxLeases: 100,
      maxListLimit: 100,
    });
    const app = createApp({ knowledgeFsLeases });
    const spaceId = await createSpace(app);
    const nowIso = new Date().toISOString();
    const leaseBase = {
      acquiredAt: nowIso,
      expiresAt: "2030-01-01T00:00:00.000Z",
      heartbeatAt: nowIso,
      knowledgeSpaceId: spaceId,
      leaseType: "read" as const,
      metadata: {},
      sessionId: "00000000-0000-4000-8000-000000000201",
      status: "active" as const,
      targetType: "document-asset" as const,
      tenantId: "tenant-1",
      updatedAt: nowIso,
    };
    await knowledgeFsLeases.acquire({
      ...leaseBase,
      id: "00000000-0000-4000-8000-000000000301",
      targetId: "asset-1",
      virtualPath: "/knowledge/docs/a",
    });
    await knowledgeFsLeases.acquire({
      ...leaseBase,
      id: "00000000-0000-4000-8000-000000000302",
      targetId: "asset-2",
      virtualPath: "/knowledge/docs/b",
    });

    const response = await app.request(`/knowledge-spaces/${spaceId}/leases/active?limit=1`, {
      headers: bearer(readToken),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items).toHaveLength(1);
    expect(typeof body.nextCursor).toBe("string");
  });
});
