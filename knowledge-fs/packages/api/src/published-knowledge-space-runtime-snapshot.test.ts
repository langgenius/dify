import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import { type DatabaseExecuteInput, buildKnowledgeSpaceVectorSpaceId } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import { knowledgeSpaceProfileSnapshotDigest } from "./knowledge-space-profile-repository";
import { createDatabasePublishedKnowledgeSpaceRuntimeSnapshotResolver } from "./published-knowledge-space-runtime-snapshot";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f01";
const PUBLICATION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2f02";
const embeddingSelection = {
  model: "embed-user",
  pluginId: "plugin-embed",
  provider: "provider-a",
};
const embeddingCapability = {
  capabilityDigest: `sha256:${"c".repeat(64)}`,
  checkedAt: "2026-07-14T12:00:00.000Z",
  dimension: 3072,
  distanceMetric: "cosine" as const,
  kind: "embedding" as const,
  pluginUniqueIdentifier: "plugin-embed:1@sha256:installed",
  schemaFingerprint: `sha256:${"d".repeat(64)}`,
  selection: embeddingSelection,
};
const embedding = {
  ...embeddingSelection,
  dimension: 3072,
  revision: 4,
  vectorSpaceId: await buildKnowledgeSpaceVectorSpaceId(embeddingSelection, 4, {
    capabilityDigest: embeddingCapability.capabilityDigest,
    dimension: embeddingCapability.dimension,
    distanceMetric: embeddingCapability.distanceMetric,
    pluginUniqueIdentifier: embeddingCapability.pluginUniqueIdentifier,
    schemaFingerprint: embeddingCapability.schemaFingerprint,
  }),
};
const retrieval = {
  defaultMode: "deep" as const,
  reasoningModel: { model: "reason", pluginId: "plugin-llm", provider: "provider-a" },
  rerank: {
    enabled: true,
    model: { model: "rerank", pluginId: "plugin-rerank", provider: "provider-a" },
  },
  revision: 7,
  scoreThreshold: { enabled: true, stage: "mode-final" as const, value: 0.3 },
  topK: 8,
};
const reasoningCapability = {
  capabilityDigest: `sha256:${"e".repeat(64)}`,
  checkedAt: "2026-07-14T12:00:00.000Z",
  kind: "reasoning" as const,
  pluginUniqueIdentifier: "plugin-llm:1@sha256:installed",
  schemaFingerprint: `sha256:${"f".repeat(64)}`,
  selection: retrieval.reasoningModel,
};
const rerankCapability = {
  capabilityDigest: `sha256:${"1".repeat(64)}`,
  checkedAt: "2026-07-14T12:00:00.000Z",
  kind: "rerank" as const,
  pluginUniqueIdentifier: "plugin-rerank:1@sha256:installed",
  schemaFingerprint: `sha256:${"2".repeat(64)}`,
  selection: retrieval.rerank.model,
};

describe("published knowledge-space runtime snapshot", () => {
  it.each(["postgres", "tidb"] as const)(
    "captures publication and profile heads in one %s statement",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const retrievalCapability = {
        reasoning: reasoningCapability,
        rerank: rerankCapability,
        verification: "verified",
      };
      const database = createSchemaDatabaseAdapter({
        executor: async (input) => {
          calls.push(input);
          return {
            rows: [
              {
                embedding_capability: embeddingCapability,
                embedding_capability_digest:
                  knowledgeSpaceProfileSnapshotDigest(embeddingCapability),
                embedding_head_revision: embedding.revision,
                embedding_snapshot: embedding,
                embedding_snapshot_digest: knowledgeSpaceProfileSnapshotDigest(embedding),
                publication_fingerprint: "sha256:publication",
                publication_head_revision: 9,
                publication_id: PUBLICATION_ID,
                publication_projection_version: 12,
                retrieval_capability: retrievalCapability,
                retrieval_capability_digest:
                  knowledgeSpaceProfileSnapshotDigest(retrievalCapability),
                retrieval_head_revision: retrieval.revision,
                retrieval_snapshot: retrieval,
                retrieval_snapshot_digest: knowledgeSpaceProfileSnapshotDigest(retrieval),
              },
            ],
            rowsAffected: 1,
          };
        },
        kind: dialect,
      });
      const readiness = { isQueryReady: vi.fn(async () => true) };
      const resolver = createDatabasePublishedKnowledgeSpaceRuntimeSnapshotResolver({
        database,
        readiness,
      });

      const snapshot = await resolver.resolve({
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-a",
      });
      await resolver.assertReady({
        knowledgeSpaceId: SPACE_ID,
        resolvedMode: "deep",
        tenantId: "tenant-a",
      });

      expect(calls).toHaveLength(1);
      const quote = dialect === "postgres" ? '"' : "`";
      expect(calls[0]?.sql).toContain("knowledge_space_profile_publication_bindings");
      expect(calls[0]?.sql).toContain(`binding.${quote}activated_at${quote} IS NOT NULL`);
      expect(calls[0]?.sql).toContain(
        `retrieval_head.${quote}profile_revision_id${quote} = binding.${quote}retrieval_profile_revision_id${quote}`,
      );
      expect(calls[0]?.sql).toContain(
        `embedding_revision.${quote}vector_space_id${quote} = binding.${quote}vector_space_id${quote}`,
      );
      expect(calls[0]?.sql).toContain("knowledge_space_profile_heads");
      expect(calls[0]?.sql).toContain("projection_set_publication_heads");
      expect(snapshot).toMatchObject({
        embeddingProfile: embedding,
        projectionSnapshot: { headRevision: 9, publicationId: PUBLICATION_ID },
        retrievalProfile: retrieval,
      });
      expect(readiness.isQueryReady).toHaveBeenCalledWith({
        knowledgeSpaceId: SPACE_ID,
        resolvedMode: "deep",
        tenantId: "tenant-a",
      });
    },
  );

  it("fails closed when a profile digest does not match its immutable snapshot", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({
        rows: [
          {
            embedding_capability: null,
            embedding_capability_digest: null,
            embedding_head_revision: null,
            embedding_snapshot: null,
            embedding_snapshot_digest: null,
            publication_fingerprint: "sha256:publication",
            publication_head_revision: 1,
            publication_id: PUBLICATION_ID,
            publication_projection_version: 1,
            retrieval_capability: {},
            retrieval_capability_digest: knowledgeSpaceProfileSnapshotDigest({}),
            retrieval_head_revision: retrieval.revision,
            retrieval_snapshot: retrieval,
            retrieval_snapshot_digest: "0".repeat(64),
          },
        ],
        rowsAffected: 1,
      }),
      kind: "postgres",
    });
    const resolver = createDatabasePublishedKnowledgeSpaceRuntimeSnapshotResolver({ database });
    await expect(
      resolver.resolve({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-a" }),
    ).rejects.toThrow("corrupt");
  });

  it("fails closed when an active profile capability was not verified", async () => {
    const unverified = {
      reasoning: reasoningCapability,
      rerank: rerankCapability,
      verification: "unverified",
    };
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({
        rows: [
          {
            embedding_capability: null,
            embedding_capability_digest: null,
            embedding_head_revision: null,
            embedding_snapshot: null,
            embedding_snapshot_digest: null,
            publication_fingerprint: "sha256:publication",
            publication_head_revision: 1,
            publication_id: PUBLICATION_ID,
            publication_projection_version: 1,
            retrieval_capability: unverified,
            retrieval_capability_digest: knowledgeSpaceProfileSnapshotDigest(unverified),
            retrieval_head_revision: retrieval.revision,
            retrieval_snapshot: retrieval,
            retrieval_snapshot_digest: knowledgeSpaceProfileSnapshotDigest(retrieval),
          },
        ],
        rowsAffected: 1,
      }),
      kind: "postgres",
    });
    const resolver = createDatabasePublishedKnowledgeSpaceRuntimeSnapshotResolver({ database });

    await expect(
      resolver.resolve({ knowledgeSpaceId: SPACE_ID, tenantId: "tenant-a" }),
    ).rejects.toMatchObject({ name: "PublishedProjectionReadUnavailableError" });
  });

  it("accepts a capability-verified legacy v1 vector space during controlled migration", async () => {
    const legacyEmbedding = {
      ...embeddingSelection,
      dimension: embeddingCapability.dimension,
      revision: 1,
      vectorSpaceId: await buildKnowledgeSpaceVectorSpaceId(embeddingSelection, 1),
    };
    const retrievalCapability = {
      reasoning: reasoningCapability,
      rerank: rerankCapability,
      verification: "verified",
    };
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({
        rows: [
          {
            embedding_capability: embeddingCapability,
            embedding_capability_digest: knowledgeSpaceProfileSnapshotDigest(embeddingCapability),
            embedding_head_revision: legacyEmbedding.revision,
            embedding_snapshot: legacyEmbedding,
            embedding_snapshot_digest: knowledgeSpaceProfileSnapshotDigest(legacyEmbedding),
            publication_fingerprint: "sha256:legacy-publication",
            publication_head_revision: 3,
            publication_id: PUBLICATION_ID,
            publication_projection_version: 2,
            retrieval_capability: retrievalCapability,
            retrieval_capability_digest: knowledgeSpaceProfileSnapshotDigest(retrievalCapability),
            retrieval_head_revision: retrieval.revision,
            retrieval_snapshot: retrieval,
            retrieval_snapshot_digest: knowledgeSpaceProfileSnapshotDigest(retrieval),
          },
        ],
        rowsAffected: 1,
      }),
      kind: "postgres",
    });

    await expect(
      createDatabasePublishedKnowledgeSpaceRuntimeSnapshotResolver({ database }).resolve({
        knowledgeSpaceId: SPACE_ID,
        tenantId: "tenant-a",
      }),
    ).resolves.toMatchObject({ embeddingProfile: legacyEmbedding });
  });
});
