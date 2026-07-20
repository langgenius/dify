# Source optimistic locking (version column + CAS)

Date: 2026-07-08

Closes the remaining concurrency gap called out in the multi-replica claim change: source metadata
writes were read-merge-write with no guard, so a concurrent PATCH and an in-flight sync could
silently overwrite each other.

## Mechanism
- **`Source.version`** — new int column on `sources` (schema + both migrations; `SourceSchema`
  gains `version` with `default(1)`, so existing parse fixtures stay valid). Bumped on EVERY
  write: `update` (+1), `claimForSync` (SQL `version = version + 1`), created at 1. Exposed in all
  API responses (Source response schema derives from SourceSchema).
- **CAS update** — `sources.update` accepts `expectedVersion`; in database mode the WHERE clause
  pins the stored version so the database itself rejects concurrent modification (`rowsAffected 0`
  -> `SourceVersionConflictError`). Without `expectedVersion` behavior is unchanged (legacy,
  unconditional) apart from the version bump.
- **`updateSourceWithRetry`** (`source-cas-update.ts`) — read fresh -> rebuild metadata via a
  `merge(fresh)` callback -> CAS-write; on conflict re-read and retry (default 3 attempts, then
  rethrow). Because `merge` runs on the FRESH row every attempt, a concurrent writer's changes are
  preserved rather than clobbered.
- **All source-metadata writers converted** to the helper: scheduler (syncStartedAt + bookkeeping),
  runner (web/document/drive finals + markError), handlers (crawl/import-pages/import-files finals
  + their error catches). Sync flows now overlay their owned keys (`crawled`/`imported`/
  `importedFiles`/`sync`/`syncState`) onto fresh state instead of a stale pre-sync snapshot.
  Status-only writes (syncing markers, claim release) stay plain — they carry no metadata.
- **Client-facing CAS** — `PATCH .../sources/{id}` accepts optional `expectedVersion`; a stale
  value returns the new `409` instead of overwriting (read `version` from any GET/list response).

## Notes
- Error-path metadata writes are best-effort (`.catch(() => undefined)`) so a CAS storm cannot
  mask the original sync error.
- docs/api-reference.md is now behind on sources (version field, 400/409, skipped/replaced,
  syncPolicy) — one consolidated doc refresh pending.

## Tests
- repository: version starts/bumps (update + claim), stale-CAS throws in-memory, database SQL pins
  version + conflict on rowsAffected 0; row-mapping fixture carries version.
- `source-cas-update.test.ts`: conflict -> retry preserves BOTH writers' changes; missing source ->
  null; persistent contention -> rethrown conflict.
- gateway e2e: PATCH with stale expectedVersion -> 409; fresh -> 200 with bumped version.
