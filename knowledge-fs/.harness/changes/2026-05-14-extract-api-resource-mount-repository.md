# Extract API Resource Mount Repository

## Summary

- Continued R6 API decomposition by moving `ResourceMountRepository`, the bounded in-memory implementation, capacity error, keying, and clone helper out of `packages/api/src/index.ts`.
- Added direct tests for tenant/knowledge-space scoped lookup, longest matching source mount selection, clone isolation, invalid bounds, and capacity overflow.
- Added a code-health guardrail to prevent resource mount repository responsibilities from moving back into the gateway file.

## TDD

- RED: `pnpm --filter @knowledge/api test -- src/resource-mount-repository.test.ts src/code-health.test.ts` failed because `resource-mount-repository.ts` did not exist.
- GREEN: implemented `packages/api/src/resource-mount-repository.ts`, exported it from the API package, and removed the moved implementation from `index.ts`.

## Verification

- `pnpm --filter @knowledge/api test -- src/resource-mount-repository.test.ts src/code-health.test.ts src/gateway.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 10 after review checkpoint `f6ceb51`.
- After this commit is verified, committed, and pushed, the mandatory 10-commit project health review must run before further feature work.
