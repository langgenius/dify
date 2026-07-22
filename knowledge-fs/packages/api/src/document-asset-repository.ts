import { randomUUID } from "node:crypto";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { readableDocumentParentSourcePredicateSql } from "./document-asset-visibility-sql";
import { cloneJsonObject, jsonObjectColumn } from "./json-utils";

import {
  type DatabaseAdapter,
  type DatabaseQueryValue,
  type DatabaseRow,
  type DocumentAsset,
  DocumentAssetSchema,
} from "@knowledge/core";

export interface CreateDocumentAssetInput {
  readonly filename: string;
  readonly id?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly mimeType: string;
  readonly objectKey: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly sourceId?: string | undefined;
  /** Authenticated admission context; repositories do not persist this field on the asset. */
  readonly tenantId?: string | undefined;
}

export interface DocumentAssetRepository {
  create(input: CreateDocumentAssetInput): Promise<DocumentAsset>;
  get(input: DocumentAssetLookupInput): Promise<DocumentAsset | null>;
  /** Internal durable-deletion lookup; includes a row already fenced as deleting. */
  getForDeletion(input: DocumentAssetLookupInput): Promise<DocumentAsset | null>;
  getStorageUsage(input: DocumentStorageUsageInput): Promise<DocumentStorageUsage>;
  list(input: ListDocumentAssetsInput): Promise<ListDocumentAssetsResult>;
  listBySource(input: ListDocumentAssetsBySourceInput): Promise<ListDocumentAssetsResult>;
  /** Exact compensation for an asset created by a writer that failed or lost its fence. */
  rollbackStaleWrite(input: RollbackDocumentAssetWriteInput): Promise<DocumentAsset | null>;
  updateParserStatus(input: UpdateDocumentAssetParserStatusInput): Promise<DocumentAsset | null>;
}

export interface ListDocumentAssetsBySourceInput {
  readonly cursor?: DocumentAssetCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly sourceId: string;
}

export interface DocumentAssetLookupInput {
  readonly id: string;
  readonly knowledgeSpaceId: string;
}

export interface RollbackDocumentAssetWriteInput extends DocumentAssetLookupInput {
  readonly expectedObjectKey: string;
  readonly expectedVersion: number;
}

export interface DocumentAssetCursor {
  readonly id: string;
}

export interface ListDocumentAssetsInput {
  readonly cursor?: DocumentAssetCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
}

export interface ListDocumentAssetsResult {
  readonly items: DocumentAsset[];
  readonly nextCursor?: DocumentAssetCursor | undefined;
}

export interface DocumentStorageUsageInput {
  readonly knowledgeSpaceId: string;
}

export interface DocumentStorageUsage {
  readonly documentCount: number;
  readonly rawDocumentBytes: number;
}

export interface UpdateDocumentAssetParserStatusInput extends DocumentAssetLookupInput {
  readonly parserStatus: DocumentAsset["parserStatus"];
}

export interface InMemoryDocumentAssetRepositoryOptions {
  readonly generateId?: () => string;
  /** Test/runtime hook mirroring the database parent-Source visibility closure. */
  readonly isParentSourceReadable?:
    | ((input: { readonly knowledgeSpaceId: string; readonly sourceId: string }) =>
        | boolean
        | Promise<boolean>)
    | undefined;
  readonly maxAssets: number;
  readonly now?: () => string;
}

export interface DatabaseDocumentAssetRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: () => string;
  readonly now?: () => string;
}

export class DocumentAssetCapacityExceededError extends Error {
  constructor(maxAssets: number) {
    super(`Document asset repository maxAssets=${maxAssets} exceeded`);
  }
}

export function createInMemoryDocumentAssetRepository({
  generateId = randomUUID,
  isParentSourceReadable = () => true,
  maxAssets,
  now = () => new Date().toISOString(),
}: InMemoryDocumentAssetRepositoryOptions): DocumentAssetRepository {
  if (maxAssets < 1) {
    throw new Error("Document asset repository maxAssets must be at least 1");
  }

  const assets = new Map<string, DocumentAsset>();
  const isReadable = async (asset: DocumentAsset): Promise<boolean> =>
    !asset.sourceId ||
    (await isParentSourceReadable({
      knowledgeSpaceId: asset.knowledgeSpaceId,
      sourceId: asset.sourceId,
    }));

  return {
    create: async (input) => {
      if (assets.size >= maxAssets) {
        throw new DocumentAssetCapacityExceededError(maxAssets);
      }

      const asset = DocumentAssetSchema.parse({
        ...input,
        createdAt: now(),
        id: input.id ?? generateId(),
        metadata: cloneJsonObject(input.metadata ?? {}),
        parserStatus: "pending",
        version: 1,
      });

      assets.set(asset.id, cloneDocumentAsset(asset));

      return cloneDocumentAsset(asset);
    },
    rollbackStaleWrite: async ({ expectedObjectKey, expectedVersion, id, knowledgeSpaceId }) => {
      const existing = assets.get(id);

      if (
        !existing ||
        existing.knowledgeSpaceId !== knowledgeSpaceId ||
        existing.objectKey !== expectedObjectKey ||
        existing.version !== expectedVersion
      ) {
        return null;
      }

      assets.delete(id);

      return cloneDocumentAsset(existing);
    },
    get: async ({ id, knowledgeSpaceId }) => {
      const asset = assets.get(id);

      return asset && asset.knowledgeSpaceId === knowledgeSpaceId && (await isReadable(asset))
        ? cloneDocumentAsset(asset)
        : null;
    },
    getForDeletion: async ({ id, knowledgeSpaceId }) => {
      const asset = assets.get(id);

      return asset && asset.knowledgeSpaceId === knowledgeSpaceId
        ? cloneDocumentAsset(asset)
        : null;
    },
    getStorageUsage: async ({ knowledgeSpaceId }) => {
      let documentCount = 0;
      let rawDocumentBytes = 0;

      for (const asset of assets.values()) {
        if (asset.knowledgeSpaceId !== knowledgeSpaceId || !(await isReadable(asset))) {
          continue;
        }

        documentCount += 1;
        rawDocumentBytes += asset.sizeBytes;
      }

      return {
        documentCount,
        rawDocumentBytes,
      };
    },
    list: async ({ cursor, knowledgeSpaceId, limit }) => {
      validateDocumentAssetListLimit(limit);

      const rows: DocumentAsset[] = [];
      for (const asset of assets.values()) {
        if (
          asset.knowledgeSpaceId === knowledgeSpaceId &&
          (!cursor || asset.id > cursor.id) &&
          (await isReadable(asset))
        ) {
          rows.push(asset);
        }
      }
      rows.sort((left, right) => left.id.localeCompare(right.id));
      const page = rows.slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneDocumentAsset);
      const lastItem = items.at(-1);

      return {
        items,
        ...(page.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
      };
    },
    listBySource: async ({ cursor, knowledgeSpaceId, limit, sourceId }) => {
      validateDocumentAssetListLimit(limit);

      const rows: DocumentAsset[] = [];
      for (const asset of assets.values()) {
        if (
          asset.knowledgeSpaceId === knowledgeSpaceId &&
          asset.sourceId === sourceId &&
          (!cursor || asset.id > cursor.id) &&
          (await isReadable(asset))
        ) {
          rows.push(asset);
        }
      }
      rows.sort((left, right) => left.id.localeCompare(right.id));
      const page = rows.slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneDocumentAsset);
      const lastItem = items.at(-1);

      return {
        items,
        ...(page.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
      };
    },
    updateParserStatus: async ({ id, knowledgeSpaceId, parserStatus }) => {
      const existing = assets.get(id);

      if (!existing || existing.knowledgeSpaceId !== knowledgeSpaceId) {
        return null;
      }

      const updated = DocumentAssetSchema.parse({
        ...existing,
        parserStatus,
      });

      assets.set(id, cloneDocumentAsset(updated));

      return cloneDocumentAsset(updated);
    },
  };
}

export function createDatabaseDocumentAssetRepository({
  database,
  generateId = randomUUID,
  now = () => new Date().toISOString(),
}: DatabaseDocumentAssetRepositoryOptions): DocumentAssetRepository {
  const tableName = "document_assets";

  return {
    create: async (input) => {
      const id = input.id ?? generateId();
      const createdAt = now();
      const metadata = JSON.stringify(cloneJsonObject(input.metadata ?? {}));
      const params = [
        id,
        input.knowledgeSpaceId,
        input.sourceId ?? null,
        input.filename,
        input.mimeType,
        input.objectKey,
        input.sha256,
        input.sizeBytes,
        metadata,
        "pending",
        1,
        createdAt,
      ] satisfies readonly DatabaseQueryValue[];
      const columns = [
        "id",
        "knowledge_space_id",
        "source_id",
        "filename",
        "mime_type",
        "object_key",
        "sha256",
        "size_bytes",
        "metadata",
        "parser_status",
        "version",
        "created_at",
      ];
      const result = await database.execute({
        maxRows: 1,
        operation: "insert",
        params,
        sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
          .map((column) => quoteDatabaseIdentifier(database, column))
          .join(", ")}) VALUES (${params
          .map((_, index) => jsonInsertPlaceholder(database, index + 1, columns[index]))
          .join(", ")})${database.dialect === "postgres" ? " RETURNING *" : ""};`,
        tableName,
      });

      if (result.rows[0]) {
        return mapDocumentAssetRow(result.rows[0]);
      }

      return DocumentAssetSchema.parse({
        ...input,
        createdAt,
        id,
        metadata: JSON.parse(metadata),
        parserStatus: "pending",
        version: 1,
      });
    },
    get: async (input) => databaseDocumentAssetGet(database, input),
    getForDeletion: async (input) => databaseDocumentAssetGetForDeletion(database, input),
    getStorageUsage: async ({ knowledgeSpaceId }) => {
      const documentAlias = "document_asset";
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [knowledgeSpaceId],
        sql: `SELECT COUNT(*) AS ${quoteDatabaseIdentifier(
          database,
          "document_count",
        )}, COALESCE(SUM(${documentAlias}.${quoteDatabaseIdentifier(
          database,
          "size_bytes",
        )}), 0) AS ${quoteDatabaseIdentifier(
          database,
          "raw_document_bytes",
        )} FROM ${quoteDatabaseIdentifier(database, tableName)} ${documentAlias} WHERE ${
          documentAlias
        }.${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
          database,
          1,
        )} AND ${documentAlias}.${quoteDatabaseIdentifier(
          database,
          "lifecycle_state",
        )} = 'active' AND ${readableDocumentParentSourcePredicateSql(
          database,
          documentAlias,
          "usage_parent_source",
        )};`,
        tableName,
      });
      const row = result.rows[0] ?? {};

      return {
        documentCount: Number(row.document_count ?? 0),
        rawDocumentBytes: Number(row.raw_document_bytes ?? 0),
      };
    },
    list: async ({ cursor, knowledgeSpaceId, limit }) => {
      validateDocumentAssetListLimit(limit);

      const documentAlias = "document_asset";
      const readLimit = limit + 1;
      const params = cursor
        ? [knowledgeSpaceId, cursor.id, readLimit]
        : [knowledgeSpaceId, readLimit];
      const cursorSql = cursor
        ? ` AND ${documentAlias}.${quoteDatabaseIdentifier(
            database,
            "id",
          )} > ${databasePlaceholder(database, 2)}`
        : "";
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT ${documentAlias}.* FROM ${quoteDatabaseIdentifier(
          database,
          tableName,
        )} ${documentAlias} WHERE ${documentAlias}.${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${documentAlias}.${quoteDatabaseIdentifier(
          database,
          "lifecycle_state",
        )} = 'active' AND ${readableDocumentParentSourcePredicateSql(
          database,
          documentAlias,
          "list_parent_source",
        )}${cursorSql} ORDER BY ${documentAlias}.${quoteDatabaseIdentifier(
          database,
          "id",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName,
      });
      const rows = result.rows.map(mapDocumentAssetRow);
      const items = rows.slice(0, limit).map(cloneDocumentAsset);
      const lastItem = items.at(-1);

      return {
        items,
        ...(rows.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
      };
    },
    listBySource: async ({ cursor, knowledgeSpaceId, limit, sourceId }) => {
      validateDocumentAssetListLimit(limit);

      const documentAlias = "document_asset";
      const readLimit = limit + 1;
      const params = cursor
        ? [knowledgeSpaceId, sourceId, cursor.id, readLimit]
        : [knowledgeSpaceId, sourceId, readLimit];
      const cursorSql = cursor
        ? ` AND ${documentAlias}.${quoteDatabaseIdentifier(
            database,
            "id",
          )} > ${databasePlaceholder(database, 3)}`
        : "";
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT ${documentAlias}.* FROM ${quoteDatabaseIdentifier(
          database,
          tableName,
        )} ${documentAlias} WHERE ${documentAlias}.${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${documentAlias}.${quoteDatabaseIdentifier(
          database,
          "source_id",
        )} = ${databasePlaceholder(database, 2)} AND ${documentAlias}.${quoteDatabaseIdentifier(
          database,
          "lifecycle_state",
        )} = 'active' AND ${readableDocumentParentSourcePredicateSql(
          database,
          documentAlias,
          "source_list_parent_source",
        )}${cursorSql} ORDER BY ${documentAlias}.${quoteDatabaseIdentifier(
          database,
          "id",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName,
      });
      const rows = result.rows.map(mapDocumentAssetRow);
      const items = rows.slice(0, limit).map(cloneDocumentAsset);
      const lastItem = items.at(-1);

      return {
        items,
        ...(rows.length > limit && lastItem ? { nextCursor: { id: lastItem.id } } : {}),
      };
    },
    updateParserStatus: async ({ id, knowledgeSpaceId, parserStatus }) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "update",
        params: [parserStatus, id, knowledgeSpaceId],
        sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(
          database,
          "parser_status",
        )} = ${databasePlaceholder(database, 1)} WHERE ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
          database,
          "lifecycle_state",
        )} = 'active' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL${
          database.dialect === "postgres" ? " RETURNING *" : ""
        };`,
        tableName,
      });

      if (result.rows[0]) {
        return mapDocumentAssetRow(result.rows[0]);
      }

      return result.rowsAffected > 0
        ? databaseDocumentAssetGet(database, { id, knowledgeSpaceId })
        : null;
    },
    rollbackStaleWrite: async (input) => {
      const existing = await databaseDocumentAssetGetForDeletion(database, input);

      if (
        !existing ||
        existing.objectKey !== input.expectedObjectKey ||
        existing.version !== input.expectedVersion
      ) {
        return null;
      }

      const result = await database.execute({
        maxRows: 1,
        operation: "delete",
        params: [input.id, input.knowledgeSpaceId, input.expectedVersion, input.expectedObjectKey],
        sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
          database,
          "object_key",
        )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
          database,
          "lifecycle_state",
        )} = 'active' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL;`,
        tableName,
      });

      return result.rowsAffected > 0 ? existing : null;
    },
  };
}

async function databaseDocumentAssetGet(
  database: DatabaseAdapter,
  input: DocumentAssetLookupInput,
): Promise<DocumentAsset | null> {
  const documentAlias = "document_asset";
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.id, input.knowledgeSpaceId],
    sql: `SELECT ${documentAlias}.* FROM ${quoteDatabaseIdentifier(
      database,
      "document_assets",
    )} ${documentAlias} WHERE ${documentAlias}.${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 1)} AND ${documentAlias}.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} AND ${documentAlias}.${quoteDatabaseIdentifier(
      database,
      "lifecycle_state",
    )} = 'active' AND ${readableDocumentParentSourcePredicateSql(
      database,
      documentAlias,
      "get_parent_source",
    )} LIMIT 1;`,
    tableName: "document_assets",
  });

  return result.rows[0] ? mapDocumentAssetRow(result.rows[0]) : null;
}

async function databaseDocumentAssetGetForDeletion(
  database: DatabaseAdapter,
  input: DocumentAssetLookupInput,
): Promise<DocumentAsset | null> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.id, input.knowledgeSpaceId],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "document_assets")} WHERE ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} LIMIT 1;`,
    tableName: "document_assets",
  });

  return result.rows[0] ? mapDocumentAssetRow(result.rows[0]) : null;
}

function mapDocumentAssetRow(row: DatabaseRow): DocumentAsset {
  const sourceId = optionalStringColumn(row, "source_id");

  return DocumentAssetSchema.parse({
    createdAt: stringColumn(row, "created_at"),
    filename: stringColumn(row, "filename"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    mimeType: stringColumn(row, "mime_type"),
    objectKey: stringColumn(row, "object_key"),
    parserStatus: stringColumn(row, "parser_status"),
    sha256: stringColumn(row, "sha256"),
    sizeBytes: numberColumn(row, "size_bytes"),
    ...(sourceId ? { sourceId } : {}),
    version: numberColumn(row, "version"),
  });
}

function cloneDocumentAsset(asset: DocumentAsset): DocumentAsset {
  return {
    ...asset,
    metadata: cloneJsonObject(asset.metadata),
  };
}

function validateDocumentAssetListLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Document asset list limit must be at least 1");
  }
}
