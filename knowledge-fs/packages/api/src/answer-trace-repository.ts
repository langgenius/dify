import { createHash } from "node:crypto";

import { optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { persistScopedEvidenceBundleWithExecutor } from "./evidence-bundle-database-repository";
import { jsonObjectColumn } from "./json-utils";

import {
  type AnswerTrace,
  AnswerTraceSchema,
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type EvidenceBundle,
  EvidenceBundleSchema,
} from "@knowledge/core";

import { reconcileAnswerTraceWrite } from "./answer-trace-idempotency";
import { assertCapabilityJobPublicationAllowed } from "./capability-job-fence";

export interface AnswerTraceLookupInput {
  readonly id: string;
  readonly knowledgeSpaceId: string;
}

export interface DeleteAnswerTracesOlderThanInput {
  readonly knowledgeSpaceId: string;
  readonly maxTraces: number;
  readonly olderThan: string;
}

export interface AnswerTraceRepository {
  create(trace: AnswerTrace): Promise<AnswerTrace>;
  deleteOlderThan(input: DeleteAnswerTracesOlderThanInput): Promise<number>;
  get(input: AnswerTraceLookupInput): Promise<AnswerTrace | null>;
  getById(id: string): Promise<AnswerTrace | null>;
}

export interface InMemoryAnswerTraceRepositoryOptions {
  readonly maxSteps: number;
  readonly maxTraces: number;
}

export interface DatabaseAnswerTraceRepositoryOptions {
  readonly database: DatabaseAdapter;
}

export class AnswerTraceCapacityExceededError extends Error {
  constructor(maxTraces: number) {
    super(`AnswerTrace repository maxTraces=${maxTraces} exceeded`);
  }
}

export function createInMemoryAnswerTraceRepository({
  maxSteps,
  maxTraces,
}: InMemoryAnswerTraceRepositoryOptions): AnswerTraceRepository {
  validateAnswerTraceRepositoryBounds({ maxSteps, maxTraces });

  const traces = new Map<string, AnswerTrace>();

  return {
    create: async (trace) => {
      const parsed = parseAnswerTraceWithStepLimit(trace, maxSteps);
      const existing = traces.get(parsed.id);
      if (existing) {
        return cloneAnswerTrace(reconcileAnswerTraceWrite(existing, parsed));
      }
      if (traces.size >= maxTraces) {
        throw new AnswerTraceCapacityExceededError(maxTraces);
      }
      traces.set(parsed.id, cloneAnswerTrace(parsed));

      return cloneAnswerTrace(parsed);
    },
    deleteOlderThan: async (input) => {
      validateAnswerTraceCleanupInput(input);
      const selected = Array.from(traces.values())
        .filter((trace) => trace.knowledgeSpaceId === input.knowledgeSpaceId)
        .filter((trace) => trace.createdAt < input.olderThan)
        .sort(compareAnswerTracesForCleanup)
        .slice(0, input.maxTraces + 1);

      if (selected.length > input.maxTraces) {
        throw new Error(`AnswerTrace cleanup maxTraces=${input.maxTraces} exceeded`);
      }

      for (const trace of selected) {
        traces.delete(trace.id);
      }

      return selected.length;
    },
    get: async ({ id, knowledgeSpaceId }) => {
      const trace = traces.get(id);

      return trace && trace.knowledgeSpaceId === knowledgeSpaceId ? cloneAnswerTrace(trace) : null;
    },
    getById: async (id) => {
      const trace = traces.get(id);

      return trace ? cloneAnswerTrace(trace) : null;
    },
  };
}

export function createDatabaseAnswerTraceRepository({
  database,
}: DatabaseAnswerTraceRepositoryOptions): AnswerTraceRepository {
  const readTrace = async (whereSql: string, params: readonly DatabaseQueryValue[]) => {
    const result = await database.execute({
      maxRows: 1,
      operation: "select",
      params,
      sql: `SELECT * FROM ${quoteDatabaseIdentifier(
        database,
        "answer_traces",
      )} WHERE ${whereSql} AND ${answerTraceReadVisibilitySql(database)} LIMIT 1;`,
      tableName: "answer_traces",
    });

    if (!result.rows[0]) {
      return null;
    }

    const traceId = stringColumn(result.rows[0], "id");
    const steps = await database.execute({
      maxRows: 1_000,
      operation: "select",
      params: [traceId],
      sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "answer_trace_steps")} WHERE ${quoteDatabaseIdentifier(
        database,
        "trace_id",
      )} = ${databasePlaceholder(database, 1)} ORDER BY ${quoteDatabaseIdentifier(
        database,
        "started_at",
      )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT 1000;`,
      tableName: "answer_trace_steps",
    });

    return mapAnswerTraceRows(result.rows[0], steps.rows);
  };

  return {
    create: async (trace) =>
      database.transaction(async (transaction) => {
        const parsed = parseAnswerTraceProvenance(trace);
        const lockedSpace = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [parsed.knowledgeSpaceId],
          sql: `SELECT ${quoteDatabaseIdentifier(database, "id")}, ${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} FROM ${quoteDatabaseIdentifier(database, "knowledge_spaces")} WHERE ${quoteDatabaseIdentifier(
            database,
            "id",
          )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
            database,
            "lifecycle_state",
          )} = 'active' AND ${quoteDatabaseIdentifier(
            database,
            "deletion_job_id",
          )} IS NULL LIMIT 1 FOR UPDATE;`,
          tableName: "knowledge_spaces",
        });
        if (lockedSpace.rows.length !== 1) {
          throw new Error("Answer trace creation rejected by durable deletion");
        }
        const tenantId = stringColumn(lockedSpace.rows[0] as DatabaseRow, "tenant_id");
        if (parsed.tenantId !== undefined && parsed.tenantId !== tenantId) {
          throw new Error("AnswerTrace capability tenant does not match knowledge space");
        }
        const embeddedBundle = answerTraceEmbeddedEvidenceBundle(parsed);
        if (
          embeddedBundle &&
          parsed.evidenceBundleId &&
          embeddedBundle.id !== parsed.evidenceBundleId
        ) {
          throw new Error("Answer trace evidenceBundleId does not match embedded EvidenceBundle");
        }
        const resolvedEvidenceBundleId = parsed.evidenceBundleId ?? embeddedBundle?.id;
        const persistedTrace = resolvedEvidenceBundleId
          ? parseAnswerTraceProvenance({
              ...parsed,
              evidenceBundleId: resolvedEvidenceBundleId,
            })
          : parsed;
        const existing = await readStoredAnswerTraceForCreate(
          database,
          transaction,
          persistedTrace,
        );
        if (existing) {
          return cloneAnswerTrace(reconcileAnswerTraceWrite(existing, persistedTrace));
        }
        if (persistedTrace.capabilityGrantId) {
          await assertCapabilityJobPublicationAllowed(database, transaction, {
            capabilityGrantId: persistedTrace.capabilityGrantId,
            knowledgeSpaceId: persistedTrace.knowledgeSpaceId,
            tenantId,
          });
        }
        if (embeddedBundle) {
          await persistScopedEvidenceBundleWithExecutor(database, transaction, {
            bundle: embeddedBundle,
            knowledgeSpaceId: parsed.knowledgeSpaceId,
            tenantId,
          });
        }
        const traceColumns = [
          "id",
          "tenant_id",
          "knowledge_space_id",
          "capability_grant_id",
          "evidence_bundle_id",
          "query",
          "mode",
          "subject_id",
          "permission_snapshot_id",
          "permission_snapshot_revision",
          "access_channel",
          "completed",
          "created_at",
        ];
        const traceParams = [
          persistedTrace.id,
          persistedTrace.capabilityGrantId ? tenantId : null,
          persistedTrace.knowledgeSpaceId,
          persistedTrace.capabilityGrantId ?? null,
          persistedTrace.evidenceBundleId ?? null,
          persistedTrace.query,
          persistedTrace.mode,
          persistedTrace.subjectId ?? null,
          persistedTrace.permissionSnapshot?.id ?? null,
          persistedTrace.permissionSnapshot?.revision ?? null,
          persistedTrace.permissionSnapshot?.accessChannel ?? null,
          answerTraceCompleted(persistedTrace),
          persistedTrace.createdAt,
        ] satisfies readonly DatabaseQueryValue[];
        const admissionSpaceParameter =
          database.dialect === "postgres"
            ? databasePlaceholder(database, 3)
            : databasePlaceholder(database, traceParams.length + 1);
        const evidenceNullParameter =
          database.dialect === "postgres"
            ? databasePlaceholder(database, 5)
            : databasePlaceholder(database, traceParams.length + 2);
        const evidenceIdParameter =
          database.dialect === "postgres"
            ? databasePlaceholder(database, 5)
            : databasePlaceholder(database, traceParams.length + 3);
        const traceInsert = await transaction.execute({
          maxRows: database.dialect === "postgres" ? 1 : 0,
          operation: "insert",
          params:
            database.dialect === "postgres"
              ? traceParams
              : [
                  ...traceParams,
                  persistedTrace.knowledgeSpaceId,
                  persistedTrace.evidenceBundleId ?? null,
                  persistedTrace.evidenceBundleId ?? null,
                ],
          sql: `INSERT INTO ${quoteDatabaseIdentifier(database, "answer_traces")} (${traceColumns
            .map((column) => quoteDatabaseIdentifier(database, column))
            .join(", ")}) SELECT ${traceParams
            .map((_, index) => databasePlaceholder(database, index + 1))
            .join(", ")} WHERE EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
            database,
            "knowledge_spaces",
          )} writable_space WHERE writable_space.${quoteDatabaseIdentifier(
            database,
            "id",
          )} = ${admissionSpaceParameter} AND writable_space.${quoteDatabaseIdentifier(
            database,
            "lifecycle_state",
          )} = 'active' AND NOT EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
            database,
            "deletion_jobs",
          )} active_deletion WHERE active_deletion.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} = writable_space.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} AND active_deletion.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = writable_space.${quoteDatabaseIdentifier(
            database,
            "id",
          )} AND active_deletion.${quoteDatabaseIdentifier(
            database,
            "active_slot",
          )} = 1) AND (${evidenceNullParameter} IS NULL OR EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
            database,
            "evidence_bundles",
          )} scoped_bundle WHERE scoped_bundle.${quoteDatabaseIdentifier(
            database,
            "id",
          )} = ${evidenceIdParameter} AND scoped_bundle.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} = writable_space.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} AND scoped_bundle.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = writable_space.${quoteDatabaseIdentifier(
            database,
            "id",
          )})))${database.dialect === "postgres" ? ` RETURNING ${quoteDatabaseIdentifier(database, "id")}` : ""};`,
          tableName: "answer_traces",
        });
        if (traceInsert.rowsAffected !== 1) {
          throw new Error("Answer trace creation rejected by durable deletion");
        }

        if (persistedTrace.steps.length > 0) {
          const stepColumns = [
            "id",
            "trace_id",
            "name",
            "status",
            "metadata",
            "started_at",
            "ended_at",
          ];
          const stepParams = persistedTrace.steps.flatMap((step, index) => [
            deterministicAnswerTraceStepId(persistedTrace.id, index),
            persistedTrace.id,
            step.name,
            step.status,
            JSON.stringify(step.metadata),
            step.startedAt,
            step.endedAt ?? step.startedAt,
          ]) satisfies DatabaseQueryValue[];
          const columnCount = stepColumns.length;
          await transaction.execute({
            maxRows: persistedTrace.steps.length,
            operation: "insert",
            params: stepParams,
            sql: `INSERT INTO ${quoteDatabaseIdentifier(database, "answer_trace_steps")} (${stepColumns
              .map((column) => quoteDatabaseIdentifier(database, column))
              .join(", ")}) VALUES ${persistedTrace.steps
              .map(
                (_, rowIndex) =>
                  `(${stepColumns
                    .map((column, columnIndex) =>
                      jsonInsertPlaceholder(
                        database,
                        rowIndex * columnCount + columnIndex + 1,
                        column,
                      ),
                    )
                    .join(", ")})`,
              )
              .join(", ")};`,
            tableName: "answer_trace_steps",
          });
        }

        return cloneAnswerTrace(persistedTrace);
      }),
    deleteOlderThan: async (input) => {
      validateAnswerTraceCleanupInput(input);
      const params = [
        input.knowledgeSpaceId,
        input.olderThan,
        input.maxTraces,
      ] satisfies readonly DatabaseQueryValue[];
      const selectedTraceIdsSql = `SELECT ${quoteDatabaseIdentifier(
        database,
        "id",
      )} FROM ${quoteDatabaseIdentifier(database, "answer_traces")} WHERE ${quoteDatabaseIdentifier(
        database,
        "knowledge_space_id",
      )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
        database,
        "created_at",
      )} < ${databasePlaceholder(database, 2)} ORDER BY ${quoteDatabaseIdentifier(
        database,
        "created_at",
      )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(
        database,
        3,
      )}`;
      await database.execute({
        maxRows: input.maxTraces,
        operation: "delete",
        params,
        sql: `DELETE FROM ${quoteDatabaseIdentifier(database, "answer_trace_steps")} WHERE ${quoteDatabaseIdentifier(
          database,
          "trace_id",
        )} IN (SELECT ${quoteDatabaseIdentifier(
          database,
          "id",
        )} FROM (${selectedTraceIdsSql}) AS expired_answer_traces_for_steps);`,
        tableName: "answer_trace_steps",
      });
      const result = await database.execute({
        maxRows: input.maxTraces,
        operation: "delete",
        params,
        sql: `DELETE FROM ${quoteDatabaseIdentifier(database, "answer_traces")} WHERE ${quoteDatabaseIdentifier(
          database,
          "id",
        )} IN (SELECT ${quoteDatabaseIdentifier(
          database,
          "id",
        )} FROM (${selectedTraceIdsSql}) AS expired_answer_traces);`,
        tableName: "answer_traces",
      });

      return result.rowsAffected;
    },
    get: async ({ id, knowledgeSpaceId }) => {
      return readTrace(
        `${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${databasePlaceholder(database, 2)}`,
        [knowledgeSpaceId, id],
      );
    },
    getById: async (id) => {
      return readTrace(
        `${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(database, 1)}`,
        [id],
      );
    },
  };
}

/**
 * The knowledge-space row is already locked by create(), so this read serializes retries for the
 * same space without relying on dialect-specific duplicate-key affected-row semantics.
 */
async function readStoredAnswerTraceForCreate(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  requested: AnswerTrace,
): Promise<AnswerTrace | null> {
  const trace = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [requested.id],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "answer_traces")} WHERE ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 1)} LIMIT 1 FOR UPDATE;`,
    tableName: "answer_traces",
  });
  const traceRow = trace.rows[0];
  if (!traceRow) return null;

  const steps = await executor.execute({
    maxRows: 1_000,
    operation: "select",
    params: [requested.id],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "answer_trace_steps")} WHERE ${quoteDatabaseIdentifier(
      database,
      "trace_id",
    )} = ${databasePlaceholder(database, 1)} LIMIT 1000;`,
    tableName: "answer_trace_steps",
  });
  const rowsById = new Map(steps.rows.map((row) => [stringColumn(row, "id"), row]));
  const requestedOrder = requested.steps.map((_step, index) =>
    rowsById.get(deterministicAnswerTraceStepId(requested.id, index)),
  );
  const orderedRows =
    requestedOrder.length === steps.rows.length && requestedOrder.every((row) => row !== undefined)
      ? (requestedOrder as DatabaseRow[])
      : steps.rows;
  return mapAnswerTraceRows(traceRow, orderedRows);
}

function answerTraceReadVisibilitySql(database: DatabaseAdapter): string {
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const trace = q("answer_traces");
  const activeDocument = (documentAssetId: string) =>
    `EXISTS (SELECT 1 FROM ${q("document_assets")} readable_document WHERE readable_document.${q(
      "knowledge_space_id",
    )} = ${trace}.${q("knowledge_space_id")} AND ${
      database.dialect === "postgres"
        ? `CAST(readable_document.${q("id")} AS TEXT)`
        : `CAST(readable_document.${q("id")} AS CHAR(36))`
    } = ${documentAssetId} AND readable_document.${q(
      "lifecycle_state",
    )} = 'active' AND readable_document.${q("deletion_job_id")} IS NULL)`;

  const persistedCitationRows =
    database.dialect === "postgres"
      ? `jsonb_array_elements(CASE WHEN jsonb_typeof(readable_bundle.${q(
          "items",
        )}) = 'array' THEN readable_bundle.${q(
          "items",
        )} ELSE '[]'::jsonb END) AS readable_item(value) CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(readable_item.value -> 'citations') = 'array' THEN readable_item.value -> 'citations' ELSE '[]'::jsonb END) AS readable_citation(value)`
      : `JSON_TABLE(readable_bundle.${q(
          "items",
        )}, '$[*].citations[*]' COLUMNS (document_asset_id VARCHAR(36) PATH '$.documentAssetId')) AS readable_citation`;
  const persistedDocumentId =
    database.dialect === "postgres"
      ? `readable_citation.value ->> 'documentAssetId'`
      : "readable_citation.document_asset_id";
  const inlineCitationRows =
    database.dialect === "postgres"
      ? `jsonb_array_elements(CASE WHEN jsonb_typeof(readable_step.${q(
          "metadata",
        )} -> 'evidenceBundle' -> 'items') = 'array' THEN readable_step.${q(
          "metadata",
        )} -> 'evidenceBundle' -> 'items' ELSE '[]'::jsonb END) AS inline_item(value) CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(inline_item.value -> 'citations') = 'array' THEN inline_item.value -> 'citations' ELSE '[]'::jsonb END) AS inline_citation(value)`
      : `JSON_TABLE(readable_step.${q(
          "metadata",
        )}, '$.evidenceBundle.items[*].citations[*]' COLUMNS (document_asset_id VARCHAR(36) PATH '$.documentAssetId')) AS inline_citation`;
  const inlineDocumentId =
    database.dialect === "postgres"
      ? `inline_citation.value ->> 'documentAssetId'`
      : "inline_citation.document_asset_id";

  const readableSpace = `EXISTS (SELECT 1 FROM ${q(
    "knowledge_spaces",
  )} readable_space WHERE readable_space.${q("id")} = ${trace}.${q(
    "knowledge_space_id",
  )} AND readable_space.${q("lifecycle_state")} = 'active' AND NOT EXISTS (SELECT 1 FROM ${q(
    "deletion_jobs",
  )} active_deletion WHERE active_deletion.${q("tenant_id")} = readable_space.${q(
    "tenant_id",
  )} AND active_deletion.${q("knowledge_space_id")} = readable_space.${q(
    "id",
  )} AND active_deletion.${q("active_slot")} = 1))`;
  const scopedBundle = `(${trace}.${q("evidence_bundle_id")} IS NULL OR EXISTS (SELECT 1 FROM ${q(
    "evidence_bundles",
  )} scoped_bundle INNER JOIN ${q(
    "knowledge_spaces",
  )} scoped_bundle_space ON scoped_bundle_space.${q("id")} = scoped_bundle.${q(
    "knowledge_space_id",
  )} AND scoped_bundle_space.${q("tenant_id")} = scoped_bundle.${q(
    "tenant_id",
  )} WHERE scoped_bundle.${q("id")} = ${trace}.${q(
    "evidence_bundle_id",
  )} AND scoped_bundle.${q("knowledge_space_id")} = ${trace}.${q("knowledge_space_id")}))`;
  const noStalePersistedCitation = `NOT EXISTS (SELECT 1 FROM ${q(
    "evidence_bundles",
  )} readable_bundle CROSS JOIN ${persistedCitationRows} WHERE (readable_bundle.${q(
    "id",
  )} = ${trace}.${q("evidence_bundle_id")} OR readable_bundle.${q(
    "trace_id",
  )} = ${trace}.${q("id")}) AND NOT (${activeDocument(persistedDocumentId)}))`;
  const noStaleInlineCitation = `NOT EXISTS (SELECT 1 FROM ${q(
    "answer_trace_steps",
  )} readable_step CROSS JOIN ${inlineCitationRows} WHERE readable_step.${q(
    "trace_id",
  )} = ${trace}.${q("id")} AND NOT (${activeDocument(inlineDocumentId)}))`;
  return `(${readableSpace} AND ${scopedBundle} AND ${noStalePersistedCitation} AND ${noStaleInlineCitation})`;
}

function answerTraceEmbeddedEvidenceBundle(trace: AnswerTrace): EvidenceBundle | undefined {
  let selected: EvidenceBundle | undefined;
  for (const step of trace.steps) {
    const candidate = EvidenceBundleSchema.safeParse(step.metadata.evidenceBundle);
    if (!candidate.success) continue;
    if (
      selected &&
      (selected.id !== candidate.data.id ||
        JSON.stringify(selected) !== JSON.stringify(candidate.data))
    ) {
      throw new Error("Answer trace contains conflicting embedded EvidenceBundles");
    }
    selected = candidate.data;
  }
  return selected;
}

function mapAnswerTraceRows(traceRow: DatabaseRow, stepRows: readonly DatabaseRow[]): AnswerTrace {
  const capabilityGrantId = optionalStringColumn(traceRow, "capability_grant_id");
  const evidenceBundleId = optionalStringColumn(traceRow, "evidence_bundle_id");
  const subjectId = optionalStringColumn(traceRow, "subject_id");
  const permissionSnapshotId = optionalStringColumn(traceRow, "permission_snapshot_id");
  const permissionSnapshotRevision = optionalPositiveIntegerColumn(
    traceRow,
    "permission_snapshot_revision",
  );
  const accessChannel = optionalStringColumn(traceRow, "access_channel");
  const tenantId = optionalStringColumn(traceRow, "tenant_id");

  return parseAnswerTraceProvenance({
    ...(capabilityGrantId === undefined ? {} : { capabilityGrantId }),
    createdAt: stringColumn(traceRow, "created_at"),
    ...(evidenceBundleId === undefined ? {} : { evidenceBundleId }),
    id: stringColumn(traceRow, "id"),
    knowledgeSpaceId: stringColumn(traceRow, "knowledge_space_id"),
    mode: stringColumn(traceRow, "mode"),
    ...(permissionSnapshotId && permissionSnapshotRevision && accessChannel
      ? {
          permissionSnapshot: {
            accessChannel,
            id: permissionSnapshotId,
            revision: permissionSnapshotRevision,
          },
        }
      : {}),
    query: stringColumn(traceRow, "query"),
    ...(subjectId === undefined ? {} : { subjectId }),
    steps: stepRows.map((row) => ({
      endedAt: stringColumn(row, "ended_at"),
      metadata: jsonObjectColumn(row, "metadata"),
      name: stringColumn(row, "name"),
      startedAt: stringColumn(row, "started_at"),
      status: stringColumn(row, "status"),
    })),
    ...(tenantId === undefined ? {} : { tenantId }),
  });
}

function parseAnswerTraceProvenance(trace: unknown): AnswerTrace {
  const parsed = AnswerTraceSchema.parse(trace);
  if (parsed.capabilityGrantId) {
    if (!parsed.tenantId || parsed.permissionSnapshot || parsed.subjectId) {
      throw new Error(
        "AnswerTrace capability grant requires tenantId and forbids legacy member provenance",
      );
    }
    return parsed;
  }
  if (parsed.tenantId) {
    throw new Error("AnswerTrace tenantId requires capabilityGrantId");
  }
  if (Boolean(parsed.permissionSnapshot) !== Boolean(parsed.subjectId)) {
    throw new Error("AnswerTrace permission snapshot requires subjectId");
  }
  return parsed;
}

/**
 * Query traces append `query.generate` as their terminal summary. Recoverable stage failures (for
 * example a failed multimodal attempt followed by a successful text fallback) remain valuable
 * diagnostics, but must not turn the completed answer into a failed durable terminal fact.
 * Non-query/legacy traces retain the historical all-steps-success interpretation.
 */
function answerTraceCompleted(trace: AnswerTrace): boolean {
  const terminal = [...trace.steps].reverse().find((step) => step.name === "query.generate");
  return terminal ? terminal.status === "ok" : trace.steps.every((step) => step.status !== "error");
}

function optionalPositiveIntegerColumn(row: DatabaseRow, column: string): number | undefined {
  const value = row[column];
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Database row column ${column} must be a positive integer`);
  }
  return value;
}

function cloneAnswerTrace(trace: AnswerTrace): AnswerTrace {
  return AnswerTraceSchema.parse(JSON.parse(JSON.stringify(trace)) as unknown);
}

function validateAnswerTraceRepositoryBounds({
  maxSteps,
  maxTraces,
}: {
  readonly maxSteps: number;
  readonly maxTraces: number;
}): void {
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error("AnswerTrace repository maxSteps must be at least 1");
  }

  if (!Number.isInteger(maxTraces) || maxTraces < 1) {
    throw new Error("AnswerTrace repository maxTraces must be at least 1");
  }
}

function validateAnswerTraceCleanupInput({
  knowledgeSpaceId,
  maxTraces,
  olderThan,
}: DeleteAnswerTracesOlderThanInput): void {
  if (!knowledgeSpaceId.trim()) {
    throw new Error("AnswerTrace cleanup knowledgeSpaceId is required");
  }

  if (!Number.isInteger(maxTraces) || maxTraces < 1) {
    throw new Error("AnswerTrace cleanup maxTraces must be at least 1");
  }

  if (Number.isNaN(Date.parse(olderThan))) {
    throw new Error("AnswerTrace cleanup olderThan must be a valid timestamp");
  }
}

function compareAnswerTracesForCleanup(left: AnswerTrace, right: AnswerTrace): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function parseAnswerTraceWithStepLimit(trace: AnswerTrace, maxSteps: number): AnswerTrace {
  if (trace.steps.length > maxSteps) {
    throw new Error(`AnswerTrace repository step count exceeds maxSteps=${maxSteps}`);
  }

  return parseAnswerTraceProvenance(trace);
}

function deterministicAnswerTraceStepId(traceId: string, stepIndex: number): string {
  const hex = createHash("sha256").update(`${traceId}:step:${stepIndex}`).digest("hex");
  const variant = ((Number.parseInt(hex[16] ?? "8", 16) & 0x3) | 0x8).toString(16);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}
