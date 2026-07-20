# Safe Shell Planner Executor

## What Changed

- Added `createSafeShell()` to plan and execute shell-like pipelines without invoking a host shell.
- Added structured `SafeShellPlan`, step, and execution result contracts.
- Safe shell parsing supports allowlisted commands only: `ls`, `tree`, `cat`, `grep`, `find`, `stat`, `diff`, `head`, `tail`, `wc`, and `jq`.
- Registry-backed filesystem commands dispatch through `CommandRegistry` with subject, trace id, knowledge-space id, and resource type context.
- In-memory transforms support bounded `head`, `tail`, `wc`, and a minimal JSON selector for `jq`.
- Added tests for command planning, registry dispatch, SourceFS routing, pipeline shape rejection, host-shell syntax rejection, explicit limits, selector behavior, and output truncation.

## Why

- Phase 2 Sprint 8 requires a safe ergonomic command composition layer for agents while preserving the architecture rule that no host shell commands may be executed.
- The existing `CommandRegistry` remains the canonical execution boundary; safe shell is only a parser and dispatcher over registered commands plus bounded in-memory transforms.

## Performance And Safety Notes

- Rejects host-shell syntax including redirects, command separators, backticks, and command substitution.
- Enforces `maxPipelineCommands`, `maxListLimit`, and `maxOutputBytes`.
- Registry commands must be the first pipeline step, so a pipeline cannot trigger repeated registry reads after expanding intermediate output.
- Resource type routing is path-based: `/sources` uses `source`, `/evidence` uses `evidence`, and the remaining virtual filesystem paths use `workspace`.
- Large string or text-object outputs are truncated with an explicit `truncated` signal.

## Verification

- RED first:
  - `pnpm --filter @knowledge/api test -- src/safe-shell.test.ts` failed because `createSafeShell` did not exist.
- Focused verification:
  - `pnpm --filter @knowledge/api test -- src/safe-shell.test.ts src/sourcefs.test.ts`
  - `pnpm --filter @knowledge/api typecheck`
  - `pnpm --filter @knowledge/api test:coverage`
  - `pnpm lint`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Known Risks / Follow-Up

- This slice provides package-level safe shell planning/execution; Hono and MCP exposure for `knowledge.shell.plan` / `knowledge.shell.execute` remains in the later MCP/shell tool slice.
- `jq` intentionally supports a small selector subset; a richer JSON query language can be added behind the same bounded transform contract later.
