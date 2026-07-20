import type { DatabaseAdapter } from "@knowledge/core";
import { getPendingMigrationArtifacts, renderSchemaMigrationsTableSql } from "@knowledge/database";

export interface RunDatabaseMigrationsInput {
  readonly database: DatabaseAdapter;
  readonly maxMigrationRecords?: number;
  readonly now?: () => string;
}

export interface RunDatabaseMigrationsResult {
  readonly appliedMigrationIds: readonly string[];
  readonly pendingBeforeRun: number;
}

const defaultMaxMigrationRecords = 10_000;
const defaultNow = () => new Date().toISOString();
const tidbCheckConstraintMigrationId = "0005_publication_generation_nonzero";
const tidbForeignKeyMigrationId = "0006_document_compilation_attempts";
const minimumTidbCheckConstraintVersion = [7, 2] as const;
const minimumTidbForeignKeyVersion = [8, 5] as const;
const compilationForeignKeyTables = [
  {
    expectedForeignKeys: [
      "document_compilation_attempts_asset_version_fk",
      "document_compilation_attempts_candidate_fk",
      "document_compilation_attempts_space_fk",
    ],
    tableName: "document_compilation_attempts",
  },
  {
    expectedForeignKeys: ["document_compilation_outbox_attempt_fk"],
    tableName: "document_compilation_outbox",
  },
] as const;

export async function runDatabaseMigrations({
  database,
  maxMigrationRecords = defaultMaxMigrationRecords,
  now = defaultNow,
}: RunDatabaseMigrationsInput): Promise<RunDatabaseMigrationsResult> {
  if (!Number.isInteger(maxMigrationRecords) || maxMigrationRecords < 1) {
    throw new Error("Migration runner maxMigrationRecords must be at least 1");
  }

  await database.execute({
    maxRows: 0,
    operation: "schema",
    params: [],
    sql: renderSchemaMigrationsTableSql(database.dialect),
    tableName: "schema_migrations",
  });

  const appliedResult = await database.execute({
    maxRows: maxMigrationRecords,
    operation: "select",
    params: [database.dialect],
    sql: `SELECT ${quoteIdentifier(database, "migration_id")} FROM ${quoteIdentifier(
      database,
      "schema_migrations",
    )} WHERE ${quoteIdentifier(database, "dialect")} = ${placeholder(
      database,
      1,
    )} ORDER BY ${quoteIdentifier(database, "migration_id")} ASC;`,
    tableName: "schema_migrations",
  });
  const appliedMigrationIds = appliedResult.rows.map(readMigrationId);
  const pendingArtifacts = getPendingMigrationArtifacts({
    appliedMigrationIds,
    dialect: database.dialect,
  });
  const appliedNow: string[] = [];
  const requiresTidbCheckConstraints =
    appliedMigrationIds.includes(tidbCheckConstraintMigrationId) ||
    pendingArtifacts.some(
      (artifact) => migrationIdFromPath(artifact.path) === tidbCheckConstraintMigrationId,
    );
  const requiresTidbForeignKeys =
    appliedMigrationIds.includes(tidbForeignKeyMigrationId) ||
    pendingArtifacts.some(
      (artifact) => migrationIdFromPath(artifact.path) === tidbForeignKeyMigrationId,
    );

  if (database.dialect === "tidb" && requiresTidbCheckConstraints) {
    await assertTidbConstraintEnforcement(database, requiresTidbForeignKeys);
  }

  for (const artifact of pendingArtifacts) {
    const migrationId = migrationIdFromPath(artifact.path);

    if (migrationId === tidbForeignKeyMigrationId) {
      await assertCompilationTenantIdsFit(database);
    }

    await database.execute({
      maxRows: 0,
      operation: "schema",
      params: [],
      sql: artifact.content,
      tableName: "schema_migrations",
    });
    await database.execute({
      maxRows: 0,
      operation: "insert",
      params: [migrationId, database.dialect, now()],
      sql: `INSERT INTO ${quoteIdentifier(database, "schema_migrations")} (${[
        "migration_id",
        "dialect",
        "applied_at",
      ]
        .map((column) => quoteIdentifier(database, column))
        .join(", ")}) VALUES (${[1, 2, 3]
        .map((position) => placeholder(database, position))
        .join(", ")});`,
      tableName: "schema_migrations",
    });
    appliedNow.push(migrationId);
  }

  if (database.dialect === "tidb" && requiresTidbForeignKeys) {
    await assertTidbCompilationForeignKeys(database);
  }

  return {
    appliedMigrationIds: appliedNow,
    pendingBeforeRun: pendingArtifacts.length,
  };
}

async function assertCompilationTenantIdsFit(database: DatabaseAdapter): Promise<void> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [],
    sql: `SELECT ${quoteIdentifier(database, "tenant_id")} FROM ${quoteIdentifier(
      database,
      "knowledge_spaces",
    )} WHERE CHAR_LENGTH(${quoteIdentifier(database, "tenant_id")}) > 255 LIMIT 1;`,
    tableName: "knowledge_spaces",
  });

  if (result.rows.length > 0) {
    throw new Error(
      `Migration ${tidbForeignKeyMigrationId} cannot narrow knowledge_spaces.tenant_id to VARCHAR(255) while values longer than 255 characters exist`,
    );
  }
}

async function assertTidbConstraintEnforcement(
  database: DatabaseAdapter,
  requireForeignKeys: boolean,
): Promise<void> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [],
    sql: `SELECT VERSION() AS tidb_version,
      @@tidb_enable_check_constraint AS check_constraint_enabled,
      @@GLOBAL.tidb_enable_foreign_key AS foreign_key_enabled,
      @@SESSION.foreign_key_checks AS foreign_key_checks_enabled;`,
    tableName: "schema_migrations",
  });
  const row = result.rows[0];
  const rawVersion = row?.tidb_version;
  const version = parseTidbVersion(rawVersion);

  if (!version || !isMinimumTidbVersion(version, minimumTidbCheckConstraintVersion)) {
    throw new Error(
      `TiDB migration ${tidbCheckConstraintMigrationId} requires TiDB 7.2 or newer; received VERSION()=${formatPreflightValue(rawVersion)}`,
    );
  }

  const checkConstraintEnabled = row?.check_constraint_enabled;
  if (!isCheckConstraintEnabled(checkConstraintEnabled)) {
    throw new Error(
      `TiDB migration ${tidbCheckConstraintMigrationId} requires @@tidb_enable_check_constraint to be ON/1; received ${formatPreflightValue(checkConstraintEnabled)}`,
    );
  }

  if (requireForeignKeys && !isMinimumTidbVersion(version, minimumTidbForeignKeyVersion)) {
    throw new Error(
      `TiDB migration ${tidbForeignKeyMigrationId} requires TiDB 8.5 or newer for generally available foreign-key enforcement; received VERSION()=${formatPreflightValue(rawVersion)}`,
    );
  }

  if (requireForeignKeys && !isConstraintEnabled(row?.foreign_key_enabled)) {
    throw new Error(
      `TiDB migration ${tidbForeignKeyMigrationId} requires @@GLOBAL.tidb_enable_foreign_key to be ON/1; received ${formatPreflightValue(row?.foreign_key_enabled)}`,
    );
  }
  if (requireForeignKeys && !isConstraintEnabled(row?.foreign_key_checks_enabled)) {
    throw new Error(
      `TiDB migration ${tidbForeignKeyMigrationId} requires @@SESSION.foreign_key_checks to be ON/1; received ${formatPreflightValue(row?.foreign_key_checks_enabled)}`,
    );
  }
}

async function assertTidbCompilationForeignKeys(database: DatabaseAdapter): Promise<void> {
  for (const table of compilationForeignKeyTables) {
    const result = await database.execute({
      maxRows: 1,
      operation: "select",
      params: [],
      sql: `SHOW CREATE TABLE ${quoteIdentifier(database, table.tableName)};`,
      tableName: table.tableName,
    });
    const createSql = readShowCreateTable(result.rows[0]);
    const foreignKeyNames = [
      ...createSql.matchAll(/\bCONSTRAINT\s+[`"]?([^`"\s]+)[`"]?\s+FOREIGN\s+KEY\b/giu),
    ]
      .map((match) => match[1] ?? "")
      .filter(Boolean)
      .sort();
    const expectedForeignKeys = [...table.expectedForeignKeys].sort();
    if (
      !createSql ||
      /FOREIGN\s+KEY\s+INVALID/iu.test(createSql) ||
      foreignKeyNames.length !== expectedForeignKeys.length ||
      foreignKeyNames.some((name, index) => name !== expectedForeignKeys[index])
    ) {
      throw new Error(
        `TiDB migration ${tidbForeignKeyMigrationId} requires ${expectedForeignKeys.length} valid FOREIGN KEY constraints on ${table.tableName} with names ${expectedForeignKeys.join(", ")}; observed ${foreignKeyNames.join(", ") || "none"}`,
      );
    }
  }
}

function parseTidbVersion(value: unknown): readonly [number, number] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = /TiDB-v(\d+)\.(\d+)(?:\.\d+)?/i.exec(value);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2])];
}

function isMinimumTidbVersion(
  actual: readonly [number, number],
  minimum: readonly [number, number],
): boolean {
  return actual[0] > minimum[0] || (actual[0] === minimum[0] && actual[1] >= minimum[1]);
}

function isCheckConstraintEnabled(value: unknown): boolean {
  return isConstraintEnabled(value);
}

function isConstraintEnabled(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    (typeof value === "string" && ["1", "ON"].includes(value.toUpperCase()))
  );
}

function readShowCreateTable(row: Readonly<Record<string, unknown>> | undefined): string {
  if (!row) {
    return "";
  }
  for (const [key, value] of Object.entries(row)) {
    if (key.toLowerCase().replaceAll("_", " ") === "create table" && typeof value === "string") {
      return value;
    }
  }
  return "";
}

function formatPreflightValue(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function readMigrationId(row: Readonly<Record<string, unknown>>): string {
  const value = row.migration_id;

  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Migration runner received an invalid schema_migrations row");
  }

  return value;
}

function migrationIdFromPath(path: string): string {
  const filename = path.split("/").at(-1) ?? path;
  const [migrationId] = filename.split(".");

  if (!migrationId) {
    throw new Error(`Invalid migration artifact path: ${path}`);
  }

  return migrationId;
}

function quoteIdentifier(database: DatabaseAdapter, identifier: string): string {
  if (database.dialect === "postgres") {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  return `\`${identifier.replace(/`/g, "``")}\``;
}

function placeholder(database: DatabaseAdapter, position: number): string {
  return database.dialect === "postgres" ? `$${position}` : "?";
}
