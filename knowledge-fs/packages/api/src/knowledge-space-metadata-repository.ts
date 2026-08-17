import { randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import { nonnegativeSafeIntegerColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

export type KnowledgeSpaceMetadataFieldType = "number" | "string" | "time";

export interface KnowledgeSpaceMetadataField {
  readonly count: number;
  readonly createdAt: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly name: string;
  readonly rowVersion: number;
  readonly tenantId: string;
  readonly type: KnowledgeSpaceMetadataFieldType;
  readonly updatedAt: string;
}

export interface KnowledgeSpaceMetadataFieldCursor {
  readonly id: string;
  readonly name: string;
}

interface MetadataScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface KnowledgeSpaceMetadataRepository {
  create(
    input: MetadataScope & {
      readonly name: string;
      readonly now: string;
      readonly subjectId: string;
      readonly type: KnowledgeSpaceMetadataFieldType;
    },
  ): Promise<KnowledgeSpaceMetadataField>;
  delete(
    input: MetadataScope & {
      readonly expectedRowVersion: number;
      readonly fieldId: string;
      readonly now: string;
    },
  ): Promise<void>;
  list(
    input: MetadataScope & {
      readonly cursor?: KnowledgeSpaceMetadataFieldCursor | undefined;
      readonly limit: number;
    },
  ): Promise<{
    readonly items: readonly KnowledgeSpaceMetadataField[];
    readonly nextCursor?: KnowledgeSpaceMetadataFieldCursor | undefined;
  }>;
  reconcileDocument(
    input: MetadataScope & {
      readonly documentId: string;
      readonly now: string;
      readonly subjectId: string;
      readonly userMetadata: Readonly<Record<string, unknown>>;
    },
  ): Promise<void>;
  updateName(
    input: MetadataScope & {
      readonly expectedRowVersion: number;
      readonly fieldId: string;
      readonly name: string;
      readonly now: string;
      readonly subjectId: string;
    },
  ): Promise<KnowledgeSpaceMetadataField>;
  validatePatch(
    input: MetadataScope & { readonly patch: Readonly<Record<string, unknown>> },
  ): Promise<void>;
}

export interface KnowledgeSpaceMetadataDocumentLifecycle {
  reconcileDocument(
    executor: DatabaseExecutor,
    input: MetadataScope & {
      readonly documentId: string;
      readonly now: string;
      readonly subjectId: string;
      readonly userMetadata: Readonly<Record<string, unknown>>;
    },
  ): Promise<void>;
  syncDocumentAsset(
    executor: DatabaseExecutor,
    input: MetadataScope & {
      readonly documentId: string;
      readonly userMetadata: Readonly<Record<string, unknown>>;
    },
  ): Promise<void>;
  validatePatch(
    executor: DatabaseExecutor,
    input: MetadataScope & { readonly patch: Readonly<Record<string, unknown>> },
  ): Promise<void>;
}

export interface DatabaseKnowledgeSpaceMetadataRepository extends KnowledgeSpaceMetadataRepository {
  readonly documentLifecycle: KnowledgeSpaceMetadataDocumentLifecycle;
}

export class KnowledgeSpaceMetadataValidationError extends Error {}
export class KnowledgeSpaceMetadataNotFoundError extends Error {}
export class KnowledgeSpaceMetadataConflictError extends Error {}

export interface DatabaseKnowledgeSpaceMetadataRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateFieldId?: (() => string) | undefined;
  readonly maxFieldsPerSpace?: number | undefined;
  readonly maxListLimit: number;
}

const customMetadataNamePattern = /^[a-z][a-z0-9_]{0,254}$/u;
const reservedCustomMetadataNames = new Set(["provenance", "system"]);
const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

export function createDatabaseKnowledgeSpaceMetadataRepository({
  database,
  generateFieldId = randomUUID,
  maxFieldsPerSpace = 100,
  maxListLimit,
}: DatabaseKnowledgeSpaceMetadataRepositoryOptions): DatabaseKnowledgeSpaceMetadataRepository {
  positiveLimit(maxFieldsPerSpace, "maxFieldsPerSpace");
  positiveLimit(maxListLimit, "maxListLimit");

  const readField = async (
    executor: DatabaseExecutor,
    input: MetadataScope & { readonly fieldId: string },
    forUpdate = false,
  ): Promise<KnowledgeSpaceMetadataField | null> => {
    if (forUpdate) {
      const result = await executor.execute({
        maxRows: 1,
        operation: "select",
        params: [input.tenantId, input.knowledgeSpaceId, input.fieldId],
        sql: `SELECT field.*, 0 AS ${q(database, "binding_count")} FROM ${q(database, "knowledge_space_metadata_fields")} field WHERE field.${q(database, "tenant_id")} = ${p(database, 1)} AND field.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND field.${q(database, "id")} = ${p(database, 3)} FOR UPDATE;`,
        tableName: "knowledge_space_metadata_fields",
      });
      return result.rows[0] ? mapField(result.rows[0]) : null;
    }
    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId, input.fieldId],
      sql: `SELECT field.*, COUNT(binding.${q(database, "document_id")}) AS ${q(database, "binding_count")} FROM ${q(database, "knowledge_space_metadata_fields")} field LEFT JOIN ${q(database, "logical_document_metadata_bindings")} binding ON binding.${q(database, "tenant_id")} = field.${q(database, "tenant_id")} AND binding.${q(database, "knowledge_space_id")} = field.${q(database, "knowledge_space_id")} AND binding.${q(database, "metadata_field_id")} = field.${q(database, "id")} WHERE field.${q(database, "tenant_id")} = ${p(database, 1)} AND field.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND field.${q(database, "id")} = ${p(database, 3)} GROUP BY ${fieldGroupColumns(database)};`,
      tableName: "knowledge_space_metadata_fields",
    });
    return result.rows[0] ? mapField(result.rows[0]) : null;
  };

  const requireField = async (
    executor: DatabaseExecutor,
    input: MetadataScope & { readonly fieldId: string },
    forUpdate = false,
  ): Promise<KnowledgeSpaceMetadataField> => {
    const field = await readField(executor, input, forUpdate);
    if (!field) throw new KnowledgeSpaceMetadataNotFoundError("Metadata field not found");
    return field;
  };

  const validatePatchWithExecutor: KnowledgeSpaceMetadataDocumentLifecycle["validatePatch"] =
    async (executor, input) => {
      const fields = await listAllFieldsByName(database, executor, input);
      for (const [name, value] of Object.entries(input.patch)) {
        if (!isCustomMetadataName(name) || value === null) continue;
        const field = fields.get(name);
        if (!field) {
          throw new KnowledgeSpaceMetadataValidationError(
            `Metadata field ${name} must be created before assigning a value`,
          );
        }
        validateMetadataValue(field, value);
      }
    };

  const reconcileDocumentWithExecutor: KnowledgeSpaceMetadataDocumentLifecycle["reconcileDocument"] =
    async (executor, input) => {
      const fields = await listAllFieldsByName(database, executor, input);
      validateUserMetadataAgainstFields(input.userMetadata, fields);
      const boundFields = [...fields.values()].filter(
        (field) =>
          input.userMetadata[field.name] !== null && input.userMetadata[field.name] !== undefined,
      );
      await executor.execute({
        maxRows: 0,
        operation: "delete",
        params: [input.tenantId, input.knowledgeSpaceId, input.documentId],
        sql: `DELETE FROM ${q(database, "logical_document_metadata_bindings")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "document_id")} = ${p(database, 3)};`,
        tableName: "logical_document_metadata_bindings",
      });
      if (boundFields.length > 0) {
        const params: DatabaseQueryValue[] = [];
        const rows = boundFields.map((field) => {
          const start = params.length;
          params.push(
            input.tenantId,
            input.knowledgeSpaceId,
            input.documentId,
            field.id,
            input.subjectId,
            input.now,
          );
          return `(${p(database, start + 1)}, ${p(database, start + 2)}, ${p(database, start + 3)}, ${p(database, start + 4)}, ${p(database, start + 5)}, ${p(database, start + 6)})`;
        });
        await executor.execute({
          maxRows: 0,
          operation: "insert",
          params,
          sql: `INSERT INTO ${q(database, "logical_document_metadata_bindings")} (${["tenant_id", "knowledge_space_id", "document_id", "metadata_field_id", "created_by_subject_id", "created_at"].map((column) => q(database, column)).join(", ")}) VALUES ${rows.join(", ")};`,
          tableName: "logical_document_metadata_bindings",
        });
      }
      await syncDocumentAsset(database, executor, input);
    };

  return {
    create: (input) =>
      database.transaction(async (transaction) => {
        const name = normalizeMetadataName(input.name);
        validateMetadataType(input.type);
        await requireWritableSpace(database, transaction, input);
        const existing = await readFieldByName(database, transaction, { ...input, name });
        if (existing) {
          throw new KnowledgeSpaceMetadataConflictError("Metadata field name already exists");
        }
        const countResult = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId],
          sql: `SELECT COUNT(*) AS ${q(database, "field_count")} FROM ${q(database, "knowledge_space_metadata_fields")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)};`,
          tableName: "knowledge_space_metadata_fields",
        });
        if (countColumn(countResult.rows[0] ?? {}, "field_count") >= maxFieldsPerSpace) {
          throw new KnowledgeSpaceMetadataValidationError(
            `Metadata field limit ${maxFieldsPerSpace} exceeded`,
          );
        }
        const fieldId = generateFieldId();
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params: [
            fieldId,
            input.tenantId,
            input.knowledgeSpaceId,
            name,
            input.type,
            input.subjectId,
            input.now,
          ],
          sql: `INSERT INTO ${q(database, "knowledge_space_metadata_fields")} (${["id", "tenant_id", "knowledge_space_id", "name", "type", "row_version", "created_by_subject_id", "updated_by_subject_id", "created_at", "updated_at"].map((column) => q(database, column)).join(", ")}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${p(database, 5)}, 0, ${p(database, 6)}, NULL, ${p(database, 7)}, ${p(database, 7)});`,
          tableName: "knowledge_space_metadata_fields",
        });
        return requireField(transaction, { ...input, fieldId });
      }),
    delete: (input) =>
      database.transaction(async (transaction) => {
        await requireWritableSpace(database, transaction, input);
        const field = await requireField(transaction, input, true);
        assertRowVersion(field, input.expectedRowVersion);
        await updateBoundDocumentMetadata(database, transaction, {
          ...input,
          operation: "delete",
          sourceName: field.name,
        });
        await syncBoundDocumentAssets(database, transaction, input);
        const deleted = await transaction.execute({
          maxRows: 0,
          operation: "delete",
          params: [input.tenantId, input.knowledgeSpaceId, input.fieldId, input.expectedRowVersion],
          sql: `DELETE FROM ${q(database, "knowledge_space_metadata_fields")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "row_version")} = ${p(database, 4)};`,
          tableName: "knowledge_space_metadata_fields",
        });
        if (deleted.rowsAffected !== 1) {
          throw new KnowledgeSpaceMetadataConflictError("Metadata field changed concurrently");
        }
      }),
    list: async (input) => {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
        throw new KnowledgeSpaceMetadataValidationError(
          `Metadata field limit must be between 1 and ${maxListLimit}`,
        );
      }
      const params: DatabaseQueryValue[] = [input.tenantId, input.knowledgeSpaceId];
      let cursorSql = "";
      if (input.cursor) {
        params.push(input.cursor.name, input.cursor.name, input.cursor.id);
        cursorSql = ` AND (field.${q(database, "name")} > ${p(database, 3)} OR (field.${q(database, "name")} = ${p(database, 4)} AND field.${q(database, "id")} > ${p(database, 5)}))`;
      }
      params.push(input.limit + 1);
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT field.*, COUNT(binding.${q(database, "document_id")}) AS ${q(database, "binding_count")} FROM ${q(database, "knowledge_space_metadata_fields")} field LEFT JOIN ${q(database, "logical_document_metadata_bindings")} binding ON binding.${q(database, "tenant_id")} = field.${q(database, "tenant_id")} AND binding.${q(database, "knowledge_space_id")} = field.${q(database, "knowledge_space_id")} AND binding.${q(database, "metadata_field_id")} = field.${q(database, "id")} WHERE field.${q(database, "tenant_id")} = ${p(database, 1)} AND field.${q(database, "knowledge_space_id")} = ${p(database, 2)}${cursorSql} GROUP BY ${fieldGroupColumns(database)} ORDER BY field.${q(database, "name")} ASC, field.${q(database, "id")} ASC LIMIT ${p(database, params.length)};`,
        tableName: "knowledge_space_metadata_fields",
      });
      const items = result.rows.slice(0, input.limit).map(mapField);
      const last = items.at(-1);
      return {
        items,
        ...(result.rows.length > input.limit && last
          ? { nextCursor: { id: last.id, name: last.name } }
          : {}),
      };
    },
    documentLifecycle: {
      reconcileDocument: reconcileDocumentWithExecutor,
      syncDocumentAsset: (executor, input) => syncDocumentAsset(database, executor, input),
      validatePatch: validatePatchWithExecutor,
    },
    reconcileDocument: (input) =>
      database.transaction((transaction) => reconcileDocumentWithExecutor(transaction, input)),
    updateName: (input) =>
      database.transaction(async (transaction) => {
        const name = normalizeMetadataName(input.name);
        await requireWritableSpace(database, transaction, input);
        const field = await requireField(transaction, input, true);
        assertRowVersion(field, input.expectedRowVersion);
        if (field.name === name) return field;
        if (await readFieldByName(database, transaction, { ...input, name })) {
          throw new KnowledgeSpaceMetadataConflictError("Metadata field name already exists");
        }
        await updateBoundDocumentMetadata(database, transaction, {
          ...input,
          operation: "rename",
          sourceName: field.name,
          targetName: name,
        });
        const updated = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            name,
            input.subjectId,
            input.now,
            input.tenantId,
            input.knowledgeSpaceId,
            input.fieldId,
            input.expectedRowVersion,
          ],
          sql: `UPDATE ${q(database, "knowledge_space_metadata_fields")} SET ${q(database, "name")} = ${p(database, 1)}, ${q(database, "updated_by_subject_id")} = ${p(database, 2)}, ${q(database, "updated_at")} = ${p(database, 3)}, ${q(database, "row_version")} = ${q(database, "row_version")} + 1 WHERE ${q(database, "tenant_id")} = ${p(database, 4)} AND ${q(database, "knowledge_space_id")} = ${p(database, 5)} AND ${q(database, "id")} = ${p(database, 6)} AND ${q(database, "row_version")} = ${p(database, 7)};`,
          tableName: "knowledge_space_metadata_fields",
        });
        if (updated.rowsAffected !== 1) {
          throw new KnowledgeSpaceMetadataConflictError("Metadata field changed concurrently");
        }
        await syncBoundDocumentAssets(database, transaction, input);
        return requireField(transaction, input);
      }),
    validatePatch: (input) => validatePatchWithExecutor(database, input),
  };
}

function normalizeMetadataName(name: string): string {
  const normalized = name.trim();
  if (!customMetadataNamePattern.test(normalized) || reservedCustomMetadataNames.has(normalized)) {
    throw new KnowledgeSpaceMetadataValidationError(
      "Metadata field name must be non-reserved, start with a lowercase letter, and contain only lowercase letters, digits, or underscores",
    );
  }
  return normalized;
}

function isCustomMetadataName(name: string): boolean {
  return customMetadataNamePattern.test(name) && !reservedCustomMetadataNames.has(name);
}

function validateMetadataType(type: string): asserts type is KnowledgeSpaceMetadataFieldType {
  if (type !== "string" && type !== "number" && type !== "time") {
    throw new KnowledgeSpaceMetadataValidationError("Metadata field type is invalid");
  }
}

function validateMetadataValue(field: KnowledgeSpaceMetadataField, value: unknown): void {
  if (
    (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) ||
    (field.type === "string" && typeof value !== "string") ||
    (field.type === "time" &&
      (typeof value !== "string" ||
        !isoTimestampPattern.test(value) ||
        Number.isNaN(Date.parse(value))))
  ) {
    throw new KnowledgeSpaceMetadataValidationError(
      `Metadata field ${field.name} requires a ${field.type} value`,
    );
  }
}

function validateUserMetadataAgainstFields(
  metadata: Readonly<Record<string, unknown>>,
  fields: ReadonlyMap<string, KnowledgeSpaceMetadataField>,
): void {
  for (const [name, value] of Object.entries(metadata)) {
    if (!isCustomMetadataName(name) || value === null || value === undefined) continue;
    const field = fields.get(name);
    if (!field) continue;
    validateMetadataValue(field, value);
  }
}

async function listAllFieldsByName(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: MetadataScope,
): Promise<Map<string, KnowledgeSpaceMetadataField>> {
  const result = await executor.execute({
    maxRows: 100,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT field.*, COUNT(binding.${q(database, "document_id")}) AS ${q(database, "binding_count")} FROM ${q(database, "knowledge_space_metadata_fields")} field LEFT JOIN ${q(database, "logical_document_metadata_bindings")} binding ON binding.${q(database, "tenant_id")} = field.${q(database, "tenant_id")} AND binding.${q(database, "knowledge_space_id")} = field.${q(database, "knowledge_space_id")} AND binding.${q(database, "metadata_field_id")} = field.${q(database, "id")} WHERE field.${q(database, "tenant_id")} = ${p(database, 1)} AND field.${q(database, "knowledge_space_id")} = ${p(database, 2)} GROUP BY ${fieldGroupColumns(database)} ORDER BY field.${q(database, "name")} ASC, field.${q(database, "id")} ASC LIMIT 100;`,
    tableName: "knowledge_space_metadata_fields",
  });
  return new Map(result.rows.map(mapField).map((field) => [field.name, field]));
}

async function readFieldByName(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: MetadataScope & { readonly name: string },
): Promise<DatabaseRow | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.name],
    sql: `SELECT * FROM ${q(database, "knowledge_space_metadata_fields")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "name")} = ${p(database, 3)} LIMIT 1;`,
    tableName: "knowledge_space_metadata_fields",
  });
  return result.rows[0] ?? null;
}

async function requireWritableSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: MetadataScope,
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, input))) {
    throw new KnowledgeSpaceMetadataNotFoundError("Knowledge space not found");
  }
}

function mapField(row: DatabaseRow): KnowledgeSpaceMetadataField {
  const type = stringColumn(row, "type");
  validateMetadataType(type);
  return {
    count: countColumn(row, "binding_count"),
    createdAt: stringColumn(row, "created_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    name: stringColumn(row, "name"),
    rowVersion: nonnegativeSafeIntegerColumn(row, "row_version"),
    tenantId: stringColumn(row, "tenant_id"),
    type,
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function countColumn(row: DatabaseRow, column: string): number {
  const value = row[column];
  const normalized = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (typeof normalized !== "number" || !Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error(`Database row column ${column} must be a nonnegative integer`);
  }
  return normalized;
}

function assertRowVersion(field: KnowledgeSpaceMetadataField, expected: number): void {
  if (field.rowVersion !== expected) {
    throw new KnowledgeSpaceMetadataConflictError(
      `Metadata field changed concurrently: expected=${expected} actual=${field.rowVersion}`,
    );
  }
}

async function updateBoundDocumentMetadata(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: MetadataScope & {
    readonly fieldId: string;
    readonly now: string;
    readonly operation: "delete" | "rename";
    readonly sourceName: string;
    readonly targetName?: string | undefined;
  },
): Promise<void> {
  const params: DatabaseQueryValue[] = [
    input.sourceName,
    ...(input.targetName ? [input.targetName] : []),
    input.now,
    input.tenantId,
    input.knowledgeSpaceId,
    input.fieldId,
  ];
  const source = p(database, 1);
  const target = input.targetName ? p(database, 2) : undefined;
  const nowPosition = input.targetName ? 3 : 2;
  const tenantPosition = nowPosition + 1;
  const spacePosition = tenantPosition + 1;
  const fieldPosition = spacePosition + 1;
  const jsonExpression =
    database.dialect === "postgres"
      ? input.operation === "rename"
        ? `jsonb_set(document.${q(database, "user_metadata")} - ${source}, ARRAY[${target}]::text[], document.${q(database, "user_metadata")} -> ${source}, true)`
        : `document.${q(database, "user_metadata")} - ${source}`
      : input.operation === "rename"
        ? `JSON_SET(JSON_REMOVE(document.${q(database, "user_metadata")}, CONCAT('$."', ${source}, '"')), CONCAT('$."', ${target}, '"'), JSON_EXTRACT(document.${q(database, "user_metadata")}, CONCAT('$."', ${source}, '"')))`
        : `JSON_REMOVE(document.${q(database, "user_metadata")}, CONCAT('$."', ${source}, '"'))`;
  await executor.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q(database, "logical_documents")} document SET ${q(database, "user_metadata")} = ${jsonExpression}, ${q(database, "updated_at")} = ${p(database, nowPosition)}, ${q(database, "row_version")} = document.${q(database, "row_version")} + 1 WHERE document.${q(database, "tenant_id")} = ${p(database, tenantPosition)} AND document.${q(database, "knowledge_space_id")} = ${p(database, spacePosition)} AND EXISTS (SELECT 1 FROM ${q(database, "logical_document_metadata_bindings")} binding WHERE binding.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND binding.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND binding.${q(database, "document_id")} = document.${q(database, "id")} AND binding.${q(database, "metadata_field_id")} = ${p(database, fieldPosition)});`,
    tableName: "logical_documents",
  });
}

async function syncDocumentAsset(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: MetadataScope & {
    readonly documentId: string;
    readonly userMetadata: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  const metadata = JSON.stringify(input.userMetadata);
  const expression =
    database.dialect === "postgres"
      ? `jsonb_set(asset.${q(database, "metadata")}, '{userMetadata}', ${p(database, 1)}::jsonb, true)`
      : `JSON_SET(asset.${q(database, "metadata")}, '$.userMetadata', CAST(${p(database, 1)} AS JSON))`;
  await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [metadata, input.tenantId, input.knowledgeSpaceId, input.documentId],
    sql: `UPDATE ${q(database, "document_assets")} asset SET ${q(database, "metadata")} = ${expression} WHERE EXISTS (SELECT 1 FROM ${q(database, "logical_documents")} document JOIN ${q(database, "document_revisions")} revision ON revision.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND revision.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND revision.${q(database, "document_id")} = document.${q(database, "id")} AND revision.${q(database, "revision")} = document.${q(database, "active_revision")} WHERE document.${q(database, "tenant_id")} = ${p(database, 2)} AND document.${q(database, "knowledge_space_id")} = ${p(database, 3)} AND document.${q(database, "id")} = ${p(database, 4)} AND revision.${q(database, "document_asset_id")} = asset.${q(database, "id")} AND revision.${q(database, "document_asset_version")} = asset.${q(database, "version")});`,
    tableName: "document_assets",
  });
}

async function syncBoundDocumentAssets(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: MetadataScope & { readonly fieldId: string },
): Promise<void> {
  const expression =
    database.dialect === "postgres"
      ? `jsonb_set(asset.${q(database, "metadata")}, '{userMetadata}', document.${q(database, "user_metadata")}, true)`
      : `JSON_SET(asset.${q(database, "metadata")}, '$.userMetadata', document.${q(database, "user_metadata")})`;
  await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [input.tenantId, input.knowledgeSpaceId, input.fieldId],
    sql: `UPDATE ${q(database, "document_assets")} asset SET ${q(database, "metadata")} = (SELECT ${expression} FROM ${q(database, "logical_documents")} document JOIN ${q(database, "document_revisions")} revision ON revision.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND revision.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND revision.${q(database, "document_id")} = document.${q(database, "id")} AND revision.${q(database, "revision")} = document.${q(database, "active_revision")} JOIN ${q(database, "logical_document_metadata_bindings")} binding ON binding.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND binding.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND binding.${q(database, "document_id")} = document.${q(database, "id")} WHERE binding.${q(database, "tenant_id")} = ${p(database, 1)} AND binding.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND binding.${q(database, "metadata_field_id")} = ${p(database, 3)} AND revision.${q(database, "document_asset_id")} = asset.${q(database, "id")} AND revision.${q(database, "document_asset_version")} = asset.${q(database, "version")} LIMIT 1) WHERE EXISTS (SELECT 1 FROM ${q(database, "logical_documents")} document JOIN ${q(database, "document_revisions")} revision ON revision.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND revision.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND revision.${q(database, "document_id")} = document.${q(database, "id")} AND revision.${q(database, "revision")} = document.${q(database, "active_revision")} JOIN ${q(database, "logical_document_metadata_bindings")} binding ON binding.${q(database, "tenant_id")} = document.${q(database, "tenant_id")} AND binding.${q(database, "knowledge_space_id")} = document.${q(database, "knowledge_space_id")} AND binding.${q(database, "document_id")} = document.${q(database, "id")} WHERE binding.${q(database, "tenant_id")} = ${p(database, 1)} AND binding.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND binding.${q(database, "metadata_field_id")} = ${p(database, 3)} AND revision.${q(database, "document_asset_id")} = asset.${q(database, "id")} AND revision.${q(database, "document_asset_version")} = asset.${q(database, "version")});`,
    tableName: "document_assets",
  });
}

function fieldGroupColumns(database: DatabaseAdapter): string {
  return [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "name",
    "type",
    "row_version",
    "created_by_subject_id",
    "updated_by_subject_id",
    "created_at",
    "updated_at",
  ]
    .map((column) => `field.${q(database, column)}`)
    .join(", ");
}

function q(database: DatabaseAdapter, value: string): string {
  return quoteDatabaseIdentifier(database, value);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}

function positiveLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive`);
}
