import type { DatabaseAdapter } from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import type { DocumentChunkRepository } from "./document-chunk-repository";
import type { DocumentCompilationJobStateMachine } from "./document-compilation-job";
import type { DocumentCompilationIndexOverrideResolver } from "./document-compilation-worker";
import type { DocumentProcessingTaskRepository } from "./document-processing-task-repository";
import type { DocumentSettingsRepository } from "./document-settings-repository";
import { jsonObjectColumn } from "./json-utils";
import type {
  DocumentRevisionRollbackCoordinator,
  DocumentSettingsChangeCoordinator,
} from "./logical-document-handlers";
import {
  LogicalDocumentConflictError,
  type LogicalDocumentRepository,
  LogicalDocumentValidationError,
} from "./logical-document-repository";

export function createDocumentRevisionRollbackCoordinator({
  compilationJobs,
  logicalDocuments,
  now = () => new Date().toISOString(),
  tasks,
}: {
  readonly compilationJobs: DocumentCompilationJobStateMachine;
  readonly logicalDocuments: LogicalDocumentRepository;
  readonly now?: (() => string) | undefined;
  readonly tasks: DocumentProcessingTaskRepository;
}): DocumentRevisionRollbackCoordinator {
  return {
    request: async (input) => {
      const document = await logicalDocuments.get(input);
      if (!document?.active) {
        throw new LogicalDocumentValidationError("Logical document has no active revision");
      }
      if (
        document.activeRevision !== input.expectedActiveRevision ||
        document.rowVersion !== input.expectedRowVersion
      ) {
        throw new LogicalDocumentConflictError(
          input.expectedActiveRevision,
          document.activeRevision ?? null,
          input.expectedRowVersion,
          document.rowVersion,
        );
      }
      if (input.revision === document.activeRevision) {
        throw new LogicalDocumentValidationError("Rollback target is already active");
      }
      const target = await logicalDocuments.getRevision({ ...input, revision: input.revision });
      if (!target || target.state !== "superseded") {
        throw new LogicalDocumentValidationError("Rollback target revision is not available");
      }
      const timestamp = now();
      const created = await logicalDocuments.createCandidateRevision({
        contentHash: target.contentHash,
        documentAssetId: target.documentAssetId,
        documentAssetVersion: target.documentAssetVersion,
        documentId: input.documentId,
        expectedActiveRevision: input.expectedActiveRevision,
        expectedDocumentRowVersion: input.expectedRowVersion,
        knowledgeSpaceId: input.knowledgeSpaceId,
        mimeType: target.mimeType,
        now: timestamp,
        ...(input.permissionSnapshot ? { permissionSnapshot: input.permissionSnapshot } : {}),
        requestedBySubjectId: input.subjectId,
        rollbackOfRevision: input.revision,
        sizeBytes: target.sizeBytes,
        systemMetadata: {
          ...target.systemMetadata,
          provenance: {
            rollbackOfRevision: input.revision,
            requestedBySubjectId: input.subjectId,
          },
        },
        tenantId: input.tenantId,
        title: document.title,
      });
      let compilationAttemptId: string | undefined;
      try {
        const compilation = await compilationJobs.start({
          ...(compilationJobs.releaseDispatch ? { deferDispatch: true } : {}),
          documentAssetId: target.documentAssetId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          ...(input.permissionSnapshot ? { permissionSnapshot: input.permissionSnapshot } : {}),
          requestedBySubjectId: input.subjectId,
          tenantId: input.tenantId,
          version: target.documentAssetVersion,
        });
        compilationAttemptId = compilation.id;
        await logicalDocuments.bindCompilationAttempt({
          attemptId: compilation.id,
          documentId: input.documentId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          revision: created.revision.revision,
          tenantId: input.tenantId,
        });
        await compilationJobs.releaseDispatch?.(compilation.id);
        const task = await tasks.get({
          documentId: input.documentId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          taskId: compilation.id,
          tenantId: input.tenantId,
        });
        if (!task) throw new LogicalDocumentValidationError("Rollback task binding failed");
        return task;
      } catch (error) {
        if (compilationAttemptId) {
          await compilationJobs
            .cancel(compilationAttemptId, "Rollback candidate staging failed")
            .catch(() => undefined);
        }
        const current = await logicalDocuments.getRevision({
          documentId: input.documentId,
          knowledgeSpaceId: input.knowledgeSpaceId,
          revision: created.revision.revision,
          tenantId: input.tenantId,
        });
        if (current?.state === "candidate") {
          await logicalDocuments
            .failCandidate({
              documentId: input.documentId,
              knowledgeSpaceId: input.knowledgeSpaceId,
              now: timestamp,
              revision: created.revision.revision,
              tenantId: input.tenantId,
            })
            .catch(() => undefined);
        }
        throw error;
      }
    },
  };
}

export function createDocumentSettingsChangeCoordinator({
  compilationJobs,
  logicalDocuments,
  now = () => new Date().toISOString(),
  settings,
}: {
  readonly compilationJobs: DocumentCompilationJobStateMachine;
  readonly logicalDocuments: LogicalDocumentRepository;
  readonly now?: (() => string) | undefined;
  readonly settings: DocumentSettingsRepository;
}): DocumentSettingsChangeCoordinator {
  return {
    request: async (input) => {
      const document = await logicalDocuments.get(input);
      if (!document?.active) {
        throw new LogicalDocumentValidationError("Logical document has no active revision");
      }
      const compilation = await compilationJobs.start({
        ...(compilationJobs.releaseDispatch ? { deferDispatch: true } : {}),
        documentAssetId: document.active.documentAssetId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        ...(input.permissionSnapshot ? { permissionSnapshot: input.permissionSnapshot } : {}),
        requestedBySubjectId: input.subjectId,
        tenantId: input.tenantId,
        version: document.active.documentAssetVersion,
      });
      try {
        const requested = await settings.requestChange({
          compilationAttemptId: compilation.id,
          createdBySubjectId: input.subjectId,
          documentId: input.documentId,
          documentRevision: document.active.revision,
          expectedSettingsHeadRevision: input.expectedSettingsHeadRevision,
          knowledgeSpaceId: input.knowledgeSpaceId,
          now: now(),
          settings: input.settings,
          tenantId: input.tenantId,
        });
        await compilationJobs.releaseDispatch?.(compilation.id);
        return {
          attemptId: requested.attempt.id,
          compilationAttemptId: compilation.id,
          settingsRevision: requested.candidate.revision,
          state: "running",
          statusUrl: `/knowledge-spaces/${input.knowledgeSpaceId}/documents/${input.documentId}/processing-tasks/${compilation.id}`,
        };
      } catch (error) {
        await compilationJobs
          .cancel(compilation.id, "Document settings candidate staging failed")
          .catch(() => undefined);
        throw error;
      }
    },
  };
}

/** Resolves only state tied to the exact durable attempt; ordinary compiles have no overrides. */
export function createDatabaseDocumentCompilationIndexOverrideResolver(
  database: DatabaseAdapter,
): DocumentCompilationIndexOverrideResolver {
  return {
    resolve: async (input) => {
      const settingsResult = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.tenantId, input.knowledgeSpaceId, input.compilationAttemptId],
        sql: `SELECT settings_revision.${q(database, "settings")} FROM ${q(database, "document_reindex_attempts")} reindex_attempt JOIN ${q(database, "document_settings_revisions")} settings_revision ON settings_revision.${q(database, "tenant_id")} = reindex_attempt.${q(database, "tenant_id")} AND settings_revision.${q(database, "knowledge_space_id")} = reindex_attempt.${q(database, "knowledge_space_id")} AND settings_revision.${q(database, "document_id")} = reindex_attempt.${q(database, "document_id")} AND settings_revision.${q(database, "revision")} = reindex_attempt.${q(database, "settings_revision")} WHERE reindex_attempt.${q(database, "tenant_id")} = ${p(database, 1)} AND reindex_attempt.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND reindex_attempt.${q(database, "compilation_attempt_id")} = ${p(database, 3)} AND reindex_attempt.${q(database, "state")} = 'running' AND settings_revision.${q(database, "state")} = 'candidate' LIMIT 1;`,
        tableName: "document_reindex_attempts",
      });
      let settingsRow = settingsResult.rows[0];
      if (!settingsRow) {
        const activeSettings = await database.execute({
          maxRows: 1,
          operation: "select",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            input.compilationAttemptId,
            input.documentAssetId,
          ],
          sql: `SELECT settings_revision.${q(database, "settings")} FROM ${q(database, "document_revisions")} target JOIN ${q(database, "logical_documents")} document ON document.${q(database, "tenant_id")} = target.${q(database, "tenant_id")} AND document.${q(database, "knowledge_space_id")} = target.${q(database, "knowledge_space_id")} AND document.${q(database, "id")} = target.${q(database, "document_id")} JOIN ${q(database, "document_settings_heads")} settings_head ON settings_head.${q(database, "tenant_id")} = target.${q(database, "tenant_id")} AND settings_head.${q(database, "knowledge_space_id")} = target.${q(database, "knowledge_space_id")} AND settings_head.${q(database, "document_id")} = target.${q(database, "document_id")} JOIN ${q(database, "document_settings_revisions")} settings_revision ON settings_revision.${q(database, "tenant_id")} = settings_head.${q(database, "tenant_id")} AND settings_revision.${q(database, "knowledge_space_id")} = settings_head.${q(database, "knowledge_space_id")} AND settings_revision.${q(database, "document_id")} = settings_head.${q(database, "document_id")} AND settings_revision.${q(database, "revision")} = settings_head.${q(database, "active_revision")} AND settings_revision.${q(database, "state")} = 'active' WHERE target.${q(database, "tenant_id")} = ${p(database, 1)} AND target.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND target.${q(database, "document_asset_id")} = ${p(database, 4)} AND (target.${q(database, "compilation_attempt_id")} = ${p(database, 3)} OR (target.${q(database, "revision")} = document.${q(database, "active_revision")} AND target.${q(database, "state")} = 'active')) ORDER BY CASE WHEN target.${q(database, "compilation_attempt_id")} = ${p(database, 3)} THEN 0 ELSE 1 END ASC LIMIT 1;`,
          tableName: "document_settings_heads",
        });
        settingsRow = activeSettings.rows[0];
      }
      const settingsValue = settingsRow ? jsonObjectColumn(settingsRow, "settings") : undefined;

      const changeResult = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.tenantId, input.knowledgeSpaceId, input.compilationAttemptId],
        sql: `SELECT candidate.${q(database, "document_id")}, candidate.${q(database, "document_revision")}, candidate.${q(database, "chunk_id")}, candidate.${q(database, "enabled")}, chunk.${q(database, "ordinal")} FROM ${q(database, "document_chunk_state_changes")} candidate JOIN ${q(database, "document_revision_chunks")} chunk ON chunk.${q(database, "tenant_id")} = candidate.${q(database, "tenant_id")} AND chunk.${q(database, "knowledge_space_id")} = candidate.${q(database, "knowledge_space_id")} AND chunk.${q(database, "document_id")} = candidate.${q(database, "document_id")} AND chunk.${q(database, "document_revision")} = candidate.${q(database, "document_revision")} AND chunk.${q(database, "id")} = candidate.${q(database, "chunk_id")} WHERE candidate.${q(database, "tenant_id")} = ${p(database, 1)} AND candidate.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND candidate.${q(database, "compilation_attempt_id")} = ${p(database, 3)} AND candidate.${q(database, "state")} = 'candidate' LIMIT 1;`,
        tableName: "document_chunk_state_changes",
      });
      const change = changeResult.rows[0];
      const excluded = new Set<number>();
      if (change) {
        const activeResult = await database.execute({
          maxRows: 20_000,
          operation: "select",
          params: [
            input.tenantId,
            input.knowledgeSpaceId,
            stringColumn(change, "document_id"),
            numberColumn(change, "document_revision"),
          ],
          sql: `SELECT chunk.${q(database, "ordinal")} FROM ${q(database, "document_chunk_state_changes")} active_change JOIN ${q(database, "document_revision_chunks")} chunk ON chunk.${q(database, "tenant_id")} = active_change.${q(database, "tenant_id")} AND chunk.${q(database, "knowledge_space_id")} = active_change.${q(database, "knowledge_space_id")} AND chunk.${q(database, "document_id")} = active_change.${q(database, "document_id")} AND chunk.${q(database, "document_revision")} = active_change.${q(database, "document_revision")} AND chunk.${q(database, "id")} = active_change.${q(database, "chunk_id")} WHERE active_change.${q(database, "tenant_id")} = ${p(database, 1)} AND active_change.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND active_change.${q(database, "document_id")} = ${p(database, 3)} AND active_change.${q(database, "document_revision")} = ${p(database, 4)} AND active_change.${q(database, "state")} = 'active' AND active_change.${q(database, "enabled")} = ${database.dialect === "postgres" ? "FALSE" : "0"};`,
          tableName: "document_chunk_state_changes",
        });
        for (const row of activeResult.rows) excluded.add(numberColumn(row, "ordinal"));
        const ordinal = numberColumn(change, "ordinal");
        if (booleanColumn(change, "enabled")) excluded.delete(ordinal);
        else excluded.add(ordinal);
      }
      return {
        ...(settingsValue
          ? {
              chunkConfig: {
                maxChunkChars: numberSetting(settingsValue, "chunkSize"),
                overlapChars: numberSetting(settingsValue, "chunkOverlap"),
              },
              enableGraph: booleanSetting(settingsValue, "enableGraph"),
              enablePageIndex: booleanSetting(settingsValue, "enablePageIndex"),
              ...(optionalSettingString(settingsValue, "language")
                ? { language: optionalSettingString(settingsValue, "language") }
                : {}),
            }
          : {}),
        ...(change ? { excludedNodeOrdinals: [...excluded].sort((a, b) => a - b) } : {}),
      };
    },
  };
}

export interface DocumentLogicalMutationReconciler {
  tick(): Promise<{
    readonly chunksActivated: number;
    readonly chunksFailed: number;
    readonly revisionsActivated: number;
    readonly revisionsFailed: number;
    readonly settingsCompleted: number;
    readonly settingsFailed: number;
  }>;
}

/** Marks staged product state failed after its exact compilation attempt becomes terminal. */
export function createDatabaseDocumentLogicalMutationReconciler({
  chunks,
  database,
  logicalDocuments,
  now = () => new Date().toISOString(),
  settings,
}: {
  readonly chunks: DocumentChunkRepository;
  readonly database: DatabaseAdapter;
  readonly logicalDocuments: LogicalDocumentRepository;
  readonly now?: (() => string) | undefined;
  readonly settings: DocumentSettingsRepository;
}): DocumentLogicalMutationReconciler {
  return {
    tick: async () => {
      const timestamp = now();
      const terminal = "('failed', 'canceled', 'superseded')";
      // Successful product transitions are part of the publication/head-CAS transaction. This
      // reconciler is intentionally failure-only so a late/stale candidate can never be activated
      // merely because its compilation attempt already reports success.
      const revisionsActivated = 0;
      const settingsCompleted = 0;
      const chunksActivated = 0;

      const revisions = await database.execute({
        maxRows: 100,
        operation: "select",
        params: [],
        sql: `SELECT revision.${q(database, "tenant_id")}, revision.${q(database, "knowledge_space_id")}, revision.${q(database, "document_id")}, revision.${q(database, "revision")} FROM ${q(database, "document_revisions")} revision JOIN ${q(database, "document_compilation_attempts")} attempt ON attempt.${q(database, "tenant_id")} = revision.${q(database, "tenant_id")} AND attempt.${q(database, "knowledge_space_id")} = revision.${q(database, "knowledge_space_id")} AND attempt.${q(database, "id")} = revision.${q(database, "compilation_attempt_id")} WHERE revision.${q(database, "state")} = 'candidate' AND attempt.${q(database, "run_state")} IN ${terminal} ORDER BY revision.${q(database, "created_at")} ASC LIMIT 100;`,
        tableName: "document_revisions",
      });
      let revisionsFailed = 0;
      for (const row of revisions.rows) {
        await logicalDocuments.failCandidate({
          documentId: stringColumn(row, "document_id"),
          knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
          now: timestamp,
          revision: numberColumn(row, "revision"),
          tenantId: stringColumn(row, "tenant_id"),
        });
        revisionsFailed += 1;
      }

      const reindexes = await database.execute({
        maxRows: 100,
        operation: "select",
        params: [],
        sql: `SELECT reindex_attempt.${q(database, "tenant_id")}, reindex_attempt.${q(database, "knowledge_space_id")}, reindex_attempt.${q(database, "document_id")}, reindex_attempt.${q(database, "id")}, reindex_attempt.${q(database, "row_version")}, attempt.${q(database, "run_state")}, attempt.${q(database, "last_error_code")}, attempt.${q(database, "last_error_message")} FROM ${q(database, "document_reindex_attempts")} reindex_attempt JOIN ${q(database, "document_compilation_attempts")} attempt ON attempt.${q(database, "tenant_id")} = reindex_attempt.${q(database, "tenant_id")} AND attempt.${q(database, "knowledge_space_id")} = reindex_attempt.${q(database, "knowledge_space_id")} AND attempt.${q(database, "id")} = reindex_attempt.${q(database, "compilation_attempt_id")} WHERE reindex_attempt.${q(database, "state")} IN ('queued', 'running') AND attempt.${q(database, "run_state")} IN ${terminal} ORDER BY reindex_attempt.${q(database, "created_at")} ASC LIMIT 100;`,
        tableName: "document_reindex_attempts",
      });
      let settingsFailed = 0;
      for (const row of reindexes.rows) {
        await settings.fail({
          attemptId: stringColumn(row, "id"),
          documentId: stringColumn(row, "document_id"),
          errorCode: optionalString(row, "last_error_code") ?? "COMPILATION_TERMINATED",
          errorMessage:
            optionalString(row, "last_error_message") ??
            `Compilation ${stringColumn(row, "run_state")}`,
          expectedRowVersion: numberColumn(row, "row_version"),
          knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
          now: timestamp,
          tenantId: stringColumn(row, "tenant_id"),
        });
        settingsFailed += 1;
      }

      const chunkChanges = await database.execute({
        maxRows: 100,
        operation: "select",
        params: [],
        sql: `SELECT change.${q(database, "tenant_id")}, change.${q(database, "knowledge_space_id")}, change.${q(database, "document_id")}, change.${q(database, "id")} FROM ${q(database, "document_chunk_state_changes")} change JOIN ${q(database, "document_compilation_attempts")} attempt ON attempt.${q(database, "tenant_id")} = change.${q(database, "tenant_id")} AND attempt.${q(database, "knowledge_space_id")} = change.${q(database, "knowledge_space_id")} AND attempt.${q(database, "id")} = change.${q(database, "compilation_attempt_id")} WHERE change.${q(database, "state")} = 'candidate' AND attempt.${q(database, "run_state")} IN ${terminal} ORDER BY change.${q(database, "created_at")} ASC LIMIT 100;`,
        tableName: "document_chunk_state_changes",
      });
      let chunksFailed = 0;
      for (const row of chunkChanges.rows) {
        await chunks.failStateChange({
          changeId: stringColumn(row, "id"),
          documentId: stringColumn(row, "document_id"),
          knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
          tenantId: stringColumn(row, "tenant_id"),
        });
        chunksFailed += 1;
      }
      return {
        chunksActivated,
        chunksFailed,
        revisionsActivated,
        revisionsFailed,
        settingsCompleted,
        settingsFailed,
      };
    },
  };
}

function booleanColumn(row: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = row[key];
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new LogicalDocumentValidationError(`Invalid boolean column ${key}`);
}

function numberSetting(settings: Readonly<Record<string, unknown>>, key: string): number {
  const value = settings[key];
  if (!Number.isSafeInteger(value)) {
    throw new LogicalDocumentValidationError(`Invalid document setting ${key}`);
  }
  return value as number;
}

function booleanSetting(settings: Readonly<Record<string, unknown>>, key: string): boolean {
  const value = settings[key];
  if (typeof value !== "boolean") {
    throw new LogicalDocumentValidationError(`Invalid document setting ${key}`);
  }
  return value;
}

function optionalSettingString(
  settings: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = settings[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value) {
    throw new LogicalDocumentValidationError(`Invalid document setting ${key}`);
  }
  return value;
}

function optionalString(row: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value ? value : undefined;
}

function q(database: Pick<DatabaseAdapter, "dialect">, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return databasePlaceholder(database, position);
}
