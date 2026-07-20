import { randomUUID } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  TenantIdSchema,
  UuidSchema,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { lockKnowledgeSpaceForDeletionAdmission } from "./knowledge-space-deletion-admission";
import { TIDB_FTS_TOKENIZER_VERSION, createTidbFtsDocumentPostings } from "./tidb-fts-postings";

export const TidbFtsPostingBackfillRunStates = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type TidbFtsPostingBackfillRunState = (typeof TidbFtsPostingBackfillRunStates)[number];

export interface TidbFtsPostingBackfillScope {
  readonly knowledgeSpaceId: string;
  readonly tenantId: string;
}

export interface TidbFtsPostingBackfill extends TidbFtsPostingBackfillScope {
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly cursorProjectionId?: string | undefined;
  readonly heartbeatAt?: string | undefined;
  readonly id: string;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly retryCount: number;
  readonly rowVersion: number;
  readonly runState: TidbFtsPostingBackfillRunState;
  readonly scannedProjections: number;
  readonly tokenizerVersion: string;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
  readonly writtenPostings: number;
}

export interface TidbFtsPostingBackfillFence {
  readonly expectedRowVersion: number;
  readonly jobId: string;
  readonly leaseToken: string;
  readonly now: string;
}

export interface ClaimTidbFtsPostingBackfillsInput {
  readonly leaseExpiresAt: string;
  readonly limit: number;
  readonly now: string;
  readonly workerId: string;
}

export interface DiscoverTidbFtsPostingBackfillsInput {
  readonly afterKnowledgeSpaceId?: string | undefined;
  readonly limit: number;
  readonly now: string;
}

export interface DiscoverTidbFtsPostingBackfillsResult {
  readonly created: number;
  readonly nextKnowledgeSpaceId?: string | undefined;
  readonly scanned: number;
}

export interface ProcessTidbFtsPostingBackfillResult {
  readonly completed: boolean;
  readonly job: TidbFtsPostingBackfill;
  readonly projectionId?: string | undefined;
}

/** Fast/Deep call this before any hybrid leg is allowed to degrade independently. */
export interface TidbFtsPostingReadinessGate {
  assertReady(input: TidbFtsPostingBackfillScope): Promise<void>;
}

export interface TidbFtsPostingBackfillRepository extends TidbFtsPostingReadinessGate {
  claim(input: ClaimTidbFtsPostingBackfillsInput): Promise<readonly TidbFtsPostingBackfill[]>;
  discover(
    input: DiscoverTidbFtsPostingBackfillsInput,
  ): Promise<DiscoverTidbFtsPostingBackfillsResult>;
  ensure(
    input: TidbFtsPostingBackfillScope & { readonly now: string },
  ): Promise<TidbFtsPostingBackfill | null>;
  fail(
    input: TidbFtsPostingBackfillFence & {
      readonly errorCode: string;
      readonly errorMessage: string;
    },
  ): Promise<TidbFtsPostingBackfill | null>;
  get(input: TidbFtsPostingBackfillScope): Promise<TidbFtsPostingBackfill | null>;
  heartbeat(
    input: TidbFtsPostingBackfillFence & {
      readonly leaseExpiresAt: string;
      readonly workerId: string;
    },
  ): Promise<TidbFtsPostingBackfill | null>;
  processNext(input: TidbFtsPostingBackfillFence): Promise<ProcessTidbFtsPostingBackfillResult>;
  release(input: TidbFtsPostingBackfillFence): Promise<TidbFtsPostingBackfill | null>;
  retry(
    input: TidbFtsPostingBackfillScope & { readonly now: string },
  ): Promise<TidbFtsPostingBackfill | null>;
}

export interface DatabaseTidbFtsPostingBackfillRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: (() => string) | undefined;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly generatePostingId?: (() => string) | undefined;
  readonly maxClaimBatchSize: number;
  readonly maxDiscoveryBatchSize: number;
}

export class TidbFtsPostingBackfillTransitionError extends Error {
  readonly code = "TIDB_FTS_BACKFILL_TRANSITION_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "TidbFtsPostingBackfillTransitionError";
  }
}

export class TidbFtsPostingBackfillNotReadyError extends Error {
  readonly code = "TIDB_FTS_POSTINGS_NOT_READY";
  readonly runState: TidbFtsPostingBackfillRunState | "unregistered";

  constructor(runState: TidbFtsPostingBackfillRunState | "unregistered") {
    super(
      runState === "failed"
        ? "TiDB lexical postings failed historical repair; retry the knowledge-space backfill"
        : "TiDB lexical postings are not ready for Fast or Deep retrieval",
    );
    this.name = "TidbFtsPostingBackfillNotReadyError";
    this.runState = runState;
  }
}

const jobTable = "tidb_fts_posting_backfills";
const projectionTable = "index_projections";
const postingTable = "index_projection_fts_postings";
const spaceTable = "knowledge_spaces";

/**
 * Durable expand/backfill/contract repository for TiDB's application-maintained lexical index.
 * Discovery is keyset bounded, each worker mutation is lease-token + row-version fenced, and a
 * projection cursor is persisted only in the same transaction as its exact posting replacement.
 */
export function createDatabaseTidbFtsPostingBackfillRepository({
  database,
  generateId = randomUUID,
  generateLeaseToken = randomUUID,
  generatePostingId = randomUUID,
  maxClaimBatchSize,
  maxDiscoveryBatchSize,
}: DatabaseTidbFtsPostingBackfillRepositoryOptions): TidbFtsPostingBackfillRepository {
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");
  positiveInteger(maxDiscoveryBatchSize, "maxDiscoveryBatchSize");

  return {
    assertReady: async (rawScope) => {
      const scope = normalizeScope(rawScope);
      const existing = await getByScope(database, database, scope, false);
      if (existing) {
        if (existing.runState !== "succeeded") {
          throw new TidbFtsPostingBackfillNotReadyError(existing.runState);
        }
        return;
      }

      const status = await inspectSpaceReadiness(database, database, scope);
      if (!status.exists) {
        throw new TidbFtsPostingBackfillTransitionError("Knowledge space was not found");
      }
      if (status.missingProjectionId) {
        throw new TidbFtsPostingBackfillNotReadyError("unregistered");
      }
    },

    claim: async (rawInput) => {
      const input = normalizeClaim(rawInput, maxClaimBatchSize);
      return database.transaction(async (transaction) => {
        const result = await transaction.execute({
          maxRows: input.limit,
          operation: "select",
          params: [input.now, input.limit],
          sql: `SELECT * FROM ${q(database, jobTable)} WHERE (${q(
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
          tableName: jobTable,
        });
        const claimed: TidbFtsPostingBackfill[] = [];
        for (const row of result.rows) {
          const current = mapJob(row);
          const leaseToken = nonzeroUuid(generateLeaseToken(), "leaseToken");
          claimed.push(
            await persistJob(database, transaction, current, {
              ...current,
              completedAt: undefined,
              heartbeatAt: input.now,
              lastErrorCode: undefined,
              lastErrorMessage: undefined,
              leaseExpiresAt: input.leaseExpiresAt,
              leaseToken,
              rowVersion: current.rowVersion + 1,
              runState: "running",
              updatedAt: input.now,
              workerId: input.workerId,
            }),
          );
        }
        return claimed;
      });
    },

    discover: async (rawInput) => {
      const input = normalizeDiscovery(rawInput, maxDiscoveryBatchSize);
      return database.transaction(async (transaction) => {
        const params: DatabaseQueryValue[] = [];
        const afterClause = input.afterKnowledgeSpaceId
          ? `${qualified(database, "space", "id")} > ${pushParam(
              database,
              params,
              input.afterKnowledgeSpaceId,
            )} AND `
          : "";
        const tokenizer = pushParam(database, params, TIDB_FTS_TOKENIZER_VERSION);
        const tokenizerForJob = pushParam(database, params, TIDB_FTS_TOKENIZER_VERSION);
        const limit = pushParam(database, params, input.limit);
        const result = await transaction.execute({
          maxRows: input.limit,
          operation: "select",
          params,
          sql: `SELECT ${qualified(database, "space", "tenant_id")} AS ${q(
            database,
            "tenant_id",
          )}, ${qualified(database, "space", "id")} AS ${q(
            database,
            "knowledge_space_id",
          )} FROM ${q(database, spaceTable)} space WHERE ${afterClause}${qualified(database, "space", "lifecycle_state")} = 'active' AND ${qualified(database, "space", "deletion_job_id")} IS NULL AND EXISTS (SELECT 1 FROM ${q(
            database,
            projectionTable,
          )} projection WHERE ${qualified(database, "projection", "knowledge_space_id")} = ${qualified(
            database,
            "space",
            "id",
          )} AND ${qualified(database, "projection", "type")} = 'fts' AND ${qualified(
            database,
            "projection",
            "status",
          )} IN ('building', 'ready') AND NOT EXISTS (SELECT 1 FROM ${q(
            database,
            postingTable,
          )} posting WHERE ${qualified(database, "posting", "projection_id")} = ${qualified(
            database,
            "projection",
            "id",
          )} AND ${qualified(database, "posting", "tokenizer_version")} = ${tokenizer})) AND NOT EXISTS (SELECT 1 FROM ${q(
            database,
            jobTable,
          )} job WHERE ${qualified(database, "job", "tenant_id")} = ${qualified(
            database,
            "space",
            "tenant_id",
          )} AND ${qualified(database, "job", "knowledge_space_id")} = ${qualified(
            database,
            "space",
            "id",
          )} AND ${qualified(database, "job", "tokenizer_version")} = ${tokenizerForJob}) ORDER BY ${qualified(
            database,
            "space",
            "id",
          )} ASC LIMIT ${limit};`,
          tableName: spaceTable,
        });

        let created = 0;
        for (const row of result.rows) {
          const scope = normalizeScope({
            knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
            tenantId: stringColumn(row, "tenant_id"),
          });
          const inserted = await insertJob(
            database,
            transaction,
            scope,
            input.now,
            nonzeroUuid(generateId(), "id"),
          );
          if (inserted) {
            created += 1;
          }
        }
        const last = result.rows.at(-1);
        return {
          created,
          ...(last
            ? {
                nextKnowledgeSpaceId: UuidSchema.parse(stringColumn(last, "knowledge_space_id")),
              }
            : {}),
          scanned: result.rows.length,
        };
      });
    },

    ensure: async (rawInput) => {
      const input = normalizeScopeWithNow(rawInput);
      return database.transaction(async (transaction) => {
        await lockSpace(database, transaction, input);
        const existing = await getByScope(database, transaction, input, true);
        if (existing) {
          return existing;
        }
        const readiness = await inspectSpaceReadiness(database, transaction, input);
        if (!readiness.exists) {
          throw new TidbFtsPostingBackfillTransitionError("Knowledge space was not found");
        }
        if (!readiness.missingProjectionId) {
          return null;
        }
        await insertJob(database, transaction, input, input.now, nonzeroUuid(generateId(), "id"));
        return requireByScope(database, transaction, input, false);
      });
    },

    fail: async (rawInput) => {
      const fence = normalizeFence(rawInput);
      const errorCode = requiredString(rawInput.errorCode, "errorCode", 64);
      const errorMessage = requiredString(rawInput.errorMessage, "errorMessage", 16_384);
      return database.transaction(async (transaction) => {
        const current = await requireFencedJob(database, transaction, fence);
        return persistJob(database, transaction, current, {
          ...withoutLease(current),
          completedAt: fence.now,
          lastErrorCode: errorCode,
          lastErrorMessage: errorMessage,
          rowVersion: current.rowVersion + 1,
          runState: "failed",
          updatedAt: fence.now,
        });
      });
    },

    get: (scope) => getByScope(database, database, normalizeScope(scope), false),

    heartbeat: async (rawInput) => {
      const input = normalizeHeartbeat(rawInput);
      return database.transaction(async (transaction) => {
        const preview = await getById(database, transaction, input.jobId, false);
        if (!preview) return null;
        await lockSpace(database, transaction, preview);
        const current = await requireFencedJob(database, transaction, input);
        if (current.workerId !== input.workerId) {
          throw new TidbFtsPostingBackfillTransitionError(
            "TiDB FTS backfill heartbeat worker does not own the lease",
          );
        }
        return persistJob(database, transaction, current, {
          ...current,
          heartbeatAt: input.now,
          leaseExpiresAt: input.leaseExpiresAt,
          rowVersion: current.rowVersion + 1,
          updatedAt: input.now,
        });
      });
    },

    processNext: async (rawFence) => {
      const fence = normalizeFence(rawFence);
      return database.transaction(async (transaction) => {
        const preview = await getById(database, transaction, fence.jobId, false);
        if (!preview) {
          throw new TidbFtsPostingBackfillTransitionError("TiDB FTS backfill was not found");
        }
        await lockSpace(database, transaction, preview);
        const current = await requireFencedJob(database, transaction, fence);
        const next = await loadNextProjection(database, transaction, current);
        if (next) {
          const written = await replaceProjectionPostings(
            database,
            transaction,
            next,
            generatePostingId,
          );
          const job = await persistJob(database, transaction, current, {
            ...current,
            cursorProjectionId: next.id,
            heartbeatAt: fence.now,
            rowVersion: current.rowVersion + 1,
            scannedProjections: current.scannedProjections + 1,
            updatedAt: fence.now,
            writtenPostings: current.writtenPostings + written,
          });
          return { completed: false, job, projectionId: next.id };
        }

        // A projection created behind the UUID cursor is already covered by the dual writer. This
        // closure also repairs any historical/manual gap before the readiness latch can open.
        const missing = await loadMissingProjection(database, transaction, current);
        if (missing) {
          const written = await replaceProjectionPostings(
            database,
            transaction,
            missing,
            generatePostingId,
          );
          const job = await persistJob(database, transaction, current, {
            ...current,
            heartbeatAt: fence.now,
            rowVersion: current.rowVersion + 1,
            scannedProjections: current.scannedProjections + 1,
            updatedAt: fence.now,
            writtenPostings: current.writtenPostings + written,
          });
          return { completed: false, job, projectionId: missing.id };
        }

        const job = await persistJob(database, transaction, current, {
          ...withoutLease(current),
          completedAt: fence.now,
          rowVersion: current.rowVersion + 1,
          runState: "succeeded",
          updatedAt: fence.now,
        });
        return { completed: true, job };
      });
    },

    release: async (rawFence) => {
      const fence = normalizeFence(rawFence);
      return database.transaction(async (transaction) => {
        const preview = await getById(database, transaction, fence.jobId, false);
        if (!preview) return null;
        await lockSpace(database, transaction, preview);
        const current = await requireFencedJob(database, transaction, fence);
        return persistJob(database, transaction, current, {
          ...withoutLease(current),
          rowVersion: current.rowVersion + 1,
          runState: "queued",
          updatedAt: fence.now,
        });
      });
    },

    retry: async (rawInput) => {
      const input = normalizeScopeWithNow(rawInput);
      return database.transaction(async (transaction) => {
        const current = await getByScope(database, transaction, input, true);
        if (!current) {
          return null;
        }
        if (current.runState !== "failed") {
          throw new TidbFtsPostingBackfillTransitionError(
            "Only a failed TiDB FTS posting backfill can be retried",
          );
        }
        return persistJob(database, transaction, current, {
          ...withoutLease(current),
          completedAt: undefined,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
          retryCount: current.retryCount + 1,
          rowVersion: current.rowVersion + 1,
          runState: "queued",
          updatedAt: input.now,
        });
      });
    },
  };
}

interface StoredProjection {
  readonly ftsDocument: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
}

async function replaceProjectionPostings(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  projection: StoredProjection,
  generatePostingId: () => string,
): Promise<number> {
  const postings = createTidbFtsDocumentPostings(projection.ftsDocument);
  await transaction.execute({
    maxRows: 0,
    operation: "delete",
    params: [projection.id, TIDB_FTS_TOKENIZER_VERSION],
    sql: `DELETE FROM ${q(database, postingTable)} WHERE ${q(
      database,
      "projection_id",
    )} = ${p(database, 1)} AND ${q(database, "tokenizer_version")} = ${p(database, 2)};`,
    tableName: postingTable,
  });

  if (postings.length === 0) {
    return 0;
  }
  const columns = [
    "id",
    "knowledge_space_id",
    "projection_id",
    "tokenizer_version",
    "term_hash",
    "term",
    "term_frequency",
    "document_token_count",
  ];
  const params: DatabaseQueryValue[] = [];
  const values = postings.map((posting) => {
    const row: DatabaseQueryValue[] = [
      nonzeroUuid(generatePostingId(), "postingId"),
      projection.knowledgeSpaceId,
      projection.id,
      posting.tokenizerVersion,
      posting.termHash,
      posting.term,
      posting.termFrequency,
      posting.documentTokenCount,
    ];
    return `(${row.map((value) => pushParam(database, params, value)).join(", ")})`;
  });
  await transaction.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, postingTable)} (${columns
      .map((column) => q(database, column))
      .join(", ")}) VALUES ${values.join(", ")};`,
    tableName: postingTable,
  });
  return postings.length;
}

async function loadNextProjection(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  job: TidbFtsPostingBackfill,
): Promise<StoredProjection | null> {
  const params: DatabaseQueryValue[] = [job.knowledgeSpaceId];
  const cursorClause = job.cursorProjectionId
    ? ` AND ${q(database, "id")} > ${pushParam(database, params, job.cursorProjectionId)}`
    : "";
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params,
    sql: `SELECT ${q(database, "id")}, ${q(database, "knowledge_space_id")}, ${q(
      database,
      "fts_document",
    )} FROM ${q(database, projectionTable)} WHERE ${q(
      database,
      "knowledge_space_id",
    )} = ${p(database, 1)} AND ${q(
      database,
      "type",
    )} = 'fts' AND ${q(database, "status")} IN ('building', 'ready')${cursorClause} ORDER BY ${q(
      database,
      "id",
    )} ASC LIMIT 1 FOR UPDATE;`,
    tableName: projectionTable,
  });
  return result.rows[0] ? mapProjection(result.rows[0]) : null;
}

async function loadMissingProjection(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  job: TidbFtsPostingBackfill,
): Promise<StoredProjection | null> {
  const result = await transaction.execute({
    maxRows: 1,
    operation: "select",
    params: [job.knowledgeSpaceId, job.tokenizerVersion],
    sql: `SELECT ${qualified(database, "projection", "id")} AS ${q(
      database,
      "id",
    )}, ${qualified(database, "projection", "knowledge_space_id")} AS ${q(
      database,
      "knowledge_space_id",
    )}, ${qualified(database, "projection", "fts_document")} AS ${q(
      database,
      "fts_document",
    )} FROM ${q(database, projectionTable)} projection WHERE ${qualified(
      database,
      "projection",
      "knowledge_space_id",
    )} = ${p(database, 1)} AND ${qualified(database, "projection", "type")} = 'fts' AND ${qualified(
      database,
      "projection",
      "status",
    )} IN ('building', 'ready') AND NOT EXISTS (SELECT 1 FROM ${q(
      database,
      postingTable,
    )} posting WHERE ${qualified(database, "posting", "projection_id")} = ${qualified(
      database,
      "projection",
      "id",
    )} AND ${qualified(database, "posting", "tokenizer_version")} = ${p(
      database,
      2,
    )}) ORDER BY ${qualified(database, "projection", "id")} ASC LIMIT 1 FOR UPDATE;`,
    tableName: projectionTable,
  });
  return result.rows[0] ? mapProjection(result.rows[0]) : null;
}

function mapProjection(row: DatabaseRow): StoredProjection {
  const ftsDocument = optionalStringColumn(row, "fts_document");
  if (!ftsDocument) {
    throw new Error("Historical FTS projection has no normalized source document");
  }
  return {
    ftsDocument,
    id: UuidSchema.parse(stringColumn(row, "id")),
    knowledgeSpaceId: UuidSchema.parse(stringColumn(row, "knowledge_space_id")),
  };
}

async function inspectSpaceReadiness(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: TidbFtsPostingBackfillScope,
): Promise<{ readonly exists: boolean; readonly missingProjectionId?: string | undefined }> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    // The tokenizer placeholder occurs before the outer tenant/space predicates. Parameters stay
    // in textual order so TiDB's anonymous `?` binding cannot inherit PostgreSQL `$n` semantics.
    params: [TIDB_FTS_TOKENIZER_VERSION, scope.tenantId, scope.knowledgeSpaceId],
    sql: `SELECT ${qualified(database, "space", "id")} AS ${q(
      database,
      "knowledge_space_id",
    )}, (SELECT ${qualified(database, "projection", "id")} FROM ${q(
      database,
      projectionTable,
    )} projection WHERE ${qualified(database, "projection", "knowledge_space_id")} = ${qualified(
      database,
      "space",
      "id",
    )} AND ${qualified(database, "projection", "type")} = 'fts' AND ${qualified(
      database,
      "projection",
      "status",
    )} IN ('building', 'ready') AND NOT EXISTS (SELECT 1 FROM ${q(
      database,
      postingTable,
    )} posting WHERE ${qualified(database, "posting", "projection_id")} = ${qualified(
      database,
      "projection",
      "id",
    )} AND ${qualified(database, "posting", "tokenizer_version")} = ${p(
      database,
      1,
    )}) ORDER BY ${qualified(database, "projection", "id")} ASC LIMIT 1) AS ${q(
      database,
      "missing_projection_id",
    )} FROM ${q(database, spaceTable)} space WHERE ${qualified(
      database,
      "space",
      "tenant_id",
    )} = ${p(database, 2)} AND ${qualified(database, "space", "id")} = ${p(database, 3)} AND ${qualified(database, "space", "lifecycle_state")} = 'active' AND ${qualified(database, "space", "deletion_job_id")} IS NULL LIMIT 1;`,
    tableName: spaceTable,
  });
  const row = result.rows[0];
  if (!row) {
    return { exists: false };
  }
  const missingProjectionId = optionalStringColumn(row, "missing_projection_id");
  return {
    exists: true,
    ...(missingProjectionId ? { missingProjectionId: UuidSchema.parse(missingProjectionId) } : {}),
  };
}

async function insertJob(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  scope: TidbFtsPostingBackfillScope,
  now: string,
  id: string,
): Promise<boolean> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "tokenizer_version",
    "run_state",
    "scanned_projections",
    "written_postings",
    "retry_count",
    "row_version",
    "created_at",
    "updated_at",
  ];
  const params: DatabaseQueryValue[] = [
    id,
    scope.tenantId,
    scope.knowledgeSpaceId,
    TIDB_FTS_TOKENIZER_VERSION,
    "queued",
    0,
    0,
    0,
    0,
    now,
    now,
  ];
  const conflict =
    database.dialect === "postgres"
      ? ` ON CONFLICT (${q(database, "tenant_id")}, ${q(
          database,
          "knowledge_space_id",
        )}, ${q(database, "tokenizer_version")}) DO NOTHING`
      : ` ON DUPLICATE KEY UPDATE ${q(database, "id")} = ${q(database, "id")}`;
  const result = await transaction.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, jobTable)} (${columns
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${params
      .map((_value, index) => p(database, index + 1))
      .join(", ")})${conflict};`,
    tableName: jobTable,
  });
  return result.rowsAffected === 1;
}

async function lockSpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: TidbFtsPostingBackfillScope,
): Promise<void> {
  if (!(await lockKnowledgeSpaceForDeletionAdmission(database, executor, scope))) {
    throw new TidbFtsPostingBackfillTransitionError("Knowledge space was not found");
  }
}

async function requireFencedJob(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  fence: TidbFtsPostingBackfillFence,
): Promise<TidbFtsPostingBackfill> {
  const current = await getById(database, transaction, fence.jobId, true);
  if (
    !current ||
    current.runState !== "running" ||
    current.leaseToken !== fence.leaseToken ||
    current.rowVersion !== fence.expectedRowVersion ||
    !current.leaseExpiresAt ||
    current.leaseExpiresAt <= fence.now
  ) {
    throw new TidbFtsPostingBackfillTransitionError(
      "TiDB FTS backfill worker lost its lease or row-version fence",
    );
  }
  return current;
}

async function getById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  rawId: string,
  lock: boolean,
): Promise<TidbFtsPostingBackfill | null> {
  const id = UuidSchema.parse(rawId);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [id],
    sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(database, "id")} = ${p(
      database,
      1,
    )} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: jobTable,
  });
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function getByScope(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: TidbFtsPostingBackfillScope,
  lock: boolean,
): Promise<TidbFtsPostingBackfill | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [scope.tenantId, scope.knowledgeSpaceId, TIDB_FTS_TOKENIZER_VERSION],
    sql: `SELECT * FROM ${q(database, jobTable)} WHERE ${q(
      database,
      "tenant_id",
    )} = ${p(database, 1)} AND ${q(database, "knowledge_space_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "tokenizer_version")} = ${p(
      database,
      3,
    )} LIMIT 1${lock ? " FOR UPDATE" : ""};`,
    tableName: jobTable,
  });
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function requireByScope(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: TidbFtsPostingBackfillScope,
  lock: boolean,
): Promise<TidbFtsPostingBackfill> {
  const job = await getByScope(database, executor, scope, lock);
  if (!job) {
    throw new TidbFtsPostingBackfillTransitionError(
      "TiDB FTS backfill could not be loaded after creation",
    );
  }
  return job;
}

async function persistJob(
  database: DatabaseAdapter,
  transaction: DatabaseExecutor,
  previous: TidbFtsPostingBackfill,
  next: TidbFtsPostingBackfill,
): Promise<TidbFtsPostingBackfill> {
  const columns = [
    "run_state",
    "cursor_projection_id",
    "scanned_projections",
    "written_postings",
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
  const params: DatabaseQueryValue[] = [
    next.runState,
    next.cursorProjectionId ?? null,
    next.scannedProjections,
    next.writtenPostings,
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
    previous.id,
    previous.rowVersion,
  ];
  const result = await transaction.execute({
    maxRows: 0,
    operation: "update",
    params,
    sql: `UPDATE ${q(database, jobTable)} SET ${columns
      .map((column, index) => `${q(database, column)} = ${p(database, index + 1)}`)
      .join(", ")} WHERE ${q(database, "id")} = ${p(database, 15)} AND ${q(
      database,
      "row_version",
    )} = ${p(database, 16)};`,
    tableName: jobTable,
  });
  if (result.rowsAffected !== 1) {
    throw new TidbFtsPostingBackfillTransitionError(
      "TiDB FTS backfill row changed before transition",
    );
  }
  return next;
}

function mapJob(row: DatabaseRow): TidbFtsPostingBackfill {
  const runState = stringColumn(row, "run_state");
  if (!TidbFtsPostingBackfillRunStates.includes(runState as TidbFtsPostingBackfillRunState)) {
    throw new Error(`Invalid TiDB FTS backfill runState=${runState}`);
  }
  const completedAt = optionalStringColumn(row, "completed_at");
  const cursorProjectionId = optionalStringColumn(row, "cursor_projection_id");
  const heartbeatAt = optionalStringColumn(row, "heartbeat_at");
  const lastErrorCode = optionalStringColumn(row, "last_error_code");
  const lastErrorMessage = optionalStringColumn(row, "last_error_message");
  const leaseExpiresAt = optionalStringColumn(row, "lease_expires_at");
  const leaseToken = optionalStringColumn(row, "lease_token");
  const workerId = optionalStringColumn(row, "worker_id");
  return {
    ...(completedAt ? { completedAt: DateTimeSchema.parse(completedAt) } : {}),
    createdAt: DateTimeSchema.parse(stringColumn(row, "created_at")),
    ...(cursorProjectionId ? { cursorProjectionId: UuidSchema.parse(cursorProjectionId) } : {}),
    ...(heartbeatAt ? { heartbeatAt: DateTimeSchema.parse(heartbeatAt) } : {}),
    id: UuidSchema.parse(stringColumn(row, "id")),
    knowledgeSpaceId: UuidSchema.parse(stringColumn(row, "knowledge_space_id")),
    ...(lastErrorCode ? { lastErrorCode } : {}),
    ...(lastErrorMessage ? { lastErrorMessage } : {}),
    ...(leaseExpiresAt ? { leaseExpiresAt: DateTimeSchema.parse(leaseExpiresAt) } : {}),
    ...(leaseToken ? { leaseToken: UuidSchema.parse(leaseToken) } : {}),
    retryCount: nonnegativeInteger(numberColumn(row, "retry_count"), "retryCount"),
    rowVersion: nonnegativeInteger(numberColumn(row, "row_version"), "rowVersion"),
    runState: runState as TidbFtsPostingBackfillRunState,
    scannedProjections: nonnegativeInteger(
      numberColumn(row, "scanned_projections"),
      "scannedProjections",
    ),
    tenantId: TenantIdSchema.parse(stringColumn(row, "tenant_id")),
    tokenizerVersion: requiredString(
      stringColumn(row, "tokenizer_version"),
      "tokenizerVersion",
      64,
    ),
    updatedAt: DateTimeSchema.parse(stringColumn(row, "updated_at")),
    ...(workerId ? { workerId } : {}),
    writtenPostings: nonnegativeInteger(numberColumn(row, "written_postings"), "writtenPostings"),
  };
}

function withoutLease(job: TidbFtsPostingBackfill): TidbFtsPostingBackfill {
  const {
    heartbeatAt: _heartbeatAt,
    leaseExpiresAt: _leaseExpiresAt,
    leaseToken: _leaseToken,
    workerId: _workerId,
    ...rest
  } = job;
  return rest;
}

function normalizeScope(input: TidbFtsPostingBackfillScope): TidbFtsPostingBackfillScope {
  return {
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    tenantId: TenantIdSchema.parse(input.tenantId),
  };
}

function normalizeScopeWithNow(input: TidbFtsPostingBackfillScope & { readonly now: string }) {
  return { ...normalizeScope(input), now: DateTimeSchema.parse(input.now) };
}

function normalizeFence(input: TidbFtsPostingBackfillFence): TidbFtsPostingBackfillFence {
  return {
    expectedRowVersion: nonnegativeInteger(input.expectedRowVersion, "expectedRowVersion"),
    jobId: UuidSchema.parse(input.jobId),
    leaseToken: nonzeroUuid(input.leaseToken, "leaseToken"),
    now: DateTimeSchema.parse(input.now),
  };
}

function normalizeHeartbeat(
  input: TidbFtsPostingBackfillFence & {
    readonly leaseExpiresAt: string;
    readonly workerId: string;
  },
) {
  const fence = normalizeFence(input);
  const leaseExpiresAt = DateTimeSchema.parse(input.leaseExpiresAt);
  if (leaseExpiresAt <= fence.now) {
    throw new Error("TiDB FTS backfill leaseExpiresAt must be after now");
  }
  return {
    ...fence,
    leaseExpiresAt,
    workerId: requiredString(input.workerId, "workerId", 255),
  };
}

function normalizeClaim(input: ClaimTidbFtsPostingBackfillsInput, maxClaimBatchSize: number) {
  const now = DateTimeSchema.parse(input.now);
  const leaseExpiresAt = DateTimeSchema.parse(input.leaseExpiresAt);
  if (leaseExpiresAt <= now) {
    throw new Error("TiDB FTS backfill leaseExpiresAt must be after now");
  }
  const limit = positiveInteger(input.limit, "limit");
  if (limit > maxClaimBatchSize) {
    throw new Error(`TiDB FTS backfill claim limit exceeds maxClaimBatchSize=${maxClaimBatchSize}`);
  }
  return {
    leaseExpiresAt,
    limit,
    now,
    workerId: requiredString(input.workerId, "workerId", 255),
  };
}

function normalizeDiscovery(
  input: DiscoverTidbFtsPostingBackfillsInput,
  maxDiscoveryBatchSize: number,
) {
  const limit = positiveInteger(input.limit, "limit");
  if (limit > maxDiscoveryBatchSize) {
    throw new Error(
      `TiDB FTS backfill discovery limit exceeds maxDiscoveryBatchSize=${maxDiscoveryBatchSize}`,
    );
  }
  return {
    ...(input.afterKnowledgeSpaceId
      ? { afterKnowledgeSpaceId: UuidSchema.parse(input.afterKnowledgeSpaceId) }
      : {}),
    limit,
    now: DateTimeSchema.parse(input.now),
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`TiDB FTS backfill ${name} must be a positive safe integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`TiDB FTS backfill ${name} must be a non-negative safe integer`);
  }
  return value;
}

function requiredString(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`TiDB FTS backfill ${name} must contain 1-${max} characters`);
  }
  return normalized;
}

function nonzeroUuid(value: string, name: string): string {
  const parsed = UuidSchema.parse(value);
  if (parsed === "00000000-0000-0000-0000-000000000000") {
    throw new Error(`TiDB FTS backfill ${name} must not be the zero UUID`);
  }
  return parsed;
}

function q(database: Pick<DatabaseAdapter, "dialect">, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function qualified(
  database: Pick<DatabaseAdapter, "dialect">,
  alias: string,
  identifier: string,
): string {
  return `${alias}.${q(database, identifier)}`;
}

function p(database: Pick<DatabaseAdapter, "dialect">, position: number): string {
  return databasePlaceholder(database, position);
}

function pushParam(
  database: Pick<DatabaseAdapter, "dialect">,
  params: DatabaseQueryValue[],
  value: DatabaseQueryValue,
): string {
  params.push(value);
  return p(database, params.length);
}
