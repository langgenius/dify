# 2026-05-08 Initial Skeleton And Process Requirements

## Summary

- Added the initial TypeScript monorepo skeleton.
- Added Hono API, Next.js Admin, core, API, and adapter package boundaries.
- Added a Rust compute crate placeholder for future WASM-only pure compute modules.
- Added temporary task and progress documents for multi-round continuity.
- Recorded agent-level requirements for traceability and TDD.
- Added coverage gates for current behavioral TypeScript packages.

## Files Added Or Updated

- Root workspace/config:
  - `package.json`
  - `pnpm-workspace.yaml`
  - `pnpm-lock.yaml`
  - `turbo.json`
  - `tsconfig.base.json`
  - `biome.json`
  - `.gitignore`
- Apps:
  - `apps/api`
  - `apps/admin`
- Packages:
  - `packages/core`
  - `packages/api`
  - `packages/adapters`
- Rust:
  - `Cargo.toml`
  - `Cargo.lock`
  - `crates/knowledge_compute`
- Harness:
  - `.harness/docs/TEMP-task-document.md`
  - `.harness/docs/TEMP-progress-document.md`
  - `.harness/agents/development-requirements.md`
  - `.harness/changes/2026-05-08-initial-skeleton-and-process.md`

## Why

The project needs a concrete foundation aligned with `.harness/docs/iteration-plan.md` and `.harness/docs/rag-platform-redesign-technical-selection.md`.

The user also required:

- All changes to be traceable under `.harness/changes`.
- Project requirements to be recorded under `.harness/agents`.
- TDD according to `.harness/skills/test-driven-development/SKILL.md`.
- Test coverage above 90%.

## Verification

Initial skeleton verification completed before this change summary was created:

- `pnpm install`: passed.
- `pnpm check`: passed.
- `pnpm build`: passed.
- `pnpm lint`: passed.
- `cargo test --workspace`: passed.

After adding coverage gates:

- `pnpm test:coverage`: passed.
  - `packages/core`: 100% lines, statements, branches, and functions.
  - `packages/adapters`: 100% lines, statements, branches, and functions.
  - `packages/api`: 100% lines, statements, branches, and functions.
- `pnpm check`: passed, including coverage gates.
- `pnpm lint`: passed.

## Known Risks And Follow-Up

- `wasm-pack` is not installed. Current Rust verification uses `cargo check --workspace` and `cargo test --workspace`.
- App packages are shell placeholders and currently have no behavioral tests.
- Coverage gates currently apply to behavioral TypeScript packages:
  - `packages/core`
  - `packages/api`
  - `packages/adapters`
- Future packages with behavior must add tests and coverage gates before being considered complete.
