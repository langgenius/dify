import {
  type DatabaseAdapter,
  type DatabaseQueryValue,
  type DatabaseRow,
  type EmbeddingModel,
  EmbeddingModelSchema,
} from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";

export interface EmbeddingModelCursor {
  readonly id: string;
  readonly modelId: string;
}

export interface EmbeddingModelLookupInput {
  readonly modelId: string;
  readonly version: string;
}

export interface ListEmbeddingModelsInput {
  readonly cursor?: EmbeddingModelCursor | undefined;
  readonly limit: number;
  readonly provider?: string | undefined;
  readonly status: EmbeddingModel["status"];
}

export interface ListEmbeddingModelsResult {
  readonly items: EmbeddingModel[];
  readonly nextCursor?: EmbeddingModelCursor;
}

export interface EmbeddingModelRegistry {
  get(input: EmbeddingModelLookupInput): Promise<EmbeddingModel | null>;
  list(input: ListEmbeddingModelsInput): Promise<ListEmbeddingModelsResult>;
  register(model: EmbeddingModel): Promise<EmbeddingModel>;
}

export interface InMemoryEmbeddingModelRegistryOptions {
  readonly maxListLimit: number;
  readonly maxModels: number;
}

export interface DatabaseEmbeddingModelRegistryOptions {
  readonly database: DatabaseAdapter;
  readonly maxListLimit: number;
}

export class EmbeddingModelRegistryCapacityExceededError extends Error {
  constructor(maxModels: number) {
    super(`Embedding model registry maxModels=${maxModels} exceeded`);
  }
}

export function createInMemoryEmbeddingModelRegistry({
  maxListLimit,
  maxModels,
}: InMemoryEmbeddingModelRegistryOptions): EmbeddingModelRegistry {
  validateEmbeddingModelRegistryBounds({ maxListLimit, maxModels });

  const models = new Map<string, EmbeddingModel>();

  return {
    get: async (input) => {
      validateEmbeddingModelLookupInput(input);
      const model = models.get(embeddingModelKey(input.modelId, input.version));

      return model ? cloneEmbeddingModel(model) : null;
    },
    list: async (input) => {
      validateEmbeddingModelListLimit(input.limit, maxListLimit);
      const rows = Array.from(models.values())
        .filter((model) => model.status === input.status)
        .filter((model) => input.provider === undefined || model.provider === input.provider)
        .filter((model) => isEmbeddingModelAfterCursor(model, input.cursor))
        .sort(compareEmbeddingModelsForRegistry);
      const page = rows.slice(0, input.limit + 1);
      const items = page.slice(0, input.limit).map(cloneEmbeddingModel);
      const lastItem = items.at(-1);
      const nextCursor =
        page.length > input.limit && lastItem ? embeddingModelCursor(lastItem) : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    register: async (input) => {
      const model = cloneEmbeddingModel(EmbeddingModelSchema.parse(input));
      const key = embeddingModelKey(model.modelId, model.version);

      if (!models.has(key) && models.size + 1 > maxModels) {
        throw new EmbeddingModelRegistryCapacityExceededError(maxModels);
      }

      models.set(key, cloneEmbeddingModel(model));

      return cloneEmbeddingModel(model);
    },
  };
}

export function createDatabaseEmbeddingModelRegistry({
  database,
  maxListLimit,
}: DatabaseEmbeddingModelRegistryOptions): EmbeddingModelRegistry {
  validateEmbeddingModelRegistryBounds({
    maxListLimit,
    maxModels: Number.MAX_SAFE_INTEGER,
  });
  const tableName = "embedding_models";

  return {
    get: async (input) => {
      validateEmbeddingModelLookupInput(input);
      const result = await database.execute({
        maxRows: 1,
        operation: "select",
        params: [input.modelId, input.version],
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "model_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "version",
        )} = ${databasePlaceholder(database, 2)} LIMIT 1;`,
        tableName,
      });
      const row = result.rows[0];

      return row ? mapEmbeddingModelRow(row) : null;
    },
    list: async (input) => {
      validateEmbeddingModelListLimit(input.limit, maxListLimit);
      const readLimit = input.limit + 1;
      const params = embeddingModelListParams(input, readLimit);
      const whereSql = embeddingModelListWhereSql(database, input);
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "status",
        )} = ${databasePlaceholder(database, 1)}${whereSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "model_id",
        )} ASC, ${quoteDatabaseIdentifier(database, "id")} ASC LIMIT ${databasePlaceholder(
          database,
          params.length,
        )};`,
        tableName,
      });
      const rows = result.rows.map(mapEmbeddingModelRow);
      const items = rows.slice(0, input.limit).map(cloneEmbeddingModel);
      const lastItem = items.at(-1);
      const nextCursor =
        rows.length > input.limit && lastItem ? embeddingModelCursor(lastItem) : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    register: async (input) => {
      const model = cloneEmbeddingModel(EmbeddingModelSchema.parse(input));
      const columns = [
        "id",
        "provider",
        "model_id",
        "version",
        "dimension",
        "metric",
        "tokenizer",
        "max_tokens",
        "status",
        "metadata",
        "created_at",
        "updated_at",
      ];
      const params = [
        model.id,
        model.provider,
        model.modelId,
        model.version,
        model.dimension,
        model.metric,
        model.tokenizer,
        model.maxTokens,
        model.status,
        JSON.stringify(model.metadata),
        model.createdAt,
        model.updatedAt,
      ] satisfies readonly DatabaseQueryValue[];
      const result = await database.execute({
        maxRows: 1,
        operation: "insert",
        params,
        sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
          .map((column) => quoteDatabaseIdentifier(database, column))
          .join(", ")}) VALUES (${columns
          .map((column, index) => jsonInsertPlaceholder(database, index + 1, column))
          .join(", ")})${embeddingModelUpsertSql(database, columns)}${
          database.dialect === "postgres" ? " RETURNING *" : ""
        };`,
        tableName,
      });

      return result.rows[0] ? mapEmbeddingModelRow(result.rows[0]) : model;
    },
  };
}

function embeddingModelListParams(
  input: ListEmbeddingModelsInput,
  readLimit: number,
): readonly DatabaseQueryValue[] {
  return [
    input.status,
    ...(input.provider === undefined ? [] : [input.provider]),
    ...(input.cursor ? [input.cursor.modelId, input.cursor.id] : []),
    readLimit,
  ];
}

function embeddingModelListWhereSql(
  database: DatabaseAdapter,
  input: ListEmbeddingModelsInput,
): string {
  let nextPlaceholder = 2;
  const parts: string[] = [];

  if (input.provider !== undefined) {
    parts.push(
      `${quoteDatabaseIdentifier(database, "provider")} = ${databasePlaceholder(
        database,
        nextPlaceholder,
      )}`,
    );
    nextPlaceholder += 1;
  }

  if (input.cursor) {
    parts.push(
      `(${quoteDatabaseIdentifier(database, "model_id")} > ${databasePlaceholder(
        database,
        nextPlaceholder,
      )} OR (${quoteDatabaseIdentifier(database, "model_id")} = ${databasePlaceholder(
        database,
        nextPlaceholder,
      )} AND ${quoteDatabaseIdentifier(database, "id")} > ${databasePlaceholder(
        database,
        nextPlaceholder + 1,
      )}))`,
    );
  }

  return parts.length > 0 ? ` AND ${parts.join(" AND ")}` : "";
}

function embeddingModelUpsertSql(database: DatabaseAdapter, columns: readonly string[]): string {
  const mutableColumns = columns.filter((column) => column !== "model_id" && column !== "version");

  if (database.dialect === "postgres") {
    return ` ON CONFLICT (${quoteDatabaseIdentifier(
      database,
      "model_id",
    )}, ${quoteDatabaseIdentifier(database, "version")}) DO UPDATE SET ${mutableColumns
      .map(
        (column) =>
          `${quoteDatabaseIdentifier(database, column)} = EXCLUDED.${quoteDatabaseIdentifier(
            database,
            column,
          )}`,
      )
      .join(", ")}`;
  }

  return ` ON DUPLICATE KEY UPDATE ${mutableColumns
    .map(
      (column) =>
        `${quoteDatabaseIdentifier(database, column)} = VALUES(${quoteDatabaseIdentifier(
          database,
          column,
        )})`,
    )
    .join(", ")}`;
}

function mapEmbeddingModelRow(row: DatabaseRow): EmbeddingModel {
  return EmbeddingModelSchema.parse({
    createdAt: stringColumn(row, "created_at"),
    dimension: numberColumn(row, "dimension"),
    id: stringColumn(row, "id"),
    maxTokens: numberColumn(row, "max_tokens"),
    metadata: jsonObjectColumn(row, "metadata"),
    metric: stringColumn(row, "metric"),
    modelId: stringColumn(row, "model_id"),
    provider: stringColumn(row, "provider"),
    status: stringColumn(row, "status"),
    tokenizer: stringColumn(row, "tokenizer"),
    updatedAt: stringColumn(row, "updated_at"),
    version: stringColumn(row, "version"),
  });
}

export function cloneEmbeddingModel(model: EmbeddingModel): EmbeddingModel {
  return EmbeddingModelSchema.parse(JSON.parse(JSON.stringify(model)) as unknown);
}

function validateEmbeddingModelRegistryBounds({
  maxListLimit,
  maxModels,
}: {
  readonly maxListLimit: number;
  readonly maxModels: number;
}) {
  if (maxListLimit < 1) {
    throw new Error("Embedding model registry maxListLimit must be at least 1");
  }

  if (maxModels < 1) {
    throw new Error("Embedding model registry maxModels must be at least 1");
  }
}

function validateEmbeddingModelListLimit(limit: number, maxListLimit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Embedding model registry list limit must be at least 1");
  }

  if (limit > maxListLimit) {
    throw new Error(`Embedding model registry list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

function validateEmbeddingModelLookupInput({ modelId, version }: EmbeddingModelLookupInput) {
  if (!modelId.trim()) {
    throw new Error("Embedding model modelId is required");
  }

  if (!version.trim()) {
    throw new Error("Embedding model version is required");
  }
}

function embeddingModelKey(modelId: string, version: string): string {
  return `${modelId}:${version}`;
}

function compareEmbeddingModelsForRegistry(left: EmbeddingModel, right: EmbeddingModel): number {
  return left.modelId.localeCompare(right.modelId) || left.id.localeCompare(right.id);
}

function isEmbeddingModelAfterCursor(
  model: EmbeddingModel,
  cursor: EmbeddingModelCursor | undefined,
): boolean {
  return (
    !cursor ||
    model.modelId > cursor.modelId ||
    (model.modelId === cursor.modelId && model.id > cursor.id)
  );
}

function embeddingModelCursor(model: EmbeddingModel): EmbeddingModelCursor {
  return {
    id: model.id,
    modelId: model.modelId,
  };
}
