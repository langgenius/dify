import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type EvidenceBundle,
  EvidenceBundleSchema,
} from "@knowledge/core";

import { optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonArrayColumn } from "./json-utils";

export interface ScopedEvidenceBundleInput {
  readonly bundle: EvidenceBundle;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface ScopedEvidenceBundleLookup {
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface DatabaseEvidenceBundleRepository {
  create(input: ScopedEvidenceBundleInput): Promise<EvidenceBundle>;
  get(input: ScopedEvidenceBundleLookup): Promise<EvidenceBundle | null>;
}

export interface CreateDatabaseEvidenceBundleRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxDocumentReferences?: number | undefined;
}

/**
 * The only production writer for the normalized evidence_bundles table. Scope is mandatory and
 * the knowledge-space row lock serializes bundle creation with durable-deletion admission.
 */
export function createDatabaseEvidenceBundleRepository({
  database,
  maxDocumentReferences = 10_000,
}: CreateDatabaseEvidenceBundleRepositoryOptions): DatabaseEvidenceBundleRepository {
  if (!Number.isSafeInteger(maxDocumentReferences) || maxDocumentReferences < 1) {
    throw new Error("Evidence bundle maxDocumentReferences must be a positive integer");
  }
  return {
    create: async (rawInput) => {
      const input = normalizeCreateInput(rawInput);
      return database.transaction(async (transaction) => {
        await lockWritableSpace(database, transaction, input);
        return persistScopedEvidenceBundleWithExecutor(
          database,
          transaction,
          input,
          maxDocumentReferences,
        );
      });
    },
    get: async (rawInput) => {
      const input = normalizeLookup(rawInput);
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.id, input.tenantId, input.knowledgeSpaceId],
        sql: `SELECT scoped_bundle.* FROM ${q(
          database,
          "evidence_bundles",
        )} AS scoped_bundle WHERE scoped_bundle.${q(database, "id")} = ${p(
          database,
          1,
        )} AND scoped_bundle.${q(database, "tenant_id")} = ${p(
          database,
          2,
        )} AND scoped_bundle.${q(database, "knowledge_space_id")} = ${p(
          database,
          3,
        )} AND EXISTS (SELECT 1 FROM ${q(
          database,
          "knowledge_spaces",
        )} AS active_space WHERE active_space.${q(database, "tenant_id")} = scoped_bundle.${q(
          database,
          "tenant_id",
        )} AND active_space.${q(database, "id")} = scoped_bundle.${q(
          database,
          "knowledge_space_id",
        )} AND active_space.${q(database, "lifecycle_state")} = 'active' AND active_space.${q(
          database,
          "deletion_job_id",
        )} IS NULL) AND NOT EXISTS (SELECT 1 FROM ${q(
          database,
          "deletion_jobs",
        )} AS active_deletion WHERE active_deletion.${q(
          database,
          "tenant_id",
        )} = scoped_bundle.${q(database, "tenant_id")} AND active_deletion.${q(
          database,
          "knowledge_space_id",
        )} = scoped_bundle.${q(database, "knowledge_space_id")} AND active_deletion.${q(
          database,
          "active_slot",
        )} = 1) LIMIT 1;`,
        tableName: "evidence_bundles",
      });
      if (!result.rows[0]) return null;
      const bundle = mapEvidenceBundle(result.rows[0]);
      const ids = citationDocumentIds(bundle);
      if (ids.length > maxDocumentReferences) return null;
      try {
        await assertActiveDocuments(database, database, input.knowledgeSpaceId, ids);
      } catch {
        return null;
      }
      return bundle;
    },
  };
}

/** Caller-executor form for AnswerTrace, which already holds the same knowledge-space row lock. */
export async function persistScopedEvidenceBundleWithExecutor(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  rawInput: ScopedEvidenceBundleInput,
  maxDocumentReferences = 10_000,
): Promise<EvidenceBundle> {
  if (!Number.isSafeInteger(maxDocumentReferences) || maxDocumentReferences < 1) {
    throw new Error("Evidence bundle maxDocumentReferences must be a positive integer");
  }
  const input = normalizeCreateInput(rawInput);
  const documentAssetIds = citationDocumentIds(input.bundle);
  if (documentAssetIds.length > maxDocumentReferences) {
    throw new Error(
      `Evidence bundle document references exceed maxDocumentReferences=${maxDocumentReferences}`,
    );
  }
  await assertActiveDocuments(database, executor, input.knowledgeSpaceId, documentAssetIds);

  const existing = await selectBundleById(database, executor, input.bundle.id, true);
  if (existing) {
    const existingTenantId = optionalStringColumn(existing, "tenant_id");
    const existingSpaceId = optionalStringColumn(existing, "knowledge_space_id");
    const existingBundle = mapEvidenceBundle(existing);
    if (
      existingTenantId !== input.tenantId ||
      existingSpaceId !== input.knowledgeSpaceId ||
      JSON.stringify(existingBundle) !== JSON.stringify(input.bundle)
    ) {
      throw new Error("Evidence bundle id already belongs to different scoped content");
    }
    return existingBundle;
  }

  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "trace_id",
    "query",
    "state",
    "items",
    "missing_evidence",
    "created_at",
    "updated_at",
  ] as const;
  const params = [
    input.bundle.id,
    input.tenantId,
    input.knowledgeSpaceId,
    input.bundle.traceId ?? null,
    input.bundle.query,
    input.bundle.state,
    JSON.stringify(input.bundle.items),
    JSON.stringify(input.bundle.missingEvidence),
    input.bundle.createdAt,
    input.bundle.createdAt,
  ] satisfies readonly DatabaseQueryValue[];
  const alias = "scoped_bundle";
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, "evidence_bundles")} (${columns
      .map((column) => q(database, column))
      .join(", ")}) SELECT ${columns
      .map((column) => `${q(database, alias)}.${q(database, column)}`)
      .join(", ")} FROM (SELECT ${columns
      .map(
        (column, index) =>
          `${jsonInsertPlaceholder(database, index + 1, column)} AS ${q(database, column)}`,
      )
      .join(", ")}) AS ${q(database, alias)} WHERE NOT EXISTS (SELECT 1 FROM ${q(
      database,
      "deletion_jobs",
    )} AS active_deletion WHERE active_deletion.${q(database, "tenant_id")} = ${q(
      database,
      alias,
    )}.${q(database, "tenant_id")} AND active_deletion.${q(
      database,
      "knowledge_space_id",
    )} = ${q(database, alias)}.${q(
      database,
      "knowledge_space_id",
    )} AND active_deletion.${q(database, "active_slot")} = 1);`,
    tableName: "evidence_bundles",
  });
  if (result.rowsAffected !== 1) {
    throw new Error("Evidence bundle creation rejected by active durable deletion");
  }
  return cloneBundle(input.bundle);
}

export async function assertEvidenceBundleScopeReady(database: DatabaseAdapter): Promise<void> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [],
    sql: `SELECT ${q(database, "id")} FROM ${q(
      database,
      "evidence_bundles",
    )} WHERE ${q(database, "tenant_id")} IS NULL OR ${q(
      database,
      "knowledge_space_id",
    )} IS NULL LIMIT 1;`,
    tableName: "evidence_bundles",
  });
  if (result.rows.length > 0) {
    throw new Error(
      "Durable deletion requires every evidence bundle to have an unambiguous tenant/space scope",
    );
  }
}

export async function purgeUnscopedEvidenceBundlesPage(
  database: DatabaseAdapter,
  input: { readonly limit: number },
): Promise<number> {
  return database.transaction((transaction) =>
    purgeUnscopedEvidenceBundlesPageWithExecutor(database, transaction, input),
  );
}

/** Executor form for a migration/maintenance worker with its own outer lease transaction. */
export async function purgeUnscopedEvidenceBundlesPageWithExecutor(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: { readonly limit: number },
): Promise<number> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 10_000) {
    throw new Error("Unscoped evidence bundle purge limit must be between 1 and 10000");
  }
  const selected = await executor.execute({
    maxRows: input.limit,
    operation: "select",
    params: [input.limit],
    sql: `SELECT ${q(database, "id")} FROM ${q(
      database,
      "evidence_bundles",
    )} WHERE ${q(database, "tenant_id")} IS NULL OR ${q(
      database,
      "knowledge_space_id",
    )} IS NULL ORDER BY ${q(database, "id")} ASC LIMIT ${p(database, 1)} FOR UPDATE;`,
    tableName: "evidence_bundles",
  });
  const ids = selected.rows.map((row) => stringColumn(row, "id"));
  if (ids.length === 0) return 0;
  const placeholders = ids.map((_, index) => p(database, index + 1)).join(", ");
  await executor.execute({
    maxRows: 0,
    operation: "update",
    params: ids,
    sql: `UPDATE ${q(database, "answer_traces")} SET ${q(
      database,
      "evidence_bundle_id",
    )} = NULL WHERE ${q(database, "evidence_bundle_id")} IN (${placeholders});`,
    tableName: "answer_traces",
  });
  await executor.execute({
    maxRows: 0,
    operation: "delete",
    params: ids,
    sql: `DELETE FROM ${q(database, "evidence_bundles")} WHERE ${q(
      database,
      "id",
    )} IN (${placeholders}) AND (${q(database, "tenant_id")} IS NULL OR ${q(
      database,
      "knowledge_space_id",
    )} IS NULL);`,
    tableName: "evidence_bundles",
  });
  return ids.length;
}

async function lockWritableSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: Pick<ScopedEvidenceBundleInput, "knowledgeSpaceId" | "tenantId">,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, "knowledge_spaces")} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "id")} = ${p(
      database,
      2,
    )} AND ${q(database, "lifecycle_state")} = 'active' AND ${q(
      database,
      "deletion_job_id",
    )} IS NULL FOR UPDATE;`,
    tableName: "knowledge_spaces",
  });
  if (result.rows.length !== 1) {
    throw new Error("Evidence bundle creation rejected because knowledge space is unavailable");
  }
}

async function assertActiveDocuments(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  knowledgeSpaceId: string,
  documentAssetIds: readonly string[],
): Promise<void> {
  if (documentAssetIds.length === 0) return;
  const params: DatabaseQueryValue[] = [knowledgeSpaceId, ...documentAssetIds];
  const result = await executor.execute({
    maxRows: documentAssetIds.length,
    operation: "select",
    params,
    sql: `SELECT ${q(database, "id")} FROM ${q(
      database,
      "document_assets",
    )} WHERE ${q(database, "knowledge_space_id")} = ${p(
      database,
      1,
    )} AND ${q(database, "id")} IN (${documentAssetIds
      .map((_, index) => p(database, index + 2))
      .join(", ")}) AND ${q(database, "lifecycle_state")} = 'active' AND ${q(
      database,
      "deletion_job_id",
    )} IS NULL;`,
    tableName: "document_assets",
  });
  const found = new Set(result.rows.map((row) => stringColumn(row, "id")));
  if (found.size !== documentAssetIds.length || documentAssetIds.some((id) => !found.has(id))) {
    throw new Error("Evidence bundle references unavailable or cross-space documents");
  }
}

async function selectBundleById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
  forUpdate: boolean,
): Promise<DatabaseRow | undefined> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [id],
    sql: `SELECT * FROM ${q(database, "evidence_bundles")} WHERE ${q(
      database,
      "id",
    )} = ${p(database, 1)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: "evidence_bundles",
  });
  return result.rows[0];
}

function mapEvidenceBundle(row: DatabaseRow): EvidenceBundle {
  const traceId = optionalStringColumn(row, "trace_id");
  return EvidenceBundleSchema.parse({
    createdAt: stringColumn(row, "created_at"),
    id: stringColumn(row, "id"),
    items: jsonArrayColumn(row, "items"),
    missingEvidence: jsonArrayColumn(row, "missing_evidence"),
    query: stringColumn(row, "query"),
    state: stringColumn(row, "state"),
    ...(traceId ? { traceId } : {}),
  });
}

function citationDocumentIds(bundle: EvidenceBundle): readonly string[] {
  return [
    ...new Set(
      bundle.items.flatMap((item) => item.citations.map((citation) => citation.documentAssetId)),
    ),
  ].sort();
}

function normalizeCreateInput(input: ScopedEvidenceBundleInput): ScopedEvidenceBundleInput {
  const scope = normalizeLookup({
    id: input.bundle.id,
    knowledgeSpaceId: input.knowledgeSpaceId,
    tenantId: input.tenantId,
  });
  return { ...scope, bundle: cloneBundle(EvidenceBundleSchema.parse(input.bundle)) };
}

function normalizeLookup(input: ScopedEvidenceBundleLookup): ScopedEvidenceBundleLookup {
  for (const [field, value] of Object.entries(input)) {
    if (!value || value !== value.trim()) {
      throw new Error(`Evidence bundle ${field} is invalid`);
    }
  }
  return { ...input };
}

function cloneBundle(bundle: EvidenceBundle): EvidenceBundle {
  return EvidenceBundleSchema.parse(JSON.parse(JSON.stringify(bundle)) as unknown);
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}
