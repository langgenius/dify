export interface ResearchModelTokenUsage {
  readonly completionTokens?: number | undefined;
  readonly promptTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
}

export interface ResearchModelCallDescriptor {
  /** Unique within one durable execution attempt. */
  readonly callId: string;
  readonly estimatedPromptTokens: number;
  readonly maxOutputTokens: number;
  readonly model: string;
  readonly provider: string;
  readonly step:
    | "pageindex.layer"
    | "pageindex.semantic"
    | "pageindex.whole-tree"
    | "research.judge"
    | "research.plan"
    | "query.answer"
    | "query.image-expand";
}

export interface ResearchModelCallCompletion extends ResearchModelCallDescriptor {
  readonly metadata?: unknown;
  readonly status: "failed" | "succeeded";
}

export interface ResearchModelCallObserver {
  /** Persists a conservative reservation before the provider is invoked. */
  before(input: ResearchModelCallDescriptor): Promise<void>;
  /** Reconciles that reservation with provider-reported usage. */
  after(input: ResearchModelCallCompletion): Promise<void>;
}

export class ResearchModelCallObserverError extends Error {
  constructor(message: string, options: { readonly cause: unknown }) {
    super(message, { cause: options.cause });
    this.name = "ResearchModelCallObserverError";
  }
}

export async function notifyResearchModelCallBefore(
  observer: ResearchModelCallObserver | undefined,
  input: ResearchModelCallDescriptor,
): Promise<void> {
  if (!observer) return;
  try {
    await observer.before(input);
  } catch (error) {
    throw new ResearchModelCallObserverError("Research model call reservation failed", {
      cause: error,
    });
  }
}

export async function notifyResearchModelCallAfter(
  observer: ResearchModelCallObserver | undefined,
  input: ResearchModelCallCompletion,
): Promise<void> {
  if (!observer) return;
  try {
    await observer.after(input);
  } catch (error) {
    throw new ResearchModelCallObserverError("Research model call accounting failed", {
      cause: error,
    });
  }
}

export interface ResearchModelPricing {
  readonly inputPerTokenUsd: number;
  readonly outputPerTokenUsd: number;
}

export interface ResearchModelCallCost {
  readonly costUsd: number;
  readonly estimated: boolean;
  readonly usage: {
    readonly completionTokens: number;
    readonly promptTokens: number;
    readonly totalTokens: number;
  };
}

export function parseResearchModelUsage(metadata: unknown): ResearchModelTokenUsage | undefined {
  if (!isRecord(metadata)) return undefined;
  const usage = isRecord(metadata.usage) ? metadata.usage : undefined;
  if (!usage) return undefined;
  const completionTokens = tokenCount(usage.completionTokens ?? usage.completion_tokens);
  const promptTokens = tokenCount(usage.promptTokens ?? usage.prompt_tokens);
  const totalTokens = tokenCount(usage.totalTokens ?? usage.total_tokens);
  if (completionTokens === undefined && promptTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

export function calculateResearchModelCallCost({
  fallback,
  metadata,
  pricing,
}: {
  readonly fallback: { readonly completionTokens: number; readonly promptTokens: number };
  readonly metadata: unknown;
  readonly pricing: ResearchModelPricing;
}): ResearchModelCallCost {
  validatePricing(pricing);
  const parsed = parseResearchModelUsage(metadata);
  const promptTokens = parsed?.promptTokens ?? fallback.promptTokens;
  const completionTokens = parsed?.completionTokens ?? fallback.completionTokens;
  const totalTokens = parsed?.totalTokens ?? promptTokens + completionTokens;
  for (const [label, value] of [
    ["promptTokens", promptTokens],
    ["completionTokens", completionTokens],
    ["totalTokens", totalTokens],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Research model usage ${label} must be a non-negative integer`);
    }
  }
  return {
    costUsd: roundCurrency(
      promptTokens * pricing.inputPerTokenUsd + completionTokens * pricing.outputPerTokenUsd,
    ),
    estimated: parsed?.promptTokens === undefined || parsed.completionTokens === undefined,
    usage: { completionTokens, promptTokens, totalTokens },
  };
}

export function estimateResearchModelPromptTokens(value: unknown): number {
  return Math.ceil(new TextEncoder().encode(JSON.stringify(value)).byteLength / 2) + 32;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validatePricing(pricing: ResearchModelPricing): void {
  for (const [label, value] of Object.entries(pricing)) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Research model pricing ${label} must be non-negative and finite`);
    }
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}
