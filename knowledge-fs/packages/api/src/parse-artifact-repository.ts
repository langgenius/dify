import {
  type DatabaseAdapter,
  type DatabaseQueryValue,
  type DatabaseRow,
  type ParseArtifact,
  ParseArtifactSchema,
} from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonArrayColumn, jsonObjectColumn } from "./json-utils";

export interface ParseArtifactLookupInput {
  readonly documentAssetId: string;
  readonly version: number;
}

export interface ParseArtifactIdLookupInput {
  readonly id: string;
}

export interface ParseArtifactRepository {
  create(input: ParseArtifact): Promise<ParseArtifact>;
  deleteByDocumentAsset(input: DeleteParseArtifactsByDocumentAssetInput): Promise<number>;
  getById(input: ParseArtifactIdLookupInput): Promise<ParseArtifact | null>;
  getByDocumentVersion(input: ParseArtifactLookupInput): Promise<ParseArtifact | null>;
  pruneDocumentVersions(input: PruneParseArtifactVersionsInput): Promise<number>;
}

export interface DeleteParseArtifactsByDocumentAssetInput {
  readonly documentAssetId: string;
  readonly maxArtifacts: number;
}

export interface PruneParseArtifactVersionsInput {
  readonly documentAssetId: string;
  readonly keepVersions: number;
  readonly maxArtifacts: number;
}

export interface InMemoryParseArtifactRepositoryOptions {
  readonly maxArtifacts: number;
}

export interface DatabaseParseArtifactRepositoryOptions {
  readonly database: DatabaseAdapter;
}

export class ParseArtifactCapacityExceededError extends Error {
  constructor(maxArtifacts: number) {
    super(`Parse artifact repository maxArtifacts=${maxArtifacts} exceeded`);
  }
}

function parseArtifactKey(documentAssetId: string, version: number): string {
  return `${documentAssetId}:${version}`;
}

function validateParseArtifactPruneInput({
  documentAssetId,
  keepVersions,
  maxArtifacts,
}: PruneParseArtifactVersionsInput): void {
  if (!documentAssetId.trim()) {
    throw new Error("Parse artifact prune documentAssetId is required");
  }

  if (!Number.isInteger(keepVersions) || keepVersions < 1) {
    throw new Error("Parse artifact prune keepVersions must be at least 1");
  }

  if (!Number.isInteger(maxArtifacts) || maxArtifacts < 1) {
    throw new Error("Parse artifact prune maxArtifacts must be at least 1");
  }
}

function mapParseArtifactRow(row: DatabaseRow): ParseArtifact {
  return ParseArtifactSchema.parse({
    artifactHash: stringColumn(row, "artifact_hash"),
    contentType: stringColumn(row, "content_type"),
    createdAt: stringColumn(row, "created_at"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    elements: jsonArrayColumn(row, "elements"),
    id: stringColumn(row, "id"),
    metadata: jsonObjectColumn(row, "metadata"),
    parser: stringColumn(row, "parser"),
    version: numberColumn(row, "version"),
  });
}

export function cloneParseArtifact(artifact: ParseArtifact): ParseArtifact {
  return ParseArtifactSchema.parse(JSON.parse(JSON.stringify(artifact)) as unknown);
}

export function createInMemoryParseArtifactRepository({
  maxArtifacts,
}: InMemoryParseArtifactRepositoryOptions): ParseArtifactRepository {
  if (maxArtifacts < 1) {
    throw new Error("Parse artifact repository maxArtifacts must be at least 1");
  }

  const artifacts = new Map<string, ParseArtifact>();

  return {
    create: async (input) => {
      const artifact = cloneParseArtifact(ParseArtifactSchema.parse(input));
      const key = parseArtifactKey(artifact.documentAssetId, artifact.version);
      const existing = artifacts.get(key);

      if (!existing && artifacts.size >= maxArtifacts) {
        throw new ParseArtifactCapacityExceededError(maxArtifacts);
      }

      const stored = existing
        ? cloneParseArtifact({ ...artifact, createdAt: existing.createdAt, id: existing.id })
        : artifact;
      artifacts.set(key, stored);

      return cloneParseArtifact(stored);
    },
    getByDocumentVersion: async ({ documentAssetId, version }) => {
      const artifact = artifacts.get(parseArtifactKey(documentAssetId, version));

      return artifact ? cloneParseArtifact(artifact) : null;
    },
    getById: async ({ id }) => {
      const artifact = Array.from(artifacts.values()).find((candidate) => candidate.id === id);

      return artifact ? cloneParseArtifact(artifact) : null;
    },
    deleteByDocumentAsset: async ({ documentAssetId, maxArtifacts }) => {
      if (!Number.isInteger(maxArtifacts) || maxArtifacts < 1) {
        throw new Error("Parse artifact delete maxArtifacts must be at least 1");
      }

      const keys = Array.from(artifacts.values())
        .filter((artifact) => artifact.documentAssetId === documentAssetId)
        .slice(0, maxArtifacts + 1)
        .map((artifact) => parseArtifactKey(artifact.documentAssetId, artifact.version));

      if (keys.length > maxArtifacts) {
        throw new Error(`Parse artifact delete maxArtifacts=${maxArtifacts} exceeded`);
      }

      for (const key of keys) {
        artifacts.delete(key);
      }

      return keys.length;
    },
    pruneDocumentVersions: async ({ documentAssetId, keepVersions, maxArtifacts }) => {
      validateParseArtifactPruneInput({ documentAssetId, keepVersions, maxArtifacts });
      const selected = Array.from(artifacts.values())
        .filter((artifact) => artifact.documentAssetId === documentAssetId)
        .sort((left, right) => right.version - left.version)
        .slice(keepVersions, keepVersions + maxArtifacts + 1);

      if (selected.length > maxArtifacts) {
        throw new Error(`Parse artifact prune maxArtifacts=${maxArtifacts} exceeded`);
      }

      for (const artifact of selected) {
        artifacts.delete(parseArtifactKey(artifact.documentAssetId, artifact.version));
      }

      return selected.length;
    },
  };
}

export function createDatabaseParseArtifactRepository({
  database,
}: DatabaseParseArtifactRepositoryOptions): ParseArtifactRepository {
  const tableName = "parse_artifacts";

  return {
    create: async (input) => {
      const artifact = ParseArtifactSchema.parse(input);
      const elements = JSON.stringify(artifact.elements);
      const metadata = JSON.stringify(artifact.metadata);
      const params = [
        artifact.id,
        artifact.documentAssetId,
        artifact.version,
        artifact.parser,
        artifact.contentType,
        artifact.artifactHash,
        elements,
        metadata,
        artifact.createdAt,
      ] satisfies readonly DatabaseQueryValue[];
      const columns = [
        "id",
        "document_asset_id",
        "version",
        "parser",
        "content_type",
        "artifact_hash",
        "elements",
        "metadata",
        "created_at",
      ];
      const mutableColumns = columns.filter(
        (column) =>
          column !== "id" &&
          column !== "document_asset_id" &&
          column !== "version" &&
          column !== "created_at",
      );
      const upsertClause =
        database.dialect === "postgres"
          ? ` ON CONFLICT (${quoteDatabaseIdentifier(
              database,
              "document_asset_id",
            )}, ${quoteDatabaseIdentifier(database, "version")}) DO UPDATE SET ${mutableColumns
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
      const result = await database.execute({
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

      if (result.rows[0]) {
        return mapParseArtifactRow(result.rows[0]);
      }

      const stored = await database.execute({
        maxRows: 2,
        operation: "select",
        params: [artifact.documentAssetId, artifact.version],
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(
          database,
          tableName,
        )} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} = ${databasePlaceholder(database, 2)} LIMIT 2;`,
        tableName,
      });

      const [row, duplicate] = stored.rows;
      if (!row) {
        throw new Error("Parse artifact upsert did not persist its logical row");
      }
      if (duplicate) {
        throw new Error("Parse artifact upsert resolved multiple persisted logical rows");
      }

      const persisted = mapParseArtifactRow(row);
      if (
        persisted.documentAssetId !== artifact.documentAssetId ||
        persisted.version !== artifact.version
      ) {
        throw new Error("Parse artifact upsert resolved a mismatched persisted logical row");
      }

      return persisted;
    },
    getByDocumentVersion: async ({ documentAssetId, version }) => {
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [documentAssetId, version],
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} = ${databasePlaceholder(database, 2)} LIMIT 1;`,
        tableName,
      });

      return result.rows[0] ? mapParseArtifactRow(result.rows[0]) : null;
    },
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

      return result.rows[0] ? mapParseArtifactRow(result.rows[0]) : null;
    },
    deleteByDocumentAsset: async ({ documentAssetId, maxArtifacts }) => {
      if (!Number.isInteger(maxArtifacts) || maxArtifacts < 1) {
        throw new Error("Parse artifact delete maxArtifacts must be at least 1");
      }

      const result = await database.execute({
        maxRows: maxArtifacts,
        operation: "delete",
        params: [documentAssetId],
        sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)};`,
        tableName,
      });

      return result.rowsAffected;
    },
    pruneDocumentVersions: async ({ documentAssetId, keepVersions, maxArtifacts }) => {
      validateParseArtifactPruneInput({ documentAssetId, keepVersions, maxArtifacts });
      const result = await database.execute({
        maxRows: maxArtifacts,
        operation: "delete",
        params: [documentAssetId, keepVersions],
        sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} NOT IN (SELECT ${quoteDatabaseIdentifier(database, "version")} FROM (SELECT ${quoteDatabaseIdentifier(
          database,
          "version",
        )} FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "document_asset_id",
        )} = ${databasePlaceholder(database, 1)} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "version",
        )} DESC LIMIT ${databasePlaceholder(database, 2)}) AS retained_parse_artifact_versions);`,
        tableName,
      });

      return result.rowsAffected;
    },
  };
}
