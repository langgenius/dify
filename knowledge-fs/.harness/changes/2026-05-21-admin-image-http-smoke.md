# Admin Image HTTP Smoke

## Summary

- Added `pnpm docker:admin:http-smoke` to start the production Admin image and verify the Next.js standalone homepage renders.
- Added a bounded static script test and wired it into `pnpm check`.
- Added the Admin HTTP smoke to the GitHub Actions Docker image job after image build and API image smokes.

## TDD

- RED: `pnpm docker:admin:http-smoke` failed because the script was missing.
- GREEN: Added the smoke script, package scripts, workflow assertions, and CI step.

## Performance And Safety

- The smoke uses a dynamically mapped localhost port and a bounded HTML response reader.
- The container cleanup path force-removes the smoke container in `finally`.
- The smoke checks the rendered shell without requiring database, MinIO, Unstructured, or API containers.

## Verification

- Passed: `node --test scripts/admin-image-http-smoke.test.mjs`
- Passed: `pnpm ci:workflow:test`
- Passed: `pnpm docker:admin:build`
- Passed: `pnpm docker:admin:http-smoke`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 8 after review checkpoint `563f24c`.
