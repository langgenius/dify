# Centralize KnowledgeFS Errors

## Summary

- Continued the API god-file decomposition by moving `KnowledgeFsNotFoundError` out of `packages/api/src/index.ts`.
- Centralized KnowledgeFS validation and not-found error classes in `packages/api/src/knowledge-fs-errors.ts`.
- Added focused error tests and strengthened code-health guardrails so shared KnowledgeFS error classes stay outside the gateway file.

## TDD Notes

- RED: added `knowledge-fs-errors.test.ts` and a code-health assertion for `KnowledgeFsNotFoundError` before the error was exported by `knowledge-fs-errors.ts`.
- GREEN: exported `KnowledgeFsNotFoundError` from the shared errors module and rewired gateway route handlers to import it.

## Performance And Safety Notes

- This is a pure boundary move with no new runtime I/O, database queries, object storage calls, parsing, or allocation-heavy behavior.
- Existing route error semantics are preserved: KnowledgeFS missing paths/nodes still map to 404 responses.

## Verification

- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/knowledge-fs-errors.test.ts src/code-health.test.ts`
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

- This slice is implementation commit 6 after review checkpoint `207c4f3`.
- Next mandatory 10-commit health review is due after 4 more implementation commits.
