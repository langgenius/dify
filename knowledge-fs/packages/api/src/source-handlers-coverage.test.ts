import { createNodePlatformAdapter } from "@knowledge/adapters/node";
import { describe, expect, it, vi } from "vitest";

import { DurableDeletionServiceError } from "./durable-deletion-service";
import {
  createAcceptingDurableDeletionService,
  createAllowingDurableDeletionSafetyOptions,
} from "./durable-deletion-test-utils";
import {
  type KnowledgeSpaceRepository,
  type OnlineDocumentConnector,
  type OnlineDriveConnector,
  SOURCE_OPERATION_FAILURES,
  type SourceCredentialService,
  type SourceCredentialTester,
  type SourceDocumentMaterializer,
  type SourceRepository,
  type SourceSecretStore,
  type WebsiteCrawlConnector,
  createInMemoryKnowledgeSpaceRepository,
  createInMemorySourceRepository,
  createInMemorySourceRetiredSecretCleanupRepository,
  createKnowledgeGateway,
  createKnowledgeGatewayApp,
  createSourceCredentialFingerprinter,
  createSourceCredentialService,
  createStaticAuthVerifier,
  mimeTypeForFilename,
  onlineDocumentFilename,
  readImportedFilesState,
  readImportedState,
  readSourceCredentialConfig,
  registerSourceHandlers,
} from "./index";

const readToken = "read-token";
const writeToken = "write-token";
const otherTenantToken = "other-tenant-token";
const missingSourceId = "00000000-0000-4000-8000-00000000dead";

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function json(token: string) {
  return { ...bearer(token), "content-type": "application/json" };
}

interface GatewayOptions {
  onlineDocumentConnector?: OnlineDocumentConnector;
  onlineDriveConnector?: OnlineDriveConnector;
  sourceCredentials?: SourceCredentialService;
  sourceCredentialTester?: SourceCredentialTester;
  sources?: SourceRepository;
  websiteCrawlConnector?: WebsiteCrawlConnector;
}

function createApp(options: GatewayOptions = {}) {
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
    durableDeletions: createAcceptingDurableDeletionService({
      requestSourceDeletion: async () => {
        throw new DurableDeletionServiceError(
          "DURABLE_DELETION_NOT_FOUND",
          "Deletion target not found",
        );
      },
    }),
    ...(options.onlineDocumentConnector
      ? { onlineDocumentConnector: options.onlineDocumentConnector }
      : {}),
    ...(options.onlineDriveConnector ? { onlineDriveConnector: options.onlineDriveConnector } : {}),
    ...(options.sourceCredentials ? { sourceCredentials: options.sourceCredentials } : {}),
    ...(options.sourceCredentialTester
      ? { sourceCredentialTester: options.sourceCredentialTester }
      : {}),
    ...(options.sources ? { sources: options.sources } : {}),
    ...(options.websiteCrawlConnector
      ? { websiteCrawlConnector: options.websiteCrawlConnector }
      : {}),
  });
}

function createMemorySourceSecretStore(): SourceSecretStore {
  const records = new Map<
    string,
    { credentials: Record<string, unknown>; fingerprint: string; ref: string }
  >();
  let sequence = 0;
  const key = (input: {
    knowledgeSpaceId: string;
    ref: string;
    sourceId: string;
    tenantId: string;
  }) => `${input.tenantId}/${input.knowledgeSpaceId}/${input.sourceId}/${input.ref}`;
  const fingerprint = createSourceCredentialFingerprinter(new Uint8Array(32).fill(43));

  return {
    delete: async (input) => {
      records.delete(key(input));
    },
    fingerprint,
    get: async (input) => {
      const record = records.get(key(input));

      return record ? { ...record, credentials: { ...record.credentials } } : null;
    },
    put: async (input) => {
      sequence += 1;
      const ref = input.ref ?? `source-secret:test:${sequence.toString().padStart(16, "0")}`;
      const record = {
        credentials: { ...input.credentials },
        fingerprint: fingerprint({
          credentials: input.credentials,
          knowledgeSpaceId: input.knowledgeSpaceId,
          sourceId: input.sourceId,
          tenantId: input.tenantId,
        }),
        ref,
      };
      records.set(key({ ...input, ref }), record);

      return { ...record, credentials: { ...record.credentials } };
    },
  };
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

async function createWebSource(
  app: ReturnType<typeof createApp>,
  spaceId: string,
  name = "Docs crawl",
): Promise<string> {
  const response = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
    body: JSON.stringify({
      metadata: { provider: "firecrawl" },
      name,
      type: "web",
      uri: "https://example.com",
    }),
    headers: json(writeToken),
    method: "POST",
  });
  expect(response.status).toBe(201);

  return (await response.json()).id;
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

async function getSource(
  app: ReturnType<typeof createApp>,
  spaceId: string,
  sourceId: string,
): Promise<{ metadata: Record<string, unknown>; status: string }> {
  const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
    headers: bearer(writeToken),
  });
  expect(response.status).toBe(200);

  return response.json();
}

describe("source creation edge branches", () => {
  it("accepts a valid metadata.syncPolicy and rejects an invalid one", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);

    const created = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      body: JSON.stringify({
        metadata: { syncPolicy: { everyHours: 6 } },
        name: "Scheduled",
        type: "web",
        uri: "https://example.com",
      }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(created.status).toBe(201);
    const source = await created.json();
    expect(source.metadata.syncPolicy).toEqual({ everyHours: 6 });
    // The owning tenant is stamped for the background sync scheduler.
    expect(source.metadata.tenantId).toBe("tenant-1");

    const invalid = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      body: JSON.stringify({
        metadata: { syncPolicy: { everyHours: 0 } },
        name: "Broken schedule",
        type: "web",
        uri: "https://example.com",
      }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain("Invalid source syncPolicy");
  });

  it("returns 429 when the source repository capacity is exceeded", async () => {
    const app = createApp({ sources: createInMemorySourceRepository({ maxSources: 1 }) });
    const spaceId = await createSpace(app);
    await createWebSource(app, spaceId);

    const overflow = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      body: JSON.stringify({ name: "Too many", type: "web", uri: "https://example.com/2" }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(overflow.status).toBe(429);
    expect((await overflow.json()).error).toContain("maxSources=1 exceeded");
  });

  it("rethrows unexpected repository failures as 500", async () => {
    const inner = createInMemorySourceRepository({ maxSources: 10 });
    const sources: SourceRepository = {
      ...inner,
      create: async () => {
        throw new Error("create exploded");
      },
    };
    const app = createApp({ sources });
    const spaceId = await createSpace(app);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      body: JSON.stringify({ name: "Boom", type: "web", uri: "https://example.com" }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(response.status).toBe(500);
  });
});

describe("source list pagination", () => {
  it("pages sources with cursor and nextCursor", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    await createWebSource(app, spaceId, "One");
    await createWebSource(app, spaceId, "Two");

    const first = await app.request(`/knowledge-spaces/${spaceId}/sources?limit=1`, {
      headers: bearer(readToken),
    });
    expect(first.status).toBe(200);
    const firstPage = await first.json();
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toBeDefined();

    const second = await app.request(
      `/knowledge-spaces/${spaceId}/sources?limit=1&cursor=${firstPage.nextCursor}`,
      { headers: bearer(readToken) },
    );
    expect(second.status).toBe(200);
    const secondPage = await second.json();
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id);
    expect(secondPage.nextCursor).toBeUndefined();
  });
});

describe("source response credential redaction", () => {
  it("removes secret-bearing metadata recursively from create, list, get, and update responses", async () => {
    const sources = createInMemorySourceRepository({ maxSources: 10 });
    const secretStore = createMemorySourceSecretStore();
    const retiredSecrets = createInMemorySourceRetiredSecretCleanupRepository({
      maxClaimBatchSize: 10,
      maxJobs: 100,
      sources,
    });
    const sourceCredentials = createSourceCredentialService({
      retiredSecrets,
      secretStore,
      sources,
    });
    const app = createApp({ sourceCredentials, sources });
    const spaceId = await createSpace(app);
    const created = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      body: JSON.stringify({
        metadata: {
          auth: {
            accessToken: "access-secret",
            mode: "oauth",
            nested: [{ integration_password: "password-secret", label: "primary" }],
          },
          credentials: { apiKey: "credential-secret" },
          endpoint: "https://crawler.example.com",
          provider: "firecrawl",
          secretRotationAt: "2026-07-13T00:00:00.000Z",
          tokenCount: 42,
        },
        name: "Secret source",
        type: "web",
        uri: "https://example.com",
      }),
      headers: json(writeToken),
      method: "POST",
    });

    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody.credentialConfigured).toBe(true);
    expect(createdBody.metadata).toEqual({
      auth: { mode: "oauth", nested: [{ label: "primary" }] },
      endpoint: "https://crawler.example.com",
      provider: "firecrawl",
      secretRotationAt: "2026-07-13T00:00:00.000Z",
      tenantId: "tenant-1",
      tokenCount: 42,
    });

    const sourceId = createdBody.id as string;
    const storedAfterCreate = await sources.get({ id: sourceId, knowledgeSpaceId: spaceId });
    expect(storedAfterCreate?.credentialRef).toBeDefined();
    expect(storedAfterCreate?.metadata).not.toHaveProperty("credentials");
    expect(storedAfterCreate?.metadata.auth).toEqual({
      mode: "oauth",
      nested: [{ label: "primary" }],
    });
    const credentialRef = storedAfterCreate?.credentialRef;
    expect(credentialRef).toBeDefined();
    expect(
      await secretStore.get({
        knowledgeSpaceId: spaceId,
        ref: credentialRef as string,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).toMatchObject({ credentials: { apiKey: "credential-secret" } });

    const listed = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      headers: bearer(readToken),
    });
    expect(listed.status).toBe(200);
    expect((await listed.json()).items[0].metadata).toEqual(createdBody.metadata);

    const fetched = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      headers: bearer(readToken),
    });
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).metadata).toEqual(createdBody.metadata);

    const updated = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      body: JSON.stringify({
        metadata: {
          "api-key": "updated-api-secret",
          connection: {
            authorizationHeader: "Bearer updated-token",
            region: "us-east-1",
          },
          githubToken: "updated-token",
          note: "visible",
          password: "updated-password",
        },
      }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).metadata).toEqual({
      auth: { mode: "oauth", nested: [{ label: "primary" }] },
      connection: { region: "us-east-1" },
      endpoint: "https://crawler.example.com",
      note: "visible",
      provider: "firecrawl",
      secretRotationAt: "2026-07-13T00:00:00.000Z",
      tenantId: "tenant-1",
      tokenCount: 42,
    });

    const storedAfterUpdate = await sources.get({ id: sourceId, knowledgeSpaceId: spaceId });
    expect(storedAfterUpdate?.credentialRef).toBe(credentialRef);
    expect(storedAfterUpdate?.metadata).not.toHaveProperty("credentials");
    expect(storedAfterUpdate?.metadata.auth).toEqual({
      mode: "oauth",
      nested: [{ label: "primary" }],
    });
    expect(storedAfterUpdate?.metadata.connection).toEqual({ region: "us-east-1" });
    expect(storedAfterUpdate?.metadata).not.toHaveProperty("api-key");
    expect(storedAfterUpdate?.metadata).not.toHaveProperty("githubToken");
    expect(storedAfterUpdate?.metadata).not.toHaveProperty("password");
  });

  it("preserves stored credentials when redacted GET metadata is patched back", async () => {
    const sources = createInMemorySourceRepository({ maxSources: 10 });
    const secretStore = createMemorySourceSecretStore();
    const retiredSecrets = createInMemorySourceRetiredSecretCleanupRepository({
      maxClaimBatchSize: 10,
      maxJobs: 100,
      sources,
    });
    const sourceCredentials = createSourceCredentialService({
      retiredSecrets,
      secretStore,
      sources,
    });
    let testedCredentials: Record<string, unknown> | undefined;
    const app = createApp({
      sourceCredentials,
      sourceCredentialTester: {
        test: async ({ source }) => {
          testedCredentials = readSourceCredentialConfig(source).credentials;
          return { valid: testedCredentials.apiKey === "stored-api-key" };
        },
      },
      sources,
    });
    const spaceId = await createSpace(app);
    const created = await app.request(`/knowledge-spaces/${spaceId}/sources`, {
      body: JSON.stringify({
        metadata: {
          credentials: { apiKey: "stored-api-key" },
          pluginId: "langgenius/firecrawl",
          profiles: [{ name: "primary", token: "nested-token" }],
          provider: "firecrawl",
        },
        name: "Credential round trip",
        type: "connector",
        uri: "workspace-1",
      }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(created.status).toBe(201);
    const sourceId = (await created.json()).id as string;

    const fetched = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      headers: bearer(readToken),
    });
    expect(fetched.status).toBe(200);
    const publicSource = await fetched.json();
    expect(publicSource.metadata).toEqual({
      pluginId: "langgenius/firecrawl",
      profiles: [{ name: "primary" }],
      provider: "firecrawl",
      tenantId: "tenant-1",
    });

    const patched = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      body: JSON.stringify({ metadata: { ...publicSource.metadata, label: "updated" } }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(patched.status).toBe(200);
    expect((await patched.json()).metadata).toEqual({
      label: "updated",
      pluginId: "langgenius/firecrawl",
      profiles: [{ name: "primary" }],
      provider: "firecrawl",
      tenantId: "tenant-1",
    });

    const stored = await sources.get({ id: sourceId, knowledgeSpaceId: spaceId });
    expect(stored?.credentialRef).toBeDefined();
    expect(stored?.metadata).not.toHaveProperty("credentials");
    expect(stored?.metadata.profiles).toEqual([{ name: "primary" }]);
    expect(
      await secretStore.get({
        knowledgeSpaceId: spaceId,
        ref: stored?.credentialRef as string,
        sourceId,
        tenantId: "tenant-1",
      }),
    ).toMatchObject({ credentials: { apiKey: "stored-api-key" } });

    const tested = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/test`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(tested.status).toBe(200);
    expect(await tested.json()).toEqual({ valid: true });
    expect(testedCredentials).toEqual({ apiKey: "stored-api-key" });
  });
});

describe("tenant and existence guards on every source endpoint", () => {
  it("returns 404 when the space belongs to another tenant", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    const sourceId = await createWebSource(app, spaceId);
    const base = `/knowledge-spaces/${spaceId}/sources/${sourceId}`;

    expect((await app.request(base, { headers: bearer(otherTenantToken) })).status).toBe(404);
    expect(
      (
        await app.request(base, {
          body: JSON.stringify({ name: "Nope" }),
          headers: json(otherTenantToken),
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(base, {
          body: JSON.stringify({ expectedRevision: 1 }),
          headers: {
            ...json(otherTenantToken),
            "idempotency-key": "cross-tenant-source-delete",
          },
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`${base}/crawl`, { headers: bearer(otherTenantToken), method: "POST" }))
        .status,
    ).toBe(404);
    expect((await app.request(`${base}/pages`, { headers: bearer(otherTenantToken) })).status).toBe(
      404,
    );
    expect(
      (
        await app.request(`${base}/import`, {
          body: JSON.stringify({ pages: [{ pageId: "p1", type: "page", workspaceId: "w1" }] }),
          headers: json(otherTenantToken),
          method: "POST",
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`${base}/test`, { headers: bearer(otherTenantToken), method: "POST" }))
        .status,
    ).toBe(404);
    expect((await app.request(`${base}/files`, { headers: bearer(otherTenantToken) })).status).toBe(
      404,
    );
    expect(
      (
        await app.request(`${base}/import-files`, {
          body: JSON.stringify({ files: [{ id: "f1", name: "a.txt" }] }),
          headers: json(otherTenantToken),
          method: "POST",
        })
      ).status,
    ).toBe(404);
  });

  it("returns 404 when the source id is unknown", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    const base = `/knowledge-spaces/${spaceId}/sources/${missingSourceId}`;

    expect(
      (
        await app.request(base, {
          body: JSON.stringify({ name: "Nope" }),
          headers: json(writeToken),
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(base, {
          body: JSON.stringify({ expectedRevision: 1 }),
          headers: { ...json(writeToken), "idempotency-key": "missing-source-delete" },
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`${base}/crawl`, { headers: bearer(writeToken), method: "POST" })).status,
    ).toBe(404);
    expect((await app.request(`${base}/pages`, { headers: bearer(readToken) })).status).toBe(404);
    expect(
      (
        await app.request(`${base}/import`, {
          body: JSON.stringify({ pages: [{ pageId: "p1", type: "page", workspaceId: "w1" }] }),
          headers: json(writeToken),
          method: "POST",
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`${base}/test`, { headers: bearer(writeToken), method: "POST" })).status,
    ).toBe(404);
    expect((await app.request(`${base}/files`, { headers: bearer(readToken) })).status).toBe(404);
    expect(
      (
        await app.request(`${base}/import-files`, {
          body: JSON.stringify({ files: [{ id: "f1", name: "a.txt" }] }),
          headers: json(writeToken),
          method: "POST",
        })
      ).status,
    ).toBe(404);
  });
});

describe("source update edge branches", () => {
  it("validates metadata.syncPolicy on update and re-stamps the tenant", async () => {
    const app = createApp();
    const spaceId = await createSpace(app);
    const sourceId = await createWebSource(app, spaceId);

    const invalid = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      body: JSON.stringify({ metadata: { syncPolicy: { dailyAt: [] } } }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toContain("Invalid source syncPolicy");

    const valid = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      body: JSON.stringify({ metadata: { note: "kept", syncPolicy: { dailyAt: ["03:00"] } } }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(valid.status).toBe(200);
    const updated = await valid.json();
    expect(updated.metadata).toEqual({
      note: "kept",
      provider: "firecrawl",
      syncPolicy: { dailyAt: ["03:00"] },
      tenantId: "tenant-1",
    });

    // Metadata without a syncPolicy merges into the existing metadata and skips policy validation.
    const plain = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      body: JSON.stringify({ metadata: { plain: true } }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(plain.status).toBe(200);
    expect((await plain.json()).metadata).toEqual({
      note: "kept",
      plain: true,
      provider: "firecrawl",
      syncPolicy: { dailyAt: ["03:00"] },
      tenantId: "tenant-1",
    });
  });

  it("rethrows unexpected update failures as 500", async () => {
    const inner = createInMemorySourceRepository({ maxSources: 10 });
    const sources: SourceRepository = {
      ...inner,
      update: async () => {
        throw new Error("update exploded");
      },
    };
    const app = createApp({ sources });
    const spaceId = await createSpace(app);
    const sourceId = await createWebSource(app, spaceId);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}`, {
      body: JSON.stringify({ name: "Renamed" }),
      headers: json(writeToken),
      method: "PATCH",
    });
    expect(response.status).toBe(500);
  });
});

describe("website crawl failure mapping", () => {
  it("maps a non-Error crawl failure to the fallback messages", async () => {
    const nonErrorFailure: unknown = "daemon exploded without an Error";
    const app = createApp({
      websiteCrawlConnector: {
        crawl: async () => {
          throw nonErrorFailure;
        },
      },
    });
    const spaceId = await createSpace(app);
    const sourceId = await createWebSource(app, spaceId);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: SOURCE_OPERATION_FAILURES.websiteCrawl.code,
      error: SOURCE_OPERATION_FAILURES.websiteCrawl.message,
    });

    const source = await getSource(app, spaceId, sourceId);
    expect(source.status).toBe("error");
    expect(source.metadata.sync).toEqual({
      error: SOURCE_OPERATION_FAILURES.websiteCrawl.message,
      errorCode: SOURCE_OPERATION_FAILURES.websiteCrawl.code,
    });
  });
});

describe("online document listing shape branches", () => {
  it("passes through optional page fields and omits absent workspace fields", async () => {
    const connector: OnlineDocumentConnector = {
      getPageContent: async ({ page }) => ({ content: `# ${page.pageId}`, pageId: page.pageId }),
      listPages: async () => ({
        workspaces: [
          {
            pages: [
              {
                lastEditedTime: "2026-07-01T00:00:00.000Z",
                pageId: "p1",
                pageName: "One",
                parentId: "root",
                type: "page",
              },
            ],
          },
        ],
      }),
    };
    const app = createApp({ onlineDocumentConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createConnectorSource(app, spaceId);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/pages`, {
      headers: bearer(readToken),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workspaces).toEqual([
      {
        pages: [
          {
            lastEditedTime: "2026-07-01T00:00:00.000Z",
            pageId: "p1",
            pageName: "One",
            parentId: "root",
            type: "page",
          },
        ],
      },
    ]);
  });

  it("maps listing failures to 502", async () => {
    const connector: OnlineDocumentConnector = {
      getPageContent: async ({ page }) => ({ content: "x", pageId: page.pageId }),
      listPages: async () => {
        throw new Error("notion down: Authorization Bearer credential-secret");
      },
    };
    const app = createApp({ onlineDocumentConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createConnectorSource(app, spaceId);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/pages`, {
      headers: bearer(readToken),
    });
    expect(response.status).toBe(502);
    const errorBody = await response.json();
    expect(errorBody).toEqual({
      code: SOURCE_OPERATION_FAILURES.onlineDocumentRequest.code,
      error: SOURCE_OPERATION_FAILURES.onlineDocumentRequest.message,
    });
    expect(JSON.stringify(errorBody)).not.toContain("credential-secret");

    // A non-Error failure falls back to the generic message.
    const nonErrorFailure: unknown = "rejected without an Error";
    const nonErrorApp = createApp({
      onlineDocumentConnector: {
        getPageContent: async ({ page }) => ({ content: "x", pageId: page.pageId }),
        listPages: async () => {
          throw nonErrorFailure;
        },
      },
    });
    const spaceB = await createSpace(nonErrorApp);
    const sourceB = await createConnectorSource(nonErrorApp, spaceB);
    const fallback = await nonErrorApp.request(
      `/knowledge-spaces/${spaceB}/sources/${sourceB}/pages`,
      { headers: bearer(readToken) },
    );
    expect(fallback.status).toBe(502);
    expect(await fallback.json()).toEqual({
      code: SOURCE_OPERATION_FAILURES.onlineDocumentRequest.code,
      error: SOURCE_OPERATION_FAILURES.onlineDocumentRequest.message,
    });
  });
});

describe("online document import edge branches", () => {
  it("returns 400 for a non-connector source and 501 without a connector", async () => {
    const noConnectorApp = createApp();
    const spaceA = await createSpace(noConnectorApp);
    const connectorSourceId = await createConnectorSource(noConnectorApp, spaceA);
    const notConfigured = await noConnectorApp.request(
      `/knowledge-spaces/${spaceA}/sources/${connectorSourceId}/import`,
      {
        body: JSON.stringify({ pages: [{ pageId: "p1", type: "page", workspaceId: "w1" }] }),
        headers: json(writeToken),
        method: "POST",
      },
    );
    expect(notConfigured.status).toBe(501);

    const connector: OnlineDocumentConnector = {
      getPageContent: async ({ page }) => ({ content: "x", pageId: page.pageId }),
      listPages: async () => ({ workspaces: [] }),
    };
    const app = createApp({ onlineDocumentConnector: connector });
    const spaceB = await createSpace(app);
    const webSourceId = await createWebSource(app, spaceB);
    const wrongType = await app.request(
      `/knowledge-spaces/${spaceB}/sources/${webSourceId}/import`,
      {
        body: JSON.stringify({ pages: [{ pageId: "p1", type: "page", workspaceId: "w1" }] }),
        headers: json(writeToken),
        method: "POST",
      },
    );
    expect(wrongType.status).toBe(400);
  });

  it("isolates per-page fetch failures into the failed list", async () => {
    const nonErrorFailure: unknown = "page fetch rejected without an Error";
    const connector: OnlineDocumentConnector = {
      getPageContent: async ({ page }) => {
        if (page.pageId === "p2") {
          throw new Error("page fetch denied");
        }

        if (page.pageId === "p3") {
          throw nonErrorFailure;
        }

        return { content: `# ${page.pageId}`, pageId: page.pageId };
      },
      listPages: async () => ({ workspaces: [] }),
    };
    const app = createApp({ onlineDocumentConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createConnectorSource(app, spaceId);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/import`, {
      body: JSON.stringify({
        pages: [
          { name: "One", pageId: "p1", type: "page", workspaceId: "w1" },
          { name: "Two", pageId: "p2", type: "page", workspaceId: "w1" },
          { name: "Three", pageId: "p3", type: "page", workspaceId: "w1" },
        ],
      }),
      headers: json(writeToken),
      method: "POST",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.documents).toHaveLength(1);
    expect(body.failed).toEqual([
      {
        code: SOURCE_OPERATION_FAILURES.onlineDocumentPageFetch.code,
        error: SOURCE_OPERATION_FAILURES.onlineDocumentPageFetch.message,
        filename: "Two-p2.md",
      },
      {
        code: SOURCE_OPERATION_FAILURES.onlineDocumentPageFetch.code,
        error: SOURCE_OPERATION_FAILURES.onlineDocumentPageFetch.message,
        filename: "Three-p3.md",
      },
    ]);
    expect(body.skipped).toEqual([]);
  });
});

describe("source credential test result mapping", () => {
  it("maps a tester error to a stable response without leaking it", async () => {
    const app = createApp({
      sourceCredentialTester: {
        test: async () => ({ error: "expired token credential-secret", valid: false }),
      },
    });
    const spaceId = await createSpace(app);
    const sourceId = await createWebSource(app, spaceId);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/test`, {
      headers: bearer(writeToken),
      method: "POST",
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      code: SOURCE_OPERATION_FAILURES.credentialTest.code,
      error: SOURCE_OPERATION_FAILURES.credentialTest.message,
      valid: false,
    });
    expect(JSON.stringify(body)).not.toContain("credential-secret");
  });
});

describe("online drive browse edge branches", () => {
  it("forwards maxKeys/prefix without a bucket and maps truncated anonymous buckets", async () => {
    const browseCalls: {
      bucket: string | undefined;
      maxKeys: number | undefined;
      prefix: string | undefined;
    }[] = [];
    const connector: OnlineDriveConnector = {
      browse: async ({ bucket, maxKeys, prefix }) => {
        browseCalls.push({ bucket, maxKeys, prefix });

        return {
          buckets: [{ files: [{ id: "f1", name: "a.txt", type: "file" }], isTruncated: true }],
        };
      },
      download: async () => ({ body: new TextEncoder().encode("x") }),
    };
    const app = createApp({ onlineDriveConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createConnectorSource(app, spaceId);

    const response = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/files?maxKeys=5&prefix=docs`,
      { headers: bearer(readToken) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      buckets: [
        {
          files: [{ id: "f1", name: "a.txt", type: "file" }],
          isTruncated: true,
        },
      ],
    });
    expect(browseCalls).toEqual([{ bucket: undefined, maxKeys: 5, prefix: "docs" }]);
  });

  it("maps browse failures to 502", async () => {
    const connector: OnlineDriveConnector = {
      browse: async () => {
        throw new Error("drive down: signedUrl=https://secret.example/credential-secret");
      },
      download: async () => ({ body: new Uint8Array() }),
    };
    const app = createApp({ onlineDriveConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createConnectorSource(app, spaceId);

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/files`, {
      headers: bearer(readToken),
    });
    expect(response.status).toBe(502);
    const errorBody = await response.json();
    expect(errorBody).toEqual({
      code: SOURCE_OPERATION_FAILURES.onlineDriveRequest.code,
      error: SOURCE_OPERATION_FAILURES.onlineDriveRequest.message,
    });
    expect(JSON.stringify(errorBody)).not.toContain("credential-secret");

    // A non-Error failure falls back to the generic message.
    const nonErrorFailure: unknown = "rejected without an Error";
    const nonErrorApp = createApp({
      onlineDriveConnector: {
        browse: async () => {
          throw nonErrorFailure;
        },
        download: async () => ({ body: new Uint8Array() }),
      },
    });
    const spaceB = await createSpace(nonErrorApp);
    const sourceB = await createConnectorSource(nonErrorApp, spaceB);
    const fallback = await nonErrorApp.request(
      `/knowledge-spaces/${spaceB}/sources/${sourceB}/files`,
      { headers: bearer(readToken) },
    );
    expect(fallback.status).toBe(502);
    expect(await fallback.json()).toEqual({
      code: SOURCE_OPERATION_FAILURES.onlineDriveRequest.code,
      error: SOURCE_OPERATION_FAILURES.onlineDriveRequest.message,
    });
  });
});

describe("online drive import edge branches", () => {
  it("returns 400 for a non-connector source and 501 without a connector", async () => {
    const noConnectorApp = createApp();
    const spaceA = await createSpace(noConnectorApp);
    const connectorSourceId = await createConnectorSource(noConnectorApp, spaceA);
    const notConfigured = await noConnectorApp.request(
      `/knowledge-spaces/${spaceA}/sources/${connectorSourceId}/import-files`,
      {
        body: JSON.stringify({ files: [{ id: "f1", name: "a.txt" }] }),
        headers: json(writeToken),
        method: "POST",
      },
    );
    expect(notConfigured.status).toBe(501);

    const connector: OnlineDriveConnector = {
      browse: async () => ({ buckets: [] }),
      download: async () => ({ body: new Uint8Array() }),
    };
    const app = createApp({ onlineDriveConnector: connector });
    const spaceB = await createSpace(app);
    const webSourceId = await createWebSource(app, spaceB);
    const wrongType = await app.request(
      `/knowledge-spaces/${spaceB}/sources/${webSourceId}/import-files`,
      {
        body: JSON.stringify({ files: [{ id: "f1", name: "a.txt" }] }),
        headers: json(writeToken),
        method: "POST",
      },
    );
    expect(wrongType.status).toBe(400);
  });

  it("imports bucketless files with explicit mime types and isolates download failures", async () => {
    const nonErrorFailure: unknown = "download rejected without an Error";
    const connector: OnlineDriveConnector = {
      browse: async () => ({ buckets: [] }),
      download: async ({ file }) => {
        if (file.id === "bad") {
          throw new Error("download denied");
        }

        if (file.id === "worse") {
          throw nonErrorFailure;
        }

        return { body: new TextEncoder().encode(`content of ${file.id}`) };
      },
    };
    const app = createApp({ onlineDriveConnector: connector });
    const spaceId = await createSpace(app);
    const sourceId = await createConnectorSource(app, spaceId);

    const response = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/import-files`,
      {
        body: JSON.stringify({
          files: [
            { id: "ok", mimeType: "text/plain", name: "plain.txt" },
            { id: "bad", name: "broken.bin" },
            { id: "worse", name: "worse.bin" },
          ],
        }),
        headers: json(writeToken),
        method: "POST",
      },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.documents).toEqual([
      { documentAssetId: expect.any(String), filename: "plain.txt" },
    ]);
    expect(body.failed).toEqual([
      {
        code: SOURCE_OPERATION_FAILURES.onlineDriveFileDownload.code,
        error: SOURCE_OPERATION_FAILURES.onlineDriveFileDownload.message,
        filename: "broken.bin",
      },
      {
        code: SOURCE_OPERATION_FAILURES.onlineDriveFileDownload.code,
        error: SOURCE_OPERATION_FAILURES.onlineDriveFileDownload.message,
        filename: "worse.bin",
      },
    ]);

    // The imported-files provenance omits absent buckets and keeps explicit mime types.
    const source = await getSource(app, spaceId, sourceId);
    expect(source.metadata.importedFiles).toEqual({
      ok: { mimeType: "text/plain", name: "plain.txt" },
    });
    expect(source.metadata.sync).toMatchObject({ failed: 2, imported: 1, requested: 3 });
  });
});

describe("source handlers without optional collaborators", () => {
  interface BareAppOptions {
    legacyMutationEndpointsEnabled?: boolean;
    onlineDocumentConnector?: OnlineDocumentConnector;
    onlineDriveConnector?: OnlineDriveConnector;
    sourceDocumentMaterializer?: SourceDocumentMaterializer;
    websiteCrawlConnector?: WebsiteCrawlConnector;
  }

  function createBareApp(options: BareAppOptions = {}) {
    const app = createKnowledgeGatewayApp();
    app.use("*", async (context, next) => {
      const knowledgeSpaceId = context.req.path.split("/")[2] ?? "";
      context.set("subject", {
        scopes: ["knowledge-spaces:*"],
        subjectId: "u1",
        tenantId: "tenant-1",
      });
      context.set("authorizationDecision", {
        accessContext: {} as never,
        permissionSnapshot: {
          apiAccessRevision: 1,
          callerKind: "interactive",
          candidateGrants: [],
          issuedAt: "2026-07-14T00:00:00.000Z",
          knowledgeSpaceId,
          memberRevision: 1,
          memberRole: "owner",
          policyRevision: 1,
          subjectId: "u1",
          tenantId: "tenant-1",
        },
      });
      context.set("traceId", "trace-source-coverage");
      context.set("rateLimitChecked", true);
      await next();
    });

    const spaces = createInMemoryKnowledgeSpaceRepository({ maxListLimit: 100, maxSpaces: 10 });
    const sources = createInMemorySourceRepository({ maxSources: 100 });
    registerSourceHandlers({
      app,
      ...(options.legacyMutationEndpointsEnabled === undefined
        ? {}
        : { legacyMutationEndpointsEnabled: options.legacyMutationEndpointsEnabled }),
      ...(options.onlineDocumentConnector
        ? { onlineDocumentConnector: options.onlineDocumentConnector }
        : {}),
      ...(options.onlineDriveConnector
        ? { onlineDriveConnector: options.onlineDriveConnector }
        : {}),
      ...(options.sourceDocumentMaterializer
        ? { sourceDocumentMaterializer: options.sourceDocumentMaterializer }
        : {}),
      sources,
      spaces,
      ...(options.websiteCrawlConnector
        ? { websiteCrawlConnector: options.websiteCrawlConnector }
        : {}),
    });

    return { app, sources, spaces };
  }

  async function seedSource(
    repos: { sources: SourceRepository; spaces: KnowledgeSpaceRepository },
    type: "connector" | "web",
  ): Promise<{ sourceId: string; spaceId: string }> {
    const space = await repos.spaces.create({
      name: "Space",
      slug: `space-${type}`,
      tenantId: "tenant-1",
    });
    const source = await repos.sources.create({
      knowledgeSpaceId: space.id,
      name: "Seeded",
      type,
      uri: "https://example.com",
    });

    return { sourceId: source.id, spaceId: space.id };
  }

  it("crawls without a materializer: raw pages come back and sync counters are null", async () => {
    const bare = createBareApp({
      websiteCrawlConnector: {
        crawl: async () => ({
          pages: [{ content: "# A", description: "About A", sourceUrl: "https://example.com/a" }],
        }),
      },
    });
    const { sourceId, spaceId } = await seedSource(bare, "web");

    const response = await bare.app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pages).toEqual([
      { content: "# A", description: "About A", sourceUrl: "https://example.com/a" },
    ]);
    // No materializer: no import bookkeeping fields on the response.
    expect(body.failed).toBeUndefined();
    expect(body.imported).toBeUndefined();
    expect(body.replaced).toBeUndefined();
    expect(body.skipped).toBeUndefined();

    const source = await bare.sources.get({ id: sourceId, knowledgeSpaceId: spaceId });
    expect(source?.status).toBe("active");
    expect(source?.metadata.sync).toEqual({
      completed: null,
      failed: null,
      imported: null,
      pageCount: 1,
      replaced: null,
      skipped: null,
      status: null,
      total: null,
    });
  });

  it("rejects all legacy synchronous mutation endpoints when durable Source product is enabled", async () => {
    const crawl = vi.fn(async () => ({ pages: [] }));
    const bare = createBareApp({
      legacyMutationEndpointsEnabled: false,
      onlineDocumentConnector: {
        getPageContent: vi.fn(async () => ({ content: "x", pageId: "p1" })),
        listPages: vi.fn(async () => ({ workspaces: [] })),
      },
      onlineDriveConnector: {
        browse: vi.fn(async () => ({ buckets: [] })),
        download: vi.fn(async () => ({ body: new Uint8Array() })),
      },
      websiteCrawlConnector: { crawl },
    });
    const web = await seedSource(bare, "web");
    const connector = await seedSource(bare, "connector");

    const responses = await Promise.all([
      bare.app.request(`/knowledge-spaces/${web.spaceId}/sources/${web.sourceId}/crawl`, {
        method: "POST",
      }),
      bare.app.request(
        `/knowledge-spaces/${connector.spaceId}/sources/${connector.sourceId}/import`,
        {
          body: JSON.stringify({
            pages: [{ pageId: "p1", type: "page", workspaceId: "workspace-1" }],
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ),
      bare.app.request(
        `/knowledge-spaces/${connector.spaceId}/sources/${connector.sourceId}/import-files`,
        {
          body: JSON.stringify({ files: [{ id: "f1", name: "f1.txt" }] }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([409, 409, 409]);
    expect(crawl).not.toHaveBeenCalled();
  });

  it("returns 501 for page and file imports when the materializer is missing", async () => {
    const bare = createBareApp({
      onlineDocumentConnector: {
        getPageContent: async ({ page }) => ({ content: "x", pageId: page.pageId }),
        listPages: async () => ({ workspaces: [] }),
      },
      onlineDriveConnector: {
        browse: async () => ({ buckets: [] }),
        download: async () => ({ body: new Uint8Array() }),
      },
    });
    const { sourceId, spaceId } = await seedSource(bare, "connector");

    const pageImport = await bare.app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/import`,
      {
        body: JSON.stringify({ pages: [{ pageId: "p1", type: "page", workspaceId: "w1" }] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(pageImport.status).toBe(501);

    const fileImport = await bare.app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/import-files`,
      {
        body: JSON.stringify({ files: [{ id: "f1", name: "a.txt" }] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(fileImport.status).toBe(501);
  });

  it("marks the source errored and returns 502 when materialization fails", async () => {
    const failingMaterializer: SourceDocumentMaterializer = {
      compensate: async () => undefined,
      materialize: async () => {
        throw new Error("materialize exploded with credential-secret");
      },
    };
    const bare = createBareApp({
      onlineDocumentConnector: {
        getPageContent: async ({ page }) => ({ content: "c", pageId: page.pageId }),
        listPages: async () => ({ workspaces: [] }),
      },
      onlineDriveConnector: {
        browse: async () => ({ buckets: [] }),
        download: async () => ({ body: new TextEncoder().encode("b") }),
      },
      sourceDocumentMaterializer: failingMaterializer,
    });
    const { sourceId, spaceId } = await seedSource(bare, "connector");

    const pageImport = await bare.app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/import`,
      {
        body: JSON.stringify({ pages: [{ pageId: "p1", type: "page", workspaceId: "w1" }] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(pageImport.status).toBe(502);
    const pageError = await pageImport.json();
    expect(pageError).toEqual({
      code: SOURCE_OPERATION_FAILURES.onlineDocumentImport.code,
      error: SOURCE_OPERATION_FAILURES.onlineDocumentImport.message,
    });
    expect(JSON.stringify(pageError)).not.toContain("credential-secret");

    const afterPages = await bare.sources.get({ id: sourceId, knowledgeSpaceId: spaceId });
    expect(afterPages?.status).toBe("error");
    expect(afterPages?.metadata.sync).toEqual({
      error: SOURCE_OPERATION_FAILURES.onlineDocumentImport.message,
      errorCode: SOURCE_OPERATION_FAILURES.onlineDocumentImport.code,
    });
    expect(JSON.stringify(afterPages?.metadata)).not.toContain("credential-secret");

    const fileImport = await bare.app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/import-files`,
      {
        body: JSON.stringify({ files: [{ id: "f1", name: "a.txt" }] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(fileImport.status).toBe(502);
    const fileError = await fileImport.json();
    expect(fileError).toEqual({
      code: SOURCE_OPERATION_FAILURES.onlineDriveImport.code,
      error: SOURCE_OPERATION_FAILURES.onlineDriveImport.message,
    });
    expect(JSON.stringify(fileError)).not.toContain("credential-secret");

    const afterFiles = await bare.sources.get({ id: sourceId, knowledgeSpaceId: spaceId });
    expect(afterFiles?.status).toBe("error");
    expect(afterFiles?.metadata.sync).toEqual({
      error: SOURCE_OPERATION_FAILURES.onlineDriveImport.message,
      errorCode: SOURCE_OPERATION_FAILURES.onlineDriveImport.code,
    });
    expect(JSON.stringify(afterFiles?.metadata)).not.toContain("credential-secret");
  });

  it("falls back to generic import failure messages when materialization throws a non-Error", async () => {
    const nonErrorFailure: unknown = "materialize rejected without an Error";
    const bare = createBareApp({
      onlineDocumentConnector: {
        getPageContent: async ({ page }) => ({ content: "c", pageId: page.pageId }),
        listPages: async () => ({ workspaces: [] }),
      },
      onlineDriveConnector: {
        browse: async () => ({ buckets: [] }),
        download: async () => ({ body: new TextEncoder().encode("b") }),
      },
      sourceDocumentMaterializer: {
        compensate: async () => undefined,
        materialize: async () => {
          throw nonErrorFailure;
        },
      },
    });
    const { sourceId, spaceId } = await seedSource(bare, "connector");

    const pageImport = await bare.app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/import`,
      {
        body: JSON.stringify({ pages: [{ pageId: "p1", type: "page", workspaceId: "w1" }] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(pageImport.status).toBe(502);
    expect(await pageImport.json()).toEqual({
      code: SOURCE_OPERATION_FAILURES.onlineDocumentImport.code,
      error: SOURCE_OPERATION_FAILURES.onlineDocumentImport.message,
    });

    const afterPages = await bare.sources.get({ id: sourceId, knowledgeSpaceId: spaceId });
    expect(afterPages?.metadata.sync).toEqual({
      error: SOURCE_OPERATION_FAILURES.onlineDocumentImport.message,
      errorCode: SOURCE_OPERATION_FAILURES.onlineDocumentImport.code,
    });

    const fileImport = await bare.app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/import-files`,
      {
        body: JSON.stringify({ files: [{ id: "f1", name: "a.txt" }] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(fileImport.status).toBe(502);
    expect(await fileImport.json()).toEqual({
      code: SOURCE_OPERATION_FAILURES.onlineDriveImport.code,
      error: SOURCE_OPERATION_FAILURES.onlineDriveImport.message,
    });

    const afterFiles = await bare.sources.get({ id: sourceId, knowledgeSpaceId: spaceId });
    expect(afterFiles?.status).toBe("error");
    expect(afterFiles?.metadata.sync).toEqual({
      error: SOURCE_OPERATION_FAILURES.onlineDriveImport.message,
      errorCode: SOURCE_OPERATION_FAILURES.onlineDriveImport.code,
    });
  });
});

describe("source handler helper functions", () => {
  it("builds unique online-document filenames with degraded slugs", () => {
    expect(onlineDocumentFilename("Hello World", "p 1")).toBe("Hello-World-p-1.md");
    // Page id slugs to nothing: fall back to the base name alone.
    expect(onlineDocumentFilename("Notes", "///")).toBe("Notes.md");
    // Nothing slugs to anything: fall back to the generic page name.
    expect(onlineDocumentFilename("###", "$$$")).toBe("page.md");
  });

  it("maps filenames to mime types with an octet-stream fallback", () => {
    expect(mimeTypeForFilename("report.PDF")).toBe("application/pdf");
    expect(mimeTypeForFilename("archive.zip")).toBe("application/octet-stream");
    expect(mimeTypeForFilename("README")).toBe("application/octet-stream");
  });

  it("reads imported page state defensively", () => {
    expect(readImportedState({})).toEqual({});
    expect(readImportedState({ imported: ["nope"] })).toEqual({});
    expect(
      readImportedState({
        imported: {
          a: "not an object",
          b: { documentAssetId: 42, lastEditedTime: 42 },
          c: { documentAssetId: "d1", lastEditedTime: "t1" },
          d: null,
          e: ["array"],
        },
      }),
    ).toEqual({ b: {}, c: { documentAssetId: "d1", lastEditedTime: "t1" } });
  });

  it("reads imported file state defensively", () => {
    expect(readImportedFilesState({})).toEqual({});
    expect(readImportedFilesState({ importedFiles: "nope" })).toEqual({});
    expect(
      readImportedFilesState({
        importedFiles: {
          a: { name: "" },
          b: { bucket: 3, mimeType: "text/plain", name: "f.txt" },
          c: ["array"],
          d: { bucket: "b1", name: "g.txt" },
        },
      }),
    ).toEqual({
      b: { mimeType: "text/plain", name: "f.txt" },
      d: { bucket: "b1", name: "g.txt" },
    });
  });
});
