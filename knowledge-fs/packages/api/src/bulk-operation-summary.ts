import type { BulkOperation, BulkOperationItemStatus, BulkOperationType } from "./bulk-operation";
import type {
  DocumentCompilationJob,
  DocumentCompilationJobStateMachine,
} from "./document-compilation-job";

export interface BulkOperationSummary {
  readonly canceledItems: number;
  readonly completedItems: number;
  readonly createdAt: string;
  readonly failedItemIds: string[];
  readonly failedItems: number;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly status: "canceled" | "completed" | "failed" | "running";
  readonly totalItems: number;
  readonly type: BulkOperationType;
  readonly updatedAt: string;
}

export async function summarizeBulkOperation(
  operation: BulkOperation,
  documentCompilationJobs: DocumentCompilationJobStateMachine | undefined,
): Promise<BulkOperationSummary> {
  const compilationJobIds = operation.items
    .map((item) => item.compilationJobId)
    .filter((id): id is string => Boolean(id));
  const compilationJobsById = new Map<string, DocumentCompilationJob>();

  if (compilationJobIds.length > 0 && documentCompilationJobs) {
    const jobs = await documentCompilationJobs.getMany(compilationJobIds);

    for (const job of jobs) {
      compilationJobsById.set(job.id, job);
    }
  }

  let completedItems = 0;
  let canceledItems = 0;
  let updatedAtMs = Date.parse(operation.updatedAt);
  const failedItemIds: string[] = [];

  for (const item of operation.items) {
    const compilationJob = item.compilationJobId
      ? compilationJobsById.get(item.compilationJobId)
      : undefined;
    const status = item.compilationJobId
      ? summarizeCompilationItemStatus(compilationJob)
      : item.status;
    if (compilationJob) updatedAtMs = Math.max(updatedAtMs, compilationJob.updatedAt);

    if (status === "failed") {
      failedItemIds.push(item.documentId);
      continue;
    }

    if (status === "canceled") {
      canceledItems += 1;
      continue;
    }

    if (status === "completed" || status === "not_found") {
      completedItems += 1;
    }
  }

  const failedItems = failedItemIds.length;
  const totalItems = operation.items.length;
  const terminalItems = completedItems + failedItems + canceledItems;
  const status: "canceled" | "completed" | "failed" | "running" =
    failedItems > 0 && terminalItems === totalItems
      ? "failed"
      : completedItems === totalItems
        ? "completed"
        : canceledItems > 0 && terminalItems === totalItems
          ? "canceled"
          : "running";

  return {
    canceledItems,
    completedItems,
    createdAt: operation.createdAt,
    failedItemIds,
    failedItems,
    id: operation.id,
    knowledgeSpaceId: operation.knowledgeSpaceId,
    status,
    totalItems,
    type: operation.type,
    updatedAt: new Date(updatedAtMs).toISOString(),
  };
}

function summarizeCompilationItemStatus(
  job: DocumentCompilationJob | undefined,
): BulkOperationItemStatus {
  if (!job) {
    return "failed";
  }

  if (job.stage === "failed") {
    return "failed";
  }
  if (job.stage === "canceled") return "canceled";

  if (
    job.stage === "projection_built" ||
    job.stage === "smoke_eval_passed" ||
    job.stage === "published"
  ) {
    return "completed";
  }

  return "queued";
}
