import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryNamespaceSourcePreviewRepository,
  createNamespaceSourcePreviewRuntime,
  createNamespaceSourcePreviewService,
} from "./namespace-source-preview";

describe("namespace website source preview", () => {
  it("stores content in KFS and consumes only selected page ids", async () => {
    const objects = new Map<string, Uint8Array>();
    const createCrawlImport = vi.fn(async () => ({ id: "22222222-2222-4222-8222-222222222222" }));
    const findCrawlImportByIdempotency = vi.fn(async () => null);
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
      workflows: { createCrawlImport, findCrawlImportByIdempotency } as never,
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

    const workflowId = await service.consume(
      {
        callerKind: "interactive",
        capability: {
          contentScopeIds: ["tenant:tenant", "source:preview"],
          grantId: "preview-grant",
        },
        subject,
      },
      {
        jobId: job.id,
        pageIds: [page.pageId],
        configurationFingerprint: "f".repeat(64),
        knowledgeSpaceId: "11111111-1111-4111-8111-111111111111",
        sourceId: "33333333-3333-4333-8333-333333333333",
        idempotencyKey: "request:crawl-import",
      },
    );

    expect(workflowId).toBe("22222222-2222-4222-8222-222222222222");
    expect(createCrawlImport).toHaveBeenCalledWith(
      expect.objectContaining({
        callerKind: "interactive",
        capability: {
          contentScopeIds: ["tenant:tenant", "source:preview"],
          grantId: "preview-grant",
        },
        subject,
        sourceUrls: ["https://example.com/a"],
        pageReferences: [
          expect.objectContaining({
            contentHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
            contentObjectKey: expect.stringContaining("__namespace-source-previews/"),
            sourceUrl: "https://example.com/a",
            title: "A",
          }),
        ],
      }),
    );
    expect(JSON.stringify(createCrawlImport.mock.calls[0])).not.toContain("large body");
    expect(objects.size).toBe(0);
  });

  it("recovers an exact crawl import when workflow creation commits but its response is lost", async () => {
    const objects = new Map<string, Uint8Array>();
    const repository = createInMemoryNamespaceSourcePreviewRepository();
    const findCrawlImportByIdempotency = vi.fn();
    const createCrawlImport = vi.fn(async () => {
      throw new Error("workflow response lost");
    });
    const service = createNamespaceSourcePreviewService({
      repository,
      storage: memoryStorage(objects) as never,
      websiteCrawl: crawlPages([{ sourceUrl: "https://example.com/a", content: "body" }]),
      workflows: { createCrawlImport, findCrawlImportByIdempotency } as never,
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
    const { subject, job } = await createJob(service);
    await service.tick();
    const [page] = await service.pages(subject, job.id);
    if (!page) throw new Error("Expected a preview page");
    const recovered = {
      id: "22222222-2222-4222-8222-222222222222",
      payload: {
        selectedSourceUrls: [page.sourceUrl],
        stagedPageReferences: [{ contentHash: page.contentHash, sourceUrl: page.sourceUrl }],
      },
    };
    findCrawlImportByIdempotency.mockResolvedValueOnce(null).mockResolvedValueOnce(recovered);

    await expect(
      service.consume(
        {
          callerKind: "interactive",
          capability: { contentScopeIds: [], grantId: "replacement-grant" },
          subject,
        },
        {
          jobId: job.id,
          pageIds: [page.pageId],
          configurationFingerprint: "f".repeat(64),
          knowledgeSpaceId: "11111111-1111-4111-8111-111111111111",
          sourceId: "33333333-3333-4333-8333-333333333333",
          idempotencyKey: "request:crawl-import",
        },
      ),
    ).resolves.toBe(recovered.id);

    expect(createCrawlImport).toHaveBeenCalledOnce();
    await expect(service.get(subject, job.id)).resolves.toMatchObject({
      importWorkflowId: recovered.id,
      status: "consumed",
    });
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

  it("processes queued previews even when an older cleanup job keeps failing", async () => {
    const objects = new Map<string, Uint8Array>();
    const repository = createInMemoryNamespaceSourcePreviewRepository();
    await repository.create({
      id: "11111111-1111-4111-8111-111111111111",
      tenantId: "tenant",
      accountId: "account",
      status: "failed",
      config: {
        credentialId: "credential",
        pluginId: "plugin",
        provider: "firecrawl",
        datasource: "crawl",
        parameters: {},
        rootUrl: "https://failed.example.com",
      },
      configurationFingerprint: "e".repeat(64),
      expiresAt: "2026-09-04T01:00:00.000Z",
      createdAt: "2026-09-03T23:00:00.000Z",
      updatedAt: "2026-09-03T23:00:00.000Z",
      errorCode: "PREVIEW_PROVIDER_FAILED",
    });
    const storage = memoryStorage(objects);
    storage.listObjects = vi.fn(async ({ prefix }: { prefix: string }) => {
      if (prefix.includes("11111111-1111-4111-8111-111111111111"))
        throw new Error("storage unavailable");
      return {
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key })),
      };
    });
    const service = createNamespaceSourcePreviewService({
      repository,
      storage: storage as never,
      websiteCrawl: crawlPages([{ sourceUrl: "https://example.com/new", content: "body" }]),
      workflows: {} as never,
      sources: {} as never,
      now: () => new Date("2026-09-04T00:00:00.000Z"),
    });
    const { subject, job } = await createJob(service);

    await expect(service.tick()).resolves.toBe(true);

    await expect(service.get(subject, job.id)).resolves.toMatchObject({ status: "completed" });
  });

  it("serializes scheduled ticks and reports failures without stopping the scheduler", async () => {
    let releaseFirst: (() => void) | undefined;
    const first = new Promise<boolean>((resolve) => {
      releaseFirst = () => resolve(true);
    });
    const tick = vi
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(() => first)
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(false);
    const onError = vi.fn();
    let scheduled: (() => void) | undefined;
    const interval = { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation((handler) => {
      scheduled = handler as () => void;
      return interval;
    });
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    const stop = createNamespaceSourcePreviewRuntime({ service: { tick }, onError }).start();
    if (!scheduled || !releaseFirst) throw new Error("Expected the preview runtime to start");

    scheduled();
    scheduled();
    expect(tick).toHaveBeenCalledOnce();
    releaseFirst();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    scheduled();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    scheduled();
    await vi.waitFor(() => expect(tick).toHaveBeenCalledTimes(3));

    await stop();
    expect(clearIntervalSpy).toHaveBeenCalledWith(interval);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
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
