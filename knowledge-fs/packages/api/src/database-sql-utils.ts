import type { DatabaseAdapter } from "@knowledge/core";

type DatabaseDialectInput = Pick<DatabaseAdapter, "dialect">;

export function quoteDatabaseIdentifier(
  database: DatabaseDialectInput,
  identifier: string,
): string {
  return database.dialect === "postgres"
    ? `"${identifier.replaceAll('"', '""')}"`
    : `\`${identifier.replaceAll("`", "``")}\``;
}

export function qualifiedDatabaseIdentifier(
  database: DatabaseDialectInput,
  alias: string,
  identifier: string,
): string {
  return `${alias}.${quoteDatabaseIdentifier(database, identifier)}`;
}

export function databasePlaceholder(database: DatabaseDialectInput, position: number): string {
  return database.dialect === "postgres" ? `$${position}` : "?";
}

export function jsonInsertPlaceholder(
  database: DatabaseDialectInput,
  position: number,
  column: string | undefined,
): string {
  const placeholder = databasePlaceholder(database, position);

  if (
    column !== "metadata" &&
    column !== "elements" &&
    column !== "expected_evidence_ids" &&
    column !== "items" &&
    column !== "nodes" &&
    column !== "payload" &&
    column !== "permission_scope" &&
    column !== "permission_scopes" &&
    column !== "permission_snapshot" &&
    column !== "source_location" &&
    column !== "subject" &&
    column !== "tags"
  ) {
    return placeholder;
  }

  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}

export function indexProjectionInsertPlaceholder(
  database: DatabaseDialectInput,
  position: number,
  column: string | undefined,
): string {
  const placeholder = databasePlaceholder(database, position);

  if (column === "dense_vector" || column === "visual_vector") {
    return database.dialect === "postgres"
      ? `${placeholder}::vector`
      : `CAST(${placeholder} AS VECTOR)`;
  }

  if (column === "fts_document") {
    return database.dialect === "postgres" ? `to_tsvector('simple', ${placeholder})` : placeholder;
  }

  return jsonInsertPlaceholder(database, position, column);
}
