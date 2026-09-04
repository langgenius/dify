import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryNamespaceSourcePreviewRepository,
  createNamespaceSourcePreviewService,
} from "./namespace-source-preview";

describe("namespace website source preview", () => {
  it("stores content in KFS and consumes only selected page ids", async () => {
    const objects = new Map<string, Uint8Array>();
    const createCrawlImport = vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222" }));
    const service = createNamespaceSourcePreviewService({
      repository: createInMemoryNamespaceSourcePreviewRepository(),
      storage: {
        putObject: vi.fn(async ({ key, body }) => {
          objects.set(key, body);
        }),
        getObject: vi.fn(async (key) => objects.get(key) ?? null),
        deleteObject: vi.fn(async (key) => {
          objects.delete(key);
        }),
        listObjects: vi.fn(async ({ prefix }) => ({
          objects: [...objects.keys()]
            .filter((key) => key.startsWith(prefix))
            .map((key) => ({ key })),
        })),
      } as never,
      websiteCrawl: {
        crawl: vi.fn(async () => ({
          pages: [{ sourceUrl: "https://example.com/a", title: "A", content: "large body" }],
        })),
      },
      workflows: { createCrawlImport } as never,
      sources: {
        get: vi.fn(async () => ({
          type: "web",
          metadata: {
            credentialId: "credential",
            pluginId: "plugin",
            provider: "firecrawl",
            datasource: "crawl",
            initialPreview: { configurationFingerprint: "f".repeat(64) },
          },
        })),
      } as never,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const subject = { tenantId: "tenant", subjectId: "account", scopes: [] };
    const job = await service.create(
      subject,
      {
        credentialId: "credential",
        pluginId: "plugin",
        provider: "firecrawl",
        datasource: "crawl",
        parameters: { url: "https://example.com" },
        rootUrl: "https://example.com",
      },
      "f".repeat(64),
    );
    expect(await service.tick()).toBe(true);
    const [page] = await service.pages(subject, job.id);
    expect(page).toMatchObject({ sourceUrl: "https://example.com/a" });
    if (!page) throw new Error("Expected a preview page");

    const workflowId = await service.consume(subject, {
      jobId: job.id,
      pageIds: [page.pageId],
      configurationFingerprint: "f".repeat(64),
      knowledgeSpaceId: "11111111-1111-4111-8111-111111111111",
      sourceId: "33333333-3333-4333-8333-333333333333",
      idempotencyKey: "request:crawl-import",
    });

    expect(workflowId).toBe("22222222-2222-4222-8222-222222222222");
    expect(createCrawlImport).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrls: ["https://example.com/a"],
        pages: [{ sourceUrl: "https://example.com/a", title: "A", content: "large body" }],
      }),
    );
    expect(JSON.stringify(createCrawlImport.mock.calls[0])).toContain("large body");
    expect(objects.size).toBe(0);
  });

  it("rejects a page larger than the configured per-page limit", async () => {
    const objects = new Map<string, Uint8Array>();
    const repository = createInMemoryNamespaceSourcePreviewRepository();
    const service = createNamespaceSourcePreviewService({
      repository,
      storage: memoryStorage(objects) as never,
      websiteCrawl: crawlPages([{ sourceUrl: "https://example.com/large", content: "12345" }]),
      workflows: {} as never,
      sources: {} as never,
      maxPageBytes: 4,
      maxJobBytes: 10,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const { subject, job } = await createJob(service);

    await service.tick();

    await expect(service.get(subject, job.id)).resolves.toMatchObject({
      status: "failed",
      errorCode: "PREVIEW_PAGE_TOO_LARGE",
    });
    expect(objects.size).toBe(0);
  });

  it("rejects a preview whose aggregate content exceeds the job limit", async () => {
    const objects = new Map<string, Uint8Array>();
    const repository = createInMemoryNamespaceSourcePreviewRepository();
    const service = createNamespaceSourcePreviewService({
      repository,
      storage: memoryStorage(objects) as never,
      websiteCrawl: crawlPages([
        { sourceUrl: "https://example.com/a", content: "123" },
        { sourceUrl: "https://example.com/b", content: "456" },
      ]),
      workflows: {} as never,
      sources: {} as never,
      maxPageBytes: 4,
      maxJobBytes: 5,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const { subject, job } = await createJob(service);

    await service.tick();

    await expect(service.get(subject, job.id)).resolves.toMatchObject({
      status: "failed",
      errorCode: "PREVIEW_JOB_TOO_LARGE",
    });
    expect(objects.size).toBe(0);
  });

  it("retries object cleanup after preview metadata persistence fails", async () => {
    const objects = new Map<string, Uint8Array>();
    const base = createInMemoryNamespaceSourcePreviewRepository();
    const repository = {
      ...base,
      complete: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };
    let deleteFailures = 2;
    const storage = memoryStorage(objects);
    storage.deleteObject = vi.fn(async (key: string) => {
      if (deleteFailures-- > 0) throw new Error("storage unavailable");
      objects.delete(key);
    });
    const service = createNamespaceSourcePreviewService({
      repository,
      storage: storage as never,
      websiteCrawl: crawlPages([{ sourceUrl: "https://example.com/a", content: "body" }]),
      workflows: {} as never,
      sources: {} as never,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const { subject, job } = await createJob(service);

    await service.tick();
    expect(objects.size).toBe(1);
    await expect(service.get(subject, job.id)).resolves.toMatchObject({ status: "failed" });

    await service.tick();
    expect(objects.size).toBe(0);
    await expect(service.get(subject, job.id)).resolves.toMatchObject({
      contentCleanedAt: "2026-09-04T00:00:00.000Z",
    });
  });
});

function memoryStorage(objects: Map<string, Uint8Array>) {
  return {
    putObject: vi.fn(async ({ key, body }: { key: string; body: Uint8Array }) => {
      objects.set(key, body);
    }),
    getObject: vi.fn(async (key: string) => objects.get(key) ?? null),
    deleteObject: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
    listObjects: vi.fn(async ({ prefix }: { prefix: string }) => ({
      objects: [...objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
    })),
  };
}

function crawlPages(pages: Array<{ sourceUrl: string; content: string }>) {
  return { crawl: vi.fn(async () => ({ pages })) } as never;
}

async function createJob(service: ReturnType<typeof createNamespaceSourcePreviewService>) {
  const subject = { tenantId: "tenant", subjectId: "account", scopes: [] };
  const job = await service.create(
    subject,
    {
      credentialId: "credential",
      pluginId: "plugin",
      provider: "firecrawl",
      datasource: "crawl",
      parameters: {},
      rootUrl: "https://example.com",
    },
    "f".repeat(64),
  );
  return { subject, job };
}
