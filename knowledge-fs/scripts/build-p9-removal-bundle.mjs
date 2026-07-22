import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LEGACY_AUTHORIZATION_TABLES = Object.freeze([
  "knowledge_space_access_policies",
  "knowledge_space_access_policy_members",
  "knowledge_space_api_access",
  "knowledge_space_api_keys",
  "knowledge_space_members",
  "knowledge_space_permission_snapshots",
]);

const REQUIRED_EXTERNAL_REFERENCES = Object.freeze([
  ["answer_traces", "knowledge_space_permission_snapshots"],
  ["document_compilation_attempts", "knowledge_space_permission_snapshots"],
  ["failed_queries", "knowledge_space_permission_snapshots"],
  ["knowledge_space_profile_migration_runs", "knowledge_space_permission_snapshots"],
  ["quality_replay_runs", "knowledge_space_permission_snapshots"],
  ["research_task_jobs", "knowledge_space_permission_snapshots"],
  ["source_oauth_transactions", "knowledge_space_api_keys"],
  ["source_oauth_transactions", "knowledge_space_permission_snapshots"],
  ["source_sync_policies", "knowledge_space_permission_snapshots"],
  ["source_workflow_runs", "knowledge_space_permission_snapshots"],
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFERENTIAL_ACTIONS = new Set(["CASCADE", "NO ACTION", "RESTRICT", "SET NULL"]);

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireExactKeys(value, expected, label) {
  const received = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(received) !== JSON.stringify(wanted)) {
    throw new Error(`${label} keys must be exactly: ${wanted.join(", ")}`);
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a safe SQL identifier`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function validateForeignKey(value, index) {
  const foreignKey = requireObject(value, `foreignKeys[${index}]`);
  requireExactKeys(
    foreignKey,
    [
      "columns",
      "constraintName",
      "onDelete",
      "onUpdate",
      "referencedColumns",
      "referencedTableName",
      "tableName",
    ],
    `foreignKeys[${index}]`,
  );
  for (const field of ["constraintName", "referencedTableName", "tableName"]) {
    requireIdentifier(foreignKey[field], `foreignKeys[${index}].${field}`);
  }
  for (const field of ["columns", "referencedColumns"]) {
    if (!Array.isArray(foreignKey[field]) || foreignKey[field].length === 0) {
      throw new Error(`foreignKeys[${index}].${field} must be a non-empty array`);
    }
    foreignKey[field].forEach((column, columnIndex) =>
      requireIdentifier(column, `foreignKeys[${index}].${field}[${columnIndex}]`),
    );
  }
  if (foreignKey.columns.length !== foreignKey.referencedColumns.length) {
    throw new Error(`foreignKeys[${index}] column arity does not match`);
  }
  for (const field of ["onDelete", "onUpdate"]) {
    if (!REFERENTIAL_ACTIONS.has(foreignKey[field])) {
      throw new Error(`foreignKeys[${index}].${field} is unsupported`);
    }
  }
  return foreignKey;
}

export function validateP9Catalog(input) {
  const catalog = requireObject(input, "catalog");
  requireExactKeys(
    catalog,
    [
      "activeLegacyApiKeys",
      "activePermissionSnapshots",
      "capturedAt",
      "databaseEngine",
      "databaseName",
      "foreignKeys",
      "legacyRouteCalls",
      "legacyRouteWindowEndedAt",
      "legacyRouteWindowStartedAt",
      "legacyRowCounts",
      "nonterminalLegacyTasks",
      "schemaVersion",
      "workspaceCohortDigest",
    ],
    "catalog",
  );
  if (catalog.schemaVersion !== 1) throw new Error("catalog.schemaVersion must be 1");
  if (!new Set(["postgresql", "tidb"]).has(catalog.databaseEngine)) {
    throw new Error("catalog.databaseEngine must be postgresql or tidb");
  }
  requireIdentifier(catalog.databaseName, "catalog.databaseName");
  if (
    typeof catalog.capturedAt !== "string" ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(catalog.capturedAt)
  ) {
    throw new Error("catalog.capturedAt must include an explicit timezone");
  }
  if (Number.isNaN(Date.parse(catalog.capturedAt)))
    throw new Error("catalog.capturedAt is invalid");
  if (!SHA256.test(catalog.workspaceCohortDigest)) {
    throw new Error("catalog.workspaceCohortDigest must be sha256:<hex>");
  }

  const rowCounts = requireObject(catalog.legacyRowCounts, "catalog.legacyRowCounts");
  requireExactKeys(rowCounts, LEGACY_AUTHORIZATION_TABLES, "catalog.legacyRowCounts");
  for (const tableName of LEGACY_AUTHORIZATION_TABLES) {
    requireNonNegativeInteger(rowCounts[tableName], `catalog.legacyRowCounts.${tableName}`);
  }
  const routeCalls = requireObject(catalog.legacyRouteCalls, "catalog.legacyRouteCalls");
  requireExactKeys(routeCalls, ["access", "apiKey", "member"], "catalog.legacyRouteCalls");
  for (const routeKind of ["access", "apiKey", "member"]) {
    if (
      requireNonNegativeInteger(routeCalls[routeKind], `catalog.legacyRouteCalls.${routeKind}`) !==
      0
    ) {
      throw new Error(`catalog.legacyRouteCalls.${routeKind} must be zero`);
    }
  }
  for (const field of [
    "activeLegacyApiKeys",
    "activePermissionSnapshots",
    "nonterminalLegacyTasks",
  ]) {
    if (requireNonNegativeInteger(catalog[field], `catalog.${field}`) !== 0) {
      throw new Error(`catalog.${field} must be zero`);
    }
  }
  for (const field of ["legacyRouteWindowStartedAt", "legacyRouteWindowEndedAt"]) {
    if (typeof catalog[field] !== "string" || Number.isNaN(Date.parse(catalog[field]))) {
      throw new Error(`catalog.${field} must be an ISO timestamp`);
    }
  }
  if (
    Date.parse(catalog.legacyRouteWindowEndedAt) <= Date.parse(catalog.legacyRouteWindowStartedAt)
  ) {
    throw new Error("catalog legacy route window must have positive duration");
  }
  if (!Array.isArray(catalog.foreignKeys)) throw new Error("catalog.foreignKeys must be an array");
  const foreignKeys = catalog.foreignKeys.map(validateForeignKey);
  const identities = new Set();
  for (const foreignKey of foreignKeys) {
    const identity = `${foreignKey.tableName}.${foreignKey.constraintName}`;
    if (identities.has(identity)) throw new Error(`duplicate foreign key: ${identity}`);
    identities.add(identity);
    if (
      !LEGACY_AUTHORIZATION_TABLES.includes(foreignKey.tableName) &&
      !LEGACY_AUTHORIZATION_TABLES.includes(foreignKey.referencedTableName)
    ) {
      throw new Error(`foreign key ${identity} is unrelated to the legacy authorization schema`);
    }
  }
  const pairs = new Set(
    foreignKeys.map((item) => `${item.tableName}->${item.referencedTableName}`),
  );
  for (const [tableName, referencedTableName] of REQUIRED_EXTERNAL_REFERENCES) {
    if (!pairs.has(`${tableName}->${referencedTableName}`)) {
      throw new Error(`catalog is missing ${tableName} -> ${referencedTableName} foreign key`);
    }
  }
  return { ...catalog, foreignKeys };
}

function quoteIdentifier(dialect, value) {
  requireIdentifier(value, "SQL identifier");
  return dialect === "postgresql" ? `"${value}"` : `\`${value}\``;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function foreignKeySql(dialect, foreignKey) {
  const q = (value) => quoteIdentifier(dialect, value);
  return `ALTER TABLE ${q(foreignKey.tableName)} ADD CONSTRAINT ${q(foreignKey.constraintName)} FOREIGN KEY (${foreignKey.columns.map(q).join(", ")}) REFERENCES ${q(foreignKey.referencedTableName)} (${foreignKey.referencedColumns.map(q).join(", ")}) ON DELETE ${foreignKey.onDelete} ON UPDATE ${foreignKey.onUpdate};`;
}

function sortedForeignKeys(catalog) {
  return [...catalog.foreignKeys].sort((left, right) =>
    `${left.tableName}.${left.constraintName}`.localeCompare(
      `${right.tableName}.${right.constraintName}`,
    ),
  );
}

function postgresRemovalSql(catalog, requestId) {
  const q = (value) => quoteIdentifier("postgresql", value);
  const tables = LEGACY_AUTHORIZATION_TABLES.map(q).join(", ");
  const rowCountChecks = LEGACY_AUTHORIZATION_TABLES.map(
    (tableName) =>
      `  IF (SELECT count(*) FROM ${q(tableName)}) <> ${catalog.legacyRowCounts[tableName]} THEN RAISE EXCEPTION 'P9 row-count drift: ${tableName}'; END IF;`,
  ).join("\n");
  const constraintDrops = sortedForeignKeys(catalog)
    .map(
      (foreignKey) =>
        `ALTER TABLE ${q(foreignKey.tableName)} DROP CONSTRAINT ${q(foreignKey.constraintName)};`,
    )
    .join("\n");
  const moves = LEGACY_AUTHORIZATION_TABLES.map(
    (tableName) => `ALTER TABLE ${q(tableName)} SET SCHEMA "knowledge_fs_p9_archive";`,
  ).join("\n");
  return `-- Generated KnowledgeFS P9 removal bundle. Do not edit after approval.
-- Set knowledge_fs.p9_cleanup_request_id=${requestId} on this session before execution.
BEGIN;
DO $p9_guard$
BEGIN
  IF current_database() <> ${sqlLiteral(catalog.databaseName)} THEN
    RAISE EXCEPTION 'P9 database mismatch';
  END IF;
  IF current_setting('knowledge_fs.p9_cleanup_request_id', true) IS DISTINCT FROM ${sqlLiteral(requestId)} THEN
    RAISE EXCEPTION 'P9 cleanup request guard mismatch';
  END IF;
END
$p9_guard$;
LOCK TABLE ${tables} IN ACCESS EXCLUSIVE MODE;
DO $p9_preflight$
BEGIN
${rowCountChecks}
  IF (SELECT count(*) FROM "knowledge_space_api_keys" WHERE "status" = 'active') <> 0 THEN RAISE EXCEPTION 'P9 active legacy API keys remain'; END IF;
  IF (SELECT count(*) FROM "knowledge_space_permission_snapshots" WHERE "status" = 'active') <> 0 THEN RAISE EXCEPTION 'P9 active permission snapshots remain'; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'knowledge_fs_p9_archive'
      AND table_name IN (${LEGACY_AUTHORIZATION_TABLES.map(sqlLiteral).join(", ")})
  ) THEN RAISE EXCEPTION 'P9 archive target already exists'; END IF;
END
$p9_preflight$;
CREATE SCHEMA IF NOT EXISTS "knowledge_fs_p9_archive";
CREATE TABLE IF NOT EXISTS "knowledge_fs_p9_archive"."removal_manifest" (
  "request_id" UUID PRIMARY KEY,
  "workspace_cohort_digest" VARCHAR(71) NOT NULL,
  "captured_at" TIMESTAMPTZ NOT NULL,
  "archived_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_counts" JSONB NOT NULL
);
INSERT INTO "knowledge_fs_p9_archive"."removal_manifest" (
  "request_id", "workspace_cohort_digest", "captured_at", "row_counts"
) VALUES (
  ${sqlLiteral(requestId)}::uuid,
  ${sqlLiteral(catalog.workspaceCohortDigest)},
  ${sqlLiteral(catalog.capturedAt)}::timestamptz,
  ${sqlLiteral(JSON.stringify(catalog.legacyRowCounts))}::jsonb
);
${constraintDrops}
${moves}
DO $p9_postcondition$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN (${LEGACY_AUTHORIZATION_TABLES.map(sqlLiteral).join(", ")})
  ) THEN RAISE EXCEPTION 'P9 live legacy tables remain'; END IF;
END
$p9_postcondition$;
COMMIT;
`;
}

function postgresRecoverySql(catalog, requestId) {
  const q = (value) => quoteIdentifier("postgresql", value);
  const restores = [...LEGACY_AUTHORIZATION_TABLES]
    .reverse()
    .map(
      (tableName) =>
        `ALTER TABLE "knowledge_fs_p9_archive".${q(tableName)} SET SCHEMA ${q("public")};`,
    )
    .join("\n");
  const constraints = sortedForeignKeys(catalog)
    .map((item) => foreignKeySql("postgresql", item))
    .join("\n");
  return `-- Disaster-recovery data restoration for request ${requestId}.
-- Restoring these tables never re-enables legacy authorization traffic.
BEGIN;
DO $p9_guard$
BEGIN
  IF current_database() <> ${sqlLiteral(catalog.databaseName)} THEN RAISE EXCEPTION 'P9 database mismatch'; END IF;
  IF current_setting('knowledge_fs.p9_cleanup_request_id', true) IS DISTINCT FROM ${sqlLiteral(requestId)} THEN RAISE EXCEPTION 'P9 cleanup request guard mismatch'; END IF;
END
$p9_guard$;
${restores}
${constraints}
COMMIT;
`;
}

function tidbGuard(name, condition, message) {
  return `SET @${name}_sql = IF(${condition}, 'DO 0', ${sqlLiteral(`SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}'`)});\nPREPARE ${name} FROM @${name}_sql;\nEXECUTE ${name};\nDEALLOCATE PREPARE ${name};`;
}

function tidbRemovalSql(catalog, requestId) {
  const q = (value) => quoteIdentifier("tidb", value);
  const guards = [
    tidbGuard(
      "p9_database_guard",
      `DATABASE() = ${sqlLiteral(catalog.databaseName)}`,
      "P9 database mismatch",
    ),
    tidbGuard(
      "p9_request_guard",
      `@knowledge_fs_p9_cleanup_request_id = ${sqlLiteral(requestId)}`,
      "P9 cleanup request guard mismatch",
    ),
    ...LEGACY_AUTHORIZATION_TABLES.map((tableName) =>
      tidbGuard(
        `p9_count_${tableName}`,
        `(SELECT COUNT(*) FROM ${q(tableName)}) = ${catalog.legacyRowCounts[tableName]}`,
        `P9 row-count drift: ${tableName}`,
      ),
    ),
    tidbGuard(
      "p9_active_keys",
      `(SELECT COUNT(*) FROM ${q("knowledge_space_api_keys")} WHERE ${q("status")} = 'active') = 0`,
      "P9 active legacy API keys remain",
    ),
    tidbGuard(
      "p9_active_snapshots",
      `(SELECT COUNT(*) FROM ${q("knowledge_space_permission_snapshots")} WHERE ${q("status")} = 'active') = 0`,
      "P9 active permission snapshots remain",
    ),
  ].join("\n");
  const drops = sortedForeignKeys(catalog)
    .map(
      (foreignKey) =>
        `ALTER TABLE ${q(foreignKey.tableName)} DROP FOREIGN KEY ${q(foreignKey.constraintName)};`,
    )
    .join("\n");
  const renames = LEGACY_AUTHORIZATION_TABLES.map(
    (tableName) => `${q(tableName)} TO ${q(`knowledge_fs_p9_archive__${tableName}`)}`,
  ).join(",\n  ");
  return `-- Generated KnowledgeFS P9 TiDB removal bundle. TiDB DDL is not transactionally rolled back.
-- Set @knowledge_fs_p9_cleanup_request_id=${requestId} before execution and stop on the first error.
${guards}
CREATE TABLE IF NOT EXISTS ${q("knowledge_fs_p9_archive_manifest")} (
  ${q("request_id")} CHAR(36) PRIMARY KEY NOT NULL,
  ${q("workspace_cohort_digest")} VARCHAR(71) NOT NULL,
  ${q("captured_at")} DATETIME(3) NOT NULL,
  ${q("archived_at")} DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ${q("row_counts")} JSON NOT NULL
);
INSERT INTO ${q("knowledge_fs_p9_archive_manifest")} (
  ${q("request_id")}, ${q("workspace_cohort_digest")}, ${q("captured_at")}, ${q("row_counts")}
) VALUES (
  ${sqlLiteral(requestId)},
  ${sqlLiteral(catalog.workspaceCohortDigest)},
  ${sqlLiteral(new Date(catalog.capturedAt).toISOString().replace("T", " ").replace("Z", ""))},
  ${sqlLiteral(JSON.stringify(catalog.legacyRowCounts))}
);
${drops}
RENAME TABLE
  ${renames};
${tidbGuard(
  "p9_live_table_postcondition",
  `(SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (${LEGACY_AUTHORIZATION_TABLES.map(sqlLiteral).join(", ")})) = 0`,
  "P9 live legacy tables remain",
)}
`;
}

function tidbRecoverySql(catalog, requestId) {
  const q = (value) => quoteIdentifier("tidb", value);
  const renames = [...LEGACY_AUTHORIZATION_TABLES]
    .reverse()
    .map((tableName) => `${q(`knowledge_fs_p9_archive__${tableName}`)} TO ${q(tableName)}`)
    .join(",\n  ");
  const constraints = sortedForeignKeys(catalog)
    .map((item) => foreignKeySql("tidb", item))
    .join("\n");
  return `-- Disaster-recovery data restoration for request ${requestId}.
-- Restoring these tables never re-enables legacy authorization traffic.
${tidbGuard(
  "p9_recovery_request_guard",
  `@knowledge_fs_p9_cleanup_request_id = ${sqlLiteral(requestId)}`,
  "P9 cleanup request guard mismatch",
)}
RENAME TABLE
  ${renames};
${constraints}
`;
}

export function renderP9RemovalBundle(catalogInput, requestId) {
  if (typeof requestId !== "string" || !UUID.test(requestId)) {
    throw new Error("requestId must be a UUID");
  }
  const catalog = validateP9Catalog(catalogInput);
  const removalSql =
    catalog.databaseEngine === "postgresql"
      ? postgresRemovalSql(catalog, requestId)
      : tidbRemovalSql(catalog, requestId);
  const recoverySql =
    catalog.databaseEngine === "postgresql"
      ? postgresRecoverySql(catalog, requestId)
      : tidbRecoverySql(catalog, requestId);
  const canonicalCatalog = `${JSON.stringify(catalog, null, 2)}\n`;
  return {
    catalog,
    catalogDigest: sha256(canonicalCatalog),
    removalSql,
    removalSqlDigest: sha256(removalSql),
    recoverySql,
    recoverySqlDigest: sha256(recoverySql),
  };
}

export async function buildP9RemovalBundle({ catalogPath, outputDirectory, requestId }) {
  const catalogContent = await readFile(resolve(catalogPath), "utf8");
  const rendered = renderP9RemovalBundle(JSON.parse(catalogContent), requestId);
  const output = resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  await Promise.all([
    writeFile(resolve(output, "remove-legacy-authorization.sql"), rendered.removalSql),
    writeFile(resolve(output, "recover-legacy-authorization-data.sql"), rendered.recoverySql),
    writeFile(
      resolve(output, "bundle-manifest.json"),
      `${JSON.stringify(
        {
          catalogDigest: rendered.catalogDigest,
          databaseEngine: rendered.catalog.databaseEngine,
          recoverySqlDigest: rendered.recoverySqlDigest,
          removalSqlDigest: rendered.removalSqlDigest,
          requestId,
          schemaVersion: 1,
          workspaceCohortDigest: rendered.catalog.workspaceCohortDigest,
        },
        null,
        2,
      )}\n`,
    ),
  ]);
  return rendered;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function main() {
  const result = await buildP9RemovalBundle({
    catalogPath: argumentValue("--catalog"),
    outputDirectory: argumentValue("--output"),
    requestId: argumentValue("--request-id"),
  });
  process.stdout.write(`${result.removalSqlDigest}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
