# Replace the project-owned Rust/WASM compute runtime with TypeScript

Date: 2026-07-16

## Why

The Rust crate was compiled to WASM and then called from TypeScript through JSON boundaries, but
the implemented workload is bounded application compute rather than a native-runtime requirement.
Maintaining Cargo, `wasm-bindgen`, a generated package, dynamic loading, and a second image build
stage added deployment and compatibility risk without a corresponding product benefit.

## Runtime changes

- Replaced the WASM wrapper with an in-process `createTypeScriptComputeRuntime()` implementation
  for parse-artifact chunking, approximate token counting, line/word LCS diff, reciprocal-rank
  fusion, evidence packing, UTF-8 offsets, and stable UUID v5 node IDs.
- Kept the old deterministic behavior while removing JSON calls across a WASM boundary.
- Pinned Unicode behavior instead of inheriting the host Node/ICU version:
  - `unicode-segmenter@0.15.0` supplies Unicode 17 grapheme and general-property tables.
  - `@unicode/unicode-17.0.0@1.6.17` supplies the Unicode 17 word-break property ranges used by
    the local UAX #29 word segmenter.
  - The Unicode 17 official WordBreakTest corpus passed 1,944/1,944 cases with zero differences.
- Added fail-closed limits for diff matrix allocation and tokenization, non-finite RRF scores,
  unpaired UTF-16 surrogates, input traversal depth, and input node count.
- The gateway and the API app now always assemble a TypeScript compute runtime. Synchronous upload
  reindexing no longer silently disappears when an external generated artifact is absent. Explicit
  compute injection remains available for tests and alternative implementations.
- `/health.components.compute` now executes a bounded token-count and single-item RRF probe against
  the final default or injected runtime. A broken injected runtime reports `false`; the top-level
  `ok` field remains the platform-liveness signal, so readiness monitors must also check the
  component field.

## Build and deployment changes

- Removed `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `crates/knowledge_compute`, and the WASM
  build/import smoke scripts.
- Removed Cargo/Rust/WASM setup and gates from package scripts and GitHub Actions.
- Simplified the API Dockerfile to a Node-only builder and a final image containing only
  `/workspace/server.mjs`.
- Replaced the misleading API HTTP smoke name in active gates with
  `docker:api:bundle-smoke`. This starts the isolated bundle with `NODE_ENV=test`, requires
  `components.compute === true`, and reports `productionConfigValidated: false`. It does not claim
  to validate production fail-closed configuration, durable storage, or external providers.
  `docker:api:http-smoke` remains only as a compatibility alias.
- Updated active architecture, operator, deployment, local-runtime, and iteration documentation.
  Historical Rust/WASM review and plan entries remain clearly marked as superseded history.

## Verification

- Compute: 22/22 tests; 92.99% statements, 91.88% branches, 96.49% functions, 92.99% lines;
  typecheck and Biome passed.
- API package: 2,555 passed, 3 skipped; typecheck passed.
- API app: 168/168 passed; typecheck passed.
- Root `pnpm typecheck`: 20/20 tasks passed.
- Root `pnpm build`: 11/11 tasks passed.
- Retrieval regression, Phase 4 evaluation, Swagger, and migration-artifact gates passed.
- CI workflow, Docker context, bundle-smoke contract, and app-smoke contract tests passed.
- `pnpm docker:api:build` passed without a Rust toolchain or generated WASM artifact.
- `pnpm docker:api:bundle-smoke` returned `compute: true` and
  `productionConfigValidated: false`.
- Final image inspection found only `/workspace/server.mjs` and no legacy compute loader, Cargo,
  Rust toolchain, or generated WASM identifiers.
- Biome passed for every changed source/config file and `git diff --check` passed.

The repository-wide `pnpm check` was also exercised during the migration. It stops at an unchanged
`@knowledge/core` branch-coverage baseline of 88.02% against its 90% threshold; all test stages
before that point passed. The repository-wide lint command likewise includes unrelated pre-existing
Admin/API findings and the user's untracked coverage output. Neither baseline was changed or staged;
all files in this migration pass the scoped lint gate.
