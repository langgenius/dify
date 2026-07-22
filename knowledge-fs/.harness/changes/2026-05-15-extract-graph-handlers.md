# Extract Graph Handlers

## Summary

- Extracted graph traversal handler registration from `packages/api/src/index.ts` into `packages/api/src/graph-handlers.ts`.
- Preserved tenant-scoped KnowledgeSpace checks, bounded traversal parameters, and empty traversal 404 behavior.
- Left the gateway entrypoint to compose graph handlers through `registerGraphHandlers`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `graph-handlers.ts` did not exist.
- GREEN: Added `registerGraphHandlers`, exported it, wired it from `createKnowledgeGateway`, and removed the inline graph traversal handler from `index.ts`.

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

Note: the first full `pnpm lint` run reported import ordering in `packages/api/src/index.ts`; the import order was corrected and `pnpm lint` was rerun successfully.

## Review Cadence

- This is implementation commit 3 after review checkpoint `09193ab`.
- The next mandatory health review is due after 7 more implementation commits.
