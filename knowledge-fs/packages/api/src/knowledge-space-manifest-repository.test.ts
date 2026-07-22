import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import {
  type DatabaseExecuteInput,
  type KnowledgeSpaceManifest,
  KnowledgeSpaceManifestSchema,
  createDefaultKnowledgeSpaceManifest,
  createKnowledgeSpaceEmbeddingProfile,
  createKnowledgeSpaceRetrievalProfile,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  DuplicateKnowledgeSpaceManifestError,
  KnowledgeSpaceEmbeddingProfileFrozenError,
  KnowledgeSpaceManifestCapacityExceededError,
  KnowledgeSpaceManifestListLimitExceededError,
  type KnowledgeSpaceManifestRepository,
  KnowledgeSpaceRetrievalProfileRevisionConflictError,
  createDatabaseKnowledgeSpaceManifestRepository,
  createInMemoryKnowledgeSpaceManifestRepository,
  createKnowledgeSpacePendingModelConfiguration,
  freezeKnowledgeSpaceEmbeddingProfile,
  observeKnowledgeSpaceEmbeddingDimension,
  updateKnowledgeSpaceEmbeddingSelection,
  updateKnowledgeSpaceRetrievalProfile,
} from "./knowledge-space-manifest-repository";

const TENANT_ID = "tenant-1";
const SPACE_ID_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const SPACE_ID_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const MANIFEST_ID_A = "018f0d60-7a49-7cc2-9c1b-5b36f18f7a10";
const MANIFEST_ID_B = "018f0d60-7a49-7cc2-9c1b-5b36f18f7a11";
const NOW = "2026-05-27T08:00:00.000Z";
const LATER = "2026-05-27T08:05:00.000Z";

function manifest(overrides: Partial<KnowledgeSpaceManifest> = {}): KnowledgeSpaceManifest {
  return KnowledgeSpaceManifestSchema.parse({
    ...createDefaultKnowledgeSpaceManifest({
      createdAt: NOW,
      id: MANIFEST_ID_A,
      knowledgeSpaceId: SPACE_ID_A,
      tenantId: TENANT_ID,
      updatedAt: NOW,
    }),
    ...overrides,
  });
}

describe("KnowledgeSpaceManifest repositories", () => {
  it("stores clone-isolated manifests scoped by tenant and knowledge space", async () => {
    const repository = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 2,
      maxManifests: 2,
    });
    const created = await repository.create(manifest({ metadata: { label: "control-plane" } }));

    created.metadata.label = "mutated";

    await expect(
      repository.get({ knowledgeSpaceId: SPACE_ID_A, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({
      metadata: { label: "control-plane" },
      objectKeyPrefix: `${TENANT_ID}/spaces/${SPACE_ID_A}`,
    });

    const found = await repository.get({ knowledgeSpaceId: SPACE_ID_A, tenantId: TENANT_ID });

    if (found) {
      found.metadata.label = "mutated-again";
    }

    await expect(
      repository.get({ knowledgeSpaceId: SPACE_ID_A, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({
      metadata: { label: "control-plane" },
    });
    await expect(
      repository.get({ knowledgeSpaceId: SPACE_ID_A, tenantId: "other-tenant" }),
    ).resolves.toBeNull();
  });

  it("updates mutable manifest policies while preserving immutable identity fields", async () => {
    const repository = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 2,
      maxManifests: 2,
    });
    await repository.create(manifest());

    await expect(
      repository.update({
        knowledgeSpaceId: SPACE_ID_A,
        patch: {
          consistencyPolicy: {
            cacheTtlSeconds: 30,
            defaultClass: "cache-consistent",
            snapshotTtlSeconds: 1200,
          },
          manifestVersion: 2,
          metadata: { rollout: "green" },
          projectionSetVersion: "projection-v2",
          updatedAt: LATER,
        },
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({
      consistencyPolicy: {
        cacheTtlSeconds: 30,
        defaultClass: "cache-consistent",
        snapshotTtlSeconds: 1200,
      },
      id: MANIFEST_ID_A,
      knowledgeSpaceId: SPACE_ID_A,
      manifestVersion: 2,
      projectionSetVersion: "projection-v2",
      tenantId: TENANT_ID,
      updatedAt: LATER,
    });

    await expect(
      repository.update({
        knowledgeSpaceId: SPACE_ID_A,
        patch: {
          id: MANIFEST_ID_B,
          knowledgeSpaceId: SPACE_ID_B,
          tenantId: "other-tenant",
          updatedAt: LATER,
        },
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({
      id: MANIFEST_ID_A,
      knowledgeSpaceId: SPACE_ID_A,
      tenantId: TENANT_ID,
    });
  });

  it("updates retrieval profiles with an independent revision and manifest CAS", async () => {
    const repository = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 2,
      maxManifests: 2,
    });
    await repository.create(manifest());
    const profile = {
      defaultMode: "fast" as const,
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
      scoreThreshold: { enabled: true, stage: "rerank" as const, value: 0.5 },
      topK: 3,
    };

    await expect(
      updateKnowledgeSpaceRetrievalProfile(repository, {
        expectedRevision: 0,
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        profile,
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual(createKnowledgeSpaceRetrievalProfile(profile));
    await expect(
      repository.get({ knowledgeSpaceId: SPACE_ID_A, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({
      manifestVersion: 2,
      retrievalProfile: { revision: 1, topK: 3 },
      updatedAt: LATER,
    });
    await expect(
      updateKnowledgeSpaceRetrievalProfile(repository, {
        expectedRevision: 0,
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        profile,
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceRetrievalProfileRevisionConflictError);
  });

  it("updates embedding selections idempotently and observes dimensions with a vector-space CAS", async () => {
    const repository = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 2,
      maxManifests: 2,
    });
    await repository.create(manifest());
    const selection = {
      model: "embed-v1",
      pluginId: "plugin-demo",
      provider: "tenant-provider",
    };
    const first = await updateKnowledgeSpaceEmbeddingSelection(repository, {
      knowledgeSpaceId: SPACE_ID_A,
      now: () => LATER,
      selection,
      tenantId: TENANT_ID,
    });

    expect(first).toMatchObject({ ...selection, revision: 1 });
    await expect(
      updateKnowledgeSpaceEmbeddingSelection(repository, {
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        selection,
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual(first);
    await expect(
      observeKnowledgeSpaceEmbeddingDimension(repository, {
        dimension: 3_072,
        expectedRevision: first?.revision ?? 0,
        expectedVectorSpaceId: first?.vectorSpaceId ?? "missing",
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ dimension: 3_072, revision: 1 });
    await expect(
      observeKnowledgeSpaceEmbeddingDimension(repository, {
        dimension: 1_536,
        expectedRevision: first?.revision ?? 0,
        expectedVectorSpaceId: first?.vectorSpaceId ?? "missing",
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("Embedding dimension conflict");

    const second = await updateKnowledgeSpaceEmbeddingSelection(repository, {
      knowledgeSpaceId: SPACE_ID_A,
      now: () => LATER,
      selection: { ...selection, model: "embed-v2" },
      tenantId: TENANT_ID,
    });
    expect(second).toMatchObject({ revision: 2 });
    expect(second?.dimension).toBeUndefined();
    await expect(
      observeKnowledgeSpaceEmbeddingDimension(repository, {
        dimension: 3_072,
        expectedRevision: first?.revision ?? 0,
        expectedVectorSpaceId: first?.vectorSpaceId ?? "missing",
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        tenantId: TENANT_ID,
      }),
    ).resolves.toBeNull();
  });

  it("freezes profile changes monotonically while preserving idempotent selection updates", async () => {
    const repository = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 2,
      maxManifests: 2,
    });
    await repository.create(manifest());
    const selection = {
      model: "embed-v1",
      pluginId: "plugin-demo",
      provider: "tenant-provider",
    };
    const profile = await updateKnowledgeSpaceEmbeddingSelection(repository, {
      knowledgeSpaceId: SPACE_ID_A,
      now: () => NOW,
      selection,
      tenantId: TENANT_ID,
    });

    await expect(
      freezeKnowledgeSpaceEmbeddingProfile(repository, {
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        tenantId: TENANT_ID,
      }),
    ).resolves.toBe(LATER);
    await expect(
      freezeKnowledgeSpaceEmbeddingProfile(repository, {
        knowledgeSpaceId: SPACE_ID_A,
        now: () => "2026-05-27T09:00:00.000Z",
        tenantId: TENANT_ID,
      }),
    ).resolves.toBe(LATER);
    await expect(
      updateKnowledgeSpaceEmbeddingSelection(repository, {
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        selection,
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual(profile);
    await expect(
      observeKnowledgeSpaceEmbeddingDimension(repository, {
        dimension: 3_072,
        expectedRevision: profile?.revision ?? 0,
        expectedVectorSpaceId: profile?.vectorSpaceId ?? "missing",
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ dimension: 3_072 });
    await expect(
      updateKnowledgeSpaceEmbeddingSelection(repository, {
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        selection: { ...selection, model: "embed-v2" },
        tenantId: TENANT_ID,
      }),
    ).rejects.toMatchObject({
      frozenAt: LATER,
      knowledgeSpaceId: SPACE_ID_A,
      tenantId: TENANT_ID,
    });
    await expect(
      updateKnowledgeSpaceEmbeddingSelection(repository, {
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        selection: { ...selection, model: "embed-v2" },
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceEmbeddingProfileFrozenError);
    await expect(
      repository.get({ knowledgeSpaceId: SPACE_ID_A, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({
      embeddingProfile: { dimension: 3_072 },
      embeddingProfileFrozenAt: LATER,
      manifestVersion: 4,
    });
  });

  it("rechecks the frozen latch after losing a profile-update CAS race", async () => {
    const repository = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 2,
      maxManifests: 2,
    });
    const selection = {
      model: "embed-v1",
      pluginId: "plugin-demo",
      provider: "tenant-provider",
    };
    await repository.create(
      manifest({ embeddingProfile: await createKnowledgeSpaceEmbeddingProfile(selection) }),
    );
    let injectedFreeze = false;
    const racingRepository: KnowledgeSpaceManifestRepository = {
      ...repository,
      update: async (input) => {
        if (!injectedFreeze && input.patch.embeddingProfile) {
          injectedFreeze = true;
          await freezeKnowledgeSpaceEmbeddingProfile(repository, {
            knowledgeSpaceId: SPACE_ID_A,
            now: () => LATER,
            tenantId: TENANT_ID,
          });

          return null;
        }

        return repository.update(input);
      },
    };

    await expect(
      updateKnowledgeSpaceEmbeddingSelection(racingRepository, {
        knowledgeSpaceId: SPACE_ID_A,
        now: () => LATER,
        selection: { ...selection, model: "embed-v2" },
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceEmbeddingProfileFrozenError);
    await expect(
      repository.get({ knowledgeSpaceId: SPACE_ID_A, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({
      embeddingProfile: expect.objectContaining({ model: "embed-v1", revision: 1 }),
      embeddingProfileFrozenAt: LATER,
    });
  });

  it("lists manifests with stable pagination and bounded limits", async () => {
    const repository = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 1,
      maxManifests: 3,
    });
    await repository.create(manifest());
    await repository.create(
      manifest({
        id: MANIFEST_ID_B,
        knowledgeSpaceId: SPACE_ID_B,
        objectKeyPrefix: `${TENANT_ID}/spaces/${SPACE_ID_B}`,
      }),
    );

    await expect(repository.list({ limit: 2, tenantId: TENANT_ID })).rejects.toBeInstanceOf(
      KnowledgeSpaceManifestListLimitExceededError,
    );

    const first = await repository.list({ limit: 1, tenantId: TENANT_ID });
    expect(first).toEqual({
      items: [expect.objectContaining({ knowledgeSpaceId: SPACE_ID_A })],
      nextCursor: SPACE_ID_A,
    });
    await expect(
      repository.list({ cursor: first.nextCursor, limit: 1, tenantId: TENANT_ID }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ knowledgeSpaceId: SPACE_ID_B })],
    });
  });

  it("rejects duplicate manifests, invalid bounds, and capacity overflow", async () => {
    expect(() =>
      createInMemoryKnowledgeSpaceManifestRepository({ maxListLimit: 0, maxManifests: 1 }),
    ).toThrow("KnowledgeSpaceManifest repository maxListLimit must be at least 1");
    expect(() =>
      createInMemoryKnowledgeSpaceManifestRepository({ maxListLimit: 1, maxManifests: 0 }),
    ).toThrow("KnowledgeSpaceManifest repository maxManifests must be at least 1");

    const repository = createInMemoryKnowledgeSpaceManifestRepository({
      maxListLimit: 2,
      maxManifests: 1,
    });
    await repository.create(manifest());

    await expect(repository.create(manifest({ id: MANIFEST_ID_B }))).rejects.toBeInstanceOf(
      DuplicateKnowledgeSpaceManifestError,
    );
    await expect(
      repository.create(
        manifest({
          id: MANIFEST_ID_B,
          knowledgeSpaceId: SPACE_ID_B,
          objectKeyPrefix: `${TENANT_ID}/spaces/${SPACE_ID_B}`,
        }),
      ),
    ).rejects.toBeInstanceOf(KnowledgeSpaceManifestCapacityExceededError);
  });
});

describe("DatabaseKnowledgeSpaceManifestRepository", () => {
  it("implements PostgreSQL create/get/list/update with parameters and RETURNING", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const embeddingProfile = await createKnowledgeSpaceEmbeddingProfile({
      model: "embed-v1",
      pluginId: "plugin-demo",
      provider: "tenant-provider",
    });
    const pendingModelConfiguration = createKnowledgeSpacePendingModelConfiguration({
      embeddingSelection: {
        model: "embed-v2",
        pluginId: "plugin-demo",
        provider: "tenant-provider",
      },
    });
    const initial = manifest({
      embeddingProfile,
      embeddingProfileFrozenAt: NOW,
      parserPolicyVersion: "parser-v1'); DROP TABLE knowledge_spaces; --",
      pendingModelConfiguration,
    });
    const second = manifest({
      id: MANIFEST_ID_B,
      knowledgeSpaceId: SPACE_ID_B,
      objectKeyPrefix: `${TENANT_ID}/spaces/${SPACE_ID_B}`,
    });
    const updated = KnowledgeSpaceManifestSchema.parse({
      ...initial,
      manifestVersion: 2,
      metadata: { rollout: "green" },
      projectionSetVersion: "projection-v2",
      updatedAt: LATER,
    });
    let stored: KnowledgeSpaceManifest | null = null;
    const execute = async (input: DatabaseExecuteInput) => {
      calls.push(input);

      if (input.tableName === "knowledge_spaces") {
        return {
          rows: [
            {
              deletion_job_id: null,
              id: input.params[1],
              lifecycle_state: "active",
            },
          ],
          rowsAffected: 1,
        };
      }

      if (input.tableName === "deletion_jobs") {
        return { rows: [], rowsAffected: 0 };
      }

      if (input.operation === "insert") {
        stored = initial;
        return { rows: [manifestRow(initial, false)], rowsAffected: 1 };
      }

      if (input.operation === "update") {
        stored = updated;
        return { rows: [manifestRow(updated, false)], rowsAffected: 1 };
      }

      if (input.sql.includes("ORDER BY")) {
        return {
          rows: [manifestRow(initial, false), manifestRow(second, false)],
          rowsAffected: 2,
        };
      }

      return { rows: stored ? [manifestRow(stored, false)] : [], rowsAffected: stored ? 1 : 0 };
    };
    const database = createSchemaDatabaseAdapter({
      executor: execute,
      kind: "postgres",
      transaction: async (callback) => callback({ execute }),
    });
    const repository = createDatabaseKnowledgeSpaceManifestRepository({
      database,
      maxListLimit: 2,
    });

    await expect(repository.create(initial)).resolves.toEqual(initial);
    await expect(
      repository.get({ knowledgeSpaceId: SPACE_ID_A, tenantId: TENANT_ID }),
    ).resolves.toEqual(initial);
    await expect(repository.list({ limit: 1, tenantId: TENANT_ID })).resolves.toEqual({
      items: [initial],
      nextCursor: SPACE_ID_A,
    });
    await expect(
      repository.update({
        knowledgeSpaceId: SPACE_ID_A,
        patch: {
          manifestVersion: 2,
          metadata: { rollout: "green" },
          projectionSetVersion: "projection-v2",
          updatedAt: LATER,
        },
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual(updated);

    const insert = calls.find((call) => call.operation === "insert");
    expect(insert?.sql).toContain('INSERT INTO "knowledge_space_manifests"');
    expect(insert?.sql).toContain("$12::jsonb");
    expect(insert?.sql).toContain(" RETURNING *");
    expect(insert?.sql).not.toContain(initial.parserPolicyVersion);
    expect(insert?.params).toContain(initial.parserPolicyVersion);
    expect(insert?.params).toContain(
      JSON.stringify({
        __knowledgeFsEmbeddingProfile: embeddingProfile,
        __knowledgeFsEmbeddingProfileFrozenAt: NOW,
        __knowledgeFsPendingModelConfiguration: pendingModelConfiguration,
        ...initial.metadata,
      }),
    );
    const update = calls.find((call) => call.operation === "update");
    expect(update?.sql).toContain('UPDATE "knowledge_space_manifests"');
    expect(update?.sql).toContain(" RETURNING *");
    expect(update?.params.at(-2)).toBe(TENANT_ID);
    expect(update?.params.at(-1)).toBe(SPACE_ID_A);
  });

  it("implements TiDB create/get/list/update without RETURNING and reads writes back", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const initial = manifest({ parserPolicyVersion: "tidb-parser-v1" });
    const second = manifest({
      id: MANIFEST_ID_B,
      knowledgeSpaceId: SPACE_ID_B,
      objectKeyPrefix: `${TENANT_ID}/spaces/${SPACE_ID_B}`,
    });
    const updated = KnowledgeSpaceManifestSchema.parse({
      ...initial,
      manifestVersion: 3,
      metadata: { dialect: "tidb" },
      projectionSetVersion: "projection-v3",
      updatedAt: LATER,
    });
    let stored: KnowledgeSpaceManifest | null = null;
    const execute = async (input: DatabaseExecuteInput) => {
      calls.push(input);

      if (input.tableName === "knowledge_spaces") {
        return {
          rows: [
            {
              deletion_job_id: null,
              id: input.params[1],
              lifecycle_state: "active",
            },
          ],
          rowsAffected: 1,
        };
      }

      if (input.tableName === "deletion_jobs") {
        return { rows: [], rowsAffected: 0 };
      }

      if (input.operation === "insert") {
        stored = initial;
        return { rows: [], rowsAffected: 1 };
      }

      if (input.operation === "update") {
        stored = updated;
        return { rows: [], rowsAffected: 1 };
      }

      if (input.sql.includes("ORDER BY")) {
        return { rows: [manifestRow(second, true)], rowsAffected: 1 };
      }

      return { rows: stored ? [manifestRow(stored, true)] : [], rowsAffected: stored ? 1 : 0 };
    };
    const database = createSchemaDatabaseAdapter({
      executor: execute,
      kind: "tidb",
      transaction: async (callback) => callback({ execute }),
    });
    const repository = createDatabaseKnowledgeSpaceManifestRepository({
      database,
      maxListLimit: 2,
    });

    await expect(repository.create(initial)).resolves.toEqual(initial);
    await expect(
      repository.get({ knowledgeSpaceId: SPACE_ID_A, tenantId: TENANT_ID }),
    ).resolves.toEqual(initial);
    await expect(
      repository.list({ cursor: SPACE_ID_A, limit: 1, tenantId: TENANT_ID }),
    ).resolves.toEqual({ items: [second] });
    await expect(
      repository.update({
        knowledgeSpaceId: SPACE_ID_A,
        patch: {
          id: MANIFEST_ID_B,
          knowledgeSpaceId: SPACE_ID_B,
          manifestVersion: 3,
          metadata: { dialect: "tidb" },
          projectionSetVersion: "projection-v3",
          tenantId: "other-tenant",
          updatedAt: LATER,
        },
        tenantId: TENANT_ID,
      }),
    ).resolves.toEqual(updated);

    const insertIndex = calls.findIndex((call) => call.operation === "insert");
    const updateIndex = calls.findIndex((call) => call.operation === "update");
    const insert = calls[insertIndex];
    const update = calls[updateIndex];
    expect(insert?.sql).toContain("INSERT INTO `knowledge_space_manifests`");
    expect(insert?.sql).toContain("CAST(? AS JSON)");
    expect(insert?.sql).not.toContain("RETURNING");
    expect(calls[insertIndex + 1]?.operation).toBe("select");
    expect(update?.sql).toContain("UPDATE `knowledge_space_manifests`");
    expect(update?.sql).not.toContain("RETURNING");
    expect(calls[updateIndex + 1]?.operation).toBe("select");
  });

  it("returns null when a TiDB manifest-version CAS loses a concurrent update", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const initial = manifest();
    const execute = async (input: DatabaseExecuteInput) => {
      calls.push(input);

      if (input.tableName === "knowledge_spaces") {
        return {
          rows: [
            {
              deletion_job_id: null,
              id: input.params[1],
              lifecycle_state: "active",
            },
          ],
          rowsAffected: 1,
        };
      }

      if (input.tableName === "deletion_jobs") {
        return { rows: [], rowsAffected: 0 };
      }

      if (input.operation === "update") {
        return { rows: [], rowsAffected: 0 };
      }

      return { rows: [manifestRow(initial, true)], rowsAffected: 1 };
    };
    const database = createSchemaDatabaseAdapter({
      executor: execute,
      kind: "tidb",
      transaction: async (callback) => callback({ execute }),
    });
    const repository = createDatabaseKnowledgeSpaceManifestRepository({
      database,
      maxListLimit: 2,
    });

    await expect(
      repository.update({
        expectedManifestVersion: 1,
        knowledgeSpaceId: SPACE_ID_A,
        patch: { manifestVersion: 2, updatedAt: LATER },
        tenantId: TENANT_ID,
      }),
    ).resolves.toBeNull();
    expect(
      calls.filter(
        (call) => call.operation === "select" && call.tableName === "knowledge_space_manifests",
      ),
    ).toHaveLength(1);
    const update = calls.find((call) => call.operation === "update");
    expect(update?.sql).toContain("`manifest_version` = ?");
    expect(update?.params.at(-1)).toBe(1);
  });

  it.each(["postgres", "tidb"] as const)(
    "revalidates a durable permission inside the %s manifest mutation transaction",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const initial = manifest();
      let permissionReads = 0;
      const execute = async (input: DatabaseExecuteInput) => {
        calls.push(input);

        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: SPACE_ID_A, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") {
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_permission_snapshots") {
          permissionReads += 1;
          return permissionReads === 1
            ? { rows: [permissionSnapshotRow()], rowsAffected: 1 }
            : { rows: [], rowsAffected: 0 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: "permission-lock" }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_manifests") {
          if (input.operation === "update") {
            throw new Error("manifest update must not execute after permission revocation");
          }
          return { rows: [manifestRow(initial, dialect === "tidb")], rowsAffected: 1 };
        }
        throw new Error(`Unexpected table ${input.tableName}`);
      };
      const database = createSchemaDatabaseAdapter({
        executor: execute,
        kind: dialect,
        transaction: async (callback) => callback({ execute }),
      });
      const repository = createDatabaseKnowledgeSpaceManifestRepository({
        database,
        maxListLimit: 2,
      });

      await expect(
        repository.update({
          expectedManifestVersion: 1,
          knowledgeSpaceId: SPACE_ID_A,
          patch: { manifestVersion: 2, updatedAt: LATER },
          permission: {
            fence: {
              accessChannel: "interactive",
              knowledgeSpaceId: SPACE_ID_A,
              permissionSnapshotId: MANIFEST_ID_B,
              permissionSnapshotRevision: 1,
              requestedBySubjectId: "owner-1",
              tenantId: TENANT_ID,
            },
            now: NOW,
            requiredAccess: "write",
          },
          tenantId: TENANT_ID,
        }),
      ).rejects.toMatchObject({ code: "space_access_permission_snapshot_invalid" });
      expect(calls.some((call) => call.operation === "update")).toBe(false);
      expect(calls.map((call) => call.tableName)).toEqual([
        "knowledge_spaces",
        "deletion_jobs",
        "knowledge_space_permission_snapshots",
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
        "knowledge_space_permission_snapshots",
      ]);
    },
  );
});

function permissionSnapshotRow(): Readonly<Record<string, unknown>> {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: NOW,
    expires_at: "2026-05-27T09:00:00.000Z",
    id: MANIFEST_ID_B,
    knowledge_space_id: SPACE_ID_A,
    member_revision: 1,
    permission_scopes: JSON.stringify([]),
    revision: 1,
    revoked_at: null,
    role: "owner",
    status: "active",
    subject_id: "owner-1",
    tenant_id: TENANT_ID,
    updated_at: NOW,
    visibility: "only_me",
  };
}

function manifestRow(
  value: KnowledgeSpaceManifest,
  serializeJson: boolean,
): Readonly<Record<string, unknown>> {
  const json = (input: Readonly<Record<string, unknown>>): unknown =>
    serializeJson ? JSON.stringify(input) : input;

  return {
    consistency_policy: json(value.consistencyPolicy),
    created_at: value.createdAt,
    encryption_policy: json(value.encryptionPolicy),
    id: value.id,
    knowledge_space_id: value.knowledgeSpaceId,
    manifest_version: value.manifestVersion,
    metadata: json({
      ...value.metadata,
      ...(value.embeddingProfile ? { __knowledgeFsEmbeddingProfile: value.embeddingProfile } : {}),
      ...(value.embeddingProfileFrozenAt
        ? { __knowledgeFsEmbeddingProfileFrozenAt: value.embeddingProfileFrozenAt }
        : {}),
      ...(value.pendingModelConfiguration
        ? { __knowledgeFsPendingModelConfiguration: value.pendingModelConfiguration }
        : {}),
    }),
    metadata_dialect: value.metadataDialect,
    min_client_version: value.minClientVersion,
    node_schema_version: value.nodeSchemaVersion,
    object_key_prefix: value.objectKeyPrefix,
    parser_policy_version: value.parserPolicyVersion,
    projection_set_version: value.projectionSetVersion,
    quota_policy: json(value.quotaPolicy),
    retention_policy: json(value.retentionPolicy),
    storage_provider: value.storageProvider,
    tenant_id: value.tenantId,
    updated_at: value.updatedAt,
  };
}
