import type { DocumentAsset } from "@knowledge/core";
import { describe, expect, it, vi } from "vitest";

import type {
  DocumentCompilationJob,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";
import type { DurableDeletionRepository } from "./durable-deletion-repository";
import { createInMemoryLogicalDocumentRepository } from "./logical-document-repository";
import {
  type SourceCompilationPublicationExecutor,
  createJointCasSourceLogicalRevisionPublisher,
  createSourceCompilationPublicationExecutor,
  createSourceLogicalDocumentVersionAdapter,
} from "./source-logical-document-version-adapter";
import type { PublishSourceLogicalRevisionInput } from "./source-logical-revision-publisher";

const TENANT_ID = "tenant-a";
const SPACE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c40";
const SOURCE_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c41";
const DOCUMENT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42";
const ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c43";
const SECOND_ASSET_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c44";
const ATTEMPT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c45";
const CAPABILITY_GRANT_ID = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c46";
const NOW = "2026-07-14T12:00:00.000Z";

describe("Source logical document version adapter", () => {
  it("requires the I5 repository and appends provider provenance as trusted system metadata", async () => {
    await expect(
      createSourceLogicalDocumentVersionAdapter(undefined).append({
        asset: documentAsset(),
        now: NOW,
        providerItemId: "provider-item-1",
        sourceId: SOURCE_ID,
        systemMetadata: { connector: "website" },
        tenantId: TENANT_ID,
      }),
    ).rejects.toThrow("Logical document version repository is required for Source imports");

    const logicalDocuments = repository();
    const appended = await createSourceLogicalDocumentVersionAdapter(logicalDocuments).append({
      asset: documentAsset(),
      now: NOW,
      providerItemId: "provider-item-1",
      sourceId: SOURCE_ID,
      systemMetadata: { connector: "website" },
      tenantId: TENANT_ID,
    });
    expect(appended).toMatchObject({
      document: { id: DOCUMENT_ID, providerItemId: "provider-item-1", sourceId: SOURCE_ID },
      revision: {
        documentAssetId: ASSET_ID,
        systemMetadata: {
          connector: "website",
          provenance: {
            documentAssetId: ASSET_ID,
            providerItemId: "provider-item-1",
            sourceId: SOURCE_ID,
          },
        },
      },
    });
  });
});

describe("Source compilation publication executor", () => {
  it("starts deferred work, binds before dispatch, and observes durable publication", async () => {
    const fixture = compilationJobs(
      [compilationJob({ runState: "succeeded", stage: "published" })],
      {
        releaseDispatch: true,
      },
    );
    const executor = createSourceCompilationPublicationExecutor({
      compilationJobs: fixture.jobs,
      maxWaitMs: 100,
      pollIntervalMs: 1,
    });
    const bindCompilationAttempt = vi.fn(async () => undefined);
    const assertActive = vi.fn(async () => undefined);

    await expect(
      executor.publishAndWait({
        ...compilationInput(),
        assertActive,
        bindCompilationAttempt,
      }),
    ).resolves.toBe("published");
    expect(fixture.start).toHaveBeenCalledWith(
      expect.objectContaining({
        deferDispatch: true,
        permissionSnapshot: publicationInput().permissionSnapshot,
        requestedBySubjectId: "user-1",
      }),
    );
    expect(bindCompilationAttempt).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(fixture.releaseDispatch).toHaveBeenCalledWith(ATTEMPT_ID);
    expect(assertActive).toHaveBeenCalledTimes(2);
    expect(fixture.cancel).not.toHaveBeenCalled();
  });

  it("validates durations and requires exactly one durable authorization binding", async () => {
    const fixture = compilationJobs([]);
    expect(() =>
      createSourceCompilationPublicationExecutor({
        compilationJobs: fixture.jobs,
        maxWaitMs: 0,
      }),
    ).toThrow("maxWaitMs must be positive");
    expect(() =>
      createSourceCompilationPublicationExecutor({
        compilationJobs: fixture.jobs,
        pollIntervalMs: 1.5,
      }),
    ).toThrow("pollIntervalMs must be positive");

    const executor = createSourceCompilationPublicationExecutor({
      compilationJobs: fixture.jobs,
      maxWaitMs: 10,
      pollIntervalMs: 1,
    });
    const permissionInput = compilationInput();
    await expect(
      executor.publishAndWait({
        ...permissionInput,
        capabilityGrantId: CAPABILITY_GRANT_ID,
      }),
    ).rejects.toThrow("Source compilation requires exactly one durable authorization binding");
    const {
      permissionSnapshot: _permissionSnapshot,
      requestedBySubjectId: _requestedBySubjectId,
      ...unbound
    } = permissionInput;
    await expect(executor.publishAndWait(unbound)).rejects.toThrow(
      "Source compilation requires exactly one durable authorization binding",
    );
    expect(fixture.start).not.toHaveBeenCalled();
  });

  it.each(["failed", "canceled", "superseded"] as const)(
    "cancels its attempt when durable compilation terminates as %s",
    async (runState) => {
      const fixture = compilationJobs([compilationJob({ runState, stage: "failed" })]);
      const executor = createSourceCompilationPublicationExecutor({
        compilationJobs: fixture.jobs,
        maxWaitMs: 20,
        pollIntervalMs: 1,
      });

      await expect(executor.publishAndWait(compilationInput())).rejects.toThrow(
        `Source compilation terminated as ${runState}`,
      );
      expect(fixture.cancel).toHaveBeenCalledWith(ATTEMPT_ID, "Source publication wait aborted");
    },
  );

  it("fails closed when the durable attempt disappears and tolerates cancellation cleanup failure", async () => {
    const fixture = compilationJobs([null], { cancelError: new Error("cancel unavailable") });
    const executor = createSourceCompilationPublicationExecutor({
      compilationJobs: fixture.jobs,
      maxWaitMs: 20,
      pollIntervalMs: 1,
    });

    await expect(executor.publishAndWait(compilationInput())).rejects.toThrow(
      "Source compilation attempt disappeared",
    );
    expect(fixture.cancel).toHaveBeenCalledOnce();
  });

  it("cancels polling immediately when its execution signal is aborted", async () => {
    const fixture = compilationJobs([compilationJob({ runState: "running", stage: "parsed" })], {
      repeatLast: true,
    });
    const executor = createSourceCompilationPublicationExecutor({
      compilationJobs: fixture.jobs,
      maxWaitMs: 1_000,
      pollIntervalMs: 100,
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error("source lease lost")), 0);

    await expect(
      executor.publishAndWait({ ...compilationInput(), signal: controller.signal }),
    ).rejects.toThrow("source lease lost");
    expect(fixture.cancel).toHaveBeenCalledOnce();
  });

  it("supports a capability-only job and times out a non-terminal durable attempt", async () => {
    const capabilityFixture = compilationJobs([
      compilationJob({ runState: "succeeded", stage: "published" }),
    ]);
    const capabilityExecutor = createSourceCompilationPublicationExecutor({
      compilationJobs: capabilityFixture.jobs,
      maxWaitMs: 20,
      pollIntervalMs: 1,
    });
    const {
      permissionSnapshot: _permissionSnapshot,
      requestedBySubjectId: _requestedBySubjectId,
      ...base
    } = compilationInput();
    await expect(
      capabilityExecutor.publishAndWait({
        ...base,
        capabilityGrantId: CAPABILITY_GRANT_ID,
      }),
    ).resolves.toBe("published");
    expect(capabilityFixture.start).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId: CAPABILITY_GRANT_ID }),
    );

    const timeoutFixture = compilationJobs(
      [compilationJob({ runState: "running", stage: "parsed" })],
      { repeatLast: true },
    );
    const timeoutExecutor = createSourceCompilationPublicationExecutor({
      compilationJobs: timeoutFixture.jobs,
      maxWaitMs: 2,
      pollIntervalMs: 1,
    });
    await expect(timeoutExecutor.publishAndWait(compilationInput())).rejects.toThrow(
      "Source compilation publication timed out",
    );
    expect(timeoutFixture.cancel).toHaveBeenCalledOnce();
  });
});

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

  it("returns activated only after the compilation attempt is bound and jointly committed", async () => {
    const logicalDocuments = repository();
    const compilationPublication: SourceCompilationPublicationExecutor = {
      publishAndWait: async (input) => {
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
        return "published";
      },
    };
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication,
      logicalDocuments,
      now: () => NOW,
    });

    await expect(publisher.publish(publicationInput())).resolves.toEqual({
      documentId: DOCUMENT_ID,
      kind: "activated",
      revision: 1,
    });
    await expect(
      logicalDocuments.getRevision({
        documentId: DOCUMENT_ID,
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ compilationAttemptId: ATTEMPT_ID, state: "active" });
  });

  it("retires an unbound candidate when its execution fence is lost after creation", async () => {
    const logicalDocuments = repository();
    const publishAndWait = vi.fn<SourceCompilationPublicationExecutor["publishAndWait"]>();
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: { publishAndWait },
      logicalDocuments,
      now: () => NOW,
    });
    const assertActive = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("source lease lost after candidate creation"));

    await expect(publisher.publish(publicationInput(), { assertActive })).rejects.toThrow(
      "source lease lost after candidate creation",
    );
    expect(publishAndWait).not.toHaveBeenCalled();
    await expect(
      logicalDocuments.getRevision({
        documentId: DOCUMENT_ID,
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toBeNull();
  });

  it("rejects a published outcome that never bound its durable compilation attempt", async () => {
    const logicalDocuments = repository();
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: { publishAndWait: async () => "published" },
      logicalDocuments,
      now: () => NOW,
    });

    await expect(publisher.publish(publicationInput())).rejects.toThrow(
      "Compilation publication did not bind its durable attempt",
    );
    await expect(
      logicalDocuments.getRevision({
        documentId: DOCUMENT_ID,
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toBeNull();
  });

  it("fails and durably cleans a bound revision that was not jointly activated", async () => {
    const logicalDocuments = repository();
    const remoteDeletions = deletionSpies();
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: {
        publishAndWait: async (input) => {
          await input.bindCompilationAttempt(ATTEMPT_ID);
          return "published";
        },
      },
      logicalDocuments,
      now: () => NOW,
      remoteDeletions,
    });

    await expect(publisher.publish(publicationInput())).rejects.toThrow(
      "Compilation publication did not jointly activate the logical revision",
    );
    await expect(
      logicalDocuments.getRevision({
        documentId: DOCUMENT_ID,
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ compilationAttemptId: ATTEMPT_ID, state: "failed" });
    expect(remoteDeletions.requestDocumentDeletion).toHaveBeenCalledOnce();
  });

  it("preserves a committed revision when the execution fence is lost after publication", async () => {
    const logicalDocuments = repository();
    const remoteDeletions = deletionSpies();
    const compilationPublication: SourceCompilationPublicationExecutor = {
      publishAndWait: async (input) => {
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
        return "published";
      },
    };
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication,
      logicalDocuments,
      now: () => NOW,
      remoteDeletions,
    });
    const assertActive = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("source lease lost after publication"));

    await expect(publisher.publish(publicationInput(), { assertActive })).rejects.toThrow(
      "source lease lost after publication",
    );
    expect(remoteDeletions.requestDocumentDeletion).not.toHaveBeenCalled();
    await expect(
      logicalDocuments.getRevision({
        documentId: DOCUMENT_ID,
        knowledgeSpaceId: SPACE_ID,
        revision: 1,
        tenantId: TENANT_ID,
      }),
    ).resolves.toMatchObject({ state: "active" });
  });

  it("rejects unchanged outcomes without an active revision or matching content", async () => {
    const emptyRepository = repository();
    const emptyPublisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: { publishAndWait: async () => "unchanged" },
      logicalDocuments: emptyRepository,
      now: () => NOW,
    });
    await expect(emptyPublisher.publish(publicationInput())).rejects.toThrow(
      "Unchanged Source revision has no active logical document revision",
    );

    const mismatchRepository = repository();
    const initial = await mismatchRepository.createCandidateRevision({
      contentHash: "b".repeat(64),
      documentAssetId: ASSET_ID,
      documentAssetVersion: 1,
      knowledgeSpaceId: SPACE_ID,
      mimeType: "text/markdown",
      now: NOW,
      providerItemId: "provider-item-1",
      sizeBytes: 6,
      sourceId: SOURCE_ID,
      systemMetadata: {},
      tenantId: TENANT_ID,
      title: "old.md",
      trustedInternalAdmission: true,
    });
    await mismatchRepository.activateRevision({
      documentId: initial.document.id,
      expectedActiveRevision: null,
      expectedRowVersion: initial.document.rowVersion,
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: initial.revision.revision,
      tenantId: TENANT_ID,
    });
    const mismatchPublisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: { publishAndWait: async () => "unchanged" },
      logicalDocuments: mismatchRepository,
      now: () => NOW,
    });
    await expect(
      mismatchPublisher.publish({ ...publicationInput(), documentAssetId: SECOND_ASSET_ID }),
    ).rejects.toThrow("Unchanged Source revision does not match the active content hash");
  });

  it("fails closed when bound cleanup lacks ownership, deletion storage, or exact eligibility", async () => {
    const compileThenFail: SourceCompilationPublicationExecutor = {
      publishAndWait: async (input) => {
        await input.bindCompilationAttempt(ATTEMPT_ID);
        throw new Error("compilation failed");
      },
    };

    const missingOwnershipPublisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: compileThenFail,
      logicalDocuments: repository(),
      now: () => NOW,
      remoteDeletions: deletionSpies(),
    });
    await expect(
      missingOwnershipPublisher.publish({
        ...publicationInput(),
        materializationOwnership: undefined,
      }),
    ).rejects.toThrow("Failed Source materialization has no durable run ownership proof");

    const missingDeletionPublisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: compileThenFail,
      logicalDocuments: repository(),
      now: () => NOW,
    });
    await expect(missingDeletionPublisher.publish(publicationInput())).rejects.toThrow(
      "Durable document cleanup is required for failed Source materialization",
    );

    const ineligibleBase = repository();
    const isFailedSourceRevisionCleanupEligible = vi.fn(async () => false);
    const ineligiblePublisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: compileThenFail,
      logicalDocuments: {
        ...ineligibleBase,
        isFailedSourceRevisionCleanupEligible,
      },
      now: () => NOW,
      remoteDeletions: deletionSpies(),
    });
    await expect(ineligiblePublisher.publish(publicationInput())).rejects.toThrow(
      "Failed Source materialization did not satisfy exact durable cleanup ownership",
    );
    expect(isFailedSourceRevisionCleanupEligible).toHaveBeenCalledOnce();
  });

  it("uses a capability grant as the sole durable publication and cleanup authorization", async () => {
    const logicalDocuments = repository();
    const remoteDeletions = deletionSpies();
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: {
        publishAndWait: async (input) => {
          await input.bindCompilationAttempt(ATTEMPT_ID);
          throw new Error("compilation failed with capability");
        },
      },
      logicalDocuments,
      now: () => NOW,
      remoteDeletions,
    });
    const {
      permissionSnapshot: _permissionSnapshot,
      requestedBySubjectId: _requestedBySubjectId,
      ...base
    } = publicationInput();

    await expect(
      publisher.publish({ ...base, capabilityGrantId: CAPABILITY_GRANT_ID }),
    ).rejects.toThrow("compilation failed with capability");
    expect(remoteDeletions.requestDocumentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ capabilityGrantId: CAPABILITY_GRANT_ID }),
    );
  });

  it("discards an unbound candidate when the active Source content is unchanged", async () => {
    const logicalDocuments = repository();
    const initial = await logicalDocuments.createCandidateRevision({
      contentHash: publicationInput().contentHash,
      documentAssetId: ASSET_ID,
      documentAssetVersion: 1,
      knowledgeSpaceId: SPACE_ID,
      mimeType: "text/markdown",
      now: NOW,
      providerItemId: "provider-item-1",
      sizeBytes: 6,
      sourceId: SOURCE_ID,
      systemMetadata: {},
      tenantId: TENANT_ID,
      title: "source.md",
      trustedInternalAdmission: true,
    });
    await logicalDocuments.activateRevision({
      documentId: initial.document.id,
      expectedActiveRevision: null,
      expectedRowVersion: initial.document.rowVersion,
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: initial.revision.revision,
      tenantId: TENANT_ID,
    });
    const publishAndWait = vi.fn<SourceCompilationPublicationExecutor["publishAndWait"]>();
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: { publishAndWait },
      logicalDocuments,
      now: () => NOW,
    });
    const ownership = publicationInput().materializationOwnership;
    if (!ownership) throw new Error("Expected Source materialization ownership");

    await expect(
      publisher.publish({
        ...publicationInput(),
        documentAssetId: SECOND_ASSET_ID,
        materializationOwnership: {
          ...ownership,
          itemKey: "provider-item-1",
        },
      }),
    ).resolves.toEqual({
      documentId: DOCUMENT_ID,
      kind: "unchanged",
      revision: 1,
    });
    expect(publishAndWait).not.toHaveBeenCalled();
    await expect(
      logicalDocuments.getRevision({
        documentId: DOCUMENT_ID,
        knowledgeSpaceId: SPACE_ID,
        revision: 2,
        tenantId: TENANT_ID,
      }),
    ).resolves.toBeNull();
  });

  it("validates publication dependencies and authorization before creating a candidate", async () => {
    expect(() =>
      createJointCasSourceLogicalRevisionPublisher({
        compilationPublication: undefined,
        logicalDocuments: repository(),
      }),
    ).toThrow("Source logical revision publishing requires logical documents");

    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: { publishAndWait: vi.fn() },
      logicalDocuments: repository(),
    });
    await expect(
      publisher.publish({ ...publicationInput(), capabilityGrantId: CAPABILITY_GRANT_ID }),
    ).rejects.toThrow("Source logical revision requires exactly one durable authorization binding");
    const {
      permissionSnapshot: _permissionSnapshot,
      requestedBySubjectId: _requestedBySubjectId,
      ...unbound
    } = publicationInput();
    await expect(publisher.publish(unbound)).rejects.toThrow(
      "Source logical revision requires exactly one durable authorization binding",
    );
  });

  it("handles remote retain, missing, identity drift, provenance, and durable tombstone admission", async () => {
    const logicalDocuments = repository();
    const created = await logicalDocuments.createCandidateRevision({
      contentHash: publicationInput().contentHash,
      documentAssetId: ASSET_ID,
      documentAssetVersion: 1,
      knowledgeSpaceId: SPACE_ID,
      mimeType: "text/markdown",
      now: NOW,
      providerItemId: "provider-item-1",
      sizeBytes: 6,
      sourceId: SOURCE_ID,
      systemMetadata: {},
      tenantId: TENANT_ID,
      title: "source.md",
      trustedInternalAdmission: true,
    });
    await logicalDocuments.activateRevision({
      documentId: created.document.id,
      expectedActiveRevision: null,
      expectedRowVersion: created.document.rowVersion,
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      revision: created.revision.revision,
      tenantId: TENANT_ID,
    });
    const remoteDeletions = deletionSpies();
    const publisher = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: { publishAndWait: vi.fn() },
      logicalDocuments,
      remoteDeletions,
    });
    const tombstone = {
      documentId: DOCUMENT_ID,
      knowledgeSpaceId: SPACE_ID,
      now: NOW,
      permissionSnapshot: publicationInput().permissionSnapshot,
      policy: "tombstone" as const,
      providerItemId: "provider-item-1",
      requestedBySubjectId: publicationInput().requestedBySubjectId,
      sourceId: SOURCE_ID,
      tenantId: TENANT_ID,
    };

    await expect(publisher.markRemoteMissing?.({ ...tombstone, policy: "retain" })).resolves.toBe(
      undefined,
    );
    await expect(
      publisher.markRemoteMissing?.({
        ...tombstone,
        documentId: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c99",
      }),
    ).resolves.toBeUndefined();
    await expect(
      publisher.markRemoteMissing?.({ ...tombstone, providerItemId: "provider-item-moved" }),
    ).rejects.toThrow("Remote tombstone identity no longer matches the logical document");
    const {
      permissionSnapshot: _permission,
      requestedBySubjectId: _requester,
      ...withoutAuthorization
    } = tombstone;
    await expect(publisher.markRemoteMissing?.(withoutAuthorization)).rejects.toThrow(
      "Remote tombstone has no durable authorization provenance",
    );
    const assertActive = vi.fn(async () => undefined);
    await expect(
      publisher.markRemoteMissing?.(tombstone, { assertActive }),
    ).resolves.toBeUndefined();
    expect(remoteDeletions.requestLogicalDocumentDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        expectedDocumentRowVersion: 1,
        idempotencyKey: `source-remote-missing:${SOURCE_ID}:${DOCUMENT_ID}`,
        permissionSnapshotId: "permission-snapshot-1",
      }),
    );
    expect(assertActive).toHaveBeenCalledTimes(2);

    const withoutDeletion = createJointCasSourceLogicalRevisionPublisher({
      compilationPublication: { publishAndWait: vi.fn() },
      logicalDocuments,
    });
    await expect(withoutDeletion.markRemoteMissing?.(tombstone)).rejects.toThrow(
      "Durable logical document deletion is required for remote tombstones",
    );
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

function compilationInput() {
  return {
    ...publicationInput(),
    bindCompilationAttempt: async (_attemptId: string) => undefined,
    logicalDocumentFence: {
      documentId: DOCUMENT_ID,
      expectedActiveRevision: null,
      expectedDocumentRowVersion: 0,
      revision: 1,
    },
  };
}

function compilationJob(overrides: Partial<DocumentCompilationJob> = {}): DocumentCompilationJob {
  return {
    createdAt: Date.parse(NOW),
    documentAssetId: ASSET_ID,
    id: ATTEMPT_ID,
    knowledgeSpaceId: SPACE_ID,
    runState: "queued",
    stage: "queued",
    tenantId: TENANT_ID,
    updatedAt: Date.parse(NOW),
    version: 1,
    ...overrides,
  };
}

function compilationJobs(
  states: readonly (DocumentCompilationJob | null)[],
  options: {
    readonly cancelError?: Error;
    readonly releaseDispatch?: boolean;
    readonly repeatLast?: boolean;
  } = {},
) {
  let stateIndex = 0;
  const start = vi.fn(async () => compilationJob());
  const get = vi.fn(async () => {
    const value = states[stateIndex] ?? null;
    if (stateIndex < states.length - 1 || !options.repeatLast) stateIndex += 1;
    return value;
  });
  const cancel = vi.fn(async () => {
    if (options.cancelError) throw options.cancelError;
    return compilationJob({ runState: "canceled", stage: "canceled" });
  });
  const releaseDispatch = vi.fn(async () => compilationJob({ runState: "queued" }));
  const jobs: DocumentCompilationJobStateMachine = {
    advance: vi.fn(async () => compilationJob()),
    cancel,
    fail: vi.fn(async () => compilationJob({ runState: "failed", stage: "failed" })),
    get,
    getMany: vi.fn(async () => []),
    ...(options.releaseDispatch ? { releaseDispatch } : {}),
    start,
  };
  return { cancel, get, jobs, releaseDispatch, start };
}

function documentAsset(): DocumentAsset {
  return {
    createdAt: NOW,
    filename: "source.md",
    id: ASSET_ID,
    knowledgeSpaceId: SPACE_ID,
    metadata: {},
    mimeType: "text/markdown",
    objectKey: "knowledge/source.md",
    parserStatus: "parsed",
    sha256: "a".repeat(64),
    sizeBytes: 6,
    sourceId: SOURCE_ID,
    updatedAt: NOW,
    version: 1,
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
