import { randomUUID } from "node:crypto";
import { ProjectionSetFingerprintSchema, UuidSchema } from "@knowledge/core";

import type {
  KnowledgeSpaceAccessChannel,
  KnowledgeSpacePermissionSnapshot,
} from "./knowledge-space-access-control";
import type { KnowledgeSpaceProfileKind } from "./knowledge-space-profile-repository";

export const KnowledgeSpaceProfileMigrationRunStates = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type KnowledgeSpaceProfileMigrationRunState =
  (typeof KnowledgeSpaceProfileMigrationRunStates)[number];

export const KnowledgeSpaceProfileMigrationCheckpoints = [
  "queued",
  "candidate-built",
  "evaluated",
  "activated",
] as const;
export type KnowledgeSpaceProfileMigrationCheckpoint =
  (typeof KnowledgeSpaceProfileMigrationCheckpoints)[number];

/**
 * `clone-publication` is intentionally still a publication migration: no index bytes need to be
 * rebuilt, but a successor publication must be bound and jointly activated so a settings-only
 * retrieval change can never invalidate the currently published tuple.
 */
export type KnowledgeSpaceProfileMigrationRebuildScope =
  | "clone-publication"
  | "full-page-index-summary-outline"
  | "full-vector-space";

export interface KnowledgeSpaceProfileMigrationProfileReference {
  readonly id: string;
  readonly revision: number;
  readonly snapshotDigest: string;
}

export interface KnowledgeSpaceProfileMigrationPublicationReference {
  readonly fingerprint: string;
  readonly headRevision: number;
  readonly id: string;
}

export interface KnowledgeSpaceProfileMigrationRun {
  readonly accessChannel?: KnowledgeSpacePermissionSnapshot["accessChannel"] | undefined;
  readonly baseEmbeddingProfile?: KnowledgeSpaceProfileMigrationProfileReference | undefined;
  readonly basePublication: KnowledgeSpaceProfileMigrationPublicationReference;
  readonly baseRetrievalProfile: KnowledgeSpaceProfileMigrationProfileReference;
  readonly capabilityGrantId?: string | undefined;
  readonly canceledAt?: string | undefined;
  readonly candidateProfile: KnowledgeSpaceProfileMigrationProfileReference;
  readonly candidatePublicationId?: string | undefined;
  readonly candidatePublicationFingerprint?: string | undefined;
  readonly changedKind: KnowledgeSpaceProfileKind;
  readonly checkpoint: KnowledgeSpaceProfileMigrationCheckpoint;
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly evaluationSummary?: Readonly<Record<string, unknown>> | undefined;
  readonly executionAttempts: number;
  readonly heartbeatAt?: string | undefined;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly maxExecutionAttempts: number;
  readonly permissionSnapshotId?: string | undefined;
  readonly permissionSnapshotRevision?: number | undefined;
  readonly rebuildScope: KnowledgeSpaceProfileMigrationRebuildScope;
  readonly requestedBySubjectId?: string | undefined;
  readonly rowVersion: number;
  readonly runState: KnowledgeSpaceProfileMigrationRunState;
  readonly tenantId: string;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
}

export interface StartKnowledgeSpaceProfileMigrationInput {
  readonly accessChannel?: KnowledgeSpacePermissionSnapshot["accessChannel"] | undefined;
  readonly baseEmbeddingProfile?: KnowledgeSpaceProfileMigrationProfileReference | undefined;
  readonly basePublication: KnowledgeSpaceProfileMigrationPublicationReference;
  readonly baseRetrievalProfile: KnowledgeSpaceProfileMigrationProfileReference;
  readonly capabilityGrantId?: string | undefined;
  readonly candidateProfile: KnowledgeSpaceProfileMigrationProfileReference;
  readonly changedKind: KnowledgeSpaceProfileKind;
  readonly createdAt: string;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly maxExecutionAttempts: number;
  readonly permissionSnapshotId?: string | undefined;
  readonly permissionSnapshotRevision?: number | undefined;
  readonly rebuildScope: KnowledgeSpaceProfileMigrationRebuildScope;
  readonly requestedBySubjectId?: string | undefined;
  readonly tenantId: string;
}

export interface KnowledgeSpaceProfileMigrationFence {
  readonly expectedRowVersion: number;
  readonly leaseToken: string;
  readonly now: string;
  readonly runId: string;
}

export interface KnowledgeSpaceProfileMigrationRepository {
  cancel(input: {
    readonly accessChannel?: KnowledgeSpaceAccessChannel | undefined;
    readonly capabilityGrantId?: string | undefined;
    readonly now: string;
    readonly permissionSnapshotId?: string | undefined;
    readonly permissionSnapshotRevision?: number | undefined;
    readonly reason: string;
    readonly requestedBySubjectId?: string | undefined;
    readonly runId: string;
  }): Promise<KnowledgeSpaceProfileMigrationRun | null>;
  checkpoint(
    input: KnowledgeSpaceProfileMigrationFence & {
      readonly candidatePublicationFingerprint?: string | undefined;
      readonly candidatePublicationId?: string | undefined;
      readonly checkpoint: Exclude<KnowledgeSpaceProfileMigrationCheckpoint, "activated">;
      readonly evaluationSummary?: Readonly<Record<string, unknown>> | undefined;
    },
  ): Promise<KnowledgeSpaceProfileMigrationRun | null>;
  claim(input: {
    readonly leaseExpiresAt: string;
    readonly limit: number;
    readonly now: string;
    readonly workerId: string;
  }): Promise<readonly KnowledgeSpaceProfileMigrationRun[]>;
  fail(
    input: KnowledgeSpaceProfileMigrationFence & {
      readonly errorCode: string;
      readonly errorMessage: string;
      readonly terminal: boolean;
    },
  ): Promise<KnowledgeSpaceProfileMigrationRun | null>;
  findByRequest(input: {
    readonly capabilityGrantId?: string | undefined;
    readonly idempotencyKey: string;
    readonly knowledgeSpaceId: string;
    readonly requestedBySubjectId?: string | undefined;
    readonly tenantId: string;
  }): Promise<KnowledgeSpaceProfileMigrationRun | null>;
  get(runId: string): Promise<KnowledgeSpaceProfileMigrationRun | null>;
  heartbeat(
    input: KnowledgeSpaceProfileMigrationFence & {
      readonly leaseExpiresAt: string;
      readonly workerId: string;
    },
  ): Promise<KnowledgeSpaceProfileMigrationRun | null>;
  retry(input: {
    readonly capabilityGrantId?: string | undefined;
    readonly expectedCapabilityGrantId?: string | undefined;
    readonly expectedPermissionSnapshotId?: string | undefined;
    readonly expectedPermissionSnapshotRevision?: number | undefined;
    readonly now: string;
    readonly permissionSnapshotId?: string | undefined;
    readonly permissionSnapshotRevision?: number | undefined;
    readonly requestedBySubjectId?: string | undefined;
    readonly runId: string;
  }): Promise<KnowledgeSpaceProfileMigrationRun | null>;
  start(
    input: StartKnowledgeSpaceProfileMigrationInput,
  ): Promise<KnowledgeSpaceProfileMigrationRun>;
  succeed(
    input: KnowledgeSpaceProfileMigrationFence,
  ): Promise<KnowledgeSpaceProfileMigrationRun | null>;
}

export class KnowledgeSpaceProfileMigrationConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "KnowledgeSpaceProfileMigrationConflictError";
    this.code = code;
  }
}

export interface InMemoryKnowledgeSpaceProfileMigrationRepositoryOptions {
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly generateRunId?: (() => string) | undefined;
  readonly maxRuns: number;
}

/** Deterministic test/local implementation with the same lease and row-version fences as SQL. */
export function createInMemoryKnowledgeSpaceProfileMigrationRepository({
  generateLeaseToken = randomUUID,
  generateRunId = randomUUID,
  maxRuns,
}: InMemoryKnowledgeSpaceProfileMigrationRepositoryOptions): KnowledgeSpaceProfileMigrationRepository {
  positiveInteger(maxRuns, "maxRuns");
  const runs = new Map<string, KnowledgeSpaceProfileMigrationRun>();
  const requestKeys = new Map<string, string>();

  const save = (run: KnowledgeSpaceProfileMigrationRun) => {
    const frozen = freezeRun(run);
    runs.set(run.id, frozen);
    return frozen;
  };
  const fenced = (input: KnowledgeSpaceProfileMigrationFence) => {
    const current = runs.get(input.runId);
    if (
      !current ||
      current.runState !== "running" ||
      current.rowVersion !== input.expectedRowVersion ||
      current.leaseToken !== input.leaseToken ||
      !current.leaseExpiresAt ||
      Date.parse(current.leaseExpiresAt) <= Date.parse(input.now)
    ) {
      return null;
    }
    return current;
  };

  return {
    start: async (raw) => {
      const input = normalizeStart(raw);
      const requestKey = profileMigrationRequestKey(input);
      const existingId = requestKeys.get(requestKey);
      if (existingId) {
        const existing = runs.get(existingId);
        if (!existing) throw new Error("Profile migration idempotency index is corrupt");
        if (!sameStart(existing, input)) {
          throw new KnowledgeSpaceProfileMigrationConflictError(
            "PROFILE_MIGRATION_IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for a different profile migration",
          );
        }
        return existing;
      }
      if (
        [...runs.values()].some(
          (run) =>
            run.tenantId === input.tenantId &&
            run.knowledgeSpaceId === input.knowledgeSpaceId &&
            (run.runState === "queued" || run.runState === "running"),
        )
      ) {
        throw new KnowledgeSpaceProfileMigrationConflictError(
          "PROFILE_MIGRATION_ALREADY_ACTIVE",
          "Another profile migration is already active for this knowledge space",
        );
      }
      if (runs.size >= maxRuns) throw new Error("Profile migration repository capacity exceeded");
      const id = requiredString(generateRunId(), "runId");
      const run = save({
        ...input,
        checkpoint: "queued",
        executionAttempts: 0,
        id,
        rowVersion: 1,
        runState: "queued",
        updatedAt: input.createdAt,
      });
      requestKeys.set(requestKey, id);
      return run;
    },
    get: async (id) => runs.get(id) ?? null,
    findByRequest: async (input) => {
      const key = profileMigrationRequestKey(input);
      const id = requestKeys.get(key);
      return id ? (runs.get(id) ?? null) : null;
    },
    claim: async (raw) => {
      const now = validDate(raw.now, "claim.now");
      const leaseExpiresAt = validDate(raw.leaseExpiresAt, "claim.leaseExpiresAt");
      positiveInteger(raw.limit, "claim.limit");
      requiredString(raw.workerId, "claim.workerId");
      if (Date.parse(leaseExpiresAt) <= Date.parse(now))
        throw new Error("Lease must expire after now");
      const claimable = [...runs.values()]
        .filter(
          (run) =>
            run.runState === "queued" ||
            (run.runState === "running" &&
              run.leaseExpiresAt !== undefined &&
              Date.parse(run.leaseExpiresAt) <= Date.parse(now)),
        )
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
        .slice(0, raw.limit);
      const claimed: KnowledgeSpaceProfileMigrationRun[] = [];
      for (const current of claimable) {
        if (current.executionAttempts >= current.maxExecutionAttempts) {
          save({
            ...clearLease(current),
            completedAt: now,
            lastErrorCode: "PROFILE_MIGRATION_ATTEMPTS_EXHAUSTED",
            lastErrorMessage: "Profile migration exhausted its execution-attempt budget",
            rowVersion: current.rowVersion + 1,
            runState: "failed",
            updatedAt: now,
          });
          continue;
        }
        claimed.push(
          save({
            ...current,
            executionAttempts: current.executionAttempts + 1,
            heartbeatAt: now,
            leaseExpiresAt,
            leaseToken: requiredString(generateLeaseToken(), "leaseToken"),
            rowVersion: current.rowVersion + 1,
            runState: "running",
            updatedAt: now,
            workerId: raw.workerId,
          }),
        );
      }
      return claimed;
    },
    heartbeat: async (raw) => {
      const input = normalizeFence(raw);
      const current = fenced(input);
      if (!current || current.workerId !== raw.workerId) return null;
      const leaseExpiresAt = validDate(raw.leaseExpiresAt, "heartbeat.leaseExpiresAt");
      if (Date.parse(leaseExpiresAt) <= Date.parse(input.now)) return null;
      return save({
        ...current,
        heartbeatAt: input.now,
        leaseExpiresAt,
        rowVersion: current.rowVersion + 1,
        updatedAt: input.now,
      });
    },
    checkpoint: async (raw) => {
      const input = normalizeFence(raw);
      const current = fenced(input);
      if (!current) return null;
      const nextOrder = checkpointOrder(raw.checkpoint);
      if (nextOrder < checkpointOrder(current.checkpoint)) {
        throw new KnowledgeSpaceProfileMigrationConflictError(
          "PROFILE_MIGRATION_CHECKPOINT_CONFLICT",
          "Profile migration checkpoint cannot move backwards or activate outside joint CAS",
        );
      }
      const candidatePublicationFingerprint =
        raw.candidatePublicationFingerprint ?? current.candidatePublicationFingerprint;
      const candidatePublicationId = raw.candidatePublicationId ?? current.candidatePublicationId;
      const evaluationSummary = raw.evaluationSummary
        ? sanitizeSummary(raw.evaluationSummary)
        : current.evaluationSummary;
      if (raw.checkpoint !== "queued" && !candidatePublicationFingerprint) {
        throw new KnowledgeSpaceProfileMigrationConflictError(
          "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_REQUIRED",
          "Candidate publication must be frozen before advancing the checkpoint",
        );
      }
      if (
        raw.checkpoint === "queued" &&
        (candidatePublicationFingerprint || candidatePublicationId || evaluationSummary)
      ) {
        throw new KnowledgeSpaceProfileMigrationConflictError(
          "PROFILE_MIGRATION_CHECKPOINT_CONFLICT",
          "Queued checkpoint cannot carry candidate publication or evaluation state",
        );
      }
      if (raw.checkpoint === "candidate-built" && evaluationSummary) {
        throw new KnowledgeSpaceProfileMigrationConflictError(
          "PROFILE_MIGRATION_CHECKPOINT_CONFLICT",
          "Candidate-built checkpoint cannot carry an evaluation summary",
        );
      }
      if (raw.checkpoint === "evaluated" && !evaluationSummary) {
        throw new KnowledgeSpaceProfileMigrationConflictError(
          "PROFILE_MIGRATION_EVALUATION_REQUIRED",
          "Evaluated checkpoint requires a persisted evaluation summary",
        );
      }
      return save({
        ...current,
        ...(candidatePublicationFingerprint ? { candidatePublicationFingerprint } : {}),
        ...(candidatePublicationId ? { candidatePublicationId } : {}),
        checkpoint: raw.checkpoint,
        ...(evaluationSummary ? { evaluationSummary } : {}),
        rowVersion: current.rowVersion + 1,
        updatedAt: input.now,
      });
    },
    succeed: async (raw) => {
      const input = normalizeFence(raw);
      const current = fenced(input);
      if (
        !current ||
        current.checkpoint !== "evaluated" ||
        !current.candidatePublicationFingerprint
      ) {
        return null;
      }
      return save({
        ...clearLease(current),
        checkpoint: "activated",
        completedAt: input.now,
        rowVersion: current.rowVersion + 1,
        runState: "succeeded",
        updatedAt: input.now,
      });
    },
    fail: async (raw) => {
      const input = normalizeFence(raw);
      const current = fenced(input);
      if (!current) return null;
      return save({
        ...clearLease(current),
        completedAt: input.now,
        lastErrorCode: safeError(raw.errorCode, 64, "PROFILE_MIGRATION_FAILED"),
        lastErrorMessage: safeError(raw.errorMessage, 2_000, "Profile migration failed"),
        rowVersion: current.rowVersion + 1,
        runState: "failed",
        updatedAt: input.now,
      });
    },
    cancel: async (raw) => {
      const current = runs.get(raw.runId);
      if (!current) return null;
      if (current.runState === "succeeded" || current.runState === "canceled") return current;
      const now = validDate(raw.now, "cancel.now");
      const authorization = normalizeProfileMigrationAuthorization({
        ...raw,
        ...(current.accessChannel ? { accessChannel: current.accessChannel } : {}),
      });
      return save({
        ...clearLease(current),
        ...authorization,
        canceledAt: now,
        completedAt: now,
        lastErrorCode: "PROFILE_MIGRATION_CANCELED",
        lastErrorMessage: safeError(raw.reason, 2_000, "Profile migration canceled"),
        rowVersion: current.rowVersion + 1,
        runState: "canceled",
        updatedAt: now,
      });
    },
    retry: async (raw) => {
      const current = runs.get(raw.runId);
      if (!current) return null;
      const authorization = normalizeProfileMigrationAuthorization({
        ...raw,
        ...(current.accessChannel ? { accessChannel: current.accessChannel } : {}),
      });
      const expectedMatches = current.capabilityGrantId
        ? current.capabilityGrantId === raw.expectedCapabilityGrantId
        : current.requestedBySubjectId === raw.requestedBySubjectId &&
          current.permissionSnapshotId === raw.expectedPermissionSnapshotId &&
          current.permissionSnapshotRevision === raw.expectedPermissionSnapshotRevision;
      if (!expectedMatches) {
        throw new KnowledgeSpaceProfileMigrationConflictError(
          "PROFILE_MIGRATION_PERMISSION_SNAPSHOT_CONFLICT",
          "Profile migration permission snapshot changed before retry",
        );
      }
      if (current.runState !== "failed") {
        throw new KnowledgeSpaceProfileMigrationConflictError(
          "PROFILE_MIGRATION_NOT_RETRYABLE",
          "Only a failed profile migration can be retried",
        );
      }
      if (isTerminalKnowledgeSpaceProfileMigrationError(current.lastErrorCode)) {
        throw new KnowledgeSpaceProfileMigrationConflictError(
          "PROFILE_MIGRATION_NOT_RETRYABLE",
          "Terminal profile migration failures cannot be retried",
        );
      }
      if (
        [...runs.values()].some(
          (run) =>
            run.id !== current.id &&
            run.tenantId === current.tenantId &&
            run.knowledgeSpaceId === current.knowledgeSpaceId &&
            (run.runState === "queued" || run.runState === "running"),
        )
      ) {
        throw new KnowledgeSpaceProfileMigrationConflictError(
          "PROFILE_MIGRATION_ALREADY_ACTIVE",
          "Another profile migration is already active for this knowledge space",
        );
      }
      const now = validDate(raw.now, "retry.now");
      return save({
        ...clearLease(current),
        ...authorization,
        completedAt: undefined,
        executionAttempts: 0,
        lastErrorCode: undefined,
        lastErrorMessage: undefined,
        rowVersion: current.rowVersion + 1,
        runState: "queued",
        updatedAt: now,
      });
    },
  };
}

const terminalProfileMigrationErrorCodes = new Set([
  "PROFILE_MIGRATION_ATTEMPTS_EXHAUSTED",
  "PROFILE_MIGRATION_BASE_MEMBER_INVALID",
  "PROFILE_MIGRATION_BASE_OUTLINE_INVALID",
  "PROFILE_MIGRATION_BASE_PUBLICATION_CHANGED",
  "PROFILE_MIGRATION_CANDIDATE_INVALID",
  "PROFILE_MIGRATION_CANDIDATE_MEMBER_LIMIT",
  "PROFILE_MIGRATION_CANDIDATE_NOT_VALIDATING",
  "PROFILE_MIGRATION_CANDIDATE_PROJECTION_INVALID",
  "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_CONFLICT",
  "PROFILE_MIGRATION_CANDIDATE_PUBLICATION_INVALID",
  "PROFILE_MIGRATION_CHECKPOINT_CORRUPT",
  "PROFILE_MIGRATION_EVALUATION_FAILED",
  "PROFILE_MIGRATION_PAGE_INDEX_REBUILD_INCOMPLETE",
  "PROFILE_MIGRATION_PROFILE_SNAPSHOT_INVALID",
  "PROFILE_MIGRATION_SOURCE_SNAPSHOT_INVALID",
  "PROFILE_MIGRATION_SUCCESSOR_INCOMPLETE",
  "PROFILE_MIGRATION_VECTOR_REBUILD_INCOMPLETE",
]);

export function isTerminalKnowledgeSpaceProfileMigrationError(code: string | undefined): boolean {
  return code !== undefined && terminalProfileMigrationErrorCodes.has(code);
}

function normalizeStart(input: StartKnowledgeSpaceProfileMigrationInput) {
  const changedKind = input.changedKind;
  const expectedScope: KnowledgeSpaceProfileMigrationRebuildScope =
    changedKind === "embedding" ? "full-vector-space" : input.rebuildScope;
  if (changedKind === "embedding" && input.rebuildScope !== expectedScope) {
    throw new Error("Embedding profile migrations require a full vector-space rebuild");
  }
  if (
    changedKind === "retrieval" &&
    input.rebuildScope !== "clone-publication" &&
    input.rebuildScope !== "full-page-index-summary-outline"
  ) {
    throw new Error("Retrieval profile migration rebuild scope is invalid");
  }
  const authorization = normalizeProfileMigrationAuthorization(input);
  return {
    ...input,
    ...authorization,
    baseEmbeddingProfile: input.baseEmbeddingProfile
      ? normalizeReference(input.baseEmbeddingProfile, "baseEmbeddingProfile")
      : undefined,
    basePublication: {
      fingerprint: ProjectionSetFingerprintSchema.parse(input.basePublication.fingerprint),
      headRevision: positiveInteger(
        input.basePublication.headRevision,
        "basePublication.headRevision",
      ),
      id: requiredString(input.basePublication.id, "basePublication.id"),
    },
    baseRetrievalProfile: normalizeReference(input.baseRetrievalProfile, "baseRetrievalProfile"),
    candidateProfile: normalizeReference(input.candidateProfile, "candidateProfile"),
    changedKind,
    createdAt: validDate(input.createdAt, "createdAt"),
    idempotencyKey: boundedString(input.idempotencyKey, 255, "idempotencyKey"),
    knowledgeSpaceId: requiredString(input.knowledgeSpaceId, "knowledgeSpaceId"),
    maxExecutionAttempts: positiveInteger(input.maxExecutionAttempts, "maxExecutionAttempts"),
    tenantId: boundedString(input.tenantId, 255, "tenantId"),
  };
}

function normalizeProfileMigrationAuthorization(input: {
  readonly accessChannel?: KnowledgeSpaceAccessChannel | undefined;
  readonly capabilityGrantId?: string | undefined;
  readonly permissionSnapshotId?: string | undefined;
  readonly permissionSnapshotRevision?: number | undefined;
  readonly requestedBySubjectId?: string | undefined;
}): Pick<
  KnowledgeSpaceProfileMigrationRun,
  | "accessChannel"
  | "capabilityGrantId"
  | "permissionSnapshotId"
  | "permissionSnapshotRevision"
  | "requestedBySubjectId"
> {
  const hasLegacy = Boolean(
    input.accessChannel ||
      input.permissionSnapshotId ||
      input.permissionSnapshotRevision ||
      input.requestedBySubjectId,
  );
  const legacyComplete = Boolean(
    input.accessChannel &&
      input.permissionSnapshotId &&
      input.permissionSnapshotRevision &&
      input.requestedBySubjectId,
  );
  if ((hasLegacy && !legacyComplete) || (input.capabilityGrantId && hasLegacy)) {
    throw new Error("Profile migration requires exactly one authorization binding");
  }
  if (input.capabilityGrantId) {
    return { capabilityGrantId: UuidSchema.parse(input.capabilityGrantId) };
  }
  if (!legacyComplete) {
    throw new Error("Profile migration requires exactly one authorization binding");
  }
  if (
    !input.accessChannel ||
    !input.permissionSnapshotId ||
    !input.permissionSnapshotRevision ||
    !input.requestedBySubjectId
  ) {
    throw new Error("Profile migration requires exactly one authorization binding");
  }
  return {
    accessChannel: input.accessChannel,
    permissionSnapshotId: requiredString(input.permissionSnapshotId, "permissionSnapshotId"),
    permissionSnapshotRevision: positiveInteger(
      input.permissionSnapshotRevision,
      "permissionSnapshotRevision",
    ),
    requestedBySubjectId: boundedString(input.requestedBySubjectId, 255, "requestedBySubjectId"),
  };
}

function profileMigrationRequestKey(input: {
  readonly capabilityGrantId?: string | undefined;
  readonly idempotencyKey: string;
  readonly knowledgeSpaceId: string;
  readonly requestedBySubjectId?: string | undefined;
  readonly tenantId: string;
}): string {
  const authorizationKey = input.capabilityGrantId
    ? `capability:${input.capabilityGrantId}`
    : `subject:${requiredString(input.requestedBySubjectId ?? "", "requestedBySubjectId")}`;
  return `${input.tenantId}\u0000${input.knowledgeSpaceId}\u0000${authorizationKey}\u0000${input.idempotencyKey}`;
}

function normalizeReference(
  value: KnowledgeSpaceProfileMigrationProfileReference,
  name: string,
): KnowledgeSpaceProfileMigrationProfileReference {
  return Object.freeze({
    id: requiredString(value.id, `${name}.id`),
    revision: positiveInteger(value.revision, `${name}.revision`),
    snapshotDigest: digest(value.snapshotDigest, `${name}.snapshotDigest`),
  });
}

function normalizeFence<T extends KnowledgeSpaceProfileMigrationFence>(input: T): T {
  positiveInteger(input.expectedRowVersion, "expectedRowVersion");
  requiredString(input.leaseToken, "leaseToken");
  requiredString(input.runId, "runId");
  validDate(input.now, "now");
  return input;
}

function checkpointOrder(value: KnowledgeSpaceProfileMigrationCheckpoint): number {
  return KnowledgeSpaceProfileMigrationCheckpoints.indexOf(value);
}

function clearLease<T extends KnowledgeSpaceProfileMigrationRun>(
  run: T,
): Omit<T, "heartbeatAt" | "leaseExpiresAt" | "leaseToken" | "workerId"> {
  const {
    heartbeatAt: _heartbeatAt,
    leaseExpiresAt: _leaseExpiresAt,
    leaseToken: _leaseToken,
    workerId: _workerId,
    ...rest
  } = run;
  return rest;
}

function sameStart(
  run: KnowledgeSpaceProfileMigrationRun,
  input: ReturnType<typeof normalizeStart>,
): boolean {
  return (
    JSON.stringify({
      ...input,
      baseEmbeddingProfile: input.baseEmbeddingProfile ?? null,
    }) ===
    JSON.stringify({
      accessChannel: run.accessChannel,
      baseEmbeddingProfile: run.baseEmbeddingProfile ?? null,
      basePublication: run.basePublication,
      baseRetrievalProfile: run.baseRetrievalProfile,
      capabilityGrantId: run.capabilityGrantId,
      candidateProfile: run.candidateProfile,
      changedKind: run.changedKind,
      createdAt: run.createdAt,
      idempotencyKey: run.idempotencyKey,
      knowledgeSpaceId: run.knowledgeSpaceId,
      maxExecutionAttempts: run.maxExecutionAttempts,
      permissionSnapshotId: run.permissionSnapshotId,
      permissionSnapshotRevision: run.permissionSnapshotRevision,
      rebuildScope: run.rebuildScope,
      requestedBySubjectId: run.requestedBySubjectId,
      tenantId: run.tenantId,
    })
  );
}

function freezeRun(run: KnowledgeSpaceProfileMigrationRun): KnowledgeSpaceProfileMigrationRun {
  return Object.freeze({
    ...run,
    ...(run.baseEmbeddingProfile
      ? { baseEmbeddingProfile: Object.freeze({ ...run.baseEmbeddingProfile }) }
      : {}),
    basePublication: Object.freeze({ ...run.basePublication }),
    baseRetrievalProfile: Object.freeze({ ...run.baseRetrievalProfile }),
    candidateProfile: Object.freeze({ ...run.candidateProfile }),
    ...(run.evaluationSummary
      ? { evaluationSummary: Object.freeze({ ...run.evaluationSummary }) }
      : {}),
  });
}

function sanitizeSummary(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 32)) {
    if (typeof item === "boolean" || typeof item === "number" || typeof item === "string") {
      safe[key.slice(0, 64)] = typeof item === "string" ? item.slice(0, 512) : item;
    }
  }
  return Object.freeze(safe);
}

function digest(value: string, name: string): string {
  const normalized = requiredString(value, name).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error(`${name} must be a SHA-256 digest`);
  return normalized;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`${name} must be a positive integer`);
  return value;
}

function requiredString(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty`);
  return normalized;
}

function boundedString(value: string, max: number, name: string): string {
  const normalized = requiredString(value, name);
  if (normalized.length > max) throw new Error(`${name} exceeds ${max} characters`);
  return normalized;
}

function validDate(value: string, name: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO timestamp`);
  return value;
}

function safeError(value: string, max: number, fallback: string): string {
  const normalized = value.trim().replaceAll(/[\r\n\t]+/g, " ");
  return (normalized || fallback).slice(0, max);
}
