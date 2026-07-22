import {
  type ArtifactSegment,
  ArtifactSegmentSchema,
  type DatabaseAdapter,
  type DatabaseQueryValue,
  type DatabaseRow,
} from "@knowledge/core";

import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";

export interface CreateArtifactSegmentsInput {
  readonly segments: readonly ArtifactSegment[];
}

export interface ListArtifactSegmentsByArtifactInput {
  readonly cursor?: number | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly parseArtifactId: string;
}

export interface ListArtifactSegmentsByChecksumInput {
  readonly checksum: string;
  readonly cursor?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
}

export interface ListArtifactSegmentsByDocumentAssetInput {
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly maxSegments: number;
}

export interface DeleteArtifactSegmentsByDocumentAssetInput
  extends ListArtifactSegmentsByDocumentAssetInput {}

export interface ListArtifactSegmentsResult {
  readonly items: ArtifactSegment[];
  readonly nextCursor?: number;
}

export interface ListArtifactSegmentsByChecksumResult {
  readonly items: ArtifactSegment[];
  readonly nextCursor?: string;
}

export interface ArtifactSegmentRepository {
  createMany(input: CreateArtifactSegmentsInput): Promise<ArtifactSegment[]>;
  deleteByDocumentAsset(input: DeleteArtifactSegmentsByDocumentAssetInput): Promise<number>;
  listByArtifact(input: ListArtifactSegmentsByArtifactInput): Promise<ListArtifactSegmentsResult>;
  listByChecksum(
    input: ListArtifactSegmentsByChecksumInput,
  ): Promise<ListArtifactSegmentsByChecksumResult>;
  listByDocumentAsset(
    input: ListArtifactSegmentsByDocumentAssetInput,
  ): Promise<readonly ArtifactSegment[]>;
}

export interface InMemoryArtifactSegmentRepositoryOptions {
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
  readonly maxSegments: number;
}

export interface DatabaseArtifactSegmentRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
}

export class ArtifactSegmentBatchSizeExceededError extends Error {
  constructor(maxBatchSize: number) {
    super(`Artifact segment batch size exceeds maxBatchSize=${maxBatchSize}`);
  }
}

export class ArtifactSegmentCapacityExceededError extends Error {
  constructor(maxSegments: number) {
    super(`Artifact segment repository maxSegments=${maxSegments} exceeded`);
  }
}

export class ArtifactSegmentListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`Artifact segment list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

export class DuplicateArtifactSegmentError extends Error {
  constructor(parseArtifactId: string, segmentIndex: number) {
    super(`Artifact segment already exists for artifact=${parseArtifactId} index=${segmentIndex}`);
  }
}

export function createInMemoryArtifactSegmentRepository({
  maxBatchSize,
  maxListLimit,
  maxSegments,
}: InMemoryArtifactSegmentRepositoryOptions): ArtifactSegmentRepository {
  validateRepositoryBounds({ maxBatchSize, maxListLimit, maxSegments });

  const segmentsById = new Map<string, ArtifactSegment>();
  const artifactIndex = new Map<string, string>();

  return {
    createMany: async ({ segments }) => {
      if (segments.length > maxBatchSize) {
        throw new ArtifactSegmentBatchSizeExceededError(maxBatchSize);
      }

      const parsed = segments.map((segment) => cloneSegment(ArtifactSegmentSchema.parse(segment)));
      const nextSegmentsById = new Map(segmentsById);
      const nextArtifactIndex = new Map(artifactIndex);

      for (const segment of parsed) {
        const key = scopedArtifactIndexKey(segment);
        const existingId = nextArtifactIndex.get(key);

        if (existingId && existingId !== segment.id) {
          nextSegmentsById.delete(existingId);
        }
        const existingById = nextSegmentsById.get(segment.id);
        if (existingById) {
          nextArtifactIndex.delete(scopedArtifactIndexKey(existingById));
        }
        nextSegmentsById.set(segment.id, cloneSegment(segment));
        nextArtifactIndex.set(key, segment.id);
      }

      if (nextSegmentsById.size > maxSegments) {
        throw new ArtifactSegmentCapacityExceededError(maxSegments);
      }

      segmentsById.clear();
      artifactIndex.clear();
      for (const [id, segment] of nextSegmentsById) {
        segmentsById.set(id, segment);
      }
      for (const [key, id] of nextArtifactIndex) {
        artifactIndex.set(key, id);
      }

      return parsed.map(cloneSegment);
    },
    deleteByDocumentAsset: async (input) => {
      const selected = selectInMemorySegmentsByDocumentAsset(segmentsById.values(), input);

      for (const segment of selected) {
        segmentsById.delete(segment.id);
        artifactIndex.delete(scopedArtifactIndexKey(segment));
      }

      return selected.length;
    },
    listByArtifact: async ({ cursor, knowledgeSpaceId, limit, parseArtifactId }) => {
      validateListLimit(limit, maxListLimit);

      const page = Array.from(segmentsById.values())
        .filter((segment) => segment.knowledgeSpaceId === knowledgeSpaceId)
        .filter((segment) => segment.parseArtifactId === parseArtifactId)
        .filter((segment) => (cursor === undefined ? true : segment.segmentIndex > cursor))
        .sort(
          (left, right) =>
            left.segmentIndex - right.segmentIndex || left.id.localeCompare(right.id),
        )
        .slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneSegment);
      const nextCursor = page.length > limit ? items.at(-1)?.segmentIndex : undefined;

      return {
        items,
        ...(nextCursor !== undefined ? { nextCursor } : {}),
      };
    },
    listByChecksum: async ({ checksum, cursor, knowledgeSpaceId, limit }) => {
      validateListLimit(limit, maxListLimit);

      const page = Array.from(segmentsById.values())
        .filter((segment) => segment.knowledgeSpaceId === knowledgeSpaceId)
        .filter((segment) => segment.checksum === checksum)
        .filter((segment) => (cursor ? segment.id > cursor : true))
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneSegment);
      const nextCursor = page.length > limit ? items.at(-1)?.id : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    listByDocumentAsset: async (input) =>
      selectInMemorySegmentsByDocumentAsset(segmentsById.values(), input).map(cloneSegment),
  };
}

export function createDatabaseArtifactSegmentRepository({
  database,
  maxBatchSize,
  maxListLimit,
}: DatabaseArtifactSegmentRepositoryOptions): ArtifactSegmentRepository {
  validateCommonRepositoryBounds({ maxBatchSize, maxListLimit });
  const tableName = "artifact_segments";

  return {
    createMany: async ({ segments }) => {
      if (segments.length > maxBatchSize) {
        throw new ArtifactSegmentBatchSizeExceededError(maxBatchSize);
      }
      if (segments.length === 0) {
        return [];
      }

      const parsed = segments.map((segment) => ArtifactSegmentSchema.parse(segment));
      const columns = [
        "id",
        "knowledge_space_id",
        "document_asset_id",
        "parse_artifact_id",
        "segment_index",
        "segment_type",
        "artifact_hash",
        "checksum",
        "object_key",
        "inline_text",
        "content_encoding",
        "size_bytes",
        "start_offset",
        "end_offset",
        "source_location",
        "metadata",
        "created_at",
        "updated_at",
      ] as const;
      const params = parsed.flatMap((segment) => [
        segment.id,
        segment.knowledgeSpaceId,
        segment.documentAssetId,
        segment.parseArtifactId,
        segment.segmentIndex,
        segment.segmentType,
        segment.artifactHash,
        segment.checksum,
        segment.objectKey ?? null,
        segment.inlineText ?? null,
        segment.contentEncoding,
        segment.sizeBytes ?? null,
        segment.startOffset ?? null,
        segment.endOffset ?? null,
        JSON.stringify(segment.sourceLocation),
        JSON.stringify(segment.metadata),
        segment.createdAt,
        segment.updatedAt ?? null,
      ]) satisfies readonly DatabaseQueryValue[];
      const values = parsed
        .map((_, rowIndex) => {
          const offset = rowIndex * columns.length;

          return `(${columns
            .map((column, columnIndex) =>
              jsonInsertPlaceholder(database, offset + columnIndex + 1, column),
            )
            .join(", ")})`;
        })
        .join(", ");
      const mutableColumns = columns.filter(
        (column) => column !== "parse_artifact_id" && column !== "segment_index",
      );
      const upsertClause =
        database.dialect === "postgres"
          ? ` ON CONFLICT (${quoteDatabaseIdentifier(database, "parse_artifact_id")}, ${quoteDatabaseIdentifier(
              database,
              "segment_index",
            )}) DO UPDATE SET ${mutableColumns
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
        maxRows: parsed.length,
        operation: "insert",
        params,
        sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
          .map((column) => quoteDatabaseIdentifier(database, column))
          .join(", ")}) VALUES ${values}${upsertClause};`,
        tableName,
      });

      return result.rows.length > 0
        ? result.rows.map(mapArtifactSegmentRow)
        : parsed.map(cloneSegment);
    },
    deleteByDocumentAsset: async (input) => {
      validateDocumentAssetBound(input, "delete");

      return database.transaction(async (transaction) => {
        const selected = await transaction.execute({
          maxRows: input.maxSegments + 1,
          operation: "select",
          params: [input.knowledgeSpaceId, input.documentAssetId],
          sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
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
          )} ASC LIMIT ${input.maxSegments + 1} FOR UPDATE;`,
          tableName,
        });
        if (selected.rows.length > input.maxSegments) {
          throw new Error(
            `Artifact segment delete maxSegments=${input.maxSegments} exceeded for document asset`,
          );
        }
        const ids = selected.rows.map((row) => stringColumn(row, "id"));
        if (ids.length === 0) {
          return 0;
        }
        const params = [input.knowledgeSpaceId, input.documentAssetId, ...ids];
        const deleted = await transaction.execute({
          maxRows: ids.length,
          operation: "delete",
          params,
          sql: `DELETE FROM ${quoteDatabaseIdentifier(
            database,
            tableName,
          )} WHERE ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
            database,
            1,
          )} AND ${quoteDatabaseIdentifier(
            database,
            "document_asset_id",
          )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
            database,
            "id",
          )} IN (${ids.map((_, index) => databasePlaceholder(database, index + 3)).join(", ")});`,
          tableName,
        });

        return deleted.rowsAffected;
      });
    },
    listByArtifact: async ({ cursor, knowledgeSpaceId, limit, parseArtifactId }) => {
      validateListLimit(limit, maxListLimit);
      const params: DatabaseQueryValue[] = [knowledgeSpaceId, parseArtifactId];
      const cursorSql =
        cursor === undefined
          ? ""
          : (() => {
              params.push(cursor);

              return ` AND ${quoteDatabaseIdentifier(database, "segment_index")} > ${databasePlaceholder(
                database,
                params.length,
              )}`;
            })();
      params.push(limit + 1);
      const result = await database.execute({
        maxRows: limit + 1,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "parse_artifact_id",
        )} = ${databasePlaceholder(database, 2)}${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "segment_index",
        )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(
          database,
          params.length,
        )};`,
        tableName,
      });
      const page = result.rows.map(mapArtifactSegmentRow);
      const items = page.slice(0, limit);
      const nextCursor = page.length > limit ? items.at(-1)?.segmentIndex : undefined;

      return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
    },
    listByChecksum: async ({ checksum, cursor, knowledgeSpaceId, limit }) => {
      validateListLimit(limit, maxListLimit);
      const params: DatabaseQueryValue[] = [knowledgeSpaceId, checksum];
      const cursorSql = cursor
        ? (() => {
            params.push(cursor);

            return ` AND ${quoteDatabaseIdentifier(database, "id")} > ${databasePlaceholder(
              database,
              params.length,
            )}`;
          })()
        : "";
      params.push(limit + 1);
      const result = await database.execute({
        maxRows: limit + 1,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "checksum",
        )} = ${databasePlaceholder(database, 2)}${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "id",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName,
      });
      const page = result.rows.map(mapArtifactSegmentRow);
      const items = page.slice(0, limit);
      const nextCursor = page.length > limit ? items.at(-1)?.id : undefined;

      return { items, ...(nextCursor ? { nextCursor } : {}) };
    },
    listByDocumentAsset: async (input) => {
      validateDocumentAssetBound(input, "list");
      const result = await database.execute({
        maxRows: input.maxSegments + 1,
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
        )} ASC LIMIT ${input.maxSegments + 1};`,
        tableName,
      });
      if (result.rows.length > input.maxSegments) {
        throw new Error(
          `Artifact segment list maxSegments=${input.maxSegments} exceeded for document asset`,
        );
      }

      return result.rows.map(mapArtifactSegmentRow);
    },
  };
}

function selectInMemorySegmentsByDocumentAsset(
  segments: Iterable<ArtifactSegment>,
  input: ListArtifactSegmentsByDocumentAssetInput,
): ArtifactSegment[] {
  validateDocumentAssetBound(input, "list");
  const selected = Array.from(segments)
    .filter((segment) => segment.knowledgeSpaceId === input.knowledgeSpaceId)
    .filter((segment) => segment.documentAssetId === input.documentAssetId)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, input.maxSegments + 1);
  if (selected.length > input.maxSegments) {
    throw new Error(
      `Artifact segment list maxSegments=${input.maxSegments} exceeded for document asset`,
    );
  }

  return selected;
}

function validateDocumentAssetBound(
  input: ListArtifactSegmentsByDocumentAssetInput,
  operation: "delete" | "list",
): void {
  if (!input.knowledgeSpaceId.trim() || !input.documentAssetId.trim()) {
    throw new Error(`Artifact segment ${operation} document scope is required`);
  }
  if (!Number.isInteger(input.maxSegments) || input.maxSegments < 1) {
    throw new Error(`Artifact segment ${operation} maxSegments must be at least 1`);
  }
}

function mapArtifactSegmentRow(row: DatabaseRow): ArtifactSegment {
  return ArtifactSegmentSchema.parse({
    artifactHash: stringColumn(row, "artifact_hash"),
    checksum: stringColumn(row, "checksum"),
    contentEncoding: stringColumn(row, "content_encoding"),
    createdAt: stringColumn(row, "created_at"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    endOffset: optionalNumberColumn(row, "end_offset"),
    id: stringColumn(row, "id"),
    inlineText: optionalStringColumn(row, "inline_text"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    objectKey: optionalStringColumn(row, "object_key"),
    parseArtifactId: stringColumn(row, "parse_artifact_id"),
    segmentIndex: numberColumn(row, "segment_index"),
    segmentType: stringColumn(row, "segment_type"),
    sizeBytes: optionalNumberColumn(row, "size_bytes"),
    sourceLocation: jsonObjectColumn(row, "source_location"),
    startOffset: optionalNumberColumn(row, "start_offset"),
    updatedAt: optionalStringColumn(row, "updated_at"),
  });
}

function validateRepositoryBounds({
  maxBatchSize,
  maxListLimit,
  maxSegments,
}: InMemoryArtifactSegmentRepositoryOptions): void {
  validateCommonRepositoryBounds({ maxBatchSize, maxListLimit });

  if (!Number.isInteger(maxSegments) || maxSegments < 1) {
    throw new Error("Artifact segment repository maxSegments must be at least 1");
  }
}

function validateCommonRepositoryBounds({
  maxBatchSize,
  maxListLimit,
}: Pick<InMemoryArtifactSegmentRepositoryOptions, "maxBatchSize" | "maxListLimit">): void {
  if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
    throw new Error("Artifact segment repository maxBatchSize must be at least 1");
  }

  if (!Number.isInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("Artifact segment repository maxListLimit must be at least 1");
  }
}

function validateListLimit(limit: number, maxListLimit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxListLimit) {
    throw new ArtifactSegmentListLimitExceededError(maxListLimit);
  }
}

function scopedArtifactIndexKey(segment: ArtifactSegment): string {
  return `${segment.knowledgeSpaceId}:${segment.parseArtifactId}:${segment.segmentIndex}`;
}

function cloneSegment(segment: ArtifactSegment): ArtifactSegment {
  return ArtifactSegmentSchema.parse(JSON.parse(JSON.stringify(segment)) as unknown);
}
