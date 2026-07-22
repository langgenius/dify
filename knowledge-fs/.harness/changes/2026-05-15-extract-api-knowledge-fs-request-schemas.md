# Extract API KnowledgeFS Request Schemas

## Summary

- Continued the H1/R6 API god-file decomposition by moving KnowledgeFS route query and command input schemas out of `packages/api/src/index.ts`.
- Added `packages/api/src/knowledge-fs-request-schemas.ts` as the focused boundary for KnowledgeFS request validation.
- Added code-health guardrails so these schemas cannot drift back into the gateway file.

## TDD Notes

- RED: added focused request-schema and code-health tests before wiring the new module into `index.ts`.
- GREEN: exported/imported the new schema module and removed the duplicated inline gateway definitions.

## Performance And Safety Notes

- Kept existing bounded query validation for route reads (`limit`, `depth`, `timeoutMs`) and strict command integer validation.
- Preserved namespace validation for KnowledgeFS virtual paths and UUID validation for command-scoped resource ids.
- No new database, object storage, parser, or network behavior was introduced.

## Verification

- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/knowledge-fs-request-schemas.test.ts src/code-health.test.ts`
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

- This slice is implementation commit 4 after review checkpoint `207c4f3`.
- Next mandatory 10-commit health review is due after 6 more implementation commits.
