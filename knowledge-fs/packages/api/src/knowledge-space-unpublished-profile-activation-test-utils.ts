import {
  KnowledgeSpaceEmbeddingProfileSchema,
  KnowledgeSpaceRetrievalProfileSchema,
} from "@knowledge/core";

import type { KnowledgeSpaceManifestRepository } from "./knowledge-space-manifest-repository";
import {
  type KnowledgeSpaceProfileRepository,
  KnowledgeSpaceUnpublishedProfileActivationError,
  type KnowledgeSpaceUnpublishedProfileActivationRepository,
  knowledgeSpaceProfileSnapshotDigest,
} from "./knowledge-space-profile-repository";

/**
 * Keeps the manifest and immutable profile repositories aligned in handler tests. All deterministic
 * conflict checks happen before either repository is mutated; production code uses the database
 * implementation to provide the real transaction and durable permission fence.
 */
export function createTestUnpublishedProfileActivations(
  manifests: KnowledgeSpaceManifestRepository,
  profiles: KnowledgeSpaceProfileRepository,
): KnowledgeSpaceUnpublishedProfileActivationRepository {
  return {
    activate: async (input) => {
      const currentManifest = await manifests.get(input);
      if (!currentManifest) {
        throw new KnowledgeSpaceUnpublishedProfileActivationError(
          "KNOWLEDGE_SPACE_MANIFEST_NOT_FOUND",
          "Knowledge-space manifest was not found",
        );
      }
      const currentSnapshot =
        input.kind === "embedding"
          ? currentManifest.embeddingProfile
          : currentManifest.retrievalProfile;
      const currentRevision = currentSnapshot?.revision ?? 0;
      const snapshotDigest = knowledgeSpaceProfileSnapshotDigest(input.snapshot);
      const manifestAlreadyTargetsSnapshot =
        currentSnapshot !== undefined &&
        knowledgeSpaceProfileSnapshotDigest(currentSnapshot) === snapshotDigest;
      if (
        !manifestAlreadyTargetsSnapshot &&
        (currentManifest.manifestVersion !== input.expectedManifestVersion ||
          currentRevision !== input.expectedManifestProfileRevision ||
          input.snapshot.revision !== currentRevision + 1)
      ) {
        throw new KnowledgeSpaceUnpublishedProfileActivationError(
          "KNOWLEDGE_SPACE_PROFILE_MANIFEST_CONFLICT",
          `Knowledge-space profile manifest conflict: expected manifest=${input.expectedManifestVersion}/profile=${input.expectedManifestProfileRevision}, actual manifest=${currentManifest.manifestVersion}/profile=${currentRevision}`,
        );
      }

      const currentHead = await profiles.getHead(input);
      if (
        (currentSnapshot === undefined && currentHead !== null) ||
        (currentSnapshot !== undefined &&
          (currentHead === null ||
            currentHead.activeRevision !== currentRevision ||
            currentHead.profile.snapshotDigest !==
              knowledgeSpaceProfileSnapshotDigest(currentSnapshot)))
      ) {
        throw new KnowledgeSpaceUnpublishedProfileActivationError(
          "KNOWLEDGE_SPACE_PROFILE_HEAD_INVALID",
          "Knowledge-space manifest and active profile head are inconsistent",
        );
      }

      if (manifestAlreadyTargetsSnapshot) {
        if (!currentHead) {
          throw new Error("Validated profile head unexpectedly disappeared");
        }
        return {
          head: currentHead,
          manifestVersion: currentManifest.manifestVersion,
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
      const updatedManifest = await manifests.update({
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
      if (!updatedManifest) {
        throw new Error("Prevalidated test manifest CAS unexpectedly failed");
      }
      return {
        head,
        manifestVersion: updatedManifest.manifestVersion,
        replayed: false,
        snapshot: input.snapshot,
      };
    },
    activateInitialTuple: async () => {
      throw new Error("Initial tuple activation is not exercised by handler test repositories");
    },
  };
}
