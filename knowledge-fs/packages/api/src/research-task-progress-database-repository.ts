import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type {
  DatabaseAdapter,
  DatabaseExecutor,
  DatabaseQueryValue,
  DatabaseRow,
} from "@knowledge/core";
import { UuidSchema } from "@knowledge/core";

import { numberColumn, stringColumn } from "./database-row-utils";
import { databasePlaceholder, quoteDatabaseIdentifier } from "./database-sql-utils";
import { cloneJsonObject, jsonObjectColumn } from "./json-utils";
import type { ResearchTaskJobStage } from "./research-task-job";
import type {
  AppendResearchTaskProgressEventInput,
  ResearchTaskProgressEvent,
  ResearchTaskProgressEventType,
  ResearchTaskProgressRepository,
  SubscribeResearchTaskProgressInput,
} from "./research-task-progress";

export interface CreateDatabaseResearchTaskProgressRepositoryOptions {
  readonly database: DatabaseAdapter;
  readonly generateId?: (() => string) | undefined;
  readonly maxListLimit: number;
  readonly maxPollBatchSize: number;
  readonly maxSubscribers: number;
  readonly now?: (() => number) | undefined;
  readonly pollIntervalMs: number;
}

export interface AppendDatabaseResearchTaskProgressEventInTransactionOptions {
  readonly database: DatabaseAdapter;
  readonly executor: DatabaseExecutor;
  readonly generateId?: (() => string) | undefined;
  readonly input: AppendResearchTaskProgressEventInput;
  readonly now: number;
}

const progressTable = "research_task_progress_events";
const jobTable = "research_task_jobs";
const eventTypes = new Set<ResearchTaskProgressEventType>([
  "research_task.canceled",
  "research_task.failed",
  "research_task.paused",
  "research_task.resumed",
  "research_task.stage_changed",
  "research_task.started",
]);
const jobStages = new Set<ResearchTaskJobStage>([
  "queued",
  "planning",
  "retrieving",
  "analyzing",
  "generating",
  "paused",
  "completed",
  "failed",
  "canceled",
]);

/**
 * Durable progress ledger. Appends serialize on the owning job row, giving every task one stable
 * sequence across replicas. Subscriptions poll that ledger from a cursor, so process restarts and
 * events written between an HTTP backlog read and live subscription cannot be lost.
 */
export function createDatabaseResearchTaskProgressRepository({
  database,
  generateId = randomUUID,
  maxListLimit,
  maxPollBatchSize,
  maxSubscribers,
  now = Date.now,
  pollIntervalMs,
}: CreateDatabaseResearchTaskProgressRepositoryOptions): ResearchTaskProgressRepository {
  positiveInteger(maxListLimit, "maxListLimit");
  positiveInteger(maxPollBatchSize, "maxPollBatchSize");
  positiveInteger(maxSubscribers, "maxSubscribers");
  if (maxPollBatchSize > maxListLimit) {
    throw new Error("Research task progress maxPollBatchSize must not exceed maxListLimit");
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 10 || pollIntervalMs > 60_000) {
    throw new Error("Research task progress pollIntervalMs must be between 10 and 60000");
  }

  let activeSubscribers = 0;
  const repository: ResearchTaskProgressRepository = {
    append: async (rawInput) => {
      const input = normalizeAppend(rawInput);
      return database.transaction(async (transaction) => {
        await requireJobScope(database, transaction, input);
        return appendDatabaseResearchTaskProgressEventInTransaction({
          database,
          executor: transaction,
          generateId,
          input,
          now: validTimestamp(now()),
        });
      });
    },
    list: async (rawInput) => {
      const input = normalizeList(rawInput, maxListLimit);
      const params: DatabaseQueryValue[] = [
        input.tenantId,
        input.researchTaskJobId,
        input.afterSequence,
        input.limit + 1,
      ];
      const result = await database.execute({
        maxRows: input.limit + 1,
        operation: "select",
        params,
        sql: `SELECT * FROM ${q(database, progressTable)} WHERE ${q(
          database,
          "tenant_id",
        )} = ${p(database, 1)} AND ${q(database, "research_task_job_id")} = ${p(
          database,
          2,
        )} AND ${q(database, "sequence")} > ${p(database, 3)} ORDER BY ${q(
          database,
          "sequence",
        )} ASC, ${q(database, "id")} ASC LIMIT ${p(database, 4)}`,
        tableName: progressTable,
      });
      const selected = result.rows.map(progressFromRow);
      const items = selected.slice(0, input.limit);
      return {
        items,
        ...(selected.length > input.limit
          ? { nextCursor: String(items.at(-1)?.sequence ?? input.afterSequence) }
          : {}),
      };
    },
    subscribe: (rawInput) => {
      const input = normalizeSubscribe(rawInput);
      if (activeSubscribers >= maxSubscribers) {
        throw new Error(
          `Research task progress subscribers exceed maxSubscribers=${maxSubscribers}`,
        );
      }
      activeSubscribers += 1;
      return createPollingSubscription({
        input,
        list: repository.list,
        maxPollBatchSize,
        onClose: () => {
          activeSubscribers -= 1;
        },
        pollIntervalMs,
      });
    },
  };
  return repository;
}

/**
 * Appends to the progress ledger using an existing transaction. The caller must already own the
 * Research job row (by inserting it or locking it FOR UPDATE), which serializes task-local
 * sequence allocation and makes the visible job mutation and progress event one atomic commit.
 */
export async function appendDatabaseResearchTaskProgressEventInTransaction({
  database,
  executor,
  generateId = randomUUID,
  input: rawInput,
  now,
}: AppendDatabaseResearchTaskProgressEventInTransactionOptions): Promise<ResearchTaskProgressEvent> {
  const input = normalizeAppend(rawInput);
  const timestamp = validTimestamp(now);
  let eventId: string | undefined;
  const idempotencyKey =
    input.idempotencyKey ??
    (() => {
      eventId = UuidSchema.parse(generateId());
      return `research-task-progress:${input.researchTaskJobId}:${eventId}`;
    })();
  const existing = await getByIdempotencyKey(
    database,
    executor,
    input.researchTaskJobId,
    idempotencyKey,
  );
  if (existing) {
    assertIdempotentReplay(existing, input);
    return existing;
  }

  eventId ??= UuidSchema.parse(generateId());
  const sequence = await nextSequence(database, executor, input.researchTaskJobId);
  const params: DatabaseQueryValue[] = [
    eventId,
    input.tenantId,
    input.knowledgeSpaceId,
    input.researchTaskJobId,
    sequence,
    idempotencyKey,
    input.type,
    input.stage,
    JSON.stringify(input.payload),
    timestamp,
  ];
  await executor.execute({
    maxRows: 0,
    operation: "insert",
    params,
    sql: `INSERT INTO ${q(database, progressTable)} (${[
      "id",
      "tenant_id",
      "knowledge_space_id",
      "research_task_job_id",
      "sequence",
      "idempotency_key",
      "event_type",
      "stage",
      "payload",
      "created_at",
    ]
      .map((column) => q(database, column))
      .join(", ")}) VALUES (${params
      .map((_, index) =>
        index === 8
          ? database.dialect === "postgres"
            ? `${p(database, index + 1)}::jsonb`
            : `CAST(${p(database, index + 1)} AS JSON)`
          : p(database, index + 1),
      )
      .join(", ")})`,
    tableName: progressTable,
  });
  return {
    createdAt: new Date(timestamp).toISOString(),
    id: eventId,
    knowledgeSpaceId: input.knowledgeSpaceId,
    payload: cloneJsonObject(input.payload),
    researchTaskJobId: input.researchTaskJobId,
    sequence,
    stage: input.stage,
    tenantId: input.tenantId,
    type: input.type,
  };
}

async function requireJobScope(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  input: ReturnType<typeof normalizeAppend>,
): Promise<void> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [input.researchTaskJobId, input.tenantId, input.knowledgeSpaceId],
    sql: `SELECT ${q(database, "id")} FROM ${q(database, jobTable)} WHERE ${q(
      database,
      "id",
    )} = ${p(database, 1)} AND ${q(database, "tenant_id")} = ${p(
      database,
      2,
    )} AND ${q(database, "knowledge_space_id")} = ${p(database, 3)} FOR UPDATE`,
    tableName: jobTable,
  });
  if (result.rows.length !== 1) {
    throw new Error("Research task progress job scope was not found");
  }
}

async function nextSequence(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  researchTaskJobId: string,
): Promise<number> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [researchTaskJobId],
    sql: `SELECT ${q(database, "sequence")} FROM ${q(
      database,
      progressTable,
    )} WHERE ${q(database, "research_task_job_id")} = ${p(
      database,
      1,
    )} ORDER BY ${q(database, "sequence")} DESC LIMIT 1`,
    tableName: progressTable,
  });
  return result.rows[0] ? numberColumn(result.rows[0], "sequence") + 1 : 1;
}

async function getByIdempotencyKey(
  database: DatabaseAdapter,
  executor: DatabaseExecutor,
  researchTaskJobId: string,
  idempotencyKey: string,
): Promise<ResearchTaskProgressEvent | null> {
  const result = await executor.execute({
    maxRows: 1,
    operation: "select",
    params: [researchTaskJobId, idempotencyKey],
    sql: `SELECT * FROM ${q(database, progressTable)} WHERE ${q(
      database,
      "research_task_job_id",
    )} = ${p(database, 1)} AND ${q(database, "idempotency_key")} = ${p(database, 2)}`,
    tableName: progressTable,
  });
  return result.rows[0] ? progressFromRow(result.rows[0]) : null;
}

function createPollingSubscription(input: {
  readonly input: ReturnType<typeof normalizeSubscribe>;
  readonly list: ResearchTaskProgressRepository["list"];
  readonly maxPollBatchSize: number;
  readonly onClose: () => void;
  readonly pollIntervalMs: number;
}): AsyncIterable<ResearchTaskProgressEvent> {
  let afterSequence = input.input.afterSequence;
  let closed = false;
  let released = false;
  let wakePoll: (() => void) | undefined;
  const queued: ResearchTaskProgressEvent[] = [];
  let nextTail: Promise<void> = Promise.resolve();

  const close = () => {
    if (closed) return;
    closed = true;
    wakePoll?.();
    if (!released) {
      released = true;
      input.onClose();
    }
  };

  const pollNext = async (): Promise<IteratorResult<ResearchTaskProgressEvent>> => {
    try {
      while (!closed) {
        const queuedEvent = queued.shift();
        if (queuedEvent) {
          afterSequence = queuedEvent.sequence;
          return { done: false, value: queuedEvent };
        }
        const page = await input.list({
          cursor: String(afterSequence),
          limit: input.maxPollBatchSize,
          researchTaskJobId: input.input.researchTaskJobId,
          tenantId: input.input.tenantId,
        });
        if (closed) break;
        queued.push(...page.items);
        if (queued.length > 0) continue;
        await waitForPoll(input.pollIntervalMs, (wake) => {
          wakePoll = wake;
        });
        wakePoll = undefined;
      }
      return { done: true, value: undefined as never };
    } catch (error) {
      close();
      throw error;
    }
  };

  const next = (): Promise<IteratorResult<ResearchTaskProgressEvent>> => {
    const result = nextTail.then(pollNext, pollNext);
    nextTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<ResearchTaskProgressEvent> {
      return {
        next,
        return: async () => {
          close();
          return { done: true, value: undefined as never };
        },
      };
    },
  };
}

function waitForPoll(intervalMs: number, registerWake: (wake: () => void) => void): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, intervalMs);
    timer.unref?.();
    registerWake(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function progressFromRow(row: DatabaseRow): ResearchTaskProgressEvent {
  const type = stringColumn(row, "event_type") as ResearchTaskProgressEventType;
  const stage = stringColumn(row, "stage") as ResearchTaskJobStage;
  if (!eventTypes.has(type) || !jobStages.has(stage)) {
    throw new Error("Research task progress row has an invalid event type or stage");
  }
  const createdAt = validTimestamp(numberColumn(row, "created_at"));
  return {
    createdAt: new Date(createdAt).toISOString(),
    id: stringColumn(row, "id"),
    knowledgeSpaceId: stringColumn(row, "knowledge_space_id"),
    payload: jsonObjectColumn(row, "payload"),
    researchTaskJobId: stringColumn(row, "research_task_job_id"),
    sequence: positiveInteger(numberColumn(row, "sequence"), "sequence"),
    stage,
    tenantId: stringColumn(row, "tenant_id"),
    type,
  };
}

function normalizeAppend(input: AppendResearchTaskProgressEventInput) {
  const type = input.type;
  const stage = input.stage;
  if (!eventTypes.has(type) || !jobStages.has(stage)) {
    throw new Error("Research task progress event type or stage is invalid");
  }
  return {
    idempotencyKey: optionalIdempotencyKey(input.idempotencyKey),
    knowledgeSpaceId: requiredString(input.knowledgeSpaceId, "knowledgeSpaceId", 255),
    payload: cloneJsonObject(input.payload ?? {}),
    researchTaskJobId: requiredString(input.researchTaskJobId, "researchTaskJobId", 255),
    stage,
    tenantId: requiredString(input.tenantId, "tenantId", 255),
    type,
  };
}

function normalizeList(
  input: Parameters<ResearchTaskProgressRepository["list"]>[0],
  maxListLimit: number,
) {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > maxListLimit) {
    throw new Error(`Research task progress list limit must be between 1 and ${maxListLimit}`);
  }
  return {
    afterSequence: parseCursor(input.cursor),
    limit: input.limit,
    researchTaskJobId: requiredString(input.researchTaskJobId, "researchTaskJobId", 255),
    tenantId: requiredString(input.tenantId, "tenantId", 255),
  };
}

function normalizeSubscribe(input: SubscribeResearchTaskProgressInput) {
  return {
    afterSequence: parseCursor(input.cursor),
    researchTaskJobId: requiredString(input.researchTaskJobId, "researchTaskJobId", 255),
    tenantId: requiredString(input.tenantId, "tenantId", 255),
  };
}

function optionalIdempotencyKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, "idempotencyKey", 512);
}

function parseCursor(value: string | undefined): number {
  if (value === undefined) return 0;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new Error("Research task progress cursor is invalid");
  }
  return parsed;
}

function assertIdempotentReplay(
  existing: ResearchTaskProgressEvent,
  input: ReturnType<typeof normalizeAppend>,
): void {
  if (
    existing.tenantId !== input.tenantId ||
    existing.knowledgeSpaceId !== input.knowledgeSpaceId ||
    existing.researchTaskJobId !== input.researchTaskJobId ||
    existing.stage !== input.stage ||
    existing.type !== input.type ||
    !isDeepStrictEqual(existing.payload, input.payload)
  ) {
    throw new Error("Research task progress idempotencyKey was reused with different event data");
  }
}

function requiredString(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`Research task progress ${label} must contain 1-${max} characters`);
  }
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Research task progress ${label} must be a positive integer`);
  }
  return value;
}

function validTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Research task progress timestamp must be a nonnegative safe integer");
  }
  return value;
}

function q(database: DatabaseAdapter, identifier: string): string {
  return quoteDatabaseIdentifier(database, identifier);
}

function p(database: DatabaseAdapter, position: number): string {
  return databasePlaceholder(database, position);
}
