# GitHub Flow Build Workflow

## Summary

- Added a GitHub Flow workflow for pull requests, pushes to `main`, and manual dispatch.
- Kept the build pipeline aligned with local gates: TypeScript/tests/coverage/evaluation checks, build, lint, Compose config validation, Rust tests, WASM build, and production API Docker image build.
- Added a Node test that asserts the workflow shape so CI drift is caught by `pnpm check`.

## TDD Notes

- Red: `pnpm ci:workflow:test` failed against the old workflow because it lacked GitHub Flow naming, manual dispatch, concurrency cancellation, a production Docker image gate, and still duplicated `pnpm eval:regression` outside `pnpm check`.
- Green: updated `.github/workflows/ci.yml` and wired `ci:workflow:test` into the root `check` script.

## Performance And Safety Notes

- The workflow uses concurrency cancellation so stale runs do not consume runner capacity.
- `pnpm check` remains the single source for expensive regression gates, avoiding duplicate evaluation work in CI.
- The Docker job only builds the production API image; it does not publish artifacts or deploy.

## Verification

- Passed:
  - `pnpm ci:workflow:test`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`
- Local environment limitation:
  - `pnpm docker:api:build` could not complete because the local Docker daemon was not reachable at `unix:///Users/jyong/.docker/run/docker.sock`; the workflow still gates the production image build on GitHub-hosted runners.
