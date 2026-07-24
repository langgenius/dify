import type { DatabaseAdapter, DatabaseQueryValue, DatabaseRow } from "@knowledge/core";

import type {
  BulkOperation,
  BulkOperationItem,
  BulkOperationRepository,
  BulkOperationType,
} from "./bulk-operation";
import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonArrayColumn, jsonStringArrayColumn } from "./json-utils";

const table = "bulk_operations";

export function createDatabaseBulkOperationRepository(input: {
  readonly database: DatabaseAdapter;
  readonly maxItems: number;
  readonly maxListLimit: number;
}): BulkOperationRepository {
  const { database, maxItems, maxListLimit } = input;
  positiveInteger(maxItems, "maxItems");
  positiveInteger(maxListLimit, "maxListLimit");

  return {
    create: async (record) => {
      if (record.items.length > maxItems) {
        throw new Error(`Bulk operation repository maxItems=${maxItems} exceeded`);
      }
      const timestamp = new Date().toISOString();
      const requiredPermissionScope = operationPermissionScope(record.items);
      const params: readonly DatabaseQueryValue[] = [
        record.id,
        record.tenantId,
        record.knowledgeSpaceId,
        record.type,
        JSON.stringify(record.items),
        JSON.stringify(requiredPermissionScope),
        record.items.some((item) => item.status === "not_found"),
        record.capabilityGrantId ?? null,
        record.permissionSnapshot?.accessChannel ?? null,
        record.permissionSnapshot?.id ?? null,
        record.permissionSnapshot?.revision ?? null,
        record.requestedBySubjectId ?? null,
        timestamp,
        timestamp,
      ];
      await database.execute({
        maxRows: 0,
        operation: "insert",
        params,
        sql: `INSERT INTO ${q(database, table)} (${[
          "id",
          "tenant_id",
          "knowledge_space_id",
          "operation_type",
          "items",
          "required_permission_scope",
          "has_not_found_items",
          "capability_grant_id",
          "permission_access_channel",
          "permission_snapshot_id",
          "permission_snapshot_revision",
          "requested_by_subject_id",
          "created_at",
          "updated_at",
        ]
          .map((column) => q(database, column))
          .join(", ")}) VALUES (${params
          .map((_, index) =>
            index === 4 || index === 5 ? jsonP(database, index + 1) : p(database, index + 1),
          )
          .join(", ")});`,
        tableName: table,
      });
      return {
        ...(record.capabilityGrantId ? { capabilityGrantId: record.capabilityGrantId } : {}),
        createdAt: timestamp,
        id: record.id,
        items: record.items.map(cloneItem),
        knowledgeSpaceId: record.knowledgeSpaceId,
        ...(record.permissionSnapshot
          ? { permissionSnapshot: { ...record.permissionSnapshot } }
          : {}),
        ...(record.requestedBySubjectId
          ? { requestedBySubjectId: record.requestedBySubjectId }
          : {}),
        tenantId: record.tenantId,
        type: record.type,
        updatedAt: timestamp,
      };
    },
    findGroupedCompilationJobIds: async ({
      candidateGrants,
      compilationJobIds,
      knowledgeSpaceId,
      requestedBySubjectId,
      tenantId,
    }) => {
      const requested = [...new Set(compilationJobIds)];
      if (requested.length === 0) return [];
      if (requested.length > maxListLimit) {
        throw new Error(
          `Bulk operation grouped compilation lookup must contain at most ${maxListLimit} ids`,
        );
      }
      const params: DatabaseQueryValue[] = [
        tenantId,
        knowledgeSpaceId,
        JSON.stringify(candidateGrants),
        requestedBySubjectId,
      ];
      const itemPredicates = requested.map((compilationJobId) => {
        params.push(JSON.stringify([{ compilationJobId }]));
        return jsonContains(database, q(database, "items"), p(database, params.length));
      });
      params.push(requested.length);
      const result = await database.execute({
        maxRows: requested.length,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, table)} WHERE ${q(
          database,
          "tenant_id",
        )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
          database,
          2,
        )} AND ${permissionScopePredicate(database, p(database, 3))} AND (${q(
          database,
          "has_not_found_items",
        )} = FALSE OR ${q(database, "requested_by_subject_id")} = ${p(
          database,
          4,
        )}) AND (${itemPredicates.join(" OR ")}) LIMIT ${p(database, params.length)};`,
        tableName: table,
      });
      const requestedSet = new Set(requested);
      const grouped = new Set<string>();
      for (const operation of result.rows.map(mapOperation)) {
        for (const item of operation.items) {
          if (item.compilationJobId && requestedSet.has(item.compilationJobId)) {
            grouped.add(item.compilationJobId);
          }
        }
      }
      return [...grouped].sort();
    },
    get: async ({ id, tenantId }) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [tenantId, id],
        sql: `SELECT * FROM ${q(database, table)} WHERE ${q(
          database,
          "tenant_id",
        )} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} LIMIT 1;`,
        tableName: table,
      });
      return result.rows[0] ? mapOperation(result.rows[0]) : null;
    },
    list: async ({
      candidateGrants,
      cursor,
      knowledgeSpaceId,
      limit,
      requestedBySubjectId,
      tenantId,
    }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxListLimit) {
        throw new Error(`Bulk operation list limit must be between 1 and ${maxListLimit}`);
      }
      const params: DatabaseQueryValue[] = [
        tenantId,
        knowledgeSpaceId,
        JSON.stringify(candidateGrants),
        requestedBySubjectId,
      ];
      let cursorPredicate = "";
      if (cursor) {
        params.push(cursor.createdAt, cursor.id);
        cursorPredicate = ` AND (${q(database, "created_at")} < ${p(
          database,
          params.length - 1,
        )} OR (${q(database, "created_at")} = ${p(
          database,
          params.length - 1,
        )} AND ${q(database, "id")} < ${p(database, params.length)}))`;
      }
      params.push(limit + 1);
      const result = await database.execute({
        maxRows: limit + 1,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, table)} WHERE ${q(
          database,
          "tenant_id",
        )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
          database,
          2,
        )} AND ${permissionScopePredicate(database, p(database, 3))} AND (${q(
          database,
          "has_not_found_items",
        )} = FALSE OR ${q(database, "requested_by_subject_id")} = ${p(
          database,
          4,
        )})${cursorPredicate} ORDER BY ${q(database, "created_at")} DESC, ${q(
          database,
          "id",
        )} DESC LIMIT ${p(database, params.length)};`,
        tableName: table,
      });
      const items = result.rows.slice(0, limit).map(mapOperation);
      const last = items.at(-1);
      return {
        items,
        ...(result.rows.length > limit && last
          ? { nextCursor: { createdAt: last.createdAt, id: last.id } }
          : {}),
      };
    },
  };
}

function mapOperation(row: DatabaseRow): BulkOperation {
  const type = stringColumn(row, "operation_type");
  if (!isOperationType(type)) throw new Error("Bulk operation type is invalid");
  const items = jsonArrayColumn(row, "items").map(parseItem);
  const permissionAccessChannel = optionalStringColumn(row, "permission_access_channel");
  let validatedPermissionAccessChannel: "agent" | "interactive" | "mcp" | "service_api" | undefined;
  const permissionSnapshotId = optionalStringColumn(row, "permission_snapshot_id");
  const permissionSnapshotRevision = optionalNumber(row, "permission_snapshot_revision");
  if (
    Boolean(permissionAccessChannel) !== Boolean(permissionSnapshotId) ||
    Boolean(permissionAccessChannel) !== (permissionSnapshotRevision !== undefined)
  ) {
    throw new Error("Bulk operation permission snapshot is invalid");
  }
  if (permissionAccessChannel) {
    if (!isPermissionAccessChannel(permissionAccessChannel)) {
      throw new Error("Bulk operation permission access channel is invalid");
    }
    validatedPermissionAccessChannel = permissionAccessChannel;
  }
  return {
    ...(optionalStringColumn(row, "capability_grant_id")
      ? { capabilityGrantId: optionalStringColumn(row, "capability_grant_id") }
      : {}),
    createdAt: stringColumn(row, "created_at"),
    id: stringColumn(row, "id"),
    items,
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ...(validatedPermissionAccessChannel &&
    permissionSnapshotId &&
    permissionSnapshotRevision !== undefined
      ? {
          permissionSnapshot: {
            accessChannel: validatedPermissionAccessChannel,
            id: permissionSnapshotId,
            revision: permissionSnapshotRevision,
          },
        }
      : {}),
    ...(optionalStringColumn(row, "requested_by_subject_id")
      ? { requestedBySubjectId: optionalStringColumn(row, "requested_by_subject_id") }
      : {}),
    tenantId: stringColumn(row, "tenant_id"),
    type,
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function parseItem(value: unknown): BulkOperationItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Bulk operation item is invalid");
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.documentId !== "string" ||
    !item.documentId ||
    (item.compilationJobId !== undefined && typeof item.compilationJobId !== "string") ||
    (item.error !== undefined && typeof item.error !== "string") ||
    !["queued", "completed", "failed", "canceled", "not_found"].includes(String(item.status))
  ) {
    throw new Error("Bulk operation item is invalid");
  }
  const scope =
    item.requiredPermissionScope === undefined
      ? undefined
      : Array.isArray(item.requiredPermissionScope) &&
          item.requiredPermissionScope.every((entry) => typeof entry === "string")
        ? (item.requiredPermissionScope as string[])
        : null;
  if (scope === null) throw new Error("Bulk operation permission scope is invalid");
  return {
    ...(item.compilationJobId ? { compilationJobId: item.compilationJobId as string } : {}),
    documentId: item.documentId,
    ...(item.error ? { error: item.error as string } : {}),
    ...(scope ? { requiredPermissionScope: [...scope] } : {}),
    status: item.status as BulkOperationItem["status"],
  };
}

function operationPermissionScope(items: readonly BulkOperationItem[]): readonly string[] {
  const scopes = new Set<string>();
  for (const item of items) {
    for (const scope of item.requiredPermissionScope ?? []) scopes.add(scope);
  }
  return [...scopes].sort();
}

function permissionScopePredicate(database: DatabaseAdapter, grants: string): string {
  const scope = q(database, "required_permission_scope");
  return database.dialect === "postgres"
    ? `${grants}::jsonb @> ${scope}`
    : `JSON_CONTAINS(CAST(${grants} AS JSON), ${scope})`;
}

function jsonContains(database: DatabaseAdapter, column: string, candidate: string): string {
  return database.dialect === "postgres"
    ? `${column} @> ${candidate}::jsonb`
    : `JSON_CONTAINS(${column}, CAST(${candidate} AS JSON))`;
}

function isOperationType(value: string): value is BulkOperationType {
  return value === "document_upload" || value === "document_delete" || value === "document_reindex";
}

function isPermissionAccessChannel(
  value: string,
): value is "agent" | "interactive" | "mcp" | "service_api" {
  return value === "interactive" || value === "service_api" || value === "mcp" || value === "agent";
}

function cloneItem(item: BulkOperationItem): BulkOperationItem {
  return JSON.parse(JSON.stringify(item)) as BulkOperationItem;
}

function optionalNumber(row: DatabaseRow, column: string): number | undefined {
  return row[column] === null || row[column] === undefined ? undefined : numberColumn(row, column);
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive`);
}

function q(database: Pick<DatabaseAdapter, "dialect">, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return databasePlaceholder(database, position);
}

function jsonP(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  const placeholder = p(database, position);
  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}
