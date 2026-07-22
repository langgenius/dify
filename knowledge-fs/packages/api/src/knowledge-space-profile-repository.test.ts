import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  KnowledgeSpaceEmbeddingProfile,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeSpaceProfileHeadConflictError,
  type KnowledgeSpaceProfileRepository,
  KnowledgeSpaceProfileSnapshotCorruptionError,
  KnowledgeSpaceProfileTransitionError,
  createDatabaseKnowledgeSpaceProfileRepository,
  knowledgeSpaceProfileSnapshotDigest,
} from "./knowledge-space-profile-repository";

const TENANT_ID = "tenant-profile-test";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const REVISION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const HEAD_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const SECOND_REVISION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const THIRD_REVISION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const NOW = "2026-07-14T12:00:00.000Z";

function embeddingProfile(
  dimension: number | undefined,
  revision = 1,
): KnowledgeSpaceEmbeddingProfile {
  return {
    ...(dimension === undefined ? {} : { dimension }),
    model: "user-selected-embedding-model",
    pluginId: "plugin-daemon-user-provider",
    provider: "user-provider",
    revision,
    vectorSpaceId: `embedding-space-sha256:${"a".repeat(64)}`,
  };
}

function revisionRow(
  snapshot: KnowledgeSpaceEmbeddingProfile,
  state: "active" | "candidate" | "failed" = "candidate",
): Record<string, unknown> {
  const capabilitySnapshot = { dimensions: snapshot.dimension ?? null, source: "preflight" };
  return {
    activated_at: state === "active" ? NOW : null,
    capability_snapshot: capabilitySnapshot,
    capability_snapshot_digest: knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot),
    created_at: NOW,
    created_by_subject_id: "user:profile-owner",
    dimension: snapshot.dimension ?? null,
    failed_at: state === "failed" ? NOW : null,
    failure_code: state === "failed" ? "MODEL_PREFLIGHT_FAILED" : null,
    failure_message: state === "failed" ? "model rejected" : null,
    id: REVISION_ID,
    kind: "embedding",
    knowledge_space_id: SPACE_ID,
    model: snapshot.model,
    plugin_id: snapshot.pluginId,
    provider: snapshot.provider,
    revision: snapshot.revision,
    snapshot,
    snapshot_digest: knowledgeSpaceProfileSnapshotDigest(snapshot),
    state,
    superseded_at: null,
    tenant_id: TENANT_ID,
    updated_at: NOW,
    vector_space_id: snapshot.vectorSpaceId,
  };
}

function activeSpaceResult(): DatabaseExecuteResult {
  return {
    rows: [{ deletion_job_id: null, id: SPACE_ID, lifecycle_state: "active" }],
    rowsAffected: 1,
  };
}

function adapter(
  dialect: "postgres" | "tidb",
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
) {
  return createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
}

describe("knowledge-space profile repository", () => {
  it.each([
    ["postgres", 384],
    ["postgres", 3072],
    ["tidb", 384],
    ["tidb", 3072],
  ] as const)(
    "persists the user model's dynamic dimension with %s (dimension=%s)",
    async (dialect, dimension) => {
      const calls: DatabaseExecuteInput[] = [];
      const snapshot = embeddingProfile(dimension);
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") return activeSpaceResult();
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_profile_revisions") {
          if (input.operation === "insert") return { rows: [], rowsAffected: 1 };
          if (input.sql.includes("SELECT *")) {
            return { rows: [revisionRow(snapshot)], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        }
        throw new Error(`Unexpected table ${input.tableName}`);
      };
      const repository = createDatabaseKnowledgeSpaceProfileRepository({
        database: adapter(dialect, execute),
        generateRevisionId: () => REVISION_ID,
        maxListLimit: 20,
      });

      const created = await repository.createCandidate({
        capabilitySnapshot: { dimensions: dimension ?? null, source: "preflight" },
        createdBySubjectId: "user:profile-owner",
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        snapshot,
        tenantId: TENANT_ID,
      });

      expect(created.dimension).toBe(dimension);
      expect(created.vectorSpaceId).toBe(snapshot.vectorSpaceId);
      const insert = calls.find(
        (call) =>
          call.tableName === "knowledge_space_profile_revisions" && call.operation === "insert",
      );
      expect(insert?.params[14]).toBe(dimension ?? null);
      expect(insert?.params).not.toContain(1536);
      expect(insert?.sql).toContain(dialect === "postgres" ? "$7::jsonb" : "CAST(? AS JSON)");
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rejects an embedding candidate whose plugin preflight did not resolve a dimension on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const repository = createDatabaseKnowledgeSpaceProfileRepository({
        database: adapter(dialect, async (input) => {
          calls.push(input);
          return { rows: [], rowsAffected: 0 };
        }),
        maxListLimit: 20,
      });

      await expect(
        repository.createCandidate({
          capabilitySnapshot: { source: "preflight" },
          createdBySubjectId: "user:profile-owner",
          kind: "embedding",
          knowledgeSpaceId: SPACE_ID,
          now: NOW,
          snapshot: embeddingProfile(undefined),
          tenantId: TENANT_ID,
        }),
      ).rejects.toThrow("embedding profile dimension");
      expect(calls).toHaveLength(0);
    },
  );

  it("requires the first online candidate to start at revision 1", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") return activeSpaceResult();
      return { rows: [], rowsAffected: 0 };
    };
    const repository = createDatabaseKnowledgeSpaceProfileRepository({
      database: adapter("postgres", execute),
      generateRevisionId: () => REVISION_ID,
      maxListLimit: 20,
    });

    await expect(
      repository.createCandidate({
        capabilitySnapshot: { source: "preflight" },
        createdBySubjectId: "user:profile-owner",
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        snapshot: embeddingProfile(768, 2),
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceProfileTransitionError);
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("preserves an advanced first revision only for explicit legacy bootstrap", async () => {
    const snapshot = embeddingProfile(768, 4);
    const calls: DatabaseExecuteInput[] = [];
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") return activeSpaceResult();
      if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
      if (input.tableName === "knowledge_space_profile_revisions") {
        if (input.operation === "insert") return { rows: [], rowsAffected: 1 };
        if (input.sql.includes("SELECT *")) {
          return { rows: [revisionRow(snapshot)], rowsAffected: 1 };
        }
      }
      return { rows: [], rowsAffected: 0 };
    };
    const repository = createDatabaseKnowledgeSpaceProfileRepository({
      database: adapter("postgres", execute),
      generateRevisionId: () => REVISION_ID,
      maxListLimit: 20,
    });

    await expect(
      repository.createCandidate({
        capabilitySnapshot: { dimensions: 768, source: "preflight" },
        createdBySubjectId: "user:profile-owner",
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        preserveLegacyInitialRevision: true,
        snapshot,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ revision: 4, state: "candidate" });
    expect(calls.some((call) => call.operation === "insert")).toBe(true);
  });

  it.each(["postgres", "tidb"] as const)(
    "activates a candidate and installs the initial CAS head with %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const snapshot = embeddingProfile(2048);
      let activated = false;
      let activityRow: Record<string, unknown> | undefined;
      const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") return activeSpaceResult();
        if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
        if (input.tableName === "knowledge_space_profile_heads") {
          if (input.operation === "insert") return { rows: [], rowsAffected: 1 };
          if (input.sql.includes("JOIN")) {
            return {
              rows: [
                {
                  ...revisionRow(snapshot, "active"),
                  head_active_revision: 1,
                  head_created_at: NOW,
                  head_id: HEAD_ID,
                  head_profile_revision_id: REVISION_ID,
                  head_row_version: 1,
                  head_updated_at: NOW,
                },
              ],
              rowsAffected: 1,
            };
          }
          return { rows: [], rowsAffected: 0 };
        }
        if (input.tableName === "knowledge_space_profile_revisions") {
          if (input.operation === "update") {
            activated = true;
            return { rows: [], rowsAffected: 1 };
          }
          return {
            rows: [revisionRow(snapshot, activated ? "active" : "candidate")],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "knowledge_space_activity_events") {
          if (input.operation === "insert") {
            const values = input.params;
            activityRow = {
              action: values[5],
              actor_subject_id: values[4],
              actor_type: values[3],
              details: values[10],
              id: values[0],
              knowledge_space_id: values[2],
              occurred_at: values[11],
              required_permission_scope: values[9],
              resource_id: values[7],
              resource_type: values[6],
              result: values[8],
              tenant_id: values[1],
            };
            return { rows: [], rowsAffected: 1 };
          }
          return activityRow
            ? { rows: [activityRow], rowsAffected: 1 }
            : { rows: [], rowsAffected: 0 };
        }
        throw new Error(`Unexpected table ${input.tableName}`);
      };
      const repository = createDatabaseKnowledgeSpaceProfileRepository({
        database: adapter(dialect, execute),
        generateHeadId: () => HEAD_ID,
        maxListLimit: 20,
      });

      const head = await repository.activateCandidate({
        expectedActiveRevision: null,
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        revision: 1,
        tenantId: TENANT_ID,
      });

      expect(head.activeRevision).toBe(1);
      expect(head.profile.dimension).toBe(2048);
      expect(
        calls.some(
          (call) =>
            call.tableName === "knowledge_space_profile_heads" && call.operation === "insert",
        ),
      ).toBe(true);
      expect(calls.filter((call) => call.operation === "update")).toHaveLength(1);
      expect(
        calls.some(
          (call) =>
            call.tableName === "knowledge_space_activity_events" && call.operation === "insert",
        ),
      ).toBe(true);
    },
  );

  it("rejects a stale activation before mutating either revision or head", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") return activeSpaceResult();
      if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };
      if (input.tableName === "knowledge_space_profile_heads") {
        return {
          rows: [{ active_revision: 7, profile_revision_id: REVISION_ID, row_version: 4 }],
          rowsAffected: 1,
        };
      }
      throw new Error(`Unexpected call after CAS conflict: ${input.tableName}`);
    };
    const repository = createDatabaseKnowledgeSpaceProfileRepository({
      database: adapter("postgres", execute),
      maxListLimit: 20,
    });

    const activation = repository.activateCandidate({
      expectedActiveRevision: 6,
      kind: "embedding",
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: 8,
      tenantId: TENANT_ID,
    });
    await expect(activation).rejects.toBeInstanceOf(KnowledgeSpaceProfileHeadConflictError);
    await expect(activation).rejects.toMatchObject({
      actualActiveRevision: 7,
      expectedActiveRevision: 6,
    });
    expect(calls.some((call) => call.operation !== "select")).toBe(false);
  });

  it("runs the durable candidate, failure, supersession, head, and pagination lifecycle", async () => {
    const fixture = createProfileRepositoryFixture();
    const revisionIds = [REVISION_ID, SECOND_REVISION_ID, THIRD_REVISION_ID];
    const repository = createDatabaseKnowledgeSpaceProfileRepository({
      database: fixture.database,
      generateHeadId: () => HEAD_ID,
      generateRevisionId: () => revisionIds.shift() ?? THIRD_REVISION_ID,
      maxListLimit: 2,
    });
    const candidateInput = (revision: number) => ({
      capabilitySnapshot: { dimensions: 768, source: "preflight" },
      createdBySubjectId: "user:profile-owner",
      kind: "embedding" as const,
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      snapshot: embeddingProfile(768, revision),
      tenantId: TENANT_ID,
    });

    await expect(repository.createCandidate(candidateInput(1))).resolves.toMatchObject({
      id: REVISION_ID,
      revision: 1,
      state: "candidate",
    });
    await expect(
      repository.activateCandidate({
        expectedActiveRevision: null,
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ activeRevision: 1, profile: { state: "active" }, rowVersion: 1 });

    await repository.createCandidate(candidateInput(2));
    const failureInput = {
      errorCode: "MODEL_PREFLIGHT_FAILED",
      errorMessage: "model rejected",
      kind: "embedding" as const,
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: 2,
      tenantId: TENANT_ID,
    };
    await expect(repository.failCandidate(failureInput)).resolves.toMatchObject({
      failureCode: "MODEL_PREFLIGHT_FAILED",
      state: "failed",
    });
    await expect(repository.failCandidate(failureInput)).resolves.toMatchObject({
      state: "failed",
    });

    await repository.createCandidate(candidateInput(3));
    await expect(
      repository.activateCandidate({
        expectedActiveRevision: 1,
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        revision: 3,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ activeRevision: 3, profile: { state: "active" }, rowVersion: 2 });
    await expect(
      repository.getHead({ kind: "embedding", knowledgeSpaceId: SPACE_ID, tenantId: TENANT_ID }),
    ).resolves.toMatchObject({ activeRevision: 3, profileRevisionId: THIRD_REVISION_ID });
    await expect(
      repository.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ state: "superseded" });
    await expect(
      repository.listRevisions({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        limit: 2,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({
      items: [{ revision: 1 }, { revision: 2 }],
      nextRevision: 2,
    });
    await expect(
      repository.listRevisions({
        afterRevision: 2,
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        limit: 2,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ items: [{ revision: 3 }] });
    expect(fixture.calls.some((call) => call.operation === "update")).toBe(true);
  });

  it("fails closed for missing, invalid, and concurrently changed activation state", async () => {
    const missingFixture = createProfileRepositoryFixture();
    const missingRepository = createDatabaseKnowledgeSpaceProfileRepository({
      database: missingFixture.database,
      maxListLimit: 2,
    });
    await expect(
      missingRepository.activateCandidate({
        expectedActiveRevision: null,
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_REVISION_NOT_FOUND" });

    const nonCandidate = await createActiveProfileTransitionHarness();
    await expect(
      nonCandidate.repository.activateCandidate({
        expectedActiveRevision: 1,
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        now: NOW,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_SPACE_PROFILE_NOT_CANDIDATE" });

    const dangling = await createActiveProfileTransitionHarness();
    dangling.fixture.deleteRevision(1);
    await expect(activateSecondProfile(dangling.repository)).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_HEAD_DANGLING",
    });

    const invalid = await createActiveProfileTransitionHarness();
    invalid.fixture.mutateRevision(1, { state: "failed" });
    await expect(activateSecondProfile(invalid.repository)).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_HEAD_INVALID",
    });

    for (const [failure, code] of [
      ["superseded", "KNOWLEDGE_SPACE_PROFILE_ACTIVATION_CONFLICT"],
      ["active", "KNOWLEDGE_SPACE_PROFILE_ACTIVATION_CONFLICT"],
    ] as const) {
      const harness = await createActiveProfileTransitionHarness();
      harness.fixture.failNextRevisionUpdate(failure);
      await expect(activateSecondProfile(harness.repository)).rejects.toMatchObject({ code });
    }

    const headConflict = await createActiveProfileTransitionHarness();
    headConflict.fixture.failNextHeadUpdate();
    await expect(activateSecondProfile(headConflict.repository)).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_ACTIVATION_CONFLICT",
    });

    const reloadFailure = await createActiveProfileTransitionHarness();
    reloadFailure.fixture.hideNextHeadJoin();
    await expect(activateSecondProfile(reloadFailure.repository)).rejects.toThrow(
      "Activated knowledge-space profile head could not be reloaded",
    );
  });

  it("rejects pending/reload conflicts and fails only live candidates", async () => {
    const pendingFixture = createProfileRepositoryFixture();
    const ids = [REVISION_ID, SECOND_REVISION_ID];
    const pendingRepository = createDatabaseKnowledgeSpaceProfileRepository({
      database: pendingFixture.database,
      generateRevisionId: () => ids.shift() ?? SECOND_REVISION_ID,
      maxListLimit: 2,
    });
    await pendingRepository.createCandidate(profileCandidateInput(1));
    await expect(pendingRepository.createCandidate(profileCandidateInput(1))).rejects.toMatchObject(
      { code: "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_EXISTS" },
    );
    pendingFixture.failNextRevisionUpdate("failed");
    await expect(pendingRepository.failCandidate(profileFailureInput(1))).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_FAILURE_CONFLICT",
    });

    const reloadFixture = createProfileRepositoryFixture();
    reloadFixture.hideInsertedRevisionOnce(1);
    const reloadRepository = createDatabaseKnowledgeSpaceProfileRepository({
      database: reloadFixture.database,
      generateRevisionId: () => REVISION_ID,
      maxListLimit: 2,
    });
    await expect(reloadRepository.createCandidate(profileCandidateInput(1))).rejects.toThrow(
      "Created knowledge-space profile candidate could not be reloaded",
    );

    const missingFixture = createProfileRepositoryFixture();
    const missingRepository = createDatabaseKnowledgeSpaceProfileRepository({
      database: missingFixture.database,
      maxListLimit: 2,
    });
    await expect(missingRepository.failCandidate(profileFailureInput(1))).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_REVISION_NOT_FOUND",
    });

    const active = await createActiveProfileTransitionHarness();
    await expect(active.repository.failCandidate(profileFailureInput(1))).rejects.toMatchObject({
      code: "KNOWLEDGE_SPACE_PROFILE_NOT_CANDIDATE",
    });
  });

  it("detects a stored snapshot digest mismatch before returning a profile", async () => {
    const snapshot = embeddingProfile(1024);
    const execute = async (): Promise<DatabaseExecuteResult> => ({
      rows: [{ ...revisionRow(snapshot), snapshot_digest: "0".repeat(64) }],
      rowsAffected: 1,
    });
    const repository = createDatabaseKnowledgeSpaceProfileRepository({
      database: adapter("postgres", execute),
      maxListLimit: 20,
    });

    await expect(
      repository.getRevision({
        kind: "embedding",
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).rejects.toBeInstanceOf(KnowledgeSpaceProfileSnapshotCorruptionError);
  });
});

function createProfileRepositoryFixture() {
  const calls: DatabaseExecuteInput[] = [];
  const revisions = new Map<number, Record<string, unknown>>();
  const activities = new Map<string, Record<string, unknown>>();
  let head: Record<string, unknown> | undefined;
  let failedRevisionUpdate: "active" | "failed" | "superseded" | undefined;
  let failHeadUpdate = false;
  let hideHeadJoin = false;
  let hideInsertedRevision: number | undefined;
  let hiddenRevision: number | undefined;

  const execute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    calls.push({ ...input, params: [...input.params] });
    if (input.tableName === "knowledge_spaces") return activeSpaceResult();
    if (input.tableName === "deletion_jobs") return { rows: [], rowsAffected: 0 };

    if (input.tableName === "knowledge_space_profile_revisions") {
      if (input.operation === "insert") {
        const [
          id,
          tenantId,
          knowledgeSpaceId,
          kind,
          revision,
          state,
          snapshot,
          snapshotDigest,
          capabilitySnapshot,
          capabilitySnapshotDigest,
          pluginId,
          provider,
          model,
          vectorSpaceId,
          dimension,
          createdBySubjectId,
          failureCode,
          failureMessage,
          createdAt,
          updatedAt,
          activatedAt,
          supersededAt,
          failedAt,
        ] = input.params;
        revisions.set(Number(revision), {
          activated_at: activatedAt,
          capability_snapshot: parseJsonParameter(capabilitySnapshot),
          capability_snapshot_digest: capabilitySnapshotDigest,
          created_at: createdAt,
          created_by_subject_id: createdBySubjectId,
          dimension,
          failed_at: failedAt,
          failure_code: failureCode,
          failure_message: failureMessage,
          id,
          kind,
          knowledge_space_id: knowledgeSpaceId,
          model,
          plugin_id: pluginId,
          provider,
          revision,
          snapshot: parseJsonParameter(snapshot),
          snapshot_digest: snapshotDigest,
          state,
          superseded_at: supersededAt,
          tenant_id: tenantId,
          updated_at: updatedAt,
          vector_space_id: vectorSpaceId,
        });
        if (Number(revision) === hideInsertedRevision) hiddenRevision = Number(revision);
        return { rows: [], rowsAffected: 1 };
      }

      if (input.operation === "update") {
        const id = String(input.params.at(-1));
        const entry = [...revisions.entries()].find(([, row]) => row.id === id);
        if (!entry) return { rows: [], rowsAffected: 0 };
        const [revision, row] = entry;
        if (input.sql.includes("'superseded'")) {
          if (failedRevisionUpdate === "superseded") {
            failedRevisionUpdate = undefined;
            return { rows: [], rowsAffected: 0 };
          }
          if (row.state !== "active") return { rows: [], rowsAffected: 0 };
          revisions.set(revision, {
            ...row,
            state: "superseded",
            superseded_at: input.params[0],
            updated_at: input.params[1],
          });
        } else if (input.sql.includes("'active'")) {
          if (failedRevisionUpdate === "active") {
            failedRevisionUpdate = undefined;
            return { rows: [], rowsAffected: 0 };
          }
          if (row.state !== "candidate") return { rows: [], rowsAffected: 0 };
          revisions.set(revision, {
            ...row,
            activated_at: input.params[0],
            state: "active",
            updated_at: input.params[1],
          });
        } else if (input.sql.includes("'failed'")) {
          if (failedRevisionUpdate === "failed") {
            failedRevisionUpdate = undefined;
            return { rows: [], rowsAffected: 0 };
          }
          if (row.state !== "candidate") return { rows: [], rowsAffected: 0 };
          revisions.set(revision, {
            ...row,
            failed_at: input.params[2],
            failure_code: input.params[0],
            failure_message: input.params[1],
            state: "failed",
            updated_at: input.params[3],
          });
        }
        return { rows: [], rowsAffected: 1 };
      }

      if (input.params.length === 1) {
        const row = [...revisions.values()].find((candidate) => candidate.id === input.params[0]);
        return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
      }
      if (input.sql.includes("'candidate'")) {
        const row = [...revisions.values()].find((candidate) => candidate.state === "candidate");
        return {
          rows: row ? [{ id: row.id, revision: row.revision }] : [],
          rowsAffected: row ? 1 : 0,
        };
      }
      if (input.sql.includes("ORDER BY") && input.sql.includes("DESC")) {
        const row = [...revisions.values()].sort(
          (left, right) => Number(right.revision) - Number(left.revision),
        )[0];
        return {
          rows: row ? [{ revision: row.revision }] : [],
          rowsAffected: row ? 1 : 0,
        };
      }
      if (input.sql.includes("ORDER BY")) {
        const afterRevision = input.params.length === 5 ? Number(input.params[3]) : 0;
        const limit = Number(input.params.at(-1));
        const rows = [...revisions.values()]
          .filter((row) => Number(row.revision) > afterRevision)
          .sort((left, right) => Number(left.revision) - Number(right.revision))
          .slice(0, limit)
          .map((row) => ({ ...row }));
        return { rows, rowsAffected: rows.length };
      }
      const requestedRevision = Number(input.params[3]);
      if (hiddenRevision === requestedRevision) {
        hiddenRevision = undefined;
        return { rows: [], rowsAffected: 0 };
      }
      const row = revisions.get(requestedRevision);
      return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
    }

    if (input.tableName === "knowledge_space_profile_heads") {
      if (input.operation === "insert") {
        const [
          id,
          tenantId,
          knowledgeSpaceId,
          kind,
          profileRevisionId,
          activeRevision,
          rowVersion,
          createdAt,
          updatedAt,
        ] = input.params;
        head = {
          active_revision: activeRevision,
          created_at: createdAt,
          id,
          kind,
          knowledge_space_id: knowledgeSpaceId,
          profile_revision_id: profileRevisionId,
          row_version: rowVersion,
          tenant_id: tenantId,
          updated_at: updatedAt,
        };
        return { rows: [], rowsAffected: 1 };
      }
      if (input.operation === "update") {
        if (failHeadUpdate) {
          failHeadUpdate = false;
          return { rows: [], rowsAffected: 0 };
        }
        if (!head || head.row_version !== input.params[7]) {
          return { rows: [], rowsAffected: 0 };
        }
        head = {
          ...head,
          active_revision: input.params[1],
          profile_revision_id: input.params[0],
          row_version: input.params[2],
          updated_at: input.params[3],
        };
        return { rows: [], rowsAffected: 1 };
      }
      if (!head) return { rows: [], rowsAffected: 0 };
      if (!input.sql.includes("JOIN")) return { rows: [{ ...head }], rowsAffected: 1 };
      if (hideHeadJoin) {
        hideHeadJoin = false;
        return { rows: [], rowsAffected: 0 };
      }
      const profile = [...revisions.values()].find(
        (revision) => revision.id === head?.profile_revision_id,
      );
      if (!profile) return { rows: [], rowsAffected: 0 };
      return {
        rows: [
          {
            ...profile,
            head_active_revision: head.active_revision,
            head_created_at: head.created_at,
            head_id: head.id,
            head_profile_revision_id: head.profile_revision_id,
            head_row_version: head.row_version,
            head_updated_at: head.updated_at,
          },
        ],
        rowsAffected: 1,
      };
    }

    if (input.tableName === "knowledge_space_activity_events") {
      if (input.operation === "insert") {
        const values = input.params;
        activities.set(String(values[0]), {
          action: values[5],
          actor_subject_id: values[4],
          actor_type: values[3],
          details: values[10],
          id: values[0],
          knowledge_space_id: values[2],
          occurred_at: values[11],
          required_permission_scope: values[9],
          resource_id: values[7],
          resource_type: values[6],
          result: values[8],
          tenant_id: values[1],
        });
        return { rows: [], rowsAffected: 1 };
      }
      const row = activities.get(String(input.params[2]));
      return { rows: row ? [{ ...row }] : [], rowsAffected: row ? 1 : 0 };
    }

    throw new Error(`Unexpected profile repository table ${input.tableName}`);
  };

  return {
    calls,
    database: adapter("postgres", execute),
    deleteRevision: (revision: number) => revisions.delete(revision),
    failNextHeadUpdate: () => {
      failHeadUpdate = true;
    },
    failNextRevisionUpdate: (state: "active" | "failed" | "superseded") => {
      failedRevisionUpdate = state;
    },
    hideInsertedRevisionOnce: (revision: number) => {
      hideInsertedRevision = revision;
    },
    hideNextHeadJoin: () => {
      hideHeadJoin = true;
    },
    mutateRevision: (revision: number, patch: Readonly<Record<string, unknown>>) => {
      const current = revisions.get(revision);
      if (current) revisions.set(revision, { ...current, ...patch });
    },
  };
}

function parseJsonParameter(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function profileCandidateInput(revision: number) {
  return {
    capabilitySnapshot: { dimensions: 768, source: "preflight" },
    createdBySubjectId: "user:profile-owner",
    kind: "embedding" as const,
    knowledgeSpaceId: SPACE_ID,
    now: NOW,
    snapshot: embeddingProfile(768, revision),
    tenantId: TENANT_ID,
  };
}

function profileFailureInput(revision: number) {
  return {
    errorCode: "MODEL_PREFLIGHT_FAILED",
    errorMessage: "model rejected",
    kind: "embedding" as const,
    knowledgeSpaceId: SPACE_ID,
    now: NOW,
    revision,
    tenantId: TENANT_ID,
  };
}

async function createActiveProfileTransitionHarness() {
  const fixture = createProfileRepositoryFixture();
  const revisionIds = [REVISION_ID, SECOND_REVISION_ID];
  const repository = createDatabaseKnowledgeSpaceProfileRepository({
    database: fixture.database,
    generateHeadId: () => HEAD_ID,
    generateRevisionId: () => revisionIds.shift() ?? SECOND_REVISION_ID,
    maxListLimit: 2,
  });
  await repository.createCandidate(profileCandidateInput(1));
  await repository.activateCandidate({
    expectedActiveRevision: null,
    kind: "embedding",
    knowledgeSpaceId: SPACE_ID,
    now: NOW,
    revision: 1,
    tenantId: TENANT_ID,
  });
  await repository.createCandidate(profileCandidateInput(2));
  return { fixture, repository };
}

function activateSecondProfile(repository: KnowledgeSpaceProfileRepository) {
  return repository.activateCandidate({
    expectedActiveRevision: 1,
    kind: "embedding",
    knowledgeSpaceId: SPACE_ID,
    now: NOW,
    revision: 2,
    tenantId: TENANT_ID,
  });
}
