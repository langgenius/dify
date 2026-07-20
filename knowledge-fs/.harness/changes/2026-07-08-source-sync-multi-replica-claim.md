# Multi-replica-safe source sync via atomic DB claims

Date: 2026-07-08

Hardens the scheduled-sync scheduler for multi-replica deployments. The previous implementation
was single-process only (read-then-write soft lock + in-process tick guard) and documented "enable
on one replica" — unacceptable for the project's enterprise, always-multi-replica posture.

## Failure modes fixed
1. N replicas ticking -> the same due source synced N times concurrently (duplicate crawls,
   racing metadata writes).
2. The status=syncing soft lock was read-then-write, so two replicas could both observe `active`
   and both start.

## Mechanism (same pattern as pg-boss-style DB schedulers)
- **`SourceRepository.claimForSync`** — a single conditional UPDATE:
  `SET status='syncing', updated_at=$now WHERE id=... AND (status <> 'syncing' OR updated_at < $staleBefore)`
  (postgres RETURNING *; tidb rowsAffected + re-read; in-memory mirrors the semantics). The
  database serializes concurrent claims: exactly one replica wins per source, work shards
  naturally across replicas, no leader election needed.
- **Post-claim re-verification** — the winner re-checks dueness/policy/tenant on the claimed
  (fresh) row; if another replica completed the sync between listing and claiming (nextSyncAt now
  in the future), the claim is released (status restored) instead of re-running.
- **Crash recovery** — a claim stuck in `syncing` becomes re-claimable once `updated_at` predates
  `staleSyncMs` (default 30min). Corollary: a legitimately long-running sync must finish within
  `staleSyncMs` or another replica may steal it — size `staleSyncMs` to the slowest connector
  (scheduler option; not yet env-exposed).
- Snapshot pre-filters (status/dueness from the listed page) remain as cheap traffic reduction;
  the claim is the sole authority.

## Remaining known gaps (explicitly out of scope here)
- Source metadata writes elsewhere (user PATCH vs in-flight sync bookkeeping) are still
  read-merge-write without optimistic versioning; a concurrent PATCH during a sync can be
  overwritten by the sync's final metadata write. Follow-up: version column / CAS on sources.
- No claim heartbeat for very long syncs (see staleSyncMs note above).

## Tests
- repository: in-memory claim triad (active claims / fresh syncing refused / stale re-claimed);
  database claim SQL (conditional UPDATE, param order, RETURNING).
- scheduler: contended claim (another replica holds it -> skippedInFlight, runner not called);
  lost-race release (stale listing vs fresh truth -> claim released, syncState untouched);
  all prior dueness/skip/stale/failure tests unchanged and passing semantics preserved.
