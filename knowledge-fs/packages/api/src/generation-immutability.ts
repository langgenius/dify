import type { DatabaseAdapter, DatabaseExecutor, DatabaseQueryValue } from "@knowledge/core";

import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";

export type PublishedGenerationComponentType =
  | "document-outline"
  | "graph-entity"
  | "graph-relation"
  | "index-projection"
  | "knowledge-node"
  | "knowledge-path"
  | "multimodal-manifest";

export interface PublishedGenerationReferenceInput {
  readonly componentKey?: string | undefined;
  readonly componentType: PublishedGenerationComponentType;
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId: string;
}

export type PublishedGenerationReferenceGuard = (
  input: PublishedGenerationReferenceInput,
) => boolean | Promise<boolean>;

export class GenerationScopedComponentConflictError extends Error {
  readonly code = "GENERATION_SCOPED_COMPONENT_CONFLICT";

  constructor(componentType: PublishedGenerationComponentType, logicalKey: string) {
    super(
      `Generation-scoped ${componentType} logicalKey=${logicalKey} conflicts with its immutable persisted value`,
    );
    this.name = "GenerationScopedComponentConflictError";
  }
}

export class PublishedGenerationMutationConflictError extends Error {
  readonly code = "PUBLISHED_GENERATION_MUTATION_CONFLICT";

  constructor(componentType: PublishedGenerationComponentType, publicationGenerationId: string) {
    super(
      `Published or superseded generation=${publicationGenerationId} ${componentType} cannot be mutated`,
    );
    this.name = "PublishedGenerationMutationConflictError";
  }
}

export class GenerationScopedIndexProjectionLifecycleError extends Error {
  readonly code = "GENERATION_SCOPED_INDEX_PROJECTION_LIFECYCLE_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "GenerationScopedIndexProjectionLifecycleError";
  }
}

/**
 * Audit timestamps are assigned by the worker and may legitimately differ after a crash/retry.
 * Everything else, including the physical id, lineage, ACL, metadata, and derived content, is
 * immutable for a non-legacy generation.
 */
export function assertExactGenerationReplay({
  componentType,
  incoming,
  logicalKey,
  persisted,
}: {
  readonly componentType: PublishedGenerationComponentType;
  readonly incoming: unknown;
  readonly logicalKey: string;
  readonly persisted: unknown;
}): void {
  if (canonicalJson(replayMaterial(incoming)) !== canonicalJson(replayMaterial(persisted))) {
    throw new GenerationScopedComponentConflictError(componentType, logicalKey);
  }
}

export async function assertInMemoryGenerationNotPublished({
  componentKey,
  componentType,
  guard,
  knowledgeSpaceId,
  publicationGenerationId,
}: PublishedGenerationReferenceInput & {
  readonly guard?: PublishedGenerationReferenceGuard | undefined;
}): Promise<void> {
  if (
    guard &&
    (await guard({
      ...(componentKey ? { componentKey } : {}),
      componentType,
      knowledgeSpaceId,
      publicationGenerationId,
    }))
  ) {
    throw new PublishedGenerationMutationConflictError(componentType, publicationGenerationId);
  }
}

/**
 * Locks every publication/member ledger row for the generation before allowing destructive
 * maintenance. This serializes the guard with publication/rollback transactions. Candidate rows
 * do not block cleanup, but a concurrent transition to published must wait and revalidate its
 * component closure after this transaction commits.
 */
export async function assertDatabaseGenerationNotPublished({
  componentType,
  database,
  executor,
  knowledgeSpaceId,
  publicationGenerationId,
}: {
  readonly componentType: PublishedGenerationComponentType;
  readonly database: Pick<DatabaseAdapter, "dialect">;
  readonly executor: DatabaseExecutor;
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId: string;
}): Promise<void> {
  const members = quoteDatabaseIdentifier(database, "projection_set_publication_members");
  const publications = quoteDatabaseIdentifier(database, "projection_set_publications");
  const memberAlias = quoteDatabaseIdentifier(database, "generation_member");
  const publicationAlias = quoteDatabaseIdentifier(database, "generation_publication");
  const params = [
    knowledgeSpaceId,
    publicationGenerationId,
  ] satisfies readonly DatabaseQueryValue[];
  const lockSql =
    database.dialect === "postgres" ? " FOR UPDATE OF generation_publication" : " FOR UPDATE";
  const result = await executor.execute({
    maxRows: 100_000,
    operation: "select",
    params,
    sql: `SELECT ${publicationAlias}.${quoteDatabaseIdentifier(database, "status")} AS ${quoteDatabaseIdentifier(
      database,
      "publication_status",
    )} FROM ${publications} ${publicationAlias} WHERE ${publicationAlias}.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 1)} AND ${publicationAlias}.${quoteDatabaseIdentifier(
      database,
      "status",
    )} IN ('candidate', 'validating', 'published', 'superseded') AND EXISTS (SELECT 1 FROM ${members} ${memberAlias} WHERE ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${publicationAlias}.${quoteDatabaseIdentifier(database, "tenant_id")} AND ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${publicationAlias}.${quoteDatabaseIdentifier(database, "knowledge_space_id")} AND ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "publication_id",
    )} = ${publicationAlias}.${quoteDatabaseIdentifier(database, "id")} AND ${memberAlias}.${quoteDatabaseIdentifier(
      database,
      "generation_id",
    )} = ${databasePlaceholder(database, 2)})${lockSql};`,
    tableName: "projection_set_publication_members",
  });

  if (
    result.rows.some(
      (row) => row.publication_status === "published" || row.publication_status === "superseded",
    )
  ) {
    throw new PublishedGenerationMutationConflictError(componentType, publicationGenerationId);
  }
}

function replayMaterial(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(replayMaterial);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "createdAt" && key !== "updatedAt")
      .map(([key, nested]) => [key, replayMaterial(nested)]),
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
