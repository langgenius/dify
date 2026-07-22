# Extract API Auth Utilities

## Summary

- Continued the R6 shared-utilities/API decomposition remediation for H1/L9 by moving auth verifier, Bearer-token, middleware, and scope helpers out of `packages/api/src/index.ts`.
- Added a code-health guardrail so these auth responsibilities stay in `packages/api/src/auth.ts`.
- Preserved existing public exports through `export * from "./auth"` so existing gateway tests and callers continue to import from `@knowledge/api`.

## Why

- `packages/api/src/index.ts` is still a high-risk god file. Auth verification and route-scope logic are cohesive enough to own in a focused module.
- Keeping auth parsing and middleware in one module makes future JWT/OIDC/JWKS wiring easier to review without growing the gateway file further.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/code-health.test.ts` failed because `packages/api/src/auth.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm --filter @knowledge/api test -- src/gateway.test.ts`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Risks And Follow-Up

- This slice is intentionally mechanical and keeps behavior unchanged.
- Remaining R6 work should continue extracting coherent route/workflow helpers from `packages/api/src/index.ts`, with guardrails for each moved responsibility.
