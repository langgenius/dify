# Extract API Shared Utilities

## Summary

- Extracted shared gateway utility helpers from `packages/api/src/index.ts` into `packages/api/src/api-shared-utils.ts`.
- Re-exported the new utility module from the API package root.
- Added direct utility coverage and a code-health guardrail preventing deterministic-id, evidence clone, text diff clone, and string dedupe helpers from drifting back into the gateway god file.

## TDD

- RED: added `api-shared-utils.test.ts` and a code-health guardrail first; they failed because `api-shared-utils.ts` did not exist.
- GREEN: moved the helper implementations, imported them from the gateway, re-exported the module, fixed strict test access, and reran focused tests plus API typecheck and lint.

## Performance Notes

- `deterministicChildId` remains a pure SHA-256 UUID-v5-style derivation with no runtime randomness or I/O.
- `uniqueStrings` preserves the previous insertion-order `Set` behavior and does not add sorting or extra passes.
- Clone helpers keep existing clone-isolation semantics for external response/cache boundaries and introduce no database, network, cache, or queue work.

## Verification

- `pnpm --filter @knowledge/api test -- src/api-shared-utils.test.ts src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm lint`
- Remaining full verification is run before commit.

## Review Cadence

- This is implementation commit 5 after review checkpoint `9042d56`.
- The next mandatory health review is due after 5 more implementation commits.
- Temporary task/progress documents are absent after the earlier cleanup, so this checkpoint is recorded in `.harness/changes` and the remediation iteration plan.
