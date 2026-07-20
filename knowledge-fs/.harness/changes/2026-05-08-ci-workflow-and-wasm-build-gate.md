# CI Workflow And WASM Build Gate

## What Changed

- Added a GitHub Actions CI workflow for pull requests and pushes to `main`.
- CI now runs TypeScript checks, Vitest coverage gates, Rust checks/tests, WASM build, lint, and Docker Compose config validation.
- Added root `wasm:build` script using the pinned local `wasm-pack` package.
- Added `wasm-pack` `0.14.0` as a root dev dependency and updated `pnpm-lock.yaml`.
- Added `rust-toolchain.toml` to make the Rust stable toolchain and `wasm32-unknown-unknown` target explicit for local and CI runs.

## Why

Sprint 1 requires PR-level CI/CD and a real `wasm-pack build` gate for the placeholder Rust WASM crate. This turns the local verification chain into repeatable CI checks without adding deployment, publishing, or live container integration yet.

## TDD Notes

- RED: `test -f .github/workflows/ci.yml` failed because no CI workflow existed.
- RED: `pnpm wasm:build` failed because the root script did not exist.
- GREEN: Added the workflow, script, pinned `wasm-pack` dependency, lockfile update, and Rust toolchain file.

## Performance Notes

- CI validates existing bounded adapter and database planner tests, including coverage gates above 90%.
- The workflow validates Compose rendering only; it does not start local databases or object stores.
- WASM build output remains ignored via `pkg/`, avoiding tracked generated artifact churn.

## Verification

- `pnpm install --frozen-lockfile`: passed.
- `pnpm wasm:build`: passed.
- `pnpm check`: passed.
  - `packages/adapters`: 96.82% lines/statements, 96.12% branches, 100% functions.
  - `packages/api`, `packages/core`, and `packages/database`: 100% lines/statements/branches/functions.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.
- `pnpm compose:config`: passed.
- `docker compose --profile apps config`: passed.
- `git diff --check`: passed.

## Known Risks / Follow-Up

- The CI workflow does not deploy, publish Docker images, or run wrangler deployment.
- Live MinIO/PostgreSQL/Unstructured integration remains deferred to a later container-backed test slice.
- On macOS arm64, `wasm-pack` may compile `wasm-bindgen-cli` on first run if no prebuilt binary is available; the cache absorbs that after the first run.
