import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { createDefaultKnowledgeSpaceManifest } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  type ModelCapabilityPreflight,
  createInMemoryDocumentAssetRepository,
  createInMemoryKnowledgeSpaceManifestRepository,
  createInMemoryKnowledgeSpaceProfileRepository,
  createInMemoryKnowledgeSpaceRepository,
  createKnowledgeGateway,
  createStaticAuthVerifier,
  freezeKnowledgeSpaceEmbeddingProfile,
} from "./index";
import { createTestUnpublishedProfileActivations } from "./knowledge-space-unpublished-profile-activation-test-utils";
import { createInitializedTestKnowledgeSpaceAccess } from "./test-knowledge-space-access";

const writeToken = "write-token";
const writeSubject = {
  scopes: ["knowledge-spaces:*"],
  subjectId: "user-1",
  tenantId: "tenant-1",
};

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function acceptingModelCapabilityPreflight(): ModelCapabilityPreflight {
  return {
    verify: async (input) => ({
      capabilityDigest: `sha256:${"a".repeat(64)}`,
      checkedAt: "2026-05-27T09:00:00.000Z",
      ...(input.kind === "embedding" ? { dimension: 3072, distanceMetric: "cosine" as const } : {}),
      kind: input.kind,
      pluginUniqueIdentifier: `${input.selection.pluginId}:test@sha256:installed`,
      schemaFingerprint: `sha256:${"b".repeat(64)}`,
      selection: input.selection,
    }),
  };
}

describe("KnowledgeSpace manifest bootstrap", () => {
  it("creates a default manifest when a new KnowledgeSpace is created", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { [writeToken]: writeSubject } }),
      generateKnowledgeSpaceManifestId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f7b10",
      knowledgeSpaceManifests: manifests,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-27T09:00:00.000Z",
      }),
      modelCapabilityPreflight: acceptingModelCapabilityPreflight(),
      now: () => "2026-05-27T09:00:00.000Z",
    });

    const response = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        embeddingProfile: {
          model: "user-selected",
          pluginId: "plugin-demo",
          provider: "tenant-provider",
        },
        name: "Engineering",
        slug: "engineering",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    await expect(
      manifests.get({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      pendingModelConfiguration: {
        digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        embeddingSelection: {
          model: "user-selected",
          pluginId: "plugin-demo",
          provider: "tenant-provider",
        },
        revision: 1,
        state: "pending-validation",
      },
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b10",
      manifestVersion: 1,
      objectKeyPrefix: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      storageProvider: "dify",
    });
  });

  it("persists a pending model selection without preflight and revisions it only when changed", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 20,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { [writeToken]: writeSubject } }),
      generateKnowledgeSpaceManifestId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f7b12",
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaceUnpublishedProfileActivations: createTestUnpublishedProfileActivations(
        manifests,
        profiles,
      ),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
        maxListLimit: 10,
        maxSpaces: 10,
        now: () => "2026-05-27T09:10:00.000Z",
      }),
      modelCapabilityPreflight: acceptingModelCapabilityPreflight(),
      now: () => "2026-05-27T09:10:00.000Z",
    });
    const firstSelection = {
      model: "embed-v1",
      pluginId: "plugin-demo",
      provider: "tenant-provider",
    };
    const created = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        embeddingProfile: firstSelection,
        name: "Research",
        slug: "research",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);

    const manifestResponse = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44/manifest",
      { headers: bearer(writeToken) },
    );
    const manifest = await manifestResponse.json();
    expect(manifest.embeddingProfile).toBeUndefined();
    expect(manifest.pendingModelConfiguration).toMatchObject({
      embeddingSelection: firstSelection,
      revision: 1,
      state: "pending-validation",
    });

    const activated = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44/embedding-profile",
      {
        body: JSON.stringify(firstSelection),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(activated.status).toBe(202);
    await expect(activated.json()).resolves.toMatchObject({
      configurationStatus: "setup-required",
      operation: "initial-validation-pending",
      revision: 1,
    });

    const changed = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44/embedding-profile",
      {
        body: JSON.stringify({ ...firstSelection, model: "embed-v2" }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(changed.status).toBe(202);
    await expect(changed.json()).resolves.toMatchObject({
      operation: "initial-validation-pending",
      revision: 2,
    });

    await freezeKnowledgeSpaceEmbeddingProfile(manifests, {
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      now: () => "2026-05-27T09:11:00.000Z",
      tenantId: "tenant-1",
    });
    const frozenIdempotent = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44/embedding-profile",
      {
        body: JSON.stringify({ ...firstSelection, model: "embed-v2" }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(frozenIdempotent.status).toBe(202);
    await expect(frozenIdempotent.json()).resolves.toMatchObject({ revision: 2 });

    const frozenChange = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c44/embedding-profile",
      {
        body: JSON.stringify({ ...firstSelection, model: "embed-v3" }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(frozenChange.status).toBe(202);
    await expect(frozenChange.json()).resolves.toMatchObject({
      operation: "initial-validation-pending",
      revision: 3,
    });
    const finalManifest = await manifests.get({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
      tenantId: "tenant-1",
    });
    expect(finalManifest?.embeddingProfile).toBeUndefined();
    expect(finalManifest).toMatchObject({
      pendingModelConfiguration: {
        embeddingSelection: { ...firstSelection, model: "embed-v3" },
        revision: 3,
      },
    });
  });

  it("persists and CAS-updates the pending per-space retrieval profile", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const profiles = createInMemoryKnowledgeSpaceProfileRepository({
      maxListLimit: 10,
      maxRevisions: 20,
    });
    const queryCalls: unknown[] = [];
    const manifestIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7b15",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f7b16",
    ];
    const spaceIds = [
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
    ];
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { [writeToken]: writeSubject } }),
      generateKnowledgeSpaceManifestId: () => {
        const id = manifestIds.shift();
        if (!id) {
          throw new Error("No manifest id available");
        }
        return id;
      },
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceProfiles: profiles,
      knowledgeSpaceUnpublishedProfileActivations: createTestUnpublishedProfileActivations(
        manifests,
        profiles,
      ),
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => {
          const id = spaceIds.shift();
          if (!id) {
            throw new Error("No knowledge-space id available");
          }
          return id;
        },
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      modelCapabilityPreflight: acceptingModelCapabilityPreflight(),
      queryGenerator: {
        stream: async function* (input: unknown) {
          queryCalls.push(input);
          yield { finishReason: "stop", type: "done" as const };
        },
      },
    });
    const profile = {
      defaultMode: "fast",
      reasoningModel: {
        model: "gpt-4.1-mini",
        pluginId: "openai-plugin",
        provider: "openai",
      },
      rerank: {
        enabled: true,
        model: {
          model: "rerank-v3.5",
          pluginId: "cohere-plugin",
          provider: "cohere",
        },
      },
      scoreThreshold: { enabled: true, stage: "rerank", value: 0.5 },
      topK: 3,
    };
    const invalidCreate = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        name: "Invalid Retrieval Config",
        retrievalProfile: { ...profile, rerank: { enabled: false } },
        slug: "invalid-retrieval-config",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(invalidCreate.status).toBe(400);
    await expect(invalidCreate.json()).resolves.toEqual({
      code: "RETRIEVAL_PROFILE_SCORE_THRESHOLD_REQUIRES_RERANK",
      error:
        "Fast/Deep mode-final score threshold requires the knowledge-space reranker to be enabled",
      mode: "fast",
    });
    const created = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        embeddingProfile: {
          model: "embed-v1",
          pluginId: "plugin-demo",
          provider: "tenant-provider",
        },
        name: "Retrieval Config",
        retrievalProfile: profile,
        slug: "retrieval-config",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    await expect(
      manifests.get({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      pendingModelConfiguration: {
        retrievalProfile: profile,
        state: "pending-validation",
      },
    });

    const updated = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c48/retrieval-profile",
      {
        body: JSON.stringify({
          expectedRevision: 0,
          profile: { ...profile, defaultMode: "deep", topK: 8 },
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(updated.status).toBe(202);
    await expect(updated.json()).resolves.toMatchObject({
      configurationStatus: "pending-validation",
      operation: "initial-validation-pending",
      revision: 2,
    });
    const invalidUpdate = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c48/retrieval-profile",
      {
        body: JSON.stringify({
          expectedRevision: 1,
          profile: {
            ...profile,
            defaultMode: "deep",
            rerank: { enabled: false },
          },
        }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(invalidUpdate.status).toBe(400);
    await expect(invalidUpdate.json()).resolves.toEqual({
      code: "RETRIEVAL_PROFILE_SCORE_THRESHOLD_REQUIRES_RERANK",
      error:
        "Fast/Deep mode-final score threshold requires the knowledge-space reranker to be enabled",
      mode: "deep",
    });

    await expect(
      manifests.get({
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
        tenantId: "tenant-1",
      }),
    ).resolves.toMatchObject({
      manifestVersion: 2,
      pendingModelConfiguration: {
        retrievalProfile: { defaultMode: "deep", topK: 8 },
        revision: 2,
        state: "pending-validation",
      },
    });
    await expect(
      profiles.getHead({
        kind: "retrieval",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
  });

  it("allows pending model correction before initial activation when an asset already exists", async () => {
    const assets = createInMemoryDocumentAssetRepository({ maxAssets: 10 });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { [writeToken]: writeSubject } }),
      documentAssets: assets,
      knowledgeSpaces: createInMemoryKnowledgeSpaceRepository({
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
        maxListLimit: 10,
        maxSpaces: 10,
      }),
      modelCapabilityPreflight: acceptingModelCapabilityPreflight(),
    });
    const firstSelection = {
      model: "embed-v1",
      pluginId: "plugin-demo",
      provider: "tenant-provider",
    };
    await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        embeddingProfile: firstSelection,
        name: "Indexed",
        slug: "indexed",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });
    await assets.create({
      filename: "indexed.txt",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01",
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45",
      mimeType: "text/plain",
      objectKey: "tenant-1/indexed.txt",
      sha256: "a".repeat(64),
      sizeBytes: 10,
    });

    const response = await app.request(
      "/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c45/embedding-profile",
      {
        body: JSON.stringify({ ...firstSelection, model: "embed-v2" }),
        headers: { ...bearer(writeToken), "content-type": "application/json" },
        method: "PUT",
      },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      configurationStatus: "setup-required",
      operation: "initial-validation-pending",
      revision: 2,
    });
  });

  it("removes a newly-created space when its selected profile cannot be persisted", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
      maxListLimit: 10,
      maxSpaces: 10,
    });
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 1,
    });
    await manifests.create(
      createDefaultKnowledgeSpaceManifest({
        createdAt: "2026-05-27T09:15:00.000Z",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b13",
        knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
        tenantId: "tenant-1",
        updatedAt: "2026-05-27T09:15:00.000Z",
      }),
    );
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { [writeToken]: writeSubject } }),
      knowledgeSpaceManifests: manifests,
      knowledgeSpaces: spaces,
      modelCapabilityPreflight: acceptingModelCapabilityPreflight(),
    });

    const response = await app.request("/knowledge-spaces", {
      body: JSON.stringify({
        embeddingProfile: {
          model: "embed-v1",
          pluginId: "plugin-demo",
          provider: "tenant-provider",
        },
        name: "Rollback",
        slug: "rollback",
      }),
      headers: { ...bearer(writeToken), "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(500);
    await expect(
      spaces.get({
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
        tenantId: "tenant-1",
      }),
    ).resolves.toBeNull();
  });

  it("lazily creates a default manifest when reading a legacy KnowledgeSpace", async () => {
    const spaces = createInMemoryKnowledgeSpaceRepository({
      generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      maxListLimit: 10,
      maxSpaces: 10,
      now: () => "2026-05-27T09:00:00.000Z",
    });
    await spaces.create({ name: "Legacy", slug: "legacy", tenantId: "tenant-1" });

    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const app = createKnowledgeGateway({
      adapter: createNodePlatformAdapter({ env: {} }),
      auth: createStaticAuthVerifier({ subjectsByToken: { [writeToken]: writeSubject } }),
      generateKnowledgeSpaceManifestId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f7b11",
      knowledgeSpaceManifests: manifests,
      knowledgeSpaceAccess: await createInitializedTestKnowledgeSpaceAccess([
        { knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43" },
      ]),
      knowledgeSpaces: spaces,
      now: () => "2026-05-27T09:05:00.000Z",
    });

    const response = await app.request("/knowledge-spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43", {
      headers: bearer(writeToken),
    });

    expect(response.status).toBe(200);
    const legacyManifest = await manifests.get({
      knowledgeSpaceId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
      tenantId: "tenant-1",
    });
    expect(legacyManifest).toMatchObject({
      createdAt: "2026-05-27T09:05:00.000Z",
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f7b11",
      objectKeyPrefix: "tenant-1/spaces/018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
    });
    expect(legacyManifest?.embeddingProfile).toBeUndefined();
  });
});
