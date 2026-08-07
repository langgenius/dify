import { randomUUID } from "node:crypto";

import {
  type DatabaseAdapter,
  type DatabaseExecutor,
  type DatabaseQueryValue,
  type DatabaseRow,
  DateTimeSchema,
  ProjectionSetFingerprintSchema,
  UuidSchema,
} from "@knowledge/core";

import { numberColumn, optionalStringColumn, stringColumn } from "./database-row-utils";
import {
  databasePlaceholder,
  jsonInsertPlaceholder,
  quoteDatabaseIdentifier,
} from "./database-sql-utils";
import { jsonObjectColumn } from "./json-utils";
import type { PageIndexFindabilityEvaluationResult } from "./page-index-findability-evaluation";
import { PageIndexLayeredTreePromptVersion } from "./page-index-layered-tree-search";

export const PageIndexSummaryRepairStates = [
  "not-requested",
  "queued",
  "leased",
  "dispatched",
  "failed",
] as const;
export type PageIndexSummaryRepairState = (typeof PageIndexSummaryRepairStates)[number];

export interface PageIndexFindabilityEvaluationRecord {
  readonly compilationAttemptId: string;
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly availableAt?: string | undefined;
  readonly evaluatedAt: string;
  readonly evaluation: PageIndexFindabilityEvaluationResult;
  readonly generationId: string;
  readonly id: string;
  readonly knowledgeSpaceId: string;
  readonly leaseExpiresAt?: string | undefined;
  readonly lockToken?: string | undefined;
  readonly lockedBy?: string | undefined;
  readonly outlineId: string;
  readonly publicationFingerprint: string;
  readonly summaryRepairAttempts: number;
  readonly summaryRepairError?: string | undefined;
  readonly summaryRepairState: PageIndexSummaryRepairState;
  readonly tenantId: string;
  readonly updatedAt: string;
}

export interface PersistPageIndexFindabilityEvaluationInput {
  readonly compilationAttemptId: string;
  readonly documentAssetId: string;
  readonly documentVersion: number;
  readonly evaluatedAt: string;
  readonly evaluation: PageIndexFindabilityEvaluationResult;
  readonly generationId: string;
  readonly knowledgeSpaceId: string;
  readonly outlineId: string;
  readonly publicationFingerprint: string;
  readonly requestSummaryRepair: boolean;
  readonly tenantId: string;
}

export interface PageIndexFindabilityRoute {
  readonly documentAssetId: string;
  readonly generationId: string;
  readonly recommendedRoute: PageIndexFindabilityEvaluationResult["recommendedRoute"];
  readonly status: PageIndexFindabilityEvaluationResult["status"];
}

export interface PageIndexFindabilityRepository {
  claimSummaryRepairs(input: {
    readonly leaseExpiresAt: string;
    readonly limit: number;
    readonly now: string;
    readonly workerId: string;
  }): Promise<readonly PageIndexFindabilityEvaluationRecord[]>;
  completeSummaryRepair(input: {
    readonly id: string;
    readonly lockToken: string;
    readonly now: string;
  }): Promise<PageIndexFindabilityEvaluationRecord | null>;
  failSummaryRepair(input: {
    readonly error: string;
    readonly id: string;
    readonly lockToken: string;
    readonly now: string;
    readonly retryAt?: string | undefined;
  }): Promise<PageIndexFindabilityEvaluationRecord | null>;
  getManyRoutes(input: {
    readonly documents: readonly {
      readonly documentAssetId: string;
      readonly generationId: string;
    }[];
    readonly knowledgeSpaceId: string;
    readonly limit: number;
    readonly tenantId: string;
  }): Promise<readonly PageIndexFindabilityRoute[]>;
  persist(
    input: PersistPageIndexFindabilityEvaluationInput,
  ): Promise<PageIndexFindabilityEvaluationRecord>;
}

export interface InMemoryPageIndexFindabilityRepositoryOptions {
  readonly generateId?: (() => string) | undefined;
  readonly generateLockToken?: (() => string) | undefined;
  readonly maxEvaluations: number;
}

export interface DatabasePageIndexFindabilityRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: (() => string) | undefined;
  readonly generateLockToken?: (() => string) | undefined;
  readonly maxBatchSize: number;
}

export function createInMemoryPageIndexFindabilityRepository({
  generateId = randomUUID,
  generateLockToken = randomUUID,
  maxEvaluations,
}: InMemoryPageIndexFindabilityRepositoryOptions): PageIndexFindabilityRepository {
  positiveInteger(maxEvaluations, "maxEvaluations");
  const records = new Map<string, PageIndexFindabilityEvaluationRecord>();

  const write = (record: PageIndexFindabilityEvaluationRecord) => {
    const parsed = validateRecord(record);
    records.set(parsed.id, parsed);
    return cloneRecord(parsed);
  };

  return {
    claimSummaryRepairs: async (input) => {
      const now = DateTimeSchema.parse(input.now);
      const leaseExpiresAt = DateTimeSchema.parse(input.leaseExpiresAt);
      positiveInteger(input.limit, "claim limit");
      const workerId = requiredString(input.workerId, "workerId");
      if (leaseExpiresAt <= now) throw new Error("Findability repair lease must expire after now");
      const claimable = [...records.values()]
        .filter(
          (record) =>
            (record.summaryRepairState === "queued" &&
              (record.availableAt === undefined || record.availableAt <= now)) ||
            (record.summaryRepairState === "leased" &&
              record.leaseExpiresAt !== undefined &&
              record.leaseExpiresAt <= now),
        )
        .sort(
          (left, right) =>
            left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id),
        )
        .slice(0, input.limit);
      return claimable.map((record) =>
        write({
          ...record,
          availableAt: undefined,
          leaseExpiresAt,
          lockToken: UuidSchema.parse(generateLockToken()),
          lockedBy: workerId,
          summaryRepairAttempts: record.summaryRepairAttempts + 1,
          summaryRepairState: "leased",
          updatedAt: now,
        }),
      );
    },
    completeSummaryRepair: async (input) => {
      const current = records.get(UuidSchema.parse(input.id));
      if (!current || !ownsLease(current, input.lockToken)) return null;
      return write({
        ...current,
        availableAt: undefined,
        leaseExpiresAt: undefined,
        lockToken: undefined,
        lockedBy: undefined,
        summaryRepairError: undefined,
        summaryRepairState: "dispatched",
        updatedAt: DateTimeSchema.parse(input.now),
      });
    },
    failSummaryRepair: async (input) => {
      const current = records.get(UuidSchema.parse(input.id));
      if (!current || !ownsLease(current, input.lockToken)) return null;
      const retryAt = input.retryAt ? DateTimeSchema.parse(input.retryAt) : undefined;
      return write({
        ...current,
        availableAt: retryAt,
        leaseExpiresAt: undefined,
        lockToken: undefined,
        lockedBy: undefined,
        summaryRepairError: requiredString(input.error, "summary repair error").slice(0, 2_000),
        summaryRepairState: retryAt ? "queued" : "failed",
        updatedAt: DateTimeSchema.parse(input.now),
      });
    },
    getManyRoutes: async (input) => {
      positiveInteger(input.limit, "route limit");
      if (input.documents.length > input.limit) {
        throw new Error(`Findability route input exceeds limit=${input.limit}`);
      }
      const requested = new Set(
        input.documents.map(
          (document) =>
            `${UuidSchema.parse(document.documentAssetId)}\u001f${UuidSchema.parse(document.generationId)}`,
        ),
      );
      return [...records.values()]
        .filter(
          (record) =>
            record.tenantId === input.tenantId &&
            record.knowledgeSpaceId === input.knowledgeSpaceId &&
            requested.has(`${record.documentAssetId}\u001f${record.generationId}`),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, input.limit)
        .map((record) => ({
          documentAssetId: record.documentAssetId,
          generationId: record.generationId,
          recommendedRoute: record.evaluation.recommendedRoute,
          status: record.evaluation.status,
        }));
    },
    persist: async (input) => {
      const normalized = validatePersistInput(input);
      const existing = [...records.values()].find(
        (record) =>
          record.tenantId === normalized.tenantId &&
          record.knowledgeSpaceId === normalized.knowledgeSpaceId &&
          record.generationId === normalized.generationId &&
          record.evaluation.evaluatorVersion === normalized.evaluation.evaluatorVersion,
      );
      const priorRepair = [...records.values()].some(
        (record) =>
          record.tenantId === normalized.tenantId &&
          record.knowledgeSpaceId === normalized.knowledgeSpaceId &&
          record.documentAssetId === normalized.documentAssetId &&
          record.documentVersion === normalized.documentVersion &&
          record.summaryRepairState !== "not-requested" &&
          record.id !== existing?.id,
      );
      const queueRepair =
        normalized.requestSummaryRepair &&
        normalized.evaluation.status === "failed" &&
        !priorRepair &&
        (existing?.summaryRepairState === undefined ||
          existing.summaryRepairState === "not-requested" ||
          existing.summaryRepairState === "queued");
      const summaryRepairRequested =
        queueRepair || existing?.evaluation.summaryRepairRequested === true;
      if (!existing && records.size >= maxEvaluations) {
        throw new Error(`Findability repository maxEvaluations=${maxEvaluations} exceeded`);
      }
      return write({
        ...normalized,
        evaluation: {
          ...normalized.evaluation,
          summaryRepairRequested,
        },
        id: existing?.id ?? UuidSchema.parse(generateId()),
        ...(existing?.leaseExpiresAt ? { leaseExpiresAt: existing.leaseExpiresAt } : {}),
        ...(existing?.availableAt ? { availableAt: existing.availableAt } : {}),
        ...(existing?.lockToken ? { lockToken: existing.lockToken } : {}),
        ...(existing?.lockedBy ? { lockedBy: existing.lockedBy } : {}),
        summaryRepairAttempts: existing?.summaryRepairAttempts ?? 0,
        ...(existing?.summaryRepairError
          ? { summaryRepairError: existing.summaryRepairError }
          : {}),
        summaryRepairState: queueRepair
          ? "queued"
          : (existing?.summaryRepairState ?? "not-requested"),
        updatedAt: normalized.evaluatedAt,
      });
    },
  };
}

export function createDatabasePageIndexFindabilityRepository({
  database,
  generateId = randomUUID,
  generateLockToken = randomUUID,
  maxBatchSize,
}: DatabasePageIndexFindabilityRepositoryOptions): PageIndexFindabilityRepository {
  positiveInteger(maxBatchSize, "maxBatchSize");
  const table = "page_index_findability_evaluations";
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);

  return {
    persist: async (input) => {
      const normalized = validatePersistInput(input);
      return database.transaction(async (transaction) => {
        await lockFindabilitySpace(database, transaction, normalized);
        const existing = await selectExactEvaluation(database, transaction, normalized, true);
        const priorRepair = await transaction.execute({
          maxRows: 1,
          operation: "select",
          params: [
            normalized.tenantId,
            normalized.knowledgeSpaceId,
            normalized.documentAssetId,
            normalized.documentVersion,
            ...(existing ? [existing.id] : []),
          ],
          sql: `SELECT ${q("id")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND ${q("document_asset_id")} = ${p(3)} AND ${q("document_version")} = ${p(4)} AND ${q("summary_repair_state")} <> 'not-requested'${existing ? ` AND ${q("id")} <> ${p(5)}` : ""} LIMIT 1 FOR UPDATE;`,
          tableName: table,
        });
        const queueRepair =
          normalized.requestSummaryRepair &&
          normalized.evaluation.status === "failed" &&
          priorRepair.rows.length === 0 &&
          (!existing || ["not-requested", "queued"].includes(existing.summaryRepairState));
        const summaryRepairRequested =
          queueRepair || existing?.evaluation.summaryRepairRequested === true;
        const record = validateRecord({
          ...normalized,
          evaluation: { ...normalized.evaluation, summaryRepairRequested },
          id: existing?.id ?? UuidSchema.parse(generateId()),
          ...(existing?.availableAt ? { availableAt: existing.availableAt } : {}),
          ...(existing?.leaseExpiresAt ? { leaseExpiresAt: existing.leaseExpiresAt } : {}),
          ...(existing?.lockToken ? { lockToken: existing.lockToken } : {}),
          ...(existing?.lockedBy ? { lockedBy: existing.lockedBy } : {}),
          summaryRepairAttempts: existing?.summaryRepairAttempts ?? 0,
          ...(existing?.summaryRepairError
            ? { summaryRepairError: existing.summaryRepairError }
            : {}),
          summaryRepairState: queueRepair
            ? "queued"
            : (existing?.summaryRepairState ?? "not-requested"),
          updatedAt: normalized.evaluatedAt,
        });
        await upsertDatabaseEvaluation(database, transaction, record);
        return record;
      });
    },
    getManyRoutes: async (input) => {
      positiveInteger(input.limit, "route limit");
      if (input.documents.length > input.limit || input.documents.length > maxBatchSize) {
        throw new Error(
          `Findability route input exceeds limit=${Math.min(input.limit, maxBatchSize)}`,
        );
      }
      if (input.documents.length === 0) return [];
      const params: DatabaseQueryValue[] = [
        requiredString(input.tenantId, "tenantId"),
        UuidSchema.parse(input.knowledgeSpaceId),
      ];
      const pairs = input.documents.map((document) => {
        params.push(
          UuidSchema.parse(document.documentAssetId),
          UuidSchema.parse(document.generationId),
        );
        return `(${q("document_asset_id")} = ${p(params.length - 1)} AND ${q("publication_generation_id")} = ${p(params.length)})`;
      });
      const result = await database.execute({
        maxRows: input.limit,
        operation: "select",
        params,
        sql: `SELECT ${q("document_asset_id")}, ${q("publication_generation_id")}, ${q("status")}, ${q("recommended_route")} FROM ${q(table)} WHERE ${q("tenant_id")} = ${p(1)} AND ${q("knowledge_space_id")} = ${p(2)} AND (${pairs.join(" OR ")}) ORDER BY ${q("updated_at")} DESC LIMIT ${input.limit};`,
        tableName: table,
      });
      const seen = new Set<string>();
      return result.rows.flatMap((row): PageIndexFindabilityRoute[] => {
        const documentAssetId = UuidSchema.parse(stringColumn(row, "document_asset_id"));
        const generationId = UuidSchema.parse(stringColumn(row, "publication_generation_id"));
        const key = `${documentAssetId}\u001f${generationId}`;
        if (seen.has(key)) return [];
        seen.add(key);
        return [
          {
            documentAssetId,
            generationId,
            recommendedRoute: findabilityRoute(stringColumn(row, "recommended_route")),
            status: findabilityStatus(stringColumn(row, "status")),
          },
        ];
      });
    },
    claimSummaryRepairs: async (input) => {
      const limit = positiveInteger(input.limit, "claim limit");
      if (limit > maxBatchSize)
        throw new Error(`Findability repair claim exceeds maxBatchSize=${maxBatchSize}`);
      const now = DateTimeSchema.parse(input.now);
      const leaseExpiresAt = DateTimeSchema.parse(input.leaseExpiresAt);
      const workerId = requiredString(input.workerId, "workerId");
      if (leaseExpiresAt <= now) throw new Error("Findability repair lease must expire after now");
      return database.transaction(async (transaction) => {
        const selected = await transaction.execute({
          maxRows: limit,
          operation: "select",
          params: [now],
          sql: `SELECT * FROM ${q(table)} WHERE ((${q("summary_repair_state")} = 'queued' AND (${q("available_at")} IS NULL OR ${q("available_at")} <= ${p(1)})) OR (${q("summary_repair_state")} = 'leased' AND ${q("lease_expires_at")} <= ${p(1)})) ORDER BY ${q("updated_at")}, ${q("id")} LIMIT ${limit} FOR UPDATE SKIP LOCKED;`,
          tableName: table,
        });
        const claimed: PageIndexFindabilityEvaluationRecord[] = [];
        for (const row of selected.rows) {
          const current = mapEvaluationRow(row);
          const lockToken = UuidSchema.parse(generateLockToken());
          await transaction.execute({
            maxRows: 0,
            operation: "update",
            params: [current.id, lockToken, workerId, leaseExpiresAt, now],
            sql: `UPDATE ${q(table)} SET ${q("summary_repair_state")} = 'leased', ${q("summary_repair_attempts")} = ${q("summary_repair_attempts")} + 1, ${q("available_at")} = NULL, ${q("lock_token")} = ${p(2)}, ${q("locked_by")} = ${p(3)}, ${q("lease_expires_at")} = ${p(4)}, ${q("updated_at")} = ${p(5)} WHERE ${q("id")} = ${p(1)};`,
            tableName: table,
          });
          claimed.push({
            ...current,
            availableAt: undefined,
            leaseExpiresAt,
            lockToken,
            lockedBy: workerId,
            summaryRepairAttempts: current.summaryRepairAttempts + 1,
            summaryRepairState: "leased",
            updatedAt: now,
          });
        }
        return claimed;
      });
    },
    completeSummaryRepair: async (input) =>
      mutateDatabaseRepair(database, {
        id: input.id,
        lockToken: input.lockToken,
        now: input.now,
        state: "dispatched",
      }),
    failSummaryRepair: async (input) =>
      mutateDatabaseRepair(database, {
        error: input.error,
        id: input.id,
        lockToken: input.lockToken,
        now: input.now,
        ...(input.retryAt ? { retryAt: input.retryAt } : {}),
        state: input.retryAt ? "queued" : "failed",
      }),
  };
}

function validatePersistInput(
  input: PersistPageIndexFindabilityEvaluationInput,
): PersistPageIndexFindabilityEvaluationInput {
  return {
    compilationAttemptId: UuidSchema.parse(input.compilationAttemptId),
    documentAssetId: UuidSchema.parse(input.documentAssetId),
    documentVersion: positiveInteger(input.documentVersion, "documentVersion"),
    evaluatedAt: DateTimeSchema.parse(input.evaluatedAt),
    evaluation: cloneEvaluation(input.evaluation),
    generationId: UuidSchema.parse(input.generationId),
    knowledgeSpaceId: UuidSchema.parse(input.knowledgeSpaceId),
    outlineId: UuidSchema.parse(input.outlineId),
    publicationFingerprint: ProjectionSetFingerprintSchema.parse(input.publicationFingerprint),
    requestSummaryRepair: input.requestSummaryRepair === true,
    tenantId: requiredString(input.tenantId, "tenantId"),
  };
}

function validateRecord(
  record: PageIndexFindabilityEvaluationRecord,
): PageIndexFindabilityEvaluationRecord {
  const base = validatePersistInput({ ...record, requestSummaryRepair: false });
  if (!PageIndexSummaryRepairStates.includes(record.summaryRepairState)) {
    throw new Error("Invalid PageIndex summary repair state");
  }
  return {
    ...base,
    id: UuidSchema.parse(record.id),
    ...(record.availableAt ? { availableAt: DateTimeSchema.parse(record.availableAt) } : {}),
    ...(record.leaseExpiresAt
      ? { leaseExpiresAt: DateTimeSchema.parse(record.leaseExpiresAt) }
      : {}),
    ...(record.lockToken ? { lockToken: UuidSchema.parse(record.lockToken) } : {}),
    ...(record.lockedBy ? { lockedBy: requiredString(record.lockedBy, "lockedBy") } : {}),
    summaryRepairAttempts: nonnegativeInteger(
      record.summaryRepairAttempts,
      "summaryRepairAttempts",
    ),
    ...(record.summaryRepairError
      ? { summaryRepairError: requiredString(record.summaryRepairError, "summaryRepairError") }
      : {}),
    summaryRepairState: record.summaryRepairState,
    updatedAt: DateTimeSchema.parse(record.updatedAt),
  };
}

const findabilityTable = "page_index_findability_evaluations";

async function lockFindabilitySpace(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: Pick<PersistPageIndexFindabilityEvaluationInput, "knowledgeSpaceId" | "tenantId">,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT ${quoteDatabaseIdentifier(database, "id")} FROM ${quoteDatabaseIdentifier(database, "knowledge_spaces")} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(database, "id")} = ${databasePlaceholder(database, 2)} LIMIT 1 FOR UPDATE;`,
    tableName: "knowledge_spaces",
  });
  if (!result.rows[0]) throw new Error("Findability knowledge space was not found");
}

async function selectExactEvaluation(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: PersistPageIndexFindabilityEvaluationInput,
  forUpdate: boolean,
): Promise<PageIndexFindabilityEvaluationRecord | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [
      input.tenantId,
      input.knowledgeSpaceId,
      input.generationId,
      input.evaluation.evaluatorVersion,
    ],
    sql: `SELECT * FROM ${quoteDatabaseIdentifier(database, findabilityTable)} WHERE ${quoteDatabaseIdentifier(database, "tenant_id")} = ${databasePlaceholder(database, 1)} AND ${quoteDatabaseIdentifier(database, "knowledge_space_id")} = ${databasePlaceholder(database, 2)} AND ${quoteDatabaseIdentifier(database, "publication_generation_id")} = ${databasePlaceholder(database, 3)} AND ${quoteDatabaseIdentifier(database, "evaluator_version")} = ${databasePlaceholder(database, 4)} LIMIT 1${forUpdate ? " FOR UPDATE" : ""};`,
    tableName: findabilityTable,
  });
  return result.rows[0] ? mapEvaluationRow(result.rows[0]) : null;
}

async function upsertDatabaseEvaluation(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  record: PageIndexFindabilityEvaluationRecord,
): Promise<void> {
  const columns = [
    "id",
    "tenant_id",
    "knowledge_space_id",
    "document_asset_id",
    "document_version",
    "outline_id",
    "publication_generation_id",
    "publication_fingerprint",
    "compilation_attempt_id",
    "evaluator_version",
    "status",
    "recommended_route",
    "evaluation",
    "summary_repair_state",
    "summary_repair_attempts",
    "summary_repair_error",
    "available_at",
    "lock_token",
    "locked_by",
    "lease_expires_at",
    "evaluated_at",
    "updated_at",
  ] as const;
  const params: DatabaseQueryValue[] = [
    record.id,
    record.tenantId,
    record.knowledgeSpaceId,
    record.documentAssetId,
    record.documentVersion,
    record.outlineId,
    record.generationId,
    record.publicationFingerprint,
    record.compilationAttemptId,
    record.evaluation.evaluatorVersion,
    record.evaluation.status,
    record.evaluation.recommendedRoute,
    JSON.stringify(record.evaluation),
    record.summaryRepairState,
    record.summaryRepairAttempts,
    record.summaryRepairError ?? null,
    record.availableAt ?? null,
    record.lockToken ?? null,
    record.lockedBy ?? null,
    record.leaseExpiresAt ?? null,
    record.evaluatedAt,
    record.updatedAt,
  ];
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const values = columns.map((column, index) =>
    column === "evaluation"
      ? jsonInsertPlaceholder(database, index + 1, column)
      : databasePlaceholder(database, index + 1),
  );
  const mutable = columns.filter(
    (column) =>
      ![
        "id",
        "tenant_id",
        "knowledge_space_id",
        "publication_generation_id",
        "evaluator_version",
      ].includes(column),
  );
  const conflict =
    database.dialect === "postgres"
      ? ` ON CONFLICT (${q("tenant_id")}, ${q("knowledge_space_id")}, ${q("publication_generation_id")}, ${q("evaluator_version")}) DO UPDATE SET ${mutable.map((column) => `${q(column)} = EXCLUDED.${q(column)}`).join(", ")}`
      : ` ON DUPLICATE KEY UPDATE ${mutable.map((column) => `${q(column)} = VALUES(${q(column)})`).join(", ")}`;
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(findabilityTable)} (${columns.map(q).join(", ")}) VALUES (${values.join(", ")})${conflict};`,
    tableName: findabilityTable,
  });
}

async function mutateDatabaseRepair(
  database: DatabaseAdapter,
  input: {
    readonly error?: string | undefined;
    readonly id: string;
    readonly lockToken: string;
    readonly now: string;
    readonly retryAt?: string | undefined;
    readonly state: "dispatched" | "failed" | "queued";
  },
): Promise<PageIndexFindabilityEvaluationRecord | null> {
  const id = UuidSchema.parse(input.id);
  const lockToken = UuidSchema.parse(input.lockToken);
  const now = DateTimeSchema.parse(input.now);
  const retryAt = input.retryAt ? DateTimeSchema.parse(input.retryAt) : undefined;
  const q = (value: string) => quoteDatabaseIdentifier(database, value);
  const p = (position: number) => databasePlaceholder(database, position);
  return database.transaction(async (transaction) => {
    const currentResult = await transaction.execute({
      maxRows: 1,
      operation: "select",
      params: [id, lockToken],
      sql: `SELECT * FROM ${q(findabilityTable)} WHERE ${q("id")} = ${p(1)} AND ${q("summary_repair_state")} = 'leased' AND ${q("lock_token")} = ${p(2)} LIMIT 1 FOR UPDATE;`,
      tableName: findabilityTable,
    });
    if (!currentResult.rows[0]) return null;
    const current = mapEvaluationRow(currentResult.rows[0]);
    await transaction.execute({
      maxRows: 0,
      operation: "update",
      params: [
        id,
        input.state,
        input.error ? requiredString(input.error, "summary repair error").slice(0, 2_000) : null,
        retryAt ?? null,
        now,
      ],
      sql: `UPDATE ${q(findabilityTable)} SET ${q("summary_repair_state")} = ${p(2)}, ${q("summary_repair_error")} = ${p(3)}, ${q("available_at")} = ${p(4)}, ${q("lock_token")} = NULL, ${q("locked_by")} = NULL, ${q("lease_expires_at")} = NULL, ${q("updated_at")} = ${p(5)} WHERE ${q("id")} = ${p(1)};`,
      tableName: findabilityTable,
    });
    return validateRecord({
      ...current,
      availableAt: retryAt,
      leaseExpiresAt: undefined,
      lockToken: undefined,
      lockedBy: undefined,
      ...(input.error ? { summaryRepairError: input.error.slice(0, 2_000) } : {}),
      summaryRepairState: input.state,
      updatedAt: now,
    });
  });
}

function mapEvaluationRow(row: DatabaseRow): PageIndexFindabilityEvaluationRecord {
  return validateRecord({
    compilationAttemptId: stringColumn(row, "compilation_attempt_id"),
    documentAssetId: stringColumn(row, "document_asset_id"),
    documentVersion: numberColumn(row, "document_version"),
    evaluatedAt: stringColumn(row, "evaluated_at"),
    evaluation: parseEvaluation(jsonObjectColumn(row, "evaluation")),
    generationId: stringColumn(row, "publication_generation_id"),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    ...(optionalStringColumn(row, "available_at")
      ? { availableAt: optionalStringColumn(row, "available_at") }
      : {}),
    ...(optionalStringColumn(row, "lease_expires_at")
      ? { leaseExpiresAt: optionalStringColumn(row, "lease_expires_at") }
      : {}),
    ...(optionalStringColumn(row, "lock_token")
      ? { lockToken: optionalStringColumn(row, "lock_token") }
      : {}),
    ...(optionalStringColumn(row, "locked_by")
      ? { lockedBy: optionalStringColumn(row, "locked_by") }
      : {}),
    outlineId: stringColumn(row, "outline_id"),
    publicationFingerprint: stringColumn(row, "publication_fingerprint"),
    summaryRepairAttempts: numberColumn(row, "summary_repair_attempts"),
    ...(optionalStringColumn(row, "summary_repair_error")
      ? { summaryRepairError: optionalStringColumn(row, "summary_repair_error") }
      : {}),
    summaryRepairState: summaryRepairState(stringColumn(row, "summary_repair_state")),
    tenantId: stringColumn(row, "tenant_id"),
    updatedAt: stringColumn(row, "updated_at"),
  });
}

function parseEvaluation(
  value: Readonly<Record<string, unknown>>,
): PageIndexFindabilityEvaluationResult {
  const model = objectValue(value.model, "model");
  if (value.promptVersion !== PageIndexLayeredTreePromptVersion) {
    throw new Error("Findability promptVersion is invalid");
  }
  return {
    abstentionRate: boundedNumber(value.abstentionRate, "abstentionRate"),
    evaluatorVersion: requiredUnknownString(value.evaluatorVersion, "evaluatorVersion"),
    meanReciprocalRank: boundedNumber(value.meanReciprocalRank, "meanReciprocalRank"),
    model: {
      model: requiredUnknownString(model.model, "model.model"),
      pluginId: requiredUnknownString(model.pluginId, "model.pluginId"),
      provider: requiredUnknownString(model.provider, "model.provider"),
    },
    pathRecallAtK: boundedNumber(value.pathRecallAtK, "pathRecallAtK"),
    promptVersion: PageIndexLayeredTreePromptVersion,
    recallAtK: boundedNumber(value.recallAtK, "recallAtK"),
    recommendedRoute: findabilityRoute(value.recommendedRoute),
    sampleCount: unknownNonnegativeInteger(value.sampleCount, "sampleCount"),
    status: findabilityStatus(value.status),
    summaryRepairRequested: value.summaryRepairRequested === true,
    topK: unknownPositiveInteger(value.topK, "topK"),
  };
}

function objectValue(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Findability ${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredUnknownString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`Findability ${label} must be a string`);
  return requiredString(value, label);
}

function boundedNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Findability ${label} must be within [0, 1]`);
  }
  return value;
}

function unknownPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number") throw new Error(`Findability ${label} must be a number`);
  return positiveInteger(value, label);
}

function unknownNonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number") throw new Error(`Findability ${label} must be a number`);
  return nonnegativeInteger(value, label);
}

function findabilityStatus(value: unknown): PageIndexFindabilityEvaluationResult["status"] {
  if (value !== "failed" && value !== "not-evaluated" && value !== "passed") {
    throw new Error("Findability status is invalid");
  }
  return value;
}

function findabilityRoute(
  value: unknown,
): PageIndexFindabilityEvaluationResult["recommendedRoute"] {
  if (value !== "hybrid" && value !== "layered" && value !== "unchanged") {
    throw new Error("Findability route is invalid");
  }
  return value;
}

function summaryRepairState(value: unknown): PageIndexSummaryRepairState {
  if (
    typeof value !== "string" ||
    !PageIndexSummaryRepairStates.includes(value as PageIndexSummaryRepairState)
  ) {
    throw new Error("Findability summary repair state is invalid");
  }
  return value as PageIndexSummaryRepairState;
}

function ownsLease(record: PageIndexFindabilityEvaluationRecord, lockToken: string): boolean {
  return record.summaryRepairState === "leased" && record.lockToken === UuidSchema.parse(lockToken);
}

function cloneRecord(
  record: PageIndexFindabilityEvaluationRecord,
): PageIndexFindabilityEvaluationRecord {
  return { ...record, evaluation: cloneEvaluation(record.evaluation) };
}

function cloneEvaluation(
  evaluation: PageIndexFindabilityEvaluationResult,
): PageIndexFindabilityEvaluationResult {
  return { ...evaluation, model: { ...evaluation.model } };
}

function requiredString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_000) throw new Error(`Findability ${label} is invalid`);
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Findability ${label} must be a positive integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Findability ${label} must be a non-negative integer`);
  }
  return value;
}
