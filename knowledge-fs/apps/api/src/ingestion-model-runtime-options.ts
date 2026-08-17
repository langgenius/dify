import {
  type ConcurrencyGate,
  type ConcurrencyGateEvent,
  type DocumentModelBudget,
  createConcurrencyGate,
  createDocumentModelBudget,
} from "@knowledge/api";

export interface ApiIngestionModelRuntimeEnv {
  readonly KNOWLEDGE_DOCUMENT_MODEL_MAX_ESTIMATED_TOKENS?: string | undefined;
  readonly KNOWLEDGE_DOCUMENT_MODEL_MAX_REQUESTS?: string | undefined;
  readonly KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY?: string | undefined;
  readonly KNOWLEDGE_OUTLINE_SUMMARY_BATCH_MAX_INPUT_CHARS?: string | undefined;
  readonly KNOWLEDGE_OUTLINE_SUMMARY_BATCH_SIZE?: string | undefined;
  readonly KNOWLEDGE_OUTLINE_SUMMARY_MAX_CONCURRENCY?: string | undefined;
  readonly KNOWLEDGE_SEMANTIC_EXTRACTION_BATCH_SIZE?: string | undefined;
  readonly KNOWLEDGE_SEMANTIC_EXTRACTION_MAX_CONCURRENCY?: string | undefined;
}

export interface ApiIngestionModelRuntimeOptions {
  readonly createDocumentModelBudget: () => DocumentModelBudget;
  readonly documentModelMaxEstimatedTokens: number;
  readonly documentModelMaxRequests: number;
  readonly globalConcurrency: number;
  readonly modelRequestGate: ConcurrencyGate;
  readonly outlineSummaryBatchMaxInputChars: number;
  readonly outlineSummaryBatchSize: number;
  readonly outlineSummaryMaxConcurrency: number;
  readonly semanticExtractionBatchSize: number;
  readonly semanticExtractionMaxConcurrency: number;
}

export interface ApiIngestionModelRuntimeMetrics {
  record(metric: ConcurrencyGateEvent): Promise<void> | void;
}

const DEFAULT_GLOBAL_CONCURRENCY = 16;
const DEFAULT_DOCUMENT_MODEL_MAX_ESTIMATED_TOKENS = 2_000_000;
const DEFAULT_DOCUMENT_MODEL_MAX_REQUESTS = 500;
const DEFAULT_OUTLINE_SUMMARY_BATCH_MAX_INPUT_CHARS = 32_000;
const DEFAULT_OUTLINE_SUMMARY_BATCH_SIZE = 8;
const DEFAULT_OUTLINE_SUMMARY_MAX_CONCURRENCY = 8;
const MAX_GLOBAL_CONCURRENCY = 128;
const MAX_DOCUMENT_MODEL_MAX_ESTIMATED_TOKENS = 20_000_000;
const MAX_DOCUMENT_MODEL_MAX_REQUESTS = 5_000;
const MAX_OUTLINE_SUMMARY_BATCH_INPUT_CHARS = 200_000;
const MAX_OUTLINE_SUMMARY_BATCH_SIZE = 32;
const MAX_OUTLINE_SUMMARY_CONCURRENCY = 32;
const DEFAULT_SEMANTIC_EXTRACTION_BATCH_SIZE = 8;
const DEFAULT_SEMANTIC_EXTRACTION_MAX_CONCURRENCY = 4;
const MAX_SEMANTIC_EXTRACTION_BATCH_SIZE = 32;
const MAX_SEMANTIC_EXTRACTION_CONCURRENCY = 32;

/**
 * Builds the shared ingestion-time model budget. The per-document outline bound protects fairness
 * inside one compilation, while the process-wide FIFO gate caps aggregate model pressure across
 * simultaneous outline and semantic-enrichment work.
 */
export function createApiIngestionModelRuntimeOptions(
  env: ApiIngestionModelRuntimeEnv = process.env,
  metrics?: ApiIngestionModelRuntimeMetrics,
): ApiIngestionModelRuntimeOptions {
  const globalConcurrency = boundedPositiveIntegerEnv({
    fallback: DEFAULT_GLOBAL_CONCURRENCY,
    max: MAX_GLOBAL_CONCURRENCY,
    name: "KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY",
    value: env.KNOWLEDGE_MODEL_RUNTIME_GLOBAL_CONCURRENCY,
  });
  const documentModelMaxEstimatedTokens = boundedPositiveIntegerEnv({
    fallback: DEFAULT_DOCUMENT_MODEL_MAX_ESTIMATED_TOKENS,
    max: MAX_DOCUMENT_MODEL_MAX_ESTIMATED_TOKENS,
    name: "KNOWLEDGE_DOCUMENT_MODEL_MAX_ESTIMATED_TOKENS",
    value: env.KNOWLEDGE_DOCUMENT_MODEL_MAX_ESTIMATED_TOKENS,
  });
  const documentModelMaxRequests = boundedPositiveIntegerEnv({
    fallback: DEFAULT_DOCUMENT_MODEL_MAX_REQUESTS,
    max: MAX_DOCUMENT_MODEL_MAX_REQUESTS,
    name: "KNOWLEDGE_DOCUMENT_MODEL_MAX_REQUESTS",
    value: env.KNOWLEDGE_DOCUMENT_MODEL_MAX_REQUESTS,
  });
  const outlineSummaryMaxConcurrency = boundedPositiveIntegerEnv({
    fallback: DEFAULT_OUTLINE_SUMMARY_MAX_CONCURRENCY,
    max: MAX_OUTLINE_SUMMARY_CONCURRENCY,
    name: "KNOWLEDGE_OUTLINE_SUMMARY_MAX_CONCURRENCY",
    value: env.KNOWLEDGE_OUTLINE_SUMMARY_MAX_CONCURRENCY,
  });
  const outlineSummaryBatchSize = boundedPositiveIntegerEnv({
    fallback: DEFAULT_OUTLINE_SUMMARY_BATCH_SIZE,
    max: MAX_OUTLINE_SUMMARY_BATCH_SIZE,
    name: "KNOWLEDGE_OUTLINE_SUMMARY_BATCH_SIZE",
    value: env.KNOWLEDGE_OUTLINE_SUMMARY_BATCH_SIZE,
  });
  const outlineSummaryBatchMaxInputChars = boundedPositiveIntegerEnv({
    fallback: DEFAULT_OUTLINE_SUMMARY_BATCH_MAX_INPUT_CHARS,
    max: MAX_OUTLINE_SUMMARY_BATCH_INPUT_CHARS,
    name: "KNOWLEDGE_OUTLINE_SUMMARY_BATCH_MAX_INPUT_CHARS",
    value: env.KNOWLEDGE_OUTLINE_SUMMARY_BATCH_MAX_INPUT_CHARS,
  });
  const semanticExtractionBatchSize = boundedPositiveIntegerEnv({
    fallback: DEFAULT_SEMANTIC_EXTRACTION_BATCH_SIZE,
    max: MAX_SEMANTIC_EXTRACTION_BATCH_SIZE,
    name: "KNOWLEDGE_SEMANTIC_EXTRACTION_BATCH_SIZE",
    value: env.KNOWLEDGE_SEMANTIC_EXTRACTION_BATCH_SIZE,
  });
  const semanticExtractionMaxConcurrency = boundedPositiveIntegerEnv({
    fallback: DEFAULT_SEMANTIC_EXTRACTION_MAX_CONCURRENCY,
    max: MAX_SEMANTIC_EXTRACTION_CONCURRENCY,
    name: "KNOWLEDGE_SEMANTIC_EXTRACTION_MAX_CONCURRENCY",
    value: env.KNOWLEDGE_SEMANTIC_EXTRACTION_MAX_CONCURRENCY,
  });

  return {
    createDocumentModelBudget: () =>
      createDocumentModelBudget({
        maxEstimatedTokens: documentModelMaxEstimatedTokens,
        maxRequests: documentModelMaxRequests,
      }),
    documentModelMaxEstimatedTokens,
    documentModelMaxRequests,
    globalConcurrency,
    modelRequestGate: createConcurrencyGate(globalConcurrency, {
      onEvent: (event) => metrics?.record(event),
    }),
    outlineSummaryBatchMaxInputChars,
    outlineSummaryBatchSize,
    outlineSummaryMaxConcurrency,
    semanticExtractionBatchSize,
    semanticExtractionMaxConcurrency,
  };
}

function boundedPositiveIntegerEnv({
  fallback,
  max,
  name,
  value,
}: {
  readonly fallback: number;
  readonly max: number;
  readonly name: string;
  readonly value: string | undefined;
}): number {
  const normalized = value?.trim();
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return parsed;
}
