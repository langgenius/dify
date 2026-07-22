# Extract KnowledgeSpace Handlers

## Summary

- Extracted KnowledgeSpace CRUD handler registration from `packages/api/src/index.ts` into `packages/api/src/knowledge-space-handlers.ts`.
- Preserved server-side tenant scoping from the authenticated subject for create/list/get/update/delete.
- Kept existing duplicate slug, capacity, list-limit, and not-found response mappings.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `knowledge-space-handlers.ts` did not exist.
- GREEN: Added `registerKnowledgeSpaceHandlers`, exported it, wired it from `createKnowledgeGateway`, and removed inline KnowledgeSpace CRUD handlers from `index.ts`.

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

- This is implementation commit 5 after review checkpoint `09193ab`.
- The next mandatory health review is due after 5 more implementation commits.
