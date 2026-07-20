import { createHash } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  type KnowledgeSpace,
  type KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceEmbeddingProfileSchema,
  type KnowledgeSpaceEmbeddingSelection,
  KnowledgeSpaceEmbeddingSelectionSchema,
  type KnowledgeSpaceManifest,
  KnowledgeSpaceManifestSchema,
  type KnowledgeSpacePendingModelConfiguration,
  KnowledgeSpacePendingModelConfigurationSchema,
  type KnowledgeSpaceRetrievalProfile,
  type KnowledgeSpaceRetrievalProfileInput,
  KnowledgeSpaceRetrievalProfileInputSchema,
  type KnowledgeSpaceVectorSpaceIdentity,
  createDefaultKnowledgeSpaceManifest,
  createKnowledgeSpaceEmbeddingProfile,
  createKnowledgeSpaceRetrievalProfile,
  stableJson,
  updateKnowledgeSpaceEmbeddingProfile,
} from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import { omitKnowledgeFsReservedMetadata } from "./knowledge-fs-reserved-metadata";
import {
  type DatabaseKnowledgeSpacePermissionFence,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";

export interface KnowledgeSpaceManifestLookupInput {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface ListKnowledgeSpaceManifestsInput {
  readonly cursor?: string | undefined;
  readonly limit: number;
  readonly tenantId: string;
}

export interface ListKnowledgeSpaceManifestsResult {
  readonly items: KnowledgeSpaceManifest[];
  readonly nextCursor?: string;
}

export interface UpdateKnowledgeSpaceManifestInput extends KnowledgeSpaceManifestLookupInput {
  readonly expectedManifestVersion?: number | undefined;
  readonly permission?:
    | {
        readonly fence: DatabaseKnowledgeSpacePermissionFence;
        readonly now: string;
        readonly requiredAccess: "admin" | "write";
      }
    | undefined;
  readonly patch: Partial<KnowledgeSpaceManifest>;
}

export interface KnowledgeSpaceManifestRepository {
  create(input: KnowledgeSpaceManifest): Promise<KnowledgeSpaceManifest>;
  /** Compensation primitive for atomic knowledge-space provisioning and durable deletion. */
  delete?(input: KnowledgeSpaceManifestLookupInput): Promise<boolean>;
  get(input: KnowledgeSpaceManifestLookupInput): Promise<KnowledgeSpaceManifest | null>;
  list(input: ListKnowledgeSpaceManifestsInput): Promise<ListKnowledgeSpaceManifestsResult>;
  update(input: UpdateKnowledgeSpaceManifestInput): Promise<KnowledgeSpaceManifest | null>;
}

export interface InMemoryKnowledgeSpaceManifestRepositoryOptions {
  readonly maxListLimit: number;
  readonly maxManifests: number;
}

export interface DatabaseKnowledgeSpaceManifestRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxListLimit: number;
}

export interface EnsureKnowledgeSpaceManifestInput {
  readonly embeddingDimension?: number | undefined;
  readonly embeddingSelection?: KnowledgeSpaceEmbeddingSelection | undefined;
  readonly embeddingVectorSpaceIdentity?: KnowledgeSpaceVectorSpaceIdentity | undefined;
  readonly generateId: () => string;
  readonly manifests: KnowledgeSpaceManifestRepository;
  readonly now: () => string;
  readonly pendingModelConfiguration?: KnowledgeSpacePendingModelConfiguration | undefined;
  readonly retrievalProfile?: KnowledgeSpaceRetrievalProfileInput | undefined;
  readonly space: KnowledgeSpace;
}

export interface CreateKnowledgeSpacePendingModelConfigurationInput {
  readonly embeddingSelection?: KnowledgeSpaceEmbeddingSelection | undefined;
  readonly retrievalProfile?: KnowledgeSpaceRetrievalProfileInput | undefined;
  readonly revision?: number | undefined;
}

export function createKnowledgeSpacePendingModelConfiguration({
  embeddingSelection,
  retrievalProfile,
  revision = 1,
}: CreateKnowledgeSpacePendingModelConfigurationInput): KnowledgeSpacePendingModelConfiguration {
  const normalizedEmbedding = embeddingSelection
    ? KnowledgeSpaceEmbeddingSelectionSchema.parse(embeddingSelection)
    : undefined;
  const normalizedRetrieval = retrievalProfile
    ? KnowledgeSpaceRetrievalProfileInputSchema.parse(retrievalProfile)
    : undefined;
  const material = {
    embeddingSelection: normalizedEmbedding ?? null,
    retrievalProfile: normalizedRetrieval ?? null,
    revision,
    schemaVersion: 1,
  };
  return KnowledgeSpacePendingModelConfigurationSchema.parse({
    digest: createHash("sha256").update(stableJson(material)).digest("hex"),
    ...(normalizedEmbedding ? { embeddingSelection: normalizedEmbedding } : {}),
    ...(normalizedRetrieval ? { retrievalProfile: normalizedRetrieval } : {}),
    revision,
    state: "pending-validation",
  });
}

export interface UpdateKnowledgeSpaceEmbeddingSelectionInput
  extends KnowledgeSpaceManifestLookupInput {
  readonly dimension?: number | undefined;
  readonly now: () => string;
  readonly permission?: UpdateKnowledgeSpaceManifestInput["permission"] | undefined;
  readonly selection: KnowledgeSpaceEmbeddingSelection;
  readonly vectorSpaceIdentity?: KnowledgeSpaceVectorSpaceIdentity | undefined;
}

export interface FreezeKnowledgeSpaceEmbeddingProfileInput
  extends KnowledgeSpaceManifestLookupInput {
  readonly now: () => string;
}

export interface ObserveKnowledgeSpaceEmbeddingDimensionInput
  extends KnowledgeSpaceManifestLookupInput {
  readonly dimension: number;
  readonly expectedRevision: number;
  readonly expectedVectorSpaceId: string;
  readonly now: () => string;
}

export interface UpdateKnowledgeSpaceRetrievalProfileInput
  extends KnowledgeSpaceManifestLookupInput {
  readonly expectedRevision: number;
  readonly now: () => string;
  readonly permission?: UpdateKnowledgeSpaceManifestInput["permission"] | undefined;
  readonly profile: KnowledgeSpaceRetrievalProfileInput;
}

export class DuplicateKnowledgeSpaceManifestError extends Error {
  constructor() {
    super("KnowledgeSpaceManifest already exists for knowledge space");
  }
}

export class KnowledgeSpaceManifestCapacityExceededError extends Error {
  constructor(maxManifests: number) {
    super(`KnowledgeSpaceManifest repository maxManifests=${maxManifests} exceeded`);
  }
}

export class KnowledgeSpaceManifestListLimitExceededError extends Error {
  constructor(maxListLimit: number) {
    super(`KnowledgeSpaceManifest list limit exceeds maxListLimit=${maxListLimit}`);
  }
}

export class KnowledgeSpaceEmbeddingDimensionConflictError extends Error {
  constructor(vectorSpaceId: string, expected: number, observed: number) {
    super(
      `Embedding dimension conflict for vectorSpaceId=${vectorSpaceId}: expected ${expected}, observed ${observed}`,
    );
  }
}

export class KnowledgeSpaceEmbeddingProfileFrozenError extends Error {
  readonly frozenAt: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;

  constructor({
    frozenAt,
    knowledgeSpaceId,
    tenantId,
  }: {
    readonly frozenAt: string;
    readonly knowledgeSpaceId: string;
    readonly tenantId: string;
  }) {
    super(
      `Embedding profile for tenantId=${tenantId} knowledgeSpaceId=${knowledgeSpaceId} ` +
        `was frozen at ${frozenAt}; changing the selection requires reindexing`,
    );
    this.name = "KnowledgeSpaceEmbeddingProfileFrozenError";
    this.frozenAt = frozenAt;
    this.knowledgeSpaceId = knowledgeSpaceId;
    this.tenantId = tenantId;
  }
}

export class KnowledgeSpaceRetrievalProfileRevisionConflictError extends Error {
  readonly actualRevision: number;
  readonly expectedRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(
      `Knowledge space retrieval profile revision conflict: expected=${expectedRevision} actual=${actualRevision}`,
    );
    this.name = "KnowledgeSpaceRetrievalProfileRevisionConflictError";
    this.actualRevision = actualRevision;
    this.expectedRevision = expectedRevision;
  }
}

export function createInMemoryKnowledgeSpaceManifestRepository({
  maxListLimit,
  maxManifests,
}: InMemoryKnowledgeSpaceManifestRepositoryOptions): KnowledgeSpaceManifestRepository {
  validateKnowledgeSpaceManifestRepositoryBounds({ maxListLimit, maxManifests });

  const manifests = new Map<string, KnowledgeSpaceManifest>();

  return {
    create: async (input) => {
      const manifest = cloneManifest(KnowledgeSpaceManifestSchema.parse(input));
      const key = manifestKey(manifest.tenantId, manifest.knowledgeSpaceId);

      if (manifests.has(key)) {
        throw new DuplicateKnowledgeSpaceManifestError();
      }

      if (manifests.size >= maxManifests) {
        throw new KnowledgeSpaceManifestCapacityExceededError(maxManifests);
      }

      manifests.set(key, cloneManifest(manifest));

      return cloneManifest(manifest);
    },
    delete: async ({ knowledgeSpaceId, tenantId }) =>
      manifests.delete(manifestKey(tenantId, knowledgeSpaceId)),
    get: async ({ knowledgeSpaceId, tenantId }) => {
      const manifest = manifests.get(manifestKey(tenantId, knowledgeSpaceId));

      return manifest ? cloneManifest(manifest) : null;
    },
    list: async ({ cursor, limit, tenantId }) => {
      validateKnowledgeSpaceManifestListLimit(limit, maxListLimit);

      const page = Array.from(manifests.values())
        .filter((manifest) => manifest.tenantId === tenantId)
        .filter((manifest) => (cursor ? manifest.knowledgeSpaceId > cursor : true))
        .sort((left, right) => left.knowledgeSpaceId.localeCompare(right.knowledgeSpaceId))
        .slice(0, limit + 1);
      const items = page.slice(0, limit).map(cloneManifest);
      const nextCursor = page.length > limit ? items.at(-1)?.knowledgeSpaceId : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    update: async ({ expectedManifestVersion, knowledgeSpaceId, patch, tenantId }) => {
      const key = manifestKey(tenantId, knowledgeSpaceId);
      const existing = manifests.get(key);

      if (
        !existing ||
        (expectedManifestVersion !== undefined &&
          existing.manifestVersion !== expectedManifestVersion)
      ) {
        return null;
      }

      const updated = KnowledgeSpaceManifestSchema.parse({
        ...existing,
        ...patch,
        createdAt: existing.createdAt,
        id: existing.id,
        knowledgeSpaceId: existing.knowledgeSpaceId,
        objectKeyPrefix: existing.objectKeyPrefix,
        tenantId: existing.tenantId,
      });

      manifests.set(key, cloneManifest(updated));

      return cloneManifest(updated);
    },
  };
}

export function createDatabaseKnowledgeSpaceManifestRepository({
  database,
  maxListLimit,
}: DatabaseKnowledgeSpaceManifestRepositoryOptions): KnowledgeSpaceManifestRepository {
  if (!Number.isInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("KnowledgeSpaceManifest repository maxListLimit must be at least 1");
  }

  const tableName = "knowledge_space_manifests";

  return {
    create: async (input) => {
      const manifest = KnowledgeSpaceManifestSchema.parse(input);
      const existing = await databaseKnowledgeSpaceManifestGet(database, database, {
        knowledgeSpaceId: manifest.knowledgeSpaceId,
        tenantId: manifest.tenantId,
      });

      if (existing) {
        throw new DuplicateKnowledgeSpaceManifestError();
      }

      const columns = manifestColumns();
      const params = manifestColumnValues(manifest);
      const result = await database
        .transaction(async (transaction) => {
          if (!(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, manifest))) {
            throw new Error("Knowledge space is unavailable for manifest creation");
          }
          return transaction.execute({
            maxRows: 1,
            operation: "insert",
            params,
            sql: `INSERT INTO ${quoteDatabaseIdentifier(database, tableName)} (${columns
              .map((column) => quoteDatabaseIdentifier(database, column))
              .join(", ")}) VALUES (${params
              .map((_, index) =>
                manifestValuePlaceholder(database, index + 1, columns[index] ?? ""),
              )
              .join(", ")})${database.dialect === "postgres" ? " RETURNING *" : ""};`,
            tableName,
          });
        })
        .catch(async (error: unknown) => {
          // Preserve the repository's duplicate contract under a concurrent create race while
          // rethrowing unrelated database failures unchanged.
          const raced = await databaseKnowledgeSpaceManifestGet(database, database, {
            knowledgeSpaceId: manifest.knowledgeSpaceId,
            tenantId: manifest.tenantId,
          });

          if (raced) {
            throw new DuplicateKnowledgeSpaceManifestError();
          }

          throw error;
        });

      if (result.rows[0]) {
        return mapKnowledgeSpaceManifestRow(result.rows[0]);
      }

      const inserted = await databaseKnowledgeSpaceManifestGet(database, database, {
        knowledgeSpaceId: manifest.knowledgeSpaceId,
        tenantId: manifest.tenantId,
      });

      if (!inserted) {
        throw new Error("Database insert did not return a knowledge space manifest");
      }

      return inserted;
    },
    delete: async ({ knowledgeSpaceId, tenantId }) => {
      const result = await database.execute({
        maxRows: 0,
        operation: "delete",
        params: [tenantId, knowledgeSpaceId],
        sql: `DELETE FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "tenant_id",
        )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} = ${databasePlaceholder(database, 2)};`,
        tableName,
      });
      return result.rowsAffected > 0;
    },
    get: async (input) => databaseKnowledgeSpaceManifestGet(database, database, input),
    list: async ({ cursor, limit, tenantId }) => {
      validateKnowledgeSpaceManifestListLimit(limit, maxListLimit);

      const readLimit = limit + 1;
      const params = (
        cursor ? [tenantId, cursor, readLimit] : [tenantId, readLimit]
      ) satisfies readonly DatabaseQueryValue[];
      const cursorSql = cursor
        ? ` AND ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} > ${databasePlaceholder(database, 2)}`
        : "";
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params,
        sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, tableName)} WHERE ${quoteDatabaseIdentifier(
          database,
          "tenant_id",
        )} = ${databasePlaceholder(database, 1)}${cursorSql} ORDER BY ${quoteDatabaseIdentifier(
          database,
          "knowledge_space_id",
        )} ASC LIMIT ${databasePlaceholder(database, params.length)};`,
        tableName,
      });
      const rows = result.rows.map(mapKnowledgeSpaceManifestRow);
      const items = rows.slice(0, limit).map(cloneManifest);
      const nextCursor = rows.length > limit ? items.at(-1)?.knowledgeSpaceId : undefined;

      return {
        items,
        ...(nextCursor ? { nextCursor } : {}),
      };
    },
    update: async ({ expectedManifestVersion, knowledgeSpaceId, patch, permission, tenantId }) =>
      database.transaction(async (transaction) => {
        if (
          !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
            knowledgeSpaceId,
            tenantId,
          }))
        ) {
          return null;
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
        const existing = await databaseKnowledgeSpaceManifestGet(
          database,
          transaction,
          { knowledgeSpaceId, tenantId },
          true,
        );

        if (
          !existing ||
          (expectedManifestVersion !== undefined &&
            existing.manifestVersion !== expectedManifestVersion)
        ) {
          return null;
        }

        const updated = KnowledgeSpaceManifestSchema.parse({
          ...existing,
          ...patch,
          createdAt: existing.createdAt,
          id: existing.id,
          knowledgeSpaceId: existing.knowledgeSpaceId,
          objectKeyPrefix: existing.objectKeyPrefix,
          tenantId: existing.tenantId,
        });
        const columns = mutableManifestColumns();
        const params = [
          ...mutableManifestColumnValues(updated),
          tenantId,
          knowledgeSpaceId,
          ...(expectedManifestVersion !== undefined ? [expectedManifestVersion] : []),
        ] satisfies readonly DatabaseQueryValue[];
        const expectedVersionSql =
          expectedManifestVersion === undefined
            ? ""
            : ` AND ${quoteDatabaseIdentifier(
                database,
                "manifest_version",
              )} = ${databasePlaceholder(database, columns.length + 3)}`;
        const result = await transaction.execute({
          maxRows: 1,
          operation: "update",
          params,
          sql: `UPDATE ${quoteDatabaseIdentifier(database, tableName)} SET ${columns
            .map(
              (column, index) =>
                `${quoteDatabaseIdentifier(database, column)} = ${manifestValuePlaceholder(
                  database,
                  index + 1,
                  column,
                )}`,
            )
            .join(", ")} WHERE ${quoteDatabaseIdentifier(
            database,
            "tenant_id",
          )} = ${databasePlaceholder(database, columns.length + 1)} AND ${quoteDatabaseIdentifier(
            database,
            "knowledge_space_id",
          )} = ${databasePlaceholder(database, columns.length + 2)}${expectedVersionSql}${
            database.dialect === "postgres" ? " RETURNING *" : ""
          };`,
          tableName,
        });

        if (result.rowsAffected === 0 && result.rows.length === 0) {
          return null;
        }

        return result.rows[0]
          ? mapKnowledgeSpaceManifestRow(result.rows[0])
          : databaseKnowledgeSpaceManifestGet(database, transaction, {
              knowledgeSpaceId,
              tenantId,
            });
      }),
  };
}

export async function ensureKnowledgeSpaceManifest({
  embeddingDimension,
  embeddingSelection,
  embeddingVectorSpaceIdentity,
  generateId,
  manifests,
  now,
  pendingModelConfiguration,
  retrievalProfile: retrievalProfileInput,
  space,
}: EnsureKnowledgeSpaceManifestInput): Promise<KnowledgeSpaceManifest> {
  const existing = await manifests.get({
    knowledgeSpaceId: space.id,
    tenantId: space.tenantId,
  });

  if (existing) {
    return existing;
  }

  const timestamp = now();
  const embeddingProfile = embeddingSelection
    ? await createKnowledgeSpaceEmbeddingProfile(
        embeddingSelection,
        1,
        embeddingVectorSpaceIdentity,
      )
    : undefined;
  const observedEmbeddingProfile =
    embeddingProfile && embeddingDimension !== undefined
      ? KnowledgeSpaceEmbeddingProfileSchema.parse({
          ...embeddingProfile,
          dimension: embeddingDimension,
        })
      : embeddingProfile;
  const retrievalProfile = retrievalProfileInput
    ? createKnowledgeSpaceRetrievalProfile(retrievalProfileInput)
    : undefined;
  const manifest = createDefaultKnowledgeSpaceManifest({
    createdAt: timestamp,
    ...(observedEmbeddingProfile ? { embeddingProfile: observedEmbeddingProfile } : {}),
    id: generateId(),
    knowledgeSpaceId: space.id,
    ...(pendingModelConfiguration ? { pendingModelConfiguration } : {}),
    ...(retrievalProfile ? { retrievalProfile } : {}),
    tenantId: space.tenantId,
    updatedAt: timestamp,
  });

  try {
    return await manifests.create(manifest);
  } catch (error) {
    if (!(error instanceof DuplicateKnowledgeSpaceManifestError)) {
      throw error;
    }

    const raced = await manifests.get({
      knowledgeSpaceId: space.id,
      tenantId: space.tenantId,
    });

    if (!raced) {
      throw error;
    }

    return raced;
  }
}

export async function updateKnowledgeSpaceEmbeddingSelection(
  manifests: KnowledgeSpaceManifestRepository,
  {
    dimension,
    knowledgeSpaceId,
    now,
    permission,
    selection,
    tenantId,
    vectorSpaceIdentity,
  }: UpdateKnowledgeSpaceEmbeddingSelectionInput,
): Promise<KnowledgeSpaceEmbeddingProfile | null> {
  for (let attempt = 0; attempt < MANIFEST_CAS_ATTEMPTS; attempt += 1) {
    const current = await manifests.get({ knowledgeSpaceId, tenantId });

    if (!current) {
      return null;
    }

    const nextProfile = await updateKnowledgeSpaceEmbeddingProfile(
      current.embeddingProfile,
      selection,
      vectorSpaceIdentity,
    );
    const parsedDimension =
      dimension === undefined
        ? undefined
        : Number.isSafeInteger(dimension) && dimension > 0
          ? dimension
          : null;
    if (parsedDimension === null) {
      throw new Error("Observed embedding dimension must be a positive integer");
    }
    if (
      current.embeddingProfile?.vectorSpaceId === nextProfile.vectorSpaceId &&
      current.embeddingProfile.dimension !== undefined &&
      parsedDimension !== undefined &&
      current.embeddingProfile.dimension !== parsedDimension
    ) {
      throw new KnowledgeSpaceEmbeddingDimensionConflictError(
        nextProfile.vectorSpaceId,
        current.embeddingProfile.dimension,
        parsedDimension,
      );
    }
    const embeddingProfile =
      parsedDimension === undefined
        ? nextProfile
        : KnowledgeSpaceEmbeddingProfileSchema.parse({
            ...nextProfile,
            dimension: parsedDimension,
          });

    if (
      embeddingProfile === current.embeddingProfile ||
      (current.embeddingProfile?.vectorSpaceId === embeddingProfile.vectorSpaceId &&
        current.embeddingProfile.dimension === embeddingProfile.dimension)
    ) {
      return embeddingProfile;
    }

    if (current.embeddingProfileFrozenAt) {
      throw new KnowledgeSpaceEmbeddingProfileFrozenError({
        frozenAt: current.embeddingProfileFrozenAt,
        knowledgeSpaceId,
        tenantId,
      });
    }

    const updated = await manifests.update({
      expectedManifestVersion: current.manifestVersion,
      knowledgeSpaceId,
      ...(permission ? { permission } : {}),
      patch: {
        embeddingProfile,
        manifestVersion: current.manifestVersion + 1,
        updatedAt: now(),
      },
      tenantId,
    });

    if (updated) {
      return updated.embeddingProfile ?? null;
    }
  }

  throw new Error(
    "KnowledgeSpaceManifest embedding profile update contention exceeded retry limit",
  );
}

export async function updateKnowledgeSpaceRetrievalProfile(
  manifests: KnowledgeSpaceManifestRepository,
  {
    expectedRevision,
    knowledgeSpaceId,
    now,
    permission,
    profile,
    tenantId,
  }: UpdateKnowledgeSpaceRetrievalProfileInput,
): Promise<KnowledgeSpaceRetrievalProfile | null> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error("Knowledge space retrieval profile expectedRevision must be non-negative");
  }

  for (let attempt = 0; attempt < MANIFEST_CAS_ATTEMPTS; attempt += 1) {
    const current = await manifests.get({ knowledgeSpaceId, tenantId });

    if (!current) {
      return null;
    }

    const actualRevision = current.retrievalProfile?.revision ?? 0;
    if (actualRevision !== expectedRevision) {
      throw new KnowledgeSpaceRetrievalProfileRevisionConflictError(
        expectedRevision,
        actualRevision,
      );
    }

    const retrievalProfile = createKnowledgeSpaceRetrievalProfile(profile, actualRevision + 1);
    const updated = await manifests.update({
      expectedManifestVersion: current.manifestVersion,
      knowledgeSpaceId,
      ...(permission ? { permission } : {}),
      patch: {
        manifestVersion: current.manifestVersion + 1,
        retrievalProfile,
        updatedAt: now(),
      },
      tenantId,
    });

    if (updated) {
      return updated.retrievalProfile ?? null;
    }
  }

  throw new Error(
    "KnowledgeSpaceManifest retrieval profile update contention exceeded retry limit",
  );
}

/**
 * Atomically closes the inline embedding-selection mutation window before ingestion is admitted.
 * The latch is deliberately one-way: a failed downstream asset write does not reopen a race with
 * a profile switch, and clearing it is reserved for an explicit reindex workflow.
 */
export async function freezeKnowledgeSpaceEmbeddingProfile(
  manifests: KnowledgeSpaceManifestRepository,
  { knowledgeSpaceId, now, tenantId }: FreezeKnowledgeSpaceEmbeddingProfileInput,
): Promise<string | null> {
  for (let attempt = 0; attempt < MANIFEST_CAS_ATTEMPTS; attempt += 1) {
    const current = await manifests.get({ knowledgeSpaceId, tenantId });

    if (!current) {
      return null;
    }

    if (current.embeddingProfileFrozenAt) {
      return current.embeddingProfileFrozenAt;
    }

    const frozenAt = now();
    const updated = await manifests.update({
      expectedManifestVersion: current.manifestVersion,
      knowledgeSpaceId,
      patch: {
        embeddingProfileFrozenAt: frozenAt,
        manifestVersion: current.manifestVersion + 1,
        updatedAt: frozenAt,
      },
      tenantId,
    });

    if (updated?.embeddingProfileFrozenAt) {
      return updated.embeddingProfileFrozenAt;
    }
  }

  throw new Error(
    "KnowledgeSpaceManifest embedding profile freeze contention exceeded retry limit",
  );
}

/**
 * Records a daemon-observed dimension only if the same vector space is still active. The manifest
 * version CAS prevents a late response from an old model selection overwriting a newer profile.
 */
export async function observeKnowledgeSpaceEmbeddingDimension(
  manifests: KnowledgeSpaceManifestRepository,
  {
    dimension,
    expectedRevision,
    expectedVectorSpaceId,
    knowledgeSpaceId,
    now,
    tenantId,
  }: ObserveKnowledgeSpaceEmbeddingDimensionInput,
): Promise<KnowledgeSpaceEmbeddingProfile | null> {
  const parsedDimension = Number.isSafeInteger(dimension) && dimension > 0 ? dimension : null;

  if (parsedDimension === null) {
    throw new Error("Observed embedding dimension must be a positive integer");
  }

  for (let attempt = 0; attempt < MANIFEST_CAS_ATTEMPTS; attempt += 1) {
    const current = await manifests.get({ knowledgeSpaceId, tenantId });
    const embeddingProfile = current?.embeddingProfile;

    if (
      !current ||
      !embeddingProfile ||
      embeddingProfile.revision !== expectedRevision ||
      embeddingProfile.vectorSpaceId !== expectedVectorSpaceId
    ) {
      return null;
    }

    if (embeddingProfile.dimension !== undefined) {
      if (embeddingProfile.dimension !== parsedDimension) {
        throw new KnowledgeSpaceEmbeddingDimensionConflictError(
          expectedVectorSpaceId,
          embeddingProfile.dimension,
          parsedDimension,
        );
      }

      return embeddingProfile;
    }

    const updated = await manifests.update({
      expectedManifestVersion: current.manifestVersion,
      knowledgeSpaceId,
      patch: {
        embeddingProfile: KnowledgeSpaceEmbeddingProfileSchema.parse({
          ...embeddingProfile,
          dimension: parsedDimension,
        }),
        manifestVersion: current.manifestVersion + 1,
        updatedAt: now(),
      },
      tenantId,
    });

    if (updated) {
      return updated.embeddingProfile ?? null;
    }
  }

  throw new Error("KnowledgeSpaceManifest dimension observation contention exceeded retry limit");
}

const MANIFEST_CAS_ATTEMPTS = 4;

function validateKnowledgeSpaceManifestRepositoryBounds({
  maxListLimit,
  maxManifests,
}: InMemoryKnowledgeSpaceManifestRepositoryOptions): void {
  if (!Number.isInteger(maxListLimit) || maxListLimit < 1) {
    throw new Error("KnowledgeSpaceManifest repository maxListLimit must be at least 1");
  }

  if (!Number.isInteger(maxManifests) || maxManifests < 1) {
    throw new Error("KnowledgeSpaceManifest repository maxManifests must be at least 1");
  }
}

function validateKnowledgeSpaceManifestListLimit(limit: number, maxListLimit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxListLimit) {
    throw new KnowledgeSpaceManifestListLimitExceededError(maxListLimit);
  }
}

function manifestKey(tenantId: string, knowledgeSpaceId: string): string {
  return `${tenantId}:${knowledgeSpaceId}`;
}

function cloneManifest(manifest: KnowledgeSpaceManifest): KnowledgeSpaceManifest {
  return KnowledgeSpaceManifestSchema.parse(JSON.parse(JSON.stringify(manifest)) as unknown);
}

async function databaseKnowledgeSpaceManifestGet(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  { knowledgeSpaceId, tenantId }: KnowledgeSpaceManifestLookupInput,
  forUpdate = false,
): Promise<KnowledgeSpaceManifest | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId, knowledgeSpaceId],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_manifests",
    )} WHERE ${quoteDatabaseIdentifier(
      database,
      "tenant_id",
    )} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(
      database,
      "knowledge_space_id",
    )} = ${databasePlaceholder(database, 2)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: "knowledge_space_manifests",
  });

  return result.rows[0] ? mapKnowledgeSpaceManifestRow(result.rows[0]) : null;
}

function manifestColumns(): readonly string[] {
  return [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "manifest_version",
    "storage_provider",
    "object_key_prefix",
    "metadata_dialect",
    "parser_policy_version",
    "node_schema_version",
    "projection_set_version",
    "min_client_version",
    "retention_policy",
    "quota_policy",
    "consistency_policy",
    "encryption_policy",
    "metadata",
    "created_at",
    "updated_at",
  ];
}

function manifestColumnValues(manifest: KnowledgeSpaceManifest): readonly DatabaseQueryValue[] {
  return [
    manifest.id,
    manifest.tenantId,
    manifest.knowledgeSpaceId,
    manifest.manifestVersion,
    manifest.storageProvider,
    manifest.objectKeyPrefix,
    manifest.metadataDialect,
    manifest.parserPolicyVersion,
    manifest.nodeSchemaVersion,
    manifest.projectionSetVersion,
    manifest.minClientVersion,
    JSON.stringify(manifest.retentionPolicy),
    JSON.stringify(manifest.quotaPolicy),
    JSON.stringify(manifest.consistencyPolicy),
    JSON.stringify(manifest.encryptionPolicy),
    JSON.stringify(persistedManifestMetadata(manifest)),
    manifest.createdAt,
    manifest.updatedAt,
  ];
}

function mutableManifestColumns(): readonly string[] {
  return [
    "manifest_version",
    "storage_provider",
    "metadata_dialect",
    "parser_policy_version",
    "node_schema_version",
    "projection_set_version",
    "min_client_version",
    "retention_policy",
    "quota_policy",
    "consistency_policy",
    "encryption_policy",
    "metadata",
    "updated_at",
  ];
}

function mutableManifestColumnValues(
  manifest: KnowledgeSpaceManifest,
): readonly DatabaseQueryValue[] {
  return [
    manifest.manifestVersion,
    manifest.storageProvider,
    manifest.metadataDialect,
    manifest.parserPolicyVersion,
    manifest.nodeSchemaVersion,
    manifest.projectionSetVersion,
    manifest.minClientVersion,
    JSON.stringify(manifest.retentionPolicy),
    JSON.stringify(manifest.quotaPolicy),
    JSON.stringify(manifest.consistencyPolicy),
    JSON.stringify(manifest.encryptionPolicy),
    JSON.stringify(persistedManifestMetadata(manifest)),
    manifest.updatedAt,
  ];
}

function manifestValuePlaceholder(
  database: Pick<DatabaseAdapter, "dialect">,
  position: number,
  column: string,
): string {
  const placeholder = databasePlaceholder(database, position);

  if (!manifestJsonColumns.has(column)) {
    return placeholder;
  }

  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}

const manifestJsonColumns = new Set([
  "consistency_policy",
  "encryption_policy",
  "metadata",
  "quota_policy",
  "retention_policy",
]);

function mapKnowledgeSpaceManifestRow(row: DatabaseRow): KnowledgeSpaceManifest {
  const persistedMetadata = jsonObjectColumn(row, "metadata");
  const embeddingProfile = persistedMetadata[EMBEDDING_PROFILE_METADATA_KEY];
  const embeddingProfileFrozenAt = persistedMetadata[EMBEDDING_PROFILE_FROZEN_AT_METADATA_KEY];
  const pendingModelConfiguration = persistedMetadata[PENDING_MODEL_CONFIGURATION_METADATA_KEY];
  const retrievalProfile = persistedMetadata[RETRIEVAL_PROFILE_METADATA_KEY];
  const metadata = omitKnowledgeFsReservedMetadata(persistedMetadata);

  return KnowledgeSpaceManifestSchema.parse({
    consistencyPolicy: jsonObjectColumn(row, "consistency_policy"),
    createdAt: stringColumn(row, "created_at"),
    ...(embeddingProfile !== undefined ? { embeddingProfile } : {}),
    ...(embeddingProfileFrozenAt !== undefined ? { embeddingProfileFrozenAt } : {}),
    encryptionPolicy: jsonObjectColumn(row, "encryption_policy"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    manifestVersion: numberColumn(row, "manifest_version"),
    metadata,
    metadataDialect: stringColumn(row, "metadata_dialect"),
    minClientVersion: stringColumn(row, "min_client_version"),
    nodeSchemaVersion: numberColumn(row, "node_schema_version"),
    objectKeyPrefix: stringColumn(row, "object_key_prefix"),
    parserPolicyVersion: stringColumn(row, "parser_policy_version"),
    ...(pendingModelConfiguration !== undefined ? { pendingModelConfiguration } : {}),
    projectionSetVersion: stringColumn(row, "projection_set_version"),
    quotaPolicy: jsonObjectColumn(row, "quota_policy"),
    retentionPolicy: jsonObjectColumn(row, "retention_policy"),
    ...(retrievalProfile !== undefined ? { retrievalProfile } : {}),
    storageProvider: stringColumn(row, "storage_provider"),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

const EMBEDDING_PROFILE_METADATA_KEY = "__knowledgeFsEmbeddingProfile";
const EMBEDDING_PROFILE_FROZEN_AT_METADATA_KEY = "__knowledgeFsEmbeddingProfileFrozenAt";
const PENDING_MODEL_CONFIGURATION_METADATA_KEY = "__knowledgeFsPendingModelConfiguration";
const RETRIEVAL_PROFILE_METADATA_KEY = "__knowledgeFsRetrievalProfile";

function persistedManifestMetadata(
  manifest: KnowledgeSpaceManifest,
): Readonly<Record<string, unknown>> {
  const metadata = { ...manifest.metadata };

  if (manifest.embeddingProfile) {
    metadata[EMBEDDING_PROFILE_METADATA_KEY] = manifest.embeddingProfile;
  } else {
    delete metadata[EMBEDDING_PROFILE_METADATA_KEY];
  }

  if (manifest.embeddingProfileFrozenAt) {
    metadata[EMBEDDING_PROFILE_FROZEN_AT_METADATA_KEY] = manifest.embeddingProfileFrozenAt;
  } else {
    delete metadata[EMBEDDING_PROFILE_FROZEN_AT_METADATA_KEY];
  }

  if (manifest.pendingModelConfiguration) {
    metadata[PENDING_MODEL_CONFIGURATION_METADATA_KEY] = manifest.pendingModelConfiguration;
  } else {
    delete metadata[PENDING_MODEL_CONFIGURATION_METADATA_KEY];
  }

  if (manifest.retrievalProfile) {
    metadata[RETRIEVAL_PROFILE_METADATA_KEY] = manifest.retrievalProfile;
  } else {
    delete metadata[RETRIEVAL_PROFILE_METADATA_KEY];
  }

  return metadata;
}
