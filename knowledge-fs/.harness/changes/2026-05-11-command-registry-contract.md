# CommandRegistry Contract

## What Changed

- Added `packages/core/src/command-registry.ts` with an allowlisted KnowledgeFS command registry.
- Added command contracts for handlers, resource/node overrides, permission checks, cost estimation, trace hooks, cache policy, and degradation policy.
- Exported the registry through `@knowledge/core`.
- Added TDD coverage for:
  - allowlisted command registration and validated execution,
  - resource type and node-kind handler overrides,
  - duplicate/max registry bounds,
  - unauthorized, invalid, unsupported, missing, and unsafe command execution,
  - command failure trace events,
  - summary clone isolation.

## Why It Changed

- Sprint 4 needs a central command dispatch boundary before implementing safe shell-style KnowledgeFS commands.
- The `.harness` architecture requires safe shell behavior to be an allowlisted dispatcher over registered KnowledgeFS commands, never host shell execution.

## Performance Notes

- The registry is explicitly bounded with `maxCommands`.
- Execution validates input through command schemas before invoking handlers.
- Cost estimation is part of the contract so future commands can expose bounded read/scan expectations before expensive execution paths are added.
- No host process execution, database queries, or network IO were introduced in this slice.

## Verification

- `pnpm --filter @knowledge/core test -- src/command-registry.test.ts`
- `pnpm --filter @knowledge/core test:coverage`

## Known Risks / Follow-Up

- The registry is a contract and in-memory dispatcher only; actual `ls`, `tree`, `cat`, and other KnowledgeFS command handlers still need to be implemented over bounded repositories.
- Future safe shell parsing must dispatch only through this registry and preserve the same allowlist.
