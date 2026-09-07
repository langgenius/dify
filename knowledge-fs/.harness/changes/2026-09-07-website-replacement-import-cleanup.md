# Website Replacement Import Cleanup

## Problem

Editing a Website Source to replace its selected URL set ran a new `crawl-import` and published the
new selection, but the import path did not reconcile the Source's existing logical-document
inventory. Documents belonging to URLs removed from the selection therefore remained visible after
the edit completed.

## Changes

- Mark namespace Website preview consumption explicitly as a replacement-selection import.
- Load the active Source inventory only when processing that marked Website `crawl-import`.
- Publish every newly selected page before reconciling removed provider identities.
- Tombstone documents outside the replacement selection through the existing durable logical-
  document deletion boundary, preserving parent workflow ownership.
- Keep the previous documents and persisted Website selection unchanged if replacement publication
  fails.
- Leave unmarked direct Website crawl imports, legacy preview-selection imports, online-document,
  and online-drive flows unchanged.

## Verification

- Added a failing regression test proving that a replacement Website import previously left the old
  document active, then made it pass with the cleanup behavior.
- Added failure-path coverage proving cleanup is not started when replacement publication fails.
- Focused workflow runtime suite: 60 tests passed.
- Related workflow, Source-product, and namespace-preview suites: 89 tests passed.
- KnowledgeFS `pnpm check` passed.
- KnowledgeFS `pnpm build` passed for all 12 packages.
- Targeted Biome check passed for both changed TypeScript files.
- Repository-wide `pnpm lint` remains blocked by 10 existing formatting/lint diagnostics in
  unrelated files; this change does not modify those files.
