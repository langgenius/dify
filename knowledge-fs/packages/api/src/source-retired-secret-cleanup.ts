import { randomUUID } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  type Source,
  SourceSchema,
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
import { cloneJsonObject } from "./json-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import {
  type CreateSourceInput,
  type SourceRepository,
  SourceVersionConflictError,
  mapDatabaseSourceRow,
} from "./source-repository";

export const SourceSecretLifecycleStates = [
  "staged",
  "candidate",
  "active",
  "retired",
  "deleting",
  "deleted",
] as const;
export type SourceSecretLifecycleState = (typeof SourceSecretLifecycleStates)[number];

export const SourceSecretLifecyclePurposes = ["create", "rotate", "backfill"] as const;
export type SourceSecretLifecyclePurpose = (typeof SourceSecretLifecyclePurposes)[number];

export interface SourceSecretLifecycleRef {
  readonly createdAt: string;
  readonly credentialRef: string;
  readonly deleteAttempts: number;
  readonly deletedAt?: string | undefined;
  readonly heartbeatAt?: string | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly nextDeleteAt?: string | undefined;
  readonly operationId: string;
  readonly purpose: SourceSecretLifecyclePurpose;
  readonly recoverAfter: string;
  readonly rowVersion: number;
  readonly sourceId: string;
  readonly sourceVersion?: number | undefined;
  readonly state: SourceSecretLifecycleState;
  readonly tenantId: string;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
}

/** Compatibility projection for the cleanup runtime while callers migrate to lifecycle terms. */
export interface SourceRetiredSecretCleanupJob extends SourceSecretLifecycleRef {
  readonly retiredCredentialRef: string;
  readonly retryCount: number;
  readonly runState: "queued" | "running" | "succeeded";
}

export interface SourceSecretDeleteFence {
  readonly credentialRef: string;
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly now: string;
}
export interface SourceRetiredSecretCleanupFence {
  readonly expectedRowVersion: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly now: string;
}

export interface SourceSecretCandidateFence {
  readonly expectedJobRowVersion: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly now: string;
}

export interface ReserveSourceSecretInput {
  readonly credentialRef: string;
  readonly knowledgeSpaceId: string;
  readonly operationId: string;
  readonly purpose: Exclude<SourceSecretLifecyclePurpose, "backfill">;
  readonly recoverAfter: string;
  readonly sourceId: string;
  readonly tenantId: string;
}

export interface ReserveSourceSecretCandidateInput
  extends Omit<ReserveSourceSecretInput, "purpose"> {
  readonly purpose?: "backfill" | undefined;
}

export interface CreateSourceAndActivateInput {
  readonly operationId: string;
  readonly reservedCredentialRef: string;
  readonly source: Omit<CreateSourceInput, "credentialRef" | "id"> & { readonly id: string };
  readonly tenantId: string;
}

export interface ActivateRotateAndRetireInput {
  readonly expectedVersion: number;
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly newCredentialRef: string | null;
  readonly operationId?: string | undefined;
  readonly sourceId: string;
  readonly tenantId: string;
}

export interface CandidateActivateInput extends SourceSecretCandidateFence {
  readonly candidateCredentialRef: string;
  readonly expectedSourceVersion: number;
  readonly knowledgeSpaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly sourceId: string;
  readonly tenantId: string;
}

export interface CandidateRefreshInput extends SourceSecretCandidateFence {
  readonly knowledgeSpaceId: string;
  readonly newCandidateCredentialRef: string;
  readonly newRecoverAfter: string;
  readonly oldCandidateCredentialRef: string;
  readonly sourceId: string;
  readonly tenantId: string;
}

export interface SourceSecretLifecycleRepository {
  activateCreate(input: CreateSourceAndActivateInput): Promise<Source>;
  activateRotateAndRetire(input: ActivateRotateAndRetireInput): Promise<Source | null>;
  beginDelete(input: {
    readonly leaseExpiresAt: string;
    readonly now: string;
    readonly workerId: string;
  }): Promise<SourceSecretLifecycleRef | null>;
  candidateAbandon(
    input: SourceSecretCandidateFence & {
      readonly candidateCredentialRef: string;
      readonly errorCode?: string | undefined;
      readonly errorMessage?: string | undefined;
    },
  ): Promise<SourceSecretLifecycleRef>;
  candidateActivate(input: CandidateActivateInput): Promise<Source | null>;
  candidateRefresh(input: CandidateRefreshInput): Promise<SourceSecretLifecycleRef>;
  completeDelete(
    input: SourceSecretDeleteFence & { readonly nextDeleteAt?: string | undefined },
  ): Promise<SourceSecretLifecycleRef>;
  getByRef(input: { readonly credentialRef: string }): Promise<SourceSecretLifecycleRef | null>;
  reconcileExpiredStaged(input: {
    readonly nextRecoverAfter: string;
    readonly now: string;
  }): Promise<SourceSecretLifecycleRef | null>;
  renewDelete(
    input: SourceSecretDeleteFence & {
      readonly leaseExpiresAt: string;
      readonly workerId: string;
    },
  ): Promise<SourceSecretLifecycleRef>;
  reserveCandidate(input: ReserveSourceSecretCandidateInput): Promise<SourceSecretLifecycleRef>;
  reserveStaged(input: ReserveSourceSecretInput): Promise<SourceSecretLifecycleRef>;
  retire(input: {
    readonly credentialRef: string;
    readonly now: string;
  }): Promise<SourceSecretLifecycleRef>;
  retryDelete(
    input: SourceSecretDeleteFence & {
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly nextDeleteAt: string;
    },
  ): Promise<SourceSecretLifecycleRef>;
  /**
   * Holds the same knowledge-space row lock used by durable-deletion admission while an external
   * SecretStore mutation is in flight. This closes the reserve -> put -> activate late-write gap:
   * deletion either observes the durable reservation and completed put, or the put is rejected.
   */
  withWriteAdmission<T>(
    input: { readonly knowledgeSpaceId: string; readonly tenantId: string },
    mutation: () => Promise<T>,
  ): Promise<T>;
}

/** I2 must invoke this before deleting Source/Space rows; lifecycle rows intentionally have no FK. */
export interface SourceSecretLifecycleDeletionCoordinator {
  retireSourceReferencesForDeletion(input: {
    readonly knowledgeSpaceId: string;
    readonly now: string;
    readonly sourceId: string;
    readonly tenantId: string;
  }): Promise<number>;
  retireSpaceReferencesForDeletion(input: {
    readonly knowledgeSpaceId: string;
    readonly now: string;
    readonly tenantId: string;
  }): Promise<number>;
}

/**
 * Temporary compatibility surface for existing service/runtime call sites. New code must use the
 * lifecycle methods above so SecretStore writes are reserved before they begin.
 */
export interface SourceRetiredSecretCleanupRepository extends SourceSecretLifecycleRepository {
  claim(input: {
    readonly leaseExpiresAt: string;
    readonly limit: number;
    readonly now: string;
    readonly workerId: string;
  }): Promise<readonly SourceRetiredSecretCleanupJob[]>;
  complete(input: SourceRetiredSecretCleanupFence): Promise<SourceRetiredSecretCleanupJob>;
  fail(
    input: SourceRetiredSecretCleanupFence & {
      readonly errorCode: string;
      readonly errorMessage: string;
    },
  ): Promise<SourceRetiredSecretCleanupJob>;
  get(input: { readonly jobId: string }): Promise<SourceRetiredSecretCleanupJob | null>;
  heartbeat(
    input: SourceRetiredSecretCleanupFence & {
      readonly leaseExpiresAt: string;
      readonly workerId: string;
    },
  ): Promise<SourceRetiredSecretCleanupJob>;
  isReferenceInUse(input: { readonly retiredCredentialRef: string }): Promise<boolean>;
  replaceCredentialAndRetire(input: {
    readonly credentialRef: string | null;
    readonly expectedVersion: number;
    readonly knowledgeSpaceId: string;
    readonly metadata: Readonly<Record<string, unknown>>;
    readonly reason: "rotate" | "revoke";
    readonly sourceId: string;
    readonly tenantId: string;
  }): Promise<Source | null>;
  retry(input: {
    readonly jobId: string;
    readonly now: string;
  }): Promise<SourceRetiredSecretCleanupJob | null>;
  retryableFailure(
    input: SourceRetiredSecretCleanupFence & {
      readonly errorCode: string;
      readonly errorMessage: string;
    },
  ): Promise<SourceRetiredSecretCleanupJob>;
}

export class SourceRetiredSecretCleanupTransitionError extends Error {
  readonly code = "SOURCE_SECRET_LIFECYCLE_TRANSITION_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "SourceRetiredSecretCleanupTransitionError";
  }
}

export interface InMemorySourceRetiredSecretCleanupRepositoryOptions {
  readonly candidateReferenceInUse?: ((ref: string) => Promise<boolean>) | undefined;
  readonly generateId?: (() => string) | undefined;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly maxClaimBatchSize: number;
  readonly maxJobs: number;
  readonly now?: (() => string) | undefined;
  readonly sources: SourceRepository;
}

export function createInMemorySourceRetiredSecretCleanupRepository({
  candidateReferenceInUse,
  generateId = randomUUID,
  generateLeaseToken = randomUUID,
  maxClaimBatchSize,
  maxJobs,
  now = () => new Date().toISOString(),
  sources,
}: InMemorySourceRetiredSecretCleanupRepositoryOptions): SourceRetiredSecretCleanupRepository {
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");
  positiveInteger(maxJobs, "maxJobs");
  const rows = new Map<string, SourceSecretLifecycleRef>();
  const refById = new Map<string, string>();

  const store = (row: SourceSecretLifecycleRef) => {
    const normalized = lifecycleRef(row);
    rows.set(normalized.credentialRef, normalized);
    refById.set(normalized.id, normalized.credentialRef);
    return cloneRef(normalized);
  };
  const requireRow = (ref: string) => {
    const row = rows.get(normalizeRef(ref));
    if (!row) {
      throw transition("Source secret lifecycle ref does not exist");
    }
    return row;
  };
  const referenceUse = async (ref: string): Promise<"active" | "candidate" | null> => {
    let cursor: { readonly id: string } | undefined;
    do {
      const page = await sources.listAll({ ...(cursor ? { cursor } : {}), limit: 100 });
      if (page.items.some((source) => source.credentialRef === ref)) {
        return "active";
      }
      cursor = page.nextCursor;
    } while (cursor);
    return (await candidateReferenceInUse?.(ref)) ? "candidate" : null;
  };
  const adoptLegacyActiveReference = async (input: {
    readonly knowledgeSpaceId: string;
    readonly sourceId: string;
    readonly tenantId: string;
  }) => {
    const source = await sources.get({
      id: input.sourceId,
      knowledgeSpaceId: input.knowledgeSpaceId,
    });
    if (!source?.credentialRef) return;
    const existing = rows.get(source.credentialRef);
    if (existing) {
      if (
        existing.state !== "active" ||
        existing.sourceId !== input.sourceId ||
        existing.knowledgeSpaceId !== input.knowledgeSpaceId ||
        existing.tenantId !== input.tenantId
      ) {
        throw transition("Legacy active source ref conflicts with lifecycle registry");
      }
      return;
    }
    const timestamp = DateTimeSchema.parse(now());
    store({
      createdAt: timestamp,
      credentialRef: source.credentialRef,
      deleteAttempts: 0,
      id: UuidSchema.parse(generateId()),
      knowledgeSpaceId: input.knowledgeSpaceId,
      operationId: `legacy-source:${source.id}:${source.version}`,
      purpose: "rotate",
      recoverAfter: timestamp,
      rowVersion: 0,
      sourceId: input.sourceId,
      sourceVersion: source.version,
      state: "active",
      tenantId: input.tenantId,
      updatedAt: timestamp,
    });
  };
  const reserve = async (
    raw: ReserveSourceSecretInput | ReserveSourceSecretCandidateInput,
    state: "staged" | "candidate",
  ) => {
    const purpose = state === "candidate" ? "backfill" : (raw as ReserveSourceSecretInput).purpose;
    const input = normalizeReservation(raw, purpose);
    const existing = rows.get(input.credentialRef);
    if (existing) {
      if (sameReservation(existing, input, state)) {
        return cloneRef(existing);
      }
      throw transition("Source secret ref is already reserved by another lifecycle operation");
    }
    if (rows.size >= maxJobs) {
      throw new Error(`Source secret lifecycle maxJobs=${maxJobs} exceeded`);
    }
    const timestamp = DateTimeSchema.parse(now());
    return store({
      createdAt: timestamp,
      credentialRef: input.credentialRef,
      deleteAttempts: 0,
      id: UuidSchema.parse(generateId()),
      knowledgeSpaceId: input.knowledgeSpaceId,
      operationId: input.operationId,
      purpose: input.purpose,
      recoverAfter: input.recoverAfter,
      rowVersion: 0,
      sourceId: input.sourceId,
      state,
      tenantId: input.tenantId,
      updatedAt: timestamp,
    });
  };

  const api: SourceRetiredSecretCleanupRepository = {
    withWriteAdmission: (_input, mutation) => mutation(),
    reserveStaged: (input) => reserve(input, "staged"),
    reserveCandidate: (input) => reserve(input, "candidate"),
    activateCreate: async (rawInput) => {
      const input = normalizeCreateActivation(rawInput);
      const row = requireRow(input.reservedCredentialRef);
      requireOperationScope(row, input.operationId, input.tenantId, input.source.id);
      const existing = await sources.get({
        id: input.source.id,
        knowledgeSpaceId: input.source.knowledgeSpaceId,
      });
      if (row.state === "active") {
        if (existing?.credentialRef === row.credentialRef) return existing;
        throw transition("Active lifecycle ref is not bound to the requested source");
      }
      if (row.state !== "staged") {
        throw transition(`Source secret assignment rejected from state=${row.state}`);
      }
      if (existing) {
        if (existing.credentialRef !== row.credentialRef) {
          throw transition("Source id is already bound to another secret");
        }
        store({
          ...clearLease(row),
          rowVersion: row.rowVersion + 1,
          sourceVersion: existing.version,
          state: "active",
          updatedAt: DateTimeSchema.parse(now()),
        });
        return existing;
      }
      const source = await sources.create({
        ...input.source,
        credentialRef: row.credentialRef,
      });
      store({
        ...clearLease(row),
        recoverAfter: row.recoverAfter,
        rowVersion: row.rowVersion + 1,
        sourceVersion: source.version,
        state: "active",
        updatedAt: DateTimeSchema.parse(now()),
      });
      return source;
    },
    activateRotateAndRetire: async (rawInput) => {
      const input = normalizeRotation(rawInput);
      const source = await sources.get({
        id: input.sourceId,
        knowledgeSpaceId: input.knowledgeSpaceId,
      });
      if (!source) return null;
      const next = input.newCredentialRef ? requireRow(input.newCredentialRef) : undefined;
      if (next) {
        const operationId = required(input.operationId, "operationId", 255);
        requireOperationScope(next, operationId, input.tenantId, input.sourceId);
        if (
          next.state === "active" &&
          source.credentialRef === next.credentialRef &&
          source.version === input.expectedVersion + 1
        ) {
          return source;
        }
        if (next.state !== "staged") {
          throw transition(`Source secret assignment rejected from state=${next.state}`);
        }
      }
      if (source.version !== input.expectedVersion) {
        throw new SourceVersionConflictError(input.sourceId, input.expectedVersion);
      }
      const prior = source.credentialRef ? requireRow(source.credentialRef) : undefined;
      if (prior && prior.state !== "active") {
        throw transition(`Cannot retire source secret from state=${prior.state}`);
      }
      const updated = await sources.update({
        credentialRef: input.newCredentialRef,
        expectedVersion: input.expectedVersion,
        id: input.sourceId,
        knowledgeSpaceId: input.knowledgeSpaceId,
        metadata: input.metadata,
      });
      if (!updated) return null;
      const timestamp = DateTimeSchema.parse(now());
      if (next) {
        store({
          ...clearLease(next),
          rowVersion: next.rowVersion + 1,
          sourceVersion: updated.version,
          state: "active",
          updatedAt: timestamp,
        });
      }
      if (prior && prior.credentialRef !== input.newCredentialRef) {
        store({
          ...clearLease(prior),
          nextDeleteAt: timestamp,
          rowVersion: prior.rowVersion + 1,
          state: "retired",
          updatedAt: timestamp,
        });
      }
      return updated;
    },
    candidateActivate: async (rawInput) => {
      const input = normalizeCandidateActivation(rawInput);
      const candidate = requireRow(input.candidateCredentialRef);
      requireOperationScope(candidate, input.jobId, input.tenantId, input.sourceId);
      const source = await sources.get({
        id: input.sourceId,
        knowledgeSpaceId: input.knowledgeSpaceId,
      });
      if (
        candidate.state === "active" &&
        source?.credentialRef === candidate.credentialRef &&
        source.version === input.expectedSourceVersion + 1
      ) {
        return source;
      }
      if (candidate.state !== "candidate") {
        throw transition(`Source secret assignment rejected from state=${candidate.state}`);
      }
      if (!source || source.version !== input.expectedSourceVersion || source.credentialRef)
        return null;
      const updated = await sources.update({
        credentialRef: candidate.credentialRef,
        expectedVersion: source.version,
        id: source.id,
        knowledgeSpaceId: source.knowledgeSpaceId,
        metadata: input.metadata,
      });
      if (!updated) return null;
      store({
        ...clearLease(candidate),
        rowVersion: candidate.rowVersion + 1,
        sourceVersion: updated.version,
        state: "active",
        updatedAt: input.now,
      });
      return updated;
    },
    candidateAbandon: async (rawInput) => {
      const candidate = requireRow(rawInput.candidateCredentialRef);
      requireOperationScope(candidate, rawInput.jobId, candidate.tenantId, candidate.sourceId);
      if (candidate.state === "retired") return cloneRef(candidate);
      if (candidate.state !== "candidate") {
        throw transition(`Source secret assignment rejected from state=${candidate.state}`);
      }
      const source = await sources.get({
        id: candidate.sourceId,
        knowledgeSpaceId: candidate.knowledgeSpaceId,
      });
      if (source?.credentialRef === candidate.credentialRef) {
        return store({
          ...clearLease(candidate),
          rowVersion: candidate.rowVersion + 1,
          sourceVersion: source.version,
          state: "active",
          updatedAt: DateTimeSchema.parse(rawInput.now),
        });
      }
      return store({
        ...clearLease(candidate),
        lastErrorCode: rawInput.errorCode,
        lastErrorMessage: rawInput.errorMessage,
        nextDeleteAt: DateTimeSchema.parse(rawInput.now),
        rowVersion: candidate.rowVersion + 1,
        state: "retired",
        updatedAt: DateTimeSchema.parse(rawInput.now),
      });
    },
    candidateRefresh: async (rawInput) => {
      const input = normalizeCandidateRefresh(rawInput);
      const old = requireRow(input.oldCandidateCredentialRef);
      requireOperationScope(old, input.jobId, input.tenantId, input.sourceId);
      const existingNext = rows.get(input.newCandidateCredentialRef);
      if (
        old.state === "retired" &&
        existingNext &&
        sameReservation(
          existingNext,
          normalizeReservation(
            {
              credentialRef: input.newCandidateCredentialRef,
              knowledgeSpaceId: input.knowledgeSpaceId,
              operationId: input.jobId,
              recoverAfter: input.newRecoverAfter,
              sourceId: input.sourceId,
              tenantId: input.tenantId,
            },
            "backfill",
          ),
          "candidate",
        )
      ) {
        return cloneRef(existingNext);
      }
      if (old.state !== "candidate") {
        throw transition(`Source secret assignment rejected from state=${old.state}`);
      }
      const source = await sources.get({
        id: input.sourceId,
        knowledgeSpaceId: input.knowledgeSpaceId,
      });
      if (source?.credentialRef === old.credentialRef) {
        return store({
          ...clearLease(old),
          rowVersion: old.rowVersion + 1,
          sourceVersion: source.version,
          state: "active",
          updatedAt: input.now,
        });
      }
      if (existingNext) throw transition("New candidate ref is already reserved");
      const timestamp = input.now;
      store({
        ...clearLease(old),
        nextDeleteAt: timestamp,
        rowVersion: old.rowVersion + 1,
        state: "retired",
        updatedAt: timestamp,
      });
      return reserve(
        {
          credentialRef: input.newCandidateCredentialRef,
          knowledgeSpaceId: input.knowledgeSpaceId,
          operationId: input.jobId,
          recoverAfter: input.newRecoverAfter,
          sourceId: input.sourceId,
          tenantId: input.tenantId,
        },
        "candidate",
      );
    },
    retire: async ({ credentialRef, now: rawNow }) => {
      const row = requireRow(credentialRef);
      if (row.state === "retired") return cloneRef(row);
      if (row.state === "deleting" || row.state === "deleted") {
        throw transition(`Cannot retire source secret from state=${row.state}`);
      }
      const timestamp = DateTimeSchema.parse(rawNow);
      return store({
        ...clearLease(row),
        nextDeleteAt: timestamp,
        rowVersion: row.rowVersion + 1,
        state: "retired",
        updatedAt: timestamp,
      });
    },
    beginDelete: async (rawInput) => {
      const input = normalizeBeginDelete(rawInput);
      const row = [...rows.values()]
        .filter(
          (item) =>
            (item.state === "retired" && (item.nextDeleteAt ?? item.updatedAt) <= input.now) ||
            (item.state === "deleting" && (item.leaseExpiresAt ?? "") <= input.now) ||
            (item.state === "deleted" && (item.nextDeleteAt ?? item.updatedAt) <= input.now),
        )
        .sort(compareLifecycleRows)[0];
      if (!row) return null;
      const use = await referenceUse(row.credentialRef);
      if (use) {
        if (row.state === "deleted") {
          store({
            ...row,
            nextDeleteAt: input.leaseExpiresAt,
            rowVersion: row.rowVersion + 1,
            updatedAt: input.now,
          });
          return null;
        }
        store({
          ...clearLease(row),
          recoverAfter: input.leaseExpiresAt,
          rowVersion: row.rowVersion + 1,
          state: use,
          updatedAt: input.now,
        });
        return null;
      }
      return store({
        ...row,
        deletedAt: undefined,
        deleteAttempts: row.deleteAttempts + (row.state === "deleting" ? 1 : 0),
        heartbeatAt: input.now,
        leaseExpiresAt: input.leaseExpiresAt,
        leaseToken: UuidSchema.parse(generateLeaseToken()),
        rowVersion: row.rowVersion + 1,
        state: "deleting",
        updatedAt: input.now,
        workerId: input.workerId,
      });
    },
    renewDelete: async (rawInput) => {
      const { input, row } = requireDeleteFence(rows, rawInput);
      if (row.workerId !== rawInput.workerId || rawInput.leaseExpiresAt <= input.now)
        throw staleFence();
      return store({
        ...row,
        heartbeatAt: input.now,
        leaseExpiresAt: DateTimeSchema.parse(rawInput.leaseExpiresAt),
        rowVersion: row.rowVersion + 1,
        updatedAt: input.now,
      });
    },
    completeDelete: async (rawInput) => {
      const { input, row } = requireDeleteFence(rows, rawInput);
      return store({
        ...clearLease(row),
        deletedAt: input.now,
        nextDeleteAt: DateTimeSchema.parse(rawInput.nextDeleteAt ?? input.now),
        rowVersion: row.rowVersion + 1,
        state: "deleted",
        updatedAt: input.now,
      });
    },
    retryDelete: async (rawInput) => {
      const { input, row } = requireDeleteFence(rows, rawInput);
      return store({
        ...clearLease(row),
        deleteAttempts: row.deleteAttempts + 1,
        lastErrorCode: required(rawInput.errorCode, "errorCode", 64),
        lastErrorMessage: required(rawInput.errorMessage, "errorMessage", 16_384),
        nextDeleteAt: DateTimeSchema.parse(rawInput.nextDeleteAt),
        rowVersion: row.rowVersion + 1,
        state: "retired",
        updatedAt: input.now,
      });
    },
    reconcileExpiredStaged: async (rawInput) => {
      const nowValue = DateTimeSchema.parse(rawInput.now);
      const row = [...rows.values()]
        .filter(
          (item) =>
            (item.state === "staged" || item.state === "candidate") &&
            item.recoverAfter <= nowValue,
        )
        .sort(compareLifecycleRows)[0];
      if (!row) return null;
      const use = await referenceUse(row.credentialRef);
      const state = use ?? "retired";
      return store({
        ...clearLease(row),
        ...(state === "retired" ? { nextDeleteAt: nowValue } : {}),
        recoverAfter: DateTimeSchema.parse(rawInput.nextRecoverAfter),
        rowVersion: row.rowVersion + 1,
        state,
        updatedAt: nowValue,
      });
    },
    getByRef: async ({ credentialRef }) => {
      const row = rows.get(normalizeRef(credentialRef));
      return row ? cloneRef(row) : null;
    },
    // Compatibility wrappers. They intentionally preserve claim-one semantics.
    claim: async (input) => {
      if (input.limit < 1 || input.limit > maxClaimBatchSize)
        throw new Error("Invalid lifecycle claim limit");
      const row = await api.beginDelete(input);
      return row ? [cleanupJob(row)] : [];
    },
    complete: async (input) =>
      cleanupJob(await api.completeDelete(inMemoryDeleteFence(refById, input))),
    heartbeat: async (input) =>
      cleanupJob(
        await api.renewDelete({
          ...inMemoryDeleteFence(refById, input),
          leaseExpiresAt: input.leaseExpiresAt,
          workerId: input.workerId,
        }),
      ),
    retryableFailure: async (input) =>
      cleanupJob(
        await api.retryDelete({
          ...inMemoryDeleteFence(refById, input),
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          nextDeleteAt: input.now,
        }),
      ),
    fail: async (input) =>
      cleanupJob(
        await api.retryDelete({
          ...inMemoryDeleteFence(refById, input),
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          nextDeleteAt: input.now,
        }),
      ),
    get: async ({ jobId }) => {
      const ref = refById.get(UuidSchema.parse(jobId));
      const row = ref ? rows.get(ref) : undefined;
      return row ? cleanupJob(row) : null;
    },
    retry: async ({ jobId }) => {
      const ref = refById.get(UuidSchema.parse(jobId));
      const row = ref ? rows.get(ref) : undefined;
      return row ? cleanupJob(row) : null;
    },
    isReferenceInUse: async ({ retiredCredentialRef }) =>
      (await referenceUse(normalizeRef(retiredCredentialRef))) !== null,
    replaceCredentialAndRetire: async (input) => {
      await adoptLegacyActiveReference(input);
      let operationId: string | undefined;
      if (input.credentialRef) {
        operationId = randomUUID();
        await api.reserveStaged({
          credentialRef: input.credentialRef,
          knowledgeSpaceId: input.knowledgeSpaceId,
          operationId,
          purpose: "rotate",
          recoverAfter: new Date(Date.parse(now()) + 300_000).toISOString(),
          sourceId: input.sourceId,
          tenantId: input.tenantId,
        });
      }
      return api.activateRotateAndRetire({
        expectedVersion: input.expectedVersion,
        knowledgeSpaceId: input.knowledgeSpaceId,
        metadata: input.metadata,
        newCredentialRef: input.credentialRef,
        ...(operationId ? { operationId } : {}),
        sourceId: input.sourceId,
        tenantId: input.tenantId,
      });
    },
  };
  return api;
}

export interface DatabaseSourceRetiredSecretCleanupRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: (() => string) | undefined;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly maxClaimBatchSize: number;
  readonly now?: (() => string) | undefined;
}

const lifecycleTable = "source_secret_lifecycle_refs";
const sourceTable = "sources";
const backfillTable = "source_credential_backfills";

export function createDatabaseSourceRetiredSecretCleanupRepository({
  database,
  generateId = randomUUID,
  generateLeaseToken = randomUUID,
  maxClaimBatchSize,
  now = () => new Date().toISOString(),
}: DatabaseSourceRetiredSecretCleanupRepositoryOptions): SourceRetiredSecretCleanupRepository {
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");

  const reserve = async (
    raw: ReserveSourceSecretInput | ReserveSourceSecretCandidateInput,
    state: "staged" | "candidate",
  ) => {
    const purpose = state === "candidate" ? "backfill" : (raw as ReserveSourceSecretInput).purpose;
    const input = normalizeReservation(raw, purpose);
    return database.transaction(async (transaction) => {
      await requireWriteAdmission(database, transaction, input);
      const existing = await getByRef(database, transaction, input.credentialRef, true);
      if (existing) {
        if (sameReservation(existing, input, state)) return existing;
        throw transition("Source secret ref is already reserved by another lifecycle operation");
      }
      const timestamp = DateTimeSchema.parse(now());
      const row = lifecycleRef({
        createdAt: timestamp,
        credentialRef: input.credentialRef,
        deleteAttempts: 0,
        id: UuidSchema.parse(generateId()),
        knowledgeSpaceId: input.knowledgeSpaceId,
        operationId: input.operationId,
        purpose: input.purpose,
        recoverAfter: input.recoverAfter,
        rowVersion: 0,
        sourceId: input.sourceId,
        state,
        tenantId: input.tenantId,
        updatedAt: timestamp,
      });
      await insertLifecycle(database, transaction, row);
      return row;
    });
  };
  const adoptLegacyActiveReference = async (input: {
    readonly knowledgeSpaceId: string;
    readonly sourceId: string;
    readonly tenantId: string;
  }) => {
    const observed = await getSource(
      database,
      database,
      input.sourceId,
      input.knowledgeSpaceId,
      input.tenantId,
      false,
    );
    if (!observed?.credentialRef) return;
    const credentialRef = observed.credentialRef;
    await database.transaction(async (transaction) => {
      await requireWriteAdmission(database, transaction, input);
      const existing = await getByRef(database, transaction, credentialRef, true);
      if (existing) {
        if (
          existing.state !== "active" ||
          existing.sourceId !== input.sourceId ||
          existing.knowledgeSpaceId !== input.knowledgeSpaceId ||
          existing.tenantId !== input.tenantId
        ) {
          throw transition("Legacy active source ref conflicts with lifecycle registry");
        }
        return;
      }
      const current = await getSource(
        database,
        transaction,
        input.sourceId,
        input.knowledgeSpaceId,
        input.tenantId,
        true,
      );
      if (!current || current.credentialRef !== credentialRef) return;
      const timestamp = DateTimeSchema.parse(now());
      await insertLifecycle(
        database,
        transaction,
        lifecycleRef({
          createdAt: timestamp,
          credentialRef,
          deleteAttempts: 0,
          id: UuidSchema.parse(generateId()),
          knowledgeSpaceId: input.knowledgeSpaceId,
          operationId: `legacy-source:${current.id}:${current.version}`,
          purpose: "rotate",
          recoverAfter: timestamp,
          rowVersion: 0,
          sourceId: input.sourceId,
          sourceVersion: current.version,
          state: "active",
          tenantId: input.tenantId,
          updatedAt: timestamp,
        }),
      );
    });
  };

  const api: SourceRetiredSecretCleanupRepository = {
    withWriteAdmission: (input, mutation) =>
      database.transaction(async (transaction) => {
        await requireWriteAdmission(database, transaction, input);
        return mutation();
      }),
    reserveStaged: (input) => reserve(input, "staged"),
    reserveCandidate: (input) => reserve(input, "candidate"),
    activateCreate: async (rawInput) => {
      const input = normalizeCreateActivation(rawInput);
      return database.transaction(async (transaction) => {
        await requireWriteAdmission(database, transaction, {
          knowledgeSpaceId: input.source.knowledgeSpaceId,
          tenantId: input.tenantId,
        });
        const row = await requireLockedRef(database, transaction, input.reservedCredentialRef);
        requireOperationScope(row, input.operationId, input.tenantId, input.source.id);
        const existing = await getSource(
          database,
          transaction,
          input.source.id,
          input.source.knowledgeSpaceId,
          input.tenantId,
          true,
        );
        if (row.state === "active") {
          if (existing?.credentialRef === row.credentialRef) return existing;
          throw transition("Active lifecycle ref is not bound to the requested source");
        }
        if (row.state !== "staged") {
          throw transition(`Source secret assignment rejected from state=${row.state}`);
        }
        if (existing) {
          if (existing.credentialRef !== row.credentialRef)
            throw transition("Source id is already bound to another secret");
          await persistLifecycle(database, transaction, row, {
            ...clearLease(row),
            rowVersion: row.rowVersion + 1,
            sourceVersion: existing.version,
            state: "active",
            updatedAt: DateTimeSchema.parse(now()),
          });
          return existing;
        }
        const timestamp = DateTimeSchema.parse(now());
        const source = SourceSchema.parse({
          ...input.source,
          credentialRef: row.credentialRef,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await insertSource(database, transaction, source);
        await persistLifecycle(database, transaction, row, {
          ...clearLease(row),
          rowVersion: row.rowVersion + 1,
          sourceVersion: source.version,
          state: "active",
          updatedAt: timestamp,
        });
        return source;
      });
    },
    activateRotateAndRetire: async (rawInput) => {
      const input = normalizeRotation(rawInput);
      const observed = await getSource(
        database,
        database,
        input.sourceId,
        input.knowledgeSpaceId,
        input.tenantId,
        false,
      );
      if (!observed) return null;
      const refs = [
        ...new Set(
          [observed.credentialRef, input.newCredentialRef].filter((value): value is string =>
            Boolean(value),
          ),
        ),
      ].sort();
      return database.transaction(async (transaction) => {
        await requireWriteAdmission(database, transaction, input);
        const locked = new Map<string, SourceSecretLifecycleRef>();
        for (const ref of refs) locked.set(ref, await requireLockedRef(database, transaction, ref));
        const current = await getSource(
          database,
          transaction,
          input.sourceId,
          input.knowledgeSpaceId,
          input.tenantId,
          true,
        );
        if (!current) return null;
        const next = input.newCredentialRef ? locked.get(input.newCredentialRef) : undefined;
        if (next) {
          const operationId = required(input.operationId, "operationId", 255);
          requireOperationScope(next, operationId, input.tenantId, input.sourceId);
          if (
            next.state === "active" &&
            current.credentialRef === next.credentialRef &&
            current.version === input.expectedVersion + 1
          ) {
            return current;
          }
          if (next.state !== "staged") {
            throw transition(`Source secret assignment rejected from state=${next.state}`);
          }
        }
        if (
          current.version !== input.expectedVersion ||
          current.credentialRef !== observed.credentialRef
        ) {
          throw new SourceVersionConflictError(input.sourceId, input.expectedVersion);
        }
        const prior = current.credentialRef ? locked.get(current.credentialRef) : undefined;
        if (prior?.state !== "active")
          throw transition("Current source secret is not active in lifecycle registry");
        const timestamp = DateTimeSchema.parse(now());
        const updated = SourceSchema.parse({
          ...current,
          ...(input.newCredentialRef
            ? { credentialRef: input.newCredentialRef }
            : { credentialRef: undefined }),
          metadata: cloneJsonObject(input.metadata),
          updatedAt: timestamp,
          version: current.version + 1,
        });
        await updateSourceCredential(database, transaction, current, updated);
        if (next)
          await persistLifecycle(database, transaction, next, {
            ...clearLease(next),
            rowVersion: next.rowVersion + 1,
            sourceVersion: updated.version,
            state: "active",
            updatedAt: timestamp,
          });
        if (prior && prior.credentialRef !== input.newCredentialRef) {
          await persistLifecycle(database, transaction, prior, {
            ...clearLease(prior),
            nextDeleteAt: timestamp,
            rowVersion: prior.rowVersion + 1,
            state: "retired",
            updatedAt: timestamp,
          });
        }
        return updated;
      });
    },
    candidateActivate: async (rawInput) => {
      const input = normalizeCandidateActivation(rawInput);
      return database.transaction(async (transaction) => {
        await requireWriteAdmission(database, transaction, input);
        const candidate = await requireLockedRef(
          database,
          transaction,
          input.candidateCredentialRef,
        );
        requireOperationScope(candidate, input.jobId, input.tenantId, input.sourceId);
        if (candidate.state === "active") {
          const completedSource = await getSource(
            database,
            transaction,
            input.sourceId,
            input.knowledgeSpaceId,
            input.tenantId,
            true,
          );
          if (
            completedSource?.credentialRef === candidate.credentialRef &&
            completedSource.version === input.expectedSourceVersion + 1
          ) {
            return completedSource;
          }
          throw transition("Active candidate lifecycle ref is not bound to the requested source");
        }
        if (candidate.state !== "candidate") {
          throw transition(`Source secret assignment rejected from state=${candidate.state}`);
        }
        const job = await requireCandidateFence(database, transaction, input, candidate);
        if (
          job.candidateCredentialRef !== candidate.credentialRef ||
          job.sourceVersion !== input.expectedSourceVersion
        ) {
          throw transition("Source credential backfill candidate or source version changed");
        }
        const source = await getSource(
          database,
          transaction,
          input.sourceId,
          input.knowledgeSpaceId,
          input.tenantId,
          true,
        );
        if (!source || source.version !== input.expectedSourceVersion || source.credentialRef)
          return null;
        const updated = SourceSchema.parse({
          ...source,
          credentialRef: candidate.credentialRef,
          metadata: cloneJsonObject(input.metadata),
          updatedAt: input.now,
          version: source.version + 1,
        });
        await updateSourceCredential(database, transaction, source, updated);
        await persistLifecycle(database, transaction, candidate, {
          ...clearLease(candidate),
          rowVersion: candidate.rowVersion + 1,
          sourceVersion: updated.version,
          state: "active",
          updatedAt: input.now,
        });
        return updated;
      });
    },
    candidateAbandon: async (rawInput) => {
      const observed = await getByRef(database, database, rawInput.candidateCredentialRef, false);
      if (!observed) throw transition("Source secret lifecycle ref does not exist");
      return database.transaction(async (transaction) => {
        await requireWriteAdmission(database, transaction, observed);
        const candidate = await requireLockedRef(
          database,
          transaction,
          rawInput.candidateCredentialRef,
        );
        requireReservation(
          candidate,
          rawInput.jobId,
          "candidate",
          candidate.tenantId,
          candidate.sourceId,
        );
        const job = await requireCandidateFence(database, transaction, rawInput, candidate);
        if (job.candidateCredentialRef !== candidate.credentialRef) {
          throw transition("Source credential backfill candidate changed");
        }
        const source = await getSource(
          database,
          transaction,
          candidate.sourceId,
          candidate.knowledgeSpaceId,
          candidate.tenantId,
          true,
        );
        if (source?.credentialRef === candidate.credentialRef) {
          return persistLifecycle(database, transaction, candidate, {
            ...clearLease(candidate),
            rowVersion: candidate.rowVersion + 1,
            sourceVersion: source.version,
            state: "active",
            updatedAt: DateTimeSchema.parse(rawInput.now),
          });
        }
        return persistLifecycle(database, transaction, candidate, {
          ...clearLease(candidate),
          lastErrorCode: rawInput.errorCode,
          lastErrorMessage: rawInput.errorMessage,
          nextDeleteAt: DateTimeSchema.parse(rawInput.now),
          rowVersion: candidate.rowVersion + 1,
          state: "retired",
          updatedAt: DateTimeSchema.parse(rawInput.now),
        });
      });
    },
    candidateRefresh: async (rawInput) => {
      const input = normalizeCandidateRefresh(rawInput);
      return database.transaction(async (transaction) => {
        await requireWriteAdmission(database, transaction, input);
        const refs = [input.newCandidateCredentialRef, input.oldCandidateCredentialRef].sort();
        const locked = new Map<string, SourceSecretLifecycleRef | null>();
        for (const ref of refs) locked.set(ref, await getByRef(database, transaction, ref, true));
        const old = locked.get(input.oldCandidateCredentialRef);
        const existingNext = locked.get(input.newCandidateCredentialRef);
        if (!old) throw transition("Old candidate lifecycle ref does not exist");
        requireOperationScope(old, input.jobId, input.tenantId, input.sourceId);
        if (
          old.state === "retired" &&
          existingNext &&
          sameReservation(
            existingNext,
            normalizeReservation(
              {
                credentialRef: input.newCandidateCredentialRef,
                knowledgeSpaceId: input.knowledgeSpaceId,
                operationId: input.jobId,
                recoverAfter: input.newRecoverAfter,
                sourceId: input.sourceId,
                tenantId: input.tenantId,
              },
              "backfill",
            ),
            "candidate",
          )
        ) {
          return existingNext;
        }
        if (old.state !== "candidate") {
          throw transition(`Source secret assignment rejected from state=${old.state}`);
        }
        const job = await requireCandidateFence(database, transaction, input, old);
        if (job.candidateCredentialRef !== old.credentialRef) {
          throw transition("Source credential backfill candidate changed");
        }
        const source = await getSource(
          database,
          transaction,
          input.sourceId,
          input.knowledgeSpaceId,
          input.tenantId,
          true,
        );
        if (source?.credentialRef === old.credentialRef) {
          return persistLifecycle(database, transaction, old, {
            ...clearLease(old),
            rowVersion: old.rowVersion + 1,
            sourceVersion: source.version,
            state: "active",
            updatedAt: input.now,
          });
        }
        if (!source || source.version !== job.sourceVersion || source.credentialRef) {
          throw transition("Source changed while refreshing its credential candidate");
        }
        if (existingNext) throw transition("New candidate ref is already reserved");
        await persistLifecycle(database, transaction, old, {
          ...clearLease(old),
          nextDeleteAt: input.now,
          rowVersion: old.rowVersion + 1,
          state: "retired",
          updatedAt: input.now,
        });
        const next = lifecycleRef({
          createdAt: input.now,
          credentialRef: input.newCandidateCredentialRef,
          deleteAttempts: 0,
          id: UuidSchema.parse(generateId()),
          knowledgeSpaceId: input.knowledgeSpaceId,
          operationId: input.jobId,
          purpose: "backfill",
          recoverAfter: input.newRecoverAfter,
          rowVersion: 0,
          sourceId: input.sourceId,
          state: "candidate",
          tenantId: input.tenantId,
          updatedAt: input.now,
        });
        await insertLifecycle(database, transaction, next);
        return next;
      });
    },
    retire: async ({ credentialRef, now: rawNow }) =>
      database.transaction(async (transaction) => {
        const row = await requireLockedRef(database, transaction, credentialRef);
        if (row.state === "retired") return row;
        if (row.state === "deleting" || row.state === "deleted")
          throw transition(`Cannot retire source secret from state=${row.state}`);
        const timestamp = DateTimeSchema.parse(rawNow);
        return persistLifecycle(database, transaction, row, {
          ...clearLease(row),
          nextDeleteAt: timestamp,
          rowVersion: row.rowVersion + 1,
          state: "retired",
          updatedAt: timestamp,
        });
      }),
    beginDelete: async (rawInput) => {
      const input = normalizeBeginDelete(rawInput);
      return database.transaction(async (transaction) => {
        const secondNowPlaceholder = database.dialect === "postgres" ? 1 : 2;
        const thirdNowPlaceholder = database.dialect === "postgres" ? 1 : 3;
        const result = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: database.dialect === "postgres" ? [input.now] : [input.now, input.now, input.now],
          sql: `SELECT * FROM ${q(database, lifecycleTable)} WHERE (${q(database, "state")} = 'retired' AND COALESCE(${q(database, "next_delete_at")}, ${q(database, "updated_at")}) <= ${p(database, 1)}) OR (${q(database, "state")} = 'deleting' AND ${q(database, "lease_expires_at")} <= ${p(database, secondNowPlaceholder)}) OR (${q(database, "state")} = 'deleted' AND COALESCE(${q(database, "next_delete_at")}, ${q(database, "updated_at")}) <= ${p(database, thirdNowPlaceholder)}) ORDER BY ${q(database, "updated_at")}, ${q(database, "id")} LIMIT 1 FOR UPDATE${database.dialect === "postgres" ? " SKIP LOCKED" : ""};`,
          tableName: lifecycleTable,
        });
        if (!result.rows[0]) return null;
        const row = mapLifecycle(result.rows[0]);
        const use = await referenceUseDatabase(database, transaction, row.credentialRef);
        if (use) {
          if (row.state === "deleted") {
            await persistLifecycle(database, transaction, row, {
              ...row,
              nextDeleteAt: input.leaseExpiresAt,
              rowVersion: row.rowVersion + 1,
              updatedAt: input.now,
            });
            return null;
          }
          await persistLifecycle(database, transaction, row, {
            ...clearLease(row),
            recoverAfter: input.leaseExpiresAt,
            rowVersion: row.rowVersion + 1,
            state: use,
            updatedAt: input.now,
          });
          return null;
        }
        return persistLifecycle(database, transaction, row, {
          ...row,
          deletedAt: undefined,
          deleteAttempts: row.deleteAttempts + (row.state === "deleting" ? 1 : 0),
          heartbeatAt: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
          leaseToken: UuidSchema.parse(generateLeaseToken()),
          rowVersion: row.rowVersion + 1,
          state: "deleting",
          updatedAt: input.now,
          workerId: input.workerId,
        });
      });
    },
    renewDelete: (rawInput) =>
      mutateDeleteFence(database, rawInput, (row, input) => {
        const leaseExpiresAt = DateTimeSchema.parse(rawInput.leaseExpiresAt);
        if (row.workerId !== rawInput.workerId || leaseExpiresAt <= input.now) throw staleFence();
        return {
          ...row,
          heartbeatAt: input.now,
          leaseExpiresAt,
          rowVersion: row.rowVersion + 1,
          updatedAt: input.now,
        };
      }),
    completeDelete: (rawInput) => {
      const nextDeleteAt = DateTimeSchema.parse(rawInput.nextDeleteAt ?? rawInput.now);
      return mutateDeleteFence(database, rawInput, (row, input) => ({
        ...clearLease(row),
        deletedAt: input.now,
        nextDeleteAt,
        rowVersion: row.rowVersion + 1,
        state: "deleted",
        updatedAt: input.now,
      }));
    },
    retryDelete: (rawInput) =>
      mutateDeleteFence(database, rawInput, (row, input) => ({
        ...clearLease(row),
        deleteAttempts: row.deleteAttempts + 1,
        lastErrorCode: required(rawInput.errorCode, "errorCode", 64),
        lastErrorMessage: required(rawInput.errorMessage, "errorMessage", 16_384),
        nextDeleteAt: DateTimeSchema.parse(rawInput.nextDeleteAt),
        rowVersion: row.rowVersion + 1,
        state: "retired",
        updatedAt: input.now,
      })),
    reconcileExpiredStaged: async (rawInput) => {
      const nowValue = DateTimeSchema.parse(rawInput.now);
      const nextRecoverAfter = DateTimeSchema.parse(rawInput.nextRecoverAfter);
      return database.transaction(async (transaction) => {
        const result = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [nowValue],
          sql: `SELECT * FROM ${q(database, lifecycleTable)} WHERE ${q(database, "state")} IN ('staged', 'candidate') AND ${q(database, "recover_after")} <= ${p(database, 1)} ORDER BY ${q(database, "recover_after")}, ${q(database, "id")} LIMIT 1 FOR UPDATE${database.dialect === "postgres" ? " SKIP LOCKED" : ""};`,
          tableName: lifecycleTable,
        });
        if (!result.rows[0]) return null;
        const row = mapLifecycle(result.rows[0]);
        const use = await referenceUseDatabase(database, transaction, row.credentialRef);
        const state = use ?? "retired";
        return persistLifecycle(database, transaction, row, {
          ...clearLease(row),
          ...(state === "retired" ? { nextDeleteAt: nowValue } : {}),
          recoverAfter: nextRecoverAfter,
          rowVersion: row.rowVersion + 1,
          state,
          updatedAt: nowValue,
        });
      });
    },
    getByRef: ({ credentialRef }) => getByRef(database, database, credentialRef, false),
    claim: async (input) => {
      if (input.limit < 1 || input.limit > maxClaimBatchSize)
        throw new Error("Invalid lifecycle claim limit");
      const row = await api.beginDelete(input);
      return row ? [cleanupJob(row)] : [];
    },
    complete: async (input) =>
      cleanupJob(await api.completeDelete(await databaseDeleteFence(database, input))),
    heartbeat: async (input) =>
      cleanupJob(
        await api.renewDelete({
          ...(await databaseDeleteFence(database, input)),
          leaseExpiresAt: input.leaseExpiresAt,
          workerId: input.workerId,
        }),
      ),
    retryableFailure: async (input) =>
      cleanupJob(
        await api.retryDelete({
          ...(await databaseDeleteFence(database, input)),
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          nextDeleteAt: input.now,
        }),
      ),
    fail: async (input) =>
      cleanupJob(
        await api.retryDelete({
          ...(await databaseDeleteFence(database, input)),
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          nextDeleteAt: input.now,
        }),
      ),
    get: async ({ jobId }) => {
      const row = await getById(database, database, jobId);
      return row ? cleanupJob(row) : null;
    },
    retry: async ({ jobId }) => {
      const row = await getById(database, database, jobId);
      return row ? cleanupJob(row) : null;
    },
    isReferenceInUse: ({ retiredCredentialRef }) =>
      referenceUseDatabase(database, database, retiredCredentialRef).then(Boolean),
    replaceCredentialAndRetire: async (input) => {
      await adoptLegacyActiveReference(input);
      let operationId: string | undefined;
      if (input.credentialRef) {
        operationId = randomUUID();
        await api.reserveStaged({
          credentialRef: input.credentialRef,
          knowledgeSpaceId: input.knowledgeSpaceId,
          operationId,
          purpose: "rotate",
          recoverAfter: new Date(Date.parse(now()) + 300_000).toISOString(),
          sourceId: input.sourceId,
          tenantId: input.tenantId,
        });
      }
      return api.activateRotateAndRetire({
        expectedVersion: input.expectedVersion,
        knowledgeSpaceId: input.knowledgeSpaceId,
        metadata: input.metadata,
        newCredentialRef: input.credentialRef,
        ...(operationId ? { operationId } : {}),
        sourceId: input.sourceId,
        tenantId: input.tenantId,
      });
    },
  };
  return api;
}

async function mutateDeleteFence(
  database: DatabaseAdapter,
  rawInput: SourceSecretDeleteFence,
  mutate: (
    row: SourceSecretLifecycleRef,
    input: SourceSecretDeleteFence,
  ) => SourceSecretLifecycleRef,
): Promise<SourceSecretLifecycleRef> {
  const input = normalizeDeleteFence(rawInput);
  return database.transaction(async (transaction) => {
    const row = await requireLockedRef(database, transaction, input.credentialRef);
    if (
      row.state !== "deleting" ||
      row.rowVersion !== input.expectedRowVersion ||
      row.leaseToken !== input.leaseToken ||
      !row.leaseExpiresAt ||
      row.leaseExpiresAt <= input.now
    )
      throw staleFence();
    return persistLifecycle(database, transaction, row, mutate(row, input));
  });
}

async function requireWriteAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: { readonly knowledgeSpaceId: string; readonly tenantId: string },
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, input))) {
    throw transition("Source secret mutation rejected while knowledge-space deletion is active");
  }
}

async function referenceUseDatabase(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  credentialRef: string,
): Promise<"active" | "candidate" | null> {
  const ref = normalizeRef(credentialRef);
  const active = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [ref],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, sourceTable)} WHERE ${q(database, "credential_ref")} = ${p(database, 1)} LIMIT 1;`,
    tableName: sourceTable,
  });
  if (active.rows.length > 0) return "active";
  const candidate = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [ref],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, backfillTable)} WHERE ${q(database, "candidate_credential_ref")} = ${p(database, 1)} AND ${q(database, "run_state")} IN ('queued', 'running') LIMIT 1;`,
    tableName: backfillTable,
  });
  return candidate.rows.length > 0 ? "candidate" : null;
}

async function requireCandidateFence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: SourceSecretCandidateFence,
  lifecycle: SourceSecretLifecycleRef,
): Promise<{ readonly candidateCredentialRef: string; readonly sourceVersion: number }> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.jobId],
    sql: `SELECT ${q(database, "tenant_id")}, ${q(database, "knowledge_space_id")}, ${q(database, "source_id")}, ${q(database, "source_version")}, ${q(database, "candidate_credential_ref")}, ${q(database, "row_version")}, ${q(database, "lease_token")}, ${q(database, "lease_expires_at")}, ${q(database, "run_state")} FROM ${q(database, backfillTable)} WHERE ${q(database, "id")} = ${p(database, 1)} LIMIT 1 FOR UPDATE;`,
    tableName: backfillTable,
  });
  const row = result.rows[0];
  if (
    !row ||
    stringColumn(row, "run_state") !== "running" ||
    stringColumn(row, "tenant_id") !== lifecycle.tenantId ||
    stringColumn(row, "knowledge_space_id") !== lifecycle.knowledgeSpaceId ||
    stringColumn(row, "source_id") !== lifecycle.sourceId ||
    numberColumn(row, "row_version") !== input.expectedJobRowVersion ||
    optionalStringColumn(row, "lease_token") !== input.leaseToken ||
    (optionalStringColumn(row, "lease_expires_at") ?? "") <= input.now
  )
    throw transition("Source credential backfill fence is stale or expired");
  return {
    candidateCredentialRef: normalizeRef(stringColumn(row, "candidate_credential_ref")),
    sourceVersion: positiveInteger(numberColumn(row, "source_version"), "sourceVersion"),
  };
}

async function getSource(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  sourceId: string,
  knowledgeSpaceId: string,
  tenantId: string,
  forUpdate: boolean,
): Promise<Source | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [sourceId, knowledgeSpaceId, tenantId],
    sql: `SELECT src.* FROM ${q(database, sourceTable)} src INNER JOIN ${q(database, "knowledge_spaces")} space ON space.${q(database, "id")} = src.${q(database, "knowledge_space_id")} WHERE src.${q(database, "id")} = ${p(database, 1)} AND src.${q(database, "knowledge_space_id")} = ${p(database, 2)} AND space.${q(database, "tenant_id")} = ${p(database, 3)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: sourceTable,
  });
  return result.rows[0] ? mapDatabaseSourceRow(result.rows[0]) : null;
}

async function insertSource(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  source: Source,
): Promise<void> {
  const columns = [
    "id",
    "knowledge_space_id",
    "credential_ref",
    "name",
    "type",
    "status",
    "uri",
    "permission_scope",
    "metadata",
    "version",
    "created_at",
    "updated_at",
  ] as const;
  const values: DatabaseQueryValue[] = [
    source.id,
    source.knowledgeSpaceId,
    source.credentialRef ?? null,
    source.name,
    source.type,
    source.status,
    source.uri,
    JSON.stringify(source.permissionScope),
    JSON.stringify(source.metadata),
    source.version,
    source.createdAt,
    source.updatedAt,
  ];
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: values,
    sql: `INSERT INTO ${q(database, sourceTable)} (${columns.map((column) => q(database, column)).join(", ")}) VALUES (${columns.map((column, index) => jsonInsertPlaceholder(database, index + 1, column)).join(", ")});`,
    tableName: sourceTable,
  });
}

async function updateSourceCredential(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  current: Source,
  next: Source,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [
      next.credentialRef ?? null,
      JSON.stringify(next.metadata),
      next.version,
      next.updatedAt,
      current.id,
      current.knowledgeSpaceId,
      current.version,
    ],
    sql: `UPDATE ${q(database, sourceTable)} SET ${q(database, "credential_ref")} = ${p(database, 1)}, ${q(database, "metadata")} = ${jsonInsertPlaceholder(database, 2, "metadata")}, ${q(database, "version")} = ${p(database, 3)}, ${q(database, "updated_at")} = ${p(database, 4)} WHERE ${q(database, "id")} = ${p(database, 5)} AND ${q(database, "knowledge_space_id")} = ${p(database, 6)} AND ${q(database, "version")} = ${p(database, 7)};`,
    tableName: sourceTable,
  });
  if (result.rowsAffected !== 1) throw new SourceVersionConflictError(current.id, current.version);
}

const lifecycleColumns = [
  "id",
  "tenant_id",
  "knowledge_space_id",
  "source_id",
  "credential_ref",
  "operation_id",
  "purpose",
  "state",
  "source_version",
  "recover_after",
  "next_delete_at",
  "worker_id",
  "lease_token",
  "lease_expires_at",
  "heartbeat_at",
  "delete_attempts",
  "row_version",
  "last_error_code",
  "last_error_message",
  "created_at",
  "updated_at",
  "deleted_at",
] as const;

async function insertLifecycle(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  row: SourceSecretLifecycleRef,
): Promise<void> {
  const values = lifecycleValues(row);
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params: values,
    sql: `INSERT INTO ${q(database, lifecycleTable)} (${lifecycleColumns.map((column) => q(database, column)).join(", ")}) VALUES (${lifecycleColumns.map((_, index) => p(database, index + 1)).join(", ")});`,
    tableName: lifecycleTable,
  });
  if (result.rowsAffected !== 1)
    throw transition("Source secret lifecycle reservation insert failed");
}

async function persistLifecycle(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  current: SourceSecretLifecycleRef,
  rawNext: SourceSecretLifecycleRef,
): Promise<SourceSecretLifecycleRef> {
  const next = lifecycleRef(rawNext);
  const values = lifecycleValues(next).slice(1);
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params: [...values, current.id, current.rowVersion],
    sql: `UPDATE ${q(database, lifecycleTable)} SET ${lifecycleColumns
      .slice(1)
      .map((column, index) => `${q(database, column)} = ${p(database, index + 1)}`)
      .join(
        ", ",
      )} WHERE ${q(database, "id")} = ${p(database, values.length + 1)} AND ${q(database, "row_version")} = ${p(database, values.length + 2)};`,
    tableName: lifecycleTable,
  });
  if (result.rowsAffected !== 1) throw staleFence();
  return next;
}

function lifecycleValues(row: SourceSecretLifecycleRef): DatabaseQueryValue[] {
  return [
    row.id,
    row.tenantId,
    row.knowledgeSpaceId,
    row.sourceId,
    row.credentialRef,
    row.operationId,
    row.purpose,
    row.state,
    row.sourceVersion ?? null,
    row.recoverAfter,
    row.nextDeleteAt ?? null,
    row.workerId ?? null,
    row.leaseToken ?? null,
    row.leaseExpiresAt ?? null,
    row.heartbeatAt ?? null,
    row.deleteAttempts,
    row.rowVersion,
    row.lastErrorCode ?? null,
    row.lastErrorMessage ?? null,
    row.createdAt,
    row.updatedAt,
    row.deletedAt ?? null,
  ];
}

async function getByRef(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  credentialRef: string,
  forUpdate: boolean,
): Promise<SourceSecretLifecycleRef | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [normalizeRef(credentialRef)],
    sql: `SELECT * FROM ${q(database, lifecycleTable)} WHERE ${q(database, "credential_ref")} = ${p(database, 1)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: lifecycleTable,
  });
  return result.rows[0] ? mapLifecycle(result.rows[0]) : null;
}

async function getById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
): Promise<SourceSecretLifecycleRef | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [UuidSchema.parse(id)],
    sql: `SELECT * FROM ${q(database, lifecycleTable)} WHERE ${q(database, "id")} = ${p(database, 1)} LIMIT 1;`,
    tableName: lifecycleTable,
  });
  return result.rows[0] ? mapLifecycle(result.rows[0]) : null;
}

async function requireLockedRef(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  credentialRef: string,
): Promise<SourceSecretLifecycleRef> {
  const row = await getByRef(database, executor, credentialRef, true);
  if (!row) throw transition("Source secret lifecycle ref does not exist");
  return row;
}

function mapLifecycle(row: DatabaseRow): SourceSecretLifecycleRef {
  return lifecycleRef({
    createdAt: stringColumn(row, "created_at"),
    credentialRef: stringColumn(row, "credential_ref"),
    deleteAttempts: numberColumn(row, "delete_attempts"),
    deletedAt: optionalStringColumn(row, "deleted_at"),
    heartbeatAt: optionalStringColumn(row, "heartbeat_at"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    lastErrorCode: optionalStringColumn(row, "last_error_code"),
    lastErrorMessage: optionalStringColumn(row, "last_error_message"),
    leaseExpiresAt: optionalStringColumn(row, "lease_expires_at"),
    leaseToken: optionalStringColumn(row, "lease_token"),
    nextDeleteAt: optionalStringColumn(row, "next_delete_at"),
    operationId: stringColumn(row, "operation_id"),
    purpose: stringColumn(row, "purpose") as SourceSecretLifecyclePurpose,
    recoverAfter: stringColumn(row, "recover_after"),
    rowVersion: numberColumn(row, "row_version"),
    sourceId: stringColumn(row, "source_id"),
    sourceVersion: optionalNumberColumn(row, "source_version"),
    state: stringColumn(row, "state") as SourceSecretLifecycleState,
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
    workerId: optionalStringColumn(row, "worker_id"),
  });
}

function lifecycleRef(raw: SourceSecretLifecycleRef): SourceSecretLifecycleRef {
  const row = { ...raw };
  UuidSchema.parse(row.id);
  TenantIdSchema.parse(row.tenantId);
  UuidSchema.parse(row.knowledgeSpaceId);
  UuidSchema.parse(row.sourceId);
  normalizeRef(row.credentialRef);
  required(row.operationId, "operationId", 255);
  if (!SourceSecretLifecyclePurposes.includes(row.purpose))
    throw new Error("Invalid lifecycle purpose");
  if (!SourceSecretLifecycleStates.includes(row.state)) throw new Error("Invalid lifecycle state");
  DateTimeSchema.parse(row.recoverAfter);
  DateTimeSchema.parse(row.createdAt);
  DateTimeSchema.parse(row.updatedAt);
  nonnegativeInteger(row.deleteAttempts, "deleteAttempts");
  nonnegativeInteger(row.rowVersion, "rowVersion");
  if (row.sourceVersion !== undefined) positiveInteger(row.sourceVersion, "sourceVersion");
  if (row.state === "deleting") {
    if (!row.workerId || !row.leaseToken || !row.leaseExpiresAt || !row.heartbeatAt)
      throw new Error("Deleting lifecycle ref requires complete lease");
    UuidSchema.parse(row.leaseToken);
  } else if (row.workerId || row.leaseToken || row.leaseExpiresAt || row.heartbeatAt) {
    throw new Error("Only deleting lifecycle ref may hold a lease");
  }
  if ((row.state === "deleted") !== Boolean(row.deletedAt))
    throw new Error("Deleted lifecycle ref requires deletedAt only in deleted state");
  return cloneRef(row);
}

function requireReservation(
  row: SourceSecretLifecycleRef,
  operationId: string,
  expectedState: "staged" | "candidate",
  tenantId: string,
  sourceId: string,
): void {
  requireOperationScope(row, operationId, tenantId, sourceId);
  if (row.state !== expectedState) {
    throw transition(`Source secret assignment rejected from state=${row.state}`);
  }
}

function requireOperationScope(
  row: SourceSecretLifecycleRef,
  operationId: string,
  tenantId: string,
  sourceId: string,
): void {
  if (row.operationId !== operationId || row.tenantId !== tenantId || row.sourceId !== sourceId) {
    throw transition("Source secret lifecycle operation or scope does not match");
  }
}

function sameReservation(
  row: SourceSecretLifecycleRef,
  input: ReturnType<typeof normalizeReservation>,
  initialState: "staged" | "candidate",
): boolean {
  return (
    row.credentialRef === input.credentialRef &&
    row.operationId === input.operationId &&
    row.purpose === input.purpose &&
    row.tenantId === input.tenantId &&
    row.knowledgeSpaceId === input.knowledgeSpaceId &&
    row.sourceId === input.sourceId &&
    (row.state === initialState ||
      row.state === "active" ||
      row.state === "retired" ||
      row.state === "deleting" ||
      row.state === "deleted")
  );
}

function normalizeReservation(
  input: ReserveSourceSecretInput | ReserveSourceSecretCandidateInput,
  purpose: SourceSecretLifecyclePurpose,
) {
  return {
    credentialRef: normalizeRef(input.credentialRef),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    operationId: required(input.operationId, "operationId", 255),
    purpose,
    recoverAfter: DateTimeSchema.parse(input.recoverAfter),
    sourceId: UuidSchema.parse(input.sourceId),
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function normalizeCreateActivation(
  input: CreateSourceAndActivateInput,
): CreateSourceAndActivateInput {
  return {
    ...input,
    operationId: required(input.operationId, "operationId", 255),
    reservedCredentialRef: normalizeRef(input.reservedCredentialRef),
    source: {
      ...input.source,
      id: UuidSchema.parse(input.source.id),
      knowledgeSpaceId: UuidSchema.parse(input.source.knowledgeSpaceId),
      metadata: cloneJsonObject(input.source.metadata ?? {}),
    },
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function normalizeRotation(input: ActivateRotateAndRetireInput): ActivateRotateAndRetireInput {
  return {
    ...input,
    expectedVersion: positiveInteger(input.expectedVersion, "expectedVersion"),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    metadata: cloneJsonObject(input.metadata),
    newCredentialRef: input.newCredentialRef ? normalizeRef(input.newCredentialRef) : null,
    sourceId: UuidSchema.parse(input.sourceId),
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function normalizeCandidateActivation(input: CandidateActivateInput): CandidateActivateInput {
  return {
    ...input,
    candidateCredentialRef: normalizeRef(input.candidateCredentialRef),
    expectedJobRowVersion: nonnegativeInteger(input.expectedJobRowVersion, "expectedJobRowVersion"),
    expectedSourceVersion: positiveInteger(input.expectedSourceVersion, "expectedSourceVersion"),
    jobId: UuidSchema.parse(input.jobId),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    leaseToken: UuidSchema.parse(input.leaseToken),
    metadata: cloneJsonObject(input.metadata),
    now: DateTimeSchema.parse(input.now),
    sourceId: UuidSchema.parse(input.sourceId),
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function normalizeCandidateRefresh(input: CandidateRefreshInput): CandidateRefreshInput {
  return {
    ...input,
    expectedJobRowVersion: nonnegativeInteger(input.expectedJobRowVersion, "expectedJobRowVersion"),
    jobId: UuidSchema.parse(input.jobId),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    leaseToken: UuidSchema.parse(input.leaseToken),
    newCandidateCredentialRef: normalizeRef(input.newCandidateCredentialRef),
    newRecoverAfter: DateTimeSchema.parse(input.newRecoverAfter),
    now: DateTimeSchema.parse(input.now),
    oldCandidateCredentialRef: normalizeRef(input.oldCandidateCredentialRef),
    sourceId: UuidSchema.parse(input.sourceId),
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function normalizeBeginDelete(input: {
  readonly leaseExpiresAt: string;
  readonly now: string;
  readonly workerId: string;
}) {
  const nowValue = DateTimeSchema.parse(input.now);
  const leaseExpiresAt = DateTimeSchema.parse(input.leaseExpiresAt);
  if (leaseExpiresAt <= nowValue) throw new Error("Delete lease must expire after now");
  return { leaseExpiresAt, now: nowValue, workerId: required(input.workerId, "workerId", 255) };
}

function normalizeDeleteFence(input: SourceSecretDeleteFence): SourceSecretDeleteFence {
  return {
    credentialRef: normalizeRef(input.credentialRef),
    expectedRowVersion: nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion"),
    leaseToken: UuidSchema.parse(input.leaseToken),
    now: DateTimeSchema.parse(input.now),
  };
}

function requireDeleteFence(
  rows: Map<string, SourceSecretLifecycleRef>,
  rawInput: SourceSecretDeleteFence,
) {
  const input = normalizeDeleteFence(rawInput);
  const row = rows.get(input.credentialRef);
  if (
    !row ||
    row.state !== "deleting" ||
    row.rowVersion !== input.expectedRowVersion ||
    row.leaseToken !== input.leaseToken ||
    !row.leaseExpiresAt ||
    row.leaseExpiresAt <= input.now
  )
    throw staleFence();
  return { input, row };
}

function clearLease(row: SourceSecretLifecycleRef): SourceSecretLifecycleRef {
  const {
    heartbeatAt: _heartbeatAt,
    leaseExpiresAt: _leaseExpiresAt,
    leaseToken: _leaseToken,
    workerId: _workerId,
    ...rest
  } = row;
  return rest;
}

function compareLifecycleRows(
  left: SourceSecretLifecycleRef,
  right: SourceSecretLifecycleRef,
): number {
  return left.updatedAt === right.updatedAt
    ? left.id.localeCompare(right.id)
    : left.updatedAt.localeCompare(right.updatedAt);
}

function normalizeRef(value: string): string {
  const ref = required(value, "credentialRef", 255);
  if (!/^source-secret:v1:[0-9a-f-]{36}$/u.test(ref)) throw new Error("Invalid source secret ref");
  return ref;
}

function transition(message: string): SourceRetiredSecretCleanupTransitionError {
  return new SourceRetiredSecretCleanupTransitionError(message);
}

function staleFence(): SourceRetiredSecretCleanupTransitionError {
  return transition("Source secret delete fence is stale or expired");
}

function required(value: string | undefined, field: string, max: number): string {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > max)
    throw new Error(`Source secret lifecycle ${field} must contain 1-${max} characters`);
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Source secret lifecycle ${field} must be positive`);
  return value;
}

function nonnegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`Source secret lifecycle ${field} must be nonnegative`);
  return value;
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}

function cloneRef(row: SourceSecretLifecycleRef): SourceSecretLifecycleRef {
  return JSON.parse(JSON.stringify(row)) as SourceSecretLifecycleRef;
}

function cleanupJob(row: SourceSecretLifecycleRef): SourceRetiredSecretCleanupJob {
  const runState =
    row.state === "deleting" ? "running" : row.state === "deleted" ? "succeeded" : "queued";
  return {
    ...cloneRef(row),
    retiredCredentialRef: row.credentialRef,
    retryCount: row.deleteAttempts,
    runState,
  };
}

function inMemoryDeleteFence(
  refById: ReadonlyMap<string, string>,
  input: SourceRetiredSecretCleanupFence,
): SourceSecretDeleteFence {
  const credentialRef = refById.get(UuidSchema.parse(input.jobId));
  if (!credentialRef) throw staleFence();
  return {
    credentialRef,
    expectedRowVersion: input.expectedRowVersion,
    leaseToken: input.leaseToken,
    now: input.now,
  };
}

async function databaseDeleteFence(
  database: DatabaseAdapter,
  input: SourceRetiredSecretCleanupFence,
): Promise<SourceSecretDeleteFence> {
  const row = await getById(database, database, input.jobId);
  if (!row) throw staleFence();
  return {
    credentialRef: row.credentialRef,
    expectedRowVersion: input.expectedRowVersion,
    leaseToken: input.leaseToken,
    now: input.now,
  };
}

/**
 * Transaction-scoped building blocks used by the credential backfill repository. Callers must
 * preserve the global lock order: lifecycle ref, backfill job, then source row.
 */
export const sourceSecretLifecycleTransactionOperations = {
  clearLease,
  createRef: lifecycleRef,
  getByRef,
  getSource,
  insert: insertLifecycle,
  persist: persistLifecycle,
  updateSourceCredential,
} as const;
