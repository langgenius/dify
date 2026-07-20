import {
  type KnowledgeSpaceEmbeddingProfile,
  type KnowledgeSpaceManifest,
  type KnowledgeSpaceModelSelection,
  createDefaultKnowledgeSpaceManifest,
  createKnowledgeSpaceEmbeddingProfile,
  createKnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { ensureLegacyPublishedProfileTuple } from "./knowledge-space-handlers";
import { createInMemoryKnowledgeSpaceProfileRepository } from "./knowledge-space-profile-memory-repository";
import {
  type ModelCapabilityKind,
  type ModelCapabilityPreflight,
  ModelCapabilityPreflightError,
  type ModelCapabilitySnapshot,
} from "./model-capability-preflight";

const TENANT_ID = "tenant-legacy";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f3a40";
const MANIFEST_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f7a10";
const NOW = "2026-07-14T12:00:00.000Z";
const LATER = "2026-07-14T12:05:00.000Z";
const EMBEDDING: KnowledgeSpaceModelSelection = {
  model: "embed-dynamic",
  pluginId: "embedding-plugin",
  provider: "plugin-daemon",
};
const REASONING: KnowledgeSpaceModelSelection = {
  model: "reasoning-v2",
  pluginId: "reasoning-plugin",
  provider: "plugin-daemon",
};
const RERANK: KnowledgeSpaceModelSelection = {
  model: "rerank-v3",
  pluginId: "rerank-plugin",
  provider: "plugin-daemon",
};

describe("legacy published profile bootstrap", () => {
  it("preflights the complete legacy tuple before staging any profile", async () => {
    const profiles = repository();
    const manifest = await legacyManifest();
    const bindCurrentPublished = vi.fn();
    const verify = vi.fn(async ({ kind }: { readonly kind: ModelCapabilityKind }) => {
      if (kind === "reasoning") {
        throw new ModelCapabilityPreflightError("MODEL_PREFLIGHT_FAILED", "reasoning is offline", {
          retryable: true,
        });
      }
      return capability(kind);
    });

    await expect(
      ensureLegacyPublishedProfileTuple({
        createdBySubjectId: "user:owner",
        knowledgeSpaceId: SPACE_ID,
        manifest,
        modelCapabilityPreflight: { verify } as ModelCapabilityPreflight,
        now: () => NOW,
        profilePublicationBindings: { bindCurrentPublished },
        profiles,
        tenantId: TENANT_ID,
      }),
    ).rejects.toMatchObject({ code: "MODEL_PREFLIGHT_FAILED" });

    await expect(
      profiles.getHead({ kind: "embedding", knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toBeNull();
    await expect(
      profiles.getHead({ kind: "retrieval", knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toBeNull();
    expect(bindCurrentPublished).not.toHaveBeenCalled();
  });

  it("preserves legacy revisions, records the observed dimension, and binds verified heads", async () => {
    const profiles = repository();
    const manifest = await legacyManifest();
    const bindCurrentPublished = vi.fn(async () => ({}) as never);
    const verify = vi.fn(async ({ kind }: { readonly kind: ModelCapabilityKind }) =>
      capability(kind),
    );

    await ensureLegacyPublishedProfileTuple({
      createdBySubjectId: "user:owner",
      knowledgeSpaceId: SPACE_ID,
      manifest,
      modelCapabilityPreflight: { verify } as ModelCapabilityPreflight,
      now: () => NOW,
      profilePublicationBindings: { bindCurrentPublished },
      profiles,
      tenantId: TENANT_ID,
    });

    const embeddingHead = await profiles.getHead({
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });
    const retrievalHead = await profiles.getHead({
      kind: "retrieval",
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
    });
    expect(embeddingHead).toMatchObject({
      activeRevision: 4,
      profile: {
        capabilitySnapshot: { dimension: 3072, kind: "embedding" },
        dimension: 3072,
        revision: 4,
        state: "active",
      },
    });
    expect(retrievalHead).toMatchObject({
      activeRevision: 6,
      profile: {
        capabilitySnapshot: { verification: "verified" },
        revision: 6,
        state: "active",
      },
    });
    expect(verify).toHaveBeenCalledTimes(3);
    expect(bindCurrentPublished).toHaveBeenCalledWith({
      knowledgeSpaceId: SPACE_ID,
      tenantId: TENANT_ID,
      verifiedAt: NOW,
    });
  });

  it("rejects an unproven legacy vector space without leaving an active head", async () => {
    const profiles = repository();
    const manifest = await legacyManifest({
      vectorSpaceId: `embedding-space-sha256:${"f".repeat(64)}`,
    });
    const bindCurrentPublished = vi.fn();

    await expect(
      ensureLegacyPublishedProfileTuple({
        createdBySubjectId: "user:owner",
        knowledgeSpaceId: SPACE_ID,
        manifest,
        modelCapabilityPreflight: {
          verify: async ({ kind }) => capability(kind),
        },
        now: () => NOW,
        profilePublicationBindings: { bindCurrentPublished },
        profiles,
        tenantId: TENANT_ID,
      }),
    ).rejects.toMatchObject({ code: "PROFILE_PUBLICATION_BOOTSTRAP_VECTOR_SPACE_UNPROVEN" });

    await expect(
      profiles.getHead({ kind: "embedding", knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toBeNull();
    expect(bindCurrentPublished).not.toHaveBeenCalled();
  });

  it("replays a partially staged bootstrap across a later preflight timestamp", async () => {
    const profiles = repository();
    const manifest = await legacyManifest();
    let failRetrievalCandidate = true;
    const flakyProfiles = {
      ...profiles,
      createCandidate: async (input: Parameters<typeof profiles.createCandidate>[0]) => {
        if (input.kind === "retrieval" && failRetrievalCandidate) {
          failRetrievalCandidate = false;
          throw new Error("transient retrieval candidate write failure");
        }
        return profiles.createCandidate(input);
      },
    };
    let checkedAt = NOW;
    const modelCapabilityPreflight: ModelCapabilityPreflight = {
      verify: async ({ kind }) => capability(kind, checkedAt),
    };
    const bindCurrentPublished = vi.fn(async () => ({}) as never);

    await expect(
      ensureLegacyPublishedProfileTuple({
        createdBySubjectId: "user:owner",
        knowledgeSpaceId: SPACE_ID,
        manifest,
        modelCapabilityPreflight,
        now: () => NOW,
        profilePublicationBindings: { bindCurrentPublished },
        profiles: flakyProfiles,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("transient retrieval candidate write failure");
    await expect(
      profiles.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 4,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ state: "candidate" });

    checkedAt = LATER;
    await ensureLegacyPublishedProfileTuple({
      createdBySubjectId: "user:owner",
      knowledgeSpaceId: SPACE_ID,
      manifest,
      modelCapabilityPreflight,
      now: () => LATER,
      profilePublicationBindings: { bindCurrentPublished },
      profiles: flakyProfiles,
      tenantId: TENANT_ID,
    });

    await expect(
      profiles.getHead({ kind: "embedding", knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({ activeRevision: 4 });
    await expect(
      profiles.getHead({ kind: "retrieval", knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({ activeRevision: 6 });
    expect(bindCurrentPublished).toHaveBeenCalledOnce();
  });
});

function repository() {
  return createInMemoryKnowledgeSpaceProfileRepository({
    maxListLimit: 10,
    maxRevisions: 10,
  });
}

async function legacyManifest(
  embeddingOverrides: Partial<KnowledgeSpaceEmbeddingProfile> = {},
): Promise<KnowledgeSpaceManifest> {
  const embeddingProfile = {
    ...(await createKnowledgeSpaceEmbeddingProfile(EMBEDDING, 4)),
    ...embeddingOverrides,
  };
  return createDefaultKnowledgeSpaceManifest({
    createdAt: NOW,
    embeddingProfile,
    id: MANIFEST_ID,
    knowledgeSpaceId: SPACE_ID,
    retrievalProfile: createKnowledgeSpaceRetrievalProfile(
      {
        defaultMode: "deep",
        reasoningModel: REASONING,
        rerank: { enabled: true, model: RERANK },
        scoreThreshold: { enabled: true, stage: "mode-final", value: 0.4 },
        topK: 12,
      },
      6,
    ),
    tenantId: TENANT_ID,
    updatedAt: NOW,
  });
}

function capability(kind: ModelCapabilityKind, checkedAt = NOW): ModelCapabilitySnapshot {
  const selection = kind === "embedding" ? EMBEDDING : kind === "reasoning" ? REASONING : RERANK;
  return {
    capabilityDigest:
      `sha256:${kind === "embedding" ? "a" : kind === "reasoning" ? "b" : "c"}`.padEnd(
        71,
        kind === "embedding" ? "a" : kind === "reasoning" ? "b" : "c",
      ),
    checkedAt,
    ...(kind === "embedding" ? { dimension: 3072, distanceMetric: "cosine" as const } : {}),
    kind,
    pluginUniqueIdentifier: `${selection.pluginId}@install-1`,
    schemaFingerprint: `sha256:${"d".repeat(64)}`,
    selection,
  };
}
