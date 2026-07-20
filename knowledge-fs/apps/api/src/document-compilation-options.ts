export interface ApiDocumentCompilationEnv {
  readonly KNOWLEDGE_DOCUMENT_COMPILATION_BATCH_SIZE?: string;
  readonly KNOWLEDGE_DOCUMENT_COMPILATION_LEASE_MS?: string;
  readonly KNOWLEDGE_DOCUMENT_COMPILATION_MAX_ATTEMPTS?: string;
  readonly KNOWLEDGE_DOCUMENT_COMPILATION_OUTBOX_VISIBILITY_MS?: string;
  readonly KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_BASE_MS?: string;
  readonly KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_MAX_MS?: string;
  readonly KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME?: string;
  readonly KNOWLEDGE_DOCUMENT_COMPILATION_TICK_MS?: string;
}

export interface ApiDocumentCompilationOptions {
  readonly batchSize: number;
  readonly leaseMs: number;
  readonly maxAttempts: number;
  readonly outboxVisibilityMs: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
  readonly tickMs: number;
}

export interface ApiDocumentWriteSafetyInput {
  readonly durableCompilationEnabled: boolean;
  readonly production: boolean;
  readonly usesDatabaseRepositories: boolean;
}

/**
 * The API currently exposes mutation routes whenever it starts. Therefore there is no safe
 * read-only exception to these checks: database writes must go through durable generation
 * compilation, and a production process must never fall back to process-local repositories.
 */
export function assertApiDocumentWriteSafety({
  durableCompilationEnabled,
  production,
  usesDatabaseRepositories,
}: ApiDocumentWriteSafetyInput): void {
  if (production && !usesDatabaseRepositories) {
    throw new Error(
      "Production API requires database repositories; local repository fallback is not write-safe",
    );
  }
  if (usesDatabaseRepositories && !durableCompilationEnabled) {
    throw new Error(
      "Database-backed API requires KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME=on; synchronous uploads cannot publish an immutable generation",
    );
  }
}

/**
 * Durable document compilation is explicitly enabled because it owns background timers and queue
 * consumers. Once enabled, production assembly validates every required capability at startup.
 * Invalid values fail startup rather than silently falling back to an unsafe runtime profile.
 */
export function createApiDocumentCompilationOptions(
  env: ApiDocumentCompilationEnv = process.env,
): ApiDocumentCompilationOptions | undefined {
  const enabled = parseEnabled(env.KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME);
  if (!enabled) {
    return undefined;
  }

  const retryBaseMs = boundedIntegerEnv(
    env.KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_BASE_MS,
    5_000,
    "KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_BASE_MS",
    100,
  );
  const retryMaxMs = boundedIntegerEnv(
    env.KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_MAX_MS,
    300_000,
    "KNOWLEDGE_DOCUMENT_COMPILATION_RETRY_MAX_MS",
    retryBaseMs,
  );

  return {
    batchSize: boundedIntegerEnv(
      env.KNOWLEDGE_DOCUMENT_COMPILATION_BATCH_SIZE,
      10,
      "KNOWLEDGE_DOCUMENT_COMPILATION_BATCH_SIZE",
      1,
    ),
    leaseMs: boundedIntegerEnv(
      env.KNOWLEDGE_DOCUMENT_COMPILATION_LEASE_MS,
      60_000,
      "KNOWLEDGE_DOCUMENT_COMPILATION_LEASE_MS",
      1_000,
    ),
    maxAttempts: boundedIntegerEnv(
      env.KNOWLEDGE_DOCUMENT_COMPILATION_MAX_ATTEMPTS,
      5,
      "KNOWLEDGE_DOCUMENT_COMPILATION_MAX_ATTEMPTS",
      1,
    ),
    outboxVisibilityMs: boundedIntegerEnv(
      env.KNOWLEDGE_DOCUMENT_COMPILATION_OUTBOX_VISIBILITY_MS,
      60_000,
      "KNOWLEDGE_DOCUMENT_COMPILATION_OUTBOX_VISIBILITY_MS",
      1_000,
    ),
    retryBaseMs,
    retryMaxMs,
    tickMs: boundedIntegerEnv(
      env.KNOWLEDGE_DOCUMENT_COMPILATION_TICK_MS,
      1_000,
      "KNOWLEDGE_DOCUMENT_COMPILATION_TICK_MS",
      100,
    ),
  };
}

function parseEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return true;
  }

  throw new Error("KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME must be on/true/1 or off/false/0");
}

function boundedIntegerEnv(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
): number {
  const raw = value?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`${name} must be an integer of at least ${min}`);
  }

  return parsed;
}
