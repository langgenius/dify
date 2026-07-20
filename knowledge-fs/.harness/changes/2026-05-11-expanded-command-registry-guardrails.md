# Expanded CommandRegistry Guardrails

## What Changed

- Added runtime validation for command definitions:
  - Commands must support at least one resource type.
  - Supported resource types must be unique.
  - Cache policy `maxBytes` and `ttlSeconds` must be positive integers when present.
- Added runtime validation for command cost estimates:
  - `estimatedBytes`, `estimatedRows`, and `estimatedMs` must be non-negative finite numbers when present.
- Changed execution order so cost estimation is validated before the command handler runs.
- Extended trace hook events with `durationMs` and successful `cost` details.
- Added TDD coverage for successful trace metadata, invalid cost estimates not invoking handlers, and invalid command definitions.

## Why

- Sprint 8 requires the CommandRegistry to be the safe dispatch boundary for KnowledgeFS, SourceFS, MCP, and later safe-shell execution.
- Bad command metadata should fail before expensive IO, database access, or side effects begin.
- Trace hooks need bounded, low-cardinality timing/cost metadata so later command logs and shell tooling can reason about command behavior.

## Verification

- RED:
  - `pnpm --filter @knowledge/core test -- src/command-registry.test.ts` failed because trace metadata and definition/cost validation were missing.
- GREEN focused verification:
  - `pnpm --filter @knowledge/core test -- src/command-registry.test.ts`
  - `pnpm --filter @knowledge/core test:coverage`
  - `pnpm --filter @knowledge/core typecheck`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks And Follow-Up

- This slice hardens the core registry contract only; SourceFS inspection tools and safe-shell pipeline parsing remain separate Sprint 8 slices.
- This commit reaches the 10-commit cadence after checkpoint `50d3a26`, so feature iteration must pause for a project health review immediately after commit and push.
