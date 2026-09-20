---
title: How to test — Dify
status: draft
updated: 2026-09-20
---

# How to test — Dify

## Backend

```
make test
```

Runs `uv run --project api --dev pytest` in two passes: everything except `api/tests/unit_tests/controllers` with
`-n auto`, `-p no:benchmark` and a 20-second per-test timeout — including every provider package's `unit_tests` —
then `api/tests/unit_tests/controllers` on its own [D: Makefile:106].

A single target:

```
make test TARGET_TESTS=./api/tests/<path>
```

[D: api/AGENTS.md:12]

Docker-backed integration suites are CI-owned and are not expected to run locally [D: api/AGENTS.md:14].
`make test-all` runs them [D: Makefile:122].

## Frontend, CLI, e2e

| Suite | Command | Source |
| --- | --- | --- |
| Web | `pnpm test` in `web/` | `web/package.json` |
| Design system | `pnpm test` in `packages/dify-ui/` | `packages/dify-ui/package.json` |
| CLI | `pnpm test`, or `pnpm ci` for tree-check + coverage + build | `cli/package.json` |
| Agent runtime (Go) | `go test ./...` | `dify-agent-runtime/go.mod` |
| E2E | `pnpm test:unit` in `e2e/` | `e2e/package.json` |

## Size

24,695 test cases across 2,182 files [D: survey of test names].

## First run warning

A cold `uv` cache resolves and builds 519 packages before the first test executes; this session observed roughly 25
minutes for that step alone. It is a property of the cache, not the suite.

OPEN: what coverage threshold must a change meet? `api-coverage` runs in CI [D: .github/workflows/api-tests.yml:154]
and no threshold is stated in the repository.
