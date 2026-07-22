import type { Source } from "@knowledge/core";

import { safeSourceOperationError } from "./source-operation-error";
import { type SourceRepository, SourceVersionConflictError } from "./source-repository";
import { computeNextSyncAt, readSourceSyncPolicy, readSourceSyncState } from "./source-sync-policy";
import type { SourceSyncRunner } from "./source-sync-runner";

export interface SourceSyncTickResult {
  readonly due: number;
  readonly failed: number;
  readonly scanned: number;
  readonly skippedInFlight: number;
  readonly skippedNoTenant: number;
  readonly synced: number;
}

export interface SourceSyncScheduler {
  /** Starts the periodic tick; returns a stop function. Safe to call once. */
  start(): () => void;
  /** Runs one scheduling pass; exposed for tests and manual triggering. */
  tick(): Promise<SourceSyncTickResult>;
}

export interface SourceSyncSchedulerOptions {
  readonly intervalMs: number;
  readonly maxSourcesPerTick: number;
  readonly now?: () => Date;
  readonly onSyncError?: ((input: { error: unknown; source: Source }) => void) | undefined;
  readonly runner: SourceSyncRunner;
  readonly sources: SourceRepository;
  /** A sync stuck in `syncing` longer than this is considered stale and retried. */
  readonly staleSyncMs?: number;
  /** Attributed as the connector user for scheduled runs. */
  readonly syncUserId?: string;
}

const LIST_PAGE_SIZE = 100;

/**
 * Periodically scans sources for a `metadata.syncPolicy` and runs due syncs via the runner.
 * Dueness is `metadata.syncState.nextSyncAt` (seeded from the policy anchored at the last sync,
 * falling back to the source's `updatedAt`); after every run the scheduler records
 * `syncState.{lastSyncAt,lastSyncStatus,lastSyncError?,lastSyncErrorCode?,nextSyncAt}`. The owning
 * tenant is read from `metadata.tenantId` (stamped by the source create/update handlers) — sources
 * without it are skipped.
 *
 * Multi-replica safe: every replica may run the scheduler. Mutual exclusion per source is an
 * atomic `claimForSync` (a conditional UPDATE in database mode — the database serializes
 * concurrent claims), followed by a post-claim dueness re-check so a replica that lost the race
 * releases the claim instead of re-running a just-finished sync. Claims stuck in `syncing` (a
 * crashed holder) become re-claimable after `staleSyncMs`; a legitimately long-running sync must
 * finish within `staleSyncMs` or another replica may re-claim it — size it to your slowest
 * connector.
 */
export function createSourceSyncScheduler({
  intervalMs,
  maxSourcesPerTick,
  now = () => new Date(),
  onSyncError,
  runner,
  sources,
  staleSyncMs = 30 * 60_000,
  syncUserId = "source-sync-scheduler",
}: SourceSyncSchedulerOptions): SourceSyncScheduler {
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error("Source sync scheduler intervalMs must be at least 1000");
  }

  if (!Number.isInteger(maxSourcesPerTick) || maxSourcesPerTick < 1) {
    throw new Error("Source sync scheduler maxSourcesPerTick must be at least 1");
  }

  let ticking = false;

  async function syncClaimedSource(
    claimed: Source,
    policy: NonNullable<ReturnType<typeof readSourceSyncPolicy>>,
    tenantId: string,
    nowIso: string,
  ): Promise<"failed" | "skippedInFlight" | "synced"> {
    // Bind all later writes to the exact row claimed by this scheduler. A credential rotation,
    // policy edit, deletion fence, or another pod's claim invalidates this run instead of letting
    // a stale runner take ownership of the newer source version.
    let started: Source | null;
    try {
      started = await sources.update({
        expectedVersion: claimed.version,
        id: claimed.id,
        knowledgeSpaceId: claimed.knowledgeSpaceId,
        metadata: {
          ...claimed.metadata,
          syncState: { ...readSourceSyncState(claimed.metadata), syncStartedAt: nowIso },
        },
      });
    } catch (error) {
      if (error instanceof SourceVersionConflictError) return "skippedInFlight";
      throw error;
    }
    if (!started) return "skippedInFlight";

    let failure: unknown;
    let outcome: Awaited<ReturnType<SourceSyncRunner["sync"]>> | undefined;

    try {
      outcome = await runner.sync({ source: started, tenantId, userId: syncUserId });
    } catch (error) {
      failure = error ?? new Error("sync failed");
      onSyncError?.({ error: failure, source: started });
    }
    if (!failure && outcome?.kind === "none") return "skippedInFlight";
    const safeFailure = failure ? safeSourceOperationError("sync", failure) : undefined;

    const fresh = await sources.get({ id: started.id, knowledgeSpaceId: started.knowledgeSpaceId });
    const stillOwnsUnchangedClaim =
      fresh?.version === started.version && fresh.status === "syncing";
    const runnerCommitted = safeFailure ? fresh?.status === "error" : fresh?.status === "active";
    if (!fresh || (!stillOwnsUnchangedClaim && !runnerCommitted)) {
      return "skippedInFlight";
    }
    try {
      const recorded = await sources.update({
        expectedVersion: fresh.version,
        id: fresh.id,
        knowledgeSpaceId: fresh.knowledgeSpaceId,
        metadata: {
          ...fresh.metadata,
          syncState: {
            lastSyncAt: nowIso,
            lastSyncStatus: failure ? "error" : "ok",
            nextSyncAt: computeNextSyncAt(policy, nowIso),
            ...(safeFailure
              ? { lastSyncError: safeFailure.message, lastSyncErrorCode: safeFailure.code }
              : {}),
          },
        },
      });
      if (!recorded) return "skippedInFlight";
    } catch (error) {
      if (error instanceof SourceVersionConflictError) return "skippedInFlight";
      throw error;
    }

    return safeFailure ? "failed" : "synced";
  }

  async function tick(): Promise<SourceSyncTickResult> {
    const counts = {
      due: 0,
      failed: 0,
      scanned: 0,
      skippedInFlight: 0,
      skippedNoTenant: 0,
      synced: 0,
    };
    let cursor: { id: string } | undefined;

    while (counts.scanned < maxSourcesPerTick) {
      const limit = Math.min(LIST_PAGE_SIZE, maxSourcesPerTick - counts.scanned);
      const page = await sources.listAll({ ...(cursor ? { cursor } : {}), limit });
      counts.scanned += page.items.length;

      for (const source of page.items) {
        const policy = readSourceSyncPolicy(source.metadata);

        if (!policy || source.status === "disabled") {
          continue;
        }

        const current = now();
        const state = readSourceSyncState(source.metadata);

        // Cheap pre-filter on the listed snapshot; the atomic claim below is the authority.
        if (source.status === "syncing") {
          const startedMs = state.syncStartedAt ? Date.parse(state.syncStartedAt) : Number.NaN;

          if (Number.isFinite(startedMs) && current.getTime() - startedMs < staleSyncMs) {
            counts.skippedInFlight += 1;
            continue;
          }
        }

        const anchor = state.lastSyncAt ?? source.updatedAt;
        const dueAtIso = state.nextSyncAt ?? computeNextSyncAt(policy, anchor);

        if (current.getTime() < Date.parse(dueAtIso)) {
          continue;
        }

        counts.due += 1;

        if (typeof source.metadata.tenantId !== "string" || !source.metadata.tenantId) {
          counts.skippedNoTenant += 1;
          continue;
        }

        // Atomic claim: across replicas, the repository guarantees exactly one worker wins.
        const nowIso = current.toISOString();
        const claimed = await sources.claimForSync({
          id: source.id,
          knowledgeSpaceId: source.knowledgeSpaceId,
          now: nowIso,
          staleBefore: new Date(current.getTime() - staleSyncMs).toISOString(),
        });

        if (!claimed) {
          counts.skippedInFlight += 1;
          continue;
        }

        // Re-verify on the claimed (fresh) row: another replica may have completed this sync
        // between our listing and our claim, pushing nextSyncAt into the future. `nextSyncAt`
        // absent means the source was never synced — still due.
        const freshPolicy = readSourceSyncPolicy(claimed.metadata);
        const freshNextSyncAt = readSourceSyncState(claimed.metadata).nextSyncAt;
        const freshTenantId = claimed.metadata.tenantId;

        if (
          !freshPolicy ||
          typeof freshTenantId !== "string" ||
          !freshTenantId ||
          (freshNextSyncAt !== undefined && current.getTime() < Date.parse(freshNextSyncAt))
        ) {
          // Lost the race (or the policy/tenant changed underneath us): release the claim.
          await sources.update({
            expectedVersion: claimed.version,
            id: claimed.id,
            knowledgeSpaceId: claimed.knowledgeSpaceId,
            status: source.status === "syncing" ? "active" : source.status,
          });
          counts.skippedInFlight += 1;
          continue;
        }

        const result = await syncClaimedSource(claimed, freshPolicy, freshTenantId, nowIso);
        counts[result] += 1;
      }

      if (!page.nextCursor) {
        break;
      }

      cursor = page.nextCursor;
    }

    return counts;
  }

  return {
    start: () => {
      let stopped = false;
      const timer = setInterval(() => {
        if (ticking || stopped) {
          return;
        }

        ticking = true;
        void tick()
          .catch(() => undefined)
          .finally(() => {
            ticking = false;
          });
      }, intervalMs);
      // Do not hold the process open for the scheduler (node timers only).
      (timer as { unref?: () => void }).unref?.();

      return () => {
        stopped = true;
        clearInterval(timer);
      };
    },
    tick,
  };
}
