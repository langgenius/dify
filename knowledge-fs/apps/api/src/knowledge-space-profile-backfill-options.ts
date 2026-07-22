import { randomUUID } from "node:crypto";

import {
  type KnowledgeSpaceProfileBackfillRepository,
  type KnowledgeSpaceProfileBackfillRuntime,
  type KnowledgeSpaceProfilePublicationRepository,
  type ModelCapabilityPreflight,
  createKnowledgeSpaceProfileBackfillRuntime,
} from "@knowledge/api";

export interface ApiKnowledgeSpaceProfileBackfillEnv {
  readonly KNOWLEDGE_PROFILE_BACKFILL_CLAIM_BATCH?: string | undefined;
  readonly KNOWLEDGE_PROFILE_BACKFILL_DISCOVERY_BATCH?: string | undefined;
  readonly KNOWLEDGE_PROFILE_BACKFILL_INTERVAL_MS?: string | undefined;
  readonly KNOWLEDGE_PROFILE_BACKFILL_LEASE_MS?: string | undefined;
}

export interface ApiKnowledgeSpaceProfileBackfillAssembly {
  readonly runtime: KnowledgeSpaceProfileBackfillRuntime;
  start(): void;
  stop(): void;
}

/** Runs the durable legacy-manifest cutover on every database-backed API replica. */
export function createApiKnowledgeSpaceProfileBackfillAssembly(input: {
  readonly env?: ApiKnowledgeSpaceProfileBackfillEnv | undefined;
  readonly onError?: ((error: unknown) => void) | undefined;
  readonly preflight?: ModelCapabilityPreflight | undefined;
  readonly publicationBindings?:
    | Pick<KnowledgeSpaceProfilePublicationRepository, "bindCurrentPublished">
    | undefined;
  readonly repository?: KnowledgeSpaceProfileBackfillRepository | undefined;
}): ApiKnowledgeSpaceProfileBackfillAssembly | undefined {
  if (!input.repository) return undefined;
  if (!input.preflight || !input.publicationBindings) {
    throw new Error(
      "Knowledge-space profile backfill requires model preflight and publication binding reconciliation",
    );
  }
  const env = input.env ?? process.env;
  const intervalMs = positiveEnv(
    env.KNOWLEDGE_PROFILE_BACKFILL_INTERVAL_MS,
    1_000,
    "KNOWLEDGE_PROFILE_BACKFILL_INTERVAL_MS",
  );
  const runtime = createKnowledgeSpaceProfileBackfillRuntime({
    claimLimit: positiveEnv(
      env.KNOWLEDGE_PROFILE_BACKFILL_CLAIM_BATCH,
      10,
      "KNOWLEDGE_PROFILE_BACKFILL_CLAIM_BATCH",
    ),
    discoveryLimit: positiveEnv(
      env.KNOWLEDGE_PROFILE_BACKFILL_DISCOVERY_BATCH,
      100,
      "KNOWLEDGE_PROFILE_BACKFILL_DISCOVERY_BATCH",
    ),
    leaseMs: positiveEnv(
      env.KNOWLEDGE_PROFILE_BACKFILL_LEASE_MS,
      30_000,
      "KNOWLEDGE_PROFILE_BACKFILL_LEASE_MS",
    ),
    preflight: input.preflight,
    publicationBindings: input.publicationBindings,
    repository: input.repository,
    workerId: `knowledge-space-profile-backfill-${process.pid}-${randomUUID()}`,
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = () => void runtime.tick().catch((error) => input.onError?.(error));
  return {
    runtime,
    start: () => {
      if (timer) return;
      tick();
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
    },
    stop: () => {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
    },
  };
}

function positiveEnv(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}
