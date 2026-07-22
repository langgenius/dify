import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import {
  KnowledgeSpaceEmbeddingProfileSchema,
  KnowledgeSpaceRetrievalProfileSchema,
  createKnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  createAcceptingDurableDeletionService,
  createAllowingDurableDeletionSafetyOptions,
} from "./durable-deletion-test-utils";
import {
  type KnowledgeSpaceManifestRepository,
  type KnowledgeSpaceProfileRepository,
  KnowledgeSpaceProvisioningIdempotencyConflictError,
  type KnowledgeSpaceProvisioningRepository,
  type KnowledgeSpaceUnpublishedProfileActivationRepository,
  type ModelCapabilityPreflight,
  createInMemoryDocumentAssetRepository,
  createInMemoryKnowledgeSpaceAccessRepository,
  createInMemoryKnowledgeSpaceManifestRepository,
  createInMemoryKnowledgeSpaceProfileRepository,
  createInMemoryKnowledgeSpaceRepository,
  createInMemoryTraceRecorder,
  createKnowledgeGateway,
  createKnowledgeSpaceAccessService,
  createStaticAuthVerifier,
  knowledgeSpaceProfileSnapshotDigest,
} from "./index";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const readToken = "read-token";
const writeToken = "write-token";

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function createTestUnpublishedProfileActivations(
  manifests: KnowledgeSpaceManifestRepository,
  profiles: KnowledgeSpaceProfileRepository,
): KnowledgeSpaceUnpublishedProfileActivationRepository {
  return {
    activate: async (input) => {
      const currentManifest = await manifests.get(input);
      if (!currentManifest) throw new Error("test manifest missing");
      const currentSnapshot =
        input.kind === "embedding"
          ? currentManifest.embeddingProfile
          : currentManifest.retrievalProfile;
      const exactManifest =
        currentSnapshot !== undefined &&
        knowledgeSpaceProfileSnapshotDigest(currentSnapshot) ===
          knowledgeSpaceProfileSnapshotDigest(input.snapshot);
      const updatedManifest = exactManifest
        ? currentManifest
        : await manifests.update({
            expectedManifestVersion: input.expectedManifestVersion,
            knowledgeSpaceId: input.knowledgeSpaceId,
            patch:
              input.kind === "embedding"
                ? {
                    embeddingProfile: KnowledgeSpaceEmbeddingProfileSchema.parse(input.snapshot),
                    manifestVersion: currentManifest.manifestVersion + 1,
                    updatedAt: input.now,
                  }
                : {
                    manifestVersion: currentManifest.manifestVersion + 1,
                    retrievalProfile: KnowledgeSpaceRetrievalProfileSchema.parse(input.snapshot),
                    updatedAt: input.now,
                  },
            tenantId: input.tenantId,
          });
      if (!updatedManifest) throw new Error("test manifest CAS failed");
      const currentHead = await profiles.getHead(input);
      if (
        currentHead?.activeRevision === input.snapshot.revision &&
        currentHead.profile.snapshotDigest === knowledgeSpaceProfileSnapshotDigest(input.snapshot)
      ) {
        return {
          head: currentHead,
          manifestVersion: updatedManifest.manifestVersion,
          replayed: true,
          snapshot: input.snapshot,
        };
      }
      const candidate = await profiles.createCandidate({
        capabilitySnapshot: input.capabilitySnapshot,
        createdBySubjectId: input.createdBySubjectId,
        kind: input.kind,
        knowledgeSpaceId: input.knowledgeSpaceId,
        now: input.now,
        snapshot: input.snapshot,
        tenantId: input.tenantId,
      });
      const head = await profiles.activateCandidate({
        expectedActiveRevision: currentHead?.activeRevision ?? null,
        kind: input.kind,
        knowledgeSpaceId: input.knowledgeSpaceId,
        now: input.now,
        revision: candidate.revision,
        tenantId: input.tenantId,
      });
      return {
        head,
        manifestVersion: updatedManifest.manifestVersion,
        replayed: false,
        snapshot: input.snapshot,
      };
    },
    activateInitialTuple: async () => {
      throw new Error("Initial tuple activation is not exercised by gateway settings tests");
    },
  };
}

describe("knowledge-space gateway integration", () => {
  it("creates, reads, updates, lists, and requests durable deletion of a tenant space", async () => {
    const traces = createInMemoryTraceRecorder();
    const app = createKnowledgeGateway({
      ...createAllowingDurableDeletionSafetyOptions(),
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [readToken]: {
            scopes: ["knowledge-spaces:read"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
          [writeToken]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      durableDeletions: createAcceptingDurableDeletionService(),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => SPACE_ID,
        maxListLimit: 2,
        maxSpaces: 10,
        now: () => "2026-05-08T10:00:00.000Z",
      }),
      traces,
    });

    const created = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        description: "Shared engineering memory",
        name: "Engineering",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    expect(created.status).toBe(201);
    expect(created.headers.get("x-trace-id")).toBeTruthy();
    await expect(created.json()).resolves.toEqual({
      configurationStatus: "setup-required",
      createdAt: "2026-05-08T10:00:00.000Z",
      description: "Shared engineering memory",
      id: SPACE_ID,
      name: "Engineering",
      revision: 1,
      slug: "engineering",
      tenantId: "tenant-1",
      updatedAt: "2026-05-08T10:00:00.000Z",
    });

    const read = await app.request(`/knowledge-spaces/${SPACE_ID}`, {
      headers: bearer(readToken),
    });
    expect(read.status).toBe(200);
    expect(read.headers.get("x-trace-id")).toBeTruthy();
    await expect(read.json()).resolves.toMatchObject({ name: "Engineering" });

    const updated = await app.request(`/knowledge-spaces/${SPACE_ID}`, {
      body: JSON.stringify({ expectedRevision: 1, name: "Engineering Knowledge" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PATCH",
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      name: "Engineering Knowledge",
      revision: 2,
    });

    const staleUpdate = await app.request(`/knowledge-spaces/${SPACE_ID}`, {
      body: JSON.stringify({ expectedRevision: 1, name: "Stale rename" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PATCH",
    });
    expect(staleUpdate.status).toBe(409);
    await expect(staleUpdate.json()).resolves.toMatchObject({
      code: "knowledge_space_revision_conflict",
    });

    const listed = await app.request("/knowledge-spaces?limit=2", {
      headers: bearer(readToken),
    });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      items: [{ slug: "engineering", tenantId: "tenant-1" }],
    });

    const deleted = await app.request(`/knowledge-spaces/${SPACE_ID}`, {
      body: JSON.stringify({ challenge: "Engineering Knowledge", expectedRevision: 2 }),
      headers: {
        ...bearer(writeToken),
        "content-type": "application/json",
        "idempotency-key": "delete-space-engineering",
      },
      method: "DELETE",
    });
    expect(deleted.status).toBe(202);
    expect(deleted.headers.get("location")).toMatch(/^\/deletion-jobs\//u);
    await expect(deleted.json()).resolves.toMatchObject({
      job: {
        runState: "dispatch_pending",
        targetId: SPACE_ID,
        targetType: "knowledge_space",
      },
    });

    const stillVisible = await app.request(`/knowledge-spaces/${SPACE_ID}`, {
      headers: bearer(readToken),
    });
    expect(stillVisible.status).toBe(200);

    expect(traces.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: expect.objectContaining({
            method: "POST",
            route: "/knowledge-spaces",
            tenantId: "tenant-1",
          }),
          name: "http.request",
          status: "ok",
        }),
        expect.objectContaining({
          attributes: expect.objectContaining({
            method: "GET",
            route: "/knowledge-spaces/{id}",
            statusCode: 200,
          }),
          name: "http.request",
          status: "ok",
        }),
      ]),
    );
  });

  it("persists selected models without preflight and defers profile activation", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 10,
    });
    const verify = vi.fn(async (input: Parameters<ModelCapabilityPreflight["verify"]>[0]) => ({
      capabilityDigest: `sha256:${input.kind.charCodeAt(0).toString(16).padStart(2, "0").repeat(32)}`,
      checkedAt: "2026-07-14T12:00:00.000Z",
      ...(input.kind === "embedding" ? { dimension: 3072, distanceMetric: "cosine" as const } : {}),
      kind: input.kind,
      pluginUniqueIdentifier: `plugin-${input.kind}:1@sha256:installed`,
      schemaFingerprint: `sha256:${"d".repeat(64)}`,
      selection: input.selection,
    }));
    const embeddingProfile = {
      model: "embed-3072",
      pluginId: "plugin-embedding",
      provider: "provider-a",
    };
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [writeToken]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaceUnpublishedProfileActivations: createTestUnpublishedProfileActivations(
        manifests,
        profiles,
      ),
      knowledgeSpaces: spaces,
      modelCapabilityPreflight: { verify },
    });
    const reasoningModel = {
      model: "reasoning-a",
      pluginId: "plugin-reasoning",
      provider: "provider-a",
    };
    const rerankModel = {
      model: "rerank-a",
      pluginId: "plugin-rerank",
      provider: "provider-a",
    };
    const response = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        embeddingProfile,
        name: "Preflight space",
        retrievalProfile: {
          defaultMode: "fast",
          reasoningModel,
          rerank: { enabled: true, model: rerankModel },
          scoreThreshold: { enabled: false, stage: "mode-final" },
          topK: 3,
        },
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(201);
    await expect(response.clone().json()).resolves.toMatchObject({
      configurationStatus: "pending-validation",
    });
    expect(verify).not.toHaveBeenCalled();
    const createdManifest = await manifests.get({
      knowledgeSpaceId: SPACE_ID,
      tenantId: "tenant-1",
    });
    expect(createdManifest).toMatchObject({
      pendingModelConfiguration: {
        digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        embeddingSelection: embeddingProfile,
        retrievalProfile: expect.objectContaining({
          defaultMode: "fast",
          reasoningModel,
          rerank: { enabled: true, model: rerankModel },
        }),
        revision: 1,
        state: "pending-validation",
      },
    });
    expect(createdManifest?.embeddingProfile).toBeUndefined();
    expect(createdManifest?.retrievalProfile).toBeUndefined();
    await expect(
      profiles.getHead({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
    await expect(
      profiles.getHead({
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();

    const embeddingUpdate = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify({
        model: "embed-3072-v2",
        pluginId: "plugin-embedding-v2",
        provider: "provider-b",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PUT",
    });
    expect(embeddingUpdate.status).toBe(202);
    await expect(embeddingUpdate.json()).resolves.toMatchObject({
      configurationStatus: "pending-validation",
      operation: "initial-validation-pending",
      revision: 2,
    });
    expect(verify).not.toHaveBeenCalled();
    await expect(
      profiles.getHead({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
    await expect(
      manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" }),
    ).resolves.toMatchObject({
      pendingModelConfiguration: {
        embeddingSelection: {
          model: "embed-3072-v2",
          pluginId: "plugin-embedding-v2",
          provider: "provider-b",
        },
        revision: 2,
        state: "pending-validation",
      },
    });

    const retrievalUpdate = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify({
        expectedRevision: 0,
        profile: {
          defaultMode: "deep",
          reasoningModel: {
            model: "reasoning-b",
            pluginId: "plugin-reasoning-b",
            provider: "provider-b",
          },
          rerank: { enabled: true, model: rerankModel },
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.35 },
          topK: 9,
        },
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PUT",
    });
    expect(retrievalUpdate.status).toBe(202);
    await expect(retrievalUpdate.json()).resolves.toMatchObject({
      configurationStatus: "pending-validation",
      operation: "initial-validation-pending",
      revision: 3,
    });
    expect(verify).not.toHaveBeenCalled();
    await expect(
      profiles.getHead({
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
    await expect(
      manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" }),
    ).resolves.toMatchObject({
      pendingModelConfiguration: {
        retrievalProfile: {
          defaultMode: "deep",
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.35 },
          topK: 9,
        },
        revision: 3,
      },
    });
  });

  it("persists unpublished settings as pending without invoking activation ports", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 10,
    });
    const atomicActivate = vi.fn(
      async (
        _input: Parameters<KnowledgeSpaceUnpublishedProfileActivationRepository["activate"]>[0],
      ) => ({}) as never,
    );
    const manifestUpdate = vi.spyOn(manifests, "update");
    const createCandidate = vi.spyOn(profiles, "createCandidate");
    const activateCandidate = vi.spyOn(profiles, "activateCandidate");
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [writeToken]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaceUnpublishedProfileActivations: {
        activate: atomicActivate,
        activateInitialTuple: async () => ({}) as never,
      },
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => SPACE_ID,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      modelCapabilityPreflight: {
        verify: async (input) => ({
          capabilityDigest: `sha256:${"a".repeat(64)}`,
          checkedAt: NOW_FOR_ATOMIC_HANDLER_TEST,
          ...(input.kind === "embedding"
            ? { dimension: 768, distanceMetric: "cosine" as const }
            : {}),
          kind: input.kind,
          pluginUniqueIdentifier: `plugin-${input.kind}@installed`,
          schemaFingerprint: `sha256:${"b".repeat(64)}`,
          selection: input.selection,
        }),
      },
      now: () => NOW_FOR_ATOMIC_HANDLER_TEST,
    });
    const created = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Atomic settings" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    manifestUpdate.mockClear();
    createCandidate.mockClear();
    activateCandidate.mockClear();

    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify({
        model: "embed-768",
        pluginId: "plugin-embedding",
        provider: "provider-a",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PUT",
    });
    const retrievalBody = {
      expectedRevision: 0,
      profile: {
        defaultMode: "research",
        reasoningModel: {
          model: "reasoning-a",
          pluginId: "plugin-reasoning",
          provider: "provider-a",
        },
        rerank: { enabled: false },
        scoreThreshold: { enabled: false, stage: "mode-final" },
        topK: 5,
      },
    } as const;
    const retrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify(retrievalBody),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PUT",
    });

    expect(embedding.status).toBe(202);
    await expect(embedding.json()).resolves.toMatchObject({
      configurationStatus: "setup-required",
      operation: "initial-validation-pending",
      revision: 1,
    });
    expect(retrieval.status).toBe(202);
    await expect(retrieval.json()).resolves.toMatchObject({
      configurationStatus: "pending-validation",
      operation: "initial-validation-pending",
      revision: 2,
    });
    expect(atomicActivate).not.toHaveBeenCalled();
    expect(manifestUpdate).toHaveBeenCalledTimes(2);
    expect(createCandidate).not.toHaveBeenCalled();
    expect(activateCandidate).not.toHaveBeenCalled();
    await expect(
      manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" }),
    ).resolves.toMatchObject({
      pendingModelConfiguration: {
        embeddingSelection: {
          model: "embed-768",
          pluginId: "plugin-embedding",
          provider: "provider-a",
        },
        retrievalProfile: retrievalBody.profile,
        revision: 2,
      },
    });
  });

  it("does not call model preflight before handing pending selections to provisioning", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const provision = vi.fn(
      async (_input: Parameters<KnowledgeSpaceProvisioningRepository["provision"]>[0]) => ({
        configurationStatus: "pending-validation" as const,
        replayed: false,
        space: {
          createdAt: "2026-07-14T12:00:00.000Z",
          id: SPACE_ID,
          name: "Must persist pending",
          revision: 1,
          slug: "must-persist-pending",
          tenantId: "tenant-1",
          updatedAt: "2026-07-14T12:00:00.000Z",
        },
      }),
    );
    const verify = vi.fn(async () => {
      throw new Error("the daemon must not be called during creation");
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [writeToken]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceProvisioning: { provision },
      knowledgeSpaces: spaces,
      modelCapabilityPreflight: { verify },
    });
    const response = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        embeddingProfile: {
          model: "missing",
          pluginId: "missing",
          provider: "missing",
        },
        name: "Must persist pending",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      configurationStatus: "pending-validation",
    });
    expect(verify).not.toHaveBeenCalled();
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingModelConfiguration: expect.objectContaining({
          embeddingSelection: {
            model: "missing",
            pluginId: "missing",
            provider: "missing",
          },
          state: "pending-validation",
        }),
      }),
    );
    expect(provision.mock.calls[0]?.[0]).not.toHaveProperty("embedding");
    expect(provision.mock.calls[0]?.[0]).not.toHaveProperty("retrieval");
    await expect(spaces.list({ limit: 10, tenantId: "tenant-1" })).resolves.toEqual({ items: [] });
  });

  it("creates an observable setup-required space instead of applying a deployment model", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [writeToken]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaces: spaces,
    });

    const response = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "Needs explicit setup" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      configurationStatus: "setup-required",
      name: "Needs explicit setup",
    });
    await expect(spaces.list({ limit: 10, tenantId: "tenant-1" })).resolves.toMatchObject({
      items: [{ name: "Needs explicit setup" }],
    });
  });

  it("never invokes best-effort compensation when the atomic production port fails", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const access = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 10,
        maxMembersPerSpace: 10,
      }),
    });
    const rollbackCreate = vi.spyOn(spaces, "rollbackCreate");
    const deleteManifest = vi.spyOn(manifests, "delete");
    const initializeAccess = vi.spyOn(access, "initialize");
    const deleteAccess = vi.spyOn(access, "deleteAggregate");
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [writeToken]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceAccess: access,
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProvisioning: {
        provision: async () => {
          throw new Error("atomic statement failed");
        },
      },
      knowledgeSpaces: spaces,
    });

    const response = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ idempotencyKey: "atomic-failure", name: "Atomic failure" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(500);
    expect(rollbackCreate).not.toHaveBeenCalled();
    expect(deleteManifest).not.toHaveBeenCalled();
    expect(initializeAccess).not.toHaveBeenCalled();
    expect(deleteAccess).not.toHaveBeenCalled();
  });

  it("exposes an idempotency conflict without retrying through legacy repositories", async () => {
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [writeToken]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceProvisioning: {
        provision: async () => {
          throw new KnowledgeSpaceProvisioningIdempotencyConflictError();
        },
      },
    });

    const response = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ idempotencyKey: "reused-key", name: "Different intent" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "KNOWLEDGE_SPACE_PROVISIONING_IDEMPOTENCY_CONFLICT",
      error: "Knowledge-space idempotency key was already used with a different create request",
    });
  });

  it("stores a Research-only selection as pending without calling the reasoning model", async () => {
    const profiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 10,
    });
    const verify = vi.fn(async (input: Parameters<ModelCapabilityPreflight["verify"]>[0]) => ({
      capabilityDigest: `sha256:${"a".repeat(64)}`,
      checkedAt: "2026-07-14T12:00:00.000Z",
      kind: input.kind,
      pluginUniqueIdentifier: "reasoning-plugin@installed",
      schemaFingerprint: `sha256:${"b".repeat(64)}`,
      selection: input.selection,
    }));
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [writeToken]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => SPACE_ID,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      modelCapabilityPreflight: { verify },
    });

    const response = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        name: "Research only",
        retrievalProfile: {
          defaultMode: "research",
          reasoningModel: {
            model: "reasoning-only",
            pluginId: "reasoning-plugin",
            provider: "provider-a",
          },
          rerank: { enabled: false },
          scoreThreshold: { enabled: false, stage: "mode-final" },
          topK: 6,
        },
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    await expect(response.clone().json()).resolves.toMatchObject({
      configurationStatus: "pending-validation",
    });
    expect(verify).not.toHaveBeenCalled();
    await expect(
      profiles.getHead({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
    await expect(
      profiles.getHead({
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
  });

  it("accepts empty-space settings without preflight and leaves active profiles unset", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [writeToken]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      knowledgeSpaceManifests: manifests,
      knowledgeSpaces: spaces,
    });
    const created = await app.request("/knowledge-spaces", {
      body: JSON.stringify({ name: "No preflight" }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const embeddingUpdate = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify({
        model: "embed-user-selected",
        pluginId: "plugin-embedding",
        provider: "provider-a",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PUT",
    });
    expect(embeddingUpdate.status).toBe(202);
    await expect(embeddingUpdate.json()).resolves.toMatchObject({
      configurationStatus: "setup-required",
      operation: "initial-validation-pending",
    });

    const retrievalUpdate = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify({
        expectedRevision: 0,
        profile: {
          defaultMode: "research",
          reasoningModel: {
            model: "reasoning-user-selected",
            pluginId: "plugin-reasoning",
            provider: "provider-a",
          },
          rerank: { enabled: false },
          scoreThreshold: { enabled: false, stage: "mode-final" },
          topK: 5,
        },
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PUT",
    });
    expect(retrievalUpdate.status).toBe(202);
    await expect(retrievalUpdate.json()).resolves.toMatchObject({
      configurationStatus: "pending-validation",
      operation: "initial-validation-pending",
    });
    await expect(
      manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" }),
    ).resolves.toMatchObject({
      pendingModelConfiguration: {
        embeddingSelection: {
          model: "embed-user-selected",
          pluginId: "plugin-embedding",
          provider: "provider-a",
        },
        retrievalProfile: {
          defaultMode: "research",
          reasoningModel: { model: "reasoning-user-selected" },
        },
        state: "pending-validation",
      },
    });
  });

  it("requires a PageIndex rebuild before changing the reasoning model of a populated space", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const verify = vi.fn(async (input: Parameters<ModelCapabilityPreflight["verify"]>[0]) => ({
      capabilityDigest: `sha256:${"a".repeat(64)}`,
      checkedAt: "2026-07-14T12:00:00.000Z",
      kind: input.kind,
      pluginUniqueIdentifier: `plugin-${input.kind}:1@sha256:installed`,
      schemaFingerprint: `sha256:${"b".repeat(64)}`,
      selection: input.selection,
    }));
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({
        subjectsByToken: {
          [writeToken]: {
            scopes: ["knowledge-spaces:*"],
            subjectId: "user-1",
            tenantId: "tenant-1",
          },
        },
      }),
      documentAssets: assets,
      knowledgeSpaceManifests: manifests,
      knowledgeSpaces: spaces,
      modelCapabilityPreflight: { verify },
    });
    const initialRetrievalProfile = {
      defaultMode: "research" as const,
      reasoningModel: {
        model: "reasoning-a",
        pluginId: "plugin-reasoning-a",
        provider: "provider-a",
      },
      rerank: { enabled: false as const },
      scoreThreshold: { enabled: false as const, stage: "mode-final" as const },
      topK: 5,
    };
    const created = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        name: "Populated research",
        retrievalProfile: initialRetrievalProfile,
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const pendingManifest = await manifests.get({
      knowledgeSpaceId: SPACE_ID,
      tenantId: "tenant-1",
    });
    if (!pendingManifest) throw new Error("pending test manifest missing");
    await manifests.update({
      expectedManifestVersion: pendingManifest.manifestVersion,
      knowledgeSpaceId: SPACE_ID,
      patch: {
        manifestVersion: pendingManifest.manifestVersion + 1,
        retrievalProfile: createKnowledgeSpaceRetrievalProfile(initialRetrievalProfile),
        updatedAt: new Date(Date.parse(pendingManifest.updatedAt) + 1).toISOString(),
      },
      tenantId: "tenant-1",
    });
    await assets.create({
      filename: "indexed.pdf",
      knowledgeSpaceId: SPACE_ID,
      mimeType: "application/pdf",
      objectKey: `tenants/tenant-1/knowledge-spaces/${SPACE_ID}/raw/indexed.pdf`,
      sha256: "c".repeat(64),
      sizeBytes: 100,
      tenantId: "tenant-1",
    });
    const before = await manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" });
    const preflightCallsBeforeUpdate = verify.mock.calls.length;

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify({
        expectedRevision: 1,
        profile: {
          defaultMode: "research",
          reasoningModel: {
            model: "reasoning-b",
            pluginId: "plugin-reasoning-b",
            provider: "provider-b",
          },
          rerank: { enabled: false },
          scoreThreshold: { enabled: false, stage: "mode-final" },
          topK: 5,
        },
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "PUT",
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "RETRIEVAL_PROFILE_REBUILD_REQUIRED",
      error: "Reasoning model change requires a PageIndex rebuild workflow",
    });
    expect(verify).toHaveBeenCalledTimes(preflightCallsBeforeUpdate);
    await expect(
      manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" }),
    ).resolves.toEqual(before);
  });
});

const NOW_FOR_ATOMIC_HANDLER_TEST = "2026-07-14T12:00:00.000Z";
