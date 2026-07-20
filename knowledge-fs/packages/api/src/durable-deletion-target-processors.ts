import type { DatabaseExecutor } from "@knowledge/core";

import type {
  DurableDeletionInventoryItemInput,
  DurableDeletionJob,
  DurableDeletionJobItem,
  DurableDeletionRepository,
  DurableDeletionTargetType,
} from "./durable-deletion-repository";
import { DurableDeletionPrimaryResidueDirtyError } from "./durable-deletion-repository";

export interface DurableDeletionTargetOperationInput {
  readonly job: DurableDeletionJob;
  readonly signal: AbortSignal;
}

export interface DurableDeletionPrimaryDeleteInput extends DurableDeletionTargetOperationInput {
  /**
   * The primary-delete adapter must revalidate this fence in the same database transaction that
   * removes the target rows. A stale worker is never allowed to delete primary data.
   */
  readonly leaseFence: {
    readonly deletionJobId: string;
    readonly expectedRowVersion: number;
    readonly leaseToken: string;
  };
  /** The fenced repository transaction; all primary deletes and DB residue probes use this. */
  readonly transaction: DatabaseExecutor;
}

export interface DurableDeletionInventoryPage {
  readonly complete: boolean;
  /**
   * Items use deterministic job-global ordinals starting at 1. Ordinal 0 is reserved for the
   * document request's pre-seeded raw-object item, so adapters must never emit it.
   */
  readonly items: readonly DurableDeletionInventoryItemInput[];
  readonly nextCursor?: string | undefined;
  readonly scanPhase: string;
}

export interface DurableDeletionTargetCapabilities {
  /** Stops/cancels target-scoped work. Space implementations drain every background subsystem. */
  quiesce(input: DurableDeletionTargetOperationInput): Promise<{ readonly drained: boolean }>;
  /** Persists enough external inventory that later primary-row deletion cannot lose cleanup keys. */
  inventory(
    input: DurableDeletionTargetOperationInput & {
      readonly cursor?: string | undefined;
      readonly limit: number;
      readonly scanPhase?: string | undefined;
    },
  ): Promise<DurableDeletionInventoryPage>;
  /** CAS-publishes a new head excluding target members; historical publication rows are retained. */
  excludeTargetFromPublishedHead(input: DurableDeletionTargetOperationInput): Promise<void>;
  /** Deletes/retire/detaches one inventoried object, secret, cache key, or child document. */
  executeExternalItem(
    input: DurableDeletionTargetOperationInput & { readonly item: DurableDeletionJobItem },
  ): Promise<void>;
  /** Deletes one bounded first page. Repeated calls from cursor zero must converge. */
  deleteDerivedDataPage(
    input: DurableDeletionTargetOperationInput & { readonly limit: number },
  ): Promise<{ readonly complete: boolean; readonly deleted: number }>;
  /**
   * Idempotently removes the target's primary rows after all prior phases. The implementation must
   * validate leaseFence in the deletion-job row inside the same transaction as the primary delete.
   */
  deletePrimaryData(input: DurableDeletionPrimaryDeleteInput): Promise<{ readonly clean: boolean }>;
}

export interface DurableDeletionItemErrorClassification {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type DurableDeletionItemErrorClassifier = (
  error: unknown,
  item: DurableDeletionJobItem,
) => DurableDeletionItemErrorClassification;

export interface CreateDurableDeletionTargetProcessorsOptions {
  readonly classifyItemError?: DurableDeletionItemErrorClassifier | undefined;
  readonly documentAsset: DurableDeletionTargetCapabilities;
  readonly initialRetryDelayMs?: number | undefined;
  readonly inventoryPageSize: number;
  readonly itemBatchSize: number;
  readonly maxRetryDelayMs?: number | undefined;
  readonly now?: (() => number) | undefined;
  readonly repository: Pick<
    DurableDeletionRepository,
    | "advanceCheckpoint"
    | "appendInventory"
    | "claimItems"
    | "completeItem"
    | "completeJob"
    | "reconcileDirtyPrimary"
    | "scheduleItemRetry"
  >;
  readonly source: DurableDeletionTargetCapabilities;
  readonly knowledgeSpace: DurableDeletionTargetCapabilities;
  readonly logicalDocument?: DurableDeletionTargetCapabilities | undefined;
}

export type DurableDeletionTargetProcessResult =
  | { readonly disposition: "completed"; readonly job: DurableDeletionJob }
  | {
      readonly disposition: "failed";
      readonly error: DurableDeletionItemErrorClassification;
      readonly job: DurableDeletionJob;
    }
  | {
      /** scheduleItemRetry atomically persisted both the dead item and failed parent job. */
      readonly disposition: "failed_persisted";
      readonly error: DurableDeletionItemErrorClassification;
      readonly job: DurableDeletionJob;
    }
  | { readonly disposition: "progressed"; readonly job: DurableDeletionJob }
  | {
      readonly attemptBudget: "cooperative" | "failure";
      readonly disposition: "waiting";
      readonly job: DurableDeletionJob;
      readonly retryAt: string;
    };

export interface DurableDeletionTargetProcessors {
  process(input: DurableDeletionTargetOperationInput): Promise<DurableDeletionTargetProcessResult>;
}

export class DurableDeletionProcessorLeaseLostError extends Error {
  constructor() {
    super("Durable deletion processor lease fence was lost");
    this.name = "DurableDeletionProcessorLeaseLostError";
  }
}

export function createDurableDeletionTargetProcessors({
  classifyItemError = defaultItemErrorClassification,
  documentAsset,
  initialRetryDelayMs = 1_000,
  inventoryPageSize,
  itemBatchSize,
  knowledgeSpace,
  logicalDocument,
  maxRetryDelayMs = 5 * 60_000,
  now = Date.now,
  repository,
  source,
}: CreateDurableDeletionTargetProcessorsOptions): DurableDeletionTargetProcessors {
  for (const [field, value] of [
    ["inventoryPageSize", inventoryPageSize],
    ["itemBatchSize", itemBatchSize],
    ["initialRetryDelayMs", initialRetryDelayMs],
    ["maxRetryDelayMs", maxRetryDelayMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`Durable deletion processor ${field} must be a positive integer`);
    }
  }
  const capabilities: Record<DurableDeletionTargetType, DurableDeletionTargetCapabilities> = {
    document_asset: requireCapabilities(documentAsset, "documentAsset"),
    knowledge_space: requireCapabilities(knowledgeSpace, "knowledgeSpace"),
    logical_document: requireCapabilities(logicalDocument ?? documentAsset, "logicalDocument"),
    source: requireCapabilities(source, "source"),
  };

  return {
    async process({ job, signal }) {
      assertRunning(job);
      const target = capabilities[job.targetType];
      const operation = { job, signal };
      switch (job.checkpoint) {
        case "requested":
          return progressed(await advance(repository, job, "quiescing", now()));
        case "quiescing": {
          const quiescence = await target.quiesce(operation);
          if (!quiescence.drained) {
            return waiting(job, now() + initialRetryDelayMs);
          }
          let current = job;
          if (!current.inventoryComplete) {
            const page = await target.inventory({
              ...operation,
              ...(job.scanCursor ? { cursor: job.scanCursor } : {}),
              limit: inventoryPageSize,
              ...(job.scanPhase ? { scanPhase: job.scanPhase } : {}),
            });
            assertInventoryOrdinals(page);
            current = await requireJob(
              repository.appendInventory({
                ...fence(job, now()),
                inventoryComplete: page.complete,
                items: page.items,
                ...(page.nextCursor ? { scanCursor: page.nextCursor } : {}),
                scanPhase: page.scanPhase,
              }),
            );
          }
          if (!current.inventoryComplete) {
            return progressed(current);
          }
          const finalQuiescence = await target.quiesce({ job: current, signal });
          if (!finalQuiescence.drained) {
            const reset = await requireJob(
              repository.appendInventory({
                ...fence(current, now()),
                inventoryComplete: false,
                items: [],
                resetExistingInventory: true,
                scanPhase: "restart-after-late-writer",
              }),
            );
            return waiting(reset, now() + initialRetryDelayMs);
          }
          await target.excludeTargetFromPublishedHead({ job: current, signal });
          return progressed(await advance(repository, current, "deleting_objects", now()));
        }
        case "deleting_objects": {
          const items = await repository.claimItems({
            ...fence(job, now()),
            limit: itemBatchSize,
          });
          if (items.length === 0) {
            return progressed(await advance(repository, job, "deleting_derived_data", now()));
          }
          for (const item of items) {
            try {
              await target.executeExternalItem({ item, job, signal });
              await requireItem(
                repository.completeItem({
                  ...fence(job, now()),
                  expectedItemRowVersion: item.rowVersion,
                  itemId: item.id,
                }),
              );
            } catch (error) {
              const classification = classifyItemError(error, item);
              const dead = !classification.retryable || item.attempts + 1 >= item.maxAttempts;
              const retryAt =
                now() + retryDelay(item.attempts, initialRetryDelayMs, maxRetryDelayMs);
              await requireItem(
                repository.scheduleItemRetry({
                  ...fence(job, now()),
                  deadLetter: dead,
                  errorCode: classification.code,
                  errorMessage: classification.message,
                  expectedItemRowVersion: item.rowVersion,
                  itemId: item.id,
                  retryAt: iso(retryAt),
                }),
              );
              return dead
                ? { disposition: "failed_persisted", error: classification, job }
                : waiting(job, retryAt, "failure");
            }
          }
          return progressed(job);
        }
        case "deleting_derived_data": {
          const result = await target.deleteDerivedDataPage({
            job,
            limit: inventoryPageSize,
            signal,
          });
          if (result.complete) {
            return progressed(await advance(repository, job, "deleting_primary_data", now()));
          }
          return result.deleted > 0 ? progressed(job) : waiting(job, now() + initialRetryDelayMs);
        }
        case "deleting_primary_data": {
          try {
            const completed = await requireJob(
              repository.completeJob({
                ...fence(job, now()),
                deleteAndProbePrimaryData: ({ job: lockedJob, transaction }) =>
                  target.deletePrimaryData({
                    job: lockedJob,
                    leaseFence: primaryDeleteFence(lockedJob),
                    signal,
                    transaction,
                  }),
              }),
            );
            return { disposition: "completed", job: completed };
          } catch (error) {
            if (!(error instanceof DurableDeletionPrimaryResidueDirtyError)) throw error;
            const reconciled = await requireJob(
              repository.reconcileDirtyPrimary(fence(job, now())),
            );
            return progressed(reconciled);
          }
        }
        case "completed":
          return { disposition: "completed", job };
      }
    },
  };
}

function assertInventoryOrdinals(page: DurableDeletionInventoryPage): void {
  const ordinals = new Set<number>();
  for (const item of page.items) {
    if (!Number.isSafeInteger(item.ordinal) || item.ordinal < 1) {
      throw new Error(
        "Durable deletion inventory ordinals must be deterministic job-global integers starting at 1; ordinal 0 is reserved",
      );
    }
    if (ordinals.has(item.ordinal)) {
      throw new Error(`Durable deletion inventory page contains duplicate ordinal ${item.ordinal}`);
    }
    ordinals.add(item.ordinal);
  }
}

function fence(job: DurableDeletionJob, timestamp: number) {
  if (!job.leaseToken) throw new DurableDeletionProcessorLeaseLostError();
  return {
    deletionJobId: job.id,
    expectedRowVersion: job.rowVersion,
    leaseToken: job.leaseToken,
    now: iso(timestamp),
  };
}

function primaryDeleteFence(job: DurableDeletionJob) {
  if (!job.leaseToken) throw new DurableDeletionProcessorLeaseLostError();
  return {
    deletionJobId: job.id,
    expectedRowVersion: job.rowVersion,
    leaseToken: job.leaseToken,
  };
}

async function advance(
  repository: Pick<DurableDeletionRepository, "advanceCheckpoint">,
  job: DurableDeletionJob,
  nextCheckpoint:
    | "deleting_derived_data"
    | "deleting_objects"
    | "deleting_primary_data"
    | "quiescing",
  timestamp: number,
): Promise<DurableDeletionJob> {
  return requireJob(repository.advanceCheckpoint({ ...fence(job, timestamp), nextCheckpoint }));
}

async function requireJob(value: Promise<DurableDeletionJob | null>): Promise<DurableDeletionJob> {
  const result = await value;
  if (!result) throw new DurableDeletionProcessorLeaseLostError();
  return result;
}

async function requireItem(
  value: Promise<DurableDeletionJobItem | null>,
): Promise<DurableDeletionJobItem> {
  const result = await value;
  if (!result) throw new DurableDeletionProcessorLeaseLostError();
  return result;
}

function assertRunning(job: DurableDeletionJob): void {
  if (job.runState !== "running" || !job.leaseToken || !job.leaseExpiresAt) {
    throw new DurableDeletionProcessorLeaseLostError();
  }
}

function requireCapabilities(
  capabilities: DurableDeletionTargetCapabilities,
  label: string,
): DurableDeletionTargetCapabilities {
  for (const method of [
    "deleteDerivedDataPage",
    "deletePrimaryData",
    "excludeTargetFromPublishedHead",
    "executeExternalItem",
    "inventory",
    "quiesce",
  ] as const) {
    if (typeof capabilities?.[method] !== "function") {
      throw new Error(`Durable deletion ${label}.${method} is required`);
    }
  }
  return capabilities;
}

function progressed(job: DurableDeletionJob): DurableDeletionTargetProcessResult {
  return { disposition: "progressed", job };
}

function waiting(
  job: DurableDeletionJob,
  retryAt: number,
  attemptBudget: "cooperative" | "failure" = "cooperative",
): DurableDeletionTargetProcessResult {
  return { attemptBudget, disposition: "waiting", job, retryAt: iso(retryAt) };
}

function retryDelay(attempt: number, initial: number, maximum: number): number {
  return Math.min(maximum, initial * 2 ** Math.max(0, attempt));
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function defaultItemErrorClassification(error: unknown): DurableDeletionItemErrorClassification {
  return {
    code: "DURABLE_DELETION_ITEM_FAILED",
    message: error instanceof Error ? error.message : "Durable deletion item failed",
    retryable: true,
  };
}
