import type { DurableDeletionJob, DurableDeletionRepository } from "./durable-deletion-repository";
import type {
  SourceBulkRemovalRequester,
  SourceBulkRemovalStatus,
} from "./source-product-workflow-runtime";

export interface CreateDurableSourceBulkRemovalRequesterOptions {
  readonly now?: (() => number) | undefined;
  readonly repository: Pick<
    DurableDeletionRepository,
    "getJob" | "getJobByIdempotency" | "requestSourceDeletion"
  >;
}

/**
 * Bridges a frozen Source bulk child into the durable deletion ledger. The repository performs the
 * final space/deletion, permission, source-scope and source-version checks in one transaction, so
 * this adapter must not replace the worker's durable permission provenance with a fresh identity.
 */
export function createDurableSourceBulkRemovalRequester({
  now = Date.now,
  repository,
}: CreateDurableSourceBulkRemovalRequesterOptions): SourceBulkRemovalRequester {
  const status = (
    job: DurableDeletionJob | null,
    expected: {
      readonly knowledgeSpaceId: string;
      readonly sourceId: string;
      readonly tenantId: string;
    },
  ): SourceBulkRemovalStatus | null => {
    if (!job) return null;
    if (
      job.tenantId !== expected.tenantId ||
      job.knowledgeSpaceId !== expected.knowledgeSpaceId ||
      job.targetType !== "source" ||
      job.targetId !== expected.sourceId
    ) {
      throw new Error("Durable deletion job is outside the Source bulk child scope");
    }
    if (job.runState === "succeeded") {
      return { deletionJobId: job.id, state: "succeeded" };
    }
    if (job.runState === "failed" || job.runState === "canceled") {
      return {
        deletionJobId: job.id,
        errorCode:
          job.runState === "canceled"
            ? "SOURCE_DURABLE_DELETION_CANCELED"
            : "SOURCE_DURABLE_DELETION_FAILED",
        reason:
          job.runState === "canceled"
            ? "Durable source deletion was canceled"
            : "Durable source deletion failed",
        state: "failed",
      };
    }
    return { deletionJobId: job.id, state: "pending" };
  };

  return {
    async find(input) {
      return status(
        await repository.getJobByIdempotency({
          idempotencyKey: input.idempotencyKey,
          tenantId: input.tenantId,
        }),
        input,
      );
    },
    async get(input) {
      return status(
        await repository.getJob({ id: input.deletionJobId, tenantId: input.tenantId }),
        input,
      );
    },
    async request(input) {
      if (
        input.permissionFence.tenantId !== input.tenantId ||
        input.permissionFence.knowledgeSpaceId !== input.knowledgeSpaceId
      ) {
        throw new Error("Source bulk-removal permission fence is outside the requested scope");
      }
      const timestamp = now();
      if (!Number.isFinite(timestamp)) {
        throw new Error("Source bulk-removal clock returned an invalid timestamp");
      }
      const result = await repository.requestSourceDeletion({
        accessChannel: input.permissionFence.accessChannel,
        createdAt: new Date(timestamp).toISOString(),
        deleteMode: "cascade",
        expectedVersion: input.expectedSourceVersion,
        idempotencyKey: input.idempotencyKey,
        knowledgeSpaceId: input.knowledgeSpaceId,
        permissionSnapshotId: input.permissionFence.permissionSnapshotId,
        permissionSnapshotRevision: input.permissionFence.permissionSnapshotRevision,
        requestedBySubjectId: input.permissionFence.requestedBySubjectId,
        sourceId: input.sourceId,
        tenantId: input.tenantId,
      });
      const accepted = status(result.job, input);
      if (!accepted) throw new Error("Durable source deletion request did not return its job");
      return accepted;
    },
  };
}
