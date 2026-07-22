import { KnowledgeSpaceManifestSchema } from "@knowledge/core";

import type {
  KnowledgeSpaceManifestRepository,
  ListKnowledgeSpaceManifestsResult,
} from "./knowledge-space-manifest-repository";
import type { KnowledgeSpaceProfileRepository } from "./knowledge-space-profile-repository";

/**
 * Compatibility view used during the manifest-to-profile-head cutover. Once a kind has an active
 * head, every runtime consumer sees that immutable snapshot; legacy manifest fields are fallback
 * only until the bounded backfill installs the first head.
 */
export function createProfileAwareKnowledgeSpaceManifestRepository({
  manifests,
  profiles,
}: {
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly profiles: KnowledgeSpaceProfileRepository;
}): KnowledgeSpaceManifestRepository {
  const overlay = async <T extends Awaited<ReturnType<KnowledgeSpaceManifestRepository["get"]>>>(
    manifest: T,
  ): Promise<T> => {
    if (!manifest) return manifest;
    const [embedding, retrieval] = await Promise.all([
      profiles.getHead({
        kind: "embedding",
        knowledgeSpaceId: manifest.knowledgeSpaceId,
        tenantId: manifest.tenantId,
      }),
      profiles.getHead({
        kind: "retrieval",
        knowledgeSpaceId: manifest.knowledgeSpaceId,
        tenantId: manifest.tenantId,
      }),
    ]);
    return KnowledgeSpaceManifestSchema.parse({
      ...manifest,
      ...(embedding ? { embeddingProfile: embedding.profile.snapshot } : {}),
      ...(retrieval ? { retrievalProfile: retrieval.profile.snapshot } : {}),
    }) as T;
  };

  return {
    create: (manifest) => manifests.create(manifest),
    ...(manifests.delete
      ? { delete: async (input) => (await manifests.delete?.(input)) ?? false }
      : {}),
    get: async (input) => overlay(await manifests.get(input)),
    list: async (input): Promise<ListKnowledgeSpaceManifestsResult> => {
      const result = await manifests.list(input);
      return {
        items: await Promise.all(result.items.map((manifest) => overlay(manifest))),
        ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      };
    },
    update: (input) => manifests.update(input),
  };
}
