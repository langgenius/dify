import { randomUUID } from "node:crypto";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";

import { candidatePermissionScopeAllows } from "./candidate-content-authorization";
import {
  numberColumn,
  optionalNumberColumn,
  optionalStringColumn,
  stringColumn,
} from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import type { DurableDeletionFingerprinter } from "./durable-deletion-fingerprinter";
import { jsonObjectColumn, jsonStringArrayColumn } from "./json-utils";
import { assertDatabaseKnowledgeSpacePermissionFence } from "./knowledge-space-access-control";
import {
  SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY,
  type SourceDocumentWorkflowOwnership,
  sourceWorkflowOwnershipMatches,
} from "./source-document-workflow-ownership";

export const DurableDeletionTargetTypes = [
  "knowledge_space",
  "source",
  "document_asset",
  "logical_document",
] as const;
export type DurableDeletionTargetType = (typeof DurableDeletionTargetTypes)[number];

export const DurableDeletionModes = ["cascade", "keep"] as const;
export type DurableDeletionMode = (typeof DurableDeletionModes)[number];

export const DurableDeletionCheckpoints = [
  "requested",
  "quiescing",
  "deleting_objects",
  "deleting_derived_data",
  "deleting_primary_data",
  "completed",
] as const;
export type DurableDeletionCheckpoint = (typeof DurableDeletionCheckpoints)[number];

export const DurableDeletionRunStates = [
  "dispatch_pending",
  "queued",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type DurableDeletionRunState = (typeof DurableDeletionRunStates)[number];

export const DurableDeletionItemKinds = [
  "object",
  "secret_ref",
  "cache_key",
  "document_cascade",
  "document_detach",
] as const;
export type DurableDeletionItemKind = (typeof DurableDeletionItemKinds)[number];

export const DurableDeletionItemStatuses = ["pending", "retry_wait", "completed", "dead"] as const;
export type DurableDeletionItemStatus = (typeof DurableDeletionItemStatuses)[number];

export const DurableDeletionRetryAuthorities = [
  "original_requester",
  "interactive_owner_rescue",
] as const;
export type DurableDeletionRetryAuthority = (typeof DurableDeletionRetryAuthorities)[number];

export const DurableDeletionOutboxStatuses = [
  "pending",
  "dispatching",
  "dispatched",
  "leased",
  "completed",
  "canceled",
  "dead",
] as const;
export type DurableDeletionOutboxStatus = (typeof DurableDeletionOutboxStatuses)[number];

export const DurableDeletionTombstoneStates = ["active", "completed"] as const;
export type DurableDeletionTombstoneState = (typeof DurableDeletionTombstoneStates)[number];

export const DurableDeletionOutboxEventType = "deletion.job" as const;
export const DurableDeletionOutboxSchemaVersion = 1 as const;

export interface DurableDeletionPermissionProvenance {
  readonly accessChannel: "interactive" | "service_api" | "mcp" | "agent";
  readonly apiKeyExpiresAt?: string | undefined;
  readonly apiKeyId?: string | undefined;
  readonly apiKeyRevision?: number | undefined;
  readonly permissionSnapshotId: string;
  readonly permissionSnapshotRevision: number;
  readonly requestedBySubjectId: string;
}

export interface DurableDeletionJob extends DurableDeletionPermissionProvenance {
  readonly activeSlot?: 1 | undefined;
  readonly checkpoint: DurableDeletionCheckpoint;
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly deleteMode: DurableDeletionMode;
  readonly executionAttempts: number;
  readonly heartbeatAt?: string | undefined;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly inventoryComplete: boolean;
  readonly knowledgeSpaceId: string;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly maxExecutionAttempts: number;
  readonly nameChallengeDigest?: string | undefined;
  readonly queueJobId?: string | undefined;
  readonly requestFingerprint: string;
  readonly retryAt?: string | undefined;
  readonly rowVersion: number;
  readonly runState: DurableDeletionRunState;
  readonly scanCursor?: string | undefined;
  readonly scanPhase?: string | undefined;
  readonly startedAt?: string | undefined;
  readonly targetId: string;
  readonly targetRevision: number;
  readonly targetType: DurableDeletionTargetType;
  readonly tenantId: string;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
}

export interface DurableDeletionJobItem {
  readonly attempts: number;
  readonly cacheKey?: string | undefined;
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly credentialRef?: string | undefined;
  readonly deletionJobId: string;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly kind: DurableDeletionItemKind;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly maxAttempts: number;
  readonly nextAttemptAt?: string | undefined;
  readonly objectKey?: string | undefined;
  readonly ordinal: number;
  readonly payloadDigest: string;
  readonly redactedAt?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly rowVersion: number;
  readonly status: DurableDeletionItemStatus;
  readonly updatedAt: string;
}

export interface DurableDeletionOutboxEvent {
  readonly availableAt: string;
  readonly createdAt: string;
  readonly deletionJobId: string;
  readonly deliveredAt?: string | undefined;
  readonly deliveryRevision: number;
  readonly dispatchAttempts: number;
  readonly eventType: typeof DurableDeletionOutboxEventType;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly lastError?: string | undefined;
  readonly lockedBy?: string | undefined;
  readonly lockedUntil?: string | undefined;
  readonly lockToken?: string | undefined;
  readonly payload: { readonly deletionJobId: string };
  readonly queueJobId?: string | undefined;
  readonly requestFingerprint: string;
  readonly requestIdempotencyKey: string;
  readonly schemaVersion: typeof DurableDeletionOutboxSchemaVersion;
  readonly status: DurableDeletionOutboxStatus;
  readonly updatedAt: string;
}

export interface DurableDeletionTombstone {
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly deletionJobId: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly rowVersion: number;
  readonly state: DurableDeletionTombstoneState;
  readonly targetId: string;
  readonly targetRevision: number;
  readonly targetType: DurableDeletionTargetType;
  readonly tenantId: string;
}

export interface DurableDeletionLeaseFence {
  readonly deletionJobId: string;
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly now: string;
}

interface RequestDurableDeletionBase extends DurableDeletionPermissionProvenance {
  readonly createdAt: string;
  readonly idempotencyKey: string;
  /** Stable digest of a containing logical request (for example, a canonical bulk batch). */
  readonly idempotencyContext?: string | undefined;
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface RequestKnowledgeSpaceDeletionInput extends RequestDurableDeletionBase {
  readonly expectedRevision: number;
  readonly nameChallenge: string;
}

export interface RequestSourceDeletionInput extends RequestDurableDeletionBase {
  readonly deleteMode: DurableDeletionMode;
  readonly expectedVersion: number;
  readonly sourceId: string;
}

export interface RequestDocumentDeletionInput extends RequestDurableDeletionBase {
  readonly documentAssetId: string;
  readonly expectedDocumentVersion: number;
  /**
   * Internal, atomically revalidated proof for cleanup of a failed Source materialization.
   * HTTP callers never populate this capability.
   */
  readonly failedSourceMaterialization?:
    | {
        readonly documentId: string;
        readonly ownership: SourceDocumentWorkflowOwnership;
        readonly revision: number;
        readonly sourceId: string;
      }
    | undefined;
}

export interface RequestLogicalDocumentDeletionInput extends RequestDurableDeletionBase {
  readonly documentId: string;
  readonly expectedDocumentRowVersion: number;
}

export interface RequestDurableDeletionResult {
  readonly created: boolean;
  readonly job: DurableDeletionJob;
  readonly outbox: DurableDeletionOutboxEvent;
  readonly tombstone: DurableDeletionTombstone;
}

export interface ClaimDurableDeletionJobsInput {
  readonly leaseExpiresAt: string;
  readonly limit: number;
  readonly now: string;
  readonly workerId: string;
}

export interface HeartbeatDurableDeletionJobInput extends DurableDeletionLeaseFence {
  readonly leaseExpiresAt: string;
  readonly workerId: string;
}

export interface DurableDeletionInventoryItemInput {
  readonly cacheKey?: string | undefined;
  readonly credentialRef?: string | undefined;
  readonly idempotencyKey: string;
  readonly kind: DurableDeletionItemKind;
  readonly maxAttempts: number;
  readonly objectKey?: string | undefined;
  readonly ordinal: number;
  readonly resourceId?: string | undefined;
}

export interface AppendDurableDeletionInventoryInput extends DurableDeletionLeaseFence {
  readonly inventoryComplete: boolean;
  readonly items: readonly DurableDeletionInventoryItemInput[];
  /**
   * Atomically drops every scan-produced item (ordinal >= 1) before updating the cursor. This is
   * only used when the post-inventory drain probe detects a late writer. The direct-document raw
   * object at ordinal 0 remains durable while the complete external inventory is rebuilt.
   */
  readonly resetExistingInventory?: boolean | undefined;
  readonly scanCursor?: string | undefined;
  readonly scanPhase: string;
}

export interface ClaimDurableDeletionItemsInput extends DurableDeletionLeaseFence {
  readonly limit: number;
}

export interface CompleteDurableDeletionItemInput extends DurableDeletionLeaseFence {
  readonly expectedItemRowVersion: number;
  readonly itemId: string;
}

export interface ScheduleDurableDeletionItemRetryInput extends CompleteDurableDeletionItemInput {
  readonly deadLetter?: boolean | undefined;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly retryAt: string;
}

export interface AdvanceDurableDeletionCheckpointInput extends DurableDeletionLeaseFence {
  readonly nextCheckpoint: Exclude<DurableDeletionCheckpoint, "completed">;
}

export interface ScheduleDurableDeletionRetryInput extends DurableDeletionLeaseFence {
  readonly errorCode: string;
  readonly errorMessage: string;
  /**
   * Resets the consecutive execution-attempt budget after a lease made bounded forward progress.
   * This is reserved for cooperative yield, never waits or actual errors.
   */
  readonly resetExecutionAttempts?: boolean | undefined;
  readonly retryAt: string;
}

export interface FailDurableDeletionExecutionInput extends DurableDeletionLeaseFence {
  readonly errorCode: string;
  readonly errorMessage: string;
}

export interface CompleteDurableDeletionJobInput extends DurableDeletionLeaseFence {
  /**
   * Runs inside the same transaction that locks the fenced job, completes the tombstone, and marks
   * the job succeeded. The callback must delete target primary rows and prove scoped DB residue is
   * absent using only the provided transaction. Throwing or returning clean=false rolls back all
   * primary deletion, including cascaded ACL rows.
   */
  readonly deleteAndProbePrimaryData: (input: {
    readonly job: DurableDeletionJob;
    readonly transaction: DatabaseExecutor;
  }) => Promise<{ readonly clean: boolean }>;
}

export type ReconcileDirtyPrimaryDeletionInput = DurableDeletionLeaseFence;

export interface RetryFailedDurableDeletionJobInput extends DurableDeletionPermissionProvenance {
  readonly expectedRowVersion?: number | undefined;
  readonly idempotencyKey: string;
  readonly jobId: string;
  readonly now: string;
  /** The original deletion request fingerprint returned by the status service. */
  readonly requestFingerprint: string;
  /** Binds the retry to either the stable requester or a freshly-authorized interactive owner. */
  readonly retryAuthority: DurableDeletionRetryAuthority;
  readonly tenantId: string;
}

export interface ClaimDurableDeletionOutboxInput {
  readonly limit: number;
  readonly lockedUntil: string;
  readonly lockToken: string;
  readonly now: string;
  readonly workerId: string;
}

export interface MarkDurableDeletionOutboxDispatchedInput {
  readonly deliveredAt: string;
  readonly lockToken: string;
  readonly now: string;
  readonly outboxId: string;
  readonly queueJobId: string;
}

export interface ReleaseDurableDeletionOutboxInput {
  readonly availableAt: string;
  readonly deadLetter?: boolean | undefined;
  readonly error: string;
  readonly lockToken: string;
  readonly now: string;
  readonly outboxId: string;
}

export interface DurableDeletionRepository {
  advanceCheckpoint(
    input: AdvanceDurableDeletionCheckpointInput,
  ): Promise<DurableDeletionJob | null>;
  appendInventory(input: AppendDurableDeletionInventoryInput): Promise<DurableDeletionJob | null>;
  claimItems(input: ClaimDurableDeletionItemsInput): Promise<readonly DurableDeletionJobItem[]>;
  claimJobs(input: ClaimDurableDeletionJobsInput): Promise<readonly DurableDeletionJob[]>;
  claimOutbox(
    input: ClaimDurableDeletionOutboxInput,
  ): Promise<readonly DurableDeletionOutboxEvent[]>;
  completeItem(input: CompleteDurableDeletionItemInput): Promise<DurableDeletionJobItem | null>;
  completeJob(input: CompleteDurableDeletionJobInput): Promise<DurableDeletionJob | null>;
  /** Fenced rollback to quiescing when a late writer makes the final residue proof dirty. */
  reconcileDirtyPrimary(
    input: ReconcileDirtyPrimaryDeletionInput,
  ): Promise<DurableDeletionJob | null>;
  getJob(input: {
    readonly id: string;
    readonly tenantId: string;
  }): Promise<DurableDeletionJob | null>;
  getJobByIdempotency(input: {
    readonly idempotencyKey: string;
    readonly tenantId: string;
  }): Promise<DurableDeletionJob | null>;
  getTombstone(input: {
    readonly knowledgeSpaceId?: string | undefined;
    readonly targetId: string;
    readonly targetType: DurableDeletionTargetType;
    readonly tenantId: string;
  }): Promise<DurableDeletionTombstone | null>;
  /** Exact, bounded lookup used to let only the recorded owner-rescue actor monitor takeover. */
  hasRetryAuditActor(input: {
    readonly jobId: string;
    readonly subjectId: string;
    readonly tenantId: string;
  }): Promise<boolean>;
  failJob(input: FailDurableDeletionExecutionInput): Promise<DurableDeletionJob | null>;
  heartbeatJob(input: HeartbeatDurableDeletionJobInput): Promise<DurableDeletionJob | null>;
  markOutboxDispatched(
    input: MarkDurableDeletionOutboxDispatchedInput,
  ): Promise<DurableDeletionOutboxEvent | null>;
  releaseOutbox(
    input: ReleaseDurableDeletionOutboxInput,
  ): Promise<DurableDeletionOutboxEvent | null>;
  retryFailedJob(input: RetryFailedDurableDeletionJobInput): Promise<RequestDurableDeletionResult>;
  requestDocumentDeletion(
    input: RequestDocumentDeletionInput,
  ): Promise<RequestDurableDeletionResult>;
  requestKnowledgeSpaceDeletion(
    input: RequestKnowledgeSpaceDeletionInput,
  ): Promise<RequestDurableDeletionResult>;
  requestSourceDeletion(input: RequestSourceDeletionInput): Promise<RequestDurableDeletionResult>;
  requestLogicalDocumentDeletion(
    input: RequestLogicalDocumentDeletionInput,
  ): Promise<RequestDurableDeletionResult>;
  scheduleItemRetry(
    input: ScheduleDurableDeletionItemRetryInput,
  ): Promise<DurableDeletionJobItem | null>;
  scheduleJobRetry(input: ScheduleDurableDeletionRetryInput): Promise<DurableDeletionJob | null>;
}

export interface DatabaseDurableDeletionRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly fingerprinter: DurableDeletionFingerprinter;
  readonly generateItemId?: (() => string) | undefined;
  readonly generateJobId?: (() => string) | undefined;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly generateOutboxId?: (() => string) | undefined;
  readonly generateRetryAuditId?: (() => string) | undefined;
  readonly generateTombstoneId?: (() => string) | undefined;
  readonly maxClaimBatchSize?: number | undefined;
  readonly maxExecutionAttempts?: number | undefined;
  readonly maxInventoryBatchSize?: number | undefined;
}

export class DurableDeletionIdempotencyConflictError extends Error {
  constructor() {
    super("Durable deletion idempotency key was reused with a different request");
    this.name = "DurableDeletionIdempotencyConflictError";
  }
}

export class DurableDeletionTargetConflictError extends Error {
  constructor(message = "Durable deletion target is already deleting or deleted") {
    super(message);
    this.name = "DurableDeletionTargetConflictError";
  }
}

export class DurableDeletionTargetRevisionConflictError extends Error {
  constructor() {
    super("Durable deletion target revision is stale");
    this.name = "DurableDeletionTargetRevisionConflictError";
  }
}

export class DurableDeletionPermissionFenceError extends Error {
  constructor() {
    super("Durable deletion permission is no longer valid for this source");
    this.name = "DurableDeletionPermissionFenceError";
  }
}

export class DurableDeletionNameChallengeMismatchError extends Error {
  constructor() {
    super("Durable deletion knowledge-space name challenge does not match");
    this.name = "DurableDeletionNameChallengeMismatchError";
  }
}

export class DurableDeletionCheckpointConflictError extends Error {
  constructor(message = "Durable deletion checkpoint transition is invalid") {
    super(message);
    this.name = "DurableDeletionCheckpointConflictError";
  }
}

export class DurableDeletionPrimaryResidueDirtyError extends DurableDeletionCheckpointConflictError {
  constructor() {
    super("Durable deletion primary-data residue probe is not clean");
    this.name = "DurableDeletionPrimaryResidueDirtyError";
  }
}

const jobTable = "deletion_jobs";
const itemTable = "deletion_job_items";
const outboxTable = "deletion_outbox";
const tombstoneTable = "deletion_tombstones";

export function createDatabaseDurableDeletionRepository({
  database,
  fingerprinter,
  generateItemId = randomUUID,
  generateJobId = randomUUID,
  generateLeaseToken = randomUUID,
  generateOutboxId = randomUUID,
  generateRetryAuditId = randomUUID,
  generateTombstoneId = randomUUID,
  maxClaimBatchSize = 100,
  maxExecutionAttempts = 10,
  maxInventoryBatchSize = 500,
}: DatabaseDurableDeletionRepositoryOptions): DurableDeletionRepository {
  if (typeof fingerprinter !== "function") {
    throw new Error("Durable deletion fingerprinter is required");
  }
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");
  positiveInteger(maxExecutionAttempts, "maxExecutionAttempts");
  positiveInteger(maxInventoryBatchSize, "maxInventoryBatchSize");

  const request = async (
    input:
      | RequestKnowledgeSpaceDeletionInput
      | RequestSourceDeletionInput
      | RequestDocumentDeletionInput
      | RequestLogicalDocumentDeletionInput,
    target:
      | { readonly type: "knowledge_space" }
      | { readonly sourceId: string; readonly type: "source" }
      | { readonly documentAssetId: string; readonly type: "document_asset" }
      | { readonly documentId: string; readonly type: "logical_document" },
  ): Promise<RequestDurableDeletionResult> => {
    const common = normalizeRequestBase(input);
    const failedSourceMaterialization =
      target.type === "document_asset"
        ? normalizeFailedSourceMaterializationProof(
            (input as RequestDocumentDeletionInput).failedSourceMaterialization,
          )
        : undefined;
    const requestIdentity =
      target.type === "knowledge_space"
        ? {
            deleteMode: "cascade" as const,
            expectedRevision: positiveInteger(
              (input as RequestKnowledgeSpaceDeletionInput).expectedRevision,
              "expectedRevision",
            ),
            nameChallengeDigest: fingerprintValue(
              fingerprinter({
                knowledgeSpaceId: common.knowledgeSpaceId,
                operationKey: common.idempotencyKey,
                purpose: "name_challenge",
                tenantId: common.tenantId,
                value: (input as RequestKnowledgeSpaceDeletionInput).nameChallenge,
              }),
              "name challenge",
            ),
            targetId: common.knowledgeSpaceId,
          }
        : target.type === "source"
          ? {
              deleteMode: normalizeDeleteMode(
                (input as RequestSourceDeletionInput).deleteMode,
                true,
              ),
              expectedRevision: positiveInteger(
                (input as RequestSourceDeletionInput).expectedVersion,
                "expectedVersion",
              ),
              targetId: requiredString(target.sourceId, "sourceId"),
            }
          : target.type === "logical_document"
            ? {
                deleteMode: "cascade" as const,
                expectedRevision: positiveInteger(
                  (input as RequestLogicalDocumentDeletionInput).expectedDocumentRowVersion,
                  "expectedDocumentRowVersion",
                ),
                targetId: requiredString(target.documentId, "documentId"),
              }
            : {
                deleteMode: "cascade" as const,
                expectedRevision: positiveInteger(
                  (input as RequestDocumentDeletionInput).expectedDocumentVersion,
                  "expectedDocumentVersion",
                ),
                targetId: requiredString(target.documentAssetId, "documentAssetId"),
              };
    const requestFingerprint = fingerprintValue(
      fingerprinter({
        knowledgeSpaceId: common.knowledgeSpaceId,
        operationKey: common.idempotencyKey,
        purpose: "request_payload",
        tenantId: common.tenantId,
        value: JSON.stringify({
          accessChannel: common.accessChannel,
          apiKeyExpiresAt: common.apiKeyExpiresAt ?? null,
          apiKeyId: common.apiKeyId ?? null,
          apiKeyRevision: common.apiKeyRevision ?? null,
          deleteMode: requestIdentity.deleteMode,
          expectedRevision: requestIdentity.expectedRevision,
          ...(failedSourceMaterialization ? { failedSourceMaterialization } : {}),
          ...(common.idempotencyContext === undefined
            ? {}
            : { idempotencyContext: common.idempotencyContext }),
          knowledgeSpaceId: common.knowledgeSpaceId,
          nameChallengeDigest:
            "nameChallengeDigest" in requestIdentity ? requestIdentity.nameChallengeDigest : null,
          requestedBySubjectId: common.requestedBySubjectId,
          targetId: requestIdentity.targetId,
          targetType: target.type,
          tenantId: common.tenantId,
        }),
      }),
      "request",
    );

    return database.transaction(async (transaction) => {
      const replay = await getJobByIdempotency(
        database,
        transaction,
        common.tenantId,
        common.idempotencyKey,
        false,
      );
      if (replay) {
        assertMatchingRequest(replay, requestFingerprint);
        return existingRequestResult(database, transaction, replay);
      }

      const space = await lockSpace(
        database,
        transaction,
        common.tenantId,
        common.knowledgeSpaceId,
      );
      if (!space) {
        throw new DurableDeletionTargetRevisionConflictError();
      }

      // Waiting for the stable space lock can race the first request. Re-read the tenant-global
      // idempotency ledger before observing lifecycle state so identical retries remain replayable.
      const replayAfterLock = await getJobByIdempotency(
        database,
        transaction,
        common.tenantId,
        common.idempotencyKey,
        true,
      );
      if (replayAfterLock) {
        assertMatchingRequest(replayAfterLock, requestFingerprint);
        return existingRequestResult(database, transaction, replayAfterLock);
      }

      // Source and logical-document final acts reuse the immutable durable permission issued to
      // the request/workflow. Lock authorization before their mutable targets so revocation and
      // source-scope changes cannot win a check-to-act race or invert the global lock order.
      const finalPermission =
        target.type === "source" || target.type === "logical_document"
          ? await assertDatabaseKnowledgeSpacePermissionFence({
              database,
              executor: transaction,
              fence: {
                accessChannel: common.accessChannel,
                knowledgeSpaceId: common.knowledgeSpaceId,
                permissionSnapshotId: common.permissionSnapshotId,
                permissionSnapshotRevision: common.permissionSnapshotRevision,
                requestedBySubjectId: common.requestedBySubjectId,
                tenantId: common.tenantId,
              },
              now: common.createdAt,
              requiredAccess: "write",
            })
          : undefined;

      const targetId = requestIdentity.targetId;
      let targetRevision: number;
      let rawObjectKey: string | undefined;
      let documentVersion: number | undefined;

      if (target.type === "knowledge_space") {
        const requestInput = input as RequestKnowledgeSpaceDeletionInput;
        if (requestInput.nameChallenge !== space.name) {
          throw new DurableDeletionNameChallengeMismatchError();
        }
        if (requestIdentity.expectedRevision !== space.revision) {
          throw new DurableDeletionTargetRevisionConflictError();
        }
        await assertNoActiveChildDeletion(database, transaction, {
          knowledgeSpaceId: common.knowledgeSpaceId,
          targetType: "knowledge_space",
          tenantId: common.tenantId,
        });
        targetRevision = space.revision;
      } else if (target.type === "source") {
        assertActiveSpace(space);
        const source = await lockSource(database, transaction, common.knowledgeSpaceId, targetId);
        if (!source || source.version !== requestIdentity.expectedRevision) {
          throw new DurableDeletionTargetRevisionConflictError();
        }
        if (
          !finalPermission ||
          !candidatePermissionScopeAllows(source.permissionScope, finalPermission.permissionScopes)
        ) {
          throw new DurableDeletionPermissionFenceError();
        }
        if (source.status === "deleting" || source.deletionJobId) {
          throw new DurableDeletionTargetConflictError();
        }
        await assertNoActiveChildDeletion(database, transaction, {
          knowledgeSpaceId: common.knowledgeSpaceId,
          sourceId: targetId,
          targetType: "source",
          tenantId: common.tenantId,
        });
        targetRevision = source.version;
      } else if (target.type === "logical_document") {
        assertActiveSpace(space);
        const document = await lockLogicalDocument(
          database,
          transaction,
          common.tenantId,
          common.knowledgeSpaceId,
          targetId,
        );
        if (!document || document.rowVersion !== requestIdentity.expectedRevision) {
          throw new DurableDeletionTargetRevisionConflictError();
        }
        if (document.status === "deleting") {
          throw new DurableDeletionTargetConflictError();
        }
        if (document.sourceId) {
          const parentSource = await lockSource(
            database,
            transaction,
            common.knowledgeSpaceId,
            document.sourceId,
          );
          if (parentSource?.status === "deleting" || parentSource?.deletionJobId) {
            throw new DurableDeletionTargetConflictError(
              `Logical document deletion is blocked by parent source deletion ${parentSource.deletionJobId ?? "in progress"}`,
            );
          }
        }
        await assertNoActiveChildDeletion(database, transaction, {
          documentId: targetId,
          knowledgeSpaceId: common.knowledgeSpaceId,
          targetType: "logical_document",
          tenantId: common.tenantId,
        });
        targetRevision = document.rowVersion;
      } else {
        assertActiveSpace(space);
        const document = await lockDocument(
          database,
          transaction,
          common.knowledgeSpaceId,
          targetId,
        );
        if (!document || document.version !== requestIdentity.expectedRevision) {
          throw new DurableDeletionTargetRevisionConflictError();
        }
        if (document.lifecycleState !== "active" || document.deletionJobId) {
          throw new DurableDeletionTargetConflictError();
        }
        if (document.sourceId) {
          const parentSource = await lockSource(
            database,
            transaction,
            common.knowledgeSpaceId,
            document.sourceId,
          );
          if (parentSource?.status === "deleting" || parentSource?.deletionJobId) {
            throw new DurableDeletionTargetConflictError(
              `Document deletion is blocked by parent source deletion ${parentSource.deletionJobId ?? "in progress"}`,
            );
          }
        }
        if (failedSourceMaterialization) {
          await assertFailedSourceMaterializationDeletionProof({
            asset: document,
            database,
            documentAssetId: targetId,
            documentAssetVersion: document.version,
            knowledgeSpaceId: common.knowledgeSpaceId,
            proof: failedSourceMaterialization,
            tenantId: common.tenantId,
            transaction,
          });
        }
        targetRevision = document.rowVersion;
        rawObjectKey = document.objectKey;
        documentVersion = document.version;
      }

      assertActiveSpace(space);
      const existingTombstone = await getTombstoneRow(
        database,
        transaction,
        { targetId, targetType: target.type, tenantId: common.tenantId },
        true,
      );
      if (existingTombstone) {
        throw new DurableDeletionTargetConflictError();
      }

      const jobId = generateJobId();
      const tombstoneId = generateTombstoneId();
      const outboxId = generateOutboxId();
      const job = initialJob({
        ...common,
        deleteMode: requestIdentity.deleteMode,
        id: jobId,
        maxExecutionAttempts,
        ...(target.type === "knowledge_space"
          ? { nameChallengeDigest: requestIdentity.nameChallengeDigest }
          : {}),
        requestFingerprint,
        targetId,
        targetRevision,
        targetType: target.type,
      });
      const tombstone = initialTombstone({
        createdAt: common.createdAt,
        deletionJobId: jobId,
        id: tombstoneId,
        knowledgeSpaceId: common.knowledgeSpaceId,
        targetId,
        targetRevision,
        targetType: target.type,
        tenantId: common.tenantId,
      });
      const outbox = initialOutbox(outboxId, job);

      await insertJobForRequest(database, transaction, job);
      const insertedOrRaced = await getJobByIdempotency(
        database,
        transaction,
        common.tenantId,
        common.idempotencyKey,
        true,
      );
      if (!insertedOrRaced) {
        throw new Error("Durable deletion request insert was not observable");
      }
      if (insertedOrRaced.id !== job.id) {
        assertMatchingRequest(insertedOrRaced, requestFingerprint);
        return existingRequestResult(database, transaction, insertedOrRaced);
      }
      await insertTombstone(database, transaction, tombstone);
      await insertOutbox(database, transaction, outbox);
      if (target.type === "document_asset" && rawObjectKey) {
        const rawPayloadDigest = inventoryDigest(fingerprinter, job, {
          idempotencyKey: "raw-object",
          kind: "object",
          maxAttempts: maxExecutionAttempts,
          objectKey: rawObjectKey,
          ordinal: 0,
          resourceId: targetId,
        });
        await insertItem(
          database,
          transaction,
          initialItem(
            generateItemId(),
            job,
            {
              idempotencyKey: `raw-object:${rawPayloadDigest}`,
              kind: "object",
              maxAttempts: maxExecutionAttempts,
              objectKey: rawObjectKey,
              ordinal: 0,
              resourceId: targetId,
            },
            rawPayloadDigest,
          ),
        );
      }

      const marked = await markTargetDeleting(database, transaction, job, {
        ...(target.type === "document_asset" ? { expectedDocumentVersion: documentVersion } : {}),
      });
      if (marked !== 1) {
        throw new DurableDeletionTargetRevisionConflictError();
      }

      return {
        created: true,
        job: cloneJob(job),
        outbox: cloneOutbox(outbox),
        tombstone: cloneTombstone(tombstone),
      };
    });
  };

  return {
    requestKnowledgeSpaceDeletion: (input) => request(input, { type: "knowledge_space" }),
    requestSourceDeletion: (input) => request(input, { sourceId: input.sourceId, type: "source" }),
    requestDocumentDeletion: (input) =>
      request(input, { documentAssetId: input.documentAssetId, type: "document_asset" }),
    requestLogicalDocumentDeletion: (input) =>
      request(input, { documentId: input.documentId, type: "logical_document" }),
    getJob: async (input) =>
      getJobRow(
        database,
        database,
        requiredString(input.id, "job id"),
        false,
        requiredString(input.tenantId, "tenantId"),
      ),
    getJobByIdempotency: async (input) =>
      getJobByIdempotency(
        database,
        database,
        boundedString(input.tenantId, 255, "tenantId"),
        boundedString(input.idempotencyKey, 512, "idempotencyKey"),
        false,
      ),
    getTombstone: async (input) =>
      getTombstoneRow(
        database,
        database,
        {
          ...(input.knowledgeSpaceId
            ? { knowledgeSpaceId: requiredString(input.knowledgeSpaceId, "knowledgeSpaceId") }
            : {}),
          targetId: requiredString(input.targetId, "targetId"),
          targetType: enumValue(input.targetType, DurableDeletionTargetTypes, "targetType"),
          tenantId: requiredString(input.tenantId, "tenantId"),
        },
        false,
      ),
    hasRetryAuditActor: (input) => hasRetryAuditActor(database, input),
    claimJobs: (input) =>
      claimDeletionJobs(database, input, {
        generateLeaseToken,
        maxClaimBatchSize,
      }),
    heartbeatJob: (input) => heartbeatDeletionJob(database, input),
    appendInventory: (input) =>
      appendDeletionInventory(database, input, {
        fingerprinter,
        generateItemId,
        maxInventoryBatchSize,
      }),
    claimItems: (input) => claimDeletionItems(database, input, maxClaimBatchSize),
    completeItem: (input) => completeDeletionItem(database, input),
    scheduleItemRetry: (input) => scheduleDeletionItemRetry(database, input, fingerprinter),
    advanceCheckpoint: (input) => advanceDeletionCheckpoint(database, input),
    scheduleJobRetry: (input) => scheduleDeletionJobRetry(database, input, fingerprinter),
    completeJob: (input) => completeDeletionJob(database, input),
    reconcileDirtyPrimary: (input) => reconcileDirtyPrimaryDeletion(database, input),
    failJob: (input) => failDeletionJob(database, input, fingerprinter),
    retryFailedJob: (input) =>
      retryFailedDeletionJob(database, input, {
        fingerprinter,
        generateOutboxId,
        generateRetryAuditId,
      }),
    claimOutbox: (input) => claimDeletionOutbox(database, input, maxClaimBatchSize),
    markOutboxDispatched: (input) => markDeletionOutboxDispatched(database, input),
    releaseOutbox: (input) => releaseDeletionOutbox(database, input, fingerprinter),
  };
}

async function claimDeletionJobs(
  database: DatabaseAdapter,
  input: ClaimDurableDeletionJobsInput,
  options: {
    readonly generateLeaseToken: () => string;
    readonly maxClaimBatchSize: number;
  },
): Promise<readonly DurableDeletionJob[]> {
  const limit = positiveInteger(input.limit, "claimJobs.limit");
  if (limit > options.maxClaimBatchSize) {
    throw new Error(`Durable deletion claim limit exceeds ${options.maxClaimBatchSize}`);
  }
  const now = isoDate(input.now, "claimJobs.now");
  const leaseExpiresAt = isoDate(input.leaseExpiresAt, "claimJobs.leaseExpiresAt");
  if (Date.parse(leaseExpiresAt) <= Date.parse(now)) {
    throw new Error("Durable deletion leaseExpiresAt must be after now");
  }
  const workerId = boundedString(input.workerId, 255, "claimJobs.workerId");

  return database.transaction(async (transaction) => {
    // A worker can crash after consuming the final execution attempt. Such a
    // job is no longer claimable, so retire the expired lease before looking
    // for runnable work. Keeping this transition in the claim transaction
    // prevents an exhausted job (and its active tombstone) from being stranded
    // forever in `running`.
    const exhausted = await transaction.execute({
      maxRows: limit,
      operation: "select",
      params: [now, limit],
      sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(database, "run_state")} = 'running' AND ${q(database, "lease_expires_at")} <= ${p(database, 1)} AND ${q(database, "execution_attempts")} >= ${q(database, "max_execution_attempts")} ORDER BY ${q(database, "lease_expires_at")} ASC, ${q(database, "id")} ASC LIMIT ${p(database, 2)} FOR UPDATE${database.dialect === "postgres" ? " SKIP LOCKED" : ""};`,
      tableName: jobTable,
    });
    for (const row of exhausted.rows) {
      await failExpiredExhaustedDeletionJob(database, transaction, mapJob(row), now);
    }

    const selected = await transaction.execute({
      maxRows: limit,
      operation: "select",
      params: [now, limit],
      sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(database, "execution_attempts")} < ${q(database, "max_execution_attempts")} AND ((${q(database, "run_state")} = 'queued') OR (${q(database, "run_state")} = 'retry_wait' AND ${q(database, "retry_at")} <= ${p(database, 1)}) OR (${q(database, "run_state")} = 'running' AND ${q(database, "lease_expires_at")} <= ${p(database, 1)})) ORDER BY ${q(database, "created_at")} ASC, ${q(database, "id")} ASC LIMIT ${p(database, 2)} FOR UPDATE${database.dialect === "postgres" ? " SKIP LOCKED" : ""};`,
      tableName: jobTable,
    });
    const claimed: DurableDeletionJob[] = [];
    for (const row of selected.rows) {
      const current = mapJob(row);
      const leaseToken = requiredString(options.generateLeaseToken(), "generated lease token");
      const updated = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [
          workerId,
          leaseToken,
          leaseExpiresAt,
          now,
          current.executionAttempts + 1,
          current.rowVersion + 1,
          now,
          current.id,
          current.rowVersion,
        ],
        sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "run_state")} = 'running', ${q(database, "worker_id")} = ${p(database, 1)}, ${q(database, "lease_token")} = ${p(database, 2)}, ${q(database, "lease_expires_at")} = ${p(database, 3)}, ${q(database, "heartbeat_at")} = ${p(database, 4)}, ${q(database, "execution_attempts")} = ${p(database, 5)}, ${q(database, "row_version")} = ${p(database, 6)}, ${q(database, "updated_at")} = ${p(database, 7)}, ${q(database, "started_at")} = COALESCE(${q(database, "started_at")}, ${p(database, 7)}), ${q(database, "retry_at")} = NULL, ${q(database, "last_error_code")} = NULL, ${q(database, "last_error_message")} = NULL WHERE ${q(database, "id")} = ${p(database, 8)} AND ${q(database, "row_version")} = ${p(database, 9)};`,
        tableName: jobTable,
      });
      if (updated.rowsAffected !== 1) continue;
      // queued/retry_wait jobs are consuming the dispatcher-delivered event for the first time.
      // An expired running job already owns that same event in `leased`; reclaim must refresh and
      // reuse it rather than requiring a second delivery (or becoming permanently unclaimable).
      const expectedOutboxStatus = current.runState === "running" ? "leased" : "dispatched";
      const leasedOutbox = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [now, current.id, expectedOutboxStatus],
        sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = 'leased', ${q(database, "locked_by")} = NULL, ${q(database, "lock_token")} = NULL, ${q(database, "locked_until")} = NULL, ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 2)} AND ${q(database, "status")} = ${p(database, 3)};`,
        tableName: outboxTable,
      });
      if (leasedOutbox.rowsAffected !== 1) {
        throw new Error("Durable deletion claimed job did not lease exactly one outbox event");
      }
      const stored = await getJobRow(database, transaction, current.id, false);
      if (stored) claimed.push(stored);
    }
    return claimed;
  });
}

async function heartbeatDeletionJob(
  database: DatabaseAdapter,
  input: HeartbeatDurableDeletionJobInput,
): Promise<DurableDeletionJob | null> {
  const now = isoDate(input.now, "heartbeat.now");
  const leaseExpiresAt = isoDate(input.leaseExpiresAt, "heartbeat.leaseExpiresAt");
  if (Date.parse(leaseExpiresAt) <= Date.parse(now)) {
    throw new Error("Durable deletion heartbeat leaseExpiresAt must be after now");
  }
  return database.transaction(async (transaction) => {
    const current = await lockFencedJob(database, transaction, input);
    if (!current || current.workerId !== requiredString(input.workerId, "heartbeat.workerId")) {
      return null;
    }
    const result = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        leaseExpiresAt,
        now,
        current.rowVersion + 1,
        current.id,
        current.rowVersion,
        input.leaseToken,
        now,
      ],
      sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "lease_expires_at")} = ${p(database, 1)}, ${q(database, "heartbeat_at")} = ${p(database, 2)}, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(database, "row_version")} = ${p(database, 3)} WHERE ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "row_version")} = ${p(database, 5)} AND ${q(database, "lease_token")} = ${p(database, 6)} AND ${q(database, "lease_expires_at")} > ${p(database, 7)};`,
      tableName: jobTable,
    });
    return result.rowsAffected === 1 ? getJobRow(database, transaction, current.id, false) : null;
  });
}

async function appendDeletionInventory(
  database: DatabaseAdapter,
  input: AppendDurableDeletionInventoryInput,
  options: {
    readonly fingerprinter: DurableDeletionFingerprinter;
    readonly generateItemId: () => string;
    readonly maxInventoryBatchSize: number;
  },
): Promise<DurableDeletionJob | null> {
  if (input.items.length > options.maxInventoryBatchSize) {
    throw new Error(`Durable deletion inventory batch exceeds ${options.maxInventoryBatchSize}`);
  }
  const scanPhase = boundedString(input.scanPhase, 64, "inventory.scanPhase");
  const scanCursor = input.scanCursor
    ? boundedString(input.scanCursor, 1024, "inventory.scanCursor")
    : undefined;
  if (input.resetExistingInventory && (input.items.length > 0 || input.inventoryComplete)) {
    throw new Error("Durable deletion inventory reset must be empty and incomplete");
  }

  return database.transaction(async (transaction) => {
    const current = await lockFencedJob(database, transaction, input);
    if (!current || current.checkpoint !== "quiescing") return null;
    if (input.resetExistingInventory) {
      await transaction.execute({
        maxRows: 0,
        operation: "delete",
        params: [current.id],
        sql: `DELETE FROM ${q(database, itemTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)} AND ${q(database, "ordinal")} >= 1;`,
        tableName: itemTable,
      });
    }
    for (const rawItem of input.items) {
      const normalized = normalizeInventoryItem(rawItem);
      const payloadDigest = inventoryDigest(options.fingerprinter, current, normalized);
      const existing = await getItemByIdempotency(
        database,
        transaction,
        current.id,
        normalized.idempotencyKey,
        true,
      );
      if (existing) {
        if (existing.payloadDigest !== payloadDigest || existing.kind !== normalized.kind) {
          throw new DurableDeletionIdempotencyConflictError();
        }
        continue;
      }
      await insertItem(
        database,
        transaction,
        initialItem(
          requiredString(options.generateItemId(), "generated item id"),
          { ...current, createdAt: input.now },
          normalized,
          payloadDigest,
        ),
      );
    }
    const updated = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        scanPhase,
        scanCursor ?? null,
        input.inventoryComplete,
        input.now,
        current.rowVersion + 1,
        current.id,
        current.rowVersion,
        input.leaseToken,
        input.now,
      ],
      sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "scan_phase")} = ${p(database, 1)}, ${q(database, "scan_cursor")} = ${p(database, 2)}, ${q(database, "inventory_complete")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 4)}, ${q(database, "row_version")} = ${p(database, 5)} WHERE ${q(database, "id")} = ${p(database, 6)} AND ${q(database, "row_version")} = ${p(database, 7)} AND ${q(database, "lease_token")} = ${p(database, 8)} AND ${q(database, "lease_expires_at")} > ${p(database, 9)};`,
      tableName: jobTable,
    });
    if (updated.rowsAffected !== 1) {
      throw new Error("Durable deletion inventory lease fence was lost");
    }
    return getJobRow(database, transaction, current.id, false);
  });
}

async function claimDeletionItems(
  database: DatabaseAdapter,
  input: ClaimDurableDeletionItemsInput,
  maxClaimBatchSize: number,
): Promise<readonly DurableDeletionJobItem[]> {
  const limit = positiveInteger(input.limit, "claimItems.limit");
  if (limit > maxClaimBatchSize) {
    throw new Error(`Durable deletion item claim limit exceeds ${maxClaimBatchSize}`);
  }
  return database.transaction(async (transaction) => {
    const current = await lockFencedJob(database, transaction, input);
    if (!current) return [];
    const result = await transaction.execute({
      maxRows: limit,
      operation: "select",
      params: [current.id, input.now, limit],
      sql: `SELECT * FROM ${q(database, itemTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)} AND (${q(database, "status")} = 'pending' OR (${q(database, "status")} = 'retry_wait' AND ${q(database, "next_attempt_at")} <= ${p(database, 2)})) ORDER BY ${q(database, "ordinal")} ASC, ${q(database, "id")} ASC LIMIT ${p(database, 3)} FOR UPDATE${database.dialect === "postgres" ? " SKIP LOCKED" : ""};`,
      tableName: itemTable,
    });
    return result.rows.map(mapItem);
  });
}

async function lockFencedJob(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  input: DurableDeletionLeaseFence,
): Promise<DurableDeletionJob | null> {
  const now = isoDate(input.now, "fence.now");
  const job = await getJobRow(
    database,
    transaction,
    requiredString(input.deletionJobId, "deletionJobId"),
    true,
  );
  if (
    !job ||
    job.runState !== "running" ||
    job.rowVersion !== nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion") ||
    job.leaseToken !== requiredString(input.leaseToken, "leaseToken") ||
    !job.leaseExpiresAt ||
    Date.parse(job.leaseExpiresAt) <= Date.parse(now)
  ) {
    return null;
  }
  return job;
}

async function completeDeletionItem(
  database: DatabaseAdapter,
  input: CompleteDurableDeletionItemInput,
): Promise<DurableDeletionJobItem | null> {
  return database.transaction(async (transaction) => {
    const job = await lockFencedJob(database, transaction, input);
    if (!job) return null;
    const item = await getItemRow(
      database,
      transaction,
      job.id,
      requiredString(input.itemId, "itemId"),
      true,
    );
    if (
      !item ||
      item.rowVersion !==
        nonnegativeInteger(input.expectedItemRowVersion, "expectedItemRowVersion") ||
      (item.status !== "pending" && item.status !== "retry_wait") ||
      item.attempts >= item.maxAttempts
    ) {
      return null;
    }
    const updated = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [item.attempts + 1, item.rowVersion + 1, input.now, item.id, job.id, item.rowVersion],
      sql: `UPDATE ${q(database, itemTable)} SET ${q(database, "status")} = 'completed', ${q(database, "attempts")} = ${p(database, 1)}, ${q(database, "next_attempt_at")} = NULL, ${q(database, "object_key")} = NULL, ${q(database, "credential_ref")} = NULL, ${q(database, "cache_key")} = NULL, ${q(database, "last_error_code")} = NULL, ${q(database, "last_error_message")} = NULL, ${q(database, "row_version")} = ${p(database, 2)}, ${q(database, "updated_at")} = ${p(database, 3)}, ${q(database, "completed_at")} = ${p(database, 3)}, ${q(database, "redacted_at")} = CASE WHEN ${q(database, "kind")} IN ('object', 'secret_ref', 'cache_key') THEN ${p(database, 3)} ELSE NULL END WHERE ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "deletion_job_id")} = ${p(database, 5)} AND ${q(database, "row_version")} = ${p(database, 6)};`,
      tableName: itemTable,
    });
    return updated.rowsAffected === 1
      ? getItemRow(database, transaction, job.id, item.id, false)
      : null;
  });
}

async function scheduleDeletionItemRetry(
  database: DatabaseAdapter,
  input: ScheduleDurableDeletionItemRetryInput,
  fingerprinter: DurableDeletionFingerprinter,
): Promise<DurableDeletionJobItem | null> {
  const retryAt = isoDate(input.retryAt, "itemRetry.retryAt");
  return database.transaction(async (transaction) => {
    const job = await lockFencedJob(database, transaction, input);
    if (!job) return null;
    const item = await getItemRow(
      database,
      transaction,
      job.id,
      requiredString(input.itemId, "itemId"),
      true,
    );
    if (
      !item ||
      item.rowVersion !==
        nonnegativeInteger(input.expectedItemRowVersion, "expectedItemRowVersion") ||
      (item.status !== "pending" && item.status !== "retry_wait") ||
      item.attempts >= item.maxAttempts
    ) {
      return null;
    }
    const storedError = storedDeletionError({
      fallbackCode: "DURABLE_DELETION_ITEM_FAILED",
      fingerprinter,
      job,
      rawCode: input.errorCode,
      rawMessage: input.errorMessage,
    });
    const attempts = item.attempts + 1;
    const dead = input.deadLetter === true || attempts >= item.maxAttempts;
    if (!dead && Date.parse(retryAt) <= Date.parse(input.now)) {
      throw new Error("Durable deletion item retryAt must be after now");
    }
    const updated = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        dead ? "dead" : "retry_wait",
        attempts,
        dead ? null : retryAt,
        storedError.code,
        storedError.message,
        item.rowVersion + 1,
        input.now,
        dead ? input.now : null,
        item.id,
        job.id,
        item.rowVersion,
      ],
      sql: `UPDATE ${q(database, itemTable)} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "attempts")} = ${p(database, 2)}, ${q(database, "next_attempt_at")} = ${p(database, 3)}, ${q(database, "last_error_code")} = ${p(database, 4)}, ${q(database, "last_error_message")} = ${p(database, 5)}, ${q(database, "row_version")} = ${p(database, 6)}, ${q(database, "updated_at")} = ${p(database, 7)}, ${q(database, "completed_at")} = ${p(database, 8)} WHERE ${q(database, "id")} = ${p(database, 9)} AND ${q(database, "deletion_job_id")} = ${p(database, 10)} AND ${q(database, "row_version")} = ${p(database, 11)};`,
      tableName: itemTable,
    });
    if (updated.rowsAffected !== 1) return null;
    if (dead) {
      const failed = await failLockedDeletionJob(database, transaction, job, {
        errorCode: storedError.code,
        errorMessage: storedError.message,
        now: input.now,
      });
      if (!failed) {
        throw new Error("Durable deletion parent failure fence was lost for a dead item");
      }
    }
    return getItemRow(database, transaction, job.id, item.id, false);
  });
}

async function advanceDeletionCheckpoint(
  database: DatabaseAdapter,
  input: AdvanceDurableDeletionCheckpointInput,
): Promise<DurableDeletionJob | null> {
  const next = enumValue(
    input.nextCheckpoint,
    DurableDeletionCheckpoints.filter((checkpoint) => checkpoint !== "completed"),
    "nextCheckpoint",
  ) as Exclude<DurableDeletionCheckpoint, "completed">;
  return database.transaction(async (transaction) => {
    const current = await lockFencedJob(database, transaction, input);
    if (!current) return null;
    const currentIndex = DurableDeletionCheckpoints.indexOf(current.checkpoint);
    if (DurableDeletionCheckpoints[currentIndex + 1] !== next) {
      throw new DurableDeletionCheckpointConflictError();
    }
    if (current.checkpoint === "quiescing" && !current.inventoryComplete) {
      throw new DurableDeletionCheckpointConflictError(
        "Durable deletion inventory is not complete",
      );
    }
    if (current.checkpoint === "deleting_objects") {
      const incomplete = await hasIncompleteItems(database, transaction, current.id);
      if (incomplete) {
        throw new DurableDeletionCheckpointConflictError(
          "Durable deletion external items are incomplete",
        );
      }
    }
    const updated = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        next,
        input.now,
        current.rowVersion + 1,
        current.id,
        current.rowVersion,
        input.leaseToken,
        input.now,
      ],
      sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "checkpoint")} = ${p(database, 1)}, ${q(database, "scan_phase")} = NULL, ${q(database, "scan_cursor")} = NULL, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(database, "row_version")} = ${p(database, 3)} WHERE ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "row_version")} = ${p(database, 5)} AND ${q(database, "lease_token")} = ${p(database, 6)} AND ${q(database, "lease_expires_at")} > ${p(database, 7)};`,
      tableName: jobTable,
    });
    if (updated.rowsAffected !== 1) {
      throw new Error("Durable deletion checkpoint lease fence was lost");
    }
    return getJobRow(database, transaction, current.id, false);
  });
}

async function reconcileDirtyPrimaryDeletion(
  database: DatabaseAdapter,
  input: ReconcileDirtyPrimaryDeletionInput,
): Promise<DurableDeletionJob | null> {
  return database.transaction(async (transaction) => {
    const current = await lockFencedJob(database, transaction, input);
    if (!current) return null;
    if (current.checkpoint !== "deleting_primary_data") {
      throw new DurableDeletionCheckpointConflictError(
        "Durable deletion dirty-primary reconciliation requires the final checkpoint",
      );
    }

    // Completed inventory items are deliberately redacted. Drop the entire old inventory so the
    // quiescing rescan can recover late-created object/secret keys from still-present primary rows.
    await transaction.execute({
      maxRows: 0,
      operation: "delete",
      params: [current.id],
      sql: `DELETE FROM ${q(database, itemTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)};`,
      tableName: itemTable,
    });
    const updated = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        input.now,
        current.rowVersion + 1,
        current.id,
        current.rowVersion,
        input.leaseToken,
        input.now,
      ],
      sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "checkpoint")} = 'quiescing', ${q(database, "inventory_complete")} = ${database.dialect === "postgres" ? "FALSE" : "0"}, ${q(database, "scan_phase")} = 'reconcile-after-dirty-primary', ${q(database, "scan_cursor")} = NULL, ${q(database, "updated_at")} = ${p(database, 1)}, ${q(database, "row_version")} = ${p(database, 2)} WHERE ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "row_version")} = ${p(database, 4)} AND ${q(database, "lease_token")} = ${p(database, 5)} AND ${q(database, "run_state")} = 'running' AND ${q(database, "lease_expires_at")} > ${p(database, 6)};`,
      tableName: jobTable,
    });
    if (updated.rowsAffected !== 1) {
      throw new Error("Durable deletion dirty-primary reconciliation lease fence was lost");
    }
    return getJobRow(database, transaction, current.id, false);
  });
}

async function scheduleDeletionJobRetry(
  database: DatabaseAdapter,
  input: ScheduleDurableDeletionRetryInput,
  fingerprinter: DurableDeletionFingerprinter,
): Promise<DurableDeletionJob | null> {
  const retryAt = isoDate(input.retryAt, "jobRetry.retryAt");
  if (Date.parse(retryAt) <= Date.parse(isoDate(input.now, "jobRetry.now"))) {
    throw new Error("Durable deletion job retryAt must be after now");
  }
  if (
    input.resetExecutionAttempts &&
    !["DURABLE_DELETION_COOPERATIVE_WAIT", "DURABLE_DELETION_COOPERATIVE_YIELD"].includes(
      input.errorCode,
    )
  ) {
    throw new Error("Durable deletion execution attempts may reset only after cooperative yield");
  }
  return database.transaction(async (transaction) => {
    const current = await lockFencedJob(database, transaction, input);
    if (!current) return null;
    const storedError = storedDeletionError({
      fallbackCode: "DURABLE_DELETION_PROCESSING_FAILED",
      fingerprinter,
      job: current,
      rawCode: input.errorCode,
      rawMessage: input.errorMessage,
    });
    if (
      !input.resetExecutionAttempts &&
      current.executionAttempts >= current.maxExecutionAttempts
    ) {
      return failLockedDeletionJob(database, transaction, current, {
        errorCode: storedError.code,
        errorMessage: storedError.message,
        now: input.now,
      });
    }
    const updated = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        retryAt,
        storedError.code,
        storedError.message,
        input.resetExecutionAttempts ? 0 : current.executionAttempts,
        input.now,
        current.rowVersion + 1,
        current.id,
        current.rowVersion,
        input.leaseToken,
        input.now,
      ],
      sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "run_state")} = 'retry_wait', ${q(database, "retry_at")} = ${p(database, 1)}, ${q(database, "last_error_code")} = ${p(database, 2)}, ${q(database, "last_error_message")} = ${p(database, 3)}, ${q(database, "execution_attempts")} = ${p(database, 4)}, ${q(database, "worker_id")} = NULL, ${q(database, "lease_token")} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(database, "heartbeat_at")} = NULL, ${q(database, "updated_at")} = ${p(database, 5)}, ${q(database, "row_version")} = ${p(database, 6)} WHERE ${q(database, "id")} = ${p(database, 7)} AND ${q(database, "row_version")} = ${p(database, 8)} AND ${q(database, "lease_token")} = ${p(database, 9)} AND ${q(database, "lease_expires_at")} > ${p(database, 10)};`,
      tableName: jobTable,
    });
    if (updated.rowsAffected !== 1) return null;
    const retryOutbox = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [retryAt, input.now, current.id],
      sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = 'dispatched', ${q(database, "available_at")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 3)} AND ${q(database, "status")} = 'leased';`,
      tableName: outboxTable,
    });
    if (retryOutbox.rowsAffected !== 1) {
      throw new Error("Durable deletion retry did not release exactly one outbox event");
    }
    return getJobRow(database, transaction, current.id, false);
  });
}

async function failDeletionJob(
  database: DatabaseAdapter,
  input: FailDurableDeletionExecutionInput,
  fingerprinter: DurableDeletionFingerprinter,
): Promise<DurableDeletionJob | null> {
  return database.transaction(async (transaction) => {
    const current = await lockFencedJob(database, transaction, input);
    if (!current) return null;
    const storedError = storedDeletionError({
      fallbackCode: "DURABLE_DELETION_PROCESSING_FAILED",
      fingerprinter,
      job: current,
      rawCode: input.errorCode,
      rawMessage: input.errorMessage,
    });
    return failLockedDeletionJob(database, transaction, current, {
      errorCode: storedError.code,
      errorMessage: storedError.message,
      now: input.now,
    });
  });
}

async function failLockedDeletionJob(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  current: DurableDeletionJob,
  input: {
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly now: string;
  },
): Promise<DurableDeletionJob | null> {
  const updated = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [
      boundedString(input.errorCode, 64, "failJob.errorCode"),
      requiredString(input.errorMessage, "failJob.errorMessage"),
      input.now,
      current.rowVersion + 1,
      current.id,
      current.rowVersion,
      current.leaseToken ?? null,
      input.now,
    ],
    sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "run_state")} = 'failed', ${q(database, "retry_at")} = NULL, ${q(database, "last_error_code")} = ${p(database, 1)}, ${q(database, "last_error_message")} = ${p(database, 2)}, ${q(database, "worker_id")} = NULL, ${q(database, "lease_token")} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(database, "heartbeat_at")} = NULL, ${q(database, "updated_at")} = ${p(database, 3)}, ${q(database, "row_version")} = ${p(database, 4)} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "row_version")} = ${p(database, 6)} AND ${q(database, "lease_token")} = ${p(database, 7)} AND ${q(database, "lease_expires_at")} > ${p(database, 8)};`,
    tableName: jobTable,
  });
  if (updated.rowsAffected !== 1) return null;
  const failedOutbox = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [input.errorMessage, input.now, current.id],
    sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = 'dead', ${q(database, "last_error")} = ${p(database, 1)}, ${q(database, "locked_by")} = NULL, ${q(database, "lock_token")} = NULL, ${q(database, "locked_until")} = NULL, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 3)} AND ${q(database, "status")} NOT IN ('completed', 'canceled', 'dead');`,
    tableName: outboxTable,
  });
  if (failedOutbox.rowsAffected !== 1) {
    throw new Error("Durable deletion failure did not terminate exactly one outbox event");
  }
  return getJobRow(database, transaction, current.id, false);
}

async function failExpiredExhaustedDeletionJob(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  current: DurableDeletionJob,
  now: string,
): Promise<void> {
  const errorCode = "DURABLE_DELETION_ATTEMPTS_EXHAUSTED";
  const errorMessage = "Durable deletion worker lease expired after the final execution attempt";
  const updated = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [
      errorCode,
      errorMessage,
      now,
      current.rowVersion + 1,
      current.id,
      current.rowVersion,
      now,
    ],
    sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "run_state")} = 'failed', ${q(database, "retry_at")} = NULL, ${q(database, "last_error_code")} = ${p(database, 1)}, ${q(database, "last_error_message")} = ${p(database, 2)}, ${q(database, "worker_id")} = NULL, ${q(database, "lease_token")} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(database, "heartbeat_at")} = NULL, ${q(database, "updated_at")} = ${p(database, 3)}, ${q(database, "row_version")} = ${p(database, 4)} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "row_version")} = ${p(database, 6)} AND ${q(database, "run_state")} = 'running' AND ${q(database, "execution_attempts")} >= ${q(database, "max_execution_attempts")} AND ${q(database, "lease_expires_at")} <= ${p(database, 7)};`,
    tableName: jobTable,
  });
  if (updated.rowsAffected !== 1) {
    throw new Error("Durable deletion exhausted lease failure fence was lost");
  }
  const failedOutbox = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params: [errorMessage, now, current.id],
    sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = 'dead', ${q(database, "last_error")} = ${p(database, 1)}, ${q(database, "locked_by")} = NULL, ${q(database, "lock_token")} = NULL, ${q(database, "locked_until")} = NULL, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 3)} AND ${q(database, "status")} NOT IN ('completed', 'canceled', 'dead');`,
    tableName: outboxTable,
  });
  if (failedOutbox.rowsAffected !== 1) {
    throw new Error(
      "Durable deletion exhausted failure did not terminate exactly one outbox event",
    );
  }
}

async function completeDeletionJob(
  database: DatabaseAdapter,
  input: CompleteDurableDeletionJobInput,
): Promise<DurableDeletionJob | null> {
  return database.transaction(async (transaction) => {
    const current = await lockFencedJob(database, transaction, input);
    if (!current) return null;
    if (current.checkpoint !== "deleting_primary_data") {
      throw new DurableDeletionCheckpointConflictError(
        "Durable deletion primary-data checkpoint has not been reached",
      );
    }
    if (await hasIncompleteItems(database, transaction, current.id)) {
      throw new DurableDeletionCheckpointConflictError(
        "Durable deletion cannot complete with unfinished items",
      );
    }
    const targetBeforeDelete = await getPrimaryTargetDeletionLink(
      database,
      transaction,
      current,
      true,
    );
    if (targetBeforeDelete.exists && targetBeforeDelete.deletionJobId !== current.id) {
      throw new DurableDeletionCheckpointConflictError(
        "Durable deletion primary target is not linked to this job",
      );
    }
    const primary = await input.deleteAndProbePrimaryData({
      job: cloneJob(current),
      transaction,
    });
    if (!primary.clean) {
      throw new DurableDeletionPrimaryResidueDirtyError();
    }
    const targetAfterDelete = await getPrimaryTargetDeletionLink(
      database,
      transaction,
      current,
      false,
    );
    if (targetAfterDelete.exists) {
      throw new DurableDeletionCheckpointConflictError(
        "Durable deletion primary target still exists after delete",
      );
    }
    const tombstone = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [input.now, current.id],
      sql: `UPDATE ${q(database, tombstoneTable)} SET ${q(database, "state")} = 'completed', ${q(database, "completed_at")} = ${p(database, 1)}, ${q(database, "row_version")} = ${q(database, "row_version")} + 1 WHERE ${q(database, "deletion_job_id")} = ${p(database, 2)} AND ${q(database, "state")} = 'active';`,
      tableName: tombstoneTable,
    });
    if (tombstone.rowsAffected !== 1) {
      throw new Error("Durable deletion tombstone completion fence was lost");
    }
    const completedOutbox = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [input.now, current.id],
      sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = 'completed', ${q(database, "locked_by")} = NULL, ${q(database, "lock_token")} = NULL, ${q(database, "locked_until")} = NULL, ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 2)} AND ${q(database, "status")} NOT IN ('completed', 'canceled', 'dead');`,
      tableName: outboxTable,
    });
    if (completedOutbox.rowsAffected !== 1) {
      throw new Error("Durable deletion completion did not terminate exactly one outbox event");
    }
    const updated = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        input.now,
        current.rowVersion + 1,
        current.id,
        current.rowVersion,
        input.leaseToken,
        input.now,
      ],
      sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "checkpoint")} = 'completed', ${q(database, "run_state")} = 'succeeded', ${q(database, "active_slot")} = NULL, ${q(database, "retry_at")} = NULL, ${q(database, "worker_id")} = NULL, ${q(database, "lease_token")} = NULL, ${q(database, "lease_expires_at")} = NULL, ${q(database, "heartbeat_at")} = NULL, ${q(database, "updated_at")} = ${p(database, 1)}, ${q(database, "completed_at")} = ${p(database, 1)}, ${q(database, "row_version")} = ${p(database, 2)} WHERE ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "row_version")} = ${p(database, 4)} AND ${q(database, "lease_token")} = ${p(database, 5)} AND ${q(database, "lease_expires_at")} > ${p(database, 6)};`,
      tableName: jobTable,
    });
    if (updated.rowsAffected !== 1) {
      throw new Error("Durable deletion completion lease fence was lost");
    }
    return getJobRow(database, transaction, current.id, false);
  });
}

async function hasIncompleteItems(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  deletionJobId: string,
): Promise<boolean> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [deletionJobId],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, itemTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)} AND ${q(database, "status")} <> 'completed' LIMIT 1;`,
    tableName: itemTable,
  });
  return result.rows.length > 0;
}

async function getPrimaryTargetDeletionLink(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: Pick<DurableDeletionJob, "id" | "knowledgeSpaceId" | "targetId" | "targetType" | "tenantId">,
  forUpdate: boolean,
): Promise<{ readonly deletionJobId?: string | undefined; readonly exists: boolean }> {
  const tableName =
    job.targetType === "knowledge_space"
      ? "knowledge_spaces"
      : job.targetType === "source"
        ? "sources"
        : job.targetType === "logical_document"
          ? "logical_documents"
          : "document_assets";
  const params: DatabaseQueryValue[] =
    job.targetType === "knowledge_space"
      ? [job.tenantId, job.targetId]
      : [job.knowledgeSpaceId, job.targetId];
  const scopeColumn = job.targetType === "knowledge_space" ? "tenant_id" : "knowledge_space_id";
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${q(database, "deletion_job_id")} FROM ${q(database, tableName)} WHERE ${q(database, scopeColumn)} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName,
  });
  const row = result.rows[0];
  if (!row) return { exists: false };
  const deletionJobId = optionalStringColumn(row, "deletion_job_id");
  return { ...(deletionJobId ? { deletionJobId } : {}), exists: true };
}

async function claimDeletionOutbox(
  database: DatabaseAdapter,
  input: ClaimDurableDeletionOutboxInput,
  maxClaimBatchSize: number,
): Promise<readonly DurableDeletionOutboxEvent[]> {
  const limit = positiveInteger(input.limit, "outboxClaim.limit");
  if (limit > maxClaimBatchSize) {
    throw new Error(`Durable deletion outbox claim limit exceeds ${maxClaimBatchSize}`);
  }
  const now = isoDate(input.now, "outboxClaim.now");
  const lockedUntil = isoDate(input.lockedUntil, "outboxClaim.lockedUntil");
  if (Date.parse(lockedUntil) <= Date.parse(now)) {
    throw new Error("Durable deletion outbox lockedUntil must be after now");
  }
  const lockToken = requiredString(input.lockToken, "outboxClaim.lockToken");
  const workerId = boundedString(input.workerId, 255, "outboxClaim.workerId");
  return database.transaction(async (transaction) => {
    const selected = await transaction.execute({
      maxRows: limit,
      operation: "select",
      params: [now, limit],
      sql: `SELECT * FROM ${q(database, outboxTable)} WHERE ${q(database, "available_at")} <= ${p(database, 1)} AND (${q(database, "status")} = 'pending' OR (${q(database, "status")} = 'dispatching' AND ${q(database, "locked_until")} <= ${p(database, 1)})) ORDER BY ${q(database, "available_at")} ASC, ${q(database, "id")} ASC LIMIT ${p(database, 2)} FOR UPDATE${database.dialect === "postgres" ? " SKIP LOCKED" : ""};`,
      tableName: outboxTable,
    });
    const claimed: DurableDeletionOutboxEvent[] = [];
    for (const row of selected.rows) {
      const current = mapOutbox(row);
      const updated = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [current.dispatchAttempts + 1, workerId, lockToken, lockedUntil, now, current.id],
        sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = 'dispatching', ${q(database, "dispatch_attempts")} = ${p(database, 1)}, ${q(database, "locked_by")} = ${p(database, 2)}, ${q(database, "lock_token")} = ${p(database, 3)}, ${q(database, "locked_until")} = ${p(database, 4)}, ${q(database, "updated_at")} = ${p(database, 5)} WHERE ${q(database, "id")} = ${p(database, 6)};`,
        tableName: outboxTable,
      });
      if (updated.rowsAffected !== 1) continue;
      const stored = await getOutboxRow(database, transaction, current.id, false);
      if (stored) claimed.push(stored);
    }
    return claimed;
  });
}

async function markDeletionOutboxDispatched(
  database: DatabaseAdapter,
  input: MarkDurableDeletionOutboxDispatchedInput,
): Promise<DurableDeletionOutboxEvent | null> {
  const now = isoDate(input.now, "markOutbox.now");
  return database.transaction(async (transaction) => {
    const current = await getOutboxRow(
      database,
      transaction,
      requiredString(input.outboxId, "outboxId"),
      true,
    );
    if (
      !current ||
      current.status !== "dispatching" ||
      current.lockToken !== requiredString(input.lockToken, "markOutbox.lockToken") ||
      !current.lockedUntil ||
      Date.parse(current.lockedUntil) <= Date.parse(now)
    ) {
      return null;
    }
    const updated = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        requiredString(input.queueJobId, "markOutbox.queueJobId"),
        isoDate(input.deliveredAt, "markOutbox.deliveredAt"),
        now,
        current.id,
        input.lockToken,
        now,
      ],
      sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = 'dispatched', ${q(database, "queue_job_id")} = ${p(database, 1)}, ${q(database, "delivered_at")} = ${p(database, 2)}, ${q(database, "locked_by")} = NULL, ${q(database, "lock_token")} = NULL, ${q(database, "locked_until")} = NULL, ${q(database, "last_error")} = NULL, ${q(database, "updated_at")} = ${p(database, 3)} WHERE ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "lock_token")} = ${p(database, 5)} AND ${q(database, "locked_until")} > ${p(database, 6)};`,
      tableName: outboxTable,
    });
    if (updated.rowsAffected !== 1) return null;
    const queued = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [input.queueJobId, now, current.deletionJobId],
      sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "run_state")} = 'queued', ${q(database, "queue_job_id")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(database, "row_version")} = ${q(database, "row_version")} + 1 WHERE ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "run_state")} = 'dispatch_pending';`,
      tableName: jobTable,
    });
    if (queued.rowsAffected !== 1) {
      throw new Error("Durable deletion dispatched outbox did not queue its job");
    }
    return getOutboxRow(database, transaction, current.id, false);
  });
}

async function releaseDeletionOutbox(
  database: DatabaseAdapter,
  input: ReleaseDurableDeletionOutboxInput,
  fingerprinter: DurableDeletionFingerprinter,
): Promise<DurableDeletionOutboxEvent | null> {
  const now = isoDate(input.now, "releaseOutbox.now");
  const availableAt = isoDate(input.availableAt, "releaseOutbox.availableAt");
  return database.transaction(async (transaction) => {
    const current = await getOutboxRow(
      database,
      transaction,
      requiredString(input.outboxId, "outboxId"),
      true,
    );
    if (
      !current ||
      current.status !== "dispatching" ||
      current.lockToken !== requiredString(input.lockToken, "releaseOutbox.lockToken")
    ) {
      return null;
    }
    const job = await getJobRow(database, transaction, current.deletionJobId, false);
    if (!job) throw new Error("Durable deletion outbox lost its parent job");
    const dead = input.deadLetter === true;
    const storedError = storedDeletionError({
      fallbackCode: dead ? "OUTBOX_DISPATCH_EXHAUSTED" : "DURABLE_DELETION_OUTBOX_DISPATCH_FAILED",
      fingerprinter,
      job,
      rawCode: dead ? "OUTBOX_DISPATCH_EXHAUSTED" : "DURABLE_DELETION_OUTBOX_DISPATCH_FAILED",
      rawMessage: input.error,
    });
    const updated = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        dead ? "dead" : "pending",
        availableAt,
        storedError.message,
        now,
        current.id,
        input.lockToken,
      ],
      sql: `UPDATE ${q(database, outboxTable)} SET ${q(database, "status")} = ${p(database, 1)}, ${q(database, "available_at")} = ${p(database, 2)}, ${q(database, "last_error")} = ${p(database, 3)}, ${q(database, "locked_by")} = NULL, ${q(database, "lock_token")} = NULL, ${q(database, "locked_until")} = NULL, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "lock_token")} = ${p(database, 6)};`,
      tableName: outboxTable,
    });
    if (updated.rowsAffected !== 1) return null;
    if (dead) {
      const failedJob = await transaction.execute({
        maxRows: 0,
        operation: "update",
        params: [storedError.message, now, current.deletionJobId],
        sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "run_state")} = 'failed', ${q(database, "last_error_code")} = 'OUTBOX_DISPATCH_EXHAUSTED', ${q(database, "last_error_message")} = ${p(database, 1)}, ${q(database, "updated_at")} = ${p(database, 2)}, ${q(database, "row_version")} = ${q(database, "row_version")} + 1 WHERE ${q(database, "id")} = ${p(database, 3)} AND ${q(database, "run_state")} = 'dispatch_pending';`,
        tableName: jobTable,
      });
      if (failedJob.rowsAffected !== 1) {
        throw new Error("Durable deletion dead outbox did not fail its job");
      }
    }
    return getOutboxRow(database, transaction, current.id, false);
  });
}

async function retryFailedDeletionJob(
  database: DatabaseAdapter,
  input: RetryFailedDurableDeletionJobInput,
  options: {
    readonly fingerprinter: DurableDeletionFingerprinter;
    readonly generateOutboxId: () => string;
    readonly generateRetryAuditId: () => string;
  },
): Promise<RequestDurableDeletionResult> {
  const tenantId = boundedString(input.tenantId, 255, "retryFailed.tenantId");
  const jobId = requiredString(input.jobId, "retryFailed.jobId");
  const now = isoDate(input.now, "retryFailed.now");
  const retryIdempotencyKey = boundedString(
    input.idempotencyKey,
    512,
    "retryFailed.idempotencyKey",
  );
  const provenance = normalizePermissionProvenance(input);
  const retryAuthority = enumValue(
    input.retryAuthority,
    DurableDeletionRetryAuthorities,
    "retryFailed.retryAuthority",
  );
  if (
    retryAuthority === "interactive_owner_rescue" &&
    (provenance.accessChannel !== "interactive" || provenance.apiKeyId !== undefined)
  ) {
    throw new Error("Durable deletion owner rescue requires an interactive non-API-key actor");
  }
  const originalRequestFingerprint = fingerprintValue(input.requestFingerprint, "original request");

  return database.transaction(async (transaction) => {
    const job = await getJobRow(database, transaction, jobId, true, tenantId);
    if (!job) throw new DurableDeletionTargetConflictError("Durable deletion job was not found");
    // Recompute with the real space after the tenant-scoped lookup. The placeholder digest is
    // discarded; it only validates operation-key bounds before a database read.
    const exactRetryFingerprint = fingerprintValue(
      options.fingerprinter({
        knowledgeSpaceId: job.knowledgeSpaceId,
        operationKey: retryIdempotencyKey,
        purpose: "retry_request",
        tenantId,
        value: JSON.stringify({
          accessChannel: provenance.accessChannel,
          apiKeyExpiresAt: provenance.apiKeyExpiresAt ?? null,
          apiKeyId: provenance.apiKeyId ?? null,
          apiKeyRevision: provenance.apiKeyRevision ?? null,
          jobId,
          originalRequestFingerprint,
          requestedBySubjectId: provenance.requestedBySubjectId,
          retryAuthority,
        }),
      }),
      "retry request",
    );
    const existing = await getOutboxByRequest(
      database,
      transaction,
      job.id,
      retryIdempotencyKey,
      true,
    );
    if (existing) {
      if (existing.requestFingerprint !== exactRetryFingerprint) {
        throw new DurableDeletionIdempotencyConflictError();
      }
      return resultForJobAndOutbox(database, transaction, job, existing, false);
    }
    if (
      job.runState !== "failed" ||
      job.activeSlot !== 1 ||
      job.requestFingerprint !== originalRequestFingerprint ||
      (input.expectedRowVersion !== undefined && job.rowVersion !== input.expectedRowVersion) ||
      (retryAuthority === "original_requester" && !sameStableRequester(job, provenance))
    ) {
      throw new DurableDeletionTargetConflictError(
        "Durable deletion failed-job retry fence was lost",
      );
    }
    const tombstone = await getTombstoneByJob(database, transaction, job.id, true);
    if (!tombstone || tombstone.state !== "active") {
      throw new DurableDeletionTargetConflictError(
        "Durable deletion target no longer has an active tombstone",
      );
    }
    const deliveryRevision = await nextOutboxDeliveryRevision(database, transaction, job.id);
    const outbox: DurableDeletionOutboxEvent = {
      availableAt: now,
      createdAt: now,
      deletionJobId: job.id,
      deliveryRevision,
      dispatchAttempts: 0,
      eventType: DurableDeletionOutboxEventType,
      id: requiredString(options.generateOutboxId(), "generated outbox id"),
      idempotencyKey: `deletion:${job.id}:${deliveryRevision}`,
      payload: { deletionJobId: job.id },
      requestFingerprint: exactRetryFingerprint,
      requestIdempotencyKey: retryIdempotencyKey,
      schemaVersion: DurableDeletionOutboxSchemaVersion,
      status: "pending",
      updatedAt: now,
    };
    await insertOutbox(database, transaction, outbox);
    await insertRecord(database, transaction, "deletion_retry_audits", {
      access_channel: provenance.accessChannel,
      actor_subject_id: provenance.requestedBySubjectId,
      api_key_expires_at: provenance.apiKeyExpiresAt ?? null,
      api_key_id: provenance.apiKeyId ?? null,
      api_key_revision: provenance.apiKeyRevision ?? null,
      created_at: now,
      deletion_job_id: job.id,
      id: requiredString(options.generateRetryAuditId(), "generated retry audit id"),
      knowledge_space_id: job.knowledgeSpaceId,
      outbox_id: outbox.id,
      permission_snapshot_id: provenance.permissionSnapshotId,
      permission_snapshot_revision: provenance.permissionSnapshotRevision,
      request_fingerprint: exactRetryFingerprint,
      request_idempotency_key: retryIdempotencyKey,
      retry_authority: retryAuthority,
      tenant_id: tenantId,
    });
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [now, job.id],
      sql: `UPDATE ${q(database, itemTable)} SET ${q(database, "status")} = 'pending', ${q(database, "attempts")} = 0, ${q(database, "max_attempts")} = ${q(database, "max_attempts")} + 1, ${q(database, "next_attempt_at")} = NULL, ${q(database, "last_error_code")} = NULL, ${q(database, "last_error_message")} = NULL, ${q(database, "completed_at")} = NULL, ${q(database, "row_version")} = ${q(database, "row_version")} + 1, ${q(database, "updated_at")} = ${p(database, 1)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 2)} AND ${q(database, "status")} = 'dead';`,
      tableName: itemTable,
    });
    const updated = await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        now,
        job.rowVersion + 1,
        Math.max(job.maxExecutionAttempts, job.executionAttempts + 1),
        job.id,
        job.rowVersion,
      ],
      sql: `UPDATE ${q(database, jobTable)} SET ${q(database, "run_state")} = 'dispatch_pending', ${q(database, "queue_job_id")} = NULL, ${q(database, "last_error_code")} = NULL, ${q(database, "last_error_message")} = NULL, ${q(database, "updated_at")} = ${p(database, 1)}, ${q(database, "row_version")} = ${p(database, 2)}, ${q(database, "max_execution_attempts")} = ${p(database, 3)} WHERE ${q(database, "id")} = ${p(database, 4)} AND ${q(database, "row_version")} = ${p(database, 5)} AND ${q(database, "run_state")} = 'failed' AND ${q(database, "active_slot")} = 1;`,
      tableName: jobTable,
    });
    if (updated.rowsAffected !== 1) {
      throw new DurableDeletionTargetConflictError(
        "Durable deletion failed-job retry update was lost",
      );
    }
    const stored = await getJobRow(database, transaction, job.id, false);
    if (!stored) throw new Error("Durable deletion retry job disappeared");
    return {
      created: true,
      job: stored,
      outbox,
      tombstone,
    };
  });
}

interface LockedSpace {
  readonly deletionJobId?: string | undefined;
  readonly lifecycleState: string;
  readonly name: string;
  readonly revision: number;
}

async function lockSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  knowledgeSpaceId: string,
): Promise<LockedSpace | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId, knowledgeSpaceId],
    sql: `SELECT ${columns(database, ["name", "revision", "lifecycle_state", "deletion_job_id"])} FROM ${q(database, "knowledge_spaces")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} LIMIT 1 FOR UPDATE;`,
    tableName: "knowledge_spaces",
  });
  const row = result.rows[0];
  return row
    ? {
        ...(optionalStringColumn(row, "deletion_job_id")
          ? { deletionJobId: optionalStringColumn(row, "deletion_job_id") }
          : {}),
        lifecycleState: stringColumn(row, "lifecycle_state"),
        name: stringColumn(row, "name"),
        revision: numberColumn(row, "revision"),
      }
    : null;
}

async function lockSource(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  knowledgeSpaceId: string,
  sourceId: string,
): Promise<{
  readonly deletionJobId?: string;
  readonly permissionScope: readonly string[];
  readonly status: string;
  readonly version: number;
} | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [knowledgeSpaceId, sourceId],
    sql: `SELECT ${columns(database, ["version", "status", "deletion_job_id", "permission_scope"])} FROM ${q(database, "sources")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} LIMIT 1 FOR UPDATE;`,
    tableName: "sources",
  });
  const row = result.rows[0];
  const deletionJobId = row ? optionalStringColumn(row, "deletion_job_id") : undefined;
  return row
    ? {
        ...(deletionJobId ? { deletionJobId } : {}),
        permissionScope: jsonStringArrayColumn(row, "permission_scope"),
        status: stringColumn(row, "status"),
        version: numberColumn(row, "version"),
      }
    : null;
}

async function lockDocument(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  knowledgeSpaceId: string,
  documentAssetId: string,
): Promise<{
  readonly deletionJobId?: string;
  readonly lifecycleState: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly objectKey: string;
  readonly rowVersion: number;
  readonly sourceId?: string | undefined;
  readonly version: number;
} | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [knowledgeSpaceId, documentAssetId],
    sql: `SELECT ${columns(database, ["version", "row_version", "lifecycle_state", "deletion_job_id", "object_key", "source_id", "metadata"])} FROM ${q(database, "document_assets")} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} LIMIT 1 FOR UPDATE;`,
    tableName: "document_assets",
  });
  const row = result.rows[0];
  const deletionJobId = row ? optionalStringColumn(row, "deletion_job_id") : undefined;
  const sourceId = row ? optionalStringColumn(row, "source_id") : undefined;
  return row
    ? {
        ...(deletionJobId ? { deletionJobId } : {}),
        lifecycleState: stringColumn(row, "lifecycle_state"),
        metadata: jsonObjectColumn(row, "metadata"),
        objectKey: stringColumn(row, "object_key"),
        rowVersion: numberColumn(row, "row_version"),
        ...(sourceId ? { sourceId } : {}),
        version: numberColumn(row, "version"),
      }
    : null;
}

async function lockLogicalDocument(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  knowledgeSpaceId: string,
  documentId: string,
): Promise<{
  readonly activeRevision?: number | undefined;
  readonly rowVersion: number;
  readonly sourceId?: string | undefined;
  readonly status: string;
} | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId, knowledgeSpaceId, documentId],
    sql: `SELECT ${columns(database, ["active_revision", "row_version", "source_id", "status"])} FROM ${q(database, "logical_documents")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(database, 2)} AND ${q(database, "id")} = ${p(database, 3)} LIMIT 1 FOR UPDATE;`,
    tableName: "logical_documents",
  });
  const row = result.rows[0];
  if (!row) return null;
  const activeRevision = optionalNumberColumn(row, "active_revision");
  const sourceId = optionalStringColumn(row, "source_id");
  return {
    ...(activeRevision === undefined ? {} : { activeRevision }),
    rowVersion: numberColumn(row, "row_version"),
    ...(sourceId ? { sourceId } : {}),
    status: stringColumn(row, "status"),
  };
}

async function assertFailedSourceMaterializationDeletionProof(input: {
  readonly asset: {
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly sourceId?: string | undefined;
  };
  readonly database: DatabaseAdapter;
  readonly documentAssetId: string;
  readonly documentAssetVersion: number;
  readonly knowledgeSpaceId: string;
  readonly proof: NonNullable<RequestDocumentDeletionInput["failedSourceMaterialization"]>;
  readonly tenantId: string;
  readonly transaction: DatabaseExecutor;
}): Promise<void> {
  const reject = () => {
    throw new DurableDeletionTargetRevisionConflictError();
  };
  if (
    input.asset.sourceId !== input.proof.sourceId ||
    !sourceWorkflowOwnershipMatches(
      input.asset.metadata[SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY],
      input.proof.ownership,
    )
  ) {
    reject();
  }

  // Lock order matches logical revision creation: space -> asset -> logical document -> revision.
  // Because the asset row is already locked by requestDocumentDeletion, no writer can pass the
  // active-asset admission check and add a new logical reference after this proof succeeds.
  const document = await lockLogicalDocument(
    input.database,
    input.transaction,
    input.tenantId,
    input.knowledgeSpaceId,
    input.proof.documentId,
  );
  if (
    !document ||
    document.sourceId !== input.proof.sourceId ||
    document.activeRevision === input.proof.revision
  ) {
    reject();
  }

  const q = (value: string) => quoteDatabaseIdentifier(input.database, value);
  const p = (position: number) => databasePlaceholder(input.database, position);
  const references = await input.transaction.execute({
    maxRows: 2,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.documentAssetId],
    sql: `SELECT ${columns(input.database, ["document_id", "revision", "document_asset_version", "state", "compilation_attempt_id", "activated_at", "system_metadata"])} FROM ${q("document_revisions")} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("document_asset_id")} = ${p(3)} LIMIT 2 FOR UPDATE;`,
    tableName: "document_revisions",
  });
  const target = references.rows[0];
  if (
    references.rows.length !== 1 ||
    !target ||
    stringColumn(target, "document_id") !== input.proof.documentId ||
    numberColumn(target, "revision") !== input.proof.revision ||
    numberColumn(target, "document_asset_version") !== input.documentAssetVersion ||
    stringColumn(target, "state") !== "failed" ||
    !optionalStringColumn(target, "compilation_attempt_id") ||
    optionalStringColumn(target, "activated_at") !== undefined ||
    !sourceWorkflowOwnershipMatches(
      jsonObjectColumn(target, "system_metadata")[SOURCE_WORKFLOW_OWNERSHIP_METADATA_KEY],
      input.proof.ownership,
    )
  ) {
    reject();
  }
}

async function assertNoActiveChildDeletion(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input:
    | {
        readonly knowledgeSpaceId: string;
        readonly targetType: "knowledge_space";
        readonly tenantId: string;
      }
    | {
        readonly knowledgeSpaceId: string;
        readonly sourceId: string;
        readonly targetType: "source";
        readonly tenantId: string;
      }
    | {
        readonly documentId: string;
        readonly knowledgeSpaceId: string;
        readonly targetType: "logical_document";
        readonly tenantId: string;
      },
): Promise<void> {
  const params: DatabaseQueryValue[] = [input.tenantId, input.knowledgeSpaceId];
  let predicate = `child_tombstone.${q(database, "target_type")} IN ('source', 'document_asset', 'logical_document')`;
  if (input.targetType === "source") {
    params.push(input.sourceId);
    predicate = `((child_tombstone.${q(database, "target_type")} = 'document_asset' AND EXISTS (SELECT 1 FROM ${q(database, "document_assets")} child_document WHERE child_document.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND child_document.${q(database, "id")} = child_tombstone.${q(database, "target_id")} AND child_document.${q(database, "source_id")} = ${p(database, 3)})) OR (child_tombstone.${q(database, "target_type")} = 'logical_document' AND EXISTS (SELECT 1 FROM ${q(database, "logical_documents")} child_logical WHERE child_logical.${q(database, "tenant_id")} = ${p(database, 1)} AND child_logical.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND child_logical.${q(database, "id")} = child_tombstone.${q(database, "target_id")} AND child_logical.${q(database, "source_id")} = ${p(database, 3)})))`;
  } else if (input.targetType === "logical_document") {
    params.push(input.documentId);
    predicate = `child_tombstone.${q(database, "target_type")} = 'document_asset' AND EXISTS (SELECT 1 FROM ${q(database, "document_revisions")} child_revision WHERE child_revision.${q(database, "tenant_id")} = ${p(database, 1)} AND child_revision.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND child_revision.${q(database, "document_id")} = ${p(database, 3)} AND child_revision.${q(database, "document_asset_id")} = child_tombstone.${q(database, "target_id")})`;
  }
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT child_tombstone.${q(database, "deletion_job_id")} FROM ${q(database, tombstoneTable)} child_tombstone WHERE child_tombstone.${q(database, "tenant_id")} = ${p(database, 1)} AND child_tombstone.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND child_tombstone.${q(database, "state")} = 'active' AND ${predicate} ORDER BY child_tombstone.${q(database, "id")} ASC LIMIT 1 FOR UPDATE;`,
    tableName: tombstoneTable,
  });
  const blocker = result.rows[0] ? stringColumn(result.rows[0], "deletion_job_id") : undefined;
  if (blocker) {
    throw new DurableDeletionTargetConflictError(
      `${input.targetType === "knowledge_space" ? "Knowledge space" : input.targetType === "source" ? "Source" : "Logical document"} deletion is blocked by active child deletion ${blocker}`,
    );
  }
}

function assertActiveSpace(space: LockedSpace): void {
  if (space.lifecycleState !== "active" || space.deletionJobId) {
    throw new DurableDeletionTargetConflictError("Knowledge space is deleting or deleted");
  }
}

async function markTargetDeleting(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionJob,
  options: { readonly expectedDocumentVersion?: number | undefined },
): Promise<number> {
  if (job.targetType === "knowledge_space") {
    const marked = await executor.execute({
      maxRows: 0,
      operation: "update",
      params: [
        job.id,
        job.updatedAt,
        job.targetRevision + 1,
        job.tenantId,
        job.targetId,
        job.targetRevision,
      ],
      sql: `UPDATE ${q(database, "knowledge_spaces")} SET ${q(database, "lifecycle_state")} = 'deleting', ${q(database, "deletion_job_id")} = ${p(database, 1)}, ${q(database, "deleting_at")} = ${p(database, 2)}, ${q(database, "revision")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "tenant_id")} = ${p(database, 4)} AND ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "revision")} = ${p(database, 6)} AND ${q(database, "lifecycle_state")} = 'active' AND ${q(database, "deletion_job_id")} IS NULL;`,
      tableName: "knowledge_spaces",
    });
    if (marked.rowsAffected === 1) {
      await invalidateAgentWorkspaceSnapshots(database, executor, job);
    }
    return marked.rowsAffected;
  }
  if (job.targetType === "source") {
    const marked = await executor.execute({
      maxRows: 0,
      operation: "update",
      params: [
        job.id,
        job.updatedAt,
        job.targetRevision + 1,
        job.knowledgeSpaceId,
        job.targetId,
        job.targetRevision,
      ],
      sql: `UPDATE ${q(database, "sources")} SET ${q(database, "status")} = 'deleting', ${q(database, "deletion_job_id")} = ${p(database, 1)}, ${q(database, "deleting_at")} = ${p(database, 2)}, ${q(database, "version")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 4)} AND ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "version")} = ${p(database, 6)} AND ${q(database, "status")} <> 'deleting' AND ${q(database, "deletion_job_id")} IS NULL;`,
      tableName: "sources",
    });
    if (marked.rowsAffected !== 1) return marked.rowsAffected;

    // Source deletion must become read-invisible in the same transaction as its tombstone. All
    // document and retrieval reads already fail closed on document_assets.lifecycle_state; linking
    // the children to this source job closes the queue-to-publication-exclusion visibility window.
    await executor.execute({
      maxRows: 0,
      operation: "update",
      params: [job.id, job.updatedAt, job.knowledgeSpaceId, job.targetId],
      sql: `UPDATE ${q(database, "document_assets")} SET ${q(database, "lifecycle_state")} = 'deleting', ${q(database, "deletion_job_id")} = ${p(database, 1)}, ${q(database, "deleting_at")} = ${p(database, 2)}, ${q(database, "row_version")} = ${q(database, "row_version")} + 1, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 3)} AND ${q(database, "source_id")} = ${p(database, 4)} AND ${q(database, "lifecycle_state")} = 'active' AND ${q(database, "deletion_job_id")} IS NULL;`,
      tableName: "document_assets",
    });
    await invalidateAgentWorkspaceSnapshots(database, executor, job);
    return marked.rowsAffected;
  }
  if (job.targetType === "logical_document") {
    const marked = await executor.execute({
      maxRows: 0,
      operation: "update",
      params: [
        job.id,
        job.updatedAt,
        job.tenantId,
        job.knowledgeSpaceId,
        job.targetId,
        job.targetRevision,
      ],
      sql: `UPDATE ${q(database, "logical_documents")} SET ${q(database, "status")} = 'deleting', ${q(database, "deletion_job_id")} = ${p(database, 1)}, ${q(database, "deleting_at")} = ${p(database, 2)}, ${q(database, "row_version")} = ${q(database, "row_version")} + 1, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "tenant_id")} = ${p(database, 3)} AND ${q(database, "knowledge_space_id")} = ${p(database, 4)} AND ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "row_version")} = ${p(database, 6)} AND ${q(database, "status")} <> 'deleting' AND ${q(database, "deletion_job_id")} IS NULL;`,
      tableName: "logical_documents",
    });
    if (marked.rowsAffected !== 1) return marked.rowsAffected;

    // Freeze only physical assets exclusively owned by this aggregate. A rollback can reuse an
    // historical asset from another aggregate; reference-counting here keeps that shared binary
    // and its derived rows available to the surviving document.
    await executor.execute({
      maxRows: 0,
      operation: "update",
      params: [job.id, job.updatedAt, job.tenantId, job.knowledgeSpaceId, job.targetId],
      sql: `UPDATE ${q(database, "document_assets")} asset SET ${q(database, "lifecycle_state")} = 'deleting', ${q(database, "deletion_job_id")} = ${p(database, 1)}, ${q(database, "deleting_at")} = ${p(database, 2)}, ${q(database, "row_version")} = asset.${q(database, "row_version")} + 1, ${q(database, "updated_at")} = ${p(database, 2)} WHERE asset.${q(database, "knowledge_space_id")} = ${p(database, 4)} AND asset.${q(database, "lifecycle_state")} = 'active' AND asset.${q(database, "deletion_job_id")} IS NULL AND EXISTS (SELECT 1 FROM ${q(database, "document_revisions")} owned_revision WHERE owned_revision.${q(database, "tenant_id")} = ${p(database, 3)} AND owned_revision.${q(database, "knowledge_space_id")} = ${p(database, 4)} AND owned_revision.${q(database, "document_id")} = ${p(database, 5)} AND owned_revision.${q(database, "document_asset_id")} = asset.${q(database, "id")}) AND NOT EXISTS (SELECT 1 FROM ${q(database, "document_revisions")} external_revision WHERE external_revision.${q(database, "tenant_id")} = ${p(database, 3)} AND external_revision.${q(database, "knowledge_space_id")} = ${p(database, 4)} AND external_revision.${q(database, "document_id")} <> ${p(database, 5)} AND external_revision.${q(database, "document_asset_id")} = asset.${q(database, "id")});`,
      tableName: "document_assets",
    });
    await invalidateAgentWorkspaceSnapshots(database, executor, job);
    return marked.rowsAffected;
  }
  const marked = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [
      job.id,
      job.updatedAt,
      job.targetRevision + 1,
      job.knowledgeSpaceId,
      job.targetId,
      options.expectedDocumentVersion ?? 0,
      job.targetRevision,
    ],
    sql: `UPDATE ${q(database, "document_assets")} SET ${q(database, "lifecycle_state")} = 'deleting', ${q(database, "deletion_job_id")} = ${p(database, 1)}, ${q(database, "deleting_at")} = ${p(database, 2)}, ${q(database, "row_version")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 2)} WHERE ${q(database, "knowledge_space_id")} = ${p(database, 4)} AND ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "version")} = ${p(database, 6)} AND ${q(database, "row_version")} = ${p(database, 7)} AND ${q(database, "lifecycle_state")} = 'active' AND ${q(database, "deletion_job_id")} IS NULL;`,
    tableName: "document_assets",
  });
  if (marked.rowsAffected === 1) {
    await invalidateAgentWorkspaceSnapshots(database, executor, job);
  }
  return marked.rowsAffected;
}

async function invalidateAgentWorkspaceSnapshots(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionJob,
): Promise<void> {
  await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [
      job.updatedAt,
      `durable-deletion:${job.targetType}`,
      job.tenantId,
      job.knowledgeSpaceId,
    ],
    sql: `UPDATE ${q(database, "agent_workspace_snapshots")} SET ${q(database, "invalidated_at")} = ${p(database, 1)}, ${q(database, "invalidation_reason")} = ${p(database, 2)} WHERE ${q(database, "tenant_id")} = ${p(database, 3)} AND ${q(database, "knowledge_space_id")} = ${p(database, 4)} AND ${q(database, "invalidated_at")} IS NULL;`,
    tableName: "agent_workspace_snapshots",
  });
}

function initialJob(
  input: RequestDurableDeletionBase & {
    readonly deleteMode: DurableDeletionMode;
    readonly id: string;
    readonly maxExecutionAttempts: number;
    readonly nameChallengeDigest?: string | undefined;
    readonly requestFingerprint: string;
    readonly targetId: string;
    readonly targetRevision: number;
    readonly targetType: DurableDeletionTargetType;
  },
): DurableDeletionJob {
  return {
    accessChannel: input.accessChannel,
    activeSlot: 1,
    ...(input.apiKeyExpiresAt ? { apiKeyExpiresAt: input.apiKeyExpiresAt } : {}),
    ...(input.apiKeyId ? { apiKeyId: input.apiKeyId } : {}),
    ...(input.apiKeyRevision ? { apiKeyRevision: input.apiKeyRevision } : {}),
    checkpoint: "requested",
    createdAt: input.createdAt,
    deleteMode: input.deleteMode,
    executionAttempts: 0,
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    inventoryComplete: false,
    knowledgeSpaceId: input.knowledgeSpaceId,
    maxExecutionAttempts: input.maxExecutionAttempts,
    ...(input.nameChallengeDigest ? { nameChallengeDigest: input.nameChallengeDigest } : {}),
    permissionSnapshotId: input.permissionSnapshotId,
    permissionSnapshotRevision: input.permissionSnapshotRevision,
    requestFingerprint: input.requestFingerprint,
    requestedBySubjectId: input.requestedBySubjectId,
    rowVersion: 1,
    runState: "dispatch_pending",
    targetId: input.targetId,
    targetRevision: input.targetRevision,
    targetType: input.targetType,
    tenantId: input.tenantId,
    updatedAt: input.createdAt,
  };
}

function initialTombstone(
  input: Omit<DurableDeletionTombstone, "rowVersion" | "state">,
): DurableDeletionTombstone {
  return { ...input, rowVersion: 1, state: "active" };
}

function initialOutbox(id: string, job: DurableDeletionJob): DurableDeletionOutboxEvent {
  return {
    availableAt: job.createdAt,
    createdAt: job.createdAt,
    deletionJobId: job.id,
    deliveryRevision: 1,
    dispatchAttempts: 0,
    eventType: DurableDeletionOutboxEventType,
    id,
    idempotencyKey: `deletion:${job.id}:1`,
    payload: { deletionJobId: job.id },
    requestFingerprint: job.requestFingerprint,
    requestIdempotencyKey: job.idempotencyKey,
    schemaVersion: DurableDeletionOutboxSchemaVersion,
    status: "pending",
    updatedAt: job.createdAt,
  };
}

function initialItem(
  id: string,
  job: DurableDeletionJob,
  input: DurableDeletionInventoryItemInput,
  payloadDigest: string,
): DurableDeletionJobItem {
  const normalized = normalizeInventoryItem(input);
  return {
    attempts: 0,
    ...(normalized.cacheKey ? { cacheKey: normalized.cacheKey } : {}),
    createdAt: job.createdAt,
    ...(normalized.credentialRef ? { credentialRef: normalized.credentialRef } : {}),
    deletionJobId: job.id,
    id,
    idempotencyKey: normalized.idempotencyKey,
    kind: normalized.kind,
    maxAttempts: normalized.maxAttempts,
    ...(normalized.objectKey ? { objectKey: normalized.objectKey } : {}),
    ordinal: normalized.ordinal,
    payloadDigest,
    ...(normalized.resourceId ? { resourceId: normalized.resourceId } : {}),
    rowVersion: 1,
    status: "pending",
    updatedAt: job.createdAt,
  };
}

async function insertJobForRequest(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionJob,
): Promise<void> {
  const record = jobRecord(job);
  const entries = Object.entries(record);
  const suffix =
    database.dialect === "postgres"
      ? ` ON CONFLICT (${q(database, "tenant_id")}, ${q(database, "idempotency_key")}) DO NOTHING`
      : ` ON DUPLICATE KEY UPDATE ${q(database, "id")} = ${q(database, "id")}`;
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: entries.map(([, value]) => value),
    sql: `INSERT INTO ${q(database, jobTable)} (${entries.map(([column]) => q(database, column)).join(", ")}) VALUES (${entries.map((_, index) => p(database, index + 1)).join(", ")})${suffix};`,
    tableName: jobTable,
  });
}

function jobRecord(job: DurableDeletionJob): Readonly<Record<string, DatabaseQueryValue>> {
  return {
    access_channel: job.accessChannel,
    active_slot: job.activeSlot ?? null,
    api_key_expires_at: job.apiKeyExpiresAt ?? null,
    api_key_id: job.apiKeyId ?? null,
    api_key_revision: job.apiKeyRevision ?? null,
    checkpoint: job.checkpoint,
    completed_at: job.completedAt ?? null,
    created_at: job.createdAt,
    delete_mode: job.deleteMode,
    execution_attempts: job.executionAttempts,
    heartbeat_at: job.heartbeatAt ?? null,
    id: job.id,
    idempotency_key: job.idempotencyKey,
    inventory_complete: job.inventoryComplete,
    knowledge_space_id: job.knowledgeSpaceId,
    last_error_code: job.lastErrorCode ?? null,
    last_error_message: job.lastErrorMessage ?? null,
    lease_expires_at: job.leaseExpiresAt ?? null,
    lease_token: job.leaseToken ?? null,
    max_execution_attempts: job.maxExecutionAttempts,
    name_challenge_digest: job.nameChallengeDigest ?? null,
    permission_snapshot_id: job.permissionSnapshotId,
    permission_snapshot_revision: job.permissionSnapshotRevision,
    queue_job_id: job.queueJobId ?? null,
    request_fingerprint: job.requestFingerprint,
    requested_by_subject_id: job.requestedBySubjectId,
    retry_at: job.retryAt ?? null,
    row_version: job.rowVersion,
    run_state: job.runState,
    scan_cursor: job.scanCursor ?? null,
    scan_phase: job.scanPhase ?? null,
    started_at: job.startedAt ?? null,
    target_id: job.targetId,
    target_revision: job.targetRevision,
    target_type: job.targetType,
    tenant_id: job.tenantId,
    updated_at: job.updatedAt,
    worker_id: job.workerId ?? null,
  };
}

async function insertTombstone(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tombstone: DurableDeletionTombstone,
): Promise<void> {
  await insertRecord(database, executor, tombstoneTable, {
    completed_at: tombstone.completedAt ?? null,
    created_at: tombstone.createdAt,
    deletion_job_id: tombstone.deletionJobId,
    id: tombstone.id,
    knowledge_space_id: tombstone.knowledgeSpaceId,
    row_version: tombstone.rowVersion,
    state: tombstone.state,
    target_id: tombstone.targetId,
    target_revision: tombstone.targetRevision,
    target_type: tombstone.targetType,
    tenant_id: tombstone.tenantId,
  });
}

async function insertOutbox(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  outbox: DurableDeletionOutboxEvent,
): Promise<void> {
  await insertRecord(
    database,
    executor,
    outboxTable,
    {
      available_at: outbox.availableAt,
      created_at: outbox.createdAt,
      deletion_job_id: outbox.deletionJobId,
      delivered_at: outbox.deliveredAt ?? null,
      delivery_revision: outbox.deliveryRevision,
      dispatch_attempts: outbox.dispatchAttempts,
      event_type: outbox.eventType,
      id: outbox.id,
      idempotency_key: outbox.idempotencyKey,
      last_error: outbox.lastError ?? null,
      locked_by: outbox.lockedBy ?? null,
      locked_until: outbox.lockedUntil ?? null,
      lock_token: outbox.lockToken ?? null,
      payload: JSON.stringify(outbox.payload),
      queue_job_id: outbox.queueJobId ?? null,
      request_fingerprint: outbox.requestFingerprint,
      request_idempotency_key: outbox.requestIdempotencyKey,
      schema_version: outbox.schemaVersion,
      status: outbox.status,
      updated_at: outbox.updatedAt,
    },
    new Set(["payload"]),
  );
}

async function insertItem(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  item: DurableDeletionJobItem,
): Promise<void> {
  await insertRecord(database, executor, itemTable, {
    attempts: item.attempts,
    cache_key: item.cacheKey ?? null,
    completed_at: item.completedAt ?? null,
    created_at: item.createdAt,
    credential_ref: item.credentialRef ?? null,
    deletion_job_id: item.deletionJobId,
    id: item.id,
    idempotency_key: item.idempotencyKey,
    kind: item.kind,
    last_error_code: item.lastErrorCode ?? null,
    last_error_message: item.lastErrorMessage ?? null,
    max_attempts: item.maxAttempts,
    next_attempt_at: item.nextAttemptAt ?? null,
    object_key: item.objectKey ?? null,
    ordinal: item.ordinal,
    payload_digest: item.payloadDigest,
    redacted_at: item.redactedAt ?? null,
    resource_id: item.resourceId ?? null,
    row_version: item.rowVersion,
    status: item.status,
    updated_at: item.updatedAt,
  });
}

async function insertRecord(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tableName: string,
  record: Readonly<Record<string, DatabaseQueryValue>>,
  jsonColumns: ReadonlySet<string> = new Set(),
): Promise<void> {
  const entries = Object.entries(record);
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: entries.map(([, value]) => value),
    sql: `INSERT INTO ${q(database, tableName)} (${entries.map(([column]) => q(database, column)).join(", ")}) VALUES (${entries.map(([column], index) => (jsonColumns.has(column) ? jsonPlaceholder(database, index + 1) : p(database, index + 1))).join(", ")});`,
    tableName,
  });
}

async function getJobByIdempotency(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  tenantId: string,
  idempotencyKey: string,
  forUpdate: boolean,
): Promise<DurableDeletionJob | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [tenantId, idempotencyKey],
    sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "idempotency_key")} = ${p(database, 2)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: jobTable,
  });
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function getJobRow(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
  forUpdate: boolean,
  tenantId?: string | undefined,
): Promise<DurableDeletionJob | null> {
  const params: DatabaseQueryValue[] = [id];
  const tenantPredicate = tenantId ? ` AND ${q(database, "tenant_id")} = ${p(database, 2)}` : "";
  if (tenantId) params.push(tenantId);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(database, "id")} = ${p(database, 1)}${tenantPredicate} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: jobTable,
  });
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function hasRetryAuditActor(
  database: DatabaseAdapter,
  input: { readonly jobId: string; readonly subjectId: string; readonly tenantId: string },
): Promise<boolean> {
  const result = await database.execute({
    maxRows: 1,
    operation: "select",
    params: [
      boundedString(input.tenantId, 255, "retryAuditActor.tenantId"),
      requiredString(input.jobId, "retryAuditActor.jobId"),
      boundedString(input.subjectId, 255, "retryAuditActor.subjectId"),
    ],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, "deletion_retry_audits")} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "deletion_job_id")} = ${p(database, 2)} AND ${q(database, "actor_subject_id")} = ${p(database, 3)} AND ${q(database, "retry_authority")} = 'interactive_owner_rescue' AND ${q(database, "access_channel")} = 'interactive' LIMIT 1;`,
    tableName: "deletion_retry_audits",
  });
  return result.rows.length > 0;
}

async function getTombstoneRow(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly knowledgeSpaceId?: string | undefined;
    readonly targetId: string;
    readonly targetType: DurableDeletionTargetType;
    readonly tenantId: string;
  },
  forUpdate: boolean,
): Promise<DurableDeletionTombstone | null> {
  const params: DatabaseQueryValue[] = [input.tenantId, input.targetType, input.targetId];
  const spacePredicate = input.knowledgeSpaceId
    ? ` AND ${q(database, "knowledge_space_id")} = ${p(database, 4)}`
    : "";
  if (input.knowledgeSpaceId) {
    params.push(input.knowledgeSpaceId);
  }
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT * FROM ${q(database, tombstoneTable)} WHERE ${q(database, "tenant_id")} = ${p(database, 1)} AND ${q(database, "target_type")} = ${p(database, 2)} AND ${q(database, "target_id")} = ${p(database, 3)}${spacePredicate} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: tombstoneTable,
  });
  return result.rows[0] ? mapTombstone(result.rows[0]) : null;
}

async function getItemByIdempotency(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  deletionJobId: string,
  idempotencyKey: string,
  forUpdate: boolean,
): Promise<DurableDeletionJobItem | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [deletionJobId, idempotencyKey],
    sql: `SELECT * FROM ${q(database, itemTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)} AND ${q(database, "idempotency_key")} = ${p(database, 2)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: itemTable,
  });
  return result.rows[0] ? mapItem(result.rows[0]) : null;
}

async function getItemRow(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  deletionJobId: string,
  itemId: string,
  forUpdate: boolean,
): Promise<DurableDeletionJobItem | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [deletionJobId, itemId],
    sql: `SELECT * FROM ${q(database, itemTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)} AND ${q(database, "id")} = ${p(database, 2)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: itemTable,
  });
  return result.rows[0] ? mapItem(result.rows[0]) : null;
}

async function getOutboxRow(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
  forUpdate: boolean,
): Promise<DurableDeletionOutboxEvent | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [id],
    sql: `SELECT * FROM ${q(database, outboxTable)} WHERE ${q(database, "id")} = ${p(database, 1)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: outboxTable,
  });
  return result.rows[0] ? mapOutbox(result.rows[0]) : null;
}

async function getOutboxByRequest(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  deletionJobId: string,
  requestIdempotencyKey: string,
  forUpdate: boolean,
): Promise<DurableDeletionOutboxEvent | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [deletionJobId, requestIdempotencyKey],
    sql: `SELECT * FROM ${q(database, outboxTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)} AND ${q(database, "request_idempotency_key")} = ${p(database, 2)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: outboxTable,
  });
  return result.rows[0] ? mapOutbox(result.rows[0]) : null;
}

async function getTombstoneByJob(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  deletionJobId: string,
  forUpdate: boolean,
): Promise<DurableDeletionTombstone | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [deletionJobId],
    sql: `SELECT * FROM ${q(database, tombstoneTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: tombstoneTable,
  });
  return result.rows[0] ? mapTombstone(result.rows[0]) : null;
}

async function nextOutboxDeliveryRevision(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  deletionJobId: string,
): Promise<number> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [deletionJobId],
    sql: `SELECT ${q(database, "delivery_revision")} FROM ${q(database, outboxTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)} ORDER BY ${q(database, "delivery_revision")} DESC LIMIT 1 FOR UPDATE;`,
    tableName: outboxTable,
  });
  return (result.rows[0] ? numberColumn(result.rows[0], "delivery_revision") : 0) + 1;
}

async function resultForJobAndOutbox(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionJob,
  outbox: DurableDeletionOutboxEvent,
  created: boolean,
): Promise<RequestDurableDeletionResult> {
  const tombstone = await getTombstoneByJob(database, executor, job.id, false);
  if (!tombstone) throw new Error("Durable deletion tombstone is missing");
  return { created, job: cloneJob(job), outbox: cloneOutbox(outbox), tombstone };
}

async function existingRequestResult(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  job: DurableDeletionJob,
): Promise<RequestDurableDeletionResult> {
  const tombstoneResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id],
    sql: `SELECT * FROM ${q(database, tombstoneTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)} LIMIT 1;`,
    tableName: tombstoneTable,
  });
  const outboxResult = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [job.id],
    sql: `SELECT * FROM ${q(database, outboxTable)} WHERE ${q(database, "deletion_job_id")} = ${p(database, 1)} ORDER BY ${q(database, "delivery_revision")} DESC LIMIT 1;`,
    tableName: outboxTable,
  });
  if (!tombstoneResult.rows[0] || !outboxResult.rows[0]) {
    throw new Error("Durable deletion request ledger is incomplete");
  }
  return {
    created: false,
    job: cloneJob(job),
    outbox: mapOutbox(outboxResult.rows[0]),
    tombstone: mapTombstone(tombstoneResult.rows[0]),
  };
}

function mapJob(row: DatabaseRow): DurableDeletionJob {
  return {
    accessChannel: enumValue(
      stringColumn(row, "access_channel"),
      ["interactive", "service_api", "mcp", "agent"] as const,
      "access_channel",
    ),
    ...(optionalNumberColumn(row, "active_slot") === 1 ? { activeSlot: 1 } : {}),
    ...(optionalStringColumn(row, "api_key_expires_at")
      ? { apiKeyExpiresAt: optionalStringColumn(row, "api_key_expires_at") }
      : {}),
    ...(optionalStringColumn(row, "api_key_id")
      ? { apiKeyId: optionalStringColumn(row, "api_key_id") }
      : {}),
    ...(optionalNumberColumn(row, "api_key_revision")
      ? { apiKeyRevision: optionalNumberColumn(row, "api_key_revision") }
      : {}),
    checkpoint: enumValue(
      stringColumn(row, "checkpoint"),
      DurableDeletionCheckpoints,
      "checkpoint",
    ),
    ...(optionalStringColumn(row, "completed_at")
      ? { completedAt: optionalStringColumn(row, "completed_at") }
      : {}),
    createdAt: stringColumn(row, "created_at"),
    deleteMode: enumValue(stringColumn(row, "delete_mode"), DurableDeletionModes, "delete_mode"),
    executionAttempts: numberColumn(row, "execution_attempts"),
    ...(optionalStringColumn(row, "heartbeat_at")
      ? { heartbeatAt: optionalStringColumn(row, "heartbeat_at") }
      : {}),
    id: stringColumn(row, "id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    inventoryComplete: booleanColumn(row, "inventory_complete"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ...(optionalStringColumn(row, "last_error_code")
      ? { lastErrorCode: optionalStringColumn(row, "last_error_code") }
      : {}),
    ...(optionalStringColumn(row, "last_error_message")
      ? { lastErrorMessage: optionalStringColumn(row, "last_error_message") }
      : {}),
    ...(optionalStringColumn(row, "lease_expires_at")
      ? { leaseExpiresAt: optionalStringColumn(row, "lease_expires_at") }
      : {}),
    ...(optionalStringColumn(row, "lease_token")
      ? { leaseToken: optionalStringColumn(row, "lease_token") }
      : {}),
    maxExecutionAttempts: numberColumn(row, "max_execution_attempts"),
    ...(optionalStringColumn(row, "name_challenge_digest")
      ? { nameChallengeDigest: optionalStringColumn(row, "name_challenge_digest") }
      : {}),
    permissionSnapshotId: stringColumn(row, "permission_snapshot_id"),
    permissionSnapshotRevision: numberColumn(row, "permission_snapshot_revision"),
    ...(optionalStringColumn(row, "queue_job_id")
      ? { queueJobId: optionalStringColumn(row, "queue_job_id") }
      : {}),
    requestFingerprint: stringColumn(row, "request_fingerprint"),
    requestedBySubjectId: stringColumn(row, "requested_by_subject_id"),
    ...(optionalStringColumn(row, "retry_at")
      ? { retryAt: optionalStringColumn(row, "retry_at") }
      : {}),
    rowVersion: numberColumn(row, "row_version"),
    runState: enumValue(stringColumn(row, "run_state"), DurableDeletionRunStates, "run_state"),
    ...(optionalStringColumn(row, "scan_cursor")
      ? { scanCursor: optionalStringColumn(row, "scan_cursor") }
      : {}),
    ...(optionalStringColumn(row, "scan_phase")
      ? { scanPhase: optionalStringColumn(row, "scan_phase") }
      : {}),
    ...(optionalStringColumn(row, "started_at")
      ? { startedAt: optionalStringColumn(row, "started_at") }
      : {}),
    targetId: stringColumn(row, "target_id"),
    targetRevision: numberColumn(row, "target_revision"),
    targetType: enumValue(
      stringColumn(row, "target_type"),
      DurableDeletionTargetTypes,
      "target_type",
    ),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    ...(optionalStringColumn(row, "worker_id")
      ? { workerId: optionalStringColumn(row, "worker_id") }
      : {}),
  };
}

function mapTombstone(row: DatabaseRow): DurableDeletionTombstone {
  return {
    ...(optionalStringColumn(row, "completed_at")
      ? { completedAt: optionalStringColumn(row, "completed_at") }
      : {}),
    createdAt: stringColumn(row, "created_at"),
    deletionJobId: stringColumn(row, "deletion_job_id"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    rowVersion: numberColumn(row, "row_version"),
    state: enumValue(stringColumn(row, "state"), DurableDeletionTombstoneStates, "state"),
    targetId: stringColumn(row, "target_id"),
    targetRevision: numberColumn(row, "target_revision"),
    targetType: enumValue(
      stringColumn(row, "target_type"),
      DurableDeletionTargetTypes,
      "target_type",
    ),
    tenantId: stringColumn(row, "tenant_id"),
  };
}

function mapItem(row: DatabaseRow): DurableDeletionJobItem {
  return {
    attempts: numberColumn(row, "attempts"),
    ...(optionalStringColumn(row, "cache_key")
      ? { cacheKey: optionalStringColumn(row, "cache_key") }
      : {}),
    ...(optionalStringColumn(row, "completed_at")
      ? { completedAt: optionalStringColumn(row, "completed_at") }
      : {}),
    createdAt: stringColumn(row, "created_at"),
    ...(optionalStringColumn(row, "credential_ref")
      ? { credentialRef: optionalStringColumn(row, "credential_ref") }
      : {}),
    deletionJobId: stringColumn(row, "deletion_job_id"),
    id: stringColumn(row, "id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    kind: enumValue(stringColumn(row, "kind"), DurableDeletionItemKinds, "item.kind"),
    ...(optionalStringColumn(row, "last_error_code")
      ? { lastErrorCode: optionalStringColumn(row, "last_error_code") }
      : {}),
    ...(optionalStringColumn(row, "last_error_message")
      ? { lastErrorMessage: optionalStringColumn(row, "last_error_message") }
      : {}),
    maxAttempts: numberColumn(row, "max_attempts"),
    ...(optionalStringColumn(row, "next_attempt_at")
      ? { nextAttemptAt: optionalStringColumn(row, "next_attempt_at") }
      : {}),
    ...(optionalStringColumn(row, "object_key")
      ? { objectKey: optionalStringColumn(row, "object_key") }
      : {}),
    ordinal: numberColumn(row, "ordinal"),
    payloadDigest: stringColumn(row, "payload_digest"),
    ...(optionalStringColumn(row, "redacted_at")
      ? { redactedAt: optionalStringColumn(row, "redacted_at") }
      : {}),
    ...(optionalStringColumn(row, "resource_id")
      ? { resourceId: optionalStringColumn(row, "resource_id") }
      : {}),
    rowVersion: numberColumn(row, "row_version"),
    status: enumValue(stringColumn(row, "status"), DurableDeletionItemStatuses, "item.status"),
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function mapOutbox(row: DatabaseRow): DurableDeletionOutboxEvent {
  const payload = jsonObjectColumn(row, "payload");
  const deletionJobId = stringColumn(row, "deletion_job_id");
  if (payload.deletionJobId !== deletionJobId) {
    throw new Error("Durable deletion outbox payload does not match its job");
  }
  return {
    availableAt: stringColumn(row, "available_at"),
    createdAt: stringColumn(row, "created_at"),
    deletionJobId,
    ...(optionalStringColumn(row, "delivered_at")
      ? { deliveredAt: optionalStringColumn(row, "delivered_at") }
      : {}),
    deliveryRevision: numberColumn(row, "delivery_revision"),
    dispatchAttempts: numberColumn(row, "dispatch_attempts"),
    eventType: literalValue(
      stringColumn(row, "event_type"),
      DurableDeletionOutboxEventType,
      "event_type",
    ),
    id: stringColumn(row, "id"),
    idempotencyKey: stringColumn(row, "idempotency_key"),
    ...(optionalStringColumn(row, "last_error")
      ? { lastError: optionalStringColumn(row, "last_error") }
      : {}),
    ...(optionalStringColumn(row, "locked_by")
      ? { lockedBy: optionalStringColumn(row, "locked_by") }
      : {}),
    ...(optionalStringColumn(row, "locked_until")
      ? { lockedUntil: optionalStringColumn(row, "locked_until") }
      : {}),
    ...(optionalStringColumn(row, "lock_token")
      ? { lockToken: optionalStringColumn(row, "lock_token") }
      : {}),
    payload: { deletionJobId },
    ...(optionalStringColumn(row, "queue_job_id")
      ? { queueJobId: optionalStringColumn(row, "queue_job_id") }
      : {}),
    requestFingerprint: stringColumn(row, "request_fingerprint"),
    requestIdempotencyKey: stringColumn(row, "request_idempotency_key"),
    schemaVersion: numberLiteral(
      numberColumn(row, "schema_version"),
      DurableDeletionOutboxSchemaVersion,
      "schema_version",
    ),
    status: enumValue(stringColumn(row, "status"), DurableDeletionOutboxStatuses, "status"),
    updatedAt: stringColumn(row, "updated_at"),
  };
}

function normalizeRequestBase<T extends RequestDurableDeletionBase>(input: T): T {
  const apiKeyId = optionalTrimmed(input.apiKeyId);
  const apiKeyRevision = input.apiKeyRevision;
  const apiKeyExpiresAt = optionalTrimmed(input.apiKeyExpiresAt);
  if (
    (apiKeyId === undefined && (apiKeyRevision !== undefined || apiKeyExpiresAt !== undefined)) ||
    (apiKeyId !== undefined &&
      (!Number.isSafeInteger(apiKeyRevision) || (apiKeyRevision ?? 0) < 1)) ||
    (apiKeyId !== undefined && input.accessChannel !== "service_api")
  ) {
    throw new Error("Durable deletion API-key provenance is inconsistent");
  }
  return {
    ...input,
    accessChannel: enumValue(
      input.accessChannel,
      ["interactive", "service_api", "mcp", "agent"] as const,
      "accessChannel",
    ),
    ...(apiKeyExpiresAt ? { apiKeyExpiresAt: isoDate(apiKeyExpiresAt, "apiKeyExpiresAt") } : {}),
    ...(apiKeyId ? { apiKeyId } : {}),
    ...(apiKeyRevision ? { apiKeyRevision } : {}),
    createdAt: isoDate(input.createdAt, "createdAt"),
    idempotencyKey: boundedString(input.idempotencyKey, 512, "idempotencyKey"),
    ...(input.idempotencyContext === undefined
      ? {}
      : {
          idempotencyContext: boundedString(input.idempotencyContext, 128, "idempotencyContext"),
        }),
    knowledgeSpaceId: requiredString(input.knowledgeSpaceId, "knowledgeSpaceId"),
    permissionSnapshotId: requiredString(input.permissionSnapshotId, "permissionSnapshotId"),
    permissionSnapshotRevision: positiveInteger(
      input.permissionSnapshotRevision,
      "permissionSnapshotRevision",
    ),
    requestedBySubjectId: boundedString(input.requestedBySubjectId, 255, "requestedBySubjectId"),
    tenantId: boundedString(input.tenantId, 255, "tenantId"),
  };
}

function normalizePermissionProvenance(
  input: DurableDeletionPermissionProvenance,
): DurableDeletionPermissionProvenance {
  const apiKeyId = optionalTrimmed(input.apiKeyId);
  const apiKeyRevision = input.apiKeyRevision;
  const apiKeyExpiresAt = optionalTrimmed(input.apiKeyExpiresAt);
  const accessChannel = enumValue(
    input.accessChannel,
    ["interactive", "service_api", "mcp", "agent"] as const,
    "accessChannel",
  );
  if (
    (apiKeyId === undefined && (apiKeyRevision !== undefined || apiKeyExpiresAt !== undefined)) ||
    (apiKeyId !== undefined &&
      (!Number.isSafeInteger(apiKeyRevision) || (apiKeyRevision ?? 0) < 1)) ||
    (apiKeyId !== undefined && accessChannel !== "service_api")
  ) {
    throw new Error("Durable deletion API-key provenance is inconsistent");
  }
  return {
    accessChannel,
    ...(apiKeyExpiresAt ? { apiKeyExpiresAt: isoDate(apiKeyExpiresAt, "apiKeyExpiresAt") } : {}),
    ...(apiKeyId ? { apiKeyId } : {}),
    ...(apiKeyRevision ? { apiKeyRevision } : {}),
    permissionSnapshotId: requiredString(input.permissionSnapshotId, "permissionSnapshotId"),
    permissionSnapshotRevision: positiveInteger(
      input.permissionSnapshotRevision,
      "permissionSnapshotRevision",
    ),
    requestedBySubjectId: boundedString(input.requestedBySubjectId, 255, "requestedBySubjectId"),
  };
}

function sameStableRequester(
  job: DurableDeletionJob,
  provenance: DurableDeletionPermissionProvenance,
): boolean {
  return (
    job.requestedBySubjectId === provenance.requestedBySubjectId &&
    job.accessChannel === provenance.accessChannel &&
    job.apiKeyId === provenance.apiKeyId &&
    job.apiKeyRevision === provenance.apiKeyRevision &&
    job.apiKeyExpiresAt === provenance.apiKeyExpiresAt
  );
}

function normalizeInventoryItem(
  input: DurableDeletionInventoryItemInput,
): DurableDeletionInventoryItemInput {
  const normalized = {
    ...(optionalTrimmed(input.cacheKey) ? { cacheKey: input.cacheKey?.trim() } : {}),
    ...(optionalTrimmed(input.credentialRef) ? { credentialRef: input.credentialRef?.trim() } : {}),
    idempotencyKey: boundedString(input.idempotencyKey, 512, "item.idempotencyKey"),
    kind: enumValue(input.kind, DurableDeletionItemKinds, "item.kind"),
    maxAttempts: positiveInteger(input.maxAttempts, "item.maxAttempts"),
    ...(optionalTrimmed(input.objectKey) ? { objectKey: input.objectKey?.trim() } : {}),
    ordinal: nonnegativeInteger(input.ordinal, "item.ordinal"),
    ...(optionalTrimmed(input.resourceId) ? { resourceId: input.resourceId?.trim() } : {}),
  } satisfies DurableDeletionInventoryItemInput;
  const exactCount = [normalized.objectKey, normalized.credentialRef, normalized.cacheKey].filter(
    Boolean,
  ).length;
  if (
    (normalized.kind === "object" && (exactCount !== 1 || !normalized.objectKey)) ||
    (normalized.kind === "secret_ref" && (exactCount !== 1 || !normalized.credentialRef)) ||
    (normalized.kind === "cache_key" && (exactCount !== 1 || !normalized.cacheKey)) ||
    ((normalized.kind === "document_cascade" || normalized.kind === "document_detach") &&
      (exactCount !== 0 || !normalized.resourceId))
  ) {
    throw new Error("Durable deletion inventory payload does not match its kind");
  }
  return normalized;
}

function inventoryDigest(
  fingerprinter: DurableDeletionFingerprinter,
  job: Pick<DurableDeletionJob, "idempotencyKey" | "knowledgeSpaceId" | "tenantId">,
  item: DurableDeletionInventoryItemInput,
): string {
  return fingerprintValue(
    fingerprinter({
      knowledgeSpaceId: job.knowledgeSpaceId,
      operationKey: job.idempotencyKey,
      purpose: "inventory_payload",
      tenantId: job.tenantId,
      value: JSON.stringify({
        cacheKey: item.cacheKey ?? null,
        credentialRef: item.credentialRef ?? null,
        kind: item.kind,
        objectKey: item.objectKey ?? null,
        resourceId: item.resourceId ?? null,
      }),
    }),
    "inventory payload",
  );
}

const maxDiagnosticErrorCharacters = 16_384;

function storedDeletionError(input: {
  readonly fallbackCode: string;
  readonly fingerprinter: DurableDeletionFingerprinter;
  readonly job: Pick<DurableDeletionJob, "id" | "knowledgeSpaceId" | "tenantId">;
  readonly rawCode: string;
  readonly rawMessage: string;
}): { readonly code: string; readonly message: string } {
  const fallbackCode = normalizedErrorCode(
    input.fallbackCode,
    "DURABLE_DELETION_PROCESSING_FAILED",
  );
  const code = normalizedErrorCode(input.rawCode, fallbackCode);
  const baseMessage = safeDeletionErrorMessage(code);
  if (
    code === "DURABLE_DELETION_COOPERATIVE_WAIT" ||
    code === "DURABLE_DELETION_COOPERATIVE_YIELD" ||
    code === "DURABLE_DELETION_ITEM_RETRY_WAIT"
  ) {
    return { code, message: baseMessage };
  }
  const rawMessage = typeof input.rawMessage === "string" ? input.rawMessage : "";
  const diagnostic = fingerprintValue(
    input.fingerprinter({
      knowledgeSpaceId: input.job.knowledgeSpaceId,
      operationKey: `${input.job.id}:${code}`,
      purpose: "error_diagnostic",
      tenantId: input.job.tenantId,
      value: JSON.stringify({
        code,
        length: rawMessage.length,
        messagePrefix: rawMessage.slice(0, maxDiagnosticErrorCharacters),
      }),
    }),
    "error diagnostic",
  );
  return { code, message: `${baseMessage} [diagnostic:${diagnostic.slice(0, 16)}]` };
}

function normalizedErrorCode(value: string, fallback: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^[A-Z][A-Z0-9_]{0,63}$/u.test(normalized) ? normalized : fallback;
}

function safeDeletionErrorMessage(code: string): string {
  switch (code) {
    case "DURABLE_DELETION_COOPERATIVE_WAIT":
      return "Durable deletion is waiting for scoped work to drain";
    case "DURABLE_DELETION_COOPERATIVE_YIELD":
      return "Durable deletion yielded after bounded progress";
    case "DURABLE_DELETION_ITEM_RETRY_WAIT":
      return "Durable deletion is waiting to retry external cleanup";
    case "DURABLE_DELETION_ATTEMPTS_EXHAUSTED":
      return "Durable deletion worker attempts were exhausted";
    default:
      if (code.includes("OUTBOX")) return "Durable deletion dispatch failed";
      if (
        code.includes("ITEM") ||
        code.includes("OBJECT") ||
        code.includes("SECRET") ||
        code.includes("CACHE")
      ) {
        return "Durable deletion external cleanup failed";
      }
      return "Durable deletion processing failed";
  }
}

function assertMatchingRequest(job: DurableDeletionJob, requestFingerprint: string): void {
  if (job.requestFingerprint !== requestFingerprint) {
    throw new DurableDeletionIdempotencyConflictError();
  }
}

function fingerprintValue(value: string, field: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Durable deletion ${field} fingerprint must be a lowercase SHA-256 HMAC`);
  }
  return value;
}

function cloneJob(job: DurableDeletionJob): DurableDeletionJob {
  return { ...job };
}

function cloneOutbox(outbox: DurableDeletionOutboxEvent): DurableDeletionOutboxEvent {
  return { ...outbox, payload: { ...outbox.payload } };
}

function cloneTombstone(tombstone: DurableDeletionTombstone): DurableDeletionTombstone {
  return { ...tombstone };
}

function booleanColumn(row: DatabaseRow, column: string): boolean {
  const value = row[column];
  if (typeof value === "boolean") return value;
  if (value === 0) return false;
  if (value === 1) return true;
  throw new Error(`Database row column ${column} must be a boolean`);
}

function requiredString(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Durable deletion ${field} is required`);
  }
  return value.trim();
}

function boundedString(value: string, maxLength: number, field: string): string {
  const normalized = requiredString(value, field);
  if (normalized.length > maxLength) {
    throw new Error(`Durable deletion ${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalTrimmed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeFailedSourceMaterializationProof(
  proof: RequestDocumentDeletionInput["failedSourceMaterialization"],
): RequestDocumentDeletionInput["failedSourceMaterialization"] {
  if (!proof) return undefined;
  const ownership = {
    contentHash: requiredString(proof.ownership.contentHash, "Source ownership contentHash"),
    itemKey: boundedString(proof.ownership.itemKey, 2_048, "Source ownership itemKey"),
    runId: boundedString(proof.ownership.runId, 255, "Source ownership runId"),
  };
  if (!/^[0-9a-f]{64}$/u.test(ownership.contentHash)) {
    throw new Error("Durable deletion Source ownership contentHash must be lowercase SHA-256");
  }
  return {
    documentId: boundedString(proof.documentId, 255, "Source cleanup documentId"),
    ownership,
    revision: positiveInteger(proof.revision, "Source cleanup revision"),
    sourceId: boundedString(proof.sourceId, 255, "Source cleanup sourceId"),
  };
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Durable deletion ${field} must be a positive integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Durable deletion ${field} must be a non-negative integer`);
  }
  return value;
}

function isoDate(value: string, field: string): string {
  const normalized = requiredString(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`Durable deletion ${field} must be an ISO date-time`);
  }
  return normalized;
}

function normalizeDeleteMode(value: DurableDeletionMode, allowKeep: boolean): DurableDeletionMode {
  const normalized = enumValue(value, DurableDeletionModes, "deleteMode");
  if (!allowKeep && normalized === "keep") {
    throw new Error("Durable deletion keep mode is only valid for sources");
  }
  return normalized;
}

function enumValue<const T extends readonly string[]>(
  value: string,
  allowed: T,
  field: string,
): T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`Durable deletion ${field} is invalid`);
  }
  return value as T[number];
}

function literalValue<const T extends string>(value: string, expected: T, field: string): T {
  if (value !== expected) throw new Error(`Durable deletion ${field} is invalid`);
  return expected;
}

function numberLiteral<const T extends number>(value: number, expected: T, field: string): T {
  if (value !== expected) throw new Error(`Durable deletion ${field} is invalid`);
  return expected;
}

function columns(database: DatabaseAdapter, values: readonly string[]): string {
  return values.map((value) => q(database, value)).join(", ");
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}

function jsonPlaceholder(database: DatabaseAdapter, position: number): string {
  const placeholder = p(database, position);
  return database.dialect === "postgres" ? `${placeholder}::jsonb` : `CAST(${placeholder} AS JSON)`;
}
