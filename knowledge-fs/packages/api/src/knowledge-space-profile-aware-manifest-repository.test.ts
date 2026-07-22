import {
  createDefaultKnowledgeSpaceManifest,
  createKnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createInMemoryKnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import { createProfileAwareKnowledgeSpaceManifestRepository } from "./knowledge-space-profile-aware-manifest-repository";
import type { KnowledgeSpaceProfileRepository } from "./knowledge-space-profile-repository";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99";
const NOW = "2026-07-14T12:00:00.000Z";

describe("profile-aware manifest repository", () => {
  it("uses active profile heads and falls back to legacy manifest fields per kind", async () => {
    const manifests = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 10,
      maxManifests: 10,
    });
    const legacy = createKnowledgeSpaceRetrievalProfile({
      defaultMode: "fast",
      reasoningModel: { model: "old", pluginId: "p", provider: "v" },
      rerank: { enabled: false },
      scoreThreshold: { enabled: false, stage: "mode-final" },
      topK: 3,
    });
    const active = createKnowledgeSpaceRetrievalProfile(
      {
        defaultMode: "research",
        reasoningModel: { model: "new", pluginId: "p", provider: "v" },
        rerank: { enabled: false },
        scoreThreshold: { enabled: false, stage: "mode-final" },
        topK: 9,
      },
      2,
    );
    await manifests.create(
      createDefaultKnowledgeSpaceManifest({
        createdAt: NOW,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c98",
        knowledgeSpaceId: SPACE_ID,
        retrievalProfile: legacy,
        tenantId: "tenant-1",
        updatedAt: NOW,
      }),
    );
    const repository = createProfileAwareKnowledgeSpaceManifestRepository({
      manifests,
      profiles: profileRepository(active),
    });
    await expect(
      repository.get({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-1" }),
    ).resolves.toMatchObject({
      retrievalProfile: active,
    });
  });
});

function profileRepository(
  active: ReturnType<typeof createKnowledgeSpaceRetrievalProfile>,
): KnowledgeSpaceProfileRepository {
  return {
    activateCandidate: async () => {
      throw new Error("not used");
    },
    createCandidate: async () => {
      throw new Error("not used");
    },
    failCandidate: async () => {
      throw new Error("not used");
    },
    getHead: async (input) =>
      input.kind === "retrieval"
        ? {
            activeRevision: active.revision,
            createdAt: NOW,
            id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c90",
            kind: "retrieval",
            knowledgeSpaceId: SPACE_ID,
            profile: {
              capabilitySnapshot: {},
              capabilitySnapshotDigest: "a".repeat(64),
              createdAt: NOW,
              createdBySubjectId: "user-1",
              id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c91",
              kind: "retrieval",
              knowledgeSpaceId: SPACE_ID,
              model: active.reasoningModel.model,
              pluginId: active.reasoningModel.pluginId,
              provider: active.reasoningModel.provider,
              revision: active.revision,
              snapshot: active,
              snapshotDigest: "b".repeat(64),
              state: "active",
              tenantId: "tenant-1",
              updatedAt: NOW,
            },
            profileRevisionId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c91",
            rowVersion: 1,
            tenantId: "tenant-1",
            updatedAt: NOW,
          }
        : null,
    getRevision: async () => null,
    listRevisions: async () => ({ items: [] }),
  };
}
