# WASM Bindgen CI Build Fix

## What Changed

- Added root `wasm:bindgen:install` script that ensures `wasm-bindgen-cli 0.2.121` is installed on `PATH`.
- Updated `wasm:build` to run `wasm-pack build --mode no-install`, so `wasm-pack` no longer tries to download a prebuilt `wasm-bindgen` release during CI.
- Updated README WASM build notes to document the pinned `wasm-bindgen-cli` bootstrap.

## Why

- GitHub Actions failed with `Error fetching release: Request failed with status code 404` while `wasm-pack` tried to fetch a release dynamically.
- Installing the CLI through Cargo makes the build deterministic and avoids the failing release-download path.

## Verification

- `pnpm wasm:build`: passed locally with the new bootstrap path.
- Full verification passed:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- First CI run may spend extra time compiling `wasm-bindgen-cli`; adding a Cargo binary cache can optimize this later if needed.
