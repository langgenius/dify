import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type { DatabaseAdapter, DatabaseExecuteInput, DatabaseExecuteResult } from "@knowledge/core";
import { describe, expect, it } from "vitest";

import type { FrozenQualityRuntimeSnapshot, QualityPermissionBinding } from "./quality-control";
import {
  QualityControlIdempotencyConflictError,
  createDatabaseQualityControlRepository,
} from "./quality-control-database-repository";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const RUN_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const OUTBOX_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const PERMISSION_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const NOW = "2026-07-14T15:00:00.000Z";

function fixedQualityId(seed: number): () => string {
  let next = seed;
  return () => `00000000-0000-4000-8000-${(next++).toString(16).padStart(12, "0")}`;
}

describe("database quality-control repository", () => {
  it.each(["postgres", "tidb"] as const)(
    "applies exact subject and candidate ACL before trace LIMIT on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "answer_traces") {
          return {
            rows: [
              {
                completed: dialect === "tidb" ? "0" : false,
                created_at: NOW,
                evidence_bundle_id: null,
                evidence_items: [],
                evidence_state: null,
                id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46",
                mode: "fast",
                query: "camera evidence",
              },
            ],
            rowsAffected: 1,
          };
        }
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        maxListLimit: 100,
      });

      const page = await repository.listTraces({
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        knowledgeSpaceId: SPACE_ID,
        limit: 10,
        subjectId: "editor-1",
        tenantId: "tenant-1",
      });

      expect(page.items[0]?.completed).toBe(false);
      const call = calls.find((candidate) => candidate.tableName === "answer_traces");
      expect(call?.params.slice(0, 4)).toEqual([
        "tenant-1",
        SPACE_ID,
        "editor-1",
        JSON.stringify(["tenant:tenant-1", "subject:editor-1"]),
      ]);
      expect(call?.sql).toContain("subject_id");
      expect(call?.sql).toMatch(/permission\.(?:"tenant_id"|`tenant_id`)\s*=\s*(?:\$1|\?)/u);
      expect(call?.sql).toContain(dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS");
      expect(
        call?.sql.indexOf(dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS"),
      ).toBeLessThan(call?.sql.indexOf("LIMIT") ?? 0);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "applies replay candidate ACL before LIMIT on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await repository.listReplays({
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        knowledgeSpaceId: SPACE_ID,
        limit: 5,
        subjectId: "editor-1",
        tenantId: "tenant-1",
      });

      const call = calls[0];
      const aclOperator = dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS";
      expect(call?.sql).toContain(aclOperator);
      expect(call?.sql.indexOf(aclOperator)).toBeLessThan(call?.sql.indexOf("LIMIT") ?? 0);
      expect(call?.params.slice(0, 4)).toEqual([
        "tenant-1",
        SPACE_ID,
        "editor-1",
        JSON.stringify(["tenant:tenant-1", "subject:editor-1"]),
      ]);
      expect(call?.sql).toContain("requested_by_subject_id");
      expect(call?.sql.indexOf("requested_by_subject_id")).toBeLessThan(
        call?.sql.indexOf("LIMIT") ?? 0,
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "conceals every public quality resource by exact requester before LIMIT or history ordering on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });
      const scope = {
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        knowledgeSpaceId: SPACE_ID,
        subjectId: "editor-1",
        tenantId: "tenant-1",
      } as const;

      await repository.getBadCase({ ...scope, id: "bad-case-1" });
      await repository.listBadCases({ ...scope, limit: 5 });
      await repository.getReplay({ ...scope, id: RUN_ID });
      await repository.listReplays({ ...scope, limit: 5 });
      await repository.getMissingReview({ ...scope, itemKey: "missing-1", traceId: "trace-1" });
      await repository.listHistory({
        ...scope,
        aggregateId: "bad-case-1",
        aggregateType: "bad-case",
        limit: 5,
      });

      const publicReads = calls.filter((call) =>
        [
          "quality_bad_cases",
          "quality_missing_evidence_reviews",
          "quality_replay_runs",
          "quality_resource_history",
        ].includes(call.tableName),
      );
      expect(publicReads).toHaveLength(6);
      for (const call of publicReads) {
        expect(call.params).toContain("editor-1");
        expect(call.sql).toMatch(/(?:actor_subject_id|requested_by_subject_id|subject_id)/u);
        const boundary = call.sql.includes("LIMIT")
          ? call.sql.indexOf("LIMIT")
          : call.sql.indexOf("ORDER BY");
        const subjectIndex = Math.max(
          call.sql.indexOf("actor_subject_id"),
          call.sql.indexOf("requested_by_subject_id"),
          call.sql.indexOf("subject_id"),
        );
        expect(subjectIndex).toBeGreaterThanOrEqual(0);
        expect(subjectIndex).toBeLessThan(boundary);
      }
      const missingReview = publicReads.find(
        (call) => call.tableName === "quality_missing_evidence_reviews",
      );
      const aclOperator = dialect === "postgres" ? "jsonb_typeof" : "JSON_CONTAINS";
      expect(missingReview?.sql.match(new RegExp(aclOperator, "gu")) ?? []).toHaveLength(2);
      expect(missingReview?.sql).toMatch(
        /permission\.(?:"tenant_id"|`tenant_id`)\s*=\s*(?:\$1|\?)/u,
      );
    },
  );

  it("rejects idempotency-key reuse by a different subject before writing anything", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") {
        return { rows: [{ id: SPACE_ID }], rowsAffected: 1 };
      }
      if (input.tableName === "quality_replay_runs" && input.operation === "select") {
        return {
          rows: [
            {
              access_channel: "interactive",
              id: RUN_ID,
              request_fingerprint: `sha256:${"c".repeat(64)}`,
              requested_by_subject_id: "other-editor",
            },
          ],
          rowsAffected: 1,
        };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const repository = createDatabaseQualityControlRepository({
      database,
      maxListLimit: 100,
      now: () => NOW,
    });

    await expect(
      repository.createReplay({
        frozenSnapshot: frozenSnapshot(),
        idempotencyKey: "same-key",
        knowledgeSpaceId: SPACE_ID,
        mode: "deep",
        permission: {
          accessChannel: "interactive",
          candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
          permissionSnapshotId: PERMISSION_ID,
          permissionSnapshotRevision: 3,
          requestedBySubjectId: "editor-1",
        },
        questions: [],
        requestFingerprint: `sha256:${"c".repeat(64)}`,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(QualityControlIdempotencyConflictError);
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
  });

  it("rejects replay creation before idempotency lookup/inserts when fresh permission is revoked", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase(
      "postgres",
      async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      },
      { permissionFence: false },
    );
    const repository = createDatabaseQualityControlRepository({
      database,
      maxListLimit: 100,
      now: () => NOW,
    });

    await expect(
      repository.createReplay({
        frozenSnapshot: frozenSnapshot(),
        idempotencyKey: "revoked-create",
        knowledgeSpaceId: SPACE_ID,
        mode: "fast",
        permission: permissionBinding(),
        questions: [],
        requestFingerprint: `sha256:${"d".repeat(64)}`,
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
    expect(
      calls.some((call) => call.tableName === "quality_replay_runs" && call.operation === "select"),
    ).toBe(false);
  });

  it.each(["postgres", "tidb"] as const)(
    "creates the first replay delivery with revision one on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return input.sql.includes("idempotency_key")
            ? { rows: [], rowsAffected: 0 }
            : { rows: [replayRow({ state: "queued" })], rowsAffected: 1 };
        }
        if (input.tableName === "quality_replay_items" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        generateId: fixedQualityId(800),
        maxListLimit: 100,
        now: () => NOW,
      });

      await repository.createReplay({
        frozenSnapshot: frozenSnapshot(),
        idempotencyKey: "first-delivery",
        knowledgeSpaceId: SPACE_ID,
        mode: "deep",
        permission: permissionBinding(),
        questions: [],
        requestFingerprint: `sha256:${"a".repeat(64)}`,
        tenantId: "tenant-1",
      });

      const outbox = calls.find(
        (call) => call.tableName === "quality_replay_outbox" && call.operation === "insert",
      );
      expect(outbox?.sql).toContain("delivery_revision");
      expect(outbox?.params[2]).toBe(1);
    },
  );

  it("rejects cancellation before replay selection when current permission scopes narrowed", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      return { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseQualityControlRepository({
      database,
      maxListLimit: 100,
      now: () => NOW,
    });

    await expect(
      repository.cancelReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding({
          candidateGrants: ["tenant:tenant-1", "subject:editor-1", "team:camera"],
        }),
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
    expect(
      calls.some((call) => call.tableName === "quality_replay_runs" && call.operation === "select"),
    ).toBe(false);
    expect(calls.some((call) => call.operation === "update")).toBe(false);
  });

  it("rejects retry before replay selection/outbox creation when fresh permission is revoked", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase(
      "postgres",
      async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      },
      { permissionFence: false },
    );
    const repository = createDatabaseQualityControlRepository({
      database,
      maxListLimit: 100,
      now: () => NOW,
    });

    await expect(
      repository.retryReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        frozenSnapshot: frozenSnapshot(),
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        tenantId: "tenant-1",
      }),
    ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
    expect(
      calls.some((call) => call.tableName === "quality_replay_runs" && call.operation === "select"),
    ).toBe(false);
    expect(calls.some((call) => call.operation === "insert")).toBe(false);
    expect(calls.some((call) => call.operation === "update")).toBe(false);
  });

  it.each(["postgres", "tidb"] as const)(
    "rechecks exact active trace provenance inside the bad-case write transaction on %s",
    async (dialect) => {
      const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53";
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        maxListLimit: 100,
        now: () => NOW,
      });

      await expect(
        repository.createBadCase({
          actorSubjectId: "editor-1",
          candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
          knowledgeSpaceId: SPACE_ID,
          permission: permissionBinding(),
          reason: "bad evidence",
          tags: ["regression"],
          tenantId: "tenant-1",
          traceId,
        }),
      ).rejects.toThrow("Answer trace is not visible");
      expect(calls.some((call) => call.operation === "insert")).toBe(false);
      const traceFence = calls.find((call) => call.tableName === "answer_traces");
      expect(traceFence?.params).toEqual([
        "tenant-1",
        SPACE_ID,
        traceId,
        "editor-1",
        JSON.stringify(["tenant:tenant-1", "subject:editor-1"]),
        NOW,
      ]);
      expect(traceFence?.sql).toContain("access_channel");
      expect(traceFence?.sql).toContain("permission_snapshot_revision");
      expect(traceFence?.sql).toContain("status");
      expect(traceFence?.sql).toContain("revoked_at");
      expect(traceFence?.sql).toContain("expires_at");
      expect(traceFence?.sql).toContain("FOR UPDATE");
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "creates a bad case only after the final trace provenance fence on %s",
    async (dialect) => {
      const traceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53";
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "answer_traces") {
          return { rows: [{ id: traceId }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        generateId: fixedQualityId(700),
        maxListLimit: 100,
        now: () => NOW,
      });

      await expect(
        repository.createBadCase({
          actorSubjectId: "editor-1",
          candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
          knowledgeSpaceId: SPACE_ID,
          permission: permissionBinding(),
          reason: "bad evidence",
          tags: ["regression"],
          tenantId: "tenant-1",
          traceId,
        }),
      ).resolves.toMatchObject({ status: "open", traceId });
      const traceFence = calls.find((call) => call.tableName === "answer_traces");
      const badCaseInsert = calls.find(
        (call) => call.tableName === "quality_bad_cases" && call.operation === "insert",
      );
      expect(calls.indexOf(traceFence as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(badCaseInsert as DatabaseExecuteInput),
      );
    },
  );

  it("binds a replaying bad case only to a visible run in the exact tenant-space", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") {
        return { rows: [{ id: SPACE_ID }], rowsAffected: 1 };
      }
      if (input.tableName === "quality_bad_cases" && input.operation === "select") {
        return { rows: [badCaseRow()], rowsAffected: 1 };
      }
      if (input.tableName === "quality_replay_runs") {
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

    await expect(
      repository.updateBadCase({
        actorSubjectId: "editor-1",
        candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
        expectedRevision: 1,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        replayRunId: RUN_ID,
        status: "replaying",
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Linked replay run is not visible");
    const replayFence = calls.find((call) => call.tableName === "quality_replay_runs");
    expect(replayFence?.params).toEqual([
      "tenant-1",
      SPACE_ID,
      RUN_ID,
      "editor-1",
      JSON.stringify(["tenant:tenant-1", "subject:editor-1"]),
    ]);
    expect(replayFence?.sql).toContain("required_permission_scope");
    expect(replayFence?.sql).toContain("FOR UPDATE");
  });

  it("retries with a fresh permission and frozen publication snapshot", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase(
      "postgres",
      async (input) => {
        calls.push(input);
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return {
            rows: [replayRow({ completedAt: NOW, state: "failed" })],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "quality_replay_items" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      },
      {
        permission: {
          accessChannel: "service_api",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
          revision: 8,
          subjectId: "new-editor",
        },
      },
    );
    const repository = createDatabaseQualityControlRepository({
      database,
      maxListLimit: 100,
      now: () => NOW,
    });
    const fresh = {
      ...frozenSnapshot(),
      projectionSnapshot: { ...frozenSnapshot().projectionSnapshot, projectionVersion: 99 },
    };

    await repository.retryReplay({
      actorSubjectId: "new-editor",
      expectedRevision: 1,
      frozenSnapshot: fresh,
      id: RUN_ID,
      knowledgeSpaceId: SPACE_ID,
      permission: {
        accessChannel: "service_api",
        candidateGrants: ["tenant:tenant-1", "subject:new-editor"],
        permissionSnapshotId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
        permissionSnapshotRevision: 8,
        requestedBySubjectId: "new-editor",
      },
      tenantId: "tenant-1",
    });

    const update = calls.find(
      (call) => call.tableName === "quality_replay_runs" && call.operation === "update",
    );
    expect(update?.params.slice(0, 8)).toEqual([
      "new-editor",
      "service_api",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c51",
      8,
      JSON.stringify(["tenant:tenant-1", "subject:new-editor"]),
      JSON.stringify(fresh),
      2,
      NOW,
    ]);
    const outbox = calls.find(
      (call) => call.tableName === "quality_replay_outbox" && call.operation === "insert",
    );
    expect(outbox?.sql).toContain("delivery_revision");
    expect(outbox?.params[2]).toBe(2);
  });

  it("fails cancellation closed when the active-space deletion fence disappears", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase(
      "postgres",
      async (input) => {
        calls.push(input);
        return { rows: [], rowsAffected: 0 };
      },
      { activeSpace: false },
    );
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

    await expect(
      repository.cancelReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Quality write rejected by durable deletion");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("lifecycle_state");
    expect(calls[0]?.sql).toContain("deletion_job_id");
    expect(calls[0]?.sql).toContain("FOR UPDATE");
  });

  it("fails cancellation closed when an active deletion job owns the space", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      return input.tableName === "deletion_jobs"
        ? { rows: [{ id: "active-delete" }], rowsAffected: 1 }
        : { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

    await expect(
      repository.cancelReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        tenantId: "tenant-1",
      }),
    ).rejects.toThrow("Quality write rejected by durable deletion");
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({ operation: "select", tableName: "deletion_jobs" });
    expect(calls[1]?.sql).toContain("active_slot");
    expect(calls[1]?.sql).toContain("FOR UPDATE");
    expect(calls.some((call) => call.tableName === "knowledge_space_permission_snapshots")).toBe(
      false,
    );
  });

  it("never marks a run passed while any persisted item is non-passed", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "knowledge_spaces") {
        return { rows: [{ id: SPACE_ID }], rowsAffected: 1 };
      }
      if (input.tableName === "quality_replay_runs" && input.operation === "select") {
        return {
          rows: [
            replayRow({
              leaseExpiresAt: "2026-07-14T16:00:00.000Z",
              leaseOwner: "worker-1",
              leaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
              state: "running",
            }),
          ],
          rowsAffected: 1,
        };
      }
      if (input.tableName === "quality_replay_items" && input.operation === "select") {
        if (input.sql.includes("not_passed_count")) {
          return { rows: [{ not_passed_count: 1 }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

    await repository.completeReplay({
      expectedLeaseToken: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c52",
      id: RUN_ID,
      now: NOW,
      permissionRevoked: true,
      state: "passed",
    });

    const completion = calls.find(
      (call) => call.tableName === "quality_replay_runs" && call.operation === "update",
    );
    expect(completion?.params[0]).toBe("failed");
    expect(
      calls.find(
        (call) =>
          call.tableName === "quality_replay_items" && call.sql.includes("not_passed_count"),
      )?.sql,
    ).toContain("<> 'passed'");
  });

  it.each(["postgres", "tidb"] as const)(
    "claims a replay/outbox lease transactionally and reconstructs the frozen run on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "quality_replay_outbox" && input.operation === "select") {
          return {
            rows: [{ ...replayRow(), outbox_id: OUTBOX_ID }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return { rows: [replayRow()], rowsAffected: 1 };
        }
        if (input.tableName === "quality_replay_items" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        generateId: () => "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
        maxListLimit: 100,
      });

      const run = await repository.claimReplay({ leaseMs: 30_000, now: NOW, workerId: "worker-1" });

      expect(run).toMatchObject({ id: RUN_ID, mode: "deep", tenantId: "tenant-1" });
      expect((run as unknown as { leaseToken: string }).leaseToken).toBe(
        "018f0d60-7a49-7cc2-9c1b-5b36f18f2c49",
      );
      const claim = calls.find(
        (call) =>
          call.tableName === "quality_replay_outbox" &&
          call.operation === "select" &&
          call.sql.includes("FOR UPDATE"),
      );
      expect(claim?.sql).toContain("FOR UPDATE");
      expect(claim?.sql).toContain("lease_expires_at");
      const locate = calls.find(
        (call) =>
          call.tableName === "quality_replay_outbox" &&
          call.operation === "select" &&
          !call.sql.includes("FOR UPDATE"),
      );
      expect(locate?.sql).toContain("deletion_job_id");
      expect(locate?.sql).toContain("deletion_jobs");
      const spaceLock = calls.find((call) => call.tableName === "knowledge_spaces");
      const permissionLock = calls.find(
        (call) => call.tableName === "knowledge_space_permission_snapshots",
      );
      expect(calls.indexOf(spaceLock as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(permissionLock as DatabaseExecuteInput),
      );
      expect(calls.indexOf(permissionLock as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(claim as DatabaseExecuteInput),
      );
      const runUpdate = calls.find(
        (call) => call.tableName === "quality_replay_runs" && call.operation === "update",
      );
      expect(runUpdate?.sql).toContain("lease_token");
      expect(runUpdate?.sql).toContain("attempt");
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rejects replay claim before lease mutation when the stored durable permission is revoked on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(
        dialect,
        async (input) => {
          calls.push(input);
          if (input.tableName === "quality_replay_outbox" && input.operation === "select") {
            return { rows: [{ ...replayRow(), outbox_id: OUTBOX_ID }], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: 0 };
        },
        { permissionFence: false },
      );
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await expect(
        repository.claimReplay({ leaseMs: 30_000, now: NOW, workerId: "worker-1" }),
      ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
      expect(calls.some((call) => call.operation === "update")).toBe(false);
      expect(calls.find((call) => call.tableName === "knowledge_spaces")?.sql).toContain(
        "FOR UPDATE",
      );
      expect(calls.find((call) => call.tableName === "deletion_jobs")?.sql).toContain(
        "active_slot",
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "rejects replay item checkpoint when deletion wins before the child mutation on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(
        dialect,
        async (input) => {
          calls.push(input);
          if (input.tableName === "quality_replay_runs" && input.operation === "select") {
            return {
              rows: [
                replayRow({
                  leaseExpiresAt: "2026-07-14T16:00:00.000Z",
                  leaseOwner: "worker-1",
                  leaseToken: "lease-1",
                  state: "running",
                }),
              ],
              rowsAffected: 1,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
        { activeSpace: false },
      );
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await expect(
        repository.recordReplayItem({
          expectedLeaseToken: "lease-1",
          itemId: "item-1",
          now: NOW,
          result: {},
          runId: RUN_ID,
          state: "passed",
          traceId: "trace-1",
        }),
      ).rejects.toThrow("Quality write rejected by durable deletion");
      expect(calls.some((call) => call.operation === "update")).toBe(false);
      expect(calls.find((call) => call.tableName === "knowledge_spaces")?.sql).toContain(
        "FOR UPDATE",
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "binds a replay checkpoint to the exact subject, snapshot, trace and candidate grants on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return {
            rows: [
              replayRow({
                leaseExpiresAt: "2026-07-14T16:00:00.000Z",
                leaseOwner: "worker-1",
                leaseToken: "lease-1",
                state: "running",
              }),
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "answer_traces") {
          return { rows: [{ id: "trace-1" }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: input.operation === "update" ? 1 : 0 };
      });
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await expect(
        repository.recordReplayItem({
          expectedLeaseToken: "lease-1",
          itemId: "item-1",
          now: NOW,
          result: {},
          runId: RUN_ID,
          state: "passed",
          traceId: "trace-1",
        }),
      ).resolves.toBe(true);
      const traceFence = calls.find((call) => call.tableName === "answer_traces");
      expect(traceFence?.params).toEqual([
        "tenant-1",
        SPACE_ID,
        "trace-1",
        "editor-1",
        "interactive",
        PERMISSION_ID,
        3,
        JSON.stringify(["tenant:tenant-1", "subject:editor-1"]),
      ]);
      expect(traceFence?.sql).toContain("permission_snapshot_revision");
      expect(traceFence?.sql).toContain("FOR UPDATE");
      const itemUpdate = calls.find(
        (call) => call.tableName === "quality_replay_items" && call.operation === "update",
      );
      expect(calls.indexOf(traceFence as DatabaseExecuteInput)).toBeLessThan(
        calls.indexOf(itemUpdate as DatabaseExecuteInput),
      );
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "does not let permissionRevoked bypass the terminal replay permission fence on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(
        dialect,
        async (input) => {
          calls.push(input);
          if (input.tableName === "quality_replay_runs" && input.operation === "select") {
            return {
              rows: [
                replayRow({
                  leaseExpiresAt: "2026-07-14T16:00:00.000Z",
                  leaseOwner: "worker-1",
                  leaseToken: "lease-1",
                  state: "running",
                }),
              ],
              rowsAffected: 1,
            };
          }
          return { rows: [], rowsAffected: 0 };
        },
        { permissionFence: false },
      );
      const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

      await expect(
        repository.completeReplay({
          expectedLeaseToken: "lease-1",
          id: RUN_ID,
          now: NOW,
          permissionRevoked: true,
          state: "failed",
        }),
      ).rejects.toMatchObject({ name: "KnowledgeSpaceAccessError" });
      expect(calls.some((call) => call.operation === "update")).toBe(false);
    },
  );

  it.each(["postgres", "tidb"] as const)(
    "clears outbox lease fields when cancellation makes the event terminal on %s",
    async (dialect) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "quality_replay_runs" && input.operation === "select") {
          return { rows: [replayRow()], rowsAffected: 1 };
        }
        if (input.tableName === "quality_replay_items" && input.operation === "select") {
          return { rows: [], rowsAffected: 0 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseQualityControlRepository({
        database,
        maxListLimit: 100,
        now: () => NOW,
      });

      await repository.cancelReplay({
        actorSubjectId: "editor-1",
        expectedRevision: 1,
        id: RUN_ID,
        knowledgeSpaceId: SPACE_ID,
        permission: permissionBinding(),
        tenantId: "tenant-1",
      });

      const terminalOutbox = calls.find(
        (call) => call.tableName === "quality_replay_outbox" && call.operation === "update",
      );
      expect(terminalOutbox?.sql).toMatch(/lease_owner[`"]?\s*=\s*NULL/u);
      expect(terminalOutbox?.sql).toMatch(/lease_token[`"]?\s*=\s*NULL/u);
      expect(terminalOutbox?.sql).toMatch(/lease_expires_at[`"]?\s*=\s*NULL/u);
    },
  );

  it("bounds trend slices by tenant, subject, candidate grants, and the requested window", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      return { rows: [], rowsAffected: 0 };
    });
    const repository = createDatabaseQualityControlRepository({ database, maxListLimit: 100 });

    await repository.trends({
      candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
      from: "2026-07-07T00:00:00.000Z",
      knowledgeSpaceId: SPACE_ID,
      subjectId: "editor-1",
      tenantId: "tenant-1",
      to: "2026-07-14T00:00:00.000Z",
      topLimit: 20,
    });

    const failedCalls = calls.filter((call) => call.tableName === "failed_queries");
    expect(failedCalls).toHaveLength(3);
    for (const call of failedCalls) {
      expect(call.sql).toContain("answer_traces");
      expect(call.sql).toContain("subject_id");
      expect(call.sql).toContain("permission_scopes");
      expect(call.sql).toContain("requested_by_subject_id");
      expect(call.sql).toContain("required_permission_scope");
      expect(call.sql).toContain("permission_snapshot_revision");
      expect(call.params).toContain("tenant-1");
      expect(call.params).toContain(SPACE_ID);
      expect(call.params).toContain("editor-1");
      const boundary = call.sql.includes("GROUP BY")
        ? call.sql.indexOf("GROUP BY")
        : call.sql.indexOf(";");
      expect(call.sql.indexOf("requested_by_subject_id")).toBeLessThan(boundary);
      expect(call.sql.indexOf("required_permission_scope")).toBeLessThan(boundary);
    }
  });
});

function replayRow(
  overrides: {
    readonly completedAt?: string | null;
    readonly leaseExpiresAt?: string | null;
    readonly leaseOwner?: string | null;
    readonly leaseToken?: string | null;
    readonly state?: string;
  } = {},
) {
  return {
    access_channel: "interactive",
    attempt: 0,
    completed_at: overrides.completedAt ?? null,
    created_at: NOW,
    error_message: null,
    frozen_snapshot: frozenSnapshot(),
    id: RUN_ID,
    idempotency_key: "idem-1",
    knowledge_space_id: SPACE_ID,
    lease_expires_at: overrides.leaseExpiresAt ?? null,
    lease_owner: overrides.leaseOwner ?? null,
    lease_token: overrides.leaseToken ?? null,
    mode: "deep",
    permission_snapshot_id: PERMISSION_ID,
    permission_snapshot_revision: 3,
    request_fingerprint: `sha256:${"b".repeat(64)}`,
    requested_by_subject_id: "editor-1",
    required_permission_scope: ["tenant:tenant-1", "subject:editor-1"],
    revision: 1,
    started_at: null,
    state: overrides.state ?? "queued",
    tenant_id: "tenant-1",
    updated_at: NOW,
  };
}

function frozenSnapshot(): FrozenQualityRuntimeSnapshot {
  return {
    projectionSnapshot: {
      fingerprint: `sha256:${"a".repeat(64)}`,
      headRevision: 1,
      knowledgeSpaceId: SPACE_ID,
      projectionVersion: 1,
      publicationId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47",
      tenantId: "tenant-1",
    },
    retrievalCapabilitySnapshot: { verification: "verified" },
    retrievalProfile: {
      defaultMode: "deep",
      reasoningModel: { model: "reason", pluginId: "reason", provider: "plugin-daemon" },
      rerank: { enabled: false },
      revision: 1,
      scoreThreshold: { enabled: false, stage: "mode-final", value: 0 },
      topK: 3,
    },
  };
}

function badCaseRow() {
  return {
    actor_subject_id: "editor-1",
    created_at: NOW,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50",
    knowledge_space_id: SPACE_ID,
    reason: "bad evidence",
    replay_run_id: null,
    revision: 1,
    status: "open",
    tags: [],
    trace_id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c53",
    updated_at: NOW,
  };
}

function permissionBinding(
  overrides: Partial<QualityPermissionBinding> = {},
): QualityPermissionBinding {
  return {
    accessChannel: "interactive",
    candidateGrants: ["tenant:tenant-1", "subject:editor-1"],
    permissionSnapshotId: PERMISSION_ID,
    permissionSnapshotRevision: 3,
    requestedBySubjectId: "editor-1",
    ...overrides,
  };
}

function testDatabase(
  dialect: DatabaseAdapter["dialect"],
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
  options: {
    readonly activeSpace?: boolean;
    readonly permission?: {
      readonly accessChannel?: QualityPermissionBinding["accessChannel"];
      readonly id?: string;
      readonly revision?: number;
      readonly subjectId?: string;
    };
    readonly permissionFence?: boolean;
  } = {},
): DatabaseAdapter {
  const wrappedExecute = async (input: DatabaseExecuteInput): Promise<DatabaseExecuteResult> => {
    const result = await execute(input);
    if (input.operation !== "select") return result;
    if (input.tableName === "knowledge_spaces" && options.activeSpace !== false) {
      return {
        rows: [{ deletion_job_id: null, id: SPACE_ID, lifecycle_state: "active" }],
        rowsAffected: 1,
      };
    }
    if (options.permissionFence !== false) {
      if (input.tableName === "knowledge_space_permission_snapshots") {
        return {
          rows: [permissionFenceRow(options.permission)],
          rowsAffected: 1,
        };
      }
      if (
        input.tableName === "knowledge_space_members" ||
        input.tableName === "knowledge_space_access_policies" ||
        input.tableName === "knowledge_space_api_access"
      ) {
        return { rows: [{ id: `acl-${input.tableName}` }], rowsAffected: 1 };
      }
    }
    return result;
  };
  const adapter = createSchemaDatabaseAdapter({
    executor: wrappedExecute,
    kind: dialect,
    transaction: async (callback) => callback({ execute: wrappedExecute }),
  });
  return {
    ...adapter,
    execute: wrappedExecute,
    transaction: async (callback) => callback({ execute: wrappedExecute }),
  };
}

function permissionFenceRow(
  overrides: {
    readonly accessChannel?: QualityPermissionBinding["accessChannel"];
    readonly id?: string;
    readonly revision?: number;
    readonly subjectId?: string;
  } = {},
) {
  return {
    access_channel: overrides.accessChannel ?? "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: NOW,
    expires_at: "2099-01-01T00:00:00.000Z",
    id: overrides.id ?? PERMISSION_ID,
    knowledge_space_id: SPACE_ID,
    member_revision: 1,
    permission_scopes: ["tenant:tenant-1", `subject:${overrides.subjectId ?? "editor-1"}`],
    revision: overrides.revision ?? 3,
    revoked_at: null,
    role: "editor",
    status: "active",
    subject_id: overrides.subjectId ?? "editor-1",
    tenant_id: "tenant-1",
    updated_at: NOW,
    visibility: "all_members",
  };
}
