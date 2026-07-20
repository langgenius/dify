# Extract Document Read Handlers

## Summary

- Extracted document asset and parse artifact read handler registration from `packages/api/src/index.ts` into `packages/api/src/document-read-handlers.ts`.
- Preserved tenant-scoped KnowledgeSpace checks before document and artifact lookup.
- Kept missing space, missing asset, and missing artifact responses as 404 to avoid cross-tenant existence leaks.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `document-read-handlers.ts` did not exist.
- GREEN: Added `registerDocumentReadHandlers`, exported it, wired it from `createKnowledgeGateway`, and removed inline document read handlers from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 2 after review checkpoint `09193ab`.
- The next mandatory health review is due after 8 more implementation commits.
