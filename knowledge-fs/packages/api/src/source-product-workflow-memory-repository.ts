import { randomUUID } from "node:crypto";

import { candidatePermissionScopeAllows } from "./candidate-content-authorization";

import {
  type NewSourceWorkflowRun,
  type SourceBulkWorkflowItem,
  type SourceCrawlPreviewPage,
  type SourceProductWorkflowRepository,
  type SourceSyncPolicyRecord,
  SourceWorkflowError,
  type SourceWorkflowFence,
  type SourceWorkflowRun,
  nextSyncPolicyRunAt,
} from "./source-product-workflow";

export function createInMemorySourceProductWorkflowRepository(input?: {
  readonly generateLeaseToken?: (() => string) | undefined;
}): SourceProductWorkflowRepository {
  const generateLeaseToken = input?.generateLeaseToken ?? randomUUID;
  const runs = new Map<string, SourceWorkflowRun>();
  const pages = new Map<string, Map<string, SourceCrawlPreviewPage>>();
  const bulkItems = new Map<string, Map<string, SourceBulkWorkflowItem>>();
  const claimable = new Set<string>();
  const claimableAt = new Map<string, string>();
  const policies = new Map<string, SourceSyncPolicyRecord>();
  const selections = new Map<string, { idempotencyKey: string; pageIds: readonly string[] }>();

  const requiredRun = (runId: string) => {
    const run = runs.get(runId);
    if (!run)
      throw new SourceWorkflowError("SOURCE_WORKFLOW_NOT_FOUND", "Source workflow not found");
    return run;
  };
  const save = (run: SourceWorkflowRun) => {
    runs.set(run.id, cloneRun(run));
    return cloneRun(run);
  };
  const fenced = (fence: SourceWorkflowFence) => {
    const run = requiredRun(fence.runId);
    if (
      run.state !== "running" &&
      run.state !== "crawling" &&
      run.state !== "importing" &&
      run.state !== "syncing"
    ) {
      fenceConflict();
    }
    if (
      run.workerId !== fence.workerId ||
      run.leaseToken !== fence.leaseToken ||
      run.rowVersion !== fence.rowVersion
    ) {
      fenceConflict();
    }
    return run;
  };
  const startRun = (
    record: NewSourceWorkflowRun,
    initialProgressSkipped = 0,
  ): SourceWorkflowRun => {
    const replay = Array.from(runs.values()).find(
      (run) =>
        run.tenantId === record.tenantId &&
        run.knowledgeSpaceId === record.knowledgeSpaceId &&
        run.requestedBySubjectId === record.requestedBySubjectId &&
        run.idempotencyKey === record.idempotencyKey,
    );
    if (replay) {
      if (
        replay.kind !== record.kind ||
        replay.sourceId !== record.sourceId ||
        stableJson(replay.payload) !== stableJson(record.payload)
      ) {
        throw new SourceWorkflowError(
          "SOURCE_WORKFLOW_IDEMPOTENCY_CONFLICT",
          "Idempotency key was used for a different source workflow",
        );
      }
      return cloneRun(replay);
    }
    const run: SourceWorkflowRun = {
      ...record,
      activeSlot: 1,
      checkpoint: "queued",
      executionAttempts: 0,
      progressCompleted: 0,
      progressFailed: 0,
      progressSkipped: initialProgressSkipped,
      rowVersion: 1,
      state: "queued",
      updatedAt: record.createdAt,
    };
    runs.set(run.id, cloneRun(run));
    claimable.add(run.id);
    claimableAt.set(run.id, record.createdAt);
    return cloneRun(run);
  };

  return {
    attachBulkRemovalJob: async ({ deletionJobId, fence, itemId, now, runId }) => {
      const current = fenced(fence);
      if (current.id !== runId || current.kind !== "bulk") invalidState();
      const items = bulkItems.get(runId);
      const item = items?.get(itemId);
      if (!item || item.action !== "remove" || item.status !== "eligible") invalidState();
      const runningItem: SourceBulkWorkflowItem = {
        ...item,
        deletionJobId,
        status: "running",
        updatedAt: now,
      };
      items?.set(item.id, runningItem);
      const parent = save({
        ...current,
        rowVersion: current.rowVersion + 1,
        updatedAt: now,
      });
      return { item: cloneBulkItem(runningItem), parent };
    },
    start: async (record) => startRun(record),
    startBulk: async ({ items, run: record }) => {
      const replay = Array.from(runs.values()).find(
        (candidate) =>
          candidate.tenantId === record.tenantId &&
          candidate.knowledgeSpaceId === record.knowledgeSpaceId &&
          candidate.requestedBySubjectId === record.requestedBySubjectId &&
          candidate.idempotencyKey === record.idempotencyKey,
      );
      if (replay) return startRun(record);
      if (record.kind !== "bulk" || items.length !== record.progressTotal) invalidState();
      const ids = new Set<string>();
      const sourceIds = new Set<string>();
      const staged = new Map<string, SourceBulkWorkflowItem>();
      for (const item of items) {
        if (item.runId !== record.id || ids.has(item.id) || sourceIds.has(item.sourceId)) {
          invalidState();
        }
        ids.add(item.id);
        sourceIds.add(item.sourceId);
        staged.set(item.id, cloneBulkItem(item));
      }
      // All validation happens before these synchronous map mutations, so the run cannot become
      // claimable without its complete frozen item set.
      bulkItems.set(record.id, staged);
      return startRun(record, items.filter((item) => item.status === "skipped").length);
    },
    claim: async ({ leaseExpiresAt, limit, now, workerId }) => {
      if (limit < 1) throw new Error("Source workflow claim limit must be positive");
      const candidates = Array.from(runs.values())
        .filter(
          (run) =>
            claimable.has(run.id) &&
            (claimableAt.get(run.id) ?? run.createdAt) <= now &&
            (run.state === "queued" ||
              (["running", "crawling", "importing", "syncing"].includes(run.state) &&
                run.leaseExpiresAt !== undefined &&
                run.leaseExpiresAt <= now)),
        )
        .sort(
          (left, right) =>
            left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
        )
        .slice(0, limit);
      const claimed: SourceWorkflowRun[] = [];
      for (const run of candidates) {
        if (run.executionAttempts >= run.maxExecutionAttempts) {
          save({
            ...run,
            activeSlot: undefined,
            completedAt: now,
            lastErrorCode: "SOURCE_WORKFLOW_ATTEMPTS_EXHAUSTED",
            lastErrorMessage: "Source workflow exhausted its execution attempt budget",
            leaseExpiresAt: undefined,
            leaseToken: undefined,
            rowVersion: run.rowVersion + 1,
            state: "failed",
            updatedAt: now,
            workerId: undefined,
          });
          claimable.delete(run.id);
          claimableAt.delete(run.id);
          continue;
        }
        const next = save({
          ...run,
          executionAttempts: run.executionAttempts + 1,
          leaseExpiresAt,
          leaseToken: generateLeaseToken(),
          rowVersion: run.rowVersion + 1,
          state:
            run.kind === "crawl-preview"
              ? "crawling"
              : run.kind === "sync"
                ? "syncing"
                : run.kind === "bulk"
                  ? "running"
                  : "importing",
          updatedAt: now,
          workerId,
        });
        claimed.push(next);
      }
      return claimed;
    },
    checkpoint: async (request) => {
      const run = fenced(request.fence);
      return save({
        ...run,
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
        rowVersion: run.rowVersion + 1,
        state: request.state,
        updatedAt: request.now,
      });
    },
    heartbeat: async ({ fence, leaseExpiresAt, now }) => {
      const run = fenced(fence);
      return save({
        ...run,
        leaseExpiresAt,
        rowVersion: run.rowVersion + 1,
        updatedAt: now,
      });
    },
    appendCrawlPages: async ({ fence, now, pages: nextPages }) => {
      const run = fenced(fence);
      if (run.kind !== "crawl-preview") invalidState();
      const byId = pages.get(run.id) ?? new Map<string, SourceCrawlPreviewPage>();
      for (const page of nextPages) {
        const existing = byId.get(page.pageId);
        if (existing && stableJson(existing) !== stableJson(page)) {
          throw new SourceWorkflowError(
            "SOURCE_CRAWL_PAGE_CONFLICT",
            "Crawl page id was reused with different content",
          );
        }
        byId.set(page.pageId, clonePage(page));
      }
      pages.set(run.id, byId);
      return save({
        ...run,
        checkpoint: "preview-staged",
        progressCompleted: byId.size,
        progressTotal: byId.size,
        rowVersion: run.rowVersion + 1,
        updatedAt: now,
      });
    },
    listCrawlPages: async ({ cursor, limit, runId }) => {
      const list = Array.from(pages.get(runId)?.values() ?? [])
        .filter((page) => !cursor || page.id > cursor)
        .sort((left, right) => left.id.localeCompare(right.id));
      return page(list, limit, (item) => item.id, clonePage);
    },
    selectCrawlPages: async ({
      accessChannel,
      idempotencyKey,
      now,
      pageIds,
      permissionSnapshotId,
      permissionSnapshotRevision,
      requestedBySubjectId,
      runId,
    }) => {
      const run = requiredRun(runId);
      const prior = selections.get(runId);
      const normalized = [...new Set(pageIds)].sort();
      if (prior) {
        if (
          prior.idempotencyKey !== idempotencyKey ||
          stableJson(prior.pageIds) !== stableJson(normalized)
        ) {
          throw new SourceWorkflowError(
            "SOURCE_WORKFLOW_IDEMPOTENCY_CONFLICT",
            "Crawl selection was already submitted differently",
          );
        }
        return cloneRun(run);
      }
      if (run.kind !== "crawl-preview" || run.state !== "preview_ready") invalidState();
      const available = pages.get(runId) ?? new Map();
      if (normalized.some((pageId) => !available.has(pageId))) {
        throw new SourceWorkflowError(
          "SOURCE_CRAWL_PAGE_NOT_FOUND",
          "Crawl selection contains an unknown page",
        );
      }
      selections.set(runId, { idempotencyKey, pageIds: normalized });
      claimable.add(runId);
      return save({
        ...run,
        accessChannel,
        activeSlot: 1,
        checkpoint: "selection-frozen",
        completedAt: undefined,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        payload: {
          ...run.payload,
          selectedPageIds: normalized,
          selectionIdempotencyKey: idempotencyKey,
        },
        permissionSnapshotId,
        permissionSnapshotRevision,
        progressCompleted: 0,
        progressFailed: 0,
        progressSkipped: 0,
        progressTotal: normalized.length,
        requestedBySubjectId,
        rowVersion: run.rowVersion + 1,
        state: "queued",
        updatedAt: now,
        workerId: undefined,
      });
    },
    complete: async ({ fence, now, state = "completed" }) => {
      const run = fenced(fence);
      if (state === "preview_ready" && run.kind !== "crawl-preview") invalidState();
      const terminal = state === "completed" || state === "zero_results";
      claimable.delete(run.id);
      claimableAt.delete(run.id);
      return save({
        ...run,
        activeSlot: terminal ? undefined : run.activeSlot,
        checkpoint:
          state === "preview_ready"
            ? "preview-staged"
            : state === "completed"
              ? "source-committed"
              : run.checkpoint,
        ...(terminal ? { completedAt: now } : {}),
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        rowVersion: run.rowVersion + 1,
        state,
        updatedAt: now,
        workerId: undefined,
      });
    },
    fail: async ({ errorCode, errorMessage, fence, now }) => {
      const run = fenced(fence);
      claimable.delete(run.id);
      claimableAt.delete(run.id);
      return save({
        ...run,
        activeSlot: undefined,
        completedAt: now,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        rowVersion: run.rowVersion + 1,
        state: "failed",
        updatedAt: now,
        workerId: undefined,
      });
    },
    cancel: async ({
      accessChannel,
      now,
      permissionSnapshotId,
      permissionSnapshotRevision,
      reason,
      requestedBySubjectId,
      runId,
    }) => {
      const run = runs.get(runId);
      if (!run) return null;
      if (["completed", "zero_results", "canceled"].includes(run.state)) return cloneRun(run);
      if (run.state === "failed") invalidState();
      claimable.delete(run.id);
      claimableAt.delete(run.id);
      return save({
        ...run,
        activeSlot: undefined,
        canceledAt: now,
        completedAt: now,
        lastErrorCode: "SOURCE_WORKFLOW_CANCELED",
        lastErrorMessage: reason.slice(0, 1_000),
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        accessChannel,
        permissionSnapshotId,
        permissionSnapshotRevision,
        requestedBySubjectId,
        rowVersion: run.rowVersion + 1,
        state: "canceled",
        updatedAt: now,
        workerId: undefined,
      });
    },
    retry: async ({
      accessChannel,
      now,
      permissionSnapshotId,
      permissionSnapshotRevision,
      requestedBySubjectId,
      runId,
    }) => {
      const run = runs.get(runId);
      if (!run) return null;
      if (!(["failed", "canceled"] as const).includes(run.state as never)) invalidState();
      if (run.executionAttempts >= run.maxExecutionAttempts) {
        throw new SourceWorkflowError(
          "SOURCE_WORKFLOW_ATTEMPTS_EXHAUSTED",
          "Source workflow exhausted its execution attempt budget",
        );
      }
      claimable.add(run.id);
      claimableAt.set(run.id, now);
      return save({
        ...run,
        activeSlot: 1,
        canceledAt: undefined,
        completedAt: undefined,
        cursor: undefined,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        permissionSnapshotId,
        permissionSnapshotRevision,
        progressCompleted: 0,
        progressFailed: 0,
        progressSkipped: 0,
        accessChannel,
        requestedBySubjectId,
        rowVersion: run.rowVersion + 1,
        state: "queued",
        updatedAt: now,
        workerId: undefined,
      });
    },
    defer: async ({ availableAt, fence, now }) => {
      const run = fenced(fence);
      if (run.kind !== "bulk") invalidState();
      claimable.add(run.id);
      claimableAt.set(run.id, availableAt);
      return save({
        ...run,
        cursor: undefined,
        executionAttempts: Math.max(0, run.executionAttempts - 1),
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        rowVersion: run.rowVersion + 1,
        state: "queued",
        updatedAt: now,
        workerId: undefined,
      });
    },
    get: async ({ knowledgeSpaceId, runId, tenantId }) => {
      const run = runs.get(runId);
      return run?.tenantId === tenantId && run.knowledgeSpaceId === knowledgeSpaceId
        ? cloneRun(run)
        : null;
    },
    listRuns: async ({ candidateGrants, cursor, knowledgeSpaceId, limit, sourceId, tenantId }) => {
      const list = Array.from(runs.values())
        .filter((run) => run.tenantId === tenantId && run.knowledgeSpaceId === knowledgeSpaceId)
        .filter((run) =>
          candidatePermissionScopeAllows(run.requiredPermissionScope, candidateGrants),
        )
        .filter((run) => !sourceId || run.sourceId === sourceId)
        .filter((run) => !cursor || run.id > cursor)
        .sort((left, right) => left.id.localeCompare(right.id));
      return page(list, limit, (item) => item.id, cloneRun);
    },
    listBulkItems: async ({ cursor, limit, runId }) => {
      const list = Array.from(bulkItems.get(runId)?.values() ?? [])
        .filter((item) => !cursor || item.id > cursor)
        .sort((left, right) => left.id.localeCompare(right.id));
      return page(list, limit, (item) => item.id, cloneBulkItem);
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
      const run = runs.get(runId);
      if (
        !run ||
        run.kind !== "bulk" ||
        run.tenantId !== tenantId ||
        run.knowledgeSpaceId !== knowledgeSpaceId ||
        run.requestedBySubjectId !== requestedBySubjectId ||
        run.accessChannel !== accessChannel ||
        run.permissionSnapshotId !== permissionSnapshotId ||
        run.permissionSnapshotRevision !== permissionSnapshotRevision ||
        !candidatePermissionScopeAllows(run.requiredPermissionScope, candidateGrants)
      ) {
        return { items: [] };
      }
      const list = Array.from(bulkItems.get(runId)?.values() ?? [])
        .filter((item) => !cursor || item.id > cursor)
        .sort((left, right) => left.id.localeCompare(right.id));
      return page(list, limit, (item) => item.id, cloneBulkItem);
    },
    markBulkItem: async ({ errorCode, fence, itemId, now, reason, runId, status }) => {
      const run = fenced(fence);
      if (run.id !== runId || run.kind !== "bulk") invalidState();
      const items = bulkItems.get(runId);
      const item = items?.get(itemId);
      if (!item) throw new SourceWorkflowError("SOURCE_BULK_ITEM_NOT_FOUND", "Bulk item not found");
      if (!bulkItemTransitionAllowed(item.status, status)) invalidState();
      const updated: SourceBulkWorkflowItem = {
        ...item,
        ...(errorCode ? { errorCode } : {}),
        ...(reason ? { reason } : {}),
        status,
        updatedAt: now,
      };
      items?.set(itemId, updated);
      return cloneBulkItem(updated);
    },
    enqueueBulkSyncChild: async ({ fence, itemId, now, runId }) => {
      const current = fenced(fence);
      if (current.id !== runId || current.kind !== "bulk") invalidState();
      const items = bulkItems.get(runId);
      const item = items?.get(itemId);
      if (!item || item.action !== "sync" || item.status !== "eligible") invalidState();
      const child = startRun({
        accessChannel: current.accessChannel,
        createdAt: now,
        id: randomUUID(),
        idempotencyKey: `bulk-sync:${current.id}:${item.id}`,
        knowledgeSpaceId: current.knowledgeSpaceId,
        kind: "sync",
        maxExecutionAttempts: current.maxExecutionAttempts,
        payload: { bulkItemId: item.id, parentRunId: current.id },
        permissionSnapshotId: current.permissionSnapshotId,
        permissionSnapshotRevision: current.permissionSnapshotRevision,
        requestedBySubjectId: current.requestedBySubjectId,
        requiredPermissionScope: [...current.requiredPermissionScope],
        sourceId: item.sourceId,
        tenantId: current.tenantId,
      });
      const runningItem: SourceBulkWorkflowItem = {
        ...item,
        childRunId: child.id,
        status: "running",
        updatedAt: now,
      };
      items?.set(item.id, runningItem);
      const parent = save({
        ...current,
        rowVersion: current.rowVersion + 1,
        updatedAt: now,
      });
      return { child, item: cloneBulkItem(runningItem), parent };
    },
    upsertSyncPolicy: async (policy) => {
      const key = `${policy.tenantId}\0${policy.knowledgeSpaceId}\0${policy.sourceId}`;
      const prior = policies.get(key);
      if (prior && policy.revision !== prior.revision + 1) {
        throw new SourceWorkflowError(
          "SOURCE_SYNC_POLICY_CONFLICT",
          "Sync policy changed concurrently",
        );
      }
      if (!prior && policy.revision !== 1) {
        throw new SourceWorkflowError(
          "SOURCE_SYNC_POLICY_CONFLICT",
          "First sync policy revision must be 1",
        );
      }
      policies.set(key, clonePolicy(policy));
      return clonePolicy(policy);
    },
    getSyncPolicy: async ({ knowledgeSpaceId, sourceId, tenantId }) => {
      const policy = policies.get(`${tenantId}\0${knowledgeSpaceId}\0${sourceId}`);
      return policy ? clonePolicy(policy) : null;
    },
    enqueueDueSyncRuns: async ({ limit, maxExecutionAttempts, now }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
        throw new Error("Source sync due enqueue limit must be 1-1000");
      }
      const due = Array.from(policies.values())
        .filter(
          (policy) => policy.enabled && policy.nextRunAt !== undefined && policy.nextRunAt <= now,
        )
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, limit);
      const queued: SourceWorkflowRun[] = [];
      for (const policy of due) {
        const scheduledFor = policy.nextRunAt as string;
        const record: NewSourceWorkflowRun = {
          accessChannel: policy.accessChannel,
          createdAt: now,
          id: randomUUID(),
          idempotencyKey: `sync-policy:${policy.id}:${scheduledFor}`,
          knowledgeSpaceId: policy.knowledgeSpaceId,
          kind: "sync",
          maxExecutionAttempts,
          payload: { scheduledFor, syncPolicyId: policy.id },
          permissionSnapshotId: policy.permissionSnapshotId,
          permissionSnapshotRevision: policy.permissionSnapshotRevision,
          requestedBySubjectId: policy.requestedBySubjectId,
          requiredPermissionScope: [...policy.requiredPermissionScope],
          sourceId: policy.sourceId,
          tenantId: policy.tenantId,
        };
        const run = startRun(record);
        policies.set(`${policy.tenantId}\0${policy.knowledgeSpaceId}\0${policy.sourceId}`, {
          ...policy,
          nextRunAt: nextSyncPolicyRunAt(policy.mode, policy.customIntervalSeconds, now),
          revision: policy.revision + 1,
          updatedAt: now,
        });
        queued.push(run);
      }
      return queued;
    },
    listDueSyncPolicies: async ({ cursor, limit, now }) => {
      const list = Array.from(policies.values())
        .filter(
          (policy) => policy.enabled && policy.nextRunAt !== undefined && policy.nextRunAt <= now,
        )
        .filter((policy) => !cursor || policy.id > cursor)
        .sort((left, right) => left.id.localeCompare(right.id));
      return page(list, limit, (item) => item.id, clonePolicy);
    },
  };
}

function page<T>(
  values: readonly T[],
  limit: number,
  cursor: (item: T) => string,
  clone: (item: T) => T,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new Error("Source workflow list limit must be 1-1000");
  }
  const selected = values.slice(0, limit + 1);
  const items = selected.slice(0, limit).map(clone);
  const last = items.at(-1);
  return {
    items,
    ...(selected.length > limit && last ? { nextCursor: cursor(last) } : {}),
  };
}

function cloneRun(run: SourceWorkflowRun): SourceWorkflowRun {
  return { ...run, payload: JSON.parse(JSON.stringify(run.payload)) };
}

function clonePage(value: SourceCrawlPreviewPage): SourceCrawlPreviewPage {
  return { ...value };
}

function cloneBulkItem(value: SourceBulkWorkflowItem): SourceBulkWorkflowItem {
  return { ...value };
}

function clonePolicy(value: SourceSyncPolicyRecord): SourceSyncPolicyRecord {
  return { ...value };
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

function fenceConflict(): never {
  throw new SourceWorkflowError(
    "SOURCE_WORKFLOW_FENCE_CONFLICT",
    "Source workflow lease or row-version fence was lost",
  );
}

function invalidState(): never {
  throw new SourceWorkflowError(
    "SOURCE_WORKFLOW_STATE_CONFLICT",
    "Source workflow state does not allow this transition",
  );
}
