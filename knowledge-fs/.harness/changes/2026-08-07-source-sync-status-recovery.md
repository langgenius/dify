# Source sync status recovery

Date: 2026-08-07

## What changed

- Enriched source-list responses with the caller-visible latest sync workflow, including terminal
  outcomes, so the Dify Sources page can recover status after a reload without per-row requests.
- Kept the source-list `status` consistent with the latest relevant workflow and normalized the
  same invariant at the Dify frontend contract boundary, so restored runs participate in Syncing
  and Error filters even when the source's persisted status has not changed.
- Replaced row-owned workflow polling with the source list's bounded bulk snapshot. Terminal
  failures can no longer disappear in the race between list refresh and workflow-detail polling,
  and a page with many active sources issues one periodic list request instead of one request per row.
- Kept a newly accepted sync authoritative over an older cached terminal run until the source list
  observes the same run or a newer one, including when the immediate list refresh fails.
- Let a newer terminal server run supersede an older local active override, preventing the page from
  remaining stuck in Syncing when another actor starts and finishes a later run between polls.
- Preserved a Source's explicit Disabled state while still returning its latest workflow, and kept
  newer toggle responses authoritative when a workflow-enriched list replica is stale.
- Kept in-flight workflow state across non-enriched toggle responses when the immediate list
  refresh fails, while still dropping terminal workflows made stale by the source update.
- Matched the backend's active-first workflow precedence while reconciling local overrides, so a
  retried older run cannot be hidden by a newer terminal run retained in the page state.
- Bound both permission-scope branches independently for TiDB positional parameters while retaining
  PostgreSQL placeholder reuse.
- Made the in-memory source-workflow repository resolve Capability-owned run scopes explicitly,
  matching the database repository's fail-closed behavior. Missing Capability provenance no longer
  behaves like a public empty legacy scope.
- Added cross-layer DTO/generated-contract coverage and regressions for restored status, terminal
  failures, newer runs, status filtering, bulk latest-run lookup, and Capability scope filtering.

## Why

The Sources page previously lost an accepted sync run on reload. Returning the latest workflow from
the bounded source-list lookup restores both active progress and terminal outcomes. During review,
eight follow-up defects were found: a list refresh could remove the run id before detail polling saw
its terminal failure; restoring many active rows created a per-row polling fan-out; a restored run
retained the source's persisted Active status in list filters; and the in-memory adapter treated a
Capability run's intentionally absent legacy scope as public even though the database adapter
resolves the immutable Capability grant scope. An older terminal run cached by the source list could
also hide a newly accepted sync and stop polling when the immediate refresh failed. Finally, a
non-enriched toggle response could discard an in-flight run, and an older retried run could lose to a
newer terminal page override even though the backend correctly ranked the active run first. A local
active override could also hide a later terminal server run forever when another actor completed a
newer sync between list polls.

## Verification

- `pnpm --filter @knowledge/api exec vitest run src/source-handlers-coverage.test.ts src/source-product-workflow.test.ts src/source-product-workflow-database-repository.test.ts src/source-product-workflow-memory-repository.test.ts`
  passed: 141 tests.
- `pnpm --filter @knowledge/api typecheck` passed.
- Targeted Biome checks passed for all changed KnowledgeFS API files.
- `vp test run features/new-rag/__tests__/sources-page.spec.tsx` passed: 41 tests. The three review
  regressions failed before the stale-override reconciliation fixes and passed afterward.
- Targeted `vp check` passed for the changed Sources page, model, and test files.
- Targeted KnowledgeFS facade and Swagger/schema tests passed: 131 tests.
- Ruff passed for the changed Python DTO and facade test.

## Risks and follow-up

- The complete KnowledgeFS `pnpm check`, repository-wide build, and repository-wide lint suites were
  not rerun because they include unrelated CI, Docker, evaluation, and coverage gates. The affected
  package tests, typecheck, and targeted lint/build-equivalent checks were run instead.
- The full Web `pnpm type-check` remains blocked by pre-existing generated `.next/types/validator.ts`
  route-type errors. Targeted Vite+ type checking for every changed Web file passed.
