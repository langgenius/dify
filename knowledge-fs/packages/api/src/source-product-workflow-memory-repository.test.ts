import { describe, expect, it } from "vitest";

import {
  type NewSourceWorkflowRun,
  type SourceBulkWorkflowItem,
  type SourceCrawlPreviewPage,
  type SourceProductWorkflowRepository,
  type SourceSyncPolicyRecord,
  SourceWorkflowError,
  type SourceWorkflowRun,
} from "./source-product-workflow";
import { createInMemorySourceProductWorkflowRepository } from "./source-product-workflow-memory-repository";

const tenantId = "tenant-memory";
const knowledgeSpaceId = "space-memory";
const createdAt = "2026-03-01T00:00:00.000Z";

describe("in-memory source product workflow repository", () => {
  it("starts cloned runs idempotently and rejects conflicting replays", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    const payload = { nested: { value: "original" } };
    const started = await repository.start(runRecord("run-start", { payload }));
    payload.nested.value = "mutated";
    expect(started).toMatchObject({ checkpoint: "queued", rowVersion: 1, state: "queued" });
    expect(started.payload).toEqual({ nested: { value: "original" } });

    const fetched = await repository.get({ knowledgeSpaceId, runId: started.id, tenantId });
    if (!fetched) throw new Error("started run was not persisted");
    (fetched.payload as { nested: { value: string } }).nested.value = "changed-clone";
    await expect(
      repository.get({ knowledgeSpaceId, runId: started.id, tenantId }),
    ).resolves.toMatchObject({ payload: { nested: { value: "original" } } });

    await expect(
      repository.start(
        runRecord("replay-id", {
          idempotencyKey: started.idempotencyKey,
          payload: { nested: { value: "original" } },
        }),
      ),
    ).resolves.toMatchObject({ id: started.id });
    for (const conflict of [
      runRecord("conflict-kind", {
        idempotencyKey: started.idempotencyKey,
        kind: "online-drive-import",
        payload: { nested: { value: "original" } },
      }),
      runRecord("conflict-source", {
        idempotencyKey: started.idempotencyKey,
        payload: { nested: { value: "original" } },
        sourceId: "different-source",
      }),
      runRecord("conflict-payload", {
        idempotencyKey: started.idempotencyKey,
        payload: { nested: { value: "different" } },
      }),
    ]) {
      await expect(repository.start(conflict)).rejects.toMatchObject({
        code: "SOURCE_WORKFLOW_IDEMPOTENCY_CONFLICT",
      });
    }

    await expect(
      repository.get({ knowledgeSpaceId, runId: started.id, tenantId: "other-tenant" }),
    ).resolves.toBeNull();
    await expect(
      repository.get({ knowledgeSpaceId: "other-space", runId: started.id, tenantId }),
    ).resolves.toBeNull();
    await expect(
      repository.get({ knowledgeSpaceId, runId: "missing", tenantId }),
    ).resolves.toBeNull();
  });

  it("filters and paginates runs before applying LIMIT", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    await repository.start(
      runRecord("a-hidden", { requiredPermissionScope: ["grant:hidden"], sourceId: "source-a" }),
    );
    await repository.start(
      runRecord("b-visible", {
        requiredPermissionScope: ["grant:visible"],
        sourceId: "source-b",
      }),
    );
    await repository.start(
      runRecord("c-visible", {
        requiredPermissionScope: ["grant:visible"],
        sourceId: "source-b",
      }),
    );
    await repository.start(
      runRecord("d-other-space", {
        knowledgeSpaceId: "other-space",
        requiredPermissionScope: ["grant:visible"],
        sourceId: "source-b",
      }),
    );

    await expect(
      repository.listRuns({
        candidateGrants: ["grant:visible"],
        knowledgeSpaceId,
        limit: 1,
        sourceId: "source-b",
        tenantId,
      }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: "b-visible" })],
      nextCursor: "b-visible",
    });
    await expect(
      repository.listRuns({
        candidateGrants: ["grant:visible"],
        cursor: "b-visible",
        knowledgeSpaceId,
        limit: 10,
        sourceId: "source-b",
        tenantId,
      }),
    ).resolves.toEqual({ items: [expect.objectContaining({ id: "c-visible" })] });
    await expect(
      repository.listRuns({ candidateGrants: [], knowledgeSpaceId, limit: 10, tenantId }),
    ).resolves.toEqual({ items: [] });
    for (const limit of [0, 1_001, 1.5]) {
      await expect(
        repository.listRuns({ candidateGrants: [], knowledgeSpaceId, limit, tenantId }),
      ).rejects.toThrow("Source workflow list limit must be 1-1000");
    }
  });

  it("lists newest authorized runs with a stable composite cursor", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    await repository.start(
      runRecord("run-old", {
        createdAt: "2026-03-01T00:00:00.000Z",
        requiredPermissionScope: ["grant:visible"],
      }),
    );
    await repository.start(
      runRecord("run-new", {
        createdAt: "2026-03-01T00:01:00.000Z",
        requiredPermissionScope: ["grant:visible"],
      }),
    );
    await repository.start(
      runRecord("run-hidden", {
        createdAt: "2026-03-01T00:02:00.000Z",
        requiredPermissionScope: ["grant:hidden"],
      }),
    );

    const first = await repository.listRecentRuns({
      candidateGrants: ["grant:visible"],
      knowledgeSpaceId,
      limit: 1,
      tenantId,
    });
    expect(first).toMatchObject({
      items: [{ id: "run-new" }],
      nextCursor: {
        createdAt: "2026-03-01T00:01:00.000Z",
        id: "run-new",
      },
    });
    await expect(
      repository.listRecentRuns({
        candidateGrants: ["grant:visible"],
        cursor: first.nextCursor,
        knowledgeSpaceId,
        limit: 1,
        tenantId,
      }),
    ).resolves.toMatchObject({ items: [{ id: "run-old" }] });
    await expect(
      repository.listRecentRuns({
        candidateGrants: [],
        knowledgeSpaceId,
        limit: 1,
        tenantId,
      }),
    ).resolves.toEqual({ items: [] });
  });

  it("validates recent-run limits and orders timestamp ties by id", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    await repository.start(runRecord("run-tie-a", { requiredPermissionScope: ["grant:visible"] }));
    await repository.start(runRecord("run-tie-b", { requiredPermissionScope: ["grant:visible"] }));

    await expect(
      repository.listRecentRuns({
        candidateGrants: ["grant:visible"],
        knowledgeSpaceId,
        limit: 10,
        tenantId,
      }),
    ).resolves.toMatchObject({
      items: [{ id: "run-tie-b" }, { id: "run-tie-a" }],
    });
    for (const limit of [0, 1_001, 1.5]) {
      await expect(
        repository.listRecentRuns({
          candidateGrants: ["grant:visible"],
          knowledgeSpaceId,
          limit,
          tenantId,
        }),
      ).rejects.toThrow("Source workflow list limit must be 1-1000");
    }
  });

  it("atomically validates bulk starts and authorizes item pages", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    const parentRecord = runRecord("bulk-valid", {
      kind: "bulk",
      progressTotal: 3,
      requiredPermissionScope: ["grant:bulk"],
    });
    const items = [
      bulkItem("item-a", parentRecord.id, "source-a"),
      bulkItem("item-b", parentRecord.id, "source-b", {
        reason: "already-disabled",
        status: "skipped",
      }),
      bulkItem("item-c", parentRecord.id, "source-c"),
    ];
    const parent = await repository.startBulk({ items, run: parentRecord });
    expect(parent).toMatchObject({ progressSkipped: 1, progressTotal: 3 });
    await expect(repository.startBulk({ items, run: parentRecord })).resolves.toMatchObject({
      id: parent.id,
    });
    await expect(repository.listBulkItems({ limit: 2, runId: parent.id })).resolves.toEqual({
      items: [expect.objectContaining({ id: "item-a" }), expect.objectContaining({ id: "item-b" })],
      nextCursor: "item-b",
    });
    await expect(
      repository.listBulkItems({ cursor: "item-b", limit: 2, runId: parent.id }),
    ).resolves.toEqual({ items: [expect.objectContaining({ id: "item-c" })] });
    await expect(repository.listBulkItems({ limit: 2, runId: "missing" })).resolves.toEqual({
      items: [],
    });

    const authorized = {
      accessChannel: "interactive" as const,
      candidateGrants: ["grant:bulk"],
      knowledgeSpaceId,
      limit: 10,
      permissionSnapshotId: parent.permissionSnapshotId as string,
      permissionSnapshotRevision: parent.permissionSnapshotRevision as number,
      requestedBySubjectId: parent.requestedBySubjectId as string,
      runId: parent.id,
      tenantId,
    };
    await expect(repository.listAuthorizedBulkItems(authorized)).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: "item-a" })]),
    });
    await expect(
      repository.listAuthorizedBulkItems({ ...authorized, cursor: "item-a", limit: 1 }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: "item-b" })],
      nextCursor: "item-b",
    });
    for (const mismatch of [
      { runId: "missing" },
      { tenantId: "other-tenant" },
      { knowledgeSpaceId: "other-space" },
      { requestedBySubjectId: "other-subject" },
      { accessChannel: "service_api" as const },
      { permissionSnapshotId: "other-permission" },
      { permissionSnapshotRevision: 99 },
      { candidateGrants: ["grant:other"] },
    ]) {
      await expect(
        repository.listAuthorizedBulkItems({ ...authorized, ...mismatch }),
      ).resolves.toEqual({ items: [] });
    }

    const invalidCases = [
      {
        items: [bulkItem("wrong-kind-item", "wrong-kind", "source")],
        run: runRecord("wrong-kind", { progressTotal: 1 }),
      },
      {
        items: [],
        run: runRecord("wrong-count", { kind: "bulk", progressTotal: 1 }),
      },
      {
        items: [bulkItem("wrong-parent-item", "different-parent", "source")],
        run: runRecord("wrong-parent", { kind: "bulk", progressTotal: 1 }),
      },
      {
        items: [
          bulkItem("duplicate-item", "duplicate-items", "source-a"),
          bulkItem("duplicate-item", "duplicate-items", "source-b"),
        ],
        run: runRecord("duplicate-items", { kind: "bulk", progressTotal: 2 }),
      },
      {
        items: [
          bulkItem("first-item", "duplicate-sources", "same-source"),
          bulkItem("second-item", "duplicate-sources", "same-source"),
        ],
        run: runRecord("duplicate-sources", { kind: "bulk", progressTotal: 2 }),
      },
    ];
    for (const invalid of invalidCases) {
      await expect(repository.startBulk(invalid)).rejects.toMatchObject({
        code: "SOURCE_WORKFLOW_STATE_CONFLICT",
      });
    }
  });

  it("claims each workflow kind, checkpoints progress, heartbeats, and defers bulk parents", async () => {
    let leaseSequence = 0;
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => `lease-${++leaseSequence}`,
    });
    await repository.start(runRecord("a-crawl", { kind: "crawl-preview" }));
    await repository.start(runRecord("b-sync"));
    await repository.start(runRecord("c-import", { kind: "online-document-import" }));
    await repository.startBulk({
      items: [bulkItem("bulk-claim-item", "d-bulk", "source-bulk")],
      run: runRecord("d-bulk", { kind: "bulk", progressTotal: 1 }),
    });
    await expect(
      repository.claim({
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        limit: 0,
        now: createdAt,
        workerId: "worker",
      }),
    ).rejects.toThrow("Source workflow claim limit must be positive");
    const claimed = await repository.claim({
      leaseExpiresAt: "2026-03-01T01:00:00.000Z",
      limit: 10,
      now: createdAt,
      workerId: "worker",
    });
    expect(claimed.map((run) => [run.id, run.state])).toEqual([
      ["a-crawl", "crawling"],
      ["b-sync", "syncing"],
      ["c-import", "importing"],
      ["d-bulk", "running"],
    ]);

    const sync = requiredClaim(claimed, "b-sync");
    const heartbeat = await repository.heartbeat({
      fence: fence(sync, "worker"),
      leaseExpiresAt: "2026-03-01T02:00:00.000Z",
      now: "2026-03-01T00:01:00.000Z",
    });
    const withProgress = await repository.checkpoint({
      checkpoint: "provider-read",
      cursor: "cursor-a",
      fence: fence(heartbeat, "worker"),
      now: "2026-03-01T00:02:00.000Z",
      progressCompleted: 2,
      progressFailed: 1,
      progressSkipped: 3,
      progressTotal: 6,
      state: "syncing",
    });
    expect(withProgress).toMatchObject({
      cursor: "cursor-a",
      progressCompleted: 2,
      progressFailed: 1,
      progressSkipped: 3,
      progressTotal: 6,
    });
    const cleared = await repository.checkpoint({
      checkpoint: "materialized",
      cursor: null,
      fence: fence(withProgress, "worker"),
      now: "2026-03-01T00:03:00.000Z",
      progressTotal: null,
      state: "syncing",
    });
    expect(cleared.cursor).toBeUndefined();
    expect(cleared.progressTotal).toBeUndefined();
    const unchanged = await repository.checkpoint({
      checkpoint: "source-committed",
      fence: fence(cleared, "worker"),
      now: "2026-03-01T00:04:00.000Z",
      state: "syncing",
    });
    expect(unchanged).toMatchObject({
      progressCompleted: 2,
      progressFailed: 1,
      progressSkipped: 3,
    });

    const bulk = requiredClaim(claimed, "d-bulk");
    const deferred = await repository.defer({
      availableAt: "2026-03-01T00:10:00.000Z",
      fence: fence(bulk, "worker"),
      now: "2026-03-01T00:05:00.000Z",
    });
    expect(deferred).toMatchObject({ executionAttempts: 0, state: "queued" });
    await expect(
      repository.claim({
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        limit: 10,
        now: "2026-03-01T00:09:00.000Z",
        workerId: "early-worker",
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.claim({
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        limit: 10,
        now: "2026-03-01T00:10:00.000Z",
        workerId: "later-worker",
      }),
    ).resolves.toEqual([expect.objectContaining({ id: "d-bulk", state: "running" })]);
  });

  it("keeps the materialization generation stable when an expired lease is reclaimed", async () => {
    let leaseSequence = 0;
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => `lease-reclaim-${++leaseSequence}`,
    });
    await repository.start(runRecord("lease-reclaim"));

    const firstClaim = requiredClaim(
      await repository.claim({
        leaseExpiresAt: "2026-03-01T00:01:00.000Z",
        limit: 1,
        now: createdAt,
        workerId: "worker-a",
      }),
      "lease-reclaim",
    );
    const reclaimed = requiredClaim(
      await repository.claim({
        leaseExpiresAt: "2026-03-01T00:03:00.000Z",
        limit: 1,
        now: "2026-03-01T00:02:00.000Z",
        workerId: "worker-b",
      }),
      "lease-reclaim",
    );

    expect(firstClaim).toMatchObject({ executionAttempts: 1, payload: {} });
    expect(reclaimed).toMatchObject({ executionAttempts: 2, payload: firstClaim.payload });
  });

  it("enforces lease fences and terminal transition rules", async () => {
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => "lease-fence",
    });
    const queued = await repository.start(runRecord("queued-fence"));
    await expect(
      repository.heartbeat({
        fence: {
          leaseToken: "lease-fence",
          rowVersion: queued.rowVersion,
          runId: queued.id,
          workerId: "worker",
        },
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        now: createdAt,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_FENCE_CONFLICT" });
    const claimed = requiredClaim(
      await repository.claim({
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        limit: 1,
        now: createdAt,
        workerId: "worker",
      }),
      queued.id,
    );
    for (const invalidFence of [
      { ...fence(claimed, "worker"), workerId: "other-worker" },
      { ...fence(claimed, "worker"), leaseToken: "other-token" },
      { ...fence(claimed, "worker"), rowVersion: claimed.rowVersion + 1 },
    ]) {
      await expect(
        repository.heartbeat({
          fence: invalidFence,
          leaseExpiresAt: "2026-03-01T02:00:00.000Z",
          now: "2026-03-01T00:01:00.000Z",
        }),
      ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_FENCE_CONFLICT" });
    }
    await expect(
      repository.appendCrawlPages({
        fence: fence(claimed, "worker"),
        now: createdAt,
        pages: [],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    await expect(
      repository.complete({
        fence: fence(claimed, "worker"),
        now: createdAt,
        state: "preview_ready",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    await expect(
      repository.defer({
        availableAt: "2026-03-01T01:00:00.000Z",
        fence: fence(claimed, "worker"),
        now: createdAt,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });

    const completed = await repository.complete({
      fence: fence(claimed, "worker"),
      now: "2026-03-01T00:02:00.000Z",
    });
    expect(completed).toMatchObject({
      activeSlot: undefined,
      checkpoint: "source-committed",
      completedAt: "2026-03-01T00:02:00.000Z",
      state: "completed",
    });
    await expect(
      repository.heartbeat({
        fence: fence(claimed, "worker"),
        leaseExpiresAt: "2026-03-01T03:00:00.000Z",
        now: "2026-03-01T00:03:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_FENCE_CONFLICT" });
  });

  it("stages crawl pages and freezes idempotent selections", async () => {
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => "lease-crawl",
    });
    const preview = await repository.start(runRecord("crawl-pages", { kind: "crawl-preview" }));
    await expect(
      repository.selectCrawlPages({
        idempotencyKey: "too-early",
        now: createdAt,
        pageIds: ["page-a"],
        runId: preview.id,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    await expect(
      repository.selectCrawlPages({
        idempotencyKey: "missing-run",
        now: createdAt,
        pageIds: ["page-a"],
        runId: "missing",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_NOT_FOUND" });

    const claimed = requiredClaim(
      await repository.claim({
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        limit: 1,
        now: createdAt,
        workerId: "crawl-worker",
      }),
      preview.id,
    );
    const pages = [
      crawlPage("row-a", "page-a", preview.id),
      crawlPage("row-b", "page-b", preview.id),
    ];
    const staged = await repository.appendCrawlPages({
      fence: fence(claimed, "crawl-worker"),
      now: "2026-03-01T00:01:00.000Z",
      pages,
    });
    expect(staged).toMatchObject({ checkpoint: "preview-staged", progressCompleted: 2 });
    const replayedStage = await repository.appendCrawlPages({
      fence: fence(staged, "crawl-worker"),
      now: "2026-03-01T00:02:00.000Z",
      pages: [pages[0] as SourceCrawlPreviewPage],
    });
    await expect(
      repository.appendCrawlPages({
        fence: fence(replayedStage, "crawl-worker"),
        now: "2026-03-01T00:03:00.000Z",
        pages: [{ ...(pages[0] as SourceCrawlPreviewPage), title: "different" }],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CRAWL_PAGE_CONFLICT" });
    await expect(repository.listCrawlPages({ limit: 1, runId: preview.id })).resolves.toEqual({
      items: [expect.objectContaining({ pageId: "page-a" })],
      nextCursor: "row-a",
    });
    await expect(
      repository.listCrawlPages({ cursor: "row-a", limit: 10, runId: preview.id }),
    ).resolves.toEqual({ items: [expect.objectContaining({ pageId: "page-b" })] });
    const ready = await repository.complete({
      fence: fence(replayedStage, "crawl-worker"),
      now: "2026-03-01T00:04:00.000Z",
      state: "preview_ready",
    });
    expect(ready).toMatchObject({ activeSlot: 1, checkpoint: "preview-staged" });
    await expect(
      repository.selectCrawlPages({
        idempotencyKey: "unknown-page",
        now: "2026-03-01T00:05:00.000Z",
        pageIds: ["missing-page"],
        runId: ready.id,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CRAWL_PAGE_NOT_FOUND" });
    const selected = await repository.selectCrawlPages({
      accessChannel: "interactive",
      idempotencyKey: "selection-a",
      now: "2026-03-01T00:05:00.000Z",
      pageIds: ["page-b", "page-a", "page-a"],
      permissionSnapshotId: "permission-selection",
      permissionSnapshotRevision: 2,
      requestedBySubjectId: "editor-selection",
      runId: ready.id,
    });
    expect(selected).toMatchObject({
      checkpoint: "selection-frozen",
      payload: { selectedPageIds: ["page-a", "page-b"] },
      progressTotal: 2,
      state: "queued",
    });
    await expect(
      repository.selectCrawlPages({
        idempotencyKey: "selection-a",
        now: "2026-03-01T00:06:00.000Z",
        pageIds: ["page-a", "page-b"],
        runId: ready.id,
      }),
    ).resolves.toMatchObject({ rowVersion: selected.rowVersion });
    for (const conflicting of [
      { idempotencyKey: "selection-different", pageIds: ["page-a", "page-b"] },
      { idempotencyKey: "selection-a", pageIds: ["page-a"] },
    ]) {
      await expect(
        repository.selectCrawlPages({
          ...conflicting,
          now: "2026-03-01T00:06:00.000Z",
          runId: ready.id,
        }),
      ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_IDEMPOTENCY_CONFLICT" });
    }
  });

  it("freezes an empty crawl selection when the preview has no staged page map", async () => {
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => "lease-empty-crawl",
    });
    const preview = await repository.start(runRecord("crawl-empty", { kind: "crawl-preview" }));
    const claimed = requiredClaim(
      await repository.claim({
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        limit: 1,
        now: createdAt,
        workerId: "empty-crawl-worker",
      }),
      preview.id,
    );
    const ready = await repository.complete({
      fence: fence(claimed, "empty-crawl-worker"),
      now: createdAt,
      state: "preview_ready",
    });

    await expect(
      repository.selectCrawlPages({
        idempotencyKey: "empty-selection",
        now: createdAt,
        pageIds: [],
        runId: ready.id,
      }),
    ).resolves.toMatchObject({
      payload: { selectedPageIds: [] },
      progressTotal: 0,
      state: "queued",
    });
  });

  it("fails, cancels, retries, and exhausts execution attempts", async () => {
    let leaseSequence = 0;
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => `lease-retry-${++leaseSequence}`,
    });
    await expect(
      repository.cancel({ now: createdAt, reason: "missing", runId: "missing" }),
    ).resolves.toBeNull();
    await expect(repository.retry({ now: createdAt, runId: "missing" })).resolves.toBeNull();

    const queued = await repository.start(runRecord("cancel-queued"));
    await expect(repository.retry({ now: createdAt, runId: queued.id })).rejects.toMatchObject({
      code: "SOURCE_WORKFLOW_STATE_CONFLICT",
    });
    const canceled = await repository.cancel({
      accessChannel: "service_api",
      now: "2026-03-01T00:01:00.000Z",
      permissionSnapshotId: "permission-cancel",
      permissionSnapshotRevision: 3,
      reason: "x".repeat(1_100),
      requestedBySubjectId: "canceling-subject",
      runId: queued.id,
    });
    expect(canceled).toMatchObject({
      accessChannel: "service_api",
      lastErrorCode: "SOURCE_WORKFLOW_CANCELED",
      permissionSnapshotId: "permission-cancel",
      state: "canceled",
    });
    expect(canceled?.lastErrorMessage).toHaveLength(1_000);
    await expect(
      repository.cancel({ now: createdAt, reason: "again", runId: queued.id }),
    ).resolves.toMatchObject({ rowVersion: canceled?.rowVersion });
    const retriedCanceled = await repository.retry({
      capabilityGrantId: "capability-retry",
      now: "2026-03-01T00:02:00.000Z",
      runId: queued.id,
    });
    expect(retriedCanceled).toMatchObject({
      payload: { __materializationGeneration: 1 },
      progressCompleted: 0,
      state: "queued",
    });

    const claimed = requiredClaim(
      await repository.claim({
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        limit: 10,
        now: "2026-03-01T00:02:00.000Z",
        workerId: "retry-worker",
      }),
      queued.id,
    );
    const failed = await repository.fail({
      errorCode: "PROVIDER_FAILED",
      errorMessage: "provider failed",
      fence: fence(claimed, "retry-worker"),
      now: "2026-03-01T00:03:00.000Z",
    });
    expect(failed).toMatchObject({ activeSlot: undefined, state: "failed" });
    await expect(
      repository.cancel({ now: createdAt, reason: "invalid", runId: failed.id }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    await expect(
      repository.retry({
        accessChannel: "interactive",
        now: "2026-03-01T00:04:00.000Z",
        permissionSnapshotId: "permission-retry",
        permissionSnapshotRevision: 4,
        requestedBySubjectId: "retrying-subject",
        runId: failed.id,
      }),
    ).resolves.toMatchObject({
      lastErrorCode: undefined,
      payload: { __materializationGeneration: 2 },
      state: "queued",
    });

    const exhausted = await repository.start(
      runRecord("attempts-exhausted", { maxExecutionAttempts: 1 }),
    );
    await repository.claim({
      leaseExpiresAt: "2026-03-01T00:05:00.000Z",
      limit: 10,
      now: "2026-03-01T00:04:00.000Z",
      workerId: "exhaust-worker",
    });
    await expect(
      repository.claim({
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        limit: 10,
        now: "2026-03-01T00:06:00.000Z",
        workerId: "exhaust-worker-2",
      }),
    ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: exhausted.id })]));
    await expect(
      repository.get({ knowledgeSpaceId, runId: exhausted.id, tenantId }),
    ).resolves.toMatchObject({
      lastErrorCode: "SOURCE_WORKFLOW_ATTEMPTS_EXHAUSTED",
      state: "failed",
    });
    await expect(
      repository.retry({ now: "2026-03-01T00:07:00.000Z", runId: exhausted.id }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_ATTEMPTS_EXHAUSTED" });

    const zero = await terminalRun(repository, "zero-run", "zero_results");
    await expect(
      repository.cancel({ now: createdAt, reason: "terminal", runId: zero.id }),
    ).resolves.toMatchObject({ state: "zero_results" });
  });

  it("applies valid bulk item transitions and isolates sync children", async () => {
    let leaseSequence = 0;
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => `lease-bulk-${++leaseSequence}`,
    });
    const parent = await repository.startBulk({
      items: [
        bulkItem("sync-item", "bulk-transitions", "source-sync"),
        bulkItem("remove-item", "bulk-transitions", "source-remove", { action: "remove" }),
        bulkItem("disable-item", "bulk-transitions", "source-disable", { action: "disable" }),
      ],
      run: runRecord("bulk-transitions", { kind: "bulk", progressTotal: 3 }),
    });
    const claimed = requiredClaim(
      await repository.claim({
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        limit: 1,
        now: createdAt,
        workerId: "bulk-worker",
      }),
      parent.id,
    );
    await expect(
      repository.markBulkItem({
        fence: fence(claimed, "bulk-worker"),
        itemId: "missing",
        now: createdAt,
        runId: parent.id,
        status: "failed",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_BULK_ITEM_NOT_FOUND" });
    await expect(
      repository.markBulkItem({
        fence: fence(claimed, "bulk-worker"),
        itemId: "sync-item",
        now: createdAt,
        runId: "other-run",
        status: "failed",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    const skipped = await repository.markBulkItem({
      fence: fence(claimed, "bulk-worker"),
      itemId: "disable-item",
      now: "2026-03-01T00:01:00.000Z",
      reason: "already disabled",
      runId: parent.id,
      status: "skipped",
    });
    expect(skipped).toMatchObject({ reason: "already disabled", status: "skipped" });
    await expect(
      repository.markBulkItem({
        fence: fence(claimed, "bulk-worker"),
        itemId: "disable-item",
        now: createdAt,
        runId: parent.id,
        status: "completed",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });

    await expect(
      repository.attachBulkRemovalJob({
        deletionJobId: "deletion-invalid",
        fence: fence(claimed, "bulk-worker"),
        itemId: "sync-item",
        now: createdAt,
        runId: parent.id,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    const attached = await repository.attachBulkRemovalJob({
      deletionJobId: "deletion-a",
      fence: fence(claimed, "bulk-worker"),
      itemId: "remove-item",
      now: "2026-03-01T00:02:00.000Z",
      runId: parent.id,
    });
    expect(attached.item).toMatchObject({ deletionJobId: "deletion-a", status: "running" });
    await expect(
      repository.attachBulkRemovalJob({
        deletionJobId: "deletion-again",
        fence: fence(attached.parent, "bulk-worker"),
        itemId: "remove-item",
        now: createdAt,
        runId: parent.id,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    const removalComplete = await repository.markBulkItem({
      fence: fence(attached.parent, "bulk-worker"),
      itemId: "remove-item",
      now: "2026-03-01T00:03:00.000Z",
      runId: parent.id,
      status: "completed",
    });
    expect(removalComplete.status).toBe("completed");
    await expect(
      repository.markBulkItem({
        fence: fence(attached.parent, "bulk-worker"),
        itemId: "remove-item",
        now: createdAt,
        runId: parent.id,
        status: "completed",
      }),
    ).resolves.toMatchObject({ status: "completed" });

    const child = await repository.enqueueBulkSyncChild({
      fence: fence(attached.parent, "bulk-worker"),
      itemId: "sync-item",
      now: "2026-03-01T00:04:00.000Z",
      runId: parent.id,
    });
    expect(child).toMatchObject({
      child: {
        accessChannel: "interactive",
        kind: "sync",
        payload: { bulkItemId: "sync-item", parentRunId: parent.id },
      },
      item: { childRunId: expect.any(String), status: "running" },
    });
    await expect(
      repository.enqueueBulkSyncChild({
        fence: fence(child.parent, "bulk-worker"),
        itemId: "sync-item",
        now: createdAt,
        runId: parent.id,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });
    await expect(
      repository.enqueueBulkSyncChild({
        fence: fence(child.parent, "bulk-worker"),
        itemId: "remove-item",
        now: createdAt,
        runId: parent.id,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_STATE_CONFLICT" });

    const capabilityRepository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => "lease-cap-bulk",
    });
    const capabilityParent = await capabilityRepository.startBulk({
      items: [bulkItem("cap-sync-item", "cap-bulk", "source-cap")],
      run: runRecord("cap-bulk", {
        accessChannel: undefined,
        capabilityGrantId: "capability-bulk",
        kind: "bulk",
        permissionSnapshotId: undefined,
        permissionSnapshotRevision: undefined,
        progressTotal: 1,
        requestedBySubjectId: undefined,
        requiredPermissionScope: undefined,
      }),
    });
    const capabilityClaim = requiredClaim(
      await capabilityRepository.claim({
        leaseExpiresAt: "2026-03-01T01:00:00.000Z",
        limit: 1,
        now: createdAt,
        workerId: "cap-bulk-worker",
      }),
      capabilityParent.id,
    );
    await expect(
      capabilityRepository.enqueueBulkSyncChild({
        fence: fence(capabilityClaim, "cap-bulk-worker"),
        itemId: "cap-sync-item",
        now: createdAt,
        runId: capabilityParent.id,
      }),
    ).resolves.toMatchObject({ child: { capabilityGrantId: "capability-bulk" } });
  });

  it("fails closed on non-bulk child mutations and supports empty legacy scope", async () => {
    let leaseSequence = 0;
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => `lease-coverage-${++leaseSequence}`,
    });
    const emptyBulk = await repository.start(
      runRecord("bulk-empty", {
        kind: "bulk",
        progressTotal: 0,
        requiredPermissionScope: ["grant:empty"],
      }),
    );
    await expect(
      repository.listAuthorizedBulkItems({
        accessChannel: emptyBulk.accessChannel as "interactive",
        candidateGrants: ["grant:empty"],
        knowledgeSpaceId,
        limit: 10,
        permissionSnapshotId: emptyBulk.permissionSnapshotId as string,
        permissionSnapshotRevision: emptyBulk.permissionSnapshotRevision as number,
        requestedBySubjectId: emptyBulk.requestedBySubjectId as string,
        runId: emptyBulk.id,
        tenantId,
      }),
    ).resolves.toEqual({ items: [] });

    const nonBulk = await repository.start(runRecord("non-bulk-mutation"));
    const bulk = await repository.startBulk({
      items: [bulkItem("scope-item", "bulk-no-scope", "source-scope")],
      run: runRecord("bulk-no-scope", {
        kind: "bulk",
        progressTotal: 1,
        requiredPermissionScope: undefined,
      }),
    });
    const claimed = await repository.claim({
      leaseExpiresAt: "2026-03-01T01:00:00.000Z",
      limit: 10,
      now: createdAt,
      workerId: "coverage-worker",
    });
    const claimedNonBulk = requiredClaim(claimed, nonBulk.id);
    for (const mutation of [
      repository.attachBulkRemovalJob({
        deletionJobId: "deletion-non-bulk",
        fence: fence(claimedNonBulk, "coverage-worker"),
        itemId: "missing",
        now: createdAt,
        runId: nonBulk.id,
      }),
      repository.enqueueBulkSyncChild({
        fence: fence(claimedNonBulk, "coverage-worker"),
        itemId: "missing",
        now: createdAt,
        runId: nonBulk.id,
      }),
    ]) {
      await expect(mutation).rejects.toMatchObject({
        code: "SOURCE_WORKFLOW_STATE_CONFLICT",
      });
    }

    const child = await repository.enqueueBulkSyncChild({
      fence: fence(requiredClaim(claimed, bulk.id), "coverage-worker"),
      itemId: "scope-item",
      now: createdAt,
      runId: bulk.id,
    });
    expect(child.child.requiredPermissionScope).toEqual([]);
  });

  it("persists revision-fenced policies and atomically enqueues due runs", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    await expect(
      repository.getSyncPolicy({ knowledgeSpaceId, sourceId: "source-policy", tenantId }),
    ).resolves.toBeNull();
    await expect(
      repository.upsertSyncPolicy(policyRecord("policy-invalid-first", { revision: 2 })),
    ).rejects.toMatchObject({ code: "SOURCE_SYNC_POLICY_CONFLICT" });
    const provider = await repository.upsertSyncPolicy(policyRecord("policy-provider"));
    expect(provider).toMatchObject({ revision: 1 });
    await expect(repository.upsertSyncPolicy({ ...provider, revision: 3 })).rejects.toMatchObject({
      code: "SOURCE_SYNC_POLICY_CONFLICT",
    });
    const revised = await repository.upsertSyncPolicy({
      ...provider,
      revision: 2,
      updatedAt: "2026-03-01T00:01:00.000Z",
    });
    expect(revised.revision).toBe(2);
    const rebound = await repository.rebindSyncPolicySourceVersion({
      expectedSourceVersion: 1,
      knowledgeSpaceId,
      sourceId: provider.sourceId,
      sourceVersion: 4,
      tenantId,
    });
    expect(rebound).toEqual({ ...revised, expectedSourceVersion: 4 });
    await expect(
      repository.rebindSyncPolicySourceVersion({
        expectedSourceVersion: 1,
        knowledgeSpaceId,
        sourceId: provider.sourceId,
        sourceVersion: 5,
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_SYNC_POLICY_SOURCE_CONFLICT" });
    await expect(
      repository.getSyncPolicy({ knowledgeSpaceId, sourceId: provider.sourceId, tenantId }),
    ).resolves.toEqual(rebound);
    await expect(
      repository.listSyncPolicies({
        knowledgeSpaceId,
        sourceIds: ["missing", provider.sourceId, provider.sourceId],
        tenantId,
      }),
    ).resolves.toEqual([rebound]);
    await expect(
      repository.listSyncPolicies({
        knowledgeSpaceId,
        sourceIds: [provider.sourceId],
        tenantId: "other-tenant",
      }),
    ).resolves.toEqual([]);

    await repository.upsertSyncPolicy(
      policyRecord("policy-custom", {
        customIntervalSeconds: 7_200,
        mode: "custom",
        sourceId: "source-custom",
      }),
    );
    await repository.upsertSyncPolicy(
      policyRecord("policy-interval", { mode: "interval", sourceId: "source-interval" }),
    );
    await repository.upsertSyncPolicy(
      policyRecord("policy-disabled", {
        enabled: false,
        sourceId: "source-disabled",
      }),
    );
    await repository.upsertSyncPolicy(
      policyRecord("policy-future", {
        nextRunAt: "2026-03-02T00:00:00.000Z",
        sourceId: "source-future",
      }),
    );
    await repository.upsertSyncPolicy(
      policyRecord("policy-no-next", { nextRunAt: undefined, sourceId: "source-no-next" }),
    );
    for (const limit of [0, 1_001, 1.5]) {
      await expect(
        repository.enqueueDueSyncRuns({ limit, maxExecutionAttempts: 3, now: createdAt }),
      ).rejects.toThrow("Source sync due enqueue limit must be 1-1000");
    }
    await expect(repository.listDueSyncPolicies({ limit: 2, now: createdAt })).resolves.toEqual({
      items: [
        expect.objectContaining({ id: "policy-custom" }),
        expect.objectContaining({ id: "policy-interval" }),
      ],
      nextCursor: "policy-interval",
    });
    await expect(
      repository.listDueSyncPolicies({ cursor: "policy-interval", limit: 10, now: createdAt }),
    ).resolves.toEqual({ items: [expect.objectContaining({ id: "policy-provider" })] });
    await repository.upsertSyncPolicy(
      policyRecord("policy-capability", {
        accessChannel: undefined,
        capabilityGrantId: "capability-policy",
        permissionSnapshotId: undefined,
        permissionSnapshotRevision: undefined,
        requestedBySubjectId: undefined,
        requiredPermissionScope: undefined,
        sourceId: "source-capability",
      }),
    );

    const queued = await repository.enqueueDueSyncRuns({
      limit: 10,
      maxExecutionAttempts: 3,
      now: createdAt,
    });
    expect(queued).toHaveLength(4);
    expect(queued).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          idempotencyKey: "sync-policy:policy-provider:2026-03-01T00:00:00.000Z",
          kind: "sync",
          maxExecutionAttempts: 3,
        }),
        expect.objectContaining({
          capabilityGrantId: "capability-policy",
          idempotencyKey: "sync-policy:policy-capability:2026-03-01T00:00:00.000Z",
        }),
      ]),
    );
    await expect(repository.listDueSyncPolicies({ limit: 10, now: createdAt })).resolves.toEqual({
      items: [],
    });
    await expect(
      repository.getSyncPolicy({ knowledgeSpaceId, sourceId: "source-custom", tenantId }),
    ).resolves.toMatchObject({ nextRunAt: "2026-03-01T02:00:00.000Z", revision: 2 });
    await expect(
      repository.getSyncPolicy({ knowledgeSpaceId, sourceId: "source-interval", tenantId }),
    ).resolves.toMatchObject({ nextRunAt: "2026-03-02T00:00:00.000Z", revision: 2 });
  });

  it("lists successful initial imports and sync timestamps in the requested tenant and space", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    await terminalRun(repository, "zero-result-sync", "zero_results");
    const importedSourceIds = [
      ["crawl-preview", "source-crawl-preview"],
      ["crawl-import", "source-crawl-import"],
      ["online-document-import", "source-online-document"],
      ["online-drive-import", "source-online-drive"],
    ] as const;
    for (const [kind, sourceId] of importedSourceIds) {
      await terminalRun(repository, `completed-${kind}`, "completed", { kind, sourceId });
    }
    await terminalRun(repository, "preview-only", "preview_ready", {
      kind: "crawl-preview",
      sourceId: "source-preview-only",
    });
    await terminalRun(repository, "empty-initial-crawl", "zero_results", {
      kind: "crawl-preview",
      sourceId: "source-empty-initial-crawl",
    });

    await expect(
      repository.listLatestSyncCompletions({
        knowledgeSpaceId,
        sourceIds: [
          "missing",
          "source-memory",
          "source-memory",
          ...importedSourceIds.map(([, sourceId]) => sourceId),
          "source-preview-only",
          "source-empty-initial-crawl",
        ],
        tenantId,
      }),
    ).resolves.toEqual([
      { completedAt: createdAt, sourceId: "source-memory" },
      ...importedSourceIds.map(([, sourceId]) => ({ completedAt: createdAt, sourceId })),
    ]);
    await expect(
      repository.listLatestSyncCompletions({
        knowledgeSpaceId,
        sourceIds: ["source-memory"],
        tenantId: "other-tenant",
      }),
    ).resolves.toEqual([]);
  });

  it("lists the latest sync runs in the requested tenant and space", async () => {
    const repository = createInMemorySourceProductWorkflowRepository({
      resolveCapabilityGrantScope: ({
        grantId,
        knowledgeSpaceId: scopedSpaceId,
        tenantId: scopedTenantId,
      }) =>
        grantId === "capability-private" &&
        scopedSpaceId === knowledgeSpaceId &&
        scopedTenantId === tenantId
          ? ["team:private"]
          : null,
    });
    await repository.start(runRecord("active-sync"));
    await repository.start(
      runRecord("other-source", {
        sourceId: "source-other",
      }),
    );
    await repository.start(
      runRecord("private-source", {
        requiredPermissionScope: ["team:private"],
        sourceId: "source-private",
      }),
    );
    await repository.start(
      runRecord("capability-private-source", {
        accessChannel: undefined,
        capabilityGrantId: "capability-private",
        permissionSnapshotId: undefined,
        permissionSnapshotRevision: undefined,
        requestedBySubjectId: undefined,
        requiredPermissionScope: undefined,
        sourceId: "source-capability-private",
      }),
    );
    await terminalRun(repository, "completed-sync", "completed");

    await expect(
      repository.listLatestSyncRuns({
        candidateGrants: [],
        knowledgeSpaceId,
        sourceIds: [
          "source-memory",
          "source-other",
          "source-private",
          "source-capability-private",
          "source-memory",
        ],
        tenantId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "active-sync", sourceId: "source-memory" }),
      expect.objectContaining({ id: "other-source", sourceId: "source-other" }),
    ]);
    await expect(
      repository.listLatestSyncRuns({
        candidateGrants: ["team:private"],
        knowledgeSpaceId,
        sourceIds: ["source-private"],
        tenantId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: "private-source", sourceId: "source-private" }),
    ]);
    await expect(
      repository.listLatestSyncRuns({
        candidateGrants: ["team:private"],
        knowledgeSpaceId,
        sourceIds: ["source-capability-private"],
        tenantId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "capability-private-source",
        sourceId: "source-capability-private",
      }),
    ]);
    await expect(
      repository.listLatestSyncRuns({
        candidateGrants: [],
        knowledgeSpaceId,
        sourceIds: ["source-memory"],
        tenantId: "other-tenant",
      }),
    ).resolves.toEqual([]);
  });
});

function runRecord(id: string, patch: Partial<NewSourceWorkflowRun> = {}): NewSourceWorkflowRun {
  return {
    accessChannel: "interactive",
    createdAt,
    id,
    idempotencyKey: `idempotency-${id}`,
    knowledgeSpaceId,
    kind: "sync",
    maxExecutionAttempts: 5,
    payload: {},
    permissionSnapshotId: `permission-${id}`,
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "editor-memory",
    requiredPermissionScope: [],
    sourceId: "source-memory",
    tenantId,
    ...patch,
  };
}

function bulkItem(
  id: string,
  runId: string,
  sourceId: string,
  patch: Partial<SourceBulkWorkflowItem> = {},
): SourceBulkWorkflowItem {
  return {
    action: "sync",
    id,
    runId,
    sourceId,
    status: "eligible",
    updatedAt: createdAt,
    ...patch,
  };
}

function crawlPage(id: string, pageId: string, runId: string): SourceCrawlPreviewPage {
  return {
    contentHash: "a".repeat(64),
    contentObjectKey: `${runId}/${pageId}`,
    createdAt,
    id,
    pageId,
    runId,
    sourceUrl: `https://example.test/${pageId}`,
  };
}

function requiredClaim(runs: readonly SourceWorkflowRun[], id: string): SourceWorkflowRun {
  const run = runs.find((candidate) => candidate.id === id);
  if (!run) throw new Error(`run ${id} was not claimed`);
  return run;
}

function fence(run: SourceWorkflowRun, workerId: string) {
  if (!run.leaseToken) throw new Error("run is not leased");
  return { leaseToken: run.leaseToken, rowVersion: run.rowVersion, runId: run.id, workerId };
}

async function terminalRun(
  repository: SourceProductWorkflowRepository,
  id: string,
  state: "completed" | "preview_ready" | "zero_results",
  patch: Partial<NewSourceWorkflowRun> = {},
) {
  await repository.start(runRecord(id, patch));
  const claimed = requiredClaim(
    await repository.claim({
      leaseExpiresAt: "2026-03-01T01:00:00.000Z",
      limit: 10,
      now: createdAt,
      workerId: `worker-${id}`,
    }),
    id,
  );
  return repository.complete({ fence: fence(claimed, `worker-${id}`), now: createdAt, state });
}

function policyRecord(
  id: string,
  patch: Partial<SourceSyncPolicyRecord> = {},
): SourceSyncPolicyRecord {
  return {
    accessChannel: "interactive",
    createdAt,
    enabled: true,
    expectedSourceVersion: 1,
    id,
    knowledgeSpaceId,
    mode: "interval",
    nextRunAt: createdAt,
    permissionSnapshotId: `permission-${id}`,
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "editor-memory",
    requiredPermissionScope: [],
    revision: 1,
    sourceId: `source-${id}`,
    tenantId,
    updatedAt: createdAt,
    ...patch,
  } as SourceSyncPolicyRecord;
}
