import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import type { NewSourceWorkflowRun } from "./source-product-workflow";
import { createDatabaseSourceProductWorkflowRepository } from "./source-product-workflow-database-repository";

const tenantId = "tenant-source";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const runId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const childRunId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const deletionJobId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c47";
const itemId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const leaseToken = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const permissionSnapshotId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const now = "2026-07-14T12:00:00.000Z";

describe.each(["postgres", "tidb"] as const)(
  "database source-product workflow repository (%s)",
  (dialect) => {
    it("applies frozen candidate ACL before LIMIT", async () => {
      let select: DatabaseExecuteInput | undefined;
      const database = testDatabase(dialect, async (input) => {
        select = input;
        return empty();
      });
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      await repository.listRuns({
        candidateGrants: ["team:camera"],
        cursor: runId,
        knowledgeSpaceId,
        limit: 5,
        tenantId,
      });

      expect(select?.params.slice(0, 3)).toEqual([
        tenantId,
        knowledgeSpaceId,
        JSON.stringify(["team:camera"]),
      ]);
      const sql = select?.sql ?? "";
      const acl = dialect === "postgres" ? "::jsonb @>" : "JSON_CONTAINS";
      expect(sql).toContain(acl);
      expect(sql.indexOf(acl)).toBeLessThan(sql.indexOf("ORDER BY"));
      expect(sql.indexOf(acl)).toBeLessThan(sql.indexOf("LIMIT"));
    });

    it("applies bulk requester, provenance, and candidate ACL predicates before LIMIT", async () => {
      let select: DatabaseExecuteInput | undefined;
      const database = testDatabase(dialect, async (input) => {
        select = input;
        return empty();
      });
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      await repository.listAuthorizedBulkItems({
        accessChannel: "interactive",
        candidateGrants: ["team:camera"],
        cursor: itemId,
        knowledgeSpaceId,
        limit: 5,
        permissionSnapshotId,
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "editor-a",
        runId,
        tenantId,
      });

      expect(select?.params).toEqual([
        tenantId,
        knowledgeSpaceId,
        runId,
        "editor-a",
        "interactive",
        permissionSnapshotId,
        1,
        JSON.stringify(["team:camera"]),
        itemId,
        6,
      ]);
      const sql = select?.sql ?? "";
      const predicates = [
        "requested_by_subject_id",
        "access_channel",
        "permission_snapshot_id",
        "permission_snapshot_revision",
        dialect === "postgres" ? "::jsonb @>" : "JSON_CONTAINS",
      ];
      expect(sql).toContain("INNER JOIN");
      expect(sql).toContain("tenant_id");
      expect(sql).toContain("knowledge_space_id");
      for (const predicate of predicates) {
        expect(sql.indexOf(predicate), predicate).toBeGreaterThanOrEqual(0);
        expect(sql.indexOf(predicate), predicate).toBeLessThan(sql.indexOf("ORDER BY"));
        expect(sql.indexOf(predicate), predicate).toBeLessThan(sql.indexOf("LIMIT"));
      }
    });

    it("stores and looks up a fixed full-value idempotency digest", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = orderedMutationDatabase(dialect, calls, sourceRunRow("running"), true);
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      await repository.start(newSourceRun());

      const lookup = calls.find(
        (call) =>
          call.tableName === "source_workflow_runs" &&
          call.operation === "select" &&
          call.sql.includes("idempotency_digest"),
      );
      const insert = calls.find(
        (call) => call.tableName === "source_workflow_runs" && call.operation === "insert",
      );
      expect(lookup?.params).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/u)]);
      expect(insert?.sql).toContain("idempotency_key");
      expect(insert?.sql).toContain("idempotency_digest");
      expect(insert?.params[18]).toBe("sync-test");
      expect(insert?.params[19]).toBe(lookup?.params[0]);
    });

    it("verifies the original idempotency tuple after digest lookup", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = orderedMutationDatabase(
        dialect,
        calls,
        { ...sourceRunRow("running"), idempotency_key: "digest-collision" },
        false,
      );
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      await expect(repository.start(newSourceRun())).rejects.toMatchObject({
        code: "SOURCE_WORKFLOW_IDEMPOTENCY_CONFLICT",
      });
      expect(
        calls.some(
          (call) => call.tableName === "source_workflow_runs" && call.operation === "insert",
        ),
      ).toBe(false);
    });

    it("persists unavailable bulk items as skipped without locking a missing source", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") return activeSpace();
        if (input.tableName === "deletion_jobs") return empty();
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow()], rowsAffected: 1 };
        }
        if (isAccessLock(input.tableName)) return oneRow(input.tableName);
        if (
          input.tableName === "source_workflow_runs" &&
          input.operation === "select" &&
          input.sql.includes("idempotency_digest")
        ) {
          return empty();
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      const run = await repository.startBulk({
        items: [
          {
            action: "disable",
            id: itemId,
            reason: "source-not-found",
            runId,
            sourceId: "source-unavailable",
            status: "skipped",
            updatedAt: now,
          },
        ],
        run: newBulkRun(),
      });

      expect(run).toMatchObject({ progressSkipped: 1, progressTotal: 1 });
      expect(calls.some((call) => call.tableName === "sources")).toBe(false);
      const runInsert = calls.find(
        (call) => call.tableName === "source_workflow_runs" && call.operation === "insert",
      );
      const itemInsert = calls.find(
        (call) => call.tableName === "source_bulk_workflow_items" && call.operation === "insert",
      );
      expect(runInsert?.params[12]).toBe(1);
      expect(itemInsert?.params).toEqual(
        expect.arrayContaining(["source-unavailable", "skipped", "source-not-found"]),
      );
    });

    it("does not claim a deferred delivery before outbox available_at", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        return empty();
      });
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      await repository.claim({
        leaseExpiresAt: "2026-07-14T12:05:00.000Z",
        limit: 10,
        now,
        workerId: "source-worker",
      });

      const claim = calls.find(
        (call) => call.tableName === "source_workflow_runs" && call.sql.includes("INNER JOIN"),
      );
      expect(claim?.sql).toMatch(/available_at[`"]?\s*<=/u);
      expect(claim?.sql.indexOf("available_at")).toBeLessThan(claim?.sql.indexOf("LIMIT") ?? -1);
    });

    it("round-trips durable child identity and atomically defers the parent lease", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const parent = runRow();
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "source_bulk_workflow_items" && input.operation === "select") {
          return {
            rows: [
              {
                action: "sync",
                child_run_id: childRunId,
                error_code: null,
                id: itemId,
                reason: null,
                run_id: runId,
                source_id: sourceId,
                status: "running",
                updated_at: now,
              },
            ],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "source_workflow_runs" && input.operation === "select") {
          return { rows: [parent], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "deletion_jobs") return empty();
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow()], rowsAffected: 1 };
        }
        if (
          input.tableName === "knowledge_space_members" ||
          input.tableName === "knowledge_space_access_policies" ||
          input.tableName === "knowledge_space_api_access"
        ) {
          return { rows: [{ id: `${input.tableName}-a` }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      await expect(repository.listBulkItems({ limit: 10, runId })).resolves.toMatchObject({
        items: [{ childRunId, status: "running" }],
      });
      await expect(
        repository.defer({
          availableAt: "2026-07-14T12:00:10.000Z",
          fence: { leaseToken, rowVersion: 7, runId, workerId: "source-worker" },
          now,
        }),
      ).resolves.toMatchObject({
        cursor: undefined,
        executionAttempts: 1,
        state: "queued",
      });

      const release = calls.find(
        (call) => call.tableName === "source_workflow_outbox" && call.operation === "update",
      );
      expect(release?.params).toEqual(["2026-07-14T12:00:10.000Z", now, runId, leaseToken]);
      expect(release?.sql).toContain("'pending'");
      expect(release?.sql).toContain("lock_token");
    });

    it("terminalizes a queued run instead of leasing it after durable permission revocation", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const queued = {
        ...runRow(),
        active_slot: 1,
        cursor: null,
        execution_attempts: 0,
        lease_expires_at: null,
        lease_token: null,
        run_state: "queued",
        worker_id: null,
      };
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "source_workflow_runs" && input.operation === "select") {
          return { rows: [queued], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_spaces") return activeSpace();
        if (input.tableName === "deletion_jobs") return empty();
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return input.sql.includes("INNER JOIN")
            ? empty()
            : { rows: [permissionRow()], rowsAffected: 1 };
        }
        if (isAccessLock(input.tableName)) return oneRow(input.tableName);
        if (input.tableName === "source_workflow_outbox" && input.operation === "select") {
          return { rows: [{ id: "outbox-a" }], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      await expect(
        repository.claim({
          leaseExpiresAt: "2026-07-14T12:05:00.000Z",
          limit: 1,
          now,
          workerId: "source-worker",
        }),
      ).resolves.toEqual([]);

      const terminal = calls.find(
        (call) => call.tableName === "source_workflow_runs" && call.operation === "update",
      );
      expect(terminal?.params).toContain("SOURCE_WORKFLOW_PERMISSION_INVALID");
      expect(
        calls.filter(
          (call) => call.tableName === "source_workflow_runs" && call.operation === "update",
        ),
      ).toHaveLength(1);
      expect(
        calls.some(
          (call) =>
            call.tableName === "source_workflow_outbox" &&
            call.operation === "update" &&
            call.params[0] === "source-worker",
        ),
      ).toBe(false);
    });

    it("fails closed when the current source scope is tightened before a worker mutation", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const running = sourceRunRow("running");
      let activity: DatabaseRow | undefined;
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "source_workflow_runs" && input.operation === "select") {
          return { rows: [running], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_spaces") return activeSpace();
        if (input.tableName === "deletion_jobs") return empty();
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow(["team:camera"])], rowsAffected: 1 };
        }
        if (isAccessLock(input.tableName)) return oneRow(input.tableName);
        if (input.tableName === "sources") {
          return { rows: [sourceRow(["team:restricted"])], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_space_activity_events") {
          if (input.operation === "insert") {
            activity = activityRow(input.params);
            return { rows: [], rowsAffected: 1 };
          }
          return activity ? { rows: [activity], rowsAffected: 1 } : empty();
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      await expect(
        repository.checkpoint({
          checkpoint: "provider-read",
          fence: { leaseToken, rowVersion: 7, runId, workerId: "source-worker" },
          now,
          state: "syncing",
        }),
      ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_PERMISSION_INVALID" });
      expect(
        calls.some(
          (call) =>
            call.tableName === "source_workflow_runs" &&
            call.operation === "select" &&
            call.sql.includes("FOR UPDATE"),
        ),
      ).toBe(false);
      expect(
        calls.some(
          (call) => call.tableName === "source_workflow_runs" && call.operation === "update",
        ),
      ).toBe(false);

      calls.length = 0;
      await expect(
        repository.fail({
          errorCode: "SOURCE_WORKFLOW_PERMISSION_INVALID",
          errorMessage: "current source scope was tightened",
          fence: { leaseToken, rowVersion: 7, runId, workerId: "source-worker" },
          now,
        }),
      ).resolves.toMatchObject({
        lastErrorCode: "SOURCE_WORKFLOW_PERMISSION_INVALID",
        state: "failed",
      });
      expect(
        calls.some(
          (call) =>
            call.tableName === "source_workflow_runs" &&
            call.operation === "update" &&
            call.params.includes("SOURCE_WORKFLOW_PERMISSION_INVALID"),
        ),
      ).toBe(true);
    });

    it("loses the deletion race before taking permission, source, or run mutation locks", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const running = sourceRunRow("running");
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "source_workflow_runs" && input.operation === "select") {
          return { rows: [running], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_spaces") {
          return {
            rows: [
              { deletion_job_id: "delete-a", id: knowledgeSpaceId, lifecycle_state: "deleting" },
            ],
            rowsAffected: 1,
          };
        }
        return empty();
      });
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      await expect(
        repository.checkpoint({
          checkpoint: "provider-read",
          fence: { leaseToken, rowVersion: 7, runId, workerId: "source-worker" },
          now,
          state: "syncing",
        }),
      ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_SPACE_NOT_WRITABLE" });
      expect(
        calls.some(
          (call) =>
            call.tableName === "knowledge_space_permission_snapshots" ||
            call.tableName === "sources" ||
            (call.tableName === "source_workflow_runs" && call.sql.includes("FOR UPDATE")),
        ),
      ).toBe(false);
    });

    it("uses space-access-source-run lock order for start, worker mutation, cancel, and retry", async () => {
      const operations = [
        {
          invoke: async (
            repository: ReturnType<typeof createDatabaseSourceProductWorkflowRepository>,
          ) => repository.start(newSourceRun()),
          name: "start",
          row: sourceRunRow("running"),
        },
        {
          invoke: async (
            repository: ReturnType<typeof createDatabaseSourceProductWorkflowRepository>,
          ) =>
            repository.checkpoint({
              checkpoint: "provider-read",
              fence: { leaseToken, rowVersion: 7, runId, workerId: "source-worker" },
              now,
              state: "syncing",
            }),
          name: "checkpoint",
          row: sourceRunRow("running"),
        },
        {
          invoke: async (
            repository: ReturnType<typeof createDatabaseSourceProductWorkflowRepository>,
          ) =>
            repository.cancel({
              accessChannel: "interactive",
              now,
              permissionSnapshotId,
              permissionSnapshotRevision: 1,
              reason: "test",
              requestedBySubjectId: "editor-a",
              runId,
            }),
          name: "cancel",
          row: sourceRunRow("running"),
        },
        {
          invoke: async (
            repository: ReturnType<typeof createDatabaseSourceProductWorkflowRepository>,
          ) =>
            repository.retry({
              accessChannel: "interactive",
              now,
              permissionSnapshotId,
              permissionSnapshotRevision: 1,
              requestedBySubjectId: "editor-a",
              runId,
            }),
          name: "retry",
          row: sourceRunRow("failed"),
        },
        {
          invoke: async (
            repository: ReturnType<typeof createDatabaseSourceProductWorkflowRepository>,
          ) =>
            repository.selectCrawlPages({
              accessChannel: "interactive",
              idempotencyKey: "selection-a",
              now,
              pageIds: ["page-a"],
              permissionSnapshotId,
              permissionSnapshotRevision: 1,
              requestedBySubjectId: "editor-a",
              runId,
            }),
          name: "select",
          row: sourceRunRow("preview_ready"),
        },
      ] as const;

      for (const operation of operations) {
        const calls: DatabaseExecuteInput[] = [];
        const database = orderedMutationDatabase(
          dialect,
          calls,
          operation.row,
          operation.name === "start",
        );
        const repository = createDatabaseSourceProductWorkflowRepository({ database });
        await operation.invoke(repository);
        expectLockOrder(calls, operation.name, [
          "knowledge_spaces",
          "deletion_jobs",
          "knowledge_space_permission_snapshots",
          "knowledge_space_members",
          "knowledge_space_access_policies",
          "knowledge_space_api_access",
          "sources",
          "source_workflow_runs",
        ]);
      }
    });

    it("locks a bulk source before its parent run and child item", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const parent = runRow();
      const item = bulkItemRow("eligible");
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "source_bulk_workflow_items" && input.operation === "select") {
          return { rows: [item], rowsAffected: 1 };
        }
        if (input.tableName === "source_workflow_runs" && input.operation === "select") {
          return { rows: [parent], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_spaces") return activeSpace();
        if (input.tableName === "deletion_jobs") return empty();
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow()], rowsAffected: 1 };
        }
        if (isAccessLock(input.tableName)) return oneRow(input.tableName);
        if (input.tableName === "sources") {
          return { rows: [sourceRow([])], rowsAffected: 1 };
        }
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseSourceProductWorkflowRepository({
        database,
        generateRunId: () => childRunId,
      });

      await expect(
        repository.enqueueBulkSyncChild({
          fence: { leaseToken, rowVersion: 7, runId, workerId: "source-worker" },
          itemId,
          now,
          runId,
        }),
      ).resolves.toMatchObject({ child: { id: childRunId }, item: { status: "running" } });
      expectLockOrder(calls, "bulk-child", [
        "knowledge_spaces",
        "deletion_jobs",
        "knowledge_space_permission_snapshots",
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
        "sources",
        "source_workflow_runs",
        "source_bulk_workflow_items",
      ]);
    });

    it("persists and terminalizes a durable removal child without requiring the deleted source", async () => {
      const calls: DatabaseExecuteInput[] = [];
      let attached = false;
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "source_bulk_workflow_items" && input.operation === "select") {
          return {
            rows: [bulkItemRow(attached ? "running" : "eligible", "remove")],
            rowsAffected: 1,
          };
        }
        if (input.tableName === "source_bulk_workflow_items" && input.operation === "update") {
          if (input.params[0] === deletionJobId) attached = true;
          return { rows: [], rowsAffected: 1 };
        }
        if (input.tableName === "source_workflow_runs" && input.operation === "select") {
          return { rows: [{ ...runRow(), row_version: attached ? 8 : 7 }], rowsAffected: 1 };
        }
        if (input.tableName === "knowledge_spaces") return activeSpace();
        if (input.tableName === "deletion_jobs") return empty();
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow()], rowsAffected: 1 };
        }
        if (isAccessLock(input.tableName)) return oneRow(input.tableName);
        return { rows: [], rowsAffected: 1 };
      });
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      const attachedResult = await repository.attachBulkRemovalJob({
        deletionJobId,
        fence: { leaseToken, rowVersion: 7, runId, workerId: "source-worker" },
        itemId,
        now,
        runId,
      });
      expect(attachedResult).toMatchObject({
        item: { deletionJobId, status: "running" },
        parent: { rowVersion: 8 },
      });
      expectLockOrder(calls, "bulk-removal-attach", [
        "knowledge_spaces",
        "deletion_jobs",
        "knowledge_space_permission_snapshots",
        "knowledge_space_members",
        "knowledge_space_access_policies",
        "knowledge_space_api_access",
        "source_workflow_runs",
        "source_bulk_workflow_items",
      ]);
      expect(calls.some((call) => call.tableName === "sources")).toBe(false);

      calls.length = 0;
      await expect(
        repository.markBulkItem({
          fence: { leaseToken, rowVersion: 8, runId, workerId: "source-worker" },
          itemId,
          now,
          runId,
          status: "completed",
        }),
      ).resolves.toMatchObject({ deletionJobId, status: "completed" });
      expect(calls.some((call) => call.tableName === "sources")).toBe(false);
    });
  },
);

function runRow(): DatabaseRow {
  return {
    access_channel: "interactive",
    active_slot: 1,
    canceled_at: null,
    checkpoint: "provider-read",
    completed_at: null,
    created_at: "2026-07-14T11:00:00.000Z",
    cursor: "bulk-eof:v1",
    execution_attempts: 2,
    id: runId,
    idempotency_key: "bulk-test",
    knowledge_space_id: knowledgeSpaceId,
    kind: "bulk",
    last_error_code: null,
    last_error_message: null,
    lease_expires_at: "2026-07-14T12:05:00.000Z",
    lease_token: leaseToken,
    max_execution_attempts: 5,
    payload: JSON.stringify({ action: "sync", sourceIds: [sourceId] }),
    permission_snapshot_id: permissionSnapshotId,
    permission_snapshot_revision: 1,
    progress_completed: 0,
    progress_failed: 0,
    progress_skipped: 0,
    progress_total: 1,
    requested_by_subject_id: "editor-a",
    required_permission_scope: "[]",
    row_version: 7,
    run_state: "running",
    source_id: null,
    tenant_id: tenantId,
    updated_at: now,
    worker_id: "source-worker",
  };
}

function sourceRunRow(state: "failed" | "preview_ready" | "running"): DatabaseRow {
  const running = state === "running";
  return {
    ...runRow(),
    active_slot: state === "failed" ? null : 1,
    checkpoint: "provider-read",
    completed_at: state === "failed" ? now : null,
    cursor: null,
    execution_attempts: 1,
    idempotency_key: "sync-test",
    kind: state === "preview_ready" ? "crawl-preview" : "sync",
    lease_expires_at: running ? "2026-07-14T12:05:00.000Z" : null,
    lease_token: running ? leaseToken : null,
    payload: "{}",
    progress_total: null,
    run_state: state,
    source_id: sourceId,
    worker_id: running ? "source-worker" : null,
  };
}

function newSourceRun(): NewSourceWorkflowRun {
  return {
    accessChannel: "interactive",
    createdAt: now,
    id: runId,
    idempotencyKey: "sync-test",
    knowledgeSpaceId,
    kind: "sync",
    maxExecutionAttempts: 5,
    payload: {},
    permissionSnapshotId,
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "editor-a",
    requiredPermissionScope: [],
    sourceId,
    tenantId,
  };
}

function newBulkRun(): NewSourceWorkflowRun {
  return {
    accessChannel: "interactive",
    createdAt: now,
    id: runId,
    idempotencyKey: "bulk-test",
    knowledgeSpaceId,
    kind: "bulk",
    maxExecutionAttempts: 5,
    payload: { action: "disable", sourceIds: ["source-unavailable"] },
    permissionSnapshotId,
    permissionSnapshotRevision: 1,
    progressTotal: 1,
    requestedBySubjectId: "editor-a",
    requiredPermissionScope: [],
    tenantId,
  };
}

function sourceRow(permissionScope: readonly string[]): DatabaseRow {
  return {
    deletion_job_id: null,
    permission_scope: JSON.stringify(permissionScope),
    status: "active",
    version: 1,
  };
}

function bulkItemRow(
  status: "eligible" | "running",
  action: "remove" | "sync" = "sync",
): DatabaseRow {
  return {
    action,
    child_run_id: status === "running" && action === "sync" ? childRunId : null,
    deletion_job_id: status === "running" && action === "remove" ? deletionJobId : null,
    error_code: null,
    id: itemId,
    reason: null,
    run_id: runId,
    source_id: sourceId,
    status,
    updated_at: now,
  };
}

function activityRow(params: DatabaseExecuteInput["params"]): DatabaseRow {
  return {
    action: params[5],
    actor_subject_id: params[4],
    actor_type: params[3],
    details: params[10],
    id: params[0],
    knowledge_space_id: params[2],
    occurred_at: params[11],
    required_permission_scope: params[9],
    resource_id: params[7],
    resource_type: params[6],
    result: params[8],
    tenant_id: params[1],
  };
}

function permissionRow(permissionScopes: readonly string[] = []): DatabaseRow {
  return {
    access_channel: "interactive",
    access_policy_revision: 1,
    api_access_revision: 1,
    api_key_expires_at: null,
    api_key_id: null,
    api_key_revision: null,
    created_at: "2026-07-14T10:00:00.000Z",
    expires_at: "2026-07-15T10:00:00.000Z",
    id: permissionSnapshotId,
    knowledge_space_id: knowledgeSpaceId,
    member_revision: 1,
    permission_scopes: JSON.stringify(permissionScopes),
    revision: 1,
    revoked_at: null,
    role: "editor",
    status: "active",
    subject_id: "editor-a",
    tenant_id: tenantId,
    updated_at: "2026-07-14T10:00:00.000Z",
    visibility: "all_members",
  };
}

function activeSpace(): DatabaseExecuteResult {
  return {
    rows: [{ deletion_job_id: null, id: knowledgeSpaceId, lifecycle_state: "active" }],
    rowsAffected: 1,
  };
}

function oneRow(tableName: string): DatabaseExecuteResult {
  return { rows: [{ id: `${tableName}-a` }], rowsAffected: 1 };
}

function isAccessLock(tableName: string): boolean {
  return (
    tableName === "knowledge_space_members" ||
    tableName === "knowledge_space_access_policies" ||
    tableName === "knowledge_space_api_access"
  );
}

function orderedMutationDatabase(
  dialect: DatabaseAdapter["dialect"],
  calls: DatabaseExecuteInput[],
  row: DatabaseRow,
  idempotencyMiss: boolean,
): DatabaseAdapter {
  return testDatabase(dialect, async (input) => {
    calls.push(input);
    if (input.tableName === "knowledge_spaces") return activeSpace();
    if (input.tableName === "deletion_jobs") return empty();
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return { rows: [permissionRow()], rowsAffected: 1 };
    }
    if (isAccessLock(input.tableName)) return oneRow(input.tableName);
    if (input.tableName === "sources") {
      return { rows: [sourceRow([])], rowsAffected: 1 };
    }
    if (input.tableName === "source_workflow_runs" && input.operation === "select") {
      if (idempotencyMiss && input.sql.includes("idempotency_digest")) return empty();
      return { rows: [row], rowsAffected: 1 };
    }
    if (input.tableName === "source_workflow_outbox" && input.operation === "select") {
      return input.sql.includes("delivery_revision")
        ? { rows: [{ revision: 1 }], rowsAffected: 1 }
        : { rows: [{ id: "outbox-a" }], rowsAffected: 1 };
    }
    if (input.tableName === "source_crawl_preview_pages" && input.operation === "select") {
      return { rows: [{ page_id: "page-a" }], rowsAffected: 1 };
    }
    return { rows: [], rowsAffected: 1 };
  });
}

function expectLockOrder(
  calls: readonly DatabaseExecuteInput[],
  operation: string,
  expected: readonly string[],
): void {
  const locks = calls
    .filter((call) => call.operation === "select" && call.sql.includes("FOR UPDATE"))
    .map((call) => call.tableName);
  expect(locks.slice(0, expected.length), `${operation} lock order`).toEqual(expected);
}

function empty(): DatabaseExecuteResult {
  return { rows: [], rowsAffected: 0 };
}

function testDatabase(
  dialect: DatabaseAdapter["dialect"],
  execute: (input: DatabaseExecuteInput) => Promise<DatabaseExecuteResult>,
): DatabaseAdapter {
  const schema = createSchemaDatabaseAdapter({
    executor: execute,
    kind: dialect,
    transaction: async (callback) => callback({ execute }),
  });
  return { ...schema, execute, transaction: async (callback) => callback({ execute }) };
}
