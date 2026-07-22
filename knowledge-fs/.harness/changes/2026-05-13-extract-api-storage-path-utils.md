# Extract API Storage Path Utilities

## Summary

- Continued R6 API decomposition by moving SourceFS path normalization, mount/object-key mapping, document object key generation, and filename sanitization into `packages/api/src/storage-path-utils.ts`.
- Added direct unit tests for traversal rejection, SourceFS mount containment, object key mapping, and sanitized upload object keys.
- Added a code-health guardrail so storage path helpers stay out of `packages/api/src/index.ts`.

## Why

- Storage path construction is security-sensitive and performance-neutral pure logic. Keeping it in a small tested module makes traversal and key isolation behavior easier to audit.
- The gateway still uses the same object key format and SourceFS virtual path behavior.

## Verification

- RED: `pnpm --filter @knowledge/api test -- src/storage-path-utils.test.ts src/code-health.test.ts` failed because `storage-path-utils.ts` did not exist.
- GREEN: `pnpm --filter @knowledge/api test -- src/storage-path-utils.test.ts src/code-health.test.ts src/sourcefs.test.ts src/gateway.test.ts`
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

- Filename sanitization preserves the existing behavior exactly, including dashes before extensions in some punctuation-heavy names.
- SourceFS object path functions remain string-based; later live storage integrations should continue using these utilities rather than duplicating key math.
