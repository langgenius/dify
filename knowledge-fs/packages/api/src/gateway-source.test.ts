import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it } from "vitest";

import {
  createAcceptingDurableDeletionService,
  createAllowingDurableDeletionSafetyOptions,
} from "./durable-deletion-test-utils";
import {
  type OnlineDocumentConnector,
  type OnlineDriveConnector,
  SOURCE_OPERATION_FAILURES,
  type SourceCredentialTester,
  type WebsiteCrawlConnector,
  createKnowledgeGateway,
  createStaticAuthVerifier,
} from "./index";

const readToken = "read-token";
const writeToken = "write-token";
const otherTenantToken = "other-tenant-token";

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function json(token: string) {
  return { ...bearer(token), "content-type": "application/json" };
}

function createApp(
  options: {
    onlineDocumentConnector?: OnlineDocumentConnector;
    onlineDriveConnector?: OnlineDriveConnector;
    sourceCredentialTester?: SourceCredentialTester;
    websiteCrawlConnector?: WebsiteCrawlConnector;
  } = {},
) {
  return createKnowledgeGateway({
    ...createAllowingDurableDeletionSafetyOptions(),
    adapter: createNodePlatformAdapter({ env: {} }),
    auth: createStaticAuthVerifier({
      subjectsByToken: {
        [otherTenantToken]: {
          scopes: ["knowledge-spaces:*"],
          subjectId: "u2",
          tenantId: "tenant-2",
        },
        [readToken]: { scopes: ["knowledge-spaces:read"], subjectId: "u1", tenantId: "tenant-1" },
        [writeToken]: { scopes: ["knowledge-spaces:*"], subjectId: "u1", tenantId: "tenant-1" },
      },
    }),
    durableDeletions: createAcceptingDurableDeletionService(),
    ...(options.onlineDocumentConnector
      ? { onlineDocumentConnector: options.onlineDocumentConnector }
      : {}),
    ...(options.onlineDriveConnector ? { onlineDriveConnector: options.onlineDriveConnector } : {}),
    ...(options.sourceCredentialTester
      ? { sourceCredentialTester: options.sourceCredentialTester }
      : {}),
    ...(options.websiteCrawlConnector
      ? { websiteCrawlConnector: options.websiteCrawlConnector }
      : {}),
  });
}

async function createConnectorSource(
  app: ReturnType<typeof createApp>,
  spaceId: string,
): Promise<string> {
  const response = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
    body: JSON.stringify({
      metadata: {
        datasource: "notion_datasource",
        pluginId: "langgenius/notion_datasource",
        provider: "notion_datasource",
      },
      name: "Notion",
      type: "connector",
      uri: "workspace-1",
    }),
    headers: json(writeToken),
    method: "POST",
  });
  expect(response.status).toBe(201);

  return (await response.json()).id;
}

async function createWebSource(
  app: ReturnType<typeof createApp>,
  spaceId: string,
): Promise<string> {
  const response = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
    body: JSON.stringify({
      metadata: {
        datasource: "crawl",
        pluginId: "langgenius/firecrawl_datasource",
        provider: "firecrawl",
      },
      name: "Docs crawl",
      type: "web",
      uri: "https://example.com",
    }),
    headers: json(writeToken),
    method: "POST",
  });
  expect(response.status).toBe(201);

  return (await response.json()).id;
}

async function createSpace(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.request("/knowledge-spaces", {
    body: JSON.stringify({ name: "Space", slug: "space" }),
    headers: json(writeToken),
    method: "POST",
  });
  expect(response.status).toBe(201);

  return (await response.json()).id;
}

describe("knowledge space source CRUD", () => {
  it("creates, lists, gets, updates and deletes a source (tenant scoped)", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);

    const createResponse = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      body: JSON.stringify({
        metadata: { provider: "firecrawl", url: "https://example.com" },
        name: "Docs crawl",
        type: "web",
        uri: "https://example.com",
      }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(createResponse.status).toBe(201);
    const source = await createResponse.json();
    expect(source).toMatchObject({
      knowledgeSpaceId: spaceId,
      name: "Docs crawl",
      status: "active",
      type: "web",
    });

    // A different tenant cannot see the space (404) and therefore not the source.
    const foreign = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      headers: bearer(otherTenantToken),
    });
    expect(foreign.status).toBe(404);

    const listResponse = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      headers: bearer(readToken),
    });
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).items).toHaveLength(1);

    const getResponse = await app.request(`/knowledge-spaces/${spaceId}/sources/${source.id}`, {
      headers: bearer(readToken),
    });
    expect(getResponse.status).toBe(200);
    expect((await getResponse.json()).id).toBe(source.id);

    const patchResponse = await app.request(`/knowledge-spaces/${spaceId}/sources/${source.id}`, {
      body: JSON.stringify({ status: "syncing" }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(patchResponse.status).toBe(200);
    const patchedSource = await patchResponse.json();
    expect(patchedSource.status).toBe("syncing");

    const deleteResponse = await app.request(`/knowledge-spaces/${spaceId}/sources/${source.id}`, {
      body: JSON.stringify({ expectedRevision: patchedSource.version }),
      headers: { ...json(writeToken), "idempotency-key": "delete-source-crud" },
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(202);
    await expect(deleteResponse.json()).resolves.toMatchObject({
      job: { mode: "cascade", targetId: source.id, targetType: "source" },
    });

    const stillVisible = await app.request(`/knowledge-spaces/${spaceId}/sources/${source.id}`, {
      headers: bearer(readToken),
    });
    expect(stillVisible.status).toBe(200);
  });

  it("rejects source creation in a space the tenant does not own", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      body: JSON.stringify({ name: "x", type: "web", uri: "https://x.test" }),
      headers: json(otherTenantToken),
      method: "POST",
    });
    expect(response.status).toBe(404);
  });
});

describe("website crawl run", () => {
  it("returns 501 when no crawl connector is configured", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    const sourceId = await createWebSource(app, spaceId);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status).toBe(501);
  });

  it("returns 400 when crawling a non-web source", async () => {
    const app = createApp({ websiteCrawlConnector: { crawl: async () => ({ pages: [] }) } });
    const spaceId = await createSpace(app);
    const createResponse = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      body: JSON.stringify({ name: "Notion", type: "connector", uri: "workspace-1" }),
      headers: json(writeToken),
      method: "POST",
    });
    const sourceId = (await createResponse.json()).id;

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status).toBe(400);
  });

  it("crawls, returns pages, and marks the source active with sync metadata", async () => {
    const seen: { tenantId: string; uri: string }[] = [];
    const connector: WebsiteCrawlConnector = {
      crawl: async ({ source, tenantId }) => {
        seen.push({ tenantId, uri: source.uri });

        return {
          completed: 2,
          pages: [
            { content: "# A", sourceUrl: "https://example.com/a", title: "A" },
            { content: "# B", sourceUrl: "https://example.com/b" },
          ],
          status: "completed",
          total: 2,
        };
      },
    };
    const app = createApp({ websiteCrawlConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createWebSource(app, spaceId);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      completed: 2,
      failed: 0,
      imported: 2,
      status: "completed",
      total: 2,
    });
    expect(body.pages).toHaveLength(2);
    expect(seen).toEqual([{ tenantId: "tenant-1", uri: "https://example.com" }]);

    const source = await (
      await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(source.status).toBe("active");
    expect(source.metadata.sync).toMatchObject({ imported: 2, failed: 0, pageCount: 2 });

    // The crawled pages were materialized into documents carrying the source id.
    const documents = await (
      await app.request(`/knowledge-spaces/${spaceId}/documents?limit=10`, {
        headers: bearer(readToken),
      })
    ).json();
    expect(documents.items).toHaveLength(2);
    expect(documents.items.every((item: { sourceId?: string }) => item.sourceId === sourceId)).toBe(
      true,
    );

    // Re-crawling identical content dedupes by content hash: no new documents.
    const recrawl = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(recrawl.status).toBe(200);
    await expect(recrawl.json()).resolves.toMatchObject({ imported: 0, replaced: 0, skipped: 2 });
    const documentsAfter = await (
      await app.request(`/knowledge-spaces/${spaceId}/documents?limit=10`, {
        headers: bearer(readToken),
      })
    ).json();
    expect(documentsAfter.items).toHaveLength(2);
  });

  it("marks the source errored and returns 502 when the crawl fails", async () => {
    const connector: WebsiteCrawlConnector = {
      crawl: async () => {
        throw new Error("daemon unavailable credential-secret");
      },
    };
    const app = createApp({ websiteCrawlConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createWebSource(app, spaceId);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status).toBe(502);
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      code: SOURCE_OPERATION_FAILURES.websiteCrawl.code,
      error: SOURCE_OPERATION_FAILURES.websiteCrawl.message,
    });
    expect(JSON.stringify(responseBody)).not.toContain("credential-secret");

    const source = await (
      await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(source.status).toBe("error");
    expect(source.metadata.sync).toEqual({
      error: SOURCE_OPERATION_FAILURES.websiteCrawl.message,
      errorCode: SOURCE_OPERATION_FAILURES.websiteCrawl.code,
    });
    expect(JSON.stringify(source.metadata)).not.toContain("credential-secret");
  });
});

describe("online document pages", () => {
  const connector: OnlineDocumentConnector = {
    getPageContent: async ({ page }) => ({
      content: `# ${page.pageId}`,
      pageId: page.pageId,
      workspaceId: page.workspaceId,
    }),
    listPages: async ({ source, tenantId }) => ({
      workspaces: [
        {
          pages: [
            { pageId: "p1", pageName: "One", type: "page" },
            { pageId: "p2", pageName: "Two", type: "database" },
          ],
          total: 2,
          workspaceId: `${tenantId}:${source.uri}`,
          workspaceName: "WS",
        },
      ],
    }),
  };

  it("returns 501 when no connector, 400 for a non-connector source", async () => {
    const noConnectorApp = createApp();
    const spaceA = await createSpace(noConnectorApp);
    const connectorSourceId = await createConnectorSource(noConnectorApp, spaceA);
    expect(
      (
        await noConnectorApp.request(
          `/knowledge-spaces/${spaceA}/sources/${connectorSourceId}/pages`,
          { headers: bearer(readToken) },
        )
      ).status,
    ).toBe(501);

    const app = createApp({ onlineDocumentConnector: connector });
    const spaceB = await createSpace(app);
    const webSourceId = await createWebSource(app, spaceB);
    expect(
      (
        await app.request(`/knowledge-spaces/${spaceB}/sources/${webSourceId}/pages`, {
          headers: bearer(readToken),
        })
      ).status,
    ).toBe(400);
  });

  it("lists pages then imports selected pages into documents", async () => {
    const app = createApp({ onlineDocumentConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createConnectorSource(app, spaceId);

    const pages = await (
      await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/pages`, {
        headers: bearer(readToken),
      })
    ).json();
    expect(pages.workspaces[0].pages).toHaveLength(2);

    const importResponse = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/import`,
      {
        body: JSON.stringify({
          pages: [
            { name: "One", pageId: "p1", type: "page", workspaceId: "w1" },
            { name: "Two", pageId: "p2", type: "database", workspaceId: "w1" },
          ],
        }),
        headers: json(writeToken),
        method: "POST",
      },
    );
    expect(importResponse.status).toBe(200);
    const imported = await importResponse.json();
    expect(imported.documents).toHaveLength(2);
    expect(imported.failed).toHaveLength(0);

    const source = await (
      await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(source.status).toBe("active");
    expect(source.metadata.sync).toMatchObject({ failed: 0, imported: 2, requested: 2 });

    const documents = await (
      await app.request(`/knowledge-spaces/${spaceId}/documents?limit=10`, {
        headers: bearer(readToken),
      })
    ).json();
    expect(documents.items).toHaveLength(2);
    expect(documents.items.every((item: { sourceId?: string }) => item.sourceId === sourceId)).toBe(
      true,
    );
  });

  it("re-sync skips pages whose lastEditedTime is unchanged", async () => {
    const fetched: string[] = [];
    const connector: OnlineDocumentConnector = {
      getPageContent: async ({ page }) => {
        fetched.push(page.pageId);
        return { content: `# ${page.pageId}`, pageId: page.pageId };
      },
      listPages: async () => ({ workspaces: [] }),
    };
    const app = createApp({ onlineDocumentConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createConnectorSource(app, spaceId);
    const importBody = {
      pages: [
        { lastEditedTime: "t1", pageId: "p1", type: "page", workspaceId: "w1" },
        { lastEditedTime: "t1", pageId: "p2", type: "page", workspaceId: "w1" },
      ],
    };

    const first = await (
      await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/import`, {
        body: JSON.stringify(importBody),
        headers: json(writeToken),
        method: "POST",
      })
    ).json();
    expect(first.documents).toHaveLength(2);
    expect(first.skipped).toEqual([]);
    expect(fetched).toEqual(["p1", "p2"]);

    // Second import: p1 unchanged (skip), p2 edited (fail closed before re-fetch).
    fetched.length = 0;
    const second = await (
      await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/import`, {
        body: JSON.stringify({
          pages: [
            { lastEditedTime: "t1", pageId: "p1", type: "page", workspaceId: "w1" },
            { lastEditedTime: "t2", pageId: "p2", type: "page", workspaceId: "w1" },
          ],
        }),
        headers: json(writeToken),
        method: "POST",
      })
    ).json();
    expect(second.skipped).toEqual(["p1"]);
    expect(second.documents).toHaveLength(0);
    expect(second.failed).toEqual([
      expect.objectContaining({ code: "SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED" }),
    ]);
    expect(fetched).toEqual([]);

    const source = await (
      await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
        headers: bearer(readToken),
      })
    ).json();
    expect(source.metadata.imported.p2.lastEditedTime).toBe("t1");
  });
});

describe("source credential test", () => {
  it("returns 501 without a tester and the validation result with one", async () => {
    const noTesterApp = createApp();
    const spaceA = await createSpace(noTesterApp);
    const sourceA = await createWebSource(noTesterApp, spaceA);
    expect(
      (
        await noTesterApp.request(`/knowledge-spaces/${spaceA}/sources/${sourceA}/test`, {
          headers: bearer(writeToken),
          method: "POST",
        })
      ).status,
    ).toBe(501);

    const seen: string[] = [];
    const app = createApp({
      sourceCredentialTester: {
        test: async ({ source }) => {
          seen.push(source.id);
          return { valid: true };
        },
      },
    });
    const spaceB = await createSpace(app);
    const sourceB = await createWebSource(app, spaceB);
    const response = await app.request(`/knowledge-spaces/${spaceB}/sources/${sourceB}/test`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ valid: true });
    expect(seen).toEqual([sourceB]);
  });
});

describe("online drive files", () => {
  const connector: OnlineDriveConnector = {
    browse: async ({ prefix }) => ({
      buckets: [
        {
          bucket: "b1",
          files: [
            { id: "f1", name: "notes.md", size: 4, type: "file" },
            { id: "d1", name: prefix ?? "docs", type: "folder" },
          ],
        },
      ],
    }),
    download: async ({ file }) => ({ body: new TextEncoder().encode(`# ${file.id}`) }),
  };

  it("returns 501 without a connector and 400 for a non-connector source", async () => {
    const noConnectorApp = createApp();
    const spaceA = await createSpace(noConnectorApp);
    const connectorSourceId = await createConnectorSource(noConnectorApp, spaceA);
    expect(
      (
        await noConnectorApp.request(
          `/knowledge-spaces/${spaceA}/sources/${connectorSourceId}/files`,
          { headers: bearer(readToken) },
        )
      ).status,
    ).toBe(501);

    const app = createApp({ onlineDriveConnector: connector });
    const spaceB = await createSpace(app);
    const webSourceId = await createWebSource(app, spaceB);
    expect(
      (
        await app.request(`/knowledge-spaces/${spaceB}/sources/${webSourceId}/files`, {
          headers: bearer(readToken),
        })
      ).status,
    ).toBe(400);
  });

  it("browses files then imports selected files as documents", async () => {
    const app = createApp({ onlineDriveConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createConnectorSource(app, spaceId);

    const browse = await (
      await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/files?bucket=b1`, {
        headers: bearer(readToken),
      })
    ).json();
    expect(browse.buckets[0].files).toHaveLength(2);

    const importResponse = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/import-files`,
      {
        body: JSON.stringify({
          files: [{ bucket: "b1", id: "f1", name: "notes.md" }],
        }),
        headers: json(writeToken),
        method: "POST",
      },
    );
    expect(importResponse.status).toBe(200);
    const imported = await importResponse.json();
    expect(imported.documents).toHaveLength(1);
    expect(imported.failed).toHaveLength(0);

    const documents = await (
      await app.request(`/knowledge-spaces/${spaceId}/documents?limit=10`, {
        headers: bearer(readToken),
      })
    ).json();
    expect(documents.items).toHaveLength(1);
    expect(documents.items[0].filename).toBe("notes.md");
    expect(documents.items[0].sourceId).toBe(sourceId);

    const reimport = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/import-files`,
      {
        body: JSON.stringify({
          files: [{ bucket: "b1", id: "f1", name: "notes.md" }],
        }),
        headers: json(writeToken),
        method: "POST",
      },
    );
    expect(reimport.status).toBe(200);
    await expect(reimport.json()).resolves.toMatchObject({
      documents: [],
      failed: [expect.objectContaining({ code: "SOURCE_DOCUMENT_REPLACEMENT_SAGA_REQUIRED" })],
    });
    const documentsAfter = await (
      await app.request(`/knowledge-spaces/${spaceId}/documents?limit=10`, {
        headers: bearer(readToken),
      })
    ).json();
    expect(documentsAfter.items).toHaveLength(1);
  });
});

describe("source delete cascade", () => {
  const crawlConnector: WebsiteCrawlConnector = {
    crawl: async () => ({
      pages: [
        { content: "# A", sourceUrl: "https://example.com/a" },
        { content: "# B", sourceUrl: "https://example.com/b" },
      ],
    }),
  };

  async function crawlIntoTwoDocuments(app: ReturnType<typeof createApp>): Promise<{
    sourceId: string;
    spaceId: string;
  }> {
    const spaceId = await createSpace(app);
    const sourceId = await createWebSource(app, spaceId);
    const crawl = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(crawl.status).toBe(200);

    return { sourceId, spaceId };
  }

  async function documentCount(
    app: ReturnType<typeof createApp>,
    spaceId: string,
  ): Promise<number> {
    const documents = await (
      await app.request(`/knowledge-spaces/${spaceId}/documents?limit=20`, {
        headers: bearer(readToken),
      })
    ).json();

    return documents.items.length;
  }

  async function sourceVersion(
    app: ReturnType<typeof createApp>,
    spaceId: string,
    sourceId: string,
  ): Promise<number> {
    const source = await (
      await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
        headers: bearer(readToken),
      })
    ).json();
    return source.version;
  }

  it("accepts a durable cascade request without deleting synchronously", async () => {
    const app = createApp({ websiteCrawlConnector: crawlConnector });
    const { sourceId, spaceId } = await crawlIntoTwoDocuments(app);
    expect(await documentCount(app, spaceId)).toBe(2);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      body: JSON.stringify({ expectedRevision: await sourceVersion(app, spaceId, sourceId) }),
      headers: { ...json(writeToken), "idempotency-key": "cascade-source-documents" },
      method: "DELETE",
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ job: { mode: "cascade" } });
    expect(await documentCount(app, spaceId)).toBe(2);
  });

  it("accepts a durable keep-documents request", async () => {
    const app = createApp({ websiteCrawlConnector: crawlConnector });
    const { sourceId, spaceId } = await crawlIntoTwoDocuments(app);

    const response = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}?documents=keep`,
      {
        body: JSON.stringify({ expectedRevision: await sourceVersion(app, spaceId, sourceId) }),
        headers: { ...json(writeToken), "idempotency-key": "keep-source-documents" },
        method: "DELETE",
      },
    );
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ job: { mode: "keep" } });
    expect(await documentCount(app, spaceId)).toBe(2);
  });
});

describe("source optimistic concurrency", () => {
  it("returns 409 for a stale expectedVersion and succeeds with the fresh one", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    const sourceId = await createWebSource(app, spaceId);
    const original = await (
      await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
        headers: bearer(writeToken),
      })
    ).json();
    expect(original.version).toBeGreaterThanOrEqual(1);

    // A concurrent update bumps the version.
    const bumped = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      body: JSON.stringify({ name: "Renamed" }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(bumped.status).toBe(200);
    const bumpedSource = await bumped.json();
    expect(bumpedSource.version).toBe(original.version + 1);

    // Writing with the stale version is rejected instead of overwriting.
    const stale = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      body: JSON.stringify({ expectedVersion: original.version, name: "Lost update" }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(stale.status).toBe(409);

    // Writing with the fresh version succeeds.
    const fresh = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      body: JSON.stringify({ expectedVersion: bumpedSource.version, name: "Current update" }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(fresh.status).toBe(200);
    await expect(fresh.json()).resolves.toMatchObject({
      name: "Current update",
      version: bumpedSource.version + 1,
    });
  });
});
