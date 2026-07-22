import { createHash, randomUUID } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  type KnowledgeSpaceEmbeddingProfile,
  KnowledgeSpaceEmbeddingProfileSchema,
  type KnowledgeSpacePendingModelConfiguration,
  KnowledgeSpacePendingModelConfigurationSchema,
  type KnowledgeSpaceRetrievalProfile,
  KnowledgeSpaceRetrievalProfileSchema,
  TenantIdSchema,
  UuidSchema,
  stableJson,
} from "@knowledge/core";

import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import {
  type DatabaseKnowledgeSpacePermissionFence,
  assertDatabaseKnowledgeSpacePermissionFence,
} from "./knowledge-space-access-control";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import { deterministicKnowledgeSpaceActivityId } from "./knowledge-space-overview";
import { appendKnowledgeSpaceActivityWithExecutor } from "./knowledge-space-overview-database-repository";

export const KnowledgeSpaceProfileKinds = ["embedding", "retrieval"] as const;
export type KnowledgeSpaceProfileKind = (typeof KnowledgeSpaceProfileKinds)[number];

export const KnowledgeSpaceProfileRevisionStates = [
  "candidate",
  "active",
  "superseded",
  "failed",
] as const;
export type KnowledgeSpaceProfileRevisionState =
  (typeof KnowledgeSpaceProfileRevisionStates)[number];

export type KnowledgeSpaceProfileSnapshot =
  | KnowledgeSpaceEmbeddingProfile
  | KnowledgeSpaceRetrievalProfile;

export interface KnowledgeSpaceProfileScope {
  readonly kind: KnowledgeSpaceProfileKind;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface KnowledgeSpaceProfileRevision extends KnowledgeSpaceProfileScope {
  readonly activatedAt?: string | undefined;
  readonly capabilitySnapshot: Readonly<Record<string, unknown>>;
  readonly capabilitySnapshotDigest: string;
  readonly createdAt: string;
  readonly createdBySubjectId: string;
  readonly dimension?: number | undefined;
  readonly failedAt?: string | undefined;
  readonly failureCode?: string | undefined;
  readonly failureMessage?: string | undefined;
  readonly id: string;
  readonly model: string;
  readonly pluginId: string;
  readonly provider: string;
  readonly revision: number;
  readonly snapshot: KnowledgeSpaceProfileSnapshot;
  readonly snapshotDigest: string;
  readonly state: KnowledgeSpaceProfileRevisionState;
  readonly supersededAt?: string | undefined;
  readonly updatedAt: string;
  readonly vectorSpaceId?: string | undefined;
}

export interface KnowledgeSpaceProfileHead extends KnowledgeSpaceProfileScope {
  readonly activeRevision: number;
  readonly createdAt: string;
  readonly id: string;
  readonly profile: KnowledgeSpaceProfileRevision;
  readonly profileRevisionId: string;
  readonly rowVersion: number;
  readonly updatedAt: string;
}

export interface CreateKnowledgeSpaceProfileCandidateInput extends KnowledgeSpaceProfileScope {
  readonly capabilitySnapshot: Readonly<Record<string, unknown>>;
  readonly createdBySubjectId: string;
  /** Internal rollout-only escape hatch for a legacy manifest whose revision already exceeds 1. */
  readonly preserveLegacyInitialRevision?: boolean | undefined;
  readonly now: string;
  readonly snapshot: KnowledgeSpaceProfileSnapshot;
}

export interface ActivateKnowledgeSpaceProfileCandidateInput extends KnowledgeSpaceProfileScope {
  /** `null` means the caller expects no active head yet. */
  readonly expectedActiveRevision: number | null;
  readonly now: string;
  readonly revision: number;
}

export interface FailKnowledgeSpaceProfileCandidateInput extends KnowledgeSpaceProfileScope {
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly now: string;
  readonly revision: number;
}

export interface ListKnowledgeSpaceProfileRevisionsInput extends KnowledgeSpaceProfileScope {
  readonly afterRevision?: number | undefined;
  readonly limit: number;
}

export interface ListKnowledgeSpaceProfileRevisionsResult {
  readonly items: readonly KnowledgeSpaceProfileRevision[];
  readonly nextRevision?: number | undefined;
}

export interface KnowledgeSpaceProfileRepository {
  activateCandidate(
    input: ActivateKnowledgeSpaceProfileCandidateInput,
  ): Promise<KnowledgeSpaceProfileHead>;
  createCandidate(
    input: CreateKnowledgeSpaceProfileCandidateInput,
  ): Promise<KnowledgeSpaceProfileRevision>;
  failCandidate(
    input: FailKnowledgeSpaceProfileCandidateInput,
  ): Promise<KnowledgeSpaceProfileRevision>;
  getHead(input: KnowledgeSpaceProfileScope): Promise<KnowledgeSpaceProfileHead | null>;
  getRevision(
    input: KnowledgeSpaceProfileScope & { readonly revision: number },
  ): Promise<KnowledgeSpaceProfileRevision | null>;
  listRevisions(
    input: ListKnowledgeSpaceProfileRevisionsInput,
  ): Promise<ListKnowledgeSpaceProfileRevisionsResult>;
}

export interface DatabaseKnowledgeSpaceProfileRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateHeadId?: (() => string) | undefined;
  readonly generateRevisionId?: (() => string) | undefined;
  readonly maxListLimit: number;
}

export interface ActivateUnpublishedKnowledgeSpaceProfileInput extends KnowledgeSpaceProfileScope {
  readonly capabilitySnapshot: Readonly<Record<string, unknown>>;
  /** Atomically removes the matching pending configuration with the final retrieval head. */
  readonly clearPendingConfiguration?: boolean | undefined;
  readonly createdBySubjectId: string;
  readonly expectedManifestProfileRevision: number;
  readonly expectedManifestVersion: number;
  readonly expectedPendingConfiguration?:
    | { readonly digest: string; readonly revision: number }
    | undefined;
  /** Allows the first verified embedding profile to materialize behind the ingestion freeze. */
  readonly initialActivation?: boolean | undefined;
  readonly now: string;
  readonly permission: DatabaseKnowledgeSpacePermissionFence;
  /**
   * Initial compilation materializes a configuration that was already accepted at space
   * creation, so the document writer only needs a fresh write fence. Interactive settings
   * mutations keep the stricter admin default.
   */
  readonly requiredAccess?: "admin" | "write" | undefined;
  readonly snapshot: KnowledgeSpaceProfileSnapshot;
}

export interface ActivateUnpublishedKnowledgeSpaceProfileResult {
  readonly head: KnowledgeSpaceProfileHead;
  readonly manifestVersion: number;
  readonly replayed: boolean;
  readonly snapshot: KnowledgeSpaceProfileSnapshot;
}

export interface ActivateInitialKnowledgeSpaceProfileTupleInput {
  readonly createdBySubjectId: string;
  readonly embedding?:
    | {
        readonly capabilitySnapshot: Readonly<Record<string, unknown>>;
        readonly snapshot: KnowledgeSpaceEmbeddingProfile;
      }
    | undefined;
  readonly expectedManifestVersion: number;
  readonly expectedPendingConfiguration: {
    readonly digest: string;
    readonly revision: number;
  };
  readonly knowledgeSpaceId: string;
  readonly now: string;
  readonly permission: DatabaseKnowledgeSpacePermissionFence;
  readonly requiredAccess?: "admin" | "write" | undefined;
  readonly retrieval: {
    readonly capabilitySnapshot: Readonly<Record<string, unknown>>;
    readonly snapshot: KnowledgeSpaceRetrievalProfile;
  };
  readonly tenantId: string;
}

export interface ActivateInitialKnowledgeSpaceProfileTupleResult {
  readonly embeddingHead?: KnowledgeSpaceProfileHead | undefined;
  readonly manifestVersion: number;
  readonly replayed: boolean;
  readonly retrievalHead: KnowledgeSpaceProfileHead;
}

/**
 * Atomic settings-write port for a space that has not published a projection tuple yet. Durable
 * implementations must fence deletion, permission revocation, publication, manifest CAS, immutable
 * revision creation, and head activation in one transaction.
 */
export interface KnowledgeSpaceUnpublishedProfileActivationRepository {
  activate(
    input: ActivateUnpublishedKnowledgeSpaceProfileInput,
  ): Promise<ActivateUnpublishedKnowledgeSpaceProfileResult>;
  /** Installs the complete first compilation tuple and clears pending configuration atomically. */
  activateInitialTuple(
    input: ActivateInitialKnowledgeSpaceProfileTupleInput,
  ): Promise<ActivateInitialKnowledgeSpaceProfileTupleResult>;
}

export interface DatabaseKnowledgeSpaceUnpublishedProfileActivationRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateHeadId?: (() => string) | undefined;
  readonly generateRevisionId?: (() => string) | undefined;
}

export class KnowledgeSpaceUnpublishedProfileActivationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "KnowledgeSpaceUnpublishedProfileActivationError";
    this.code = code;
  }
}

export class KnowledgeSpaceProfileTransitionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "KnowledgeSpaceProfileTransitionError";
    this.code = code;
  }
}

export class KnowledgeSpaceProfileHeadConflictError extends KnowledgeSpaceProfileTransitionError {
  readonly actualActiveRevision: number | null;
  readonly expectedActiveRevision: number | null;

  constructor(expectedActiveRevision: number | null, actualActiveRevision: number | null) {
    super(
      "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
      `Knowledge-space profile head conflict: expected=${String(
        expectedActiveRevision,
      )} actual=${String(actualActiveRevision)}`,
    );
    this.name = "KnowledgeSpaceProfileHeadConflictError";
    this.actualActiveRevision = actualActiveRevision;
    this.expectedActiveRevision = expectedActiveRevision;
  }
}

export class KnowledgeSpaceProfileSnapshotCorruptionError extends Error {
  readonly code = "KNOWLEDGE_SPACE_PROFILE_SNAPSHOT_CORRUPT";

  constructor(revisionId: string) {
    super(`Knowledge-space profile revision ${revisionId} has a snapshot digest mismatch`);
    this.name = "KnowledgeSpaceProfileSnapshotCorruptionError";
  }
}

const revisionTable = "knowledge_space_profile_revisions";
const headTable = "knowledge_space_profile_heads";
const unpublishedManifestTable = "knowledge_space_manifests";
const unpublishedPublicationHeadTable = "projection_set_publication_heads";
const unpublishedEmbeddingProfileMetadataKey = "__knowledgeFsEmbeddingProfile";
const unpublishedEmbeddingFrozenMetadataKey = "__knowledgeFsEmbeddingProfileFrozenAt";
const unpublishedPendingModelConfigurationMetadataKey = "__knowledgeFsPendingModelConfiguration";
const unpublishedRetrievalProfileMetadataKey = "__knowledgeFsRetrievalProfile";

/**
 * Durable profile repository. Space-row locking serializes revision allocation with deletion and
 * other profile writers. Activation changes only lifecycle columns and the head pointer; immutable
 * snapshot, capability, model identity, vector-space, and dimension fields are never rewritten.
 */
export function createDatabaseKnowledgeSpaceProfileRepository({
  database,
  generateHeadId = randomUUID,
  generateRevisionId = randomUUID,
  maxListLimit,
}: DatabaseKnowledgeSpaceProfileRepositoryOptions): KnowledgeSpaceProfileRepository {
  positiveInteger(maxListLimit, "maxListLimit");

  return {
    activateCandidate: async (rawInput) => {
      const input = normalizeActivationInput(rawInput);

      return database.transaction(async (transaction) => {
        await requireWritableSpace(database, transaction, input);
        const currentHead = await getHeadRow(database, transaction, input, true);
        const actualRevision = currentHead ? numberColumn(currentHead, "active_revision") : null;
        if (actualRevision !== input.expectedActiveRevision) {
          throw new KnowledgeSpaceProfileHeadConflictError(
            input.expectedActiveRevision,
            actualRevision,
          );
        }

        const candidateRow = await getRevisionRow(
          database,
          transaction,
          { ...input, revision: input.revision },
          true,
        );
        if (!candidateRow) {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_REVISION_NOT_FOUND",
            `Knowledge-space profile candidate revision=${input.revision} was not found`,
          );
        }
        const candidate = mapProfileRevision(candidateRow);
        if (candidate.state !== "candidate") {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_NOT_CANDIDATE",
            `Knowledge-space profile revision=${input.revision} is ${candidate.state}, not candidate`,
          );
        }

        if (currentHead) {
          const previousRevisionId = stringColumn(currentHead, "profile_revision_id");
          const previous = await getRevisionRowById(
            database,
            transaction,
            previousRevisionId,
            true,
          );
          if (!previous) {
            throw new KnowledgeSpaceProfileTransitionError(
              "KNOWLEDGE_SPACE_PROFILE_HEAD_DANGLING",
              "Knowledge-space profile head references a missing revision",
            );
          }
          const mappedPrevious = mapProfileRevision(previous);
          if (
            mappedPrevious.state !== "active" ||
            mappedPrevious.revision !== actualRevision ||
            mappedPrevious.kind !== input.kind ||
            mappedPrevious.tenantId !== input.tenantId ||
            mappedPrevious.knowledgeSpaceId !== input.knowledgeSpaceId
          ) {
            throw new KnowledgeSpaceProfileTransitionError(
              "KNOWLEDGE_SPACE_PROFILE_HEAD_INVALID",
              "Knowledge-space profile head does not reference its scoped active revision",
            );
          }

          const superseded = await transaction.execute({
            maxRows: 0,
            operation: "update",
            params: [input.now, input.now, mappedPrevious.id],
            sql: `UPDATE ${q(database, revisionTable)} SET ${q(
              database,
              "state",
            )} = 'superseded', ${q(database, "superseded_at")} = ${p(
              database,
              1,
            )}, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(
              database,
              "id",
            )} = ${p(database, 3)} AND ${q(database, "state")} = 'active';`,
            tableName: revisionTable,
          });
          if (superseded.rowsAffected !== 1) {
            throw new KnowledgeSpaceProfileTransitionError(
              "KNOWLEDGE_SPACE_PROFILE_ACTIVATION_CONFLICT",
              "Active profile revision changed before it could be superseded",
            );
          }
        }

        const activated = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [input.now, input.now, candidate.id],
          sql: `UPDATE ${q(database, revisionTable)} SET ${q(
            database,
            "state",
          )} = 'active', ${q(database, "activated_at")} = ${p(database, 1)}, ${q(
            database,
            "updated_at",
          )} = ${p(database, 2)} WHERE ${q(database, "id")} = ${p(
            database,
            3,
          )} AND ${q(database, "state")} = 'candidate';`,
          tableName: revisionTable,
        });
        if (activated.rowsAffected !== 1) {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_ACTIVATION_CONFLICT",
            "Candidate profile revision changed before activation",
          );
        }

        if (currentHead) {
          const currentRowVersion = numberColumn(currentHead, "row_version");
          const advanced = await transaction.execute({
            maxRows: 0,
            operation: "update",
            params: [
              candidate.id,
              candidate.revision,
              currentRowVersion + 1,
              input.now,
              input.tenantId,
              input.knowledgeSpaceId,
              input.kind,
              currentRowVersion,
            ],
            sql: `UPDATE ${q(database, headTable)} SET ${q(
              database,
              "profile_revision_id",
            )} = ${p(database, 1)}, ${q(database, "active_revision")} = ${p(
              database,
              2,
            )}, ${q(database, "row_version")} = ${p(database, 3)}, ${q(
              database,
              "updated_at",
            )} = ${p(database, 4)} WHERE ${q(database, "tenant_id")} = ${p(
              database,
              5,
            )} AND ${q(database, "knowledge_space_id")} = ${p(
              database,
              6,
            )} AND ${q(database, "kind")} = ${p(database, 7)} AND ${q(
              database,
              "row_version",
            )} = ${p(database, 8)};`,
            tableName: headTable,
          });
          if (advanced.rowsAffected !== 1) {
            throw new KnowledgeSpaceProfileTransitionError(
              "KNOWLEDGE_SPACE_PROFILE_ACTIVATION_CONFLICT",
              "Knowledge-space profile head lost its row-version fence",
            );
          }
        } else {
          const headId = nonzeroUuid(generateHeadId(), "headId");
          await transaction.execute({
            maxRows: 0,
            operation: "insert",
            params: [
              headId,
              input.tenantId,
              input.knowledgeSpaceId,
              input.kind,
              candidate.id,
              candidate.revision,
              1,
              input.now,
              input.now,
            ],
            sql: `INSERT INTO ${q(database, headTable)} (${[
              "id",
              "tenant_id",
              "knowledge_space_id",
              "kind",
              "profile_revision_id",
              "active_revision",
              "row_version",
              "created_at",
              "updated_at",
            ]
              .map((column) => q(database, column))
              .join(", ")}) VALUES (${Array.from({ length: 9 }, (_, index) =>
              p(database, index + 1),
            ).join(", ")});`,
            tableName: headTable,
          });
        }

        const head = await getProfileHead(database, transaction, input, false);
        if (!head) {
          throw new Error("Activated knowledge-space profile head could not be reloaded");
        }
        await appendKnowledgeSpaceActivityWithExecutor({
          database,
          executor: transaction,
          input: {
            action: "profile.published",
            actor: { id: candidate.createdBySubjectId, type: "member" },
            details: { providerId: candidate.provider },
            id: deterministicKnowledgeSpaceActivityId(
              "profile.published",
              input.tenantId,
              input.knowledgeSpaceId,
              input.kind,
              candidate.id,
            ),
            knowledgeSpaceId: input.knowledgeSpaceId,
            occurredAt: input.now,
            requiredPermissionScope: [],
            resource: { id: candidate.id, type: "profile" },
            result: "success",
            tenantId: input.tenantId,
          },
        });
        return head;
      });
    },

    createCandidate: async (rawInput) => {
      const input = normalizeCandidateInput(rawInput);

      return database.transaction(async (transaction) => {
        await requireWritableSpace(database, transaction, input);
        const pending = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId, input.kind],
          sql: `SELECT ${q(database, "id")}, ${q(database, "revision")} FROM ${q(
            database,
            revisionTable,
          )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
            database,
            "knowledge_space_id",
          )} = ${p(database, 2)} AND ${q(database, "kind")} = ${p(
            database,
            3,
          )} AND ${q(database, "state")} = 'candidate' LIMIT 1 FOR UPDATE;`,
          tableName: revisionTable,
        });
        if (pending.rows.length > 0) {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_EXISTS",
            `Knowledge-space ${input.kind} profile already has a candidate revision`,
          );
        }

        const latest = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId, input.kind],
          sql: `SELECT ${q(database, "revision")} FROM ${q(
            database,
            revisionTable,
          )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
            database,
            "knowledge_space_id",
          )} = ${p(database, 2)} AND ${q(database, "kind")} = ${p(
            database,
            3,
          )} ORDER BY ${q(database, "revision")} DESC LIMIT 1 FOR UPDATE;`,
          tableName: revisionTable,
        });
        const latestRevision = latest.rows[0]
          ? numberColumn(latest.rows[0], "revision")
          : undefined;
        const expectedRevision =
          latestRevision === undefined && input.preserveLegacyInitialRevision
            ? input.snapshot.revision
            : (latestRevision ?? 0) + 1;
        if (input.snapshot.revision !== expectedRevision) {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_REVISION_CONFLICT",
            `Profile snapshot revision=${input.snapshot.revision} must be next revision=${expectedRevision}`,
          );
        }

        const id = nonzeroUuid(generateRevisionId(), "revisionId");
        await insertProfileRevision(database, transaction, {
          ...input,
          id,
          state: "candidate",
        });
        const created = await getRevisionRow(
          database,
          transaction,
          { ...input, revision: input.snapshot.revision },
          false,
        );
        if (!created) {
          throw new Error("Created knowledge-space profile candidate could not be reloaded");
        }
        return mapProfileRevision(created);
      });
    },

    failCandidate: async (rawInput) => {
      const input = normalizeFailureInput(rawInput);

      return database.transaction(async (transaction) => {
        const currentRow = await getRevisionRow(database, transaction, input, true);
        if (!currentRow) {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_REVISION_NOT_FOUND",
            `Knowledge-space profile candidate revision=${input.revision} was not found`,
          );
        }
        const current = mapProfileRevision(currentRow);
        if (current.state === "failed") {
          return current;
        }
        if (current.state !== "candidate") {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_NOT_CANDIDATE",
            `Only a candidate profile can fail; revision=${input.revision} is ${current.state}`,
          );
        }

        const failed = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [input.errorCode, input.errorMessage, input.now, input.now, current.id],
          sql: `UPDATE ${q(database, revisionTable)} SET ${q(
            database,
            "state",
          )} = 'failed', ${q(database, "failure_code")} = ${p(database, 1)}, ${q(
            database,
            "failure_message",
          )} = ${p(database, 2)}, ${q(database, "failed_at")} = ${p(
            database,
            3,
          )}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(
            database,
            "id",
          )} = ${p(database, 5)} AND ${q(database, "state")} = 'candidate';`,
          tableName: revisionTable,
        });
        if (failed.rowsAffected !== 1) {
          throw new KnowledgeSpaceProfileTransitionError(
            "KNOWLEDGE_SPACE_PROFILE_FAILURE_CONFLICT",
            "Candidate profile changed before failure could be recorded",
          );
        }
        const result = await getRevisionRow(database, transaction, input, false);
        if (!result) throw new Error("Failed profile revision could not be reloaded");
        return mapProfileRevision(result);
      });
    },

    getHead: (input) => getProfileHead(database, database, normalizeScope(input), false),

    getRevision: async (rawInput) => {
      const input = {
        ...normalizeScope(rawInput),
        revision: positiveInteger(rawInput.revision, "revision"),
      };
      const row = await getRevisionRow(database, database, input, false);
      return row ? mapProfileRevision(row) : null;
    },

    listRevisions: async (rawInput) => {
      const input = normalizeListInput(rawInput, maxListLimit);
      const params: DatabaseQueryValue[] = [input.tenantId, input.knowledgeSpaceId, input.kind];
      const cursorSql =
        input.afterRevision === undefined
          ? ""
          : ` AND ${q(database, "revision")} > ${pushParam(database, params, input.afterRevision)}`;
      const readLimit = input.limit + 1;
      const result = await database.execute({
        maxRows: readLimit,
        operation: "select",
        params: [...params, readLimit],
        sql: `SELECT * FROM ${q(database, revisionTable)} WHERE ${q(
          database,
          "tenant_id",
        )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
          database,
          2,
        )} AND ${q(database, "kind")} = ${p(database, 3)}${cursorSql} ORDER BY ${q(
          database,
          "revision",
        )} ASC LIMIT ${p(database, params.length + 1)};`,
        tableName: revisionTable,
      });
      const mapped = result.rows.map(mapProfileRevision);
      const items = mapped.slice(0, input.limit);
      return {
        items,
        ...(mapped.length > input.limit ? { nextRevision: items.at(-1)?.revision } : {}),
      };
    },
  };
}

/**
 * Database implementation of the unpublished settings-write port. The space row is the global
 * serialization point shared with deletion and publication, so observing no publication head is
 * stable until this transaction commits.
 */
export function createDatabaseKnowledgeSpaceUnpublishedProfileActivationRepository({
  database,
  generateHeadId = randomUUID,
  generateRevisionId = randomUUID,
}: DatabaseKnowledgeSpaceUnpublishedProfileActivationRepositoryOptions): KnowledgeSpaceUnpublishedProfileActivationRepository {
  return {
    activate: async (rawInput) => {
      const input = normalizeUnpublishedActivationInput(rawInput);

      return database.transaction(async (transaction) => {
        await requireWritableSpace(database, transaction, input);
        await assertDatabaseKnowledgeSpacePermissionFence({
          database,
          executor: transaction,
          fence: input.permission,
          now: input.now,
          requiredAccess: input.requiredAccess,
        });

        const published = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId],
          sql: `SELECT ${q(database, "publication_id")} FROM ${q(
            database,
            unpublishedPublicationHeadTable,
          )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
            database,
            "knowledge_space_id",
          )} = ${p(database, 2)} LIMIT 1 FOR UPDATE;`,
          tableName: unpublishedPublicationHeadTable,
        });
        if (published.rows[0]) {
          throw unpublishedActivationError(
            "KNOWLEDGE_SPACE_PROFILE_PUBLISHED",
            "The knowledge space became published; use the profile migration workflow",
          );
        }

        const manifestResult = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId],
          sql: `SELECT ${q(database, "manifest_version")}, ${q(
            database,
            "metadata",
          )} FROM ${q(database, unpublishedManifestTable)} WHERE ${q(
            database,
            "tenant_id",
          )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
            database,
            2,
          )} LIMIT 1 FOR UPDATE;`,
          tableName: unpublishedManifestTable,
        });
        const manifestRow = manifestResult.rows[0];
        if (!manifestRow) {
          throw unpublishedActivationError(
            "KNOWLEDGE_SPACE_PROFILE_MANIFEST_NOT_FOUND",
            "Knowledge-space manifest was not found during atomic profile activation",
          );
        }

        const manifestVersion = positiveInteger(
          numberColumn(manifestRow, "manifest_version"),
          "manifestVersion",
        );
        const metadata = jsonObjectColumn(manifestRow, "metadata");
        if (input.expectedPendingConfiguration) {
          const pending = KnowledgeSpacePendingModelConfigurationSchema.safeParse(
            metadata[unpublishedPendingModelConfigurationMetadataKey],
          );
          if (
            !pending.success ||
            pending.data.digest !== input.expectedPendingConfiguration.digest ||
            pending.data.revision !== input.expectedPendingConfiguration.revision ||
            !pendingConfigurationMatchesSnapshot(input.kind, pending.data, input.snapshot)
          ) {
            throw unpublishedActivationError(
              "KNOWLEDGE_SPACE_PENDING_CONFIGURATION_STALE",
              "The pending model configuration changed before activation",
            );
          }
        }
        const profileMetadataKey = unpublishedProfileMetadataKey(input.kind);
        const currentValue = metadata[profileMetadataKey];
        const currentSnapshot =
          currentValue === undefined ? null : parseSnapshot(input.kind, currentValue);
        const manifestAlreadyTargetsSnapshot =
          currentSnapshot !== null &&
          knowledgeSpaceProfileSnapshotDigest(currentSnapshot) === input.snapshotDigest;

        let committedManifestVersion = manifestVersion;
        if (!manifestAlreadyTargetsSnapshot) {
          const actualProfileRevision = currentSnapshot?.revision ?? 0;
          if (
            manifestVersion !== input.expectedManifestVersion ||
            actualProfileRevision !== input.expectedManifestProfileRevision ||
            input.snapshot.revision !== actualProfileRevision + 1
          ) {
            throw unpublishedActivationError(
              "KNOWLEDGE_SPACE_PROFILE_MANIFEST_CONFLICT",
              `Knowledge-space profile manifest conflict: expected manifest=${input.expectedManifestVersion}/profile=${input.expectedManifestProfileRevision}, actual manifest=${manifestVersion}/profile=${actualProfileRevision}`,
            );
          }
          if (
            input.kind === "embedding" &&
            metadata[unpublishedEmbeddingFrozenMetadataKey] !== undefined &&
            !input.initialActivation
          ) {
            throw unpublishedActivationError(
              "KNOWLEDGE_SPACE_EMBEDDING_PROFILE_FROZEN",
              "Embedding profile change requires the reindex workflow",
            );
          }

          const nextMetadata = { ...metadata, [profileMetadataKey]: input.snapshot };
          if (input.clearPendingConfiguration) {
            delete nextMetadata[unpublishedPendingModelConfigurationMetadataKey];
          }
          committedManifestVersion = manifestVersion + 1;
          const updated = await transaction.execute({
            maxRows: 0,
            operation: "update",
            params: [
              JSON.stringify(nextMetadata),
              committedManifestVersion,
              input.now,
              input.tenantId,
              input.knowledgeSpaceId,
              manifestVersion,
            ],
            sql: `UPDATE ${q(database, unpublishedManifestTable)} SET ${q(
              database,
              "metadata",
            )} = ${jsonPlaceholder(database, 1)}, ${q(
              database,
              "manifest_version",
            )} = ${p(database, 2)}, ${q(database, "updated_at")} = ${p(
              database,
              3,
            )} WHERE ${q(database, "tenant_id")} = ${p(database, 4)} AND ${q(
              database,
              "knowledge_space_id",
            )} = ${p(database, 5)} AND ${q(database, "manifest_version")} = ${p(database, 6)};`,
            tableName: unpublishedManifestTable,
          });
          if (updated.rowsAffected !== 1) {
            throw unpublishedActivationError(
              "KNOWLEDGE_SPACE_PROFILE_MANIFEST_CONFLICT",
              "Knowledge-space profile manifest lost its compare-and-swap fence",
            );
          }
        } else if (input.clearPendingConfiguration) {
          if (manifestVersion !== input.expectedManifestVersion) {
            throw unpublishedActivationError(
              "KNOWLEDGE_SPACE_PROFILE_MANIFEST_CONFLICT",
              `Knowledge-space profile manifest conflict: expected manifest=${input.expectedManifestVersion}, actual manifest=${manifestVersion}`,
            );
          }
          const nextMetadata = { ...metadata };
          delete nextMetadata[unpublishedPendingModelConfigurationMetadataKey];
          committedManifestVersion = manifestVersion + 1;
          const updated = await transaction.execute({
            maxRows: 0,
            operation: "update",
            params: [
              JSON.stringify(nextMetadata),
              committedManifestVersion,
              input.now,
              input.tenantId,
              input.knowledgeSpaceId,
              manifestVersion,
            ],
            sql: `UPDATE ${q(database, unpublishedManifestTable)} SET ${q(
              database,
              "metadata",
            )} = ${jsonPlaceholder(database, 1)}, ${q(
              database,
              "manifest_version",
            )} = ${p(database, 2)}, ${q(database, "updated_at")} = ${p(
              database,
              3,
            )} WHERE ${q(database, "tenant_id")} = ${p(database, 4)} AND ${q(
              database,
              "knowledge_space_id",
            )} = ${p(database, 5)} AND ${q(database, "manifest_version")} = ${p(database, 6)};`,
            tableName: unpublishedManifestTable,
          });
          if (updated.rowsAffected !== 1) {
            throw unpublishedActivationError(
              "KNOWLEDGE_SPACE_PROFILE_MANIFEST_CONFLICT",
              "Knowledge-space profile manifest lost its compare-and-swap fence",
            );
          }
        }

        const installed = await activateUnpublishedProfileRevision({
          database,
          generateHeadId,
          generateRevisionId,
          input,
          transaction,
        });
        return {
          head: installed.head,
          manifestVersion: committedManifestVersion,
          replayed: manifestAlreadyTargetsSnapshot && installed.replayed,
          snapshot: input.snapshot,
        };
      });
    },
    activateInitialTuple: (input) =>
      activateInitialKnowledgeSpaceProfileTuple({
        database,
        generateHeadId,
        generateRevisionId,
        input,
      }),
  };
}

/**
 * The first document must never observe a half-installed profile tuple. Capability probing happens
 * outside the transaction, but the verified snapshots, immutable revisions, active heads, and
 * pending-configuration removal cross the database boundary together. A concurrent worker may
 * replay the exact committed tuple; a different pending revision or snapshot always fails closed.
 */
async function activateInitialKnowledgeSpaceProfileTuple({
  database,
  generateHeadId,
  generateRevisionId,
  input: rawInput,
}: {
  readonly database: DatabaseAdapter;
  readonly generateHeadId: () => string;
  readonly generateRevisionId: () => string;
  readonly input: ActivateInitialKnowledgeSpaceProfileTupleInput;
}): Promise<ActivateInitialKnowledgeSpaceProfileTupleResult> {
  const input = normalizeInitialTupleInput(rawInput);
  const scope = input.retrieval;

  return database.transaction(async (transaction) => {
    await requireWritableSpace(database, transaction, scope);
    await assertDatabaseKnowledgeSpacePermissionFence({
      database,
      executor: transaction,
      fence: input.permission,
      now: input.now,
      requiredAccess: input.requiredAccess,
    });

    const published = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId],
      sql: `SELECT ${q(database, "publication_id")} FROM ${q(
        database,
        unpublishedPublicationHeadTable,
      )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
        database,
        "knowledge_space_id",
      )} = ${p(database, 2)} LIMIT 1 FOR UPDATE;`,
      tableName: unpublishedPublicationHeadTable,
    });
    if (published.rows[0]) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_PUBLISHED",
        "The knowledge space became published; use the profile migration workflow",
      );
    }

    const manifestResult = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId],
      sql: `SELECT ${q(database, "manifest_version")}, ${q(
        database,
        "metadata",
      )} FROM ${q(database, unpublishedManifestTable)} WHERE ${q(
        database,
        "tenant_id",
      )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
        database,
        2,
      )} LIMIT 1 FOR UPDATE;`,
      tableName: unpublishedManifestTable,
    });
    const manifestRow = manifestResult.rows[0];
    if (!manifestRow) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_MANIFEST_NOT_FOUND",
        "Knowledge-space manifest was not found during atomic initial profile activation",
      );
    }

    const manifestVersion = positiveInteger(
      numberColumn(manifestRow, "manifest_version"),
      "manifestVersion",
    );
    const metadata = jsonObjectColumn(manifestRow, "metadata");
    const currentEmbeddingValue = metadata[unpublishedEmbeddingProfileMetadataKey];
    const currentRetrievalValue = metadata[unpublishedRetrievalProfileMetadataKey];
    const currentEmbedding =
      currentEmbeddingValue === undefined
        ? undefined
        : KnowledgeSpaceEmbeddingProfileSchema.parse(currentEmbeddingValue);
    const currentRetrieval =
      currentRetrievalValue === undefined
        ? undefined
        : KnowledgeSpaceRetrievalProfileSchema.parse(currentRetrievalValue);
    const embeddingMatches = input.embedding
      ? currentEmbedding !== undefined &&
        knowledgeSpaceProfileSnapshotDigest(currentEmbedding) === input.embedding.snapshotDigest
      : currentEmbedding === undefined;
    const retrievalMatches =
      currentRetrieval !== undefined &&
      knowledgeSpaceProfileSnapshotDigest(currentRetrieval) === input.retrieval.snapshotDigest;
    const exactManifestTuple = embeddingMatches && retrievalMatches;

    const pendingValue = metadata[unpublishedPendingModelConfigurationMetadataKey];
    if (pendingValue === undefined) {
      if (!exactManifestTuple) {
        throw unpublishedActivationError(
          "KNOWLEDGE_SPACE_PENDING_CONFIGURATION_STALE",
          "The pending model configuration changed before initial tuple activation",
        );
      }
    } else {
      const pending = KnowledgeSpacePendingModelConfigurationSchema.safeParse(pendingValue);
      if (
        !pending.success ||
        pending.data.digest !== input.expectedPendingConfiguration.digest ||
        pending.data.revision !== input.expectedPendingConfiguration.revision ||
        (input.embedding !== undefined &&
          !pendingConfigurationMatchesSnapshot(
            "embedding",
            pending.data,
            input.embedding.snapshot,
          )) ||
        !pendingConfigurationMatchesSnapshot("retrieval", pending.data, input.retrieval.snapshot)
      ) {
        throw unpublishedActivationError(
          "KNOWLEDGE_SPACE_PENDING_CONFIGURATION_STALE",
          "The pending model configuration changed before initial tuple activation",
        );
      }
    }

    if (
      (currentEmbedding !== undefined && !embeddingMatches) ||
      (currentRetrieval !== undefined && !retrievalMatches)
    ) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_INITIAL_PROFILE_TUPLE_CONFLICT",
        "The knowledge space already contains a different initial profile tuple",
      );
    }

    let committedManifestVersion = manifestVersion;
    if (!exactManifestTuple || pendingValue !== undefined) {
      if (manifestVersion !== input.expectedManifestVersion) {
        throw unpublishedActivationError(
          "KNOWLEDGE_SPACE_PROFILE_MANIFEST_CONFLICT",
          `Knowledge-space initial profile manifest conflict: expected=${input.expectedManifestVersion} actual=${manifestVersion}`,
        );
      }
      const nextMetadata: Record<string, unknown> = {
        ...metadata,
        ...(input.embedding
          ? { [unpublishedEmbeddingProfileMetadataKey]: input.embedding.snapshot }
          : {}),
        [unpublishedRetrievalProfileMetadataKey]: input.retrieval.snapshot,
      };
      delete nextMetadata[unpublishedPendingModelConfigurationMetadataKey];
      committedManifestVersion = manifestVersion + 1;
      const updated = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [
          JSON.stringify(nextMetadata),
          committedManifestVersion,
          input.now,
          input.tenantId,
          input.knowledgeSpaceId,
          manifestVersion,
        ],
        sql: `UPDATE ${q(database, unpublishedManifestTable)} SET ${q(
          database,
          "metadata",
        )} = ${jsonPlaceholder(database, 1)}, ${q(
          database,
          "manifest_version",
        )} = ${p(database, 2)}, ${q(database, "updated_at")} = ${p(
          database,
          3,
        )} WHERE ${q(database, "tenant_id")} = ${p(database, 4)} AND ${q(
          database,
          "knowledge_space_id",
        )} = ${p(database, 5)} AND ${q(database, "manifest_version")} = ${p(database, 6)};`,
        tableName: unpublishedManifestTable,
      });
      if (updated.rowsAffected !== 1) {
        throw unpublishedActivationError(
          "KNOWLEDGE_SPACE_PROFILE_MANIFEST_CONFLICT",
          "Knowledge-space initial profile manifest lost its compare-and-swap fence",
        );
      }
    }

    const installedEmbedding = input.embedding
      ? await activateUnpublishedProfileRevision({
          database,
          generateHeadId,
          generateRevisionId,
          input: input.embedding,
          transaction,
        })
      : undefined;
    const installedRetrieval = await activateUnpublishedProfileRevision({
      database,
      generateHeadId,
      generateRevisionId,
      input: input.retrieval,
      transaction,
    });

    return {
      ...(installedEmbedding ? { embeddingHead: installedEmbedding.head } : {}),
      manifestVersion: committedManifestVersion,
      replayed:
        exactManifestTuple && (installedEmbedding?.replayed ?? true) && installedRetrieval.replayed,
      retrievalHead: installedRetrieval.head,
    };
  });
}

export interface KnowledgeSpaceProfileService {
  activate(input: ActivateKnowledgeSpaceProfileCandidateInput): Promise<KnowledgeSpaceProfileHead>;
  fail(input: FailKnowledgeSpaceProfileCandidateInput): Promise<KnowledgeSpaceProfileRevision>;
  getActive(input: KnowledgeSpaceProfileScope): Promise<KnowledgeSpaceProfileHead | null>;
  stage(input: CreateKnowledgeSpaceProfileCandidateInput): Promise<KnowledgeSpaceProfileRevision>;
}

/** Thin orchestration boundary used by handlers/workers without exposing database implementation. */
export function createKnowledgeSpaceProfileService(
  repository: KnowledgeSpaceProfileRepository,
): KnowledgeSpaceProfileService {
  return {
    activate: (input) => repository.activateCandidate(input),
    fail: (input) => repository.failCandidate(input),
    getActive: (input) => repository.getHead(input),
    stage: (input) => repository.createCandidate(input),
  };
}

export function knowledgeSpaceProfileSnapshotDigest(snapshot: unknown): string {
  return createHash("sha256").update(stableJson(snapshot)).digest("hex");
}

interface NormalizedCandidate extends KnowledgeSpaceProfileScope {
  readonly capabilitySnapshot: Readonly<Record<string, unknown>>;
  readonly capabilitySnapshotDigest: string;
  readonly createdBySubjectId: string;
  readonly dimension?: number | undefined;
  readonly model: string;
  readonly now: string;
  readonly pluginId: string;
  readonly preserveLegacyInitialRevision: boolean;
  readonly provider: string;
  readonly snapshot: KnowledgeSpaceProfileSnapshot;
  readonly snapshotDigest: string;
  readonly vectorSpaceId?: string | undefined;
}

interface NormalizedUnpublishedActivation extends NormalizedCandidate {
  readonly clearPendingConfiguration: boolean;
  readonly expectedManifestProfileRevision: number;
  readonly expectedManifestVersion: number;
  readonly expectedPendingConfiguration?:
    | { readonly digest: string; readonly revision: number }
    | undefined;
  readonly initialActivation: boolean;
  readonly permission: DatabaseKnowledgeSpacePermissionFence;
  readonly requiredAccess: "admin" | "write";
}

interface NormalizedInitialProfileTuple {
  readonly embedding?: NormalizedUnpublishedActivation | undefined;
  readonly expectedManifestVersion: number;
  readonly expectedPendingConfiguration: {
    readonly digest: string;
    readonly revision: number;
  };
  readonly knowledgeSpaceId: string;
  readonly now: string;
  readonly permission: DatabaseKnowledgeSpacePermissionFence;
  readonly requiredAccess: "admin" | "write";
  readonly retrieval: NormalizedUnpublishedActivation;
  readonly tenantId: string;
}

async function insertProfileRevision(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: NormalizedCandidate & {
    readonly id: string;
    readonly state: "candidate" | "active";
  },
): Promise<void> {
  const activatedAt = input.state === "active" ? input.now : null;
  const values: readonly DatabaseQueryValue[] = [
    input.id,
    input.tenantId,
    input.knowledgeSpaceId,
    input.kind,
    input.snapshot.revision,
    input.state,
    JSON.stringify(input.snapshot),
    input.snapshotDigest,
    JSON.stringify(input.capabilitySnapshot),
    input.capabilitySnapshotDigest,
    input.pluginId,
    input.provider,
    input.model,
    input.vectorSpaceId ?? null,
    input.dimension ?? null,
    input.createdBySubjectId,
    null,
    null,
    input.now,
    input.now,
    activatedAt,
    null,
    null,
  ];
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "kind",
    "revision",
    "state",
    "snapshot",
    "snapshot_digest",
    "capability_snapshot",
    "capability_snapshot_digest",
    "plugin_id",
    "provider",
    "model",
    "vector_space_id",
    "dimension",
    "created_by_subject_id",
    "failure_code",
    "failure_message",
    "created_at",
    "updated_at",
    "activated_at",
    "superseded_at",
    "failed_at",
  ] as const;
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: values,
    sql: `INSERT INTO ${q(database, revisionTable)} (${columns
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${columns
      .map((column, index) =>
        column === "snapshot" || column === "capability_snapshot"
          ? jsonPlaceholder(database, index + 1)
          : p(database, index + 1),
      )
      .join(", ")});`,
    tableName: revisionTable,
  });
}

async function activateUnpublishedProfileRevision({
  database,
  generateHeadId,
  generateRevisionId,
  input,
  transaction,
}: {
  readonly database: DatabaseAdapter;
  readonly generateHeadId: () => string;
  readonly generateRevisionId: () => string;
  readonly input: NormalizedUnpublishedActivation;
  readonly transaction: DatabaseExecutor;
}): Promise<{ readonly head: KnowledgeSpaceProfileHead; readonly replayed: boolean }> {
  const currentHead = await getHeadRow(database, transaction, input, true);
  let currentProfile: KnowledgeSpaceProfileRevision | null = null;
  if (currentHead) {
    const currentRevisionRow = await getRevisionRowById(
      database,
      transaction,
      stringColumn(currentHead, "profile_revision_id"),
      true,
    );
    if (!currentRevisionRow) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_HEAD_INVALID",
        "Knowledge-space profile head references a missing revision",
      );
    }
    currentProfile = mapProfileRevision(currentRevisionRow);
    if (
      currentProfile.state !== "active" ||
      currentProfile.kind !== input.kind ||
      currentProfile.tenantId !== input.tenantId ||
      currentProfile.knowledgeSpaceId !== input.knowledgeSpaceId ||
      currentProfile.revision !== numberColumn(currentHead, "active_revision")
    ) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_HEAD_INVALID",
        "Knowledge-space profile head does not reference its scoped active revision",
      );
    }

    if (currentProfile.revision === input.snapshot.revision) {
      if (
        currentProfile.snapshotDigest !== input.snapshotDigest ||
        currentProfile.capabilitySnapshotDigest !== input.capabilitySnapshotDigest
      ) {
        throw unpublishedActivationError(
          "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
          "The active profile revision has different immutable settings",
        );
      }
      const replayHead = await getProfileHead(database, transaction, input, false);
      if (!replayHead) {
        throw unpublishedActivationError(
          "KNOWLEDGE_SPACE_PROFILE_HEAD_INVALID",
          "Knowledge-space profile head disappeared during replay",
        );
      }
      return { head: replayHead, replayed: true };
    }

    if (input.snapshot.revision !== currentProfile.revision + 1) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
        `Profile snapshot revision=${input.snapshot.revision} must succeed active revision=${currentProfile.revision}`,
      );
    }
  }

  const existingRow = await getRevisionRow(
    database,
    transaction,
    { ...input, revision: input.snapshot.revision },
    true,
  );
  let candidate: KnowledgeSpaceProfileRevision;
  if (existingRow) {
    candidate = mapProfileRevision(existingRow);
    if (
      candidate.state !== "candidate" ||
      candidate.snapshotDigest !== input.snapshotDigest ||
      candidate.capabilitySnapshotDigest !== input.capabilitySnapshotDigest
    ) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_CONFLICT",
        "The target immutable profile revision is already owned by different settings",
      );
    }
  } else {
    const pending = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId, input.kind],
      sql: `SELECT ${q(database, "id")}, ${q(database, "revision")} FROM ${q(
        database,
        revisionTable,
      )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
        database,
        "knowledge_space_id",
      )} = ${p(database, 2)} AND ${q(database, "kind")} = ${p(
        database,
        3,
      )} AND ${q(database, "state")} = 'candidate' LIMIT 1 FOR UPDATE;`,
      tableName: revisionTable,
    });
    if (pending.rows[0]) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_CONFLICT",
        "Another settings update owns the pending immutable profile revision",
      );
    }

    const latest = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [input.tenantId, input.knowledgeSpaceId, input.kind],
      sql: `SELECT * FROM ${q(database, revisionTable)} WHERE ${q(
        database,
        "tenant_id",
      )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
        database,
        2,
      )} AND ${q(database, "kind")} = ${p(database, 3)} ORDER BY ${q(
        database,
        "revision",
      )} DESC LIMIT 1 FOR UPDATE;`,
      tableName: revisionTable,
    });
    const latestProfile = latest.rows[0] ? mapProfileRevision(latest.rows[0]) : null;
    if (!currentHead && latestProfile?.state === "active") {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_HEAD_INVALID",
        "An active profile revision exists without its durable head",
      );
    }
    if (latestProfile && input.snapshot.revision !== latestProfile.revision + 1) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_REVISION_CONFLICT",
        `Profile snapshot revision=${input.snapshot.revision} must be next revision=${latestProfile.revision + 1}`,
      );
    }

    const candidateId = nonzeroUuid(generateRevisionId(), "revisionId");
    await insertProfileRevision(database, transaction, {
      ...input,
      id: candidateId,
      state: "candidate",
    });
    const created = await getRevisionRow(
      database,
      transaction,
      { ...input, revision: input.snapshot.revision },
      false,
    );
    if (!created) {
      throw new Error("Created unpublished profile candidate could not be reloaded");
    }
    candidate = mapProfileRevision(created);
  }

  if (currentProfile) {
    const superseded = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [input.now, input.now, currentProfile.id],
      sql: `UPDATE ${q(database, revisionTable)} SET ${q(
        database,
        "state",
      )} = 'superseded', ${q(database, "superseded_at")} = ${p(
        database,
        1,
      )}, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(
        database,
        "id",
      )} = ${p(database, 3)} AND ${q(database, "state")} = 'active';`,
      tableName: revisionTable,
    });
    if (superseded.rowsAffected !== 1) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
        "Active profile revision changed before it could be superseded",
      );
    }
  }

  const activated = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [input.now, input.now, candidate.id],
    sql: `UPDATE ${q(database, revisionTable)} SET ${q(
      database,
      "state",
    )} = 'active', ${q(database, "activated_at")} = ${p(database, 1)}, ${q(
      database,
      "updated_at",
    )} = ${p(database, 2)} WHERE ${q(database, "id")} = ${p(
      database,
      3,
    )} AND ${q(database, "state")} = 'candidate';`,
    tableName: revisionTable,
  });
  if (activated.rowsAffected !== 1) {
    throw unpublishedActivationError(
      "KNOWLEDGE_SPACE_PROFILE_CANDIDATE_CONFLICT",
      "Candidate profile revision changed before activation",
    );
  }

  if (currentHead) {
    const rowVersion = numberColumn(currentHead, "row_version");
    const advanced = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        candidate.id,
        candidate.revision,
        rowVersion + 1,
        input.now,
        input.tenantId,
        input.knowledgeSpaceId,
        input.kind,
        rowVersion,
      ],
      sql: `UPDATE ${q(database, headTable)} SET ${q(
        database,
        "profile_revision_id",
      )} = ${p(database, 1)}, ${q(database, "active_revision")} = ${p(
        database,
        2,
      )}, ${q(database, "row_version")} = ${p(database, 3)}, ${q(
        database,
        "updated_at",
      )} = ${p(database, 4)} WHERE ${q(database, "tenant_id")} = ${p(
        database,
        5,
      )} AND ${q(database, "knowledge_space_id")} = ${p(database, 6)} AND ${q(
        database,
        "kind",
      )} = ${p(database, 7)} AND ${q(database, "row_version")} = ${p(database, 8)};`,
      tableName: headTable,
    });
    if (advanced.rowsAffected !== 1) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
        "Knowledge-space profile head lost its row-version fence",
      );
    }
  } else {
    const headId = nonzeroUuid(generateHeadId(), "headId");
    const inserted = await transaction.execute({
      maxRows: 0,
      operation: "insert",
      params: [
        headId,
        input.tenantId,
        input.knowledgeSpaceId,
        input.kind,
        candidate.id,
        candidate.revision,
        1,
        input.now,
        input.now,
      ],
      sql: `INSERT INTO ${q(database, headTable)} (${[
        "id",
        "tenant_id",
        "knowledge_space_id",
        "kind",
        "profile_revision_id",
        "active_revision",
        "row_version",
        "created_at",
        "updated_at",
      ]
        .map((column) => q(database, column))
        .join(", ")}) VALUES (${Array.from({ length: 9 }, (_, index) =>
        p(database, index + 1),
      ).join(", ")});`,
      tableName: headTable,
    });
    if (inserted.rowsAffected !== 1) {
      throw unpublishedActivationError(
        "KNOWLEDGE_SPACE_PROFILE_HEAD_CONFLICT",
        "Knowledge-space profile head could not be installed",
      );
    }
  }

  const head = await getProfileHead(database, transaction, input, false);
  if (!head) throw new Error("Activated unpublished profile head could not be reloaded");
  await appendKnowledgeSpaceActivityWithExecutor({
    database,
    executor: transaction,
    input: {
      action: "profile.published",
      actor: { id: candidate.createdBySubjectId, type: "member" },
      details: { providerId: candidate.provider },
      id: deterministicKnowledgeSpaceActivityId(
        "profile.published",
        input.tenantId,
        input.knowledgeSpaceId,
        input.kind,
        candidate.id,
      ),
      knowledgeSpaceId: input.knowledgeSpaceId,
      occurredAt: input.now,
      requiredPermissionScope: [],
      resource: { id: candidate.id, type: "profile" },
      result: "success",
      tenantId: input.tenantId,
    },
  });
  return { head, replayed: false };
}

async function requireWritableSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfileScope,
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, scope))) {
    throw new KnowledgeSpaceProfileTransitionError(
      "KNOWLEDGE_SPACE_PROFILE_SPACE_NOT_WRITABLE",
      "Knowledge space is missing, deleting, or fenced by an active deletion job",
    );
  }
}

async function getProfileHead(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfileScope,
  forUpdate: boolean,
): Promise<KnowledgeSpaceProfileHead | null> {
  const headAlias = "profile_head";
  const revisionAlias = "profile_revision";
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.kind],
    sql: `SELECT ${qualified(database, headAlias, "id")} AS ${q(
      database,
      "head_id",
    )}, ${qualified(database, headAlias, "profile_revision_id")} AS ${q(
      database,
      "head_profile_revision_id",
    )}, ${qualified(database, headAlias, "active_revision")} AS ${q(
      database,
      "head_active_revision",
    )}, ${qualified(database, headAlias, "row_version")} AS ${q(
      database,
      "head_row_version",
    )}, ${qualified(database, headAlias, "created_at")} AS ${q(
      database,
      "head_created_at",
    )}, ${qualified(database, headAlias, "updated_at")} AS ${q(
      database,
      "head_updated_at",
    )}, ${revisionAlias}.* FROM ${q(database, headTable)} ${headAlias} JOIN ${q(
      database,
      revisionTable,
    )} ${revisionAlias} ON ${qualified(database, revisionAlias, "id")} = ${qualified(
      database,
      headAlias,
      "profile_revision_id",
    )} WHERE ${qualified(database, headAlias, "tenant_id")} = ${p(
      database,
      1,
    )} AND ${qualified(database, headAlias, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${qualified(database, headAlias, "kind")} = ${p(database, 3)}${
      forUpdate ? " FOR UPDATE" : ""
    };`,
    tableName: headTable,
  });
  const row = result.rows[0];
  if (!row) return null;
  const profile = mapProfileRevision(row);
  const activeRevision = numberColumn(row, "head_active_revision");
  if (
    profile.state !== "active" ||
    profile.revision !== activeRevision ||
    profile.id !== stringColumn(row, "head_profile_revision_id") ||
    profile.tenantId !== scope.tenantId ||
    profile.knowledgeSpaceId !== scope.knowledgeSpaceId ||
    profile.kind !== scope.kind
  ) {
    throw new KnowledgeSpaceProfileTransitionError(
      "KNOWLEDGE_SPACE_PROFILE_HEAD_INVALID",
      "Knowledge-space profile head and revision scope are inconsistent",
    );
  }
  return {
    activeRevision,
    createdAt: stringColumn(row, "head_created_at"),
    id: stringColumn(row, "head_id"),
    kind: scope.kind,
    knowledgeSpaceId: scope.knowledgeSpaceId,
    profile,
    profileRevisionId: profile.id,
    rowVersion: numberColumn(row, "head_row_version"),
    tenantId: scope.tenantId,
    updatedAt: stringColumn(row, "head_updated_at"),
  };
}

async function getHeadRow(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfileScope,
  forUpdate: boolean,
): Promise<DatabaseRow | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.kind],
    sql: `SELECT * FROM ${q(database, headTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "kind")} = ${p(database, 3)}${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: headTable,
  });
  return result.rows[0] ?? null;
}

async function getRevisionRow(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: KnowledgeSpaceProfileScope & { readonly revision: number },
  forUpdate: boolean,
): Promise<DatabaseRow | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.kind, input.revision],
    sql: `SELECT * FROM ${q(database, revisionTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "kind")} = ${p(database, 3)} AND ${q(
      database,
      "revision",
    )} = ${p(database, 4)}${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: revisionTable,
  });
  return result.rows[0] ?? null;
}

async function getRevisionRowById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
  forUpdate: boolean,
): Promise<DatabaseRow | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [id],
    sql: `SELECT * FROM ${q(database, revisionTable)} WHERE ${q(
      database,
      "id",
    )} = ${p(database, 1)}${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: revisionTable,
  });
  return result.rows[0] ?? null;
}

function mapProfileRevision(row: DatabaseRow): KnowledgeSpaceProfileRevision {
  const kind = profileKind(stringColumn(row, "kind"));
  const id = UuidSchema.parse(stringColumn(row, "id"));
  const snapshotObject = jsonObjectColumn(row, "snapshot");
  const snapshot = parseSnapshot(kind, snapshotObject);
  const capabilitySnapshot = jsonObjectColumn(row, "capability_snapshot");
  const snapshotDigest = digest(stringColumn(row, "snapshot_digest"), "snapshotDigest");
  const capabilitySnapshotDigest = digest(
    stringColumn(row, "capability_snapshot_digest"),
    "capabilitySnapshotDigest",
  );
  if (
    knowledgeSpaceProfileSnapshotDigest(snapshot) !== snapshotDigest ||
    knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot) !== capabilitySnapshotDigest
  ) {
    throw new KnowledgeSpaceProfileSnapshotCorruptionError(id);
  }

  const stateText = stringColumn(row, "state");
  if (
    !KnowledgeSpaceProfileRevisionStates.includes(stateText as KnowledgeSpaceProfileRevisionState)
  ) {
    throw new Error(`Invalid knowledge-space profile revision state=${stateText}`);
  }
  const state = stateText as KnowledgeSpaceProfileRevisionState;
  const selection = selectionForSnapshot(kind, snapshot);
  const embeddingSnapshot =
    kind === "embedding" ? KnowledgeSpaceEmbeddingProfileSchema.parse(snapshot) : null;
  const vectorSpaceId = optionalStringColumn(row, "vector_space_id");
  const dimension = optionalNumberColumn(row, "dimension");
  if (
    selection.pluginId !== stringColumn(row, "plugin_id") ||
    selection.provider !== stringColumn(row, "provider") ||
    selection.model !== stringColumn(row, "model") ||
    (embeddingSnapshot !== null &&
      (vectorSpaceId !== embeddingSnapshot.vectorSpaceId ||
        dimension === undefined ||
        embeddingSnapshot.dimension === undefined ||
        dimension !== embeddingSnapshot.dimension)) ||
    (kind === "retrieval" && (vectorSpaceId !== undefined || dimension !== undefined))
  ) {
    throw new KnowledgeSpaceProfileSnapshotCorruptionError(id);
  }

  return {
    ...(optionalStringColumn(row, "activated_at")
      ? { activatedAt: optionalStringColumn(row, "activated_at") }
      : {}),
    capabilitySnapshot,
    capabilitySnapshotDigest,
    createdAt: stringColumn(row, "created_at"),
    createdBySubjectId: stringColumn(row, "created_by_subject_id"),
    ...(dimension === undefined ? {} : { dimension: positiveInteger(dimension, "dimension") }),
    ...(optionalStringColumn(row, "failed_at")
      ? { failedAt: optionalStringColumn(row, "failed_at") }
      : {}),
    ...(optionalStringColumn(row, "failure_code")
      ? { failureCode: optionalStringColumn(row, "failure_code") }
      : {}),
    ...(optionalStringColumn(row, "failure_message")
      ? { failureMessage: optionalStringColumn(row, "failure_message") }
      : {}),
    id,
    kind,
    knowledgeSpaceId: UuidSchema.parse(stringColumn(row, "knowledge_space_id")),
    model: selection.model,
    pluginId: selection.pluginId,
    provider: selection.provider,
    revision: positiveInteger(numberColumn(row, "revision"), "revision"),
    snapshot,
    snapshotDigest,
    state,
    ...(optionalStringColumn(row, "superseded_at")
      ? { supersededAt: optionalStringColumn(row, "superseded_at") }
      : {}),
    tenantId: TenantIdSchema.parse(stringColumn(row, "tenant_id")),
    updatedAt: stringColumn(row, "updated_at"),
    ...(vectorSpaceId === undefined ? {} : { vectorSpaceId }),
  };
}

function normalizeCandidateInput(
  input: CreateKnowledgeSpaceProfileCandidateInput,
): NormalizedCandidate {
  const scope = normalizeScope(input);
  const now = DateTimeSchema.parse(input.now);
  const snapshot = parseSnapshot(scope.kind, input.snapshot);
  const embeddingSnapshot =
    scope.kind === "embedding" ? KnowledgeSpaceEmbeddingProfileSchema.parse(snapshot) : null;
  const embeddingDimension =
    embeddingSnapshot === null
      ? undefined
      : positiveInteger(embeddingSnapshot.dimension ?? Number.NaN, "embedding profile dimension");
  const capabilitySnapshot = cloneObject(input.capabilitySnapshot, "capabilitySnapshot");
  const selection = selectionForSnapshot(scope.kind, snapshot);
  const createdBySubjectId = requiredText(input.createdBySubjectId, "createdBySubjectId", 255);

  return {
    ...scope,
    capabilitySnapshot,
    capabilitySnapshotDigest: knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot),
    createdBySubjectId,
    ...(embeddingDimension === undefined ? {} : { dimension: embeddingDimension }),
    model: requiredText(selection.model, "model", 256),
    now,
    pluginId: requiredText(selection.pluginId, "pluginId", 256),
    preserveLegacyInitialRevision: input.preserveLegacyInitialRevision === true,
    provider: requiredText(selection.provider, "provider", 256),
    snapshot,
    snapshotDigest: knowledgeSpaceProfileSnapshotDigest(snapshot),
    ...(embeddingSnapshot === null ? {} : { vectorSpaceId: embeddingSnapshot.vectorSpaceId }),
  };
}

function normalizeUnpublishedActivationInput(
  input: ActivateUnpublishedKnowledgeSpaceProfileInput,
): NormalizedUnpublishedActivation {
  const candidate = normalizeCandidateInput({
    capabilitySnapshot: input.capabilitySnapshot,
    createdBySubjectId: input.createdBySubjectId,
    kind: input.kind,
    knowledgeSpaceId: input.knowledgeSpaceId,
    now: input.now,
    snapshot: input.snapshot,
    tenantId: input.tenantId,
  });
  const expectedManifestProfileRevision = nonnegativeInteger(
    input.expectedManifestProfileRevision,
    "expectedManifestProfileRevision",
  );
  const expectedManifestVersion = positiveInteger(
    input.expectedManifestVersion,
    "expectedManifestVersion",
  );
  const expectedPendingConfiguration = input.expectedPendingConfiguration
    ? {
        digest: digest(input.expectedPendingConfiguration.digest, "pendingConfigurationDigest"),
        revision: positiveInteger(
          input.expectedPendingConfiguration.revision,
          "pendingConfigurationRevision",
        ),
      }
    : undefined;
  const clearPendingConfiguration = input.clearPendingConfiguration === true;
  if (
    clearPendingConfiguration &&
    (candidate.kind !== "retrieval" || !expectedPendingConfiguration)
  ) {
    throw unpublishedActivationError(
      "KNOWLEDGE_SPACE_PENDING_CONFIGURATION_CLEAR_INVALID",
      "Only the final retrieval activation may clear its expected pending configuration",
    );
  }
  const initialActivation = input.initialActivation === true;
  if (
    initialActivation &&
    (candidate.kind !== "embedding" ||
      expectedManifestProfileRevision !== 0 ||
      candidate.snapshot.revision !== 1)
  ) {
    throw unpublishedActivationError(
      "KNOWLEDGE_SPACE_INITIAL_PROFILE_ACTIVATION_INVALID",
      "Initial profile activation is only valid for the first embedding revision",
    );
  }
  if (
    input.permission.tenantId !== candidate.tenantId ||
    input.permission.knowledgeSpaceId !== candidate.knowledgeSpaceId ||
    input.permission.requestedBySubjectId !== candidate.createdBySubjectId
  ) {
    throw unpublishedActivationError(
      "KNOWLEDGE_SPACE_PROFILE_PERMISSION_SCOPE_INVALID",
      "Durable admin permission does not match the profile mutation scope",
    );
  }
  return {
    ...candidate,
    clearPendingConfiguration,
    expectedManifestProfileRevision,
    expectedManifestVersion,
    ...(expectedPendingConfiguration ? { expectedPendingConfiguration } : {}),
    initialActivation,
    permission: { ...input.permission },
    requiredAccess: input.requiredAccess === "write" ? "write" : "admin",
  };
}

function normalizeInitialTupleInput(
  input: ActivateInitialKnowledgeSpaceProfileTupleInput,
): NormalizedInitialProfileTuple {
  const expectedManifestVersion = positiveInteger(
    input.expectedManifestVersion,
    "expectedManifestVersion",
  );
  const expectedPendingConfiguration = {
    digest: digest(input.expectedPendingConfiguration.digest, "pendingConfigurationDigest"),
    revision: positiveInteger(
      input.expectedPendingConfiguration.revision,
      "pendingConfigurationRevision",
    ),
  };
  const common = {
    createdBySubjectId: input.createdBySubjectId,
    expectedManifestProfileRevision: 0,
    expectedManifestVersion,
    expectedPendingConfiguration,
    knowledgeSpaceId: input.knowledgeSpaceId,
    now: input.now,
    permission: input.permission,
    requiredAccess: input.requiredAccess,
    tenantId: input.tenantId,
  } as const;
  const embedding = input.embedding
    ? normalizeUnpublishedActivationInput({
        ...common,
        capabilitySnapshot: input.embedding.capabilitySnapshot,
        initialActivation: true,
        kind: "embedding",
        snapshot: input.embedding.snapshot,
      })
    : undefined;
  const retrieval = normalizeUnpublishedActivationInput({
    ...common,
    capabilitySnapshot: input.retrieval.capabilitySnapshot,
    kind: "retrieval",
    snapshot: input.retrieval.snapshot,
  });
  if (retrieval.snapshot.revision !== 1) {
    throw unpublishedActivationError(
      "KNOWLEDGE_SPACE_INITIAL_PROFILE_ACTIVATION_INVALID",
      "Initial retrieval profile activation is only valid for revision 1",
    );
  }
  const retrievalSnapshot = KnowledgeSpaceRetrievalProfileSchema.parse(retrieval.snapshot);
  if (retrievalSnapshot.defaultMode !== "research" && !embedding) {
    throw unpublishedActivationError(
      "KNOWLEDGE_SPACE_INITIAL_PROFILE_TUPLE_INVALID",
      "Fast/Deep initial profile activation requires an embedding profile",
    );
  }
  return {
    ...(embedding ? { embedding } : {}),
    expectedManifestVersion,
    expectedPendingConfiguration,
    knowledgeSpaceId: retrieval.knowledgeSpaceId,
    now: retrieval.now,
    permission: retrieval.permission,
    requiredAccess: retrieval.requiredAccess,
    retrieval,
    tenantId: retrieval.tenantId,
  };
}

function normalizeActivationInput(
  input: ActivateKnowledgeSpaceProfileCandidateInput,
): ActivateKnowledgeSpaceProfileCandidateInput {
  return {
    ...normalizeScope(input),
    expectedActiveRevision:
      input.expectedActiveRevision === null
        ? null
        : positiveInteger(input.expectedActiveRevision, "expectedActiveRevision"),
    now: DateTimeSchema.parse(input.now),
    revision: positiveInteger(input.revision, "revision"),
  };
}

function normalizeFailureInput(
  input: FailKnowledgeSpaceProfileCandidateInput,
): FailKnowledgeSpaceProfileCandidateInput {
  return {
    ...normalizeScope(input),
    errorCode: requiredText(input.errorCode, "errorCode", 64),
    errorMessage: requiredText(input.errorMessage, "errorMessage", 16_384),
    now: DateTimeSchema.parse(input.now),
    revision: positiveInteger(input.revision, "revision"),
  };
}

function normalizeScope(input: KnowledgeSpaceProfileScope): KnowledgeSpaceProfileScope {
  return {
    kind: profileKind(input.kind),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function normalizeListInput(
  input: ListKnowledgeSpaceProfileRevisionsInput,
  maxListLimit: number,
): ListKnowledgeSpaceProfileRevisionsInput {
  const limit = positiveInteger(input.limit, "limit");
  if (limit > maxListLimit) {
    throw new Error(`Knowledge-space profile list limit exceeds maxListLimit=${maxListLimit}`);
  }
  return {
    ...normalizeScope(input),
    ...(input.afterRevision === undefined
      ? {}
      : { afterRevision: positiveInteger(input.afterRevision, "afterRevision") }),
    limit,
  };
}

function parseSnapshot(
  kind: KnowledgeSpaceProfileKind,
  value: unknown,
): KnowledgeSpaceProfileSnapshot {
  return kind === "embedding"
    ? KnowledgeSpaceEmbeddingProfileSchema.parse(value)
    : KnowledgeSpaceRetrievalProfileSchema.parse(value);
}

function selectionForSnapshot(
  kind: KnowledgeSpaceProfileKind,
  snapshot: KnowledgeSpaceProfileSnapshot,
): { readonly model: string; readonly pluginId: string; readonly provider: string } {
  return kind === "embedding"
    ? KnowledgeSpaceEmbeddingProfileSchema.parse(snapshot)
    : KnowledgeSpaceRetrievalProfileSchema.parse(snapshot).reasoningModel;
}

function pendingConfigurationMatchesSnapshot(
  kind: KnowledgeSpaceProfileKind,
  pending: KnowledgeSpacePendingModelConfiguration,
  snapshot: KnowledgeSpaceProfileSnapshot,
): boolean {
  if (kind === "embedding") {
    const embedding = KnowledgeSpaceEmbeddingProfileSchema.parse(snapshot);
    return (
      pending.embeddingSelection !== undefined &&
      pending.embeddingSelection.model === embedding.model &&
      pending.embeddingSelection.pluginId === embedding.pluginId &&
      pending.embeddingSelection.provider === embedding.provider
    );
  }
  const retrieval = KnowledgeSpaceRetrievalProfileSchema.parse(snapshot);
  const { revision: _revision, ...retrievalInput } = retrieval;
  return (
    pending.retrievalProfile !== undefined &&
    stableJson(pending.retrievalProfile) === stableJson(retrievalInput)
  );
}

function cloneObject(
  value: Readonly<Record<string, unknown>>,
  name: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Knowledge-space profile ${name} must be a JSON object`);
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function profileKind(value: string): KnowledgeSpaceProfileKind {
  if (!KnowledgeSpaceProfileKinds.includes(value as KnowledgeSpaceProfileKind)) {
    throw new Error(`Invalid knowledge-space profile kind=${value}`);
  }
  return value as KnowledgeSpaceProfileKind;
}

function digest(value: string, name: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Knowledge-space profile ${name} must be a SHA-256 hex digest`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Knowledge-space profile ${name} must be a positive safe integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Knowledge-space profile ${name} must be a non-negative safe integer`);
  }
  return value;
}

function unpublishedProfileMetadataKey(kind: KnowledgeSpaceProfileKind): string {
  return kind === "embedding"
    ? unpublishedEmbeddingProfileMetadataKey
    : unpublishedRetrievalProfileMetadataKey;
}

function unpublishedActivationError(
  code: string,
  message: string,
): KnowledgeSpaceUnpublishedProfileActivationError {
  return new KnowledgeSpaceUnpublishedProfileActivationError(code, message);
}

function requiredText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`Knowledge-space profile ${name} must contain 1-${max} characters`);
  }
  return normalized;
}

function nonzeroUuid(value: string, name: string): string {
  const id = UuidSchema.parse(value);
  if (id === "00000000-0000-0000-0000-000000000000") {
    throw new Error(`Knowledge-space profile ${name} must not be the zero UUID`);
  }
  return id;
}

function q(database: Pick<DatabaseAdapter, "dialect">, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return databasePlaceholder(database, position);
}

function qualified(
  database: Pick<DatabaseAdapter, "dialect">,
  alias: string,
  column: string,
): string {
  return `${alias}.${q(database, column)}`;
}

function pushParam(
  database: Pick<DatabaseAdapter, "dialect">,
  params: DatabaseQueryValue[],
  value: DatabaseQueryValue,
): string {
  params.push(value);
  return p(database, params.length);
}

function jsonPlaceholder(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  const placeholder = p(database, position);
  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}
