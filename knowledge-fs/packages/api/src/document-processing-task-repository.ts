import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { readableDocumentAssetPredicateSql } from "./document-asset-visibility-sql";
import {
  type LogicalDocumentLookup,
  type LogicalDocumentScope,
  LogicalDocumentValidationError,
} from "./logical-document-repository";

import type { DatabaseAdapter, DatabaseQueryValue, DatabaseRow } from "@knowledge/core";

export type DocumentProcessingTaskState =
  | "dispatch_pending"
  | "queued"
  | "running"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "canceled"
  | "superseded";

export interface DocumentProcessingTask {
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly errorCode?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly progressPercent: number;
  readonly retryAt?: string | undefined;
  readonly stage:
    | "queued"
    | "parsed"
    | "outline_built"
    | "nodes_generated"
    | "projection_built"
    | "smoke_eval_passed"
    | "published";
  readonly state: DocumentProcessingTaskState;
  readonly updatedAt: string;
}

export interface DocumentProcessingTaskCursor {
  readonly createdAt: string;
  readonly id: string;
}

export interface ListDocumentProcessingTasksInput extends LogicalDocumentScope {
  readonly candidateGrants: readonly string[];
  readonly cursor?: DocumentProcessingTaskCursor | undefined;
  readonly documentId?: string | undefined;
  readonly limit: number;
}

export interface DocumentProcessingTaskRepository {
  get(
    input: LogicalDocumentLookup & { readonly taskId: string },
  ): Promise<DocumentProcessingTask | null>;
  list(input: ListDocumentProcessingTasksInput): Promise<{
    readonly items: DocumentProcessingTask[];
    readonly nextCursor?: DocumentProcessingTaskCursor | undefined;
  }>;
}

export function createInMemoryDocumentProcessingTaskRepository({
  canReadTask,
  tasks,
}: {
  readonly canReadTask: (input: {
    readonly candidateGrants: readonly string[];
    readonly task: DocumentProcessingTask;
  }) => boolean | Promise<boolean>;
  readonly tasks: () =>
    | readonly (DocumentProcessingTask & { readonly tenantId: string })[]
    | Promise<readonly (DocumentProcessingTask & { readonly tenantId: string })[]>;
}): DocumentProcessingTaskRepository {
  return {
    get: async (input) => {
      const task = (await tasks()).find(
        (candidate) =>
          candidate.id === input.taskId &&
          candidate.tenantId === input.tenantId &&
          candidate.knowledgeSpaceId === input.knowledgeSpaceId &&
          candidate.documentId === input.documentId,
      );
      return task ? publicTask(task) : null;
    },
    list: async (input) => {
      validateTaskLimit(input.limit);
      const matching: (DocumentProcessingTask & { readonly tenantId: string })[] = [];
      for (const task of (await tasks())
        .filter(
          (task) =>
            task.tenantId === input.tenantId &&
            task.knowledgeSpaceId === input.knowledgeSpaceId &&
            (!input.documentId || task.documentId === input.documentId) &&
            (!input.cursor || compareTaskCursor(task, input.cursor) > 0),
        )
        .sort(compareTasks)) {
        if (await canReadTask({ candidateGrants: input.candidateGrants, task })) {
          matching.push(task);
        }
        if (matching.length === input.limit + 1) break;
      }
      const items = matching.slice(0, input.limit).map(publicTask);
      const last = items.at(-1);
      return {
        items,
        ...(matching.length > input.limit && last
          ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
          : {}),
      };
    },
  };
}

export function createDatabaseDocumentProcessingTaskRepository({
  database,
  maxListLimit,
}: {
  readonly database: DatabaseAdapter;
  readonly maxListLimit: number;
}): DocumentProcessingTaskRepository {
  if (!Number.isSafeInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("maxListLimit must be positive");
  }
  return {
    get: async (input) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.tenantId, input.knowledgeSpaceId, input.documentId, input.taskId],
        sql: `${taskSelectSql(database)} WHERE attempt.${q(database, "tenant_id")} = ${p(database, 1)} AND attempt.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND revision.${q(database, "document_id")} = ${p(database, 3)} AND attempt.${q(database, "id")} = ${p(database, 4)} LIMIT 1;`,
        tableName: "document_compilation_attempts",
      });
      return result.rows[0] ? mapTask(result.rows[0]) : null;
    },
    list: async (input) => {
      validateTaskLimit(input.limit, maxListLimit);
      const params: DatabaseQueryValue[] = [
        input.tenantId,
        input.knowledgeSpaceId,
        JSON.stringify(input.candidateGrants),
      ];
      let filters = "";
      if (input.documentId) {
        params.push(input.documentId);
        filters += ` AND revision.${q(database, "document_id")} = ${p(database, params.length)}`;
      }
      if (input.cursor) {
        params.push(input.cursor.createdAt, input.cursor.id);
        const created = p(database, params.length - 1);
        const id = p(database, params.length);
        filters += ` AND (attempt.${q(database, "created_at")} > ${created} OR (attempt.${q(database, "created_at")} = ${created} AND attempt.${q(database, "id")} > ${id}))`;
      }
      params.push(input.limit + 1);
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `${taskSelectSql(database)} WHERE attempt.${q(database, "tenant_id")} = ${p(database, 1)} AND attempt.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${readableDocumentAssetPredicateSql(database, "asset", "task_list_parent_source")} AND ${assetPermissionSql(database, "asset", p(database, 3))}${filters} ORDER BY attempt.${q(database, "created_at")} ASC, attempt.${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName: "document_compilation_attempts",
      });
      const items = result.rows.slice(0, input.limit).map(mapTask);
      const last = items.at(-1);
      return {
        items,
        ...(result.rows.length > input.limit && last
          ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
          : {}),
      };
    },
  };
}

export function documentTaskSseEvents(task: DocumentProcessingTask): readonly {
  readonly data: Readonly<Record<string, unknown>>;
  readonly event: "progress" | "terminal";
  readonly id: string;
}[] {
  const progress = {
    data: {
      progressPercent: task.progressPercent,
      stage: task.stage,
      state: task.state,
      updatedAt: task.updatedAt,
    },
    event: "progress" as const,
    id: `${task.id}:${task.updatedAt}`,
  };
  return isTerminalTask(task)
    ? [
        progress,
        {
          data: {
            ...(task.errorCode ? { errorCode: task.errorCode } : {}),
            state: task.state,
          },
          event: "terminal" as const,
          id: `${task.id}:terminal`,
        },
      ]
    : [progress];
}

export function isTerminalTask(task: DocumentProcessingTask): boolean {
  return (
    task.state === "succeeded" ||
    task.state === "failed" ||
    task.state === "canceled" ||
    task.state === "superseded"
  );
}

function taskSelectSql(database: DatabaseAdapter): string {
  return `SELECT attempt.*, revision.${q(database, "document_id")} AS ${q(database, "logical_document_id")}, revision.${q(database, "revision")} AS ${q(database, "logical_document_revision")} FROM ${q(database, "document_compilation_attempts")} attempt JOIN ${q(database, "document_revisions")} revision ON revision.${q(database, "tenant_id")} = attempt.${q(database, "tenant_id")} AND revision.${q(database, "knowledge_space_id")} = attempt.${q(database, "knowledge_space_id")} AND revision.${q(database, "document_asset_id")} = attempt.${q(database, "document_asset_id")} AND revision.${q(database, "document_asset_version")} = attempt.${q(database, "document_version")} AND (revision.${q(database, "compilation_attempt_id")} = attempt.${q(database, "id")} OR EXISTS (SELECT 1 FROM ${q(database, "document_reindex_attempts")} reindex_attempt WHERE reindex_attempt.${q(database, "tenant_id")} = attempt.${q(database, "tenant_id")} AND reindex_attempt.${q(database, "knowledge_space_id")} = attempt.${q(database, "knowledge_space_id")} AND reindex_attempt.${q(database, "compilation_attempt_id")} = attempt.${q(database, "id")} AND reindex_attempt.${q(database, "document_id")} = revision.${q(database, "document_id")} AND reindex_attempt.${q(database, "document_revision")} = revision.${q(database, "revision")}) OR EXISTS (SELECT 1 FROM ${q(database, "document_chunk_state_changes")} chunk_change WHERE chunk_change.${q(database, "tenant_id")} = attempt.${q(database, "tenant_id")} AND chunk_change.${q(database, "knowledge_space_id")} = attempt.${q(database, "knowledge_space_id")} AND chunk_change.${q(database, "compilation_attempt_id")} = attempt.${q(database, "id")} AND chunk_change.${q(database, "document_id")} = revision.${q(database, "document_id")} AND chunk_change.${q(database, "document_revision")} = revision.${q(database, "revision")})) JOIN ${q(database, "document_assets")} asset ON asset.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND asset.${q(database, "id")} = revision.${q(database, "document_asset_id")} AND asset.${q(database, "version")} = revision.${q(database, "document_asset_version")}`;
}

function assetPermissionSql(
  database: Pick<DatabaseAdapter, "dialect">,
  alias: string,
  grantsPlaceholder: string,
): string {
  const metadata = `${alias}.${q(database, "metadata")}`;
  return database.dialect === "postgres"
    ? `(NOT (${metadata} ? 'permissionScope') OR (jsonb_typeof(${metadata} -> 'permissionScope') = 'array' AND ${grantsPlaceholder}::jsonb @> (${metadata} -> 'permissionScope')))`
    : `(JSON_CONTAINS_PATH(${metadata}, 'one', '$.permissionScope') = 0 OR (JSON_TYPE(JSON_EXTRACT(${metadata}, '$.permissionScope')) = 'ARRAY' AND JSON_CONTAINS(CAST(${grantsPlaceholder} AS JSON), JSON_EXTRACT(${metadata}, '$.permissionScope'))))`;
}

function publicTask(
  task: DocumentProcessingTask & { readonly tenantId?: string | undefined },
): DocumentProcessingTask {
  const { tenantId: _tenantId, ...value } = task;
  return { ...value };
}

function mapTask(row: DatabaseRow): DocumentProcessingTask {
  const state = stringColumn(row, "run_state");
  if (!isTaskState(state))
    throw new LogicalDocumentValidationError("Invalid processing task state");
  const stage = stringColumn(row, "checkpoint");
  if (!isTaskStage(stage))
    throw new LogicalDocumentValidationError("Invalid processing task stage");
  return {
    ...(optionalStringColumn(row, "completed_at")
      ? { completedAt: optionalStringColumn(row, "completed_at") }
      : {}),
    createdAt: stringColumn(row, "created_at"),
    documentId: stringColumn(row, "logical_document_id"),
    documentRevision: numberColumn(row, "logical_document_revision"),
    ...(optionalStringColumn(row, "last_error_code")
      ? { errorCode: optionalStringColumn(row, "last_error_code") }
      : {}),
    ...(optionalStringColumn(row, "last_error_message")
      ? { errorMessage: optionalStringColumn(row, "last_error_message") }
      : {}),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    progressPercent: stageProgress[stage],
    ...(optionalStringColumn(row, "retry_at")
      ? { retryAt: optionalStringColumn(row, "retry_at") }
      : {}),
    stage,
    state,
    updatedAt: stringColumn(row, "updated_at"),
  };
}

const stageProgress = {
  nodes_generated: 55,
  outline_built: 35,
  parsed: 20,
  projection_built: 75,
  published: 100,
  queued: 0,
  smoke_eval_passed: 90,
} as const;

function isTaskState(value: string): value is DocumentProcessingTaskState {
  return (
    value === "dispatch_pending" ||
    value === "queued" ||
    value === "running" ||
    value === "retry_wait" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "canceled" ||
    value === "superseded"
  );
}

function isTaskStage(value: string): value is DocumentProcessingTask["stage"] {
  return Object.hasOwn(stageProgress, value);
}

function compareTasks(left: DocumentProcessingTask, right: DocumentProcessingTask): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareTaskCursor(
  task: DocumentProcessingTask,
  cursor: DocumentProcessingTaskCursor,
): number {
  return task.createdAt.localeCompare(cursor.createdAt) || task.id.localeCompare(cursor.id);
}

function validateTaskLimit(limit: number, max = 100): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) {
    throw new LogicalDocumentValidationError(`Task list limit must be between 1 and ${max}`);
  }
}

function q(database: Pick<DatabaseAdapter, "dialect">, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return databasePlaceholder(database, position);
}
