import { randomUUID } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  type Source,
  TenantIdSchema,
  UuidSchema,
} from "@knowledge/core";

import { redactSourceMetadata } from "./core-resource-response-schemas";
import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  qualifiedDatabaseIdentifier,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import { readLegacyCredentials } from "./source-credential-service";
import {
  type SourceSecretLifecycleRef,
  sourceSecretLifecycleTransactionOperations as lifecycleOperations,
} from "./source-retired-secret-cleanup";
import type { SourceCredentialFingerprinter } from "./source-secret-store";

export const SourceCredentialBackfillRunStates = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type SourceCredentialBackfillRunState = (typeof SourceCredentialBackfillRunStates)[number];

export interface SourceCredentialBackfillJob {
  readonly candidateLifecycleState?: "active" | "candidate" | undefined;
  readonly candidateCredentialRef: string;
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly heartbeatAt?: string | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly retryCount: number;
  readonly rowVersion: number;
  readonly runState: SourceCredentialBackfillRunState;
  readonly secretFingerprint: string;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly tenantId: string;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
}

export interface SourceCredentialBackfillFence {
  readonly candidateCredentialRef?: string | undefined;
  readonly expectedRowVersion: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly now: string;
}

export type SourceCredentialBackfillTransitionOutcome =
  | "abandoned"
  | "activated"
  | "already_active"
  | "refreshed";

export interface SourceCredentialBackfillTransitionResult {
  readonly job: SourceCredentialBackfillJob;
  readonly outcome: SourceCredentialBackfillTransitionOutcome;
}

export interface DiscoverSourceCredentialBackfillsInput {
  readonly afterSourceId?: string | undefined;
  readonly limit: number;
  readonly now: string;
}

export interface DiscoverSourceCredentialBackfillsResult {
  readonly created: number;
  readonly nextSourceId?: string | undefined;
  readonly scanned: number;
}

export interface SourceCredentialBackfillRepository {
  abandonCandidate(
    input: SourceCredentialBackfillFence & {
      readonly errorCode?: string | undefined;
      readonly errorMessage?: string | undefined;
      readonly terminalState: "failed" | "succeeded";
    },
  ): Promise<SourceCredentialBackfillTransitionResult>;
  activateCandidate(
    input: SourceCredentialBackfillFence,
  ): Promise<SourceCredentialBackfillTransitionResult>;
  claim(input: {
    readonly leaseExpiresAt: string;
    readonly limit: number;
    readonly now: string;
    readonly workerId: string;
  }): Promise<readonly SourceCredentialBackfillJob[]>;
  complete(input: SourceCredentialBackfillFence): Promise<SourceCredentialBackfillJob>;
  discover(
    input: DiscoverSourceCredentialBackfillsInput,
  ): Promise<DiscoverSourceCredentialBackfillsResult>;
  fail(
    input: SourceCredentialBackfillFence & {
      readonly errorCode: string;
      readonly errorMessage: string;
    },
  ): Promise<SourceCredentialBackfillJob>;
  get(input: { readonly jobId: string }): Promise<SourceCredentialBackfillJob | null>;
  heartbeat(
    input: SourceCredentialBackfillFence & {
      readonly leaseExpiresAt: string;
      readonly workerId: string;
    },
  ): Promise<SourceCredentialBackfillJob>;
  refresh(
    input: SourceCredentialBackfillFence & {
      readonly secretFingerprint: string;
      readonly sourceVersion: number;
    },
  ): Promise<SourceCredentialBackfillJob>;
  refreshCandidate(
    input: SourceCredentialBackfillFence & {
      readonly secretFingerprint: string;
      readonly sourceVersion: number;
    },
  ): Promise<SourceCredentialBackfillTransitionResult>;
  release(input: SourceCredentialBackfillFence): Promise<SourceCredentialBackfillJob>;
  retryableFailure(
    input: SourceCredentialBackfillFence & {
      readonly errorCode: string;
      readonly errorMessage: string;
    },
  ): Promise<SourceCredentialBackfillJob>;
  retry(input: {
    readonly jobId: string;
    readonly now: string;
  }): Promise<SourceCredentialBackfillJob | null>;
  withWriteAdmission<T>(
    input: { readonly knowledgeSpaceId: string; readonly tenantId: string },
    mutation: () => Promise<T>,
  ): Promise<T>;
}

export interface DatabaseSourceCredentialBackfillRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly credentialFingerprinter: SourceCredentialFingerprinter;
  readonly generateCandidateCredentialRef?: (() => string) | undefined;
  readonly generateId?: (() => string) | undefined;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly generateLifecycleId?: (() => string) | undefined;
  readonly maxClaimBatchSize: number;
  readonly maxDiscoveryBatchSize: number;
}

export class SourceCredentialBackfillTransitionError extends Error {
  readonly code = "SOURCE_CREDENTIAL_BACKFILL_TRANSITION_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "SourceCredentialBackfillTransitionError";
  }
}

const jobTable = "source_credential_backfills";
const sourceTable = "sources";
const spaceTable = "knowledge_spaces";

/**
 * Durable control plane for migrating legacy source credentials. Discovery reads the legacy
 * value only long enough to calculate its fingerprint; the job row contains an opaque candidate
 * reference and fingerprint, never credential bytes. Every worker transition is lease-token and
 * row-version fenced, including recovery of an expired worker lease.
 */
export function createDatabaseSourceCredentialBackfillRepository({
  database,
  credentialFingerprinter,
  generateCandidateCredentialRef = () => `source-secret:v1:${randomUUID()}`,
  generateId = randomUUID,
  generateLeaseToken = randomUUID,
  generateLifecycleId = randomUUID,
  maxClaimBatchSize,
  maxDiscoveryBatchSize,
}: DatabaseSourceCredentialBackfillRepositoryOptions): SourceCredentialBackfillRepository {
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");
  positiveInteger(maxDiscoveryBatchSize, "maxDiscoveryBatchSize");

  const api: SourceCredentialBackfillRepository = {
    withWriteAdmission: (input, mutation) =>
      database.transaction(async (transaction) => {
        await requireBackfillWriteAdmission(database, transaction, input);
        return mutation();
      }),
    abandonCandidate: (input) =>
      abandonCandidateTransition({
        database,
        credentialFingerprinter,
        generateCandidateCredentialRef,
        generateLifecycleId,
        input,
      }),
    activateCandidate: (input) =>
      activateCandidateTransition({
        database,
        credentialFingerprinter,
        generateCandidateCredentialRef,
        generateLifecycleId,
        input,
      }),
    claim: async (rawInput) => {
      const input = normalizeClaim(rawInput, maxClaimBatchSize);
      return database.transaction(async (transaction) => {
        const result = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [input.now, 1],
          sql: `SELECT ${q(database, "id")}, ${q(
            database,
            "candidate_credential_ref",
          )} FROM ${q(database, jobTable)} WHERE (${q(
            database,
            "run_state",
          )} = 'queued' OR (${q(database, "run_state")} = 'running' AND ${q(
            database,
            "lease_expires_at",
          )} <= ${p(database, 1)})) ORDER BY ${q(database, "updated_at")} ASC, ${q(
            database,
            "id",
          )} ASC LIMIT ${p(database, 2)};`,
          tableName: jobTable,
        });
        const observed = result.rows[0];
        if (!observed) return [];
        const jobId = UuidSchema.parse(stringColumn(observed, "id"));
        const candidateRef = normalizeCandidateRef(
          stringColumn(observed, "candidate_credential_ref"),
        );
        const observedJob = await getJob(database, transaction, jobId, false);
        if (!observedJob) return [];
        if (!(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, observedJob))) {
          return [];
        }
        const lifecycle = await lifecycleOperations.getByRef(
          database,
          transaction,
          candidateRef,
          true,
        );
        const current = await getJob(database, transaction, jobId, true);
        if (!current || current.candidateCredentialRef !== candidateRef) return [];
        const eligible =
          current.runState === "queued" ||
          (current.runState === "running" &&
            Boolean(current.leaseExpiresAt && current.leaseExpiresAt <= input.now));
        if (!eligible) return [];
        if (!lifecycle || !candidateLifecycleMatchesJob(lifecycle, current)) {
          await persistJob(
            database,
            transaction,
            current,
            terminalJob(current, input.now, "failed", {
              errorCode: "CANDIDATE_LIFECYCLE_MISSING",
              errorMessage: "Credential candidate lifecycle reservation is missing or mismatched",
            }),
          );
          return [];
        }
        if (lifecycle.state !== "candidate" && lifecycle.state !== "active") {
          await persistJob(
            database,
            transaction,
            current,
            terminalJob(current, input.now, "failed", {
              errorCode: "CANDIDATE_LIFECYCLE_NOT_WRITABLE",
              errorMessage: "Credential candidate lifecycle is no longer writable",
            }),
          );
          return [];
        }
        const claimed = await persistJob(database, transaction, current, {
          ...current,
          completedAt: undefined,
          heartbeatAt: input.now,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
          leaseExpiresAt: input.leaseExpiresAt,
          leaseToken: UuidSchema.parse(generateLeaseToken()),
          retryCount: current.retryCount + (current.runState === "running" ? 1 : 0),
          rowVersion: current.rowVersion + 1,
          runState: "running",
          updatedAt: input.now,
          workerId: input.workerId,
        });
        return [
          {
            ...claimed,
            candidateLifecycleState: lifecycle.state,
          },
        ];
      });
    },

    complete: async (rawFence) => {
      return (
        await activateCandidateTransition({
          database,
          credentialFingerprinter,
          generateCandidateCredentialRef,
          generateLifecycleId,
          input: rawFence,
        })
      ).job;
    },

    discover: async (rawInput) => {
      const input = normalizeDiscovery(rawInput, maxDiscoveryBatchSize);
      return database.transaction(async (transaction) => {
        const params: DatabaseQueryValue[] = [];
        const after = input.afterSourceId
          ? `${qualifiedDatabaseIdentifier(database, "src", "id")} > ${pushParam(
              database,
              params,
              input.afterSourceId,
            )} AND `
          : "";
        const limit = pushParam(database, params, input.limit);
        const credentialsObjectPredicate =
          database.dialect === "postgres"
            ? `jsonb_typeof(${qualifiedDatabaseIdentifier(
                database,
                "src",
                "metadata",
              )} -> 'credentials') = 'object'`
            : `JSON_TYPE(JSON_EXTRACT(${qualifiedDatabaseIdentifier(
                database,
                "src",
                "metadata",
              )}, '$.credentials')) = 'OBJECT'`;
        const result = await transaction.execute({
          maxRows: input.limit,
          operation: "select",
          params,
          sql: `SELECT ${qualifiedDatabaseIdentifier(database, "src", "id")} AS ${q(
            database,
            "source_id",
          )}, ${qualifiedDatabaseIdentifier(
            database,
            "src",
            "knowledge_space_id",
          )} AS ${q(database, "knowledge_space_id")}, ${qualifiedDatabaseIdentifier(
            database,
            "src",
            "version",
          )} AS ${q(database, "source_version")}, ${qualifiedDatabaseIdentifier(
            database,
            "src",
            "metadata",
          )} AS ${q(database, "metadata")}, ${qualifiedDatabaseIdentifier(
            database,
            "space",
            "tenant_id",
          )} AS ${q(database, "tenant_id")} FROM ${q(
            database,
            sourceTable,
          )} src INNER JOIN ${q(database, spaceTable)} space ON ${qualifiedDatabaseIdentifier(
            database,
            "space",
            "id",
          )} = ${qualifiedDatabaseIdentifier(
            database,
            "src",
            "knowledge_space_id",
          )} WHERE ${after}${qualifiedDatabaseIdentifier(
            database,
            "src",
            "credential_ref",
          )} IS NULL AND ${credentialsObjectPredicate} AND NOT EXISTS (SELECT 1 FROM ${q(
            database,
            jobTable,
          )} job WHERE ${qualifiedDatabaseIdentifier(
            database,
            "job",
            "tenant_id",
          )} = ${qualifiedDatabaseIdentifier(
            database,
            "space",
            "tenant_id",
          )} AND ${qualifiedDatabaseIdentifier(
            database,
            "job",
            "knowledge_space_id",
          )} = ${qualifiedDatabaseIdentifier(
            database,
            "src",
            "knowledge_space_id",
          )} AND ${qualifiedDatabaseIdentifier(
            database,
            "job",
            "source_id",
          )} = ${qualifiedDatabaseIdentifier(
            database,
            "src",
            "id",
          )}) ORDER BY ${qualifiedDatabaseIdentifier(database, "src", "id")} ASC LIMIT ${limit};`,
          tableName: sourceTable,
        });

        let created = 0;
        for (const row of result.rows) {
          const metadata = jsonObjectColumn(row, "metadata");
          const credentials = readLegacyCredentials(metadata);
          if (!credentials) {
            continue;
          }
          const candidateCredentialRef = normalizeCandidateRef(generateCandidateCredentialRef());
          const jobId = UuidSchema.parse(generateId());
          const knowledgeSpaceId = UuidSchema.parse(stringColumn(row, "knowledge_space_id"));
          const sourceId = UuidSchema.parse(stringColumn(row, "source_id"));
          const sourceVersion = positiveVersion(numberColumn(row, "source_version"));
          const tenantId = TenantIdSchema.parse(stringColumn(row, "tenant_id"));
          if (
            !(await lockKnowledgeSpaceForDeletionAdmission(database, transaction, {
              knowledgeSpaceId,
              tenantId,
            }))
          ) {
            continue;
          }
          const inserted = await insertJob(database, transaction, {
            candidateCredentialRef,
            id: jobId,
            knowledgeSpaceId,
            now: input.now,
            secretFingerprint: normalizeFingerprint(
              credentialFingerprinter({ credentials, knowledgeSpaceId, sourceId, tenantId }),
            ),
            sourceId,
            sourceVersion,
            tenantId,
          });
          if (inserted) {
            await lifecycleOperations.insert(
              database,
              transaction,
              lifecycleOperations.createRef({
                createdAt: input.now,
                credentialRef: candidateCredentialRef,
                deleteAttempts: 0,
                id: jobId,
                knowledgeSpaceId,
                operationId: jobId,
                purpose: "backfill",
                recoverAfter: input.now,
                rowVersion: 0,
                sourceId,
                sourceVersion,
                state: "candidate",
                tenantId,
                updatedAt: input.now,
              }),
            );
            created += 1;
          }
        }
        const last = result.rows.at(-1);
        return {
          created,
          ...(last ? { nextSourceId: UuidSchema.parse(stringColumn(last, "source_id")) } : {}),
          scanned: result.rows.length,
        };
      });
    },

    fail: async (rawInput) => {
      return (
        await abandonCandidateTransition({
          database,
          credentialFingerprinter,
          generateCandidateCredentialRef,
          generateLifecycleId,
          input: { ...rawInput, terminalState: "failed" },
        })
      ).job;
    },

    get: ({ jobId }) => getJob(database, database, UuidSchema.parse(jobId), false),

    heartbeat: async (rawInput) => {
      const fence = normalizeFence(rawInput);
      const leaseExpiresAt = DateTimeSchema.parse(rawInput.leaseExpiresAt);
      const workerId = requiredString(rawInput.workerId, "workerId", 255);
      if (leaseExpiresAt <= fence.now) {
        throw new Error("Source credential backfill leaseExpiresAt must be after now");
      }
      const candidateRef = await candidateRefForFence(database, fence);
      const observedJob = await requireObservedJob(database, fence.jobId);
      return database.transaction(async (transaction) => {
        await requireBackfillWriteAdmission(database, transaction, observedJob);
        const lifecycle = await lifecycleOperations.getByRef(
          database,
          transaction,
          candidateRef,
          true,
        );
        const current = await requireFencedJob(database, transaction, fence);
        requireWritableCandidateLifecycle(lifecycle, current, candidateRef);
        if (current.workerId !== workerId) {
          throw new SourceCredentialBackfillTransitionError(
            "Source credential backfill heartbeat worker does not own the lease",
          );
        }
        const renewed = await persistJob(database, transaction, current, {
          ...current,
          heartbeatAt: fence.now,
          leaseExpiresAt,
          rowVersion: current.rowVersion + 1,
          updatedAt: fence.now,
        });
        return {
          ...renewed,
          candidateLifecycleState: lifecycle?.state as "active" | "candidate",
        };
      });
    },

    refresh: async (rawInput) => {
      return (
        await refreshCandidateTransition({
          database,
          credentialFingerprinter,
          generateCandidateCredentialRef,
          generateLifecycleId,
          input: rawInput,
        })
      ).job;
    },

    refreshCandidate: (input) =>
      refreshCandidateTransition({
        database,
        credentialFingerprinter,
        generateCandidateCredentialRef,
        generateLifecycleId,
        input,
      }),

    release: async (rawFence) => {
      const fence = normalizeFence(rawFence);
      const candidateRef = await candidateRefForFence(database, fence);
      const observedJob = await requireObservedJob(database, fence.jobId);
      return database.transaction(async (transaction) => {
        await requireBackfillWriteAdmission(database, transaction, observedJob);
        const lifecycle = await lifecycleOperations.getByRef(
          database,
          transaction,
          candidateRef,
          true,
        );
        const current = await requireFencedJob(database, transaction, fence);
        requireWritableCandidateLifecycle(lifecycle, current, candidateRef);
        return persistJob(database, transaction, current, {
          ...withoutLease(current),
          retryCount: current.retryCount + 1,
          rowVersion: current.rowVersion + 1,
          runState: "queued",
          updatedAt: fence.now,
        });
      });
    },

    retryableFailure: async (rawInput) => {
      const fence = normalizeFence(rawInput);
      const errorCode = requiredString(rawInput.errorCode, "errorCode", 64);
      const errorMessage = requiredString(rawInput.errorMessage, "errorMessage", 16_384);
      const candidateRef = await candidateRefForFence(database, fence);
      const observedJob = await requireObservedJob(database, fence.jobId);
      return database.transaction(async (transaction) => {
        await requireBackfillWriteAdmission(database, transaction, observedJob);
        const lifecycle = await lifecycleOperations.getByRef(
          database,
          transaction,
          candidateRef,
          true,
        );
        const current = await requireFencedJob(database, transaction, fence);
        requireWritableCandidateLifecycle(lifecycle, current, candidateRef);
        return persistJob(database, transaction, current, {
          ...withoutLease(current),
          completedAt: undefined,
          lastErrorCode: errorCode,
          lastErrorMessage: errorMessage,
          retryCount: current.retryCount + 1,
          rowVersion: current.rowVersion + 1,
          runState: "queued",
          updatedAt: fence.now,
        });
      });
    },

    retry: (input) =>
      retryFailedCandidate({
        database,
        credentialFingerprinter,
        generateCandidateCredentialRef,
        generateLifecycleId,
        input,
      }),
  };
  return api;
}

async function activateCandidateTransition(input: {
  readonly database: DatabaseAdapter;
  readonly credentialFingerprinter: SourceCredentialFingerprinter;
  readonly generateCandidateCredentialRef: () => string;
  readonly generateLifecycleId: () => string;
  readonly input: SourceCredentialBackfillFence;
}): Promise<SourceCredentialBackfillTransitionResult> {
  const fence = normalizeFence(input.input);
  const candidateRef = await candidateRefForFence(input.database, fence);
  const observedJob = await requireObservedJob(input.database, fence.jobId);
  return input.database.transaction(async (transaction) => {
    await requireBackfillWriteAdmission(input.database, transaction, observedJob);
    const context = await lockCandidateContext(input.database, transaction, fence, candidateRef);
    if (context.job.candidateCredentialRef !== candidateRef) {
      if (context.lifecycle.state === "retired" && context.job.runState === "queued") {
        return { job: context.job, outcome: "refreshed" };
      }
      throw staleCandidateFence();
    }
    const source = await lifecycleOperations.getSource(
      input.database,
      transaction,
      context.job.sourceId,
      context.job.knowledgeSpaceId,
      context.job.tenantId,
      true,
    );
    const terminal = terminalTransitionResult(context, source);
    if (terminal) return terminal;
    assertJobFence(context.job, fence);
    if (context.lifecycle.state !== "candidate" && context.lifecycle.state !== "active") {
      throw staleCandidateFence();
    }
    if (
      context.lifecycle.state === "active" &&
      source?.credentialRef !== context.lifecycle.credentialRef
    ) {
      return abandonLockedCandidate(
        input.database,
        transaction,
        context,
        fence.now,
        "succeeded",
        undefined,
        source,
      );
    }
    const legacyCredentials = source ? readLegacyCredentials(source.metadata) : undefined;
    if (!source || (source.credentialRef && source.credentialRef !== candidateRef)) {
      return abandonLockedCandidate(
        input.database,
        transaction,
        context,
        fence.now,
        "succeeded",
        undefined,
        source,
      );
    }
    if (source.credentialRef === candidateRef) {
      let activeSource = source;
      if (legacyCredentials) {
        activeSource = await scrubOrActivateSource(
          input.database,
          transaction,
          source,
          candidateRef,
          fence.now,
        );
      }
      const lifecycle = await activateLifecycle(
        input.database,
        transaction,
        context.lifecycle,
        activeSource.version,
        fence.now,
      );
      const job = await persistJob(
        input.database,
        transaction,
        context.job,
        terminalJob(context.job, fence.now, "succeeded"),
      );
      return { job: withLifecycleState(job, lifecycle), outcome: "already_active" };
    }
    if (!legacyCredentials) {
      return abandonLockedCandidate(
        input.database,
        transaction,
        context,
        fence.now,
        "succeeded",
        undefined,
        source,
      );
    }
    const fingerprint = normalizeFingerprint(
      input.credentialFingerprinter({
        credentials: legacyCredentials,
        knowledgeSpaceId: context.job.knowledgeSpaceId,
        sourceId: context.job.sourceId,
        tenantId: context.job.tenantId,
      }),
    );
    if (
      source.version !== context.job.sourceVersion ||
      fingerprint !== context.job.secretFingerprint
    ) {
      return refreshLockedCandidate({
        context,
        database: input.database,
        generateCandidateCredentialRef: input.generateCandidateCredentialRef,
        generateLifecycleId: input.generateLifecycleId,
        now: fence.now,
        secretFingerprint: fingerprint,
        sourceVersion: source.version,
        transaction,
      });
    }
    const activeSource = await scrubOrActivateSource(
      input.database,
      transaction,
      source,
      candidateRef,
      fence.now,
    );
    const lifecycle = await activateLifecycle(
      input.database,
      transaction,
      context.lifecycle,
      activeSource.version,
      fence.now,
    );
    const job = await persistJob(
      input.database,
      transaction,
      context.job,
      terminalJob(context.job, fence.now, "succeeded"),
    );
    return { job: withLifecycleState(job, lifecycle), outcome: "activated" };
  });
}

async function refreshCandidateTransition(input: {
  readonly database: DatabaseAdapter;
  readonly credentialFingerprinter: SourceCredentialFingerprinter;
  readonly generateCandidateCredentialRef: () => string;
  readonly generateLifecycleId: () => string;
  readonly input: SourceCredentialBackfillFence & {
    readonly secretFingerprint: string;
    readonly sourceVersion: number;
  };
}): Promise<SourceCredentialBackfillTransitionResult> {
  const fence = normalizeFence(input.input);
  normalizeFingerprint(input.input.secretFingerprint);
  positiveVersion(input.input.sourceVersion);
  const candidateRef = await candidateRefForFence(input.database, fence);
  const observedJob = await requireObservedJob(input.database, fence.jobId);
  return input.database.transaction(async (transaction) => {
    await requireBackfillWriteAdmission(input.database, transaction, observedJob);
    const context = await lockCandidateContext(input.database, transaction, fence, candidateRef);
    if (context.job.candidateCredentialRef !== candidateRef) {
      if (context.lifecycle.state === "retired" && context.job.runState === "queued") {
        return { job: context.job, outcome: "refreshed" };
      }
      throw staleCandidateFence();
    }
    const source = await lifecycleOperations.getSource(
      input.database,
      transaction,
      context.job.sourceId,
      context.job.knowledgeSpaceId,
      context.job.tenantId,
      true,
    );
    const terminal = terminalTransitionResult(context, source);
    if (terminal) return terminal;
    assertJobFence(context.job, fence);
    const legacyCredentials = source ? readLegacyCredentials(source.metadata) : undefined;
    if (!source || (source.credentialRef && source.credentialRef !== candidateRef)) {
      return abandonLockedCandidate(
        input.database,
        transaction,
        context,
        fence.now,
        "succeeded",
        undefined,
        source,
      );
    }
    if (source.credentialRef === candidateRef) {
      const lifecycle = await activateLifecycle(
        input.database,
        transaction,
        context.lifecycle,
        source.version,
        fence.now,
      );
      const job = await persistJob(
        input.database,
        transaction,
        context.job,
        terminalJob(context.job, fence.now, "succeeded"),
      );
      return { job: withLifecycleState(job, lifecycle), outcome: "already_active" };
    }
    if (!legacyCredentials) {
      return abandonLockedCandidate(
        input.database,
        transaction,
        context,
        fence.now,
        "succeeded",
        undefined,
        source,
      );
    }
    return refreshLockedCandidate({
      context,
      database: input.database,
      generateCandidateCredentialRef: input.generateCandidateCredentialRef,
      generateLifecycleId: input.generateLifecycleId,
      now: fence.now,
      secretFingerprint: normalizeFingerprint(
        input.credentialFingerprinter({
          credentials: legacyCredentials,
          knowledgeSpaceId: context.job.knowledgeSpaceId,
          sourceId: context.job.sourceId,
          tenantId: context.job.tenantId,
        }),
      ),
      sourceVersion: source.version,
      transaction,
    });
  });
}

async function abandonCandidateTransition(input: {
  readonly database: DatabaseAdapter;
  readonly credentialFingerprinter: SourceCredentialFingerprinter;
  readonly generateCandidateCredentialRef: () => string;
  readonly generateLifecycleId: () => string;
  readonly input: SourceCredentialBackfillFence & {
    readonly errorCode?: string | undefined;
    readonly errorMessage?: string | undefined;
    readonly terminalState: "failed" | "succeeded";
  };
}): Promise<SourceCredentialBackfillTransitionResult> {
  const fence = normalizeFence(input.input);
  const candidateRef = await candidateRefForFence(input.database, fence);
  const observedJob = await requireObservedJob(input.database, fence.jobId);
  const error =
    input.input.terminalState === "failed"
      ? {
          errorCode: requiredString(
            input.input.errorCode ?? "SOURCE_CREDENTIAL_BACKFILL_FAILED",
            "errorCode",
            64,
          ),
          errorMessage: requiredString(
            input.input.errorMessage ?? "Source credential backfill failed",
            "errorMessage",
            16_384,
          ),
        }
      : undefined;
  return input.database.transaction(async (transaction) => {
    await requireBackfillWriteAdmission(input.database, transaction, observedJob);
    const context = await lockCandidateContext(input.database, transaction, fence, candidateRef);
    if (context.job.candidateCredentialRef !== candidateRef) throw staleCandidateFence();
    const source = await lifecycleOperations.getSource(
      input.database,
      transaction,
      context.job.sourceId,
      context.job.knowledgeSpaceId,
      context.job.tenantId,
      true,
    );
    const terminal = terminalTransitionResult(context, source);
    if (terminal) return terminal;
    assertJobFence(context.job, fence);
    const legacyCredentials = source ? readLegacyCredentials(source.metadata) : undefined;
    if (
      input.input.terminalState === "succeeded" &&
      source &&
      !source.credentialRef &&
      legacyCredentials
    ) {
      return refreshLockedCandidate({
        context,
        database: input.database,
        generateCandidateCredentialRef: input.generateCandidateCredentialRef,
        generateLifecycleId: input.generateLifecycleId,
        now: fence.now,
        secretFingerprint: normalizeFingerprint(
          input.credentialFingerprinter({
            credentials: legacyCredentials,
            knowledgeSpaceId: context.job.knowledgeSpaceId,
            sourceId: context.job.sourceId,
            tenantId: context.job.tenantId,
          }),
        ),
        sourceVersion: source.version,
        transaction,
      });
    }
    return abandonLockedCandidate(
      input.database,
      transaction,
      context,
      fence.now,
      input.input.terminalState,
      error,
      source,
    );
  });
}

interface LockedCandidateContext {
  readonly job: SourceCredentialBackfillJob;
  readonly lifecycle: SourceSecretLifecycleRef;
}

async function lockCandidateContext(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  fence: SourceCredentialBackfillFence,
  candidateRef: string,
): Promise<LockedCandidateContext> {
  const lifecycle = await lifecycleOperations.getByRef(database, transaction, candidateRef, true);
  if (!lifecycle) throw staleCandidateFence();
  const job = await getJob(database, transaction, fence.jobId, true);
  if (!job || !candidateLifecycleScopeMatchesJob(lifecycle, job)) throw staleCandidateFence();
  return { job, lifecycle };
}

function terminalTransitionResult(
  context: LockedCandidateContext,
  source: Source | null,
): SourceCredentialBackfillTransitionResult | null {
  if (context.job.runState !== "succeeded" && context.job.runState !== "failed") return null;
  if (
    context.lifecycle.state === "active" &&
    source?.credentialRef === context.lifecycle.credentialRef
  ) {
    return {
      job: withLifecycleState(context.job, context.lifecycle),
      outcome: "already_active",
    };
  }
  if (
    (context.lifecycle.state === "retired" ||
      context.lifecycle.state === "deleting" ||
      context.lifecycle.state === "deleted") &&
    source?.credentialRef !== context.lifecycle.credentialRef
  ) {
    return { job: context.job, outcome: "abandoned" };
  }
  throw staleCandidateFence();
}

async function refreshLockedCandidate(input: {
  readonly context: LockedCandidateContext;
  readonly database: DatabaseAdapter;
  readonly generateCandidateCredentialRef: () => string;
  readonly generateLifecycleId: () => string;
  readonly now: string;
  readonly secretFingerprint: string;
  readonly sourceVersion: number;
  readonly transaction: DatabaseExecutor;
}): Promise<SourceCredentialBackfillTransitionResult> {
  if (input.context.lifecycle.state !== "candidate") throw staleCandidateFence();
  const newCandidateRef = normalizeCandidateRef(input.generateCandidateCredentialRef());
  if (newCandidateRef === input.context.lifecycle.credentialRef) {
    throw new Error("Source credential backfill refresh must generate a new candidate ref");
  }
  const retired = await retireLifecycle(
    input.database,
    input.transaction,
    input.context.lifecycle,
    input.now,
  );
  const nextLifecycle = lifecycleOperations.createRef({
    createdAt: input.now,
    credentialRef: newCandidateRef,
    deleteAttempts: 0,
    id: UuidSchema.parse(input.generateLifecycleId()),
    knowledgeSpaceId: input.context.job.knowledgeSpaceId,
    operationId: input.context.job.id,
    purpose: "backfill",
    recoverAfter: input.now,
    rowVersion: 0,
    sourceId: input.context.job.sourceId,
    sourceVersion: input.sourceVersion,
    state: "candidate",
    tenantId: input.context.job.tenantId,
    updatedAt: input.now,
  });
  await lifecycleOperations.insert(input.database, input.transaction, nextLifecycle);
  const job = await persistJob(input.database, input.transaction, input.context.job, {
    ...withoutLease(input.context.job),
    candidateCredentialRef: newCandidateRef,
    completedAt: undefined,
    lastErrorCode: undefined,
    lastErrorMessage: undefined,
    retryCount: input.context.job.retryCount + 1,
    rowVersion: input.context.job.rowVersion + 1,
    runState: "queued",
    secretFingerprint: normalizeFingerprint(input.secretFingerprint),
    sourceVersion: positiveVersion(input.sourceVersion),
    updatedAt: input.now,
  });
  void retired;
  return { job: withLifecycleState(job, nextLifecycle), outcome: "refreshed" };
}

async function abandonLockedCandidate(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  context: LockedCandidateContext,
  now: string,
  terminalState: "failed" | "succeeded",
  error?: { readonly errorCode: string; readonly errorMessage: string },
  lockedSource?: Source | null,
): Promise<SourceCredentialBackfillTransitionResult> {
  const source =
    lockedSource === undefined
      ? await lifecycleOperations.getSource(
          database,
          transaction,
          context.job.sourceId,
          context.job.knowledgeSpaceId,
          context.job.tenantId,
          true,
        )
      : lockedSource;
  const lifecycle =
    source?.credentialRef === context.lifecycle.credentialRef
      ? await activateLifecycle(database, transaction, context.lifecycle, source.version, now)
      : await retireLifecycle(database, transaction, context.lifecycle, now);
  const job = await persistJob(
    database,
    transaction,
    context.job,
    terminalJob(context.job, now, terminalState, error),
  );
  return { job: withLifecycleState(job, lifecycle), outcome: "abandoned" };
}

async function activateLifecycle(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  lifecycle: SourceSecretLifecycleRef,
  sourceVersion: number,
  now: string,
): Promise<SourceSecretLifecycleRef> {
  if (lifecycle.state === "active") return lifecycle;
  if (lifecycle.state !== "candidate") throw staleCandidateFence();
  return lifecycleOperations.persist(database, transaction, lifecycle, {
    ...lifecycleOperations.clearLease(lifecycle),
    rowVersion: lifecycle.rowVersion + 1,
    sourceVersion,
    state: "active",
    updatedAt: now,
  });
}

async function retireLifecycle(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  lifecycle: SourceSecretLifecycleRef,
  now: string,
): Promise<SourceSecretLifecycleRef> {
  if (
    lifecycle.state === "retired" ||
    lifecycle.state === "deleting" ||
    lifecycle.state === "deleted"
  ) {
    return lifecycle;
  }
  if (lifecycle.state !== "candidate" && lifecycle.state !== "active") {
    throw staleCandidateFence();
  }
  return lifecycleOperations.persist(database, transaction, lifecycle, {
    ...lifecycleOperations.clearLease(lifecycle),
    nextDeleteAt: now,
    rowVersion: lifecycle.rowVersion + 1,
    state: "retired",
    updatedAt: now,
  });
}

async function scrubOrActivateSource(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  source: Source,
  candidateRef: string,
  now: string,
): Promise<Source> {
  const next: Source = {
    ...source,
    credentialRef: candidateRef,
    metadata: redactSourceMetadata(source.metadata),
    updatedAt: now,
    version: source.version + 1,
  };
  await lifecycleOperations.updateSourceCredential(database, transaction, source, next);
  return next;
}

function terminalJob(
  job: SourceCredentialBackfillJob,
  now: string,
  runState: "failed" | "succeeded",
  error?: { readonly errorCode: string; readonly errorMessage: string },
): SourceCredentialBackfillJob {
  return {
    ...withoutLease(job),
    completedAt: now,
    ...(error
      ? { lastErrorCode: error.errorCode, lastErrorMessage: error.errorMessage }
      : { lastErrorCode: undefined, lastErrorMessage: undefined }),
    rowVersion: job.rowVersion + 1,
    runState,
    updatedAt: now,
  };
}

function withLifecycleState(
  job: SourceCredentialBackfillJob,
  lifecycle: SourceSecretLifecycleRef,
): SourceCredentialBackfillJob {
  return lifecycle.state === "active" || lifecycle.state === "candidate"
    ? { ...job, candidateLifecycleState: lifecycle.state }
    : job;
}

async function candidateRefForFence(
  database: DatabaseAdapter,
  fence: SourceCredentialBackfillFence,
): Promise<string> {
  if (fence.candidateCredentialRef) return normalizeCandidateRef(fence.candidateCredentialRef);
  const observed = await getJob(database, database, fence.jobId, false);
  if (!observed) throw staleCandidateFence();
  return observed.candidateCredentialRef;
}

async function requireObservedJob(
  database: DatabaseAdapter,
  jobId: string,
): Promise<SourceCredentialBackfillJob> {
  const observed = await getJob(database, database, jobId, false);
  if (!observed) throw staleCandidateFence();
  return observed;
}

async function requireBackfillWriteAdmission(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: { readonly knowledgeSpaceId: string; readonly tenantId: string },
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, input))) {
    throw new SourceCredentialBackfillTransitionError(
      "Source credential backfill rejected while knowledge-space deletion is active",
    );
  }
}

function candidateLifecycleScopeMatchesJob(
  lifecycle: SourceSecretLifecycleRef,
  job: SourceCredentialBackfillJob,
): boolean {
  return (
    lifecycle.operationId === job.id &&
    lifecycle.purpose === "backfill" &&
    lifecycle.tenantId === job.tenantId &&
    lifecycle.knowledgeSpaceId === job.knowledgeSpaceId &&
    lifecycle.sourceId === job.sourceId
  );
}

function candidateLifecycleMatchesJob(
  lifecycle: SourceSecretLifecycleRef,
  job: SourceCredentialBackfillJob,
): boolean {
  return (
    lifecycle.credentialRef === job.candidateCredentialRef &&
    candidateLifecycleScopeMatchesJob(lifecycle, job) &&
    (lifecycle.state !== "candidate" || lifecycle.sourceVersion === job.sourceVersion)
  );
}

function requireWritableCandidateLifecycle(
  lifecycle: SourceSecretLifecycleRef | null,
  job: SourceCredentialBackfillJob,
  candidateRef: string,
): asserts lifecycle is SourceSecretLifecycleRef & { readonly state: "active" | "candidate" } {
  if (
    !lifecycle ||
    !candidateLifecycleMatchesJob(lifecycle, job) ||
    lifecycle.credentialRef !== candidateRef ||
    (lifecycle.state !== "candidate" && lifecycle.state !== "active")
  ) {
    throw staleCandidateFence();
  }
}

function assertJobFence(
  current: SourceCredentialBackfillJob,
  fence: SourceCredentialBackfillFence,
): void {
  if (
    current.runState !== "running" ||
    current.rowVersion !== fence.expectedRowVersion ||
    current.leaseToken !== fence.leaseToken ||
    !current.leaseExpiresAt ||
    current.leaseExpiresAt <= fence.now
  ) {
    throw new SourceCredentialBackfillTransitionError(
      "Source credential backfill worker fence is stale or expired",
    );
  }
}

function staleCandidateFence(): SourceCredentialBackfillTransitionError {
  return new SourceCredentialBackfillTransitionError(
    "Source credential backfill candidate fence is stale or inconsistent",
  );
}

async function retryFailedCandidate(input: {
  readonly database: DatabaseAdapter;
  readonly credentialFingerprinter: SourceCredentialFingerprinter;
  readonly generateCandidateCredentialRef: () => string;
  readonly generateLifecycleId: () => string;
  readonly input: { readonly jobId: string; readonly now: string };
}): Promise<SourceCredentialBackfillJob | null> {
  const jobId = UuidSchema.parse(input.input.jobId);
  const now = DateTimeSchema.parse(input.input.now);
  const observed = await getJob(input.database, input.database, jobId, false);
  if (!observed) return null;
  return input.database.transaction(async (transaction) => {
    await requireBackfillWriteAdmission(input.database, transaction, observed);
    const lifecycle = await lifecycleOperations.getByRef(
      input.database,
      transaction,
      observed.candidateCredentialRef,
      true,
    );
    if (!lifecycle) throw staleCandidateFence();
    const current = await getJob(input.database, transaction, jobId, true);
    if (!current) return null;
    if (current.runState !== "failed") {
      throw new SourceCredentialBackfillTransitionError(
        "Only a failed source credential backfill can be retried",
      );
    }
    if (
      current.candidateCredentialRef !== observed.candidateCredentialRef ||
      !candidateLifecycleScopeMatchesJob(lifecycle, current)
    ) {
      throw staleCandidateFence();
    }
    const source = await lifecycleOperations.getSource(
      input.database,
      transaction,
      current.sourceId,
      current.knowledgeSpaceId,
      current.tenantId,
      true,
    );
    const legacyCredentials = source ? readLegacyCredentials(source.metadata) : undefined;
    if (!source || source.credentialRef || !legacyCredentials) {
      const stableLifecycle =
        source?.credentialRef === lifecycle.credentialRef
          ? await activateLifecycle(input.database, transaction, lifecycle, source.version, now)
          : await retireLifecycle(input.database, transaction, lifecycle, now);
      const succeeded = await persistJob(
        input.database,
        transaction,
        current,
        terminalJob(current, now, "succeeded"),
      );
      return withLifecycleState(succeeded, stableLifecycle);
    }
    const candidateCredentialRef = normalizeCandidateRef(input.generateCandidateCredentialRef());
    if (candidateCredentialRef === current.candidateCredentialRef) {
      throw new Error("Source credential backfill retry must generate a new candidate ref");
    }
    if (
      lifecycle.state !== "retired" &&
      lifecycle.state !== "deleting" &&
      lifecycle.state !== "deleted"
    ) {
      await retireLifecycle(input.database, transaction, lifecycle, now);
    }
    const nextLifecycle = lifecycleOperations.createRef({
      createdAt: now,
      credentialRef: candidateCredentialRef,
      deleteAttempts: 0,
      id: UuidSchema.parse(input.generateLifecycleId()),
      knowledgeSpaceId: current.knowledgeSpaceId,
      operationId: current.id,
      purpose: "backfill",
      recoverAfter: now,
      rowVersion: 0,
      sourceId: current.sourceId,
      sourceVersion: source.version,
      state: "candidate",
      tenantId: current.tenantId,
      updatedAt: now,
    });
    await lifecycleOperations.insert(input.database, transaction, nextLifecycle);
    const retried = await persistJob(input.database, transaction, current, {
      ...withoutLease(current),
      candidateCredentialRef,
      completedAt: undefined,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      retryCount: current.retryCount + 1,
      rowVersion: current.rowVersion + 1,
      runState: "queued",
      secretFingerprint: normalizeFingerprint(
        input.credentialFingerprinter({
          credentials: legacyCredentials,
          knowledgeSpaceId: current.knowledgeSpaceId,
          sourceId: current.sourceId,
          tenantId: current.tenantId,
        }),
      ),
      sourceVersion: source.version,
      updatedAt: now,
    });
    return withLifecycleState(retried, nextLifecycle);
  });
}

async function insertJob(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly candidateCredentialRef: string;
    readonly id: string;
    readonly knowledgeSpaceId: string;
    readonly now: string;
    readonly secretFingerprint: string;
    readonly sourceId: string;
    readonly sourceVersion: number;
    readonly tenantId: string;
  },
): Promise<boolean> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "source_id",
    "source_version",
    "candidate_credential_ref",
    "secret_fingerprint",
    "run_state",
    "retry_count",
    "row_version",
    "created_at",
    "updated_at",
  ];
  const params: DatabaseQueryValue[] = [
    input.id,
    input.tenantId,
    input.knowledgeSpaceId,
    input.sourceId,
    input.sourceVersion,
    input.candidateCredentialRef,
    input.secretFingerprint,
    "queued",
    0,
    0,
    input.now,
    input.now,
  ];
  const result = await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `${database.dialect === "tidb" ? "INSERT IGNORE" : "INSERT"} INTO ${q(
      database,
      jobTable,
    )} (${columns.map((column) => q(database, column)).join(", ")}) VALUES (${params
      .map((_, index) => p(database, index + 1))
      .join(", ")})${
      database.dialect === "postgres"
        ? ` ON CONFLICT (${q(database, "tenant_id")}, ${q(
            database,
            "knowledge_space_id",
          )}, ${q(database, "source_id")}) DO NOTHING`
        : ""
    };`,
    tableName: jobTable,
  });
  return result.rowsAffected > 0;
}

async function getJob(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  jobId: string,
  forUpdate: boolean,
): Promise<SourceCredentialBackfillJob | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [jobId],
    sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(database, "id")} = ${p(
      database,
      1,
    )} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: jobTable,
  });
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function requireFencedJob(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  fence: SourceCredentialBackfillFence,
): Promise<SourceCredentialBackfillJob> {
  const current = await getJob(database, executor, fence.jobId, true);
  if (
    !current ||
    current.runState !== "running" ||
    current.rowVersion !== fence.expectedRowVersion ||
    current.leaseToken !== fence.leaseToken ||
    !current.leaseExpiresAt ||
    current.leaseExpiresAt <= fence.now
  ) {
    throw new SourceCredentialBackfillTransitionError(
      "Source credential backfill worker fence is stale or expired",
    );
  }
  return current;
}

async function persistJob(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  current: SourceCredentialBackfillJob,
  next: SourceCredentialBackfillJob,
): Promise<SourceCredentialBackfillJob> {
  const columns = [
    "source_version",
    "candidate_credential_ref",
    "secret_fingerprint",
    "run_state",
    "worker_id",
    "lease_token",
    "lease_expires_at",
    "heartbeat_at",
    "retry_count",
    "row_version",
    "last_error_code",
    "last_error_message",
    "updated_at",
    "completed_at",
  ];
  const values: DatabaseQueryValue[] = [
    next.sourceVersion,
    next.candidateCredentialRef,
    next.secretFingerprint,
    next.runState,
    next.workerId ?? null,
    next.leaseToken ?? null,
    next.leaseExpiresAt ?? null,
    next.heartbeatAt ?? null,
    next.retryCount,
    next.rowVersion,
    next.lastErrorCode ?? null,
    next.lastErrorMessage ?? null,
    next.updatedAt,
    next.completedAt ?? null,
  ];
  const params: DatabaseQueryValue[] = [...values, current.id, current.rowVersion];
  const result = await executor.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q(database, jobTable)} SET ${columns
      .map((column, index) => `${q(database, column)} = ${p(database, index + 1)}`)
      .join(", ")} WHERE ${q(database, "id")} = ${p(database, columns.length + 1)} AND ${q(
      database,
      "row_version",
    )} = ${p(database, columns.length + 2)};`,
    tableName: jobTable,
  });
  if (result.rowsAffected !== 1) {
    throw new SourceCredentialBackfillTransitionError(
      "Source credential backfill row-version fence was lost",
    );
  }
  return mapJob(jobToRow(next));
}

function mapJob(row: DatabaseRow): SourceCredentialBackfillJob {
  const runState = stringColumn(row, "run_state");
  if (!SourceCredentialBackfillRunStates.includes(runState as SourceCredentialBackfillRunState)) {
    throw new Error(`Invalid source credential backfill run state: ${runState}`);
  }
  const job: SourceCredentialBackfillJob = {
    candidateCredentialRef: normalizeCandidateRef(stringColumn(row, "candidate_credential_ref")),
    createdAt: DateTimeSchema.parse(stringColumn(row, "created_at")),
    id: UuidSchema.parse(stringColumn(row, "id")),
    knowledgeSpaceId: UuidSchema.parse(stringColumn(row, "knowledge_space_id")),
    retryCount: nonnegativeInteger(numberColumn(row, "retry_count"), "retryCount"),
    rowVersion: nonnegativeInteger(numberColumn(row, "row_version"), "rowVersion"),
    runState: runState as SourceCredentialBackfillRunState,
    secretFingerprint: normalizeFingerprint(stringColumn(row, "secret_fingerprint")),
    sourceId: UuidSchema.parse(stringColumn(row, "source_id")),
    sourceVersion: positiveVersion(numberColumn(row, "source_version")),
    tenantId: TenantIdSchema.parse(stringColumn(row, "tenant_id")),
    updatedAt: DateTimeSchema.parse(stringColumn(row, "updated_at")),
    ...optionalDate(row, "completed_at", "completedAt"),
    ...optionalDate(row, "heartbeat_at", "heartbeatAt"),
    ...optionalText(row, "last_error_code", "lastErrorCode"),
    ...optionalText(row, "last_error_message", "lastErrorMessage"),
    ...optionalDate(row, "lease_expires_at", "leaseExpiresAt"),
    ...optionalText(row, "lease_token", "leaseToken"),
    ...optionalText(row, "worker_id", "workerId"),
  };
  validateJobState(job);
  return job;
}

function jobToRow(job: SourceCredentialBackfillJob): DatabaseRow {
  return {
    candidate_credential_ref: job.candidateCredentialRef,
    completed_at: job.completedAt ?? null,
    created_at: job.createdAt,
    heartbeat_at: job.heartbeatAt ?? null,
    id: job.id,
    knowledge_space_id: job.knowledgeSpaceId,
    last_error_code: job.lastErrorCode ?? null,
    last_error_message: job.lastErrorMessage ?? null,
    lease_expires_at: job.leaseExpiresAt ?? null,
    lease_token: job.leaseToken ?? null,
    retry_count: job.retryCount,
    row_version: job.rowVersion,
    run_state: job.runState,
    secret_fingerprint: job.secretFingerprint,
    source_id: job.sourceId,
    source_version: job.sourceVersion,
    tenant_id: job.tenantId,
    updated_at: job.updatedAt,
    worker_id: job.workerId ?? null,
  };
}

function validateJobState(job: SourceCredentialBackfillJob): void {
  const hasLease = Boolean(job.workerId && job.leaseToken && job.leaseExpiresAt && job.heartbeatAt);
  if ((job.runState === "running") !== hasLease) {
    throw new Error("Source credential backfill lease fields do not match run state");
  }
  const terminal = job.runState === "succeeded" || job.runState === "failed";
  if (terminal !== Boolean(job.completedAt)) {
    throw new Error("Source credential backfill completion fields do not match run state");
  }
}

function withoutLease(job: SourceCredentialBackfillJob): SourceCredentialBackfillJob {
  const {
    heartbeatAt: _heartbeatAt,
    leaseExpiresAt: _leaseExpiresAt,
    leaseToken: _leaseToken,
    workerId: _workerId,
    ...rest
  } = job;
  return rest;
}

function normalizeClaim(
  input: {
    readonly leaseExpiresAt: string;
    readonly limit: number;
    readonly now: string;
    readonly workerId: string;
  },
  maximum: number,
) {
  const now = DateTimeSchema.parse(input.now);
  const leaseExpiresAt = DateTimeSchema.parse(input.leaseExpiresAt);
  const limit = boundedLimit(input.limit, maximum);
  if (leaseExpiresAt <= now) {
    throw new Error("Source credential backfill leaseExpiresAt must be after now");
  }
  return {
    leaseExpiresAt,
    limit,
    now,
    workerId: requiredString(input.workerId, "workerId", 255),
  };
}

function normalizeDiscovery(
  input: DiscoverSourceCredentialBackfillsInput,
  maximum: number,
): DiscoverSourceCredentialBackfillsInput {
  return {
    ...(input.afterSourceId ? { afterSourceId: UuidSchema.parse(input.afterSourceId) } : {}),
    limit: boundedLimit(input.limit, maximum),
    now: DateTimeSchema.parse(input.now),
  };
}

function normalizeFence(input: SourceCredentialBackfillFence): SourceCredentialBackfillFence {
  return {
    ...(input.candidateCredentialRef
      ? { candidateCredentialRef: normalizeCandidateRef(input.candidateCredentialRef) }
      : {}),
    expectedRowVersion: nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion"),
    jobId: UuidSchema.parse(input.jobId),
    leaseToken: UuidSchema.parse(input.leaseToken),
    now: DateTimeSchema.parse(input.now),
  };
}

function normalizeCandidateRef(value: string): string {
  const ref = value.trim();
  if (
    !/^source-secret:v1:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      ref,
    )
  ) {
    throw new Error("Source credential backfill candidate ref must use source-secret:v1:<uuid>");
  }
  return ref;
}

function normalizeFingerprint(value: string): string {
  const fingerprint = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) {
    throw new Error("Source credential backfill fingerprint must be a SHA-256 hex digest");
  }
  return fingerprint;
}

function optionalDate<K extends string>(row: DatabaseRow, column: string, key: K) {
  const value = optionalStringColumn(row, column);
  return value ? ({ [key]: DateTimeSchema.parse(value) } as Record<K, string>) : {};
}

function optionalText<K extends string>(row: DatabaseRow, column: string, key: K) {
  const value = optionalStringColumn(row, column);
  return value ? ({ [key]: value } as Record<K, string>) : {};
}

function positiveVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Source credential backfill sourceVersion must be a positive safe integer");
  }
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Source credential backfill ${name} must be a non-negative safe integer`);
  }
  return value;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Source credential backfill ${name} must be a positive safe integer`);
  }
}

function boundedLimit(value: number, maximum: number): number {
  positiveInteger(value, "limit");
  if (value > maximum) {
    throw new Error(`Source credential backfill limit must not exceed ${maximum}`);
  }
  return value;
}

function requiredString(value: string, name: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`Source credential backfill ${name} must contain 1-${maximum} characters`);
  }
  return normalized;
}

function pushParam(
  database: DatabaseAdapter,
  params: DatabaseQueryValue[],
  value: DatabaseQueryValue,
): string {
  params.push(value);
  return p(database, params.length);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}
