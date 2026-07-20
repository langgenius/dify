import { describe, expect, it, vi } from "vitest";

import type { DocumentAssetRepository } from "./document-asset-repository";
import { createKnowledgeGatewayApp } from "./gateway-app";
import type { KnowledgeSpaceAccessService } from "./knowledge-space-access-control";
import type { KnowledgeSpaceAuthorizationGuard } from "./knowledge-space-authorization";
import type { KnowledgeSpaceRepository } from "./knowledge-space-repository";
import { registerLogicalDocumentHandlers } from "./logical-document-handlers";
import { createInMemoryLogicalDocumentRepository } from "./logical-document-repository";

const tenantId = "tenant-a";
const knowledgeSpaceId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const documentId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d01";
const assetId = "018f0d60-7a49-7cc2-9c1b-5b36f18f2d11";

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
});

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
