import { describe, expect, it, vi } from "vitest";

import type { Source } from "@knowledge/core";

import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationInput,
} from "./knowledge-space-authorization";
import {
  type NewSourceWorkflowRun,
  SourceWorkflowError,
  type SourceWorkflowRun,
  createSourceProductWorkflowService,
  nextSyncPolicyRunAt,
  providerItemIdentity,
  toPublicSourceWorkflowRun,
} from "./source-product-workflow";
import { createInMemorySourceProductWorkflowRepository } from "./source-product-workflow-memory-repository";
import { createSourceProductWorkflowRuntime } from "./source-product-workflow-runtime";

const tenantId = "tenant-a";
const knowledgeSpaceId = "space-a";
const editor = { scopes: [], subjectId: "editor-a", tenantId };

describe("source product workflows", () => {
  it("enforces source candidate ACL and permits viewer reads without write access", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    const accesses: string[] = [];
    const source = sourceRecord("source-a", ["grant:a"]);
    const service = createSourceProductWorkflowService({
      access: accessFixture(),
      authorization: {
        authorize: async (request) => {
          accesses.push(request.requiredAccess);
          return decision(request, request.subject.subjectId === "viewer-a" ? ["grant:a"] : []);
        },
      },
      repository,
      sources: { get: async ({ id }) => (id === source.id ? source : null) },
    });
    await expect(
      service.createSync({
        callerKind: "interactive",
        idempotencyKey: "sync-hidden",
        knowledgeSpaceId,
        sourceId: source.id,
        subject: editor,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });

    const visibleRun = await repository.start(
      runRecord({
        id: "run-visible",
        requiredPermissionScope: ["grant:a"],
        sourceId: source.id,
      }),
    );
    const viewer = { scopes: [], subjectId: "viewer-a", tenantId };
    await expect(
      service.get({
        callerKind: "interactive",
        knowledgeSpaceId,
        runId: visibleRun.id,
        subject: viewer,
      }),
    ).resolves.toMatchObject({ id: visibleRun.id });
    await expect(
      service.list({ callerKind: "interactive", knowledgeSpaceId, limit: 10, subject: viewer }),
    ).resolves.toMatchObject({ items: [{ id: visibleRun.id }] });
    expect(accesses.slice(-2)).toEqual(["read", "read"]);
  });

  it("filters candidate scope before LIMIT and reissues permission on retry", async () => {
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => "lease-a",
    });
    await repository.start(
      runRecord({ id: "a-hidden", requiredPermissionScope: ["grant:hidden"] }),
    );
    await repository.start(
      runRecord({ id: "b-visible", requiredPermissionScope: ["grant:visible"] }),
    );
    const page = await repository.listRuns({
      candidateGrants: ["grant:visible"],
      knowledgeSpaceId,
      limit: 1,
      tenantId,
    });
    expect(page.items.map((run) => run.id)).toEqual(["b-visible"]);

    const claimed = (
      await repository.claim({
        leaseExpiresAt: "2026-01-01T01:00:00.000Z",
        limit: 10,
        now: "2026-01-01T00:00:00.000Z",
        workerId: "worker-a",
      })
    ).find((run) => run.id === "b-visible");
    if (!claimed?.leaseToken) throw new Error("test run was not claimed");
    const failed = await repository.fail({
      errorCode: "TEST",
      errorMessage: "failed",
      fence: {
        leaseToken: claimed.leaseToken,
        rowVersion: claimed.rowVersion,
        runId: claimed.id,
        workerId: "worker-a",
      },
      now: "2026-01-01T00:01:00.000Z",
    });
    let snapshotRevision = 10;
    const service = createSourceProductWorkflowService({
      access: accessFixture(() => `snapshot-${snapshotRevision++}`),
      authorization: {
        authorize: async (request) => decision(request, ["grant:visible"]),
      },
      now: () => "2026-01-01T00:02:00.000Z",
      repository,
      sources: { get: async () => null },
    });
    const retried = await service.retry({
      callerKind: "interactive",
      knowledgeSpaceId,
      runId: failed.id,
      subject: editor,
    });
    expect(retried).toMatchObject({
      permissionSnapshotId: "snapshot-10",
      progressCompleted: 0,
      requestedBySubjectId: editor.subjectId,
      state: "queued",
    });
    expect(retried?.cursor).toBeUndefined();
    expect(retried?.permissionSnapshotId).not.toBe(failed.permissionSnapshotId);
  });

  it("rebinds a crawl selection to the fresh writer permission snapshot", async () => {
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => "lease-preview",
    });
    const preview = await repository.start(
      runRecord({
        id: "preview-a",
        kind: "crawl-preview",
        sourceId: "source-preview",
      }),
    );
    const claimed = (
      await repository.claim({
        leaseExpiresAt: "2026-01-01T01:00:00.000Z",
        limit: 1,
        now: "2026-01-01T00:00:01.000Z",
        workerId: "preview-worker",
      })
    )[0];
    if (!claimed?.leaseToken) throw new Error("preview run was not claimed");
    const staged = await repository.appendCrawlPages({
      fence: workflowFence(claimed, "preview-worker"),
      now: "2026-01-01T00:00:02.000Z",
      pages: [
        {
          contentHash: "a".repeat(64),
          contentObjectKey: "source-preview/page-a",
          createdAt: "2026-01-01T00:00:02.000Z",
          id: "crawl-page-a",
          pageId: "page-a",
          runId: preview.id,
          sourceUrl: "https://example.test/page-a",
        },
      ],
    });
    await repository.complete({
      fence: workflowFence(staged, "preview-worker"),
      now: "2026-01-01T00:00:03.000Z",
      state: "preview_ready",
    });
    const source = sourceRecord("source-preview", []);
    const service = createSourceProductWorkflowService({
      access: accessFixture(() => "permission-selection-fresh"),
      authorization: { authorize: async (request) => decision(request, []) },
      now: () => "2026-01-01T00:00:04.000Z",
      repository,
      sources: { get: async ({ id }) => (id === source.id ? source : null) },
    });

    await expect(
      service.selectCrawlPages({
        callerKind: "interactive",
        idempotencyKey: "selection-a",
        knowledgeSpaceId,
        pageIds: ["page-a"],
        runId: preview.id,
        subject: editor,
      }),
    ).resolves.toMatchObject({
      permissionSnapshotId: "permission-selection-fresh",
      requestedBySubjectId: editor.subjectId,
      state: "queued",
    });
  });

  it("keeps an unavailable Source as skipped and conceals bulk items from other requesters", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    const available = sourceRecord("source-available", []);
    let itemSequence = 0;
    const service = createSourceProductWorkflowService({
      access: accessFixture(),
      authorization: { authorize: async (request) => decision(request, []) },
      generateBulkItemId: () => `bulk-item-${++itemSequence}`,
      generateRunId: () => "bulk-admission",
      repository,
      sources: { get: async ({ id }) => (id === available.id ? available : null) },
    });

    const run = await service.createBulk({
      action: "disable",
      callerKind: "interactive",
      idempotencyKey: "bulk-with-unavailable",
      knowledgeSpaceId,
      sourceIds: [available.id, "source-unavailable"],
      subject: editor,
    });
    expect(run).toMatchObject({ progressSkipped: 1, progressTotal: 2, state: "queued" });

    await expect(
      service.listBulkItems({
        callerKind: "interactive",
        knowledgeSpaceId,
        limit: 10,
        runId: run.id,
        subject: editor,
      }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ sourceId: available.id, status: "eligible" }),
        expect.objectContaining({
          reason: "source-not-found",
          sourceId: "source-unavailable",
          status: "skipped",
        }),
      ]),
    });
    await expect(
      service.listBulkItems({
        callerKind: "interactive",
        knowledgeSpaceId,
        limit: 10,
        runId: run.id,
        subject: { ...editor, subjectId: "other-editor" },
      }),
    ).resolves.toBeNull();

    await repository.startBulk({
      items: [
        {
          action: "disable",
          id: "api-bulk-item",
          runId: "api-bulk-run",
          sourceId: available.id,
          status: "eligible",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      run: runRecord({
        accessChannel: "service_api",
        id: "api-bulk-run",
        kind: "bulk",
        permissionSnapshotId: "permission-api-bulk",
        progressTotal: 1,
      }),
    });
    await expect(
      service.listBulkItems({
        apiKey: { id: "different-api-key", revision: 1 },
        callerKind: "api_key",
        knowledgeSpaceId,
        limit: 10,
        runId: "api-bulk-run",
        subject: editor,
      }),
    ).resolves.toBeNull();
  });

  it("turns a Source deleted after bulk admission into a skipped item", async () => {
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => "lease-deleted-source",
    });
    const parent = await repository.startBulk({
      items: [
        {
          action: "disable",
          id: "deleted-source-item",
          runId: "bulk-deleted-source",
          sourceId: "source-deleted-after-admission",
          status: "eligible",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      run: runRecord({ id: "bulk-deleted-source", kind: "bulk", progressTotal: 1 }),
    });
    const runtime = createSourceProductWorkflowRuntime({
      access: {
        revalidatePermissionSnapshot: vi.fn(
          async () => ({ permissionScopes: [], revision: 1, role: "editor" }) as never,
        ),
      },
      claimBatchSize: 1,
      contentStore: {} as never,
      deletionFence: {
        assertDeletionFenceUnchanged: vi.fn(async () => undefined),
        captureDeletionFence: vi.fn(async (scope) => ({ scope }) as never),
      },
      logicalInventory: {} as never,
      logicalRevisions: {} as never,
      materializer: {} as never,
      now: () => Date.parse("2026-01-01T00:00:01.000Z"),
      repository,
      sources: { get: vi.fn(async () => null) } as never,
      workerId: "bulk-deleted-source-worker",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    await expect(
      repository.get({ knowledgeSpaceId, runId: parent.id, tenantId }),
    ).resolves.toMatchObject({
      progressFailed: 0,
      progressSkipped: 1,
      state: "completed",
    });
    await expect(repository.listBulkItems({ limit: 10, runId: parent.id })).resolves.toMatchObject({
      items: [expect.objectContaining({ reason: "source-not-found", status: "skipped" })],
    });
  });

  it("atomically enqueues isolated child sync runs for multiple bulk items", async () => {
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => "lease-parent",
    });
    const parent = await repository.startBulk({
      items: ["source-a", "source-b"].map((sourceId, index) => ({
        action: "sync" as const,
        id: `item-${index}`,
        runId: "bulk-a",
        sourceId,
        status: "eligible" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
      run: runRecord({
        id: "bulk-a",
        kind: "bulk",
        progressTotal: 2,
      }),
    });
    const claimed = (
      await repository.claim({
        leaseExpiresAt: "2026-01-01T01:00:00.000Z",
        limit: 1,
        now: "2026-01-01T00:00:01.000Z",
        workerId: "worker-a",
      })
    )[0];
    if (!claimed?.leaseToken) throw new Error("bulk parent was not claimed");
    let current = claimed;
    for (const itemId of ["item-0", "item-1"]) {
      const queued = await repository.enqueueBulkSyncChild({
        fence: {
          leaseToken: current.leaseToken as string,
          rowVersion: current.rowVersion,
          runId: current.id,
          workerId: "worker-a",
        },
        itemId,
        now: "2026-01-01T00:00:02.000Z",
        runId: parent.id,
      });
      current = queued.parent;
    }
    const runs = await repository.listRuns({
      candidateGrants: [],
      knowledgeSpaceId,
      limit: 10,
      tenantId,
    });
    expect(
      runs.items
        .filter((run) => run.kind === "sync")
        .map((run) => run.sourceId)
        .sort(),
    ).toEqual(["source-a", "source-b"]);
    expect(current.cursor).toBeUndefined();
    expect((await repository.listBulkItems({ limit: 10, runId: parent.id })).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "item-0",
          childRunId: expect.any(String),
          status: "running",
        }),
        expect.objectContaining({
          id: "item-1",
          childRunId: expect.any(String),
          status: "running",
        }),
      ]),
    );
  });

  it("keeps a bulk parent queued until children terminate and reports partial failure", async () => {
    let clock = Date.parse("2026-01-01T00:00:01.000Z");
    let leaseSequence = 0;
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => `lease-${++leaseSequence}`,
    });
    const parent = await repository.startBulk({
      items: ["source-a", "source-b"].map((sourceId, index) => ({
        action: "sync" as const,
        id: `item-${index}`,
        runId: "bulk-partial",
        sourceId,
        status: "eligible" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
      run: runRecord({ id: "bulk-partial", kind: "bulk", progressTotal: 2 }),
    });
    const runtime = createSourceProductWorkflowRuntime({
      access: {
        revalidatePermissionSnapshot: vi.fn(
          async () => ({ permissionScopes: [], revision: 1, role: "editor" }) as never,
        ),
      },
      bulkChildPollMs: 1_000,
      claimBatchSize: 1,
      contentStore: {} as never,
      deletionFence: {
        assertDeletionFenceUnchanged: vi.fn(async () => undefined),
        captureDeletionFence: vi.fn(async (scope) => ({ scope }) as never),
      },
      logicalInventory: {} as never,
      logicalRevisions: {} as never,
      materializer: {} as never,
      now: () => clock,
      repository,
      sources: { get: vi.fn(async () => null) } as never,
      workerId: "bulk-parent-worker",
    });

    await expect(runtime.tick()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      deferred: 1,
      failed: 0,
      stale: 0,
    });
    await expect(
      repository.get({ knowledgeSpaceId, runId: parent.id, tenantId }),
    ).resolves.toMatchObject({ executionAttempts: 0, state: "queued" });

    const children = await repository.claim({
      leaseExpiresAt: "2026-01-01T01:00:00.000Z",
      limit: 10,
      now: "2026-01-01T00:00:01.000Z",
      workerId: "child-worker",
    });
    expect(children).toHaveLength(2);
    const [successful, unsuccessful] = children;
    if (!successful?.leaseToken || !unsuccessful?.leaseToken) {
      throw new Error("bulk children were not independently claimable");
    }
    await repository.complete({
      fence: workflowFence(successful, "child-worker"),
      now: "2026-01-01T00:00:02.000Z",
    });
    await repository.fail({
      errorCode: "PROVIDER_TIMEOUT",
      errorMessage: "provider timed out",
      fence: workflowFence(unsuccessful, "child-worker"),
      now: "2026-01-01T00:00:02.000Z",
    });

    clock = Date.parse("2026-01-01T00:00:03.000Z");
    await expect(runtime.tick()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      deferred: 0,
      failed: 0,
      stale: 0,
    });
    await expect(
      repository.get({ knowledgeSpaceId, runId: parent.id, tenantId }),
    ).resolves.toMatchObject({
      progressCompleted: 1,
      progressFailed: 1,
      progressSkipped: 0,
      state: "completed",
    });
    expect((await repository.listBulkItems({ limit: 10, runId: parent.id })).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "completed" }),
        expect.objectContaining({ errorCode: "PROVIDER_TIMEOUT", status: "failed" }),
      ]),
    );
  });

  it("binds an immediately terminal deletion job before completing its bulk item", async () => {
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => "lease-immediate-removal",
    });
    const parent = await repository.startBulk({
      items: [
        {
          action: "remove",
          id: "immediate-removal-item",
          runId: "bulk-immediate-removal",
          sourceId: "source-immediate-removal",
          status: "eligible",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      run: runRecord({ id: "bulk-immediate-removal", kind: "bulk", progressTotal: 1 }),
    });
    const runtime = createSourceProductWorkflowRuntime({
      access: {
        revalidatePermissionSnapshot: vi.fn(
          async () => ({ permissionScopes: [], revision: 1, role: "editor" }) as never,
        ),
      },
      bulkRemoval: {
        find: vi.fn(async () => null),
        get: vi.fn(async () => null),
        request: vi.fn(async () => ({
          deletionJobId: "deletion-immediate-removal",
          state: "succeeded" as const,
        })),
      },
      claimBatchSize: 1,
      contentStore: {} as never,
      deletionFence: {
        assertDeletionFenceUnchanged: vi.fn(async () => undefined),
        captureDeletionFence: vi.fn(async (scope) => ({ scope }) as never),
      },
      logicalInventory: {} as never,
      logicalRevisions: {} as never,
      materializer: {} as never,
      now: () => Date.parse("2026-01-01T00:00:01.000Z"),
      repository,
      sources: {
        get: vi.fn(async () => sourceRecord("source-immediate-removal", [])),
      } as never,
      workerId: "bulk-immediate-removal-worker",
    });

    await expect(runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    await expect(
      repository.get({ knowledgeSpaceId, runId: parent.id, tenantId }),
    ).resolves.toMatchObject({ progressCompleted: 1, state: "completed" });
    await expect(repository.listBulkItems({ limit: 10, runId: parent.id })).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          deletionJobId: "deletion-immediate-removal",
          status: "completed",
        }),
      ],
    });
  });

  it("submits idempotent durable source deletions and aggregates per-child partial failure", async () => {
    let clock = Date.parse("2026-01-01T00:00:01.000Z");
    let leaseSequence = 0;
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => `lease-remove-${++leaseSequence}`,
    });
    const parent = await repository.startBulk({
      items: ["source-remove-a", "source-remove-b"].map((sourceId, index) => ({
        action: "remove" as const,
        id: `remove-item-${index}`,
        runId: "bulk-remove",
        sourceId,
        status: "eligible" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
      run: runRecord({ id: "bulk-remove", kind: "bulk", progressTotal: 2 }),
    });
    const sources = new Map([
      ["source-remove-a", sourceRecord("source-remove-a", [])],
      ["source-remove-b", sourceRecord("source-remove-b", [])],
    ]);
    const getSource = vi.fn(async ({ id }: { readonly id: string }) => sources.get(id) ?? null);
    // Simulate a worker crash after source A's deletion job was committed but before the bulk item
    // was bound to it. The stable child idempotency key must recover that job without re-reading a
    // now deletion-fenced Source row.
    const findRemoval = vi.fn(async (input: { readonly sourceId: string }) =>
      input.sourceId === "source-remove-a"
        ? { deletionJobId: "deletion-source-remove-a", state: "pending" as const }
        : null,
    );
    const requestRemoval = vi.fn(async (input: { readonly sourceId: string }) => ({
      deletionJobId: `deletion-${input.sourceId}`,
      state: "pending" as const,
    }));
    const getRemoval = vi.fn(async (input: { readonly sourceId: string }) =>
      input.sourceId === "source-remove-a"
        ? { deletionJobId: `deletion-${input.sourceId}`, state: "succeeded" as const }
        : {
            deletionJobId: `deletion-${input.sourceId}`,
            errorCode: "SOURCE_DURABLE_DELETION_FAILED",
            reason: "Durable source deletion failed",
            state: "failed" as const,
          },
    );
    const runtime = createSourceProductWorkflowRuntime({
      access: {
        revalidatePermissionSnapshot: vi.fn(
          async () => ({ permissionScopes: [], revision: 1, role: "editor" }) as never,
        ),
      },
      bulkChildPollMs: 1_000,
      bulkRemoval: {
        find: findRemoval as never,
        get: getRemoval as never,
        request: requestRemoval as never,
      },
      claimBatchSize: 1,
      contentStore: {} as never,
      deletionFence: {
        assertDeletionFenceUnchanged: vi.fn(async () => undefined),
        captureDeletionFence: vi.fn(async (scope) => ({ scope }) as never),
      },
      logicalInventory: {} as never,
      logicalRevisions: {} as never,
      materializer: {} as never,
      now: () => clock,
      repository,
      sources: { get: getSource } as never,
      workerId: "bulk-remove-worker",
    });

    await expect(runtime.tick()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      deferred: 1,
      failed: 0,
      stale: 0,
    });
    expect(findRemoval).toHaveBeenCalledTimes(2);
    expect(requestRemoval).toHaveBeenCalledTimes(1);
    expect(getSource.mock.calls.map(([request]) => request.id)).toEqual(["source-remove-b"]);
    expect(requestRemoval).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expectedSourceVersion: 1,
        idempotencyKey: "source-bulk:bulk-remove:source-remove-b",
        permissionFence: {
          accessChannel: "interactive",
          knowledgeSpaceId,
          permissionSnapshotId: "permission-bulk-remove",
          permissionSnapshotRevision: 1,
          requestedBySubjectId: editor.subjectId,
          tenantId,
        },
        sourceId: "source-remove-b",
      }),
    );
    await expect(
      repository.get({ knowledgeSpaceId, runId: parent.id, tenantId }),
    ).resolves.toMatchObject({
      progressCompleted: 0,
      progressFailed: 0,
      state: "queued",
    });
    expect((await repository.listBulkItems({ limit: 10, runId: parent.id })).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deletionJobId: "deletion-source-remove-a",
          sourceId: "source-remove-a",
          status: "running",
        }),
        expect.objectContaining({
          deletionJobId: "deletion-source-remove-b",
          sourceId: "source-remove-b",
          status: "running",
        }),
      ]),
    );

    clock = Date.parse("2026-01-01T00:00:03.000Z");
    await expect(runtime.tick()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      deferred: 0,
      failed: 0,
      stale: 0,
    });
    expect(getRemoval).toHaveBeenCalledTimes(2);
    await expect(
      repository.get({ knowledgeSpaceId, runId: parent.id, tenantId }),
    ).resolves.toMatchObject({
      progressCompleted: 1,
      progressFailed: 1,
      state: "completed",
    });
    expect((await repository.listBulkItems({ limit: 10, runId: parent.id })).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "source-remove-a", status: "completed" }),
        expect.objectContaining({ sourceId: "source-remove-b", status: "failed" }),
      ]),
    );
  });
});

describe("source product workflow service boundaries", () => {
  it("creates every single-source workflow and sanitizes provider selections", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    const web = sourceRecord("source-web", [], { type: "web" });
    const connector = sourceRecord("source-connector", []);
    const sources = new Map([
      [web.id, web],
      [connector.id, connector],
    ]);
    let sequence = 0;
    const service = createSourceProductWorkflowService({
      access: accessFixture(),
      authorization: { authorize: async (request) => decision(request, []) },
      generateRunId: () => `generated-run-${++sequence}`,
      maxImportItems: 2,
      now: () => "2026-02-01T00:00:00.000Z",
      repository,
      sources: { get: async ({ id }) => sources.get(id) ?? null },
    });

    await expect(
      service.createPreview({
        callerKind: "interactive",
        idempotencyKey: " preview ",
        knowledgeSpaceId,
        sourceId: web.id,
        subject: editor,
      }),
    ).resolves.toMatchObject({ idempotencyKey: "preview", kind: "crawl-preview" });
    await expect(
      service.createPreview({
        callerKind: "interactive",
        idempotencyKey: "not-web",
        knowledgeSpaceId,
        sourceId: connector.id,
        subject: editor,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_CRAWL_TYPE_INVALID" });

    const document = await service.createImport({
      callerKind: "interactive",
      idempotencyKey: "document-import",
      items: [
        {
          etag: "etag-a",
          lastEditedTime: "2026-01-31T00:00:00.000Z",
          name: "Page A",
          pageId: "page-a",
          providerItemId: "provider-page-a",
          type: "page",
          workspaceId: "workspace-a",
        },
      ],
      kind: "online-document-import",
      knowledgeSpaceId,
      sourceId: connector.id,
      subject: editor,
    });
    expect(document).toMatchObject({
      kind: "online-document-import",
      payload: {
        items: [
          {
            etag: "etag-a",
            lastEditedTime: "2026-01-31T00:00:00.000Z",
            name: "Page A",
            pageId: "page-a",
            providerItemId: "provider-page-a",
            type: "page",
            workspaceId: "workspace-a",
          },
        ],
      },
      progressTotal: 1,
    });

    const drive = await service.createImport({
      callerKind: "interactive",
      idempotencyKey: "drive-import",
      items: [
        {
          bucket: "bucket-a",
          etag: "etag-b",
          id: "file-a",
          mimeType: "text/plain",
          name: "File A",
          providerItemId: "provider-file-a",
        },
        { id: "file-b", name: "File B", providerItemId: "provider-file-b" },
      ],
      kind: "online-drive-import",
      knowledgeSpaceId,
      sourceId: connector.id,
      subject: editor,
    });
    expect(drive.payload.items).toEqual([
      {
        bucket: "bucket-a",
        etag: "etag-b",
        id: "file-a",
        mimeType: "text/plain",
        name: "File A",
        providerItemId: "provider-file-a",
      },
      { id: "file-b", name: "File B", providerItemId: "provider-file-b" },
    ]);
    await expect(
      service.createSync({
        callerKind: "interactive",
        idempotencyKey: "sync-a",
        knowledgeSpaceId,
        sourceId: connector.id,
        subject: editor,
      }),
    ).resolves.toMatchObject({ kind: "sync", sourceId: connector.id });

    const importBase = {
      callerKind: "interactive" as const,
      idempotencyKey: "invalid-import",
      kind: "online-drive-import" as const,
      knowledgeSpaceId,
      sourceId: connector.id,
      subject: editor,
    };
    await expect(service.createImport({ ...importBase, items: [] })).rejects.toMatchObject({
      code: "SOURCE_IMPORT_ITEMS_INVALID",
    });
    await expect(
      service.createImport({
        ...importBase,
        items: [
          { id: "a", name: "A", providerItemId: "a" },
          { id: "b", name: "B", providerItemId: "b" },
          { id: "c", name: "C", providerItemId: "c" },
        ],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_IMPORT_ITEMS_INVALID" });
    await expect(
      service.createImport({
        ...importBase,
        items: [
          {
            credentials: { token: "secret" },
            id: "a",
            name: "A",
            providerItemId: "a",
          } as never,
        ],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_IMPORT_ITEMS_INVALID" });
    await expect(
      service.createImport({
        ...importBase,
        items: [{ id: " ", name: "A", providerItemId: "a" }],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_INPUT_INVALID" });
    await expect(
      service.createSync({
        callerKind: "interactive",
        idempotencyKey: " ",
        knowledgeSpaceId,
        sourceId: connector.id,
        subject: editor,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_INPUT_INVALID" });
  });

  it("uses capability authorization without minting durable permission snapshots", async () => {
    const repository = createInMemorySourceProductWorkflowRepository({
      generateLeaseToken: () => "capability-lease",
    });
    const access = accessFixture();
    const authorization = { authorize: vi.fn(async () => Promise.reject(new Error("unexpected"))) };
    const connector = sourceRecord("source-capability", ["grant:capability"]);
    const web = sourceRecord("source-capability-web", ["grant:capability"], { type: "web" });
    const sources = new Map([
      [connector.id, connector],
      [web.id, web],
    ]);
    let sequence = 0;
    const service = createSourceProductWorkflowService({
      access,
      authorization,
      generateBulkItemId: () => `cap-item-${++sequence}`,
      generateRunId: () => `cap-run-${++sequence}`,
      now: () => "2026-02-02T00:00:00.000Z",
      repository,
      sources: { get: async ({ id }) => sources.get(id) ?? null },
    });
    const principal = {
      callerKind: "interactive" as const,
      capability: { contentScopeIds: ["grant:capability"], grantId: "capability-a" },
      subject: editor,
    };

    const sync = await service.createSync({
      ...principal,
      idempotencyKey: "cap-sync",
      knowledgeSpaceId,
      sourceId: connector.id,
    });
    expect(sync).toMatchObject({ capabilityGrantId: "capability-a", kind: "sync" });
    expect(sync.permissionSnapshotId).toBeUndefined();
    await expect(
      service.get({ ...principal, knowledgeSpaceId, runId: sync.id }),
    ).resolves.toMatchObject({ id: sync.id });
    await expect(
      service.list({
        ...principal,
        cursor: "before",
        knowledgeSpaceId,
        limit: 10,
        sourceId: connector.id,
      }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ id: sync.id })] });

    const canceled = await service.cancel({ ...principal, knowledgeSpaceId, runId: sync.id });
    expect(canceled).toMatchObject({
      capabilityGrantId: "capability-a",
      lastErrorMessage: "Canceled by user",
      state: "canceled",
    });
    await expect(
      service.retry({ ...principal, knowledgeSpaceId, runId: sync.id }),
    ).resolves.toMatchObject({ capabilityGrantId: "capability-a", state: "queued" });

    const bulk = await service.createBulk({
      ...principal,
      action: "sync",
      idempotencyKey: "cap-bulk",
      knowledgeSpaceId,
      sourceIds: [connector.id],
    });
    await expect(
      service.listBulkItems({
        ...principal,
        cursor: "before",
        knowledgeSpaceId,
        limit: 10,
        runId: bulk.id,
      }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ sourceId: connector.id })] });

    const preview = await service.createPreview({
      ...principal,
      idempotencyKey: "cap-preview",
      knowledgeSpaceId,
      sourceId: web.id,
    });
    const claimed = (
      await repository.claim({
        leaseExpiresAt: "2026-02-02T01:00:00.000Z",
        limit: 20,
        now: "2026-02-02T00:01:00.000Z",
        workerId: "cap-worker",
      })
    ).find((candidate) => candidate.id === preview.id);
    if (!claimed) throw new Error("capability preview was not claimed");
    const staged = await repository.appendCrawlPages({
      fence: workflowFence(claimed, "cap-worker"),
      now: "2026-02-02T00:02:00.000Z",
      pages: [
        {
          contentHash: "b".repeat(64),
          contentObjectKey: "cap/page",
          createdAt: "2026-02-02T00:02:00.000Z",
          id: "cap-page-row",
          pageId: "cap-page",
          runId: preview.id,
          sourceUrl: "https://example.test/cap",
        },
      ],
    });
    await repository.complete({
      fence: workflowFence(staged, "cap-worker"),
      now: "2026-02-02T00:03:00.000Z",
      state: "preview_ready",
    });
    await expect(
      service.selectCrawlPages({
        ...principal,
        idempotencyKey: "cap-selection",
        knowledgeSpaceId,
        pageIds: ["cap-page", "cap-page"],
        runId: preview.id,
      }),
    ).resolves.toMatchObject({
      capabilityGrantId: "capability-a",
      payload: { selectedPageIds: ["cap-page"] },
      state: "queued",
    });

    expect(authorization.authorize).not.toHaveBeenCalled();
    expect(access.createPermissionSnapshot).not.toHaveBeenCalled();
    await expect(
      service.createSync({
        ...principal,
        capability: { contentScopeIds: ["grant:other"], grantId: "capability-hidden" },
        idempotencyKey: "hidden",
        knowledgeSpaceId,
        sourceId: connector.id,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_FOUND" });
  });

  it("validates and revises sync policies with deterministic schedules", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    const source = sourceRecord("source-policy", []);
    const service = createSourceProductWorkflowService({
      access: accessFixture(),
      authorization: { authorize: async (request) => decision(request, []) },
      now: () => "2026-02-03T00:00:00.000Z",
      repository,
      sources: { get: async ({ id }) => (id === source.id ? source : null) },
    });
    const base = {
      callerKind: "interactive" as const,
      expectedRevision: 0,
      expectedSourceVersion: 1,
      knowledgeSpaceId,
      sourceId: source.id,
      subject: editor,
    };

    await expect(
      service.getSyncPolicy({
        callerKind: "interactive",
        knowledgeSpaceId,
        sourceId: source.id,
        subject: editor,
      }),
    ).resolves.toBeNull();
    await expect(
      service.putSyncPolicy({ ...base, enabled: true, expectedSourceVersion: 2, mode: "provider" }),
    ).rejects.toMatchObject({ code: "SOURCE_SYNC_POLICY_SOURCE_CONFLICT" });

    for (const request of [
      { customIntervalSeconds: undefined, enabled: true, mode: "custom" as const },
      { customIntervalSeconds: 3_599, enabled: true, mode: "custom" as const },
      { customIntervalSeconds: 2_592_001, enabled: true, mode: "custom" as const },
      { customIntervalSeconds: 3_600.5, enabled: true, mode: "custom" as const },
      { customIntervalSeconds: 3_600, enabled: true, mode: "interval" as const },
      { customIntervalSeconds: undefined, enabled: true, mode: "manual" as const },
    ]) {
      await expect(service.putSyncPolicy({ ...base, ...request })).rejects.toMatchObject({
        code: "SOURCE_SYNC_POLICY_INVALID",
      });
    }

    const created = await service.putSyncPolicy({ ...base, enabled: true, mode: "provider" });
    expect(created).toMatchObject({
      createdAt: "2026-02-03T00:00:00.000Z",
      enabled: true,
      nextRunAt: "2026-02-03T01:00:00.000Z",
      revision: 1,
    });
    await expect(
      service.putSyncPolicy({ ...base, enabled: true, mode: "interval" }),
    ).rejects.toMatchObject({ code: "SOURCE_SYNC_POLICY_CONFLICT" });

    const manual = await service.putSyncPolicy({
      ...base,
      enabled: false,
      expectedRevision: 1,
      mode: "manual",
    });
    expect(manual).toMatchObject({ createdAt: created.createdAt, enabled: false, revision: 2 });
    expect(manual.nextRunAt).toBeUndefined();
    const custom = await service.putSyncPolicy({
      ...base,
      apiKey: { id: "api-key-a", revision: 1 },
      customIntervalSeconds: 7_200,
      enabled: true,
      expectedRevision: 2,
      mode: "custom",
    });
    expect(custom).toMatchObject({
      customIntervalSeconds: 7_200,
      nextRunAt: "2026-02-03T02:00:00.000Z",
      revision: 3,
    });
    await expect(
      service.getSyncPolicy({
        callerKind: "interactive",
        knowledgeSpaceId,
        sourceId: source.id,
        subject: editor,
      }),
    ).resolves.toMatchObject({ revision: 3 });
  });

  it("classifies bulk admission outcomes and validates unique item bounds", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    const active = sourceRecord("source-active", []);
    const disabled = sourceRecord("source-disabled", [], { status: "disabled" });
    const syncing = sourceRecord("source-syncing", [], { status: "syncing" });
    const sources = new Map([
      [active.id, active],
      [disabled.id, disabled],
      [syncing.id, syncing],
    ]);
    let runSequence = 0;
    let itemSequence = 0;
    const service = createSourceProductWorkflowService({
      access: accessFixture(),
      authorization: { authorize: async (request) => decision(request, []) },
      generateBulkItemId: () => `item-${++itemSequence}`,
      generateRunId: () => `bulk-${++runSequence}`,
      maxBulkItems: 3,
      now: () => "2026-02-04T00:00:00.000Z",
      repository,
      sources: { get: async ({ id }) => sources.get(id) ?? null },
    });
    const base = {
      callerKind: "interactive" as const,
      knowledgeSpaceId,
      subject: editor,
    };
    await expect(
      service.createBulk({
        ...base,
        action: "sync",
        idempotencyKey: "empty",
        sourceIds: [],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_BULK_ITEMS_INVALID" });
    await expect(
      service.createBulk({
        ...base,
        action: "sync",
        idempotencyKey: "too-many",
        sourceIds: ["one", "two", "three", "four"],
      }),
    ).rejects.toMatchObject({ code: "SOURCE_BULK_ITEMS_INVALID" });

    const sync = await service.createBulk({
      ...base,
      action: "sync",
      idempotencyKey: "sync-statuses",
      sourceIds: [disabled.id, syncing.id, "source-missing"],
    });
    await expect(repository.listBulkItems({ limit: 10, runId: sync.id })).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ reason: "source-disabled", sourceId: disabled.id }),
        expect.objectContaining({ reason: "sync-in-flight", sourceId: syncing.id }),
        expect.objectContaining({ reason: "source-not-found", sourceId: "source-missing" }),
      ]),
    });

    const disable = await service.createBulk({
      ...base,
      action: "disable",
      idempotencyKey: "disable-statuses",
      sourceIds: [disabled.id, active.id, active.id],
    });
    expect(disable.progressTotal).toBe(2);
    await expect(repository.listBulkItems({ limit: 10, runId: disable.id })).resolves.toMatchObject(
      {
        items: expect.arrayContaining([
          expect.objectContaining({ reason: "already-disabled", sourceId: disabled.id }),
          expect.objectContaining({ sourceId: active.id, status: "eligible" }),
        ]),
      },
    );

    const remove = await service.createBulk({
      ...base,
      action: "remove",
      idempotencyKey: "remove-disabled",
      sourceIds: [disabled.id],
    });
    await expect(repository.listBulkItems({ limit: 10, runId: remove.id })).resolves.toMatchObject({
      items: [expect.objectContaining({ sourceId: disabled.id, status: "eligible" })],
    });
  });

  it("conceals non-readable bulk results and handles durable revalidation failures", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    const nonBulk = await repository.start(runRecord({ id: "not-bulk" }));
    const hidden = await repository.startBulk({
      items: [bulkItem("hidden-item", "hidden-bulk")],
      run: runRecord({
        id: "hidden-bulk",
        kind: "bulk",
        progressTotal: 1,
        requiredPermissionScope: ["grant:hidden"],
      }),
    });
    const incomplete = await repository.startBulk({
      items: [bulkItem("incomplete-item", "incomplete-bulk")],
      run: runRecord({
        id: "incomplete-bulk",
        kind: "bulk",
        permissionSnapshotId: undefined,
        progressTotal: 1,
      }),
    });
    const deniedAccess = accessFixture();
    deniedAccess.revalidatePermissionSnapshot.mockRejectedValue(
      new KnowledgeSpaceAuthorizationError("KNOWLEDGE_SPACE_ROLE_DENIED", "denied"),
    );
    const service = createSourceProductWorkflowService({
      access: deniedAccess,
      authorization: { authorize: async (request) => decision(request, ["grant:hidden"]) },
      repository,
      sources: { get: async () => null },
    });
    const request = {
      callerKind: "interactive" as const,
      knowledgeSpaceId,
      limit: 10,
      subject: editor,
    };
    await expect(service.listBulkItems({ ...request, runId: "missing" })).resolves.toBeNull();
    await expect(service.listBulkItems({ ...request, runId: nonBulk.id })).resolves.toBeNull();
    await expect(service.listBulkItems({ ...request, runId: incomplete.id })).resolves.toBeNull();
    await expect(service.listBulkItems({ ...request, runId: hidden.id })).resolves.toBeNull();
    await expect(
      service.listBulkItems({
        ...request,
        capability: { contentScopeIds: ["grant:other"], grantId: "cap-wrong" },
        runId: hidden.id,
      }),
    ).resolves.toBeNull();

    const unexpectedAccess = accessFixture();
    unexpectedAccess.revalidatePermissionSnapshot.mockRejectedValue(new Error("access offline"));
    const unexpectedService = createSourceProductWorkflowService({
      access: unexpectedAccess,
      authorization: { authorize: async (authorizationInput) => decision(authorizationInput, []) },
      repository,
      sources: { get: async () => null },
    });
    const visible = await repository.startBulk({
      items: [bulkItem("visible-item", "visible-bulk")],
      run: runRecord({ id: "visible-bulk", kind: "bulk", progressTotal: 1 }),
    });
    await expect(
      unexpectedService.listBulkItems({ ...request, runId: visible.id }),
    ).rejects.toThrow("access offline");
  });

  it("returns null for absent operations and rejects invalid crawl selections", async () => {
    const repository = createInMemorySourceProductWorkflowRepository();
    const service = createSourceProductWorkflowService({
      access: accessFixture(),
      authorization: { authorize: async (request) => decision(request, []) },
      maxImportItems: 2,
      repository,
      sources: { get: async () => null },
    });
    const principal = { callerKind: "interactive" as const, subject: editor };
    await expect(
      service.get({ ...principal, knowledgeSpaceId, runId: "missing" }),
    ).resolves.toBeNull();
    await expect(
      service.cancel({ ...principal, knowledgeSpaceId, reason: "requested", runId: "missing" }),
    ).resolves.toBeNull();
    await expect(
      service.retry({ ...principal, knowledgeSpaceId, runId: "missing" }),
    ).resolves.toBeNull();
    await expect(
      service.selectCrawlPages({
        ...principal,
        idempotencyKey: "missing",
        knowledgeSpaceId,
        pageIds: ["page"],
        runId: "missing",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_NOT_FOUND" });

    const preview = await repository.start(
      runRecord({ id: "selection-bounds", kind: "crawl-preview" }),
    );
    await expect(
      service.selectCrawlPages({
        ...principal,
        idempotencyKey: "empty",
        knowledgeSpaceId,
        pageIds: [],
        runId: preview.id,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_IMPORT_ITEMS_INVALID" });
    await expect(
      service.selectCrawlPages({
        ...principal,
        idempotencyKey: "too-many",
        knowledgeSpaceId,
        pageIds: ["one", "two", "three"],
        runId: preview.id,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_IMPORT_ITEMS_INVALID" });
  });

  it("normalizes provider identity and strictly allow-lists public workflow output", () => {
    expect(
      providerItemIdentity({
        contentHash: "A".repeat(64),
        etag: " etag-a ",
        providerItemId: " provider-a ",
      }),
    ).toEqual({ contentHash: "a".repeat(64), etag: "etag-a", providerItemId: "provider-a" });
    expect(providerItemIdentity({ etag: "etag-only", providerItemId: "provider-b" })).toMatchObject(
      {
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        etag: "etag-only",
      },
    );
    expect(
      providerItemIdentity({ contentHash: "b".repeat(64), providerItemId: "provider-c" }),
    ).toEqual({ contentHash: "b".repeat(64), providerItemId: "provider-c" });
    expect(() =>
      providerItemIdentity({ contentHash: "not-a-hash", providerItemId: "provider-d" }),
    ).toThrowError(expect.objectContaining({ code: "SOURCE_PROVIDER_HASH_INVALID" }));
    expect(() => providerItemIdentity({ providerItemId: "provider-e" })).toThrowError(
      expect.objectContaining({ code: "SOURCE_PROVIDER_VERSION_MISSING" }),
    );
    expect(() => providerItemIdentity({ etag: "etag", providerItemId: " " })).toThrowError(
      expect.objectContaining({ code: "SOURCE_WORKFLOW_INPUT_INVALID" }),
    );

    const publicRun = toPublicSourceWorkflowRun({
      ...workflowRun("sync"),
      canceledAt: "2026-02-05T00:00:00.000Z",
      completedAt: "2026-02-05T00:00:00.000Z",
      cursor: "cursor-a",
      lastErrorCode: "SAFE_CODE",
      progressTotal: 3,
    });
    expect(publicRun).toMatchObject({
      canceledAt: "2026-02-05T00:00:00.000Z",
      completedAt: "2026-02-05T00:00:00.000Z",
      cursor: "cursor-a",
      lastErrorCode: "SAFE_CODE",
      progressTotal: 3,
      sourceId: "source-public",
    });
    expect(JSON.stringify(publicRun)).not.toMatch(
      /accessChannel|idempotencyKey|payload|permissionSnapshot|tenantId/u,
    );
    const minimal = toPublicSourceWorkflowRun({
      ...workflowRun("bulk"),
      sourceId: undefined,
    });
    expect(minimal).not.toHaveProperty("canceledAt");
    expect(minimal).not.toHaveProperty("completedAt");
    expect(minimal).not.toHaveProperty("cursor");
    expect(minimal).not.toHaveProperty("lastErrorCode");
    expect(minimal).not.toHaveProperty("progressTotal");
    expect(minimal).not.toHaveProperty("sourceId");
  });

  it("computes supported policy intervals and rejects invalid scheduling anchors", () => {
    expect(nextSyncPolicyRunAt("provider", undefined, "2026-02-06T00:00:00.000Z")).toBe(
      "2026-02-06T01:00:00.000Z",
    );
    expect(nextSyncPolicyRunAt("interval", undefined, "2026-02-06T00:00:00.000Z")).toBe(
      "2026-02-07T00:00:00.000Z",
    );
    expect(nextSyncPolicyRunAt("custom", 3_600, "2026-02-06T00:00:00.000Z")).toBe(
      "2026-02-06T01:00:00.000Z",
    );
    expect(() => nextSyncPolicyRunAt("manual", undefined, "2026-02-06T00:00:00.000Z")).toThrow(
      SourceWorkflowError,
    );
    expect(() => nextSyncPolicyRunAt("provider", undefined, "invalid")).toThrow(
      SourceWorkflowError,
    );
    expect(() => nextSyncPolicyRunAt("custom", undefined, "2026-02-06T00:00:00.000Z")).toThrow(
      SourceWorkflowError,
    );
    expect(() => nextSyncPolicyRunAt("custom", 0, "2026-02-06T00:00:00.000Z")).toThrow(
      SourceWorkflowError,
    );
  });
});

function runRecord(
  patch: Partial<NewSourceWorkflowRun> & { readonly id: string },
): NewSourceWorkflowRun {
  return {
    accessChannel: "interactive",
    createdAt: "2026-01-01T00:00:00.000Z",
    idempotencyKey: `key-${patch.id}`,
    knowledgeSpaceId,
    kind: "sync",
    maxExecutionAttempts: 5,
    payload: {},
    permissionSnapshotId: `permission-${patch.id}`,
    permissionSnapshotRevision: 1,
    requestedBySubjectId: editor.subjectId,
    requiredPermissionScope: [],
    tenantId,
    ...patch,
  };
}

function workflowRun(kind: SourceWorkflowRun["kind"]): SourceWorkflowRun {
  return {
    ...runRecord({ id: "public-run", kind, sourceId: "source-public" }),
    checkpoint: "queued",
    executionAttempts: 0,
    progressCompleted: 0,
    progressFailed: 0,
    progressSkipped: 0,
    rowVersion: 1,
    state: "queued",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function sourceRecord(
  id: string,
  permissionScope: readonly string[],
  patch: Partial<Source> = {},
): Source {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    id,
    knowledgeSpaceId,
    metadata: {},
    name: id,
    permissionScope: [...permissionScope],
    status: "active",
    type: "connector",
    updatedAt: "2026-01-01T00:00:00.000Z",
    uri: "https://example.test",
    version: 1,
    ...patch,
  };
}

function bulkItem(id: string, workflowRunId: string) {
  return {
    action: "sync" as const,
    id,
    runId: workflowRunId,
    sourceId: `source-${id}`,
    status: "eligible" as const,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function accessFixture(generateId: () => string = () => "permission-new") {
  return {
    createPermissionSnapshot: vi.fn(
      async (request: Parameters<KnowledgeSpaceAccessService["createPermissionSnapshot"]>[0]) =>
        ({
          accessChannel: request.accessChannel,
          apiAccessRevision: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: request.expiresAt,
          id: generateId(),
          knowledgeSpaceId: request.knowledgeSpaceId,
          memberRevision: 1,
          permissionScopes: [],
          policyRevision: 1,
          revision: 1,
          role: "editor",
          status: "active",
          subjectId: request.subjectId,
          tenantId: request.tenantId,
          updatedAt: "2026-01-01T00:00:00.000Z",
          visibility: "all_members",
        }) as never,
    ),
    revalidatePermissionSnapshot: vi.fn(
      async (request: Parameters<KnowledgeSpaceAccessService["revalidatePermissionSnapshot"]>[0]) =>
        ({
          accessChannel: request.expectedAccessChannel,
          apiAccessRevision: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2027-01-01T00:00:00.000Z",
          id: request.id,
          knowledgeSpaceId: request.knowledgeSpaceId,
          memberRevision: 1,
          permissionScopes: [],
          policyRevision: 1,
          revision: 1,
          role: "editor",
          status: "active",
          subjectId: request.subjectId,
          tenantId: request.tenantId,
          updatedAt: "2026-01-01T00:00:00.000Z",
          visibility: "all_members",
        }) as never,
    ),
  };
}

function decision(request: KnowledgeSpaceAuthorizationInput, candidateGrants: readonly string[]) {
  return {
    accessContext: {},
    permissionSnapshot: {
      apiAccessRevision: 1,
      callerKind: request.callerKind,
      candidateGrants,
      issuedAt: "2026-01-01T00:00:00.000Z",
      knowledgeSpaceId: request.knowledgeSpaceId,
      memberRevision: 1,
      memberRole: "editor",
      policyRevision: 1,
      subjectId: request.subject.subjectId,
      tenantId: request.subject.tenantId,
    },
  } as never;
}

function workflowFence(
  run: {
    readonly id: string;
    readonly leaseToken?: string | undefined;
    readonly rowVersion: number;
  },
  workerId: string,
) {
  if (!run.leaseToken) throw new Error("workflow is not leased");
  return {
    leaseToken: run.leaseToken,
    rowVersion: run.rowVersion,
    runId: run.id,
    workerId,
  };
}
