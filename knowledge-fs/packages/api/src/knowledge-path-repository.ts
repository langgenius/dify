import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
  KnowledgePath,
} from "@knowledge/core";
import { KnowledgePathSchema } from "@knowledge/core";

import { optionalNumberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
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
import { jsonObjectColumn } from "./json-utils";
import { knowledgePathDescendantPrefix } from "./knowledge-fs-path-utils";

export interface KnowledgePathCursor {
  readonly id: string;
  readonly virtualPath: string;
}

export interface KnowledgePathLookupInput {
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId?: string | undefined;
  readonly virtualPath: string;
}

export interface ListKnowledgePathsByPhysicalViewInput {
  readonly cursor?: KnowledgePathCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly publicationGenerationId?: string | undefined;
  readonly viewName: string;
}

export interface ListKnowledgePathDescendantsInput {
  readonly cursor?: KnowledgePathCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly parentPath: string;
  readonly publicationGenerationId?: string | undefined;
  readonly viewName: string;
}

export interface ListKnowledgePathsResult {
  readonly items: KnowledgePath[];
  readonly nextCursor?: KnowledgePathCursor;
}

export interface DeleteSemanticViewPathsInput {
  readonly knowledgeSpaceId: string;
  readonly maxPaths: number;
  readonly publicationGenerationId?: string | undefined;
  readonly viewName: string;
}

export interface DeleteKnowledgePathsByDocumentAssetInput {
  readonly documentAssetId: string;
  readonly knowledgeSpaceId: string;
  readonly maxPaths: number;
}

export interface KnowledgePathRepository {
  create(input: KnowledgePath): Promise<KnowledgePath>;
  deleteByDocumentAsset(input: DeleteKnowledgePathsByDocumentAssetInput): Promise<number>;
  deleteSemanticView(input: DeleteSemanticViewPathsInput): Promise<number>;
  get(input: KnowledgePathLookupInput): Promise<KnowledgePath | null>;
  listPhysicalDescendants(
    input: ListKnowledgePathDescendantsInput,
  ): Promise<ListKnowledgePathsResult>;
  listPhysicalView(input: ListKnowledgePathsByPhysicalViewInput): Promise<ListKnowledgePathsResult>;
  listSemanticDescendants(
    input: ListKnowledgePathDescendantsInput,
  ): Promise<ListKnowledgePathsResult>;
  upsertMany(input: readonly KnowledgePath[]): Promise<KnowledgePath[]>;
}

export interface InMemoryKnowledgePathRepositoryOptions {
  readonly maxBatchSize?: number | undefined;
  readonly maxListLimit: number;
  readonly maxPaths: number;
  readonly publishedGenerationGuard?: PublishedGenerationReferenceGuard | undefined;
}

export interface DatabaseKnowledgePathRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxBatchSize?: number | undefined;
  readonly maxListLimit: number;
}

export class DuplicateKnowledgePathError extends Error {
  constructor() {
    super("Knowledge path already exists for virtual path");
  }
}

export class KnowledgePathCapacityExceededError extends Error {
  constructor(maxPaths: number) {
    super(`Knowledge path repository maxPaths=${maxPaths} exceeded`);
  }
}

export class KnowledgePathListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`Knowledge path list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

export function createInMemoryKnowledgePathRepository({
  maxListLimit,
  maxBatchSize = maxListLimit,
  maxPaths,
  publishedGenerationGuard,
}: InMemoryKnowledgePathRepositoryOptions): KnowledgePathRepository {
  validateKnowledgePathRepositoryBounds({ maxBatchSize, maxListLimit, maxPaths });

  const paths = new Map<string, KnowledgePath>();

  return {
    create: async (input) => {
      const path = cloneKnowledgePath(KnowledgePathSchema.parse(input));
      const key = knowledgePathKey(
        path.knowledgeSpaceId,
        path.virtualPath,
        path.publicationGenerationId,
      );

      const existing = paths.get(key);
      if (existing && path.publicationGenerationId) {
        assertExactGenerationReplay({
          componentType: "knowledge-path",
          incoming: path,
          logicalKey: key,
          persisted: existing,
        });
        return cloneKnowledgePath(existing);
      }
      if (existing) {
        throw new DuplicateKnowledgePathError();
      }

      if (paths.size >= maxPaths) {
        throw new KnowledgePathCapacityExceededError(maxPaths);
      }

      paths.set(key, cloneKnowledgePath(path));

      return cloneKnowledgePath(path);
    },
    deleteByDocumentAsset: async (input) => {
      validateDeleteKnowledgePathsByDocumentAssetInput(input);
      const selected = Array.from(paths.values())
        .filter((path) => path.knowledgeSpaceId === input.knowledgeSpaceId)
        .filter((path) => path.resourceType === "document")
        .filter((path) => path.targetId === input.documentAssetId)
        .sort(compareKnowledgePathsForView)
        .slice(0, input.maxPaths + 1);
      if (selected.length > input.maxPaths) {
        throw new Error(`Knowledge path document delete exceeds maxPaths=${input.maxPaths}`);
      }
      for (const path of selected) {
        if (path.publicationGenerationId) {
          await assertInMemoryGenerationNotPublished({
            componentKey: path.id,
            componentType: "knowledge-path",
            guard: publishedGenerationGuard,
            knowledgeSpaceId: path.knowledgeSpaceId,
            publicationGenerationId: path.publicationGenerationId,
          });
        }
      }
      for (const path of selected) {
        paths.delete(
          knowledgePathKey(path.knowledgeSpaceId, path.virtualPath, path.publicationGenerationId),
        );
      }

      return selected.length;
    },
    deleteSemanticView: async ({
      knowledgeSpaceId,
      maxPaths,
      publicationGenerationId,
      viewName,
    }) => {
      validateDeleteSemanticViewPathsInput({
        knowledgeSpaceId,
        maxPaths,
        publicationGenerationId,
        viewName,
      });
      const selected = Array.from(paths.values())
        .filter((path) => path.knowledgeSpaceId === knowledgeSpaceId)
        .filter((path) => (path.publicationGenerationId ?? undefined) === publicationGenerationId)
        .filter((path) => path.viewType === "semantic")
        .filter((path) => path.viewName === viewName)
        .sort(compareKnowledgePathsForView)
        .slice(0, maxPaths + 1);

      if (selected.length > maxPaths) {
        throw new Error(`Knowledge path semantic view delete exceeds maxPaths=${maxPaths}`);
      }

      for (const path of selected) {
        if (path.publicationGenerationId) {
          await assertInMemoryGenerationNotPublished({
            componentKey: path.id,
            componentType: "knowledge-path",
            guard: publishedGenerationGuard,
            knowledgeSpaceId: path.knowledgeSpaceId,
            publicationGenerationId: path.publicationGenerationId,
          });
        }
      }

      for (const path of selected) {
        paths.delete(
          knowledgePathKey(path.knowledgeSpaceId, path.virtualPath, path.publicationGenerationId),
        );
      }

      return selected.length;
    },
    upsertMany: async (input) => {
      validateKnowledgePathBatch(input, maxBatchSize);
      const parsed = input.map((path) => cloneKnowledgePath(KnowledgePathSchema.parse(path)));
      const nextKeys = new Set(
        parsed
          .map((path) =>
            knowledgePathKey(path.knowledgeSpaceId, path.virtualPath, path.publicationGenerationId),
          )
          .filter((key) => !paths.has(key)),
      ).size;

      if (paths.size + nextKeys > maxPaths) {
        throw new KnowledgePathCapacityExceededError(maxPaths);
      }

      const persisted = parsed.map((path) => {
        const key = knowledgePathKey(
          path.knowledgeSpaceId,
          path.virtualPath,
          path.publicationGenerationId,
        );
        const existing = paths.get(key);
        if (existing && path.publicationGenerationId) {
          assertExactGenerationReplay({
            componentType: "knowledge-path",
            incoming: path,
            logicalKey: key,
            persisted: existing,
          });
          return existing;
        }
        const stored = existing ? { ...path, id: existing.id } : path;
        paths.set(key, cloneKnowledgePath(stored));

        return stored;
      });

      return persisted.map(cloneKnowledgePath);
    },
    get: async ({ knowledgeSpaceId, publicationGenerationId, virtualPath }) => {
      const path = paths.get(
        knowledgePathKey(knowledgeSpaceId, virtualPath, publicationGenerationId),
      );

      return path ? cloneKnowledgePath(path) : null;
    },
    listPhysicalView: async (input) => {
      validateKnowledgePathListLimit(input.limit, maxListLimit);
      const rows = Array.from(paths.values())
        .filter((path) => path.knowledgeSpaceId === input.knowledgeSpaceId)
        .filter(
          (path) => (path.publicationGenerationId ?? undefined) === input.publicationGenerationId,
        )
        .filter((path) => path.viewType === "physical")
        .filter((path) => path.viewName === input.viewName)
        .filter((path) => isKnowledgePathAfterCursor(path, input.cursor))
        .sort(compareKnowledgePathsForView);
      const page = rows.slice(0, input.limit + 1);
      const items = page.slice(0, input.limit).map(cloneKnowledgePath);
      const lastItem = items.at(-1);
      const nextCursor =
        page.length > input.limit && lastItem ? knowledgePathCursor(lastItem) : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    listPhysicalDescendants: async (input) => {
      validateKnowledgePathListLimit(input.limit, maxListLimit);
      return listInMemoryKnowledgePathDescendants({
        cursor: input.cursor,
        knowledgeSpaceId: input.knowledgeSpaceId,
        limit: input.limit,
        parentPath: input.parentPath,
        paths,
        publicationGenerationId: input.publicationGenerationId,
        viewName: input.viewName,
        viewType: "physical",
      });
    },
    listSemanticDescendants: async (input) => {
      validateKnowledgePathListLimit(input.limit, maxListLimit);
      return listInMemoryKnowledgePathDescendants({
        cursor: input.cursor,
        knowledgeSpaceId: input.knowledgeSpaceId,
        limit: input.limit,
        parentPath: input.parentPath,
        paths,
        publicationGenerationId: input.publicationGenerationId,
        viewName: input.viewName,
        viewType: "semantic",
      });
    },
  };
}

export function createDatabaseKnowledgePathRepository({
  database,
  maxListLimit,
  maxBatchSize = maxListLimit,
}: DatabaseKnowledgePathRepositoryOptions): KnowledgePathRepository {
  validateKnowledgePathRepositoryBounds({
    maxBatchSize,
    maxListLimit,
    maxPaths: Number.MAX_SAFE_INTEGER,
  });
  const tableName = "knowledge_paths";

  return {
    create: async (input) => {
      const path = cloneKnowledgePath(KnowledgePathSchema.parse(input));
      return path.publicationGenerationId
        ? database.transaction((transaction) =>
            writeDatabaseKnowledgePath({
              database,
              executor: transaction,
              mode: "immutable",
              path,
              tableName,
            }),
          )
        : writeDatabaseKnowledgePath({
            database,
            executor: database,
            mode: "create",
            path,
            tableName,
          });
    },
    deleteByDocumentAsset: async (input) => {
      validateDeleteKnowledgePathsByDocumentAssetInput(input);

      return database.transaction(async (transaction) => {
        const selected = await transaction.execute({
          maxRows: input.maxPaths + 1,
          operation: "select",
          params: [input.knowledgeSpaceId, "document", input.documentAssetId],
          sql: `SELECT ${quoteDatabaseIdentifier(database, "id")}, ${quoteDatabaseIdentifier(
            database,
            "publication_generation_id",
          )} FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
            database,
            "resource_type",
          )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
            database,
            "target_id",
          )} = ${databasePlaceholder(database, 3)} ORDER BY ${quoteDatabaseIdentifier(
            database,
            "id",
          )} ASC LIMIT ${input.maxPaths + 1} FOR UPDATE;`,
          tableName,
        });
        if (selected.rows.length > input.maxPaths) {
          throw new Error(`Knowledge path document delete exceeds maxPaths=${input.maxPaths}`);
        }
        for (const generation of new Set(
          selected.rows.flatMap((row) => {
            const id = optionalStringColumn(row, "publication_generation_id");
            return id ? [id] : [];
          }),
        )) {
          await assertDatabaseGenerationNotPublished({
            componentType: "knowledge-path",
            database,
            executor: transaction,
            knowledgeSpaceId: input.knowledgeSpaceId,
            publicationGenerationId: generation,
          });
        }
        const ids = selected.rows.map((row) => stringColumn(row, "id"));
        if (ids.length === 0) {
          return 0;
        }
        const params: DatabaseQueryValue[] = [input.knowledgeSpaceId, ...ids];
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
          )} AND ${quoteDatabaseIdentifier(database, "id")} IN (${ids
            .map((_, index) => databasePlaceholder(database, index + 2))
            .join(", ")});`,
          tableName,
        });

        return deleted.rowsAffected;
      });
    },
    deleteSemanticView: async ({
      knowledgeSpaceId,
      maxPaths,
      publicationGenerationId,
      viewName,
    }) => {
      validateDeleteSemanticViewPathsInput({
        knowledgeSpaceId,
        maxPaths,
        publicationGenerationId,
        viewName,
      });
      return database.transaction(async (transaction) => {
        const params: DatabaseQueryValue[] = [knowledgeSpaceId, "semantic", viewName];
        const generationSql = publicationGenerationId
          ? (() => {
              params.push(publicationGenerationId);
              return ` = ${databasePlaceholder(database, params.length)}`;
            })()
          : " IS NULL";
        const selected = await transaction.execute({
          maxRows: maxPaths + 1,
          operation: "select",
          params,
          sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(
            database,
            tableName,
          )} WHERE ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(
            database,
            1,
          )} AND ${quoteDatabaseIdentifier(database, "view_type")} = ${databasePlaceholder(
            database,
            2,
          )} AND ${quoteDatabaseIdentifier(database, "view_name")} = ${databasePlaceholder(
            database,
            3,
          )} AND ${quoteDatabaseIdentifier(
            database,
            "publication_generation_id",
          )}${generationSql} ORDER BY ${quoteDatabaseIdentifier(database, "virtual_path")} ASC LIMIT ${maxPaths + 1} FOR UPDATE;`,
          tableName,
        });
        if (selected.rows.length > maxPaths) {
          throw new Error(`Knowledge path semantic view delete exceeds maxPaths=${maxPaths}`);
        }
        if (publicationGenerationId) {
          await assertDatabaseGenerationNotPublished({
            componentType: "knowledge-path",
            database,
            executor: transaction,
            knowledgeSpaceId,
            publicationGenerationId,
          });
        }
        const ids = selected.rows.map((row) => stringColumn(row, "id"));
        if (ids.length === 0) {
          return 0;
        }
        const deleted = await transaction.execute({
          maxRows: ids.length,
          operation: "delete",
          params: ids,
          sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
            database,
            "id",
          )} IN (${ids.map((_, index) => databasePlaceholder(database, index + 1)).join(", ")});`,
          tableName,
        });

        return deleted.rowsAffected;
      });
    },
    upsertMany: async (input) => {
      validateKnowledgePathBatch(input, maxBatchSize);
      const paths = input.map((path) => cloneKnowledgePath(KnowledgePathSchema.parse(path)));
      const write = async (executor: DatabaseExecutor) => {
        const persisted: KnowledgePath[] = [];
        for (const path of paths) {
          persisted.push(
            await writeDatabaseKnowledgePath({
              database,
              executor,
              mode: path.publicationGenerationId ? "immutable" : "legacy-upsert",
              path,
              tableName,
            }),
          );
        }
        return persisted;
      };
      return paths.every((path) => !path.publicationGenerationId)
        ? write(database)
        : database.transaction(write);
    },
    get: async ({ knowledgeSpaceId, publicationGenerationId, virtualPath }) =>
      getDatabaseKnowledgePathByLogicalKey({
        database,
        executor: database,
        knowledgeSpaceId,
        publicationGenerationId,
        tableName,
        virtualPath,
      }),
    listPhysicalView: async ({
      cursor,
      knowledgeSpaceId,
      limit,
      publicationGenerationId,
      viewName,
    }) => {
      validateKnowledgePathListLimit(limit, maxListLimit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = [knowledgeSpaceId, "physical", viewName];
      const generationSql = publicationGenerationId
        ? (() => {
            params.push(publicationGenerationId);
            return ` = ${databasePlaceholder(database, params.length)}`;
          })()
        : " IS NULL";
      const cursorSql = cursor
        ? (() => {
            params.push(cursor.virtualPath);
            const virtualPathPlaceholder = databasePlaceholder(database, params.length);
            params.push(cursor.id);
            const idPlaceholder = databasePlaceholder(database, params.length);
            return ` AND (${quoteDatabaseIdentifier(
              database,
              "virtual_path",
            )} > ${virtualPathPlaceholder} OR (${quoteDatabaseIdentifier(
              database,
              "virtual_path",
            )} = ${virtualPathPlaceholder} AND ${quoteDatabaseIdentifier(
              database,
              "id",
            )} > ${idPlaceholder}))`;
          })()
        : "";
      params.push(readLimit);
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "view_type",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "view_name",
        )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
          database,
          "publication_generation_id",
        )}${generationSql}${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "virtual_path",
        )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(
          database,
          params.length,
        )};`,
        tableName,
      });
      const rows = result.rows.map(mapKnowledgePathRow);
      const items = rows.slice(0, limit).map(cloneKnowledgePath);
      const lastItem = items.at(-1);
      const nextCursor =
        rows.length > limit && lastItem ? knowledgePathCursor(lastItem) : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    listPhysicalDescendants: async ({
      cursor,
      knowledgeSpaceId,
      limit,
      parentPath,
      publicationGenerationId,
      viewName,
    }) => {
      validateKnowledgePathListLimit(limit, maxListLimit);
      return listDatabaseKnowledgePathDescendants({
        cursor,
        database,
        knowledgeSpaceId,
        limit,
        parentPath,
        publicationGenerationId,
        tableName,
        viewName,
        viewType: "physical",
      });
    },
    listSemanticDescendants: async ({
      cursor,
      knowledgeSpaceId,
      limit,
      parentPath,
      publicationGenerationId,
      viewName,
    }) => {
      validateKnowledgePathListLimit(limit, maxListLimit);
      return listDatabaseKnowledgePathDescendants({
        cursor,
        database,
        knowledgeSpaceId,
        limit,
        parentPath,
        publicationGenerationId,
        tableName,
        viewName,
        viewType: "semantic",
      });
    },
  };
}

async function writeDatabaseKnowledgePath({
  database,
  executor,
  mode,
  path,
  tableName,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly mode: "create" | "immutable" | "legacy-upsert";
  readonly path: KnowledgePath;
  readonly tableName: string;
}): Promise<KnowledgePath> {
  const columns = [
    "id",
    "knowledge_space_id",
    "publication_generation_id",
    "virtual_path",
    "resource_type",
    "target_id",
    "version",
    "view_type",
    "view_name",
    "metadata",
  ];
  const params = [
    path.id,
    path.knowledgeSpaceId,
    path.publicationGenerationId ?? null,
    path.virtualPath,
    path.resourceType,
    path.targetId,
    path.version ?? null,
    path.viewType,
    path.viewName,
    JSON.stringify(path.metadata),
  ] satisfies readonly DatabaseQueryValue[];
  const conflictTarget = `(${quoteDatabaseIdentifier(
    database,
    "knowledge_space_id",
  )}, ${quoteDatabaseIdentifier(database, "virtual_path")}, (COALESCE(${quoteDatabaseIdentifier(
    database,
    "publication_generation_id",
  )}, '00000000-0000-0000-0000-000000000000'::uuid)))`;
  const mutableColumns = columns.filter(
    (column) =>
      column !== "id" &&
      column !== "knowledge_space_id" &&
      column !== "virtual_path" &&
      column !== "publication_generation_id",
  );
  const upsertClause =
    mode === "create"
      ? database.dialect === "postgres"
        ? " RETURNING *"
        : ""
      : mode === "immutable"
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
      .join(", ")}) VALUES (${columns
      .map((column, index) => jsonInsertPlaceholder(database, index + 1, column))
      .join(", ")})${upsertClause};`,
    tableName,
  });

  if (mode === "immutable" || database.dialect === "tidb") {
    const persisted = await getDatabaseKnowledgePathByLogicalKey({
      database,
      executor,
      knowledgeSpaceId: path.knowledgeSpaceId,
      publicationGenerationId: path.publicationGenerationId,
      tableName,
      virtualPath: path.virtualPath,
    });
    if (!persisted) {
      throw new Error("Knowledge path write did not persist its logical row");
    }
    if (mode === "immutable") {
      assertExactGenerationReplay({
        componentType: "knowledge-path",
        incoming: path,
        logicalKey: knowledgePathKey(
          path.knowledgeSpaceId,
          path.virtualPath,
          path.publicationGenerationId,
        ),
        persisted,
      });
    }
    return persisted;
  }

  return result.rows[0] ? mapKnowledgePathRow(result.rows[0]) : cloneKnowledgePath(path);
}

async function getDatabaseKnowledgePathByLogicalKey({
  database,
  executor,
  knowledgeSpaceId,
  publicationGenerationId,
  tableName,
  virtualPath,
}: {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId?: string | undefined;
  readonly tableName: string;
  readonly virtualPath: string;
}): Promise<KnowledgePath | null> {
  const params: DatabaseQueryValue[] = [knowledgeSpaceId, virtualPath];
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
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "virtual_path",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )}${generationSql} LIMIT 1;`,
    tableName,
  });

  return result.rows[0] ? mapKnowledgePathRow(result.rows[0]) : null;
}

export function cloneKnowledgePath(path: KnowledgePath): KnowledgePath {
  return KnowledgePathSchema.parse(JSON.parse(JSON.stringify(path)) as unknown);
}

function listInMemoryKnowledgePathDescendants({
  cursor,
  knowledgeSpaceId,
  limit,
  parentPath,
  paths,
  publicationGenerationId,
  viewName,
  viewType,
}: {
  readonly cursor?: KnowledgePathCursor | undefined;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly parentPath: string;
  readonly paths: ReadonlyMap<string, KnowledgePath>;
  readonly publicationGenerationId?: string | undefined;
  readonly viewName: string;
  readonly viewType: KnowledgePath["viewType"];
}): ListKnowledgePathsResult {
  const descendantPrefix = knowledgePathDescendantPrefix(parentPath);
  const rows = Array.from(paths.values())
    .filter((path) => path.knowledgeSpaceId === knowledgeSpaceId)
    .filter((path) => (path.publicationGenerationId ?? undefined) === publicationGenerationId)
    .filter((path) => path.viewType === viewType)
    .filter((path) => path.viewName === viewName)
    .filter((path) => path.virtualPath.startsWith(descendantPrefix))
    .filter((path) => isKnowledgePathAfterCursor(path, cursor))
    .sort(compareKnowledgePathsForView);
  const page = rows.slice(0, limit + 1);
  const items = page.slice(0, limit).map(cloneKnowledgePath);
  const lastItem = items.at(-1);
  const nextCursor = page.length > limit && lastItem ? knowledgePathCursor(lastItem) : undefined;

  return {
    items,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

async function listDatabaseKnowledgePathDescendants({
  cursor,
  database,
  knowledgeSpaceId,
  limit,
  parentPath,
  publicationGenerationId,
  tableName,
  viewName,
  viewType,
}: {
  readonly cursor?: KnowledgePathCursor | undefined;
  readonly database: DatabaseAdapter;
  readonly knowledgeSpaceId: string;
  readonly limit: number;
  readonly parentPath: string;
  readonly publicationGenerationId?: string | undefined;
  readonly tableName: string;
  readonly viewName: string;
  readonly viewType: KnowledgePath["viewType"];
}): Promise<ListKnowledgePathsResult> {
  const readLimit = limit + 1;
  const descendantPattern = `${knowledgePathDescendantPrefix(parentPath)}%`;
  const params: DatabaseQueryValue[] = [knowledgeSpaceId, viewType, viewName, descendantPattern];
  const generationSql = publicationGenerationId
    ? (() => {
        params.push(publicationGenerationId);
        return ` = ${databasePlaceholder(database, params.length)}`;
      })()
    : " IS NULL";
  const cursorSql = cursor
    ? (() => {
        params.push(cursor.virtualPath);
        const virtualPathPlaceholder = databasePlaceholder(database, params.length);
        params.push(cursor.id);
        const idPlaceholder = databasePlaceholder(database, params.length);
        return ` AND (${quoteDatabaseIdentifier(
          database,
          "virtual_path",
        )} > ${virtualPathPlaceholder} OR (${quoteDatabaseIdentifier(
          database,
          "virtual_path",
        )} = ${virtualPathPlaceholder} AND ${quoteDatabaseIdentifier(
          database,
          "id",
        )} > ${idPlaceholder}))`;
      })()
    : "";
  params.push(readLimit);
  const result = await database.execute({
    maxRows: readLimit,
    operation: "select",
    params,
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "view_type",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "view_name",
    )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
      database,
      "virtual_path",
    )} LIKE ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
      database,
      "publication_generation_id",
    )}${generationSql}${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
      database,
      "virtual_path",
    )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(
      database,
      params.length,
    )};`,
    tableName,
  });
  const rows = result.rows.map(mapKnowledgePathRow);
  const items = rows.slice(0, limit).map(cloneKnowledgePath);
  const lastItem = items.at(-1);
  const nextCursor = rows.length > limit && lastItem ? knowledgePathCursor(lastItem) : undefined;

  return {
    items,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function mapKnowledgePathRow(row: DatabaseRow): KnowledgePath {
  const version = optionalNumberColumn(row, "version");

  return KnowledgePathSchema.parse({
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    metadata: jsonObjectColumn(row, "metadata"),
    publicationGenerationId: optionalStringColumn(row, "publication_generation_id"),
    resourceType: stringColumn(row, "resource_type"),
    targetId: stringColumn(row, "target_id"),
    ...(version === undefined ? {} : { version }),
    viewName: stringColumn(row, "view_name"),
    viewType: stringColumn(row, "view_type"),
    virtualPath: stringColumn(row, "virtual_path"),
  });
}

function validateKnowledgePathRepositoryBounds({
  maxBatchSize,
  maxListLimit,
  maxPaths,
}: {
  readonly maxBatchSize: number;
  readonly maxListLimit: number;
  readonly maxPaths: number;
}) {
  if (maxListLimit < 1) {
    throw new Error("Knowledge path repository maxListLimit must be at least 1");
  }

  if (maxPaths < 1) {
    throw new Error("Knowledge path repository maxPaths must be at least 1");
  }

  if (maxBatchSize < 1) {
    throw new Error("Knowledge path repository maxBatchSize must be at least 1");
  }
}

function validateKnowledgePathBatch(paths: readonly KnowledgePath[], maxBatchSize: number) {
  if (paths.length < 1) {
    throw new Error("Knowledge path batch must contain at least 1 path");
  }

  if (paths.length > maxBatchSize) {
    throw new Error(`Knowledge path batch size exceeds maxBatchSize=${maxBatchSize}`);
  }
}

function validateDeleteSemanticViewPathsInput({
  knowledgeSpaceId,
  maxPaths,
  viewName,
}: DeleteSemanticViewPathsInput) {
  if (!knowledgeSpaceId.trim()) {
    throw new Error("Knowledge path semantic view delete knowledgeSpaceId is required");
  }

  if (!viewName.trim()) {
    throw new Error("Knowledge path semantic view delete viewName is required");
  }

  if (!Number.isInteger(maxPaths) || maxPaths < 1) {
    throw new Error("Knowledge path semantic view delete maxPaths must be at least 1");
  }
}

function validateDeleteKnowledgePathsByDocumentAssetInput(
  input: DeleteKnowledgePathsByDocumentAssetInput,
): void {
  if (!input.knowledgeSpaceId.trim() || !input.documentAssetId.trim()) {
    throw new Error("Knowledge path document delete scope is required");
  }
  if (!Number.isInteger(input.maxPaths) || input.maxPaths < 1) {
    throw new Error("Knowledge path document delete maxPaths must be at least 1");
  }
}

function validateKnowledgePathListLimit(limit: number, maxListLimit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Knowledge path list limit must be at least 1");
  }

  if (limit > maxListLimit) {
    throw new KnowledgePathListLimitExceededError(maxListLimit);
  }
}

function compareKnowledgePathsForView(left: KnowledgePath, right: KnowledgePath): number {
  return left.virtualPath.localeCompare(right.virtualPath) || left.id.localeCompare(right.id);
}

function isKnowledgePathAfterCursor(
  path: KnowledgePath,
  cursor: KnowledgePathCursor | undefined,
): boolean {
  return (
    !cursor ||
    path.virtualPath > cursor.virtualPath ||
    (path.virtualPath === cursor.virtualPath && path.id > cursor.id)
  );
}

export function knowledgePathCursor(path: KnowledgePath): KnowledgePathCursor {
  return {
    id: path.id,
    virtualPath: path.virtualPath,
  };
}

function knowledgePathKey(
  knowledgeSpaceId: string,
  virtualPath: string,
  publicationGenerationId?: string,
): string {
  return `${knowledgeSpaceId}:${publicationGenerationId ?? "legacy"}:${virtualPath}`;
}
