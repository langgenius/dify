import type { IngestionModelStage } from "./ingestion-model-observability";

export interface DocumentModelBudgetReservation {
  readonly estimatedTokens?: number | undefined;
  readonly itemCount: number;
  readonly stage: IngestionModelStage;
}

export interface DocumentModelBudgetSnapshot {
  readonly estimatedTokensReserved: number;
  readonly maxEstimatedTokens: number;
  readonly maxRequests: number;
  readonly requestsReserved: number;
  readonly stageRequests: Readonly<Partial<Record<IngestionModelStage, number>>>;
}

export interface DocumentModelBudget {
  reserve(input: DocumentModelBudgetReservation): void;
  snapshot(): DocumentModelBudgetSnapshot;
}

export class DocumentModelBudgetExceededError extends Error {
  readonly code = "DOCUMENT_MODEL_BUDGET_EXCEEDED";

  constructor(message: string) {
    super(message);
    this.name = "DocumentModelBudgetExceededError";
  }
}

/**
 * Per-compilation admission budget. Token reservations are deliberately labelled as estimates;
 * provider-reported usage continues to be emitted separately by operational metrics.
 */
export function createDocumentModelBudget(options: {
  readonly maxEstimatedTokens: number;
  readonly maxRequests: number;
}): DocumentModelBudget {
  positiveInteger(options.maxRequests, "maxRequests");
  positiveInteger(options.maxEstimatedTokens, "maxEstimatedTokens");
  let requestsReserved = 0;
  let estimatedTokensReserved = 0;
  const stageRequests: Partial<Record<IngestionModelStage, number>> = {};

  return {
    reserve: ({ estimatedTokens = 0, itemCount, stage }) => {
      nonnegativeInteger(estimatedTokens, "estimatedTokens");
      positiveInteger(itemCount, "itemCount");
      if (requestsReserved + 1 > options.maxRequests) {
        throw new DocumentModelBudgetExceededError(
          `Document model request budget exceeded maxRequests=${options.maxRequests}`,
        );
      }
      if (estimatedTokensReserved + estimatedTokens > options.maxEstimatedTokens) {
        throw new DocumentModelBudgetExceededError(
          `Document model token budget exceeded maxEstimatedTokens=${options.maxEstimatedTokens}`,
        );
      }
      requestsReserved += 1;
      estimatedTokensReserved += estimatedTokens;
      stageRequests[stage] = (stageRequests[stage] ?? 0) + 1;
    },
    snapshot: () => ({
      estimatedTokensReserved,
      maxEstimatedTokens: options.maxEstimatedTokens,
      maxRequests: options.maxRequests,
      requestsReserved,
      stageRequests: { ...stageRequests },
    }),
  };
}

/** Conservative provider-independent admission estimate; never reported as actual token usage. */
export function estimateDocumentModelTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(new TextEncoder().encode(text).byteLength / 3));
}

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Document model budget ${label} must be a positive integer`);
  }
}

function nonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Document model budget ${label} must be a non-negative integer`);
  }
}
