# Extract API SourceFS Command Registry

## Summary

- Extracted SourceFS command schemas, registry wiring, mount resolution, object reads, and result assembly from `packages/api/src/index.ts` into `packages/api/src/source-fs-command-registry.ts`.
- Kept public API compatibility by re-exporting the new module from `packages/api/src/index.ts`.
- Added a code-health guardrail preventing SourceFS command registry logic from drifting back into the gateway.

## Why

- Continues R6 API decomposition after review checkpoint `5fcec6c`.
- Follows the SourceFS type extraction by moving the matching command execution boundary into a cohesive module.

## TDD

- RED: added a code-health guardrail first; it failed because `source-fs-command-registry.ts` did not exist.
- GREEN: moved the registry and helpers, preserved the root export, and reran focused SourceFS/safe-shell/code-health tests.

## Performance Notes

- Runtime behavior is unchanged: SourceFS list/read/grep still require explicit limits and enforce `maxListLimit`, `maxGrepMatches`, `maxGrepObjects`, and `maxReadBytes`.
- No new database queries, object-storage calls, unbounded reads, or memory retention paths were introduced.

## Verification

- `pnpm --filter @knowledge/api test -- src/code-health.test.ts`
- `pnpm --filter @knowledge/api test -- src/code-health.test.ts src/sourcefs.test.ts src/safe-shell.test.ts`
- `pnpm --filter @knowledge/api typecheck`
- `pnpm check`
- `pnpm build`
- `pnpm lint`
- `cargo test --workspace`
- `pnpm wasm:build`
- `pnpm compose:config`
- `docker compose --profile apps config`
- `git diff --check`

## Review Cadence

- This is implementation commit 6 after review checkpoint `5fcec6c`; the next mandatory 10-commit health review is not due yet.
