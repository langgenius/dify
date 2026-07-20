import { describe, expect, it } from "vitest";

import type { OnlineDocumentConnector } from "./online-document-connector";
import type { OnlineDriveConnector } from "./online-drive-connector";
import type { SourceDocumentMaterializer } from "./source-document-materializer";
import { SOURCE_OPERATION_FAILURES } from "./source-operation-error";
import { createInMemorySourceRepository } from "./source-repository";
import { createSourceSyncRunner } from "./source-sync-runner";
import type { WebsiteCrawlConnector } from "./website-crawl-connector";

const SPACE = "10000000-0000-4000-8000-000000000001";

function repositoryWith() {
  return createInMemorySourceRepository({ maxSources: 10, now: () => "2026-07-08T00:00:00.000Z" });
}

function fakeMaterializer(): SourceDocumentMaterializer & { calls: unknown[] } {
  const calls: unknown[] = [];

  return {
    calls,
    compensate: async () => undefined,
    materialize: async (input) => {
      calls.push(input);

      return {
        documents: input.documents.map((document, index) => ({
          documentAssetId: `doc-${index}`,
          documentAssetVersion: 1,
          filename: document.filename,
          mimeType: document.mimeType,
          sizeBytes: document.body.byteLength,
        })),
        failed: [],
      };
    },
  };
}

describe("createSourceSyncRunner", () => {
  it("re-runs the crawl for web sources and records the sync summary", async () => {
    const sources = repositoryWith();
    const source = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { syncPolicy: { everyHours: 24 }, tenantId: "tenant-1" },
      name: "Docs crawl",
      permissionScope: ["team:security"],
      type: "web",
      uri: "https://example.com",
    });
    const materializer = fakeMaterializer();
    const runner = createSourceSyncRunner({
      sourceDocumentMaterializer: materializer,
      sources,
      websiteCrawlConnector: {
        crawl: async () => ({
          completed: 2,
          pages: [
            { content: "one", sourceUrl: "https://example.com/a", title: "A" },
            { content: "two", sourceUrl: "https://example.com/b", title: "B" },
          ],
          status: "completed",
          total: 2,
        }),
      } as unknown as WebsiteCrawlConnector,
    });

    const outcome = await runner.sync({ source, tenantId: "tenant-1", userId: "scheduler" });

    expect(outcome).toEqual({ failed: 0, imported: 2, kind: "website-crawl", skipped: 0 });
    expect(materializer.calls).toEqual([
      expect.objectContaining({ permissionScope: ["team:security"] }),
    ]);
    const updated = await sources.get({ id: source.id, knowledgeSpaceId: SPACE });
    expect(updated?.status).toBe("active");
    expect(updated?.metadata.sync).toMatchObject({ imported: 2, pageCount: 2, skipped: 0 });

    // Re-sync with identical content: everything dedupes by content hash.
    const again = await runner.sync({
      source: updated as NonNullable<typeof updated>,
      tenantId: "tenant-1",
      userId: "scheduler",
    });
    expect(again).toEqual({ failed: 0, imported: 0, kind: "website-crawl", skipped: 2 });
  });

  it("skips unchanged pages and fails changed pages before fetch or materialization", async () => {
    const sources = repositoryWith();
    const source = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: {
        datasource: "notion",
        imported: {
          "page-changed": { documentAssetId: "old-1", lastEditedTime: "t1" },
          "page-same": { documentAssetId: "old-2", lastEditedTime: "t2" },
        },
        pluginId: "p",
        provider: "notion",
        tenantId: "tenant-1",
      },
      name: "Notion",
      type: "connector",
      uri: "workspace-1",
    });
    const fetched: string[] = [];
    const materializer = fakeMaterializer();
    const runner = createSourceSyncRunner({
      onlineDocumentConnector: {
        getPageContent: async ({ page }: { page: { pageId: string } }) => {
          fetched.push(page.pageId);

          return { content: `content of ${page.pageId}` };
        },
        listPages: async () => ({
          workspaces: [
            {
              pages: [
                {
                  lastEditedTime: "t1-new",
                  pageId: "page-changed",
                  pageName: "Changed",
                  type: "page",
                },
                { lastEditedTime: "t2", pageId: "page-same", pageName: "Same", type: "page" },
                {
                  lastEditedTime: "t3",
                  pageId: "page-never-imported",
                  pageName: "New",
                  type: "page",
                },
              ],
              workspaceId: "workspace-1",
            },
          ],
        }),
      } as unknown as OnlineDocumentConnector,
      sourceDocumentMaterializer: materializer,
      sources,
    });

    const outcome = await runner.sync({ source, tenantId: "tenant-1", userId: "scheduler" });

    expect(outcome).toEqual({ failed: 1, imported: 0, kind: "online-document", skipped: 1 });
    expect(fetched).toEqual([]);
    expect(materializer.calls).toEqual([]);
    const updated = await sources.get({ id: source.id, knowledgeSpaceId: SPACE });
    expect(updated?.status).toBe("active");
    const imported = updated?.metadata.imported as Record<string, { lastEditedTime?: string }>;
    expect(imported["page-changed"]?.lastEditedTime).toBe("t1");
    expect(imported["page-same"]?.lastEditedTime).toBe("t2");
    expect(imported["page-never-imported"]).toBeUndefined();
    expect(updated?.metadata.sync).toMatchObject({
      failed: 1,
      failures: [expect.objectContaining({ code: "SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED" })],
    });
  });

  it("fails recorded drive files before download when no provider version is available", async () => {
    const sources = repositoryWith();
    const source = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: {
        importedFiles: { "file-1": { bucket: "b", mimeType: "application/pdf", name: "a.pdf" } },
        tenantId: "tenant-1",
      },
      name: "Drive",
      type: "connector",
      uri: "bucket-b",
    });
    const downloaded: string[] = [];
    const runner = createSourceSyncRunner({
      onlineDriveConnector: {
        download: async ({ file }: { file: { id: string } }) => {
          downloaded.push(file.id);

          return { body: new Uint8Array([1, 2, 3]) };
        },
      } as unknown as OnlineDriveConnector,
      sourceDocumentMaterializer: fakeMaterializer(),
      sources,
    });

    const outcome = await runner.sync({ source, tenantId: "tenant-1", userId: "scheduler" });

    expect(outcome).toEqual({ failed: 1, imported: 0, kind: "online-drive", skipped: 0 });
    expect(downloaded).toEqual([]);
    const updated = await sources.get({ id: source.id, knowledgeSpaceId: SPACE });
    expect(updated?.metadata.sync).toMatchObject({
      failed: 1,
      failures: [expect.objectContaining({ code: "SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED" })],
    });
  });

  it("resolves to kind none when a connector source has nothing imported", async () => {
    const sources = repositoryWith();
    const source = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { tenantId: "tenant-1" },
      name: "Empty connector",
      type: "connector",
      uri: "workspace-1",
    });
    const runner = createSourceSyncRunner({ sources });

    await expect(
      runner.sync({ source, tenantId: "tenant-1", userId: "scheduler" }),
    ).resolves.toEqual({ failed: 0, imported: 0, kind: "none", skipped: 0 });
  });

  it("marks the source error and rethrows on hard sync failures", async () => {
    const sources = repositoryWith();
    const source = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { tenantId: "tenant-1" },
      name: "Broken crawl",
      type: "web",
      uri: "https://example.com",
    });
    const runner = createSourceSyncRunner({
      sourceDocumentMaterializer: fakeMaterializer(),
      sources,
      websiteCrawlConnector: {
        crawl: async () => {
          throw new Error("upstream 502 credential-secret");
        },
      } as unknown as WebsiteCrawlConnector,
    });

    await expect(
      runner.sync({ source, tenantId: "tenant-1", userId: "scheduler" }),
    ).rejects.toThrow("upstream 502 credential-secret");
    const updated = await sources.get({ id: source.id, knowledgeSpaceId: SPACE });
    expect(updated?.status).toBe("error");
    expect(updated?.metadata.sync).toEqual({
      error: SOURCE_OPERATION_FAILURES.sync.message,
      errorCode: SOURCE_OPERATION_FAILURES.sync.code,
    });
    expect(JSON.stringify(updated?.metadata)).not.toContain("credential-secret");
  });

  it("resolves to kind none when connectors or the materializer are missing", async () => {
    const sources = repositoryWith();
    const web = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { tenantId: "tenant-1" },
      name: "Web without connector",
      type: "web",
      uri: "https://example.com",
    });
    const pages = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { imported: { "p-1": { documentAssetId: "d-1" } }, tenantId: "tenant-1" },
      name: "Pages without connector",
      type: "connector",
      uri: "workspace-1",
    });
    const upload = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { tenantId: "tenant-1" },
      name: "Uploads",
      type: "upload",
      uri: "manual",
    });
    const runner = createSourceSyncRunner({ sources });

    for (const source of [web, pages, upload]) {
      await expect(
        runner.sync({ source, tenantId: "tenant-1", userId: "scheduler" }),
      ).resolves.toEqual({ failed: 0, imported: 0, kind: "none", skipped: 0 });
    }
  });

  it("reports per-page and per-file replacement guards without calling connectors", async () => {
    const sources = repositoryWith();
    const pageSource = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: {
        imported: { "page-a": { documentAssetId: "old-a", lastEditedTime: "t0" } },
        tenantId: "tenant-1",
      },
      name: "Notion",
      type: "connector",
      uri: "workspace-1",
    });
    const materializer = fakeMaterializer();
    const pageRunner = createSourceSyncRunner({
      onlineDocumentConnector: {
        getPageContent: async () => {
          throw new Error("page fetch failed");
        },
        listPages: async () => ({
          workspaces: [
            {
              pages: [{ lastEditedTime: "t1", pageId: "page-a", pageName: "A", type: "page" }],
              workspaceId: "workspace-1",
            },
          ],
        }),
      } as unknown as OnlineDocumentConnector,
      sourceDocumentMaterializer: materializer,
      sources,
    });
    await expect(
      pageRunner.sync({ source: pageSource, tenantId: "tenant-1", userId: "scheduler" }),
    ).resolves.toEqual({ failed: 1, imported: 0, kind: "online-document", skipped: 0 });

    const driveSource = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: {
        importedFiles: { "file-1": { name: "a.pdf" } },
        tenantId: "tenant-1",
      },
      name: "Drive",
      type: "connector",
      uri: "bucket",
    });
    const driveRunner = createSourceSyncRunner({
      onlineDriveConnector: {
        download: async () => {
          throw new Error("download failed");
        },
      } as unknown as OnlineDriveConnector,
      sourceDocumentMaterializer: fakeMaterializer(),
      sources,
    });
    await expect(
      driveRunner.sync({ source: driveSource, tenantId: "tenant-1", userId: "scheduler" }),
    ).resolves.toEqual({ failed: 1, imported: 0, kind: "online-drive", skipped: 0 });
  });

  it("skips a stale runner claim by exact source version without overwriting the fresh row", async () => {
    const sources = repositoryWith();
    const stale = await sources.create({
      knowledgeSpaceId: SPACE,
      metadata: { tenantId: "tenant-1" },
      name: "Stale crawl",
      type: "web",
      uri: "https://example.com",
    });
    await sources.update({
      expectedVersion: stale.version,
      id: stale.id,
      knowledgeSpaceId: SPACE,
      metadata: { tenantId: "tenant-1", credentialRevision: 2 },
    });
    let crawled = false;
    const runner = createSourceSyncRunner({
      sourceDocumentMaterializer: fakeMaterializer(),
      sources,
      websiteCrawlConnector: {
        crawl: async () => {
          crawled = true;
          return { pages: [] };
        },
      } as unknown as WebsiteCrawlConnector,
    });

    await expect(
      runner.sync({ source: stale, tenantId: "tenant-1", userId: "scheduler" }),
    ).resolves.toEqual({ failed: 0, imported: 0, kind: "none", skipped: 0 });
    expect(crawled).toBe(false);
    await expect(sources.get({ id: stale.id, knowledgeSpaceId: SPACE })).resolves.toMatchObject({
      metadata: { credentialRevision: 2 },
      status: "active",
      version: stale.version + 1,
    });
  });
});
