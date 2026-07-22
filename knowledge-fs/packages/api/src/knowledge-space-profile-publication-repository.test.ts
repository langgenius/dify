import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeSpaceProfilePublicationHeadConflictError,
  KnowledgeSpaceProfilePublicationTransitionError,
  createDatabaseKnowledgeSpaceProfilePublicationRepository,
  mapKnowledgeSpaceProfilePublicationBindingRow,
} from "./knowledge-space-profile-publication-repository";
import { knowledgeSpaceProfileSnapshotDigest } from "./knowledge-space-profile-repository";

const tenantId = "tenant-profile-publication";
const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const oldPublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const candidatePublicationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const oldEmbeddingId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const candidateEmbeddingId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const retrievalId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const bindingId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const outlineId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const documentAssetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
const outlineGenerationId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49";
const pageIndexManifestId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4a";
const migrationRunId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4b";
const apiKeyId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4c";
const accessPolicyId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c4d";
const oldFingerprint = `projection-set-sha256:${"a".repeat(64)}`;
const candidateFingerprint = `projection-set-sha256:${"b".repeat(64)}`;
const now = "2026-07-14T14:00:00.000Z";

function migrationFence() {
  return {
    expectedRowVersion: 9,
    leaseToken: "lease-token",
    now,
    runId: migrationRunId,
  };
}

function embedding(revision: number, marker: string): KnowledgeSpaceEmbeddingProfile {
  return {
    dimension: 3072,
    model: `embedding-${marker}`,
    pluginId: `plugin-${marker}`,
    provider: "provider",
    revision,
    vectorSpaceId: `embedding-space-sha256:${marker.repeat(64)}`,
  };
}

function retrieval(revision = 1): KnowledgeSpaceRetrievalProfile {
  return {
    defaultMode: "research",
    reasoningModel: { model: "reasoning", pluginId: "plugin-reason", provider: "provider" },
    rerank: { enabled: false },
    revision,
    scoreThreshold: { enabled: false, stage: "mode-final" },
    topK: 12,
  };
}

function profileRow(
  kind: "embedding" | "retrieval",
  revision: number,
  state: "active" | "candidate",
): Record<string, unknown> {
  if (kind === "embedding") {
    const snapshot = embedding(revision, revision === 1 ? "a" : "b");
    const capabilitySnapshot = capability("embedding", snapshot, snapshot.dimension);
    return {
      capability_snapshot: capabilitySnapshot,
      capability_snapshot_digest: knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot),
      id: revision === 1 ? oldEmbeddingId : candidateEmbeddingId,
      kind,
      knowledge_space_id: spaceId,
      revision,
      snapshot,
      snapshot_digest: knowledgeSpaceProfileSnapshotDigest(snapshot),
      state,
      tenant_id: tenantId,
      vector_space_id: snapshot.vectorSpaceId,
    };
  }
  const snapshot = retrieval(revision);
  const capabilitySnapshot = {
    reasoning: capability("reasoning", snapshot.reasoningModel),
    rerank: null,
    verification: "verified",
  };
  return {
    capability_snapshot: capabilitySnapshot,
    capability_snapshot_digest: knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot),
    id: retrievalId,
    kind,
    knowledge_space_id: spaceId,
    revision,
    snapshot,
    snapshot_digest: knowledgeSpaceProfileSnapshotDigest(snapshot),
    state,
    tenant_id: tenantId,
    vector_space_id: null,
  };
}

function capability(
  kind: "embedding" | "reasoning" | "rerank",
  selection: { readonly model: string; readonly pluginId: string; readonly provider: string },
  dimension?: number,
) {
  return {
    capabilityDigest: `sha256:${"c".repeat(64)}`,
    checkedAt: now,
    ...(dimension === undefined ? {} : { dimension }),
    ...(kind === "embedding" ? { distanceMetric: "cosine" as const } : {}),
    kind,
    pluginUniqueIdentifier: `installed:${selection.pluginId}`,
    schemaFingerprint: `sha256:${"d".repeat(64)}`,
    selection: {
      model: selection.model,
      pluginId: selection.pluginId,
      provider: selection.provider,
    },
  };
}

function publicationRow(
  id: string,
  fingerprint: string,
  status: "published" | "validating",
): Record<string, unknown> {
  return { fingerprint, id, knowledge_space_id: spaceId, status, tenant_id: tenantId };
}

function bindingRow(options: { activated?: boolean; researchOnly?: boolean } = {}) {
  const candidate = profileRow("embedding", 2, "candidate");
  const retrievalProfile = profileRow("retrieval", 1, "active");
  return {
    activated_at: options.activated ? now : null,
    binding_reason: options.activated ? "legacy-bootstrap" : "candidate-switch",
    changed_kind: options.activated ? "bootstrap" : "embedding",
    created_at: now,
    embedding_profile_revision: options.researchOnly ? null : 2,
    embedding_profile_revision_id: options.researchOnly ? null : candidate.id,
    embedding_profile_snapshot_digest: options.researchOnly ? null : candidate.snapshot_digest,
    embedding_profile_kind: options.researchOnly ? null : "embedding",
    id: bindingId,
    knowledge_space_id: spaceId,
    publication_fingerprint: options.activated ? oldFingerprint : candidateFingerprint,
    publication_id: options.activated ? oldPublicationId : candidatePublicationId,
    retrieval_profile_revision: 1,
    retrieval_profile_revision_id: retrievalProfile.id,
    retrieval_profile_snapshot_digest: retrievalProfile.snapshot_digest,
    retrieval_profile_kind: "retrieval",
    tenant_id: tenantId,
    vector_space_id: options.researchOnly ? null : candidate.vector_space_id,
  };
}

function currentLegacyBindingRow(activatedAt = "2026-07-13T14:00:00.000Z") {
  const embeddingProfile = profileRow("embedding", 1, "active");
  const retrievalProfile = profileRow("retrieval", 1, "active");
  return {
    ...bindingRow({ activated: true }),
    activated_at: activatedAt,
    created_at: activatedAt,
    embedding_profile_revision: 1,
    embedding_profile_revision_id: embeddingProfile.id,
    embedding_profile_snapshot_digest: embeddingProfile.snapshot_digest,
    vector_space_id: embeddingProfile.vector_space_id,
    retrieval_profile_revision_id: retrievalProfile.id,
    retrieval_profile_snapshot_digest: retrievalProfile.snapshot_digest,
  };
}

function retrievalCandidateBindingRow() {
  const embeddingProfile = profileRow("embedding", 1, "active");
  const retrievalProfile = profileRow("retrieval", 2, "candidate");
  return {
    ...bindingRow(),
    changed_kind: "retrieval",
    embedding_profile_revision: 1,
    embedding_profile_revision_id: embeddingProfile.id,
    embedding_profile_snapshot_digest: embeddingProfile.snapshot_digest,
    retrieval_profile_revision: 2,
    retrieval_profile_revision_id: retrievalProfile.id,
    retrieval_profile_snapshot_digest: retrievalProfile.snapshot_digest,
    vector_space_id: embeddingProfile.vector_space_id,
  };
}

describe.each(["postgres", "tidb"] as const)(
  "profile/publication tuple repository (%s)",
  (dialect) => {
    it("binds a candidate to the complete profile tuple using dialect-correct SQL", async () => {
      const fake = fakeDatabase(dialect);
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
        generateBindingId: () => bindingId,
      });

      const binding = await repository.bindCandidate({
        changedKind: "embedding",
        createdAt: now,
        knowledgeSpaceId: spaceId,
        profileRevision: 2,
        publicationFingerprint: candidateFingerprint,
        tenantId,
      });

      expect(binding.embeddingProfile?.revision).toBe(2);
      expect(binding.retrievalProfile.revision).toBe(1);
      expect(binding.vectorSpaceId).toBe(embedding(2, "b").vectorSpaceId);
      const insert = fake.calls.find(
        (call) =>
          call.input.tableName === "knowledge_space_profile_publication_bindings" &&
          call.input.operation === "insert",
      );
      expect(insert?.lane).toBe("transaction");
      expect(insert?.input.sql).toContain(
        dialect === "postgres" ? "VALUES ($1, $2" : "VALUES (?, ?",
      );
      expect(insert?.input.params).not.toContain(1536);
    });

    it("jointly advances the profile and publication heads after vector-space proof", async () => {
      const fake = fakeDatabase(dialect, { binding: bindingRow() });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });

      const result = await repository.activateCandidate({
        changedKind: "embedding",
        expectedProfileHeadRevision: 1,
        expectedPublicationHeadRevision: 4,
        knowledgeSpaceId: spaceId,
        migrationFence: migrationFence(),
        profileRevision: 2,
        publicationFingerprint: candidateFingerprint,
        tenantId,
        updatedAt: now,
      });

      expect(result).toMatchObject({ profileHeadRevision: 2, publicationHeadRevision: 5 });
      expect(fake.committedMutations()).toBe(10);
      expect(
        fake.calls
          .filter((call) => call.input.operation !== "select")
          .every((call) => call.lane === "transaction"),
      ).toBe(true);
      const vectorChecks = fake.calls.filter(
        (call) => call.input.tableName === "index_projections",
      );
      expect(vectorChecks).toHaveLength(2);
      expect(
        vectorChecks.every((call) => call.input.params[3] === embedding(2, "b").vectorSpaceId),
      ).toBe(true);
      expect(
        fake.calls.some(
          (call) =>
            call.input.tableName === "page_index_manifests" && call.input.operation === "update",
        ),
      ).toBe(true);
    });

    it("rejects a runtime caller that omits the durable migration fence", async () => {
      const fake = fakeDatabase(dialect, { binding: bindingRow() });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });

      await expect(
        repository.activateCandidate({
          changedKind: "embedding",
          expectedProfileHeadRevision: 1,
          expectedPublicationHeadRevision: 4,
          knowledgeSpaceId: spaceId,
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        } as unknown as Parameters<typeof repository.activateCandidate>[0]),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_MIGRATION_FENCE_REQUIRED",
      });
      expect(fake.calls).toHaveLength(0);
    });

    it("accepts the vacuous PageIndex closure when the candidate has no outlines", async () => {
      const fake = fakeDatabase(dialect, { binding: bindingRow(), noOutlineMembers: true });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });

      await expect(
        repository.activateCandidate({
          changedKind: "embedding",
          expectedProfileHeadRevision: 1,
          expectedPublicationHeadRevision: 4,
          knowledgeSpaceId: spaceId,
          migrationFence: migrationFence(),
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        }),
      ).resolves.toMatchObject({ publicationHeadRevision: 5 });
      expect(fake.calls.some((call) => call.input.tableName === "page_index_manifests")).toBe(
        false,
      );
    });

    it("rolls every prior mutation back when the final binding fence fails", async () => {
      const fake = fakeDatabase(dialect, { binding: bindingRow(), failBindingActivation: true });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });

      await expect(
        repository.activateCandidate({
          changedKind: "embedding",
          expectedProfileHeadRevision: 1,
          expectedPublicationHeadRevision: 4,
          knowledgeSpaceId: spaceId,
          migrationFence: migrationFence(),
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceProfilePublicationTransitionError);
      expect(fake.committedMutations()).toBe(0);
      expect(fake.rollbacks()).toBe(1);
    });

    it("rolls PageIndex promotion back when the final migration outbox fence is lost", async () => {
      const fake = fakeDatabase(dialect, {
        binding: bindingRow(),
        failMigrationOutboxCompletion: true,
      });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });

      await expect(
        repository.activateCandidate({
          changedKind: "embedding",
          expectedProfileHeadRevision: 1,
          expectedPublicationHeadRevision: 4,
          knowledgeSpaceId: spaceId,
          migrationFence: {
            expectedRowVersion: 9,
            leaseToken: "lease-token",
            now,
            runId: migrationRunId,
          },
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_MIGRATION_OUTBOX_FENCE_LOST",
      });
      expect(fake.committedMutations()).toBe(0);
      expect(fake.rollbacks()).toBe(1);
      expect(
        fake.calls.some(
          (call) =>
            call.input.tableName === "page_index_manifests" && call.input.operation === "update",
        ),
      ).toBe(true);
    });

    it("fails closed across late migration, vector, and PageIndex fences", async () => {
      const input = {
        changedKind: "embedding" as const,
        expectedProfileHeadRevision: 1,
        expectedPublicationHeadRevision: 4,
        knowledgeSpaceId: spaceId,
        migrationFence: migrationFence(),
        profileRevision: 2,
        publicationFingerprint: candidateFingerprint,
        tenantId,
        updatedAt: now,
      };
      for (const [options, code] of [
        [{ missingMigrationFence: true }, "KNOWLEDGE_SPACE_PROFILE_MIGRATION_FENCE_LOST"],
        [{ invalidApiKeyProvenance: true }, "KNOWLEDGE_SPACE_PROFILE_MIGRATION_PERMISSION_INVALID"],
        [
          { vectorMissingConflict: true },
          "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_VECTOR_SPACE_CONFLICT",
        ],
        [{ outlineMemberOverflow: true }, "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PAGE_INDEX_INVALID"],
        [
          { missingPageIndexManifest: true },
          "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PAGE_INDEX_INVALID",
        ],
        [
          { invalidPageIndexManifest: true },
          "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PAGE_INDEX_INVALID",
        ],
        [
          { failPageIndexPromotion: true },
          "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PAGE_INDEX_INVALID",
        ],
        [{ failMigrationRunCompletion: true }, "KNOWLEDGE_SPACE_PROFILE_MIGRATION_FENCE_LOST"],
      ] as const) {
        const fake = fakeDatabase(dialect, { ...options, binding: bindingRow() });
        const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fake.database,
        });
        await expect(repository.activateCandidate(input)).rejects.toMatchObject({ code });
        expect(fake.committedMutations()).toBe(0);
      }
    });

    it("locks and revalidates permission, API-key, and partial-member provenance in the joint CAS", async () => {
      const fake = fakeDatabase(dialect, {
        apiKeyPermission: true,
        binding: bindingRow(),
        partialMemberPermission: true,
      });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      await expect(
        repository.activateCandidate({
          changedKind: "embedding",
          expectedProfileHeadRevision: 1,
          expectedPublicationHeadRevision: 4,
          knowledgeSpaceId: spaceId,
          migrationFence: {
            expectedRowVersion: 9,
            leaseToken: "lease-token",
            now,
            runId: migrationRunId,
          },
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        }),
      ).resolves.toMatchObject({ migrationRunCompleted: true });
      const permissionProbe = fake.calls.find(
        (call) =>
          call.input.tableName === "knowledge_space_profile_migration_runs" &&
          call.input.operation === "select",
      );
      expect(permissionProbe?.input.sql).toContain("knowledge_space_permission_snapshots");
      expect(permissionProbe?.input.sql).toContain("knowledge_space_members");
      expect(permissionProbe?.input.sql).toContain("knowledge_space_access_policies");
      expect(permissionProbe?.input.sql).toContain("knowledge_space_api_access");
      expect(permissionProbe?.input.sql).toContain("FOR UPDATE");
      const apiKeyProbe = fake.calls.find(
        (call) => call.input.tableName === "knowledge_space_api_keys",
      );
      expect(apiKeyProbe?.input.params).toEqual([
        tenantId,
        spaceId,
        apiKeyId,
        7,
        "owner-1",
        "2027-01-01T00:00:00.000Z",
        now,
      ]);
      expect(apiKeyProbe?.input.sql).toContain("FOR UPDATE");
      expect(
        fake.calls.find((call) => call.input.tableName === "knowledge_space_access_policy_members")
          ?.input.sql,
      ).toContain("FOR UPDATE");
    });

    it("rolls back activation when atomic API-key or partial-member revalidation loses", async () => {
      for (const failure of ["api-key", "partial-member"] as const) {
        const fake = fakeDatabase(dialect, {
          ...(failure === "api-key"
            ? { apiKeyPermission: true, revokedApiKeyPermission: true }
            : { missingPartialMemberTarget: true, partialMemberPermission: true }),
          binding: bindingRow(),
        });
        const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fake.database,
        });
        await expect(
          repository.activateCandidate({
            changedKind: "embedding",
            expectedProfileHeadRevision: 1,
            expectedPublicationHeadRevision: 4,
            knowledgeSpaceId: spaceId,
            migrationFence: {
              expectedRowVersion: 9,
              leaseToken: "lease-token",
              now,
              runId: migrationRunId,
            },
            profileRevision: 2,
            publicationFingerprint: candidateFingerprint,
            tenantId,
            updatedAt: now,
          }),
        ).rejects.toMatchObject({
          code: "KNOWLEDGE_SPACE_PROFILE_MIGRATION_PERMISSION_INVALID",
        });
        expect(fake.committedMutations()).toBe(0);
      }
    });

    it("rejects an embedding publication with mixed vector-space members before mutation", async () => {
      const fake = fakeDatabase(dialect, { binding: bindingRow(), vectorConflict: true });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      await expect(
        repository.activateCandidate({
          changedKind: "embedding",
          expectedProfileHeadRevision: 1,
          expectedPublicationHeadRevision: 4,
          knowledgeSpaceId: spaceId,
          migrationFence: migrationFence(),
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_VECTOR_SPACE_CONFLICT",
      });
      expect(fake.committedMutations()).toBe(0);
    });

    it("does not allow a second tuple to replace a publication's immutable binding", async () => {
      const conflicting = { ...bindingRow(), embedding_profile_revision: 1 };
      const fake = fakeDatabase(dialect, { binding: conflicting });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      await expect(
        repository.bindCandidate({
          changedKind: "embedding",
          createdAt: now,
          knowledgeSpaceId: spaceId,
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_CONFLICT" });
    });

    it("rejects an unverified companion capability snapshot", async () => {
      const fake = fakeDatabase(dialect, { unverifiedRetrieval: true });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      await expect(
        repository.bindCandidate({
          changedKind: "embedding",
          createdAt: now,
          knowledgeSpaceId: spaceId,
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
        }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_CAPABILITY_UNVERIFIED",
      });
    });

    it("accepts an exactly verified enabled rerank companion", async () => {
      const fake = fakeDatabase(dialect, { rerankEnabled: true });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
        generateBindingId: () => bindingId,
      });
      await expect(
        repository.bindCandidate({
          changedKind: "embedding",
          createdAt: now,
          knowledgeSpaceId: spaceId,
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
        }),
      ).resolves.toMatchObject({ retrievalProfile: { revision: 1 } });
    });

    it("rejects stale publication CAS before issuing any mutation", async () => {
      const fake = fakeDatabase(dialect, { binding: bindingRow() });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      await expect(
        repository.activateCandidate({
          changedKind: "embedding",
          expectedProfileHeadRevision: 1,
          expectedPublicationHeadRevision: 3,
          knowledgeSpaceId: spaceId,
          migrationFence: migrationFence(),
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceProfilePublicationHeadConflictError);
      expect(fake.committedMutations()).toBe(0);
    });

    it("bootstraps a Research-only published tuple without inventing an embedding vector space", async () => {
      const fake = fakeDatabase(dialect, { noEmbeddingHead: true });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
        generateBindingId: () => bindingId,
      });
      const binding = await repository.bindExistingPublished({
        embeddingProfileRevision: null,
        expectedPublicationHeadRevision: 4,
        knowledgeSpaceId: spaceId,
        publicationFingerprint: oldFingerprint,
        retrievalProfileRevision: 1,
        tenantId,
        verifiedAt: now,
      });
      expect(binding).toMatchObject({
        bindingReason: "legacy-bootstrap",
        changedKind: "bootstrap",
      });
      expect(binding.embeddingProfile).toBeUndefined();
      expect(binding.vectorSpaceId).toBeUndefined();
      expect(fake.calls.some((call) => call.input.tableName === "index_projections")).toBe(false);
    });

    it("bootstraps and reuses an embedding-backed legacy tuple", async () => {
      const fake = fakeDatabase(dialect);
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
        generateBindingId: () => bindingId,
      });
      await expect(
        repository.bindExistingPublished({
          embeddingProfileRevision: 1,
          expectedPublicationHeadRevision: 4,
          knowledgeSpaceId: spaceId,
          publicationFingerprint: oldFingerprint,
          retrievalProfileRevision: 1,
          tenantId,
          verifiedAt: now,
        }),
      ).resolves.toMatchObject({
        activatedAt: now,
        bindingReason: "legacy-bootstrap",
        embeddingProfile: { revision: 1 },
        vectorSpaceId: embedding(1, "a").vectorSpaceId,
      });
      expect(
        fake.calls.filter((call) => call.input.tableName === "index_projections"),
      ).toHaveLength(2);

      const existing = fakeDatabase(dialect, { binding: currentLegacyBindingRow() });
      const existingRepository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: existing.database,
      });
      await expect(
        existingRepository.bindExistingPublished({
          embeddingProfileRevision: 1,
          expectedPublicationHeadRevision: 4,
          knowledgeSpaceId: spaceId,
          publicationFingerprint: oldFingerprint,
          retrievalProfileRevision: 1,
          tenantId,
          verifiedAt: now,
        }),
      ).resolves.toMatchObject({ id: bindingId, publicationId: oldPublicationId });
      expect(existing.committedMutations()).toBe(0);
    });

    it("binds retrieval candidates against the exact active embedding companion", async () => {
      const fake = fakeDatabase(dialect, { candidateRetrieval: true });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
        generateBindingId: () => bindingId,
      });
      await expect(
        repository.bindCandidate({
          changedKind: "retrieval",
          createdAt: now,
          knowledgeSpaceId: spaceId,
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
        }),
      ).resolves.toMatchObject({
        changedKind: "retrieval",
        embeddingProfile: { revision: 1 },
        retrievalProfile: { revision: 2 },
      });
    });

    it("creates both mutable heads when activating the first embedding publication", async () => {
      const fake = fakeDatabase(dialect, {
        binding: bindingRow(),
        noEmbeddingHead: true,
        noPublicationHead: true,
      });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
        generateProfileHeadId: () => outlineId,
        generatePublicationHeadId: () => pageIndexManifestId,
      });
      await expect(
        repository.activateCandidate({
          changedKind: "embedding",
          expectedProfileHeadRevision: null,
          expectedPublicationHeadRevision: 0,
          knowledgeSpaceId: spaceId,
          migrationFence: migrationFence(),
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        }),
      ).resolves.toMatchObject({
        profileHeadRevision: 2,
        profileHeadRowVersion: 1,
        publicationHeadRevision: 1,
      });
      expect(
        fake.calls.some(
          (call) =>
            call.input.tableName === "knowledge_space_profile_heads" &&
            call.input.operation === "insert",
        ),
      ).toBe(true);
      expect(
        fake.calls.some(
          (call) =>
            call.input.tableName === "projection_set_publication_heads" &&
            call.input.operation === "insert",
        ),
      ).toBe(true);
    });

    it("jointly activates a retrieval candidate against its embedding companion", async () => {
      const fake = fakeDatabase(dialect, {
        binding: retrievalCandidateBindingRow(),
        candidateRetrieval: true,
      });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      await expect(
        repository.activateCandidate({
          changedKind: "retrieval",
          expectedProfileHeadRevision: 1,
          expectedPublicationHeadRevision: 4,
          knowledgeSpaceId: spaceId,
          migrationFence: migrationFence(),
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        }),
      ).resolves.toMatchObject({
        binding: { changedKind: "retrieval", retrievalProfile: { revision: 2 } },
        profileHeadRevision: 2,
        publicationHeadRevision: 5,
      });
    });

    it("jointly activates an explicit Research-only retrieval candidate", async () => {
      const researchBinding = {
        ...retrievalCandidateBindingRow(),
        embedding_profile_kind: null,
        embedding_profile_revision: null,
        embedding_profile_revision_id: null,
        embedding_profile_snapshot_digest: null,
        vector_space_id: null,
      };
      const fake = fakeDatabase(dialect, {
        binding: researchBinding,
        candidateRetrieval: true,
        noEmbeddingHead: true,
        noOutlineMembers: true,
      });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      const activated = await repository.activateCandidate({
        changedKind: "retrieval",
        expectedProfileHeadRevision: 1,
        expectedPublicationHeadRevision: 4,
        knowledgeSpaceId: spaceId,
        migrationFence: migrationFence(),
        profileRevision: 2,
        publicationFingerprint: candidateFingerprint,
        tenantId,
        updatedAt: now,
      });
      expect(activated).toMatchObject({
        binding: { changedKind: "retrieval" },
        migrationRunCompleted: true,
      });
      expect(activated.binding.embeddingProfile).toBeUndefined();
    });

    it("fails closed on legacy bootstrap head, publication, and binding drift", async () => {
      const input = {
        embeddingProfileRevision: 1,
        expectedPublicationHeadRevision: 4,
        knowledgeSpaceId: spaceId,
        publicationFingerprint: oldFingerprint,
        retrievalProfileRevision: 1,
        tenantId,
        verifiedAt: now,
      } as const;

      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect).database,
        }).bindExistingPublished({ ...input, expectedPublicationHeadRevision: 3 }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceProfilePublicationHeadConflictError);

      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { oldPublicationStatus: "validating" }).database,
        }).bindExistingPublished(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_INVALID" });

      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect).database,
        }).bindExistingPublished({ ...input, embeddingProfileRevision: 2 }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_CONFLICT",
      });

      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect).database,
        }).bindExistingPublished({ ...input, retrievalProfileRevision: 2 }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_CONFLICT",
      });

      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { noEmbeddingHead: true }).database,
        }).bindExistingPublished(input),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_CONFLICT",
      });

      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { noRetrievalHead: true }).database,
        }).bindExistingPublished(input),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_CONFLICT",
      });

      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { invalidRetrievalCompanion: true }).database,
        }).bindExistingPublished(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_STATE_CONFLICT" });

      const inactive = { ...currentLegacyBindingRow(), activated_at: null };
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { binding: inactive }).database,
        }).bindExistingPublished(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_NOT_ACTIVE" });
    });

    it("rejects candidate companion and publication state drift", async () => {
      const embeddingInput = {
        changedKind: "embedding" as const,
        createdAt: now,
        knowledgeSpaceId: spaceId,
        profileRevision: 2,
        publicationFingerprint: candidateFingerprint,
        tenantId,
      };
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { noRetrievalHead: true }).database,
        }).bindCandidate(embeddingInput),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_RETRIEVAL_PROFILE_REQUIRED",
      });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { invalidRetrievalCompanion: true }).database,
        }).bindCandidate(embeddingInput),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_COMPANION_PROFILE_INVALID",
      });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { candidatePublicationStatus: "published" }).database,
        }).bindCandidate(embeddingInput),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_NOT_CANDIDATE" });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, {
            candidateRetrieval: true,
            invalidEmbeddingCompanion: true,
          }).database,
        }).bindCandidate({ ...embeddingInput, changedKind: "retrieval", profileRevision: 2 }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_COMPANION_PROFILE_INVALID",
      });
    });

    it("binds an explicit Research-only retrieval candidate without a vector space", async () => {
      const fake = fakeDatabase(dialect, {
        candidateRetrieval: true,
        noEmbeddingHead: true,
      });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
        generateBindingId: () => bindingId,
      });
      await expect(
        repository.bindCandidate({
          changedKind: "retrieval",
          createdAt: now,
          knowledgeSpaceId: spaceId,
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
        }),
      ).resolves.toMatchObject({
        changedKind: "retrieval",
        retrievalProfile: { revision: 2 },
      });
      const inserted = fake.calls.find(
        (call) =>
          call.input.tableName === "knowledge_space_profile_publication_bindings" &&
          call.input.operation === "insert",
      );
      expect(inserted?.input.params.slice(5, 9)).toEqual([null, null, null, null]);
      expect(inserted?.input.params[13]).toBeNull();
    });

    it("rejects corrupt immutable profile and publication rows before binding", async () => {
      const input = {
        changedKind: "embedding" as const,
        createdAt: now,
        knowledgeSpaceId: spaceId,
        profileRevision: 2,
        publicationFingerprint: candidateFingerprint,
        tenantId,
      };
      for (const [options, code] of [
        [{ activeDeletion: true }, "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_SPACE_NOT_WRITABLE"],
        [{ missingProfile: true }, "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_NOT_FOUND"],
        [
          { headProfileIdMismatch: true },
          "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_INVALID",
        ],
        [{ profileFault: "scope" }, "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_CORRUPT"],
        [
          { profileFault: "snapshot-digest" },
          "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_CORRUPT",
        ],
        [
          { profileFault: "capability-digest" },
          "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_CAPABILITY_CORRUPT",
        ],
        [{ profileFault: "revision" }, "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_CORRUPT"],
        [{ profileFault: "vector-space" }, "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_CORRUPT"],
        [
          { unverifiedEmbedding: true },
          "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_CAPABILITY_UNVERIFIED",
        ],
        [{ missingPublication: true }, "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_NOT_FOUND"],
        [{ shortBindingInsert: true }, "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_CONFLICT"],
      ] as const) {
        const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, options).database,
          generateBindingId: () => bindingId,
        });
        await expect(repository.bindCandidate(input)).rejects.toMatchObject({ code });
      }

      const missingManifest = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fakeDatabase(dialect, {
          candidateRetrieval: true,
          missingManifest: true,
          noEmbeddingHead: true,
        }).database,
      });
      await expect(
        missingManifest.bindCandidate({ ...input, changedKind: "retrieval" }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_MANIFEST_MISSING" });
    });

    it("validates profile publication identities and counters before I/O", async () => {
      const fake = fakeDatabase(dialect);
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
        generateBindingId: () => "00000000-0000-0000-0000-000000000000",
      });
      const input = {
        changedKind: "embedding" as const,
        createdAt: now,
        knowledgeSpaceId: spaceId,
        profileRevision: 2,
        publicationFingerprint: candidateFingerprint,
        tenantId,
      };
      await expect(repository.bindCandidate(input)).rejects.toThrow("bindingId must not be zero");
      await expect(
        repository.bindCandidate({ ...input, changedKind: "invalid" as never }),
      ).rejects.toThrow("Invalid profile kind");
      await expect(repository.bindCandidate({ ...input, profileRevision: 0 })).rejects.toThrow(
        "profileRevision must be positive",
      );
      await expect(
        repository.activateCandidate({
          changedKind: "embedding",
          expectedProfileHeadRevision: 1,
          expectedPublicationHeadRevision: -1,
          knowledgeSpaceId: spaceId,
          migrationFence: migrationFence(),
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        }),
      ).rejects.toThrow("expectedPublicationHeadRevision must be non-negative");
      await expect(
        repository.activateCandidate({
          changedKind: "embedding",
          expectedProfileHeadRevision: 1,
          expectedPublicationHeadRevision: 4,
          knowledgeSpaceId: spaceId,
          migrationFence: { ...migrationFence(), leaseToken: " " },
          profileRevision: 2,
          publicationFingerprint: candidateFingerprint,
          tenantId,
          updatedAt: now,
        }),
      ).rejects.toThrow("migrationFence.leaseToken must not be empty");
    });

    it("rejects activation drift before mutable-head writes", async () => {
      const input = {
        changedKind: "embedding" as const,
        expectedProfileHeadRevision: 1,
        expectedPublicationHeadRevision: 4,
        knowledgeSpaceId: spaceId,
        migrationFence: migrationFence(),
        profileRevision: 2,
        publicationFingerprint: candidateFingerprint,
        tenantId,
        updatedAt: now,
      };
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { binding: bindingRow() }).database,
        }).activateCandidate({ ...input, expectedProfileHeadRevision: 2 }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_CONFLICT",
      });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, {
            binding: bindingRow(),
            candidatePublicationStatus: "published",
          }).database,
        }).activateCandidate(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_NOT_VALIDATED" });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect).database,
        }).activateCandidate(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_INVALID" });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, {
            binding: { ...bindingRow(), embedding_profile_revision: 1 },
          }).database,
        }).activateCandidate(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_INVALID" });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, {
            binding: {
              ...bindingRow(),
              embedding_profile_snapshot_digest: "f".repeat(64),
            },
          }).database,
        }).activateCandidate(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_INVALID" });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, {
            binding: retrievalCandidateBindingRow(),
            candidateRetrieval: true,
            noEmbeddingHead: true,
          }).database,
        }).activateCandidate({ ...input, changedKind: "retrieval", profileRevision: 2 }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_PROFILE_HEAD_CONFLICT",
      });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, {
            binding: bindingRow(),
            oldPublicationStatus: "validating",
          }).database,
        }).activateCandidate(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_INVALID" });
    });

    it("rejects incomplete current-publication bootstrap snapshots", async () => {
      const input = { knowledgeSpaceId: spaceId, tenantId, verifiedAt: now };
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { noPublicationHead: true }).database,
        }).bindCurrentPublished(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_MISSING" });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { oldPublicationStatus: "validating" }).database,
        }).bindCurrentPublished(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_INVALID" });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { missingPublication: true }).database,
        }).bindCurrentPublished(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_INVALID" });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, { noRetrievalHead: true }).database,
        }).bindCurrentPublished(input),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_RETRIEVAL_PROFILE_REQUIRED",
      });
      await expect(
        createDatabaseKnowledgeSpaceProfilePublicationRepository({
          database: fakeDatabase(dialect, {
            binding: { ...currentLegacyBindingRow(), activated_at: null },
          }).database,
        }).bindCurrentPublished(input),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_BINDING_NOT_ACTIVE" });
    });

    it("binds the current published tuple from one locked database snapshot", async () => {
      const fake = fakeDatabase(dialect);
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
        generateBindingId: () => bindingId,
      });
      const binding = await repository.bindCurrentPublished({
        knowledgeSpaceId: spaceId,
        tenantId,
        verifiedAt: now,
      });
      expect(binding).toMatchObject({
        activatedAt: now,
        bindingReason: "legacy-bootstrap",
        changedKind: "bootstrap",
        publicationId: oldPublicationId,
      });
      expect(
        fake.calls.filter((call) => call.input.tableName === "index_projections"),
      ).toHaveLength(2);
      expect(fake.calls.every((call) => call.lane === "transaction")).toBe(true);
    });

    it("reuses an old publication's activated immutable tuple after rollback", async () => {
      const activatedAt = "2026-07-13T14:00:00.000Z";
      const fake = fakeDatabase(dialect, { binding: currentLegacyBindingRow(activatedAt) });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      const binding = await repository.bindCurrentPublished({
        knowledgeSpaceId: spaceId,
        tenantId,
        verifiedAt: now,
      });
      expect(binding).toMatchObject({
        activatedAt,
        id: bindingId,
        publicationId: oldPublicationId,
      });
      expect(
        fake.calls.some(
          (call) =>
            call.input.tableName === "knowledge_space_profile_publication_bindings" &&
            call.input.operation === "insert",
        ),
      ).toBe(false);
      expect(fake.committedMutations()).toBe(0);
    });

    it("does not freeze a Research-only tuple while a legacy embedding head is still pending", async () => {
      const fake = fakeDatabase(dialect, {
        expectedEmbeddingSource: true,
        noEmbeddingHead: true,
      });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      await expect(
        repository.bindCurrentPublished({ knowledgeSpaceId: spaceId, tenantId, verifiedAt: now }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_NOT_READY" });
      expect(fake.committedMutations()).toBe(0);
      expect(
        fake.calls.some(
          (call) =>
            call.input.tableName === "knowledge_space_profile_publication_bindings" &&
            call.input.operation === "insert",
        ),
      ).toBe(false);
    });

    it("allows an absent embedding tuple only for an explicit Research profile", async () => {
      const fake = fakeDatabase(dialect, { noEmbeddingHead: true, nonResearchRetrieval: true });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      await expect(
        repository.bindCurrentPublished({ knowledgeSpaceId: spaceId, tenantId, verifiedAt: now }),
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_EMBEDDING_REQUIRED",
      });
      expect(fake.committedMutations()).toBe(0);
    });

    it("fails closed when a runtime publication has no activated tuple", async () => {
      const fake = fakeDatabase(dialect);
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      await expect(
        repository.requireActivatedBinding({
          knowledgeSpaceId: spaceId,
          publicationFingerprint: oldFingerprint,
          publicationId: oldPublicationId,
          tenantId,
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_TUPLE_NOT_PUBLISHED" });
    });

    it("returns only an exact activated runtime tuple", async () => {
      const fake = fakeDatabase(dialect, { binding: currentLegacyBindingRow() });
      const repository = createDatabaseKnowledgeSpaceProfilePublicationRepository({
        database: fake.database,
      });
      await expect(
        repository.requireActivatedBinding({
          knowledgeSpaceId: spaceId,
          publicationFingerprint: oldFingerprint,
          publicationId: oldPublicationId,
          tenantId,
        }),
      ).resolves.toMatchObject({ activatedAt: expect.any(String), id: bindingId });
      await expect(
        repository.requireActivatedBinding({
          knowledgeSpaceId: spaceId,
          publicationFingerprint: candidateFingerprint,
          publicationId: oldPublicationId,
          tenantId,
        }),
      ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_TUPLE_NOT_PUBLISHED" });
    });
  },
);

it("maps an ordinary content publication to its exact active profile tuple", () => {
  const binding = mapKnowledgeSpaceProfilePublicationBindingRow({
    ...currentLegacyBindingRow(),
    binding_reason: "content-publication",
    changed_kind: "content",
  });
  expect(binding).toMatchObject({
    bindingReason: "content-publication",
    changedKind: "content",
    publicationId: oldPublicationId,
  });
});

it("rejects corrupt persisted publication bindings", () => {
  for (const row of [
    { ...bindingRow(), changed_kind: "invalid" },
    { ...bindingRow(), binding_reason: "invalid" },
    { ...bindingRow(), embedding_profile_revision_id: null },
    { ...bindingRow(), vector_space_id: null },
    { ...bindingRow({ researchOnly: true }), vector_space_id: embedding(1, "a").vectorSpaceId },
    { ...bindingRow(), embedding_profile_revision: "not-a-number" },
    { ...bindingRow(), retrieval_profile_snapshot_digest: "not-a-digest" },
  ]) {
    expect(() => mapKnowledgeSpaceProfilePublicationBindingRow(row)).toThrow();
  }
  const researchOnly = mapKnowledgeSpaceProfilePublicationBindingRow(
    bindingRow({ researchOnly: true }),
  );
  expect(researchOnly.embeddingProfile).toBeUndefined();
  expect(researchOnly.vectorSpaceId).toBeUndefined();
});

function fakeDatabase(
  dialect: "postgres" | "tidb",
  options: {
    readonly apiKeyPermission?: boolean | undefined;
    readonly activeDeletion?: boolean | undefined;
    readonly binding?: Record<string, unknown> | undefined;
    readonly candidateRetrieval?: boolean | undefined;
    readonly candidatePublicationStatus?: "published" | "validating" | undefined;
    readonly expectedEmbeddingSource?: boolean | undefined;
    readonly failBindingActivation?: boolean | undefined;
    readonly failMigrationRunCompletion?: boolean | undefined;
    readonly noEmbeddingHead?: boolean | undefined;
    readonly noOutlineMembers?: boolean | undefined;
    readonly noPublicationHead?: boolean | undefined;
    readonly noRetrievalHead?: boolean | undefined;
    readonly missingManifest?: boolean | undefined;
    readonly missingMigrationFence?: boolean | undefined;
    readonly missingPageIndexManifest?: boolean | undefined;
    readonly missingProfile?: boolean | undefined;
    readonly missingPublication?: boolean | undefined;
    readonly nonResearchRetrieval?: boolean | undefined;
    readonly failMigrationOutboxCompletion?: boolean | undefined;
    readonly missingPartialMemberTarget?: boolean | undefined;
    readonly partialMemberPermission?: boolean | undefined;
    readonly invalidApiKeyProvenance?: boolean | undefined;
    readonly failPageIndexPromotion?: boolean | undefined;
    readonly headProfileIdMismatch?: boolean | undefined;
    readonly invalidEmbeddingCompanion?: boolean | undefined;
    readonly invalidRetrievalCompanion?: boolean | undefined;
    readonly oldPublicationStatus?: "published" | "validating" | undefined;
    readonly profileFault?:
      | "capability-digest"
      | "revision"
      | "scope"
      | "snapshot-digest"
      | "vector-space"
      | undefined;
    readonly revokedApiKeyPermission?: boolean | undefined;
    readonly rerankEnabled?: boolean | undefined;
    readonly shortBindingInsert?: boolean | undefined;
    readonly unverifiedEmbedding?: boolean | undefined;
    readonly unverifiedRetrieval?: boolean | undefined;
    readonly vectorConflict?: boolean | undefined;
    readonly vectorMissingConflict?: boolean | undefined;
    readonly outlineMemberOverflow?: boolean | undefined;
    readonly invalidPageIndexManifest?: boolean | undefined;
  } = {},
) {
  const calls: Array<{ input: DatabaseExecuteInput; lane: "outside" | "transaction" }> = [];
  let lane: "outside" | "transaction" = "outside";
  let committedMutationCount = 0;
  let rollbackCount = 0;

  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ input: { ...input, params: [...input.params] }, lane });
    if (input.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: spaceId, lifecycle_state: "active" }],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "deletion_jobs") {
      return options.activeDeletion
        ? { rows: [{ id: "active-deletion" }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    }
    if (input.tableName === "knowledge_space_manifests") {
      if (options.missingManifest) return { rows: [], rowsAffected: 0 };
      return {
        rows: [
          {
            metadata: options.expectedEmbeddingSource
              ? { __knowledgeFsEmbeddingProfile: embedding(1, "a") }
              : {},
          },
        ],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "knowledge_space_profile_heads") {
      if (input.operation !== "select") return mutation();
      const kind = String(input.params[2]);
      if (kind === "embedding" && options.noEmbeddingHead) return { rows: [], rowsAffected: 0 };
      if (kind === "retrieval" && options.noRetrievalHead) return { rows: [], rowsAffected: 0 };
      return {
        rows: [
          kind === "embedding"
            ? {
                active_revision: 1,
                profile_revision_id: options.headProfileIdMismatch ? bindingId : oldEmbeddingId,
                row_version: 3,
              }
            : {
                active_revision: 1,
                profile_revision_id: options.headProfileIdMismatch ? bindingId : retrievalId,
                row_version: 2,
              },
        ],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "knowledge_space_profile_revisions") {
      if (input.operation === "update") return mutation();
      if (options.missingProfile) return { rows: [], rowsAffected: 0 };
      const kind = String(input.params[2]) as "embedding" | "retrieval";
      const revision = Number(input.params[3]);
      const row = profileRow(
        kind,
        revision,
        (kind === "embedding" && revision === 2) ||
          (kind === "retrieval" && revision === 2 && options.candidateRetrieval)
          ? "candidate"
          : "active",
      );
      if (kind === "embedding" && revision === 1 && options.invalidEmbeddingCompanion) {
        row.state = "candidate";
      }
      if (kind === "retrieval" && revision === 1 && options.invalidRetrievalCompanion) {
        row.state = "candidate";
      }
      if (kind === "retrieval" && options.unverifiedRetrieval) {
        const capabilitySnapshot = {
          ...(row.capability_snapshot as object),
          verification: "unverified",
        };
        row.capability_snapshot = capabilitySnapshot;
        row.capability_snapshot_digest = knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot);
      }
      if (kind === "retrieval" && options.rerankEnabled) {
        const model = { model: "rerank", pluginId: "plugin-rerank", provider: "provider" };
        const snapshot = { ...retrieval(revision), rerank: { enabled: true as const, model } };
        const capabilitySnapshot = {
          reasoning: capability("reasoning", snapshot.reasoningModel),
          rerank: capability("rerank", model),
          verification: "verified",
        };
        row.snapshot = snapshot;
        row.snapshot_digest = knowledgeSpaceProfileSnapshotDigest(snapshot);
        row.capability_snapshot = capabilitySnapshot;
        row.capability_snapshot_digest = knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot);
      }
      if (kind === "retrieval" && options.nonResearchRetrieval) {
        const snapshot = { ...retrieval(revision), defaultMode: "deep" as const };
        row.snapshot = snapshot;
        row.snapshot_digest = knowledgeSpaceProfileSnapshotDigest(snapshot);
      }
      if (kind === "embedding" && options.unverifiedEmbedding) {
        const capabilitySnapshot = { ...(row.capability_snapshot as object), dimension: 1 };
        row.capability_snapshot = capabilitySnapshot;
        row.capability_snapshot_digest = knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot);
      }
      if (options.profileFault === "scope") row.tenant_id = "other-tenant";
      if (options.profileFault === "snapshot-digest") row.snapshot_digest = "f".repeat(64);
      if (options.profileFault === "capability-digest") {
        row.capability_snapshot_digest = "f".repeat(64);
      }
      if (options.profileFault === "revision") {
        const snapshot = { ...(row.snapshot as object), revision: 99 };
        row.snapshot = snapshot;
        row.snapshot_digest = knowledgeSpaceProfileSnapshotDigest(snapshot);
      }
      if (options.profileFault === "vector-space") {
        row.vector_space_id = `embedding-space-sha256:${"f".repeat(64)}`;
      }
      return {
        rows: [row],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "projection_set_publication_heads") {
      if (input.operation !== "select") return mutation();
      if (options.noPublicationHead) return { rows: [], rowsAffected: 0 };
      return { rows: [{ head_revision: 4, publication_id: oldPublicationId }], rowsAffected: 1 };
    }
    if (input.tableName === "projection_set_publications") {
      if (input.operation === "update") return mutation();
      if (options.missingPublication) return { rows: [], rowsAffected: 0 };
      const lookup = String(input.params[2]);
      return {
        rows: [
          lookup === oldPublicationId || lookup === oldFingerprint
            ? publicationRow(
                oldPublicationId,
                oldFingerprint,
                options.oldPublicationStatus ?? "published",
              )
            : publicationRow(
                candidatePublicationId,
                candidateFingerprint,
                options.candidatePublicationStatus ?? "validating",
              ),
        ],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "knowledge_space_profile_publication_bindings") {
      if (input.operation === "select") {
        return options.binding
          ? { rows: [options.binding], rowsAffected: 1 }
          : { rows: [], rowsAffected: 0 };
      }
      if (input.operation === "update" && options.failBindingActivation) {
        return { rows: [], rowsAffected: 0 };
      }
      if (input.operation === "insert" && options.shortBindingInsert) {
        return { rows: [], rowsAffected: 0 };
      }
      return mutation();
    }
    if (input.tableName === "projection_set_publication_members") {
      if (options.outlineMemberOverflow) {
        const row = {
          component_key: outlineId,
          document_asset_id: documentAssetId,
          generation_id: outlineGenerationId,
        };
        return { rows: Array.from({ length: 100_001 }, () => row), rowsAffected: 100_001 };
      }
      return options.noOutlineMembers
        ? { rows: [], rowsAffected: 0 }
        : {
            rows: [
              {
                component_key: outlineId,
                document_asset_id: documentAssetId,
                generation_id: outlineGenerationId,
              },
            ],
            rowsAffected: 1,
          };
    }
    if (input.tableName === "page_index_manifests") {
      if (input.operation === "update") {
        return options.failPageIndexPromotion ? { rows: [], rowsAffected: 0 } : mutation();
      }
      if (options.missingPageIndexManifest) return { rows: [], rowsAffected: 0 };
      return {
        rows: [
          {
            id: pageIndexManifestId,
            status: options.invalidPageIndexManifest ? "failed" : "building",
          },
        ],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "knowledge_space_profile_migration_runs") {
      if (input.operation === "update" && options.failMigrationRunCompletion) {
        return { rows: [], rowsAffected: 0 };
      }
      if (input.operation === "select" && options.missingMigrationFence) {
        return { rows: [], rowsAffected: 0 };
      }
      return input.operation === "select"
        ? {
            rows: [
              {
                ...(options.apiKeyPermission
                  ? {
                      api_key_expires_at: "2027-01-01T00:00:00.000Z",
                      api_key_id: apiKeyId,
                      api_key_revision: 7,
                    }
                  : {}),
                ...(options.invalidApiKeyProvenance ? { api_key_id: apiKeyId } : {}),
                ...(options.partialMemberPermission
                  ? { access_policy_id: accessPolicyId, visibility: "partial_members" }
                  : {}),
                id: migrationRunId,
                requested_by_subject_id: "owner-1",
              },
            ],
            rowsAffected: 1,
          }
        : mutation();
    }
    if (input.tableName === "knowledge_space_api_keys") {
      return options.revokedApiKeyPermission
        ? { rows: [], rowsAffected: 0 }
        : { rows: [{ id: apiKeyId }], rowsAffected: 1 };
    }
    if (input.tableName === "knowledge_space_access_policy_members") {
      return options.missingPartialMemberTarget
        ? { rows: [], rowsAffected: 0 }
        : { rows: [{ subject_id: "owner-1" }], rowsAffected: 1 };
    }
    if (input.tableName === "knowledge_space_profile_migration_outbox") {
      return options.failMigrationOutboxCompletion ? { rows: [], rowsAffected: 0 } : mutation();
    }
    if (input.tableName === "index_projections") {
      return options.vectorConflict ||
        (options.vectorMissingConflict && input.sql.includes("NOT EXISTS"))
        ? { rows: [{ id: "mixed-vector" }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    }
    throw new Error(`Unexpected ${input.operation} on ${input.tableName}`);
  };
  const mutation = (): DatabaseExecuteResult => {
    committedMutationCount += 1;
    return { rows: [], rowsAffected: 1 };
  };
  const database: DatabaseAdapter = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => {
      const before = committedMutationCount;
      lane = "transaction";
      try {
        return await callback({ execute });
      } catch (error) {
        committedMutationCount = before;
        rollbackCount += 1;
        throw error;
      } finally {
        lane = "outside";
      }
    },
  });
  return {
    calls,
    committedMutations: () => committedMutationCount,
    database,
    rollbacks: () => rollbackCount,
  };
}
