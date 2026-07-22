# Docker Build Context Hygiene

## Summary

- Tightened `.dockerignore` so nested build artifacts and dependency directories are excluded from Docker build contexts.
- Added `pnpm docker:context:test` and wired it into `pnpm check`.
- Added a workflow/package-script assertion so the guardrail remains part of CI quality checks.

## TDD

- RED: `node --test scripts/dockerignore.test.mjs` failed because the guardrail did not exist.
- GREEN: Added recursive ignore patterns and the focused static test.

## Performance And Safety

- Docker builds no longer need to send nested `apps/admin/.next`, package `dist`, coverage, `node_modules`, or generated WASM `pkg` artifacts in the context.
- Source workspace roots remain visible to Dockerfiles.
- This directly reduces CI/local build context transfer and avoids accidental artifact leakage into images.

## Verification

- Passed: `pnpm docker:context:test`
- Passed: `pnpm ci:workflow:test`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 9 after review checkpoint `563f24c`.
