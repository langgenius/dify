import type { DatabaseAdapter, DatabaseQueryValue } from "@knowledge/core";

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

/**
 * Creates a logical parameter reference that can be rendered more than once in a SQL statement.
 * PostgreSQL positional parameters can reuse their first `$n`; TiDB's anonymous `?` parameters
 * require the value to be appended for every occurrence, in SQL lexical order.
 */
export function createReusableDatabaseParameter(
  database: DatabaseDialectInput,
  params: DatabaseQueryValue[],
  value: DatabaseQueryValue,
): () => string {
  let postgresPosition: number | undefined;
  return () => {
    if (database.dialect === "postgres" && postgresPosition !== undefined) {
      return databasePlaceholder(database, postgresPosition);
    }
    params.push(value);
    postgresPosition = params.length;
    return databasePlaceholder(database, postgresPosition);
  };
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
    column !== "evaluation" &&
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
