# Temporal-Compatible Workflow Boundary

## What Changed

- Added `docs/temporal-compatible-interface.md`.
- Documented how the current `JobQueueAdapter`, document compilation worker, repository activities, state-machine status facade, and trace recorder map to a future Temporal runtime.
- Captured future adapter shape, workflow input rules, deterministic workflow constraints, activity boundaries, cancellation/compensation behavior, workflow types, observability expectations, and migration steps.
- Linked the new document from `README.md`.

## Why

Sprint 12 requires the future Temporal adapter boundary to be documented but not implemented. This keeps the current durable job queue strategy intact while making future Temporal adoption deliberate and compatible with existing Hono APIs, repositories, and worker tests.

## Performance Notes

- The document explicitly forbids raw file bytes, parse text, embeddings, JWTs, prompts, and large arrays in workflow payload/history.
- Temporal activities must keep explicit limits, stable cursors, parameterized repository calls, and batched access patterns.
- Cleanup workflows must continue through bounded cursor pages instead of scanning full spaces.

## Verification

- RED:
  - `test -f docs/temporal-compatible-interface.md` failed because the document did not exist.
- GREEN:
  - `test -f docs/temporal-compatible-interface.md`
- Full verification:
  - `pnpm check`
  - `pnpm build`
  - `pnpm lint`
  - `cargo test --workspace`
  - `pnpm wasm:build`
  - `pnpm compose:config`
  - `docker compose --profile apps config`
  - `git diff --check`

## Risks And Follow-Up

- This slice is documentation only. A future implementation must add conformance tests before introducing Temporal SDK dependencies or runtime wiring.
