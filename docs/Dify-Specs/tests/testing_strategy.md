---
title: Testing Strategy — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Testing Strategy — Dify

> **As-built.** This describes the suite that exists and the policy that is enforced. Where no policy is stated in
> the repository, the gap is written as a question rather than filled with a reasonable-sounding rule.

## Test levels

| Level | Where | Command | Source |
| --- | --- | --- | --- |
| Backend unit | `api/tests/unit_tests`, plus each provider package's `tests/unit_tests` | `make test` | `Makefile:104` |
| Backend controller unit | `api/tests/unit_tests/controllers` | second pass of `make test` | `Makefile:106` |
| Backend integration (Docker-backed) | `api/tests/test_containers_integration_tests` | `make test-all`, CI-owned | `Makefile:122`, `api/AGENTS.md:14` |
| Frontend unit | `web/`, `packages/dify-ui/` | `pnpm test` | `web/package.json` |
| CLI unit + e2e | `cli/src`, `cli/test/e2e` | `pnpm test`, `pnpm ci` | `cli/package.json` |
| Agent runtime | `dify-agent-runtime/` | `go test ./...` | `dify-agent-runtime/go.mod` |
| End-to-end | `e2e/` (Cucumber + Playwright) | `pnpm test:unit` | `e2e/package.json` |

24,695 test cases across 2,182 files [D: survey of test function and `describe`/`it` names].

`make test` runs pytest in two passes, and the split is explicit in the target: everything except
`api/tests/unit_tests/controllers` with `-n auto`, `-p no:benchmark` and a 20-second per-test timeout, then the
controllers alone [D: Makefile:106].

I: the controllers are run separately because they are not safe to run in the same parallel pass — basis: the target
goes out of its way to `--ignore` them in the parallel invocation and then runs them without `-n auto`
[D: Makefile:106].

## Coverage policy

`api-coverage` runs as a CI job [D: .github/workflows/api-tests.yml:154], and the CLI declares a `test:coverage`
script [D: cli/package.json].

OPEN: what coverage threshold must a change meet? No threshold is stated in any config or workflow in this
repository, so coverage is measured and reported without a stated bar.

## Test data

The backend suite builds its data in-test rather than from checked-in fixture files [D: api/tests/]. The fixture sets
in `data/fixtures/` were derived from `schema/schemas.json` by this reconstruction and are consumed only by
`route/route.py`.

OPEN: is there a seeded dataset for manual testing, and where does it live?

## Pipeline gates

`main-ci.yml` is the pull-request entry point. A `check-changes` job decides whether the api, cli and web suites run
at all, so a change that touches none of them skips those suites [D: .github/workflows/main-ci.yml:38].

| Job | Runs |
| --- | --- |
| `style.yml` | `python-style`, `web-style`, `ts-common-style`, `superlinter` |
| `api-tests.yml` | `api-unit`, `api-integration`, `api-coverage` |
| `db-migration-test.yml` | applies the Alembic migrations |
| `pyrefly-type-coverage.yml` | tracks Python type coverage, comments it on the PR |

Beyond the suites, three checks gate the backend that are not tests: the response-contract linter, import-linter's 31
layer contracts, and dotenv-linter [D: Makefile:78].

OPEN: which of these jobs are required to merge, as opposed to merely reported? Branch protection is not in the
repository.

## Non-functional testing

`accessibility-e2e.yml` and `sandbox-runtime-tests.yml` exist [D: .github/workflows/]. `-p no:benchmark` in the unit
target implies a benchmark plugin is installed and deliberately disabled for that pass [D: Makefile:106].

OPEN: is there performance or load testing? `scripts/stress-test/` exists in the tree but no workflow runs it.

OPEN: what non-functional targets would such a test check against? None is stated anywhere — see `PRDs/prd.md`.

## This session's run

`make test` was started in this session on 2026-09-20 with the user's approval.

**It did not reach a result, and produced no pytest output at all.** The command spent roughly 25 minutes resolving
and installing 519 packages into a cold `uv` cache, then created a second virtual environment for the `--dev`
dependency group and began installing again. Around 58 minutes in — still in that second install, with no test yet
collected — the process was killed by the surrounding tooling because the machine ran low on memory.

That is a fact about this machine, not about the suite: nothing here shows whether the tests pass, fail or how long
they take.

Consequently **no status row anywhere in this hub reads `done`.** Every domain rule, user story, task and test case
is `todo`, because `done` asserts that a check passed *here* and no check passed here.

To cash any of those rows, run:

```
make test
```

and record the command and its result in the note, per `status-model.md`.

OPEN: how long does `make test` take on a warm cache? The 25-minute figure above is a property of an empty `uv` cache
on this machine, not of the suite, and should not be quoted as the suite's runtime.
