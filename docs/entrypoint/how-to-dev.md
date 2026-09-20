---
title: How to develop — Dify
status: draft
updated: 2026-09-20
---

# How to develop — Dify

> Derived from the Makefile and the repository's own `AGENTS.md` files. Commands marked `I:` were not run here.

## Set up

```
make dev-setup
```

Composes `prepare-docker` (middleware stack), `prepare-web` and `prepare-api` [D: Makefile:19].

## Work on the backend

Run every Python command through uv, scoped to the api project [D: AGENTS.md]:

```
uv run --project api <command>
```

| Goal | Command | Source |
| --- | --- | --- |
| Format | `make format` | `Makefile:68` |
| Lint only | `make check` | `Makefile:73` |
| Format + lint + contract + imports + env | `make lint` | `Makefile:78` |
| Type-check (pyrefly + mypy) | `make type-check` | `Makefile:92` |
| Unit tests | `make test` | `Makefile:104` |
| One target | `make test TARGET_TESTS=./api/tests/<path>` | `api/AGENTS.md:12` |

`make lint` also runs the response-contract linter, import-linter and dotenv-linter [D: Makefile:78].

## Work on the frontend

```
pnpm dev
```

Node `^24.20.0`, `pnpm@12.4.2` [D: package.json:65].

## Rules worth knowing before you edit

- Backend imports must obey `controllers -> services -> core -> libs`; this is CI-enforced with 31 contracts
  [D: api/.importlinter:21]. A new violation fails the build.
- A route's served path is the Blueprint prefix plus the decorator literal. `@console_ns.route("/apps")` serves
  `/console/api/apps` [D: api/controllers/console/__init__.py:10].
- The API contract is generated. Change a handler's response and regenerate `packages/contracts`
  [D: api/dev/generate_swagger_specs.py:1].
- `docker/.env.example` holds only what a default Compose deployment needs; provider-specific settings go in
  `docker/envs/*.env.example` [D: AGENTS.md].

OPEN: what is the expected local workflow before opening a pull request — is `make lint && make type-check && make test`
the accepted gate? Each target exists; nothing states the sequence.
