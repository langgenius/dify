# 10-Commit Health Review + Admin BFF Bounded JSON Fix

Date: 2026-05-21

## Context

- Mandatory review checkpoint: after implementation commit `f4c83cc`.
- Previous review checkpoint: `563f24c`.
- Reviewed 10 implementation commits:
  - `86b3d93 Add API-only local smoke command`
  - `62890b4 Add durable local smoke command`
  - `a07289a Bundle WASM compute in API image`
  - `438aab6 Smoke API image WASM compute`
  - `0085684 Smoke API image HTTP health`
  - `cb83114 Guard app compose profile contract`
  - `6a4711e Add Admin production Docker image`
  - `01a0382 Smoke Admin image HTTP homepage`
  - `5de5df7 Tighten Docker build context hygiene`
  - `f4c83cc Add production app image smoke command`

## Findings

- Technical direction stayed aligned with the architecture guardrails: Hono owns API/runtime behavior, Next.js stays a thin Admin shell/BFF, and Rust remains pure WASM compute.
- Docker runtime health improved: API/Admin image build and smoke commands now cover WASM import, API HTTP health, Admin HTTP homepage, and app-image smoke ordering.
- Docker build contexts are now guarded against nested `.next`, `.turbo`, `coverage`, `dist`, `node_modules`, and generated `pkg` directories.
- High-priority performance boundary issue found and fixed: Admin BFF default workspace bootstrap read upstream JSON with unbounded `response.json()`, violating the bounded response-read rule.
- Tests and CI gates remained green before the review checkpoint, including `pnpm check`, `pnpm build`, `pnpm lint`, `cargo test --workspace`, and `pnpm docker:apps:smoke`.

## Fix

- Replaced Admin BFF workspace lookup/create `response.json()` calls with a bounded JSON reader.
- The bounded reader cancels upstream reads after `maxBodyBytes`, returns `502 Bad Gateway`, and prevents upload proxying when bootstrap responses are oversized or malformed.
- Added regression tests for oversized default workspace lookup and workspace creation responses.

## Verification

- Passed:
  - `pnpm --filter @knowledge/admin test -- lib/bff.test.ts`
  - `cargo test --workspace`
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `node --test scripts/docker-apps-smoke.test.mjs`
  - `git diff --check`

## Follow-Up Risk

- Docker image builds still depend on package registry access during the build stage. A later infrastructure slice can add BuildKit cache mounts for pnpm store reuse, but this is not blocking current correctness.
