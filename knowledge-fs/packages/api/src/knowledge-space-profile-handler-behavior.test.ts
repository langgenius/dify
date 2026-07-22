import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import {
  type KnowledgeSpaceManifest,
  type KnowledgeSpaceModelSelection,
  createDefaultKnowledgeSpaceManifest,
  createKnowledgeSpaceEmbeddingProfile,
  createKnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpaceManifestRepository,
  KnowledgeSpaceProfileTransitionError,
  KnowledgeSpaceProvisioningIdempotencyConflictError,
  KnowledgeSpaceProvisioningIncompleteReplayError,
  KnowledgeSpaceUnpublishedProfileActivationError,
  type ModelCapabilityKind,
  type ModelCapabilityPreflight,
  ModelCapabilityPreflightError,
  type ModelCapabilitySnapshot,
  createInMemoryDocumentAssetRepository,
  createInMemoryKnowledgeSpaceAccessRepository,
  createInMemoryKnowledgeSpaceManifestRepository,
  createInMemoryKnowledgeSpaceProfileRepository,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createKnowledgeSpaceAccessService,
  createStaticAuthVerifier,
} from "./index";
import { ensureLegacyPublishedProfileTuple } from "./knowledge-space-handlers";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const NOW = "2026-07-21T12:00:00.000Z";
const WRITE_TOKEN = "write-token";

const EMBEDDING_V1: KnowledgeSpaceModelSelection = {
  model: "embed-v1",
  pluginId: "embedding-plugin",
  provider: "plugin-daemon",
};
const EMBEDDING_V2: KnowledgeSpaceModelSelection = {
  model: "embed-v2",
  pluginId: "embedding-plugin",
  provider: "plugin-daemon",
};
const REASONING_V1: KnowledgeSpaceModelSelection = {
  model: "reasoning-v1",
  pluginId: "reasoning-plugin",
  provider: "plugin-daemon",
};
const REASONING_V2: KnowledgeSpaceModelSelection = {
  model: "reasoning-v2",
  pluginId: "reasoning-plugin",
  provider: "plugin-daemon",
};
const RERANK_V1: KnowledgeSpaceModelSelection = {
  model: "rerank-v1",
  pluginId: "rerank-plugin",
  provider: "plugin-daemon",
};
const RERANK_V2: KnowledgeSpaceModelSelection = {
  model: "rerank-v2",
  pluginId: "rerank-plugin",
  provider: "plugin-daemon",
};

function headers() {
  return {
    authorization: `Bearer ${WRITE_TOKEN}`,
    "content-type": "application/json",
  };
}

function auth() {
  return createStaticAuthVerifier({
    subjectsByToken: {
      [WRITE_TOKEN]: {
        scopes: ["knowledge-spaces:*"],
        subjectId: "user:owner",
        tenantId: "tenant-1",
      },
    },
  });
}

function capability(
  kind: ModelCapabilityKind,
  selection: KnowledgeSpaceModelSelection,
): ModelCapabilitySnapshot {
  const marker = kind === "embedding" ? "a" : kind === "reasoning" ? "b" : "c";
  return {
    capabilityDigest: `sha256:${marker.repeat(64)}`,
    checkedAt: NOW,
    ...(kind === "embedding" ? { dimension: 1536, distanceMetric: "cosine" as const } : {}),
    kind,
    pluginUniqueIdentifier: `${selection.pluginId}@installed-1`,
    schemaFingerprint: `sha256:${"d".repeat(64)}`,
    selection,
  };
}

function modelPreflight() {
  const verify = vi.fn(async (input: Parameters<ModelCapabilityPreflight["verify"]>[0]) =>
    capability(input.kind, input.selection),
  );
  return { preflight: { verify }, verify };
}

async function createSpace(app: ReturnType<typeof createKnowledgeGateway>) {
  const response = await app.request("/knowledge-spaces", {
    body: JSON.stringify({ name: "Profile behavior" }),
    headers: headers(),
    method: "POST",
  });
  expect(response.status).toBe(201);
}

async function seedActiveManifest(manifests: KnowledgeSpaceManifestRepository) {
  const current = await manifests.get({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" });
  if (!current) throw new Error("test manifest missing");
  const embeddingProfile = await createKnowledgeSpaceEmbeddingProfile(EMBEDDING_V1);
  const retrievalProfile = createKnowledgeSpaceRetrievalProfile({
    defaultMode: "deep",
    reasoningModel: REASONING_V1,
    rerank: { enabled: true, model: RERANK_V1 },
    scoreThreshold: { enabled: true, stage: "mode-final", value: 0.35 },
    topK: 8,
  });
  const updated = await manifests.update({
    expectedManifestVersion: current.manifestVersion,
    knowledgeSpaceId: SPACE_ID,
    patch: {
      embeddingProfile,
      manifestVersion: current.manifestVersion + 1,
      retrievalProfile,
      updatedAt: NOW,
    },
    tenantId: "tenant-1",
  });
  if (!updated) throw new Error("test manifest update failed");
  return updated;
}

function retrievalUpdateBody() {
  return {
    expectedRevision: 1,
    profile: {
      defaultMode: "deep",
      reasoningModel: REASONING_V2,
      rerank: { enabled: true, model: RERANK_V2 },
      scoreThreshold: { enabled: true, stage: "mode-final", value: 0.45 },
      topK: 12,
    },
  } as const;
}

async function legacyManifest(): Promise<KnowledgeSpaceManifest> {
  return createDefaultKnowledgeSpaceManifest({
    createdAt: NOW,
    embeddingProfile: await createKnowledgeSpaceEmbeddingProfile(EMBEDDING_V1),
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7a10",
    knowledgeSpaceId: SPACE_ID,
    retrievalProfile: createKnowledgeSpaceRetrievalProfile({
      defaultMode: "deep",
      reasoningModel: REASONING_V1,
      rerank: { enabled: true, model: RERANK_V1 },
      scoreThreshold: { enabled: true, stage: "mode-final", value: 0.35 },
      topK: 8,
    }),
    tenantId: "tenant-1",
    updatedAt: NOW,
  });
}

function requireLegacyProfiles(manifest: KnowledgeSpaceManifest) {
  const { embeddingProfile, retrievalProfile } = manifest;
  if (!embeddingProfile || !retrievalProfile) {
    throw new Error("legacy profile fixture is incomplete");
  }
  return { embeddingProfile, retrievalProfile };
}

function profileRepository() {
  return createInMemoryKnowledgeSpaceProfileRepository({
    maxListLimit: 10,
    maxRevisions: 20,
  });
}

type ProfileGatewayOptions = Omit<
  Parameters<typeof createKnowledgeGateway>[0],
  "adapter" | "auth" | "knowledgeSpaces" | "now"
>;

function profileApp(options: ProfileGatewayOptions = {}) {
  return createKnowledgeGateway({
    adapter: createNodePlatformAdapter({ env: {} }),
    auth: auth(),
    knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
      generateId: () => SPACE_ID,
      maxListLimit: 10,
      maxSpaces: 10,
    }),
    now: () => NOW,
    ...options,
  });
}

function bootstrapInput(
  manifest: KnowledgeSpaceManifest,
  profiles: ReturnType<typeof profileRepository>,
  overrides: Partial<Parameters<typeof ensureLegacyPublishedProfileTuple>[0]> = {},
) {
  return {
    createdBySubjectId: "user:owner",
    knowledgeSpaceId: SPACE_ID,
    manifest,
    modelCapabilityPreflight: {
      verify: async (input: Parameters<ModelCapabilityPreflight["verify"]>[0]) =>
        capability(input.kind, input.selection),
    },
    now: () => NOW,
    profilePublicationBindings: {
      bindCurrentPublished: async () => ({}) as never,
    },
    profiles,
    tenantId: "tenant-1",
    ...overrides,
  };
}

describe("knowledge-space profile handler behavior", () => {
  it("aggregates pending first-document settings behind one revision-fenced product route", async () => {
    const app = profileApp();
    await createSpace(app);

    const initial = await app.request(`/knowledge-spaces/${SPACE_ID}/product-settings`, {
      headers: headers(),
    });
    expect(initial.status).toBe(200);
    await expect(initial.json()).resolves.toEqual({
      configurationState: "setup-required",
      embedding: null,
      retrieval: null,
      revision: 1,
    });

    const updated = await app.request(`/knowledge-spaces/${SPACE_ID}/product-settings`, {
      body: JSON.stringify({
        embedding: EMBEDDING_V1,
        expectedRevision: 1,
        retrieval: {
          defaultMode: "deep",
          reasoningModel: REASONING_V1,
          rerank: { enabled: true, model: RERANK_V1 },
          scoreThreshold: { enabled: true, stage: "mode-final", value: 0.35 },
          topK: 8,
        },
      }),
      headers: headers(),
      method: "PATCH",
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      configurationState: "pending-validation",
      embedding: EMBEDDING_V1,
      retrieval: { defaultMode: "deep", reasoningModel: REASONING_V1, topK: 8 },
      revision: 2,
    });

    const current = await app.request(`/knowledge-spaces/${SPACE_ID}/product-settings`, {
      headers: headers(),
    });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      configurationState: "pending-validation",
      embedding: EMBEDDING_V1,
      revision: 2,
    });

    const stale = await app.request(`/knowledge-spaces/${SPACE_ID}/product-settings`, {
      body: JSON.stringify({ embedding: EMBEDDING_V2, expectedRevision: 1 }),
      headers: headers(),
      method: "PATCH",
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "PRODUCT_SETTINGS_REVISION_CONFLICT",
    });
  });

  it("keeps active profile changes on the dedicated migration workflow", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const app = profileApp({ knowledgeSpaceManifests: manifests });
    await createSpace(app);
    const active = await seedActiveManifest(manifests);

    const current = await app.request(`/knowledge-spaces/${SPACE_ID}/product-settings`, {
      headers: headers(),
    });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({ configurationState: "active" });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/product-settings`, {
      body: JSON.stringify({ embedding: EMBEDDING_V2, expectedRevision: active.manifestVersion }),
      headers: headers(),
      method: "PATCH",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "PRODUCT_SETTINGS_PROFILE_MIGRATION_REQUIRED",
      error: "Active profile changes require the dedicated profile migration workflow",
    });
  });

  it("atomically activates verified embedding and retrieval settings for an unpublished space", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const activate = vi.fn(async () => ({}) as never);
    const { preflight, verify } = modelPreflight();
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: auth(),
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceUnpublishedProfileActivations: {
        activate,
        activateInitialTuple: async () => ({}) as never,
      },
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => SPACE_ID,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      modelCapabilityPreflight: preflight,
      now: () => NOW,
    });
    await createSpace(app);
    await seedActiveManifest(manifests);

    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(embedding.status).toBe(200);
    await expect(embedding.json()).resolves.toMatchObject({
      dimension: 1536,
      model: "embed-v2",
      revision: 2,
    });

    const retrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify(retrievalUpdateBody()),
      headers: headers(),
      method: "PUT",
    });
    expect(retrieval.status).toBe(200);
    await expect(retrieval.json()).resolves.toMatchObject({
      reasoningModel: REASONING_V2,
      revision: 2,
      topK: 12,
    });

    expect(verify.mock.calls.map(([input]) => input.kind)).toEqual([
      "embedding",
      "reasoning",
      "rerank",
    ]);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(activate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ kind: "embedding", knowledgeSpaceId: SPACE_ID }),
    );
    expect(activate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ kind: "retrieval", knowledgeSpaceId: SPACE_ID }),
    );
  });

  it("stages immutable candidates and replays published profile migration requests", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 20,
    });
    const request = vi.fn(
      async (input: { readonly changedKind: "embedding" | "retrieval" }) =>
        ({
          changedKind: input.changedKind,
          checkpoint: "queued",
          createdAt: NOW,
          id: input.changedKind === "embedding" ? "migration-embedding" : "migration-retrieval",
          knowledgeSpaceId: SPACE_ID,
          rebuildScope:
            input.changedKind === "embedding" ? "full-vector-space" : "clone-publication",
          runState: "queued",
          updatedAt: NOW,
        }) as never,
    );
    const bindCurrentPublished = vi.fn(async () => ({}) as never);
    const { preflight } = modelPreflight();
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: auth(),
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfileMigrations: {
        cancel: async () => null,
        get: async () => null,
        request,
        requiresMigration: async () => true,
        retry: async () => null,
      },
      knowledgeSpaceProfilePublications: {
        activateCandidate: async () => ({}) as never,
        bindCandidate: async () => ({}) as never,
        bindCurrentPublished,
        bindExistingPublished: async () => ({}) as never,
        requireActivatedBinding: async () => ({}) as never,
      },
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => SPACE_ID,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      modelCapabilityPreflight: preflight,
      now: () => NOW,
    });
    await createSpace(app);
    await seedActiveManifest(manifests);

    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    const embeddingBody = await embedding.json();
    expect(embedding.status, JSON.stringify(embeddingBody)).toBe(202);
    expect(embeddingBody).toMatchObject({
      changedKind: "embedding",
      id: "migration-embedding",
      runState: "queued",
    });
    const retrievalManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const retrievalProfiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 20,
    });
    const retrievalApp = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: auth(),
      knowledgeSpaceManifests: retrievalManifests,
      knowledgeSpaceProfileMigrations: {
        cancel: async () => null,
        get: async () => null,
        request,
        requiresMigration: async () => true,
        retry: async () => null,
      },
      knowledgeSpaceProfilePublications: {
        activateCandidate: async () => ({}) as never,
        bindCandidate: async () => ({}) as never,
        bindCurrentPublished,
        bindExistingPublished: async () => ({}) as never,
        requireActivatedBinding: async () => ({}) as never,
      },
      knowledgeSpaceProfiles: retrievalProfiles,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => SPACE_ID,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      modelCapabilityPreflight: preflight,
      now: () => NOW,
    });
    await createSpace(retrievalApp);
    await seedActiveManifest(retrievalManifests);

    const retrieval = await retrievalApp.request(
      `/knowledge-spaces/${SPACE_ID}/retrieval-profile`,
      {
        body: JSON.stringify(retrievalUpdateBody()),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(retrieval.status).toBe(202);
    await expect(retrieval.json()).resolves.toMatchObject({
      changedKind: "retrieval",
      id: "migration-retrieval",
      runState: "queued",
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(bindCurrentPublished).toHaveBeenCalledTimes(2);
    await expect(
      profiles.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 2,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ state: "candidate" });
    await expect(
      retrievalProfiles.getRevision({
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        revision: 2,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ state: "candidate" });
  });

  it("reuses an exact immutable settings candidate owned by the same subject", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profiles = profileRepository();
    const request = vi.fn(
      async () =>
        ({
          changedKind: "embedding",
          checkpoint: "queued",
          createdAt: NOW,
          id: "migration-replayed-embedding",
          knowledgeSpaceId: SPACE_ID,
          rebuildScope: "full-vector-space",
          runState: "queued",
          updatedAt: NOW,
        }) as never,
    );
    const { preflight } = modelPreflight();
    const app = profileApp({
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfileMigrations: {
        cancel: async () => null,
        get: async () => null,
        request,
        requiresMigration: async () => true,
        retry: async () => null,
      },
      knowledgeSpaceProfilePublications: {
        activateCandidate: async () => ({}) as never,
        bindCandidate: async () => ({}) as never,
        bindCurrentPublished: async () => ({}) as never,
        bindExistingPublished: async () => ({}) as never,
        requireActivatedBinding: async () => ({}) as never,
      },
      knowledgeSpaceProfiles: profiles,
      modelCapabilityPreflight: preflight,
    });
    await createSpace(app);
    const manifest = await seedActiveManifest(manifests);
    const { embeddingProfile, retrievalProfile } = requireLegacyProfiles(manifest);
    const activeEmbedding = await profiles.createCandidate({
      capabilitySnapshot: capability("embedding", EMBEDDING_V1),
      createdBySubjectId: "user:owner",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: { ...embeddingProfile, dimension: 1536 },
      tenantId: "tenant-1",
    });
    const activeRetrieval = await profiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: capability("rerank", RERANK_V1),
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: retrievalProfile,
      tenantId: "tenant-1",
    });
    await profiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: activeEmbedding.revision,
      tenantId: "tenant-1",
    });
    await profiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: activeRetrieval.revision,
      tenantId: "tenant-1",
    });
    const embeddingCapability = capability("embedding", EMBEDDING_V2);
    if (
      embeddingCapability.kind !== "embedding" ||
      embeddingCapability.dimension === undefined ||
      !embeddingCapability.distanceMetric
    ) {
      throw new Error("test embedding capability is incomplete");
    }
    await profiles.createCandidate({
      capabilitySnapshot: embeddingCapability,
      createdBySubjectId: "user:owner",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      snapshot: {
        ...(await createKnowledgeSpaceEmbeddingProfile(EMBEDDING_V2, 2, {
          capabilityDigest: embeddingCapability.capabilityDigest,
          dimension: embeddingCapability.dimension,
          distanceMetric: embeddingCapability.distanceMetric,
          pluginUniqueIdentifier: embeddingCapability.pluginUniqueIdentifier,
          schemaFingerprint: embeddingCapability.schemaFingerprint,
        })),
        dimension: embeddingCapability.dimension,
      },
      tenantId: "tenant-1",
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ id: "migration-replayed-embedding" });
    expect(request).toHaveBeenCalledOnce();
  });
});

describe("legacy published profile reconciliation behavior", () => {
  it("reports each missing bootstrap prerequisite with an actionable conflict", async () => {
    const manifest = await legacyManifest();

    await expect(
      ensureLegacyPublishedProfileTuple(
        bootstrapInput(manifest, profileRepository(), {
          profilePublicationBindings: undefined,
        }),
      ),
    ).rejects.toMatchObject({ code: "PROFILE_PUBLICATION_BOOTSTRAP_UNAVAILABLE", status: 503 });

    await expect(
      ensureLegacyPublishedProfileTuple(
        bootstrapInput({ ...manifest, retrievalProfile: undefined }, profileRepository()),
      ),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_BASE_PROFILE_MISSING", status: 409 });

    await expect(
      ensureLegacyPublishedProfileTuple(
        bootstrapInput({ ...manifest, embeddingProfile: undefined }, profileRepository()),
      ),
    ).rejects.toMatchObject({ code: "PROFILE_MIGRATION_BASE_PROFILE_MISSING", status: 409 });
  });

  it("rejects capability selections and dimensions that cannot prove the legacy vector space", async () => {
    const manifest = await legacyManifest();
    const { embeddingProfile } = requireLegacyProfiles(manifest);
    await expect(
      ensureLegacyPublishedProfileTuple(
        bootstrapInput(manifest, profileRepository(), {
          modelCapabilityPreflight: {
            verify: async ({ kind, selection }) =>
              capability(kind, kind === "embedding" ? EMBEDDING_V2 : selection),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "PROFILE_PUBLICATION_BOOTSTRAP_CAPABILITY_MISMATCH" });

    await expect(
      ensureLegacyPublishedProfileTuple(
        bootstrapInput(
          {
            ...manifest,
            embeddingProfile: { ...embeddingProfile, dimension: 768 },
          },
          profileRepository(),
        ),
      ),
    ).rejects.toMatchObject({ code: "PROFILE_PUBLICATION_BOOTSTRAP_DIMENSION_CONFLICT" });
  });

  it("rejects existing active heads that were not backed by verified capabilities", async () => {
    const manifest = await legacyManifest();
    const { embeddingProfile, retrievalProfile } = requireLegacyProfiles(manifest);
    const embeddingProfiles = profileRepository();
    const embeddingCandidate = await embeddingProfiles.createCandidate({
      capabilitySnapshot: capability("embedding", EMBEDDING_V2),
      createdBySubjectId: "user:owner",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: { ...embeddingProfile, dimension: 1536 },
      tenantId: "tenant-1",
    });
    await embeddingProfiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: embeddingCandidate.revision,
      tenantId: "tenant-1",
    });
    await expect(
      ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, embeddingProfiles)),
    ).rejects.toMatchObject({ code: "PROFILE_PUBLICATION_BOOTSTRAP_PROFILE_UNVERIFIED" });

    const retrievalProfiles = profileRepository();
    const retrievalCandidate = await retrievalProfiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V2),
        rerank: capability("rerank", RERANK_V2),
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: retrievalProfile,
      tenantId: "tenant-1",
    });
    await retrievalProfiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: retrievalCandidate.revision,
      tenantId: "tenant-1",
    });
    await expect(
      ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, retrievalProfiles)),
    ).rejects.toMatchObject({ code: "PROFILE_PUBLICATION_BOOTSTRAP_PROFILE_UNVERIFIED" });
  });

  it("accepts already-active verified heads and rebinds the publication tuple", async () => {
    const manifest = await legacyManifest();
    const { embeddingProfile, retrievalProfile } = requireLegacyProfiles(manifest);
    const profiles = profileRepository();
    const embeddingSnapshot = { ...embeddingProfile, dimension: 1536 };
    const embeddingCandidate = await profiles.createCandidate({
      capabilitySnapshot: capability("embedding", EMBEDDING_V1),
      createdBySubjectId: "user:owner",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: embeddingSnapshot,
      tenantId: "tenant-1",
    });
    const retrievalCandidate = await profiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: capability("rerank", RERANK_V1),
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: retrievalProfile,
      tenantId: "tenant-1",
    });
    await profiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: embeddingCandidate.revision,
      tenantId: "tenant-1",
    });
    await profiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: retrievalCandidate.revision,
      tenantId: "tenant-1",
    });
    const bindCurrentPublished = vi.fn(async () => ({}) as never);

    await ensureLegacyPublishedProfileTuple(
      bootstrapInput(manifest, profiles, {
        profilePublicationBindings: { bindCurrentPublished },
      }),
    );

    expect(bindCurrentPublished).toHaveBeenCalledWith({
      knowledgeSpaceId: SPACE_ID,
      tenantId: "tenant-1",
      verifiedAt: NOW,
    });
  });

  it("converges when another bootstrap wins the profile-head activation race", async () => {
    const manifest = await legacyManifest();
    const baseProfiles = profileRepository();
    let raceActivation = true;
    const racingProfiles = {
      ...baseProfiles,
      activateCandidate: async (input: Parameters<typeof baseProfiles.activateCandidate>[0]) => {
        const activated = await baseProfiles.activateCandidate(input);
        if (raceActivation) {
          raceActivation = false;
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
            "concurrent head activation",
          );
        }
        return activated;
      },
    };

    await ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, racingProfiles));

    await expect(
      baseProfiles.getHead({
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ activeRevision: 1 });
  });

  it("reuses a matching legacy Research candidate", async () => {
    const manifest = await legacyManifest();
    const researchProfile = createKnowledgeSpaceRetrievalProfile({
      defaultMode: "research",
      reasoningModel: REASONING_V1,
      rerank: { enabled: false },
      scoreThreshold: { enabled: false, stage: "mode-final" },
      topK: 5,
    });
    const researchProfiles = profileRepository();
    await researchProfiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: null,
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: researchProfile,
      tenantId: "tenant-1",
    });
    await ensureLegacyPublishedProfileTuple(
      bootstrapInput(
        { ...manifest, embeddingProfile: undefined, retrievalProfile: researchProfile },
        researchProfiles,
      ),
    );
    await expect(
      researchProfiles.getHead({
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ activeRevision: 1 });
  });

  it("refuses conflicting legacy candidates and non-convergent activation races", async () => {
    const manifest = await legacyManifest();
    const profiles = profileRepository();
    await profiles.createCandidate({
      capabilitySnapshot: capability("embedding", EMBEDDING_V2),
      createdBySubjectId: "user:other",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: {
        ...(await createKnowledgeSpaceEmbeddingProfile(EMBEDDING_V2)),
        dimension: 1536,
      },
      tenantId: "tenant-1",
    });
    await expect(
      ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, profiles)),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_SETTINGS_CANDIDATE_CONFLICT" });

    const racingBase = profileRepository();
    const racingProfiles = {
      ...racingBase,
      activateCandidate: async () => {
        throw new KnowledgeSpaceProfileTransitionError(
          "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
          "the competing activation did not publish an equivalent head",
        );
      },
    };
    await expect(
      ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, racingProfiles)),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT" });
  });

  it("bootstraps only the missing profile kind and reuses a reranked retrieval candidate", async () => {
    const manifest = await legacyManifest();
    const { embeddingProfile, retrievalProfile } = requireLegacyProfiles(manifest);
    const retrievalHeadProfiles = profileRepository();
    const activeRetrieval = await retrievalHeadProfiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: capability("rerank", RERANK_V1),
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: retrievalProfile,
      tenantId: "tenant-1",
    });
    await retrievalHeadProfiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: activeRetrieval.revision,
      tenantId: "tenant-1",
    });
    await ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, retrievalHeadProfiles));
    await expect(
      retrievalHeadProfiles.getHead({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ activeRevision: 1 });

    const embeddingHeadProfiles = profileRepository();
    const activeEmbedding = await embeddingHeadProfiles.createCandidate({
      capabilitySnapshot: capability("embedding", EMBEDDING_V1),
      createdBySubjectId: "user:owner",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: { ...embeddingProfile, dimension: 1536 },
      tenantId: "tenant-1",
    });
    await embeddingHeadProfiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: activeEmbedding.revision,
      tenantId: "tenant-1",
    });
    await embeddingHeadProfiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: capability("rerank", RERANK_V1),
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: retrievalProfile,
      tenantId: "tenant-1",
    });
    await ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, embeddingHeadProfiles));
    await expect(
      embeddingHeadProfiles.getHead({
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({ activeRevision: 1 });
  });

  it("converges candidate-creation races for both repository conflict codes", async () => {
    const baseManifest = await legacyManifest();
    const researchProfile = createKnowledgeSpaceRetrievalProfile({
      defaultMode: "research",
      reasoningModel: REASONING_V1,
      rerank: { enabled: false },
      scoreThreshold: { enabled: false, stage: "mode-final" },
      topK: 5,
    });
    const manifest = {
      ...baseManifest,
      embeddingProfile: undefined,
      retrievalProfile: researchProfile,
    };
    const conflictCodes = [
      "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_EXISTS",
      "KNOWLEDGE_SPACE_PROFILE_REVISION_CONFLICT",
    ] as const;
    for (const code of conflictCodes) {
      const baseProfiles = profileRepository();
      await baseProfiles.createCandidate({
        capabilitySnapshot: {
          reasoning: capability("reasoning", REASONING_V1),
          rerank: null,
          verification: "verified",
        },
        createdBySubjectId: "user:owner",
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        preserveLegacyInitialRevision: true,
        snapshot: researchProfile,
        tenantId: "tenant-1",
      });
      let revisionReads = 0;
      const racingProfiles = {
        ...baseProfiles,
        createCandidate: async () => {
          throw new KnowledgeSpaceProfileTransitionError(
            code,
            "candidate was written concurrently",
          );
        },
        getRevision: async (input: Parameters<typeof baseProfiles.getRevision>[0]) => {
          revisionReads += 1;
          return revisionReads === 1 ? null : baseProfiles.getRevision(input);
        },
      };

      await ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, racingProfiles));
      await expect(
        baseProfiles.getHead({
          kind: "retrieval",
          knowledgeSpaceId: SPACE_ID,
          tenantId: "tenant-1",
        }),
      ).resolves.toMatchObject({ activeRevision: 1 });
    }

    const losingProfiles = profileRepository();
    const nonConvergentProfiles = {
      ...losingProfiles,
      createCandidate: async () => {
        throw new KnowledgeSpaceProfileTransitionError(
          "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_EXISTS",
          "the concurrent candidate does not match",
        );
      },
      getRevision: async () => null,
    };
    await expect(
      ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, nonConvergentProfiles)),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_SETTINGS_CANDIDATE_CONFLICT" });
  });

  it("rejects replay candidates with unverified or mismatched reasoning capabilities", async () => {
    const baseManifest = await legacyManifest();
    const researchProfile = createKnowledgeSpaceRetrievalProfile({
      defaultMode: "research",
      reasoningModel: REASONING_V1,
      rerank: { enabled: false },
      scoreThreshold: { enabled: false, stage: "mode-final" },
      topK: 5,
    });
    const manifest = {
      ...baseManifest,
      embeddingProfile: undefined,
      retrievalProfile: researchProfile,
    };
    const capabilitySnapshots = [
      {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: null,
        verification: "unverified",
      },
      {
        reasoning: {
          ...capability("reasoning", REASONING_V2),
          capabilityDigest: `sha256:${"e".repeat(64)}`,
        },
        rerank: null,
        verification: "verified",
      },
    ] as const;
    for (const capabilitySnapshot of capabilitySnapshots) {
      const profiles = profileRepository();
      await profiles.createCandidate({
        capabilitySnapshot,
        createdBySubjectId: "user:owner",
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        preserveLegacyInitialRevision: true,
        snapshot: researchProfile,
        tenantId: "tenant-1",
      });
      await expect(
        ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, profiles)),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_SETTINGS_CANDIDATE_CONFLICT" });
    }
  });

  it("rejects explicitly unverified and inconsistent Research capability ledgers", async () => {
    const manifest = await legacyManifest();
    const { retrievalProfile } = requireLegacyProfiles(manifest);
    const unverifiedProfiles = profileRepository();
    const unverifiedCandidate = await unverifiedProfiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: capability("rerank", RERANK_V1),
        verification: "unverified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: retrievalProfile,
      tenantId: "tenant-1",
    });
    await unverifiedProfiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: unverifiedCandidate.revision,
      tenantId: "tenant-1",
    });
    await expect(
      ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, unverifiedProfiles)),
    ).rejects.toMatchObject({ code: "PROFILE_PUBLICATION_BOOTSTRAP_PROFILE_UNVERIFIED" });

    const researchProfile = createKnowledgeSpaceRetrievalProfile({
      defaultMode: "research",
      reasoningModel: REASONING_V1,
      rerank: { enabled: false },
      scoreThreshold: { enabled: false, stage: "mode-final" },
      topK: 5,
    });
    const inconsistentProfiles = profileRepository();
    const inconsistentCandidate = await inconsistentProfiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: capability("rerank", RERANK_V1),
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: researchProfile,
      tenantId: "tenant-1",
    });
    await inconsistentProfiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: inconsistentCandidate.revision,
      tenantId: "tenant-1",
    });
    await expect(
      ensureLegacyPublishedProfileTuple(
        bootstrapInput(
          { ...manifest, embeddingProfile: undefined, retrievalProfile: researchProfile },
          inconsistentProfiles,
        ),
      ),
    ).rejects.toMatchObject({ code: "PROFILE_PUBLICATION_BOOTSTRAP_PROFILE_UNVERIFIED" });

    const malformedProfiles = profileRepository();
    const malformedCandidate = await malformedProfiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: capability("rerank", RERANK_V1),
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: retrievalProfile,
      tenantId: "tenant-1",
    });
    await malformedProfiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: malformedCandidate.revision,
      tenantId: "tenant-1",
    });
    const malformedHead = await malformedProfiles.getHead({
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      tenantId: "tenant-1",
    });
    if (!malformedHead) throw new Error("test retrieval head missing");
    const malformedLedger = {
      ...malformedProfiles,
      getHead: async (input: Parameters<typeof malformedProfiles.getHead>[0]) =>
        input.kind === "retrieval"
          ? {
              ...malformedHead,
              profile: {
                ...malformedHead.profile,
                snapshot: { ...retrievalProfile, rerank: { enabled: true } },
              },
            }
          : malformedProfiles.getHead(input),
    };
    await expect(
      ensureLegacyPublishedProfileTuple(bootstrapInput(manifest, malformedLedger)),
    ).rejects.toMatchObject({ code: "PROFILE_PUBLICATION_BOOTSTRAP_PROFILE_UNVERIFIED" });
  });

  it("fails closed when a preflight adapter omits a required legacy capability", async () => {
    const manifest = await legacyManifest();
    await expect(
      ensureLegacyPublishedProfileTuple(
        bootstrapInput(manifest, profileRepository(), {
          modelCapabilityPreflight: {
            verify: async (input) =>
              input.kind === "embedding"
                ? (undefined as never)
                : capability(input.kind, input.selection),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "MODEL_PREFLIGHT_UNAVAILABLE" });

    await expect(
      ensureLegacyPublishedProfileTuple(
        bootstrapInput(manifest, profileRepository(), {
          modelCapabilityPreflight: {
            verify: async (input) =>
              input.kind === "reasoning"
                ? (undefined as never)
                : capability(input.kind, input.selection),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "MODEL_PREFLIGHT_UNAVAILABLE" });
  });
});

describe("knowledge-space profile failure behavior", () => {
  it("fails pending settings and space updates when durable permission issuance is denied", async () => {
    const baseAccess = createKnowledgeSpaceAccessService({
      repository: createInMemoryKnowledgeSpaceAccessRepository({
        maxApiKeysPerSpace: 10,
        maxListLimit: 10,
        maxMembersPerSpace: 10,
      }),
    });
    const app = profileApp({
      knowledgeSpaceAccess: {
        ...baseAccess,
        createPermissionSnapshot: async () => {
          throw new KnowledgeSpaceAccessError(
            "space_access_forbidden",
            "permission snapshots are disabled",
          );
        },
      },
    });
    await createSpace(app);

    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(embedding.status).toBe(403);
    const retrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify({
        expectedRevision: 0,
        profile: { ...retrievalUpdateBody().profile, defaultMode: "research" },
      }),
      headers: headers(),
      method: "PUT",
    });
    expect(retrieval.status).toBe(403);
    const update = await app.request(`/knowledge-spaces/${SPACE_ID}`, {
      body: JSON.stringify({ expectedRevision: 1, name: "Denied rename" }),
      headers: headers(),
      method: "PATCH",
    });
    expect(update.status).toBe(403);
  });

  it("maps non-retryable preflight failures and activation-time access revocation", async () => {
    const preflightManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const preflightApp = profileApp({
      knowledgeSpaceManifests: preflightManifests,
      knowledgeSpaceUnpublishedProfileActivations: {
        activate: async () => ({}) as never,
        activateInitialTuple: async () => ({}) as never,
      },
      modelCapabilityPreflight: {
        verify: async () => {
          throw new ModelCapabilityPreflightError(
            "MODEL_CAPABILITY_MISMATCH",
            "selected model is incompatible",
          );
        },
      },
    });
    await createSpace(preflightApp);
    await seedActiveManifest(preflightManifests);
    const embeddingPreflight = await preflightApp.request(
      `/knowledge-spaces/${SPACE_ID}/embedding-profile`,
      {
        body: JSON.stringify(EMBEDDING_V2),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(embeddingPreflight.status).toBe(422);
    const retrievalPreflight = await preflightApp.request(
      `/knowledge-spaces/${SPACE_ID}/retrieval-profile`,
      {
        body: JSON.stringify(retrievalUpdateBody()),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(retrievalPreflight.status).toBe(422);

    const activationManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const { preflight } = modelPreflight();
    const activationApp = profileApp({
      knowledgeSpaceManifests: activationManifests,
      knowledgeSpaceUnpublishedProfileActivations: {
        activate: async () => {
          throw new KnowledgeSpaceAccessError(
            "space_access_forbidden",
            "permission was revoked before activation",
          );
        },
        activateInitialTuple: async () => ({}) as never,
      },
      modelCapabilityPreflight: preflight,
    });
    await createSpace(activationApp);
    await seedActiveManifest(activationManifests);
    const embeddingActivation = await activationApp.request(
      `/knowledge-spaces/${SPACE_ID}/embedding-profile`,
      {
        body: JSON.stringify(EMBEDDING_V2),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(embeddingActivation.status).toBe(403);
    const retrievalActivation = await activationApp.request(
      `/knowledge-spaces/${SPACE_ID}/retrieval-profile`,
      {
        body: JSON.stringify(retrievalUpdateBody()),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(retrievalActivation.status).toBe(403);
  });

  it("keeps missing spaces and invalid pending retrieval updates explicit", async () => {
    const app = profileApp();

    const missingEmbedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(missingEmbedding.status).toBe(404);
    const missingRetrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify(retrievalUpdateBody()),
      headers: headers(),
      method: "PUT",
    });
    expect(missingRetrieval.status).toBe(404);

    await createSpace(app);
    const revisionConflict = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify({ ...retrievalUpdateBody(), expectedRevision: 1 }),
      headers: headers(),
      method: "PUT",
    });
    expect(revisionConflict.status).toBe(409);
    await expect(revisionConflict.json()).resolves.toMatchObject({
      code: "PENDING_MODEL_CONFIGURATION_CONFLICT",
    });

    const embeddingRequired = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify({ ...retrievalUpdateBody(), expectedRevision: 0 }),
      headers: headers(),
      method: "PUT",
    });
    expect(embeddingRequired.status).toBe(409);
    await expect(embeddingRequired.json()).resolves.toMatchObject({
      code: "EMBEDDING_MODEL_REQUIRED",
    });

    const createWithoutEmbedding = await profileApp().request("/knowledge-spaces", {
      body: JSON.stringify({
        name: "Invalid deep space",
        retrievalProfile: retrievalUpdateBody().profile,
      }),
      headers: headers(),
      method: "POST",
    });
    expect(createWithoutEmbedding.status).toBe(422);
    await expect(createWithoutEmbedding.json()).resolves.toMatchObject({
      code: "MODEL_CAPABILITY_MISMATCH",
    });
  });

  it("replays identical pending selections without starting duplicate validation", async () => {
    const app = profileApp();
    await createSpace(app);

    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(embedding.status).toBe(202);
    const retrievalBody = {
      expectedRevision: 0,
      profile: {
        ...retrievalUpdateBody().profile,
        defaultMode: "research",
      },
    } as const;
    const retrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify(retrievalBody),
      headers: headers(),
      method: "PUT",
    });
    expect(retrieval.status).toBe(202);

    const embeddingReplay = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(embeddingReplay.status).toBe(202);
    await expect(embeddingReplay.json()).resolves.toMatchObject({
      configurationStatus: "pending-validation",
      revision: 2,
    });
    const retrievalReplay = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify(retrievalBody),
      headers: headers(),
      method: "PUT",
    });
    expect(retrievalReplay.status).toBe(202);
    await expect(retrievalReplay.json()).resolves.toMatchObject({ revision: 2 });
  });

  it("reports pending manifest CAS loss for both settings kinds", async () => {
    const baseManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    let rejectUpdates = false;
    const manifests: KnowledgeSpaceManifestRepository = {
      ...baseManifests,
      update: async (input) => (rejectUpdates ? null : baseManifests.update(input)),
    };
    const app = profileApp({ knowledgeSpaceManifests: manifests });
    await createSpace(app);
    rejectUpdates = true;

    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(embedding.status).toBe(409);
    await expect(embedding.json()).resolves.toMatchObject({
      code: "PENDING_MODEL_CONFIGURATION_CONFLICT",
    });
    const retrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify({
        expectedRevision: 0,
        profile: { ...retrievalUpdateBody().profile, defaultMode: "research" },
      }),
      headers: headers(),
      method: "PUT",
    });
    expect(retrieval.status).toBe(409);
    await expect(retrieval.json()).resolves.toMatchObject({
      code: "PENDING_MODEL_CONFIGURATION_CONFLICT",
    });
  });

  it("fails closed when capability preflight or atomic activation is unavailable", async () => {
    const unavailableManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const preflightUnavailable = profileApp({
      knowledgeSpaceManifests: unavailableManifests,
      knowledgeSpaceUnpublishedProfileActivations: {
        activate: async () => ({}) as never,
        activateInitialTuple: async () => ({}) as never,
      },
    });
    await createSpace(preflightUnavailable);
    await seedActiveManifest(unavailableManifests);
    const noEmbeddingPreflight = await preflightUnavailable.request(
      `/knowledge-spaces/${SPACE_ID}/embedding-profile`,
      {
        body: JSON.stringify(EMBEDDING_V2),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(noEmbeddingPreflight.status).toBe(503);
    await expect(noEmbeddingPreflight.json()).resolves.toMatchObject({
      code: "MODEL_PREFLIGHT_UNAVAILABLE",
    });
    const noRetrievalPreflight = await preflightUnavailable.request(
      `/knowledge-spaces/${SPACE_ID}/retrieval-profile`,
      {
        body: JSON.stringify(retrievalUpdateBody()),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(noRetrievalPreflight.status).toBe(503);
    await expect(noRetrievalPreflight.json()).resolves.toMatchObject({
      code: "MODEL_PREFLIGHT_UNAVAILABLE",
    });

    const activationManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const { preflight } = modelPreflight();
    const activationUnavailable = profileApp({
      knowledgeSpaceManifests: activationManifests,
      modelCapabilityPreflight: preflight,
    });
    await createSpace(activationUnavailable);
    await seedActiveManifest(activationManifests);
    const noEmbeddingActivation = await activationUnavailable.request(
      `/knowledge-spaces/${SPACE_ID}/embedding-profile`,
      {
        body: JSON.stringify(EMBEDDING_V2),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(noEmbeddingActivation.status).toBe(503);
    await expect(noEmbeddingActivation.json()).resolves.toMatchObject({
      code: "UNPUBLISHED_PROFILE_ACTIVATION_UNAVAILABLE",
    });
    const noRetrievalActivation = await activationUnavailable.request(
      `/knowledge-spaces/${SPACE_ID}/retrieval-profile`,
      {
        body: JSON.stringify(retrievalUpdateBody()),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(noRetrievalActivation.status).toBe(503);
    await expect(noRetrievalActivation.json()).resolves.toMatchObject({
      code: "UNPUBLISHED_PROFILE_ACTIVATION_UNAVAILABLE",
    });
  });

  it("requires configured migration machinery before changing a published tuple", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const app = profileApp({
      knowledgeSpaceManifests: manifests,
      projectionSetPublications: {
        getPublished: async () => ({}) as never,
      } as never,
    });
    await createSpace(app);
    await seedActiveManifest(manifests);

    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(embedding.status).toBe(503);
    await expect(embedding.json()).resolves.toMatchObject({
      code: "PROFILE_MIGRATION_UNAVAILABLE",
    });
    const retrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify(retrievalUpdateBody()),
      headers: headers(),
      method: "PUT",
    });
    expect(retrieval.status).toBe(503);
    await expect(retrieval.json()).resolves.toMatchObject({
      code: "PROFILE_MIGRATION_UNAVAILABLE",
    });
  });

  it("blocks embedding replacement after the vector space is frozen or populated", async () => {
    const frozenManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const frozenApp = profileApp({ knowledgeSpaceManifests: frozenManifests });
    await createSpace(frozenApp);
    const frozenManifest = await seedActiveManifest(frozenManifests);
    await frozenManifests.update({
      expectedManifestVersion: frozenManifest.manifestVersion,
      knowledgeSpaceId: SPACE_ID,
      patch: {
        embeddingProfileFrozenAt: NOW,
        manifestVersion: frozenManifest.manifestVersion + 1,
        updatedAt: NOW,
      },
      tenantId: "tenant-1",
    });
    const frozen = await frozenApp.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(frozen.status).toBe(409);

    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const populatedManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const populatedApp = profileApp({
      documentAssets: assets,
      knowledgeSpaceManifests: populatedManifests,
    });
    await createSpace(populatedApp);
    await seedActiveManifest(populatedManifests);
    await assets.create({
      filename: "indexed.txt",
      knowledgeSpaceId: SPACE_ID,
      mimeType: "text/plain",
      objectKey: `tenant-1/spaces/${SPACE_ID}/raw/indexed.txt`,
      sha256: "e".repeat(64),
      sizeBytes: 8,
      tenantId: "tenant-1",
    });
    const populated = await populatedApp.request(
      `/knowledge-spaces/${SPACE_ID}/embedding-profile`,
      {
        body: JSON.stringify(EMBEDDING_V2),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(populated.status).toBe(409);
  });

  it("maps atomic activation conflicts to stable settings responses", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const { preflight } = modelPreflight();
    const app = profileApp({
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceUnpublishedProfileActivations: {
        activate: async () => {
          throw new KnowledgeSpaceUnpublishedProfileActivationError(
            "PROFILE_ACTIVATION_CONFLICT",
            "profile activation lost its manifest fence",
          );
        },
        activateInitialTuple: async () => ({}) as never,
      },
      modelCapabilityPreflight: preflight,
    });
    await createSpace(app);
    await seedActiveManifest(manifests);

    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(embedding.status).toBe(409);
    await expect(embedding.json()).resolves.toMatchObject({ code: "PROFILE_ACTIVATION_CONFLICT" });
    const retrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify(retrievalUpdateBody()),
      headers: headers(),
      method: "PUT",
    });
    expect(retrieval.status).toBe(409);
    await expect(retrieval.json()).resolves.toMatchObject({ code: "PROFILE_ACTIVATION_CONFLICT" });

    const transitionManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const transitionApp = profileApp({
      knowledgeSpaceManifests: transitionManifests,
      knowledgeSpaceUnpublishedProfileActivations: {
        activate: async () => {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
            "profile head changed concurrently",
          );
        },
        activateInitialTuple: async () => ({}) as never,
      },
      modelCapabilityPreflight: preflight,
    });
    await createSpace(transitionApp);
    await seedActiveManifest(transitionManifests);
    const transition = await transitionApp.request(
      `/knowledge-spaces/${SPACE_ID}/embedding-profile`,
      {
        body: JSON.stringify(EMBEDDING_V2),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(transition.status).toBe(409);
    await expect(transition.json()).resolves.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
    });
    const retrievalTransition = await transitionApp.request(
      `/knowledge-spaces/${SPACE_ID}/retrieval-profile`,
      {
        body: JSON.stringify(retrievalUpdateBody()),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(retrievalTransition.status).toBe(409);
    await expect(retrievalTransition.json()).resolves.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
    });
  });

  it("maps published bootstrap prerequisites and unexpected preflight outages", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const { preflight } = modelPreflight();
    const app = profileApp({
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfileMigrations: {
        cancel: async () => null,
        get: async () => null,
        request: async () => ({}) as never,
        requiresMigration: async () => true,
        retry: async () => null,
      },
      knowledgeSpaceProfiles: profileRepository(),
      modelCapabilityPreflight: preflight,
    });
    await createSpace(app);
    await seedActiveManifest(manifests);
    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(embedding.status).toBe(503);
    await expect(embedding.json()).resolves.toMatchObject({
      code: "PROFILE_PUBLICATION_BOOTSTRAP_UNAVAILABLE",
    });
    const retrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify(retrievalUpdateBody()),
      headers: headers(),
      method: "PUT",
    });
    expect(retrieval.status).toBe(503);
    await expect(retrieval.json()).resolves.toMatchObject({
      code: "PROFILE_PUBLICATION_BOOTSTRAP_UNAVAILABLE",
    });

    const outageManifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const outageApp = profileApp({
      knowledgeSpaceManifests: outageManifests,
      knowledgeSpaceUnpublishedProfileActivations: {
        activate: async () => ({}) as never,
        activateInitialTuple: async () => ({}) as never,
      },
      modelCapabilityPreflight: {
        verify: async () => {
          throw new Error("plugin daemon transport crashed");
        },
      },
    });
    await createSpace(outageApp);
    await seedActiveManifest(outageManifests);
    const embeddingOutage = await outageApp.request(
      `/knowledge-spaces/${SPACE_ID}/embedding-profile`,
      {
        body: JSON.stringify(EMBEDDING_V2),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(embeddingOutage.status).toBe(500);
    const retrievalOutage = await outageApp.request(
      `/knowledge-spaces/${SPACE_ID}/retrieval-profile`,
      {
        body: JSON.stringify(retrievalUpdateBody()),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(retrievalOutage.status).toBe(500);
  });

  it("preserves provisioning replay errors and rejects unusable embedding capabilities", async () => {
    const provisioningCases = [
      {
        error: new KnowledgeSpaceProvisioningIdempotencyConflictError(),
        status: 409,
      },
      {
        error: new KnowledgeSpaceProvisioningIncompleteReplayError(),
        status: 503,
      },
    ] as const;
    for (const { error, status } of provisioningCases) {
      const app = profileApp({
        knowledgeSpaceProvisioning: {
          provision: async () => {
            throw error;
          },
        },
      });
      const response = await app.request("/knowledge-spaces", {
        body: JSON.stringify({ name: `Provisioning error ${status}` }),
        headers: headers(),
        method: "POST",
      });
      expect(response.status).toBe(status);
    }

    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const invalidCapabilityApp = profileApp({
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceUnpublishedProfileActivations: {
        activate: async () => ({}) as never,
        activateInitialTuple: async () => ({}) as never,
      },
      modelCapabilityPreflight: {
        verify: async (input) =>
          ({
            ...capability(input.kind, input.selection),
            dimension: undefined,
            distanceMetric: undefined,
          }) as never,
      },
    });
    await createSpace(invalidCapabilityApp);
    await seedActiveManifest(manifests);
    const response = await invalidCapabilityApp.request(
      `/knowledge-spaces/${SPACE_ID}/embedding-profile`,
      {
        body: JSON.stringify(EMBEDDING_V2),
        headers: headers(),
        method: "PUT",
      },
    );
    expect(response.status).toBe(500);
  });

  it("surfaces legacy model preflight failures before staging published candidates", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profiles = profileRepository();
    const app = profileApp({
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfileMigrations: {
        cancel: async () => null,
        get: async () => null,
        request: async () => ({}) as never,
        requiresMigration: async () => true,
        retry: async () => null,
      },
      knowledgeSpaceProfilePublications: {
        activateCandidate: async () => ({}) as never,
        bindCandidate: async () => ({}) as never,
        bindCurrentPublished: async () => ({}) as never,
        bindExistingPublished: async () => ({}) as never,
        requireActivatedBinding: async () => ({}) as never,
      },
      knowledgeSpaceProfiles: profiles,
      modelCapabilityPreflight: {
        verify: async (input) => {
          if (["embed-v1", "reasoning-v1", "rerank-v1"].includes(input.selection.model)) {
            throw new ModelCapabilityPreflightError(
              "MODEL_PREFLIGHT_FAILED",
              "legacy model installation is offline",
              { retryable: true },
            );
          }
          return capability(input.kind, input.selection);
        },
      },
    });
    await createSpace(app);
    await seedActiveManifest(manifests);

    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(embedding.status).toBe(503);
    await expect(embedding.json()).resolves.toMatchObject({ code: "MODEL_PREFLIGHT_FAILED" });
    const retrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify(retrievalUpdateBody()),
      headers: headers(),
      method: "PUT",
    });
    expect(retrieval.status).toBe(503);
    await expect(retrieval.json()).resolves.toMatchObject({ code: "MODEL_PREFLIGHT_FAILED" });
    await expect(
      profiles.getHead({ kind: "embedding", knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" }),
    ).resolves.toBeNull();
  });

  it("fails closed when the published profile ledger is unavailable during bootstrap", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const baseProfiles = profileRepository();
    const unavailableProfiles = {
      ...baseProfiles,
      getHead: async () => {
        throw new Error("profile ledger unavailable");
      },
    };
    const { preflight } = modelPreflight();
    const app = profileApp({
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfileMigrations: {
        cancel: async () => null,
        get: async () => null,
        request: async () => ({}) as never,
        requiresMigration: async () => true,
        retry: async () => null,
      },
      knowledgeSpaceProfilePublications: {
        activateCandidate: async () => ({}) as never,
        bindCandidate: async () => ({}) as never,
        bindCurrentPublished: async () => ({}) as never,
        bindExistingPublished: async () => ({}) as never,
        requireActivatedBinding: async () => ({}) as never,
      },
      knowledgeSpaceProfiles: unavailableProfiles,
      modelCapabilityPreflight: preflight,
    });
    await createSpace(app);
    await seedActiveManifest(manifests);

    const embedding = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(embedding.status).toBe(503);
    await expect(embedding.json()).resolves.toMatchObject({
      code: "PROFILE_PUBLICATION_BOOTSTRAP_FAILED",
    });
    const retrieval = await app.request(`/knowledge-spaces/${SPACE_ID}/retrieval-profile`, {
      body: JSON.stringify(retrievalUpdateBody()),
      headers: headers(),
      method: "PUT",
    });
    expect(retrieval.status).toBe(503);
    await expect(retrieval.json()).resolves.toMatchObject({
      code: "PROFILE_PUBLICATION_BOOTSTRAP_FAILED",
    });
  });

  it("refuses to attach a published settings request to another immutable candidate", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profiles = profileRepository();
    const { preflight } = modelPreflight();
    const app = profileApp({
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfileMigrations: {
        cancel: async () => null,
        get: async () => null,
        request: async () => ({}) as never,
        requiresMigration: async () => true,
        retry: async () => null,
      },
      knowledgeSpaceProfilePublications: {
        activateCandidate: async () => ({}) as never,
        bindCandidate: async () => ({}) as never,
        bindCurrentPublished: async () => ({}) as never,
        bindExistingPublished: async () => ({}) as never,
        requireActivatedBinding: async () => ({}) as never,
      },
      knowledgeSpaceProfiles: profiles,
      modelCapabilityPreflight: preflight,
    });
    await createSpace(app);
    const manifest = await seedActiveManifest(manifests);
    const { embeddingProfile, retrievalProfile } = requireLegacyProfiles(manifest);
    const activeEmbedding = await profiles.createCandidate({
      capabilitySnapshot: capability("embedding", EMBEDDING_V1),
      createdBySubjectId: "user:owner",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: { ...embeddingProfile, dimension: 1536 },
      tenantId: "tenant-1",
    });
    const activeRetrieval = await profiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: capability("rerank", RERANK_V1),
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      preserveLegacyInitialRevision: true,
      snapshot: retrievalProfile,
      tenantId: "tenant-1",
    });
    await profiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: activeEmbedding.revision,
      tenantId: "tenant-1",
    });
    await profiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: activeRetrieval.revision,
      tenantId: "tenant-1",
    });
    const competingSelection: KnowledgeSpaceModelSelection = {
      model: "embed-competing",
      pluginId: "embedding-plugin",
      provider: "plugin-daemon",
    };
    await profiles.createCandidate({
      capabilitySnapshot: capability("embedding", competingSelection),
      createdBySubjectId: "user:other",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      snapshot: {
        ...(await createKnowledgeSpaceEmbeddingProfile(competingSelection, 2)),
        dimension: 1536,
      },
      tenantId: "tenant-1",
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/embedding-profile`, {
      body: JSON.stringify(EMBEDDING_V2),
      headers: headers(),
      method: "PUT",
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "KNOWLEDGE_SPACE_SETTINGS_CANDIDATE_CONFLICT",
    });
  });
});

describe("knowledge-space configuration status behavior", () => {
  it("derives ready modes from verified active profile heads", async () => {
    const profiles = profileRepository();
    const app = profileApp({ knowledgeSpaceProfiles: profiles });
    await createSpace(app);
    const embeddingCandidate = await profiles.createCandidate({
      capabilitySnapshot: capability("embedding", EMBEDDING_V1),
      createdBySubjectId: "user:owner",
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      snapshot: {
        ...(await createKnowledgeSpaceEmbeddingProfile(EMBEDDING_V1)),
        dimension: 1536,
      },
      tenantId: "tenant-1",
    });
    const retrievalCandidate = await profiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: capability("rerank", RERANK_V1),
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      snapshot: createKnowledgeSpaceRetrievalProfile({
        defaultMode: "deep",
        reasoningModel: REASONING_V1,
        rerank: { enabled: true, model: RERANK_V1 },
        scoreThreshold: { enabled: true, stage: "mode-final", value: 0.35 },
        topK: 8,
      }),
      tenantId: "tenant-1",
    });
    await profiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: embeddingCandidate.revision,
      tenantId: "tenant-1",
    });
    await profiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: retrievalCandidate.revision,
      tenantId: "tenant-1",
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/status`, {
      headers: headers(),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configuration: {
        activeProfiles: { embeddingRevision: 1, retrievalRevision: 1 },
        availableModes: ["fast", "research", "deep"],
        status: "ready",
      },
    });
  });

  it("keeps a research-only active head ready without inventing an embedding profile", async () => {
    const profiles = profileRepository();
    const app = profileApp({ knowledgeSpaceProfiles: profiles });
    await createSpace(app);
    const retrievalCandidate = await profiles.createCandidate({
      capabilitySnapshot: {
        reasoning: capability("reasoning", REASONING_V1),
        rerank: null,
        verification: "verified",
      },
      createdBySubjectId: "user:owner",
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      snapshot: createKnowledgeSpaceRetrievalProfile({
        defaultMode: "research",
        reasoningModel: REASONING_V1,
        rerank: { enabled: false },
        scoreThreshold: { enabled: false, stage: "mode-final" },
        topK: 5,
      }),
      tenantId: "tenant-1",
    });
    await profiles.activateCandidate({
      expectedActiveRevision: null,
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: retrievalCandidate.revision,
      tenantId: "tenant-1",
    });

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/status`, {
      headers: headers(),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      configuration: {
        activeProfiles: { retrievalRevision: 1 },
        availableModes: ["research"],
        status: "ready",
      },
    });
  });

  it("normalizes valid pending diagnostics and fails closed on corrupt metadata", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const app = profileApp({ knowledgeSpaceManifests: manifests });
    await createSpace(app);

    const updatePendingMetadata = async (value: unknown) => {
      const current = await manifests.get({
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-1",
      });
      if (!current) throw new Error("test manifest missing");
      const updated = await manifests.update({
        expectedManifestVersion: current.manifestVersion,
        knowledgeSpaceId: SPACE_ID,
        patch: {
          manifestVersion: current.manifestVersion + 1,
          metadata: {
            ...current.metadata,
            __knowledgeFsPendingModelConfiguration: value,
          },
          updatedAt: NOW,
        },
        tenantId: "tenant-1",
      });
      if (!updated) throw new Error("test manifest metadata update failed");
    };
    const readConfiguration = async () => {
      const response = await app.request(`/knowledge-spaces/${SPACE_ID}/status`, {
        headers: headers(),
      });
      expect(response.status).toBe(200);
      return (await response.json()).configuration;
    };

    await updatePendingMetadata("corrupt");
    await expect(readConfiguration()).resolves.toMatchObject({ status: "validation-failed" });

    await updatePendingMetadata({ digest: "bad", revision: 0, state: "pending-validation" });
    await expect(readConfiguration()).resolves.toMatchObject({ status: "validation-failed" });

    await updatePendingMetadata({
      digest: "a".repeat(64),
      revision: 2,
      state: "validating",
    });
    await expect(readConfiguration()).resolves.toMatchObject({
      pendingModelConfiguration: {
        digest: "a".repeat(64),
        revision: 2,
        state: "pending-validation",
      },
      status: "pending-validation",
    });

    await updatePendingMetadata({
      digest: "b".repeat(64),
      failure: { code: "MODEL_OFFLINE", failedAt: NOW, retryable: true },
      revision: 3,
      state: "validation-failed",
    });
    await expect(readConfiguration()).resolves.toMatchObject({
      pendingModelConfiguration: {
        failure: { code: "MODEL_OFFLINE", failedAt: NOW, retryable: true },
        revision: 3,
        state: "validation-failed",
      },
      status: "validation-failed",
    });

    await updatePendingMetadata({
      digest: "c".repeat(64),
      failure: { code: "not valid!", failedAt: "never", retryable: "yes" },
      revision: 4,
      state: "validation-failed",
    });
    await expect(readConfiguration()).resolves.toMatchObject({ status: "validation-failed" });
  });

  it("reports object storage health-check outages without failing status diagnostics", async () => {
    const baseAdapter = createNodePlatformAdapter({ env: {} });
    const app = createKnowledgeGateway({
      adapter: {
        ...baseAdapter,
        objectStorage: {
          ...baseAdapter.objectStorage,
          health: async () => {
            throw new Error("object storage health endpoint timed out");
          },
        },
      },
      auth: auth(),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => SPACE_ID,
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      now: () => NOW,
    });
    await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/status`, {
      headers: headers(),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ storage: { healthy: false } });
  });
});
