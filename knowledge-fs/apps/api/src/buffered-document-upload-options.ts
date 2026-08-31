import {
  type BufferedDocumentUploadAdmission,
  DEFAULT_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS,
  DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY,
  DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES,
  DEFAULT_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS,
  DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_BYTES,
  DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_FILES,
  HARD_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES,
  bufferedDocumentUploadReservationBytes,
  createBufferedDocumentUploadAdmission,
} from "@knowledge/api";

export interface ApiBufferedDocumentUploadEnv {
  readonly KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS?: string | undefined;
  readonly KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY?: string | undefined;
  readonly KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES?: string | undefined;
  readonly KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS?: string | undefined;
}

export interface ApiBufferedDocumentUploadOptions {
  readonly idleTimeoutMs: number;
  readonly maxConcurrency: number;
  readonly maxReservedBytes: number;
  readonly totalTimeoutMs: number;
}

const minimumReservedBytes = bufferedDocumentUploadReservationBytes(
  DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_BYTES,
  DEFAULT_BULK_DOCUMENT_UPLOAD_MAX_FILES,
);

export function createApiBufferedDocumentUploadOptions(
  env: ApiBufferedDocumentUploadEnv = process.env,
): ApiBufferedDocumentUploadOptions {
  const maxConcurrency = boundedInteger(
    env.KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY,
    DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY,
    "KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_CONCURRENCY",
    1,
    8,
  );
  const maxReservedBytes = boundedInteger(
    env.KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES,
    DEFAULT_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES,
    "KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES",
    1,
    HARD_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES,
  );
  if (maxReservedBytes < minimumReservedBytes) {
    throw new Error(
      `KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_MAX_RESERVED_BYTES must be at least ${minimumReservedBytes}`,
    );
  }
  const idleTimeoutMs = boundedInteger(
    env.KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS,
    DEFAULT_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS,
    "KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS",
    1,
    5 * 60_000,
  );
  const totalTimeoutMs = boundedInteger(
    env.KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS,
    DEFAULT_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS,
    "KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS",
    1,
    60 * 60_000,
  );
  if (totalTimeoutMs < idleTimeoutMs) {
    throw new Error(
      "KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_TOTAL_TIMEOUT_MS must be at least KNOWLEDGE_BUFFERED_DOCUMENT_UPLOAD_IDLE_TIMEOUT_MS",
    );
  }
  return { idleTimeoutMs, maxConcurrency, maxReservedBytes, totalTimeoutMs };
}

export function createApiBufferedDocumentUploadAdmission(
  env: ApiBufferedDocumentUploadEnv = process.env,
): BufferedDocumentUploadAdmission {
  const { maxConcurrency, maxReservedBytes } = createApiBufferedDocumentUploadOptions(env);
  return createBufferedDocumentUploadAdmission({ maxConcurrency, maxReservedBytes });
}

function boundedInteger(
  value: string | undefined,
  defaultValue: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined || value.length === 0 ? defaultValue : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a safe integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}
