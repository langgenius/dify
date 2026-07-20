import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeGatewayEnv } from "./gateway-openapi-contracts";
import { KnowledgeSpaceAuthorizationError } from "./knowledge-space-authorization";
import { registerSourceProductHandlers } from "./source-product-handlers";
import { SourceWorkflowError, type SourceWorkflowRun } from "./source-product-workflow";

const spaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const runId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";

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
});

function sourceProductApp(overrides: {
  readonly authorization?: object | undefined;
  readonly connections?: object | undefined;
  readonly createBulk?: ((input: never) => Promise<SourceWorkflowRun>) | undefined;
  readonly createImport?: ((input: never) => Promise<SourceWorkflowRun>) | undefined;
  readonly createPreview?: ((input: never) => Promise<SourceWorkflowRun>) | undefined;
  readonly listBulkItems?: ((input: never) => Promise<unknown>) | undefined;
}) {
  const app = new OpenAPIHono<KnowledgeGatewayEnv>();
  app.use("*", async (context, next) => {
    context.set("subject", { scopes: [], subjectId: "editor-a", tenantId: "tenant-a" });
    context.set("callerKind", "interactive");
    await next();
  });
  registerSourceProductHandlers({
    app,
    authorization: (overrides.authorization ?? {
      authorize: vi.fn(async () => ({ accessContext: {}, permissionSnapshot: {} })),
    }) as never,
    connections: (overrides.connections ?? {}) as never,
    providers: { list: vi.fn(async () => []) } as never,
    repository: {} as never,
    workflows: {
      ...(overrides.createBulk ? { createBulk: overrides.createBulk } : {}),
      ...(overrides.createImport ? { createImport: overrides.createImport } : {}),
      ...(overrides.createPreview ? { createPreview: overrides.createPreview } : {}),
      ...(overrides.listBulkItems ? { listBulkItems: overrides.listBulkItems } : {}),
    } as never,
  });
  return app;
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
