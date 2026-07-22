import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type DatabaseExecuteResult,
  KnowledgeSpaceEmbeddingProfileSchema,
  createKnowledgeSpaceEmbeddingProfile,
  createKnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { createWithOptionalKnowledgeSpaceSlug } from "./knowledge-space-creation";
import { createKnowledgeSpacePendingModelConfiguration } from "./knowledge-space-manifest-repository";
import { knowledgeSpaceProfileSnapshotDigest } from "./knowledge-space-profile-repository";
import {
  KnowledgeSpaceProvisioningIdempotencyConflictError,
  KnowledgeSpaceProvisioningIncompleteReplayError,
  createDatabaseKnowledgeSpaceProvisioningRepository,
} from "./knowledge-space-provisioning-repository";
import { DuplicateKnowledgeSpaceSlugError } from "./knowledge-space-repository";

const NOW = "2026-07-14T12:00:00.000Z";
const RESTARTED_AT = "2026-07-14T12:05:00.000Z";

describe.each(["postgres", "tidb"] as const)(
  "database knowledge-space provisioning (%s)",
  (dialect) => {
    it("provisions an integrated technical space without any local product authorization", async () => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
        provisioningMode: "integrated",
      });
      const request = await input("integrated-request", 1024);

      const first = await repository.provision(request);
      const replay = await repository.provision(request);

      expect(first).toMatchObject({ replayed: false });
      expect(replay).toMatchObject({ replayed: true, space: { id: first.space.id } });
      expect(fake.tableSize("knowledge_spaces")).toBe(1);
      expect(fake.tableSize("knowledge_space_manifests")).toBe(1);
      expect(fake.tableSize("knowledge_space_members")).toBe(0);
      expect(fake.tableSize("knowledge_space_access_policies")).toBe(0);
      expect(fake.tableSize("knowledge_space_api_access")).toBe(0);
      expect(fake.tableSize("knowledge_space_api_keys")).toBe(0);
      expect(fake.tableSize("knowledge_space_activity_events")).toBe(0);
      expect(
        jsonObject(
          jsonObject(fake.rows("knowledge_space_manifests")[0]?.metadata).__knowledgeFsProvisioning,
        ),
      ).toMatchObject({ provisioningMode: "integrated", schemaVersion: 4 });

      const legacyRepository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => RESTARTED_AT,
      });
      await expect(legacyRepository.provision(request)).rejects.toBeInstanceOf(
        KnowledgeSpaceProvisioningIdempotencyConflictError,
      );
    });

    it.each([7, 4096])(
      "atomically persists an independently selected vector space (dimension=%s)",
      async (dimension) => {
        const fake = new ProvisioningDatabaseFake(dialect);
        const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
          database: fake.adapter,
          now: () => NOW,
        });
        const result = await repository.provision(await input("request-a", dimension));

        expect(result).toMatchObject({ configurationStatus: "ready", replayed: false });
        expect(fake.tableSize("knowledge_spaces")).toBe(1);
        expect(fake.tableSize("knowledge_space_manifests")).toBe(1);
        expect(fake.tableSize("knowledge_space_profile_revisions")).toBe(2);
        expect(fake.tableSize("knowledge_space_profile_heads")).toBe(2);
        expect(fake.tableSize("knowledge_space_members")).toBe(1);
        expect(fake.tableSize("knowledge_space_access_policies")).toBe(1);
        expect(fake.tableSize("knowledge_space_api_access")).toBe(1);
        expect(fake.tableSize("knowledge_space_activity_events")).toBe(1);
        const embeddingInsert = fake.calls.find(
          (call) =>
            call.tableName === "knowledge_space_profile_revisions" &&
            call.operation === "insert" &&
            call.params[3] === "embedding",
        );
        expect(embeddingInsert?.params[14]).toBe(dimension);
        expect(embeddingInsert?.params).not.toContain(1536);
        expect(embeddingInsert?.params[13]).toMatch(/^embedding-space-sha256:/u);
        expect(fake.commits).toBe(1);
        expect(fake.rollbacks).toBe(0);
      },
    );

    it("commits a profileless space as explicitly setup-required", async () => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });

      const result = await repository.provision({
        createdBySubjectId: "user-1",
        idempotencyKey: "profileless",
        name: "Needs setup",
        slug: "needs-setup",
        slugSource: "explicit",
        tenantId: "tenant-1",
      });

      expect(result.configurationStatus).toBe("setup-required");
      expect(fake.tableSize("knowledge_space_profile_revisions")).toBe(0);
      expect(fake.tableSize("knowledge_space_profile_heads")).toBe(0);
      expect(fake.rows("knowledge_space_activity_events")[0]?.details).toContain("setup-required");
      expect(
        jsonObject(
          jsonObject(fake.rows("knowledge_space_manifests")[0]?.metadata).__knowledgeFsProvisioning,
        ).schemaVersion,
      ).toBe(2);
    });

    it("atomically persists unverified selections without activating model profiles", async () => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });
      const pendingModelConfiguration = createKnowledgeSpacePendingModelConfiguration({
        embeddingSelection: {
          model: "embed-user-selected",
          pluginId: "plugin-daemon-embedding",
          provider: "tenant-provider",
        },
        retrievalProfile: {
          defaultMode: "fast",
          reasoningModel: {
            model: "reasoning-user-selected",
            pluginId: "plugin-daemon-reasoning",
            provider: "tenant-provider",
          },
          rerank: { enabled: false },
          scoreThreshold: { enabled: false, stage: "mode-final" },
          topK: 5,
        },
      });
      const request = {
        createdBySubjectId: "user-1",
        idempotencyKey: "pending-model-selection",
        name: "Pending model selection",
        pendingModelConfiguration,
        slug: "pending-model-selection",
        slugSource: "explicit" as const,
        tenantId: "tenant-1",
      };

      const first = await repository.provision(request);
      const insertCount = fake.calls.filter((call) => call.operation === "insert").length;
      const metadata = jsonObject(fake.rows("knowledge_space_manifests")[0]?.metadata);
      const restartedRepository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => RESTARTED_AT,
      });

      expect(first).toMatchObject({ configurationStatus: "pending-validation", replayed: false });
      expect(metadata.__knowledgeFsPendingModelConfiguration).toEqual(pendingModelConfiguration);
      expect(jsonObject(metadata.__knowledgeFsProvisioning).schemaVersion).toBe(3);
      expect(fake.tableSize("knowledge_space_profile_revisions")).toBe(0);
      expect(fake.tableSize("knowledge_space_profile_heads")).toBe(0);
      await expect(restartedRepository.provision(request)).resolves.toMatchObject({
        replayed: true,
      });
      expect(fake.calls.filter((call) => call.operation === "insert")).toHaveLength(insertCount);

      const changedPendingModelConfiguration = createKnowledgeSpacePendingModelConfiguration({
        embeddingSelection: {
          model: "embed-user-selected-v2",
          pluginId: "plugin-daemon-embedding",
          provider: "tenant-provider",
        },
        retrievalProfile: pendingModelConfiguration.retrievalProfile,
      });
      await expect(
        repository.provision({
          ...request,
          pendingModelConfiguration: changedPendingModelConfiguration,
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceProvisioningIdempotencyConflictError);
    });

    it("replays a lost acknowledgement and rejects key reuse with a changed intent", async () => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });
      const request = await input("lost-ack", 768);

      const first = await repository.provision(request);
      const insertCount = fake.calls.filter((call) => call.operation === "insert").length;
      const restartedRepository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => RESTARTED_AT,
      });
      const replay = await restartedRepository.provision(request);

      expect(replay).toMatchObject({ replayed: true, space: { id: first.space.id } });
      expect(fake.calls.filter((call) => call.operation === "insert")).toHaveLength(insertCount);
      await expect(
        restartedRepository.provision({ ...request, name: "Changed" }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceProvisioningIdempotencyConflictError);
    });

    it("replays a v2 acknowledgement lost across the pending-configuration deploy", async () => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const beforeDeploy = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });
      const legacyRequest = await input("cross-deploy-lost-ack", 3072);
      const first = await beforeDeploy.provision(legacyRequest);
      const insertCount = fake.calls.filter((call) => call.operation === "insert").length;
      const pendingModelConfiguration = createKnowledgeSpacePendingModelConfiguration({
        embeddingSelection: {
          model: legacyRequest.embedding.profile.model,
          pluginId: legacyRequest.embedding.profile.pluginId,
          provider: legacyRequest.embedding.profile.provider,
        },
        retrievalProfile: {
          defaultMode: legacyRequest.retrieval.profile.defaultMode,
          reasoningModel: legacyRequest.retrieval.profile.reasoningModel,
          rerank: legacyRequest.retrieval.profile.rerank,
          scoreThreshold: legacyRequest.retrieval.profile.scoreThreshold,
          topK: legacyRequest.retrieval.profile.topK,
        },
      });
      const afterDeploy = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => RESTARTED_AT,
      });
      const pendingRequest = {
        createdBySubjectId: legacyRequest.createdBySubjectId,
        idempotencyKey: legacyRequest.idempotencyKey,
        name: legacyRequest.name,
        pendingModelConfiguration,
        slug: legacyRequest.slug,
        slugSource: legacyRequest.slugSource,
        tenantId: legacyRequest.tenantId,
      };

      await expect(afterDeploy.provision(pendingRequest)).resolves.toMatchObject({
        configurationStatus: "ready",
        replayed: true,
        space: { id: first.space.id },
      });
      expect(fake.calls.filter((call) => call.operation === "insert")).toHaveLength(insertCount);

      const researchProfile = createKnowledgeSpaceRetrievalProfile({
        defaultMode: "research",
        reasoningModel: {
          model: "research-reasoning",
          pluginId: "plugin-daemon-reasoning",
          provider: "tenant-provider",
        },
        rerank: { enabled: false },
        scoreThreshold: { enabled: false, stage: "mode-final" },
        topK: 6,
      });
      const legacyResearchRequest = {
        createdBySubjectId: "user-1",
        idempotencyKey: "cross-deploy-research-lost-ack",
        name: "Research-only lost ACK",
        retrieval: {
          capabilitySnapshot: { reasoning: "verified" },
          profile: researchProfile,
        },
        slug: "research-only-lost-ack",
        slugSource: "explicit" as const,
        tenantId: "tenant-1",
      };
      await beforeDeploy.provision(legacyResearchRequest);
      await expect(
        afterDeploy.provision({
          createdBySubjectId: legacyResearchRequest.createdBySubjectId,
          idempotencyKey: legacyResearchRequest.idempotencyKey,
          name: legacyResearchRequest.name,
          pendingModelConfiguration: createKnowledgeSpacePendingModelConfiguration({
            retrievalProfile: {
              defaultMode: researchProfile.defaultMode,
              reasoningModel: researchProfile.reasoningModel,
              rerank: researchProfile.rerank,
              scoreThreshold: researchProfile.scoreThreshold,
              topK: researchProfile.topK,
            },
          }),
          slug: legacyResearchRequest.slug,
          slugSource: legacyResearchRequest.slugSource,
          tenantId: legacyResearchRequest.tenantId,
        }),
      ).resolves.toMatchObject({ configurationStatus: "ready", replayed: true });

      await expect(
        afterDeploy.provision({
          ...pendingRequest,
          pendingModelConfiguration: createKnowledgeSpacePendingModelConfiguration({
            embeddingSelection: {
              model: "different-model",
              pluginId: legacyRequest.embedding.profile.pluginId,
              provider: legacyRequest.embedding.profile.provider,
            },
            retrievalProfile: pendingModelConfiguration.retrievalProfile,
          }),
        }),
      ).rejects.toBeInstanceOf(KnowledgeSpaceProvisioningIdempotencyConflictError);
    });

    it("replays after a fresh preflight changes only ephemeral capability metadata", async () => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });
      const request = await input("fresh-preflight", 768);
      const first = await repository.provision(request);
      const replay = await repository.provision({
        ...request,
        embedding: {
          ...request.embedding,
          capabilitySnapshot: {
            ...request.embedding.capabilitySnapshot,
            checkedAt: "2026-07-14T12:01:00.000Z",
          },
        },
      });

      expect(replay).toMatchObject({ replayed: true, space: { id: first.space.id } });
    });

    it("replays when persisted capability checkedAt metadata changes but its full digest remains valid", async () => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });
      const base = await input("persisted-checked-at", 768);
      const request = {
        ...base,
        embedding: {
          ...base.embedding,
          capabilitySnapshot: {
            ...base.embedding.capabilitySnapshot,
            observation: {
              checkedAt: "2026-07-14T12:00:00.000Z",
              status: "ready",
            },
          },
        },
      };
      const first = await repository.provision(request);
      fake.mutateFirst(
        "knowledge_space_profile_revisions",
        (row) => row.kind === "embedding",
        (row) => {
          const capability = jsonObject(row.capability_snapshot);
          const observation = jsonObject(capability.observation);
          observation.checkedAt = "2026-07-14T12:05:00.000Z";
          capability.observation = observation;
          row.capability_snapshot = JSON.stringify(capability);
          row.capability_snapshot_digest = knowledgeSpaceProfileSnapshotDigest(capability);
        },
      );

      await expect(repository.provision(request)).resolves.toMatchObject({
        replayed: true,
        space: { id: first.space.id },
      });
    });

    it.each([
      {
        label: "space lifecycle",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_spaces",
            () => true,
            (row) => {
              row.lifecycle_state = "deleting";
              row.deletion_job_id = "00000000-0000-0000-0000-000000000001";
              row.deleting_at = NOW;
            },
          ),
      },
      {
        label: "explicit space slug",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_spaces",
            () => true,
            (row) => {
              row.slug = "tampered-slug";
            },
          ),
      },
      {
        label: "manifest deterministic fields",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_manifests",
            () => true,
            (row) => {
              row.manifest_version = 2;
              row.object_key_prefix = "tampered/prefix";
            },
          ),
      },
      {
        label: "manifest policy",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_manifests",
            () => true,
            (row) => {
              const quotaPolicy = jsonObject(row.quota_policy);
              quotaPolicy.maxNodeCount = 1;
              row.quota_policy = JSON.stringify(quotaPolicy);
            },
          ),
      },
      {
        label: "manifest marker schema version",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_manifests",
            () => true,
            (row) => {
              const metadata = jsonObject(row.metadata);
              const marker = jsonObject(metadata.__knowledgeFsProvisioning);
              marker.schemaVersion = 1;
              metadata.__knowledgeFsProvisioning = marker;
              row.metadata = JSON.stringify(metadata);
            },
          ),
      },
      {
        label: "manifest configuration status",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_manifests",
            () => true,
            (row) => {
              const metadata = jsonObject(row.metadata);
              const marker = jsonObject(metadata.__knowledgeFsProvisioning);
              marker.configurationStatus = "setup-required";
              metadata.__knowledgeFsProvisioning = marker;
              row.metadata = JSON.stringify(metadata);
            },
          ),
      },
      {
        label: "legacy marker with a v3-only configuration status",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_manifests",
            () => true,
            (row) => {
              const metadata = jsonObject(row.metadata);
              const marker = jsonObject(metadata.__knowledgeFsProvisioning);
              marker.configurationStatus = "pending-validation";
              metadata.__knowledgeFsProvisioning = marker;
              row.metadata = JSON.stringify(metadata);
            },
          ),
      },
      {
        label: "owner member semantics",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_members",
            () => true,
            (row) => {
              row.revision = 2;
              row.role = "viewer";
            },
          ),
      },
      {
        label: "access policy semantics",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_access_policies",
            () => true,
            (row) => {
              row.revision = 2;
              row.visibility = "all_members";
            },
          ),
      },
      {
        label: "API access semantics",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_api_access",
            () => true,
            (row) => {
              row.enabled = true;
              row.disabled_at = null;
              row.revision = 2;
            },
          ),
      },
      {
        label: "creation activity semantics",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_activity_events",
            () => true,
            (row) => {
              row.result = "failure";
              row.details = JSON.stringify({ operation: "created" });
            },
          ),
      },
      {
        label: "embedding profile head",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_profile_heads",
            (row) => row.kind === "embedding",
            (row) => {
              row.active_revision = 2;
              row.row_version = 2;
            },
          ),
      },
      {
        label: "embedding vector identity",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_profile_revisions",
            (row) => row.kind === "embedding",
            (row) => {
              row.dimension = 1536;
              row.vector_space_id = `embedding-space-sha256:${"f".repeat(64)}`;
            },
          ),
      },
      {
        label: "retrieval model selection",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_profile_revisions",
            (row) => row.kind === "retrieval",
            (row) => {
              row.model = "tampered-reasoning-model";
              row.state = "superseded";
            },
          ),
      },
      {
        label: "retrieval profile snapshot",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_profile_revisions",
            (row) => row.kind === "retrieval",
            (row) => {
              const snapshot = jsonObject(row.snapshot);
              snapshot.topK = 99;
              row.snapshot = JSON.stringify(snapshot);
              row.snapshot_digest = knowledgeSpaceProfileSnapshotDigest(snapshot);
            },
          ),
      },
      {
        label: "stable capability semantics despite a self-consistent stored digest",
        mutate: (fake: ProvisioningDatabaseFake) =>
          fake.mutateFirst(
            "knowledge_space_profile_revisions",
            (row) => row.kind === "embedding",
            (row) => {
              const capability = jsonObject(row.capability_snapshot);
              capability.dimension = 999;
              row.capability_snapshot = JSON.stringify(capability);
              row.capability_snapshot_digest = knowledgeSpaceProfileSnapshotDigest(capability);
            },
          ),
      },
    ])("rejects a lost-ack replay with tampered $label", async ({ label, mutate }) => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });
      const request = await input(`tamper-${label}`, 768);
      await repository.provision(request);
      mutate(fake);

      await expect(repository.provision(request)).rejects.toBeInstanceOf(
        KnowledgeSpaceProvisioningIncompleteReplayError,
      );
    });

    it.each([
      { label: "manifest", tableName: "knowledge_space_manifests" },
      { label: "owner member", tableName: "knowledge_space_members" },
      { label: "access policy", tableName: "knowledge_space_access_policies" },
      { label: "API access", tableName: "knowledge_space_api_access" },
      { label: "creation activity", tableName: "knowledge_space_activity_events" },
      {
        kind: "embedding",
        label: "embedding profile head",
        tableName: "knowledge_space_profile_heads",
      },
      {
        kind: "retrieval",
        label: "retrieval profile revision",
        tableName: "knowledge_space_profile_revisions",
      },
    ])("rejects a lost-ack replay with a missing $label", async ({ kind, label, tableName }) => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });
      const request = await input(`missing-${label}`, 768);
      await repository.provision(request);
      fake.deleteFirst(tableName, (row) => kind === undefined || row.kind === kind);

      await expect(repository.provision(request)).rejects.toBeInstanceOf(
        KnowledgeSpaceProvisioningIncompleteReplayError,
      );
    });

    it("classifies a tenant slug collision without deleting the existing aggregate", async () => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });
      await repository.provision(await input("first-key", 384));

      await expect(repository.provision(await input("second-key", 384))).rejects.toBeInstanceOf(
        DuplicateKnowledgeSpaceSlugError,
      );
      expect(fake.tableSize("knowledge_spaces")).toBe(1);
    });

    it("retries a generated tenant slug and replays its committed suffix", async () => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });
      await repository.provision({
        createdBySubjectId: "owner",
        idempotencyKey: "occupied",
        name: "Camera Spec",
        slug: "camera-spec",
        slugSource: "explicit",
        tenantId: "tenant-1",
      });
      const create = () =>
        createWithOptionalKnowledgeSpaceSlug(
          { name: "Camera Spec", tenantId: "tenant-1" },
          ({ name, slug, tenantId }) =>
            repository.provision({
              createdBySubjectId: "owner",
              idempotencyKey: "generated-request",
              name,
              slug,
              slugSource: "generated",
              tenantId,
            }),
        );

      const first = await create();
      const replay = await create();

      expect(first.space.slug).toBe("camera-spec-2");
      expect(replay).toMatchObject({
        replayed: true,
        space: { id: first.space.id, slug: "camera-spec-2" },
      });
      expect(fake.tableSize("knowledge_spaces")).toBe(2);
    });

    it("keeps each space's model identity, vector space, and dimension independent", async () => {
      const fake = new ProvisioningDatabaseFake(dialect);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });
      const first = await input("independent-a", 384);
      const second = {
        ...(await input("independent-b", 3072)),
        name: "Independent model space B",
        slug: "independent-model-space-b",
      };

      await repository.provision(first);
      await repository.provision(second);

      const embeddingRows = fake
        .rows("knowledge_space_profile_revisions")
        .filter((row) => row.kind === "embedding");
      expect(
        embeddingRows.map((row) => Number(row.dimension)).sort((left, right) => left - right),
      ).toEqual([384, 3072]);
      expect(new Set(embeddingRows.map((row) => row.vector_space_id)).size).toBe(2);
      expect(new Set(embeddingRows.map((row) => row.model))).toEqual(
        new Set(["embed-384", "embed-3072"]),
      );
    });

    it.each([
      "knowledge_space_manifests",
      "knowledge_space_profile_revisions",
      "knowledge_space_members",
      "knowledge_space_access_policies",
      "knowledge_space_api_access",
      "knowledge_space_activity_events",
    ])("rolls back every prior write when %s fails", async (failureTable) => {
      const fake = new ProvisioningDatabaseFake(dialect, failureTable);
      const repository = createDatabaseKnowledgeSpaceProvisioningRepository({
        database: fake.adapter,
        now: () => NOW,
      });

      await expect(
        repository.provision(await input(`failure-${failureTable}`, 1024)),
      ).rejects.toThrow(`injected ${failureTable} failure`);
      expect(fake.totalRows()).toBe(0);
      expect(fake.commits).toBe(0);
      expect(fake.rollbacks).toBe(1);
    });
  },
);

async function input(idempotencyKey: string, dimension: number) {
  const selection = {
    model: `embed-${dimension}`,
    pluginId: "plugin-daemon-embedding",
    provider: "tenant-provider",
  };
  const embedding = KnowledgeSpaceEmbeddingProfileSchema.parse({
    ...(await createKnowledgeSpaceEmbeddingProfile(selection, 1, {
      capabilityDigest: `sha256:${"a".repeat(64)}`,
      dimension,
      distanceMetric: "cosine",
      pluginUniqueIdentifier: `plugin-daemon-embedding@${dimension}`,
      schemaFingerprint: `sha256:${"b".repeat(64)}`,
    })),
    dimension,
  });
  const retrieval = createKnowledgeSpaceRetrievalProfile({
    defaultMode: "fast",
    reasoningModel: {
      model: "reasoning-model",
      pluginId: "plugin-daemon-reasoning",
      provider: "tenant-provider",
    },
    rerank: {
      enabled: true,
      model: {
        model: "rerank-model",
        pluginId: "plugin-daemon-rerank",
        provider: "tenant-provider",
      },
    },
    scoreThreshold: { enabled: true, stage: "mode-final", value: 0.4 },
    topK: 8,
  });
  return {
    createdBySubjectId: "user-1",
    embedding: {
      capabilitySnapshot: { dimension, install: `embedding-${dimension}` },
      profile: embedding,
    },
    idempotencyKey,
    name: "Independent model space",
    retrieval: {
      capabilitySnapshot: { reasoning: "verified", rerank: "verified" },
      profile: retrieval,
    },
    slug: "independent-model-space",
    slugSource: "explicit" as const,
    tenantId: "tenant-1",
  };
}

class ProvisioningDatabaseFake {
  readonly calls: DatabaseExecuteInput[] = [];
  commits = 0;
  rollbacks = 0;
  private state = new Map<string, Map<string, Record<string, unknown>>>();
  readonly adapter;

  constructor(
    dialect: "postgres" | "tidb",
    private readonly failureTable?: string,
  ) {
    const execute = async (call: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      this.calls.push(call);
      if (call.operation === "insert") return this.insert(call);
      return this.select(call);
    };
    this.adapter = createSchemaDatabaseAdapter({
      executor: execute,
      kind: dialect,
      transaction: async (callback) => {
        const snapshot = structuredClone(this.state);
        try {
          const result = await callback({ execute });
          this.commits += 1;
          return result;
        } catch (error) {
          this.state = snapshot;
          this.rollbacks += 1;
          throw error;
        }
      },
    });
  }

  tableSize(tableName: string): number {
    return this.state.get(tableName)?.size ?? 0;
  }

  totalRows(): number {
    return [...this.state.values()].reduce((total, table) => total + table.size, 0);
  }

  rows(tableName: string): readonly Record<string, unknown>[] {
    return [...(this.state.get(tableName)?.values() ?? [])];
  }

  mutateFirst(
    tableName: string,
    predicate: (row: Record<string, unknown>) => boolean,
    mutate: (row: Record<string, unknown>) => void,
  ): void {
    const row = this.rows(tableName).find(predicate);
    if (!row) throw new Error(`Missing ${tableName} row to mutate`);
    mutate(row);
  }

  deleteFirst(
    tableName: string,
    predicate: (row: Record<string, unknown>) => boolean = () => true,
  ): void {
    const table = this.table(tableName);
    const entry = [...table.entries()].find(([, row]) => predicate(row));
    if (!entry) throw new Error(`Missing ${tableName} row to delete`);
    table.delete(entry[0]);
  }

  private insert(call: DatabaseExecuteInput): DatabaseExecuteResult {
    if (call.tableName === this.failureTable) throw new Error(`injected ${call.tableName} failure`);
    const row = rowForInsert(call);
    const table = this.table(call.tableName);
    const id = String(row.id);
    if (table.has(id)) throw uniqueViolation();
    if (
      call.tableName === "knowledge_spaces" &&
      [...table.values()].some(
        (existing) => existing.tenant_id === row.tenant_id && existing.slug === row.slug,
      )
    ) {
      throw uniqueViolation();
    }
    table.set(id, row);
    return { rows: [], rowsAffected: 1 };
  }

  private select(call: DatabaseExecuteInput): DatabaseExecuteResult {
    if (call.tableName === "knowledge_spaces") {
      const row = [...this.table("knowledge_spaces").values()].find(
        (candidate) => candidate.tenant_id === call.params[0] && candidate.id === call.params[1],
      );
      return { rows: row ? [row] : [], rowsAffected: row ? 1 : 0 };
    }
    const isProfileTable =
      call.tableName === "knowledge_space_profile_heads" ||
      call.tableName === "knowledge_space_profile_revisions";
    const rows = [...this.table(call.tableName).values()].filter(
      (candidate) =>
        candidate.tenant_id === call.params[0] &&
        candidate.knowledge_space_id === call.params[1] &&
        (isProfileTable
          ? candidate.kind === call.params[2]
          : call.params.length < 3 || candidate.id === call.params[2]),
    );
    return { rows, rowsAffected: rows.length };
  }

  private table(tableName: string): Map<string, Record<string, unknown>> {
    let table = this.state.get(tableName);
    if (!table) {
      table = new Map();
      this.state.set(tableName, table);
    }
    return table;
  }
}

function rowForInsert(call: DatabaseExecuteInput): Record<string, unknown> {
  const columns = [...call.sql.matchAll(/["`]([a-z_]+)["`]/gu)]
    .map((match) => match[1])
    .slice(1, call.params.length + 1);
  return Object.fromEntries(columns.map((column, index) => [column, call.params[index]]));
}

function jsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return structuredClone(parsed as Record<string, unknown>);
}

function uniqueViolation(): Error & { code: string } {
  return Object.assign(new Error("duplicate key violates unique constraint"), { code: "23505" });
}
