import { migrationArtifacts } from "./migration-artifacts.generated";
import { type DatabaseDialect, renderMigrationSql } from "./schema";

export interface MigrationArtifact {
  readonly content: string;
  readonly path: string;
}

export interface PendingMigrationArtifactsInput {
  readonly appliedMigrationIds: readonly string[];
  readonly dialect: DatabaseDialect;
}

export interface RenderMigrationFileInput {
  readonly dialect: DatabaseDialect;
  readonly migrationId: string;
}

const initialSchemaMigrationId = "0001_initial_schema";

export function renderSchemaMigrationsTableSql(dialect: DatabaseDialect): string {
  const quote = (identifier: string) =>
    dialect === "postgres"
      ? `"${identifier.replace(/"/g, '""')}"`
      : `\`${identifier.replace(/`/g, "``")}\``;

  return [
    `CREATE TABLE IF NOT EXISTS ${quote("schema_migrations")} (`,
    `  ${quote("migration_id")} VARCHAR(255) PRIMARY KEY,`,
    `  ${quote("dialect")} VARCHAR(32) NOT NULL,`,
    `  ${quote("applied_at")} TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    ");",
  ].join("\n");
}

export function renderMigrationFile({ dialect, migrationId }: RenderMigrationFileInput): string {
  const statements = renderMigrationSql(dialect);

  return [
    "-- Knowledge Platform schema migration",
    `-- Migration id: ${migrationId}`,
    `-- Dialect: ${dialect}`,
    "",
    ...statements,
    "",
  ].join("\n");
}

export function getInitialSchemaMigrationArtifacts(): readonly MigrationArtifact[] {
  return getDatabaseMigrationArtifacts().filter(
    (artifact) => migrationIdFromPath(artifact.path) === initialSchemaMigrationId,
  );
}

/**
 * Returns immutable, checked-in migrations in application order. The generated registry embeds
 * SQL artifacts in the production bundle; it is intentionally not rendered from the live schema
 * catalog, so a later catalog change cannot silently rewrite migration 0001.
 */
export function getDatabaseMigrationArtifacts(): readonly MigrationArtifact[] {
  return migrationArtifacts;
}

export function getPendingMigrationArtifacts({
  appliedMigrationIds,
  dialect,
}: PendingMigrationArtifactsInput): readonly MigrationArtifact[] {
  const applied = new Set(appliedMigrationIds);
  return getDatabaseMigrationArtifacts().filter((artifact) => {
    const migrationId = migrationIdFromPath(artifact.path);
    return artifact.path.endsWith(`.${dialect}.sql`) && !applied.has(migrationId);
  });
}

export function findMigrationArtifactDrift(
  currentArtifacts: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  return getDatabaseMigrationArtifacts()
    .filter((artifact) => currentArtifacts[artifact.path] !== artifact.content)
    .map((artifact) => artifact.path);
}

function migrationIdFromPath(path: string): string {
  const filename = path.split("/").at(-1) ?? path;
  const [migrationId] = filename.split(".");

  if (!migrationId) {
    throw new Error(`Invalid migration artifact path: ${path}`);
  }

  return migrationId;
}
