export interface ApiDatabaseStartupEnv {
  readonly DATABASE_URL?: string | undefined;
  readonly KNOWLEDGE_DATABASE_STARTUP_RETRY_INTERVAL_MS?: string | undefined;
  readonly KNOWLEDGE_DATABASE_STARTUP_TIMEOUT_MS?: string | undefined;
}

export interface ApiDatabaseStartupRetryEvent {
  readonly attempt: number;
  readonly code: string;
  readonly delayMs: number;
}

export interface WaitForApiDatabaseStartupInput {
  readonly env?: ApiDatabaseStartupEnv | undefined;
  readonly now?: (() => number) | undefined;
  readonly onRetry?: ((event: ApiDatabaseStartupRetryEvent) => void) | undefined;
  readonly operation: () => Promise<void>;
  readonly sleep?: ((delayMs: number) => Promise<void>) | undefined;
}

const defaultRetryIntervalMs = 2_000;
const defaultTimeoutMs = 120_000;
const transientCodes = new Set([
  "57P01",
  "57P02",
  "57P03",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);
const transientMessageFragments = [
  "connection terminated",
  "connection timeout",
  "connection failure",
  "database system is in recovery mode",
  "database system is starting up",
  "the database system is not yet accepting connections",
];

export async function waitForApiDatabaseStartup({
  env = process.env,
  now = Date.now,
  onRetry,
  operation,
  sleep = sleepFor,
}: WaitForApiDatabaseStartupInput): Promise<void> {
  if (!env.DATABASE_URL?.trim()) return;

  const timeoutMs = positiveInteger(
    env.KNOWLEDGE_DATABASE_STARTUP_TIMEOUT_MS,
    defaultTimeoutMs,
    "KNOWLEDGE_DATABASE_STARTUP_TIMEOUT_MS",
    1_000,
  );
  const retryIntervalMs = positiveInteger(
    env.KNOWLEDGE_DATABASE_STARTUP_RETRY_INTERVAL_MS,
    defaultRetryIntervalMs,
    "KNOWLEDGE_DATABASE_STARTUP_RETRY_INTERVAL_MS",
    100,
  );
  const deadline = now() + timeoutMs;
  let attempt = 1;

  while (true) {
    try {
      await operation();
      return;
    } catch (error) {
      const classification = classifyTransientDatabaseError(error);
      if (!classification) throw error;

      const remainingMs = deadline - now();
      if (remainingMs <= 0) throw error;

      const delayMs = Math.min(retryIntervalMs, remainingMs);
      onRetry?.({
        attempt,
        code: classification,
        delayMs,
      });
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

function classifyTransientDatabaseError(error: unknown): string | undefined {
  const visited = new Set<object>();
  let current: unknown = error;

  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);
    const candidate = current as {
      readonly cause?: unknown;
      readonly code?: unknown;
      readonly message?: unknown;
    };
    const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : undefined;
    if (code && (transientCodes.has(code) || code.startsWith("08"))) {
      return code;
    }
    if (typeof candidate.message === "string") {
      const normalizedMessage = candidate.message.toLowerCase();
      if (transientMessageFragments.some((fragment) => normalizedMessage.includes(fragment))) {
        return code ?? "CONNECTION_UNAVAILABLE";
      }
    }
    current = candidate.cause;
  }

  return undefined;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
): number {
  const raw = value?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return parsed;
}

function sleepFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
