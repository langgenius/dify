import { createHash, randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
  JobPayload,
} from "@knowledge/core";

import {
  candidatePermissionScopeAllows,
  candidatePermissionScopeSnapshot,
} from "./candidate-content-authorization";
import { resolveCapabilityJobPublicationGrant } from "./capability-job-fence";
import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import {
  KnowledgeSpaceAccessError,
  type KnowledgeSpacePermissionSnapshot,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import { deterministicKnowledgeSpaceActivityId } from "./knowledge-space-overview";
import { appendKnowledgeSpaceActivityWithExecutor } from "./knowledge-space-overview-database-repository";
import {
  type SourceBulkWorkflowItem,
  type SourceCrawlPreviewPage,
  type SourceProductWorkflowRepository,
  type SourceSyncPolicyRecord,
  SourceWorkflowError,
  type SourceWorkflowFence,
  type SourceWorkflowRun,
  type SourceWorkflowState,
  nextSyncPolicyRunAt,
} from "./source-product-workflow";

const runTable = "source_workflow_runs";
const outboxTable = "source_workflow_outbox";
const crawlTable = "source_crawl_preview_pages";
const bulkTable = "source_bulk_workflow_items";
const policyTable = "source_sync_policies";

export function createDatabaseSourceProductWorkflowRepository(input: {
  readonly database: DatabaseAdapter;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly generateOutboxId?: (() => string) | undefined;
  readonly generateRunId?: (() => string) | undefined;
  readonly maxClaimBatchSize?: number | undefined;
  readonly maxListLimit?: number | undefined;
}): SourceProductWorkflowRepository {
  const database = input.database;
  const generateLeaseToken = input.generateLeaseToken ?? randomUUID;
  const generateOutboxId = input.generateOutboxId ?? randomUUID;
  const generateRunId = input.generateRunId ?? randomUUID;
  const maxClaimBatchSize = input.maxClaimBatchSize ?? 100;
  const maxListLimit = input.maxListLimit ?? 200;

  const listLimit = (limit: number) => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
      throw new Error(`Source workflow list limit must be 1-${maxListLimit}`);
    }
  };

  return {
    start: (record) =>
      database.transaction(async (tx) => {
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, tx, record))) {
          throw new SourceWorkflowError(
            "SOURCE_WORKFLOW_SPACE_NOT_WRITABLE",
            "Knowledge space is missing or deletion-fenced",
          );
        }
        const permission = await assertSourceWorkflowPermissionFence(
          database,
          tx,
          record,
          record.createdAt,
        );
        await lockSourceWorkflowAdmissions(
          database,
          tx,
          record.knowledgeSpaceId,
          [record.sourceId],
          permission,
        );
        const replay = await findByIdempotency(database, tx, record);
        if (replay) {
          if (
            replay.kind !== record.kind ||
            replay.sourceId !== record.sourceId ||
            replay.capabilityGrantId !== record.capabilityGrantId ||
            replay.accessChannel !== record.accessChannel ||
            stableJson(replay.requiredPermissionScope) !==
              stableJson(record.requiredPermissionScope) ||
            stableJson(replay.payload) !== stableJson(record.payload)
          ) {
            throw new SourceWorkflowError(
              "SOURCE_WORKFLOW_IDEMPOTENCY_CONFLICT",
              "Idempotency key was used for a different source workflow",
            );
          }
          return replay;
        }
        const run: SourceWorkflowRun = {
          ...record,
          activeSlot: 1,
          checkpoint: "queued",
          executionAttempts: 0,
          progressCompleted: 0,
          progressFailed: 0,
          progressSkipped: 0,
          rowVersion: 1,
          state: "queued",
          updatedAt: record.createdAt,
        };
        await insertRun(database, tx, run);
        await insertOutbox(database, tx, {
          availableAt: run.createdAt,
          deliveryRevision: 1,
          id: generateOutboxId(),
          runId: run.id,
        });
        return run;
      }),
    startBulk: ({ items, run: record }) =>
      database.transaction(async (tx) => {
        if (record.kind !== "bulk" || items.length !== record.progressTotal) invalidState();
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, tx, record))) {
          throw new SourceWorkflowError(
            "SOURCE_WORKFLOW_SPACE_NOT_WRITABLE",
            "Knowledge space is missing or deletion-fenced",
          );
        }
        const permission = await assertSourceWorkflowPermissionFence(
          database,
          tx,
          record,
          record.createdAt,
        );
        const uniqueIds = new Set<string>();
        const uniqueSourceIds = new Set<string>();
        const orderedItems = [...items].sort((left, right) =>
          left.sourceId.localeCompare(right.sourceId),
        );
        for (const item of orderedItems) {
          if (
            item.runId !== record.id ||
            uniqueIds.has(item.id) ||
            uniqueSourceIds.has(item.sourceId) ||
            (item.status !== "eligible" && item.status !== "skipped") ||
            item.childRunId !== undefined ||
            item.deletionJobId !== undefined
          )
            invalidState();
          uniqueIds.add(item.id);
          uniqueSourceIds.add(item.sourceId);
        }
        const replay = await findByIdempotency(database, tx, record);
        if (replay) {
          if (
            replay.kind !== record.kind ||
            replay.sourceId !== record.sourceId ||
            replay.capabilityGrantId !== record.capabilityGrantId ||
            replay.accessChannel !== record.accessChannel ||
            stableJson(replay.requiredPermissionScope) !==
              stableJson(record.requiredPermissionScope) ||
            stableJson(replay.payload) !== stableJson(record.payload)
          ) {
            throw new SourceWorkflowError(
              "SOURCE_WORKFLOW_IDEMPOTENCY_CONFLICT",
              "Idempotency key was used for a different source workflow",
            );
          }
          return replay;
        }
        for (const item of orderedItems) {
          if (item.status === "skipped") continue;
          const sourceScope = await requireSourceWorkflowAdmission(
            database,
            tx,
            record.knowledgeSpaceId,
            item.sourceId,
          );
          assertSourceWorkflowScopeAllowed(sourceScope, permission.permissionScopes);
        }
        const run: SourceWorkflowRun = {
          ...record,
          activeSlot: 1,
          checkpoint: "queued",
          executionAttempts: 0,
          progressCompleted: 0,
          progressFailed: 0,
          progressSkipped: items.filter((item) => item.status === "skipped").length,
          rowVersion: 1,
          state: "queued",
          updatedAt: record.createdAt,
        };
        await insertRun(database, tx, run);
        await insertBulkItems(database, tx, run, items, false);
        await insertOutbox(database, tx, {
          availableAt: run.createdAt,
          deliveryRevision: 1,
          id: generateOutboxId(),
          runId: run.id,
        });
        return run;
      }),
    get: ({ knowledgeSpaceId, runId, tenantId }) =>
      getRun(database, database, runId, false).then((run) =>
        run?.tenantId === tenantId && run.knowledgeSpaceId === knowledgeSpaceId ? run : null,
      ),
    listRuns: async ({ candidateGrants, cursor, knowledgeSpaceId, limit, sourceId, tenantId }) => {
      listLimit(limit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = [
        tenantId,
        knowledgeSpaceId,
        JSON.stringify(candidateGrants),
      ];
      let predicate = ` AND ${sourceRunPermissionScopeSql(database, p(database, 3))}`;
      if (sourceId) {
        params.push(sourceId);
        predicate += ` AND ${q(database, "source_id")} = ${p(database, params.length)}`;
      }
      if (cursor) {
        params.push(cursor);
        predicate += ` AND ${q(database, "id")} > ${p(database, params.length)}`;
      }
      params.push(readLimit);
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, runTable)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)}${predicate} ORDER BY ${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName: runTable,
      });
      return resultPage(result.rows.map(mapRun), limit, (run) => run.id);
    },
    listRecentRuns: async ({ candidateGrants, cursor, knowledgeSpaceId, limit, tenantId }) => {
      listLimit(limit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = [
        tenantId,
        knowledgeSpaceId,
        JSON.stringify(candidateGrants),
      ];
      let predicate = ` AND ${sourceRunPermissionScopeSql(database, p(database, 3))}`;
      if (cursor) {
        params.push(cursor.createdAt, cursor.id);
        predicate += ` AND (${q(database, "created_at")} < ${p(
          database,
          params.length - 1,
        )} OR (${q(database, "created_at")} = ${p(
          database,
          params.length - 1,
        )} AND ${q(database, "id")} < ${p(database, params.length)}))`;
      }
      params.push(readLimit);
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, runTable)} WHERE ${q(
          database,
          "tenant_id",
        )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
          database,
          2,
        )}${predicate} ORDER BY ${q(database, "created_at")} DESC, ${q(
          database,
          "id",
        )} DESC LIMIT ${p(database, params.length)};`,
        tableName: runTable,
      });
      const items = result.rows.slice(0, limit).map(mapRun);
      const last = items.at(-1);
      return {
        items,
        ...(result.rows.length > limit && last
          ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
          : {}),
      };
    },
    claim: async ({ leaseExpiresAt, limit, now, workerId }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxClaimBatchSize) {
        throw new Error(`Source workflow claim limit must be 1-${maxClaimBatchSize}`);
      }
      return database.transaction(async (tx) => {
        const result = await tx.execute({
          maxRows: limit,
          operation: "select",
          params: [now, now, limit],
          sql: `SELECT run.* FROM ${q(database, runTable)} run INNER JOIN ${q(database, outboxTable)} outbox ON outbox.${q(database, "run_id")} = run.${q(database, "id")} WHERE (run.${q(database, "run_state")} = 'queued' OR (run.${q(database, "run_state")} IN ('running', 'crawling', 'importing', 'syncing') AND run.${q(database, "lease_expires_at")} <= ${p(database, 1)})) AND outbox.${q(database, "available_at")} <= ${p(database, 2)} AND (outbox.${q(database, "status")} = 'pending' OR (outbox.${q(database, "status")} = 'leased' AND outbox.${q(database, "locked_until")} <= ${p(database, 2)})) ORDER BY run.${q(database, "tenant_id")} ASC, run.${q(database, "knowledge_space_id")} ASC, run.${q(database, "updated_at")} ASC, run.${q(database, "id")} ASC LIMIT ${p(database, 3)};`,
          tableName: runTable,
        });
        const claimed: SourceWorkflowRun[] = [];
        for (const row of result.rows) {
          const candidate = mapRun(row);
          let admitted: Awaited<ReturnType<typeof getRunForMutationAdmission>>;
          try {
            admitted = await getRunForMutationAdmission(
              database,
              tx,
              candidate.id,
              now,
              undefined,
              [],
              true,
            );
          } catch (error) {
            if (
              error instanceof SourceWorkflowError &&
              (error.code === "SOURCE_WORKFLOW_SPACE_NOT_WRITABLE" ||
                error.code === "SOURCE_WORKFLOW_SOURCE_NOT_WRITABLE")
            ) {
              continue;
            }
            throw error;
          }
          if (!admitted) continue;
          const current = admitted.run;
          if (
            !(
              current.state === "queued" ||
              (["running", "crawling", "importing", "syncing"].includes(current.state) &&
                current.leaseExpiresAt !== undefined &&
                current.leaseExpiresAt <= now)
            )
          )
            continue;
          const outbox = await tx.execute({
            maxRows: 1,
            operation: "select",
            params: [current.id, now],
            sql: `SELECT ${q(database, "id")} FROM ${q(database, outboxTable)} WHERE ${q(database, "run_id")} = ${p(database, 1)} AND ${q(database, "available_at")} <= ${p(database, 2)} AND (${q(database, "status")} = 'pending' OR (${q(database, "status")} = 'leased' AND ${q(database, "locked_until")} <= ${p(database, 2)})) ORDER BY ${q(database, "delivery_revision")} DESC LIMIT 1 FOR UPDATE;`,
            tableName: outboxTable,
          });
          if (!outbox.rows[0]) continue;
          if (!admitted.permission) {
            await writeTerminal(database, tx, current, {
              errorCode: "SOURCE_WORKFLOW_PERMISSION_INVALID",
              errorMessage: "Durable source workflow permission is no longer valid",
              now,
              state: "failed",
            });
            await finishOutbox(database, tx, current.id, "completed", now);
            continue;
          }
          if (current.executionAttempts >= current.maxExecutionAttempts) {
            await writeTerminal(database, tx, current, {
              errorCode: "SOURCE_WORKFLOW_ATTEMPTS_EXHAUSTED",
              errorMessage: "Source workflow exhausted its execution attempt budget",
              now,
              state: "failed",
            });
            await finishOutbox(database, tx, current.id, "completed", now);
            continue;
          }
          const leaseToken = generateLeaseToken();
          const state = executingState(current);
          const next: SourceWorkflowRun = {
            ...current,
            executionAttempts: current.executionAttempts + 1,
            leaseExpiresAt,
            leaseToken,
            rowVersion: current.rowVersion + 1,
            state,
            updatedAt: now,
            workerId,
          };
          const updated = await tx.execute({
            maxRows: 0,
            operation: "update",
            params: [
              state,
              workerId,
              leaseToken,
              leaseExpiresAt,
              next.executionAttempts,
              next.rowVersion,
              now,
              current.id,
              current.rowVersion,
            ],
            sql: `UPDATE ${q(database, runTable)} SET ${q(database, "run_state")} = ${p(database, 1)}, ${q(database, "worker_id")} = ${p(database, 2)}, ${q(database, "lease_token")} = ${p(database, 3)}, ${q(database, "lease_expires_at")} = ${p(database, 4)}, ${q(database, "execution_attempts")} = ${p(database, 5)}, ${q(database, "row_version")} = ${p(database, 6)}, ${q(database, "updated_at")} = ${p(database, 7)} WHERE ${q(database, "id")} = ${p(database, 8)} AND ${q(database, "row_version")} = ${p(database, 9)};`,
            tableName: runTable,
          });
          if (updated.rowsAffected !== 1) continue;
          await tx.execute({
            maxRows: 0,
            operation: "update",
            params: [workerId, leaseToken, leaseExpiresAt, now, current.id],
            sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = 'leased', ${q(database, "locked_by")} = ${p(database, 1)}, ${q(database, "lock_token")} = ${p(database, 2)}, ${q(database, "locked_until")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "run_id")} = ${p(database, 5)} AND ${q(database, "status")} IN ('pending', 'leased');`,
            tableName: outboxTable,
          });
          claimed.push(next);
        }
        return claimed;
      });
    },
    checkpoint: (request) =>
      mutateFenced(database, request.fence, request.now, (current) => ({
        ...current,
        checkpoint: request.checkpoint,
        ...(request.cursor === undefined
          ? {}
          : request.cursor === null
            ? { cursor: undefined }
            : { cursor: request.cursor }),
        ...(request.progressCompleted === undefined
          ? {}
          : { progressCompleted: request.progressCompleted }),
        ...(request.progressFailed === undefined ? {} : { progressFailed: request.progressFailed }),
        ...(request.progressSkipped === undefined
          ? {}
          : { progressSkipped: request.progressSkipped }),
        ...(request.progressTotal === undefined
          ? {}
          : request.progressTotal === null
            ? { progressTotal: undefined }
            : { progressTotal: request.progressTotal }),
        rowVersion: current.rowVersion + 1,
        state: request.state,
        updatedAt: request.now,
      })),
    heartbeat: ({ fence, leaseExpiresAt, now }) =>
      mutateFenced(database, fence, now, (current) => ({
        ...current,
        leaseExpiresAt,
        rowVersion: current.rowVersion + 1,
        updatedAt: now,
      })),
    appendCrawlPages: ({ fence, now, pages }) =>
      database.transaction(async (tx) => {
        const { run: current } = await requireFenced(database, tx, fence, now);
        if (current.kind !== "crawl-preview") invalidState();
        for (const page of pages) {
          const columns = [
            "id",
            "run_id",
            "page_id",
            "source_url",
            "title",
            "description",
            "etag",
            "content_hash",
            "content_object_key",
            "created_at",
          ] as const;
          const params: DatabaseQueryValue[] = [
            page.id,
            page.runId,
            page.pageId,
            page.sourceUrl,
            page.title ?? null,
            page.description ?? null,
            page.etag ?? null,
            page.contentHash,
            page.contentObjectKey,
            page.createdAt,
          ];
          await tx.execute({
            maxRows: 0,
            operation: "insert",
            params,
            sql: `${database.dialect === "tidb" ? "INSERT IGNORE" : "INSERT"} INTO ${q(database, crawlTable)} (${columns.map((column) => q(database, column)).join(", ")}) VALUES (${params.map((_, index) => p(database, index + 1)).join(", ")})${database.dialect === "postgres" ? " ON CONFLICT DO NOTHING" : ""};`,
            tableName: crawlTable,
          });
          const stored = await getCrawlPage(database, tx, page.runId, page.pageId);
          if (!stored || stableJson(stored) !== stableJson(page)) {
            throw new SourceWorkflowError(
              "SOURCE_CRAWL_PAGE_CONFLICT",
              "Crawl page id was reused with different content",
            );
          }
        }
        const count = await tx.execute({
          maxRows: 1,
          operation: "select",
          params: [current.id],
          sql: `SELECT COUNT(*) AS ${q(database, "total")} FROM ${q(database, crawlTable)} WHERE ${q(database, "run_id")} = ${p(database, 1)};`,
          tableName: crawlTable,
        });
        const total = Number(count.rows[0]?.total ?? 0);
        return writeFenced(database, tx, current, {
          ...current,
          checkpoint: "preview-staged",
          progressCompleted: total,
          progressTotal: total,
          rowVersion: current.rowVersion + 1,
          updatedAt: now,
        });
      }),
    listCrawlPages: async ({ cursor, limit, runId }) => {
      listLimit(limit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = cursor ? [runId, cursor, readLimit] : [runId, readLimit];
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, crawlTable)} WHERE ${q(database, "run_id")} = ${p(database, 1)}${cursor ? ` AND ${q(database, "id")} > ${p(database, 2)}` : ""} ORDER BY ${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName: crawlTable,
      });
      return resultPage(result.rows.map(mapCrawlPage), limit, (page) => page.id);
    },
    selectCrawlPages: ({
      accessChannel,
      capabilityGrantId,
      idempotencyKey,
      now,
      pageIds,
      permissionSnapshotId,
      permissionSnapshotRevision,
      requestedBySubjectId,
      runId,
    }) =>
      database.transaction(async (tx) => {
        const admitted = await getRunForMutationAdmission(database, tx, runId, now, {
          accessChannel,
          capabilityGrantId,
          permissionSnapshotId,
          permissionSnapshotRevision,
          requestedBySubjectId,
        });
        if (!admitted) notFound();
        const current = admitted.run;
        const existingKey = current.payload.selectionIdempotencyKey;
        const existingIds = current.payload.selectedPageIds;
        const normalized = [...new Set(pageIds)].sort();
        if (typeof existingKey === "string") {
          if (
            existingKey !== idempotencyKey ||
            stableJson(existingIds) !== stableJson(normalized)
          ) {
            idempotencyConflict();
          }
          return current;
        }
        if (current.kind !== "crawl-preview" || current.state !== "preview_ready") invalidState();
        if (normalized.length === 0) invalidState();
        const placeholders = normalized.map((_, index) => p(database, index + 2)).join(", ");
        const found = await tx.execute({
          maxRows: normalized.length,
          operation: "select",
          params: [runId, ...normalized],
          sql: `SELECT ${q(database, "page_id")} FROM ${q(database, crawlTable)} WHERE ${q(database, "run_id")} = ${p(database, 1)} AND ${q(database, "page_id")} IN (${placeholders}) FOR UPDATE;`,
          tableName: crawlTable,
        });
        if (
          new Set(found.rows.map((row) => stringColumn(row, "page_id"))).size !== normalized.length
        ) {
          throw new SourceWorkflowError(
            "SOURCE_CRAWL_PAGE_NOT_FOUND",
            "Crawl selection contains an unknown page",
          );
        }
        const next = await writeUnfenced(database, tx, {
          ...current,
          ...(capabilityGrantId
            ? {
                accessChannel: undefined,
                capabilityGrantId,
                permissionSnapshotId: undefined,
                permissionSnapshotRevision: undefined,
                requestedBySubjectId: undefined,
                requiredPermissionScope: undefined,
              }
            : {
                accessChannel,
                capabilityGrantId: undefined,
                permissionSnapshotId,
                permissionSnapshotRevision,
                requestedBySubjectId,
              }),
          activeSlot: 1,
          checkpoint: "selection-frozen",
          completedAt: undefined,
          leaseExpiresAt: undefined,
          leaseToken: undefined,
          payload: {
            ...current.payload,
            selectedPageIds: normalized,
            selectionIdempotencyKey: idempotencyKey,
          },
          progressCompleted: 0,
          progressFailed: 0,
          progressSkipped: 0,
          progressTotal: normalized.length,
          rowVersion: current.rowVersion + 1,
          state: "queued",
          updatedAt: now,
          workerId: undefined,
        });
        await insertOutbox(database, tx, {
          availableAt: now,
          deliveryRevision: await nextDeliveryRevision(database, tx, runId),
          id: generateOutboxId(),
          runId,
        });
        return next;
      }),
    complete: ({ fence, now, state = "completed" }) =>
      database.transaction(async (tx) => {
        const { run: current } = await requireFenced(database, tx, fence, now);
        if (state === "preview_ready" && current.kind !== "crawl-preview") invalidState();
        const terminal = state === "completed" || state === "zero_results";
        const next = await writeFenced(database, tx, current, {
          ...current,
          activeSlot: terminal ? undefined : current.activeSlot,
          checkpoint:
            state === "preview_ready"
              ? "preview-staged"
              : state === "completed"
                ? "source-committed"
                : current.checkpoint,
          ...(terminal ? { completedAt: now } : {}),
          leaseExpiresAt: undefined,
          leaseToken: undefined,
          rowVersion: current.rowVersion + 1,
          state,
          updatedAt: now,
          workerId: undefined,
        });
        await finishOutbox(database, tx, current.id, "completed", now);
        if (terminal && current.kind === "sync" && current.sourceId) {
          await appendSourceWorkflowActivity(database, tx, next, "source.synced", "success", now);
        }
        return next;
      }),
    defer: ({ availableAt, fence, now }) =>
      database.transaction(async (tx) => {
        const { run: current } = await requireFenced(database, tx, fence, now);
        if (current.kind !== "bulk") invalidState();
        const next = await writeFenced(database, tx, current, {
          ...current,
          cursor: undefined,
          executionAttempts: Math.max(0, current.executionAttempts - 1),
          leaseExpiresAt: undefined,
          leaseToken: undefined,
          rowVersion: current.rowVersion + 1,
          state: "queued",
          updatedAt: now,
          workerId: undefined,
        });
        const released = await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [availableAt, now, current.id, current.leaseToken ?? null],
          sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = 'pending', ${q(database, "available_at")} = ${p(database, 1)}, ${q(database, "locked_by")} = NULL, ${q(database, "lock_token")} = NULL, ${q(database, "locked_until")} = NULL, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "run_id")} = ${p(database, 3)} AND ${q(database, "status")} = 'leased' AND ${q(database, "lock_token")} = ${p(database, 4)};`,
          tableName: outboxTable,
        });
        if (released.rowsAffected !== 1) fenceConflict();
        return next;
      }),
    fail: ({ errorCode, errorMessage, fence, now }) =>
      database.transaction(async (tx) => {
        const { run: current } = await requireFenced(database, tx, fence, now, [], true);
        const next = await writeTerminal(database, tx, current, {
          errorCode,
          errorMessage,
          now,
          state: "failed",
        });
        await finishOutbox(database, tx, current.id, "completed", now);
        if (current.sourceId) {
          await appendSourceWorkflowActivity(database, tx, next, "source.failed", "failure", now);
        }
        return next;
      }),
    cancel: ({
      accessChannel,
      capabilityGrantId,
      now,
      permissionSnapshotId,
      permissionSnapshotRevision,
      reason,
      requestedBySubjectId,
      runId,
    }) =>
      database.transaction(async (tx) => {
        const admitted = await getRunForMutationAdmission(database, tx, runId, now, {
          accessChannel,
          capabilityGrantId,
          permissionSnapshotId,
          permissionSnapshotRevision,
          requestedBySubjectId,
        });
        if (!admitted) return null;
        const current = admitted.run;
        if (["completed", "zero_results", "canceled"].includes(current.state)) return current;
        if (current.state === "failed") invalidState();
        const next = await writeUnfenced(database, tx, {
          ...current,
          activeSlot: undefined,
          canceledAt: now,
          completedAt: now,
          lastErrorCode: "SOURCE_WORKFLOW_CANCELED",
          lastErrorMessage: reason.slice(0, 1_000),
          leaseExpiresAt: undefined,
          leaseToken: undefined,
          ...(capabilityGrantId
            ? {
                accessChannel: undefined,
                capabilityGrantId,
                permissionSnapshotId: undefined,
                permissionSnapshotRevision: undefined,
                requestedBySubjectId: undefined,
                requiredPermissionScope: undefined,
              }
            : {
                accessChannel,
                capabilityGrantId: undefined,
                permissionSnapshotId,
                permissionSnapshotRevision,
                requestedBySubjectId,
              }),
          rowVersion: current.rowVersion + 1,
          state: "canceled",
          updatedAt: now,
          workerId: undefined,
        });
        await finishOutbox(database, tx, current.id, "canceled", now);
        return next;
      }),
    retry: ({
      accessChannel,
      capabilityGrantId,
      now,
      permissionSnapshotId,
      permissionSnapshotRevision,
      requestedBySubjectId,
      runId,
    }) =>
      database.transaction(async (tx) => {
        const admitted = await getRunForMutationAdmission(database, tx, runId, now, {
          accessChannel,
          capabilityGrantId,
          permissionSnapshotId,
          permissionSnapshotRevision,
          requestedBySubjectId,
        });
        if (!admitted) return null;
        const current = admitted.run;
        if (current.state !== "failed" && current.state !== "canceled") invalidState();
        if (current.executionAttempts >= current.maxExecutionAttempts) {
          throw new SourceWorkflowError(
            "SOURCE_WORKFLOW_ATTEMPTS_EXHAUSTED",
            "Source workflow exhausted its execution attempt budget",
          );
        }
        const next = await writeUnfenced(database, tx, {
          ...current,
          activeSlot: 1,
          ...(capabilityGrantId
            ? {
                accessChannel: undefined,
                capabilityGrantId,
                permissionSnapshotId: undefined,
                permissionSnapshotRevision: undefined,
                requestedBySubjectId: undefined,
                requiredPermissionScope: undefined,
              }
            : {
                accessChannel,
                capabilityGrantId: undefined,
                permissionSnapshotId,
                permissionSnapshotRevision,
                requestedBySubjectId,
              }),
          canceledAt: undefined,
          completedAt: undefined,
          cursor: undefined,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
          leaseExpiresAt: undefined,
          leaseToken: undefined,
          progressCompleted: 0,
          progressFailed: 0,
          progressSkipped: 0,
          rowVersion: current.rowVersion + 1,
          state: "queued",
          updatedAt: now,
          workerId: undefined,
        });
        await insertOutbox(database, tx, {
          availableAt: now,
          deliveryRevision: await nextDeliveryRevision(database, tx, runId),
          id: generateOutboxId(),
          runId,
        });
        return next;
      }),
    listBulkItems: async ({ cursor, limit, runId }) => {
      listLimit(limit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = cursor ? [runId, cursor, readLimit] : [runId, readLimit];
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, bulkTable)} WHERE ${q(database, "run_id")} = ${p(database, 1)}${cursor ? ` AND ${q(database, "id")} > ${p(database, 2)}` : ""} ORDER BY ${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName: bulkTable,
      });
      return resultPage(result.rows.map(mapBulkItem), limit, (item) => item.id);
    },
    listAuthorizedBulkItems: async ({
      accessChannel,
      candidateGrants,
      cursor,
      knowledgeSpaceId,
      limit,
      permissionSnapshotId,
      permissionSnapshotRevision,
      requestedBySubjectId,
      runId,
      tenantId,
    }) => {
      listLimit(limit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = [
        tenantId,
        knowledgeSpaceId,
        runId,
        requestedBySubjectId,
        accessChannel,
        permissionSnapshotId,
        permissionSnapshotRevision,
        JSON.stringify(candidateGrants),
      ];
      if (cursor) params.push(cursor);
      params.push(readLimit);
      const item = "authorized_bulk_item";
      const parent = "authorized_bulk_parent";
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT ${item}.* FROM ${q(database, bulkTable)} ${item} INNER JOIN ${q(database, runTable)} ${parent} ON ${parent}.${q(database, "id")} = ${item}.${q(database, "run_id")} AND ${parent}.${q(database, "tenant_id")} = ${item}.${q(database, "tenant_id")} AND ${parent}.${q(database, "knowledge_space_id")} = ${item}.${q(database, "knowledge_space_id")} WHERE ${item}.${q(database, "tenant_id")} = ${p(database, 1)} AND ${item}.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${item}.${q(database, "run_id")} = ${p(database, 3)} AND ${parent}.${q(database, "kind")} = 'bulk' AND ${parent}.${q(database, "requested_by_subject_id")} = ${p(database, 4)} AND ${parent}.${q(database, "access_channel")} = ${p(database, 5)} AND ${parent}.${q(database, "permission_snapshot_id")} = ${p(database, 6)} AND ${parent}.${q(database, "permission_snapshot_revision")} = ${p(database, 7)} AND ${permissionScopeSql(database, `${parent}.${q(database, "required_permission_scope")}`, p(database, 8))}${cursor ? ` AND ${item}.${q(database, "id")} > ${p(database, 9)}` : ""} ORDER BY ${item}.${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName: bulkTable,
      });
      return resultPage(result.rows.map(mapBulkItem), limit, (bulkItem) => bulkItem.id);
    },
    attachBulkRemovalJob: ({ deletionJobId, fence, itemId, now, runId }) =>
      database.transaction(async (tx) => {
        const candidateItem = await getBulkItem(database, tx, runId, itemId, false);
        if (!candidateItem) invalidState();
        const { run: current } = await requireFenced(database, tx, fence, now);
        if (current.id !== runId || current.kind !== "bulk") invalidState();
        const item = await getBulkItem(database, tx, runId, itemId, true);
        if (
          !item ||
          item.sourceId !== candidateItem.sourceId ||
          item.action !== "remove" ||
          item.status !== "eligible" ||
          item.childRunId ||
          item.deletionJobId
        ) {
          invalidState();
        }
        const runningItem: SourceBulkWorkflowItem = {
          ...item,
          deletionJobId,
          status: "running",
          updatedAt: now,
        };
        const itemUpdated = await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [deletionJobId, now, runId, itemId],
          sql: `UPDATE ${q(database, bulkTable)} SET ${q(database, "deletion_job_id")} = ${p(database, 1)}, ${q(database, "status")} = 'running', ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "run_id")} = ${p(database, 3)} AND ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "action")} = 'remove' AND ${q(database, "status")} = 'eligible' AND ${q(database, "child_run_id")} IS NULL AND ${q(database, "deletion_job_id")} IS NULL;`,
          tableName: bulkTable,
        });
        if (itemUpdated.rowsAffected !== 1) invalidState();
        const parent = await writeFenced(database, tx, current, {
          ...current,
          rowVersion: current.rowVersion + 1,
          updatedAt: now,
        });
        return { item: runningItem, parent };
      }),
    markBulkItem: ({ errorCode, fence, itemId, now, reason, runId, status }) =>
      database.transaction(async (tx) => {
        const candidateItem = await getBulkItem(database, tx, runId, itemId, false);
        if (!candidateItem) {
          throw new SourceWorkflowError("SOURCE_BULK_ITEM_NOT_FOUND", "Bulk item not found");
        }
        const { run } = await requireFenced(
          database,
          tx,
          fence,
          now,
          candidateItem.action === "remove" ? [] : [candidateItem.sourceId],
        );
        if (run.id !== runId || run.kind !== "bulk") invalidState();
        const current = await getBulkItem(database, tx, runId, itemId, true);
        if (!current)
          throw new SourceWorkflowError("SOURCE_BULK_ITEM_NOT_FOUND", "Bulk item not found");
        if (current.sourceId !== candidateItem.sourceId) fenceConflict();
        if (!bulkItemTransitionAllowed(current.status, status)) invalidState();
        const next: SourceBulkWorkflowItem = {
          ...current,
          ...(errorCode ? { errorCode } : {}),
          ...(reason ? { reason } : {}),
          status,
          updatedAt: now,
        };
        await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [next.status, next.reason ?? null, next.errorCode ?? null, now, runId, itemId],
          sql: `UPDATE ${q(database, bulkTable)} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "reason")} = ${p(database, 2)}, ${q(database, "error_code")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "run_id")} = ${p(database, 5)} AND ${q(database, "id")} = ${p(database, 6)};`,
          tableName: bulkTable,
        });
        return next;
      }),
    enqueueBulkSyncChild: ({ fence, itemId, now, runId }) =>
      database.transaction(async (tx) => {
        const candidateItem = await getBulkItem(database, tx, runId, itemId, false);
        if (!candidateItem) invalidState();
        const { run: current, sourceScopes } = await requireFenced(database, tx, fence, now, [
          candidateItem.sourceId,
        ]);
        if (current.id !== runId || current.kind !== "bulk") invalidState();
        const item = await getBulkItem(database, tx, runId, itemId, true);
        if (!item || item.action !== "sync" || item.status !== "eligible") invalidState();
        if (item.sourceId !== candidateItem.sourceId) fenceConflict();
        const sourceScope = sourceScopes.get(item.sourceId);
        if (!sourceScope) notFound();
        const child: SourceWorkflowRun = {
          ...(current.capabilityGrantId
            ? { capabilityGrantId: current.capabilityGrantId }
            : {
                accessChannel: current.accessChannel,
                permissionSnapshotId: current.permissionSnapshotId,
                permissionSnapshotRevision: current.permissionSnapshotRevision,
                requestedBySubjectId: current.requestedBySubjectId,
                requiredPermissionScope: sourceScope,
              }),
          activeSlot: 1,
          checkpoint: "queued",
          createdAt: now,
          executionAttempts: 0,
          id: generateRunId(),
          idempotencyKey: `bulk-sync:${current.id}:${item.id}`,
          knowledgeSpaceId: current.knowledgeSpaceId,
          kind: "sync",
          maxExecutionAttempts: current.maxExecutionAttempts,
          payload: { bulkItemId: item.id, parentRunId: current.id },
          progressCompleted: 0,
          progressFailed: 0,
          progressSkipped: 0,
          rowVersion: 1,
          sourceId: item.sourceId,
          state: "queued",
          tenantId: current.tenantId,
          updatedAt: now,
        };
        await insertRun(database, tx, child);
        await insertOutbox(database, tx, {
          availableAt: now,
          deliveryRevision: 1,
          id: generateOutboxId(),
          runId: child.id,
        });
        const runningItem: SourceBulkWorkflowItem = {
          ...item,
          childRunId: child.id,
          status: "running",
          updatedAt: now,
        };
        const itemUpdated = await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [child.id, now, runId, itemId],
          sql: `UPDATE ${q(database, bulkTable)} SET ${q(database, "child_run_id")} = ${p(database, 1)}, ${q(database, "status")} = 'running', ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "run_id")} = ${p(database, 3)} AND ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "status")} = 'eligible' AND ${q(database, "child_run_id")} IS NULL;`,
          tableName: bulkTable,
        });
        if (itemUpdated.rowsAffected !== 1) invalidState();
        const parent = await writeFenced(database, tx, current, {
          ...current,
          rowVersion: current.rowVersion + 1,
          updatedAt: now,
        });
        return { child, item: runningItem, parent };
      }),
    upsertSyncPolicy: (policy) =>
      database.transaction(async (tx) => {
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, tx, policy))) {
          throw new SourceWorkflowError(
            "SOURCE_WORKFLOW_SPACE_NOT_WRITABLE",
            "Knowledge space is missing or deletion-fenced",
          );
        }
        const permission = await assertSourceWorkflowPermissionFence(
          database,
          tx,
          policy,
          policy.updatedAt,
        );
        await lockSourceWorkflowAdmissions(
          database,
          tx,
          policy.knowledgeSpaceId,
          [policy.sourceId],
          permission,
        );
        const prior = await getPolicy(database, tx, policy, true);
        if (
          (!prior && policy.revision !== 1) ||
          (prior && policy.revision !== prior.revision + 1)
        ) {
          throw new SourceWorkflowError(
            "SOURCE_SYNC_POLICY_CONFLICT",
            "Sync policy changed concurrently",
          );
        }
        if (!prior) {
          const params = policyParams(policy);
          await tx.execute({
            maxRows: 0,
            operation: "insert",
            params,
            sql: `INSERT INTO ${q(database, policyTable)} (${[
              "id",
              "tenant_id",
              "knowledge_space_id",
              "source_id",
              "requested_by_subject_id",
              "access_channel",
              "permission_snapshot_id",
              "permission_snapshot_revision",
              "required_permission_scope",
              "mode",
              "enabled",
              "custom_interval_seconds",
              "next_run_at",
              "expected_source_version",
              "revision",
              "created_at",
              "updated_at",
            ]
              .map((column) => q(database, column))
              .join(
                ", ",
              )}) VALUES (${params.map((_, index) => (index === 8 ? jsonValue(database, index + 1) : p(database, index + 1))).join(", ")});`,
            tableName: policyTable,
          });
          return policy;
        }
        const result = await tx.execute({
          maxRows: 0,
          operation: "update",
          params: [
            policy.requestedBySubjectId,
            policy.accessChannel,
            policy.permissionSnapshotId,
            policy.permissionSnapshotRevision,
            JSON.stringify(policy.requiredPermissionScope),
            policy.mode,
            policy.enabled,
            policy.customIntervalSeconds ?? null,
            policy.nextRunAt ?? null,
            policy.expectedSourceVersion,
            policy.revision,
            policy.updatedAt,
            policy.tenantId,
            policy.knowledgeSpaceId,
            policy.sourceId,
            prior.revision,
          ],
          sql: `UPDATE ${q(database, policyTable)} SET ${q(database, "requested_by_subject_id")} = ${p(database, 1)}, ${q(database, "access_channel")} = ${p(database, 2)}, ${q(database, "permission_snapshot_id")} = ${p(database, 3)}, ${q(database, "permission_snapshot_revision")} = ${p(database, 4)}, ${q(database, "required_permission_scope")} = ${jsonValue(database, 5)}, ${q(database, "mode")} = ${p(database, 6)}, ${q(database, "enabled")} = ${p(database, 7)}, ${q(database, "custom_interval_seconds")} = ${p(database, 8)}, ${q(database, "next_run_at")} = ${p(database, 9)}, ${q(database, "expected_source_version")} = ${p(database, 10)}, ${q(database, "revision")} = ${p(database, 11)}, ${q(database, "updated_at")} = ${p(database, 12)} WHERE ${q(database, "tenant_id")} = ${p(database, 13)} AND ${q(database, "knowledge_space_id")} = ${p(database, 14)} AND ${q(database, "source_id")} = ${p(database, 15)} AND ${q(database, "revision")} = ${p(database, 16)};`,
          tableName: policyTable,
        });
        if (result.rowsAffected !== 1) policyConflict();
        return policy;
      }),
    listDueSyncPolicies: async ({ cursor, limit, now }) => {
      listLimit(limit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = cursor ? [now, cursor, readLimit] : [now, readLimit];
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, policyTable)} WHERE ${q(database, "enabled")} = ${database.dialect === "postgres" ? "TRUE" : "1"} AND ${q(database, "next_run_at")} <= ${p(database, 1)}${cursor ? ` AND ${q(database, "id")} > ${p(database, 2)}` : ""} ORDER BY ${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName: policyTable,
      });
      return resultPage(result.rows.map(mapPolicy), limit, (policy) => policy.id);
    },
    getSyncPolicy: ({ knowledgeSpaceId, sourceId, tenantId }) =>
      getPolicy(database, database, { knowledgeSpaceId, sourceId, tenantId }, false),
    enqueueDueSyncRuns: ({ limit, maxExecutionAttempts, now }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxClaimBatchSize) {
        throw new Error(`Source sync due enqueue limit must be 1-${maxClaimBatchSize}`);
      }
      if (!Number.isSafeInteger(maxExecutionAttempts) || maxExecutionAttempts < 1) {
        throw new Error("Source sync execution attempt budget must be positive");
      }
      return database.transaction(async (tx) => {
        const candidates = await tx.execute({
          maxRows: limit,
          operation: "select",
          params: [now, limit],
          sql: `SELECT * FROM ${q(database, policyTable)} WHERE ${q(database, "enabled")} = ${database.dialect === "postgres" ? "TRUE" : "1"} AND ${q(database, "next_run_at")} <= ${p(database, 1)} ORDER BY ${q(database, "tenant_id")} ASC, ${q(database, "knowledge_space_id")} ASC, ${q(database, "source_id")} ASC LIMIT ${p(database, 2)};`,
          tableName: policyTable,
        });
        const queued: SourceWorkflowRun[] = [];
        for (const candidateRow of candidates.rows) {
          const candidate = mapPolicy(candidateRow);
          if (!(await lockKnowledgeSpaceForDeletionAdmission(database, tx, candidate))) continue;
          let sourceRow: DatabaseRow | undefined;
          try {
            const permission = await assertSourceWorkflowPermissionFence(
              database,
              tx,
              candidate,
              now,
            );
            await lockSourceWorkflowAdmissions(
              database,
              tx,
              candidate.knowledgeSpaceId,
              [candidate.sourceId],
              permission,
            );
            const sourceResult = await tx.execute({
              maxRows: 1,
              operation: "select",
              params: [candidate.tenantId, candidate.knowledgeSpaceId, candidate.sourceId],
              sql: `SELECT ${q(database, "version")}, ${q(database, "status")}, ${q(database, "permission_scope")} FROM ${q(database, "sources")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} LIMIT 1;`,
              tableName: "sources",
            });
            sourceRow = sourceResult.rows[0];
          } catch (error) {
            if (
              !(error instanceof SourceWorkflowError) ||
              ![
                "SOURCE_WORKFLOW_PERMISSION_INVALID",
                "SOURCE_WORKFLOW_SOURCE_NOT_WRITABLE",
              ].includes(error.code)
            ) {
              throw error;
            }
            const stalePolicy = await getPolicy(database, tx, candidate, true);
            if (
              stalePolicy?.enabled &&
              stalePolicy.revision === candidate.revision &&
              stalePolicy.nextRunAt &&
              stalePolicy.nextRunAt <= now
            ) {
              await disableSyncPolicy(database, tx, stalePolicy, now);
            }
            continue;
          }
          const policy = await getPolicy(database, tx, candidate, true);
          if (
            !policy?.enabled ||
            policy.revision !== candidate.revision ||
            !policy.nextRunAt ||
            policy.nextRunAt > now
          )
            continue;
          if (
            !sourceRow ||
            numberColumn(sourceRow, "version") !== policy.expectedSourceVersion ||
            stringColumn(sourceRow, "status") === "disabled"
          ) {
            await disableSyncPolicy(database, tx, policy, now);
            continue;
          }
          const scheduledFor = policy.nextRunAt;
          const run: SourceWorkflowRun = {
            accessChannel: policy.accessChannel,
            activeSlot: 1,
            checkpoint: "queued",
            createdAt: now,
            executionAttempts: 0,
            id: generateRunId(),
            idempotencyKey: `sync-policy:${policy.id}:${scheduledFor}`,
            knowledgeSpaceId: policy.knowledgeSpaceId,
            kind: "sync",
            maxExecutionAttempts,
            payload: { scheduledFor, syncPolicyId: policy.id },
            permissionSnapshotId: policy.permissionSnapshotId,
            permissionSnapshotRevision: policy.permissionSnapshotRevision,
            progressCompleted: 0,
            progressFailed: 0,
            progressSkipped: 0,
            requestedBySubjectId: policy.requestedBySubjectId,
            requiredPermissionScope: jsonStringArrayColumn(sourceRow, "permission_scope"),
            rowVersion: 1,
            sourceId: policy.sourceId,
            state: "queued",
            tenantId: policy.tenantId,
            updatedAt: now,
          };
          await insertRun(database, tx, run);
          await insertOutbox(database, tx, {
            availableAt: now,
            deliveryRevision: 1,
            id: generateOutboxId(),
            runId: run.id,
          });
          const advanced = await tx.execute({
            maxRows: 0,
            operation: "update",
            params: [
              nextSyncPolicyRunAt(policy.mode, policy.customIntervalSeconds, now),
              policy.revision + 1,
              now,
              policy.id,
              policy.revision,
            ],
            sql: `UPDATE ${q(database, policyTable)} SET ${q(database, "next_run_at")} = ${p(database, 1)}, ${q(database, "revision")} = ${p(database, 2)}, ${q(database, "updated_at")} = ${p(database, 3)} WHERE ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "revision")} = ${p(database, 5)};`,
            tableName: policyTable,
          });
          if (advanced.rowsAffected !== 1) policyConflict();
          queued.push(run);
        }
        return queued;
      });
    },
  };
}

async function disableSyncPolicy(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  policy: SourceSyncPolicyRecord,
  now: string,
): Promise<void> {
  const result = await tx.execute({
    maxRows: 0,
    operation: "update",
    params: [policy.revision + 1, now, policy.id, policy.revision],
    sql: `UPDATE ${q(database, policyTable)} SET ${q(database, "enabled")} = ${database.dialect === "postgres" ? "FALSE" : "0"}, ${q(database, "next_run_at")} = NULL, ${q(database, "revision")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "revision")} = ${p(database, 4)};`,
    tableName: policyTable,
  });
  if (result.rowsAffected !== 1) policyConflict();
}

async function insertBulkItems(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  run: SourceWorkflowRun,
  items: readonly SourceBulkWorkflowItem[],
  idempotent: boolean,
): Promise<void> {
  for (const item of items) {
    if (item.runId !== run.id) invalidState();
    const params: DatabaseQueryValue[] = [
      item.id,
      run.tenantId,
      run.knowledgeSpaceId,
      item.runId,
      item.sourceId,
      item.childRunId ?? null,
      item.deletionJobId ?? null,
      item.action,
      item.status,
      item.reason ?? null,
      item.errorCode ?? null,
      item.updatedAt,
    ];
    await tx.execute({
      maxRows: 0,
      operation: "insert",
      params,
      sql: `${idempotent && database.dialect === "tidb" ? "INSERT IGNORE" : "INSERT"} INTO ${q(database, bulkTable)} (${[
        "id",
        "tenant_id",
        "knowledge_space_id",
        "run_id",
        "source_id",
        "child_run_id",
        "deletion_job_id",
        "action",
        "status",
        "reason",
        "error_code",
        "updated_at",
      ]
        .map((column) => q(database, column))
        .join(
          ", ",
        )}) VALUES (${params.map((_, index) => p(database, index + 1)).join(", ")})${idempotent && database.dialect === "postgres" ? " ON CONFLICT DO NOTHING" : ""};`,
      tableName: bulkTable,
    });
  }
}

async function insertRun(database: DatabaseAdapter, tx: DatabaseExecutor, run: SourceWorkflowRun) {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "source_id",
    "source_scope",
    "kind",
    "run_state",
    "checkpoint",
    "payload",
    "cursor",
    "progress_total",
    "progress_completed",
    "progress_skipped",
    "progress_failed",
    "capability_grant_id",
    "permission_snapshot_id",
    "permission_snapshot_revision",
    "requested_by_subject_id",
    "access_channel",
    "idempotency_key",
    "idempotency_digest",
    "execution_attempts",
    "max_execution_attempts",
    "worker_id",
    "lease_token",
    "lease_expires_at",
    "row_version",
    "active_slot",
    "last_error_code",
    "last_error_message",
    "created_at",
    "updated_at",
    "completed_at",
    "canceled_at",
    "required_permission_scope",
  ] as const;
  const params = runParams(run);
  await tx.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, runTable)} (${columns.map((column) => q(database, column)).join(", ")}) VALUES (${columns.map((column, index) => (column === "payload" || column === "required_permission_scope" ? jsonValue(database, index + 1) : p(database, index + 1))).join(", ")});`,
    tableName: runTable,
  });
}

function runParams(run: SourceWorkflowRun): DatabaseQueryValue[] {
  return [
    run.id,
    run.tenantId,
    run.knowledgeSpaceId,
    run.sourceId ?? null,
    run.sourceId ? `source:${run.sourceId}` : `bulk:${run.id}`,
    run.kind,
    run.state,
    run.checkpoint,
    JSON.stringify(run.payload),
    run.cursor ?? null,
    run.progressTotal ?? null,
    run.progressCompleted,
    run.progressSkipped,
    run.progressFailed,
    run.capabilityGrantId ?? null,
    run.capabilityGrantId ? null : (run.permissionSnapshotId ?? null),
    run.capabilityGrantId ? null : (run.permissionSnapshotRevision ?? null),
    run.capabilityGrantId ? null : (run.requestedBySubjectId ?? null),
    run.capabilityGrantId ? null : (run.accessChannel ?? null),
    run.idempotencyKey,
    workflowIdempotencyDigest(run),
    run.executionAttempts,
    run.maxExecutionAttempts,
    run.workerId ?? null,
    run.leaseToken ?? null,
    run.leaseExpiresAt ?? null,
    run.rowVersion,
    run.activeSlot ?? null,
    run.lastErrorCode ?? null,
    run.lastErrorMessage ?? null,
    run.createdAt,
    run.updatedAt,
    run.completedAt ?? null,
    run.canceledAt ?? null,
    run.capabilityGrantId ? null : JSON.stringify(run.requiredPermissionScope ?? []),
  ];
}

async function mutateFenced(
  database: DatabaseAdapter,
  fence: SourceWorkflowFence,
  now: string,
  mutation: (current: SourceWorkflowRun) => SourceWorkflowRun,
) {
  return database.transaction(async (tx) => {
    const { run: current } = await requireFenced(database, tx, fence, now);
    const next = mutation(current);
    return writeFenced(database, tx, current, next);
  });
}

async function writeFenced(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  current: SourceWorkflowRun,
  next: SourceWorkflowRun,
) {
  const result = await updateRun(
    database,
    tx,
    next,
    ` AND ${q(database, "worker_id")} = ${p(database, 34)} AND ${q(database, "lease_token")} = ${p(database, 35)}`,
    [current.workerId ?? null, current.leaseToken ?? null],
  );
  if (result.rowsAffected !== 1) fenceConflict();
  return next;
}

async function writeUnfenced(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  next: SourceWorkflowRun,
) {
  const result = await updateRun(database, tx, next, "", []);
  if (result.rowsAffected !== 1) fenceConflict();
  return next;
}

async function updateRun(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  next: SourceWorkflowRun,
  extraWhere: string,
  extraParams: readonly DatabaseQueryValue[],
) {
  const mutableColumns = [
    "source_id",
    "source_scope",
    "kind",
    "run_state",
    "checkpoint",
    "payload",
    "cursor",
    "progress_total",
    "progress_completed",
    "progress_skipped",
    "progress_failed",
    "permission_snapshot_id",
    "permission_snapshot_revision",
    "requested_by_subject_id",
    "access_channel",
    "idempotency_key",
    "idempotency_digest",
    "execution_attempts",
    "max_execution_attempts",
    "worker_id",
    "lease_token",
    "lease_expires_at",
    "row_version",
    "active_slot",
    "last_error_code",
    "last_error_message",
    "updated_at",
    "completed_at",
    "canceled_at",
    "required_permission_scope",
  ] as const;
  const allParams = runParams(next);
  // Immutable id/tenant/space occupy 0..2 and created_at is immutable at index 29.
  const sourceParams = [...allParams.slice(3, 29), ...allParams.slice(30)];
  const updateParams = [...sourceParams, next.id, next.rowVersion - 1, ...extraParams];
  const idPosition = mutableColumns.length + 1;
  const versionPosition = idPosition + 1;
  const fencedWhere = extraWhere
    .replaceAll("34", String(versionPosition + 1))
    .replaceAll("35", String(versionPosition + 2));
  return tx.execute({
    maxRows: 0,
    operation: "update",
    params: updateParams,
    sql: `UPDATE ${q(database, runTable)} SET ${mutableColumns.map((column, index) => `${q(database, column)} = ${column === "payload" || column === "required_permission_scope" ? jsonValue(database, index + 1) : p(database, index + 1)}`).join(", ")} WHERE ${q(database, "id")} = ${p(database, idPosition)} AND ${q(database, "row_version")} = ${p(database, versionPosition)}${fencedWhere};`,
    tableName: runTable,
  });
}

async function requireFenced(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  fence: SourceWorkflowFence,
  now: string,
  additionalSourceIds: readonly string[] = [],
  allowInvalidPermission = false,
) {
  const admitted = await getRunForMutationAdmission(
    database,
    tx,
    fence.runId,
    now,
    undefined,
    additionalSourceIds,
    allowInvalidPermission,
  );
  const run = admitted?.run;
  if (
    !run ||
    run.rowVersion !== fence.rowVersion ||
    run.workerId !== fence.workerId ||
    run.leaseToken !== fence.leaseToken ||
    !["running", "crawling", "importing", "syncing"].includes(run.state)
  )
    fenceConflict();
  return { permission: admitted.permission, run, sourceScopes: admitted.sourceScopes };
}

async function getRunForMutationAdmission(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  runId: string,
  now: string,
  authorizationOverride?: Pick<
    SourceWorkflowRun,
    | "accessChannel"
    | "capabilityGrantId"
    | "permissionSnapshotId"
    | "permissionSnapshotRevision"
    | "requestedBySubjectId"
  >,
  additionalSourceIds: readonly string[] = [],
  allowInvalidPermission = false,
): Promise<{
  readonly permission: SourceWorkflowAuthorization | undefined;
  readonly run: SourceWorkflowRun;
  readonly sourceScopes: ReadonlyMap<string, readonly string[]>;
} | null> {
  const candidate = await getRun(database, tx, runId, false);
  if (!candidate) return null;
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, tx, candidate))) {
    throw new SourceWorkflowError(
      "SOURCE_WORKFLOW_SPACE_NOT_WRITABLE",
      "Knowledge space is missing or deletion-fenced",
    );
  }
  const authorizationBinding = authorizationOverride
    ? { ...candidate, ...authorizationOverride }
    : candidate;
  let permission: SourceWorkflowAuthorization | undefined;
  try {
    permission = await assertSourceWorkflowPermissionFence(database, tx, authorizationBinding, now);
  } catch (error) {
    if (
      !allowInvalidPermission ||
      !(error instanceof SourceWorkflowError) ||
      error.code !== "SOURCE_WORKFLOW_PERMISSION_INVALID"
    ) {
      throw error;
    }
  }
  let sourceScopes: ReadonlyMap<string, readonly string[]>;
  try {
    sourceScopes = await lockSourceWorkflowAdmissions(
      database,
      tx,
      candidate.knowledgeSpaceId,
      [candidate.sourceId, ...additionalSourceIds],
      permission,
    );
  } catch (error) {
    if (
      !allowInvalidPermission ||
      !(error instanceof SourceWorkflowError) ||
      error.code !== "SOURCE_WORKFLOW_PERMISSION_INVALID"
    ) {
      throw error;
    }
    permission = undefined;
    sourceScopes = await lockSourceWorkflowAdmissions(
      database,
      tx,
      candidate.knowledgeSpaceId,
      [candidate.sourceId, ...additionalSourceIds],
      undefined,
      true,
    );
  }
  const current = await getRun(database, tx, runId, true);
  if (!current) return null;
  if (
    current.tenantId !== candidate.tenantId ||
    current.knowledgeSpaceId !== candidate.knowledgeSpaceId ||
    current.sourceId !== candidate.sourceId ||
    stableJson(current.requiredPermissionScope) !== stableJson(candidate.requiredPermissionScope) ||
    (!authorizationOverride &&
      (current.accessChannel !== candidate.accessChannel ||
        current.capabilityGrantId !== candidate.capabilityGrantId ||
        current.permissionSnapshotId !== candidate.permissionSnapshotId ||
        current.permissionSnapshotRevision !== candidate.permissionSnapshotRevision ||
        current.requestedBySubjectId !== candidate.requestedBySubjectId))
  ) {
    fenceConflict();
  }
  return { permission, run: current, sourceScopes };
}

async function lockSourceWorkflowAdmissions(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  knowledgeSpaceId: string,
  sourceIds: readonly (string | undefined)[],
  permission: SourceWorkflowAuthorization | undefined,
  allowMalformedPermissionScope = false,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const scopes = new Map<string, readonly string[]>();
  for (const sourceId of [
    ...new Set(sourceIds.filter((value): value is string => Boolean(value))),
  ].sort()) {
    const sourceScope = allowMalformedPermissionScope
      ? await requireSourceWorkflowAdmission(database, tx, knowledgeSpaceId, sourceId, true)
      : await requireSourceWorkflowAdmission(database, tx, knowledgeSpaceId, sourceId);
    if (!sourceScope) {
      scopes.set(sourceId, []);
      continue;
    }
    if (permission) assertSourceWorkflowScopeAllowed(sourceScope, permission.permissionScopes);
    scopes.set(sourceId, sourceScope);
  }
  return scopes;
}

async function requireSourceWorkflowAdmission(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  knowledgeSpaceId: string,
  sourceId: string,
): Promise<readonly string[]>;
async function requireSourceWorkflowAdmission(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  knowledgeSpaceId: string,
  sourceId: string,
  allowMalformedPermissionScope: true,
): Promise<readonly string[] | null>;
async function requireSourceWorkflowAdmission(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  knowledgeSpaceId: string,
  sourceId: string,
  allowMalformedPermissionScope = false,
): Promise<readonly string[] | null> {
  const source = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [knowledgeSpaceId, sourceId],
    sql: `SELECT ${q(database, "status")}, ${q(database, "deletion_job_id")}, ${q(database, "permission_scope")} FROM ${q(database, "sources")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} LIMIT 1 FOR UPDATE;`,
    tableName: "sources",
  });
  const row = source.rows[0];
  if (!row || row.status === "deleting" || row.deletion_job_id != null) {
    throw new SourceWorkflowError(
      "SOURCE_WORKFLOW_SOURCE_NOT_WRITABLE",
      "Source is missing or deletion-fenced",
    );
  }
  let permissionScope: readonly string[] | null = null;
  try {
    permissionScope = candidatePermissionScopeSnapshot(
      jsonStringArrayColumn(row, "permission_scope"),
    );
  } catch {
    permissionScope = null;
  }
  if (!permissionScope) {
    if (allowMalformedPermissionScope) return null;
    throw new SourceWorkflowError(
      "SOURCE_WORKFLOW_PERMISSION_INVALID",
      "Source permission scope is malformed",
    );
  }
  return permissionScope;
}

async function assertSourceWorkflowPermissionFence(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  binding: Pick<
    SourceWorkflowRun,
    | "accessChannel"
    | "capabilityGrantId"
    | "knowledgeSpaceId"
    | "permissionSnapshotId"
    | "permissionSnapshotRevision"
    | "requestedBySubjectId"
    | "requiredPermissionScope"
    | "sourceId"
    | "tenantId"
  >,
  now: string,
): Promise<SourceWorkflowAuthorization> {
  if (binding.capabilityGrantId) {
    try {
      const grant = await resolveCapabilityJobPublicationGrant(database, tx, {
        capabilityGrantId: binding.capabilityGrantId,
        knowledgeSpaceId: binding.knowledgeSpaceId,
        tenantId: binding.tenantId,
      });
      return { permissionScopes: grant.contentScopeIds };
    } catch {
      throw new SourceWorkflowError(
        "SOURCE_WORKFLOW_PERMISSION_INVALID",
        "Capability grant is no longer active",
      );
    }
  }
  if (
    !binding.accessChannel ||
    !binding.permissionSnapshotId ||
    !binding.permissionSnapshotRevision ||
    !binding.requestedBySubjectId ||
    !binding.requiredPermissionScope
  ) {
    throw new SourceWorkflowError(
      "SOURCE_WORKFLOW_PERMISSION_INVALID",
      "Durable source workflow permission provenance is incomplete",
    );
  }
  let permission: KnowledgeSpacePermissionSnapshot;
  try {
    permission = await assertDatabaseKnowledgeSpacePermissionFence({
      database,
      executor: tx,
      fence: {
        accessChannel: binding.accessChannel,
        knowledgeSpaceId: binding.knowledgeSpaceId,
        permissionSnapshotId: binding.permissionSnapshotId,
        permissionSnapshotRevision: binding.permissionSnapshotRevision,
        requestedBySubjectId: binding.requestedBySubjectId,
        tenantId: binding.tenantId,
      },
      now,
      requiredAccess: "write",
    });
  } catch (error) {
    if (!(error instanceof KnowledgeSpaceAccessError)) throw error;
    throw new SourceWorkflowError(
      "SOURCE_WORKFLOW_PERMISSION_INVALID",
      "Durable source workflow permission is no longer valid",
    );
  }
  assertSourceWorkflowScopeAllowed(binding.requiredPermissionScope, permission.permissionScopes);
  return permission;
}

interface SourceWorkflowAuthorization {
  readonly permissionScopes: readonly string[];
}

function assertSourceWorkflowScopeAllowed(
  requiredPermissionScope: readonly string[],
  candidateGrants: readonly string[],
): void {
  if (!candidatePermissionScopeAllows(requiredPermissionScope, candidateGrants)) {
    throw new SourceWorkflowError(
      "SOURCE_WORKFLOW_PERMISSION_INVALID",
      "Durable source workflow candidate scope is no longer authorized",
    );
  }
}

async function getRun(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  runId: string,
  lock: boolean,
) {
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [runId],
    sql: `SELECT * FROM ${q(database, runTable)} WHERE ${q(database, "id")} = ${p(database, 1)} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: runTable,
  });
  return result.rows[0] ? mapRun(result.rows[0]) : null;
}

async function findByIdempotency(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  input: {
    capabilityGrantId?: string | undefined;
    tenantId: string;
    knowledgeSpaceId: string;
    requestedBySubjectId?: string | undefined;
    idempotencyKey: string;
  },
) {
  const digest = workflowIdempotencyDigest(input);
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [digest],
    sql: `SELECT * FROM ${q(database, runTable)} WHERE ${q(database, "idempotency_digest")} = ${p(database, 1)} LIMIT 1 FOR UPDATE;`,
    tableName: runTable,
  });
  if (!result.rows[0]) return null;
  const replay = mapRun(result.rows[0]);
  if (
    replay.tenantId !== input.tenantId ||
    replay.knowledgeSpaceId !== input.knowledgeSpaceId ||
    replay.capabilityGrantId !== input.capabilityGrantId ||
    replay.requestedBySubjectId !== input.requestedBySubjectId ||
    replay.idempotencyKey !== input.idempotencyKey
  ) {
    idempotencyConflict();
  }
  return replay;
}

function workflowIdempotencyDigest(input: {
  readonly capabilityGrantId?: string | undefined;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly requestedBySubjectId?: string | undefined;
  readonly tenantId: string;
}): string {
  const hash = createHash("sha256");
  const authorizationIdentity = input.capabilityGrantId
    ? `capability:${input.capabilityGrantId}`
    : input.requestedBySubjectId
      ? input.requestedBySubjectId
      : undefined;
  if (!authorizationIdentity) {
    throw new SourceWorkflowError(
      "SOURCE_WORKFLOW_PERMISSION_INVALID",
      "Durable source workflow authorization binding is missing",
    );
  }
  hash.update(input.capabilityGrantId ? "v2|" : "v1|");
  for (const value of [
    input.tenantId,
    input.knowledgeSpaceId,
    authorizationIdentity,
    input.idempotencyKey,
  ]) {
    hash.update(`${Buffer.byteLength(value, "utf8")}:`);
    hash.update(value, "utf8");
    hash.update("|");
  }
  return hash.digest("hex");
}

async function insertOutbox(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  value: { id: string; runId: string; deliveryRevision: number; availableAt: string },
) {
  const params: DatabaseQueryValue[] = [
    value.id,
    value.runId,
    value.deliveryRevision,
    value.availableAt,
    value.availableAt,
    value.availableAt,
  ];
  await tx.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, outboxTable)} (${["id", "run_id", "delivery_revision", "status", "available_at", "created_at", "updated_at"].map((column) => q(database, column)).join(", ")}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, 'pending', ${p(database, 4)}, ${p(database, 5)}, ${p(database, 6)});`,
    tableName: outboxTable,
  });
}

async function nextDeliveryRevision(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  runId: string,
) {
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [runId],
    sql: `SELECT ${q(database, "delivery_revision")} AS ${q(database, "revision")} FROM ${q(database, outboxTable)} WHERE ${q(database, "run_id")} = ${p(database, 1)} ORDER BY ${q(database, "delivery_revision")} DESC LIMIT 1 FOR UPDATE;`,
    tableName: outboxTable,
  });
  return Number(result.rows[0]?.revision ?? 0) + 1;
}

async function finishOutbox(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  runId: string,
  status: "completed" | "canceled",
  now: string,
) {
  await tx.execute({
    maxRows: 0,
    operation: "update",
    params: [status, now, now, runId],
    sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "locked_by")} = NULL, ${q(database, "lock_token")} = NULL, ${q(database, "locked_until")} = NULL, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(database, "delivered_at")} = ${p(database, 3)} WHERE ${q(database, "run_id")} = ${p(database, 4)} AND ${q(database, "status")} IN ('pending', 'leased');`,
    tableName: outboxTable,
  });
}

async function writeTerminal(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  current: SourceWorkflowRun,
  value: { state: "failed"; errorCode: string; errorMessage: string; now: string },
) {
  return writeUnfenced(database, tx, {
    ...current,
    activeSlot: undefined,
    completedAt: value.now,
    lastErrorCode: value.errorCode,
    lastErrorMessage: value.errorMessage.slice(0, 1_000),
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    rowVersion: current.rowVersion + 1,
    state: value.state,
    updatedAt: value.now,
    workerId: undefined,
  });
}

async function appendSourceWorkflowActivity(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  run: SourceWorkflowRun,
  action: "source.failed" | "source.synced",
  result: "failure" | "success",
  now: string,
) {
  if (!run.sourceId) return;
  const source = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [run.knowledgeSpaceId, run.sourceId],
    sql: `SELECT ${q(database, "permission_scope")} FROM ${q(database, "sources")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} LIMIT 1;`,
    tableName: "sources",
  });
  const row = source.rows[0];
  if (!row)
    throw new SourceWorkflowError(
      "SOURCE_NOT_FOUND",
      "Source disappeared during workflow completion",
    );
  const requiredPermissionScope = candidatePermissionScopeSnapshot(
    jsonStringArrayColumn(row, "permission_scope"),
  );
  await appendKnowledgeSpaceActivityWithExecutor({
    database,
    executor: tx,
    input: {
      action,
      actor: { id: run.requestedBySubjectId, type: "member" },
      details: {
        ...(run.lastErrorCode ? { reasonCode: run.lastErrorCode } : {}),
        count: run.progressCompleted,
      },
      id: deterministicKnowledgeSpaceActivityId(action, run.tenantId, run.knowledgeSpaceId, run.id),
      knowledgeSpaceId: run.knowledgeSpaceId,
      occurredAt: now,
      requiredPermissionScope: requiredPermissionScope ?? ["__deny__"],
      resource: { id: run.sourceId, type: "source" },
      result,
      tenantId: run.tenantId,
    },
  });
}

async function getBulkItem(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  runId: string,
  itemId: string,
  lock: boolean,
): Promise<SourceBulkWorkflowItem | null> {
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [runId, itemId],
    sql: `SELECT * FROM ${q(database, bulkTable)} WHERE ${q(database, "run_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: bulkTable,
  });
  return result.rows[0] ? mapBulkItem(result.rows[0]) : null;
}

async function getCrawlPage(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  runId: string,
  pageId: string,
) {
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [runId, pageId],
    sql: `SELECT * FROM ${q(database, crawlTable)} WHERE ${q(database, "run_id")} = ${p(database, 1)} AND ${q(database, "page_id")} = ${p(database, 2)} LIMIT 1;`,
    tableName: crawlTable,
  });
  return result.rows[0] ? mapCrawlPage(result.rows[0]) : null;
}

async function getPolicy(
  database: DatabaseAdapter,
  tx: DatabaseExecutor,
  input: { tenantId: string; knowledgeSpaceId: string; sourceId: string },
  lock: boolean,
) {
  const result = await tx.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.sourceId],
    sql: `SELECT * FROM ${q(database, policyTable)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "source_id")} = ${p(database, 3)} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: policyTable,
  });
  return result.rows[0] ? mapPolicy(result.rows[0]) : null;
}

function policyParams(policy: SourceSyncPolicyRecord): DatabaseQueryValue[] {
  return [
    policy.id,
    policy.tenantId,
    policy.knowledgeSpaceId,
    policy.sourceId,
    policy.requestedBySubjectId,
    policy.accessChannel,
    policy.permissionSnapshotId,
    policy.permissionSnapshotRevision,
    JSON.stringify(policy.requiredPermissionScope),
    policy.mode,
    policy.enabled,
    policy.customIntervalSeconds ?? null,
    policy.nextRunAt ?? null,
    policy.expectedSourceVersion,
    policy.revision,
    policy.createdAt,
    policy.updatedAt,
  ];
}

function mapRun(row: DatabaseRow): SourceWorkflowRun {
  const state = stringColumn(row, "run_state") as SourceWorkflowRun["state"];
  const accessChannel = optionalStringColumn(row, "access_channel") as
    | SourceWorkflowRun["accessChannel"]
    | undefined;
  const activeSlot = optionalNumberColumn(row, "active_slot");
  const payload = jsonObjectColumn(row, "payload") as Record<string, JobPayload>;
  return {
    ...(accessChannel ? { accessChannel } : {}),
    ...(activeSlot === undefined ? {} : { activeSlot }),
    ...(optionalStringColumn(row, "canceled_at")
      ? { canceledAt: stringColumn(row, "canceled_at") }
      : {}),
    checkpoint: stringColumn(row, "checkpoint") as SourceWorkflowRun["checkpoint"],
    ...(optionalStringColumn(row, "completed_at")
      ? { completedAt: stringColumn(row, "completed_at") }
      : {}),
    createdAt: stringColumn(row, "created_at"),
    ...(optionalStringColumn(row, "cursor") ? { cursor: stringColumn(row, "cursor") } : {}),
    executionAttempts: numberColumn(row, "execution_attempts"),
    id: stringColumn(row, "id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    kind: stringColumn(row, "kind") as SourceWorkflowRun["kind"],
    ...(optionalStringColumn(row, "last_error_code")
      ? { lastErrorCode: stringColumn(row, "last_error_code") }
      : {}),
    ...(optionalStringColumn(row, "last_error_message")
      ? { lastErrorMessage: stringColumn(row, "last_error_message") }
      : {}),
    ...(optionalStringColumn(row, "lease_expires_at")
      ? { leaseExpiresAt: stringColumn(row, "lease_expires_at") }
      : {}),
    ...(optionalStringColumn(row, "lease_token")
      ? { leaseToken: stringColumn(row, "lease_token") }
      : {}),
    maxExecutionAttempts: numberColumn(row, "max_execution_attempts"),
    payload,
    ...(optionalStringColumn(row, "capability_grant_id")
      ? { capabilityGrantId: stringColumn(row, "capability_grant_id") }
      : {}),
    ...(optionalStringColumn(row, "permission_snapshot_id")
      ? { permissionSnapshotId: stringColumn(row, "permission_snapshot_id") }
      : {}),
    ...(optionalNumberColumn(row, "permission_snapshot_revision") === undefined
      ? {}
      : { permissionSnapshotRevision: numberColumn(row, "permission_snapshot_revision") }),
    progressCompleted: numberColumn(row, "progress_completed"),
    progressFailed: numberColumn(row, "progress_failed"),
    progressSkipped: numberColumn(row, "progress_skipped"),
    ...(optionalNumberColumn(row, "progress_total") === undefined
      ? {}
      : { progressTotal: numberColumn(row, "progress_total") }),
    ...(optionalStringColumn(row, "requested_by_subject_id")
      ? { requestedBySubjectId: stringColumn(row, "requested_by_subject_id") }
      : {}),
    ...(row.required_permission_scope == null
      ? {}
      : { requiredPermissionScope: jsonStringArrayColumn(row, "required_permission_scope") }),
    rowVersion: numberColumn(row, "row_version"),
    ...(optionalStringColumn(row, "source_id") ? { sourceId: stringColumn(row, "source_id") } : {}),
    state,
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    ...(optionalStringColumn(row, "worker_id") ? { workerId: stringColumn(row, "worker_id") } : {}),
  };
}

function mapCrawlPage(row: DatabaseRow): SourceCrawlPreviewPage {
  return {
    contentHash: stringColumn(row, "content_hash"),
    contentObjectKey: stringColumn(row, "content_object_key"),
    createdAt: stringColumn(row, "created_at"),
    ...(optionalStringColumn(row, "description")
      ? { description: stringColumn(row, "description") }
      : {}),
    ...(optionalStringColumn(row, "etag") ? { etag: stringColumn(row, "etag") } : {}),
    id: stringColumn(row, "id"),
    pageId: stringColumn(row, "page_id"),
    runId: stringColumn(row, "run_id"),
    sourceUrl: stringColumn(row, "source_url"),
    ...(optionalStringColumn(row, "title") ? { title: stringColumn(row, "title") } : {}),
  };
}

function mapBulkItem(row: DatabaseRow): SourceBulkWorkflowItem {
  const action = stringColumn(row, "action") as SourceBulkWorkflowItem["action"];
  const childRunId = optionalStringColumn(row, "child_run_id");
  const deletionJobId = optionalStringColumn(row, "deletion_job_id");
  return {
    action,
    ...(childRunId ? { childRunId } : {}),
    ...(deletionJobId ? { deletionJobId } : {}),
    ...(optionalStringColumn(row, "error_code")
      ? { errorCode: stringColumn(row, "error_code") }
      : {}),
    id: stringColumn(row, "id"),
    ...(optionalStringColumn(row, "reason") ? { reason: stringColumn(row, "reason") } : {}),
    runId: stringColumn(row, "run_id"),
    sourceId: stringColumn(row, "source_id"),
    status: stringColumn(row, "status") as SourceBulkWorkflowItem["status"],
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function mapPolicy(row: DatabaseRow): SourceSyncPolicyRecord {
  return {
    accessChannel: stringColumn(row, "access_channel") as SourceSyncPolicyRecord["accessChannel"],
    createdAt: stringColumn(row, "created_at"),
    ...(optionalNumberColumn(row, "custom_interval_seconds") === undefined
      ? {}
      : { customIntervalSeconds: numberColumn(row, "custom_interval_seconds") }),
    enabled: Boolean(row.enabled),
    expectedSourceVersion: numberColumn(row, "expected_source_version"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    mode: stringColumn(row, "mode") as SourceSyncPolicyRecord["mode"],
    ...(optionalStringColumn(row, "next_run_at")
      ? { nextRunAt: stringColumn(row, "next_run_at") }
      : {}),
    permissionSnapshotId: stringColumn(row, "permission_snapshot_id"),
    permissionSnapshotRevision: numberColumn(row, "permission_snapshot_revision"),
    requestedBySubjectId: stringColumn(row, "requested_by_subject_id"),
    requiredPermissionScope: jsonStringArrayColumn(row, "required_permission_scope"),
    revision: numberColumn(row, "revision"),
    sourceId: stringColumn(row, "source_id"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function resultPage<T>(rows: readonly T[], limit: number, cursor: (item: T) => string) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, ...(rows.length > limit && last ? { nextCursor: cursor(last) } : {}) };
}

function executingState(run: SourceWorkflowRun): SourceWorkflowState {
  if (run.kind === "crawl-preview") return run.payload.selectedPageIds ? "importing" : "crawling";
  if (run.kind === "sync") return "syncing";
  if (run.kind === "bulk") return "running";
  return "importing";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function bulkItemTransitionAllowed(
  current: SourceBulkWorkflowItem["status"],
  next: SourceBulkWorkflowItem["status"],
): boolean {
  if (current === next) return true;
  if (current === "eligible") {
    return next === "skipped" || next === "failed" || next === "completed";
  }
  return current === "running" && (next === "failed" || next === "completed");
}

function q(database: DatabaseAdapter, value: string) {
  return quoteDatabaseIdentifier(database, value);
}
function p(database: DatabaseAdapter, index: number) {
  return databasePlaceholder(database, index);
}
function jsonValue(database: DatabaseAdapter, index: number) {
  const placeholder = p(database, index);
  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}
function permissionScopeSql(database: DatabaseAdapter, column: string, grants: string) {
  return database.dialect === "postgres"
    ? `(jsonb_typeof(${column}) = 'array' AND ${grants}::jsonb @> ${column})`
    : `(JSON_TYPE(${column}) = 'ARRAY' AND JSON_CONTAINS(CAST(${grants} AS JSON), ${column}))`;
}

/**
 * Capability-owned runs intentionally retain only their immutable grant reference. Resolve the
 * frozen scope through capability_grants instead of treating the nullable legacy snapshot column
 * as public content.
 */
function sourceRunPermissionScopeSql(database: DatabaseAdapter, grants: string): string {
  const runs = q(database, runTable);
  const provenance = q(database, "source_run_capability");
  const capabilityGrants = q(database, "capability_grants");
  const requiredScope = `${runs}.${q(database, "required_permission_scope")}`;
  const capabilityGrantId = `${runs}.${q(database, "capability_grant_id")}`;
  return `((${requiredScope} IS NOT NULL AND ${permissionScopeSql(
    database,
    requiredScope,
    grants,
  )}) OR (${requiredScope} IS NULL AND ${capabilityGrantId} IS NOT NULL AND EXISTS (SELECT 1 FROM ${capabilityGrants} ${provenance} WHERE ${provenance}.${q(
    database,
    "tenant_id",
  )} = ${runs}.${q(database, "tenant_id")} AND ${provenance}.${q(
    database,
    "knowledge_space_id",
  )} = ${runs}.${q(database, "knowledge_space_id")} AND ${provenance}.${q(
    database,
    "grant_id",
  )} = ${capabilityGrantId} AND ${permissionScopeSql(
    database,
    `${provenance}.${q(database, "content_scope_ids")}`,
    grants,
  )})))`;
}
function fenceConflict(): never {
  throw new SourceWorkflowError(
    "SOURCE_WORKFLOW_FENCE_CONFLICT",
    "Source workflow execution fence was lost",
  );
}
function invalidState(): never {
  throw new SourceWorkflowError(
    "SOURCE_WORKFLOW_STATE_CONFLICT",
    "Source workflow state does not allow this transition",
  );
}
function notFound(): never {
  throw new SourceWorkflowError("SOURCE_WORKFLOW_NOT_FOUND", "Source workflow not found");
}
function idempotencyConflict(): never {
  throw new SourceWorkflowError(
    "SOURCE_WORKFLOW_IDEMPOTENCY_CONFLICT",
    "Crawl selection was already submitted differently",
  );
}
function policyConflict(): never {
  throw new SourceWorkflowError("SOURCE_SYNC_POLICY_CONFLICT", "Sync policy changed concurrently");
}
