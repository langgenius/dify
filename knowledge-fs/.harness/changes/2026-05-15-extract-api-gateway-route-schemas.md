# Extract API Gateway Route Schemas

## Summary

- Continued the H1/R6 API god-file decomposition by moving shared gateway route schemas out of `packages/api/src/index.ts`.
- Added `packages/api/src/gateway-route-schemas.ts` for common error, graph traversal, query stream, answer-trace, retention, production bad-case, and bulk operation schemas.
- Added a code-health guardrail to keep these route schema definitions from returning to the gateway file.

## TDD Notes

- RED: added `gateway-route-schemas.test.ts` and a `code-health.test.ts` guardrail before the new module existed.
- GREEN: implemented the schema module, exported it from the API package, and rewired `index.ts` to import the schemas.

## Performance And Safety Notes

- Preserved bounded query validation for graph traversal fanout, max nodes, depth, timeout, query stream active ids, and virtual tree list limits.
- Kept strict schemas for mutating request bodies so unknown keys are rejected where the existing route contract already rejected them.
- No runtime I/O, database, object storage, parser, or network behavior changed.

## Verification

- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/gateway-route-schemas.test.ts src/code-health.test.ts`
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

- This slice is implementation commit 5 after review checkpoint `207c4f3`.
- Next mandatory 10-commit health review is due after 5 more implementation commits.
