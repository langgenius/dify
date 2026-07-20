# Extract API Storage Quota Boundary

## Summary

- Extracted storage quota contracts, static quota repository, quota exceeded error, and enforcement helper from `packages/api/src/index.ts`.
- Added `packages/api/src/storage-quota.ts` with focused tests for static policy validation, disabled-quota short-circuiting, and over-quota rejection.
- Added a code-health guardrail so quota policy/enforcement logic does not drift back into the gateway file.

## Why

- This continues R6 module decomposition from `docs/code-review-issues.md`.
- Upload quota enforcement is performance-sensitive: when quota is disabled, the helper now has direct regression coverage proving it skips the usage read entirely.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/storage-quota.test.ts src/code-health.test.ts` failed before `storage-quota.ts` existed.
- GREEN focused: `pnpm --filter @knowledge/api test -- src/storage-quota.test.ts src/code-health.test.ts src/gateway.test.ts`

## Notes

- The temporary progress documents were previously removed after iteration-plan completion, so this permanent change summary records the slice.
- Review cadence restarted after checkpoint `f6ceb51`; this is implementation commit 2 after that checkpoint.
