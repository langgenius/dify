# Scheduled source sync (every N hours / fixed times of day)

Date: 2026-07-08

Sources (website crawl / online-document / online-drive) can now sync on a schedule, matching the
"Sync policy: Scheduled" UI: every N hours, or at fixed times of day (with optional UTC offset).

## How it works
- **Policy** — clients set `metadata.syncPolicy` on a source (create or PATCH):
  `{"everyHours": 6}` or `{"dailyAt": ["03:00","15:30"], "utcOffset": "+08:00"}`.
  Validated at create/update (new `400` on both routes); invalid stored policies read as "no
  schedule". (`source-sync-policy.ts`: schema, `computeNextSyncAt`, sync-state readers.)
- **Runner** (`source-sync-runner.ts`) mirrors the manual endpoints:
  - `web` → re-crawl + materialize all pages.
  - connector with `metadata.imported` → **online-document**: `listPages` from the provider,
    re-import only previously imported pages whose `lastEditedTime` changed (selection stays
    manual — never-imported pages are not auto-added).
  - connector with `metadata.importedFiles` → **online-drive**: re-download the recorded files.
    (The import-files endpoint now records `importedFiles` per file id; drive sources imported
    before this change have no record and no-op until re-imported once.)
  - Owns source `status` (syncing → active|error) + sync-summary metadata like the handlers.
- **Scheduler** (`source-sync-scheduler.ts`) ticks every `intervalMs`, scans sources via the new
  `SourceRepository.listAll` (cross-space, id-ordered page), and runs due syncs. Dueness =
  `syncState.nextSyncAt` (seeded from the policy anchored at last sync / source.updatedAt). After
  each run it records `syncState.{lastSyncAt,lastSyncStatus,lastSyncError?,nextSyncAt}`.
  In-flight guard: `status=syncing` younger than 30min is skipped; older is treated stale and
  retried.
- **Tenant attribution** — create/update handlers now stamp `metadata.tenantId` so the scheduler
  can run connectors without a request subject (plugin-daemon dispatch is per-tenant). Sources
  created before this change lack the stamp and are skipped (`skippedNoTenant`) until their
  metadata is updated once.
- **Wiring** — gateway option `sourceSync {intervalMs, maxSourcesPerTick, onScheduler?}` builds the
  runner from the gateway's connectors + materializer and starts the scheduler (timer unref'd).
  apps/api: `KNOWLEDGE_SOURCE_SYNC` (on by default; off|false|0 disables),
  `KNOWLEDGE_SOURCE_SYNC_TICK_MS` (60000), `KNOWLEDGE_SOURCE_SYNC_MAX_SOURCES_PER_TICK` (200).

## Caveats (flagged, not solved here)
- **Re-crawl duplication**: website crawl has no content-hash dedup (previously deferred), so every
  scheduled crawl materializes new documents for unchanged pages. Scheduled crawling amplifies
  this — dedup/stale-version cleanup is now the top follow-up before enabling aggressive crawl
  schedules.
- **Drive re-downloads are unconditional** (no change detection in the download contract).
- **Single-process scheduler**: in-process overlap guard only; multi-replica deployments should
  enable the scheduler on exactly one replica (or set `KNOWLEDGE_SOURCE_SYNC=off` elsewhere).
- docs/api-reference.md not yet updated for the new 400s / syncPolicy convention.

## Tests
- policy: parse/reject, interval + fixed-time next-run math (incl. UTC offsets), state reader.
- runner: web re-crawl, online-document changed/unchanged/never-imported split + state fold,
  drive re-download, connector no-op, hard-failure -> status error + rethrow.
- scheduler: due selection + syncState bookkeeping, disabled/in-flight/tenantless skips, stale
  retry + failure recording, bounds validation.
- repository: listAll paging (in-memory) + unscoped SQL (database).
- apps env factory: defaults/off switch/overrides/fail-fast.
