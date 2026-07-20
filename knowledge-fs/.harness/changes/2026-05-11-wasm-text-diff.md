# WASM Text Diff

## What Changed

- Added the pure-compute Rust text diff API exported to WASM as `diffTextJson`.
- Added non-WASM `diff_text_json` for Rust tests and local callers.
- Supported line-level and Unicode word-boundary diff modes.
- Returned merged `equal`, `insert`, and `delete` operations with stable 1-based old/new ranges and token-count stats.
- Added explicit bounds for input JSON bytes, token counts, output operation count, and LCS matrix cells.

## Why

- Sprint 8 needs a KnowledgeFS-safe diff primitive before exposing higher-level `diff` and `open_node` commands.
- The diff operation belongs in Rust WASM because it is deterministic pure compute with no database, network, filesystem, cache, or provider dependencies.
- The matrix-cell guard prevents accidental quadratic work from becoming a runtime or memory hazard.

## Verification

- RED: `cargo test -p knowledge_compute` failed first because `diff_text_json` was not implemented.
- GREEN focused verification:
  - `cargo test -p knowledge_compute diff`
  - `cargo test -p knowledge_compute`
- Full verification:
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- The current implementation uses bounded LCS, which is appropriate for small and medium text diffs but intentionally rejects very large comparisons instead of switching to a streaming or Myers-style algorithm.
- Next slice should wire this into TypeScript/KnowledgeFS commands with route-level bounds and tenant-scoped resource loading.
