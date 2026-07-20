import { describe, expect, it, vi } from "vitest";

import { createKnowledgeGatewayApp } from "./gateway-app";
import { registerLogicalDocumentHandlers } from "./logical-document-handlers";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const assetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11";
const chunkId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21";
const taskId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31";

describe("logical document product handlers", () => {
  it("routes revision-scoped chunk reads/state changes and versioned settings", async () => {
    const fixture = productApp();
    const chunks = await fixture.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/revisions/1/chunks?limit=10`,
    );
    expect(chunks.status, await chunks.clone().text()).toBe(200);
    await expect(chunks.json()).resolves.toMatchObject({
      items: [{ documentRevision: 1, enabled: true, id: chunkId }],
    });
    expect(fixture.listChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        candidateGrants: ["document:read"],
        documentRevision: 1,
      }),
    );

    const changed = await fixture.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/revisions/1/chunks/${chunkId}/state`,
      {
        body: JSON.stringify({ enabled: false }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(changed.status, await changed.clone().text()).toBe(202);
    await expect(changed.json()).resolves.toMatchObject({
      chunkId,
      compilationAttemptId: taskId,
      enabled: false,
      state: "candidate",
      statusUrl: `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}`,
    });

    const head = await fixture.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/settings`,
    );
    expect(head.status, await head.clone().text()).toBe(200);
    await expect(head.json()).resolves.toMatchObject({ activeRevision: 1, rowVersion: 0 });

    const updated = await fixture.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/settings`,
      {
        body: JSON.stringify({
          expectedSettingsHeadRevision: 1,
          settings: {
            chunkOverlap: 64,
            chunkSize: 512,
            enableGraph: false,
            enablePageIndex: true,
          },
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(updated.status, await updated.clone().text()).toBe(202);
    await expect(updated.json()).resolves.toMatchObject({
      compilationAttemptId: taskId,
      settingsRevision: 2,
      state: "running",
    });
  });

  it("lists, polls, cancels, retries, and closes a non-terminal SSE stream at its absolute deadline", async () => {
    const fixture = productApp({ taskSseMaxDurationMs: 25, taskSsePollIntervalMs: 10 });
    const list = await fixture.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks?limit=10`,
    );
    expect(list.status, await list.clone().text()).toBe(200);
    await expect(list.json()).resolves.toMatchObject({ items: [{ id: taskId }] });
    expect(fixture.listTasks).toHaveBeenCalledWith(
      expect.objectContaining({ candidateGrants: ["document:read"], documentId }),
    );

    const canceled = await fixture.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}`,
      { method: "DELETE" },
    );
    expect(canceled.status, await canceled.clone().text()).toBe(200);
    expect(fixture.cancel).toHaveBeenCalledWith(taskId, "Canceled by request", {
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d41",
        revision: 1,
      },
      requestedBySubjectId: "editor-a",
    });

    const retried = await fixture.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}/retry`,
      { method: "POST" },
    );
    expect(retried.status, await retried.clone().text()).toBe(200);
    expect(fixture.retry).toHaveBeenCalledWith(taskId, {
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d41",
        revision: 1,
      },
      requestedBySubjectId: "editor-a",
    });

    const startedAt = Date.now();
    const stream = await fixture.app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}/events`,
    );
    expect(stream.status).toBe(200);
    const body = await stream.text();
    expect(body).toContain("event: progress");
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(fixture.getTask.mock.calls.length).toBeGreaterThan(1);
  });
});

function productApp(
  options: { readonly taskSseMaxDurationMs?: number; readonly taskSsePollIntervalMs?: number } = {},
) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("callerKind", "interactive");
    context.set("subject", {
      scopes: ["knowledge-spaces:*"],
      subjectId: "editor-a",
      tenantId,
    });
    await next();
  });
  const revision = {
    contentHash: "a".repeat(64),
    createdAt: "2026-07-14T12:00:00.000Z",
    documentAssetId: assetId,
    documentAssetVersion: 1,
    documentId,
    expectedActiveRevision: null,
    expectedDocumentRowVersion: 0,
    knowledgeSpaceId,
    mimeType: "text/plain",
    revision: 1,
    sizeBytes: 12,
    state: "active" as const,
    systemMetadata: {},
    tenantId,
  };
  const task = {
    createdAt: "2026-07-14T12:00:00.000Z",
    documentId,
    documentRevision: 1,
    id: taskId,
    knowledgeSpaceId,
    progressPercent: 0,
    stage: "queued" as const,
    state: "queued" as const,
    updatedAt: "2026-07-14T12:00:00.000Z",
  };
  const listChunks = vi.fn(async () => ({
    items: [
      {
        createdAt: "2026-07-14T12:00:00.000Z",
        documentId,
        documentRevision: 1,
        enabled: true,
        id: chunkId,
        knowledgeSpaceId,
        ordinal: 0,
        systemMetadata: {},
        tenantId,
        text: "chunk",
        tokenCount: 1,
        userMetadata: {},
      },
    ],
  }));
  const listTasks = vi.fn(async () => ({ items: [task] }));
  const getTask = vi.fn(async () => task);
  const cancel = vi.fn(async () => task);
  const retry = vi.fn(async () => task);
  registerLogicalDocumentHandlers({
    access: {
      createPermissionSnapshot: vi.fn(async () => ({
        accessChannel: "interactive",
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d41",
        revision: 1,
        role: "editor",
      })),
    } as never,
    app,
    assets: {
      get: vi.fn(async () => ({
        id: assetId,
        knowledgeSpaceId,
        metadata: { permissionScope: ["document:read"] },
        version: 1,
      })),
    } as never,
    authorization: {
      authorize: vi.fn(async () => ({
        accessContext: {} as never,
        permissionSnapshot: {
          apiAccessRevision: 1,
          callerKind: "interactive",
          candidateGrants: ["document:read"],
          issuedAt: "2026-07-14T12:00:00.000Z",
          knowledgeSpaceId,
          memberRevision: 1,
          memberRole: "editor",
          policyRevision: 1,
          subjectId: "editor-a",
          tenantId,
        },
      })),
    } as never,
    chunkState: {
      request: vi.fn(async (input) => ({
        chunkId,
        compilationAttemptId: taskId,
        createdAt: input.now,
        documentId,
        documentRevision: 1,
        enabled: input.enabled,
        id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d51",
        knowledgeSpaceId,
        state: "candidate" as const,
        tenantId,
      })),
    },
    chunks: { get: vi.fn(), list: listChunks } as never,
    compilationJobs: { cancel, retry } as never,
    logicalDocuments: {
      get: vi.fn(async () => ({
        active: revision,
        activeRevision: 1,
        createdAt: revision.createdAt,
        id: documentId,
        knowledgeSpaceId,
        rowVersion: 1,
        status: "ready",
        systemMetadata: {},
        tenantId,
        title: "Product document",
        updatedAt: revision.createdAt,
        userMetadata: {},
      })),
      getRevision: vi.fn(async () => revision),
    } as never,
    settings: {
      getHead: vi.fn(async () => ({
        activeRevision: 1,
        documentId,
        knowledgeSpaceId,
        profile: {
          activatedAt: "2026-07-14T12:01:00.000Z",
          createdAt: "2026-07-14T12:00:00.000Z",
          createdBySubjectId: "editor-a",
          documentId,
          knowledgeSpaceId,
          revision: 1,
          settings: {
            chunkOverlap: 64,
            chunkSize: 512,
            enableGraph: true,
            enablePageIndex: true,
          },
          state: "active",
          tenantId,
        },
        rowVersion: 0,
        tenantId,
        updatedAt: "2026-07-14T12:01:00.000Z",
      })),
    } as never,
    settingsChangeCoordinator: {
      request: vi.fn(async () => ({
        attemptId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d61",
        compilationAttemptId: taskId,
        settingsRevision: 2,
        state: "running" as const,
        statusUrl: `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}`,
      })),
    },
    spaces: { get: vi.fn(async () => ({ id: knowledgeSpaceId, tenantId })) } as never,
    taskSseHeartbeatMs: 10,
    taskSseMaxDurationMs: options.taskSseMaxDurationMs ?? 100,
    taskSsePollIntervalMs: options.taskSsePollIntervalMs ?? 10,
    tasks: { get: getTask, list: listTasks },
  });
  return { app, cancel, getTask, listChunks, listTasks, retry };
}
