# Local Smoke Admin BFF Upload

## Summary

- Changed `pnpm local:happy-path` so the upload step goes through the Admin BFF proxy instead of calling the API upload route directly.
- Added an Admin BFF health check to the live smoke path.
- Documented `LOCAL_SMOKE_ADMIN_BASE` for non-default Admin dev server URLs.

## TDD

- Added failing script/documentation assertions first for `LOCAL_SMOKE_ADMIN_BASE`, `/api/bff/health`, and the Admin BFF document upload path.
- Implemented the smoke update only after the red test confirmed the missing coverage.

## Performance And Safety

- The smoke still uses bounded JSON and SSE response readers.
- The Admin BFF upload path continues to rely on its bounded request-body proxy and default local auth injection.
- API reads and query checks remain tenant-scoped through the same uploaded asset and workspace id.

## Verification

- Passed: `node --test scripts/local-happy-path-smoke.test.mjs`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `cargo test --workspace`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 10 after review checkpoint `d7e35bd`.
- After this commit is committed and pushed, feature work must pause for the required 10-commit project health review.
