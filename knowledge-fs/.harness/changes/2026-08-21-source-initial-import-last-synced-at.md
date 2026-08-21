# Source initial import `lastSyncedAt`

Date: 2026-08-21

## What changed

- The source list now derives `lastSyncedAt` from both a successful initial source import and a
  later source sync.
- Successful Firecrawl preview selections, explicit crawl imports, online-document imports, and
  online-drive imports are treated as source content updates.
- A preview that was never imported and an empty initial crawl remain excluded. A successful sync
  with zero new results continues to count as a completed sync.

## Why

The source-list query previously considered only workflow runs whose kind was `sync`. A newly
created Firecrawl source can already be active and contain imported documents while its only
completed workflow is the initial `crawl-preview` selection import. Until the first scheduled or
manual refresh, the API therefore omitted `lastSyncedAt` and the UI displayed an em dash.

## Verification

- Focused source workflow and source handler regression: 125 tests passed.
- Complete `@knowledge/api` suite: 416 files passed, 1 skipped; 4,624 tests passed, 3 skipped.
- `@knowledge/api` typecheck passed.
- Focused Biome checks and `git diff --check` passed.
