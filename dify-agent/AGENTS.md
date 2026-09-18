# Agent Guide

Read surrounding docstrings and non-obvious comments before changing behavior. They are local contracts; update them only when their owned behavior changes, and keep them aligned with the current code. Read `docs/dify-agent/index.md` when changing the public runtime contract.

## Commands

Run package commands from `dify-agent/`:

- Lint: `make check`
- Format and fix lint: `make fix`
- Type check: `make typecheck`
- Tests: `make test`

Use the package's `uv` environment and Pydantic v2 APIs. Inspect current dependency source or official documentation before integrating, implementing, or mocking an API whose runtime contract is not established locally.

## Tests And Boundaries

- Keep local tests under `tests/local/` and mirror the `src/` package structure.
- Test stable behavior and real dependency boundaries. Do not use local mocks to claim real network, framework wiring, serialization, or third-party runtime coverage.
- Keep tests, public docs, and local contracts aligned with behavior changes.
- Preserve the existing runtime and layer owners; do not add generic utilities or compatibility boundaries to bypass them.
