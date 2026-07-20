import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  KnowledgeSpaceEmbeddingProfile,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import {
  KnowledgeSpaceProfileHeadConflictError,
  KnowledgeSpaceProfileSnapshotCorruptionError,
  KnowledgeSpaceProfileTransitionError,
  createDatabaseKnowledgeSpaceProfileRepository,
  knowledgeSpaceProfileSnapshotDigest,
} from "./knowledge-space-profile-repository";

const TENANT_ID = "tenant-profile-test";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const REVISION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const HEAD_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
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
