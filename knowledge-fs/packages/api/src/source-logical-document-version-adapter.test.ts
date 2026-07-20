import { describe, expect, it, vi } from "vitest";

import type { DurableDeletionRepository } from "./durable-deletion-repository";
import { createInMemoryLogicalDocumentRepository } from "./logical-document-repository";
import {
  type SourceCompilationPublicationExecutor,
  createJointCasSourceLogicalRevisionPublisher,
} from "./source-logical-document-version-adapter";
import type { PublishSourceLogicalRevisionInput } from "./source-logical-revision-publisher";

const TENANT_ID = "tenant-a";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const SOURCE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const DOCUMENT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const SECOND_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const ATTEMPT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const NOW = "2026-07-14T12:00:00.000Z";

describe("joint-CAS Source logical revision publisher", () => {
  it("durably schedules exact failed bound materialization cleanup and replays it on restart", async () => {
    const logicalDocuments = repository();
    const remoteDeletions = deletionSpies();
    const compilationPublication: SourceCompilationPublicationExecutor = {
      publishAndWait: vi.fn(async (input) => {
        await input.bindCompilationAttempt(ATTEMPT_ID);
        throw new Error("compilation failed");
      }),
    };
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication,
      logicalDocuments,
      now: () => NOW,
      remoteDeletions,
    });

    await expect(publisher.publish(publicationInput())).rejects.toThrow("compilation failed");
    await expect(publisher.publish(publicationInput())).rejects.toThrow(
      "bound to a terminal logical revision",
    );

    const revision = await logicalDocuments.getRevision({
      documentId: DOCUMENT_ID,
      knowledgeSpaceId: SPACE_ID,
      revision: 1,
      tenantId: TENANT_ID,
    });
    expect(revision).toMatchObject({
      compilationAttemptId: ATTEMPT_ID,
      documentAssetId: ASSET_ID,
      state: "failed",
    });
    expect(compilationPublication.publishAndWait).toHaveBeenCalledTimes(1);
    expect(remoteDeletions.requestDocumentDeletion).toHaveBeenCalledTimes(2);
    for (const [request] of remoteDeletions.requestDocumentDeletion.mock.calls) {
      expect(request).toMatchObject({
        documentAssetId: ASSET_ID,
        expectedDocumentVersion: 1,
        failedSourceMaterialization: {
          documentId: DOCUMENT_ID,
          ownership: publicationInput().materializationOwnership,
          revision: 1,
          sourceId: SOURCE_ID,
        },
        idempotencyKey: `source-failed-materialization:source-run-1:${ASSET_ID}:1`,
      });
    }
  });

  it("resolves publication ACK uncertainty from committed active state and never deletes it", async () => {
    const logicalDocuments = repository();
    const remoteDeletions = deletionSpies();
    const compilationPublication: SourceCompilationPublicationExecutor = {
      publishAndWait: vi.fn(async (input) => {
        await input.bindCompilationAttempt(ATTEMPT_ID);
        await logicalDocuments.activateRevision({
          documentId: input.logicalDocumentFence.documentId,
          expectedActiveRevision: input.logicalDocumentFence.expectedActiveRevision,
          expectedRowVersion: input.logicalDocumentFence.expectedDocumentRowVersion,
          knowledgeSpaceId: input.knowledgeSpaceId,
          now: NOW,
          revision: input.logicalDocumentFence.revision,
          tenantId: input.tenantId,
        });
        throw new Error("publication acknowledgement lost");
      }),
    };
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication,
      logicalDocuments,
      now: () => NOW,
      remoteDeletions,
    });

    await expect(publisher.publish(publicationInput())).rejects.toThrow(
      "publication acknowledgement lost",
    );
    await expect(publisher.publish(publicationInput())).resolves.toEqual({
      documentId: DOCUMENT_ID,
      kind: "activated",
      revision: 1,
    });

    expect(remoteDeletions.requestDocumentDeletion).not.toHaveBeenCalled();
    expect(compilationPublication.publishAndWait).toHaveBeenCalledTimes(1);
    await expect(
      logicalDocuments.getRevision({
        documentId: DOCUMENT_ID,
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ state: "active" });
  });

  it("never deletes a revision that a concurrent activation moved into history", async () => {
    const logicalDocuments = repository();
    const remoteDeletions = deletionSpies();
    const compilationPublication: SourceCompilationPublicationExecutor = {
      publishAndWait: async (input) => {
        await input.bindCompilationAttempt(ATTEMPT_ID);
        const activated = await logicalDocuments.activateRevision({
          documentId: input.logicalDocumentFence.documentId,
          expectedActiveRevision: input.logicalDocumentFence.expectedActiveRevision,
          expectedRowVersion: input.logicalDocumentFence.expectedDocumentRowVersion,
          knowledgeSpaceId: input.knowledgeSpaceId,
          now: NOW,
          revision: input.logicalDocumentFence.revision,
          tenantId: input.tenantId,
        });
        const next = await logicalDocuments.createCandidateRevision({
          contentHash: "b".repeat(64),
          documentAssetId: SECOND_ASSET_ID,
          documentAssetVersion: 1,
          knowledgeSpaceId: SPACE_ID,
          mimeType: "text/markdown",
          now: NOW,
          providerItemId: "provider-item-1",
          sizeBytes: 7,
          sourceId: SOURCE_ID,
          systemMetadata: {},
          tenantId: TENANT_ID,
          title: "newer.md",
          trustedInternalAdmission: true,
        });
        await logicalDocuments.activateRevision({
          documentId: next.document.id,
          expectedActiveRevision: activated.activeRevision ?? null,
          expectedRowVersion: activated.rowVersion,
          knowledgeSpaceId: SPACE_ID,
          now: NOW,
          revision: next.revision.revision,
          tenantId: TENANT_ID,
        });
        throw new Error("older publication acknowledgement lost");
      },
    };
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication,
      logicalDocuments,
      now: () => NOW,
      remoteDeletions,
    });

    await expect(publisher.publish(publicationInput())).rejects.toThrow(
      "older publication acknowledgement lost",
    );

    expect(remoteDeletions.requestDocumentDeletion).not.toHaveBeenCalled();
    await expect(
      logicalDocuments.getRevision({
        documentId: DOCUMENT_ID,
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ documentAssetId: ASSET_ID, state: "superseded" });
    await expect(
      logicalDocuments.getRevision({
        documentId: DOCUMENT_ID,
        knowledgeSpaceId: SPACE_ID,
        revision: 2,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ documentAssetId: SECOND_ASSET_ID, state: "active" });
  });
});

function repository() {
  return createInMemoryLogicalDocumentRepository({
    canReadDocument: () => true,
    canReadRevision: () => true,
    generateDocumentId: () => DOCUMENT_ID,
    maxDocuments: 10,
    maxRevisionsPerDocument: 10,
  });
}

function publicationInput(): PublishSourceLogicalRevisionInput {
  return {
    contentHash: "a".repeat(64),
    documentAssetId: ASSET_ID,
    documentAssetVersion: 1,
    knowledgeSpaceId: SPACE_ID,
    materializationOwnership: {
      contentHash: "a".repeat(64),
      itemKey: "provider-item-1",
      runId: "source-run-1",
    },
    mimeType: "text/markdown",
    permissionSnapshot: {
      accessChannel: "interactive",
      id: "permission-snapshot-1",
      revision: 1,
    },
    providerItemId: "provider-item-1",
    providerKind: "website",
    remoteDeletionPolicy: "tombstone",
    requestedBySubjectId: "user-1",
    sizeBytes: 6,
    sourceId: SOURCE_ID,
    tenantId: TENANT_ID,
    title: "source.md",
  };
}

function deletionSpies() {
  return {
    requestDocumentDeletion: vi.fn(
      async (_input: Parameters<DurableDeletionRepository["requestDocumentDeletion"]>[0]) =>
        ({}) as Awaited<ReturnType<DurableDeletionRepository["requestDocumentDeletion"]>>,
    ),
    requestLogicalDocumentDeletion: vi.fn(
      async (_input: Parameters<DurableDeletionRepository["requestLogicalDocumentDeletion"]>[0]) =>
        ({}) as Awaited<ReturnType<DurableDeletionRepository["requestLogicalDocumentDeletion"]>>,
    ),
  };
}
