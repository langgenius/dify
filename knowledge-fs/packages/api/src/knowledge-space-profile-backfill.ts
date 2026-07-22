import { randomUUID } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  KnowledgeSpaceEmbeddingProfileSchema,
  KnowledgeSpaceRetrievalProfileSchema,
  TenantIdSchema,
  UuidSchema,
  buildKnowledgeSpaceVectorSpaceId,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import {
  type KnowledgeSpaceProfileKind,
  KnowledgeSpaceProfileKinds,
  type KnowledgeSpaceProfileScope,
  type KnowledgeSpaceProfileSnapshot,
  knowledgeSpaceProfileSnapshotDigest,
} from "./knowledge-space-profile-repository";
import {
  type ModelCapabilitySnapshot,
  ModelCapabilitySnapshotSchema,
} from "./model-capability-preflight";

export const KnowledgeSpaceProfileBackfillRunStates = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type KnowledgeSpaceProfileBackfillRunState =
  (typeof KnowledgeSpaceProfileBackfillRunStates)[number];

export interface KnowledgeSpaceProfileBackfill extends KnowledgeSpaceProfileScope {
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly executionAttempts: number;
  readonly heartbeatAt?: string | undefined;
  readonly id: string;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly maxExecutionAttempts: number;
  readonly rowVersion: number;
  readonly runState: KnowledgeSpaceProfileBackfillRunState;
  readonly sourceManifestVersion: number;
  readonly sourceSnapshot: Readonly<Record<string, unknown>>;
  readonly sourceSnapshotDigest: string;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
}

export interface KnowledgeSpaceProfileBackfillFence {
  readonly expectedRowVersion: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly now: string;
}

export interface DiscoverKnowledgeSpaceProfileBackfillsInput {
  readonly afterKnowledgeSpaceId?: string | undefined;
  readonly limit: number;
  readonly now: string;
}

export interface DiscoverKnowledgeSpaceProfileBackfillsResult {
  /** Scanned spaces whose current published head must be reconciled to an activated tuple. */
  readonly bindingCandidates: readonly KnowledgeSpaceProfilePublicationBackfillScope[];
  readonly created: number;
  readonly nextKnowledgeSpaceId?: string | undefined;
  readonly scanned: number;
}

export interface KnowledgeSpaceProfilePublicationBackfillScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface ClaimKnowledgeSpaceProfileBackfillsInput {
  readonly leaseExpiresAt: string;
  readonly limit: number;
  readonly now: string;
  readonly workerId: string;
}

export interface ProcessKnowledgeSpaceProfileBackfillResult {
  readonly activated: boolean;
  readonly job: KnowledgeSpaceProfileBackfill;
  readonly profileRevisionId?: string | undefined;
}

export interface KnowledgeSpaceProfileBackfillRepository {
  claim(
    input: ClaimKnowledgeSpaceProfileBackfillsInput,
  ): Promise<readonly KnowledgeSpaceProfileBackfill[]>;
  discover(
    input: DiscoverKnowledgeSpaceProfileBackfillsInput,
  ): Promise<DiscoverKnowledgeSpaceProfileBackfillsResult>;
  fail(
    input: KnowledgeSpaceProfileBackfillFence & {
      readonly errorCode: string;
      readonly errorMessage: string;
    },
  ): Promise<KnowledgeSpaceProfileBackfill | null>;
  get(input: KnowledgeSpaceProfileScope): Promise<KnowledgeSpaceProfileBackfill | null>;
  heartbeat(
    input: KnowledgeSpaceProfileBackfillFence & {
      readonly leaseExpiresAt: string;
      readonly workerId: string;
    },
  ): Promise<KnowledgeSpaceProfileBackfill | null>;
  process(
    input: KnowledgeSpaceProfileBackfillFence & {
      readonly capabilitySnapshot: Readonly<Record<string, unknown>>;
    },
  ): Promise<ProcessKnowledgeSpaceProfileBackfillResult>;
  release(input: KnowledgeSpaceProfileBackfillFence): Promise<KnowledgeSpaceProfileBackfill | null>;
  retry(
    input: KnowledgeSpaceProfileScope & { readonly now: string },
  ): Promise<KnowledgeSpaceProfileBackfill | null>;
}

export interface DatabaseKnowledgeSpaceProfileBackfillRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateHeadId?: (() => string) | undefined;
  readonly generateJobId?: (() => string) | undefined;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly generateRevisionId?: (() => string) | undefined;
  readonly maxClaimBatchSize: number;
  readonly maxDiscoveryBatchSize: number;
  readonly maxExecutionAttempts: number;
}

export class KnowledgeSpaceProfileBackfillTransitionError extends Error {
  readonly code = "KNOWLEDGE_SPACE_PROFILE_BACKFILL_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "KnowledgeSpaceProfileBackfillTransitionError";
  }
}

const backfillTable = "knowledge_space_profile_backfills";
const manifestTable = "knowledge_space_manifests";
const headTable = "knowledge_space_profile_heads";
const revisionTable = "knowledge_space_profile_revisions";
const spaceTable = "knowledge_spaces";
const publicationBindingTable = "knowledge_space_profile_publication_bindings";
const publicationHeadTable = "projection_set_publication_heads";
const embeddingMetadataKey = "__knowledgeFsEmbeddingProfile";
const retrievalMetadataKey = "__knowledgeFsRetrievalProfile";
const systemActor = "system:legacy-profile-backfill";

/**
 * Durable, bounded legacy-manifest backfill. Discovery freezes the exact source snapshot. Process
 * takes the same space/deletion lock as online profile writers, revalidates the locked manifest,
 * installs revision+head atomically, and advances the lease-fenced ledger in that transaction.
 */
export function createDatabaseKnowledgeSpaceProfileBackfillRepository({
  database,
  generateHeadId = randomUUID,
  generateJobId = randomUUID,
  generateLeaseToken = randomUUID,
  generateRevisionId = randomUUID,
  maxClaimBatchSize,
  maxDiscoveryBatchSize,
  maxExecutionAttempts,
}: DatabaseKnowledgeSpaceProfileBackfillRepositoryOptions): KnowledgeSpaceProfileBackfillRepository {
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");
  positiveInteger(maxDiscoveryBatchSize, "maxDiscoveryBatchSize");
  positiveInteger(maxExecutionAttempts, "maxExecutionAttempts");

  return {
    claim: async (rawInput) => {
      const input = normalizeClaim(rawInput, maxClaimBatchSize);
      return database.transaction(async (transaction) => {
        const claimable = await transaction.execute({
          maxRows: input.limit,
          operation: "select",
          params: [input.now, input.limit],
          sql: `SELECT * FROM ${q(database, backfillTable)} WHERE (${q(
            database,
            "run_state",
          )} = 'queued' OR (${q(database, "run_state")} = 'running' AND ${q(
            database,
            "lease_expires_at",
          )} <= ${p(database, 1)})) ORDER BY ${q(database, "updated_at")} ASC, ${q(
            database,
            "id",
          )} ASC LIMIT ${p(database, 2)} FOR UPDATE${
            database.dialect === "postgres" ? " SKIP LOCKED" : ""
          };`,
          tableName: backfillTable,
        });
        const jobs: KnowledgeSpaceProfileBackfill[] = [];
        for (const row of claimable.rows) {
          const current = mapBackfill(row);
          if (current.executionAttempts >= current.maxExecutionAttempts) {
            const exhausted = await transaction.execute({
              maxRows: 0,
              operation: "update",
              params: [
                "PROFILE_BACKFILL_ATTEMPTS_EXHAUSTED",
                "Profile backfill exhausted its durable execution-attempt budget",
                input.now,
                current.rowVersion + 1,
                current.id,
                current.rowVersion,
              ],
              sql: `UPDATE ${q(database, backfillTable)} SET ${q(
                database,
                "run_state",
              )} = 'failed', ${q(database, "last_error_code")} = ${p(
                database,
                1,
              )}, ${q(database, "last_error_message")} = ${p(
                database,
                2,
              )}, ${q(database, "worker_id")} = NULL, ${q(
                database,
                "lease_token",
              )} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(
                database,
                "heartbeat_at",
              )} = NULL, ${q(database, "completed_at")} = ${p(database, 3)}, ${q(
                database,
                "updated_at",
              )} = ${p(database, 3)}, ${q(database, "row_version")} = ${p(
                database,
                4,
              )} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(
                database,
                "row_version",
              )} = ${p(database, 6)};`,
              tableName: backfillTable,
            });
            if (exhausted.rowsAffected !== 1) {
              throw new KnowledgeSpaceProfileBackfillTransitionError(
                "Profile backfill changed while exhausting its attempt budget",
              );
            }
            continue;
          }
          const leaseToken = nonzeroUuid(generateLeaseToken(), "leaseToken");
          const nextVersion = current.rowVersion + 1;
          const updated = await transaction.execute({
            maxRows: 0,
            operation: "update",
            params: [
              input.workerId,
              leaseToken,
              input.leaseExpiresAt,
              input.now,
              current.executionAttempts + 1,
              nextVersion,
              input.now,
              current.id,
              current.rowVersion,
            ],
            sql: `UPDATE ${q(database, backfillTable)} SET ${q(
              database,
              "run_state",
            )} = 'running', ${q(database, "worker_id")} = ${p(database, 1)}, ${q(
              database,
              "lease_token",
            )} = ${p(database, 2)}, ${q(database, "lease_expires_at")} = ${p(
              database,
              3,
            )}, ${q(database, "heartbeat_at")} = ${p(database, 4)}, ${q(
              database,
              "execution_attempts",
            )} = ${p(database, 5)}, ${q(database, "row_version")} = ${p(
              database,
              6,
            )}, ${q(database, "updated_at")} = ${p(database, 7)}, ${q(
              database,
              "completed_at",
            )} = NULL, ${q(database, "last_error_code")} = NULL, ${q(
              database,
              "last_error_message",
            )} = NULL WHERE ${q(database, "id")} = ${p(database, 8)} AND ${q(
              database,
              "row_version",
            )} = ${p(database, 9)};`,
            tableName: backfillTable,
          });
          if (updated.rowsAffected !== 1) {
            throw new KnowledgeSpaceProfileBackfillTransitionError(
              "Profile backfill lost its row-version fence while being claimed",
            );
          }
          const claimed = await getBackfillById(database, transaction, current.id, false);
          if (!claimed) throw new Error("Claimed profile backfill could not be reloaded");
          jobs.push(claimed);
        }
        return jobs;
      });
    },

    discover: async (rawInput) => {
      const input = normalizeDiscovery(rawInput, maxDiscoveryBatchSize);
      return database.transaction(async (transaction) => {
        const params: DatabaseQueryValue[] = [];
        const cursorSql = input.afterKnowledgeSpaceId
          ? `${qualified(database, "space", "id")} > ${pushParam(
              database,
              params,
              input.afterKnowledgeSpaceId,
            )} AND `
          : "";
        const limitPlaceholder = pushParam(database, params, input.limit);
        const rows = await transaction.execute({
          maxRows: input.limit,
          operation: "select",
          params,
          sql: `SELECT ${qualified(database, "space", "tenant_id")} AS ${q(
            database,
            "tenant_id",
          )}, ${qualified(database, "space", "id")} AS ${q(
            database,
            "knowledge_space_id",
          )}, ${qualified(database, "manifest", "manifest_version")} AS ${q(
            database,
            "manifest_version",
          )}, ${qualified(database, "manifest", "metadata")} AS ${q(
            database,
            "metadata",
          )} FROM ${q(database, spaceTable)} space JOIN ${q(
            database,
            manifestTable,
          )} manifest ON ${qualified(database, "manifest", "tenant_id")} = ${qualified(
            database,
            "space",
            "tenant_id",
          )} AND ${qualified(database, "manifest", "knowledge_space_id")} = ${qualified(
            database,
            "space",
            "id",
          )} WHERE ${cursorSql}${qualified(
            database,
            "space",
            "lifecycle_state",
          )} = 'active' AND ${qualified(
            database,
            "space",
            "deletion_job_id",
          )} IS NULL AND (NOT EXISTS (SELECT 1 FROM ${q(
            database,
            headTable,
          )} embedding_head WHERE ${qualified(
            database,
            "embedding_head",
            "tenant_id",
          )} = ${qualified(database, "space", "tenant_id")} AND ${qualified(
            database,
            "embedding_head",
            "knowledge_space_id",
          )} = ${qualified(database, "space", "id")} AND ${qualified(
            database,
            "embedding_head",
            "kind",
          )} = 'embedding') OR NOT EXISTS (SELECT 1 FROM ${q(
            database,
            headTable,
          )} retrieval_head WHERE ${qualified(
            database,
            "retrieval_head",
            "tenant_id",
          )} = ${qualified(database, "space", "tenant_id")} AND ${qualified(
            database,
            "retrieval_head",
            "knowledge_space_id",
          )} = ${qualified(database, "space", "id")} AND ${qualified(
            database,
            "retrieval_head",
            "kind",
          )} = 'retrieval') OR EXISTS (SELECT 1 FROM ${q(
            database,
            publicationHeadTable,
          )} current_publication_head LEFT JOIN ${q(
            database,
            publicationBindingTable,
          )} current_binding ON ${qualified(
            database,
            "current_binding",
            "tenant_id",
          )} = ${qualified(database, "current_publication_head", "tenant_id")} AND ${qualified(
            database,
            "current_binding",
            "knowledge_space_id",
          )} = ${qualified(
            database,
            "current_publication_head",
            "knowledge_space_id",
          )} AND ${qualified(database, "current_binding", "publication_id")} = ${qualified(
            database,
            "current_publication_head",
            "publication_id",
          )} AND ${qualified(
            database,
            "current_binding",
            "activated_at",
          )} IS NOT NULL WHERE ${qualified(
            database,
            "current_publication_head",
            "tenant_id",
          )} = ${qualified(database, "space", "tenant_id")} AND ${qualified(
            database,
            "current_publication_head",
            "knowledge_space_id",
          )} = ${qualified(database, "space", "id")} AND ${qualified(
            database,
            "current_binding",
            "id",
          )} IS NULL)) ORDER BY ${qualified(
            database,
            "space",
            "id",
          )} ASC LIMIT ${limitPlaceholder};`,
          tableName: spaceTable,
        });

        const bindingCandidates: KnowledgeSpaceProfilePublicationBackfillScope[] = [];
        let created = 0;
        for (const row of rows.rows) {
          const tenantId = TenantIdSchema.parse(stringColumn(row, "tenant_id"));
          const knowledgeSpaceId = UuidSchema.parse(stringColumn(row, "knowledge_space_id"));
          bindingCandidates.push({ knowledgeSpaceId, tenantId });
          const manifestVersion = positiveInteger(
            numberColumn(row, "manifest_version"),
            "sourceManifestVersion",
          );
          const metadata = jsonObjectColumn(row, "metadata");
          for (const [kind, key] of [
            ["embedding", embeddingMetadataKey],
            ["retrieval", retrievalMetadataKey],
          ] as const) {
            const snapshot = metadata[key];
            if (!isObject(snapshot)) continue;
            if (
              await insertBackfillIfMissing(database, transaction, {
                id: nonzeroUuid(generateJobId(), "jobId"),
                kind,
                knowledgeSpaceId,
                maxExecutionAttempts,
                now: input.now,
                sourceManifestVersion: manifestVersion,
                sourceSnapshot: snapshot,
                tenantId,
              })
            ) {
              created += 1;
            }
          }
        }
        const last = rows.rows.at(-1);
        return {
          bindingCandidates,
          created,
          ...(last
            ? { nextKnowledgeSpaceId: UuidSchema.parse(stringColumn(last, "knowledge_space_id")) }
            : {}),
          scanned: rows.rows.length,
        };
      });
    },

    fail: async (rawInput) => {
      const input = normalizeFailure(rawInput);
      return database.transaction(async (transaction) => {
        const current = await requireFencedBackfill(database, transaction, input);
        return transitionBackfillFailure(database, transaction, current, input);
      });
    },

    get: (input) => getBackfillByScope(database, database, normalizeScope(input), false),

    heartbeat: async (rawInput) => {
      const input = normalizeHeartbeat(rawInput);
      return database.transaction(async (transaction) => {
        const current = await requireFencedBackfill(database, transaction, input);
        if (current.workerId !== input.workerId) {
          throw new KnowledgeSpaceProfileBackfillTransitionError(
            "Profile backfill heartbeat worker does not own the lease",
          );
        }
        const updated = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            input.leaseExpiresAt,
            input.now,
            current.rowVersion + 1,
            current.id,
            current.rowVersion,
            input.leaseToken,
          ],
          sql: `UPDATE ${q(database, backfillTable)} SET ${q(
            database,
            "lease_expires_at",
          )} = ${p(database, 1)}, ${q(database, "heartbeat_at")} = ${p(
            database,
            2,
          )}, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(
            database,
            "row_version",
          )} = ${p(database, 3)} WHERE ${q(database, "id")} = ${p(
            database,
            4,
          )} AND ${q(database, "row_version")} = ${p(database, 5)} AND ${q(
            database,
            "lease_token",
          )} = ${p(database, 6)};`,
          tableName: backfillTable,
        });
        if (updated.rowsAffected !== 1) return null;
        return getBackfillById(database, transaction, current.id, false);
      });
    },

    process: async (rawFence) => {
      const fence = normalizeFence(rawFence);
      return database.transaction(async (transaction) => {
        const preview = await getBackfillById(database, transaction, fence.jobId, false);
        if (!preview) {
          throw new KnowledgeSpaceProfileBackfillTransitionError(
            "Knowledge-space profile backfill was not found",
          );
        }
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, preview))) {
          const current = await requireFencedBackfill(database, transaction, fence);
          return {
            activated: false,
            job: await transitionBackfillFailure(database, transaction, current, {
              ...fence,
              errorCode: "KNOWLEDGE_SPACE_NOT_WRITABLE",
              errorMessage: "Knowledge space is missing, deleting, or deletion-fenced",
            }),
          };
        }

        const current = await requireFencedBackfill(database, transaction, fence);
        const manifest = await loadManifestForUpdate(database, transaction, current);
        if (!manifest) {
          return {
            activated: false,
            job: await transitionBackfillFailure(database, transaction, current, {
              ...fence,
              errorCode: "LEGACY_MANIFEST_NOT_FOUND",
              errorMessage: "Legacy knowledge-space manifest was not found",
            }),
          };
        }
        const metadata = jsonObjectColumn(manifest, "metadata");
        const source =
          metadata[current.kind === "embedding" ? embeddingMetadataKey : retrievalMetadataKey];
        const manifestVersion = numberColumn(manifest, "manifest_version");
        if (
          !isObject(source) ||
          manifestVersion !== current.sourceManifestVersion ||
          knowledgeSpaceProfileSnapshotDigest(source) !== current.sourceSnapshotDigest
        ) {
          return {
            activated: false,
            job: await transitionBackfillFailure(database, transaction, current, {
              ...fence,
              errorCode: "LEGACY_PROFILE_SOURCE_CHANGED",
              errorMessage:
                "Legacy manifest profile changed after backfill discovery; stale snapshot was not activated",
            }),
          };
        }

        let normalized: NormalizedLegacyProfile;
        try {
          normalized = await normalizeLegacyProfile(
            current.kind,
            source,
            current,
            rawFence.capabilitySnapshot,
          );
        } catch (error) {
          return {
            activated: false,
            job: await transitionBackfillFailure(database, transaction, current, {
              ...fence,
              errorCode: "LEGACY_PROFILE_INVALID",
              errorMessage: error instanceof Error ? error.message : "Legacy profile is invalid",
            }),
          };
        }

        const existingHead = await loadHeadForUpdate(database, transaction, current);
        if (existingHead) {
          const existingDigest = stringColumn(existingHead, "snapshot_digest");
          const existingCapabilityDigest = stringColumn(existingHead, "capability_snapshot_digest");
          const existingState = stringColumn(existingHead, "state");
          if (
            existingDigest === knowledgeSpaceProfileSnapshotDigest(normalized.snapshot) &&
            existingCapabilityDigest ===
              knowledgeSpaceProfileSnapshotDigest(normalized.capabilitySnapshot) &&
            existingState === "active" &&
            numberColumn(existingHead, "active_revision") === normalized.snapshot.revision
          ) {
            return {
              activated: false,
              job: await transitionBackfillSuccess(database, transaction, current, fence.now),
              profileRevisionId: stringColumn(existingHead, "profile_revision_id"),
            };
          }
          return {
            activated: false,
            job: await transitionBackfillFailure(database, transaction, current, {
              ...fence,
              errorCode: "PROFILE_HEAD_ALREADY_EXISTS",
              errorMessage:
                "A different versioned profile head already exists; legacy data was not activated",
            }),
          };
        }

        const revisionConflict = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [
            current.tenantId,
            current.knowledgeSpaceId,
            current.kind,
            normalized.snapshot.revision,
          ],
          sql: `SELECT ${q(database, "id")} FROM ${q(
            database,
            revisionTable,
          )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
            database,
            "knowledge_space_id",
          )} = ${p(database, 2)} AND ${q(database, "kind")} = ${p(
            database,
            3,
          )} AND ${q(database, "revision")} = ${p(database, 4)} LIMIT 1 FOR UPDATE;`,
          tableName: revisionTable,
        });
        if (revisionConflict.rows.length > 0) {
          return {
            activated: false,
            job: await transitionBackfillFailure(database, transaction, current, {
              ...fence,
              errorCode: "PROFILE_REVISION_ALREADY_EXISTS",
              errorMessage:
                "A profile revision exists without the expected head; legacy data was not activated",
            }),
          };
        }

        const revisionId = nonzeroUuid(generateRevisionId(), "revisionId");
        const headId = nonzeroUuid(generateHeadId(), "headId");
        await insertActiveRevision(database, transaction, normalized, {
          id: revisionId,
          now: fence.now,
        });
        await transaction.execute({
          maxRows: 0,
          operation: "insert",
          params: [
            headId,
            current.tenantId,
            current.knowledgeSpaceId,
            current.kind,
            revisionId,
            normalized.snapshot.revision,
            1,
            fence.now,
            fence.now,
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
        const job = await transitionBackfillSuccess(database, transaction, current, fence.now);
        return { activated: true, job, profileRevisionId: revisionId };
      });
    },

    release: async (rawFence) => {
      const fence = normalizeFence(rawFence);
      return database.transaction(async (transaction) => {
        const current = await requireFencedBackfill(database, transaction, fence);
        const updated = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [
            fence.now,
            current.rowVersion + 1,
            current.id,
            current.rowVersion,
            fence.leaseToken,
          ],
          sql: `UPDATE ${q(database, backfillTable)} SET ${q(
            database,
            "run_state",
          )} = 'queued', ${q(database, "worker_id")} = NULL, ${q(
            database,
            "lease_token",
          )} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(
            database,
            "heartbeat_at",
          )} = NULL, ${q(database, "updated_at")} = ${p(database, 1)}, ${q(
            database,
            "row_version",
          )} = ${p(database, 2)} WHERE ${q(database, "id")} = ${p(
            database,
            3,
          )} AND ${q(database, "row_version")} = ${p(database, 4)} AND ${q(
            database,
            "lease_token",
          )} = ${p(database, 5)};`,
          tableName: backfillTable,
        });
        if (updated.rowsAffected !== 1) return null;
        return getBackfillById(database, transaction, current.id, false);
      });
    },

    retry: async (rawInput) => {
      const input = { ...normalizeScope(rawInput), now: DateTimeSchema.parse(rawInput.now) };
      return database.transaction(async (transaction) => {
        const current = await getBackfillByScope(database, transaction, input, true);
        if (!current) return null;
        if (current.runState !== "failed") {
          throw new KnowledgeSpaceProfileBackfillTransitionError(
            "Only a failed profile backfill can be retried",
          );
        }
        const updated = await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [input.now, current.rowVersion + 1, current.id, current.rowVersion],
          sql: `UPDATE ${q(database, backfillTable)} SET ${q(
            database,
            "run_state",
          )} = 'queued', ${q(database, "execution_attempts")} = 0, ${q(
            database,
            "last_error_code",
          )} = NULL, ${q(database, "last_error_message")} = NULL, ${q(
            database,
            "completed_at",
          )} = NULL, ${q(database, "updated_at")} = ${p(database, 1)}, ${q(
            database,
            "row_version",
          )} = ${p(database, 2)} WHERE ${q(database, "id")} = ${p(
            database,
            3,
          )} AND ${q(database, "row_version")} = ${p(database, 4)};`,
          tableName: backfillTable,
        });
        if (updated.rowsAffected !== 1) {
          throw new KnowledgeSpaceProfileBackfillTransitionError(
            "Profile backfill changed before retry",
          );
        }
        return getBackfillById(database, transaction, current.id, false);
      });
    },
  };
}

interface NormalizedLegacyProfile {
  readonly capabilitySnapshot: Readonly<Record<string, unknown>>;
  readonly dimension?: number | undefined;
  readonly kind: KnowledgeSpaceProfileKind;
  readonly knowledgeSpaceId: string;
  readonly model: string;
  readonly pluginId: string;
  readonly provider: string;
  readonly snapshot: KnowledgeSpaceProfileSnapshot;
  readonly tenantId: string;
  readonly vectorSpaceId?: string | undefined;
}

async function normalizeLegacyProfile(
  kind: KnowledgeSpaceProfileKind,
  source: Readonly<Record<string, unknown>>,
  job: KnowledgeSpaceProfileBackfill,
  rawCapabilitySnapshot: Readonly<Record<string, unknown>>,
): Promise<NormalizedLegacyProfile> {
  if (kind === "embedding") {
    const snapshot = KnowledgeSpaceEmbeddingProfileSchema.parse(source);
    const capability = ModelCapabilitySnapshotSchema.parse(rawCapabilitySnapshot);
    if (
      capability.kind !== "embedding" ||
      capability.dimension === undefined ||
      !capability.distanceMetric ||
      !sameModelSelection(capability, snapshot)
    ) {
      throw new Error("Legacy embedding capability does not match the frozen profile selection");
    }
    const selection = {
      model: snapshot.model,
      pluginId: snapshot.pluginId,
      provider: snapshot.provider,
    };
    const [legacyVectorSpaceId, capabilityBoundVectorSpaceId] = await Promise.all([
      buildKnowledgeSpaceVectorSpaceId(selection, snapshot.revision),
      buildKnowledgeSpaceVectorSpaceId(selection, snapshot.revision, {
        capabilityDigest: capability.capabilityDigest,
        dimension: capability.dimension,
        distanceMetric: capability.distanceMetric,
        pluginUniqueIdentifier: capability.pluginUniqueIdentifier,
        schemaFingerprint: capability.schemaFingerprint,
      }),
    ]);
    if (
      snapshot.vectorSpaceId !== legacyVectorSpaceId &&
      snapshot.vectorSpaceId !== capabilityBoundVectorSpaceId
    ) {
      throw new Error(
        "Legacy embedding vector-space identity is not proven by the installed model capability",
      );
    }
    if (snapshot.dimension !== undefined && snapshot.dimension !== capability.dimension) {
      throw new Error("Legacy embedding dimension conflicts with the observed model dimension");
    }
    const verifiedSnapshot = KnowledgeSpaceEmbeddingProfileSchema.parse({
      ...snapshot,
      dimension: capability.dimension,
    });
    return {
      capabilitySnapshot: capability,
      dimension: capability.dimension,
      kind,
      knowledgeSpaceId: job.knowledgeSpaceId,
      model: snapshot.model,
      pluginId: snapshot.pluginId,
      provider: snapshot.provider,
      snapshot: verifiedSnapshot,
      tenantId: job.tenantId,
      vectorSpaceId: snapshot.vectorSpaceId,
    };
  }
  const snapshot = KnowledgeSpaceRetrievalProfileSchema.parse(source);
  const capability = normalizeRetrievalCapability(rawCapabilitySnapshot, snapshot);
  return {
    capabilitySnapshot: capability,
    kind,
    knowledgeSpaceId: job.knowledgeSpaceId,
    model: snapshot.reasoningModel.model,
    pluginId: snapshot.reasoningModel.pluginId,
    provider: snapshot.reasoningModel.provider,
    snapshot,
    tenantId: job.tenantId,
  };
}

function normalizeRetrievalCapability(
  raw: Readonly<Record<string, unknown>>,
  profile: ReturnType<typeof KnowledgeSpaceRetrievalProfileSchema.parse>,
): Readonly<Record<string, unknown>> {
  if (raw.verification !== "verified") {
    throw new Error("Legacy retrieval capability snapshot was not verified");
  }
  const reasoning = ModelCapabilitySnapshotSchema.parse(raw.reasoning);
  if (reasoning.kind !== "reasoning" || !sameModelSelection(reasoning, profile.reasoningModel)) {
    throw new Error("Legacy reasoning capability does not match the frozen retrieval profile");
  }
  let rerank: ModelCapabilitySnapshot | null = null;
  if (profile.rerank.enabled) {
    if (!profile.rerank.model) {
      throw new Error("Legacy rerank profile is enabled without a model selection");
    }
    rerank = ModelCapabilitySnapshotSchema.parse(raw.rerank);
    if (rerank.kind !== "rerank" || !sameModelSelection(rerank, profile.rerank.model)) {
      throw new Error("Legacy rerank capability does not match the frozen retrieval profile");
    }
  } else if (raw.rerank != null) {
    throw new Error("Disabled legacy rerank profile contains a capability snapshot");
  }
  return { reasoning, rerank, verification: "verified" };
}

function sameModelSelection(
  capability: ModelCapabilitySnapshot,
  selection: { readonly model: string; readonly pluginId: string; readonly provider: string },
): boolean {
  return (
    capability.selection.model === selection.model &&
    capability.selection.pluginId === selection.pluginId &&
    capability.selection.provider === selection.provider
  );
}

async function insertActiveRevision(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  profile: NormalizedLegacyProfile,
  input: { readonly id: string; readonly now: string },
): Promise<void> {
  const capabilitySnapshot = profile.capabilitySnapshot;
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
  const values: readonly DatabaseQueryValue[] = [
    input.id,
    profile.tenantId,
    profile.knowledgeSpaceId,
    profile.kind,
    profile.snapshot.revision,
    "active",
    JSON.stringify(profile.snapshot),
    knowledgeSpaceProfileSnapshotDigest(profile.snapshot),
    JSON.stringify(capabilitySnapshot),
    knowledgeSpaceProfileSnapshotDigest(capabilitySnapshot),
    profile.pluginId,
    profile.provider,
    profile.model,
    profile.vectorSpaceId ?? null,
    profile.dimension ?? null,
    systemActor,
    null,
    null,
    input.now,
    input.now,
    input.now,
    null,
    null,
  ];
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

async function insertBackfillIfMissing(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly id: string;
    readonly kind: KnowledgeSpaceProfileKind;
    readonly knowledgeSpaceId: string;
    readonly maxExecutionAttempts: number;
    readonly now: string;
    readonly sourceManifestVersion: number;
    readonly sourceSnapshot: Readonly<Record<string, unknown>>;
    readonly tenantId: string;
  },
): Promise<boolean> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "kind",
    "source_manifest_version",
    "source_snapshot",
    "source_snapshot_digest",
    "run_state",
    "execution_attempts",
    "max_execution_attempts",
    "worker_id",
    "lease_token",
    "lease_expires_at",
    "heartbeat_at",
    "row_version",
    "last_error_code",
    "last_error_message",
    "created_at",
    "updated_at",
    "completed_at",
  ] as const;
  const values: readonly DatabaseQueryValue[] = [
    input.id,
    input.tenantId,
    input.knowledgeSpaceId,
    input.kind,
    input.sourceManifestVersion,
    JSON.stringify(input.sourceSnapshot),
    knowledgeSpaceProfileSnapshotDigest(input.sourceSnapshot),
    "queued",
    0,
    input.maxExecutionAttempts,
    null,
    null,
    null,
    null,
    1,
    null,
    null,
    input.now,
    input.now,
    null,
  ];
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: values,
    sql: `${database.dialect === "tidb" ? "INSERT IGNORE" : "INSERT"} INTO ${q(
      database,
      backfillTable,
    )} (${columns.map((column) => q(database, column)).join(", ")}) VALUES (${columns
      .map((column, index) =>
        column === "source_snapshot"
          ? jsonPlaceholder(database, index + 1)
          : p(database, index + 1),
      )
      .join(", ")})${
      database.dialect === "postgres"
        ? ` ON CONFLICT (${q(database, "tenant_id")}, ${q(
            database,
            "knowledge_space_id",
          )}, ${q(database, "kind")}, ${q(database, "source_manifest_version")}, ${q(
            database,
            "source_snapshot_digest",
          )}) DO NOTHING`
        : ""
    };`,
    tableName: backfillTable,
  });
  return result.rowsAffected > 0;
}

async function transitionBackfillSuccess(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  current: KnowledgeSpaceProfileBackfill,
  now: string,
): Promise<KnowledgeSpaceProfileBackfill> {
  const updated = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [
      now,
      current.rowVersion + 1,
      current.id,
      current.rowVersion,
      current.leaseToken ?? null,
    ],
    sql: `UPDATE ${q(database, backfillTable)} SET ${q(
      database,
      "run_state",
    )} = 'succeeded', ${q(database, "worker_id")} = NULL, ${q(
      database,
      "lease_token",
    )} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(
      database,
      "heartbeat_at",
    )} = NULL, ${q(database, "completed_at")} = ${p(database, 1)}, ${q(
      database,
      "updated_at",
    )} = ${p(database, 1)}, ${q(database, "row_version")} = ${p(
      database,
      2,
    )} WHERE ${q(database, "id")} = ${p(database, 3)} AND ${q(
      database,
      "row_version",
    )} = ${p(database, 4)} AND ${q(database, "lease_token")} = ${p(database, 5)};`,
    tableName: backfillTable,
  });
  if (updated.rowsAffected !== 1) {
    throw new KnowledgeSpaceProfileBackfillTransitionError(
      "Profile backfill lost its lease while completing",
    );
  }
  const result = await getBackfillById(database, executor, current.id, false);
  if (!result) throw new Error("Completed profile backfill could not be reloaded");
  return result;
}

async function transitionBackfillFailure(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  current: KnowledgeSpaceProfileBackfill,
  input: KnowledgeSpaceProfileBackfillFence & {
    readonly errorCode: string;
    readonly errorMessage: string;
  },
): Promise<KnowledgeSpaceProfileBackfill> {
  const errorCode = requiredText(input.errorCode, "errorCode", 64);
  const errorMessage = requiredText(input.errorMessage, "errorMessage", 16_384);
  const updated = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [
      errorCode,
      errorMessage,
      input.now,
      current.rowVersion + 1,
      current.id,
      current.rowVersion,
      input.leaseToken,
    ],
    sql: `UPDATE ${q(database, backfillTable)} SET ${q(
      database,
      "run_state",
    )} = 'failed', ${q(database, "last_error_code")} = ${p(database, 1)}, ${q(
      database,
      "last_error_message",
    )} = ${p(database, 2)}, ${q(database, "worker_id")} = NULL, ${q(
      database,
      "lease_token",
    )} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(
      database,
      "heartbeat_at",
    )} = NULL, ${q(database, "completed_at")} = ${p(database, 3)}, ${q(
      database,
      "updated_at",
    )} = ${p(database, 3)}, ${q(database, "row_version")} = ${p(
      database,
      4,
    )} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(
      database,
      "row_version",
    )} = ${p(database, 6)} AND ${q(database, "lease_token")} = ${p(database, 7)};`,
    tableName: backfillTable,
  });
  if (updated.rowsAffected !== 1) {
    throw new KnowledgeSpaceProfileBackfillTransitionError(
      "Profile backfill lost its lease while recording failure",
    );
  }
  const result = await getBackfillById(database, executor, current.id, false);
  if (!result) throw new Error("Failed profile backfill could not be reloaded");
  return result;
}

async function requireFencedBackfill(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  fence: KnowledgeSpaceProfileBackfillFence,
): Promise<KnowledgeSpaceProfileBackfill> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [fence.jobId, fence.expectedRowVersion, fence.leaseToken, fence.now],
    sql: `SELECT * FROM ${q(database, backfillTable)} WHERE ${q(
      database,
      "id",
    )} = ${p(database, 1)} AND ${q(database, "row_version")} = ${p(
      database,
      2,
    )} AND ${q(database, "lease_token")} = ${p(database, 3)} AND ${q(
      database,
      "run_state",
    )} = 'running' AND ${q(database, "lease_expires_at")} > ${p(database, 4)} FOR UPDATE;`,
    tableName: backfillTable,
  });
  if (!result.rows[0]) {
    throw new KnowledgeSpaceProfileBackfillTransitionError(
      "Profile backfill worker lost its lease or row-version fence",
    );
  }
  return mapBackfill(result.rows[0]);
}

async function loadManifestForUpdate(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfileScope,
): Promise<DatabaseRow | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId],
    sql: `SELECT ${q(database, "manifest_version")}, ${q(
      database,
      "metadata",
    )} FROM ${q(database, manifestTable)} WHERE ${q(database, "tenant_id")} = ${p(
      database,
      1,
    )} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} FOR UPDATE;`,
    tableName: manifestTable,
  });
  return result.rows[0] ?? null;
}

async function loadHeadForUpdate(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfileScope,
): Promise<DatabaseRow | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.kind],
    sql: `SELECT head.${q(database, "profile_revision_id")}, head.${q(
      database,
      "active_revision",
    )}, revision.${q(database, "snapshot_digest")}, revision.${q(
      database,
      "capability_snapshot_digest",
    )}, revision.${q(database, "state")} FROM ${q(database, headTable)} head JOIN ${q(
      database,
      revisionTable,
    )} revision ON revision.${q(database, "id")} = head.${q(
      database,
      "profile_revision_id",
    )} WHERE head.${q(database, "tenant_id")} = ${p(database, 1)} AND head.${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 2)} AND head.${q(database, "kind")} = ${p(database, 3)} FOR UPDATE;`,
    tableName: headTable,
  });
  return result.rows[0] ?? null;
}

async function getBackfillByScope(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: KnowledgeSpaceProfileScope,
  forUpdate: boolean,
): Promise<KnowledgeSpaceProfileBackfill | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, scope.kind],
    sql: `SELECT * FROM ${q(database, backfillTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "kind")} = ${p(database, 3)} ORDER BY ${q(
      database,
      "source_manifest_version",
    )} DESC, ${q(database, "created_at")} DESC, ${q(
      database,
      "id",
    )} DESC LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: backfillTable,
  });
  return result.rows[0] ? mapBackfill(result.rows[0]) : null;
}

async function getBackfillById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
  forUpdate: boolean,
): Promise<KnowledgeSpaceProfileBackfill | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [id],
    sql: `SELECT * FROM ${q(database, backfillTable)} WHERE ${q(
      database,
      "id",
    )} = ${p(database, 1)}${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: backfillTable,
  });
  return result.rows[0] ? mapBackfill(result.rows[0]) : null;
}

function mapBackfill(row: DatabaseRow): KnowledgeSpaceProfileBackfill {
  const sourceSnapshot = jsonObjectColumn(row, "source_snapshot");
  const sourceSnapshotDigest = digest(stringColumn(row, "source_snapshot_digest"));
  if (knowledgeSpaceProfileSnapshotDigest(sourceSnapshot) !== sourceSnapshotDigest) {
    throw new Error("Knowledge-space profile backfill source snapshot digest mismatch");
  }
  const stateText = stringColumn(row, "run_state");
  if (
    !KnowledgeSpaceProfileBackfillRunStates.includes(
      stateText as KnowledgeSpaceProfileBackfillRunState,
    )
  ) {
    throw new Error(`Invalid knowledge-space profile backfill runState=${stateText}`);
  }
  const completedAt = optionalStringColumn(row, "completed_at");
  const heartbeatAt = optionalStringColumn(row, "heartbeat_at");
  const lastErrorCode = optionalStringColumn(row, "last_error_code");
  const lastErrorMessage = optionalStringColumn(row, "last_error_message");
  const leaseExpiresAt = optionalStringColumn(row, "lease_expires_at");
  const leaseToken = optionalStringColumn(row, "lease_token");
  const workerId = optionalStringColumn(row, "worker_id");
  return {
    ...(completedAt ? { completedAt } : {}),
    createdAt: stringColumn(row, "created_at"),
    executionAttempts: nonnegativeInteger(
      numberColumn(row, "execution_attempts"),
      "executionAttempts",
    ),
    ...(heartbeatAt ? { heartbeatAt } : {}),
    id: nonzeroUuid(stringColumn(row, "id"), "id"),
    kind: profileKind(stringColumn(row, "kind")),
    knowledgeSpaceId: UuidSchema.parse(stringColumn(row, "knowledge_space_id")),
    ...(lastErrorCode ? { lastErrorCode } : {}),
    ...(lastErrorMessage ? { lastErrorMessage } : {}),
    ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
    ...(leaseToken ? { leaseToken: nonzeroUuid(leaseToken, "leaseToken") } : {}),
    maxExecutionAttempts: positiveInteger(
      numberColumn(row, "max_execution_attempts"),
      "maxExecutionAttempts",
    ),
    rowVersion: positiveInteger(numberColumn(row, "row_version"), "rowVersion"),
    runState: stateText as KnowledgeSpaceProfileBackfillRunState,
    sourceManifestVersion: positiveInteger(
      numberColumn(row, "source_manifest_version"),
      "sourceManifestVersion",
    ),
    sourceSnapshot,
    sourceSnapshotDigest,
    tenantId: TenantIdSchema.parse(stringColumn(row, "tenant_id")),
    updatedAt: stringColumn(row, "updated_at"),
    ...(workerId ? { workerId } : {}),
  };
}

function normalizeScope(input: KnowledgeSpaceProfileScope): KnowledgeSpaceProfileScope {
  return {
    kind: profileKind(input.kind),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function normalizeDiscovery(
  input: DiscoverKnowledgeSpaceProfileBackfillsInput,
  maxLimit: number,
): DiscoverKnowledgeSpaceProfileBackfillsInput {
  const limit = boundedLimit(input.limit, maxLimit, "discovery limit");
  return {
    ...(input.afterKnowledgeSpaceId
      ? { afterKnowledgeSpaceId: UuidSchema.parse(input.afterKnowledgeSpaceId) }
      : {}),
    limit,
    now: DateTimeSchema.parse(input.now),
  };
}

function normalizeClaim(
  input: ClaimKnowledgeSpaceProfileBackfillsInput,
  maxLimit: number,
): ClaimKnowledgeSpaceProfileBackfillsInput {
  const now = DateTimeSchema.parse(input.now);
  const leaseExpiresAt = DateTimeSchema.parse(input.leaseExpiresAt);
  if (Date.parse(leaseExpiresAt) <= Date.parse(now)) {
    throw new Error("Knowledge-space profile backfill leaseExpiresAt must be after now");
  }
  return {
    leaseExpiresAt,
    limit: boundedLimit(input.limit, maxLimit, "claim limit"),
    now,
    workerId: requiredText(input.workerId, "workerId", 255),
  };
}

function normalizeFence(
  input: KnowledgeSpaceProfileBackfillFence,
): KnowledgeSpaceProfileBackfillFence {
  return {
    expectedRowVersion: positiveInteger(input.expectedRowVersion, "expectedRowVersion"),
    jobId: nonzeroUuid(input.jobId, "jobId"),
    leaseToken: nonzeroUuid(input.leaseToken, "leaseToken"),
    now: DateTimeSchema.parse(input.now),
  };
}

function normalizeFailure(
  input: KnowledgeSpaceProfileBackfillFence & {
    readonly errorCode: string;
    readonly errorMessage: string;
  },
) {
  return {
    ...normalizeFence(input),
    errorCode: requiredText(input.errorCode, "errorCode", 64),
    errorMessage: requiredText(input.errorMessage, "errorMessage", 16_384),
  };
}

function normalizeHeartbeat(
  input: KnowledgeSpaceProfileBackfillFence & {
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  },
) {
  const fence = normalizeFence(input);
  const leaseExpiresAt = DateTimeSchema.parse(input.leaseExpiresAt);
  if (Date.parse(leaseExpiresAt) <= Date.parse(fence.now)) {
    throw new Error("Knowledge-space profile backfill leaseExpiresAt must be after now");
  }
  return {
    ...fence,
    leaseExpiresAt,
    workerId: requiredText(input.workerId, "workerId", 255),
  };
}

function profileKind(value: string): KnowledgeSpaceProfileKind {
  if (!KnowledgeSpaceProfileKinds.includes(value as KnowledgeSpaceProfileKind)) {
    throw new Error(`Invalid knowledge-space profile kind=${value}`);
  }
  return value as KnowledgeSpaceProfileKind;
}

function digest(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Knowledge-space profile backfill digest must be SHA-256 hex");
  }
  return value;
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedLimit(value: number, max: number, name: string): number {
  const normalized = positiveInteger(value, name);
  if (normalized > max) {
    throw new Error(`Knowledge-space profile backfill ${name} exceeds maximum=${max}`);
  }
  return normalized;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Knowledge-space profile backfill ${name} must be a positive safe integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Knowledge-space profile backfill ${name} must be a non-negative safe integer`);
  }
  return value;
}

function requiredText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`Knowledge-space profile backfill ${name} must contain 1-${max} characters`);
  }
  return normalized;
}

function nonzeroUuid(value: string, name: string): string {
  const id = UuidSchema.parse(value);
  if (id === "00000000-0000-0000-0000-000000000000") {
    throw new Error(`Knowledge-space profile backfill ${name} must not be the zero UUID`);
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
