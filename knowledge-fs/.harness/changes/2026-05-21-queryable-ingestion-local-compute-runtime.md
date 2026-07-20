# Queryable Ingestion Local Compute Runtime

## Summary

- Completed QI.2 from the Queryable Ingestion Track.
- Added API app startup wiring that loads the generated Rust/WASM compute module when available.
- Kept local startup safe: missing WASM output or `KNOWLEDGE_WASM_COMPUTE=false|0|off` returns no compute runtime instead of crashing.

## TDD Notes

- Red: API app tests referenced missing `compute-options` and missing `@knowledge/compute` dependency.
- Green: added path resolution, explicit disable handling, injectable module loading tests, and gateway startup source assertions.

## Performance Notes

- The WASM module is loaded once at API app startup, not per request.
- Synchronous upload node generation remains bounded by the gateway `maxSynchronousUploadNodes` limit.
- No filesystem probing is performed per request; path resolution happens during startup only.

## Verification

- Passed:
  - `pnpm install`
  - `pnpm --filter @knowledge/api-app test -- src/compute-options.test.ts`
  - `pnpm --filter @knowledge/api-app typecheck`
  - `pnpm --filter @knowledge/api-app build:prod`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `git diff --check`
