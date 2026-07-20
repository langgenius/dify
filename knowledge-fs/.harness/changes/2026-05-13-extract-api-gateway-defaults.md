# Extract API Gateway Defaults

## Summary

- Continued R6 API decomposition by moving the default parser factory, unavailable compute runtime, and `KnowledgeFsUnavailableError` into `packages/api/src/gateway-defaults.ts`.
- Added direct tests for native markdown fallback behavior, fail-closed unstructured parsing, and explicit unavailable compute errors.
- Added a code-health guardrail so default runtime factories do not move back into `packages/api/src/index.ts`.

## Why

- Gateway default adapters are cohesive runtime wiring, not route logic. Extracting them reduces `index.ts` responsibility while keeping local/dev fallback behavior unchanged.
- The unavailable compute runtime still fails closed with explicit errors when WASM compute is not injected.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/gateway-defaults.test.ts src/code-health.test.ts` failed because `gateway-defaults.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/gateway-defaults.test.ts src/code-health.test.ts src/gateway.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Risks And Follow-Up

- The default parser still only handles native Markdown/HTML locally; complex formats continue to require explicit Unstructured configuration.
- The compute runtime remains intentionally unavailable unless an injected WASM runtime is provided.
