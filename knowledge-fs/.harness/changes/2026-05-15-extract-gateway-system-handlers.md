# Extract Gateway System Handlers

## Summary

- Extracted public `/health` handler registration from `packages/api/src/index.ts` into `packages/api/src/gateway-system-handlers.ts`.
- Preserved parallel platform health and gateway component health checks.
- Kept parser fallback health behavior based on the configured document parser kind.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `gateway-system-handlers.ts` did not exist.
- GREEN: Added `registerGatewaySystemHandlers`, exported it, wired it from `createKnowledgeGateway`, and removed inline health handler registration from `index.ts`.

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

- This is implementation commit 4 after review checkpoint `09193ab`.
- The next mandatory health review is due after 6 more implementation commits.
