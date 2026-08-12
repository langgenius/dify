import type { BulkOperation } from "./bulk-operation";
import type { BulkOperationFailure, BulkOperationSummary } from "./bulk-operation-summary";
import type {
  DocumentProcessingOperation,
  DocumentProcessingPhase,
  DocumentProcessingTask,
  DocumentSemanticEnrichmentProgress,
} from "./document-processing-task-repository";
import {
  type KnowledgeFsPublicFailure,
  knowledgeFsFailureAllowsManualRetry,
  knowledgeFsFailureForCode,
} from "./knowledge-fs-errors";
import type { SourceWorkflowRun } from "./source-product-workflow";

export type BackgroundTaskKind = "document" | "document_bulk" | "source";

export type BackgroundTaskOperation =
  | "document_processing"
  | "document_upload"
  | "document_delete"
  | "document_reindex"
  | "source_crawl_preview"
  | "source_crawl_import"
  | "source_online_document_import"
  | "source_online_drive_import"
  | "source_sync"
  | "source_bulk";

export type BackgroundTaskState = "queued" | "running" | "completed" | "failed" | "canceled";

export interface BackgroundTaskItemFailure extends BulkOperationFailure {
  readonly failure: KnowledgeFsPublicFailure;
}

export interface BackgroundTask {
  readonly activeOperations?: readonly DocumentProcessingOperation[] | undefined;
  readonly canCancel: boolean;
  readonly canRetry: boolean;
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly documentId?: string | undefined;
  readonly documentRevision?: number | undefined;
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly failure?: KnowledgeFsPublicFailure | undefined;
  readonly failures?: readonly BackgroundTaskItemFailure[] | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly operation: BackgroundTaskOperation;
  readonly phase?: DocumentProcessingPhase | undefined;
  readonly progressCompleted: number;
  readonly progressFailed: number;
  readonly progressPercent: number;
  readonly progressTotal: number;
  readonly sourceId?: string | undefined;
  readonly state: BackgroundTaskState;
  readonly semanticEnrichment?: DocumentSemanticEnrichmentProgress | undefined;
  readonly taskKind: BackgroundTaskKind;
  readonly updatedAt: string;
}

export interface BackgroundTaskCursor {
  readonly bulk?: { readonly createdAt: string; readonly id: string } | undefined;
  readonly document?: { readonly createdAt: string; readonly id: string } | undefined;
  readonly source?: { readonly createdAt: string; readonly id: string } | undefined;
  readonly version: 1;
}

export function documentBackgroundTask(task: DocumentProcessingTask): BackgroundTask {
  const state = documentState(task.state);
  const failure =
    state === "failed"
      ? taskFailure(task.errorCode, "DOCUMENT_COMPILATION_FAILED", task.phase, task.id)
      : undefined;
  return {
    ...(task.activeOperations ? { activeOperations: task.activeOperations } : {}),
    canCancel: state === "queued" || state === "running",
    canRetry: state === "canceled" || knowledgeFsFailureAllowsManualRetry(failure),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    createdAt: task.createdAt,
    documentId: task.documentId,
    documentRevision: task.documentRevision,
    ...(failure ? { errorCode: failure.code, errorMessage: failure.message, failure } : {}),
    id: task.id,
    knowledgeSpaceId: task.knowledgeSpaceId,
    operation: "document_processing",
    ...(task.phase ? { phase: task.phase } : {}),
    progressCompleted: state === "completed" ? 1 : 0,
    progressFailed: state === "failed" ? 1 : 0,
    progressPercent: task.progressPercent,
    progressTotal: 1,
    state,
    ...(task.semanticEnrichment ? { semanticEnrichment: task.semanticEnrichment } : {}),
    taskKind: "document",
    updatedAt: task.updatedAt,
  };
}

export function bulkBackgroundTask(
  operation: BulkOperation,
  summary: BulkOperationSummary,
): BackgroundTask {
  const state = summary.status;
  const failures = summary.failures?.map((item) => {
    const failure = taskFailure(
      item.errorCode,
      "DOCUMENT_COMPILATION_FAILED",
      operation.type,
      item.jobId,
    );
    return { ...item, errorCode: failure.code, errorMessage: failure.message, failure };
  });
  const failure =
    state === "failed"
      ? (failures?.[0]?.failure ??
        taskFailure(undefined, "DOCUMENT_COMPILATION_FAILED", operation.type, summary.id))
      : undefined;
  const hasRetryableFailure =
    failures?.some((item) => knowledgeFsFailureAllowsManualRetry(item.failure)) ??
    knowledgeFsFailureAllowsManualRetry(failure);
  return {
    canCancel: operation.type !== "document_delete" && state === "running",
    canRetry: state === "canceled" || (state === "failed" && hasRetryableFailure),
    ...(state === "completed" || state === "failed" || state === "canceled"
      ? { completedAt: summary.updatedAt }
      : {}),
    createdAt: summary.createdAt,
    ...(failure
      ? {
          errorCode: failure.code,
          errorMessage: failure.message,
          failure,
        }
      : {}),
    id: summary.id,
    ...(failures?.length ? { failures } : {}),
    knowledgeSpaceId: summary.knowledgeSpaceId,
    operation: operation.type,
    progressCompleted: summary.completedItems,
    progressFailed: summary.failedItems,
    progressPercent:
      summary.totalItems === 0
        ? 100
        : Math.round(
            ((summary.completedItems + summary.failedItems + summary.canceledItems) /
              summary.totalItems) *
              100,
          ),
    progressTotal: summary.totalItems,
    state,
    taskKind: "document_bulk",
    updatedAt: summary.updatedAt,
  };
}

export function sourceBackgroundTask(run: SourceWorkflowRun): BackgroundTask {
  const state = sourceState(run.state);
  const progressTotal = run.progressTotal ?? 1;
  const terminalProgress = state === "completed" ? progressTotal : run.progressCompleted;
  const failure =
    state === "failed"
      ? taskFailure(run.lastErrorCode, "SOURCE_OPERATION_FAILED", run.checkpoint, run.id)
      : undefined;
  return {
    canCancel: state === "queued" || state === "running",
    canRetry: state === "canceled" || knowledgeFsFailureAllowsManualRetry(failure),
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    createdAt: run.createdAt,
    ...(failure ? { errorCode: failure.code, errorMessage: failure.message, failure } : {}),
    id: run.id,
    knowledgeSpaceId: run.knowledgeSpaceId,
    operation: sourceOperation(run.kind),
    progressCompleted: terminalProgress,
    progressFailed: run.progressFailed,
    progressPercent:
      progressTotal === 0
        ? 100
        : Math.min(
            100,
            Math.round(
              ((terminalProgress + run.progressFailed + run.progressSkipped) / progressTotal) * 100,
            ),
          ),
    progressTotal,
    ...(run.sourceId ? { sourceId: run.sourceId } : {}),
    state,
    taskKind: "source",
    updatedAt: run.updatedAt,
  };
}

export function encodeBackgroundTaskCursor(cursor: BackgroundTaskCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeBackgroundTaskCursor(value: string): BackgroundTaskCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new Error("Invalid background task cursor");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid background task cursor");
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !validPair(record.document) ||
    !validPair(record.bulk) ||
    !validPair(record.source)
  ) {
    throw new Error("Invalid background task cursor");
  }
  return {
    ...(record.bulk ? { bulk: record.bulk as BackgroundTaskCursor["bulk"] } : {}),
    ...(record.document ? { document: record.document as BackgroundTaskCursor["document"] } : {}),
    ...(record.source ? { source: record.source as BackgroundTaskCursor["source"] } : {}),
    version: 1,
  };
}

function validPair(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pair = value as Record<string, unknown>;
  return (
    Object.keys(pair).length === 2 &&
    typeof pair.createdAt === "string" &&
    !Number.isNaN(Date.parse(pair.createdAt)) &&
    typeof pair.id === "string" &&
    pair.id.length > 0
  );
}

function documentState(state: DocumentProcessingTask["state"]): BackgroundTaskState {
  if (state === "succeeded") return "completed";
  if (state === "failed") return "failed";
  if (state === "canceled" || state === "superseded") return "canceled";
  if (state === "running") return "running";
  return "queued";
}

function sourceState(state: SourceWorkflowRun["state"]): BackgroundTaskState {
  if (state === "completed" || state === "zero_results" || state === "preview_ready") {
    return "completed";
  }
  if (state === "failed") return "failed";
  if (state === "canceled") return "canceled";
  if (state === "queued") return "queued";
  return "running";
}

function sourceOperation(kind: SourceWorkflowRun["kind"]): BackgroundTaskOperation {
  const operations = {
    "crawl-import": "source_crawl_import",
    "crawl-preview": "source_crawl_preview",
    "online-document-import": "source_online_document_import",
    "online-drive-import": "source_online_drive_import",
    bulk: "source_bulk",
    sync: "source_sync",
  } as const;
  return operations[kind];
}

function taskFailure(
  errorCode: string | undefined,
  fallbackCode: string,
  stage: string | undefined,
  traceId: string | undefined,
): KnowledgeFsPublicFailure {
  return knowledgeFsFailureForCode(errorCode ?? fallbackCode, {
    ...(stage ? { stage } : {}),
    ...(traceId ? { traceId } : {}),
  });
}
