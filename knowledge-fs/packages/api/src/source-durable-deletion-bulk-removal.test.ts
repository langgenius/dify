import { describe, expect, it, vi } from "vitest";

import { createDurableSourceBulkRemovalRequester } from "./source-durable-deletion-bulk-removal";

const permissionFence = {
  accessChannel: "interactive" as const,
  knowledgeSpaceId: "space-a",
  permissionSnapshotId: "permission-a",
  permissionSnapshotRevision: 3,
  requestedBySubjectId: "editor-a",
  tenantId: "tenant-a",
};

describe("durable source bulk-removal requester", () => {
  it("persists a cascade deletion with the frozen child idempotency and permission provenance", async () => {
    const requestSourceDeletion = vi.fn(
      async () =>
        ({
          created: true,
          job: deletionJob("dispatch_pending"),
        }) as never,
    );
    const requester = createDurableSourceBulkRemovalRequester({
      now: () => Date.parse("2026-07-14T12:00:00.000Z"),
      repository: {
        getJob: vi.fn(async () => null),
        getJobByIdempotency: vi.fn(async () => null),
        requestSourceDeletion,
      },
    });

    await expect(
      requester.request({
        expectedSourceVersion: 7,
        idempotencyKey: "source-bulk:run-a:source-a",
        knowledgeSpaceId: "space-a",
        permissionFence,
        sourceId: "source-a",
        tenantId: "tenant-a",
      }),
    ).resolves.toEqual({ deletionJobId: "deletion-source-a", state: "pending" });

    expect(requestSourceDeletion).toHaveBeenCalledWith({
      accessChannel: "interactive",
      createdAt: "2026-07-14T12:00:00.000Z",
      deleteMode: "cascade",
      expectedVersion: 7,
      idempotencyKey: "source-bulk:run-a:source-a",
      knowledgeSpaceId: "space-a",
      permissionSnapshotId: "permission-a",
      permissionSnapshotRevision: 3,
      requestedBySubjectId: "editor-a",
      sourceId: "source-a",
      tenantId: "tenant-a",
    });
  });

  it("rejects a cross-scope fence before touching the durable deletion repository", async () => {
    const requestSourceDeletion = vi.fn(
      async () =>
        ({
          created: true,
          job: deletionJob("dispatch_pending"),
        }) as never,
    );
    const requester = createDurableSourceBulkRemovalRequester({
      repository: {
        getJob: vi.fn(async () => null),
        getJobByIdempotency: vi.fn(async () => null),
        requestSourceDeletion,
      },
    });

    await expect(
      requester.request({
        expectedSourceVersion: 7,
        idempotencyKey: "source-bulk:run-a:source-a",
        knowledgeSpaceId: "space-other",
        permissionFence,
        sourceId: "source-a",
        tenantId: "tenant-a",
      }),
    ).rejects.toThrow("outside the requested scope");
    expect(requestSourceDeletion).not.toHaveBeenCalled();
  });

  it("recovers an accepted job by child idempotency and reports only terminal deletion success", async () => {
    const getJob = vi.fn(async () => deletionJob("succeeded"));
    const getJobByIdempotency = vi.fn(async () => deletionJob("running"));
    const requester = createDurableSourceBulkRemovalRequester({
      repository: {
        getJob,
        getJobByIdempotency,
        requestSourceDeletion: vi.fn(async () => ({ created: true }) as never),
      },
    });

    await expect(
      requester.find({
        idempotencyKey: "source-bulk:run-a:source-a",
        knowledgeSpaceId: "space-a",
        sourceId: "source-a",
        tenantId: "tenant-a",
      }),
    ).resolves.toEqual({ deletionJobId: "deletion-source-a", state: "pending" });
    await expect(
      requester.get({
        deletionJobId: "deletion-source-a",
        knowledgeSpaceId: "space-a",
        sourceId: "source-a",
        tenantId: "tenant-a",
      }),
    ).resolves.toEqual({ deletionJobId: "deletion-source-a", state: "succeeded" });
  });
});

function deletionJob(runState: string) {
  return {
    id: "deletion-source-a",
    knowledgeSpaceId: "space-a",
    runState,
    targetId: "source-a",
    targetType: "source",
    tenantId: "tenant-a",
  } as never;
}
