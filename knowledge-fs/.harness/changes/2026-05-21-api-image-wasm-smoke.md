# API Image WASM Smoke Gate

## Summary

- Added `pnpm docker:api:smoke` to run a container-level smoke against the built production API image.
- Added `scripts/api-image-smoke.mjs`, which imports `./crates/knowledge_compute/pkg/knowledge_compute.js` inside the container and verifies core WASM compute exports.
- Added the smoke to the GitHub Actions Docker image job after `pnpm docker:api:build`.

## TDD

- Added failing workflow/package/script assertions first for the missing Docker image smoke.
- Implemented the script, root scripts, and CI step after the red test confirmed the gap.

## Performance And Safety

- The smoke does not start the HTTP server or external services.
- It performs a single bounded `docker run` and validates module exports plus a tiny token-count call.
- This guards against runtime image regressions where Docker build succeeds but packaged WASM cannot be imported.

## Verification

- Passed: `node --test scripts/github-actions-workflow.test.mjs scripts/api-image-smoke.test.mjs`
- Passed: `pnpm docker:api:smoke`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `cargo test --workspace`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 4 after review checkpoint `563f24c`.
