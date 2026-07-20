# Production App Image Smoke Command

## Summary

- Added `pnpm docker:apps:smoke` as a single command that builds both production app images and runs API/Admin image smokes.
- Added `pnpm docker:apps:smoke:test` and wired it into `pnpm check`.
- Documented the command in README and local infra notes.

## TDD

- RED: `pnpm docker:apps:smoke:test` failed because the command and test did not exist.
- GREEN: Added the ordered root package script and static command test.

## Performance And Safety

- The command reuses existing bounded smoke scripts instead of introducing new network or database dependencies.
- Build and smoke order is explicit: API image, Admin image, API WASM import, API health, Admin homepage.
- Static tests keep the cheap default gate fast while the real command remains available for release/local validation.

## Verification

- Passed: `pnpm docker:apps:smoke:test`
- Passed: `pnpm ci:workflow:test`
- Passed: `pnpm docker:apps:smoke`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 10 after review checkpoint `563f24c`.
- After this commit is pushed, the next step is the mandatory 10-commit health review before more feature work.
