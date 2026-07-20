import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type DocumentOutline,
  DocumentOutlineSchema,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import {
  type PublishedGenerationReferenceGuard,
  assertDatabaseGenerationNotPublished,
  assertExactGenerationReplay,
  assertInMemoryGenerationNotPublished,
} from "./generation-immutability";
import { jsonArrayColumn, jsonObjectColumn } from "./json-utils";

export interface DocumentOutlineLookupInput {
  readonly documentAssetId: string;
  readonly publicationGenerationId?: string | undefined;
  readonly version: number;
}

export interface DocumentOutlineIdLookupInput {
  readonly id: string;
}

export interface DeleteDocumentOutlinesByDocumentAssetInput {
  readonly documentAssetId: string;
  readonly knowledgeSpaceId?: string | undefined;
  readonly maxOutlines: number;
}

export interface DocumentOutlineRepository {
  create(input: DocumentOutline): Promise<DocumentOutline>;
  deleteByDocumentAsset(input: DeleteDocumentOutlinesByDocumentAssetInput): Promise<number>;
  getByDocumentVersion(input: DocumentOutlineLookupInput): Promise<DocumentOutline | null>;
  getById(input: DocumentOutlineIdLookupInput): Promise<DocumentOutline | null>;
  upsert(input: DocumentOutline): Promise<DocumentOutline>;
}

export interface InMemoryDocumentOutlineRepositoryOptions {
  readonly maxOutlines: number;
  readonly publishedGenerationGuard?: PublishedGenerationReferenceGuard | undefined;
}

export class DocumentOutlineCapacityExceededError extends Error {
  constructor(maxOutlines: number) {
    super(`Document outline repository maxOutlines=${maxOutlines} exceeded`);
  }
}

export function createInMemoryDocumentOutlineRepository({
  maxOutlines,
  publishedGenerationGuard,
}: InMemoryDocumentOutlineRepositoryOptions): DocumentOutlineRepository {
  if (!Number.isInteger(maxOutlines) || maxOutlines < 1) {
    throw new Error("Document outline repository maxOutlines must be at least 1");
  }

  const outlines = new Map<string, DocumentOutline>();
  const write = async (input: DocumentOutline): Promise<DocumentOutline> => {
    const outline = cloneDocumentOutline(DocumentOutlineSchema.parse(input));
    const key = documentOutlineKey(
      outline.documentAssetId,
      outline.version,
      outline.publicationGenerationId,
    );
    const existing = outlines.get(key);
    if (existing && outline.publicationGenerationId) {
      assertExactGenerationReplay({
        componentType: "document-outline",
        incoming: outline,
        logicalKey: key,
        persisted: existing,
      });

      return cloneDocumentOutline(existing);
    }
    const stored = existing ? { ...outline, id: existing.id } : outline;

    if (!existing && outlines.size >= maxOutlines) {
      throw new DocumentOutlineCapacityExceededError(maxOutlines);
    }

    outlines.set(key, cloneDocumentOutline(stored));

    return cloneDocumentOutline(stored);
  };

  return {
    create: write,
    upsert: write,
    getByDocumentVersion: async ({ documentAssetId, publicationGenerationId, version }) => {
      const outline = outlines.get(
        documentOutlineKey(documentAssetId, version, publicationGenerationId),
      );

      return outline ? cloneDocumentOutline(outline) : null;
    },
    getById: async ({ id }) => {
      const outline = Array.from(outlines.values()).find((candidate) => candidate.id === id);

      return outline ? cloneDocumentOutline(outline) : null;
    },
    deleteByDocumentAsset: async ({ documentAssetId, knowledgeSpaceId, maxOutlines }) => {
      if (!Number.isInteger(maxOutlines) || maxOutlines < 1) {
        throw new Error("Document outline delete maxOutlines must be at least 1");
      }

      const keys = Array.from(outlines.values())
        .filter((outline) => outline.documentAssetId === documentAssetId)
        .filter((outline) =>
          knowledgeSpaceId ? outline.knowledgeSpaceId === knowledgeSpaceId : true,
        )
        .slice(0, maxOutlines + 1)
        .map((outline) =>
          documentOutlineKey(
            outline.documentAssetId,
            outline.version,
            outline.publicationGenerationId,
          ),
        );

      if (keys.length > maxOutlines) {
        throw new Error(`Document outline delete maxOutlines=${maxOutlines} exceeded`);
      }

      for (const outline of Array.from(outlines.values()).filter((candidate) =>
        keys.includes(
          documentOutlineKey(
            candidate.documentAssetId,
            candidate.version,
            candidate.publicationGenerationId,
          ),
        ),
      )) {
        if (outline.publicationGenerationId) {
          await assertInMemoryGenerationNotPublished({
            componentKey: outline.id,
            componentType: "document-outline",
            guard: publishedGenerationGuard,
            knowledgeSpaceId: outline.knowledgeSpaceId,
            publicationGenerationId: outline.publicationGenerationId,
          });
        }
      }

      for (const key of keys) {
        outlines.delete(key);
      }

      return keys.length;
    },
  };
}

export interface DatabaseDocumentOutlineRepositoryOptions {
  readonly database: DatabaseAdapter;
}

export function createDatabaseDocumentOutlineRepository({
  database,
}: DatabaseDocumentOutlineRepositoryOptions): DocumentOutlineRepository {
  const tableName = "document_outlines";

  const write = async (input: DocumentOutline): Promise<DocumentOutline> => {
    const outline = DocumentOutlineSchema.parse(input);
    return outline.publicationGenerationId
      ? database.transaction((transaction) =>
          writeDatabaseDocumentOutline({
            database,
            executor: transaction,
            immutable: true,
            outline,
            tableName,
          }),
        )
      : writeDatabaseDocumentOutline({
          database,
          executor: database,
          immutable: false,
          outline,
          tableName,
        });
  };

  return {
    create: write,
    deleteByDocumentAsset: async ({ documentAssetId, knowledgeSpaceId, maxOutlines }) => {
      if (!Number.isInteger(maxOutlines) || maxOutlines < 1) {
        throw new Error("Document outline delete maxOutlines must be at least 1");
      }

      return database.transaction(async (transaction) => {
        const params: DatabaseQueryValue[] = [documentAssetId];
        const knowledgeSpaceSql = knowledgeSpaceId
          ? (() => {
              params.push(knowledgeSpaceId);
              return ` AND ${quoteDatabaseIdentifier(
                database,
                "knowledge_space_id",
              )} = ${databasePlaceholder(database, params.length)}`;
            })()
          : "";
        const selected = await transaction.execute({
          maxRows: maxOutlines + 1,
          operation: "select",
          params,
          sql: `SELECT ${quoteDatabaseIdentifier(database, "id")}, ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )}, ${quoteDatabaseIdentifier(database, "publication_generation_id")} FROM ${quoteDatabaseIdentifier(
            database,
            tableName,
          )} WHERE ${quoteDatabaseIdentifier(database, "document_asset_id")} = ${databasePlaceholder(
            database,
            1,
          )}${knowledgeSpaceSql} LIMIT ${maxOutlines + 1} FOR UPDATE;`,
          tableName,
        });
        if (selected.rows.length > maxOutlines) {
          throw new Error(`Document outline delete maxOutlines=${maxOutlines} exceeded`);
        }

        for (const row of selected.rows) {
          const publicationGenerationId = optionalStringColumn(row, "publication_generation_id");
          if (publicationGenerationId) {
            await assertDatabaseGenerationNotPublished({
              componentType: "document-outline",
              database,
              executor: transaction,
              knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
              publicationGenerationId,
            });
          }
        }

        const ids = selected.rows.map((row) => stringColumn(row, "id"));
        if (ids.length === 0) {
          return 0;
        }
        const deleteParams = ids satisfies readonly DatabaseQueryValue[];
        const result = await transaction.execute({
          maxRows: ids.length,
          operation: "delete",
          params: deleteParams,
          sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "id",
          )} IN (${ids.map((_, index) => databasePlaceholder(database, index + 1)).join(", ")});`,
          tableName,
        });

        return result.rowsAffected;
      });
    },
    getByDocumentVersion: async ({ documentAssetId, publicationGenerationId, version }) =>
      getDatabaseDocumentOutlineByLogicalKey({
        database,
        documentAssetId,
        executor: database,
        publicationGenerationId,
        tableName,
        version,
      }),
    getById: async ({ id }) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [id],
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${databasePlaceholder(database, 1)} LIMIT 1;`,
        tableName,
      });

      return result.rows[0] ? mapDocumentOutlineRow(result.rows[0]) : null;
    },
    upsert: write,
  };
}

async function writeDatabaseDocumentOutline({
  database,
  executor,
  immutable,
  outline,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly immutable: boolean;
  readonly outline: DocumentOutline;
  readonly tableName: string;
}): Promise<DocumentOutline> {
  const columns = [
    "id",
    "knowledge_space_id",
    "publication_generation_id",
    "document_asset_id",
    "parse_artifact_id",
    "artifact_hash",
    "outline_version",
    "version",
    "nodes",
    "metadata",
    "created_at",
    "updated_at",
  ];
  const params = [
    outline.id,
    outline.knowledgeSpaceId,
    outline.publicationGenerationId ?? null,
    outline.documentAssetId,
    outline.parseArtifactId,
    outline.artifactHash,
    outline.outlineVersion,
    outline.version,
    JSON.stringify(outline.nodes),
    JSON.stringify(outline.metadata),
    outline.createdAt,
    outline.updatedAt ?? null,
  ] satisfies readonly DatabaseQueryValue[];
  const mutableColumns = columns.filter(
    (column) =>
      column !== "id" &&
      column !== "knowledge_space_id" &&
      column !== "document_asset_id" &&
      column !== "version" &&
      column !== "publication_generation_id",
  );
  const upsertClause = immutable
    ? database.dialect === "postgres"
      ? ` ON CONFLICT (${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )}, ${quoteDatabaseIdentifier(database, "version")}, (COALESCE(${quoteDatabaseIdentifier(
          database,
          "publication_generation_id",
        )}, '00000000-0000-0000-0000-000000000000'::uuid))) DO NOTHING RETURNING *`
      : ` ON DUPLICATE KEY UPDATE ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${quoteDatabaseIdentifier(database, "id")}`
    : database.dialect === "postgres"
      ? ` ON CONFLICT (${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )}, ${quoteDatabaseIdentifier(database, "version")}, (COALESCE(${quoteDatabaseIdentifier(
          database,
          "publication_generation_id",
        )}, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET ${mutableColumns
          .map(
            (column) =>
              `${quoteDatabaseIdentifier(database, column)} = EXCLUDED.${quoteDatabaseIdentifier(
                database,
                column,
              )}`,
          )
          .join(", ")} RETURNING *`
      : ` ON DUPLICATE KEY UPDATE ${mutableColumns
          .map(
            (column) =>
              `${quoteDatabaseIdentifier(database, column)} = VALUES(${quoteDatabaseIdentifier(
                database,
                column,
              )})`,
          )
          .join(", ")}`;
  const result = await executor.execute({
    maxRows: 1,
    operation: "insert",
    params,
    sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
      .map((column) => quoteDatabaseIdentifier(database, column))
      .join(", ")}) VALUES (${params
      .map((_, index) => jsonInsertPlaceholder(database, index + 1, columns[index]))
      .join(", ")})${upsertClause};`,
    tableName,
  });

  if (immutable || database.dialect === "tidb") {
    const persisted = await getDatabaseDocumentOutlineByLogicalKey({
      database,
      documentAssetId: outline.documentAssetId,
      executor,
      publicationGenerationId: outline.publicationGenerationId,
      tableName,
      version: outline.version,
    });

    if (!persisted) {
      throw new Error("Document outline upsert did not persist its logical row");
    }

    if (immutable) {
      assertExactGenerationReplay({
        componentType: "document-outline",
        incoming: outline,
        logicalKey: documentOutlineKey(
          outline.documentAssetId,
          outline.version,
          outline.publicationGenerationId,
        ),
        persisted,
      });
    }

    return persisted;
  }

  return result.rows[0] ? mapDocumentOutlineRow(result.rows[0]) : cloneDocumentOutline(outline);
}

async function getDatabaseDocumentOutlineByLogicalKey({
  database,
  documentAssetId,
  executor,
  publicationGenerationId,
  tableName,
  version,
}: {
  readonly database: DatabaseAdapter;
  readonly documentAssetId: string;
  readonly executor: DatabaseExecutor;
  readonly publicationGenerationId?: string | undefined;
  readonly tableName: string;
  readonly version: number;
}): Promise<DocumentOutline | null> {
  const params: DatabaseQueryValue[] = [documentAssetId, version];
  const generationSql = publicationGenerationId
    ? (() => {
        params.push(publicationGenerationId);
        return ` = ${databasePlaceholder(database, params.length)}`;
      })()
    : " IS NULL";
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
      database,
      "document_asset_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "version",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )}${generationSql} LIMIT 1;`,
    tableName,
  });

  return result.rows[0] ? mapDocumentOutlineRow(result.rows[0]) : null;
}

function mapDocumentOutlineRow(row: DatabaseRow): DocumentOutline {
  const updatedAt = optionalStringColumn(row, "updated_at");

  return DocumentOutlineSchema.parse({
    artifactHash: stringColumn(row, "artifact_hash"),
    createdAt: stringColumn(row, "created_at"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    nodes: jsonArrayColumn(row, "nodes"),
    outlineVersion: stringColumn(row, "outline_version"),
    parseArtifactId: stringColumn(row, "parse_artifact_id"),
    publicationGenerationId: optionalStringColumn(row, "publication_generation_id"),
    version: numberColumn(row, "version"),
    ...(updatedAt ? { updatedAt } : {}),
  });
}

export function cloneDocumentOutline(outline: DocumentOutline): DocumentOutline {
  return DocumentOutlineSchema.parse(JSON.parse(JSON.stringify(outline)) as unknown);
}

function documentOutlineKey(
  documentAssetId: string,
  version: number,
  publicationGenerationId?: string,
): string {
  return `${documentAssetId}:${version}:${publicationGenerationId ?? "legacy"}`;
}
