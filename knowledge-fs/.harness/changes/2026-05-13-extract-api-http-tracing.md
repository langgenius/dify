# Extract API HTTP Tracing Helpers

## Summary

- Continued R6 gateway decomposition by moving HTTP trace middleware, trace-id normalization, and error-class extraction into `packages/api/src/http-tracing.ts`.
- Added focused tests for valid trace-id propagation, unsafe trace-id regeneration, and low-cardinality error class mapping.
- Added a code-health guardrail so tracing middleware helpers do not move back into `packages/api/src/index.ts`.

## Why

- HTTP tracing is a cohesive cross-cutting boundary that should sit beside the route-classification utilities rather than inside the gateway god file.
- Sanitizing trace ids and error classes in a small module makes it easier to prevent high-cardinality or sensitive trace attributes later.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/http-tracing.test.ts src/code-health.test.ts` failed because `http-tracing.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/http-tracing.test.ts src/code-health.test.ts`
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

- Existing gateway tests still cover request-level trace header behavior.
- Future OpenTelemetry SDK wiring should reuse this boundary instead of adding SDK-specific logic to `packages/api/src/index.ts`.
