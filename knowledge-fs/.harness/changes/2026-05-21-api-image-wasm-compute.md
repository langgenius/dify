# API Image WASM Compute Packaging

## Summary

- Added a Rust `wasm-builder` stage to `apps/api/Dockerfile`.
- The production API image now builds `crates/knowledge_compute` for `wasm32-unknown-unknown`, runs pinned `wasm-bindgen-cli` `0.2.121`, and copies the generated package into `./crates/knowledge_compute/pkg`.
- Updated docs and the durable local runtime iteration plan to record the container compute packaging requirement.

## TDD

- Added a failing Dockerfile test first to prove the API image did not bundle the WASM compute package.
- Implemented the Dockerfile stage and runtime copy after the red test confirmed the gap.

## Performance And Safety

- The runtime image still runs compiled JavaScript as the non-root `node` user.
- WASM remains pure compute and is packaged as a local runtime asset; no database, network, filesystem, cache, or streaming dependency was added to Rust.
- This avoids containerized ingestion silently falling back to artifact-only behavior when source-tree `crates/knowledge_compute/pkg` is absent.

## Verification

- Passed: `pnpm --filter @knowledge/api-app test -- src/server-options.test.ts`
- Passed: `pnpm docker:api:build`
- Passed: `docker run --rm --entrypoint node knowledge-fs-api:local -e "..."`
- Passed: `pnpm check`
- Passed: `pnpm build`
- Passed: `pnpm lint`
- Passed: `cargo test --workspace`
- Passed: `git diff --check`

## Cadence

- This is implementation commit 3 after review checkpoint `563f24c`.
