# Extract KnowledgeFS Handlers

## Summary

- Extracted KnowledgeFS `app.openapi(...)` handler registration from `packages/api/src/index.ts` into `packages/api/src/knowledge-fs-handlers.ts`.
- Preserved tenant-scoped space checks, command registry execution, and existing KnowledgeFS 400/404/503 error mapping.
- Left the gateway entrypoint to compose the handler module via `registerKnowledgeFsHandlers`.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `knowledge-fs-handlers.ts` did not exist.
- GREEN: Added `registerKnowledgeFsHandlers`, exported the module, registered it from `createKnowledgeGateway`, and removed inline KnowledgeFS handler wiring from `index.ts`.

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

- This is implementation commit 1 after review checkpoint `09193ab`.
- The next mandatory health review is due after 9 more implementation commits.
