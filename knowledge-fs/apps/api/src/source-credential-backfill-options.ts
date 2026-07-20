import { randomUUID } from "node:crypto";

import {
  type SourceCredentialBackfillRepository,
  type SourceCredentialBackfillRuntime,
  type SourceRepository,
  type SourceSecretStore,
  createSourceCredentialBackfillRuntime,
} from "@knowledge/api";

export interface ApiSourceCredentialBackfillEnv {
  readonly KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_CLAIM_BATCH?: string | undefined;
  readonly KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_DISCOVERY_BATCH?: string | undefined;
  readonly KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_INTERVAL_MS?: string | undefined;
  readonly KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_LEASE_MS?: string | undefined;
  readonly KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_MAX_RETRIES?: string | undefined;
}

export interface ApiSourceCredentialBackfillAssembly {
  readonly runtime: SourceCredentialBackfillRuntime;
  start(): void;
  stop(): void;
}

/**
 * Installed only when all three durable boundaries exist: the database job repository, the
 * database source repository, and the encrypted SecretStore. There is intentionally no in-memory
 * job fallback because that would make rollout completion replica-local and crash-sensitive.
 */
export function createApiSourceCredentialBackfillAssembly(input: {
  readonly env?: ApiSourceCredentialBackfillEnv | undefined;
  readonly onError?:
    | ((input: { readonly error: unknown; readonly jobId?: string | undefined }) => void)
    | undefined;
  readonly repository?: SourceCredentialBackfillRepository | undefined;
  readonly secretStore?: SourceSecretStore | undefined;
  readonly sources?: Pick<SourceRepository, "get" | "update"> | undefined;
}): ApiSourceCredentialBackfillAssembly | undefined {
  if (!input.repository || !input.secretStore || !input.sources) {
    return undefined;
  }
  const env = input.env ?? process.env;
  const runtime = createSourceCredentialBackfillRuntime({
    discoveryBatchSize: positiveEnv(
      env.KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_DISCOVERY_BATCH,
      100,
      "KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_DISCOVERY_BATCH",
    ),
    intervalMs: positiveEnv(
      env.KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_INTERVAL_MS,
      1_000,
      "KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_INTERVAL_MS",
    ),
    leaseMs: positiveEnv(
      env.KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_LEASE_MS,
      30_000,
      "KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_LEASE_MS",
    ),
    maxClaimBatchSize: positiveEnv(
      env.KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_CLAIM_BATCH,
      10,
      "KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_CLAIM_BATCH",
    ),
    maxRetryCount: nonnegativeEnv(
      env.KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_MAX_RETRIES,
      5,
      "KNOWLEDGE_SOURCE_CREDENTIAL_BACKFILL_MAX_RETRIES",
    ),
    onError: ({ error, job }) => input.onError?.({ error, ...(job ? { jobId: job.id } : {}) }),
    repository: input.repository,
    secretStore: input.secretStore,
    sources: input.sources,
    workerId: `source-credential-backfill-${process.pid}-${randomUUID()}`,
  });
  let started = false;
  return {
    runtime,
    start: () => {
      if (started) {
        return;
      }
      started = true;
      runtime.start();
    },
    stop: () => {
      if (!started) {
        return;
      }
      runtime.stop();
      started = false;
    },
  };
}

function positiveEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function nonnegativeEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return parsed;
}
