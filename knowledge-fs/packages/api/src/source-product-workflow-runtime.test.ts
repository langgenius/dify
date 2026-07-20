import { createHash } from "node:crypto";

import type { Source } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { SourceActiveDocumentInventoryItem } from "./logical-document-repository";
import type {
  MaterializeSourceDocumentsInput,
  SourceDocumentInput,
  SourceDocumentMaterializer,
} from "./source-document-materializer";
import type { PublishSourceLogicalRevisionInput } from "./source-logical-revision-publisher";
import type { NewSourceWorkflowRun, SourceWorkflowRun } from "./source-product-workflow";
import { createInMemorySourceProductWorkflowRepository } from "./source-product-workflow-memory-repository";
import { createSourceProductWorkflowRuntime } from "./source-product-workflow-runtime";

const tenantId = "tenant-source-runtime";
const knowledgeSpaceId = "space-source-runtime";
const nowIso = "2026-07-14T12:00:00.000Z";
const nowMs = Date.parse(nowIso);

describe("source-product workflow runtime sync", () => {
  it("publishes new website content and tombstones remote-missing logical documents", async () => {
    const newUrl = "https://example.test/new";
    const newProviderItemId = createHash("sha256").update(newUrl, "utf8").digest("hex");
    const source = sourceRecord("website", { type: "web" });
    const fixture = await createFixture({
      inventory: [inventoryItem("missing-page", "website")],
      source,
      websiteCrawl: {
        crawl: vi.fn(async () => ({
          pages: [{ content: "new content", sourceUrl: newUrl, title: "New page" }],
        })),
      },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        providerItemId: newProviderItemId,
        providerKind: "website",
        sourceId: source.id,
      }),
      expect.any(Object),
    );
    expect(fixture.markRemoteMissing).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "document-missing-page",
        policy: "tombstone",
        providerItemId: "missing-page",
      }),
      expect.any(Object),
    );
    await expect(fixture.getRun()).resolves.toMatchObject({
      progressCompleted: 2,
      progressTotal: 2,
      state: "completed",
    });
  });

  it("uses the persisted connection/provider capability for an empty online-document inventory", async () => {
    const source = sourceRecord("online-document", {
      connectionId: "connection-document",
      metadata: {},
    });
    const listPages = vi
      .fn()
      .mockResolvedValueOnce({
        nextCursor: "page-2",
        workspaces: [
          {
            pages: [{ lastEditedTime: "v1", pageId: "page-a", pageName: "Page A", type: "page" }],
            workspaceId: "workspace-a",
          },
        ],
      })
      .mockResolvedValueOnce({
        workspaces: [
          {
            pages: [{ lastEditedTime: "v2", pageId: "page-b", pageName: "Page B", type: "page" }],
            workspaceId: "workspace-a",
          },
        ],
      });
    const fixture = await createFixture({
      inventory: [],
      onlineDocuments: {
        getPageContent: vi.fn(async ({ page }) => ({
          content: `content:${page.pageId}`,
          pageId: page.pageId,
          workspaceId: page.workspaceId,
        })),
        listPages,
      },
      source,
      sourceConnections: {
        get: vi.fn(async () => ({ providerId: "notion-provider" })),
        resolve: vi.fn(async ({ source: unresolved }) => unresolved),
      },
      sourceProviders: {
        get: vi.fn(async () => ({
          available: true,
          capabilities: ["online-document"],
        })),
      },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(listPages).toHaveBeenCalledTimes(2);
    expect(listPages.mock.calls[0]?.[0]).not.toHaveProperty("cursor");
    expect(listPages.mock.calls[1]?.[0]).toMatchObject({ cursor: "page-2" });
    expect(fixture.publish.mock.calls.map((call) => call[0].providerItemId).sort()).toEqual([
      "page-a",
      "page-b",
    ]);
  });

  it("consumes every online-drive continuation page before completing", async () => {
    const source = sourceRecord("online-drive", {
      metadata: { providerKind: "online-drive" },
    });
    const browse = vi
      .fn()
      .mockResolvedValueOnce({
        buckets: [
          {
            bucket: "bucket-a",
            continuationToken: "next-a",
            files: [{ id: "file-a", name: "A.txt", type: "file" }],
            isTruncated: true,
          },
        ],
      })
      .mockResolvedValueOnce({
        buckets: [
          {
            bucket: "bucket-a",
            files: [{ id: "file-b", name: "B.txt", type: "file" }],
            isTruncated: false,
          },
        ],
      });
    const fixture = await createFixture({
      inventory: [],
      onlineDrive: {
        browse,
        download: vi.fn(async ({ file }) => ({ body: new TextEncoder().encode(file.id) })),
      },
      source,
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(browse).toHaveBeenCalledTimes(2);
    expect(browse.mock.calls[1]?.[0]).toMatchObject({
      bucket: "bucket-a",
      continuationToken: "next-a",
    });
    expect(fixture.publish.mock.calls.map((call) => call[0].providerItemId).sort()).toEqual([
      "file-a",
      "file-b",
    ]);
  });

  it("fails a changed durable listing fingerprint, then retry clears the cursor and succeeds", async () => {
    let clock = nowMs;
    const source = sourceRecord("listing-change", {
      metadata: { providerKind: "online-document" },
    });
    const listingB = [
      {
        lastEditedTime: "v2",
        pageId: "page-b",
        pageName: "Page B",
        type: "page",
      },
    ];
    const fixture = await createFixture({
      clock: () => clock,
      inventory: [],
      onlineDocuments: {
        getPageContent: vi.fn(async ({ page }) => ({ content: "B", pageId: page.pageId })),
        listPages: vi.fn(async () => ({
          workspaces: [{ pages: listingB, workspaceId: "workspace-a" }],
        })),
      },
      source,
      startClaimed: false,
    });
    const claimed = (
      await fixture.repository.claim({
        leaseExpiresAt: "2026-07-14T12:00:01.000Z",
        limit: 1,
        now: nowIso,
        workerId: "stale-worker",
      })
    )[0];
    if (!claimed?.leaseToken) throw new Error("sync run was not claimed");
    await fixture.repository.checkpoint({
      checkpoint: "provider-read",
      cursor: syncCursor("online-document", [["page-a", "workspace-a", "v1", "page"]], 1),
      fence: workflowFence(claimed, "stale-worker"),
      now: nowIso,
      progressCompleted: 1,
      progressTotal: 1,
      state: "syncing",
    });

    clock = Date.parse("2026-07-14T12:00:02.000Z");
    await expect(fixture.runtime.tick()).resolves.toMatchObject({ failed: 1 });
    const failed = await fixture.getRun();
    expect(failed).toMatchObject({
      lastErrorCode: "SOURCE_SYNC_LISTING_CHANGED",
      state: "failed",
    });
    await fixture.repository.retry({
      accessChannel: "interactive",
      now: "2026-07-14T12:00:03.000Z",
      permissionSnapshotId: "permission-retry",
      permissionSnapshotRevision: 1,
      requestedBySubjectId: "editor-source",
      runId: fixture.run.id,
    });
    clock = Date.parse("2026-07-14T12:00:04.000Z");
    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    await expect(fixture.getRun()).resolves.toMatchObject({ state: "completed" });
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({ providerItemId: "page-b" }),
      expect.any(Object),
    );
  });

  it.each([
    {
      name: "frozen run scope",
      requiredPermissionScope: ["team:camera"],
      sourcePermissionScope: [] as readonly string[],
    },
    {
      name: "current source scope",
      requiredPermissionScope: [] as readonly string[],
      sourcePermissionScope: ["team:camera"],
    },
  ])("fails before provider work when $name is no longer authorized", async (testCase) => {
    const crawl = vi.fn(async () => ({ pages: [] }));
    const fixture = await createFixture({
      inventory: [],
      requiredPermissionScope: testCase.requiredPermissionScope,
      source: sourceRecord(`revoked-${testCase.name}`, {
        permissionScope: [...testCase.sourcePermissionScope],
        type: "web",
      }),
      websiteCrawl: { crawl },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 0, failed: 1 });
    expect(crawl).not.toHaveBeenCalled();
    await expect(fixture.getRun()).resolves.toMatchObject({
      lastErrorCode: "SOURCE_WORKFLOW_PERMISSION_INVALID",
      state: "failed",
    });
  });

  it("waits for a late materializer settlement and compensates it after external timeout", async () => {
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const compensate = vi.fn(async () => undefined);
    const materializer: SourceDocumentMaterializer = {
      compensate,
      materialize: async (request: MaterializeSourceDocumentsInput) => {
        markStarted?.();
        await gate;
        const document = request.documents[0];
        const ownership = request.workflowExecution?.items[0];
        if (!document || !ownership) throw new Error("missing durable materialization proof");
        return {
          documents: [
            {
              documentAssetId: "00000000-0000-4000-8000-000000000099",
              documentAssetVersion: 1,
              filename: document.filename,
              mimeType: document.mimeType,
              objectKey: "tenant/space/documents/asset/raw.md",
              sizeBytes: document.body.byteLength,
              workflowOwnership: ownership,
            },
          ],
          failed: [],
        };
      },
    };
    const fixture = await createFixture({
      externalOperationTimeoutMs: 10,
      inventory: [],
      materializer,
      source: sourceRecord("timeout-late", { type: "web" }),
      websiteCrawl: {
        crawl: vi.fn(async () => ({
          pages: [
            {
              content: "late content",
              sourceUrl: "https://example.test/late",
              title: "Late",
            },
          ],
        })),
      },
    });

    let settled = false;
    const tick = fixture.runtime.tick().finally(() => {
      settled = true;
    });
    await started;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);
    release?.();

    await expect(tick).resolves.toMatchObject({ completed: 0, failed: 1 });
    expect(compensate).toHaveBeenCalledTimes(1);
    expect(fixture.publish).not.toHaveBeenCalled();
    await expect(fixture.getRun()).resolves.toMatchObject({
      lastErrorCode: "SOURCE_WORKFLOW_EXTERNAL_TIMEOUT",
      state: "failed",
    });
  });
});

async function createFixture(input: {
  readonly clock?: (() => number) | undefined;
  readonly externalOperationTimeoutMs?: number | undefined;
  readonly inventory: readonly SourceActiveDocumentInventoryItem[];
  readonly materializer?: SourceDocumentMaterializer | undefined;
  readonly onlineDocuments?: object | undefined;
  readonly onlineDrive?: object | undefined;
  readonly permissionScopes?: readonly string[] | undefined;
  readonly requiredPermissionScope?: readonly string[] | undefined;
  readonly source: Source;
  readonly sourceConnections?: object | undefined;
  readonly sourceProviders?: object | undefined;
  readonly startClaimed?: boolean | undefined;
  readonly websiteCrawl?: object | undefined;
}) {
  let assetSequence = 0;
  const repository = createInMemorySourceProductWorkflowRepository({
    generateLeaseToken: () => `lease-${++assetSequence}`,
  });
  const run = await repository.start({
    ...runRecord(input.source.id),
    requiredPermissionScope: input.requiredPermissionScope ?? [],
  });
  const publish = vi.fn(async (_request: PublishSourceLogicalRevisionInput) => ({
    documentId: `logical-${assetSequence}`,
    kind: "activated" as const,
    revision: 1,
  }));
  const markRemoteMissing = vi.fn(async () => undefined);
  const runtime = createSourceProductWorkflowRuntime({
    access: {
      revalidatePermissionSnapshot: vi.fn(
        async () =>
          ({
            permissionScopes: input.permissionScopes ?? [],
            revision: 1,
            role: "editor",
          }) as never,
      ),
    },
    claimBatchSize: 1,
    contentStore: {} as never,
    deletionFence: {
      assertDeletionFenceUnchanged: vi.fn(async () => undefined),
      captureDeletionFence: vi.fn(async (scope) => ({ scope }) as never),
    },
    logicalInventory: {
      listActiveBySource: vi.fn(async () => ({ items: [...input.inventory] })),
    },
    ...(input.externalOperationTimeoutMs
      ? { externalOperationTimeoutMs: input.externalOperationTimeoutMs }
      : {}),
    logicalRevisions: { markRemoteMissing, publish },
    materializer: input.materializer ?? {
      compensate: vi.fn(async () => undefined),
      materialize: vi.fn(
        async ({ documents, workflowExecution }: MaterializeSourceDocumentsInput) => ({
          documents: documents.map((document, index) => ({
            documentAssetId: `asset-${++assetSequence}`,
            documentAssetVersion: 1,
            filename: document.filename,
            mimeType: document.mimeType,
            objectKey: `objects/${assetSequence}`,
            sizeBytes: document.body.byteLength,
            workflowOwnership: workflowExecution?.items[index],
          })),
          failed: [],
        }),
      ),
    },
    now: input.clock ?? (() => nowMs),
    ...(input.onlineDocuments ? { onlineDocuments: input.onlineDocuments as never } : {}),
    ...(input.onlineDrive ? { onlineDrive: input.onlineDrive as never } : {}),
    repository,
    ...(input.sourceConnections ? { sourceConnections: input.sourceConnections as never } : {}),
    ...(input.sourceProviders ? { sourceProviders: input.sourceProviders as never } : {}),
    sources: { get: vi.fn(async () => input.source) } as never,
    ...(input.websiteCrawl ? { websiteCrawl: input.websiteCrawl as never } : {}),
    workerId: "source-runtime-worker",
  });
  return {
    getRun: () => repository.get({ knowledgeSpaceId, runId: run.id, tenantId }),
    markRemoteMissing,
    publish,
    repository,
    run,
    runtime,
  };
}

function sourceRecord(
  id: string,
  patch: Partial<Source> & { readonly metadata?: Readonly<Record<string, unknown>> },
): Source {
  return {
    createdAt: nowIso,
    id,
    knowledgeSpaceId,
    metadata: {},
    name: id,
    permissionScope: [],
    status: "active",
    type: "connector",
    updatedAt: nowIso,
    uri: "https://example.test",
    version: 1,
    ...patch,
  };
}

function runRecord(sourceId: string): NewSourceWorkflowRun {
  return {
    accessChannel: "interactive",
    createdAt: nowIso,
    id: `run-${sourceId}`,
    idempotencyKey: `sync-${sourceId}`,
    knowledgeSpaceId,
    kind: "sync",
    maxExecutionAttempts: 5,
    payload: {},
    permissionSnapshotId: "permission-source",
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "editor-source",
    requiredPermissionScope: [],
    sourceId,
    tenantId,
  };
}

function inventoryItem(
  providerItemId: string,
  providerKind: "website" | "online-document" | "online-drive",
): SourceActiveDocumentInventoryItem {
  return {
    contentHash: "a".repeat(64),
    documentId: `document-${providerItemId}`,
    providerItemId,
    revision: 1,
    rowVersion: 1,
    systemMetadata: { provenance: { providerKind } },
  };
}

function workflowFence(run: SourceWorkflowRun, workerId: string) {
  if (!run.leaseToken) throw new Error("workflow is not leased");
  return {
    leaseToken: run.leaseToken,
    rowVersion: run.rowVersion,
    runId: run.id,
    workerId,
  };
}

function syncCursor(
  kind: "website" | "online-document" | "online-drive",
  rows: readonly (readonly (string | number)[])[],
  offset: number,
): string {
  const hash = createHash("sha256");
  hash.update(`${kind}\0${rows.length}\0`, "utf8");
  for (const row of rows) {
    const serialized = JSON.stringify(row);
    hash.update(`${Buffer.byteLength(serialized, "utf8")}:`, "utf8");
    hash.update(serialized, "utf8");
  }
  return `ss1:${Buffer.from(
    JSON.stringify({
      fingerprint: hash.digest("hex"),
      kind,
      offset,
      phase: "items",
    }),
    "utf8",
  ).toString("base64url")}`;
}
