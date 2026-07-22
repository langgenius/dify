import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";
import { SourceConnectionError } from "./source-connection";
import { registerSourceProductHandlers } from "./source-product-handlers";
import { SourceWorkflowError, type SourceWorkflowRun } from "./source-product-workflow";
import { SourceProviderUnavailableError } from "./source-provider-catalog";

const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const runId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const connectionId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";

describe("source-product handlers", () => {
  it("exposes crawl preview as a separate durable endpoint without changing legacy crawl", async () => {
    const createPreview = vi.fn(async () => run("crawl-preview"));
    const app = sourceProductApp({ createPreview });

    const missingKey = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl-preview`,
      { method: "POST" },
    );
    expect(missingKey.status).toBe(400);
    expect(createPreview).not.toHaveBeenCalled();

    const accepted = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl-preview`,
      { headers: { "idempotency-key": "preview-1" }, method: "POST" },
    );
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({
      id: runId,
      kind: "crawl-preview",
      state: "queued",
    });
    expect(createPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        callerKind: "interactive",
        idempotencyKey: "preview-1",
        knowledgeSpaceId: spaceId,
        sourceId,
        subject: { scopes: [], subjectId: "editor-a", tenantId: "tenant-a" },
      }),
    );
  });

  it("validates and forwards durable provider imports with idempotency provenance", async () => {
    const createImport = vi.fn(async () => run("online-drive-import"));
    const app = sourceProductApp({ createImport });
    const response = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/workflow-imports`,
      {
        body: JSON.stringify({
          items: [{ id: "file-a", name: "A.txt", providerItemId: "provider-file-a" }],
          kind: "online-drive-import",
        }),
        headers: { "content-type": "application/json", "idempotency-key": "import-1" },
        method: "POST",
      },
    );

    expect(response.status).toBe(202);
    expect(createImport).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "import-1",
        items: [{ id: "file-a", name: "A.txt", providerItemId: "provider-file-a" }],
        kind: "online-drive-import",
        knowledgeSpaceId: spaceId,
        sourceId,
      }),
    );
  });

  it("maps workflow errors and connection authorization denial without leaking internals", async () => {
    const createPreview = vi.fn(async () => {
      throw new SourceWorkflowError("SOURCE_WORKFLOW_NOT_FOUND", "source is hidden");
    });
    const authorization = {
      authorize: vi.fn(async () => {
        throw new KnowledgeSpaceAuthorizationError(
          "KNOWLEDGE_SPACE_ROLE_DENIED",
          "write access denied",
        );
      }),
    };
    const app = sourceProductApp({ authorization, createPreview });

    const hidden = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/crawl-preview`,
      { headers: { "idempotency-key": "preview-hidden" }, method: "POST" },
    );
    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toEqual({
      code: "SOURCE_WORKFLOW_NOT_FOUND",
      error: "source is hidden",
    });

    const denied = await app.request(`/knowledge-spaces/${spaceId}/source-connections`, {
      body: JSON.stringify({
        authKind: "api-key",
        credentials: { token: "must-never-echo" },
        name: "Denied",
        providerId: "provider-a",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(denied.status).toBe(403);
    expect(JSON.stringify(await denied.json())).not.toContain("must-never-echo");
  });

  it("preserves connection pagination while allow-listing the public response", async () => {
    const list = vi.fn(async () => ({
      items: [
        {
          authKind: "oauth2" as const,
          configuration: { region: "us-east-1" },
          createdAt: "2026-07-14T12:00:00.000Z",
          credentialRef: "source-secret:v1:must-never-leak",
          errorCode: "TOKEN_EXPIRED",
          expiresAt: "2026-07-15T12:00:00.000Z",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43",
          knowledgeSpaceId: spaceId,
          lastErrorCode: "provider-secret-detail",
          name: "Drive",
          providerId: "drive-a",
          scopes: ["files.read"],
          status: "active" as const,
          tenantId: "tenant-a",
          updatedAt: "2026-07-14T12:00:00.000Z",
          version: 2,
        },
      ],
      nextCursor: "opaque-next",
    }));
    const app = sourceProductApp({ connections: { list } });

    const response = await app.request(
      `/knowledge-spaces/${spaceId}/source-connections?limit=1&cursor=opaque-before`,
    );
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      cursor: "opaque-before",
      knowledgeSpaceId: spaceId,
      limit: 1,
      tenantId: "tenant-a",
    });
    const body = await response.json();
    expect(body).toMatchObject({
      items: [{ errorCode: "TOKEN_EXPIRED", name: "Drive" }],
      nextCursor: "opaque-next",
    });
    expect(JSON.stringify(body)).not.toMatch(
      /credentialRef|lastErrorCode|tenantId|must-never-leak|provider-secret-detail/u,
    );
  });

  it("forwards bounded bulk requests and redacts durable authorization provenance", async () => {
    const createBulk = vi.fn(async () => ({
      ...run("bulk"),
      payload: { internalSelection: [sourceId] },
      progressCompleted: 1,
      progressFailed: 1,
      progressTotal: 2,
    }));
    const app = sourceProductApp({ createBulk });

    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/bulk`, {
      body: JSON.stringify({ action: "sync", sourceIds: [sourceId] }),
      headers: { "content-type": "application/json", "idempotency-key": "bulk-1" },
      method: "POST",
    });
    expect(response.status).toBe(202);
    expect(createBulk).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sync",
        idempotencyKey: "bulk-1",
        knowledgeSpaceId: spaceId,
        sourceIds: [sourceId],
        subject: { scopes: [], subjectId: "editor-a", tenantId: "tenant-a" },
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({ progressCompleted: 1, progressFailed: 1, progressTotal: 2 });
    expect(JSON.stringify(body)).not.toMatch(
      /idempotencyKey|internalSelection|permissionSnapshot|requestedBySubjectId|tenantId/u,
    );
  });

  it("returns bounded per-Source bulk results without child job identities", async () => {
    const listBulkItems = vi.fn(async () => ({
      items: [
        {
          action: "remove" as const,
          childRunId: "internal-child",
          deletionJobId: "internal-deletion",
          errorCode: "SOURCE_DURABLE_DELETION_FAILED",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c48",
          reason: "Durable source deletion failed",
          runId,
          sourceId,
          status: "failed" as const,
          updatedAt: "2026-07-14T12:01:00.000Z",
        },
      ],
      nextCursor: "opaque-bulk-next",
    }));
    const app = sourceProductApp({ listBulkItems });

    const response = await app.request(
      `/knowledge-spaces/${spaceId}/source-workflows/${runId}/bulk-items?limit=1`,
    );
    expect(response.status).toBe(200);
    expect(listBulkItems).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeSpaceId: spaceId,
        limit: 1,
        runId,
        subject: { scopes: [], subjectId: "editor-a", tenantId: "tenant-a" },
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      items: [{ action: "remove", sourceId, status: "failed" }],
      nextCursor: "opaque-bulk-next",
    });
    expect(JSON.stringify(body)).not.toMatch(/childRunId|deletionJobId|internal-/u);
  });

  it("serves provider metadata and the complete public connection lifecycle", async () => {
    const connection = publicConnection();
    const create = vi.fn(async () => connection);
    const startOAuth = vi.fn(async () => ({
      authorizationUrl: "https://provider.test/authorize",
      connection,
    }));
    const callback = vi.fn(async () => connection);
    const list = vi.fn(async () => ({ items: [connection] }));
    const get = vi.fn().mockResolvedValueOnce(connection).mockResolvedValueOnce(null);
    const refresh = vi.fn(async () => connection);
    const revoke = vi.fn(async () => ({ ...connection, status: "revoked" as const, version: 3 }));
    const app = sourceProductApp({
      connections: { callback, create, get, list, refresh, revoke, startOAuth },
      providers: {
        list: vi.fn(async () => [
          {
            authKinds: ["api-key", "oauth2"],
            available: true,
            capabilities: ["online-drive"],
            configuration: [
              {
                description: "Region",
                name: "region",
                required: false,
                secret: false,
                type: "string",
              },
            ],
            displayName: "Drive",
            id: "drive",
          },
        ]),
      },
    });

    const providers = await app.request("/source-providers");
    expect(providers.status).toBe(200);
    await expect(providers.json()).resolves.toMatchObject({
      items: [{ authKinds: ["api-key", "oauth2"], capabilities: ["online-drive"] }],
    });

    const created = await app.request(`/knowledge-spaces/${spaceId}/source-connections`, {
      body: JSON.stringify({
        authKind: "api-key",
        configuration: { region: "us-east-1" },
        credentials: { token: "secret-create" },
        name: "Drive",
        providerId: "drive",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: { region: "us-east-1" },
        knowledgeSpaceId: spaceId,
        tenantId: "tenant-a",
      }),
    );
    expect(JSON.stringify(await created.json())).not.toContain("secret-create");

    const oauth = await app.request(`/knowledge-spaces/${spaceId}/source-connections/oauth`, {
      body: JSON.stringify({
        name: "Drive OAuth",
        providerId: "drive",
        redirectUri: "https://app.test/callback",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(oauth.status).toBe(201);
    expect(startOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: [], tenantId: "tenant-a" }),
    );
    await expect(oauth.json()).resolves.toMatchObject({
      authorizationUrl: "https://provider.test/authorize",
      connection: { id: connectionId },
    });

    const completed = await app.request("/source-oauth/callback", {
      body: JSON.stringify({ code: "oauth-code", state: "s".repeat(32) }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(completed.status).toBe(200);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ code: "oauth-code", state: "s".repeat(32) }),
    );

    const listed = await app.request(`/knowledge-spaces/${spaceId}/source-connections`);
    expect(listed.status).toBe(200);
    expect(list).toHaveBeenCalledWith({
      knowledgeSpaceId: spaceId,
      limit: 50,
      tenantId: "tenant-a",
    });
    await expect(listed.json()).resolves.toEqual({ items: [connection] });

    const found = await app.request(
      `/knowledge-spaces/${spaceId}/source-connections/${connectionId}`,
    );
    expect(found.status).toBe(200);
    const missing = await app.request(
      `/knowledge-spaces/${spaceId}/source-connections/${connectionId}`,
    );
    expect(missing.status).toBe(404);

    const refreshed = await app.request(
      `/knowledge-spaces/${spaceId}/source-connections/${connectionId}/refresh`,
      {
        body: JSON.stringify({ expectedVersion: 2 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(refreshed.status).toBe(200);
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId, expectedVersion: 2 }),
    );
    const revoked = await app.request(
      `/knowledge-spaces/${spaceId}/source-connections/${connectionId}?expectedVersion=2`,
      { method: "DELETE" },
    );
    expect(revoked.status).toBe(200);
    await expect(revoked.json()).resolves.toMatchObject({ status: "revoked", version: 3 });
  });

  it("forwards workflow history, policy, mutation, and selection endpoints", async () => {
    const createSync = vi.fn(async () => run("sync"));
    const getSyncPolicy = vi.fn().mockResolvedValueOnce(syncPolicy()).mockResolvedValueOnce(null);
    const putSyncPolicy = vi.fn(async () =>
      syncPolicy({
        customIntervalSeconds: 7_200,
        mode: "custom",
        nextRunAt: "2026-07-14T14:00:00.000Z",
      }),
    );
    const list = vi.fn(async () => ({ items: [run("sync")], nextCursor: "workflow-next" }));
    const get = vi.fn().mockResolvedValueOnce(run("sync")).mockResolvedValueOnce(null);
    const cancel = vi.fn().mockResolvedValueOnce(run("sync")).mockResolvedValueOnce(null);
    const retry = vi.fn().mockResolvedValueOnce(run("sync")).mockResolvedValueOnce(null);
    const selectCrawlPages = vi.fn(async () => run("online-document-import"));
    const app = sourceProductApp({
      workflows: {
        cancel,
        createSync,
        get,
        getSyncPolicy,
        list,
        putSyncPolicy,
        retry,
        selectCrawlPages,
      },
    });

    const synced = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/sync`, {
      headers: { "idempotency-key": "sync-1" },
      method: "POST",
    });
    expect(synced.status).toBe(202);
    expect(createSync).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "sync-1", sourceId }),
    );

    const policy = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/sync-policy`,
    );
    expect(policy.status).toBe(200);
    await expect(policy.json()).resolves.toMatchObject({ mode: "provider", revision: 1 });
    const missingPolicy = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/sync-policy`,
    );
    expect(missingPolicy.status).toBe(404);

    const updatedPolicy = await app.request(
      `/knowledge-spaces/${spaceId}/sources/${sourceId}/sync-policy`,
      {
        body: JSON.stringify({
          customIntervalSeconds: 7_200,
          enabled: true,
          expectedRevision: 1,
          expectedSourceVersion: 2,
          mode: "custom",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(updatedPolicy.status).toBe(200);
    expect(putSyncPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ customIntervalSeconds: 7_200, expectedRevision: 1 }),
    );
    await expect(updatedPolicy.json()).resolves.toMatchObject({
      customIntervalSeconds: 7_200,
      nextRunAt: "2026-07-14T14:00:00.000Z",
    });

    const history = await app.request(
      `/knowledge-spaces/${spaceId}/source-workflows?limit=1&cursor=before&sourceId=${sourceId}`,
    );
    expect(history.status).toBe(200);
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "before", limit: 1, sourceId }),
    );
    await expect(history.json()).resolves.toMatchObject({ nextCursor: "workflow-next" });

    expect(
      (await app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}`)).status,
    ).toBe(200);
    expect(
      (await app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}`)).status,
    ).toBe(404);

    const canceled = await app.request(
      `/knowledge-spaces/${spaceId}/source-workflows/${runId}/cancel`,
      {
        body: JSON.stringify({ reason: "operator request" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(canceled.status).toBe(200);
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ reason: "operator request" }));
    const missingCancel = await app.request(
      `/knowledge-spaces/${spaceId}/source-workflows/${runId}/cancel`,
      {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(missingCancel.status).toBe(404);
    expect(cancel).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ reason: expect.anything() }),
    );

    expect(
      (
        await app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}/retry`, {
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}/retry`, {
          method: "POST",
        })
      ).status,
    ).toBe(404);

    const selection = await app.request(
      `/knowledge-spaces/${spaceId}/source-workflows/${runId}/selection`,
      {
        body: JSON.stringify({ pageIds: ["page-a"] }),
        headers: { "content-type": "application/json", "idempotency-key": "selection-1" },
        method: "POST",
      },
    );
    expect(selection.status).toBe(202);
    expect(selectCrawlPages).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "selection-1", pageIds: ["page-a"] }),
    );
  });

  it("allow-lists crawl preview pages and conceals absent workflows", async () => {
    const listCrawlPages = vi.fn(async () => ({
      items: [
        {
          contentHash: "a".repeat(64),
          contentObjectKey: "secret/object-a",
          createdAt: "2026-07-14T12:00:00.000Z",
          description: "Description A",
          etag: "etag-a",
          id: "internal-row-a",
          pageId: "page-a",
          runId,
          sourceUrl: "https://example.test/a",
          title: "Title A",
        },
        {
          contentHash: "b".repeat(64),
          contentObjectKey: "secret/object-b",
          createdAt: "2026-07-14T12:00:00.000Z",
          id: "internal-row-b",
          pageId: "page-b",
          runId,
          sourceUrl: "https://example.test/b",
        },
      ],
      nextCursor: "page-next",
    }));
    const app = sourceProductApp({
      repository: { listCrawlPages },
      workflows: { get: vi.fn(async () => run("crawl-preview")) },
    });
    const response = await app.request(
      `/knowledge-spaces/${spaceId}/source-workflows/${runId}/pages?limit=2&cursor=before`,
    );
    expect(response.status).toBe(200);
    expect(listCrawlPages).toHaveBeenCalledWith({ cursor: "before", limit: 2, runId });
    const body = await response.json();
    expect(body).toEqual({
      items: [
        {
          description: "Description A",
          etag: "etag-a",
          pageId: "page-a",
          sourceUrl: "https://example.test/a",
          title: "Title A",
        },
        { pageId: "page-b", sourceUrl: "https://example.test/b" },
      ],
      nextCursor: "page-next",
    });
    expect(JSON.stringify(body)).not.toMatch(/contentHash|contentObjectKey|internal-row|runId/u);

    const hiddenApp = sourceProductApp({ workflows: { get: vi.fn(async () => null) } });
    const hidden = await hiddenApp.request(
      `/knowledge-spaces/${spaceId}/source-workflows/${runId}/pages`,
    );
    expect(hidden.status).toBe(404);
  });

  it("propagates API-key and capability principals to workflows", async () => {
    const createSync = vi.fn(async () => run("sync"));
    const app = sourceProductApp({
      apiKey: { id: "api-key-a", revision: 4 },
      callerKind: "api_key",
      capability: {
        contentScopeIds: ["grant:a"],
        grantId: "capability-a",
      },
      createSync,
    });
    const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/sync`, {
      headers: { "idempotency-key": "cap-sync" },
      method: "POST",
    });
    expect(response.status).toBe(202);
    expect(createSync).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: { id: "api-key-a", revision: 4 },
        callerKind: "api_key",
        capability: { contentScopeIds: ["grant:a"], grantId: "capability-a" },
      }),
    );
  });

  it("maps every stable connection failure family to its public status", async () => {
    const cases: readonly [unknown, number][] = [
      [new KnowledgeSpaceAuthorizationError("KNOWLEDGE_SPACE_ROLE_DENIED", "denied"), 403],
      [new SourceProviderUnavailableError("offline-provider"), 503],
      [new SourceConnectionError("SOURCE_CONNECTION_NOT_FOUND", "missing"), 404],
      [new SourceConnectionError("SOURCE_CONNECTION_CONFLICT", "conflict"), 409],
      [new SourceConnectionError("SOURCE_CONNECTION_UNAVAILABLE", "offline"), 503],
      [new SourceConnectionError("SOURCE_CONNECTION_CREDENTIAL_UNAVAILABLE", "credential"), 400],
      [new SourceConnectionError("SOURCE_CONNECTION_PROVIDER_FAILED", "provider"), 502],
      [new SourceConnectionError("SOURCE_CONNECTION_PERSIST_FAILED", "persist"), 502],
      [new SourceConnectionError("SOURCE_CONNECTION_START_FAILED", "start"), 502],
      [new SourceConnectionError("SOURCE_CONNECTION_CALLBACK_FAILED", "callback"), 502],
      [new SourceConnectionError("SOURCE_CONNECTION_INVALID", "invalid"), 400],
    ];
    for (const [error, expectedStatus] of cases) {
      const app = sourceProductApp({
        connections: { create: vi.fn(async () => Promise.reject(error)) },
      });
      const response = await app.request(`/knowledge-spaces/${spaceId}/source-connections`, {
        body: JSON.stringify({
          authKind: "api-key",
          credentials: { token: "never-echo" },
          name: "Failure",
          providerId: "provider-a",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      expect(response.status, String((error as Error).message)).toBe(expectedStatus);
      expect(JSON.stringify(await response.json())).not.toContain("never-echo");
    }

    const unknown = sourceProductApp({
      catchErrors: true,
      connections: { create: vi.fn(async () => Promise.reject(new Error("unknown connection"))) },
    });
    expect(
      (
        await unknown.request(`/knowledge-spaces/${spaceId}/source-connections`, {
          body: JSON.stringify({
            authKind: "api-key",
            credentials: {},
            name: "Unknown",
            providerId: "provider-a",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(500);
  });

  it("maps workflow failure families and rethrows unexpected errors", async () => {
    const cases: readonly [unknown, number][] = [
      [new KnowledgeSpaceAuthorizationError("KNOWLEDGE_SPACE_ROLE_DENIED", "denied"), 403],
      [new SourceWorkflowError("SOURCE_WORKFLOW_NOT_FOUND", "missing"), 404],
      [new SourceWorkflowError("SOURCE_WORKFLOW_CONFLICT", "conflict"), 409],
      [new SourceWorkflowError("SOURCE_WORKFLOW_ATTEMPTS_EXHAUSTED", "exhausted"), 409],
      [new SourceWorkflowError("SOURCE_WORKFLOW_INPUT_INVALID", "invalid"), 400],
    ];
    for (const [error, expectedStatus] of cases) {
      const app = sourceProductApp({ createSync: vi.fn(async () => Promise.reject(error)) });
      const response = await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/sync`, {
        headers: { "idempotency-key": "failure" },
        method: "POST",
      });
      expect(response.status, String((error as Error).message)).toBe(expectedStatus);
    }

    const unknown = sourceProductApp({
      catchErrors: true,
      createSync: vi.fn(async () => Promise.reject(new Error("unknown workflow"))),
    });
    expect(
      (
        await unknown.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/sync`, {
          headers: { "idempotency-key": "unknown" },
          method: "POST",
        })
      ).status,
    ).toBe(500);

    const authorizationUnknown = sourceProductApp({
      authorization: { authorize: vi.fn(async () => Promise.reject(new Error("auth offline"))) },
      catchErrors: true,
      connections: { list: vi.fn(async () => ({ items: [] })) },
    });
    expect(
      (await authorizationUnknown.request(`/knowledge-spaces/${spaceId}/source-connections`))
        .status,
    ).toBe(500);
  });

  it("maps authorization denial on every connection route", async () => {
    const authorization = {
      authorize: vi.fn(async () => {
        throw new KnowledgeSpaceAuthorizationError("KNOWLEDGE_SPACE_ROLE_DENIED", "access denied");
      }),
    };
    const app = sourceProductApp({ authorization });
    const requests = [
      app.request(`/knowledge-spaces/${spaceId}/source-connections/oauth`, {
        body: JSON.stringify({
          configuration: { region: "us" },
          name: "OAuth",
          providerId: "drive",
          redirectUri: "https://app.test/callback",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      app.request(`/knowledge-spaces/${spaceId}/source-connections`),
      app.request(`/knowledge-spaces/${spaceId}/source-connections/${connectionId}`),
      app.request(`/knowledge-spaces/${spaceId}/source-connections/${connectionId}/refresh`, {
        body: JSON.stringify({ expectedVersion: 2 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      app.request(
        `/knowledge-spaces/${spaceId}/source-connections/${connectionId}?expectedVersion=2`,
        { method: "DELETE" },
      ),
    ];
    for (const response of await Promise.all(requests)) expect(response.status).toBe(403);
  });

  it("routes connection failures from OAuth, list, refresh, and revoke", async () => {
    const failure = () =>
      Promise.reject(new SourceConnectionError("SOURCE_CONNECTION_INVALID", "invalid"));
    const app = sourceProductApp({
      connections: {
        callback: vi.fn(failure),
        list: vi.fn(failure),
        refresh: vi.fn(failure),
        revoke: vi.fn(failure),
        startOAuth: vi.fn(failure),
      },
    });
    const requests = [
      app.request(`/knowledge-spaces/${spaceId}/source-connections/oauth`, {
        body: JSON.stringify({
          name: "OAuth",
          providerId: "drive",
          redirectUri: "https://app.test/callback",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      app.request("/source-oauth/callback", {
        body: JSON.stringify({ code: "code", state: "s".repeat(32) }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      app.request(`/knowledge-spaces/${spaceId}/source-connections`),
      app.request(`/knowledge-spaces/${spaceId}/source-connections/${connectionId}/refresh`, {
        body: JSON.stringify({ expectedVersion: 2 }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      app.request(
        `/knowledge-spaces/${spaceId}/source-connections/${connectionId}?expectedVersion=2`,
        { method: "DELETE" },
      ),
    ];
    for (const response of await Promise.all(requests)) expect(response.status).toBe(400);
  });

  it("routes stable workflow failures from every remaining workflow endpoint", async () => {
    const failure = () =>
      Promise.reject(new SourceWorkflowError("SOURCE_WORKFLOW_INPUT_INVALID", "invalid"));
    const app = sourceProductApp({
      workflows: {
        cancel: vi.fn(failure),
        createBulk: vi.fn(failure),
        createImport: vi.fn(failure),
        get: vi.fn(failure),
        getSyncPolicy: vi.fn(failure),
        list: vi.fn(failure),
        listBulkItems: vi.fn(failure),
        putSyncPolicy: vi.fn(failure),
        retry: vi.fn(failure),
        selectCrawlPages: vi.fn(failure),
      },
    });
    const requests = [
      app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/workflow-imports`, {
        body: JSON.stringify({
          items: [{ id: "file-a", name: "A.txt", providerItemId: "provider-file-a" }],
          kind: "online-drive-import",
        }),
        headers: { "content-type": "application/json", "idempotency-key": "import-fail" },
        method: "POST",
      }),
      app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/sync-policy`),
      app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/sync-policy`, {
        body: JSON.stringify({
          enabled: true,
          expectedRevision: 1,
          expectedSourceVersion: 2,
          mode: "provider",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      app.request(`/knowledge-spaces/${spaceId}/sources/bulk`, {
        body: JSON.stringify({ action: "sync", sourceIds: [sourceId] }),
        headers: { "content-type": "application/json", "idempotency-key": "bulk-fail" },
        method: "POST",
      }),
      app.request(`/knowledge-spaces/${spaceId}/source-workflows`),
      app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}`),
      app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}/bulk-items`),
      app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}/cancel`, {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}/retry`, {
        method: "POST",
      }),
      app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}/selection`, {
        body: JSON.stringify({ pageIds: ["page-a"] }),
        headers: { "content-type": "application/json", "idempotency-key": "select-fail" },
        method: "POST",
      }),
    ];
    for (const response of await Promise.all(requests)) expect(response.status).toBe(400);
  });

  it("covers absent pagination, policy, bulk-item, page, and caller-kind optionals", async () => {
    const getSyncPolicy = vi.fn(async () => syncPolicy({ nextRunAt: undefined }));
    const putSyncPolicy = vi.fn(async () =>
      syncPolicy({ customIntervalSeconds: undefined, nextRunAt: undefined }),
    );
    const list = vi.fn(async () => ({ items: [] }));
    const listBulkItems = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            action: "sync",
            id: "item-a",
            runId,
            sourceId,
            status: "completed",
            updatedAt: "2026-07-14T12:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce(null);
    const listCrawlPages = vi.fn(async () => ({
      items: [{ pageId: "page-a", sourceUrl: "https://example.test/a" }],
    }));
    const app = sourceProductApp({
      omitCallerKind: true,
      repository: { listCrawlPages },
      workflows: {
        createSync: vi.fn(async () => run("sync")),
        get: vi.fn(async () => run("crawl-preview")),
        getSyncPolicy,
        list,
        listBulkItems,
        putSyncPolicy,
      },
    });

    expect(
      (await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/sync-policy`)).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/sync-policy`, {
          body: JSON.stringify({
            enabled: true,
            expectedRevision: 1,
            expectedSourceVersion: 2,
            mode: "provider",
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    expect(putSyncPolicy).toHaveBeenCalledWith(
      expect.not.objectContaining({ customIntervalSeconds: expect.anything() }),
    );
    expect((await app.request(`/knowledge-spaces/${spaceId}/source-workflows`)).status).toBe(200);
    expect(
      (await app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}/bulk-items`))
        .status,
    ).toBe(200);
    expect(
      (await app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}/bulk-items`))
        .status,
    ).toBe(404);
    expect(
      (await app.request(`/knowledge-spaces/${spaceId}/source-workflows/${runId}/pages`)).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/knowledge-spaces/${spaceId}/sources/${sourceId}/sync`, {
          headers: { "idempotency-key": "default-caller" },
          method: "POST",
        })
      ).status,
    ).toBe(202);
  });
});

function sourceProductApp(overrides: {
  readonly apiKey?: object | undefined;
  readonly authorization?: object | undefined;
  readonly callerKind?: "interactive" | "api_key" | "mcp" | "agent" | undefined;
  readonly capability?: object | undefined;
  readonly catchErrors?: boolean | undefined;
  readonly connections?: object | undefined;
  readonly createBulk?: ((input: never) => Promise<SourceWorkflowRun>) | undefined;
  readonly createImport?: ((input: never) => Promise<SourceWorkflowRun>) | undefined;
  readonly createPreview?: ((input: never) => Promise<SourceWorkflowRun>) | undefined;
  readonly createSync?: ((input: never) => Promise<SourceWorkflowRun>) | undefined;
  readonly listBulkItems?: ((input: never) => Promise<unknown>) | undefined;
  readonly omitCallerKind?: boolean | undefined;
  readonly providers?: object | undefined;
  readonly repository?: object | undefined;
  readonly workflows?: object | undefined;
}) {
  const app = new OpenAPIHono<KnowledgeGatewayEnv>();
  if (overrides.catchErrors) {
    app.onError((error, context) => context.json({ error: error.message }, 500));
  }
  app.use("*", async (context, next) => {
    context.set("subject", { scopes: [], subjectId: "editor-a", tenantId: "tenant-a" });
    if (!overrides.omitCallerKind) context.set("callerKind", overrides.callerKind ?? "interactive");
    if (overrides.apiKey) context.set("authenticatedApiKey", overrides.apiKey as never);
    if (overrides.capability) context.set("capabilityV2Grant", overrides.capability as never);
    await next();
  });
  registerSourceProductHandlers({
    app,
    authorization: (overrides.authorization ?? {
      authorize: vi.fn(async () => ({ accessContext: {}, permissionSnapshot: {} })),
    }) as never,
    connections: (overrides.connections ?? {}) as never,
    providers: (overrides.providers ?? { list: vi.fn(async () => []) }) as never,
    repository: (overrides.repository ?? {}) as never,
    workflows: {
      ...overrides.workflows,
      ...(overrides.createBulk ? { createBulk: overrides.createBulk } : {}),
      ...(overrides.createImport ? { createImport: overrides.createImport } : {}),
      ...(overrides.createPreview ? { createPreview: overrides.createPreview } : {}),
      ...(overrides.createSync ? { createSync: overrides.createSync } : {}),
      ...(overrides.listBulkItems ? { listBulkItems: overrides.listBulkItems } : {}),
    } as never,
  });
  return app;
}

function publicConnection() {
  return {
    authKind: "api-key" as const,
    configuration: {},
    createdAt: "2026-07-14T12:00:00.000Z",
    id: connectionId,
    knowledgeSpaceId: spaceId,
    name: "Drive",
    providerId: "drive",
    scopes: [],
    status: "active" as const,
    updatedAt: "2026-07-14T12:00:00.000Z",
    version: 2,
  };
}

function syncPolicy(patch: Record<string, unknown> = {}) {
  return {
    accessChannel: "interactive" as const,
    createdAt: "2026-07-14T12:00:00.000Z",
    enabled: true,
    expectedSourceVersion: 2,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44",
    knowledgeSpaceId: spaceId,
    mode: "provider" as const,
    nextRunAt: "2026-07-14T13:00:00.000Z",
    permissionSnapshotId: "permission-policy",
    permissionSnapshotRevision: 1,
    requestedBySubjectId: "editor-a",
    requiredPermissionScope: [],
    revision: 1,
    sourceId,
    tenantId: "tenant-a",
    updatedAt: "2026-07-14T12:00:00.000Z",
    ...patch,
  };
}

function run(kind: SourceWorkflowRun["kind"]): SourceWorkflowRun {
  return {
    accessChannel: "interactive",
    activeSlot: 1,
    checkpoint: "queued",
    createdAt: "2026-07-14T12:00:00.000Z",
    executionAttempts: 0,
    id: runId,
    idempotencyKey: "test",
    knowledgeSpaceId: spaceId,
    kind,
    maxExecutionAttempts: 5,
    payload: {},
    permissionSnapshotId: "permission-a",
    permissionSnapshotRevision: 1,
    progressCompleted: 0,
    progressFailed: 0,
    progressSkipped: 0,
    requestedBySubjectId: "editor-a",
    requiredPermissionScope: [],
    rowVersion: 1,
    sourceId,
    state: "queued",
    tenantId: "tenant-a",
    updatedAt: "2026-07-14T12:00:00.000Z",
  };
}
