import { createHash } from "node:crypto";

import type { ObjectStorageAdapter, Source } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type { SourceActiveDocumentInventoryItem } from "./logical-document-repository";
import type {
  MaterializeSourceDocumentsInput,
  MaterializedSourceDocument,
  SourceDocumentInput,
  SourceDocumentMaterializer,
} from "./source-document-materializer";
import type { PublishSourceLogicalRevisionInput } from "./source-logical-revision-publisher";
import {
  type NewSourceWorkflowRun,
  type SourceBulkWorkflowItem,
  SourceWorkflowError,
  type SourceWorkflowRun,
} from "./source-product-workflow";
import { createInMemorySourceProductWorkflowRepository } from "./source-product-workflow-memory-repository";
import {
  createObjectStorageSourceWorkflowContentStore,
  createSourceProductWorkflowRuntime,
} from "./source-product-workflow-runtime";

const tenantId = "tenant-source-runtime";
const knowledgeSpaceId = "space-source-runtime";
const nowIso = "2026-07-14T12:00:00.000Z";
const nowMs = Date.parse(nowIso);
const capabilityGrantId = "grant-source-runtime";

describe("source-product workflow staged content store", () => {
  it("writes, reads, and deletes only content in the hashed run scope", async () => {
    const body = new TextEncoder().encode("staged source body");
    const contentHash = createHash("sha256").update(body).digest("hex");
    const storage = fakeObjectStorage({
      listResults: [
        {
          nextCursor: "next-page",
          objects: [
            { key: "staged-object-a", metadata: {}, sizeBytes: 1 },
            { key: "staged-object-b", metadata: {}, sizeBytes: 1 },
          ],
        },
        { objects: [] },
      ],
      storedBody: body,
    });
    const store = createObjectStorageSourceWorkflowContentStore({
      maxCleanupBatchSize: 2,
      maxObjectBytes: body.byteLength,
      storage,
    });

    const key = await store.put({
      body,
      contentHash,
      knowledgeSpaceId: "space/with/slash",
      pageId: "page/with/slash",
      runId: "run/with/slash",
      tenantId: "tenant/with/slash",
    });

    expect(key).toMatch(
      /^__knowledge-source-workflows\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}\/[a-f0-9]{64}-[a-f0-9]{64}\.bin$/,
    );
    expect(storage.putObject).toHaveBeenCalledWith({
      body,
      contentType: "application/octet-stream",
      key,
      metadata: { contentHash, lifecycle: "source-workflow-staging", runId: "run/with/slash" },
    });
    await expect(
      store.get({
        contentObjectKey: key,
        knowledgeSpaceId: "space/with/slash",
        runId: "run/with/slash",
        tenantId: "tenant/with/slash",
      }),
    ).resolves.toEqual(body);
    await expect(
      store.deleteRun({
        knowledgeSpaceId: "space/with/slash",
        limit: 2,
        runId: "run/with/slash",
        tenantId: "tenant/with/slash",
      }),
    ).resolves.toEqual({ deleted: 2, hasMore: true });
    await expect(
      store.deleteRun({
        knowledgeSpaceId: "space/with/slash",
        limit: 1,
        runId: "run/with/slash",
        tenantId: "tenant/with/slash",
      }),
    ).resolves.toEqual({ deleted: 0, hasMore: false });
    expect(storage.deleteObject.mock.calls.map(([deletedKey]) => deletedKey)).toEqual([
      "staged-object-a",
      "staged-object-b",
    ]);
  });

  it("rejects oversized, corrupt, cross-scope, and invalid cleanup requests", async () => {
    const body = new TextEncoder().encode("body");
    const contentHash = createHash("sha256").update(body).digest("hex");
    const storage = fakeObjectStorage({ storedBody: null });
    const store = createObjectStorageSourceWorkflowContentStore({
      maxCleanupBatchSize: 2,
      maxObjectBytes: body.byteLength,
      storage,
    });

    await expect(
      store.put({
        body: new Uint8Array(body.byteLength + 1),
        contentHash,
        knowledgeSpaceId,
        pageId: "page-a",
        runId: "run-a",
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_CONTENT_TOO_LARGE" });
    await expect(
      store.put({
        body,
        contentHash: "0".repeat(64),
        knowledgeSpaceId,
        pageId: "page-a",
        runId: "run-a",
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_CONTENT_HASH_MISMATCH" });
    await expect(
      store.get({
        contentObjectKey: "outside/the/run/scope",
        knowledgeSpaceId,
        runId: "run-a",
        tenantId,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_CONTENT_SCOPE_MISMATCH" });

    for (const limit of [0, 3, 1.5, Number.NaN]) {
      await expect(
        store.deleteRun({ knowledgeSpaceId, limit, runId: "run-a", tenantId }),
      ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_CLEANUP_LIMIT_INVALID" });
    }
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(storage.listObjects).not.toHaveBeenCalled();

    const defaultStorage = fakeObjectStorage({ storedBody: null });
    const defaultStore = createObjectStorageSourceWorkflowContentStore({ storage: defaultStorage });
    const defaultKey = await defaultStore.put({
      body,
      contentHash,
      knowledgeSpaceId,
      pageId: "page-default",
      runId: "run-default",
      tenantId,
    });
    await expect(
      defaultStore.get({
        contentObjectKey: defaultKey,
        knowledgeSpaceId,
        runId: "run-default",
        tenantId,
      }),
    ).resolves.toBeNull();
    await expect(
      defaultStore.deleteRun({ knowledgeSpaceId, limit: 101, runId: "run-default", tenantId }),
    ).rejects.toMatchObject({ code: "SOURCE_WORKFLOW_CLEANUP_LIMIT_INVALID" });
  });
});

describe("source-product workflow provider imports", () => {
  it("stages a crawl preview, imports the frozen selection, and drains staged content", async () => {
    const source = sourceRecord("crawl-preview-source", { type: "web" });
    const pages = [
      {
        content: "First page body",
        description: "First description",
        sourceUrl: "https://example.test/first",
        title: "First title",
      },
      {
        content: "Second page body",
        sourceUrl: "https://example.test/second",
      },
    ];
    const bodies = new Map<string, Uint8Array>();
    const deleteRun = vi
      .fn()
      .mockResolvedValueOnce({ deleted: 1, hasMore: true })
      .mockResolvedValueOnce({ deleted: 1, hasMore: false });
    const contentStore = {
      deleteRun,
      get: vi.fn(
        async ({ contentObjectKey }: { readonly contentObjectKey: string }) =>
          bodies.get(contentObjectKey) ?? null,
      ),
      put: vi.fn(
        async ({ body, pageId }: { readonly body: Uint8Array; readonly pageId: string }) => {
          const key = `staged/${pageId}`;
          bodies.set(key, body);
          return key;
        },
      ),
    } as unknown as Parameters<typeof createSourceProductWorkflowRuntime>[0]["contentStore"];
    const run = {
      ...runRecord(source.id),
      id: "run-crawl-preview",
      idempotencyKey: "crawl-preview",
      kind: "crawl-preview" as const,
      payload: {},
    };
    const fixture = await createFixture({
      contentStore,
      inventory: [],
      maxCleanupBatchesPerRun: 2,
      run,
      source,
      websiteCrawl: { crawl: vi.fn(async () => ({ pages })) },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    await expect(fixture.getRun()).resolves.toMatchObject({
      progressCompleted: 2,
      progressTotal: 2,
      state: "preview_ready",
    });
    const staged = await fixture.repository.listCrawlPages({ limit: 10, runId: run.id });
    expect(staged.items).toHaveLength(2);
    expect(staged.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "First description", title: "First title" }),
        expect.not.objectContaining({ description: expect.anything(), title: expect.anything() }),
      ]),
    );

    await fixture.repository.selectCrawlPages({
      accessChannel: "interactive",
      idempotencyKey: "crawl-selection",
      now: nowIso,
      pageIds: staged.items.map((page) => page.pageId),
      permissionSnapshotId: "permission-source",
      permissionSnapshotRevision: 1,
      requestedBySubjectId: "editor-source",
      runId: run.id,
    });
    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    await expect(fixture.getRun()).resolves.toMatchObject({
      progressCompleted: 2,
      progressTotal: 2,
      state: "completed",
    });
    expect(fixture.publish).toHaveBeenCalledTimes(2);
    expect(deleteRun).toHaveBeenCalledTimes(2);
  });

  it("imports online-document records with and without optional identity metadata", async () => {
    const source = sourceRecord("online-document-import-source", {
      connectionId: "connection-document-import",
      type: "connector",
    });
    const getPageContent = vi.fn(
      async ({ page }: { readonly page: { readonly pageId: string } }) => ({
        content: `content:${page.pageId}`,
      }),
    );
    const resolve = vi.fn(async ({ source: unresolved }: { readonly source: Source }) => ({
      ...unresolved,
      uri: "https://resolved.example.test",
    }));
    const fixture = await createFixture({
      inventory: [],
      onlineDocuments: { getPageContent },
      run: {
        ...runRecord(source.id),
        id: "run-online-document-import",
        idempotencyKey: "online-document-import",
        kind: "online-document-import",
        payload: {
          items: [
            {
              etag: "etag-a",
              name: "Page A",
              pageId: "page-a",
              providerItemId: "provider-page-a",
              type: "page",
              workspaceId: "workspace-a",
            },
            {
              pageId: "page-b",
              providerItemId: "provider-page-b",
              type: "database",
              workspaceId: "workspace-b",
            },
          ],
        },
        progressTotal: 2,
      },
      source,
      sourceConnections: { resolve },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(resolve).toHaveBeenCalledOnce();
    expect(getPageContent).toHaveBeenCalledTimes(2);
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({ etag: "etag-a", providerItemId: "provider-page-a" }),
      expect.any(Object),
    );
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.not.objectContaining({ etag: expect.anything() }),
      expect.any(Object),
    );
    await expect(fixture.getRun()).resolves.toMatchObject({
      progressCompleted: 2,
      state: "completed",
    });
  });

  it("imports online-drive files with bounded optional bucket, etag, and MIME metadata", async () => {
    const source = sourceRecord("online-drive-import-source", { type: "connector" });
    const download = vi.fn(
      async ({ file }: { readonly file: { readonly bucket?: string; readonly id: string } }) => ({
        body: new TextEncoder().encode(`${file.bucket ?? "root"}:${file.id}`),
      }),
    );
    const fixture = await createFixture({
      inventory: [],
      onlineDrive: { download },
      run: {
        ...runRecord(source.id),
        id: "run-online-drive-import",
        idempotencyKey: "online-drive-import",
        kind: "online-drive-import",
        payload: {
          items: [
            {
              bucket: "bucket-a",
              etag: "etag-file-a",
              id: "file-a",
              mimeType: "text/plain",
              name: "A.txt",
              providerItemId: "provider-file-a",
            },
            {
              id: "file-b",
              name: "B.bin",
              providerItemId: "provider-file-b",
            },
          ],
        },
        progressTotal: 2,
      },
      source,
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(download).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ file: { bucket: "bucket-a", id: "file-a" } }),
    );
    expect(download).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ file: { id: "file-b" } }),
    );
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({ etag: "etag-file-a", mimeType: "text/plain" }),
      expect.any(Object),
    );
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "application/octet-stream" }),
      expect.any(Object),
    );
  });

  it("records zero-result previews without staging provider content", async () => {
    const source = sourceRecord("empty-crawl-preview", { type: "web" });
    const put = vi.fn();
    const fixture = await createFixture({
      contentStore: { put } as never,
      inventory: [],
      run: providerRun(source.id, "crawl-preview", {}),
      source,
      websiteCrawl: { crawl: vi.fn(async () => ({ pages: [] })) },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    await expect(fixture.getRun()).resolves.toMatchObject({ state: "zero_results" });
    expect(put).not.toHaveBeenCalled();
  });

  it("fails closed for unavailable providers, invalid payloads, and bounded result limits", async () => {
    const source = sourceRecord("provider-failure-source", { type: "connector" });
    const scenarios: readonly {
      readonly expectedCode: string;
      readonly fixture: Parameters<typeof createFixture>[0];
    }[] = [
      {
        expectedCode: "SOURCE_CRAWL_PROVIDER_UNAVAILABLE",
        fixture: {
          inventory: [],
          run: providerRun(source.id, "crawl-preview", {}),
          source,
        },
      },
      {
        expectedCode: "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
        fixture: {
          inventory: [],
          run: providerRun(source.id, "online-document-import", {
            items: [
              {
                pageId: "page-a",
                providerItemId: "provider-a",
                type: "page",
                workspaceId: "workspace-a",
              },
            ],
          }),
          source,
        },
      },
      {
        expectedCode: "SOURCE_ONLINE_DRIVE_UNAVAILABLE",
        fixture: {
          inventory: [],
          run: providerRun(source.id, "online-drive-import", {
            items: [{ id: "file-a", name: "A", providerItemId: "provider-a" }],
          }),
          source,
        },
      },
      {
        expectedCode: "SOURCE_CRAWL_PROVIDER_UNAVAILABLE",
        fixture: {
          inventory: [],
          run: providerRun(source.id, "crawl-preview", {}),
          source,
          websiteCrawl: { crawl: vi.fn(() => undefined as never) },
        },
      },
      {
        expectedCode: "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
        fixture: {
          inventory: [],
          onlineDocuments: { getPageContent: vi.fn(() => undefined as never) },
          run: providerRun(source.id, "online-document-import", {
            items: [
              {
                pageId: "empty-response-page",
                providerItemId: "empty-response-provider-page",
                type: "page",
                workspaceId: "empty-response-workspace",
              },
            ],
          }),
          source,
        },
      },
      {
        expectedCode: "SOURCE_ONLINE_DRIVE_UNAVAILABLE",
        fixture: {
          inventory: [],
          onlineDrive: { download: vi.fn(() => undefined as never) },
          run: providerRun(source.id, "online-drive-import", {
            items: [
              {
                id: "empty-response-file",
                name: "Empty.bin",
                providerItemId: "empty-response-provider-file",
              },
            ],
          }),
          source,
        },
      },
      {
        expectedCode: "SOURCE_WORKFLOW_PAYLOAD_INVALID",
        fixture: {
          inventory: [],
          onlineDocuments: { getPageContent: vi.fn() },
          run: providerRun(source.id, "online-document-import", { items: [] }),
          source,
        },
      },
      {
        expectedCode: "SOURCE_WORKFLOW_PAYLOAD_INVALID",
        fixture: {
          inventory: [],
          onlineDocuments: { getPageContent: vi.fn() },
          run: providerRun(source.id, "online-document-import", { items: [null] as never }),
          source,
        },
      },
      {
        expectedCode: "SOURCE_WORKFLOW_PAYLOAD_INVALID",
        fixture: {
          inventory: [],
          onlineDocuments: { getPageContent: vi.fn() },
          run: providerRun(source.id, "online-document-import", {
            items: [
              {
                pageId: " ",
                providerItemId: "provider-a",
                type: "page",
                workspaceId: "workspace-a",
              },
            ],
          }),
          source,
        },
      },
      {
        expectedCode: "SOURCE_WORKFLOW_PAYLOAD_INVALID",
        fixture: {
          inventory: [],
          run: providerRun(source.id, "crawl-preview", { selectedPageIds: [1] }),
          source,
          websiteCrawl: { crawl: vi.fn() },
        },
      },
      {
        expectedCode: "SOURCE_CRAWL_RESULT_LIMIT_EXCEEDED",
        fixture: {
          inventory: [],
          maxCrawlPages: 1,
          run: providerRun(source.id, "crawl-preview", {}),
          source,
          websiteCrawl: {
            crawl: vi.fn(async () => ({
              pages: [
                { content: "A", sourceUrl: "https://example.test/a" },
                { content: "B", sourceUrl: "https://example.test/b" },
              ],
            })),
          },
        },
      },
      {
        expectedCode: "SOURCE_SYNC_LIMIT_INVALID",
        fixture: {
          inventory: [],
          maxSyncItems: 0,
          source,
        },
      },
    ];

    for (const scenario of scenarios) {
      const fixture = await createFixture(scenario.fixture);
      await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 0, failed: 1 });
      await expect(fixture.getRun()).resolves.toMatchObject({
        lastErrorCode: scenario.expectedCode,
        state: "failed",
      });
    }
  });

  it("compensates every materialized document when a provider batch is partial", async () => {
    const source = sourceRecord("partial-import-source", { type: "connector" });
    const documents: readonly MaterializedSourceDocument[] = [
      {
        documentAssetId: "partial-asset",
        documentAssetVersion: 1,
        filename: "Partial.md",
        mimeType: "text/markdown",
        sizeBytes: 7,
      },
    ];
    const compensate = vi.fn(async () => undefined);
    const fixture = await createFixture({
      inventory: [],
      materializer: {
        compensate,
        materialize: vi.fn(async () => ({
          documents,
          failed: [{ code: "PARSE_FAILED", error: "parse failed", filename: "Partial.md" }],
        })),
      },
      onlineDocuments: {
        getPageContent: vi.fn(async () => ({ content: "partial" })),
      },
      run: providerRun(source.id, "online-document-import", {
        items: [
          {
            pageId: "partial-page",
            providerItemId: "partial-provider-item",
            type: "page",
            workspaceId: "partial-workspace",
          },
        ],
      }),
      source,
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 0, failed: 1 });
    expect(compensate).toHaveBeenCalledWith(
      expect.objectContaining({ documents, sourceId: source.id }),
    );
    expect(fixture.publish).not.toHaveBeenCalled();
    await expect(fixture.getRun()).resolves.toMatchObject({
      lastErrorCode: "SOURCE_IMPORT_PARTIAL_FAILURE",
      state: "failed",
    });
  });

  it("rejects missing logical-revision ownership proofs and compensates exact writes", async () => {
    const source = sourceRecord("proof-import-source", { type: "connector" });
    const prooflessDocument: MaterializedSourceDocument = {
      documentAssetId: "proofless-asset",
      documentAssetVersion: 1,
      filename: "Proofless.md",
      mimeType: "text/markdown",
      sizeBytes: 9,
    };
    for (const documents of [[], [prooflessDocument]] as const) {
      const compensate = vi.fn(async () => undefined);
      const fixture = await createFixture({
        inventory: [],
        materializer: {
          compensate,
          materialize: vi.fn(async () => ({ documents, failed: [] })),
        },
        onlineDocuments: { getPageContent: vi.fn(async () => ({ content: "proofless" })) },
        run: providerRun(source.id, "online-document-import", {
          items: [
            {
              pageId: "proof-page",
              providerItemId: "proof-provider-item",
              type: "page",
              workspaceId: "proof-workspace",
            },
          ],
        }),
        source,
      });

      await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 0, failed: 1 });
      expect(compensate).toHaveBeenCalledWith(
        expect.objectContaining({ documents, sourceId: source.id }),
      );
      await expect(fixture.getRun()).resolves.toMatchObject({
        lastErrorCode: "SOURCE_LOGICAL_REVISION_PROOF_MISSING",
        state: "failed",
      });
    }
  });

  it("runs the explicit crawl-import kind and cleans an empty frozen selection", async () => {
    const deleteRun = vi.fn(async () => ({ deleted: 0, hasMore: false }));
    const source = sourceRecord("empty-crawl-import", { type: "web" });
    const fixture = await createFixture({
      contentStore: { deleteRun } as never,
      inventory: [],
      run: providerRun(source.id, "crawl-import", { selectedPageIds: [] }),
      source,
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(deleteRun).toHaveBeenCalledOnce();
  });

  it("fails bounded crawl imports for invalid cleanup, incomplete cleanup, and missing content", async () => {
    const invalidCleanup = await createSelectedCrawlFixture({ maxCleanupBatchesPerRun: 0 });
    await expect(invalidCleanup.runtime.tick()).resolves.toMatchObject({ failed: 1 });
    await expect(invalidCleanup.getRun()).resolves.toMatchObject({
      lastErrorCode: "SOURCE_WORKFLOW_CLEANUP_BATCHES_INVALID",
      state: "failed",
    });

    const incompleteCleanup = await createSelectedCrawlFixture({
      cleanupHasMore: true,
      maxCleanupBatchesPerRun: 1,
    });
    await expect(incompleteCleanup.runtime.tick()).resolves.toMatchObject({ failed: 1 });
    await expect(incompleteCleanup.getRun()).resolves.toMatchObject({
      lastErrorCode: "SOURCE_WORKFLOW_CLEANUP_INCOMPLETE",
      state: "failed",
    });

    const missingContent = await createSelectedCrawlFixture({ contentAvailable: false });
    await expect(missingContent.runtime.tick()).resolves.toMatchObject({ failed: 1 });
    await expect(missingContent.getRun()).resolves.toMatchObject({
      lastErrorCode: "SOURCE_WORKFLOW_CONTENT_MISSING",
      state: "failed",
    });
  });

  it("compensates unchanged and failed logical revision publications", async () => {
    const source = sourceRecord("publication-compensation-source", {
      metadata: { remoteDeletionPolicy: "retain" },
      type: "connector",
    });
    const run = providerRun(source.id, "online-document-import", {
      items: [
        {
          pageId: "publication-page",
          providerItemId: "publication-provider-item",
          type: "page",
          workspaceId: "publication-workspace",
        },
      ],
    });
    const unchanged = await createFixture({
      inventory: [],
      onlineDocuments: { getPageContent: vi.fn(async () => ({ content: "unchanged" })) },
      publishKind: "unchanged",
      run,
      source,
    });

    await expect(unchanged.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(unchanged.publish).toHaveBeenCalledWith(
      expect.objectContaining({ remoteDeletionPolicy: "retain" }),
      expect.any(Object),
    );
    expect(unchanged.materializer.compensate).toHaveBeenCalledTimes(1);

    const failed = await createFixture({
      inventory: [],
      onlineDocuments: { getPageContent: vi.fn(async () => ({ content: "failed" })) },
      publishError: new Error("publication failed"),
      run,
      source,
    });
    await expect(failed.runtime.tick()).resolves.toMatchObject({ completed: 0, failed: 1 });
    expect(failed.materializer.compensate).toHaveBeenCalledTimes(1);
  });
});

describe("source-product workflow runtime sync", () => {
  it("starts idempotently and allows every stop handle to drain the shared lane", async () => {
    const fixture = await createFixture({
      intervalMs: 60_000,
      inventory: [],
      source: sourceRecord("runtime-lifecycle", { type: "web" }),
      websiteCrawl: { crawl: vi.fn(async () => ({ pages: [] })) },
    });

    const stopFirst = fixture.runtime.start();
    const stopSecond = fixture.runtime.start();
    await stopSecond();
    await stopFirst();
    await fixture.runtime.stop();
  });

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

  it("uses deterministic website fallbacks for missing and filesystem-unsafe titles", async () => {
    const fixture = await createFixture({
      inventory: [],
      source: sourceRecord("website-filename-fallbacks", { type: "web" }),
      websiteCrawl: {
        crawl: vi.fn(async () => ({
          pages: [
            { content: "untitled", sourceUrl: "https://example.test/untitled" },
            {
              content: "unsafe title",
              sourceUrl: "https://example.test/unsafe-title",
              title: "!!!",
            },
          ],
        })),
      },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(fixture.publish).toHaveBeenCalledTimes(2);
    expect(fixture.materializer.materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: expect.arrayContaining([
          expect.objectContaining({ filename: expect.stringMatching(/^provider-item-/) }),
        ]),
      }),
    );
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({ title: "https://example.test/untitled" }),
      expect.any(Object),
    );
  });

  it("derives remote-missing provider kinds from online inventories", async () => {
    const scenarios: readonly {
      readonly inventory: SourceActiveDocumentInventoryItem;
      readonly onlineDocuments?: object;
      readonly onlineDrive?: object;
      readonly source: Source;
    }[] = [
      {
        inventory: inventoryItem("missing-document", "online-document"),
        onlineDocuments: { listPages: vi.fn(async () => ({ workspaces: [] })) },
        source: sourceRecord("missing-online-document", {
          metadata: { providerKind: "online-document" },
        }),
      },
      {
        inventory: inventoryItem("missing-drive-file", "online-drive"),
        onlineDrive: { browse: vi.fn(async () => ({ buckets: [] })) },
        source: sourceRecord("missing-online-drive", {
          metadata: { providerKind: "online-drive" },
        }),
      },
    ];

    for (const scenario of scenarios) {
      const fixture = await createFixture({
        inventory: [scenario.inventory],
        ...(scenario.onlineDocuments ? { onlineDocuments: scenario.onlineDocuments } : {}),
        ...(scenario.onlineDrive ? { onlineDrive: scenario.onlineDrive } : {}),
        source: scenario.source,
      });

      await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
      expect(fixture.markRemoteMissing).toHaveBeenCalledWith(
        expect.objectContaining({ providerItemId: scenario.inventory.providerItemId }),
        expect.any(Object),
      );
    }
  });

  it("resumes a capability workflow without reading a legacy permission snapshot", async () => {
    const source = sourceRecord("capability-website", {
      permissionScope: ["team:camera"],
      type: "web",
    });
    const fixture = await createFixture({
      capability: true,
      inventory: [],
      source,
      websiteCrawl: {
        crawl: vi.fn(async () => ({
          pages: [
            {
              content: "capability content",
              sourceUrl: "https://example.test/capability",
              title: "Capability page",
            },
          ],
        })),
      },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(fixture.revalidatePermissionSnapshot).not.toHaveBeenCalled();
    expect(fixture.assertPublicationAllowed).toHaveBeenCalledWith({
      grantId: capabilityGrantId,
      knowledgeSpaceId,
      tenantId,
    });
    expect(fixture.publish).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId }),
      expect.any(Object),
    );
    const publication = fixture.publish.mock.calls[0]?.[0];
    expect(publication).not.toHaveProperty("permissionSnapshot");
    expect(publication).not.toHaveProperty("requestedBySubjectId");
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

  it("skips unchanged online-document revisions and retains remote-missing inventory", async () => {
    const unchangedBody = new TextEncoder().encode("unchanged body");
    const unchangedHash = createHash("sha256").update(unchangedBody).digest("hex");
    const source = sourceRecord("online-document-unchanged", {
      metadata: {
        providerId: "document-provider",
        providerKind: "online-document",
        remoteDeletionPolicy: "retain",
      },
    });
    const fixture = await createFixture({
      inventory: [
        { ...inventoryItem("page-same-etag", "online-document"), etag: "v1" },
        {
          ...inventoryItem("page-same-hash", "online-document"),
          contentHash: unchangedHash,
          etag: "v1",
        },
        {
          ...inventoryItem("page-without-etag", "online-document"),
          contentHash: unchangedHash,
        },
        inventoryItem("page-remote-missing", "online-document"),
      ],
      onlineDocuments: {
        getPageContent: vi.fn(async () => ({ content: new TextDecoder().decode(unchangedBody) })),
        listPages: vi.fn(async () => ({
          workspaces: [
            {
              pages: [
                {
                  lastEditedTime: "v1",
                  pageId: "page-same-etag",
                  pageName: "Same etag",
                  type: "page",
                },
                {
                  lastEditedTime: "v2",
                  pageId: "page-same-hash",
                  pageName: "Same hash",
                  type: "page",
                },
                {
                  pageId: "page-without-etag",
                  pageName: "Without etag",
                  type: "page",
                },
              ],
              workspaceId: "workspace-a",
            },
          ],
        })),
      },
      source,
      sourceProviders: {
        get: vi.fn(async () => ({
          available: false,
          capabilities: ["online-document", "online-drive"],
        })),
      },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(fixture.materializer.materialize).not.toHaveBeenCalled();
    expect(fixture.publish).not.toHaveBeenCalled();
    expect(fixture.markRemoteMissing).not.toHaveBeenCalled();
  });

  it("ignores drive folders and avoids rematerializing unchanged unbucketed files", async () => {
    const body = new TextEncoder().encode("same drive body");
    const source = sourceRecord("online-drive-unchanged", {
      metadata: { providerKind: "online-drive" },
    });
    const fixture = await createFixture({
      inventory: [
        {
          ...inventoryItem("same-file", "online-drive"),
          contentHash: createHash("sha256").update(body).digest("hex"),
        },
      ],
      onlineDrive: {
        browse: vi.fn(async () => ({
          buckets: [
            {
              files: [
                { id: "folder-a", name: "Folder", type: "folder" },
                { id: "same-file", name: "Same.bin", type: "file" },
              ],
              isTruncated: false,
            },
          ],
        })),
        download: vi.fn(async () => ({ body })),
      },
      source,
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(fixture.materializer.materialize).not.toHaveBeenCalled();
    expect(fixture.publish).not.toHaveBeenCalled();
  });

  it("fails closed for unavailable sync providers, result overflow, and missing tombstoning", async () => {
    const upload = await createFixture({
      inventory: [],
      source: sourceRecord("non-provider-upload", { type: "upload" }),
    });
    await expect(upload.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });

    const scenarios: readonly {
      readonly expectedCode: string;
      readonly fixture: Parameters<typeof createFixture>[0];
    }[] = [
      {
        expectedCode: "SOURCE_CRAWL_PROVIDER_UNAVAILABLE",
        fixture: { inventory: [], source: sourceRecord("web-unavailable", { type: "web" }) },
      },
      {
        expectedCode: "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        fixture: {
          inventory: [],
          maxSyncItems: 1,
          source: sourceRecord("web-overflow", { type: "web" }),
          websiteCrawl: {
            crawl: vi.fn(async () => ({
              pages: [
                { content: "A", sourceUrl: "https://example.test/a" },
                { content: "B", sourceUrl: "https://example.test/b" },
              ],
            })),
          },
        },
      },
      {
        expectedCode: "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
        fixture: {
          inventory: [],
          source: sourceRecord("document-unavailable", {
            metadata: { providerKind: "online-document" },
          }),
        },
      },
      {
        expectedCode: "SOURCE_ONLINE_DRIVE_UNAVAILABLE",
        fixture: {
          inventory: [],
          source: sourceRecord("drive-unavailable", {
            metadata: { providerKind: "online-drive" },
          }),
        },
      },
      {
        expectedCode: "SOURCE_CRAWL_PROVIDER_UNAVAILABLE",
        fixture: {
          inventory: [],
          source: sourceRecord("web-empty-response", { type: "web" }),
          websiteCrawl: { crawl: vi.fn(() => undefined as never) },
        },
      },
      {
        expectedCode: "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
        fixture: {
          inventory: [],
          onlineDocuments: { listPages: vi.fn(() => undefined as never) },
          source: sourceRecord("document-list-empty-response", {
            metadata: { providerKind: "online-document" },
          }),
        },
      },
      {
        expectedCode: "SOURCE_ONLINE_DRIVE_UNAVAILABLE",
        fixture: {
          inventory: [],
          onlineDrive: { browse: vi.fn(() => undefined as never) },
          source: sourceRecord("drive-list-empty-response", {
            metadata: { providerKind: "online-drive" },
          }),
        },
      },
      {
        expectedCode: "SOURCE_ONLINE_DOCUMENT_UNAVAILABLE",
        fixture: {
          inventory: [],
          onlineDocuments: {
            getPageContent: vi.fn(() => undefined as never),
            listPages: vi.fn(async () => ({
              workspaces: [
                {
                  pages: [{ pageId: "page-a", pageName: "Page A", type: "page" }],
                  workspaceId: "workspace-a",
                },
              ],
            })),
          },
          source: sourceRecord("document-content-empty-response", {
            metadata: { providerKind: "online-document" },
          }),
        },
      },
      {
        expectedCode: "SOURCE_ONLINE_DRIVE_UNAVAILABLE",
        fixture: {
          inventory: [],
          onlineDrive: {
            browse: vi.fn(async () => ({
              buckets: [
                {
                  files: [{ id: "file-a", name: "File A", type: "file" }],
                  isTruncated: false,
                },
              ],
            })),
            download: vi.fn(() => undefined as never),
          },
          source: sourceRecord("drive-content-empty-response", {
            metadata: { providerKind: "online-drive" },
          }),
        },
      },
      {
        expectedCode: "SOURCE_REMOTE_DELETION_UNAVAILABLE",
        fixture: {
          inventory: [inventoryItem("missing-website", "website")],
          omitMarkRemoteMissing: true,
          source: sourceRecord("tombstone-unavailable", { type: "web" }),
          websiteCrawl: { crawl: vi.fn(async () => ({ pages: [] })) },
        },
      },
    ];

    for (const scenario of scenarios) {
      const fixture = await createFixture(scenario.fixture);
      await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 0, failed: 1 });
      await expect(fixture.getRun()).resolves.toMatchObject({
        lastErrorCode: scenario.expectedCode,
        state: "failed",
      });
    }
  });

  it("tombstones capability-scoped remote-missing documents without legacy provenance", async () => {
    const fixture = await createFixture({
      capability: true,
      inventory: [inventoryItem("capability-missing", "website")],
      source: sourceRecord("capability-missing-source", {
        permissionScope: ["team:camera"],
        type: "web",
      }),
      websiteCrawl: { crawl: vi.fn(async () => ({ pages: [] })) },
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(fixture.markRemoteMissing).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId, providerItemId: "capability-missing" }),
      expect.any(Object),
    );
    const request = fixture.markRemoteMissing.mock.calls[0]?.[0];
    expect(request).not.toHaveProperty("permissionSnapshot");
    expect(request).not.toHaveProperty("requestedBySubjectId");
  });

  it("rejects ambiguous, duplicate, looping, and over-budget sync inventories", async () => {
    const onlineDocumentSource = sourceRecord("invalid-online-document-sync", {
      metadata: { providerKind: "online-document" },
    });
    const onlineDriveSource = sourceRecord("invalid-online-drive-sync", {
      metadata: { providerKind: "online-drive" },
    });
    const invalidProvenance = {
      ...inventoryItem("invalid-provenance", "online-document"),
      systemMetadata: {},
    };
    const scenarios: readonly {
      readonly expectedCode: string;
      readonly fixture: Parameters<typeof createFixture>[0];
    }[] = [
      {
        expectedCode: "SOURCE_SYNC_PROVIDER_KIND_MISSING",
        fixture: { inventory: [], source: sourceRecord("missing-provider-kind", {}) },
      },
      {
        expectedCode: "SOURCE_CONNECTION_UNAVAILABLE",
        fixture: {
          inventory: [],
          source: sourceRecord("missing-connection-resolver", { connectionId: "connection-a" }),
        },
      },
      {
        expectedCode: "SOURCE_SYNC_PROVIDER_KIND_MISSING",
        fixture: { inventory: [invalidProvenance], source: onlineDocumentSource },
      },
      {
        expectedCode: "SOURCE_SYNC_PROVIDER_KIND_CONFLICT",
        fixture: {
          inventory: [
            inventoryItem("mixed-document", "online-document"),
            inventoryItem("mixed-drive", "online-drive"),
          ],
          source: onlineDocumentSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_PROVIDER_KIND_CONFLICT",
        fixture: {
          inventory: [inventoryItem("stored-drive", "online-drive")],
          source: onlineDocumentSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_PROVIDER_IDENTITY_INVALID",
        fixture: {
          inventory: [],
          onlineDocuments: {
            listPages: vi.fn(async () => ({
              workspaces: [
                {
                  pages: [{ pageId: "page-a", pageName: "A", type: "page" }],
                  workspaceId: "",
                },
              ],
            })),
          },
          source: onlineDocumentSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_PROVIDER_IDENTITY_DUPLICATE",
        fixture: {
          inventory: [],
          logicalInventory: {
            listActiveBySource: vi.fn(async () => ({
              items: [
                inventoryItem("duplicate-logical", "online-document"),
                inventoryItem("duplicate-logical", "online-document"),
              ],
            })),
          },
          source: onlineDocumentSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        fixture: {
          inventory: [],
          logicalInventory: {
            listActiveBySource: vi.fn(async () => ({
              items: [inventoryItem("logical-page-a", "online-document")],
              nextCursor: { documentId: "document-a", providerItemId: "logical-page-a" },
            })),
          },
          maxSyncItems: 1,
          source: onlineDocumentSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_PROVIDER_IDENTITY_DUPLICATE",
        fixture: {
          inventory: [],
          onlineDocuments: {
            listPages: vi.fn(async () => ({
              workspaces: [
                {
                  pages: [
                    { pageId: "duplicate-page", pageName: "A", type: "page" },
                    { pageId: "duplicate-page", pageName: "B", type: "page" },
                  ],
                  workspaceId: "workspace-a",
                },
              ],
            })),
          },
          source: onlineDocumentSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        fixture: {
          inventory: [],
          maxSyncItems: 1,
          onlineDocuments: {
            listPages: vi.fn(async () => ({
              workspaces: [
                {
                  pages: [
                    { pageId: "page-a", pageName: "A", type: "page" },
                    { pageId: "page-b", pageName: "B", type: "page" },
                  ],
                  workspaceId: "workspace-a",
                },
              ],
            })),
          },
          source: onlineDocumentSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        fixture: {
          inventory: [],
          maxSyncItems: 1,
          onlineDocuments: {
            listPages: vi.fn(async () => ({
              nextCursor: "page-2",
              workspaces: [
                {
                  pages: [{ pageId: "page-a", pageName: "A", type: "page" }],
                  workspaceId: "workspace-a",
                },
              ],
            })),
          },
          source: onlineDocumentSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_CURSOR_LOOP",
        fixture: {
          inventory: [],
          onlineDocuments: {
            listPages: vi.fn(async () => ({ nextCursor: "same-cursor", workspaces: [] })),
          },
          source: onlineDocumentSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_CURSOR_LOOP",
        fixture: {
          inventory: [],
          onlineDrive: {
            browse: vi.fn(async () => ({
              buckets: [
                {
                  bucket: "bucket-a",
                  continuationToken: "same-token",
                  files: [],
                  isTruncated: true,
                },
              ],
            })),
          },
          source: onlineDriveSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_PROVIDER_IDENTITY_DUPLICATE",
        fixture: {
          inventory: [],
          onlineDrive: {
            browse: vi.fn(async () => ({
              buckets: [
                {
                  bucket: "bucket-a",
                  files: [
                    { id: "duplicate-file", name: "A", type: "file" },
                    { id: "duplicate-file", name: "B", type: "file" },
                  ],
                  isTruncated: false,
                },
              ],
            })),
          },
          source: onlineDriveSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        fixture: {
          inventory: [],
          maxSyncItems: 1,
          onlineDrive: {
            browse: vi.fn(async () => ({
              buckets: [
                {
                  files: [
                    { id: "file-a", name: "A", type: "file" },
                    { id: "file-b", name: "B", type: "file" },
                  ],
                  isTruncated: false,
                },
              ],
            })),
          },
          source: onlineDriveSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        fixture: {
          inventory: [],
          maxSyncItems: 1,
          onlineDrive: {
            browse: vi.fn(async () => ({
              buckets: [
                {
                  continuationToken: "page-2",
                  files: [{ id: "file-a", name: "A", type: "file" }],
                  isTruncated: true,
                },
              ],
            })),
          },
          source: onlineDriveSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_CURSOR_INVALID",
        fixture: {
          inventory: [],
          onlineDrive: {
            browse: vi.fn(async () => ({
              buckets: [{ bucket: "bucket-a", files: [], isTruncated: true }],
            })),
          },
          source: onlineDriveSource,
        },
      },
      {
        expectedCode: "SOURCE_SYNC_RESULT_LIMIT_EXCEEDED",
        fixture: {
          inventory: [],
          logicalInventory: {
            listActiveBySource: vi.fn(async () => ({
              items: [
                inventoryItem("over-budget-a", "online-document"),
                inventoryItem("over-budget-b", "online-document"),
              ],
            })),
          },
          maxSyncItems: 1,
          source: onlineDocumentSource,
        },
      },
    ];

    for (const scenario of scenarios) {
      const fixture = await createFixture(scenario.fixture);
      await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 0, failed: 1 });
      await expect(fixture.getRun()).resolves.toMatchObject({
        lastErrorCode: scenario.expectedCode,
        state: "failed",
      });
    }
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

describe("source-product workflow runtime bulk orchestration", () => {
  it("aggregates terminal items and isolates disable failures per source", async () => {
    const fixture = await createBulkFixture({
      disableSource: async (sourceId) => {
        if (sourceId === "disable-missing") return null;
        if (sourceId === "disable-not-writable") {
          throw new SourceWorkflowError(
            "SOURCE_WORKFLOW_SOURCE_NOT_WRITABLE",
            "Source is not writable",
          );
        }
        if (sourceId === "disable-error") throw new Error("provider failed");
        return sourceRecord(sourceId, { status: "disabled" });
      },
      getSource: (sourceId) => (sourceId === "source-missing" ? null : sourceRecord(sourceId, {})),
      items: [
        bulkItem("terminal-skipped", "disable", "skipped"),
        bulkItem("terminal-completed", "disable", "completed"),
        bulkItem("terminal-failed", "disable", "failed"),
        bulkItem("disable-success", "disable"),
        bulkItem("source-missing", "disable"),
        bulkItem("disable-missing", "disable"),
        bulkItem("disable-not-writable", "disable"),
        bulkItem("disable-error", "disable"),
        bulkItem("remove-unavailable", "remove"),
      ],
    });

    await expect(fixture.runtime.tick()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      deferred: 0,
      failed: 0,
      stale: 0,
    });
    await expect(fixture.getRun()).resolves.toMatchObject({
      progressCompleted: 2,
      progressFailed: 3,
      progressSkipped: 4,
      state: "completed",
    });
    expect(statusesBySource(await fixture.getItems())).toEqual({
      "disable-error": "failed",
      "disable-missing": "skipped",
      "disable-not-writable": "skipped",
      "disable-success": "completed",
      "remove-unavailable": "failed",
      "source-missing": "skipped",
      "terminal-completed": "completed",
      "terminal-failed": "failed",
      "terminal-skipped": "skipped",
    });
    expect(fixture.disableWithPermissionFence).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "disable-success",
        permissionFence: expect.objectContaining({
          permissionSnapshotId: "permission-bulk-runtime",
          requestedBySubjectId: "editor-source",
        }),
      }),
    );
  });

  it("defers sync children until completed, zero-result, failed, and canceled states settle", async () => {
    let clock = nowMs;
    const fixture = await createBulkFixture({
      clock: () => clock,
      items: [
        bulkItem("sync-completed", "sync"),
        bulkItem("sync-zero", "sync"),
        bulkItem("sync-failed", "sync"),
        bulkItem("sync-canceled", "sync"),
      ],
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ deferred: 1 });
    const children = await fixture.repository.claim({
      leaseExpiresAt: new Date(nowMs + 60_000).toISOString(),
      limit: 10,
      now: nowIso,
      workerId: "bulk-child-worker",
    });
    expect(children).toHaveLength(4);
    const childBySource = new Map(children.map((child) => [child.sourceId, child]));
    const completed = requiredMapValue(childBySource, "sync-completed");
    const zero = requiredMapValue(childBySource, "sync-zero");
    const failed = requiredMapValue(childBySource, "sync-failed");
    const canceled = requiredMapValue(childBySource, "sync-canceled");
    await fixture.repository.complete({
      fence: workflowFence(completed, "bulk-child-worker"),
      now: nowIso,
    });
    await fixture.repository.complete({
      fence: workflowFence(zero, "bulk-child-worker"),
      now: nowIso,
      state: "zero_results",
    });
    await fixture.repository.fail({
      errorCode: "PROVIDER_FAILED",
      errorMessage: "Provider failed",
      fence: workflowFence(failed, "bulk-child-worker"),
      now: nowIso,
    });
    const repositoryGet = fixture.repository.get.bind(fixture.repository);
    vi.spyOn(fixture.repository, "get").mockImplementation(async (request) => {
      const run = await repositoryGet(request);
      return run?.id === canceled.id
        ? { ...run, lastErrorCode: undefined, lastErrorMessage: undefined }
        : run;
    });

    clock = nowMs + 2_000;
    await expect(fixture.runtime.tick()).resolves.toMatchObject({ deferred: 1 });
    await fixture.repository.cancel({
      now: new Date(clock).toISOString(),
      reason: "Canceled by operator",
      runId: canceled.id,
    });

    clock = nowMs + 4_000;
    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, deferred: 0 });
    await expect(fixture.getRun()).resolves.toMatchObject({
      progressCompleted: 2,
      progressFailed: 2,
      state: "completed",
    });
    expect(statusesBySource(await fixture.getItems())).toEqual({
      "sync-canceled": "failed",
      "sync-completed": "completed",
      "sync-failed": "failed",
      "sync-zero": "completed",
    });
    expect(await fixture.getItems()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ errorCode: "PROVIDER_FAILED", sourceId: "sync-failed" }),
        expect.objectContaining({
          errorCode: "SOURCE_BULK_CHILD_CANCELED",
          sourceId: "sync-canceled",
        }),
      ]),
    );
  });

  it("binds capability-scoped deletion jobs and aggregates every terminal removal outcome", async () => {
    const pendingSources = new Set(["poll-success", "poll-failed", "poll-missing"]);
    let pollSuccessChecks = 0;
    const find = vi.fn(async ({ sourceId }: { readonly sourceId: string }) =>
      pendingSources.has(sourceId)
        ? { deletionJobId: `deletion-${sourceId}`, state: "pending" as const }
        : null,
    );
    const get = vi.fn(async ({ sourceId }: { readonly sourceId: string }) => {
      if (sourceId === "poll-success") {
        if (pollSuccessChecks++ === 0) {
          return { deletionJobId: "deletion-poll-success", state: "pending" as const };
        }
        return { deletionJobId: "deletion-poll-success", state: "succeeded" as const };
      }
      if (sourceId === "poll-failed") {
        return { deletionJobId: "deletion-poll-failed", state: "failed" as const };
      }
      return null;
    });
    const request = vi.fn(async ({ sourceId }: { readonly sourceId: string }) => {
      if (sourceId === "immediate-success") {
        return { deletionJobId: "deletion-immediate-success", state: "succeeded" as const };
      }
      if (sourceId === "immediate-failed") {
        return { deletionJobId: "deletion-immediate-failed", state: "failed" as const };
      }
      return null as never;
    });
    const fixture = await createBulkFixture({
      bulkRemoval: { find: find as never, get: get as never, request: request as never },
      bulkChildPollMs: 0,
      capability: true,
      getSource: (sourceId) => (sourceId === "source-missing" ? null : sourceRecord(sourceId, {})),
      items: [
        bulkItem("poll-success", "remove"),
        bulkItem("poll-failed", "remove"),
        bulkItem("poll-missing", "remove"),
        bulkItem("immediate-success", "remove"),
        bulkItem("immediate-failed", "remove"),
        bulkItem("request-missing", "remove"),
        bulkItem("source-missing", "remove"),
        bulkItem("capability-disable", "disable"),
      ],
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ deferred: 1 });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityGrantId,
        sourceId: "immediate-success",
      }),
    );
    expect(request.mock.calls[0]?.[0]).not.toHaveProperty("permissionFence");

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ deferred: 1 });
    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, deferred: 0 });
    await expect(fixture.getRun()).resolves.toMatchObject({
      progressCompleted: 3,
      progressFailed: 4,
      progressSkipped: 1,
      state: "completed",
    });
    expect(statusesBySource(await fixture.getItems())).toEqual({
      "capability-disable": "completed",
      "immediate-failed": "failed",
      "immediate-success": "completed",
      "poll-failed": "failed",
      "poll-missing": "failed",
      "poll-success": "completed",
      "request-missing": "failed",
      "source-missing": "skipped",
    });
  });

  it("fails malformed running child references without failing the parent runtime", async () => {
    const fixture = await createBulkFixture({
      bulkRemoval: {
        find: vi.fn(async () => null),
        get: vi.fn(async () => null),
        request: vi.fn(async () => ({ deletionJobId: "unused", state: "pending" as const })),
      },
      items: [
        bulkItem("remove-without-job", "remove", "running"),
        { ...bulkItem("remove-missing-job", "remove", "running"), deletionJobId: "missing" },
        bulkItem("sync-without-child", "sync", "running"),
        {
          ...bulkItem("sync-mismatched-child", "sync", "running"),
          childRunId: "mismatched-child",
        },
      ],
    });
    await fixture.repository.start({
      ...runRecord("different-source"),
      createdAt: new Date(nowMs + 60_000).toISOString(),
      id: "mismatched-child",
      idempotencyKey: "mismatched-child",
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    await expect(fixture.getRun()).resolves.toMatchObject({
      progressCompleted: 0,
      progressFailed: 4,
      state: "completed",
    });
    expect((await fixture.getItems()).map((item) => item.errorCode)).toEqual([
      "SOURCE_BULK_REMOVAL_JOB_NOT_FOUND",
      "SOURCE_BULK_REMOVAL_JOB_NOT_FOUND",
      "SOURCE_BULK_CHILD_NOT_FOUND",
      "SOURCE_BULK_CHILD_NOT_FOUND",
    ]);
  });

  it("paginates a large frozen item set and requests legacy removals with a permission fence", async () => {
    const request = vi.fn(async (_input: { readonly sourceId: string }) => ({
      deletionJobId: "deletion-legacy-removal",
      state: "succeeded" as const,
    }));
    const fixture = await createBulkFixture({
      bulkRemoval: {
        find: vi.fn(async () => null),
        get: vi.fn(async () => null),
        request,
      },
      items: [
        ...Array.from({ length: 100 }, (_, index) =>
          bulkItem(`terminal-${index.toString().padStart(3, "0")}`, "disable", "completed"),
        ),
        bulkItem("zz-legacy-removal", "remove"),
      ],
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    await expect(fixture.getRun()).resolves.toMatchObject({
      progressCompleted: 101,
      state: "completed",
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionFence: expect.objectContaining({
          permissionSnapshotId: "permission-bulk-runtime",
          requestedBySubjectId: "editor-source",
        }),
        sourceId: "zz-legacy-removal",
      }),
    );
    expect(request.mock.calls[0]?.[0]).not.toHaveProperty("capabilityGrantId");
  });
});

describe("source-product workflow runtime authorization and recovery", () => {
  it("fails closed for missing, revoked, and invalid permission provenance", async () => {
    const source = sourceRecord("permission-validation", { type: "web" });
    const scenarios: readonly Parameters<typeof createFixture>[0][] = [
      {
        inventory: [],
        run: capabilityRunRecord(source.id),
        source,
      },
      {
        capability: true,
        capabilityGrant: null,
        inventory: [],
        source,
      },
      {
        capability: true,
        capabilityGrant: {
          contentScopeIds: [],
          state: "revoked",
          subjectId: "editor-source",
        },
        inventory: [],
        source,
      },
      {
        capability: true,
        capabilityGrantError: new Error("grant was revoked"),
        inventory: [],
        source,
      },
      {
        inventory: [],
        run: { ...runRecord(source.id), accessChannel: undefined },
        source,
      },
      {
        inventory: [],
        permissionRevision: 2,
        source,
      },
      {
        inventory: [],
        permissionRole: "viewer",
        source,
      },
    ];

    for (const scenario of scenarios) {
      const crawl = vi.fn(async () => ({ pages: [] }));
      const fixture = await createFixture({ ...scenario, websiteCrawl: { crawl } });
      await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 0, failed: 1 });
      await expect(fixture.getRun()).resolves.toMatchObject({
        lastErrorCode: "SOURCE_WORKFLOW_PERMISSION_INVALID",
        state: "failed",
      });
      expect(crawl).not.toHaveBeenCalled();
    }
  });

  it("fails when a source disappears after validation and reports stale when failure fencing loses", async () => {
    const source = sourceRecord("disappearing-source", { type: "web" });
    const getSource = vi
      .fn(async (): Promise<Source | null> => source)
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(null);
    const disappeared = await createFixture({
      inventory: [],
      source,
      sources: { get: getSource } as never,
      websiteCrawl: { crawl: vi.fn(async () => ({ pages: [] })) },
    });

    await expect(disappeared.runtime.tick()).resolves.toMatchObject({ failed: 1, stale: 0 });
    await expect(disappeared.getRun()).resolves.toMatchObject({
      lastErrorCode: "SOURCE_NOT_FOUND",
      state: "failed",
    });

    const stale = await createFixture({ inventory: [], maxSyncItems: 0, source });
    vi.spyOn(stale.repository, "fail").mockRejectedValueOnce(new Error("fence lost"));
    await expect(stale.runtime.tick()).resolves.toMatchObject({ failed: 0, stale: 1 });
  });

  it("falls back to the claimed fence when deletion capture fails before execution starts", async () => {
    const fixture = await createFixture({
      deletionFence: {
        assertDeletionFenceUnchanged: vi.fn(async () => undefined),
        captureDeletionFence: vi.fn(async () => {
          throw new Error("space deletion raced the claim");
        }),
      },
      inventory: [],
      source: sourceRecord("deletion-race", { type: "web" }),
    });

    await expect(fixture.runtime.tick()).resolves.toMatchObject({ failed: 1, stale: 0 });
    await expect(fixture.getRun()).resolves.toMatchObject({ state: "failed" });
  });

  it("uses runtime defaults, resolves source credentials, and stops an active timer directly", async () => {
    const resolve = vi.fn(async ({ source }: { readonly source: Source }) => ({
      ...source,
      uri: "https://resolved.example.test",
    }));
    const fixture = await createFixture({
      inventory: [],
      source: sourceRecord("default-runtime", { type: "web" }),
      sourceCredentials: { resolve },
      useSystemClock: true,
      websiteCrawl: { crawl: vi.fn(async () => ({ pages: [] })) },
    });

    const stopHandle = fixture.runtime.start();
    await fixture.runtime.stop();
    await stopHandle();
    await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
    expect(resolve).toHaveBeenCalledOnce();
  });
});

async function createSelectedCrawlFixture(input: {
  readonly cleanupHasMore?: boolean | undefined;
  readonly contentAvailable?: boolean | undefined;
  readonly maxCleanupBatchesPerRun?: number | undefined;
}) {
  const body = new TextEncoder().encode("selected crawl body");
  const source = sourceRecord("selected-crawl", { type: "web" });
  const fixture = await createFixture({
    contentStore: {
      deleteRun: vi.fn(async () => ({
        deleted: 0,
        hasMore: input.cleanupHasMore ?? false,
      })),
      get: vi.fn(async () => (input.contentAvailable === false ? null : body)),
      put: vi.fn(async () => "staged/selected-crawl"),
    },
    inventory: [],
    maxCleanupBatchesPerRun: input.maxCleanupBatchesPerRun,
    run: providerRun(source.id, "crawl-preview", {}),
    source,
    websiteCrawl: {
      crawl: vi.fn(async () => ({
        pages: [
          {
            content: new TextDecoder().decode(body),
            sourceUrl: "https://example.test/selected-crawl",
            title: "Selected crawl",
          },
        ],
      })),
    },
  });
  await expect(fixture.runtime.tick()).resolves.toMatchObject({ completed: 1, failed: 0 });
  const staged = await fixture.repository.listCrawlPages({ limit: 10, runId: fixture.run.id });
  const page = staged.items[0];
  if (!page) throw new Error("crawl preview was not staged");
  await fixture.repository.selectCrawlPages({
    accessChannel: "interactive",
    idempotencyKey: `select-${fixture.run.id}`,
    now: nowIso,
    pageIds: [page.pageId],
    permissionSnapshotId: "permission-source",
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "editor-source",
    runId: fixture.run.id,
  });
  return fixture;
}

async function createFixture(input: {
  readonly capability?: boolean | undefined;
  readonly capabilityGrant?:
    | {
        readonly contentScopeIds: readonly string[];
        readonly state: "active" | "revoked";
        readonly subjectId: string;
      }
    | null
    | undefined;
  readonly capabilityGrantError?: Error | undefined;
  readonly clock?: (() => number) | undefined;
  readonly contentStore?: Parameters<typeof createSourceProductWorkflowRuntime>[0]["contentStore"];
  readonly deletionFence?: Parameters<
    typeof createSourceProductWorkflowRuntime
  >[0]["deletionFence"];
  readonly externalOperationTimeoutMs?: number | undefined;
  readonly inventory: readonly SourceActiveDocumentInventoryItem[];
  readonly intervalMs?: number | undefined;
  readonly logicalInventory?: Parameters<
    typeof createSourceProductWorkflowRuntime
  >[0]["logicalInventory"];
  readonly materializer?: SourceDocumentMaterializer | undefined;
  readonly maxCleanupBatchesPerRun?: number | undefined;
  readonly maxCrawlPages?: number | undefined;
  readonly maxSyncItems?: number | undefined;
  readonly onlineDocuments?: object | undefined;
  readonly onlineDrive?: object | undefined;
  readonly omitMarkRemoteMissing?: boolean | undefined;
  readonly permissionRevision?: number | undefined;
  readonly permissionRole?: "owner" | "editor" | "viewer" | undefined;
  readonly permissionScopes?: readonly string[] | undefined;
  readonly publishError?: Error | undefined;
  readonly publishKind?: "activated" | "unchanged" | undefined;
  readonly requiredPermissionScope?: readonly string[] | undefined;
  readonly run?: NewSourceWorkflowRun | undefined;
  readonly source: Source;
  readonly sourceConnections?: object | undefined;
  readonly sourceCredentials?: object | undefined;
  readonly sourceProviders?: object | undefined;
  readonly sources?: Parameters<typeof createSourceProductWorkflowRuntime>[0]["sources"];
  readonly startClaimed?: boolean | undefined;
  readonly useSystemClock?: boolean | undefined;
  readonly websiteCrawl?: object | undefined;
}) {
  let assetSequence = 0;
  const repository = createInMemorySourceProductWorkflowRepository({
    generateLeaseToken: () => `lease-${++assetSequence}`,
  });
  const run = await repository.start(
    input.run ??
      (input.capability
        ? capabilityRunRecord(input.source.id)
        : {
            ...runRecord(input.source.id),
            requiredPermissionScope: input.requiredPermissionScope ?? [],
          }),
  );
  const publish = vi.fn(async (_request: PublishSourceLogicalRevisionInput) => {
    if (input.publishError) throw input.publishError;
    return {
      documentId: `logical-${assetSequence}`,
      kind: input.publishKind ?? "activated",
      revision: 1,
    };
  });
  const markRemoteMissing = vi.fn(async (_request: unknown) => undefined);
  const revalidatePermissionSnapshot = vi.fn(
    async () =>
      ({
        permissionScopes: input.permissionScopes ?? [],
        revision: input.permissionRevision ?? 1,
        role: input.permissionRole ?? "editor",
      }) as never,
  );
  const assertPublicationAllowed = vi.fn(async () => {
    if (input.capabilityGrantError) throw input.capabilityGrantError;
  });
  const getCapabilityGrant = vi.fn(async () =>
    input.capabilityGrant === undefined
      ? ({
          contentScopeIds: ["team:camera"],
          state: "active",
          subjectId: "editor-source",
        } as const)
      : input.capabilityGrant,
  );
  const materializer = input.materializer ?? {
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
  };
  const runtime = createSourceProductWorkflowRuntime({
    access: {
      revalidatePermissionSnapshot,
    },
    ...(input.capability
      ? {
          capabilityGrants: {
            assertPublicationAllowed,
            get: getCapabilityGrant as never,
          },
        }
      : {}),
    contentStore: input.contentStore ?? ({} as never),
    deletionFence: input.deletionFence ?? {
      assertDeletionFenceUnchanged: vi.fn(async () => undefined),
      captureDeletionFence: vi.fn(async (scope) => ({ scope }) as never),
    },
    logicalInventory: input.logicalInventory ?? {
      listActiveBySource: vi.fn(async () => ({ items: [...input.inventory] })),
    },
    ...(input.externalOperationTimeoutMs
      ? { externalOperationTimeoutMs: input.externalOperationTimeoutMs }
      : {}),
    ...(input.intervalMs !== undefined ? { intervalMs: input.intervalMs } : {}),
    logicalRevisions: {
      ...(input.omitMarkRemoteMissing ? {} : { markRemoteMissing }),
      publish,
    },
    materializer,
    ...(input.maxCleanupBatchesPerRun !== undefined
      ? { maxCleanupBatchesPerRun: input.maxCleanupBatchesPerRun }
      : {}),
    ...(input.maxCrawlPages !== undefined ? { maxCrawlPages: input.maxCrawlPages } : {}),
    ...(input.maxSyncItems !== undefined ? { maxSyncItems: input.maxSyncItems } : {}),
    ...(input.useSystemClock ? {} : { now: input.clock ?? (() => nowMs) }),
    ...(input.onlineDocuments ? { onlineDocuments: input.onlineDocuments as never } : {}),
    ...(input.onlineDrive ? { onlineDrive: input.onlineDrive as never } : {}),
    repository,
    ...(input.sourceConnections ? { sourceConnections: input.sourceConnections as never } : {}),
    ...(input.sourceCredentials ? { sourceCredentials: input.sourceCredentials as never } : {}),
    ...(input.sourceProviders ? { sourceProviders: input.sourceProviders as never } : {}),
    sources: input.sources ?? ({ get: vi.fn(async () => input.source) } as never),
    ...(input.websiteCrawl ? { websiteCrawl: input.websiteCrawl as never } : {}),
    workerId: "source-runtime-worker",
  });
  return {
    assertPublicationAllowed,
    getRun: () => repository.get({ knowledgeSpaceId, runId: run.id, tenantId }),
    getCapabilityGrant,
    markRemoteMissing,
    materializer,
    publish,
    revalidatePermissionSnapshot,
    repository,
    run,
    runtime,
  };
}

async function createBulkFixture(input: {
  readonly bulkRemoval?: Parameters<typeof createSourceProductWorkflowRuntime>[0]["bulkRemoval"];
  readonly bulkChildPollMs?: number | undefined;
  readonly capability?: boolean | undefined;
  readonly clock?: (() => number) | undefined;
  readonly disableSource?: ((sourceId: string) => Promise<Source | null>) | undefined;
  readonly getSource?: ((sourceId: string) => Source | null) | undefined;
  readonly items: readonly Omit<SourceBulkWorkflowItem, "runId" | "updatedAt">[];
}) {
  let leaseSequence = 0;
  const repository = createInMemorySourceProductWorkflowRepository({
    generateLeaseToken: () => `bulk-lease-${++leaseSequence}`,
  });
  const runId = "run-bulk-runtime";
  const run: NewSourceWorkflowRun = input.capability
    ? {
        capabilityGrantId,
        createdAt: nowIso,
        id: runId,
        idempotencyKey: runId,
        knowledgeSpaceId,
        kind: "bulk",
        maxExecutionAttempts: 5,
        payload: {},
        progressTotal: input.items.length,
        tenantId,
      }
    : {
        accessChannel: "interactive",
        createdAt: nowIso,
        id: runId,
        idempotencyKey: runId,
        knowledgeSpaceId,
        kind: "bulk",
        maxExecutionAttempts: 5,
        payload: {},
        permissionSnapshotId: "permission-bulk-runtime",
        permissionSnapshotRevision: 1,
        progressTotal: input.items.length,
        requestedBySubjectId: "editor-source",
        requiredPermissionScope: [],
        tenantId,
      };
  await repository.startBulk({
    items: input.items.map((item) => ({ ...item, runId, updatedAt: nowIso })),
    run,
  });
  const getSource = vi.fn(async ({ id }: { readonly id: string }) =>
    input.getSource ? input.getSource(id) : sourceRecord(id, {}),
  );
  const disableWithPermissionFence = vi.fn(async ({ id }: { readonly id: string }) =>
    input.disableSource ? input.disableSource(id) : sourceRecord(id, { status: "disabled" }),
  );
  const runtime = createSourceProductWorkflowRuntime({
    access: {
      revalidatePermissionSnapshot: vi.fn(
        async () => ({ permissionScopes: [], revision: 1, role: "editor" }) as never,
      ),
    },
    ...(input.bulkRemoval ? { bulkRemoval: input.bulkRemoval } : {}),
    bulkChildPollMs: input.bulkChildPollMs ?? 1_000,
    claimBatchSize: 1,
    ...(input.capability
      ? {
          capabilityGrants: {
            assertPublicationAllowed: vi.fn(async () => undefined),
            get: vi.fn(
              async () =>
                ({
                  contentScopeIds: [],
                  state: "active",
                  subjectId: "editor-source",
                }) as never,
            ),
          },
        }
      : {}),
    contentStore: {} as never,
    deletionFence: {
      assertDeletionFenceUnchanged: vi.fn(async () => undefined),
      captureDeletionFence: vi.fn(async (scope) => ({ scope }) as never),
    },
    logicalInventory: {} as never,
    logicalRevisions: {} as never,
    materializer: {} as never,
    ...(input.clock ? { now: input.clock } : {}),
    repository,
    sources: { disableWithPermissionFence, get: getSource } as never,
    workerId: "bulk-runtime-worker",
  });
  return {
    disableWithPermissionFence,
    getItems: async () => (await repository.listBulkItems({ limit: 100, runId })).items,
    getRun: () => repository.get({ knowledgeSpaceId, runId, tenantId }),
    repository,
    runtime,
  };
}

function fakeObjectStorage(input: {
  readonly listResults?: Awaited<ReturnType<ObjectStorageAdapter["listObjects"]>>[];
  readonly storedBody: Uint8Array | null;
}) {
  const listResults = [...(input.listResults ?? [])];
  return {
    kind: "memory" as const,
    deleteObject: vi.fn(async (_key: string) => undefined),
    getObject: vi.fn(async (_key: string) => input.storedBody),
    getObjectStream: vi.fn(async (_key: string) => null),
    health: vi.fn(async () => true),
    headObject: vi.fn(async (_key: string) => null),
    listObjects: vi.fn(
      async (_request: Parameters<ObjectStorageAdapter["listObjects"]>[0]) =>
        listResults.shift() ?? { objects: [] },
    ),
    putObject: vi.fn(
      async ({ body, key, metadata }: Parameters<ObjectStorageAdapter["putObject"]>[0]) => ({
        key,
        metadata: metadata ?? {},
        sizeBytes: body.byteLength,
      }),
    ),
  } satisfies ObjectStorageAdapter;
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

function providerRun(
  sourceId: string,
  kind: NewSourceWorkflowRun["kind"],
  payload: NewSourceWorkflowRun["payload"],
): NewSourceWorkflowRun {
  return {
    ...runRecord(sourceId),
    id: `run-${kind}-${sourceId}`,
    idempotencyKey: `${kind}-${sourceId}`,
    kind,
    payload,
  };
}

function bulkItem(
  sourceId: string,
  action: SourceBulkWorkflowItem["action"],
  status: SourceBulkWorkflowItem["status"] = "eligible",
): Omit<SourceBulkWorkflowItem, "runId" | "updatedAt"> {
  return {
    action,
    id: `item-${sourceId}`,
    sourceId,
    status,
  };
}

function statusesBySource(
  items: readonly SourceBulkWorkflowItem[],
): Record<string, SourceBulkWorkflowItem["status"]> {
  return Object.fromEntries(items.map((item) => [item.sourceId, item.status]));
}

function requiredMapValue<K, V>(values: ReadonlyMap<K, V>, key: K): V {
  const value = values.get(key);
  if (!value) throw new Error(`Missing map value for ${String(key)}`);
  return value;
}

function capabilityRunRecord(sourceId: string): NewSourceWorkflowRun {
  return {
    capabilityGrantId,
    createdAt: nowIso,
    id: `run-${sourceId}`,
    idempotencyKey: `sync-${sourceId}`,
    knowledgeSpaceId,
    kind: "sync",
    maxExecutionAttempts: 5,
    payload: {},
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
