import {
  KnowledgeSpaceEmbeddingProfileSchema,
  KnowledgeSpaceRetrievalProfileSchema,
} from "@knowledge/core";

import type {
  KnowledgeSpaceProfileBackfill,
  KnowledgeSpaceProfileBackfillRepository,
} from "./knowledge-space-profile-backfill";
import type { KnowledgeSpaceProfilePublicationRepository } from "./knowledge-space-profile-publication-repository";
import {
  type ModelCapabilityPreflight,
  ModelCapabilityPreflightError,
} from "./model-capability-preflight";

export interface KnowledgeSpaceProfileBackfillRuntimeOptions {
  readonly claimLimit: number;
  readonly discoveryLimit: number;
  readonly leaseMs: number;
  readonly now?: (() => number) | undefined;
  readonly preflight: ModelCapabilityPreflight;
  readonly publicationBindings: Pick<
    KnowledgeSpaceProfilePublicationRepository,
    "bindCurrentPublished"
  >;
  readonly repository: KnowledgeSpaceProfileBackfillRepository;
  readonly workerId: string;
}

export interface KnowledgeSpaceProfileBackfillRuntimeResult {
  readonly activated: number;
  readonly bindingFailed: number;
  readonly bindingsReconciled: number;
  readonly claimed: number;
  readonly discovered: number;
  readonly failed: number;
  readonly scanned: number;
}

export interface KnowledgeSpaceProfileBackfillRuntime {
  tick(): Promise<KnowledgeSpaceProfileBackfillRuntimeResult>;
}

/**
 * One bounded scheduler tick. The durable repository owns every correctness fence; this runtime
 * only advances a keyset discovery cursor, claims a bounded batch, and records unexpected errors.
 */
export function createKnowledgeSpaceProfileBackfillRuntime({
  claimLimit,
  discoveryLimit,
  leaseMs,
  now = Date.now,
  preflight,
  publicationBindings,
  repository,
  workerId,
}: KnowledgeSpaceProfileBackfillRuntimeOptions): KnowledgeSpaceProfileBackfillRuntime {
  positiveInteger(claimLimit, "claimLimit");
  positiveInteger(discoveryLimit, "discoveryLimit");
  positiveInteger(leaseMs, "leaseMs");
  const normalizedWorkerId = workerId.trim();
  if (!normalizedWorkerId) {
    throw new Error("Knowledge-space profile backfill workerId must not be empty");
  }

  let discoveryCursor: string | undefined;
  let active: Promise<KnowledgeSpaceProfileBackfillRuntimeResult> | undefined;

  const runTick = async (): Promise<KnowledgeSpaceProfileBackfillRuntimeResult> => {
    const discoveryNow = iso(now());
    const discovery = await repository.discover({
      ...(discoveryCursor ? { afterKnowledgeSpaceId: discoveryCursor } : {}),
      limit: discoveryLimit,
      now: discoveryNow,
    });
    discoveryCursor = discovery.nextKnowledgeSpaceId;

    const claimTime = now();
    const claimNow = iso(claimTime);
    const jobs = await repository.claim({
      leaseExpiresAt: iso(claimTime + leaseMs),
      limit: claimLimit,
      now: claimNow,
      workerId: normalizedWorkerId,
    });
    let activated = 0;
    let bindingFailed = 0;
    let bindingsReconciled = 0;
    let failed = 0;
    for (const job of jobs) {
      const fence = {
        expectedRowVersion: job.rowVersion,
        jobId: job.id,
        leaseToken: requiredLeaseToken(job.leaseToken),
        now: iso(now()),
      };
      try {
        const capabilitySnapshot = await preflightBackfillProfile(preflight, job);
        const result = await repository.process({ ...fence, capabilitySnapshot });
        if (result.activated) activated += 1;
        if (result.job.runState === "failed") failed += 1;
      } catch (error) {
        const failure = safeBackfillFailure(error);
        try {
          const recorded = await repository.fail({
            ...fence,
            errorCode: failure.code,
            errorMessage: failure.message,
          });
          if (recorded?.runState === "failed") failed += 1;
        } catch {
          // The lease may have expired or been recovered. Its new owner is authoritative.
        }
      }
    }
    for (const scope of uniqueScopes(discovery.bindingCandidates)) {
      try {
        await publicationBindings.bindCurrentPublished({
          ...scope,
          verifiedAt: iso(now()),
        });
        bindingsReconciled += 1;
      } catch (error) {
        if (!isBindingNotReady(error)) bindingFailed += 1;
      }
    }
    return {
      activated,
      bindingFailed,
      bindingsReconciled,
      claimed: jobs.length,
      discovered: discovery.created,
      failed,
      scanned: discovery.scanned,
    };
  };

  return {
    tick: () => {
      active ??= runTick().finally(() => {
        active = undefined;
      });
      return active;
    },
  };
}

async function preflightBackfillProfile(
  preflight: ModelCapabilityPreflight,
  job: KnowledgeSpaceProfileBackfill,
): Promise<Readonly<Record<string, unknown>>> {
  if (job.kind === "embedding") {
    const profile = KnowledgeSpaceEmbeddingProfileSchema.parse(job.sourceSnapshot);
    return preflight.verify({
      kind: "embedding",
      selection: profile,
      tenantId: job.tenantId,
    });
  }
  const profile = KnowledgeSpaceRetrievalProfileSchema.parse(job.sourceSnapshot);
  const [reasoning, rerank] = await Promise.all([
    preflight.verify({
      kind: "reasoning",
      selection: profile.reasoningModel,
      tenantId: job.tenantId,
    }),
    profile.rerank.enabled && profile.rerank.model
      ? preflight.verify({
          kind: "rerank",
          selection: profile.rerank.model,
          tenantId: job.tenantId,
        })
      : null,
  ]);
  return { reasoning, rerank, verification: "verified" };
}

function safeBackfillFailure(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof ModelCapabilityPreflightError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "PROFILE_BACKFILL_CAPABILITY_INVALID",
    message: "Legacy profile capability verification failed",
  };
}

function uniqueScopes<T extends { readonly knowledgeSpaceId: string; readonly tenantId: string }>(
  scopes: readonly T[],
): readonly T[] {
  return [
    ...new Map(
      scopes.map((scope) => [`${scope.tenantId}\u0000${scope.knowledgeSpaceId}`, scope]),
    ).values(),
  ];
}

function isBindingNotReady(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = String(error.code);
  return (
    code === "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_HEAD_MISSING" ||
    code === "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_RETRIEVAL_PROFILE_REQUIRED" ||
    code === "KNOWLEDGE_SPACE_PROFILE_PUBLICATION_NOT_READY"
  );
}

function requiredLeaseToken(value: string | undefined): string {
  if (!value) throw new Error("Claimed profile backfill is missing its lease token");
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Knowledge-space profile backfill runtime ${name} must be a positive integer`);
  }
  return value;
}

function iso(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Knowledge-space profile backfill runtime clock must be finite");
  }
  return new Date(value).toISOString();
}
