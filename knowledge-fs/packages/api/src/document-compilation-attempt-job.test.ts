import { describe, expect, it, vi } from "vitest";

import { createDurableDocumentCompilationJobStateMachine } from "./document-compilation-attempt-job";
import { createInMemoryDocumentCompilationAttemptRepository } from "./document-compilation-attempt-repository";

const attemptId = "11111111-1111-4111-8111-111111111111";
const outboxId = "22222222-2222-4222-8222-222222222222";
const generationId = "33333333-3333-4333-8333-333333333333";
const assetId = "44444444-4444-4444-8444-444444444444";
const spaceId = "55555555-5555-4555-8555-555555555555";
const bootstrapId = "66666666-6666-4666-8666-666666666666";
const lockToken = "88888888-8888-4888-8888-888888888888";

describe("durable document compilation job control plane", () => {
  it("starts with capability-only provenance and rejects mixed legacy binding", async () => {
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const jobs = createDurableDocumentCompilationJobStateMachine({
      attempts,
      generateAttemptId: () => attemptId,
      generateOutboxId: () => outboxId,
      generatePublicationGenerationId: () => generationId,
      maxExecutionAttempts: 5,
      now: () => "2026-07-13T10:00:00.000Z",
      resolveBaseHeadRevision: async () => 0,
    });
    const capabilityGrantId = "77777777-7777-4777-8777-777777777777";

    await expect(
      jobs.start({
        capabilityGrantId,
        documentAssetId: assetId,
        knowledgeSpaceId: spaceId,
        tenantId: "tenant-1",
        version: 2,
      }),
    ).resolves.toMatchObject({ capabilityGrantId });
    await expect(attempts.get(attemptId)).resolves.toMatchObject({ capabilityGrantId });
    await expect(attempts.get(attemptId)).resolves.not.toHaveProperty("permissionSnapshot");
    await expect(attempts.get(attemptId)).resolves.not.toHaveProperty("requestedBySubjectId");

    await expect(
      jobs.start({
        capabilityGrantId,
        documentAssetId: assetId,
        knowledgeSpaceId: spaceId,
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "99999999-9999-4999-8999-999999999999",
          revision: 1,
        },
        requestedBySubjectId: "editor-1",
        tenantId: "tenant-1",
        version: 2,
      }),
    ).rejects.toThrow("exactly one authorization binding");
  });

  it("commits a dispatch-pending attempt without requiring a queue id", async () => {
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const record = vi.fn();
    const jobs = createDurableDocumentCompilationJobStateMachine({
      attempts,
      generateAttemptId: () => attemptId,
      generateOutboxId: () => outboxId,
      generatePublicationGenerationId: () => generationId,
      maxExecutionAttempts: 5,
      metrics: { record },
      now: () => "2026-07-13T10:00:00.000Z",
      resolveBaseHeadRevision: async () => 7,
    });

    const job = await jobs.start({
      documentAssetId: assetId,
      knowledgeSpaceId: spaceId,
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "77777777-7777-4777-8777-777777777777",
        revision: 1,
      },
      requestedBySubjectId: "editor-1",
      tenantId: "tenant-1",
      version: 2,
    });

    expect(job).toMatchObject({
      baseHeadRevision: 7,
      executionAttempts: 0,
      id: attemptId,
      maxExecutionAttempts: 5,
      publicationGenerationId: generationId,
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "77777777-7777-4777-8777-777777777777",
        revision: 1,
      },
      requestedBySubjectId: "editor-1",
      runState: "dispatch_pending",
      stage: "queued",
    });
    expect(job).not.toHaveProperty("queueJobId");
    expect(record).toHaveBeenCalledWith({
      lifecycle: "queued",
      taskKind: "document_compilation",
    });

    await expect(
      jobs.start({
        documentAssetId: assetId,
        knowledgeSpaceId: spaceId,
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "77777777-7777-4777-8777-777777777777",
          revision: 1,
        },
        requestedBySubjectId: "editor-1",
        tenantId: "tenant-1",
        version: 2,
      }),
    ).resolves.toMatchObject({ id: attemptId });
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("keeps a deferred attempt unclaimable until product staging releases dispatch", async () => {
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const jobs = createDurableDocumentCompilationJobStateMachine({
      attempts,
      generateAttemptId: () => attemptId,
      generateOutboxId: () => outboxId,
      generatePublicationGenerationId: () => generationId,
      maxExecutionAttempts: 5,
      now: () => "2026-07-13T10:00:00.000Z",
      resolveBaseHeadRevision: async () => 0,
    });
    const job = await jobs.start({
      deferDispatch: true,
      documentAssetId: assetId,
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
      version: 1,
    });

    await expect(
      attempts.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T10:05:00.000Z",
        lockToken,
        now: "2026-07-13T10:00:00.000Z",
        workerId: "dispatcher-1",
      }),
    ).resolves.toEqual([]);
    await expect(jobs.releaseDispatch?.(job.id)).resolves.toMatchObject({
      id: job.id,
      runState: "dispatch_pending",
    });
    await expect(
      attempts.claimOutbox({
        limit: 1,
        lockedUntil: "2026-07-13T10:05:00.000Z",
        lockToken,
        now: "2026-07-13T10:00:00.000Z",
        workerId: "dispatcher-1",
      }),
    ).resolves.toEqual([expect.objectContaining({ attemptId, status: "dispatching" })]);
  });

  it("rejects ordinary compilation behind a space bootstrap fence and admits its internal child", async () => {
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const jobs = createDurableDocumentCompilationJobStateMachine({
      assertCompilationAdmission: async (input) => {
        if (input.bootstrapJobId !== bootstrapId) {
          throw new Error("space bootstrap active");
        }
      },
      attempts,
      generateAttemptId: () => attemptId,
      generateOutboxId: () => outboxId,
      generatePublicationGenerationId: () => generationId,
      maxExecutionAttempts: 5,
      now: () => "2026-07-13T10:00:00.000Z",
      resolveBaseHeadRevision: async () => 0,
    });
    const input = {
      documentAssetId: assetId,
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
      version: 1,
    };

    await expect(jobs.start(input)).rejects.toThrow("space bootstrap active");
    await expect(attempts.get(attemptId)).resolves.toBeNull();
    await expect(jobs.start({ ...input, bootstrapJobId: bootstrapId })).resolves.toMatchObject({
      id: attemptId,
      runState: "dispatch_pending",
    });
  });

  it("cancels before dispatch and does not reactivate a user-canceled attempt", async () => {
    let now = "2026-07-13T10:00:00.000Z";
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const jobs = createDurableDocumentCompilationJobStateMachine({
      attempts,
      generateAttemptId: () => attemptId,
      generateOutboxId: () => outboxId,
      generatePublicationGenerationId: () => generationId,
      maxExecutionAttempts: 5,
      now: () => now,
      resolveBaseHeadRevision: async () => 0,
    });
    const started = await jobs.start({
      documentAssetId: assetId,
      knowledgeSpaceId: spaceId,
      tenantId: "tenant-1",
      version: 1,
    });

    now = "2026-07-13T10:01:00.000Z";
    await expect(jobs.cancel(started.id, "user request")).resolves.toMatchObject({
      error: "user request",
      runState: "canceled",
      stage: "canceled",
    });
    now = "2026-07-13T10:02:00.000Z";
    await expect(jobs.retry?.(started.id)).rejects.toThrow(
      "Document compilation attempt cannot be retried",
    );
  });

  it("rechecks deletion admission and binds a fresh caller permission before retry", async () => {
    let deletionActive = false;
    let now = "2026-07-13T10:00:00.000Z";
    const attempts = createInMemoryDocumentCompilationAttemptRepository();
    const jobs = createDurableDocumentCompilationJobStateMachine({
      assertCompilationAdmission: async () => {
        if (deletionActive) throw new Error("knowledge space deletion active");
      },
      attempts,
      generateAttemptId: () => attemptId,
      generateOutboxId: () => outboxId,
      generatePublicationGenerationId: () => generationId,
      maxExecutionAttempts: 5,
      now: () => now,
      resolveBaseHeadRevision: async () => 0,
    });
    await jobs.start({
      documentAssetId: assetId,
      knowledgeSpaceId: spaceId,
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "77777777-7777-4777-8777-777777777777",
        revision: 1,
      },
      requestedBySubjectId: "former-editor",
      tenantId: "tenant-1",
      version: 1,
    });
    await attempts.claimOutbox({
      limit: 1,
      lockedUntil: "2026-07-13T10:05:00.000Z",
      lockToken,
      now,
      workerId: "dispatcher-1",
    });
    now = "2026-07-13T10:00:01.000Z";
    await attempts.releaseOutbox({
      availableAt: "2026-07-13T10:01:00.000Z",
      deadLetter: true,
      error: "dispatch exhausted",
      lockToken,
      now,
      outboxId,
    });

    deletionActive = true;
    await expect(jobs.retry?.(attemptId)).rejects.toThrow("knowledge space deletion active");
    await expect(attempts.get(attemptId)).resolves.toMatchObject({ runState: "failed" });

    deletionActive = false;
    now = "2026-07-13T10:02:00.000Z";
    await expect(
      jobs.retry?.(attemptId, {
        permissionSnapshot: {
          accessChannel: "interactive",
          id: "99999999-9999-4999-8999-999999999999",
          revision: 2,
        },
        requestedBySubjectId: "current-editor",
      }),
    ).resolves.toMatchObject({
      permissionSnapshot: {
        accessChannel: "interactive",
        id: "99999999-9999-4999-8999-999999999999",
        revision: 2,
      },
      requestedBySubjectId: "current-editor",
      runState: "dispatch_pending",
    });
  });
});
