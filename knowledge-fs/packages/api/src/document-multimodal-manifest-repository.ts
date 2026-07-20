import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type DocumentMultimodalManifest,
  DocumentMultimodalManifestSchema,
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

export interface DocumentMultimodalManifestLookupInput {
  readonly documentAssetId: string;
  readonly publicationGenerationId?: string | undefined;
  readonly version: number;
}

export interface DocumentMultimodalManifestIdLookupInput {
  readonly id: string;
}

export interface DeleteDocumentMultimodalManifestsByDocumentAssetInput {
  readonly documentAssetId: string;
  readonly knowledgeSpaceId?: string | undefined;
  readonly maxManifests: number;
}

export interface ListDocumentMultimodalManifestsByDocumentAssetInput {
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly maxManifests: number;
}

export interface DocumentMultimodalManifestRepository {
  deleteByDocumentAsset(
    input: DeleteDocumentMultimodalManifestsByDocumentAssetInput,
  ): Promise<number>;
  getByDocumentVersion(
    input: DocumentMultimodalManifestLookupInput,
  ): Promise<DocumentMultimodalManifest | null>;
  getById(
    input: DocumentMultimodalManifestIdLookupInput,
  ): Promise<DocumentMultimodalManifest | null>;
  listByDocumentAsset(
    input: ListDocumentMultimodalManifestsByDocumentAssetInput,
  ): Promise<readonly DocumentMultimodalManifest[]>;
  upsert(input: DocumentMultimodalManifest): Promise<DocumentMultimodalManifest>;
}

export interface InMemoryDocumentMultimodalManifestRepositoryOptions {
  readonly maxManifests: number;
  readonly publishedGenerationGuard?: PublishedGenerationReferenceGuard | undefined;
}

export interface DatabaseDocumentMultimodalManifestRepositoryOptions {
  readonly database: DatabaseAdapter;
}

export class DocumentMultimodalManifestCapacityExceededError extends Error {
  constructor(maxManifests: number) {
    super(`Document multimodal manifest repository maxManifests=${maxManifests} exceeded`);
  }
}

export function createInMemoryDocumentMultimodalManifestRepository({
  maxManifests,
  publishedGenerationGuard,
}: InMemoryDocumentMultimodalManifestRepositoryOptions): DocumentMultimodalManifestRepository {
  if (!Number.isInteger(maxManifests) || maxManifests < 1) {
    throw new Error("Document multimodal manifest repository maxManifests must be at least 1");
  }

  const manifests = new Map<string, DocumentMultimodalManifest>();

  return {
    upsert: async (input) => {
      const manifest = cloneDocumentMultimodalManifest(
        DocumentMultimodalManifestSchema.parse(input),
      );
      const key = documentMultimodalManifestKey(
        manifest.documentAssetId,
        manifest.version,
        manifest.publicationGenerationId,
      );
      const existing = manifests.get(key);
      if (existing && manifest.publicationGenerationId) {
        assertExactGenerationReplay({
          componentType: "multimodal-manifest",
          incoming: manifest,
          logicalKey: key,
          persisted: existing,
        });

        return cloneDocumentMultimodalManifest(existing);
      }
      const stored = existing ? { ...manifest, id: existing.id } : manifest;

      if (!existing && manifests.size >= maxManifests) {
        throw new DocumentMultimodalManifestCapacityExceededError(maxManifests);
      }

      manifests.set(key, cloneDocumentMultimodalManifest(stored));

      return cloneDocumentMultimodalManifest(stored);
    },
    getByDocumentVersion: async ({ documentAssetId, publicationGenerationId, version }) => {
      const manifest = manifests.get(
        documentMultimodalManifestKey(documentAssetId, version, publicationGenerationId),
      );

      return manifest ? cloneDocumentMultimodalManifest(manifest) : null;
    },
    getById: async ({ id }) => {
      const manifest = Array.from(manifests.values()).find((candidate) => candidate.id === id);

      return manifest ? cloneDocumentMultimodalManifest(manifest) : null;
    },
    deleteByDocumentAsset: async ({ documentAssetId, knowledgeSpaceId, maxManifests }) => {
      if (!Number.isInteger(maxManifests) || maxManifests < 1) {
        throw new Error("Document multimodal manifest delete maxManifests must be at least 1");
      }

      const keys = Array.from(manifests.values())
        .filter((manifest) => manifest.documentAssetId === documentAssetId)
        .filter((manifest) =>
          knowledgeSpaceId ? manifest.knowledgeSpaceId === knowledgeSpaceId : true,
        )
        .slice(0, maxManifests + 1)
        .map((manifest) =>
          documentMultimodalManifestKey(
            manifest.documentAssetId,
            manifest.version,
            manifest.publicationGenerationId,
          ),
        );

      if (keys.length > maxManifests) {
        throw new Error(
          `Document multimodal manifest delete maxManifests=${maxManifests} exceeded`,
        );
      }

      for (const manifest of Array.from(manifests.values()).filter((candidate) =>
        keys.includes(
          documentMultimodalManifestKey(
            candidate.documentAssetId,
            candidate.version,
            candidate.publicationGenerationId,
          ),
        ),
      )) {
        if (manifest.publicationGenerationId) {
          await assertInMemoryGenerationNotPublished({
            componentKey: manifest.id,
            componentType: "multimodal-manifest",
            guard: publishedGenerationGuard,
            knowledgeSpaceId: manifest.knowledgeSpaceId,
            publicationGenerationId: manifest.publicationGenerationId,
          });
        }
      }

      for (const key of keys) {
        manifests.delete(key);
      }

      return keys.length;
    },
    listByDocumentAsset: async (input) => {
      validateDocumentMultimodalManifestList(input);
      const selected = Array.from(manifests.values())
        .filter((manifest) => manifest.knowledgeSpaceId === input.knowledgeSpaceId)
        .filter((manifest) => manifest.documentAssetId === input.documentAssetId)
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, input.maxManifests + 1);
      if (selected.length > input.maxManifests) {
        throw new Error(
          `Document multimodal manifest list maxManifests=${input.maxManifests} exceeded`,
        );
      }

      return selected.map(cloneDocumentMultimodalManifest);
    },
  };
}

export function createDatabaseDocumentMultimodalManifestRepository({
  database,
}: DatabaseDocumentMultimodalManifestRepositoryOptions): DocumentMultimodalManifestRepository {
  const tableName = "document_multimodal_manifests";

  return {
    upsert: async (input) => {
      const manifest = DocumentMultimodalManifestSchema.parse(input);
      return manifest.publicationGenerationId
        ? database.transaction((transaction) =>
            writeDatabaseDocumentMultimodalManifest({
              database,
              executor: transaction,
              immutable: true,
              manifest,
              tableName,
            }),
          )
        : writeDatabaseDocumentMultimodalManifest({
            database,
            executor: database,
            immutable: false,
            manifest,
            tableName,
          });
    },
    getByDocumentVersion: async ({ documentAssetId, publicationGenerationId, version }) =>
      getDatabaseDocumentMultimodalManifestByLogicalKey({
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

      return result.rows[0] ? mapDocumentMultimodalManifestRow(result.rows[0]) : null;
    },
    listByDocumentAsset: async (input) => {
      validateDocumentMultimodalManifestList(input);
      const result = await database.execute({
        maxRows: input.maxManifests + 1,
        operation: "select",
        params: [input.knowledgeSpaceId, input.documentAssetId],
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(
          database,
          tableName,
        )} WHERE ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
          database,
          1,
        )} AND ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 2)} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "id",
        )} ASC LIMIT ${input.maxManifests + 1};`,
        tableName,
      });
      if (result.rows.length > input.maxManifests) {
        throw new Error(
          `Document multimodal manifest list maxManifests=${input.maxManifests} exceeded`,
        );
      }

      return result.rows.map(mapDocumentMultimodalManifestRow);
    },
    deleteByDocumentAsset: async ({ documentAssetId, knowledgeSpaceId, maxManifests }) => {
      if (!Number.isInteger(maxManifests) || maxManifests < 1) {
        throw new Error("Document multimodal manifest delete maxManifests must be at least 1");
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
          maxRows: maxManifests + 1,
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
          )}${knowledgeSpaceSql} LIMIT ${maxManifests + 1} FOR UPDATE;`,
          tableName,
        });
        if (selected.rows.length > maxManifests) {
          throw new Error(
            `Document multimodal manifest delete maxManifests=${maxManifests} exceeded`,
          );
        }

        for (const row of selected.rows) {
          const publicationGenerationId = optionalStringColumn(row, "publication_generation_id");
          if (publicationGenerationId) {
            await assertDatabaseGenerationNotPublished({
              componentType: "multimodal-manifest",
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
        const result = await transaction.execute({
          maxRows: ids.length,
          operation: "delete",
          params: ids,
          sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "id",
          )} IN (${ids.map((_, index) => databasePlaceholder(database, index + 1)).join(", ")});`,
          tableName,
        });

        return result.rowsAffected;
      });
    },
  };
}

function validateDocumentMultimodalManifestList(
  input: ListDocumentMultimodalManifestsByDocumentAssetInput,
): void {
  if (!input.knowledgeSpaceId.trim() || !input.documentAssetId.trim()) {
    throw new Error("Document multimodal manifest list document scope is required");
  }
  if (!Number.isInteger(input.maxManifests) || input.maxManifests < 1) {
    throw new Error("Document multimodal manifest list maxManifests must be at least 1");
  }
}

async function writeDatabaseDocumentMultimodalManifest({
  database,
  executor,
  immutable,
  manifest,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly immutable: boolean;
  readonly manifest: DocumentMultimodalManifest;
  readonly tableName: string;
}): Promise<DocumentMultimodalManifest> {
  const params = [
    manifest.id,
    manifest.knowledgeSpaceId,
    manifest.publicationGenerationId ?? null,
    manifest.documentAssetId,
    manifest.parseArtifactId,
    manifest.version,
    manifest.artifactHash,
    manifest.manifestVersion,
    JSON.stringify(manifest.items),
    JSON.stringify(manifest.metadata),
    manifest.createdAt,
    manifest.updatedAt ?? null,
  ] satisfies readonly DatabaseQueryValue[];
  const columns = [
    "id",
    "knowledge_space_id",
    "publication_generation_id",
    "document_asset_id",
    "parse_artifact_id",
    "version",
    "artifact_hash",
    "manifest_version",
    "items",
    "metadata",
    "created_at",
    "updated_at",
  ];
  const mutableColumns = columns.filter(
    (column) =>
      column !== "id" &&
      column !== "knowledge_space_id" &&
      column !== "document_asset_id" &&
      column !== "version" &&
      column !== "publication_generation_id",
  );
  const conflictTarget = `(${quoteDatabaseIdentifier(
    database,
    "document_asset_id",
  )}, ${quoteDatabaseIdentifier(database, "version")}, (COALESCE(${quoteDatabaseIdentifier(
    database,
    "publication_generation_id",
  )}, '00000000-0000-0000-0000-000000000000'::uuid)))`;
  const upsertClause = immutable
    ? database.dialect === "postgres"
      ? ` ON CONFLICT ${conflictTarget} DO NOTHING RETURNING *`
      : ` ON DUPLICATE KEY UPDATE ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${quoteDatabaseIdentifier(database, "id")}`
    : database.dialect === "postgres"
      ? ` ON CONFLICT ${conflictTarget} DO UPDATE SET ${mutableColumns
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
    const persisted = await getDatabaseDocumentMultimodalManifestByLogicalKey({
      database,
      documentAssetId: manifest.documentAssetId,
      executor,
      publicationGenerationId: manifest.publicationGenerationId,
      tableName,
      version: manifest.version,
    });

    if (!persisted) {
      throw new Error("Document multimodal manifest upsert did not persist its logical row");
    }
    if (immutable) {
      assertExactGenerationReplay({
        componentType: "multimodal-manifest",
        incoming: manifest,
        logicalKey: documentMultimodalManifestKey(
          manifest.documentAssetId,
          manifest.version,
          manifest.publicationGenerationId,
        ),
        persisted,
      });
    }

    return persisted;
  }

  return result.rows[0]
    ? mapDocumentMultimodalManifestRow(result.rows[0])
    : cloneDocumentMultimodalManifest(manifest);
}

async function getDatabaseDocumentMultimodalManifestByLogicalKey({
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
}): Promise<DocumentMultimodalManifest | null> {
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

  return result.rows[0] ? mapDocumentMultimodalManifestRow(result.rows[0]) : null;
}

export function cloneDocumentMultimodalManifest(
  manifest: DocumentMultimodalManifest,
): DocumentMultimodalManifest {
  return DocumentMultimodalManifestSchema.parse(JSON.parse(JSON.stringify(manifest)) as unknown);
}

function mapDocumentMultimodalManifestRow(row: DatabaseRow): DocumentMultimodalManifest {
  return DocumentMultimodalManifestSchema.parse({
    artifactHash: stringColumn(row, "artifact_hash"),
    createdAt: stringColumn(row, "created_at"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    id: stringColumn(row, "id"),
    items: jsonArrayColumn(row, "items"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    manifestVersion: stringColumn(row, "manifest_version"),
    metadata: jsonObjectColumn(row, "metadata"),
    parseArtifactId: stringColumn(row, "parse_artifact_id"),
    publicationGenerationId: optionalStringColumn(row, "publication_generation_id"),
    updatedAt: optionalStringColumn(row, "updated_at"),
    version: numberColumn(row, "version"),
  });
}

function documentMultimodalManifestKey(
  documentAssetId: string,
  version: number,
  publicationGenerationId?: string,
): string {
  return `${documentAssetId}:${version}:${publicationGenerationId ?? "legacy"}`;
}
