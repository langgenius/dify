import { describe, expect, it, vi } from "vitest";

import { createInMemoryBulkOperationRepository } from "./bulk-operation";
import { registerDurableDeletionHandlers } from "./durable-deletion-handlers";
import type {
  DurableDeletionService,
  RequestBulkDocumentDeletionCommand,
  RequestBulkLogicalDocumentDeletionCommand,
} from "./durable-deletion-service";
import { createKnowledgeGatewayApp } from "./gateway-app";

const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const SOURCE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const DOCUMENT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const JOB_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const CAPABILITY_GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const NOW = "2026-07-14T12:00:00.000Z";

describe("durable deletion handlers", () => {
  it("accepts an owner knowledge-space deletion with CAS, challenge, and idempotency", async () => {
    const service = serviceStub();
    const app = testApp(service);
    const response = await app.request(`/knowledge-spaces/${SPACE_ID}`, {
      body: JSON.stringify({ challenge: "product-docs", expectedRevision: 7 }),
      headers: requestHeaders(),
      method: "DELETE",
    });

    expect(response.status, await response.clone().text()).toBe(202);
    expect(response.headers.get("location")).toBe(`/deletion-jobs/${JOB_ID}`);
    expect(await response.json()).toMatchObject({
      job: { checkpoint: "requested", id: JOB_ID, runState: "queued" },
      statusUrl: `/deletion-jobs/${JOB_ID}`,
    });
    expect(service.requestKnowledgeSpaceDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        callerKind: "interactive",
        challenge: "product-docs",
        expectedRevision: 7,
        idempotencyKey: "delete-space-0001",
        knowledgeSpaceId: SPACE_ID,
        subject: expect.objectContaining({ subjectId: "owner-1", tenantId: "tenant-1" }),
      }),
    );
  });

  it("rejects non-interactive knowledge-space deletion before calling the service", async () => {
    const service = serviceStub();
    const app = testApp(service, "api_key");
    const response = await app.request(`/knowledge-spaces/${SPACE_ID}`, {
      body: JSON.stringify({ challenge: "product-docs", expectedRevision: 7 }),
      headers: requestHeaders(),
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(service.requestKnowledgeSpaceDeletion).not.toHaveBeenCalled();
  });

  it("requires the strict per-document bulk revision DTO and never invokes a sync deleter", async () => {
    const service = serviceStub();
    const app = testApp(service);
    const legacy = await app.request(`/knowledge-spaces/${SPACE_ID}/documents/bulk`, {
      body: JSON.stringify({ documentIds: [DOCUMENT_ID] }),
      headers: requestHeaders(),
      method: "DELETE",
    });
    expect(legacy.status).toBe(400);

    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/documents/bulk`, {
      body: JSON.stringify({
        documents: [{ documentId: DOCUMENT_ID, expectedRevision: 3 }],
      }),
      headers: requestHeaders(),
      method: "DELETE",
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe(`/deletion-jobs/${JOB_ID}`);
    expect(service.requestBulkDocumentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [{ documentId: DOCUMENT_ID, expectedRevision: 3 }],
        idempotencyKey: "delete-space-0001",
      }),
    );
  });

  it("routes logical-document deletion through the durable logical aggregate path", async () => {
    const service = serviceStub();
    const bulkOperations = createInMemoryBulkOperationRepository({
      maxItems: 10,
      maxOperations: 10,
    });
    const app = testApp(service, "interactive", bulkOperations);
    const response = await app.request(
      `/knowledge-spaces/${SPACE_ID}/logical-documents/${DOCUMENT_ID}`,
      {
        body: JSON.stringify({ expectedRevision: 0 }),
        headers: requestHeaders(),
        method: "DELETE",
      },
    );

    expect(response.status, await response.clone().text()).toBe(202);
    expect(response.headers.get("location")).toBe(`/deletion-jobs/${JOB_ID}`);
    expect(await response.json()).toMatchObject({
      job: { id: JOB_ID, targetType: "logical_document" },
      statusUrl: `/deletion-jobs/${JOB_ID}`,
    });
    expect(service.requestLogicalDocumentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        callerKind: "interactive",
        documentId: DOCUMENT_ID,
        expectedRevision: 0,
        idempotencyKey: "delete-space-0001",
        knowledgeSpaceId: SPACE_ID,
      }),
    );
    expect(service.requestDocumentDeletion).not.toHaveBeenCalled();
    await expect(bulkOperations.get({ id: JOB_ID, tenantId: "tenant-1" })).resolves.toMatchObject({
      capabilityGrantId: CAPABILITY_GRANT_ID,
      items: [
        expect.objectContaining({
          deletionJobId: JOB_ID,
          documentId: DOCUMENT_ID,
          documentTitle: "Document title",
        }),
      ],
      type: "document_delete",
    });
  });

  it("creates one background task for a logical-document deletion batch", async () => {
    const service = serviceStub();
    const bulkOperations = createInMemoryBulkOperationRepository({
      maxItems: 10,
      maxOperations: 10,
    });
    const app = testApp(service, "interactive", bulkOperations);
    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/logical-documents/bulk`, {
      body: JSON.stringify({
        documents: [{ documentId: DOCUMENT_ID, expectedRevision: 3 }],
      }),
      headers: requestHeaders(),
      method: "DELETE",
    });

    expect(response.status, await response.clone().text()).toBe(202);
    expect(response.headers.get("location")).toBe(`/knowledge-spaces/${SPACE_ID}/background-tasks`);
    expect(service.requestBulkLogicalDocumentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [{ documentId: DOCUMENT_ID, expectedRevision: 3 }],
        idempotencyKey: "delete-space-0001",
      }),
    );
    await expect(bulkOperations.get({ id: JOB_ID, tenantId: "tenant-1" })).resolves.toMatchObject({
      capabilityGrantId: CAPABILITY_GRANT_ID,
      items: [expect.objectContaining({ deletionJobId: JOB_ID, documentId: DOCUMENT_ID })],
      type: "document_delete",
    });
  });

  it("keeps document-asset deletion versions strictly positive", async () => {
    const service = serviceStub();
    const app = testApp(service);
    const response = await app.request(`/knowledge-spaces/${SPACE_ID}/documents/${DOCUMENT_ID}`, {
      body: JSON.stringify({ expectedRevision: 0 }),
      headers: requestHeaders(),
      method: "DELETE",
    });

    expect(response.status).toBe(400);
    expect(service.requestDocumentDeletion).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the durable service is not configured", async () => {
    const app = testApp(undefined);
    const response = await app.request(
      `/knowledge-spaces/${SPACE_ID}/sources/${SOURCE_ID}?documents=keep`,
      {
        body: JSON.stringify({ expectedRevision: 2 }),
        headers: requestHeaders(),
        method: "DELETE",
      },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "DURABLE_DELETION_UNAVAILABLE" });
  });

  it("returns 404 for an indirectly addressed job hidden by the service", async () => {
    const service = serviceStub();
    vi.mocked(service.get).mockResolvedValueOnce(null);
    const app = testApp(service);
    const response = await app.request(`/deletion-jobs/${JOB_ID}`, {
      headers: { authorization: "Bearer ignored" },
    });

    expect(response.status).toBe(404);
    expect(service.get).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: JOB_ID,
        subject: expect.objectContaining({ subjectId: "owner-1" }),
      }),
    );
  });
});

function testApp(
  service?: DurableDeletionService,
  callerKind: "api_key" | "interactive" = "interactive",
  bulkOperations = createInMemoryBulkOperationRepository({ maxItems: 10, maxOperations: 10 }),
) {
  const app = createKnowledgeGatewayApp();
  app.use("*", async (context, next) => {
    context.set("callerKind", callerKind);
    if (callerKind === "interactive") {
      context.set("capabilityV2Grant", {
        contentScopeIds: [],
        grantId: CAPABILITY_GRANT_ID,
      } as never);
    }
    context.set("subject", {
      scopes: ["knowledge-spaces:read", "knowledge-spaces:write"],
      subjectId: "owner-1",
      tenantId: "tenant-1",
    });
    await next();
  });
  registerDurableDeletionHandlers({ app, bulkOperations, maxBulkDeleteDocuments: 10, service });
  return app;
}

function serviceStub(): DurableDeletionService {
  const accepted = {
    job: {
      checkpoint: "requested" as const,
      createdAt: NOW,
      id: JOB_ID,
      knowledgeSpaceId: SPACE_ID,
      mode: "cascade" as const,
      runState: "queued" as const,
      targetId: SPACE_ID,
      targetType: "knowledge_space" as const,
      updatedAt: NOW,
    },
    statusUrl: `/deletion-jobs/${JOB_ID}`,
  };
  return {
    get: vi.fn(async () => accepted.job),
    requestBulkDocumentDeletion: vi.fn(async (input: RequestBulkDocumentDeletionCommand) => ({
      items: input.documents.map((document) => ({
        documentId: document.documentId,
        job: {
          ...accepted.job,
          targetId: document.documentId,
          targetType: "document" as const,
        },
        statusUrl: accepted.statusUrl,
      })),
      total: input.documents.length,
    })),
    requestBulkLogicalDocumentDeletion: vi.fn(
      async (input: RequestBulkLogicalDocumentDeletionCommand) => ({
        items: input.documents.map((document) => ({
          documentId: document.documentId,
          documentTitle: "Document title",
          job: {
            ...accepted.job,
            targetId: document.documentId,
            targetType: "logical_document" as const,
          },
          statusUrl: accepted.statusUrl,
        })),
        total: input.documents.length,
      }),
    ),
    requestDocumentDeletion: vi.fn(async () => accepted),
    requestKnowledgeSpaceDeletion: vi.fn(async () => accepted),
    requestLogicalDocumentDeletion: vi.fn(async () => ({
      ...accepted,
      documentTitle: "Document title",
      job: { ...accepted.job, targetType: "logical_document" as const },
    })),
    requestSourceDeletion: vi.fn(async () => accepted),
    retry: vi.fn(async () => accepted),
  };
}

function requestHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "idempotency-key": "delete-space-0001",
  };
}
