import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
  KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceRetrievalProfile,
  KnowledgeSpaceRetrievalProfileInput,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import { KnowledgeSpaceAccessError } from "./knowledge-space-access-control";
import { createKnowledgeSpacePendingModelConfiguration } from "./knowledge-space-manifest-repository";
import {
  KnowledgeSpaceUnpublishedProfileActivationError,
  createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository,
  knowledgeSpaceProfileSnapshotDigest,
} from "./knowledge-space-profile-repository";

const TENANT_ID = "tenant-atomic-profile";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50";
const REVISION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51";
const HEAD_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52";
const PERMISSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53";
const SUBJECT_ID = "user:atomic-profile-owner";
const NOW = "2026-07-14T12:00:00.000Z";

interface AtomicState {
  activity?: Record<string, unknown> | undefined;
  heads: Record<string, Record<string, unknown>>;
  manifestVersion: number;
  metadata: Record<string, unknown>;
  permissionActive: boolean;
  published: boolean;
  revisions: Record<string, Record<string, unknown>>;
}

interface AtomicHarnessOptions {
  readonly failAfterManifestCas?: boolean | undefined;
  readonly loseAcknowledgementOnce?: boolean | undefined;
}

function embeddingProfile(
  revision = 1,
  model = "user-selected-3072",
): KnowledgeSpaceEmbeddingProfile {
  return {
    dimension: 3072,
    model,
    pluginId: "plugin-daemon-user-provider",
    provider: "user-provider",
    revision,
    vectorSpaceId: `embedding-space-sha256:${(model === "user-selected-3072" ? "a" : "b").repeat(
      64,
    )}`,
  };
}

function capabilitySnapshot(model = "user-selected-3072") {
  return {
    dimension: 3072,
    kind: "embedding",
    selection: {
      model,
      pluginId: "plugin-daemon-user-provider",
      provider: "user-provider",
    },
    verification: "verified",
  } as const;
}

function activationInput(snapshot = embeddingProfile()) {
  return {
    capabilitySnapshot: capabilitySnapshot(snapshot.model),
    createdBySubjectId: SUBJECT_ID,
    expectedManifestProfileRevision: snapshot.revision - 1,
    expectedManifestVersion: snapshot.revision,
    kind: "embedding" as const,
    knowledgeSpaceId: SPACE_ID,
    now: NOW,
    permission: {
      accessChannel: "interactive" as const,
      knowledgeSpaceId: SPACE_ID,
      permissionSnapshotId: PERMISSION_ID,
      permissionSnapshotRevision: 1,
      requestedBySubjectId: SUBJECT_ID,
      tenantId: TENANT_ID,
    },
    snapshot,
    tenantId: TENANT_ID,
  };
}

function researchRetrievalInput(): KnowledgeSpaceRetrievalProfileInput {
  return {
    defaultMode: "research",
    reasoningModel: {
      model: "reasoning-model",
      pluginId: "plugin-daemon-reasoning",
      provider: "user-provider",
    },
    rerank: { enabled: false },
    scoreThreshold: { enabled: false, stage: "mode-final" },
    topK: 10,
  };
}

function researchRetrievalProfile(): KnowledgeSpaceRetrievalProfile {
  return { ...researchRetrievalInput(), revision: 1 };
}

function initialTupleFixture() {
  const embedding = embeddingProfile();
  const retrieval = researchRetrievalProfile();
  const pending = createKnowledgeSpacePendingModelConfiguration({
    embeddingSelection: {
      model: embedding.model,
      pluginId: embedding.pluginId,
      provider: embedding.provider,
    },
    retrievalProfile: researchRetrievalInput(),
  });
  return {
    input: {
      createdBySubjectId: SUBJECT_ID,
      embedding: {
        capabilitySnapshot: capabilitySnapshot(),
        snapshot: embedding,
      },
      expectedManifestVersion: 1,
      expectedPendingConfiguration: { digest: pending.digest, revision: pending.revision },
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      permission: activationInput().permission,
      requiredAccess: "write" as const,
      retrieval: {
        capabilitySnapshot: {
          reasoning: { kind: "reasoning", selection: retrieval.reasoningModel },
          rerank: null,
          verification: "verified",
        },
        snapshot: retrieval,
      },
      tenantId: TENANT_ID,
    },
    pending,
  };
}

function createAtomicHarness(dialect: "postgres" | "tidb", options: AtomicHarnessOptions = {}) {
  const calls: Array<{
    readonly input: DatabaseExecuteInput;
    readonly lane: "outside" | "transaction";
  }> = [];
  const state: AtomicState = {
    heads: {},
    manifestVersion: 1,
    metadata: { productMetadata: "preserved" },
    permissionActive: true,
    published: false,
    revisions: {},
  };
  let loseAcknowledgement = options.loseAcknowledgementOnce === true;

  const execute = async (
    current: AtomicState,
    input: DatabaseExecuteInput,
    lane: "outside" | "transaction",
  ): Promise<DatabaseExecuteResult> => {
    calls.push({ input, lane });
    if (input.tableName === "knowledge_spaces") {
      return {
        rows: [{ deletion_job_id: null, id: SPACE_ID, lifecycle_state: "active" }],
        rowsAffected: 1,
      };
    }
    if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return current.permissionActive
        ? { rows: [permissionRow()], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    }
    if (
      input.tableName === "knowledge_space_members" ||
      input.tableName === "knowledge_space_access_policies" ||
      input.tableName === "knowledge_space_api_access"
    ) {
      return { rows: [{ id: `${input.tableName}-row` }], rowsAffected: 1 };
    }
    if (input.tableName === "projection_set_publication_heads") {
      return current.published
        ? { rows: [{ publication_id: "published-id" }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    }
    if (input.tableName === "knowledge_space_manifests") {
      if (input.operation === "select") {
        return {
          rows: [{ manifest_version: current.manifestVersion, metadata: current.metadata }],
          rowsAffected: 1,
        };
      }
      const expectedVersion = Number(input.params[5]);
      if (expectedVersion !== current.manifestVersion) return { rows: [], rowsAffected: 0 };
      current.metadata = JSON.parse(String(input.params[0])) as Record<string, unknown>;
      current.manifestVersion = Number(input.params[1]);
      return { rows: [], rowsAffected: 1 };
    }
    if (
      options.failAfterManifestCas &&
      current.manifestVersion > state.manifestVersion &&
      input.tableName === "knowledge_space_profile_revisions"
    ) {
      throw new Error("fault after manifest CAS");
    }
    if (input.tableName === "knowledge_space_profile_revisions") {
      if (input.operation === "insert") {
        const snapshot = JSON.parse(String(input.params[6])) as KnowledgeSpaceEmbeddingProfile;
        const capability = JSON.parse(String(input.params[8])) as Record<string, unknown>;
        current.revisions[`${String(input.params[3])}:${snapshot.revision}`] = {
          activated_at: null,
          capability_snapshot: capability,
          capability_snapshot_digest: input.params[9],
          created_at: input.params[18],
          created_by_subject_id: input.params[15],
          dimension: input.params[14],
          failed_at: null,
          failure_code: null,
          failure_message: null,
          id: input.params[0],
          kind: input.params[3],
          knowledge_space_id: input.params[2],
          model: input.params[12],
          plugin_id: input.params[10],
          provider: input.params[11],
          revision: input.params[4],
          snapshot,
          snapshot_digest: input.params[7],
          state: "candidate",
          superseded_at: null,
          tenant_id: input.params[1],
          updated_at: input.params[19],
          vector_space_id: input.params[13],
        };
        return { rows: [], rowsAffected: 1 };
      }
      if (input.operation === "update") {
        const id = String(input.params[2]);
        const row = Object.values(current.revisions).find((item) => item.id === id);
        if (!row) return { rows: [], rowsAffected: 0 };
        if (input.sql.includes("'superseded'")) {
          if (row.state !== "active") return { rows: [], rowsAffected: 0 };
          row.state = "superseded";
          row.superseded_at = input.params[0];
          row.updated_at = input.params[1];
          return { rows: [], rowsAffected: 1 };
        }
        if (row.state !== "candidate") return { rows: [], rowsAffected: 0 };
        row.state = "active";
        row.activated_at = input.params[0];
        row.updated_at = input.params[1];
        return { rows: [], rowsAffected: 1 };
      }
      if (input.params.length === 1) {
        const row = Object.values(current.revisions).find((item) => item.id === input.params[0]);
        return { rows: row ? [row] : [], rowsAffected: row ? 1 : 0 };
      }
      if (input.params.length === 4) {
        const row = current.revisions[`${String(input.params[2])}:${Number(input.params[3])}`];
        return { rows: row ? [row] : [], rowsAffected: row ? 1 : 0 };
      }
      if (input.sql.includes("state") && input.sql.includes("'candidate'")) {
        const row = Object.values(current.revisions).find(
          (item) => item.kind === input.params[2] && item.state === "candidate",
        );
        return { rows: row ? [row] : [], rowsAffected: row ? 1 : 0 };
      }
      if (input.sql.includes("ORDER BY")) {
        const row = Object.values(current.revisions)
          .filter((item) => item.kind === input.params[2])
          .sort((left, right) => Number(right.revision) - Number(left.revision))[0];
        return { rows: row ? [row] : [], rowsAffected: row ? 1 : 0 };
      }
    }
    if (input.tableName === "knowledge_space_profile_heads") {
      const kind = String(input.params[2] ?? input.params[6] ?? "embedding");
      if (input.operation === "insert") {
        current.heads[String(input.params[3])] = {
          active_revision: input.params[5],
          created_at: input.params[7],
          id: input.params[0],
          kind: input.params[3],
          knowledge_space_id: input.params[2],
          profile_revision_id: input.params[4],
          row_version: input.params[6],
          tenant_id: input.params[1],
          updated_at: input.params[8],
        };
        return { rows: [], rowsAffected: 1 };
      }
      if (input.operation === "update") {
        const currentHead = current.heads[String(input.params[6])];
        if (!currentHead || currentHead.row_version !== input.params[7]) {
          return { rows: [], rowsAffected: 0 };
        }
        currentHead.profile_revision_id = input.params[0];
        currentHead.active_revision = input.params[1];
        currentHead.row_version = input.params[2];
        currentHead.updated_at = input.params[3];
        return { rows: [], rowsAffected: 1 };
      }
      const currentHead = current.heads[kind];
      if (input.sql.includes("JOIN")) {
        if (!currentHead) return { rows: [], rowsAffected: 0 };
        const revision = Object.values(current.revisions).find(
          (row) => row.id === currentHead.profile_revision_id,
        );
        if (!revision) return { rows: [], rowsAffected: 0 };
        return {
          rows: [
            {
              ...revision,
              head_active_revision: currentHead.active_revision,
              head_created_at: currentHead.created_at,
              head_id: currentHead.id,
              head_profile_revision_id: currentHead.profile_revision_id,
              head_row_version: currentHead.row_version,
              head_updated_at: currentHead.updated_at,
            },
          ],
          rowsAffected: 1,
        };
      }
      return { rows: currentHead ? [currentHead] : [], rowsAffected: currentHead ? 1 : 0 };
    }
    if (input.tableName === "knowledge_space_activity_events") {
      if (input.operation === "insert") {
        current.activity = {
          action: input.params[5],
          actor_subject_id: input.params[4],
          actor_type: input.params[3],
          details: JSON.parse(String(input.params[10])),
          id: input.params[0],
          knowledge_space_id: input.params[2],
          occurred_at: input.params[11],
          required_permission_scope: JSON.parse(String(input.params[9])),
          resource_id: input.params[7],
          resource_type: input.params[6],
          result: input.params[8],
          tenant_id: input.params[1],
        };
        return { rows: [], rowsAffected: 1 };
      }
      return {
        rows: current.activity ? [current.activity] : [],
        rowsAffected: current.activity ? 1 : 0,
      };
    }
    throw new Error(`Unexpected atomic profile table ${input.tableName}`);
  };

  const database = createSchemaDatabaseAdapter({
    executor: (input) => execute(state, input, "outside"),
    kind: dialect,
    transaction: async (callback) => {
      const working = structuredClone(state);
      const result = await callback({
        execute: (input) => execute(working, input, "transaction"),
      });
      Object.assign(state, working);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new Error("simulated lost acknowledgement");
      }
      return result;
    },
  });
  return { calls, database, state };
}

function permissionRow(): DatabaseRow {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: NOW,
    expires_at: "2026-07-14T13:00:00.000Z",
    id: PERMISSION_ID,
    knowledge_space_id: SPACE_ID,
    member_revision: 1,
    permission_scopes: [],
    revision: 1,
    revoked_at: null,
    role: "owner",
    status: "active",
    subject_id: SUBJECT_ID,
    tenant_id: TENANT_ID,
    updated_at: NOW,
    visibility: "only_me",
  };
}

describe("unpublished knowledge-space profile atomic activation", () => {
  it.each(["postgres", "tidb"] as const)(
    "installs the complete first profile tuple in one %s transaction",
    async (dialect) => {
      const harness = createAtomicHarness(dialect);
      const fixture = initialTupleFixture();
      harness.state.metadata.__knowledgeFsPendingModelConfiguration = fixture.pending;
      const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
        database: harness.database,
      });

      const result = await repository.activateInitialTuple(fixture.input);

      expect(result).toMatchObject({ manifestVersion: 2, replayed: false });
      expect(result.embeddingHead?.profile.dimension).toBe(3072);
      expect(result.retrievalHead.profile.snapshot).toEqual(researchRetrievalProfile());
      expect(Object.keys(harness.state.heads).sort()).toEqual(["embedding", "retrieval"]);
      expect(Object.keys(harness.state.revisions).sort()).toEqual(["embedding:1", "retrieval:1"]);
      expect(harness.state.metadata.__knowledgeFsPendingModelConfiguration).toBeUndefined();
      expect(harness.state.metadata.__knowledgeFsEmbeddingProfile).toEqual(embeddingProfile());
      expect(harness.state.metadata.__knowledgeFsRetrievalProfile).toEqual(
        researchRetrievalProfile(),
      );
      expect(harness.calls.every((call) => call.lane === "transaction")).toBe(true);
      expect(
        harness.calls.filter(
          ({ input }) =>
            input.tableName === "knowledge_space_manifests" && input.operation === "update",
        ),
      ).toHaveLength(1);
      expect(
        harness.calls
          .filter(
            ({ input }) =>
              input.tableName === "knowledge_space_profile_revisions" &&
              input.operation === "insert",
          )
          .map(({ input }) => input.params[3]),
      ).toEqual(["embedding", "retrieval"]);
      expect(harness.calls.flatMap(({ input }) => input.params)).not.toContain(1536);
    },
  );

  it("rolls back both initial heads and keeps pending intent when tuple installation fails", async () => {
    const harness = createAtomicHarness("postgres", { failAfterManifestCas: true });
    const fixture = initialTupleFixture();
    harness.state.metadata.__knowledgeFsPendingModelConfiguration = fixture.pending;
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: harness.database,
    });

    await expect(repository.activateInitialTuple(fixture.input)).rejects.toThrow(
      "fault after manifest CAS",
    );

    expect(harness.state.manifestVersion).toBe(1);
    expect(harness.state.metadata.__knowledgeFsPendingModelConfiguration).toEqual(fixture.pending);
    expect(harness.state.metadata.__knowledgeFsEmbeddingProfile).toBeUndefined();
    expect(harness.state.metadata.__knowledgeFsRetrievalProfile).toBeUndefined();
    expect(harness.state.revisions).toEqual({});
    expect(harness.state.heads).toEqual({});
  });

  it("replays an already committed initial tuple without requiring the cleared pending record", async () => {
    const harness = createAtomicHarness("postgres");
    const fixture = initialTupleFixture();
    harness.state.metadata.__knowledgeFsPendingModelConfiguration = fixture.pending;
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: harness.database,
    });

    await repository.activateInitialTuple(fixture.input);
    const mutationCount = harness.calls.filter(
      ({ input }) => input.operation === "insert" || input.operation === "update",
    ).length;
    const replay = await repository.activateInitialTuple(fixture.input);

    expect(replay).toMatchObject({ manifestVersion: 2, replayed: true });
    expect(
      harness.calls.filter(
        ({ input }) => input.operation === "insert" || input.operation === "update",
      ),
    ).toHaveLength(mutationCount);
  });

  it.each(["postgres", "tidb"] as const)(
    "uses one transaction and the correct %s JSON SQL shape without fixing the dimension",
    async (dialect) => {
      const harness = createAtomicHarness(dialect);
      const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
        database: harness.database,
        generateHeadId: () => HEAD_ID,
        generateRevisionId: () => REVISION_ID,
      });

      const result = await repository.activate(activationInput());

      expect(result).toMatchObject({ manifestVersion: 2, replayed: false });
      expect(result.head.profile.dimension).toBe(3072);
      expect(harness.state.metadata.productMetadata).toBe("preserved");
      expect(
        (harness.state.metadata.__knowledgeFsEmbeddingProfile as { dimension: number }).dimension,
      ).toBe(3072);
      expect(harness.calls.every((call) => call.lane === "transaction")).toBe(true);
      const mutationCalls = harness.calls.filter(
        ({ input }) => input.operation === "insert" || input.operation === "update",
      );
      expect(mutationCalls.flatMap(({ input }) => input.params)).not.toContain(1536);
      const manifestUpdate = mutationCalls.find(
        ({ input }) =>
          input.tableName === "knowledge_space_manifests" && input.operation === "update",
      );
      const revisionInsert = mutationCalls.find(
        ({ input }) =>
          input.tableName === "knowledge_space_profile_revisions" && input.operation === "insert",
      );
      expect(manifestUpdate?.input.sql).toContain(
        dialect === "postgres" ? "$1::jsonb" : "CAST(? AS JSON)",
      );
      expect(revisionInsert?.input.sql).toContain(
        dialect === "postgres" ? "$7::jsonb" : "CAST(? AS JSON)",
      );
      expect(revisionInsert?.input.params).toHaveLength(23);
      expect(revisionInsert?.input.sql.match(/vector_space_id/gu)).toHaveLength(1);
      if (dialect === "postgres") {
        expect(revisionInsert?.input.sql).toContain("$23");
      } else {
        expect(revisionInsert?.input.sql.match(/\?/gu)).toHaveLength(23);
      }
      const tables = harness.calls.map(({ input }) => input.tableName);
      expect(tables.indexOf("knowledge_spaces")).toBeLessThan(
        tables.indexOf("knowledge_space_permission_snapshots"),
      );
      expect(tables.indexOf("knowledge_space_permission_snapshots")).toBeLessThan(
        harness.calls.findIndex(
          ({ input }) =>
            input.tableName === "knowledge_space_manifests" && input.operation === "update",
        ),
      );
      expect(
        harness.calls.findIndex(
          ({ input }) =>
            input.tableName === "knowledge_space_manifests" && input.operation === "update",
        ),
      ).toBeLessThan(
        harness.calls.findIndex(
          ({ input }) =>
            input.tableName === "knowledge_space_profile_revisions" && input.operation === "insert",
        ),
      );
    },
  );

  it("rolls the manifest CAS back when profile installation fails", async () => {
    const harness = createAtomicHarness("postgres", { failAfterManifestCas: true });
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: harness.database,
      generateHeadId: () => HEAD_ID,
      generateRevisionId: () => REVISION_ID,
    });

    await expect(repository.activate(activationInput())).rejects.toThrow(
      "fault after manifest CAS",
    );
    expect(harness.state.manifestVersion).toBe(1);
    expect(harness.state.metadata.__knowledgeFsEmbeddingProfile).toBeUndefined();
    expect(harness.state.revisions).toEqual({});
    expect(harness.state.heads).toEqual({});
  });

  it("materializes only the first verified embedding revision behind the ingestion freeze", async () => {
    const harness = createAtomicHarness("postgres");
    harness.state.metadata.__knowledgeFsEmbeddingProfileFrozenAt = NOW;
    const pending = createKnowledgeSpacePendingModelConfiguration({
      embeddingSelection: {
        model: "user-selected-3072",
        pluginId: "plugin-daemon-user-provider",
        provider: "user-provider",
      },
      retrievalProfile: researchRetrievalInput(),
    });
    harness.state.metadata.__knowledgeFsPendingModelConfiguration = pending;
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: harness.database,
      generateHeadId: () => HEAD_ID,
      generateRevisionId: () => REVISION_ID,
    });

    await expect(repository.activate(activationInput())).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_EMBEDDING_PROFILE_FROZEN",
    });
    await expect(
      repository.activate({
        ...activationInput(),
        expectedPendingConfiguration: { digest: pending.digest, revision: pending.revision },
        initialActivation: true,
        requiredAccess: "write",
      }),
    ).resolves.toMatchObject({ manifestVersion: 2, replayed: false });
    expect(harness.state.heads.embedding).toBeDefined();
  });

  it("rejects the initial-activation escape hatch for successor revisions", async () => {
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: createAtomicHarness("tidb").database,
    });

    await expect(
      repository.activate({
        ...activationInput(embeddingProfile(2)),
        initialActivation: true,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_INITIAL_PROFILE_ACTIVATION_INVALID" });
  });

  it("rejects a stale preflight result against the locked pending configuration", async () => {
    const harness = createAtomicHarness("postgres");
    const pending = createKnowledgeSpacePendingModelConfiguration({
      embeddingSelection: {
        model: "user-selected-3072",
        pluginId: "plugin-daemon-user-provider",
        provider: "user-provider",
      },
      retrievalProfile: researchRetrievalInput(),
    });
    harness.state.metadata.__knowledgeFsPendingModelConfiguration = pending;
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: harness.database,
    });

    await expect(
      repository.activate({
        ...activationInput(),
        expectedPendingConfiguration: { digest: "f".repeat(64), revision: 1 },
        initialActivation: true,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PENDING_CONFIGURATION_STALE" });
    expect(harness.state.manifestVersion).toBe(1);
    expect(harness.state.heads.embedding).toBeUndefined();
  });

  it("installs the final Research head and clears the exact pending config atomically", async () => {
    const harness = createAtomicHarness("tidb");
    const retrieval = researchRetrievalProfile();
    const pending = createKnowledgeSpacePendingModelConfiguration({
      retrievalProfile: researchRetrievalInput(),
    });
    harness.state.metadata.__knowledgeFsPendingModelConfiguration = pending;
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: harness.database,
      generateHeadId: () => HEAD_ID,
      generateRevisionId: () => REVISION_ID,
    });

    await expect(
      repository.activate({
        capabilitySnapshot: {
          reasoning: { kind: "reasoning", selection: retrieval.reasoningModel },
          rerank: null,
          verification: "verified",
        },
        clearPendingConfiguration: true,
        createdBySubjectId: SUBJECT_ID,
        expectedManifestProfileRevision: 0,
        expectedManifestVersion: 1,
        expectedPendingConfiguration: { digest: pending.digest, revision: pending.revision },
        kind: "retrieval",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        permission: activationInput().permission,
        snapshot: retrieval,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ manifestVersion: 2, replayed: false });
    expect(harness.state.metadata.__knowledgeFsPendingModelConfiguration).toBeUndefined();
    expect(harness.state.metadata.__knowledgeFsRetrievalProfile).toEqual(retrieval);
    expect(harness.state.heads.retrieval).toBeDefined();
  });

  it("replays the exact committed revision after a lost acknowledgement without another write", async () => {
    const harness = createAtomicHarness("tidb", { loseAcknowledgementOnce: true });
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: harness.database,
      generateHeadId: () => HEAD_ID,
      generateRevisionId: () => REVISION_ID,
    });
    await expect(repository.activate(activationInput())).rejects.toThrow(
      "simulated lost acknowledgement",
    );
    const writesAfterCommit = harness.calls.filter(
      ({ input }) => input.operation === "insert" || input.operation === "update",
    ).length;

    await expect(repository.activate(activationInput())).resolves.toMatchObject({
      manifestVersion: 2,
      replayed: true,
    });
    expect(
      harness.calls.filter(
        ({ input }) => input.operation === "insert" || input.operation === "update",
      ),
    ).toHaveLength(writesAfterCommit);
    expect(Object.keys(harness.state.revisions)).toEqual(["embedding:1"]);
  });

  it("fails closed on revoked durable permission before manifest or profile mutation", async () => {
    const harness = createAtomicHarness("postgres");
    harness.state.permissionActive = false;
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: harness.database,
    });

    await expect(repository.activate(activationInput())).rejects.toBeInstanceOf(
      KnowledgeSpaceAccessError,
    );
    expect(
      harness.calls.some(
        ({ input }) => input.operation === "insert" || input.operation === "update",
      ),
    ).toBe(false);
    expect(harness.state.manifestVersion).toBe(1);
  });

  it("rejects a stale manifest CAS and a different same-revision request without partial state", async () => {
    const harness = createAtomicHarness("postgres");
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: harness.database,
      generateHeadId: () => HEAD_ID,
      generateRevisionId: () => REVISION_ID,
    });
    await repository.activate(activationInput());
    const committedDigest = knowledgeSpaceProfileSnapshotDigest(
      harness.state.metadata.__knowledgeFsEmbeddingProfile,
    );
    const conflicting = activationInput(embeddingProfile(2, "different-model"));
    const stale = { ...conflicting, expectedManifestVersion: 1 };

    await expect(repository.activate(stale)).rejects.toBeInstanceOf(
      KnowledgeSpaceUnpublishedProfileActivationError,
    );
    expect(harness.state.manifestVersion).toBe(2);
    expect(
      knowledgeSpaceProfileSnapshotDigest(harness.state.metadata.__knowledgeFsEmbeddingProfile),
    ).toBe(committedDigest);
    expect(Object.keys(harness.state.revisions)).toEqual(["embedding:1"]);
  });

  it("refuses an unpublished inline write after a publication head wins the space lock", async () => {
    const harness = createAtomicHarness("tidb");
    harness.state.published = true;
    const repository = createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
      database: harness.database,
    });

    await expect(repository.activate(activationInput())).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_PUBLISHED",
    });
    expect(harness.state.manifestVersion).toBe(1);
    expect(harness.calls.some(({ input }) => input.tableName === "knowledge_space_manifests")).toBe(
      false,
    );
  });
});
