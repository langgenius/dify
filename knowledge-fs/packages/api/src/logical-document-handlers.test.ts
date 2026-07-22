import { describe, expect, it, vi } from "vitest";

import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import type { DocumentAssetRepository } from "./document-asset-repository";
import type {
  DocumentChunkRepository,
  DocumentChunkStateService,
  DocumentRevisionChunk,
} from "./document-chunk-repository";
import type {
  DocumentCompilationJob,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";
import type {
  DocumentProcessingTask,
  DocumentProcessingTaskRepository,
} from "./document-processing-task-repository";
import type {
  DocumentSettingsHead,
  DocumentSettingsRepository,
} from "./document-settings-repository";
import { createKnowledgeGatewayApp } from "./gateway-app";
import type {
  KnowledgeSpaceAccessService,
  KnowledgeSpaceApiKeyPermissionBinding,
} from "./knowledge-space-access-control";
import {
  KnowledgeSpaceAuthorizationError,
  type KnowledgeSpaceAuthorizationGuard,
  type KnowledgeSpaceCallerKind,
} from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import {
  type DocumentSettingsChangeCoordinator,
  type RegisterLogicalDocumentHandlersOptions,
  registerLogicalDocumentHandlers,
} from "./logical-document-handlers";
import {
  type DocumentRevision,
  LogicalDocumentConflictError,
  LogicalDocumentNotFoundError,
  type LogicalDocumentRepository,
  LogicalDocumentValidationError,
  type LogicalDocumentWithActiveRevision,
  createInMemoryLogicalDocumentRepository,
} from "./logical-document-repository";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const assetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11";
const chunkId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d31";
const taskId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d41";
const sourceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d51";

describe("logical document handlers", () => {
  it("returns readable pending and failed documents even when no active revision exists", async () => {
    const logicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      generateDocumentId: () => documentId,
      maxDocuments: 10,
      maxRevisionsPerDocument: 10,
    });
    const created = await logicalDocuments.createCandidateRevision({
      contentHash: "a".repeat(64),
      documentAssetId: assetId,
      documentAssetVersion: 1,
      knowledgeSpaceId,
      mimeType: "text/plain",
      now: "2026-07-14T12:00:00.000Z",
      sizeBytes: 12,
      systemMetadata: {},
      tenantId,
      title: "Design notes",
    });
    const app = testApp(logicalDocuments);

    const pendingList = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/logical-documents`,
    );
    expect(pendingList.status, await pendingList.clone().text()).toBe(200);
    await expect(pendingList.json()).resolves.toMatchObject({
      items: [{ active: null, id: documentId, status: "pending" }],
    });

    await logicalDocuments.failCandidate({
      documentId,
      knowledgeSpaceId,
      now: "2026-07-14T12:01:00.000Z",
      revision: created.revision.revision,
      tenantId,
    });
    const failedGet = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/logical-documents/${documentId}`,
    );
    expect(failedGet.status, await failedGet.clone().text()).toBe(200);
    await expect(failedGet.json()).resolves.toMatchObject({
      active: null,
      id: documentId,
      status: "failed",
    });
  });

  it("passes a fresh durable permission reference into the metadata CAS", async () => {
    const logicalDocuments = createInMemoryLogicalDocumentRepository({
      canReadDocument: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      canReadRevision: ({ candidateGrants }) => candidateGrants.includes("document:read"),
      generateDocumentId: () => documentId,
      maxDocuments: 10,
      maxRevisionsPerDocument: 10,
    });
    await logicalDocuments.createCandidateRevision({
      contentHash: "a".repeat(64),
      documentAssetId: assetId,
      documentAssetVersion: 1,
      knowledgeSpaceId,
      mimeType: "text/plain",
      now: "2026-07-14T12:00:00.000Z",
      sizeBytes: 12,
      systemMetadata: {},
      tenantId,
      title: "Design notes",
    });
    const patch = vi.spyOn(logicalDocuments, "patchUserMetadata");
    const createPermissionSnapshot = vi.fn(async () => permissionSnapshot());
    const app = testApp(logicalDocuments, { createPermissionSnapshot });

    const response = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/metadata`,
      {
        body: JSON.stringify({ expectedRowVersion: 0, patch: { category: "camera" } }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );

    expect(response.status, await response.clone().text()).toBe(200);
    expect(createPermissionSnapshot).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
          revision: 7,
        },
        requestedBySubjectId: "member-a",
      }),
    );
  });

  it("fails closed for unavailable resources, denied spaces, and malformed cursors", async () => {
    const unavailable = handlerApp({ logicalDocuments: undefined });
    await expectStatus(
      unavailable.request(`/knowledge-spaces/${knowledgeSpaceId}/logical-documents`),
      404,
    );
    await expectStatus(
      unavailable.request(`/knowledge-spaces/${knowledgeSpaceId}/logical-documents/${documentId}`),
      404,
    );

    const denied = handlerApp({
      spaces: { get: vi.fn(async () => null) } as unknown as KnowledgeSpaceRepository,
    });
    await expectStatus(
      denied.request(`/knowledge-spaces/${knowledgeSpaceId}/logical-documents`),
      403,
    );
    await expectStatus(
      denied.request(`/knowledge-spaces/${knowledgeSpaceId}/logical-documents/${documentId}`),
      403,
    );
    await expectStatus(
      denied.request(`/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/revisions`),
      404,
    );

    const invalid = handlerApp({ tasks: taskRepository() });
    await expectStatus(
      invalid.request(
        `/knowledge-spaces/${knowledgeSpaceId}/logical-documents?cursor=missing-separator`,
      ),
      400,
    );
    await expectStatus(
      invalid.request(
        `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/revisions?cursor=0`,
      ),
      400,
    );
    await expectStatus(
      invalid.request(
        `/knowledge-spaces/${knowledgeSpaceId}/processing-tasks?cursor=too%7Cmany%7Cparts`,
      ),
      400,
    );
  });

  it("passes decoded cursors and serializes optional document and revision fields", async () => {
    const active = revisionFixture({ activatedAt: "2026-07-14T12:02:00.000Z" });
    const document = documentFixture({
      active,
      activeRevision: 1,
      providerItemId: "provider-item-a",
      sourceId,
    });
    const list = vi.fn(async () => ({
      items: [document],
      nextCursor: { createdAt: document.createdAt, id: document.id },
    }));
    const listRevisions = vi.fn(async () => ({
      items: [active, revisionFixture({ revision: 2, state: "candidate" })],
      nextCursor: { revision: 2 },
    }));
    const logicalDocuments = logicalDocumentRepository({
      get: vi.fn(async () => document),
      list,
      listRevisions,
    });
    const app = handlerApp({ logicalDocuments });
    const pairCursor = encodeURIComponent(`${document.createdAt}|${document.id}`);

    const listed = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/logical-documents?cursor=${pairCursor}&limit=1`,
    );
    expect(listed.status, await listed.clone().text()).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      items: [
        {
          active: { activatedAt: active.activatedAt, revision: 1 },
          activeRevision: 1,
          providerItemId: "provider-item-a",
          sourceId,
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { createdAt: document.createdAt, id: document.id },
        limit: 1,
      }),
    );

    const fetched = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/logical-documents/${documentId}`,
    );
    expect(fetched.status, await fetched.clone().text()).toBe(200);
    await expect(fetched.json()).resolves.toMatchObject({
      providerItemId: "provider-item-a",
      sourceId,
    });

    const revisions = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/revisions?cursor=1&limit=1`,
    );
    expect(revisions.status, await revisions.clone().text()).toBe(200);
    await expect(revisions.json()).resolves.toMatchObject({
      items: [{ activatedAt: active.activatedAt }, { revision: 2 }],
      nextCursor: "2",
    });
    expect(listRevisions).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { revision: 1 }, limit: 1 }),
    );
  });

  it("hides missing documents and revisions whose immutable assets are unreadable", async () => {
    const missing = handlerApp({
      logicalDocuments: logicalDocumentRepository({ get: vi.fn(async () => null) }),
    });
    await expectStatus(
      missing.request(`/knowledge-spaces/${knowledgeSpaceId}/logical-documents/${documentId}`),
      404,
    );

    const unreadable = handlerApp({
      assets: { get: vi.fn(async () => null) },
      logicalDocuments: logicalDocumentRepository(),
    });
    await expectStatus(
      unreadable.request(`/knowledge-spaces/${knowledgeSpaceId}/logical-documents/${documentId}`),
      404,
    );
    const revisions = await unreadable.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/revisions`,
    );
    expect(revisions.status, await revisions.clone().text()).toBe(200);
    await expect(revisions.json()).resolves.toEqual({ items: [] });
  });

  it("handles rollback availability, authorization, success, and CAS conflicts", async () => {
    const path = `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/revisions/1/rollback`;
    const init = {
      body: JSON.stringify({ expectedActiveRevision: 1, expectedRowVersion: 2 }),
      headers: { "content-type": "application/json" },
      method: "POST",
    };
    await expectStatus(handlerApp().request(path, init), 503);

    const request = vi.fn(async () => taskFixture());
    const accepted = await handlerApp({ rollbackCoordinator: { request } }).request(path, init);
    expect(accepted.status, await accepted.clone().text()).toBe(202);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId,
        expectedActiveRevision: 1,
        expectedRowVersion: 2,
        permissionSnapshot: {
          accessChannel: "interactive",
          id: permissionSnapshot().id,
          revision: 7,
        },
        revision: 1,
      }),
    );

    const conflict = handlerApp({
      rollbackCoordinator: {
        request: vi.fn(async () => {
          throw new LogicalDocumentConflictError(1, 2, 2, 3);
        }),
      },
    });
    await expectStatus(conflict.request(path, init), 409);

    const forbidden = handlerApp({
      access: denyingAccess(),
      rollbackCoordinator: { request },
    });
    await expectStatus(forbidden.request(path, init), 403);

    const missingRevision = handlerApp({
      logicalDocuments: logicalDocumentRepository({ getRevision: vi.fn(async () => null) }),
      rollbackCoordinator: { request },
    });
    await expectStatus(missingRevision.request(path, init), 404);
  });

  it("uses capability provenance and maps every metadata repository error", async () => {
    const createPermissionSnapshot = vi.fn(async () => permissionSnapshot());
    const patchUserMetadata = vi.fn(async () => documentFixture());
    const capabilityApp = handlerApp(
      {
        access: { createPermissionSnapshot },
        assets: { get: vi.fn(async () => assetFixture({ metadata: {} })) },
        logicalDocuments: logicalDocumentRepository({ patchUserMetadata }),
      },
      { capabilityGrant: capabilityGrant({ contentScopeIds: [" invalid"] }) },
    );
    const capabilityResponse = await patchMetadata(capabilityApp);
    expect(capabilityResponse.status, await capabilityResponse.clone().text()).toBe(200);
    expect(createPermissionSnapshot).not.toHaveBeenCalled();
    expect(patchUserMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId: "grant-a" }),
    );

    const errorCases = [
      [new LogicalDocumentConflictError(1, 2, 3, 4), 409],
      [new LogicalDocumentValidationError("Reserved metadata"), 400],
      [new LogicalDocumentNotFoundError("gone"), 404],
    ] as const;
    for (const [error, status] of errorCases) {
      const app = handlerApp({
        logicalDocuments: logicalDocumentRepository({
          patchUserMetadata: vi.fn(async () => {
            throw error;
          }),
        }),
      });
      await expectStatus(patchMetadata(app), status);
    }

    const get = vi
      .fn<LogicalDocumentRepository["get"]>()
      .mockResolvedValueOnce(documentFixture())
      .mockResolvedValueOnce(null);
    const disappeared = handlerApp({
      logicalDocuments: logicalDocumentRepository({ get }),
    });
    await expectStatus(patchMetadata(disappeared), 404);
    await expectStatus(patchMetadata(handlerApp({ access: denyingAccess() })), 404);
  });

  it("lists and fetches visible chunks with optional query and cursor fields", async () => {
    const chunk = chunkFixture();
    const list = vi.fn(async () => ({
      items: [chunk],
      nextCursor: { id: chunk.id },
    }));
    const get = vi
      .fn<DocumentChunkRepository["get"]>()
      .mockResolvedValueOnce(chunk)
      .mockResolvedValueOnce(null);
    const app = handlerApp({ chunks: chunkRepository({ get, list }) });
    const collectionPath = `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/revisions/1/chunks`;

    const listed = await app.request(`${collectionPath}?cursor=chunk-cursor&query=design&limit=1`);
    expect(listed.status, await listed.clone().text()).toBe(200);
    await expect(listed.json()).resolves.toEqual({
      items: [publicChunkFixture()],
      nextCursor: chunk.id,
    });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "chunk-cursor" },
        query: "design",
      }),
    );

    const found = await app.request(`${collectionPath}/${chunkId}`);
    expect(found.status, await found.clone().text()).toBe(200);
    await expect(found.json()).resolves.toEqual(publicChunkFixture());
    await expectStatus(app.request(`${collectionPath}/${chunkId}`), 404);

    await expectStatus(handlerApp().request(collectionPath), 404);
    const hidden = handlerApp({
      chunks: chunkRepository(),
      logicalDocuments: logicalDocumentRepository({ getRevision: vi.fn(async () => null) }),
    });
    await expectStatus(hidden.request(collectionPath), 404);
  });

  it("validates chunk state mutations and strips server-only response fields", async () => {
    const path = `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/revisions/1/chunks/${chunkId}/state`;
    const init = {
      body: JSON.stringify({ enabled: false }),
      headers: { "content-type": "application/json" },
      method: "POST",
    };
    await expectStatus(handlerApp().request(path, init), 503);

    const hidden = handlerApp({
      chunkState: chunkStateService(),
      logicalDocuments: logicalDocumentRepository({ getRevision: vi.fn(async () => null) }),
    });
    await expectStatus(hidden.request(path, init), 404);

    const forbidden = handlerApp({
      access: denyingAccess(),
      chunkState: chunkStateService(),
    });
    await expectStatus(forbidden.request(path, init), 403);

    const invalid = handlerApp({
      chunkState: chunkStateService({
        request: vi.fn(async () => {
          throw new LogicalDocumentValidationError("Invalid chunk state");
        }),
      }),
    });
    await expectStatus(invalid.request(path, init), 400);

    const request = vi.fn(async () => chunkStateChangeFixture());
    const accepted = await handlerApp({ chunkState: chunkStateService({ request }) }).request(
      path,
      init,
    );
    expect(accepted.status, await accepted.clone().text()).toBe(202);
    const body = await accepted.json();
    expect(body).toMatchObject({
      chunkId,
      state: "candidate",
      statusUrl: `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}`,
    });
    expect(body).not.toHaveProperty("activatedAt");
    expect(body).not.toHaveProperty("tenantId");
  });

  it("filters task lists by visible revision and round-trips pair cursors", async () => {
    const visible = taskFixture();
    const hidden = taskFixture({
      documentRevision: 2,
      id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d42",
    });
    const list = vi.fn(async () => ({
      items: [visible, hidden],
      nextCursor: { createdAt: visible.createdAt, id: visible.id },
    }));
    const logicalDocuments = logicalDocumentRepository({
      getRevision: vi.fn(async (input) => (input.revision === 1 ? revisionFixture() : null)),
    });
    const app = handlerApp({ logicalDocuments, tasks: taskRepository({ list }) });
    const cursor = encodeURIComponent(`${visible.createdAt}|${visible.id}`);

    const spaceTasks = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/processing-tasks?cursor=${cursor}&limit=1`,
    );
    expect(spaceTasks.status, await spaceTasks.clone().text()).toBe(200);
    await expect(spaceTasks.json()).resolves.toMatchObject({
      items: [{ id: visible.id }],
      nextCursor: expect.any(String),
    });
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { createdAt: visible.createdAt, id: visible.id },
      }),
    );

    const documentTasks = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks`,
    );
    expect(documentTasks.status, await documentTasks.clone().text()).toBe(200);
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ documentId }));

    const noDocuments = handlerApp({
      logicalDocuments: undefined,
      tasks: taskRepository({ list }),
    });
    const empty = await noDocuments.request(
      `/knowledge-spaces/${knowledgeSpaceId}/processing-tasks`,
    );
    expect(empty.status, await empty.clone().text()).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ items: [] });

    await expectStatus(
      handlerApp({ tasks: undefined }).request(
        `/knowledge-spaces/${knowledgeSpaceId}/processing-tasks`,
      ),
      404,
    );
    const denied = handlerApp({
      spaces: { get: vi.fn(async () => null) } as unknown as KnowledgeSpaceRepository,
      tasks: taskRepository(),
    });
    await expectStatus(
      denied.request(`/knowledge-spaces/${knowledgeSpaceId}/processing-tasks`),
      403,
    );
  });

  it("polls terminal tasks and honors Last-Event-ID in the SSE snapshot", async () => {
    const task = taskFixture({
      completedAt: "2026-07-14T12:04:00.000Z",
      progressPercent: 100,
      stage: "published",
      state: "succeeded",
      updatedAt: "2026-07-14T12:04:00.000Z",
    });
    const get = vi.fn(async () => task);
    const app = handlerApp({ tasks: taskRepository({ get }) });
    const path = `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${task.id}`;

    const polled = await app.request(path);
    expect(polled.status, await polled.clone().text()).toBe(200);
    await expect(polled.json()).resolves.toMatchObject({ id: task.id, state: "succeeded" });

    const stream = await app.request(`${path}/events`, {
      headers: { "last-event-id": `${task.id}:${task.updatedAt}` },
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    const events = await stream.text();
    expect(events).not.toContain("event: progress");
    expect(events).toContain("event: terminal");

    const missing = handlerApp({
      tasks: taskRepository({ get: vi.fn(async () => null) }),
    });
    await expectStatus(missing.request(path), 404);
    await expectStatus(missing.request(`${path}/events`), 404);
  });

  it("maps cancel and retry task preconditions, fallbacks, and coordinator failures", async () => {
    const path = `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}`;
    const task = taskFixture();

    const withoutJobs = handlerApp({ tasks: taskRepository() });
    await expectStatus(withoutJobs.request(path, { method: "DELETE" }), 409);
    await expectStatus(withoutJobs.request(`${path}/retry`, { method: "POST" }), 409);

    const forbidden = handlerApp({
      access: denyingAccess(),
      compilationJobs: compilationJobs(),
      tasks: taskRepository(),
    });
    await expectStatus(forbidden.request(path, { method: "DELETE" }), 403);
    await expectStatus(forbidden.request(`${path}/retry`, { method: "POST" }), 403);

    const cancel = vi.fn(async () => compilationJobFixture());
    const retry = vi.fn(async () => compilationJobFixture());
    const getAfterMutation = vi
      .fn<DocumentProcessingTaskRepository["get"]>()
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(task)
      .mockResolvedValueOnce(null);
    const accepted = handlerApp({
      compilationJobs: compilationJobs({ cancel, retry }),
      tasks: taskRepository({ get: getAfterMutation }),
    });
    const canceled = await accepted.request(path, { method: "DELETE" });
    expect(canceled.status, await canceled.clone().text()).toBe(200);
    await expect(canceled.json()).resolves.toMatchObject({ id: task.id });
    const retried = await accepted.request(`${path}/retry`, { method: "POST" });
    expect(retried.status, await retried.clone().text()).toBe(200);
    await expect(retried.json()).resolves.toMatchObject({ id: task.id });

    const failing = handlerApp({
      compilationJobs: compilationJobs({
        cancel: vi.fn(async () => {
          throw new Error("cancel race");
        }),
        retry: vi.fn(async () => {
          throw new Error("retry race");
        }),
      }),
      tasks: taskRepository(),
    });
    await expectStatus(failing.request(path, { method: "DELETE" }), 409);
    await expectStatus(failing.request(`${path}/retry`, { method: "POST" }), 409);

    const missing = handlerApp({
      compilationJobs: compilationJobs(),
      tasks: taskRepository({ get: vi.fn(async () => null) }),
    });
    await expectStatus(missing.request(path, { method: "DELETE" }), 404);
    await expectStatus(missing.request(`${path}/retry`, { method: "POST" }), 404);
  });

  it("gets and changes settings across unavailable, hidden, denied, and conflict paths", async () => {
    const path = `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/settings`;
    const init = {
      body: JSON.stringify({
        expectedSettingsHeadRevision: 1,
        settings: {
          chunkOverlap: 32,
          chunkSize: 512,
          enableGraph: true,
          enablePageIndex: false,
        },
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    };
    await expectStatus(handlerApp().request(path), 404);

    const hidden = handlerApp({
      logicalDocuments: logicalDocumentRepository({ get: vi.fn(async () => null) }),
      settings: settingsRepository(),
    });
    await expectStatus(hidden.request(path), 404);
    await expectStatus(hidden.request(path, init), 404);

    const getHead = vi
      .fn<DocumentSettingsRepository["getHead"]>()
      .mockResolvedValueOnce(settingsHeadFixture({ activatedAt: null }))
      .mockResolvedValueOnce(null);
    const readable = handlerApp({ settings: settingsRepository({ getHead }) });
    const found = await readable.request(path);
    expect(found.status, await found.clone().text()).toBe(200);
    const foundBody = await found.json();
    expect(foundBody).toMatchObject({ activeRevision: 1, profile: { state: "active" } });
    expect(foundBody.profile).not.toHaveProperty("activatedAt");
    await expectStatus(readable.request(path), 404);

    await expectStatus(handlerApp().request(path, init), 503);
    await expectStatus(
      handlerApp({
        access: denyingAccess(),
        settingsChangeCoordinator: settingsCoordinator(),
      }).request(path, init),
      403,
    );
    const conflict = handlerApp({
      settingsChangeCoordinator: settingsCoordinator({
        request: vi.fn(async () => {
          throw new LogicalDocumentConflictError(1, 2, 2, 3);
        }),
      }),
    });
    await expectStatus(conflict.request(path, init), 409);

    const request = vi.fn(async () => settingsChangeFixture());
    const accepted = await handlerApp({
      settingsChangeCoordinator: settingsCoordinator({ request }),
    }).request(path, init);
    expect(accepted.status, await accepted.clone().text()).toBe(202);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedSettingsHeadRevision: 1,
        permissionSnapshot: expect.any(Object),
      }),
    );
  });

  it("authorizes parent-scoped capabilities without invoking the member guard", async () => {
    const authorize = vi.fn(defaultAuthorization().authorize);
    const app = handlerApp(
      { authorization: { authorize } },
      {
        capabilityGrant: capabilityGrant({
          resource: { id: documentId, parent_id: knowledgeSpaceId, type: "document" },
        }),
      },
    );
    const response = await app.request(
      `/knowledge-spaces/${knowledgeSpaceId}/logical-documents/${documentId}`,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("fails closed at each nested lookup and authorization boundary", async () => {
    const revisionsPath = `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/revisions`;
    await expectStatus(handlerApp({ logicalDocuments: undefined }).request(revisionsPath), 404);
    await expectStatus(
      handlerApp({
        logicalDocuments: logicalDocumentRepository({ get: vi.fn(async () => null) }),
      }).request(revisionsPath),
      404,
    );

    const chunkPath = `${revisionsPath}/1/chunks/${chunkId}`;
    await expectStatus(handlerApp().request(chunkPath), 404);
    await expectStatus(
      handlerApp({
        chunks: chunkRepository(),
        logicalDocuments: logicalDocumentRepository({ getRevision: vi.fn(async () => null) }),
      }).request(chunkPath),
      404,
    );

    const taskPath = `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}`;
    await expectStatus(handlerApp({ tasks: undefined }).request(taskPath), 404);
    await expectStatus(
      handlerApp({ logicalDocuments: undefined, tasks: taskRepository() }).request(taskPath),
      404,
    );
    await expectStatus(
      handlerApp({
        logicalDocuments: logicalDocumentRepository({ getRevision: vi.fn(async () => null) }),
        tasks: taskRepository(),
      }).request(taskPath),
      404,
    );

    const rejected = handlerApp({
      authorization: deniedAuthorization(),
      chunkState: chunkStateService(),
      chunks: chunkRepository(),
      tasks: taskRepository(),
    });
    await expectStatus(rejected.request(taskPath), 404);
    await expectStatus(patchMetadata(rejected), 404);
    await expectStatus(rejected.request(`${revisionsPath}/1/chunks`), 404);
  });

  it("bounds durable permission expiry for API keys and applies caller-kind fallbacks", async () => {
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const apiKey = { expiresAt, id: "api-key-a", revision: 3 };
    const createPermissionSnapshot = vi.fn(async () => ({
      ...permissionSnapshot(),
      accessChannel: "service_api" as const,
      apiKeyExpiresAt: expiresAt,
      apiKeyId: apiKey.id,
      apiKeyRevision: apiKey.revision,
    }));
    const apiKeyApp = handlerApp(
      { access: { createPermissionSnapshot } },
      { authenticatedApiKey: apiKey, callerKind: "api_key" },
    );
    await expectStatus(patchMetadata(apiKeyApp), 200);
    expect(createPermissionSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        accessChannel: "service_api",
        apiKey,
        expiresAt,
      }),
    );

    const noExpirySnapshot = vi.fn(async () => permissionSnapshot());
    const noExpiryApp = handlerApp(
      { access: { createPermissionSnapshot: noExpirySnapshot } },
      {
        authenticatedApiKey: { id: "api-key-b", revision: 4 },
        callerKind: null,
      },
    );
    await expectStatus(patchMetadata(noExpiryApp), 200);
    expect(noExpirySnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ accessChannel: "interactive" }),
    );
  });

  it.each([0, 1.5, 60_001, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid SSE duration %s at registration",
    (duration) => {
      expect(() => handlerApp({ taskSseHeartbeatMs: duration })).toThrow(
        "taskSseHeartbeatMs must be an integer between 1 and 60000",
      );
    },
  );
});

type HandlerOverrides = Partial<Omit<RegisterLogicalDocumentHandlersOptions, "app">>;

function handlerApp(
  overrides: HandlerOverrides = {},
  contextOptions: {
    readonly authenticatedApiKey?: KnowledgeSpaceApiKeyPermissionBinding;
    readonly callerKind?: KnowledgeSpaceCallerKind | null;
    readonly capabilityGrant?: DifyCapabilityV2SanitizedGrant;
  } = {},
) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    if (contextOptions.callerKind !== null) {
      context.set("callerKind", contextOptions.callerKind ?? "interactive");
    }
    context.set("subject", {
      scopes: ["knowledge-spaces:*"],
      subjectId: "member-a",
      tenantId,
    });
    if (contextOptions.authenticatedApiKey) {
      context.set("authenticatedApiKey", contextOptions.authenticatedApiKey);
    }
    if (contextOptions.capabilityGrant) {
      context.set("capabilityV2Grant", contextOptions.capabilityGrant);
    }
    await next();
  });
  const defaults: Omit<RegisterLogicalDocumentHandlersOptions, "app"> = {
    access: defaultAccess(),
    assets: { get: vi.fn(async () => assetFixture()) },
    authorization: defaultAuthorization(),
    logicalDocuments: logicalDocumentRepository(),
    now: () => "2026-07-14T12:05:00.000Z",
    spaces: {
      get: vi.fn(async () => ({ id: knowledgeSpaceId, tenantId })),
    } as unknown as KnowledgeSpaceRepository,
  };
  registerLogicalDocumentHandlers({ ...defaults, ...overrides, app });
  return app;
}

async function expectStatus(response: Response | Promise<Response>, status: number): Promise<void> {
  const resolved = await response;
  expect(resolved.status, await resolved.clone().text()).toBe(status);
}

function patchMetadata(app: ReturnType<typeof handlerApp>): Response | Promise<Response> {
  return app.request(`/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/metadata`, {
    body: JSON.stringify({ expectedRowVersion: 2, patch: { category: "camera" } }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

function defaultAuthorization(): KnowledgeSpaceAuthorizationGuard {
  return {
    authorize: vi.fn(async () => ({
      accessContext: {} as never,
      permissionSnapshot: {
        apiAccessRevision: 1,
        callerKind: "interactive" as const,
        candidateGrants: ["document:read"],
        issuedAt: "2026-07-14T12:00:00.000Z",
        knowledgeSpaceId,
        memberRevision: 1,
        memberRole: "editor" as const,
        policyRevision: 1,
        subjectId: "member-a",
        tenantId,
      },
    })),
  };
}

function deniedAuthorization(): KnowledgeSpaceAuthorizationGuard {
  return {
    authorize: vi.fn(async () => {
      throw new KnowledgeSpaceAuthorizationError(
        "KNOWLEDGE_SPACE_ACCESS_DENIED",
        "Knowledge space access denied",
      );
    }),
  };
}

function defaultAccess(): Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot"> {
  return { createPermissionSnapshot: vi.fn(async () => permissionSnapshot()) };
}

function denyingAccess(): Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot"> {
  return {
    createPermissionSnapshot: vi.fn(async () => {
      throw new KnowledgeSpaceAuthorizationError(
        "KNOWLEDGE_SPACE_ACCESS_DENIED",
        "Knowledge space access denied",
      );
    }),
  };
}

function logicalDocumentRepository(
  overrides: Partial<LogicalDocumentRepository> = {},
): LogicalDocumentRepository {
  const revision = revisionFixture();
  const document = documentFixture();
  return {
    activateRevision: vi.fn(async () => document),
    bindCompilationAttempt: vi.fn(async () => revision),
    createCandidateRevision: vi.fn(async () => ({ document, revision })),
    discardUnboundCandidate: vi.fn(async () => true),
    failCandidate: vi.fn(async () => revision),
    get: vi.fn(async () => document),
    getRevision: vi.fn(async () => revision),
    isAssetReferenced: vi.fn(async () => false),
    isFailedSourceRevisionCleanupEligible: vi.fn(async () => false),
    list: vi.fn(async () => ({ items: [document] })),
    listActiveBySource: vi.fn(async () => ({ items: [] })),
    listRevisions: vi.fn(async () => ({ items: [revision] })),
    patchUserMetadata: vi.fn(async () => document),
    ...overrides,
  };
}

function revisionFixture(overrides: Partial<DocumentRevision> = {}): DocumentRevision {
  return {
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
    state: "active",
    systemMetadata: {},
    tenantId,
    ...overrides,
  };
}

function documentFixture(
  overrides: Partial<LogicalDocumentWithActiveRevision> = {},
): LogicalDocumentWithActiveRevision {
  return {
    active: revisionFixture(),
    activeRevision: 1,
    createdAt: "2026-07-14T12:00:00.000Z",
    id: documentId,
    knowledgeSpaceId,
    rowVersion: 2,
    status: "ready",
    systemMetadata: {},
    tenantId,
    title: "Design notes",
    updatedAt: "2026-07-14T12:02:00.000Z",
    userMetadata: {},
    ...overrides,
  };
}

function assetFixture(
  overrides: Readonly<Record<string, unknown>> = {},
): NonNullable<Awaited<ReturnType<DocumentAssetRepository["get"]>>> {
  return {
    createdAt: "2026-07-14T12:00:00.000Z",
    filename: "design-notes.txt",
    id: assetId,
    knowledgeSpaceId,
    metadata: { permissionScope: ["document:read"] },
    mimeType: "text/plain",
    objectKey: "tenant-a/design-notes.txt",
    parserStatus: "parsed",
    sha256: "a".repeat(64),
    sizeBytes: 12,
    version: 1,
    ...overrides,
  } as NonNullable<Awaited<ReturnType<DocumentAssetRepository["get"]>>>;
}

function chunkFixture(): DocumentRevisionChunk {
  return {
    createdAt: "2026-07-14T12:00:00.000Z",
    documentId,
    documentRevision: 1,
    enabled: true,
    id: chunkId,
    knowledgeSpaceId,
    ordinal: 0,
    parentChunkId: assetId,
    systemMetadata: { private: true },
    tenantId,
    text: "Design chunk",
    tokenCount: 2,
    userMetadata: { category: "camera" },
  };
}

function publicChunkFixture() {
  const { systemMetadata: _systemMetadata, tenantId: _tenantId, ...chunk } = chunkFixture();
  return chunk;
}

function chunkRepository(
  overrides: Partial<DocumentChunkRepository> = {},
): DocumentChunkRepository {
  const chunk = chunkFixture();
  return {
    activateStateChange: vi.fn(async () => chunkStateChangeFixture()),
    createMany: vi.fn(async () => [chunk]),
    failStateChange: vi.fn(async () => chunkStateChangeFixture({ state: "failed" })),
    get: vi.fn(async () => chunk),
    list: vi.fn(async () => ({ items: [chunk] })),
    stageStateChange: vi.fn(async () => chunkStateChangeFixture()),
    ...overrides,
  };
}

function chunkStateChangeFixture(
  overrides: Readonly<Record<string, unknown>> = {},
): Awaited<ReturnType<DocumentChunkStateService["request"]>> {
  return {
    activatedAt: "2026-07-14T12:06:00.000Z",
    candidateFingerprint: "fingerprint-a",
    candidatePublicationId: sourceId,
    chunkId,
    compilationAttemptId: taskId,
    createdAt: "2026-07-14T12:05:00.000Z",
    documentId,
    documentRevision: 1,
    enabled: false,
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d61",
    knowledgeSpaceId,
    state: "candidate",
    tenantId,
    ...overrides,
  } as Awaited<ReturnType<DocumentChunkStateService["request"]>>;
}

function chunkStateService(
  overrides: Partial<DocumentChunkStateService> = {},
): DocumentChunkStateService {
  return { request: vi.fn(async () => chunkStateChangeFixture()), ...overrides };
}

function taskFixture(overrides: Partial<DocumentProcessingTask> = {}): DocumentProcessingTask {
  return {
    createdAt: "2026-07-14T12:00:00.000Z",
    documentId,
    documentRevision: 1,
    id: taskId,
    knowledgeSpaceId,
    progressPercent: 20,
    stage: "parsed",
    state: "running",
    updatedAt: "2026-07-14T12:01:00.000Z",
    ...overrides,
  };
}

function taskRepository(
  overrides: Partial<DocumentProcessingTaskRepository> = {},
): DocumentProcessingTaskRepository {
  const task = taskFixture();
  return {
    get: vi.fn(async () => task),
    list: vi.fn(async () => ({ items: [task] })),
    ...overrides,
  };
}

function compilationJobs(
  overrides: Partial<DocumentCompilationJobStateMachine> = {},
): DocumentCompilationJobStateMachine {
  return {
    cancel: vi.fn(async () => compilationJobFixture()),
    retry: vi.fn(async () => compilationJobFixture()),
    ...overrides,
  } as unknown as DocumentCompilationJobStateMachine;
}

function compilationJobFixture(): DocumentCompilationJob {
  return {
    createdAt: 1_752_494_400_000,
    documentAssetId: assetId,
    id: taskId,
    knowledgeSpaceId,
    runState: "running",
    stage: "parsed",
    tenantId,
    updatedAt: 1_752_494_460_000,
    version: 1,
  };
}

function settingsHeadFixture({
  activatedAt = "2026-07-14T12:02:00.000Z",
}: { readonly activatedAt?: string | null | undefined } = {}): DocumentSettingsHead {
  return {
    activeRevision: 1,
    documentId,
    knowledgeSpaceId,
    profile: {
      ...(activatedAt ? { activatedAt } : {}),
      createdAt: "2026-07-14T12:00:00.000Z",
      createdBySubjectId: "member-a",
      documentId,
      knowledgeSpaceId,
      revision: 1,
      settings: {
        chunkOverlap: 32,
        chunkSize: 512,
        enableGraph: true,
        enablePageIndex: false,
      },
      state: "active",
      tenantId,
    },
    rowVersion: 2,
    tenantId,
    updatedAt: "2026-07-14T12:02:00.000Z",
  };
}

function settingsRepository(
  overrides: Partial<DocumentSettingsRepository> = {},
): DocumentSettingsRepository {
  return {
    getHead: vi.fn(async () => settingsHeadFixture()),
    ...overrides,
  } as unknown as DocumentSettingsRepository;
}

function settingsChangeFixture() {
  return {
    attemptId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d71",
    compilationAttemptId: taskId,
    settingsRevision: 2,
    state: "running" as const,
    statusUrl: `/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}`,
  };
}

function settingsCoordinator(
  overrides: Partial<DocumentSettingsChangeCoordinator> = {},
): DocumentSettingsChangeCoordinator {
  return { request: vi.fn(async () => settingsChangeFixture()), ...overrides };
}

function capabilityGrant(
  overrides: Partial<DifyCapabilityV2SanitizedGrant> = {},
): DifyCapabilityV2SanitizedGrant {
  return {
    action: "documents.update",
    actor: "dify-account:member-a",
    authzRevision: {
      credential_revision: null,
      external_access_epoch: 1,
      membership_epoch: 1,
      space_acl_epoch: 1,
    },
    azp: "dify-console",
    callerKind: "interactive",
    capVersion: 2,
    contentPolicyRevision: 1,
    contentScopeIds: ["document:read"],
    controlSpaceId: "control-space-a",
    expiresAt: 1_785_152_860,
    grantId: "grant-a",
    issuedAt: 1_785_152_800,
    jtiHash: `sha256:${"a".repeat(64)}`,
    namespaceId: tenantId,
    notBefore: 1_785_152_800,
    resource: { id: knowledgeSpaceId, parent_id: null, type: "knowledge_space" },
    subject: "member-a",
    traceId: "trace-a",
    ...overrides,
  };
}

function testApp(
  logicalDocuments: ReturnType<typeof createInMemoryLogicalDocumentRepository>,
  access: Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot"> = {
    createPermissionSnapshot: vi.fn(),
  } as unknown as Pick<KnowledgeSpaceAccessService, "createPermissionSnapshot">,
) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("callerKind", "interactive");
    context.set("subject", {
      scopes: ["knowledge-spaces:read"],
      subjectId: "member-a",
      tenantId,
    });
    await next();
  });
  const authorization: KnowledgeSpaceAuthorizationGuard = {
    authorize: vi.fn(async () => ({
      accessContext: {} as never,
      permissionSnapshot: {
        apiAccessRevision: 1,
        callerKind: "interactive" as const,
        candidateGrants: ["document:read"],
        issuedAt: "2026-07-14T12:00:00.000Z",
        knowledgeSpaceId,
        memberRevision: 1,
        memberRole: "viewer" as const,
        policyRevision: 1,
        subjectId: "member-a",
        tenantId,
      },
    })),
  };
  const assets: Pick<DocumentAssetRepository, "get"> = {
    get: vi.fn(
      async () =>
        ({
          createdAt: "2026-07-14T12:00:00.000Z",
          filename: "design-notes.txt",
          id: assetId,
          knowledgeSpaceId,
          metadata: { permissionScope: ["document:read"] },
          mimeType: "text/plain",
          objectKey: "tenant-a/design-notes.txt",
          parserStatus: "parsed",
          sha256: "a".repeat(64),
          sizeBytes: 12,
          version: 1,
        }) as unknown as Awaited<ReturnType<DocumentAssetRepository["get"]>>,
    ),
  };
  registerLogicalDocumentHandlers({
    access,
    app,
    assets,
    authorization,
    logicalDocuments,
    spaces: {
      get: vi.fn(async () => ({ id: knowledgeSpaceId, tenantId })),
    } as unknown as KnowledgeSpaceRepository,
  });
  return app;
}

function permissionSnapshot() {
  return {
    accessChannel: "interactive" as const,
    accessPolicyRevision: 3,
    apiAccessRevision: 2,
    createdAt: "2026-07-14T12:00:00.000Z",
    expiresAt: "2026-07-14T13:00:00.000Z",
    id: "018f0d60-7a49-7cc2-9c1b-5b36f18f2d21",
    knowledgeSpaceId,
    memberRevision: 4,
    permissionScopes: ["document:read"],
    revision: 7,
    role: "editor" as const,
    status: "active" as const,
    subjectId: "member-a",
    tenantId,
    updatedAt: "2026-07-14T12:00:00.000Z",
    visibility: "partial_members" as const,
  };
}
