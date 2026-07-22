# Extract Golden Question Annotation Helpers

## Summary

- Continued the API god-file decomposition by moving golden question annotation types and metadata assembly out of `packages/api/src/index.ts`.
- Added `packages/api/src/golden-question-annotation.ts` for annotation input contracts and bounded metadata construction.
- Added direct tests and a code-health guardrail to keep this pure metadata helper outside the gateway file.

## TDD Notes

- RED: added focused annotation tests and a code-health guardrail before the module existed.
- GREEN: implemented the helper module, exported it from the API package, and rewired gateway annotation routes to import it.

## Performance And Safety Notes

- Preserved the existing bounded annotation retention window of 50 entries.
- Kept metadata clone isolation so caller-owned question metadata is not mutated.
- No database, object storage, parser, network, or route behavior changed.

## Verification

- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/golden-question-annotation.test.ts src/code-health.test.ts`
- Full verification to run before commit:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Review Cadence

- This slice is implementation commit 7 after review checkpoint `207c4f3`.
- Next mandatory 10-commit health review is due after 3 more implementation commits.
