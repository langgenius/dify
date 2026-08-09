import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  type KnowledgeSpaceRetrievalProfile,
  KnowledgeSpaceRetrievalProfileSchema,
  PublicationGenerationIdSchema,
  UuidSchema,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { cloneJsonObject, jsonObjectColumn } from "./json-utils";

export const DocumentSemanticEnrichmentJobStates = [
  "queued",
  "running",
  "retry_wait",
  "succeeded",
  "failed",
  "superseded",
] as const;
export type DocumentSemanticEnrichmentJobState =
  (typeof DocumentSemanticEnrichmentJobStates)[number];
export type DocumentSemanticExtractionStage = "entity" | "relation";

export interface DocumentSemanticEnrichmentJob {
  readonly availableAt: string;
  readonly baseHeadRevision: number;
  readonly compilationAttemptId: string;
  readonly completedAt?: string | undefined;
  readonly createdAt: string;
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly executionAttempts: number;
  readonly heartbeatAt?: string | undefined;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly lastErrorCode?: string | undefined;
  readonly lastErrorMessage?: string | undefined;
  readonly leaseExpiresAt?: string | undefined;
  readonly leaseToken?: string | undefined;
  readonly maxExecutionAttempts: number;
  readonly parseArtifactId: string;
  readonly publicationGenerationId: string;
  readonly result: Readonly<Record<string, unknown>>;
  readonly retrievalProfile: KnowledgeSpaceRetrievalProfile;
  readonly rowVersion: number;
  readonly runState: DocumentSemanticEnrichmentJobState;
  readonly tenantId: string;
  readonly updatedAt: string;
  readonly workerId?: string | undefined;
}

export interface EnqueueDocumentSemanticEnrichmentInput {
  readonly availableAt: string;
  readonly baseHeadRevision: number;
  readonly compilationAttemptId: string;
  readonly createdAt: string;
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly maxExecutionAttempts: number;
  readonly parseArtifactId: string;
  readonly publicationGenerationId: string;
  readonly retrievalProfile: KnowledgeSpaceRetrievalProfile;
  readonly tenantId: string;
}

export interface DocumentSemanticEnrichmentLeaseInput {
  readonly id: string;
  readonly leaseToken: string;
  readonly now: string;
  readonly workerId: string;
}

export interface DocumentSemanticEnrichmentCheckpointScope {
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly knowledgeSpaceId: string;
  readonly publicationGenerationId: string;
  readonly tenantId: string;
}

export interface DocumentSemanticExtractionCheckpointKey {
  readonly inputFingerprint: string;
  readonly nodeId: string;
  readonly stage: DocumentSemanticExtractionStage;
}

export interface DocumentSemanticExtractionCheckpoint
  extends DocumentSemanticExtractionCheckpointKey {
  readonly result: Readonly<Record<string, unknown>>;
}

export interface DocumentSemanticEnrichmentRepository {
  claim(input: {
    readonly leaseExpiresAt: string;
    readonly limit: number;
    readonly now: string;
    readonly workerId: string;
  }): Promise<readonly DocumentSemanticEnrichmentJob[]>;
  enqueue(input: EnqueueDocumentSemanticEnrichmentInput): Promise<DocumentSemanticEnrichmentJob>;
  get(id: string): Promise<DocumentSemanticEnrichmentJob | null>;
  heartbeat(
    input: DocumentSemanticEnrichmentLeaseInput & { readonly leaseExpiresAt: string },
  ): Promise<DocumentSemanticEnrichmentJob | null>;
  release(
    input: DocumentSemanticEnrichmentLeaseInput & {
      readonly availableAt?: string | undefined;
      readonly errorCode?: string | undefined;
      readonly errorMessage?: string | undefined;
      readonly preserveExecutionAttempt?: boolean | undefined;
      readonly result?: Readonly<Record<string, unknown>> | undefined;
      readonly state: "failed" | "retry_wait" | "succeeded" | "superseded";
    },
  ): Promise<DocumentSemanticEnrichmentJob | null>;
}

export interface DocumentSemanticExtractionCheckpointRepository {
  getMany(input: {
    readonly keys: readonly DocumentSemanticExtractionCheckpointKey[];
    readonly scope: DocumentSemanticEnrichmentCheckpointScope;
  }): Promise<readonly DocumentSemanticExtractionCheckpoint[]>;
  putMany(input: {
    readonly checkpoints: readonly DocumentSemanticExtractionCheckpoint[];
    readonly scope: DocumentSemanticEnrichmentCheckpointScope;
  }): Promise<readonly DocumentSemanticExtractionCheckpoint[]>;
}

export function createInMemoryDocumentSemanticEnrichmentRepository(
  options: {
    readonly generateLeaseToken?: (() => string) | undefined;
  } = {},
): DocumentSemanticEnrichmentRepository {
  const jobs = new Map<string, DocumentSemanticEnrichmentJob>();
  const byGeneration = new Map<string, string>();
  const generateLeaseToken = options.generateLeaseToken ?? (() => crypto.randomUUID());

  return {
    enqueue: async (raw) => {
      const input = normalizeEnqueue(raw);
      const generationKey = `${input.tenantId}\u001f${input.knowledgeSpaceId}\u001f${input.publicationGenerationId}`;
      const existingId = byGeneration.get(generationKey);
      if (existingId) return cloneJob(requiredJob(jobs.get(existingId)));
      const job: DocumentSemanticEnrichmentJob = {
        ...input,
        availableAt: input.availableAt,
        executionAttempts: 0,
        result: {},
        rowVersion: 0,
        runState: "queued",
        updatedAt: input.createdAt,
      };
      jobs.set(job.id, cloneJob(job));
      byGeneration.set(generationKey, job.id);
      return cloneJob(job);
    },
    get: async (id) => {
      const job = jobs.get(UuidSchema.parse(id));
      return job ? cloneJob(job) : null;
    },
    claim: async ({ leaseExpiresAt, limit, now, workerId }) => {
      positiveInteger(limit, "claim limit");
      const timestamp = Date.parse(DateTimeSchema.parse(now));
      if (Date.parse(DateTimeSchema.parse(leaseExpiresAt)) <= timestamp) {
        throw new Error("Semantic enrichment lease must expire after now");
      }
      requiredString(workerId, "workerId", 255);
      const claimed: DocumentSemanticEnrichmentJob[] = [];
      for (const job of [...jobs.values()].sort(compareJobs)) {
        if (claimed.length >= limit) break;
        if (!isClaimable(job, timestamp)) continue;
        if (job.executionAttempts >= job.maxExecutionAttempts) continue;
        const next: DocumentSemanticEnrichmentJob = {
          ...job,
          executionAttempts: job.executionAttempts + 1,
          heartbeatAt: now,
          leaseExpiresAt,
          leaseToken: UuidSchema.parse(generateLeaseToken()),
          rowVersion: job.rowVersion + 1,
          runState: "running",
          updatedAt: now,
          workerId,
        };
        jobs.set(next.id, cloneJob(next));
        claimed.push(cloneJob(next));
      }
      return claimed;
    },
    heartbeat: async (input) => {
      const current = fencedInMemoryJob(jobs, input);
      if (!current) return null;
      const next = {
        ...current,
        heartbeatAt: DateTimeSchema.parse(input.now),
        leaseExpiresAt: DateTimeSchema.parse(input.leaseExpiresAt),
        rowVersion: current.rowVersion + 1,
        updatedAt: DateTimeSchema.parse(input.now),
      };
      jobs.set(next.id, cloneJob(next));
      return cloneJob(next);
    },
    release: async (input) => {
      const current = fencedInMemoryJob(jobs, input);
      if (!current) return null;
      const now = DateTimeSchema.parse(input.now);
      const terminal = input.state !== "retry_wait";
      const next: DocumentSemanticEnrichmentJob = {
        ...current,
        ...(terminal ? { completedAt: now } : {}),
        availableAt: DateTimeSchema.parse(input.availableAt ?? now),
        ...(input.errorCode ? { lastErrorCode: input.errorCode } : {}),
        ...(input.errorMessage ? { lastErrorMessage: input.errorMessage } : {}),
        heartbeatAt: undefined,
        leaseExpiresAt: undefined,
        leaseToken: undefined,
        result: cloneJsonObject(input.result ?? current.result),
        executionAttempts: input.preserveExecutionAttempt
          ? Math.max(0, current.executionAttempts - 1)
          : current.executionAttempts,
        rowVersion: current.rowVersion + 1,
        runState: input.state,
        updatedAt: now,
        workerId: undefined,
      };
      jobs.set(next.id, cloneJob(next));
      return cloneJob(next);
    },
  };
}

export function createInMemoryDocumentSemanticExtractionCheckpointRepository(): DocumentSemanticExtractionCheckpointRepository {
  const records = new Map<string, DocumentSemanticExtractionCheckpoint>();
  return {
    getMany: async ({ keys, scope }) =>
      normalizeCheckpointKeys(keys).flatMap((key) => {
        const stored = records.get(checkpointStorageKey(normalizeScope(scope), key));
        return stored ? [cloneCheckpoint(stored)] : [];
      }),
    putMany: async ({ checkpoints, scope }) =>
      checkpoints.map((checkpoint) => {
        const normalized = normalizeCheckpoint(checkpoint);
        const key = checkpointStorageKey(normalizeScope(scope), normalized);
        const existing = records.get(key);
        if (!existing) records.set(key, cloneCheckpoint(normalized));
        return cloneCheckpoint(existing ?? normalized);
      }),
  };
}

export function createDatabaseDocumentSemanticEnrichmentRepository(options: {
  readonly database: DatabaseAdapter;
  readonly generateLeaseToken?: (() => string) | undefined;
  readonly maxClaimBatchSize: number;
}): DocumentSemanticEnrichmentRepository {
  const { database, maxClaimBatchSize } = options;
  const generateLeaseToken = options.generateLeaseToken ?? (() => crypto.randomUUID());
  positiveInteger(maxClaimBatchSize, "maxClaimBatchSize");

  return {
    enqueue: async (raw) => {
      const input = normalizeEnqueue(raw);
      return database.transaction(async (tx) => {
        const q = (name: string) => quoteDatabaseIdentifier(database, name);
        const values: readonly DatabaseQueryValue[] = [
          input.id,
          input.compilationAttemptId,
          input.tenantId,
          input.knowledgeSpaceId,
          input.documentAssetId,
          input.documentVersion,
          input.parseArtifactId,
          input.publicationGenerationId,
          input.baseHeadRevision,
          JSON.stringify(input.retrievalProfile),
          input.maxExecutionAttempts,
          input.availableAt,
          JSON.stringify({}),
          input.createdAt,
        ];
        const insert = database.dialect === "tidb" ? "INSERT IGNORE" : "INSERT";
        const conflict =
          database.dialect === "postgres"
            ? ` ON CONFLICT (${q("tenant_id")}, ${q("knowledge_space_id")}, ${q("publication_generation_id")}) DO NOTHING`
            : "";
        await tx.execute({
          maxRows: 0,
          operation: "insert",
          params: values,
          sql: `${insert} INTO ${q(jobTable)} (${[
            "id",
            "compilation_attempt_id",
            "tenant_id",
            "knowledge_space_id",
            "document_asset_id",
            "document_version",
            "parse_artifact_id",
            "publication_generation_id",
            "base_head_revision",
            "retrieval_profile",
            "run_state",
            "execution_attempts",
            "max_execution_attempts",
            "available_at",
            "result",
            "row_version",
            "created_at",
            "updated_at",
          ]
            .map(q)
            .join(", ")}) VALUES (${values
            .slice(0, 9)
            .map((_, index) => databasePlaceholder(database, index + 1))
            .join(
              ", ",
            )}, ${jsonInsertPlaceholder(database, 10, "retrieval_profile")}, 'queued', 0, ${databasePlaceholder(database, 11)}, ${databasePlaceholder(database, 12)}, ${jsonInsertPlaceholder(database, 13, "result")}, 0, ${databasePlaceholder(database, 14)}, ${databasePlaceholder(database, 14)})${conflict};`,
          tableName: jobTable,
        });
        return requiredJob(
          await selectJobByGeneration(database, tx, {
            knowledgeSpaceId: input.knowledgeSpaceId,
            publicationGenerationId: input.publicationGenerationId,
            tenantId: input.tenantId,
          }),
        );
      });
    },
    get: (id) => selectJobById(database, database, UuidSchema.parse(id)),
    claim: async ({ leaseExpiresAt, limit, now, workerId }) => {
      positiveInteger(limit, "claim limit");
      if (limit > maxClaimBatchSize) throw new Error("Semantic enrichment claim exceeds limit");
      const normalizedNow = DateTimeSchema.parse(now);
      const normalizedExpiry = DateTimeSchema.parse(leaseExpiresAt);
      if (Date.parse(normalizedExpiry) <= Date.parse(normalizedNow)) {
        throw new Error("Semantic enrichment lease must expire after now");
      }
      const normalizedWorker = requiredString(workerId, "workerId", 255);
      return database.transaction(async (tx) => {
        const q = (name: string) => quoteDatabaseIdentifier(database, name);
        const p = (index: number) => databasePlaceholder(database, index);
        const selected = await tx.execute({
          maxRows: limit,
          operation: "select",
          params: [normalizedNow, limit],
          sql: `SELECT * FROM ${q(jobTable)} WHERE ${q("execution_attempts")} < ${q("max_execution_attempts")} AND ((${q("run_state")} = 'queued') OR (${q("run_state")} = 'retry_wait' AND ${q("available_at")} <= ${p(1)}) OR (${q("run_state")} = 'running' AND ${q("lease_expires_at")} <= ${p(1)})) ORDER BY ${q("updated_at")}, ${q("id")} LIMIT ${p(2)} FOR UPDATE${database.dialect === "postgres" ? " SKIP LOCKED" : ""};`,
          tableName: jobTable,
        });
        const claimed: DocumentSemanticEnrichmentJob[] = [];
        for (const row of selected.rows) {
          const current = mapJob(row);
          const leaseToken = UuidSchema.parse(generateLeaseToken());
          const updated = await tx.execute({
            maxRows: 0,
            operation: "update",
            params: [
              normalizedWorker,
              leaseToken,
              normalizedExpiry,
              normalizedNow,
              current.executionAttempts + 1,
              current.rowVersion + 1,
              current.id,
              current.rowVersion,
            ],
            sql: `UPDATE ${q(jobTable)} SET ${q("run_state")} = 'running', ${q("worker_id")} = ${p(1)}, ${q("lease_token")} = ${p(2)}, ${q("lease_expires_at")} = ${p(3)}, ${q("heartbeat_at")} = ${p(4)}, ${q("execution_attempts")} = ${p(5)}, ${q("row_version")} = ${p(6)}, ${q("updated_at")} = ${p(4)} WHERE ${q("id")} = ${p(7)} AND ${q("row_version")} = ${p(8)};`,
            tableName: jobTable,
          });
          if (updated.rowsAffected === 1) {
            claimed.push(requiredJob(await selectJobById(database, tx, current.id)));
          }
        }
        return claimed;
      });
    },
    heartbeat: (input) =>
      updateFencedDatabaseJob(database, {
        ...input,
        leaseExpiresAt: DateTimeSchema.parse(input.leaseExpiresAt),
        mode: "heartbeat",
      }),
    release: (input) => updateFencedDatabaseJob(database, { ...input, mode: "release" }),
  };
}

export function createDatabaseDocumentSemanticExtractionCheckpointRepository(options: {
  readonly database: DatabaseAdapter;
  readonly maxBatchSize: number;
  readonly now?: (() => string) | undefined;
}): DocumentSemanticExtractionCheckpointRepository {
  const { database, maxBatchSize, now = () => new Date().toISOString() } = options;
  positiveInteger(maxBatchSize, "checkpoint maxBatchSize");
  return {
    getMany: async ({ keys, scope }) => {
      if (keys.length > maxBatchSize) throw new Error("Semantic checkpoint batch exceeds limit");
      if (keys.length === 0) return [];
      return selectCheckpoints(
        database,
        database,
        normalizeScope(scope),
        normalizeCheckpointKeys(keys),
      );
    },
    putMany: async ({ checkpoints, scope }) => {
      if (checkpoints.length > maxBatchSize)
        throw new Error("Semantic checkpoint batch exceeds limit");
      if (checkpoints.length === 0) return [];
      const normalizedScope = normalizeScope(scope);
      const normalized = checkpoints.map(normalizeCheckpoint);
      return database.transaction(async (tx) => {
        await insertCheckpoints(
          database,
          tx,
          normalizedScope,
          normalized,
          DateTimeSchema.parse(now()),
        );
        const stored = await selectCheckpoints(database, tx, normalizedScope, normalized);
        const byKey = new Map(stored.map((item) => [checkpointKey(item), item] as const));
        return normalized.map((item) => requiredCheckpoint(byKey.get(checkpointKey(item))));
      });
    },
  };
}

const jobTable = "document_semantic_enrichment_jobs";
const checkpointTable = "document_semantic_extraction_checkpoints";

async function updateFencedDatabaseJob(
  database: DatabaseAdapter,
  input:
    | (DocumentSemanticEnrichmentLeaseInput & {
        readonly leaseExpiresAt: string;
        readonly mode: "heartbeat";
      })
    | (DocumentSemanticEnrichmentLeaseInput & {
        readonly availableAt?: string | undefined;
        readonly errorCode?: string | undefined;
        readonly errorMessage?: string | undefined;
        readonly mode: "release";
        readonly preserveExecutionAttempt?: boolean | undefined;
        readonly result?: Readonly<Record<string, unknown>> | undefined;
        readonly state: "failed" | "retry_wait" | "succeeded" | "superseded";
      }),
): Promise<DocumentSemanticEnrichmentJob | null> {
  return database.transaction(async (tx) => {
    const current = await selectJobById(database, tx, UuidSchema.parse(input.id), true);
    if (
      !current ||
      current.runState !== "running" ||
      current.leaseToken !== UuidSchema.parse(input.leaseToken) ||
      current.workerId !== requiredString(input.workerId, "workerId", 255)
    ) {
      return null;
    }
    const q = (name: string) => quoteDatabaseIdentifier(database, name);
    const p = (index: number) => databasePlaceholder(database, index);
    const now = DateTimeSchema.parse(input.now);
    if (input.mode === "heartbeat") {
      const updated = await tx.execute({
        maxRows: 0,
        operation: "update",
        params: [
          input.leaseExpiresAt,
          now,
          current.rowVersion + 1,
          current.id,
          current.rowVersion,
          input.leaseToken,
        ],
        sql: `UPDATE ${q(jobTable)} SET ${q("lease_expires_at")} = ${p(1)}, ${q("heartbeat_at")} = ${p(2)}, ${q("updated_at")} = ${p(2)}, ${q("row_version")} = ${p(3)} WHERE ${q("id")} = ${p(4)} AND ${q("row_version")} = ${p(5)} AND ${q("lease_token")} = ${p(6)};`,
        tableName: jobTable,
      });
      return updated.rowsAffected === 1 ? selectJobById(database, tx, current.id) : null;
    }
    const terminal = input.state !== "retry_wait";
    const params: DatabaseQueryValue[] = [
      input.state,
      DateTimeSchema.parse(input.availableAt ?? now),
      input.errorCode ?? null,
      input.errorMessage?.slice(0, 2_000) ?? null,
      JSON.stringify(input.result ?? current.result),
      terminal ? now : null,
      now,
      input.preserveExecutionAttempt
        ? Math.max(0, current.executionAttempts - 1)
        : current.executionAttempts,
      current.rowVersion + 1,
      current.id,
      current.rowVersion,
      input.leaseToken,
    ];
    const updated = await tx.execute({
      maxRows: 0,
      operation: "update",
      params,
      sql: `UPDATE ${q(jobTable)} SET ${q("run_state")} = ${p(1)}, ${q("available_at")} = ${p(2)}, ${q("last_error_code")} = ${p(3)}, ${q("last_error_message")} = ${p(4)}, ${q("result")} = ${jsonInsertPlaceholder(database, 5, "result")}, ${q("completed_at")} = ${p(6)}, ${q("updated_at")} = ${p(7)}, ${q("execution_attempts")} = ${p(8)}, ${q("row_version")} = ${p(9)}, ${q("worker_id")} = NULL, ${q("lease_token")} = NULL, ${q("lease_expires_at")} = NULL, ${q("heartbeat_at")} = NULL WHERE ${q("id")} = ${p(10)} AND ${q("row_version")} = ${p(11)} AND ${q("lease_token")} = ${p(12)};`,
      tableName: jobTable,
    });
    return updated.rowsAffected === 1 ? selectJobById(database, tx, current.id) : null;
  });
}

async function selectJobById(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  id: string,
  forUpdate = false,
): Promise<DocumentSemanticEnrichmentJob | null> {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [id],
    sql: `SELECT * FROM ${q(jobTable)} WHERE ${q("id")} = ${databasePlaceholder(database, 1)}${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: jobTable,
  });
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

async function selectJobByGeneration(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: {
    readonly knowledgeSpaceId: string;
    readonly publicationGenerationId: string;
    readonly tenantId: string;
  },
): Promise<DocumentSemanticEnrichmentJob | null> {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId, input.publicationGenerationId],
    sql: `SELECT * FROM ${q(jobTable)} WHERE ${q("tenant_id")} = ${databasePlaceholder(database, 1)} AND ${q("knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${q("publication_generation_id")} = ${databasePlaceholder(database, 3)};`,
    tableName: jobTable,
  });
  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

function mapJob(row: DatabaseRow): DocumentSemanticEnrichmentJob {
  const state = stringColumn(row, "run_state");
  if (!DocumentSemanticEnrichmentJobStates.includes(state as DocumentSemanticEnrichmentJobState)) {
    throw new Error(`Unsupported semantic enrichment state=${state}`);
  }
  return {
    availableAt: DateTimeSchema.parse(stringColumn(row, "available_at")),
    baseHeadRevision: nonnegativeInteger(
      numberColumn(row, "base_head_revision"),
      "baseHeadRevision",
    ),
    compilationAttemptId: UuidSchema.parse(stringColumn(row, "compilation_attempt_id")),
    ...(optionalStringColumn(row, "completed_at")
      ? { completedAt: DateTimeSchema.parse(optionalStringColumn(row, "completed_at")) }
      : {}),
    createdAt: DateTimeSchema.parse(stringColumn(row, "created_at")),
    documentAssetId: UuidSchema.parse(stringColumn(row, "document_asset_id")),
    documentVersion: positiveInteger(numberColumn(row, "document_version"), "documentVersion"),
    executionAttempts: nonnegativeInteger(
      numberColumn(row, "execution_attempts"),
      "executionAttempts",
    ),
    ...(optionalStringColumn(row, "heartbeat_at")
      ? { heartbeatAt: DateTimeSchema.parse(optionalStringColumn(row, "heartbeat_at")) }
      : {}),
    id: UuidSchema.parse(stringColumn(row, "id")),
    knowledgeSpaceId: UuidSchema.parse(stringColumn(row, "knowledge_space_id")),
    ...(optionalStringColumn(row, "last_error_code")
      ? { lastErrorCode: optionalStringColumn(row, "last_error_code") }
      : {}),
    ...(optionalStringColumn(row, "last_error_message")
      ? { lastErrorMessage: optionalStringColumn(row, "last_error_message") }
      : {}),
    ...(optionalStringColumn(row, "lease_expires_at")
      ? { leaseExpiresAt: DateTimeSchema.parse(optionalStringColumn(row, "lease_expires_at")) }
      : {}),
    ...(optionalStringColumn(row, "lease_token")
      ? { leaseToken: UuidSchema.parse(optionalStringColumn(row, "lease_token")) }
      : {}),
    maxExecutionAttempts: positiveInteger(
      numberColumn(row, "max_execution_attempts"),
      "maxExecutionAttempts",
    ),
    parseArtifactId: UuidSchema.parse(stringColumn(row, "parse_artifact_id")),
    publicationGenerationId: PublicationGenerationIdSchema.parse(
      stringColumn(row, "publication_generation_id"),
    ),
    result: jsonObjectColumn(row, "result"),
    retrievalProfile: KnowledgeSpaceRetrievalProfileSchema.parse(
      jsonObjectColumn(row, "retrieval_profile"),
    ),
    rowVersion: nonnegativeInteger(numberColumn(row, "row_version"), "rowVersion"),
    runState: state as DocumentSemanticEnrichmentJobState,
    tenantId: requiredString(stringColumn(row, "tenant_id"), "tenantId", 255),
    updatedAt: DateTimeSchema.parse(stringColumn(row, "updated_at")),
    ...(optionalStringColumn(row, "worker_id")
      ? { workerId: optionalStringColumn(row, "worker_id") }
      : {}),
  };
}

async function selectCheckpoints(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: DocumentSemanticEnrichmentCheckpointScope,
  keys: readonly DocumentSemanticExtractionCheckpointKey[],
): Promise<DocumentSemanticExtractionCheckpoint[]> {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const params: DatabaseQueryValue[] = [
    scope.tenantId,
    scope.knowledgeSpaceId,
    scope.publicationGenerationId,
  ];
  const predicates = keys.map((key) => {
    params.push(key.nodeId, key.stage, key.inputFingerprint);
    const length = params.length;
    return `(${q("node_id")} = ${databasePlaceholder(database, length - 2)} AND ${q("stage")} = ${databasePlaceholder(database, length - 1)} AND ${q("input_fingerprint")} = ${databasePlaceholder(database, length)})`;
  });
  const result = await executor.execute({
    maxRows: keys.length,
    operation: "select",
    params,
    sql: `SELECT ${q("node_id")}, ${q("stage")}, ${q("input_fingerprint")}, ${q("result")} FROM ${q(checkpointTable)} WHERE ${q("tenant_id")} = ${databasePlaceholder(database, 1)} AND ${q("knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${q("publication_generation_id")} = ${databasePlaceholder(database, 3)} AND (${predicates.join(" OR ")});`,
    tableName: checkpointTable,
  });
  return result.rows.map((row) =>
    normalizeCheckpoint({
      inputFingerprint: stringColumn(row, "input_fingerprint"),
      nodeId: stringColumn(row, "node_id"),
      result: jsonObjectColumn(row, "result"),
      stage: stringColumn(row, "stage") as DocumentSemanticExtractionStage,
    }),
  );
}

async function insertCheckpoints(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  scope: DocumentSemanticEnrichmentCheckpointScope,
  checkpoints: readonly DocumentSemanticExtractionCheckpoint[],
  createdAt: string,
): Promise<void> {
  const q = (name: string) => quoteDatabaseIdentifier(database, name);
  const params: DatabaseQueryValue[] = [];
  const rows = checkpoints.map((checkpoint) => {
    const values: readonly DatabaseQueryValue[] = [
      scope.tenantId,
      scope.knowledgeSpaceId,
      scope.documentAssetId,
      scope.documentVersion,
      scope.publicationGenerationId,
      checkpoint.nodeId,
      checkpoint.stage,
      checkpoint.inputFingerprint,
      JSON.stringify(checkpoint.result),
      createdAt,
    ];
    const offset = params.length;
    params.push(...values);
    return `(${values
      .map((_, index) =>
        index === 8
          ? jsonInsertPlaceholder(database, offset + index + 1, "result")
          : databasePlaceholder(database, offset + index + 1),
      )
      .join(", ")})`;
  });
  const insert = database.dialect === "tidb" ? "INSERT IGNORE" : "INSERT";
  const conflict = database.dialect === "postgres" ? " ON CONFLICT DO NOTHING" : "";
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `${insert} INTO ${q(checkpointTable)} (${["tenant_id", "knowledge_space_id", "document_asset_id", "document_version", "publication_generation_id", "node_id", "stage", "input_fingerprint", "result", "created_at"].map(q).join(", ")}) VALUES ${rows.join(", ")}${conflict};`,
    tableName: checkpointTable,
  });
}

function normalizeEnqueue(
  input: EnqueueDocumentSemanticEnrichmentInput,
): EnqueueDocumentSemanticEnrichmentInput {
  return {
    availableAt: DateTimeSchema.parse(input.availableAt),
    baseHeadRevision: nonnegativeInteger(input.baseHeadRevision, "baseHeadRevision"),
    compilationAttemptId: UuidSchema.parse(input.compilationAttemptId),
    createdAt: DateTimeSchema.parse(input.createdAt),
    documentAssetId: UuidSchema.parse(input.documentAssetId),
    documentVersion: positiveInteger(input.documentVersion, "documentVersion"),
    id: UuidSchema.parse(input.id),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    maxExecutionAttempts: positiveInteger(input.maxExecutionAttempts, "maxExecutionAttempts"),
    parseArtifactId: UuidSchema.parse(input.parseArtifactId),
    publicationGenerationId: PublicationGenerationIdSchema.parse(input.publicationGenerationId),
    retrievalProfile: KnowledgeSpaceRetrievalProfileSchema.parse(input.retrievalProfile),
    tenantId: requiredString(input.tenantId, "tenantId", 255),
  };
}

function normalizeScope(
  scope: DocumentSemanticEnrichmentCheckpointScope,
): DocumentSemanticEnrichmentCheckpointScope {
  return {
    documentAssetId: UuidSchema.parse(scope.documentAssetId),
    documentVersion: positiveInteger(scope.documentVersion, "documentVersion"),
    knowledgeSpaceId: UuidSchema.parse(scope.knowledgeSpaceId),
    publicationGenerationId: PublicationGenerationIdSchema.parse(scope.publicationGenerationId),
    tenantId: requiredString(scope.tenantId, "tenantId", 255),
  };
}

function normalizeCheckpointKeys(
  keys: readonly DocumentSemanticExtractionCheckpointKey[],
): DocumentSemanticExtractionCheckpointKey[] {
  const normalized = keys.map((key) => ({
    inputFingerprint: /^sha256:[a-f0-9]{64}$/u.test(key.inputFingerprint)
      ? key.inputFingerprint
      : invalidFingerprint(),
    nodeId: UuidSchema.parse(key.nodeId),
    stage: key.stage === "entity" || key.stage === "relation" ? key.stage : invalidStage(),
  }));
  if (new Set(normalized.map(checkpointKey)).size !== normalized.length) {
    throw new Error("Semantic extraction checkpoint keys must be unique");
  }
  return normalized;
}

function normalizeCheckpoint(
  checkpoint: DocumentSemanticExtractionCheckpoint,
): DocumentSemanticExtractionCheckpoint {
  const key = normalizeCheckpointKeys([checkpoint])[0];
  if (!key) throw new Error("Semantic extraction checkpoint key is required");
  return { ...key, result: cloneJsonObject(checkpoint.result) };
}

function checkpointStorageKey(
  scope: DocumentSemanticEnrichmentCheckpointScope,
  key: DocumentSemanticExtractionCheckpointKey,
): string {
  return `${scope.tenantId}\u001f${scope.knowledgeSpaceId}\u001f${scope.publicationGenerationId}\u001f${checkpointKey(key)}`;
}

function checkpointKey(key: DocumentSemanticExtractionCheckpointKey): string {
  return `${key.nodeId}\u001f${key.stage}\u001f${key.inputFingerprint}`;
}

function fencedInMemoryJob(
  jobs: Map<string, DocumentSemanticEnrichmentJob>,
  input: DocumentSemanticEnrichmentLeaseInput,
): DocumentSemanticEnrichmentJob | null {
  const job = jobs.get(UuidSchema.parse(input.id));
  return job?.runState === "running" &&
    job.leaseToken === UuidSchema.parse(input.leaseToken) &&
    job.workerId === requiredString(input.workerId, "workerId", 255)
    ? job
    : null;
}

function isClaimable(job: DocumentSemanticEnrichmentJob, now: number): boolean {
  return (
    job.runState === "queued" ||
    (job.runState === "retry_wait" && Date.parse(job.availableAt) <= now) ||
    (job.runState === "running" && Date.parse(job.leaseExpiresAt ?? "") <= now)
  );
}

function compareJobs(
  left: DocumentSemanticEnrichmentJob,
  right: DocumentSemanticEnrichmentJob,
): number {
  return left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id);
}

function cloneJob(job: DocumentSemanticEnrichmentJob): DocumentSemanticEnrichmentJob {
  return {
    ...job,
    result: cloneJsonObject(job.result),
    retrievalProfile: KnowledgeSpaceRetrievalProfileSchema.parse(
      structuredClone(job.retrievalProfile),
    ),
  };
}

function cloneCheckpoint(
  checkpoint: DocumentSemanticExtractionCheckpoint,
): DocumentSemanticExtractionCheckpoint {
  return { ...checkpoint, result: cloneJsonObject(checkpoint.result) };
}

function requiredJob(
  job: DocumentSemanticEnrichmentJob | undefined | null,
): DocumentSemanticEnrichmentJob {
  if (!job) throw new Error("Document semantic enrichment job was not persisted");
  return job;
}

function requiredCheckpoint(
  checkpoint: DocumentSemanticExtractionCheckpoint | undefined,
): DocumentSemanticExtractionCheckpoint {
  if (!checkpoint) throw new Error("Document semantic extraction checkpoint was not persisted");
  return checkpoint;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error(`Semantic enrichment ${name} must be positive`);
  return value;
}

function nonnegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`Semantic enrichment ${name} must be nonnegative`);
  return value;
}

function requiredString(value: string, name: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength)
    throw new Error(`Semantic enrichment ${name} is invalid`);
  return normalized;
}

function invalidFingerprint(): never {
  throw new Error("Semantic extraction checkpoint inputFingerprint is invalid");
}

function invalidStage(): never {
  throw new Error("Semantic extraction checkpoint stage is invalid");
}
