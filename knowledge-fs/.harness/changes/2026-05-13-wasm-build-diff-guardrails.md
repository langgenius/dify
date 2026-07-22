# WASM Build And Diff Guardrails

## Summary

- Completed R5 from the code-review remediation plan by hardening WASM build reproducibility and text diff matrix bounds.
- Kept `wasm-opt` optional for local and CI environments while making its use explicit and testable.

## Changes

- Exported testable WASM build helper functions for locked Cargo arguments and optional optimizer planning.
- Added `wasm:build:test` and included it in `pnpm check`.
- Added optional `wasm-opt -Oz` execution when `wasm-opt` is available; otherwise the build emits an explicit warning and continues.
- Added Rust and TypeScript guardrails so `maxTokens` must fit inside `maxDiffCells` before LCS matrix allocation is possible.

## Verification

- `pnpm wasm:build:test`
- `cargo test --workspace rejects_oversized_or_unbounded_diff_inputs`
- `pnpm --filter @knowledge/compute test -- src/compute.test.ts`

## Notes

- `cargo build` remains pinned with `--locked`.
- Default diff `maxTokens` now derives from the configured cell budget when callers do not provide an explicit token cap.
