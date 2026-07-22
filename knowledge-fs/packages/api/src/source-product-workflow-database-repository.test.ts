import { createSchemaDatabaseAdapter } from "@knowledge/adapters";
import type {
  DatabaseAdapter,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseRow,
} from "@knowledge/core";
import { describe, expect, it } from "vitest";

import type {
  NewSourceWorkflowRun,
  SourceCrawlPreviewPage,
  SourceSyncPolicyRecord,
} from "./source-product-workflow";
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
const capabilityGrantId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48";
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
      expect(insert?.params[19]).toBe("sync-test");
      expect(insert?.params[20]).toBe(lookup?.params[0]);
    });

    it("persists only a capability locator for new source workflow admissions", async () => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase(dialect, async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") return activeSpace();
        if (input.tableName === "deletion_jobs") return empty();
        if (input.tableName === "capability_grants") return activeCapabilityGrant();
        if (input.tableName === "sources") {
          return { rows: [sourceRow(["team:camera"])], rowsAffected: 1 };
        }
        if (
          input.tableName === "source_workflow_runs" &&
          input.operation === "select" &&
          input.sql.includes("idempotency_digest")
        ) {
          return empty();
        }
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      });
      const repository = createDatabaseSourceProductWorkflowRepository({ database });

      await expect(repository.start(newCapabilitySourceRun())).resolves.toMatchObject({
        capabilityGrantId,
      });

      const insert = calls.find(
        (call) => call.tableName === "source_workflow_runs" && call.operation === "insert",
      );
      expect(insert?.params.slice(14, 19)).toEqual([capabilityGrantId, null, null, null, null]);
      expect(insert?.params[34]).toBeNull();
      expect(calls.some((call) => call.tableName === "knowledge_space_permission_snapshots")).toBe(
        false,
      );
    });

    it("revalidates capability source workflows at restart and terminals revoked work", async () => {
      const build = (active: boolean) => {
        const calls: DatabaseExecuteInput[] = [];
        const row = capabilitySourceRunRow();
        const database = testDatabase(dialect, async (input) => {
          calls.push(input);
          if (input.tableName === "source_workflow_runs" && input.operation === "select") {
            return { rows: [row], rowsAffected: 1 };
          }
          if (input.tableName === "knowledge_spaces") return activeSpace();
          if (input.tableName === "deletion_jobs") return empty();
          if (input.tableName === "capability_grants") {
            return active ? activeCapabilityGrant() : empty();
          }
          if (input.tableName === "sources") {
            return { rows: [sourceRow(["team:camera"])], rowsAffected: 1 };
          }
          if (input.tableName === "source_workflow_outbox" && input.operation === "select") {
            return { rows: [{ id: "outbox-capability" }], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected: input.operation === "update" ? 1 : 0 };
        });
        return {
          calls,
          repository: createDatabaseSourceProductWorkflowRepository({
            database,
            generateLeaseToken: () => leaseToken,
          }),
        };
      };

      const active = build(true);
      await expect(
        active.repository.claim({
          leaseExpiresAt: "2026-07-14T12:05:00.000Z",
          limit: 1,
          now,
          workerId: "source-worker",
        }),
      ).resolves.toEqual([
        expect.objectContaining({ capabilityGrantId, leaseToken, state: "syncing" }),
      ]);
      expect(
        active.calls.some((call) => call.tableName === "knowledge_space_permission_snapshots"),
      ).toBe(false);

      const revoked = build(false);
      await expect(
        revoked.repository.claim({
          leaseExpiresAt: "2026-07-14T12:05:00.000Z",
          limit: 1,
          now,
          workerId: "source-worker",
        }),
      ).resolves.toEqual([]);
      const terminal = revoked.calls.find(
        (call) =>
          call.tableName === "source_workflow_runs" &&
          call.operation === "update" &&
          call.params.includes("SOURCE_WORKFLOW_PERMISSION_INVALID"),
      );
      expect(terminal?.params).toContain("failed");
      expect(
        revoked.calls.some(
          (call) =>
            call.tableName === "source_workflow_runs" &&
            call.operation === "update" &&
            call.params.includes(leaseToken),
        ),
      ).toBe(false);
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

describe("database source-product workflow repository edge coverage", () => {
  it("maps and paginates every repository read model", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "source_workflow_runs") {
        return {
          rows: [fullRunRow(), { ...fullRunRow(), id: childRunId, idempotency_key: "sync-child" }],
          rowsAffected: 2,
        };
      }
      if (input.tableName === "source_crawl_preview_pages") {
        return {
          rows: [
            crawlPageRow(),
            {
              ...crawlPageRow(),
              description: null,
              etag: null,
              id: "page-row-b",
              page_id: "page-b",
              title: null,
            },
          ],
          rowsAffected: 2,
        };
      }
      if (input.tableName === "source_bulk_workflow_items") {
        return {
          rows: [
            {
              ...bulkItemRow("running"),
              deletion_job_id: deletionJobId,
              error_code: "SOURCE_ITEM_WARNING",
              reason: "retained diagnostic",
            },
            { ...bulkItemRow("eligible"), id: "bulk-item-b" },
          ],
          rowsAffected: 2,
        };
      }
      if (input.tableName === "source_sync_policies") {
        return {
          rows: [
            syncPolicyRow(),
            {
              ...syncPolicyRow(),
              custom_interval_seconds: null,
              id: "sync-policy-b",
              next_run_at: null,
              source_id: "source-b",
            },
          ],
          rowsAffected: 2,
        };
      }
      return empty();
    });
    const repository = createDatabaseSourceProductWorkflowRepository({ database });

    await expect(repository.get({ knowledgeSpaceId, runId, tenantId })).resolves.toMatchObject({
      canceledAt: now,
      id: runId,
      lastErrorCode: "SOURCE_WARNING",
    });
    await expect(
      repository.get({ knowledgeSpaceId: "another-space", runId, tenantId }),
    ).resolves.toBeNull();
    await expect(
      repository.listRuns({
        candidateGrants: [],
        knowledgeSpaceId,
        limit: 1,
        sourceId,
        tenantId,
      }),
    ).resolves.toMatchObject({ items: [{ id: runId }], nextCursor: runId });

    await expect(repository.listCrawlPages({ limit: 1, runId })).resolves.toMatchObject({
      items: [{ description: "description-a", etag: "etag-a", pageId: "page-a" }],
      nextCursor: "page-row-a",
    });
    await expect(
      repository.listCrawlPages({ cursor: "page-row-a", limit: 1, runId }),
    ).resolves.toMatchObject({ nextCursor: "page-row-a" });

    await expect(
      repository.listBulkItems({ cursor: itemId, limit: 1, runId }),
    ).resolves.toMatchObject({
      items: [
        {
          deletionJobId,
          errorCode: "SOURCE_ITEM_WARNING",
          reason: "retained diagnostic",
        },
      ],
      nextCursor: itemId,
    });
    await expect(
      repository.listAuthorizedBulkItems({
        accessChannel: "interactive",
        candidateGrants: [],
        knowledgeSpaceId,
        limit: 1,
        permissionSnapshotId,
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "editor-a",
        runId,
        tenantId,
      }),
    ).resolves.toMatchObject({ nextCursor: itemId });

    await expect(
      repository.listDueSyncPolicies({ cursor: "sync-policy-a", limit: 1, now }),
    ).resolves.toMatchObject({
      items: [{ customIntervalSeconds: 300, id: "sync-policy-a", nextRunAt: now }],
      nextCursor: "sync-policy-a",
    });
    await expect(repository.listDueSyncPolicies({ limit: 2, now })).resolves.toMatchObject({
      items: [{ id: "sync-policy-a" }, { id: "sync-policy-b" }],
    });
    await expect(
      repository.getSyncPolicy({ knowledgeSpaceId, sourceId, tenantId }),
    ).resolves.toEqual(expect.objectContaining({ id: "sync-policy-a", sourceId }));

    expect(
      calls.some(
        (call) => call.tableName === "source_workflow_runs" && call.params.includes(sourceId),
      ),
    ).toBe(true);
  });

  it("rejects invalid read and claim bounds", async () => {
    const repository = createDatabaseSourceProductWorkflowRepository({
      database: testDatabase("postgres", async () => empty()),
      maxClaimBatchSize: 2,
      maxListLimit: 2,
    });

    for (const limit of [0, 3, 1.5]) {
      await expect(
        repository.listRuns({ candidateGrants: [], knowledgeSpaceId, limit, tenantId }),
      ).rejects.toThrow("list limit");
    }
    for (const limit of [0, 3, 1.5]) {
      await expect(
        repository.claim({ leaseExpiresAt: now, limit, now, workerId: "worker-a" }),
      ).rejects.toThrow("claim limit");
    }
    expect(() => repository.enqueueDueSyncRuns({ limit: 1, maxExecutionAttempts: 0, now })).toThrow(
      "attempt budget",
    );
    expect(() => repository.enqueueDueSyncRuns({ limit: 3, maxExecutionAttempts: 1, now })).toThrow(
      "due enqueue limit",
    );
  });

  it("returns exact idempotent replays and validates bulk admission inputs", async () => {
    const replayRepository = createDatabaseSourceProductWorkflowRepository({
      database: orderedMutationDatabase("postgres", [], sourceRunRow("running"), false),
    });
    await expect(replayRepository.start(newSourceRun())).resolves.toMatchObject({
      id: runId,
      idempotencyKey: "sync-test",
    });

    const missingSpace = createDatabaseSourceProductWorkflowRepository({
      database: testDatabase("postgres", async () => empty()),
    });
    await expect(missingSpace.start(newSourceRun())).rejects.toMatchObject({
      code: "SOURCE_WORKFLOW_SPACE_NOT_WRITABLE",
    });
    await expect(
      missingSpace.startBulk({ items: [], run: { ...newBulkRun(), progressTotal: 0 } }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_SPACE_NOT_WRITABLE" });
    await expect(missingSpace.startBulk({ items: [], run: newSourceRun() })).rejects.toMatchObject({
      code: "SOURCE_WORKFLOW_STATE_CONFLICT",
    });

    const invalidItemDatabase = orderedMutationDatabase(
      "postgres",
      [],
      sourceRunRow("running"),
      true,
    );
    const invalidItemRepository = createDatabaseSourceProductWorkflowRepository({
      database: invalidItemDatabase,
    });
    await expect(
      invalidItemRepository.startBulk({
        items: [
          {
            action: "sync",
            childRunId,
            id: itemId,
            runId,
            sourceId,
            status: "eligible",
            updatedAt: now,
          },
        ],
        run: { ...newBulkRun(), payload: { action: "sync", sourceIds: [sourceId] } },
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });

    const eligibleCalls: DatabaseExecuteInput[] = [];
    const eligibleRepository = createDatabaseSourceProductWorkflowRepository({
      database: orderedMutationDatabase("postgres", eligibleCalls, runRow(), true),
    });
    await expect(
      eligibleRepository.startBulk({
        items: [
          {
            action: "sync",
            id: itemId,
            runId,
            sourceId,
            status: "eligible",
            updatedAt: now,
          },
        ],
        run: { ...newBulkRun(), payload: { action: "sync", sourceIds: [sourceId] } },
      }),
    ).resolves.toMatchObject({ progressSkipped: 0 });
    expect(
      eligibleCalls.some((call) => call.tableName === "sources" && call.operation === "select"),
    ).toBe(true);
  });

  it.each([
    { kind: "crawl-preview" as const, payload: {}, state: "crawling" },
    {
      kind: "crawl-preview" as const,
      payload: { selectedPageIds: ["page-a"] },
      state: "importing",
    },
    { kind: "bulk" as const, payload: {}, state: "running" },
    { kind: "crawl-import" as const, payload: {}, state: "importing" },
  ])("reclaims an expired $kind run as $state", async ({ kind, payload, state }) => {
    const row = expiredClaimRunRow(kind, payload);
    const repository = createDatabaseSourceProductWorkflowRepository({
      database: claimDatabase(row),
      generateLeaseToken: () => "replacement-lease",
    });

    await expect(
      repository.claim({
        leaseExpiresAt: "2026-07-14T12:05:00.000Z",
        limit: 1,
        now,
        workerId: "replacement-worker",
      }),
    ).resolves.toEqual([expect.objectContaining({ leaseToken: "replacement-lease", state })]);
  });

  it("skips stale claim candidates and fails an unexpected admission error closed", async () => {
    const base = expiredClaimRunRow("sync", {});
    for (const options of [
      { missingAdmission: true },
      { currentRow: { ...base, run_state: "completed" } },
      { missingOutbox: true },
      { updateRowsAffected: 0 },
    ]) {
      const repository = createDatabaseSourceProductWorkflowRepository({
        database: claimDatabase(base, options),
      });
      await expect(
        repository.claim({
          leaseExpiresAt: "2026-07-14T12:05:00.000Z",
          limit: 1,
          now,
          workerId: "replacement-worker",
        }),
      ).resolves.toEqual([]);
    }

    const exhausted = {
      ...base,
      execution_attempts: 5,
      max_execution_attempts: 5,
    };
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: claimDatabase(exhausted),
      }).claim({
        leaseExpiresAt: "2026-07-14T12:05:00.000Z",
        limit: 1,
        now,
        workerId: "replacement-worker",
      }),
    ).resolves.toEqual([]);

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: claimDatabase(base, { missingSpace: true }),
      }).claim({
        leaseExpiresAt: "2026-07-14T12:05:00.000Z",
        limit: 1,
        now,
        workerId: "replacement-worker",
      }),
    ).resolves.toEqual([]);

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: claimDatabase(base, { throwSpaceError: true }),
      }).claim({
        leaseExpiresAt: "2026-07-14T12:05:00.000Z",
        limit: 1,
        now,
        workerId: "replacement-worker",
      }),
    ).rejects.toThrow("space lookup failed");
  });

  it("persists heartbeat and every optional checkpoint mutation", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const repository = createDatabaseSourceProductWorkflowRepository({
      database: orderedMutationDatabase("postgres", calls, sourceRunRow("running"), false),
    });
    const fence = { leaseToken, rowVersion: 7, runId, workerId: "source-worker" };

    await expect(
      repository.heartbeat({
        fence,
        leaseExpiresAt: "2026-07-14T12:10:00.000Z",
        now,
      }),
    ).resolves.toMatchObject({ leaseExpiresAt: "2026-07-14T12:10:00.000Z", rowVersion: 8 });
    await expect(
      repository.checkpoint({
        checkpoint: "materialized",
        cursor: null,
        fence,
        now,
        progressCompleted: 4,
        progressFailed: 1,
        progressSkipped: 2,
        progressTotal: null,
        state: "syncing",
      }),
    ).resolves.toMatchObject({
      checkpoint: "materialized",
      cursor: undefined,
      progressCompleted: 4,
      progressFailed: 1,
      progressSkipped: 2,
      progressTotal: undefined,
    });
    await expect(
      repository.checkpoint({
        checkpoint: "provider-read",
        cursor: "next-page",
        fence,
        now,
        progressTotal: 8,
        state: "syncing",
      }),
    ).resolves.toMatchObject({ cursor: "next-page", progressTotal: 8 });

    expect(
      calls.filter(
        (call) => call.tableName === "source_workflow_runs" && call.operation === "update",
      ),
    ).toHaveLength(3);
  });

  it("appends crawl pages idempotently and completes preview and terminal runs", async () => {
    const page: SourceCrawlPreviewPage = {
      contentHash: "a".repeat(64),
      contentObjectKey: "source-crawl/page-a.json",
      createdAt: now,
      description: "description-a",
      etag: "etag-a",
      id: "page-row-a",
      pageId: "page-a",
      runId,
      sourceUrl: "https://example.test/a",
      title: "Page A",
    };
    const crawlRun = { ...sourceRunRow("running"), kind: "crawl-preview" };
    const crawlDatabase = testDatabase("postgres", async (input) => {
      if (input.tableName === "source_workflow_runs" && input.operation === "select") {
        return { rows: [crawlRun], rowsAffected: 1 };
      }
      if (input.tableName === "knowledge_spaces") return activeSpace();
      if (input.tableName === "deletion_jobs") return empty();
      if (input.tableName === "knowledge_space_permission_snapshots") {
        return { rows: [permissionRow()], rowsAffected: 1 };
      }
      if (isAccessLock(input.tableName)) return oneRow(input.tableName);
      if (input.tableName === "sources") return { rows: [sourceRow([])], rowsAffected: 1 };
      if (input.tableName === "source_crawl_preview_pages" && input.operation === "select") {
        return input.sql.includes("COUNT(*)")
          ? { rows: [{ total: 1 }], rowsAffected: 1 }
          : { rows: [crawlPageRow()], rowsAffected: 1 };
      }
      return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
    });
    const crawlRepository = createDatabaseSourceProductWorkflowRepository({
      database: crawlDatabase,
    });
    const fence = { leaseToken, rowVersion: 7, runId, workerId: "source-worker" };

    await expect(
      crawlRepository.appendCrawlPages({ fence, now, pages: [page] }),
    ).resolves.toMatchObject({
      checkpoint: "preview-staged",
      progressCompleted: 1,
      progressTotal: 1,
    });
    await expect(
      crawlRepository.complete({ fence, now, state: "preview_ready" }),
    ).resolves.toMatchObject({
      activeSlot: 1,
      checkpoint: "preview-staged",
      state: "preview_ready",
    });

    const bulkRepository = createDatabaseSourceProductWorkflowRepository({
      database: orderedMutationDatabase("postgres", [], runRow(), false),
    });
    await expect(bulkRepository.complete({ fence, now })).resolves.toMatchObject({
      activeSlot: undefined,
      checkpoint: "source-committed",
      completedAt: now,
      state: "completed",
    });
  });

  it("covers crawl-page dialect defaults, kind rejection, and content conflict", async () => {
    const fence = { leaseToken, rowVersion: 7, runId, workerId: "source-worker" };
    const minimalPage: SourceCrawlPreviewPage = {
      contentHash: "b".repeat(64),
      contentObjectKey: "source-crawl/page-minimal.json",
      createdAt: now,
      id: "page-row-minimal",
      pageId: "page-minimal",
      runId,
      sourceUrl: "https://example.test/minimal",
    };
    const minimalRow: DatabaseRow = {
      content_hash: minimalPage.contentHash,
      content_object_key: minimalPage.contentObjectKey,
      created_at: now,
      description: null,
      etag: null,
      id: minimalPage.id,
      page_id: minimalPage.pageId,
      run_id: runId,
      source_url: minimalPage.sourceUrl,
      title: null,
    };
    const crawlRun = { ...sourceRunRow("running"), kind: "crawl-preview" };

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: crawlMutationDatabase("tidb", crawlRun, minimalRow),
      }).appendCrawlPages({ fence, now, pages: [minimalPage] }),
    ).resolves.toMatchObject({ progressCompleted: 1 });

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: orderedMutationDatabase("postgres", [], sourceRunRow("running"), false),
      }).appendCrawlPages({ fence, now, pages: [] }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: crawlMutationDatabase("postgres", crawlRun, {
          ...minimalRow,
          content_hash: "different",
        }),
      }).appendCrawlPages({ fence, now, pages: [minimalPage] }),
    ).rejects.toMatchObject({ code: "SOURCE_CRAWL_PAGE_CONFLICT" });
  });

  it("handles crawl selection replay, validation failures, and capability rebinding", async () => {
    const input = {
      accessChannel: "interactive" as const,
      idempotencyKey: "selection-a",
      now,
      pageIds: ["page-a"],
      permissionSnapshotId,
      permissionSnapshotRevision: 1,
      requestedBySubjectId: "editor-a",
      runId,
    };

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: selectionDatabase(undefined),
      }).selectCrawlPages(input),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_NOT_FOUND" });

    const replay = {
      ...sourceRunRow("preview_ready"),
      payload: JSON.stringify({
        selectedPageIds: ["page-a"],
        selectionIdempotencyKey: "selection-a",
      }),
    };
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: selectionDatabase(replay),
      }).selectCrawlPages(input),
    ).resolves.toMatchObject({ payload: { selectionIdempotencyKey: "selection-a" } });

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: selectionDatabase(sourceRunRow("running")),
      }).selectCrawlPages(input),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: selectionDatabase(sourceRunRow("preview_ready")),
      }).selectCrawlPages({ ...input, pageIds: [] }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: selectionDatabase(sourceRunRow("preview_ready"), { missingPages: true }),
      }).selectCrawlPages(input),
    ).rejects.toMatchObject({ code: "SOURCE_CRAWL_PAGE_NOT_FOUND" });

    const capabilityPreview = {
      ...sourceRunRow("preview_ready"),
      access_channel: null,
      capability_grant_id: capabilityGrantId,
      permission_snapshot_id: null,
      permission_snapshot_revision: null,
      requested_by_subject_id: null,
      required_permission_scope: null,
    };
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: selectionDatabase(capabilityPreview),
        generateOutboxId: () => "outbox-selection-capability",
      }).selectCrawlPages({
        capabilityGrantId,
        idempotencyKey: "selection-capability",
        now,
        pageIds: ["page-a"],
        runId,
      }),
    ).resolves.toMatchObject({ capabilityGrantId, state: "queued" });
  });

  it("covers terminal, defer, cancel, and retry state boundaries", async () => {
    const fence = { leaseToken, rowVersion: 7, runId, workerId: "source-worker" };
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: orderedMutationDatabase("postgres", [], sourceRunRow("running"), false),
      }).complete({ fence, now, state: "preview_ready" }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: orderedMutationDatabase("postgres", [], runRow(), false),
      }).complete({ fence, now, state: "zero_results" }),
    ).resolves.toMatchObject({
      checkpoint: "provider-read",
      completedAt: now,
      state: "zero_results",
    });

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: orderedMutationDatabase("postgres", [], sourceRunRow("running"), false),
      }).defer({ availableAt: now, fence, now }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });

    const deferConflictDatabase = orderedMutationDatabase("postgres", [], runRow(), false);
    const originalExecute = deferConflictDatabase.execute.bind(deferConflictDatabase);
    const conflictingExecute = async (
      request: DatabaseExecuteInput,
    ): Promise<DatabaseExecuteResult> =>
      request.tableName === "source_workflow_outbox" && request.operation === "update"
        ? empty()
        : originalExecute(request);
    const deferConflict = {
      ...deferConflictDatabase,
      execute: conflictingExecute,
      transaction: async <T>(
        callback: (executor: { execute: typeof conflictingExecute }) => Promise<T>,
      ) => callback({ execute: conflictingExecute }),
    };
    await expect(
      createDatabaseSourceProductWorkflowRepository({ database: deferConflict }).defer({
        availableAt: now,
        fence,
        now,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_FENCE_CONFLICT" });

    const missing = createDatabaseSourceProductWorkflowRepository({
      database: selectionDatabase(undefined),
    });
    await expect(
      missing.cancel({ accessChannel: "interactive", now, reason: "stop", runId }),
    ).resolves.toBeNull();
    await expect(missing.retry({ accessChannel: "interactive", now, runId })).resolves.toBeNull();

    const completedRow = {
      ...sourceRunRow("failed"),
      run_state: "completed",
    };
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: orderedMutationDatabase("postgres", [], completedRow, false),
      }).cancel({
        accessChannel: "interactive",
        now,
        permissionSnapshotId,
        permissionSnapshotRevision: 1,
        reason: "already done",
        requestedBySubjectId: "editor-a",
        runId,
      }),
    ).resolves.toMatchObject({ state: "completed" });
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: orderedMutationDatabase("postgres", [], sourceRunRow("failed"), false),
      }).cancel({
        accessChannel: "interactive",
        now,
        permissionSnapshotId,
        permissionSnapshotRevision: 1,
        reason: "cannot cancel failed",
        requestedBySubjectId: "editor-a",
        runId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: orderedMutationDatabase("postgres", [], sourceRunRow("running"), false),
      }).retry({
        accessChannel: "interactive",
        now,
        permissionSnapshotId,
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "editor-a",
        runId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: orderedMutationDatabase(
          "postgres",
          [],
          { ...sourceRunRow("failed"), execution_attempts: 5, max_execution_attempts: 5 },
          false,
        ),
      }).retry({
        accessChannel: "interactive",
        now,
        permissionSnapshotId,
        permissionSnapshotRevision: 1,
        requestedBySubjectId: "editor-a",
        runId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_ATTEMPTS_EXHAUSTED" });
  });

  it("covers bulk item success transitions and optimistic conflicts", async () => {
    const fence = { leaseToken, rowVersion: 7, runId, workerId: "source-worker" };
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: bulkMutationDatabase(),
      }).markBulkItem({
        errorCode: "SOURCE_ITEM_FAILED",
        fence,
        itemId,
        now,
        reason: "provider rejected item",
        runId,
        status: "failed",
      }),
    ).resolves.toMatchObject({
      errorCode: "SOURCE_ITEM_FAILED",
      reason: "provider rejected item",
      status: "failed",
    });

    const failedItem = { ...bulkItemRow("eligible"), status: "failed" };
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: bulkMutationDatabase({ candidateItem: failedItem, currentItem: failedItem }),
      }).markBulkItem({ fence, itemId, now, runId, status: "failed" }),
    ).resolves.toMatchObject({ status: "failed" });

    for (const options of [
      { missingCandidate: true },
      { parentRow: sourceRunRow("running") },
      { missingCurrent: true },
      {
        currentItem: { ...bulkItemRow("eligible"), source_id: "source-changed" },
      },
      {
        candidateItem: { ...bulkItemRow("eligible"), status: "skipped" },
        currentItem: { ...bulkItemRow("eligible"), status: "skipped" },
      },
    ]) {
      await expect(
        createDatabaseSourceProductWorkflowRepository({
          database: bulkMutationDatabase(options),
        }).markBulkItem({ fence, itemId, now, runId, status: "completed" }),
      ).rejects.toBeInstanceOf(Error);
    }
  });

  it("rejects invalid bulk removal attachment and sync-child races", async () => {
    const fence = { leaseToken, rowVersion: 7, runId, workerId: "source-worker" };
    const removeItem = bulkItemRow("eligible", "remove");
    for (const options of [
      { missingCandidate: true },
      { candidateItem: removeItem, currentItem: removeItem, parentRow: sourceRunRow("running") },
      {
        candidateItem: removeItem,
        currentItem: { ...removeItem, action: "sync" },
      },
      {
        candidateItem: removeItem,
        currentItem: removeItem,
        itemUpdateRowsAffected: 0,
      },
    ]) {
      await expect(
        createDatabaseSourceProductWorkflowRepository({
          database: bulkMutationDatabase(options),
        }).attachBulkRemovalJob({ deletionJobId, fence, itemId, now, runId }),
      ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    }

    for (const options of [
      { missingCandidate: true },
      { parentRow: sourceRunRow("running") },
      { currentItem: { ...bulkItemRow("eligible"), action: "disable" } },
      { currentItem: { ...bulkItemRow("eligible"), source_id: "source-changed" } },
      { itemUpdateRowsAffected: 0 },
    ]) {
      await expect(
        createDatabaseSourceProductWorkflowRepository({
          database: bulkMutationDatabase(options),
          generateRunId: () => childRunId,
        }).enqueueBulkSyncChild({ fence, itemId, now, runId }),
      ).rejects.toBeInstanceOf(Error);
    }

    const capabilityParent = {
      ...runRow(),
      access_channel: null,
      capability_grant_id: capabilityGrantId,
      permission_snapshot_id: null,
      permission_snapshot_revision: null,
      requested_by_subject_id: null,
      required_permission_scope: null,
    };
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: bulkMutationDatabase({ parentRow: capabilityParent }),
        generateRunId: () => childRunId,
      }).enqueueBulkSyncChild({ fence, itemId, now, runId }),
    ).resolves.toMatchObject({ child: { capabilityGrantId, id: childRunId } });
  });

  it("inserts and revises sync policies under the frozen permission fence", async () => {
    const build = (prior: DatabaseRow | undefined) => {
      const calls: DatabaseExecuteInput[] = [];
      const database = testDatabase("postgres", async (input) => {
        calls.push(input);
        if (input.tableName === "knowledge_spaces") return activeSpace();
        if (input.tableName === "deletion_jobs") return empty();
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow()], rowsAffected: 1 };
        }
        if (isAccessLock(input.tableName)) return oneRow(input.tableName);
        if (input.tableName === "sources") return { rows: [sourceRow([])], rowsAffected: 1 };
        if (input.tableName === "source_sync_policies" && input.operation === "select") {
          return prior ? { rows: [prior], rowsAffected: 1 } : empty();
        }
        return { rows: [], rowsAffected: 1 };
      });
      return {
        calls,
        repository: createDatabaseSourceProductWorkflowRepository({ database }),
      };
    };

    const inserted = build(undefined);
    await expect(inserted.repository.upsertSyncPolicy(syncPolicy())).resolves.toEqual(syncPolicy());
    expect(
      inserted.calls.some(
        (call) => call.tableName === "source_sync_policies" && call.operation === "insert",
      ),
    ).toBe(true);

    const updated = build(syncPolicyRow());
    const revision = syncPolicy({ revision: 2, updatedAt: "2026-07-14T12:01:00.000Z" });
    await expect(updated.repository.upsertSyncPolicy(revision)).resolves.toEqual(revision);
    expect(
      updated.calls.some(
        (call) => call.tableName === "source_sync_policies" && call.operation === "update",
      ),
    ).toBe(true);
  });

  it("queues a due sync policy and advances its schedule atomically", async () => {
    const calls: DatabaseExecuteInput[] = [];
    const database = testDatabase("postgres", async (input) => {
      calls.push(input);
      if (input.tableName === "source_sync_policies" && input.operation === "select") {
        return { rows: [syncPolicyRow()], rowsAffected: 1 };
      }
      if (input.tableName === "knowledge_spaces") return activeSpace();
      if (input.tableName === "deletion_jobs") return empty();
      if (input.tableName === "knowledge_space_permission_snapshots") {
        return { rows: [permissionRow()], rowsAffected: 1 };
      }
      if (isAccessLock(input.tableName)) return oneRow(input.tableName);
      if (input.tableName === "sources") return { rows: [sourceRow([])], rowsAffected: 1 };
      return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
    });
    const repository = createDatabaseSourceProductWorkflowRepository({
      database,
      generateOutboxId: () => "outbox-policy-a",
      generateRunId: () => childRunId,
    });

    await expect(
      repository.enqueueDueSyncRuns({ limit: 1, maxExecutionAttempts: 4, now }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: childRunId,
        idempotencyKey: `sync-policy:sync-policy-a:${now}`,
        sourceId,
        state: "queued",
      }),
    ]);
    expect(
      calls.some(
        (call) =>
          call.tableName === "source_sync_policies" &&
          call.operation === "update" &&
          call.params.includes("sync-policy-a"),
      ),
    ).toBe(true);
  });

  it("rejects stale policy writes and accepts nullable schedule fields", async () => {
    const missingSpace = createDatabaseSourceProductWorkflowRepository({
      database: testDatabase("postgres", async () => empty()),
    });
    await expect(missingSpace.upsertSyncPolicy(syncPolicy())).rejects.toMatchObject({
      code: "SOURCE_WORKFLOW_SPACE_NOT_WRITABLE",
    });

    const build = (rowsAffected: number) =>
      createDatabaseSourceProductWorkflowRepository({
        database: testDatabase("postgres", async (input) => {
          if (input.tableName === "knowledge_spaces") return activeSpace();
          if (input.tableName === "deletion_jobs") return empty();
          if (input.tableName === "knowledge_space_permission_snapshots") {
            return { rows: [permissionRow()], rowsAffected: 1 };
          }
          if (isAccessLock(input.tableName)) return oneRow(input.tableName);
          if (input.tableName === "sources") return { rows: [sourceRow([])], rowsAffected: 1 };
          if (input.tableName === "source_sync_policies" && input.operation === "select") {
            return { rows: [syncPolicyRow()], rowsAffected: 1 };
          }
          return { rows: [], rowsAffected };
        }),
      });

    await expect(build(1).upsertSyncPolicy(syncPolicy({ revision: 3 }))).rejects.toMatchObject({
      code: "SOURCE_SYNC_POLICY_CONFLICT",
    });
    await expect(build(0).upsertSyncPolicy(syncPolicy({ revision: 2 }))).rejects.toMatchObject({
      code: "SOURCE_SYNC_POLICY_CONFLICT",
    });

    const nullableCalls: DatabaseExecuteInput[] = [];
    const nullableRepository = createDatabaseSourceProductWorkflowRepository({
      database: testDatabase("postgres", async (input) => {
        nullableCalls.push(input);
        if (input.tableName === "knowledge_spaces") return activeSpace();
        if (input.tableName === "deletion_jobs") return empty();
        if (input.tableName === "knowledge_space_permission_snapshots") {
          return { rows: [permissionRow()], rowsAffected: 1 };
        }
        if (isAccessLock(input.tableName)) return oneRow(input.tableName);
        if (input.tableName === "sources") return { rows: [sourceRow([])], rowsAffected: 1 };
        return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
      }),
    });
    await nullableRepository.upsertSyncPolicy(
      syncPolicy({ customIntervalSeconds: undefined, mode: "manual", nextRunAt: undefined }),
    );
    const insert = nullableCalls.find(
      (call) => call.tableName === "source_sync_policies" && call.operation === "insert",
    );
    expect(insert?.params[11]).toBeNull();
    expect(insert?.params[12]).toBeNull();
  });

  it("disables invalid due policies and handles scheduler races", async () => {
    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: duePolicyDatabase({ missingSpace: true }),
      }).enqueueDueSyncRuns({ limit: 1, maxExecutionAttempts: 2, now }),
    ).resolves.toEqual([]);

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: duePolicyDatabase({ sourceStatus: "disabled" }),
      }).enqueueDueSyncRuns({ limit: 1, maxExecutionAttempts: 2, now }),
    ).resolves.toEqual([]);

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: duePolicyDatabase({ currentPolicy: syncPolicyRow({ enabled: false }) }),
      }).enqueueDueSyncRuns({ limit: 1, maxExecutionAttempts: 2, now }),
    ).resolves.toEqual([]);

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: duePolicyDatabase({ missingSource: true }),
      }).enqueueDueSyncRuns({ limit: 1, maxExecutionAttempts: 2, now }),
    ).resolves.toEqual([]);

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: duePolicyDatabase({ policyUpdateRowsAffected: 0 }),
        generateRunId: () => childRunId,
      }).enqueueDueSyncRuns({ limit: 1, maxExecutionAttempts: 2, now }),
    ).rejects.toMatchObject({ code: "SOURCE_SYNC_POLICY_CONFLICT" });

    await expect(
      createDatabaseSourceProductWorkflowRepository({
        database: duePolicyDatabase({}, "tidb"),
      }).listDueSyncPolicies({ limit: 1, now }),
    ).resolves.toMatchObject({ items: [{ id: "sync-policy-a" }] });
  });
});

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

function fullRunRow(): DatabaseRow {
  return {
    ...sourceRunRow("failed"),
    canceled_at: now,
    cursor: "cursor-a",
    last_error_code: "SOURCE_WARNING",
    last_error_message: "warning detail",
    lease_expires_at: "2026-07-14T12:05:00.000Z",
    lease_token: leaseToken,
    progress_total: 8,
    worker_id: "source-worker",
  };
}

function expiredClaimRunRow(
  kind: NewSourceWorkflowRun["kind"],
  payload: Readonly<Record<string, string | readonly string[]>>,
): DatabaseRow {
  return {
    ...sourceRunRow("running"),
    kind,
    lease_expires_at: "2026-07-14T11:59:00.000Z",
    payload: JSON.stringify(payload),
    run_state: "running",
  };
}

function claimDatabase(
  candidateRow: DatabaseRow,
  options: {
    readonly currentRow?: DatabaseRow | undefined;
    readonly missingAdmission?: boolean | undefined;
    readonly missingOutbox?: boolean | undefined;
    readonly missingSpace?: boolean | undefined;
    readonly throwSpaceError?: boolean | undefined;
    readonly updateRowsAffected?: number | undefined;
  } = {},
): DatabaseAdapter {
  return testDatabase("postgres", async (input) => {
    if (input.tableName === "source_workflow_runs") {
      if (input.operation === "update") {
        return { rows: [], rowsAffected: options.updateRowsAffected ?? 1 };
      }
      if (input.sql.includes("INNER JOIN")) {
        return { rows: [candidateRow], rowsAffected: 1 };
      }
      if (options.missingAdmission && !input.sql.includes("FOR UPDATE")) return empty();
      return { rows: [options.currentRow ?? candidateRow], rowsAffected: 1 };
    }
    if (input.tableName === "knowledge_spaces") {
      if (options.throwSpaceError) throw new Error("space lookup failed");
      return options.missingSpace ? empty() : activeSpace();
    }
    if (input.tableName === "deletion_jobs") return empty();
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return { rows: [permissionRow()], rowsAffected: 1 };
    }
    if (isAccessLock(input.tableName)) return oneRow(input.tableName);
    if (input.tableName === "sources") return { rows: [sourceRow([])], rowsAffected: 1 };
    if (input.tableName === "source_workflow_outbox" && input.operation === "select") {
      return options.missingOutbox ? empty() : oneRow("source_workflow_outbox");
    }
    return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
  });
}

function crawlMutationDatabase(
  dialect: DatabaseAdapter["dialect"],
  run: DatabaseRow,
  storedPage: DatabaseRow,
): DatabaseAdapter {
  return testDatabase(dialect, async (input) => {
    if (input.tableName === "source_workflow_runs" && input.operation === "select") {
      return { rows: [run], rowsAffected: 1 };
    }
    if (input.tableName === "knowledge_spaces") return activeSpace();
    if (input.tableName === "deletion_jobs") return empty();
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return { rows: [permissionRow()], rowsAffected: 1 };
    }
    if (isAccessLock(input.tableName)) return oneRow(input.tableName);
    if (input.tableName === "sources") return { rows: [sourceRow([])], rowsAffected: 1 };
    if (input.tableName === "source_crawl_preview_pages" && input.operation === "select") {
      return input.sql.includes("COUNT(*)")
        ? { rows: [{ total: 1 }], rowsAffected: 1 }
        : { rows: [storedPage], rowsAffected: 1 };
    }
    return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
  });
}

function selectionDatabase(
  run: DatabaseRow | undefined,
  options: { readonly missingPages?: boolean | undefined } = {},
): DatabaseAdapter {
  return testDatabase("postgres", async (input) => {
    if (input.tableName === "source_workflow_runs" && input.operation === "select") {
      return run ? { rows: [run], rowsAffected: 1 } : empty();
    }
    if (input.tableName === "knowledge_spaces") return activeSpace();
    if (input.tableName === "deletion_jobs") return empty();
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return { rows: [permissionRow()], rowsAffected: 1 };
    }
    if (input.tableName === "capability_grants") return activeCapabilityGrant();
    if (isAccessLock(input.tableName)) return oneRow(input.tableName);
    if (input.tableName === "sources") return { rows: [sourceRow([])], rowsAffected: 1 };
    if (input.tableName === "source_crawl_preview_pages" && input.operation === "select") {
      return options.missingPages ? empty() : { rows: [{ page_id: "page-a" }], rowsAffected: 1 };
    }
    if (input.tableName === "source_workflow_outbox" && input.operation === "select") {
      return empty();
    }
    return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
  });
}

function bulkMutationDatabase(
  options: {
    readonly candidateItem?: DatabaseRow | undefined;
    readonly currentItem?: DatabaseRow | undefined;
    readonly itemUpdateRowsAffected?: number | undefined;
    readonly missingCandidate?: boolean | undefined;
    readonly missingCurrent?: boolean | undefined;
    readonly parentRow?: DatabaseRow | undefined;
  } = {},
): DatabaseAdapter {
  const candidate = options.candidateItem ?? bulkItemRow("eligible");
  const current = options.currentItem ?? candidate;
  const parent = options.parentRow ?? runRow();
  return testDatabase("postgres", async (input) => {
    if (input.tableName === "source_bulk_workflow_items") {
      if (input.operation === "update") {
        return { rows: [], rowsAffected: options.itemUpdateRowsAffected ?? 1 };
      }
      if (options.missingCandidate && !input.sql.includes("FOR UPDATE")) return empty();
      if (options.missingCurrent && input.sql.includes("FOR UPDATE")) return empty();
      return { rows: [input.sql.includes("FOR UPDATE") ? current : candidate], rowsAffected: 1 };
    }
    if (input.tableName === "source_workflow_runs" && input.operation === "select") {
      return { rows: [parent], rowsAffected: 1 };
    }
    if (input.tableName === "knowledge_spaces") return activeSpace();
    if (input.tableName === "deletion_jobs") return empty();
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return { rows: [permissionRow()], rowsAffected: 1 };
    }
    if (input.tableName === "capability_grants") return activeCapabilityGrant();
    if (isAccessLock(input.tableName)) return oneRow(input.tableName);
    if (input.tableName === "sources") return { rows: [sourceRow([])], rowsAffected: 1 };
    if (input.tableName === "source_workflow_outbox" && input.operation === "select") {
      return { rows: [{ revision: 1 }], rowsAffected: 1 };
    }
    return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
  });
}

function duePolicyDatabase(
  options: {
    readonly currentPolicy?: DatabaseRow | undefined;
    readonly missingSource?: boolean | undefined;
    readonly missingSpace?: boolean | undefined;
    readonly policyUpdateRowsAffected?: number | undefined;
    readonly sourceStatus?: string | undefined;
  } = {},
  dialect: DatabaseAdapter["dialect"] = "postgres",
): DatabaseAdapter {
  const candidate = syncPolicyRow();
  return testDatabase(dialect, async (input) => {
    if (input.tableName === "source_sync_policies") {
      if (input.operation === "update") {
        return { rows: [], rowsAffected: options.policyUpdateRowsAffected ?? 1 };
      }
      const row = input.sql.includes("FOR UPDATE")
        ? (options.currentPolicy ?? candidate)
        : candidate;
      return { rows: [row], rowsAffected: 1 };
    }
    if (input.tableName === "knowledge_spaces") {
      return options.missingSpace ? empty() : activeSpace();
    }
    if (input.tableName === "deletion_jobs") return empty();
    if (input.tableName === "knowledge_space_permission_snapshots") {
      return { rows: [permissionRow()], rowsAffected: 1 };
    }
    if (isAccessLock(input.tableName)) return oneRow(input.tableName);
    if (input.tableName === "sources") {
      if (options.missingSource) return empty();
      return {
        rows: [{ ...sourceRow([]), status: options.sourceStatus ?? "active" }],
        rowsAffected: 1,
      };
    }
    return { rows: [], rowsAffected: input.operation === "select" ? 0 : 1 };
  });
}

function crawlPageRow(): DatabaseRow {
  return {
    content_hash: "a".repeat(64),
    content_object_key: "source-crawl/page-a.json",
    created_at: now,
    description: "description-a",
    etag: "etag-a",
    id: "page-row-a",
    page_id: "page-a",
    run_id: runId,
    source_url: "https://example.test/a",
    title: "Page A",
  };
}

function syncPolicy(overrides: Partial<SourceSyncPolicyRecord> = {}): SourceSyncPolicyRecord {
  return {
    accessChannel: "interactive",
    createdAt: now,
    customIntervalSeconds: 300,
    enabled: true,
    expectedSourceVersion: 1,
    id: "sync-policy-a",
    knowledgeSpaceId,
    mode: "custom",
    nextRunAt: now,
    permissionSnapshotId,
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "editor-a",
    requiredPermissionScope: [],
    revision: 1,
    sourceId,
    tenantId,
    updatedAt: now,
    ...overrides,
  };
}

function syncPolicyRow(overrides: DatabaseRow = {}): DatabaseRow {
  return {
    access_channel: "interactive",
    created_at: now,
    custom_interval_seconds: 300,
    enabled: true,
    expected_source_version: 1,
    id: "sync-policy-a",
    knowledge_space_id: knowledgeSpaceId,
    mode: "custom",
    next_run_at: now,
    permission_snapshot_id: permissionSnapshotId,
    permission_snapshot_revision: 1,
    requested_by_subject_id: "editor-a",
    required_permission_scope: "[]",
    revision: 1,
    source_id: sourceId,
    tenant_id: tenantId,
    updated_at: now,
    ...overrides,
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

function newCapabilitySourceRun(): NewSourceWorkflowRun {
  return {
    capabilityGrantId,
    createdAt: now,
    id: runId,
    idempotencyKey: "capability-sync-test",
    knowledgeSpaceId,
    kind: "sync",
    maxExecutionAttempts: 5,
    payload: {},
    sourceId,
    tenantId,
  };
}

function capabilitySourceRunRow(): DatabaseRow {
  return {
    ...sourceRunRow("running"),
    access_channel: null,
    capability_grant_id: capabilityGrantId,
    execution_attempts: 0,
    idempotency_key: "capability-sync-test",
    lease_expires_at: null,
    lease_token: null,
    permission_snapshot_id: null,
    permission_snapshot_revision: null,
    requested_by_subject_id: null,
    required_permission_scope: null,
    row_version: 1,
    run_state: "queued",
    worker_id: null,
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

function activeCapabilityGrant(): DatabaseExecuteResult {
  return {
    rows: [
      {
        content_scope_ids: JSON.stringify(["team:camera"]),
        subject_id: "editor-a",
      },
    ],
    rowsAffected: 1,
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
