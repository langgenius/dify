import { describe, expect, it } from "vitest";

import { createCloudflarePlatformAdapter } from "./cloudflare";
import { createSchemaDatabaseAdapter } from "./database";
import { createNodePlatformAdapter } from "./node";
import { type PostgresPoolLike, createPostgresDatabaseExecutor } from "./postgres";

describe("schema database adapter", () => {
  it("exposes a PostgreSQL schema contract with deterministic migration SQL", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres" });

    await expect(database.health()).resolves.toBe(true);
    const summary = await database.getSchemaSummary();

    expect(summary.dialect).toBe("postgres");
    expectCoreSchemaTables(summary.tables);
    const migration = await database.renderMigrationSql();

    expect(migration[0]).toContain('CREATE TABLE IF NOT EXISTS "knowledge_spaces"');
    expect(migration.some((statement) => statement.includes("USING GIN"))).toBe(true);
  });

  it("exposes a TiDB schema contract without PostgreSQL-only index syntax", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "tidb" });
    const summary = await database.getSchemaSummary();
    const migration = await database.renderMigrationSql();

    expect(summary.dialect).toBe("tidb");
    expectCoreSchemaTables(summary.tables);
    expect(migration[0]).toContain("CREATE TABLE IF NOT EXISTS `knowledge_spaces`");
    expect(migration.some((statement) => statement.includes("USING GIN"))).toBe(false);
  });

  it("checks required performance indexes through the adapter contract", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres" });

    await expect(database.checkPerformanceIndexes()).resolves.toEqual({
      ok: true,
      missing: [],
    });
  });

  it("returns cloned schema summaries so callers cannot mutate retained adapter state", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres" });
    const firstSummary = await database.getSchemaSummary();
    const expectedFirstIndexName = firstSummary.indexes[0]?.name;

    (firstSummary.tables as string[]).push("caller_mutation");
    (firstSummary.indexes as unknown as Array<{ name: string }>)[0] = {
      name: "caller_mutation",
    };

    const secondSummary = await database.getSchemaSummary();

    expect(secondSummary.tables).not.toContain("caller_mutation");
    expect(secondSummary.indexes[0]?.name).toBe(expectedFirstIndexName);
  });

  it("executes bounded SQL through an injected executor without changing schema behavior", async () => {
    const calls: unknown[] = [];
    const database = createSchemaDatabaseAdapter({
      kind: "postgres",
      executor: async (input) => {
        calls.push(input);

        return {
          rows: [{ id: "space-1", tenant_id: input.params[0] }],
          rowsAffected: 1,
        };
      },
    });

    const result = await database.execute({
      maxRows: 1,
      operation: "select",
      params: ["tenant-1"],
      sql: 'SELECT * FROM "knowledge_spaces" WHERE "tenant_id" = $1 LIMIT 1;',
      tableName: "knowledge_spaces",
    });

    expect(result).toEqual({
      rows: [{ id: "space-1", tenant_id: "tenant-1" }],
      rowsAffected: 1,
    });
    expect(calls).toEqual([
      {
        maxRows: 1,
        operation: "select",
        params: ["tenant-1"],
        sql: 'SELECT * FROM "knowledge_spaces" WHERE "tenant_id" = $1 LIMIT 1;',
        tableName: "knowledge_spaces",
      },
    ]);
    await expect(database.getSchemaSummary()).resolves.toMatchObject({ dialect: "postgres" });
  });

  it("rejects unbounded reads and missing executors explicitly", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres" });
    const input = {
      operation: "select",
      params: ["tenant-1"],
      sql: 'SELECT * FROM "knowledge_spaces" WHERE "tenant_id" = $1;',
      tableName: "knowledge_spaces",
    } as const;

    await expect(database.execute({ ...input, maxRows: 0 })).rejects.toThrow(
      "Database read execution requires maxRows >= 1",
    );
    await expect(database.execute({ ...input, maxRows: 1 })).rejects.toThrow(
      "Database executor is not configured",
    );
  });

  it("fails closed when a transaction runner is not configured", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "tidb" });

    await expect(database.transaction(async () => "unreachable")).rejects.toThrow(
      "Database transactions are not configured for tidb",
    );
  });

  it("runs configured schema transactions through their fenced executor", async () => {
    const database = createSchemaDatabaseAdapter({
      kind: "postgres",
      transaction: async (callback) =>
        callback({
          execute: async (input) => ({
            rows: [{ operation: input.operation }],
            rowsAffected: 1,
          }),
        }),
    });

    await expect(
      database.transaction((transaction) =>
        transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [],
          sql: "SELECT 1;",
          tableName: "schema_migrations",
        }),
      ),
    ).resolves.toEqual({ rows: [{ operation: "select" }], rowsAffected: 1 });
  });

  it("rejects invalid executor bounds and excess rows", async () => {
    const database = createSchemaDatabaseAdapter({
      executor: async () => ({ rows: [{ id: 1 }, { id: 2 }], rowsAffected: 2 }),
      kind: "postgres",
    });
    const input = {
      operation: "schema",
      params: [],
      sql: "SELECT 1;",
      tableName: "schema_migrations",
    } as const;

    await expect(database.execute({ ...input, maxRows: 1.5 })).rejects.toThrow(
      "Database execution maxRows must be an integer",
    );
    await expect(database.execute({ ...input, maxRows: -1 })).rejects.toThrow(
      "Database execution maxRows must be nonnegative",
    );
    await expect(database.execute({ ...input, maxRows: 1 })).rejects.toThrow(
      "Database executor returned more rows than maxRows=1",
    );
  });

  it("describes PostgreSQL retrieval capabilities for planner decisions", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres" });

    await expect(database.getCapabilities()).resolves.toEqual({
      consistency: "strong",
      estimatedFullTextSearchP99Ms: 30,
      estimatedVectorSearchP99Ms: 50,
      fullTextCjkNative: false,
      maxVectorDimensions: 16_384,
      maxVectors: 5_000_000,
      permissionFiltering: "sql-where",
      publicationStrategy: "projection-table",
      supportsBlueGreenTableSwap: false,
      supportsConcurrentVectorAndFullText: true,
      supportsDenseVector: true,
      supportsFullText: true,
      supportsRecursiveCte: true,
      type: "postgres",
    });
  });

  it("describes TiDB retrieval capabilities with native CJK full-text support", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "tidb" });

    await expect(database.getCapabilities()).resolves.toMatchObject({
      estimatedFullTextSearchP99Ms: 20,
      estimatedVectorSearchP99Ms: 30,
      fullTextCjkNative: true,
      maxVectors: 50_000_000,
      supportsConcurrentVectorAndFullText: true,
      supportsDenseVector: true,
      supportsFullText: true,
      supportsRecursiveCte: true,
      type: "tidb",
    });
  });

  it("plans bounded PostgreSQL list queries against an explicit covering index", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxListLimit: 50 });

    const plan = await database.planListRows({
      tableName: "document_assets",
      indexName: "document_assets_space_status_created_idx",
      filters: [
        { column: "knowledge_space_id", operator: "eq", value: "space-1" },
        { column: "parser_status", operator: "eq", value: "parsed" },
      ],
      orderBy: [
        { column: "created_at", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
      limit: 20,
    });

    expect(plan).toEqual({
      accessPattern: "indexed-list",
      cursorColumns: ["created_at", "id"],
      indexName: "document_assets_space_status_created_idx",
      limit: 20,
      params: ["space-1", "parsed"],
      sql: 'SELECT * FROM "document_assets" WHERE "knowledge_space_id" = $1 AND "parser_status" = $2 ORDER BY "created_at" ASC, "id" ASC LIMIT 20;',
      tableName: "document_assets",
    });
  });

  it("adds stable cursor predicates with a primary-key tie-breaker to bounded list plans", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxListLimit: 50 });

    const plan = await database.planListRows({
      tableName: "document_assets",
      indexName: "document_assets_space_status_created_idx",
      filters: [
        { column: "knowledge_space_id", operator: "eq", value: "space-1" },
        { column: "parser_status", operator: "eq", value: "parsed" },
      ],
      orderBy: [
        { column: "created_at", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
      cursor: { values: ["2026-05-08T00:00:00.000Z", "asset-1"] },
      limit: 20,
    });

    expect(plan.params).toEqual(["space-1", "parsed", "2026-05-08T00:00:00.000Z", "asset-1"]);
    expect(plan.sql).toBe(
      'SELECT * FROM "document_assets" WHERE "knowledge_space_id" = $1 AND "parser_status" = $2 AND ("created_at", "id") > ($3, $4) ORDER BY "created_at" ASC, "id" ASC LIMIT 20;',
    );
  });

  it("plans unfiltered unique-index scans and descending cursors", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxListLimit: 50 });
    const input = {
      tableName: "knowledge_spaces",
      indexName: "knowledge_spaces_tenant_slug_uq",
      filters: [],
      orderBy: [
        { column: "tenant_id", direction: "desc" },
        { column: "slug", direction: "desc" },
      ],
      limit: 10,
    } as const;

    await expect(database.planListRows(input)).resolves.toMatchObject({
      params: [],
      sql: 'SELECT * FROM "knowledge_spaces" ORDER BY "tenant_id" DESC, "slug" DESC LIMIT 10;',
    });
    await expect(
      database.planListRows({ ...input, cursor: { values: ["tenant-z", "space-z"] } }),
    ).resolves.toMatchObject({
      params: ["tenant-z", "space-z"],
      sql: 'SELECT * FROM "knowledge_spaces" WHERE ("tenant_id", "slug") < ($1, $2) ORDER BY "tenant_id" DESC, "slug" DESC LIMIT 10;',
    });
  });

  it("rejects non-unique list ordering that cannot produce stable keyset pagination", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxListLimit: 50 });

    await expect(
      database.planListRows({
        tableName: "document_assets",
        indexName: "document_assets_space_status_created_idx",
        filters: [
          { column: "knowledge_space_id", operator: "eq", value: "space-1" },
          { column: "parser_status", operator: "eq", value: "parsed" },
        ],
        orderBy: [{ column: "created_at", direction: "asc" }],
        cursor: { values: ["2026-05-08T00:00:00.000Z"] },
        limit: 20,
      }),
    ).rejects.toThrow("Database list plans require unique ordering or id tie-breaker");
  });

  it("plans TiDB list queries with TiDB quoting and placeholders", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "tidb", maxListLimit: 50 });

    const plan = await database.planListRows({
      tableName: "knowledge_paths",
      indexName: "knowledge_paths_space_view_path_idx",
      filters: [
        { column: "knowledge_space_id", operator: "eq", value: "space-1" },
        {
          column: "publication_generation_id",
          operator: "eq",
          value: "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
        },
        { column: "view_type", operator: "eq", value: "physical" },
        { column: "view_name", operator: "eq", value: "source" },
      ],
      orderBy: [
        { column: "virtual_path", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
      cursor: { values: ["/sources/a", "path-1"] },
      limit: 10,
    });

    expect(plan.sql).toBe(
      "SELECT * FROM `knowledge_paths` WHERE `knowledge_space_id` = ? AND `publication_generation_id` = ? AND `view_type` = ? AND `view_name` = ? AND (`virtual_path`, `id`) > (?, ?) ORDER BY `virtual_path` ASC, `id` ASC LIMIT 10;",
    );
    expect(plan.params).toEqual([
      "space-1",
      "018f0d60-7a49-7cc2-9c1b-5b36f18f2c42",
      "physical",
      "source",
      "/sources/a",
      "path-1",
    ]);
  });

  it("rejects unbounded or oversized list plans", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxListLimit: 20 });
    const input = {
      tableName: "document_assets",
      indexName: "document_assets_space_status_created_idx",
      filters: [
        { column: "knowledge_space_id", operator: "eq", value: "space-1" },
        { column: "parser_status", operator: "eq", value: "parsed" },
      ],
      orderBy: [
        { column: "created_at", direction: "asc" },
        { column: "id", direction: "asc" },
      ],
    } as const;

    await expect(database.planListRows({ ...input, limit: 0 })).rejects.toThrow(
      "Database list limit must be at least 1",
    );
    await expect(database.planListRows({ ...input, limit: 21 })).rejects.toThrow(
      "Database list limit exceeds maxListLimit=20",
    );
  });

  it("rejects list plans that do not match a covering index prefix", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxListLimit: 20 });

    await expect(
      database.planListRows({
        tableName: "document_assets",
        indexName: "document_assets_space_status_created_idx",
        filters: [{ column: "parser_status", operator: "eq", value: "parsed" }],
        orderBy: [
          { column: "created_at", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: 10,
      }),
    ).rejects.toThrow(
      "Database list plan must use leading columns of index document_assets_space_status_created_idx",
    );
  });

  it("rejects list plans with missing stable ordering, unknown schema objects, or bad cursors", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxListLimit: 20 });

    await expect(
      database.planListRows({
        tableName: "document_assets",
        indexName: "document_assets_space_status_created_idx",
        filters: [
          { column: "knowledge_space_id", operator: "eq", value: "space-1" },
          { column: "parser_status", operator: "eq", value: "parsed" },
        ],
        orderBy: [],
        limit: 10,
      }),
    ).rejects.toThrow("Database list plans require stable ordering");

    await expect(
      database.planListRows({
        tableName: "missing_table",
        indexName: "document_assets_space_status_created_idx",
        filters: [],
        orderBy: [
          { column: "created_at", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: 10,
      }),
    ).rejects.toThrow("Table missing_table is not declared in schema");

    await expect(
      database.planListRows({
        tableName: "document_assets",
        indexName: "missing_index",
        filters: [],
        orderBy: [
          { column: "created_at", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: 10,
      }),
    ).rejects.toThrow("Index missing_index is not declared in schema");

    await expect(
      database.planListRows({
        tableName: "document_assets",
        indexName: "knowledge_nodes_artifact_offset_idx",
        filters: [],
        orderBy: [
          { column: "created_at", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: 10,
      }),
    ).rejects.toThrow(
      "Index knowledge_nodes_artifact_offset_idx does not belong to table document_assets",
    );
  });

  it("rejects invalid list columns, cursor shapes, and non-integer limits", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxListLimit: 20 });

    await expect(
      database.planListRows({
        tableName: "document_assets",
        indexName: "document_assets_space_status_created_idx",
        filters: [{ column: "missing_column", operator: "eq", value: "space-1" }],
        orderBy: [
          { column: "created_at", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        limit: 10,
      }),
    ).rejects.toThrow("Column document_assets.missing_column is not declared in schema");

    await expect(
      database.planListRows({
        tableName: "document_assets",
        indexName: "document_assets_space_status_created_idx",
        filters: [
          { column: "knowledge_space_id", operator: "eq", value: "space-1" },
          { column: "parser_status", operator: "eq", value: "parsed" },
        ],
        orderBy: [
          { column: "created_at", direction: "asc" },
          { column: "id", direction: "asc" },
        ],
        cursor: { values: ["2026-05-08T00:00:00.000Z"] },
        limit: 10,
      }),
    ).rejects.toThrow("Database cursor values must match orderBy columns");

    await expect(
      database.planListRows({
        tableName: "document_assets",
        indexName: "document_assets_space_source_version_idx",
        filters: [{ column: "knowledge_space_id", operator: "eq", value: "space-1" }],
        orderBy: [
          { column: "source_id", direction: "asc" },
          { column: "version", direction: "desc" },
        ],
        cursor: { values: ["source-1", 1] },
        limit: 10,
      }),
    ).rejects.toThrow("Database cursor plans require one sort direction");

    await expect(
      database.planListRows({
        tableName: "document_assets",
        indexName: "document_assets_space_status_created_idx",
        filters: [
          { column: "knowledge_space_id", operator: "eq", value: "space-1" },
          { column: "parser_status", operator: "eq", value: "parsed" },
        ],
        orderBy: [{ column: "created_at", direction: "asc" }],
        limit: 1.5,
      }),
    ).rejects.toThrow("Database list limit must be an integer");
  });

  it("plans bounded primary-key batch reads without per-row query waterfalls", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxBatchIds: 3 });

    const plan = await database.planBatchGetRows({
      tableName: "knowledge_nodes",
      ids: ["node-1", "node-2"],
    });

    expect(plan).toEqual({
      accessPattern: "primary-key-batch",
      cursorColumns: [],
      limit: 2,
      params: ["node-1", "node-2"],
      sql: 'SELECT * FROM "knowledge_nodes" WHERE "id" IN ($1, $2);',
      tableName: "knowledge_nodes",
    });
  });

  it("rejects empty or oversized batch reads", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxBatchIds: 2 });

    await expect(
      database.planBatchGetRows({ tableName: "knowledge_nodes", ids: [] }),
    ).rejects.toThrow("Database batch ids must include at least 1 id");
    await expect(
      database.planBatchGetRows({ tableName: "knowledge_nodes", ids: ["a", "b", "c"] }),
    ).rejects.toThrow("Database batch ids exceed maxBatchIds=2");
  });

  it("rejects batch reads on unknown tables or non-primary-key columns", async () => {
    const database = createSchemaDatabaseAdapter({ kind: "postgres", maxBatchIds: 2 });

    await expect(
      database.planBatchGetRows({ tableName: "missing_table", ids: ["a"] }),
    ).rejects.toThrow("Table missing_table is not declared in schema");
    await expect(
      database.planBatchGetRows({
        tableName: "knowledge_nodes",
        idColumn: "missing_column",
        ids: ["a"],
      }),
    ).rejects.toThrow("Column knowledge_nodes.missing_column is not declared in schema");
    await expect(
      database.planBatchGetRows({
        tableName: "knowledge_nodes",
        idColumn: "document_asset_id",
        ids: ["a"],
      }),
    ).rejects.toThrow(
      "Database batch reads require primary key column knowledge_nodes.document_asset_id",
    );
  });

  it("rejects invalid bounded query planner configuration", () => {
    expect(() => createSchemaDatabaseAdapter({ kind: "postgres", maxListLimit: 0 })).toThrow(
      "Database maxListLimit must be at least 1",
    );
    expect(() => createSchemaDatabaseAdapter({ kind: "postgres", maxBatchIds: 0 })).toThrow(
      "Database maxBatchIds must be at least 1",
    );
  });
});

function expectCoreSchemaTables(tables: readonly string[]): void {
  expect(tables).toEqual(
    expect.arrayContaining([
      "knowledge_spaces",
      "knowledge_space_manifests",
      "knowledge_space_profile_revisions",
      "knowledge_space_profile_heads",
      "sources",
      "source_credential_backfills",
      "source_secret_lifecycle_refs",
      "source_workflow_runs",
      "resource_mounts",
      "document_assets",
      "logical_documents",
      "document_revisions",
      "quality_replay_runs",
    ]),
  );
  expect(new Set(tables).size).toBe(tables.length);
  expect(tables[0]).toBe("knowledge_spaces");
  for (const child of [
    "knowledge_space_manifests",
    "knowledge_space_profile_revisions",
    "sources",
    "document_assets",
  ]) {
    expect(tables.indexOf("knowledge_spaces")).toBeLessThan(tables.indexOf(child));
  }
  expect(tables.indexOf("knowledge_space_profile_revisions")).toBeLessThan(
    tables.indexOf("knowledge_space_profile_heads"),
  );
  expect(tables.indexOf("logical_documents")).toBeLessThan(tables.indexOf("document_revisions"));
}

describe("platform database skeletons", () => {
  it("wires the Node adapter to the PostgreSQL schema database contract", async () => {
    const adapter = createNodePlatformAdapter();

    expect(adapter.database.kind).toBe("postgres");
    await expect(adapter.database.checkPerformanceIndexes()).resolves.toMatchObject({ ok: true });
    await expect(adapter.database.getCapabilities()).resolves.toMatchObject({
      fullTextCjkNative: false,
      type: "postgres",
    });
  });

  it("wires the Cloudflare adapter to the TiDB schema database contract", async () => {
    const adapter = createCloudflarePlatformAdapter();

    expect(adapter.database.kind).toBe("tidb");
    await expect(adapter.database.getSchemaSummary()).resolves.toMatchObject({ dialect: "tidb" });
    await expect(adapter.database.getCapabilities()).resolves.toMatchObject({
      fullTextCjkNative: true,
      type: "tidb",
    });
  });
});

describe("PostgreSQL database executor", () => {
  it("executes parameterized SQL through a pool and returns cloned rows", async () => {
    const calls: unknown[] = [];
    const pool: PostgresPoolLike = {
      query: async (query) => {
        calls.push(query);

        return {
          rowCount: 1,
          rows: [{ id: "space-1", tenant_id: query.values[0] }],
        };
      },
    };
    const executor = createPostgresDatabaseExecutor({ pool });
    const params = ["tenant-1"] as const;

    const result = await executor.execute({
      maxRows: 1,
      operation: "select",
      params,
      sql: 'SELECT * FROM "knowledge_spaces" WHERE "tenant_id" = $1 LIMIT 1;',
      tableName: "knowledge_spaces",
    });

    expect(calls).toEqual([
      {
        text: 'SELECT * FROM "knowledge_spaces" WHERE "tenant_id" = $1 LIMIT 1;',
        values: ["tenant-1"],
      },
    ]);
    expect(result).toEqual({
      rows: [{ id: "space-1", tenant_id: "tenant-1" }],
      rowsAffected: 1,
    });

    (result.rows as Array<Record<string, unknown>>)[0] = { id: "caller-mutation" };
    await expect(
      executor.execute({
        maxRows: 1,
        operation: "select",
        params,
        sql: 'SELECT * FROM "knowledge_spaces" WHERE "tenant_id" = $1 LIMIT 1;',
        tableName: "knowledge_spaces",
      }),
    ).resolves.toMatchObject({
      rows: [{ id: "space-1", tenant_id: "tenant-1" }],
    });
  });

  it("normalizes PostgreSQL timestamp rows to API date-time strings", async () => {
    const timestamp = new Date("2026-05-26T10:40:00.000Z");
    const executor = createPostgresDatabaseExecutor({
      pool: {
        query: async () => ({
          rowCount: 1,
          rows: [{ created_at: timestamp, id: "space-1" }],
        }),
      },
    });

    await expect(
      executor.execute({
        maxRows: 1,
        operation: "select",
        params: [],
        sql: 'SELECT * FROM "knowledge_spaces" LIMIT 1;',
        tableName: "knowledge_spaces",
      }),
    ).resolves.toEqual({
      rows: [{ created_at: "2026-05-26T10:40:00.000Z", id: "space-1" }],
      rowsAffected: 1,
    });
  });

  it("runs transaction work on one connection and commits before releasing it", async () => {
    const calls: string[] = [];
    const releases: Array<Error | boolean | undefined> = [];
    const executor = createPostgresDatabaseExecutor({
      pool: {
        connect: async () => ({
          query: async ({ text }) => {
            calls.push(text);

            return text === "SELECT 1;"
              ? { rowCount: 1, rows: [{ value: 1 }] }
              : { rowCount: 0, rows: [] };
          },
          release: (error) => releases.push(error),
        }),
        query: async () => ({ rowCount: 0, rows: [] }),
      },
    });

    const result = await executor.transaction((transaction) =>
      transaction.execute({
        maxRows: 1,
        operation: "select",
        params: [],
        sql: "SELECT 1;",
        tableName: "knowledge_spaces",
      }),
    );

    expect(result).toEqual({ rows: [{ value: 1 }], rowsAffected: 1 });
    expect(calls).toEqual(["BEGIN", "SELECT 1;", "COMMIT"]);
    expect(releases).toEqual([undefined]);
  });

  it("rolls back callback failures and preserves the original error", async () => {
    const calls: string[] = [];
    const releases: Array<Error | boolean | undefined> = [];
    const operationError = new Error("publish failed");
    const executor = createPostgresDatabaseExecutor({
      pool: {
        connect: async () => ({
          query: async ({ text }) => {
            calls.push(text);

            return { rowCount: 0, rows: [] };
          },
          release: (error) => releases.push(error),
        }),
        query: async () => ({ rowCount: 0, rows: [] }),
      },
    });

    await expect(
      executor.transaction(async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);
    expect(calls).toEqual(["BEGIN", "ROLLBACK"]);
    expect(releases).toEqual([undefined]);
  });

  it("discards a connection when rollback fails while preserving the operation error", async () => {
    const calls: string[] = [];
    const releases: Array<Error | boolean | undefined> = [];
    const operationError = new Error("publish failed");
    const rollbackError = new Error("rollback failed");
    const executor = createPostgresDatabaseExecutor({
      pool: {
        connect: async () => ({
          query: async ({ text }) => {
            calls.push(text);
            if (text === "ROLLBACK") {
              throw rollbackError;
            }

            return { rowCount: 0, rows: [] };
          },
          release: (error) => releases.push(error),
        }),
        query: async () => ({ rowCount: 0, rows: [] }),
      },
    });

    await expect(
      executor.transaction(async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);
    expect(calls).toEqual(["BEGIN", "ROLLBACK"]);
    expect(releases).toEqual([rollbackError]);
  });

  it("rejects transactions when the pool cannot lease a connection", async () => {
    const executor = createPostgresDatabaseExecutor({
      pool: { query: async () => ({ rowCount: 0, rows: [] }) },
    });

    await expect(executor.transaction(async () => undefined)).rejects.toThrow(
      "PostgreSQL transactions require a connection-capable pool",
    );
  });

  it("wires the Node adapter to PostgreSQL when DATABASE_URL is configured", async () => {
    const calls: unknown[] = [];
    let closed = false;
    const pool: PostgresPoolLike = {
      end: async () => {
        closed = true;
      },
      query: async (query) => {
        calls.push(query);

        return {
          rowCount: query.text === "SELECT 1;" ? 1 : 0,
          rows: query.text === "SELECT 1;" ? [{ "?column?": 1 }] : [],
        };
      },
    };
    const adapter = createNodePlatformAdapter({
      databasePool: pool,
      env: { DATABASE_URL: "postgresql://user:pass@localhost:5432/knowledge_fs" },
    });

    await expect(adapter.database.health()).resolves.toBe(true);
    await expect(
      adapter.database.execute({
        maxRows: 0,
        operation: "schema",
        params: [],
        sql: "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY);",
        tableName: "schema_migrations",
      }),
    ).resolves.toEqual({ rows: [], rowsAffected: 0 });
    await adapter.database.close?.();

    expect(calls).toEqual([
      { text: "SELECT 1;", values: [] },
      {
        text: "CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY);",
        values: [],
      },
    ]);
    expect(closed).toBe(true);
  });
});
