# TypeScript Compute Runtime

## Summary

- Added `@knowledge/compute` as the TypeScript runtime boundary for Rust/WASM compute modules.
- The package wires chunking and token counting through a stable module interface without checking generated wasm-pack artifacts into git.

## Behavior

- Added `createWasmComputeRuntime({ module })`.
- The runtime calls WASM-compatible exports:
  - `chunkParseArtifactJson(inputJson)` for parse-artifact chunking.
  - `countTokens(input)` for token counting.
- Chunk inputs are serialized through a single JSON boundary and chunk outputs are validated with `KnowledgeNodeSchema`.
- Token counts are validated as safe non-negative integers.
- Runtime errors are normalized to stable TypeScript errors for callers and tests.

## Performance And Safety

- The runtime does not load or retain large generated artifacts.
- It avoids hidden global module state; callers inject the module for Node, Workers, or tests.
- Malformed WASM output is rejected before it can enter ingestion or persistence paths.
- Returned node objects are freshly parsed/cloned, so callers cannot mutate shared internal state.

## Verification

- RED confirmed with compute package tests failing because the runtime entrypoint did not exist.
- Focused verification passed:
  - `pnpm --filter @knowledge/compute test -- src/compute.test.ts`
  - `pnpm --filter @knowledge/compute test:coverage`
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`
