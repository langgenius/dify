import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  ProjectionSetFingerprintSchema,
  TenantIdSchema,
  UuidSchema,
} from "@knowledge/core";

import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import { PageIndexTokenizerVersion } from "./page-index-scoring";

export const LegacySpacePublicationBootstrapCheckpoints = [
  "pending_snapshot",
  "snapshot_captured",
  "rebuilding",
  "verifying",
  "published",
] as const;
export type LegacySpacePublicationBootstrapCheckpoint =
  (typeof LegacySpacePublicationBootstrapCheckpoints)[number];

export const LegacySpacePublicationBootstrapRunStates = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type LegacySpacePublicationBootstrapRunState =
  (typeof LegacySpacePublicationBootstrapRunStates)[number];

export const LegacySpacePublicationBootstrapItemStatuses = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const;
export type LegacySpacePublicationBootstrapItemStatus =
  (typeof LegacySpacePublicationBootstrapItemStatuses)[number];

export interface LegacySpacePublicationBootstrap {
  readonly checkpoint: LegacySpacePublicationBootstrapCheckpoint;
  readonly completedAt?: string | undefined;
  readonly completedDocuments: number;
  readonly createdAt: string;
  readonly heartbeatAt?: string | undefined;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly publishedFingerprint?: string | undefined;
  readonly publishedHeadRevision?: number | undefined;
  readonly publishedPublicationId?: string | undefined;
  readonly rowVersion: number;
  readonly runState: LegacySpacePublicationBootstrapRunState;
  readonly snapshotMetadata: Readonly<Record<string, unknown>>;
  readonly tenantId: string;
  readonly totalDocuments: number;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
}

export interface LegacySpacePublicationBootstrapItem {
  readonly bootstrapId: string;
  readonly compilationAttemptId?: string | undefined;
  readonly createdAt: string;
  readonly documentAssetId: string;
  readonly documentSha256: string;
  readonly documentVersion: number;
  readonly lastError?: string | undefined;
  readonly ordinal: number;
  readonly status: LegacySpacePublicationBootstrapItemStatus;
  readonly updatedAt: string;
}

export interface StartLegacySpacePublicationBootstrapInput {
  readonly createdAt: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface StartLegacySpacePublicationBootstrapResult {
  readonly created: boolean;
  readonly job: LegacySpacePublicationBootstrap;
}

export interface ClaimLegacySpacePublicationBootstrapsInput {
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly limit: number;
  readonly now: string;
  readonly workerId: string;
}

export interface LegacySpacePublicationBootstrapFence {
  readonly expectedRowVersion: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly now: string;
}

export interface HeartbeatLegacySpacePublicationBootstrapInput
  extends LegacySpacePublicationBootstrapFence {
  readonly leaseExpiresAt: string;
  readonly workerId: string;
}

export interface BindLegacySpacePublicationBootstrapAttemptInput
  extends LegacySpacePublicationBootstrapFence {
  readonly compilationAttemptId: string;
  readonly documentAssetId: string;
}

export interface MarkLegacySpacePublicationBootstrapItemSucceededInput
  extends BindLegacySpacePublicationBootstrapAttemptInput {}

export interface FailLegacySpacePublicationBootstrapInput
  extends LegacySpacePublicationBootstrapFence {
  readonly compilationAttemptId?: string | undefined;
  readonly documentAssetId?: string | undefined;
  readonly errorCode: string;
  readonly errorMessage: string;
}

export interface RetryLegacySpacePublicationBootstrapInput {
  readonly expectedRowVersion: number;
  readonly jobId: string;
  readonly now: string;
}

export interface LegacySpacePublicationBootstrapLookupInput {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export type KnowledgeSpaceDocumentMutationOperation =
  | "bulk-delete"
  | "bulk-reindex"
  | "bulk-upload"
  | "knowledge-fs-write"
  | "page-index-upgrade"
  | "source-delete"
  | "source-materialize"
  | "upload";

export interface KnowledgeSpaceDocumentMutationLease {
  readonly acquiredAt: string;
  readonly expiresAt: string;
  readonly heartbeatAt: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly leaseToken: string;
  readonly operation: KnowledgeSpaceDocumentMutationOperation;
  readonly tenantId: string;
}

export interface LegacySpacePublicationBootstrapCompilationAdmissionInput
  extends LegacySpacePublicationBootstrapLookupInput {
  readonly bootstrapJobId?: string | undefined;
}

export interface LegacySpacePublicationBootstrapRepository {
  acquireDocumentMutationLease(
    input: LegacySpacePublicationBootstrapLookupInput & {
      readonly acquiredAt: string;
      readonly operation: KnowledgeSpaceDocumentMutationOperation;
    },
  ): Promise<KnowledgeSpaceDocumentMutationLease>;
  assertCompilationAdmission(
    input: LegacySpacePublicationBootstrapCompilationAdmissionInput,
  ): Promise<void>;
  beginVerification(
    input: LegacySpacePublicationBootstrapFence,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  captureSnapshot(
    input: LegacySpacePublicationBootstrapFence,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  assertDocumentMutationAdmission(input: LegacySpacePublicationBootstrapLookupInput): Promise<void>;
  bindAttempt(
    input: BindLegacySpacePublicationBootstrapAttemptInput,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  claim(
    input: ClaimLegacySpacePublicationBootstrapsInput,
  ): Promise<readonly LegacySpacePublicationBootstrap[]>;
  complete(
    input: LegacySpacePublicationBootstrapFence,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  fail(
    input: FailLegacySpacePublicationBootstrapInput,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  get(
    input: LegacySpacePublicationBootstrapLookupInput,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  getById(id: string): Promise<LegacySpacePublicationBootstrap | null>;
  getNextItem(
    input: LegacySpacePublicationBootstrapFence,
  ): Promise<LegacySpacePublicationBootstrapItem | null>;
  heartbeat(
    input: HeartbeatLegacySpacePublicationBootstrapInput,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  heartbeatDocumentMutationLease(
    lease: KnowledgeSpaceDocumentMutationLease,
    heartbeatAt: string,
  ): Promise<KnowledgeSpaceDocumentMutationLease>;
  isQueryReady(input: LegacySpacePublicationBootstrapLookupInput): Promise<boolean>;
  markItemSucceeded(
    input: MarkLegacySpacePublicationBootstrapItemSucceededInput,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  release(
    input: LegacySpacePublicationBootstrapFence,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  releaseDocumentMutationLease(lease: KnowledgeSpaceDocumentMutationLease): Promise<void>;
  retry(
    input: RetryLegacySpacePublicationBootstrapInput,
  ): Promise<LegacySpacePublicationBootstrap | null>;
  start(
    input: StartLegacySpacePublicationBootstrapInput,
  ): Promise<StartLegacySpacePublicationBootstrapResult>;
}

export interface DatabaseLegacySpacePublicationBootstrapRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly maxClaimBatchSize: number;
  readonly maxDocuments: number;
  readonly maxInsertBatchSize: number;
}

export async function withKnowledgeSpaceDocumentMutationLease<T>(input: {
  readonly acquiredAt: string;
  readonly knowledgeSpaceId: string;
  readonly mutate: () => Promise<T>;
  readonly operation: KnowledgeSpaceDocumentMutationOperation;
  readonly repository?:
    | (Pick<
        LegacySpacePublicationBootstrapRepository,
        "acquireDocumentMutationLease" | "releaseDocumentMutationLease"
      > &
        Partial<Pick<LegacySpacePublicationBootstrapRepository, "heartbeatDocumentMutationLease">>)
    | undefined;
  readonly tenantId: string;
}): Promise<T> {
  if (!input.repository) {
    return input.mutate();
  }
  let lease = await input.repository.acquireDocumentMutationLease({
    acquiredAt: input.acquiredAt,
    knowledgeSpaceId: input.knowledgeSpaceId,
    operation: input.operation,
    tenantId: input.tenantId,
  });
  let heartbeatError: unknown;
  let heartbeatInFlight: Promise<void> | undefined;
  const ttlMs = Date.parse(lease.expiresAt) - Date.parse(lease.heartbeatAt);
  const heartbeatIntervalMs = Math.max(1_000, Math.floor(ttlMs / 3));
  const heartbeat = input.repository.heartbeatDocumentMutationLease?.bind(input.repository);
  const timer = heartbeat
    ? setInterval(() => {
        if (heartbeatInFlight) return;
        heartbeatInFlight = heartbeat(lease, new Date().toISOString())
          .then((updated) => {
            lease = updated;
          })
          .catch((error) => {
            heartbeatError = error;
          })
          .finally(() => {
            heartbeatInFlight = undefined;
          });
      }, heartbeatIntervalMs)
    : undefined;
  timer?.unref?.();
  try {
    const result = await input.mutate();
    await heartbeatInFlight;
    if (heartbeatError) throw heartbeatError;
    return result;
  } finally {
    if (timer) clearInterval(timer);
    await heartbeatInFlight?.catch(() => undefined);
    await input.repository.releaseDocumentMutationLease(lease);
  }
}

export class LegacySpacePublicationBootstrapAlreadyPublishedError extends Error {
  constructor() {
    super("Legacy publication bootstrap is not allowed after a publication head exists");
    this.name = "LegacySpacePublicationBootstrapAlreadyPublishedError";
  }
}

export class LegacySpacePublicationBootstrapActiveCompilationError extends Error {
  constructor() {
    super("Legacy publication bootstrap requires all document compilation attempts to be idle");
    this.name = "LegacySpacePublicationBootstrapActiveCompilationError";
  }
}

export class KnowledgeSpaceDocumentMutationLeaseActiveError extends Error {
  constructor() {
    super("Knowledge space already has an active document mutation lease");
    this.name = "KnowledgeSpaceDocumentMutationLeaseActiveError";
  }
}

export class KnowledgeSpaceDocumentMutationDeletionActiveError extends Error {
  constructor() {
    super("Knowledge space has an active durable deletion");
    this.name = "KnowledgeSpaceDocumentMutationDeletionActiveError";
  }
}

export class LegacySpacePublicationBootstrapCapacityExceededError extends Error {
  readonly maxDocuments: number;

  constructor(maxDocuments: number) {
    super(`Legacy publication bootstrap maxDocuments=${maxDocuments} exceeded`);
    this.name = "LegacySpacePublicationBootstrapCapacityExceededError";
    this.maxDocuments = maxDocuments;
  }
}

export class LegacySpacePublicationBootstrapAdmissionError extends Error {
  readonly bootstrapJobId: string;

  constructor(bootstrapJobId: string) {
    super(`Document compilation is fenced by legacy publication bootstrap ${bootstrapJobId}`);
    this.name = "LegacySpacePublicationBootstrapAdmissionError";
    this.bootstrapJobId = bootstrapJobId;
  }
}

export class LegacySpacePublicationBootstrapSnapshotConflictError extends Error {
  constructor(message = "Legacy publication bootstrap document snapshot changed") {
    super(message);
    this.name = "LegacySpacePublicationBootstrapSnapshotConflictError";
  }
}

export class LegacySpacePublicationBootstrapVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacySpacePublicationBootstrapVerificationError";
  }
}

export class LegacySpacePublicationBootstrapTransitionError extends Error {}

const bootstrapTableName = "legacy_space_publication_bootstraps";
const itemTableName = "legacy_space_publication_bootstrap_items";
const spaceTableName = "knowledge_spaces";
const assetTableName = "document_assets";
const attemptTableName = "document_compilation_attempts";
const headTableName = "projection_set_publication_heads";
const publicationTableName = "projection_set_publications";
const memberTableName = "projection_set_publication_members";
const mutationLeaseTableName = "knowledge_space_mutation_leases";
const documentMutationLeaseTtlMs = 5 * 60_000;

export function createDatabaseLegacySpacePublicationBootstrapRepository({
  database,
  maxClaimBatchSize,
  maxDocuments,
  maxInsertBatchSize,
}: DatabaseLegacySpacePublicationBootstrapRepositoryOptions): LegacySpacePublicationBootstrapRepository {
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");
  positiveInteger(maxDocuments, "maxDocuments");
  positiveInteger(maxInsertBatchSize, "maxInsertBatchSize");

  return {
    acquireDocumentMutationLease: async (rawInput) => {
      const input = {
        acquiredAt: canonicalDateTime(rawInput.acquiredAt, "acquiredAt"),
        knowledgeSpaceId: UuidSchema.parse(rawInput.knowledgeSpaceId),
        operation: documentMutationOperation(rawInput.operation),
        tenantId: tenantId(rawInput.tenantId),
      };
      return database.transaction(async (transaction) => {
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, input))) {
          throw new KnowledgeSpaceDocumentMutationDeletionActiveError();
        }
        const bootstrap = await databaseGetBootstrapByScope(database, transaction, input, true);
        if (
          (bootstrap && bootstrap.runState !== "succeeded") ||
          (!bootstrap && (await databaseHasLegacyNullGenerationState(database, transaction, input)))
        ) {
          throw new LegacySpacePublicationBootstrapAdmissionError(
            bootstrap?.id ?? input.knowledgeSpaceId,
          );
        }
        await transaction.execute({
          maxRows: 0,
          operation: "delete",
          params: [input.tenantId, input.knowledgeSpaceId],
          sql: `DELETE FROM ${q(database, mutationLeaseTableName)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND (${q(database, "expires_at")} IS NULL OR ${q(database, "expires_at")} <= CURRENT_TIMESTAMP);`,
          tableName: mutationLeaseTableName,
        });
        await requireNoActiveDocumentMutationLease(database, transaction, input);
        const id = randomUUID();
        const leaseToken = randomUUID();
        const ttlParameter =
          database.dialect === "postgres"
            ? documentMutationLeaseTtlMs
            : documentMutationLeaseTtlMs * 1_000;
        const timestamp =
          database.dialect === "postgres" ? "CURRENT_TIMESTAMP" : "CURRENT_TIMESTAMP(3)";
        const expiry =
          database.dialect === "postgres"
            ? `${timestamp} + (${p(database, 6)} * INTERVAL '1 millisecond')`
            : `DATE_ADD(${timestamp}, INTERVAL ${p(database, 6)} MICROSECOND)`;
        const inserted = await transaction.execute({
          maxRows: database.dialect === "postgres" ? 1 : 0,
          operation: "insert",
          params: [
            id,
            input.tenantId,
            input.knowledgeSpaceId,
            input.operation,
            leaseToken,
            ttlParameter,
          ],
          sql: `INSERT INTO ${q(database, mutationLeaseTableName)} (${[
            "id",
            "tenant_id",
            "knowledge_space_id",
            "operation",
            "acquired_at",
            "lease_token",
            "heartbeat_at",
            "expires_at",
          ]
            .map((column) => q(database, column))
            .join(
              ", ",
            )}) VALUES (${p(database, 1)}, ${p(database, 2)}, ${p(database, 3)}, ${p(database, 4)}, ${timestamp}, ${p(database, 5)}, ${timestamp}, ${expiry})${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName: mutationLeaseTableName,
        });
        if (inserted.rowsAffected !== 1) {
          throw new LegacySpacePublicationBootstrapTransitionError(
            "Knowledge space document mutation lease was not acquired",
          );
        }
        const row =
          inserted.rows[0] ??
          (await selectDocumentMutationLease(
            database,
            transaction,
            input.tenantId,
            input.knowledgeSpaceId,
            id,
            leaseToken,
          ));
        if (!row) {
          throw new LegacySpacePublicationBootstrapTransitionError(
            "Knowledge space document mutation lease was not readable after acquisition",
          );
        }
        return mapDocumentMutationLeaseRow(row);
      });
    },
    assertCompilationAdmission: async (input) => {
      const job = await databaseGetBootstrapByScope(database, database, input, false);
      if (!job) {
        if (await databaseHasLegacyNullGenerationState(database, database, input)) {
          throw new LegacySpacePublicationBootstrapAdmissionError(input.knowledgeSpaceId);
        }
        return;
      }
      if (job.runState === "succeeded") {
        return;
      }
      const requestedJobId = input.bootstrapJobId
        ? UuidSchema.parse(input.bootstrapJobId)
        : undefined;
      if (requestedJobId === job.id && (job.runState === "queued" || job.runState === "running")) {
        return;
      }
      throw new LegacySpacePublicationBootstrapAdmissionError(job.id);
    },
    assertDocumentMutationAdmission: async (input) => {
      const job = await databaseGetBootstrapByScope(database, database, input, false);
      if (job && job.runState !== "succeeded") {
        throw new LegacySpacePublicationBootstrapAdmissionError(job.id);
      }
      if (!job && (await databaseHasLegacyNullGenerationState(database, database, input))) {
        throw new LegacySpacePublicationBootstrapAdmissionError(input.knowledgeSpaceId);
      }
    },
    beginVerification: async (input) =>
      mutateFencedBootstrap(database, input, async (current, transaction) => {
        const incomplete = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [current.id],
          sql: `SELECT ${q(database, "document_asset_id")} FROM ${q(
            database,
            itemTableName,
          )} WHERE ${q(database, "bootstrap_id")} = ${p(database, 1)} AND ${q(
            database,
            "status",
          )} <> 'succeeded' LIMIT 1 FOR UPDATE;`,
          tableName: itemTableName,
        });
        if (incomplete.rows[0] || current.completedDocuments !== current.totalDocuments) {
          throw new LegacySpacePublicationBootstrapTransitionError(
            "Legacy publication bootstrap cannot verify before all documents succeed",
          );
        }
        return {
          ...current,
          checkpoint: "verifying",
          rowVersion: current.rowVersion + 1,
          updatedAt: canonicalDateTime(input.now, "now"),
        };
      }),
    bindAttempt: async (input) =>
      mutateFencedBootstrap(database, input, async (current, transaction) => {
        const item = await databaseGetBootstrapItem(
          database,
          transaction,
          current.id,
          input.documentAssetId,
          true,
        );
        if (!item) {
          throw new LegacySpacePublicationBootstrapSnapshotConflictError(
            "Bootstrap document item was not found",
          );
        }
        const attemptId = UuidSchema.parse(input.compilationAttemptId);
        if (item.status === "running" && item.compilationAttemptId === attemptId) {
          return current;
        }
        if (
          item.status !== "pending" ||
          (item.compilationAttemptId !== undefined && item.compilationAttemptId !== attemptId)
        ) {
          throw new LegacySpacePublicationBootstrapTransitionError(
            `Bootstrap item cannot bind from status=${item.status}`,
          );
        }
        await databasePersistBootstrapItem(database, transaction, {
          ...item,
          compilationAttemptId: attemptId,
          status: "running",
          updatedAt: canonicalDateTime(input.now, "now"),
        });
        return {
          ...current,
          checkpoint: "rebuilding",
          rowVersion: current.rowVersion + 1,
          updatedAt: canonicalDateTime(input.now, "now"),
        };
      }),
    captureSnapshot: async (input) =>
      mutateFencedBootstrap(
        database,
        input,
        async (current, transaction) => {
          if (current.checkpoint !== "pending_snapshot") {
            return current;
          }
          if (current.totalDocuments !== 0 || current.completedDocuments !== 0) {
            throw new LegacySpacePublicationBootstrapSnapshotConflictError(
              "Pending bootstrap marker already contains a partial document snapshot",
            );
          }
          await requireNoActiveDocumentMutationLease(database, transaction, current);
          const head = await transaction.execute({
            maxRows: 1,
            operation: "select",
            params: [current.tenantId, current.knowledgeSpaceId],
            sql: `SELECT ${q(database, "publication_id")} FROM ${q(
              database,
              headTableName,
            )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
              database,
              "knowledge_space_id",
            )} = ${p(database, 2)} LIMIT 1 FOR UPDATE;`,
            tableName: headTableName,
          });
          if (head.rows[0]) {
            throw new LegacySpacePublicationBootstrapAlreadyPublishedError();
          }
          const activeAttempt = await transaction.execute({
            maxRows: 1,
            operation: "select",
            params: [current.tenantId, current.knowledgeSpaceId],
            sql: `SELECT ${q(database, "id")} FROM ${q(
              database,
              attemptTableName,
            )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
              database,
              "knowledge_space_id",
            )} = ${p(database, 2)} AND ${q(database, "active_slot")} = 1 LIMIT 1 FOR UPDATE;`,
            tableName: attemptTableName,
          });
          if (activeAttempt.rows[0]) {
            throw new LegacySpacePublicationBootstrapActiveCompilationError();
          }
          const assets = await loadFrozenDocumentSnapshot(
            database,
            transaction,
            current.knowledgeSpaceId,
            maxDocuments,
          );
          const now = canonicalDateTime(input.now, "now");
          const items = assets.map((row, ordinal) =>
            parseBootstrapItem({
              bootstrapId: current.id,
              createdAt: now,
              documentAssetId: stringColumn(row, "id"),
              documentSha256: stringColumn(row, "sha256"),
              documentVersion: numberColumn(row, "version"),
              ordinal,
              status: "pending",
              updatedAt: now,
            }),
          );
          for (let offset = 0; offset < items.length; offset += maxInsertBatchSize) {
            await databaseInsertBootstrapItems(
              database,
              transaction,
              items.slice(offset, offset + maxInsertBatchSize),
            );
          }
          return {
            ...current,
            checkpoint: "snapshot_captured",
            rowVersion: current.rowVersion + 1,
            snapshotMetadata: {
              ...current.snapshotMetadata,
              capturedAt: now,
              directLegacyAdoption: false,
              documentCount: items.length,
              reason: "legacy graph ownership and immutable generation cannot be proven",
              schemaVersion: 1,
              strategy: "full-generation-rebuild",
            },
            totalDocuments: items.length,
            updatedAt: now,
          };
        },
        true,
      ),
    claim: async (input) => {
      validateClaimInput(input, maxClaimBatchSize);
      const now = canonicalDateTime(input.now, "now");
      const leaseExpiresAt = canonicalDateTime(input.leaseExpiresAt, "leaseExpiresAt");
      if (leaseExpiresAt <= now) {
        throw new Error("Legacy publication bootstrap leaseExpiresAt must be after now");
      }
      const leaseToken = nonzeroUuid(input.leaseToken, "leaseToken");
      const workerId = requiredString(input.workerId, "workerId", 255);
      return database.transaction(async (transaction) => {
        const selected = await transaction.execute({
          maxRows: input.limit,
          operation: "select",
          params: [now, input.limit],
          sql: `SELECT * FROM ${q(database, bootstrapTableName)} WHERE ${q(
            database,
            "run_state",
          )} = 'queued' OR (${q(database, "run_state")} = 'running' AND ${q(
            database,
            "lease_expires_at",
          )} <= ${p(database, 1)}) ORDER BY ${q(database, "updated_at")} ASC, ${q(
            database,
            "id",
          )} ASC LIMIT ${p(database, 2)} FOR UPDATE${
            database.dialect === "postgres" ? " SKIP LOCKED" : ""
          };`,
          tableName: bootstrapTableName,
        });
        const claimed: LegacySpacePublicationBootstrap[] = [];
        for (const row of selected.rows) {
          const current = mapBootstrapRow(row);
          const next = await databasePersistBootstrap(database, transaction, current, {
            ...current,
            heartbeatAt: now,
            leaseExpiresAt,
            leaseToken,
            rowVersion: current.rowVersion + 1,
            runState: "running",
            updatedAt: now,
            workerId,
          });
          claimed.push(next);
        }
        return claimed;
      });
    },
    complete: async (input) =>
      mutateFencedBootstrap(
        database,
        input,
        async (current, transaction) => {
          if (current.checkpoint !== "verifying") {
            throw new LegacySpacePublicationBootstrapTransitionError(
              `Legacy publication bootstrap cannot complete from checkpoint=${current.checkpoint}`,
            );
          }
          await verifyBootstrapSnapshot(database, transaction, current);
          const now = canonicalDateTime(input.now, "now");
          if (current.totalDocuments === 0) {
            if (await databaseHasLegacyNullGenerationState(database, transaction, current)) {
              throw new LegacySpacePublicationBootstrapVerificationError(
                "Legacy null-generation derived state remains after rebuilding an empty document snapshot",
              );
            }
            return {
              ...withoutLease(current),
              checkpoint: "published",
              completedAt: now,
              rowVersion: current.rowVersion + 1,
              runState: "succeeded",
              updatedAt: now,
            };
          }
          const head = await requireCompletePublishedHead(database, transaction, current);
          return {
            ...withoutLease(current),
            checkpoint: "published",
            completedAt: now,
            publishedFingerprint: head.fingerprint,
            publishedHeadRevision: head.headRevision,
            publishedPublicationId: head.publicationId,
            rowVersion: current.rowVersion + 1,
            runState: "succeeded",
            updatedAt: now,
          };
        },
        true,
      ),
    fail: async (input) =>
      database.transaction(async (transaction) => {
        const current = await requireFencedBootstrap(database, transaction, input);
        const now = canonicalDateTime(input.now, "now");
        if (input.documentAssetId) {
          const item = await databaseGetBootstrapItem(
            database,
            transaction,
            current.id,
            input.documentAssetId,
            true,
          );
          if (!item) {
            throw new LegacySpacePublicationBootstrapSnapshotConflictError();
          }
          if (
            input.compilationAttemptId &&
            item.compilationAttemptId !== UuidSchema.parse(input.compilationAttemptId)
          ) {
            throw new LegacySpacePublicationBootstrapTransitionError(
              "Bootstrap item compilation attempt changed before failure",
            );
          }
          await databasePersistBootstrapItem(database, transaction, {
            ...item,
            lastError: requiredString(input.errorMessage, "errorMessage"),
            status: "failed",
            updatedAt: now,
          });
        }
        return databasePersistBootstrap(database, transaction, current, {
          ...withoutLease(current),
          completedAt: now,
          lastErrorCode: requiredString(input.errorCode, "errorCode", 64),
          lastErrorMessage: requiredString(input.errorMessage, "errorMessage"),
          rowVersion: current.rowVersion + 1,
          runState: "failed",
          updatedAt: now,
        });
      }),
    get: async (input) => databaseGetBootstrapByScope(database, database, input, false),
    getById: async (id) => databaseGetBootstrapById(database, database, id, false),
    getNextItem: async (input) =>
      database.transaction(async (transaction) => {
        const current = await requireFencedBootstrap(database, transaction, input);
        const result = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [current.id],
          sql: `SELECT * FROM ${q(database, itemTableName)} WHERE ${q(
            database,
            "bootstrap_id",
          )} = ${p(database, 1)} AND ${q(database, "status")} <> 'succeeded' ORDER BY ${q(
            database,
            "ordinal",
          )} ASC, ${q(database, "document_asset_id")} ASC LIMIT 1 FOR UPDATE;`,
          tableName: itemTableName,
        });
        return result.rows[0] ? mapBootstrapItemRow(result.rows[0]) : null;
      }),
    heartbeat: async (input) =>
      mutateFencedBootstrap(database, input, async (current) => {
        if (current.workerId !== requiredString(input.workerId, "workerId", 255)) {
          return null;
        }
        const now = canonicalDateTime(input.now, "now");
        const leaseExpiresAt = canonicalDateTime(input.leaseExpiresAt, "leaseExpiresAt");
        if (leaseExpiresAt <= now) {
          throw new Error("Legacy publication bootstrap leaseExpiresAt must be after now");
        }
        return {
          ...current,
          heartbeatAt: now,
          leaseExpiresAt,
          rowVersion: current.rowVersion + 1,
          updatedAt: now,
        };
      }),
    isQueryReady: async (input) => {
      const job = await databaseGetBootstrapByScope(database, database, input, false);
      if (job) {
        return job.runState === "succeeded";
      }
      return !(await databaseHasLegacyNullGenerationState(database, database, input));
    },
    markItemSucceeded: async (input) =>
      mutateFencedBootstrap(database, input, async (current, transaction) => {
        const item = await databaseGetBootstrapItem(
          database,
          transaction,
          current.id,
          input.documentAssetId,
          true,
        );
        const attemptId = UuidSchema.parse(input.compilationAttemptId);
        if (!item || item.compilationAttemptId !== attemptId) {
          throw new LegacySpacePublicationBootstrapTransitionError(
            "Bootstrap item compilation attempt changed before completion",
          );
        }
        if (item.status === "succeeded") {
          return current;
        }
        if (item.status !== "running") {
          throw new LegacySpacePublicationBootstrapTransitionError(
            `Bootstrap item cannot complete from status=${item.status}`,
          );
        }
        const now = canonicalDateTime(input.now, "now");
        await databasePersistBootstrapItem(database, transaction, {
          ...item,
          lastError: undefined,
          status: "succeeded",
          updatedAt: now,
        });
        if (current.completedDocuments >= current.totalDocuments) {
          throw new LegacySpacePublicationBootstrapTransitionError(
            "Bootstrap completed document count would exceed its frozen snapshot",
          );
        }
        return {
          ...current,
          completedDocuments: current.completedDocuments + 1,
          rowVersion: current.rowVersion + 1,
          updatedAt: now,
        };
      }),
    release: async (input) =>
      mutateFencedBootstrap(database, input, async (current) => ({
        ...withoutLease(current),
        rowVersion: current.rowVersion + 1,
        runState: "queued",
        updatedAt: canonicalDateTime(input.now, "now"),
      })),
    heartbeatDocumentMutationLease: async (lease, rawHeartbeatAt) => {
      canonicalDateTime(rawHeartbeatAt, "heartbeatAt");
      return database.transaction(async (transaction) => {
        const ttlParameter =
          database.dialect === "postgres"
            ? documentMutationLeaseTtlMs
            : documentMutationLeaseTtlMs * 1_000;
        const timestamp =
          database.dialect === "postgres" ? "CURRENT_TIMESTAMP" : "CURRENT_TIMESTAMP(3)";
        const expiry =
          database.dialect === "postgres"
            ? `${timestamp} + (${p(database, 5)} * INTERVAL '1 millisecond')`
            : `DATE_ADD(${timestamp}, INTERVAL ${p(database, 5)} MICROSECOND)`;
        const result = await transaction.execute({
          maxRows: database.dialect === "postgres" ? 1 : 0,
          operation: "update",
          params: [
            UuidSchema.parse(lease.id),
            tenantId(lease.tenantId),
            UuidSchema.parse(lease.knowledgeSpaceId),
            UuidSchema.parse(lease.leaseToken),
            ttlParameter,
          ],
          sql: `UPDATE ${q(database, mutationLeaseTableName)} SET ${q(database, "heartbeat_at")} = ${timestamp}, ${q(database, "expires_at")} = ${expiry} WHERE ${q(database, "id")} = ${p(database, 1)} AND ${q(database, "tenant_id")} = ${p(database, 2)} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} AND ${q(database, "lease_token")} = ${p(database, 4)} AND ${q(database, "expires_at")} > CURRENT_TIMESTAMP${database.dialect === "postgres" ? " RETURNING *" : ""};`,
          tableName: mutationLeaseTableName,
        });
        if (result.rowsAffected !== 1) {
          throw new LegacySpacePublicationBootstrapTransitionError(
            "Knowledge space document mutation lease heartbeat was lost",
          );
        }
        const row =
          result.rows[0] ??
          (await selectDocumentMutationLease(
            database,
            transaction,
            lease.tenantId,
            lease.knowledgeSpaceId,
            lease.id,
            lease.leaseToken,
          ));
        if (!row) {
          throw new LegacySpacePublicationBootstrapTransitionError(
            "Knowledge space document mutation lease heartbeat was lost",
          );
        }
        return mapDocumentMutationLeaseRow(row);
      });
    },
    releaseDocumentMutationLease: async (lease) => {
      const result = await database.execute({
        maxRows: 0,
        operation: "delete",
        params: [
          UuidSchema.parse(lease.id),
          tenantId(lease.tenantId),
          UuidSchema.parse(lease.knowledgeSpaceId),
          UuidSchema.parse(lease.leaseToken),
        ],
        sql: `DELETE FROM ${q(database, mutationLeaseTableName)} WHERE ${q(
          database,
          "id",
        )} = ${p(database, 1)} AND ${q(database, "tenant_id")} = ${p(
          database,
          2,
        )} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} AND ${q(database, "lease_token")} = ${p(database, 4)};`,
        tableName: mutationLeaseTableName,
      });
      if (result.rowsAffected !== 1) {
        throw new LegacySpacePublicationBootstrapTransitionError(
          "Knowledge space document mutation lease was lost",
        );
      }
    },
    retry: async (input) =>
      database.transaction(async (transaction) => {
        const current = await databaseGetBootstrapById(database, transaction, input.jobId, true);
        if (
          !current ||
          current.rowVersion !==
            nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion") ||
          current.runState !== "failed"
        ) {
          return null;
        }
        const now = canonicalDateTime(input.now, "now");
        await transaction.execute({
          maxRows: 0,
          operation: "update",
          params: [now, current.id],
          sql: `UPDATE ${q(database, itemTableName)} SET ${q(
            database,
            "status",
          )} = 'pending', ${q(database, "compilation_attempt_id")} = NULL, ${q(
            database,
            "last_error",
          )} = NULL, ${q(
            database,
            "updated_at",
          )} = ${p(database, 1)} WHERE ${q(database, "bootstrap_id")} = ${p(
            database,
            2,
          )} AND ${q(database, "status")} = 'failed';`,
          tableName: itemTableName,
        });
        return databasePersistBootstrap(database, transaction, current, {
          ...withoutLease(current),
          completedAt: undefined,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
          rowVersion: current.rowVersion + 1,
          runState: "queued",
          updatedAt: now,
        });
      }),
    start: async (rawInput) => {
      const input = normalizeStartInput(rawInput);
      return database.transaction(async (transaction) => {
        await requireSpaceOwnership(database, transaction, input, true);
        await requireNoActiveDocumentMutationLease(database, transaction, input);
        const existing = await databaseGetBootstrapByScope(database, transaction, input, true);
        if (existing) {
          if (existing.idempotencyKey !== input.idempotencyKey) {
            throw new LegacySpacePublicationBootstrapTransitionError(
              "Knowledge space already has a different legacy publication bootstrap ledger",
            );
          }
          return { created: false, job: existing };
        }
        const head = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId],
          sql: `SELECT ${q(database, "publication_id")} FROM ${q(
            database,
            headTableName,
          )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
            database,
            "knowledge_space_id",
          )} = ${p(database, 2)} LIMIT 1 FOR UPDATE;`,
          tableName: headTableName,
        });
        if (head.rows[0]) {
          throw new LegacySpacePublicationBootstrapAlreadyPublishedError();
        }
        const activeAttempt = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.tenantId, input.knowledgeSpaceId],
          sql: `SELECT ${q(database, "id")} FROM ${q(
            database,
            attemptTableName,
          )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
            database,
            "knowledge_space_id",
          )} = ${p(database, 2)} AND ${q(database, "active_slot")} = 1 LIMIT 1 FOR UPDATE;`,
          tableName: attemptTableName,
        });
        if (activeAttempt.rows[0]) {
          throw new LegacySpacePublicationBootstrapActiveCompilationError();
        }
        const assets = await loadFrozenDocumentSnapshot(
          database,
          transaction,
          input.knowledgeSpaceId,
          maxDocuments,
        );
        const timestamp = input.createdAt;
        const job = parseBootstrap({
          checkpoint: "snapshot_captured",
          completedDocuments: 0,
          createdAt: timestamp,
          id: input.id,
          idempotencyKey: input.idempotencyKey,
          knowledgeSpaceId: input.knowledgeSpaceId,
          rowVersion: 0,
          runState: "queued",
          snapshotMetadata: {
            directLegacyAdoption: false,
            reason: "legacy graph ownership and immutable generation cannot be proven",
            schemaVersion: 1,
            strategy: "full-generation-rebuild",
          },
          tenantId: input.tenantId,
          totalDocuments: assets.length,
          updatedAt: timestamp,
        });
        await databaseInsertBootstrap(database, transaction, job);
        const items = assets.map((row, ordinal) =>
          parseBootstrapItem({
            bootstrapId: job.id,
            createdAt: timestamp,
            documentAssetId: stringColumn(row, "id"),
            documentSha256: stringColumn(row, "sha256"),
            documentVersion: numberColumn(row, "version"),
            ordinal,
            status: "pending",
            updatedAt: timestamp,
          }),
        );
        for (let offset = 0; offset < items.length; offset += maxInsertBatchSize) {
          await databaseInsertBootstrapItems(
            database,
            transaction,
            items.slice(offset, offset + maxInsertBatchSize),
          );
        }
        return { created: true, job };
      });
    },
  };
}

async function loadFrozenDocumentSnapshot(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  knowledgeSpaceId: string,
  maxDocuments: number,
): Promise<readonly DatabaseRow[]> {
  const assets = await transaction.execute({
    maxRows: maxDocuments + 1,
    operation: "select",
    params: [UuidSchema.parse(knowledgeSpaceId), maxDocuments + 1],
    sql: `SELECT ${["id", "version", "sha256"]
      .map((column) => q(database, column))
      .join(", ")} FROM ${q(database, assetTableName)} WHERE ${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 1)} ORDER BY ${q(database, "id")} ASC LIMIT ${p(database, 2)} FOR UPDATE;`,
    tableName: assetTableName,
  });
  if (assets.rows.length > maxDocuments) {
    throw new LegacySpacePublicationBootstrapCapacityExceededError(maxDocuments);
  }
  return assets.rows;
}

async function databaseHasLegacyNullGenerationState(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: LegacySpacePublicationBootstrapLookupInput,
): Promise<boolean> {
  const knowledgeSpaceId = UuidSchema.parse(input.knowledgeSpaceId);
  const tenant = tenantId(input.tenantId);
  const legacyTables = [
    "knowledge_nodes",
    "index_projections",
    "document_outlines",
    "document_multimodal_manifests",
    "knowledge_paths",
    "graph_entities",
    "graph_relations",
  ] as const;
  const legacyPredicates = legacyTables.map(
    (table) =>
      `EXISTS (SELECT 1 FROM ${q(database, table)} legacy WHERE legacy.${q(
        database,
        "knowledge_space_id",
      )} = space.${q(database, "id")} AND legacy.${q(
        database,
        "publication_generation_id",
      )} IS NULL LIMIT 1)`,
  );
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenant, knowledgeSpaceId],
    sql: `SELECT 1 AS ${q(database, "legacy_exists")} FROM ${q(
      database,
      spaceTableName,
    )} space WHERE space.${q(database, "tenant_id")} = ${p(
      database,
      1,
    )} AND space.${q(database, "id")} = ${p(database, 2)} AND (${legacyPredicates.join(
      " OR ",
    )}) LIMIT 1;`,
    tableName: spaceTableName,
  });
  return Boolean(result.rows[0]);
}

async function mutateFencedBootstrap(
  database: DatabaseAdapter,
  input: LegacySpacePublicationBootstrapFence,
  mutate: (
    current: LegacySpacePublicationBootstrap,
    transaction: DatabaseExecutor,
  ) => Promise<LegacySpacePublicationBootstrap | null>,
  lockSpaceFirst = false,
): Promise<LegacySpacePublicationBootstrap | null> {
  return database.transaction(async (transaction) => {
    if (lockSpaceFirst) {
      const preliminary = await databaseGetBootstrapById(database, transaction, input.jobId, false);
      if (!preliminary) {
        throw new LegacySpacePublicationBootstrapTransitionError(
          "Legacy publication bootstrap lost its lease fence",
        );
      }
      await requireSpaceOwnership(database, transaction, preliminary, true);
    }
    const current = await requireFencedBootstrap(database, transaction, input);
    const next = await mutate(current, transaction);
    if (!next || next === current) {
      return next;
    }
    return databasePersistBootstrap(database, transaction, current, next);
  });
}

async function requireFencedBootstrap(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: LegacySpacePublicationBootstrapFence,
): Promise<LegacySpacePublicationBootstrap> {
  const current = await databaseGetBootstrapById(database, transaction, input.jobId, true);
  const now = canonicalDateTime(input.now, "now");
  if (
    !current ||
    current.runState !== "running" ||
    current.rowVersion !== nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion") ||
    current.leaseToken !== nonzeroUuid(input.leaseToken, "leaseToken") ||
    !current.leaseExpiresAt ||
    current.leaseExpiresAt <= now
  ) {
    throw new LegacySpacePublicationBootstrapTransitionError(
      "Legacy publication bootstrap lost its lease fence",
    );
  }
  return current;
}

async function requireSpaceOwnership(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: LegacySpacePublicationBootstrapLookupInput,
  _forUpdate: boolean,
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, input))) {
    throw new LegacySpacePublicationBootstrapSnapshotConflictError(
      "Legacy publication bootstrap knowledge space was not found in tenant scope",
    );
  }
}

async function requireNoActiveDocumentMutationLease(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: LegacySpacePublicationBootstrapLookupInput,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId(input.tenantId), UuidSchema.parse(input.knowledgeSpaceId)],
    sql: `SELECT ${q(database, "id")} FROM ${q(
      database,
      mutationLeaseTableName,
    )} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 2)} AND ${q(database, "expires_at")} > CURRENT_TIMESTAMP LIMIT 1 FOR UPDATE;`,
    tableName: mutationLeaseTableName,
  });
  if (result.rows[0]) {
    throw new KnowledgeSpaceDocumentMutationLeaseActiveError();
  }
}

function documentMutationOperation(value: string): KnowledgeSpaceDocumentMutationOperation {
  const operations = [
    "bulk-delete",
    "bulk-reindex",
    "bulk-upload",
    "knowledge-fs-write",
    "page-index-upgrade",
    "source-delete",
    "source-materialize",
    "upload",
  ] as const;
  if (!operations.includes(value as KnowledgeSpaceDocumentMutationOperation)) {
    throw new Error("Unknown knowledge space document mutation operation");
  }
  return value as KnowledgeSpaceDocumentMutationOperation;
}

async function databaseGetBootstrapByScope(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: LegacySpacePublicationBootstrapLookupInput,
  forUpdate: boolean,
): Promise<LegacySpacePublicationBootstrap | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId(input.tenantId), UuidSchema.parse(input.knowledgeSpaceId)],
    sql: `SELECT * FROM ${q(database, bootstrapTableName)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: bootstrapTableName,
  });
  return result.rows[0] ? mapBootstrapRow(result.rows[0]) : null;
}

async function databaseGetBootstrapById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  rawId: string,
  forUpdate: boolean,
): Promise<LegacySpacePublicationBootstrap | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [UuidSchema.parse(rawId)],
    sql: `SELECT * FROM ${q(database, bootstrapTableName)} WHERE ${q(
      database,
      "id",
    )} = ${p(database, 1)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: bootstrapTableName,
  });
  return result.rows[0] ? mapBootstrapRow(result.rows[0]) : null;
}

async function databaseGetBootstrapItem(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  bootstrapId: string,
  documentAssetId: string,
  forUpdate: boolean,
): Promise<LegacySpacePublicationBootstrapItem | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [UuidSchema.parse(bootstrapId), UuidSchema.parse(documentAssetId)],
    sql: `SELECT * FROM ${q(database, itemTableName)} WHERE ${q(
      database,
      "bootstrap_id",
    )} = ${p(database, 1)} AND ${q(database, "document_asset_id")} = ${p(
      database,
      2,
    )} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: itemTableName,
  });
  return result.rows[0] ? mapBootstrapItemRow(result.rows[0]) : null;
}

async function databaseInsertBootstrap(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: LegacySpacePublicationBootstrap,
): Promise<void> {
  const columns = bootstrapColumns;
  const params = bootstrapValues(job);
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, bootstrapTableName)} (${columns
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${columns
      .map((column, index) => jsonInsertPlaceholder(database, index + 1, column))
      .join(", ")});`,
    tableName: bootstrapTableName,
  });
  if (result.rowsAffected !== 1) {
    throw new LegacySpacePublicationBootstrapTransitionError(
      "Legacy publication bootstrap insert did not persist exactly one row",
    );
  }
}

async function databaseInsertBootstrapItems(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  items: readonly LegacySpacePublicationBootstrapItem[],
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const columns = bootstrapItemColumns;
  const params: DatabaseQueryValue[] = [];
  const rows = items.map((item) => {
    const values = bootstrapItemValues(item);
    const placeholders = values.map((value) => {
      params.push(value);
      return p(database, params.length);
    });
    return `(${placeholders.join(", ")})`;
  });
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, itemTableName)} (${columns
      .map((column) => q(database, column))
      .join(", ")}) VALUES ${rows.join(", ")};`,
    tableName: itemTableName,
  });
  if (result.rowsAffected !== items.length) {
    throw new LegacySpacePublicationBootstrapTransitionError(
      `Legacy publication bootstrap item count mismatch: expected=${items.length} actual=${result.rowsAffected}`,
    );
  }
}

async function databasePersistBootstrap(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  current: LegacySpacePublicationBootstrap,
  rawNext: LegacySpacePublicationBootstrap,
): Promise<LegacySpacePublicationBootstrap> {
  const next = parseBootstrap(rawNext);
  const mutableColumns = bootstrapColumns.filter(
    (column) => !["id", "tenant_id", "knowledge_space_id", "created_at"].includes(column),
  );
  const allValues = bootstrapValues(next);
  const valuesByColumn = new Map(
    bootstrapColumns.map((column, index) => [column, allValues[index]]),
  );
  const params = mutableColumns.map((column) => valuesByColumn.get(column) ?? null);
  params.push(current.id, current.tenantId, current.knowledgeSpaceId, current.rowVersion);
  const result = await executor.execute({
    maxRows: database.dialect === "postgres" ? 1 : 0,
    operation: "update",
    params,
    sql: `UPDATE ${q(database, bootstrapTableName)} SET ${mutableColumns
      .map(
        (column, index) =>
          `${q(database, column)} = ${jsonInsertPlaceholder(database, index + 1, column)}`,
      )
      .join(", ")} WHERE ${q(database, "id")} = ${p(
      database,
      mutableColumns.length + 1,
    )} AND ${q(database, "tenant_id")} = ${p(
      database,
      mutableColumns.length + 2,
    )} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      mutableColumns.length + 3,
    )} AND ${q(database, "row_version")} = ${p(
      database,
      mutableColumns.length + 4,
    )}${database.dialect === "postgres" ? " RETURNING *" : ""};`,
    tableName: bootstrapTableName,
  });
  if (result.rowsAffected !== 1) {
    throw new LegacySpacePublicationBootstrapTransitionError(
      "Legacy publication bootstrap changed concurrently",
    );
  }
  return result.rows[0] ? mapBootstrapRow(result.rows[0]) : cloneBootstrap(next);
}

async function databasePersistBootstrapItem(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  item: LegacySpacePublicationBootstrapItem,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [
      item.compilationAttemptId ?? null,
      item.status,
      item.lastError ?? null,
      item.updatedAt,
      item.bootstrapId,
      item.documentAssetId,
    ],
    sql: `UPDATE ${q(database, itemTableName)} SET ${q(
      database,
      "compilation_attempt_id",
    )} = ${p(database, 1)}, ${q(database, "status")} = ${p(
      database,
      2,
    )}, ${q(database, "last_error")} = ${p(database, 3)}, ${q(
      database,
      "updated_at",
    )} = ${p(database, 4)} WHERE ${q(database, "bootstrap_id")} = ${p(
      database,
      5,
    )} AND ${q(database, "document_asset_id")} = ${p(database, 6)};`,
    tableName: itemTableName,
  });
  if (result.rowsAffected !== 1) {
    throw new LegacySpacePublicationBootstrapSnapshotConflictError(
      "Legacy publication bootstrap item changed concurrently",
    );
  }
}

async function verifyBootstrapSnapshot(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  job: LegacySpacePublicationBootstrap,
): Promise<void> {
  const itemCount = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id],
    sql: `SELECT COUNT(*) AS ${q(database, "item_count")} FROM ${q(
      database,
      itemTableName,
    )} WHERE ${q(database, "bootstrap_id")} = ${p(database, 1)} AND ${q(
      database,
      "status",
    )} = 'succeeded';`,
    tableName: itemTableName,
  });
  if (
    numberColumn(requiredRow(itemCount.rows[0], "bootstrap item count"), "item_count") !==
    job.totalDocuments
  ) {
    throw new LegacySpacePublicationBootstrapSnapshotConflictError(
      "Bootstrap item count no longer matches the frozen document snapshot",
    );
  }

  const changedItem = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id, job.knowledgeSpaceId],
    sql: `SELECT bi.${q(database, "document_asset_id")} FROM ${q(
      database,
      itemTableName,
    )} bi LEFT JOIN ${q(database, assetTableName)} da ON da.${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 2)} AND da.${q(database, "id")} = bi.${q(
      database,
      "document_asset_id",
    )} AND da.${q(database, "version")} = bi.${q(
      database,
      "document_version",
    )} AND da.${q(database, "sha256")} = bi.${q(
      database,
      "document_sha256",
    )} WHERE bi.${q(database, "bootstrap_id")} = ${p(database, 1)} AND da.${q(
      database,
      "id",
    )} IS NULL LIMIT 1;`,
    tableName: itemTableName,
  });
  if (changedItem.rows[0]) {
    throw new LegacySpacePublicationBootstrapSnapshotConflictError();
  }
  const unsnapshottedAsset = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id, job.knowledgeSpaceId],
    sql: `SELECT da.${q(database, "id")} FROM ${q(
      database,
      assetTableName,
    )} da LEFT JOIN ${q(database, itemTableName)} bi ON bi.${q(
      database,
      "bootstrap_id",
    )} = ${p(database, 1)} AND bi.${q(database, "document_asset_id")} = da.${q(
      database,
      "id",
    )} WHERE da.${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND bi.${q(database, "document_asset_id")} IS NULL LIMIT 1;`,
    tableName: assetTableName,
  });
  if (unsnapshottedAsset.rows[0]) {
    throw new LegacySpacePublicationBootstrapSnapshotConflictError(
      "A document was added after the bootstrap snapshot was captured",
    );
  }
}

interface CompletePublishedHead {
  readonly fingerprint: string;
  readonly headRevision: number;
  readonly publicationId: string;
}

async function requireCompletePublishedHead(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  job: LegacySpacePublicationBootstrap,
): Promise<CompletePublishedHead> {
  const headResult = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.tenantId, job.knowledgeSpaceId],
    sql: `SELECT h.${q(database, "publication_id")}, h.${q(
      database,
      "head_revision",
    )}, pub.${q(database, "fingerprint")} FROM ${q(
      database,
      headTableName,
    )} h JOIN ${q(database, publicationTableName)} pub ON pub.${q(
      database,
      "tenant_id",
    )} = h.${q(database, "tenant_id")} AND pub.${q(
      database,
      "knowledge_space_id",
    )} = h.${q(database, "knowledge_space_id")} AND pub.${q(
      database,
      "id",
    )} = h.${q(database, "publication_id")} WHERE h.${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND h.${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND pub.${q(database, "status")} = 'published' LIMIT 1 FOR UPDATE;`,
    tableName: headTableName,
  });
  const row = headResult.rows[0];
  if (!row) {
    throw new LegacySpacePublicationBootstrapVerificationError(
      "Bootstrap has no current published head after rebuilding documents",
    );
  }
  const publicationId = UuidSchema.parse(stringColumn(row, "publication_id"));
  const fingerprint = ProjectionSetFingerprintSchema.parse(stringColumn(row, "fingerprint"));
  const headRevision = numberColumn(row, "head_revision");

  const missingRequiredDocumentComponent = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id],
    sql: `SELECT bi.${q(database, "document_asset_id")} FROM ${q(
      database,
      itemTableName,
    )} bi JOIN ${q(database, bootstrapTableName)} bootstrap ON bootstrap.${q(
      database,
      "id",
    )} = bi.${q(database, "bootstrap_id")} JOIN ${q(
      database,
      headTableName,
    )} head ON head.${q(database, "tenant_id")} = bootstrap.${q(
      database,
      "tenant_id",
    )} AND head.${q(database, "knowledge_space_id")} = bootstrap.${q(
      database,
      "knowledge_space_id",
    )} WHERE bi.${q(database, "bootstrap_id")} = ${p(
      database,
      1,
    )} AND (NOT EXISTS (SELECT 1 FROM ${q(database, memberTableName)} pm JOIN ${q(
      database,
      "document_outlines",
    )} outline ON outline.${q(database, "id")} = pm.${q(
      database,
      "component_key",
    )} AND outline.${q(database, "knowledge_space_id")} = pm.${q(
      database,
      "knowledge_space_id",
    )} AND outline.${q(database, "publication_generation_id")} = pm.${q(
      database,
      "generation_id",
    )} AND outline.${q(database, "document_asset_id")} = pm.${q(
      database,
      "document_asset_id",
    )} AND outline.${q(database, "version")} = bi.${q(
      database,
      "document_version",
    )} JOIN ${q(database, "page_index_manifests")} page_index ON page_index.${q(
      database,
      "knowledge_space_id",
    )} = pm.${q(database, "knowledge_space_id")} AND page_index.${q(
      database,
      "publication_generation_id",
    )} = pm.${q(database, "generation_id")} AND page_index.${q(
      database,
      "document_asset_id",
    )} = pm.${q(database, "document_asset_id")} AND page_index.${q(
      database,
      "document_outline_id",
    )} = outline.${q(database, "id")} AND page_index.${q(
      database,
      "document_version",
    )} = bi.${q(database, "document_version")} AND page_index.${q(
      database,
      "status",
    )} = 'ready' AND page_index.${q(
      database,
      "tokenizer_version",
    )} = '${PageIndexTokenizerVersion}' AND page_index.${q(
      database,
      "node_count",
    )} > 0 AND page_index.${q(database, "term_count")} > 0 AND page_index.${q(
      database,
      "checksum",
    )} ${database.dialect === "postgres" ? "~" : "REGEXP"} '^[a-f0-9]{64}$' AND page_index.${q(database, "node_count")} = (SELECT COUNT(*) FROM ${q(
      database,
      "page_index_nodes",
    )} page_node WHERE page_node.${q(database, "manifest_id")} = page_index.${q(
      database,
      "id",
    )}) AND page_index.${q(database, "term_count")} = (SELECT COUNT(*) FROM ${q(
      database,
      "page_index_terms",
    )} page_term WHERE page_term.${q(database, "manifest_id")} = page_index.${q(
      database,
      "id",
    )}) AND page_index.${q(database, "term_count")} = (SELECT COUNT(*) FROM ${q(
      database,
      "page_index_terms",
    )} page_term JOIN ${q(database, "page_index_nodes")} page_term_node ON page_term_node.${q(
      database,
      "id",
    )} = page_term.${q(database, "page_index_node_id")} AND page_term_node.${q(
      database,
      "manifest_id",
    )} = page_index.${q(database, "id")} WHERE page_term.${q(
      database,
      "manifest_id",
    )} = page_index.${q(database, "id")} AND page_term.${q(
      database,
      "knowledge_space_id",
    )} = page_index.${q(
      database,
      "knowledge_space_id",
    )}) WHERE pm.${q(database, "tenant_id")} = bootstrap.${q(
      database,
      "tenant_id",
    )} AND pm.${q(database, "knowledge_space_id")} = bootstrap.${q(
      database,
      "knowledge_space_id",
    )} AND pm.${q(database, "publication_id")} = head.${q(
      database,
      "publication_id",
    )} AND pm.${q(database, "component_type")} = 'document-outline' AND pm.${q(
      database,
      "document_asset_id",
    )} = bi.${q(database, "document_asset_id")}) OR NOT EXISTS (SELECT 1 FROM ${q(
      database,
      memberTableName,
    )} pm JOIN ${q(database, "index_projections")} ip ON ip.${q(
      database,
      "id",
    )} = pm.${q(database, "component_key")} AND ip.${q(
      database,
      "knowledge_space_id",
    )} = pm.${q(database, "knowledge_space_id")} AND ip.${q(
      database,
      "publication_generation_id",
    )} = pm.${q(database, "generation_id")} AND ip.${q(
      database,
      "type",
    )} = 'fts' AND ip.${q(database, "status")} = 'ready' JOIN ${q(
      database,
      "knowledge_nodes",
    )} node ON node.${q(database, "id")} = ip.${q(
      database,
      "node_id",
    )} AND node.${q(database, "knowledge_space_id")} = pm.${q(
      database,
      "knowledge_space_id",
    )} AND node.${q(database, "publication_generation_id")} = pm.${q(
      database,
      "generation_id",
    )} AND node.${q(database, "document_asset_id")} = pm.${q(
      database,
      "document_asset_id",
    )} WHERE pm.${q(database, "tenant_id")} = bootstrap.${q(
      database,
      "tenant_id",
    )} AND pm.${q(database, "knowledge_space_id")} = bootstrap.${q(
      database,
      "knowledge_space_id",
    )} AND pm.${q(database, "publication_id")} = head.${q(
      database,
      "publication_id",
    )} AND pm.${q(database, "component_type")} = 'index-projection' AND pm.${q(
      database,
      "document_asset_id",
    )} = bi.${q(database, "document_asset_id")})) LIMIT 1;`,
    tableName: memberTableName,
  });
  if (missingRequiredDocumentComponent.rows[0]) {
    throw new LegacySpacePublicationBootstrapVerificationError(
      "Published head does not contain a generation-closed PageIndex and FTS corpus for every frozen document",
    );
  }

  const selectedVectorSpace =
    database.dialect === "postgres"
      ? `manifest.${q(database, "metadata")} -> '__knowledgeFsEmbeddingProfile' ->> 'vectorSpaceId'`
      : `JSON_UNQUOTE(JSON_EXTRACT(manifest.${q(
          database,
          "metadata",
        )}, '$.__knowledgeFsEmbeddingProfile.vectorSpaceId'))`;
  const missingSelectedDense = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id],
    sql: `SELECT bi.${q(database, "document_asset_id")} FROM ${q(
      database,
      itemTableName,
    )} bi JOIN ${q(database, bootstrapTableName)} bootstrap ON bootstrap.${q(
      database,
      "id",
    )} = bi.${q(database, "bootstrap_id")} JOIN ${q(
      database,
      headTableName,
    )} head ON head.${q(database, "tenant_id")} = bootstrap.${q(
      database,
      "tenant_id",
    )} AND head.${q(database, "knowledge_space_id")} = bootstrap.${q(
      database,
      "knowledge_space_id",
    )} LEFT JOIN ${q(database, "knowledge_space_manifests")} manifest ON manifest.${q(
      database,
      "tenant_id",
    )} = bootstrap.${q(database, "tenant_id")} AND manifest.${q(
      database,
      "knowledge_space_id",
    )} = bootstrap.${q(database, "knowledge_space_id")} WHERE bi.${q(
      database,
      "bootstrap_id",
    )} = ${p(database, 1)} AND NOT EXISTS (SELECT 1 FROM ${q(
      database,
      memberTableName,
    )} pm JOIN ${q(database, "index_projections")} dense ON dense.${q(
      database,
      "id",
    )} = pm.${q(database, "component_key")} AND dense.${q(
      database,
      "knowledge_space_id",
    )} = pm.${q(database, "knowledge_space_id")} AND dense.${q(
      database,
      "publication_generation_id",
    )} = pm.${q(database, "generation_id")} AND dense.${q(
      database,
      "type",
    )} = 'dense-vector' AND dense.${q(database, "status")} = 'ready' JOIN ${q(
      database,
      "knowledge_nodes",
    )} node ON node.${q(database, "id")} = dense.${q(
      database,
      "node_id",
    )} AND node.${q(database, "knowledge_space_id")} = pm.${q(
      database,
      "knowledge_space_id",
    )} AND node.${q(database, "publication_generation_id")} = pm.${q(
      database,
      "generation_id",
    )} AND node.${q(database, "document_asset_id")} = pm.${q(
      database,
      "document_asset_id",
    )} WHERE pm.${q(database, "tenant_id")} = bootstrap.${q(
      database,
      "tenant_id",
    )} AND pm.${q(database, "knowledge_space_id")} = bootstrap.${q(
      database,
      "knowledge_space_id",
    )} AND pm.${q(database, "publication_id")} = head.${q(
      database,
      "publication_id",
    )} AND pm.${q(database, "component_type")} = 'index-projection' AND pm.${q(
      database,
      "document_asset_id",
    )} = bi.${q(database, "document_asset_id")} AND (${selectedVectorSpace} IS NULL OR dense.${q(
      database,
      "model",
    )} = ${selectedVectorSpace})) LIMIT 1;`,
    tableName: memberTableName,
  });
  if (missingSelectedDense.rows[0]) {
    throw new LegacySpacePublicationBootstrapVerificationError(
      "Published head does not contain the selected ready dense vector space for every frozen document",
    );
  }
  const incompleteNodeProjectionPair = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id],
    sql: incompleteNodeProjectionPairSql(database, selectedVectorSpace),
    tableName: memberTableName,
  });
  if (incompleteNodeProjectionPair.rows[0]) {
    throw new LegacySpacePublicationBootstrapVerificationError(
      "Published head contains a node without both ready FTS and active-vector-space projections",
    );
  }

  const invalidMember = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id, job.tenantId, job.knowledgeSpaceId, publicationId],
    sql: invalidPublishedMemberSql(database),
    tableName: memberTableName,
  });
  if (invalidMember.rows[0]) {
    throw new LegacySpacePublicationBootstrapVerificationError(
      "Published head contains a missing, cross-generation, or ownerless component",
    );
  }

  return { fingerprint, headRevision, publicationId };
}

function incompleteNodeProjectionPairSql(
  database: DatabaseAdapter,
  selectedVectorSpace: string,
): string {
  const c = (alias: string, name: string) => `${alias}.${q(database, name)}`;
  const sibling = (memberAlias: string, projectionAlias: string, type: "dense-vector" | "fts") =>
    `EXISTS (SELECT 1 FROM ${q(database, memberTableName)} ${memberAlias} JOIN ${q(
      database,
      "index_projections",
    )} ${projectionAlias} ON ${c(projectionAlias, "id")} = ${c(
      memberAlias,
      "component_key",
    )} AND ${c(projectionAlias, "knowledge_space_id")} = ${c(
      memberAlias,
      "knowledge_space_id",
    )} AND ${c(projectionAlias, "publication_generation_id")} = ${c(
      memberAlias,
      "generation_id",
    )} AND ${c(projectionAlias, "node_id")} = ${c("ip", "node_id")} AND ${c(
      projectionAlias,
      "type",
    )} = '${type}' AND ${c(projectionAlias, "status")} = 'ready' WHERE ${c(
      memberAlias,
      "tenant_id",
    )} = ${c("pm", "tenant_id")} AND ${c(memberAlias, "knowledge_space_id")} = ${c(
      "pm",
      "knowledge_space_id",
    )} AND ${c(memberAlias, "publication_id")} = ${c(
      "pm",
      "publication_id",
    )} AND ${c(memberAlias, "generation_id")} = ${c("pm", "generation_id")} AND ${c(
      memberAlias,
      "document_asset_id",
    )} = ${c("pm", "document_asset_id")} AND ${c(
      memberAlias,
      "component_type",
    )} = 'index-projection'${
      type === "dense-vector"
        ? ` AND (${selectedVectorSpace} IS NULL OR ${c(
            projectionAlias,
            "model",
          )} = ${selectedVectorSpace})`
        : ""
    })`;
  return `SELECT ${c("pm", "component_key")} FROM ${q(
    database,
    itemTableName,
  )} bi JOIN ${q(database, bootstrapTableName)} bootstrap ON ${c(
    "bootstrap",
    "id",
  )} = ${c("bi", "bootstrap_id")} JOIN ${q(database, headTableName)} head ON ${c(
    "head",
    "tenant_id",
  )} = ${c("bootstrap", "tenant_id")} AND ${c(
    "head",
    "knowledge_space_id",
  )} = ${c("bootstrap", "knowledge_space_id")} LEFT JOIN ${q(
    database,
    "knowledge_space_manifests",
  )} manifest ON ${c("manifest", "tenant_id")} = ${c(
    "bootstrap",
    "tenant_id",
  )} AND ${c("manifest", "knowledge_space_id")} = ${c(
    "bootstrap",
    "knowledge_space_id",
  )} JOIN ${q(database, memberTableName)} pm ON ${c("pm", "tenant_id")} = ${c(
    "bootstrap",
    "tenant_id",
  )} AND ${c("pm", "knowledge_space_id")} = ${c(
    "bootstrap",
    "knowledge_space_id",
  )} AND ${c("pm", "publication_id")} = ${c("head", "publication_id")} AND ${c(
    "pm",
    "document_asset_id",
  )} = ${c("bi", "document_asset_id")} AND ${c(
    "pm",
    "component_type",
  )} = 'index-projection' JOIN ${q(database, "index_projections")} ip ON ${c(
    "ip",
    "id",
  )} = ${c("pm", "component_key")} AND ${c("ip", "knowledge_space_id")} = ${c(
    "pm",
    "knowledge_space_id",
  )} AND ${c("ip", "publication_generation_id")} = ${c(
    "pm",
    "generation_id",
  )} WHERE ${c("bi", "bootstrap_id")} = ${p(database, 1)} AND (NOT ${sibling(
    "fts_pm",
    "fts_ip",
    "fts",
  )} OR NOT ${sibling("dense_pm", "dense_ip", "dense-vector")}) LIMIT 1;`;
}

function invalidPublishedMemberSql(database: DatabaseAdapter): string {
  const column = (alias: string, name: string) => `${alias}.${q(database, name)}`;
  const scope = `${column("pm", "tenant_id")} = ${p(database, 2)} AND ${column(
    "pm",
    "knowledge_space_id",
  )} = ${p(database, 3)} AND ${column("pm", "publication_id")} = ${p(database, 4)}`;
  const itemOwner = `EXISTS (SELECT 1 FROM ${q(database, itemTableName)} bi WHERE ${column(
    "bi",
    "bootstrap_id",
  )} = ${p(database, 1)} AND ${column("bi", "document_asset_id")} = ${column(
    "pm",
    "document_asset_id",
  )})`;
  const exact = (alias: string) =>
    `${column(alias, "id")} = ${column("pm", "component_key")} AND ${column(
      alias,
      "knowledge_space_id",
    )} = ${column("pm", "knowledge_space_id")} AND ${column(
      alias,
      "publication_generation_id",
    )} = ${column("pm", "generation_id")}`;
  const componentExists = (table: string, alias: string, extra = "") =>
    `EXISTS (SELECT 1 FROM ${q(database, table)} ${alias} WHERE ${exact(alias)}${extra})`;
  const nodeClosure = ` AND ${column("ip", "status")} = 'ready' AND EXISTS (SELECT 1 FROM ${q(
    database,
    "knowledge_nodes",
  )} node WHERE ${column("node", "id")} = ${column("ip", "node_id")} AND ${column(
    "node",
    "knowledge_space_id",
  )} = ${column("pm", "knowledge_space_id")} AND ${column(
    "node",
    "publication_generation_id",
  )} = ${column("pm", "generation_id")} AND ${column(
    "node",
    "document_asset_id",
  )} = ${column("pm", "document_asset_id")})`;
  const endpointMember = (
    memberAlias: string,
    endpoint: "object_entity_id" | "subject_entity_id",
  ) =>
    `EXISTS (SELECT 1 FROM ${q(database, memberTableName)} ${memberAlias} WHERE ${column(
      memberAlias,
      "tenant_id",
    )} = ${column("pm", "tenant_id")} AND ${column(
      memberAlias,
      "knowledge_space_id",
    )} = ${column("pm", "knowledge_space_id")} AND ${column(
      memberAlias,
      "publication_id",
    )} = ${column("pm", "publication_id")} AND ${column(
      memberAlias,
      "component_type",
    )} = 'graph-entity' AND ${column(memberAlias, "component_key")} = ${column(
      "relation",
      endpoint,
    )})`;
  const pathDocumentAssetId =
    database.dialect === "postgres"
      ? `CAST(${column("pm", "document_asset_id")} AS text)`
      : `CAST(${column("pm", "document_asset_id")} AS CHAR)`;
  const valid = [
    `(pm.${q(database, "component_type")} = 'index-projection' AND ${componentExists(
      "index_projections",
      "ip",
      nodeClosure,
    )})`,
    `(pm.${q(database, "component_type")} = 'document-outline' AND ${componentExists(
      "document_outlines",
      "outline",
      ` AND ${column("outline", "document_asset_id")} = ${column("pm", "document_asset_id")}`,
    )})`,
    `(pm.${q(database, "component_type")} = 'multimodal-manifest' AND ${componentExists(
      "document_multimodal_manifests",
      "manifest",
      ` AND ${column("manifest", "document_asset_id")} = ${column("pm", "document_asset_id")}`,
    )})`,
    `(pm.${q(database, "component_type")} = 'knowledge-path' AND ${componentExists(
      "knowledge_paths",
      "path",
      ` AND ${column("path", "target_id")} = ${pathDocumentAssetId}`,
    )})`,
    `(pm.${q(database, "component_type")} = 'graph-entity' AND ${componentExists(
      "graph_entities",
      "entity",
      graphSourceClosureSql(database, "entity", "pm"),
    )})`,
    `(pm.${q(database, "component_type")} = 'graph-relation' AND ${componentExists(
      "graph_relations",
      "relation",
      `${graphSourceClosureSql(database, "relation", "pm")} AND ${endpointMember(
        "subject_pm",
        "subject_entity_id",
      )} AND ${endpointMember("object_pm", "object_entity_id")}`,
    )})`,
  ].join(" OR ");
  return `SELECT ${column("pm", "component_key")} FROM ${q(
    database,
    memberTableName,
  )} pm WHERE ${scope} AND (${column(
    "pm",
    "document_asset_id",
  )} IS NULL OR NOT ${itemOwner} OR NOT (${valid})) LIMIT 1;`;
}

function graphSourceClosureSql(
  database: DatabaseAdapter,
  componentAlias: string,
  memberAlias: string,
): string {
  const sourceIds = `${componentAlias}.${q(database, "source_node_ids")}`;
  const nodeMembership =
    database.dialect === "postgres"
      ? `${sourceIds} ? CAST(node.${q(database, "id")} AS text)`
      : `JSON_CONTAINS(${sourceIds}, JSON_QUOTE(CAST(node.${q(database, "id")} AS CHAR)))`;
  const jsonLength =
    database.dialect === "postgres"
      ? `jsonb_array_length(${sourceIds})`
      : `JSON_LENGTH(${sourceIds})`;
  return ` AND ${jsonLength} > 0 AND (SELECT COUNT(*) FROM ${q(
    database,
    "knowledge_nodes",
  )} node WHERE node.${q(database, "knowledge_space_id")} = ${componentAlias}.${q(
    database,
    "knowledge_space_id",
  )} AND node.${q(database, "publication_generation_id")} = ${memberAlias}.${q(
    database,
    "generation_id",
  )} AND node.${q(database, "document_asset_id")} = ${memberAlias}.${q(
    database,
    "document_asset_id",
  )} AND ${nodeMembership} AND EXISTS (SELECT 1 FROM ${q(
    database,
    memberTableName,
  )} source_pm JOIN ${q(database, "index_projections")} source_ip ON source_ip.${q(
    database,
    "id",
  )} = source_pm.${q(database, "component_key")} AND source_ip.${q(
    database,
    "node_id",
  )} = node.${q(database, "id")} AND source_ip.${q(
    database,
    "knowledge_space_id",
  )} = node.${q(database, "knowledge_space_id")} AND source_ip.${q(
    database,
    "publication_generation_id",
  )} = node.${q(database, "publication_generation_id")} WHERE source_pm.${q(
    database,
    "tenant_id",
  )} = ${memberAlias}.${q(database, "tenant_id")} AND source_pm.${q(
    database,
    "knowledge_space_id",
  )} = ${memberAlias}.${q(database, "knowledge_space_id")} AND source_pm.${q(
    database,
    "publication_id",
  )} = ${memberAlias}.${q(database, "publication_id")} AND source_pm.${q(
    database,
    "generation_id",
  )} = ${memberAlias}.${q(database, "generation_id")} AND source_pm.${q(
    database,
    "document_asset_id",
  )} = ${memberAlias}.${q(database, "document_asset_id")} AND source_pm.${q(
    database,
    "component_type",
  )} = 'index-projection')) = ${jsonLength}`;
}

const bootstrapColumns = [
  "id",
  "tenant_id",
  "knowledge_space_id",
  "idempotency_key",
  "checkpoint",
  "run_state",
  "total_documents",
  "completed_documents",
  "worker_id",
  "lease_token",
  "lease_expires_at",
  "heartbeat_at",
  "last_error_code",
  "last_error_message",
  "row_version",
  "published_publication_id",
  "published_fingerprint",
  "published_head_revision",
  "snapshot_metadata",
  "created_at",
  "updated_at",
  "completed_at",
] as const;

const bootstrapItemColumns = [
  "bootstrap_id",
  "document_asset_id",
  "document_version",
  "document_sha256",
  "ordinal",
  "compilation_attempt_id",
  "status",
  "last_error",
  "created_at",
  "updated_at",
] as const;

function bootstrapValues(job: LegacySpacePublicationBootstrap): DatabaseQueryValue[] {
  return [
    job.id,
    job.tenantId,
    job.knowledgeSpaceId,
    job.idempotencyKey,
    job.checkpoint,
    job.runState,
    job.totalDocuments,
    job.completedDocuments,
    job.workerId ?? null,
    job.leaseToken ?? null,
    job.leaseExpiresAt ?? null,
    job.heartbeatAt ?? null,
    job.lastErrorCode ?? null,
    job.lastErrorMessage ?? null,
    job.rowVersion,
    job.publishedPublicationId ?? null,
    job.publishedFingerprint ?? null,
    job.publishedHeadRevision ?? null,
    JSON.stringify(job.snapshotMetadata),
    job.createdAt,
    job.updatedAt,
    job.completedAt ?? null,
  ];
}

function bootstrapItemValues(item: LegacySpacePublicationBootstrapItem): DatabaseQueryValue[] {
  return [
    item.bootstrapId,
    item.documentAssetId,
    item.documentVersion,
    item.documentSha256,
    item.ordinal,
    item.compilationAttemptId ?? null,
    item.status,
    item.lastError ?? null,
    item.createdAt,
    item.updatedAt,
  ];
}

function mapBootstrapRow(row: DatabaseRow): LegacySpacePublicationBootstrap {
  return parseBootstrap({
    checkpoint: stringColumn(row, "checkpoint") as LegacySpacePublicationBootstrapCheckpoint,
    completedAt: optionalStringColumn(row, "completed_at"),
    completedDocuments: numberColumn(row, "completed_documents"),
    createdAt: stringColumn(row, "created_at"),
    heartbeatAt: optionalStringColumn(row, "heartbeat_at"),
    id: stringColumn(row, "id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    lastErrorCode: optionalStringColumn(row, "last_error_code"),
    lastErrorMessage: optionalStringColumn(row, "last_error_message"),
    leaseExpiresAt: optionalStringColumn(row, "lease_expires_at"),
    leaseToken: optionalStringColumn(row, "lease_token"),
    publishedFingerprint: optionalStringColumn(row, "published_fingerprint"),
    publishedHeadRevision: optionalNumberColumn(row, "published_head_revision"),
    publishedPublicationId: optionalStringColumn(row, "published_publication_id"),
    rowVersion: numberColumn(row, "row_version"),
    runState: stringColumn(row, "run_state") as LegacySpacePublicationBootstrapRunState,
    snapshotMetadata: jsonObjectColumn(row, "snapshot_metadata"),
    tenantId: stringColumn(row, "tenant_id"),
    totalDocuments: numberColumn(row, "total_documents"),
    updatedAt: stringColumn(row, "updated_at"),
    workerId: optionalStringColumn(row, "worker_id"),
  });
}

function mapBootstrapItemRow(row: DatabaseRow): LegacySpacePublicationBootstrapItem {
  return parseBootstrapItem({
    bootstrapId: stringColumn(row, "bootstrap_id"),
    compilationAttemptId: optionalStringColumn(row, "compilation_attempt_id"),
    createdAt: stringColumn(row, "created_at"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    documentSha256: stringColumn(row, "document_sha256"),
    documentVersion: numberColumn(row, "document_version"),
    lastError: optionalStringColumn(row, "last_error"),
    ordinal: numberColumn(row, "ordinal"),
    status: stringColumn(row, "status") as LegacySpacePublicationBootstrapItemStatus,
    updatedAt: stringColumn(row, "updated_at"),
  });
}

async function selectDocumentMutationLease(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenant: string,
  knowledgeSpaceId: string,
  id: string,
  leaseToken: string,
): Promise<DatabaseRow | undefined> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenant, knowledgeSpaceId, id, leaseToken],
    sql: `SELECT * FROM ${q(database, mutationLeaseTableName)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "lease_token")} = ${p(database, 4)} LIMIT 1;`,
    tableName: mutationLeaseTableName,
  });
  return result.rows[0];
}

function mapDocumentMutationLeaseRow(row: DatabaseRow): KnowledgeSpaceDocumentMutationLease {
  return {
    acquiredAt: DateTimeSchema.parse(stringColumn(row, "acquired_at")),
    expiresAt: DateTimeSchema.parse(stringColumn(row, "expires_at")),
    heartbeatAt: DateTimeSchema.parse(stringColumn(row, "heartbeat_at")),
    id: UuidSchema.parse(stringColumn(row, "id")),
    knowledgeSpaceId: UuidSchema.parse(stringColumn(row, "knowledge_space_id")),
    leaseToken: UuidSchema.parse(stringColumn(row, "lease_token")),
    operation: documentMutationOperation(stringColumn(row, "operation")),
    tenantId: tenantId(stringColumn(row, "tenant_id")),
  };
}

function parseBootstrap(raw: LegacySpacePublicationBootstrap): LegacySpacePublicationBootstrap {
  const checkpoint = enumValue(
    raw.checkpoint,
    LegacySpacePublicationBootstrapCheckpoints,
    "checkpoint",
  );
  const runState = enumValue(raw.runState, LegacySpacePublicationBootstrapRunStates, "runState");
  const totalDocuments = nonnegativeInteger(raw.totalDocuments, "totalDocuments");
  const completedDocuments = nonnegativeInteger(raw.completedDocuments, "completedDocuments");
  if (completedDocuments > totalDocuments) {
    throw new Error("Legacy publication bootstrap completedDocuments exceeds totalDocuments");
  }
  const job: LegacySpacePublicationBootstrap = {
    checkpoint,
    ...(raw.completedAt ? { completedAt: canonicalDateTime(raw.completedAt, "completedAt") } : {}),
    completedDocuments,
    createdAt: canonicalDateTime(raw.createdAt, "createdAt"),
    ...(raw.heartbeatAt ? { heartbeatAt: canonicalDateTime(raw.heartbeatAt, "heartbeatAt") } : {}),
    id: UuidSchema.parse(raw.id),
    idempotencyKey: requiredString(raw.idempotencyKey, "idempotencyKey", 255),
    knowledgeSpaceId: UuidSchema.parse(raw.knowledgeSpaceId),
    ...(raw.lastErrorCode
      ? { lastErrorCode: requiredString(raw.lastErrorCode, "lastErrorCode", 64) }
      : {}),
    ...(raw.lastErrorMessage
      ? { lastErrorMessage: requiredString(raw.lastErrorMessage, "lastErrorMessage") }
      : {}),
    ...(raw.leaseExpiresAt
      ? { leaseExpiresAt: canonicalDateTime(raw.leaseExpiresAt, "leaseExpiresAt") }
      : {}),
    ...(raw.leaseToken ? { leaseToken: nonzeroUuid(raw.leaseToken, "leaseToken") } : {}),
    ...(raw.publishedFingerprint
      ? { publishedFingerprint: ProjectionSetFingerprintSchema.parse(raw.publishedFingerprint) }
      : {}),
    ...(raw.publishedHeadRevision !== undefined
      ? {
          publishedHeadRevision: positiveInteger(
            raw.publishedHeadRevision,
            "publishedHeadRevision",
          ),
        }
      : {}),
    ...(raw.publishedPublicationId
      ? { publishedPublicationId: UuidSchema.parse(raw.publishedPublicationId) }
      : {}),
    rowVersion: nonnegativeInteger(raw.rowVersion, "rowVersion"),
    runState,
    snapshotMetadata: structuredClone(raw.snapshotMetadata),
    tenantId: tenantId(raw.tenantId),
    totalDocuments,
    updatedAt: canonicalDateTime(raw.updatedAt, "updatedAt"),
    ...(raw.workerId ? { workerId: requiredString(raw.workerId, "workerId", 255) } : {}),
  };
  validateBootstrapLifecycle(job);
  return job;
}

function parseBootstrapItem(
  raw: LegacySpacePublicationBootstrapItem,
): LegacySpacePublicationBootstrapItem {
  const sha = raw.documentSha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(sha)) {
    throw new Error("Legacy publication bootstrap documentSha256 must be lowercase SHA-256");
  }
  return {
    bootstrapId: UuidSchema.parse(raw.bootstrapId),
    ...(raw.compilationAttemptId
      ? { compilationAttemptId: UuidSchema.parse(raw.compilationAttemptId) }
      : {}),
    createdAt: canonicalDateTime(raw.createdAt, "createdAt"),
    documentAssetId: UuidSchema.parse(raw.documentAssetId),
    documentSha256: sha,
    documentVersion: positiveInteger(raw.documentVersion, "documentVersion"),
    ...(raw.lastError ? { lastError: requiredString(raw.lastError, "lastError") } : {}),
    ordinal: nonnegativeInteger(raw.ordinal, "ordinal"),
    status: enumValue(raw.status, LegacySpacePublicationBootstrapItemStatuses, "itemStatus"),
    updatedAt: canonicalDateTime(raw.updatedAt, "updatedAt"),
  };
}

function validateBootstrapLifecycle(job: LegacySpacePublicationBootstrap): void {
  const hasLease = Boolean(job.workerId && job.leaseToken && job.leaseExpiresAt && job.heartbeatAt);
  if ((job.runState === "running") !== hasLease) {
    throw new Error("Legacy publication bootstrap has an invalid lease lifecycle");
  }
  const terminal = ["succeeded", "failed", "canceled"].includes(job.runState);
  if (terminal !== Boolean(job.completedAt)) {
    throw new Error("Legacy publication bootstrap has an invalid terminal lifecycle");
  }
  if (job.runState === "succeeded") {
    if (
      job.checkpoint !== "published" ||
      job.completedDocuments !== job.totalDocuments ||
      (job.totalDocuments > 0 &&
        (!job.publishedPublicationId || !job.publishedFingerprint || !job.publishedHeadRevision))
    ) {
      throw new Error("Succeeded legacy publication bootstrap has no complete publication");
    }
  }
}

function normalizeStartInput(
  input: StartLegacySpacePublicationBootstrapInput,
): StartLegacySpacePublicationBootstrapInput {
  return {
    createdAt: canonicalDateTime(input.createdAt, "createdAt"),
    id: UuidSchema.parse(input.id),
    idempotencyKey: requiredString(input.idempotencyKey, "idempotencyKey", 255),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    tenantId: tenantId(input.tenantId),
  };
}

function withoutLease(job: LegacySpacePublicationBootstrap): LegacySpacePublicationBootstrap {
  return {
    ...job,
    heartbeatAt: undefined,
    leaseExpiresAt: undefined,
    leaseToken: undefined,
    workerId: undefined,
  };
}

function validateClaimInput(
  input: ClaimLegacySpacePublicationBootstrapsInput,
  maxClaimBatchSize: number,
): void {
  positiveInteger(input.limit, "limit");
  if (input.limit > maxClaimBatchSize) {
    throw new Error(
      `Legacy publication bootstrap claim exceeds maxClaimBatchSize=${maxClaimBatchSize}`,
    );
  }
}

function cloneBootstrap(job: LegacySpacePublicationBootstrap): LegacySpacePublicationBootstrap {
  return structuredClone(job);
}

function canonicalDateTime(value: string, name: string): string {
  const parsed = DateTimeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Legacy publication bootstrap ${name} must be an ISO date-time`);
  }
  return parsed.data;
}

function tenantId(value: string): string {
  return TenantIdSchema.parse(value.trim());
}

function requiredString(value: string, name: string, maxLength?: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Legacy publication bootstrap ${name} is required`);
  }
  if (maxLength !== undefined && normalized.length > maxLength) {
    throw new Error(`Legacy publication bootstrap ${name} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Legacy publication bootstrap ${name} must be a positive integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Legacy publication bootstrap ${name} must be a non-negative integer`);
  }
  return value;
}

function nonzeroUuid(value: string, name: string): string {
  const id = UuidSchema.parse(value);
  if (id === "00000000-0000-0000-0000-000000000000") {
    throw new Error(`Legacy publication bootstrap ${name} must not be the zero UUID`);
  }
  return id;
}

function enumValue<const Values extends readonly string[]>(
  value: string,
  values: Values,
  name: string,
): Values[number] {
  if (!(values as readonly string[]).includes(value)) {
    throw new Error(`Legacy publication bootstrap ${name} is invalid`);
  }
  return value as Values[number];
}

function requiredRow(row: DatabaseRow | undefined, name: string): DatabaseRow {
  if (!row) {
    throw new LegacySpacePublicationBootstrapVerificationError(`${name} query returned no row`);
  }
  return row;
}

function q(database: DatabaseAdapter, name: string): string {
  return quoteDatabaseIdentifier(database, name);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}
import { randomUUID } from "node:crypto";
