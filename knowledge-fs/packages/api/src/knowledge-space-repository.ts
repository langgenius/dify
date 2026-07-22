import { randomUUID } from "node:crypto";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import {
  type DatabaseKnowledgeSpacePermissionFence,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import { deterministicKnowledgeSpaceActivityId } from "./knowledge-space-overview";
import { appendKnowledgeSpaceActivityWithExecutor } from "./knowledge-space-overview-database-repository";

import {
  type DatabaseAdapter,
  type DatabaseExecuteResult,
  type DatabaseQueryValue,
  type DatabaseRow,
  type KnowledgeSpace,
  KnowledgeSpaceSchema,
} from "@knowledge/core";

export interface CreateKnowledgeSpaceInput {
  readonly description?: string | undefined;
  readonly iconRef?: string | undefined;
  readonly name: string;
  readonly slug: string;
  readonly tenantId: string;
}

export interface UpdateKnowledgeSpaceInput {
  readonly actorSubjectId?: string | undefined;
  readonly description?: string | undefined;
  readonly expectedRevision: number;
  /** null clears the configured built-in icon; undefined preserves it. */
  readonly iconRef?: string | null | undefined;
  readonly id: string;
  readonly name?: string | undefined;
  readonly permission?:
    | {
        readonly fence: DatabaseKnowledgeSpacePermissionFence;
        readonly now: string;
        readonly requiredAccess: "admin" | "write";
      }
    | undefined;
  readonly slug?: string | undefined;
  readonly tenantId: string;
}

export interface KnowledgeSpaceLookupInput {
  readonly id: string;
  readonly tenantId: string;
}

/** Creation compensation only; cannot remove an updated or deletion-fenced knowledge space. */
export interface RollbackKnowledgeSpaceCreateInput extends KnowledgeSpaceLookupInput {
  readonly expectedRevision: number;
  readonly expectedSlug: string;
}

export interface ListKnowledgeSpacesInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly tenantId: string;
}

export interface ListAuthorizedKnowledgeSpacesInput extends ListKnowledgeSpacesInput {
  /** External channels additionally require the per-space API Access switch to be enabled. */
  readonly requireApiAccess?: boolean | undefined;
  readonly subjectId: string;
}

export interface ListKnowledgeSpacesResult {
  readonly items: KnowledgeSpace[];
  readonly nextCursor?: string;
}

export interface KnowledgeSpaceRepository {
  create(input: CreateKnowledgeSpaceInput): Promise<KnowledgeSpace>;
  get(input: KnowledgeSpaceLookupInput): Promise<KnowledgeSpace | null>;
  /** Internal durable-deletion lookup; includes a row already fenced as deleting. */
  getForDeletion(input: KnowledgeSpaceLookupInput): Promise<KnowledgeSpace | null>;
  list(input: ListKnowledgeSpacesInput): Promise<ListKnowledgeSpacesResult>;
  /** Database implementations apply membership/visibility before ORDER BY/LIMIT. */
  listAuthorized?(input: ListAuthorizedKnowledgeSpacesInput): Promise<ListKnowledgeSpacesResult>;
  rollbackCreate(input: RollbackKnowledgeSpaceCreateInput): Promise<boolean>;
  update(input: UpdateKnowledgeSpaceInput): Promise<KnowledgeSpace | null>;
}

export interface InMemoryKnowledgeSpaceRepositoryOptions {
  readonly generateId?: () => string;
  readonly maxListLimit: number;
  readonly maxSpaces: number;
  readonly now?: () => string;
}

export interface DatabaseKnowledgeSpaceRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: () => string;
  readonly maxListLimit: number;
  readonly now?: () => string;
}

export class DuplicateKnowledgeSpaceSlugError extends Error {
  constructor() {
    super("Knowledge space slug already exists for tenant");
  }
}

export class KnowledgeSpaceCapacityExceededError extends Error {
  constructor(maxSpaces: number) {
    super(`Knowledge space repository maxSpaces=${maxSpaces} exceeded`);
  }
}

export class KnowledgeSpaceListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`Knowledge space list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

export const KNOWLEDGE_SPACE_REVISION_CONFLICT = "knowledge_space_revision_conflict";

export class KnowledgeSpaceRevisionConflictError extends Error {
  readonly code = KNOWLEDGE_SPACE_REVISION_CONFLICT;

  constructor(
    readonly expectedRevision: number,
    readonly actualRevision?: number | undefined,
  ) {
    super(
      actualRevision === undefined
        ? `Knowledge space revision conflict: expected=${expectedRevision}`
        : `Knowledge space revision conflict: expected=${expectedRevision} actual=${actualRevision}`,
    );
    this.name = "KnowledgeSpaceRevisionConflictError";
  }
}

export class KnowledgeSpacePermissionFenceRequiredError extends Error {
  readonly code = "knowledge_space_permission_fence_required";

  constructor() {
    super("Database knowledge-space updates require a durable permission fence");
    this.name = "KnowledgeSpacePermissionFenceRequiredError";
  }
}

export function createInMemoryKnowledgeSpaceRepository({
  generateId = randomUUID,
  maxListLimit,
  maxSpaces,
  now = () => new Date().toISOString(),
}: InMemoryKnowledgeSpaceRepositoryOptions): KnowledgeSpaceRepository {
  validateKnowledgeSpaceRepositoryBounds({ maxListLimit, maxSpaces });

  const spaces = new Map<string, KnowledgeSpace>();

  return {
    create: async (input) => {
      if (hasTenantSlug(spaces, input.tenantId, input.slug)) {
        throw new DuplicateKnowledgeSpaceSlugError();
      }

      if (spaces.size >= maxSpaces) {
        throw new KnowledgeSpaceCapacityExceededError(maxSpaces);
      }

      const timestamp = now();
      const space = KnowledgeSpaceSchema.parse({
        ...input,
        createdAt: timestamp,
        id: generateId(),
        revision: 1,
        updatedAt: timestamp,
      });

      spaces.set(space.id, space);

      return cloneSpace(space);
    },
    rollbackCreate: async ({ expectedRevision, expectedSlug, id, tenantId }) => {
      const space = spaces.get(id);

      if (
        expectedRevision !== 1 ||
        !space ||
        space.tenantId !== tenantId ||
        space.revision !== expectedRevision ||
        space.slug !== expectedSlug
      ) {
        return false;
      }

      return spaces.delete(id);
    },
    get: async ({ id, tenantId }) => {
      const space = spaces.get(id);

      return space && space.tenantId === tenantId ? cloneSpace(space) : null;
    },
    getForDeletion: async ({ id, tenantId }) => {
      const space = spaces.get(id);

      return space && space.tenantId === tenantId ? cloneSpace(space) : null;
    },
    list: async ({ cursor, limit, tenantId }) => {
      validateKnowledgeSpaceListLimit(limit, maxListLimit);

      const sortedSpaces = [...spaces.values()]
        .filter((space) => space.tenantId === tenantId)
        .filter((space) => (cursor ? space.slug > cursor : true))
        .sort((first, second) => first.slug.localeCompare(second.slug))
        .slice(0, limit + 1);
      const items = sortedSpaces.slice(0, limit).map(cloneSpace);
      const nextCursor = sortedSpaces.length > limit ? items.at(-1)?.slug : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    update: async ({ expectedRevision, id, permission, tenantId, ...input }) => {
      validateKnowledgeSpaceRevision(expectedRevision, "expectedRevision");
      const existing = spaces.get(id);

      if (!existing || existing.tenantId !== tenantId) {
        return null;
      }
      if (existing.revision !== expectedRevision) {
        throw new KnowledgeSpaceRevisionConflictError(expectedRevision, existing.revision);
      }
      const nextSlug = input.slug ?? existing.slug;

      if (
        nextSlug !== existing.slug &&
        hasTenantSlug(spaces, existing.tenantId, nextSlug, existing.id)
      ) {
        throw new DuplicateKnowledgeSpaceSlugError();
      }

      const updated = KnowledgeSpaceSchema.parse({
        ...existing,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.iconRef === undefined
          ? {}
          : input.iconRef === null
            ? { iconRef: undefined }
            : { iconRef: input.iconRef }),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        revision: existing.revision + 1,
        updatedAt: now(),
      });

      spaces.set(id, updated);

      return cloneSpace(updated);
    },
  };
}

export function createDatabaseKnowledgeSpaceRepository({
  database,
  generateId = randomUUID,
  maxListLimit,
  now = () => new Date().toISOString(),
}: DatabaseKnowledgeSpaceRepositoryOptions): KnowledgeSpaceRepository {
  if (maxListLimit < 1) {
    throw new Error("Knowledge space repository maxListLimit must be at least 1");
  }

  const tableName = "knowledge_spaces";

  return {
    create: async (input) => {
      const existing = await findDatabaseSpaceBySlug(database, input.tenantId, input.slug);

      if (existing) {
        throw new DuplicateKnowledgeSpaceSlugError();
      }

      const timestamp = now();
      const id = generateId();
      const params = [
        id,
        input.tenantId,
        input.slug,
        input.name,
        input.description ?? null,
        input.iconRef ?? null,
        1,
        timestamp,
        timestamp,
      ] satisfies readonly DatabaseQueryValue[];
      let result: DatabaseExecuteResult;
      try {
        result = await database.execute({
          maxRows: 1,
          operation: "insert",
          params,
          sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${[
            "id",
            "tenant_id",
            "slug",
            "name",
            "description",
            "icon_ref",
            "revision",
            "created_at",
            "updated_at",
          ]
            .map((column) => quoteDatabaseIdentifier(database, column))
            .join(", ")}) VALUES (${params
            .map((_, index) => databasePlaceholder(database, index + 1))
            .join(", ")})${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName,
        });
      } catch (error) {
        if (isTenantSlugUniqueViolation(error)) {
          throw new DuplicateKnowledgeSpaceSlugError();
        }
        throw error;
      }
      const inserted = result.rows[0]
        ? mapKnowledgeSpaceRow(result.rows[0])
        : await databaseKnowledgeSpaceGet(database, { id, tenantId: input.tenantId });

      if (!inserted) {
        throw new Error("Database insert did not return a knowledge space");
      }

      return inserted;
    },
    rollbackCreate: async (input) => {
      if (input.expectedRevision !== 1) return false;
      const result = await database.execute({
        maxRows: 0,
        operation: "delete",
        params: [input.tenantId, input.id, input.expectedSlug, input.expectedRevision],
        sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "tenant_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "id",
        )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
          database,
          "slug",
        )} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(
          database,
          "revision",
        )} = ${databasePlaceholder(database, 4)} AND ${quoteDatabaseIdentifier(
          database,
          "lifecycle_state",
        )} = 'active' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL;`,
        tableName,
      });

      return result.rowsAffected > 0;
    },
    get: async (input) => databaseKnowledgeSpaceGet(database, input),
    getForDeletion: async (input) => databaseKnowledgeSpaceGetForDeletion(database, input),
    list: async ({ cursor, limit, tenantId }) => {
      validateKnowledgeSpaceListLimit(limit, maxListLimit);

      const readLimit = limit + 1;
      const params = (
        cursor ? [tenantId, cursor, readLimit] : [tenantId, readLimit]
      ) satisfies readonly DatabaseQueryValue[];
      const cursorSql = cursor
        ? ` AND ${quoteDatabaseIdentifier(database, "slug")} > ${databasePlaceholder(database, 2)}`
        : "";
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "tenant_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "lifecycle_state",
        )} = 'active'${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "slug",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName,
      });
      const rows = result.rows.map(mapKnowledgeSpaceRow);
      const items = rows.slice(0, limit).map(cloneSpace);
      const nextCursor = rows.length > limit ? items.at(-1)?.slug : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    listAuthorized: async ({ cursor, limit, requireApiAccess, subjectId, tenantId }) => {
      validateKnowledgeSpaceListLimit(limit, maxListLimit);
      const readLimit = limit + 1;
      const params: DatabaseQueryValue[] = [tenantId, subjectId];
      const cursorSql = cursor
        ? ` AND space.${quoteDatabaseIdentifier(database, "slug")} > ${databasePlaceholder(
            database,
            params.push(cursor),
          )}`
        : "";
      const apiAccessSql = requireApiAccess
        ? ` AND EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_api_access",
          )} api_access WHERE api_access.${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} = space.${quoteDatabaseIdentifier(database, "tenant_id")} AND api_access.${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = space.${quoteDatabaseIdentifier(database, "id")} AND api_access.${quoteDatabaseIdentifier(
            database,
            "enabled",
          )} = ${database.dialect === "postgres" ? "TRUE" : "1"})`
        : "";
      params.push(readLimit);
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT space.* FROM ${quoteDatabaseIdentifier(database, tableName)} space INNER JOIN ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_members",
        )} member ON member.${quoteDatabaseIdentifier(database, "tenant_id")} = space.${quoteDatabaseIdentifier(
          database,
          "tenant_id",
        )} AND member.${quoteDatabaseIdentifier(database, "knowledge_space_id")} = space.${quoteDatabaseIdentifier(
          database,
          "id",
        )} INNER JOIN ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_access_policies",
        )} policy ON policy.${quoteDatabaseIdentifier(database, "tenant_id")} = space.${quoteDatabaseIdentifier(
          database,
          "tenant_id",
        )} AND policy.${quoteDatabaseIdentifier(database, "knowledge_space_id")} = space.${quoteDatabaseIdentifier(
          database,
          "id",
        )} WHERE space.${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(
          database,
          1,
        )} AND space.${quoteDatabaseIdentifier(
          database,
          "lifecycle_state",
        )} = 'active' AND member.${quoteDatabaseIdentifier(database, "subject_id")} = ${databasePlaceholder(
          database,
          2,
        )} AND (policy.${quoteDatabaseIdentifier(database, "visibility")} = 'all_members' OR (policy.${quoteDatabaseIdentifier(
          database,
          "visibility",
        )} = 'only_me' AND policy.${quoteDatabaseIdentifier(database, "owner_subject_id")} = ${databasePlaceholder(
          database,
          2,
        )}) OR (policy.${quoteDatabaseIdentifier(
          database,
          "visibility",
        )} = 'partial_members' AND EXISTS (SELECT 1 FROM ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_access_policy_members",
        )} policy_member WHERE policy_member.${quoteDatabaseIdentifier(
          database,
          "access_policy_id",
        )} = policy.${quoteDatabaseIdentifier(database, "id")} AND policy_member.${quoteDatabaseIdentifier(
          database,
          "subject_id",
        )} = ${databasePlaceholder(database, 2)})))${apiAccessSql}${cursorSql} ORDER BY space.${quoteDatabaseIdentifier(
          database,
          "slug",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName,
      });
      const rows = result.rows.map(mapKnowledgeSpaceRow);
      const items = rows.slice(0, limit).map(cloneSpace);
      const nextCursor = rows.length > limit ? items.at(-1)?.slug : undefined;
      return { items, ...(nextCursor ? { nextCursor } : {}) };
    },
    update: async ({ expectedRevision, id, permission, tenantId, ...input }) => {
      validateKnowledgeSpaceRevision(expectedRevision, "expectedRevision");
      const existing = await databaseKnowledgeSpaceGet(database, { id, tenantId });

      if (!existing) {
        return null;
      }
      if (existing.revision !== expectedRevision) {
        throw new KnowledgeSpaceRevisionConflictError(expectedRevision, existing.revision);
      }
      if (!permission) {
        throw new KnowledgeSpacePermissionFenceRequiredError();
      }

      const nextSlug = input.slug ?? existing.slug;

      if (nextSlug !== existing.slug) {
        const conflict = await findDatabaseSpaceBySlug(database, tenantId, nextSlug);

        if (conflict && conflict.id !== id) {
          throw new DuplicateKnowledgeSpaceSlugError();
        }
      }

      const updatedAt = now();
      const params = [
        input.name ?? existing.name,
        nextSlug,
        input.description ?? existing.description ?? null,
        input.iconRef === undefined ? (existing.iconRef ?? null) : input.iconRef,
        existing.revision + 1,
        updatedAt,
        tenantId,
        id,
        expectedRevision,
      ] satisfies readonly DatabaseQueryValue[];
      try {
        return await database.transaction(async (transaction) => {
          if (
            !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
              knowledgeSpaceId: id,
              tenantId,
            }))
          ) {
            throw new KnowledgeSpaceRevisionConflictError(expectedRevision);
          }
          if (permission) {
            await assertDatabaseKnowledgeSpacePermissionFence({
              database,
              executor: transaction,
              fence: permission.fence,
              now: permission.now,
              requiredAccess: permission.requiredAccess,
            });
          }
          const result = await transaction.execute({
            maxRows: 1,
            operation: "update",
            params,
            sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${quoteDatabaseIdentifier(
              database,
              "name",
            )} = ${databasePlaceholder(database, 1)}, ${quoteDatabaseIdentifier(
              database,
              "slug",
            )} = ${databasePlaceholder(database, 2)}, ${quoteDatabaseIdentifier(
              database,
              "description",
            )} = ${databasePlaceholder(database, 3)}, ${quoteDatabaseIdentifier(
              database,
              "icon_ref",
            )} = ${databasePlaceholder(database, 4)}, ${quoteDatabaseIdentifier(
              database,
              "revision",
            )} = ${databasePlaceholder(database, 5)}, ${quoteDatabaseIdentifier(
              database,
              "updated_at",
            )} = ${databasePlaceholder(database, 6)} WHERE ${quoteDatabaseIdentifier(
              database,
              "tenant_id",
            )} = ${databasePlaceholder(database, 7)} AND ${quoteDatabaseIdentifier(
              database,
              "id",
            )} = ${databasePlaceholder(database, 8)} AND ${quoteDatabaseIdentifier(
              database,
              "revision",
            )} = ${databasePlaceholder(database, 9)} AND ${quoteDatabaseIdentifier(
              database,
              "lifecycle_state",
            )} = 'active' AND ${quoteDatabaseIdentifier(database, "deletion_job_id")} IS NULL${
              database.dialect === "postgres" ? " RETURNING *" : ""
            };`,
            tableName,
          });

          if (result.rowsAffected === 0 && !result.rows[0]) {
            throw new KnowledgeSpaceRevisionConflictError(expectedRevision);
          }
          const updatedSpace = result.rows[0]
            ? mapKnowledgeSpaceRow(result.rows[0])
            : KnowledgeSpaceSchema.parse({
                ...existing,
                ...(input.description !== undefined ? { description: input.description } : {}),
                ...(input.iconRef === undefined
                  ? {}
                  : input.iconRef === null
                    ? { iconRef: undefined }
                    : { iconRef: input.iconRef }),
                name: input.name ?? existing.name,
                revision: existing.revision + 1,
                slug: nextSlug,
                updatedAt,
              });
          await appendKnowledgeSpaceActivityWithExecutor({
            database,
            executor: transaction,
            input: {
              action: "settings.updated",
              actor: input.actorSubjectId
                ? { id: input.actorSubjectId, type: "member" }
                : { type: "system" },
              details: {},
              id: deterministicKnowledgeSpaceActivityId(
                "settings.updated",
                tenantId,
                id,
                String(updatedSpace.revision),
              ),
              knowledgeSpaceId: id,
              occurredAt: updatedAt,
              requiredPermissionScope: [],
              resource: { id, type: "knowledge-space" },
              result: "success",
              tenantId,
            },
          });
          return updatedSpace;
        });
      } catch (error) {
        if (isTenantSlugUniqueViolation(error)) {
          throw new DuplicateKnowledgeSpaceSlugError();
        }
        throw error;
      }
    },
  };
}

async function databaseKnowledgeSpaceGet(
  database: DatabaseAdapter,
  input: KnowledgeSpaceLookupInput,
): Promise<KnowledgeSpace | null> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.id],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "knowledge_spaces")} WHERE ${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(
      database,
      "lifecycle_state",
    )} = 'active' LIMIT 1;`,
    tableName: "knowledge_spaces",
  });

  return result.rows[0] ? mapKnowledgeSpaceRow(result.rows[0]) : null;
}

async function databaseKnowledgeSpaceGetForDeletion(
  database: DatabaseAdapter,
  input: KnowledgeSpaceLookupInput,
): Promise<KnowledgeSpace | null> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.id],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "knowledge_spaces")} WHERE ${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "id",
    )} = ${databasePlaceholder(database, 2)} LIMIT 1;`,
    tableName: "knowledge_spaces",
  });

  return result.rows[0] ? mapKnowledgeSpaceRow(result.rows[0]) : null;
}

async function findDatabaseSpaceBySlug(
  database: DatabaseAdapter,
  tenantId: string,
  slug: string,
): Promise<KnowledgeSpace | null> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId, slug],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, "knowledge_spaces")} WHERE ${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "slug",
    )} = ${databasePlaceholder(database, 2)} LIMIT 1;`,
    tableName: "knowledge_spaces",
  });

  return result.rows[0] ? mapKnowledgeSpaceRow(result.rows[0]) : null;
}

function mapKnowledgeSpaceRow(row: DatabaseRow): KnowledgeSpace {
  const description = optionalStringColumn(row, "description");
  const iconRef = optionalStringColumn(row, "icon_ref");

  return KnowledgeSpaceSchema.parse({
    createdAt: stringColumn(row, "created_at"),
    ...(description ? { description } : {}),
    ...(iconRef ? { iconRef } : {}),
    id: stringColumn(row, "id"),
    name: stringColumn(row, "name"),
    revision: numberColumn(row, "revision"),
    slug: stringColumn(row, "slug"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function validateKnowledgeSpaceRepositoryBounds({
  maxListLimit,
  maxSpaces,
}: {
  readonly maxListLimit: number;
  readonly maxSpaces: number;
}): void {
  if (maxSpaces < 1) {
    throw new Error("Knowledge space repository maxSpaces must be at least 1");
  }

  if (maxListLimit < 1) {
    throw new Error("Knowledge space repository maxListLimit must be at least 1");
  }
}

function validateKnowledgeSpaceListLimit(limit: number, maxListLimit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Knowledge space list limit must be at least 1");
  }

  if (limit > maxListLimit) {
    throw new KnowledgeSpaceListLimitExceededError(maxListLimit);
  }
}

function validateKnowledgeSpaceRevision(revision: number, field: string): void {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error(`Knowledge space ${field} must be a positive integer`);
  }
}

function hasTenantSlug(
  spaces: ReadonlyMap<string, KnowledgeSpace>,
  tenantId: string,
  slug: string,
  exceptId?: string,
): boolean {
  for (const space of spaces.values()) {
    if (space.id !== exceptId && space.tenantId === tenantId && space.slug === slug) {
      return true;
    }
  }

  return false;
}

function cloneSpace(space: KnowledgeSpace): KnowledgeSpace {
  return { ...space };
}

function isTenantSlugUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : undefined;
  const constraint = typeof record.constraint === "string" ? record.constraint : undefined;
  const errno = typeof record.errno === "number" ? record.errno : undefined;
  const message = error instanceof Error ? error.message : String(record.message ?? "");

  if (code === "23505") {
    return constraint === "knowledge_spaces_tenant_slug_uq";
  }

  return (
    (code === "ER_DUP_ENTRY" || errno === 1062) &&
    /knowledge_spaces[^\n]*slug[^\n]*(?:uq|guard)|(?:uq|guard)[^\n]*knowledge_spaces[^\n]*slug/iu.test(
      message,
    )
  );
}
