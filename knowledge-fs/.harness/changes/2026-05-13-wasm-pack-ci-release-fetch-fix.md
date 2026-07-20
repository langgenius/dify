# WASM Pack CI Release Fetch Fix

## What Changed

- Replaced the root `wasm:build` path with a local Node build script that runs:
  - `cargo build --manifest-path crates/knowledge_compute/Cargo.toml --target wasm32-unknown-unknown --release`
  - `wasm-bindgen target/wasm32-unknown-unknown/release/knowledge_compute.wasm --target bundler --out-dir crates/knowledge_compute/pkg`
- Removed the root `wasm-pack` dev dependency and updated `pnpm-lock.yaml`.
- Updated README WASM notes to describe the `cargo build` plus pinned `wasm-bindgen` path.

## Why It Changed

GitHub Actions still failed with `Error fetching release: Request failed with status code 404` after `wasm-bindgen-cli 0.2.121` was installed. The remaining network fetch came from invoking `wasm-pack`, so the stable fix is to avoid `wasm-pack` entirely in the CI build gate.

## Verification

- RED first:
  - `node -e 'const pkg=require("./package.json"); if ((pkg.scripts["wasm:build"]||"").includes("wasm-pack")) { throw new Error("wasm:build must not invoke wasm-pack"); }'` failed because `wasm:build` still invoked `wasm-pack`.
- GREEN:
  - The same script-level assertion now passes and also confirms `wasm-pack` is no longer a dev dependency.
  - `pnpm wasm:build` passes locally through the new no-`wasm-pack` path.
- Full verification:
  - `pnpm install --frozen-lockfile`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Performance And Reliability Notes

- This keeps the pinned `wasm-bindgen-cli` install path but removes `wasm-pack`'s release-fetch behavior from CI.
- The generated `crates/knowledge_compute/pkg` remains a build artifact and is not committed.
