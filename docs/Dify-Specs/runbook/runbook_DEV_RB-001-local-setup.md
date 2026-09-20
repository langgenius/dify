---
title: Runbook DEV RB-001 — Local setup
id: RB-001
features: [F-001, F-002, F-003, F-004, F-005, F-006, F-007]
kind: runbook
status: draft
owner: TBD
updated: 2026-09-20
---

# Runbook DEV RB-001 — Local setup

> Derived from the Makefile, `AGENTS.md` and the Compose assets. **No command below was run in this session except
> `make test`**; everything else is `I:` and the reader should expect to debug it.

## Prerequisites

- Python `~=3.12.0` [D: api/pyproject.toml:4]
- Node `^24.20.0` and `pnpm@12.4.2` [D: package.json:65]
- Docker, for the middleware stack [D: docker/docker-compose.middleware.yaml]
- Go `1.26`, only to build the agent runtime [D: dify-agent-runtime/go.mod:3]

## Set up

```
make dev-setup
```

Runs `prepare-docker`, `prepare-web` and `prepare-api` in order; `prepare-docker` starts the middleware stack and
creates the middleware env file if it is missing [D: Makefile:19].

I: `make dev-setup` is the single supported entry point for a backend development environment — basis: it is the
first target in the Makefile and the only one that composes the other three [D: Makefile:19].

## Run backend commands

All Python commands go through uv, scoped to the api project [D: AGENTS.md]:

```
uv run --project api <command>
```

## Check the code

| Goal | Command | Source |
| --- | --- | --- |
| Format and lint | `make lint` | `Makefile:78` |
| Lint only | `make check` | `Makefile:73` |
| Type-check | `make type-check` | `Makefile:92` |
| Unit tests | `make test` | `Makefile:104` |
| One target | `make test TARGET_TESTS=./api/tests/<path>` | `api/AGENTS.md:12` |
| Full suite incl. Docker | `make test-all` | `Makefile:122` |

`make test` runs pytest in two passes: everything except `api/tests/unit_tests/controllers` with `-n auto` and a
20-second per-test timeout, then the controllers on their own [D: Makefile:106].

Docker-backed integration suites are CI-owned and are not expected to run locally [D: api/AGENTS.md:14].

## Verification

This session ran `make test` once. Its result is recorded in `tests/testing_strategy.md`; the status tables in this
hub are set from that run and from nothing else.

OPEN: how long should a clean `make test` take on a developer machine? This session observed roughly 25 minutes of
dependency resolution before the first test executed, which is a property of a cold `uv` cache rather than of the
suite.

## Open questions

- OPEN: what is the minimum hardware for a local stack? The Compose file starts Postgres, MySQL, Redis, a sandbox, a
  plugin daemon, an agent backend and two proxies [D: docker/docker-compose.yaml].
- OPEN: which services must be running for `make test` to pass, and which are mocked? The unit suite ran here without
  a started stack, but that is an observation of one run, not a stated contract.
- OPEN: how does a developer reset local state — is dropping the middleware volumes the supported path?
