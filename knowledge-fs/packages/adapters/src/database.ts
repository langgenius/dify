import type {
  DatabaseAdapter,
  DatabaseBatchGetRowsInput,
  DatabaseCapabilities,
  DatabaseExecuteInput,
  DatabaseExecuteResult,
  DatabaseExecutor,
  DatabaseListRowsInput,
  DatabasePerformanceIndexStatus,
  DatabaseQueryOrder,
  DatabaseQueryPlan,
  DatabaseQueryValue,
  DatabaseSchemaSummary,
  DatabaseTransactionCallback,
  DatabaseTransactionRunner,
} from "@knowledge/core";
import {
  type DatabaseDialect,
  type DatabaseSchemaCatalog,
  type IndexDefinition,
  type TableDefinition,
  assertPerformanceIndexes,
  getDatabaseSchema,
  renderMigrationSql,
} from "@knowledge/database";

export interface SchemaDatabaseAdapterOptions {
  readonly close?: (() => Promise<void>) | undefined;
  readonly executor?: DatabaseExecutor["execute"];
  readonly health?: (() => Promise<boolean>) | undefined;
  readonly kind: DatabaseAdapter["kind"];
  readonly maxBatchIds?: number;
  readonly maxListLimit?: number;
  readonly transaction?: DatabaseTransactionRunner["transaction"];
}

export function createSchemaDatabaseAdapter({
  close,
  executor,
  health,
  kind,
  maxBatchIds = 500,
  maxListLimit = 100,
  transaction,
}: SchemaDatabaseAdapterOptions): DatabaseAdapter {
  if (maxListLimit < 1) {
    throw new Error("Database maxListLimit must be at least 1");
  }

  if (maxBatchIds < 1) {
    throw new Error("Database maxBatchIds must be at least 1");
  }

  return {
    kind,
    dialect: kind,
    checkPerformanceIndexes: async () =>
      clonePerformanceStatus(assertPerformanceIndexes(getDatabaseSchema())),
    ...(close ? { close } : {}),
    execute: async (input) => executeDatabase(input, executor),
    getCapabilities: async () => createCapabilities(kind),
    getSchemaSummary: async () => createSchemaSummary(kind),
    health: health ?? (async () => true),
    planBatchGetRows: async (input) => planBatchGetRows(kind, input, maxBatchIds),
    planListRows: async (input) => planListRows(kind, input, maxListLimit),
    renderMigrationSql: async () => [...renderMigrationSql(kind)],
    transaction: async <T>(callback: DatabaseTransactionCallback<T>): Promise<T> => {
      if (!transaction) {
        throw new Error(`Database transactions are not configured for ${kind}`);
      }

      return transaction(async (transactionExecutor) =>
        callback({
          execute: async (input) => executeDatabase(input, transactionExecutor.execute),
        }),
      );
    },
  };
}

async function executeDatabase(
  input: DatabaseExecuteInput,
  executor: DatabaseExecutor["execute"] | undefined,
): Promise<DatabaseExecuteResult> {
  validateExecutionInput(input);
  if (!isInternalDatabaseTable(input.tableName)) {
    requireTable(getDatabaseSchema(), input.tableName);
  }

  if (!executor) {
    throw new Error("Database executor is not configured");
  }

  const result = await executor({
    ...input,
    params: [...input.params],
  });

  if (result.rows.length > input.maxRows) {
    throw new Error(`Database executor returned more rows than maxRows=${input.maxRows}`);
  }

  return {
    rows: result.rows.map((row) => ({ ...row })),
    rowsAffected: result.rowsAffected,
  };
}

function validateExecutionInput(input: DatabaseExecuteInput): void {
  if (!Number.isInteger(input.maxRows)) {
    throw new Error("Database execution maxRows must be an integer");
  }

  if (input.maxRows < 0) {
    throw new Error("Database execution maxRows must be nonnegative");
  }

  if (input.operation === "select" && input.maxRows < 1) {
    throw new Error("Database read execution requires maxRows >= 1");
  }
}

function isInternalDatabaseTable(tableName: string): boolean {
  return tableName === "schema_migrations";
}

function createCapabilities(kind: DatabaseAdapter["kind"]): DatabaseCapabilities {
  const shared = {
    consistency: "strong",
    maxVectorDimensions: 16_384,
    permissionFiltering: "sql-where",
    publicationStrategy: "projection-table",
    supportsBlueGreenTableSwap: false,
    supportsConcurrentVectorAndFullText: true,
    supportsDenseVector: true,
    supportsFullText: true,
    supportsRecursiveCte: true,
    type: kind,
  } as const;

  if (kind === "tidb") {
    return {
      ...shared,
      estimatedFullTextSearchP99Ms: 20,
      estimatedVectorSearchP99Ms: 30,
      fullTextCjkNative: true,
      maxVectors: 50_000_000,
    };
  }

  return {
    ...shared,
    estimatedFullTextSearchP99Ms: 30,
    estimatedVectorSearchP99Ms: 50,
    fullTextCjkNative: false,
    maxVectors: 5_000_000,
  };
}

function createSchemaSummary(dialect: DatabaseAdapter["dialect"]): DatabaseSchemaSummary {
  const schema = getDatabaseSchema();

  return {
    dialect,
    tables: schema.tables.map((table) => table.name),
    indexes: schema.indexes.map((index) => ({
      columns: [...index.columns],
      name: index.name,
      purpose: index.purpose,
      tableName: index.tableName,
      unique: index.unique === true,
    })),
  };
}

function clonePerformanceStatus(
  status: DatabasePerformanceIndexStatus,
): DatabasePerformanceIndexStatus {
  return {
    ok: status.ok,
    missing: status.missing.map((requirement) => ({ ...requirement })),
  };
}

function planListRows(
  dialect: DatabaseDialect,
  input: DatabaseListRowsInput,
  maxListLimit: number,
): DatabaseQueryPlan {
  validateLimit(input.limit, maxListLimit);

  const schema = getDatabaseSchema();
  const table = requireTable(schema, input.tableName);
  const index = requireIndex(schema, input.indexName, input.tableName);

  if (input.orderBy.length === 0) {
    throw new Error("Database list plans require stable ordering");
  }

  validateColumns(table, [
    ...input.filters.map((filter) => filter.column),
    ...input.orderBy.map((order) => order.column),
  ]);
  validateIndexPrefix(input, index);
  validateCursor(input.cursor?.values, input.orderBy);
  validateStableOrdering(input, index);

  const params: DatabaseQueryValue[] = [];
  const whereClauses = input.filters.map((filter) => {
    params.push(filter.value);
    return `${quoteIdentifier(dialect, filter.column)} = ${placeholder(dialect, params.length)}`;
  });

  if (input.cursor) {
    const cursorParams = input.cursor.values.map((value) => {
      params.push(value);
      return placeholder(dialect, params.length);
    });
    const cursorColumns = input.orderBy.map((order) => quoteIdentifier(dialect, order.column));
    const operator = input.orderBy[0]?.direction === "desc" ? "<" : ">";

    whereClauses.push(`(${cursorColumns.join(", ")}) ${operator} (${cursorParams.join(", ")})`);
  }

  const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";
  const orderSql = input.orderBy
    .map((order) => `${quoteIdentifier(dialect, order.column)} ${order.direction.toUpperCase()}`)
    .join(", ");

  return {
    accessPattern: "indexed-list",
    cursorColumns: input.orderBy.map((order) => order.column),
    indexName: index.name,
    limit: input.limit,
    params,
    sql: `SELECT * FROM ${quoteIdentifier(dialect, input.tableName)}${whereSql} ORDER BY ${orderSql} LIMIT ${input.limit};`,
    tableName: input.tableName,
  };
}

function planBatchGetRows(
  dialect: DatabaseDialect,
  input: DatabaseBatchGetRowsInput,
  maxBatchIds: number,
): DatabaseQueryPlan {
  if (input.ids.length < 1) {
    throw new Error("Database batch ids must include at least 1 id");
  }

  if (input.ids.length > maxBatchIds) {
    throw new Error(`Database batch ids exceed maxBatchIds=${maxBatchIds}`);
  }

  const idColumn = input.idColumn ?? "id";
  const table = requireTable(getDatabaseSchema(), input.tableName);
  const column = table.columns.find((candidate) => candidate.name === idColumn);

  if (!column) {
    throw new Error(`Column ${input.tableName}.${idColumn} is not declared in schema`);
  }

  if (!column.primaryKey) {
    throw new Error(
      `Database batch reads require primary key column ${input.tableName}.${idColumn}`,
    );
  }

  const params = [...input.ids];
  const placeholders = params.map((_, index) => placeholder(dialect, index + 1)).join(", ");

  return {
    accessPattern: "primary-key-batch",
    cursorColumns: [],
    limit: params.length,
    params,
    sql: `SELECT * FROM ${quoteIdentifier(dialect, input.tableName)} WHERE ${quoteIdentifier(dialect, idColumn)} IN (${placeholders});`,
    tableName: input.tableName,
  };
}

function validateLimit(limit: number, maxListLimit: number): void {
  if (!Number.isInteger(limit)) {
    throw new Error("Database list limit must be an integer");
  }

  if (limit < 1) {
    throw new Error("Database list limit must be at least 1");
  }

  if (limit > maxListLimit) {
    throw new Error(`Database list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

function validateIndexPrefix(input: DatabaseListRowsInput, index: IndexDefinition): void {
  const queryColumns = [
    ...input.filters.map((filter) => filter.column),
    ...input.orderBy.map((order) => order.column),
  ];
  const indexPrefix = index.columns.slice(0, queryColumns.length);
  const isPrefixMatch = queryColumns.every(
    (column, indexPosition) => column === indexPrefix[indexPosition],
  );

  if (!isPrefixMatch) {
    throw new Error(`Database list plan must use leading columns of index ${index.name}`);
  }
}

function validateCursor(
  cursorValues: readonly DatabaseQueryValue[] | undefined,
  orderBy: readonly DatabaseQueryOrder[],
): void {
  if (!cursorValues) {
    return;
  }

  if (cursorValues.length !== orderBy.length) {
    throw new Error("Database cursor values must match orderBy columns");
  }

  const directions = new Set(orderBy.map((order) => order.direction));

  if (directions.size > 1) {
    throw new Error("Database cursor plans require one sort direction");
  }
}

function validateStableOrdering(input: DatabaseListRowsInput, index: IndexDefinition): void {
  const orderedColumns = input.orderBy.map((order) => order.column);
  const queryColumns = [...input.filters.map((filter) => filter.column), ...orderedColumns];
  const coversUniqueIndex =
    index.unique === true &&
    index.columns.every((column, indexPosition) => {
      return queryColumns[indexPosition] === column;
    });
  const hasPrimaryKeyTieBreaker = orderedColumns.at(-1) === "id";

  if (!coversUniqueIndex && !hasPrimaryKeyTieBreaker) {
    throw new Error("Database list plans require unique ordering or id tie-breaker");
  }
}

function validateColumns(table: TableDefinition, columns: readonly string[]): void {
  const declaredColumns = new Set(table.columns.map((column) => column.name));

  for (const column of columns) {
    if (!declaredColumns.has(column)) {
      throw new Error(`Column ${table.name}.${column} is not declared in schema`);
    }
  }
}

function requireTable(schema: DatabaseSchemaCatalog, tableName: string): TableDefinition {
  const table = schema.tables.find((candidate) => candidate.name === tableName);

  if (!table) {
    throw new Error(`Table ${tableName} is not declared in schema`);
  }

  return table;
}

function requireIndex(
  schema: DatabaseSchemaCatalog,
  indexName: string,
  tableName: string,
): IndexDefinition {
  const index = schema.indexes.find((candidate) => candidate.name === indexName);

  if (!index) {
    throw new Error(`Index ${indexName} is not declared in schema`);
  }

  if (index.tableName !== tableName) {
    throw new Error(`Index ${indexName} does not belong to table ${tableName}`);
  }

  return index;
}

function quoteIdentifier(dialect: DatabaseDialect, identifier: string): string {
  return dialect === "postgres"
    ? `"${identifier.replaceAll('"', '""')}"`
    : `\`${identifier.replaceAll("`", "``")}\``;
}

function placeholder(dialect: DatabaseDialect, position: number): string {
  return dialect === "postgres" ? `$${position}` : "?";
}
