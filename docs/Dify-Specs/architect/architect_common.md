---
title: Common Architecture — Dify
status: draft
owner: TBD
updated: 2026-09-20
---

# Common Architecture — Dify

> Conventions as practised, read out of configuration and enforcement, not out of a style guide.

## Stack

| Part | Technology | Version | Source |
| --- | --- | --- | --- |
| Backend API | Python + Flask + Flask-RESTX | ~=3.12.0 | `api/pyproject.toml:4` |
| Backend ORM | SQLAlchemy 2.0 (`mapped_column`) | — | `api/models/base.py:6` |
| Frontend | Next.js / React / TypeScript | 1.17.1 | `web/package.json` |
| Monorepo | pnpm workspaces | pnpm@12.4.2, node ^24.20.0 | `package.json:65` |
| Agent runtime | Go | 1.26 | `dify-agent-runtime/go.mod:3` |
| Agent service | Python (uvicorn) | 1.17.1 | `dify-agent/pyproject.toml` |
| CLI | TypeScript (`@langgenius/difyctl`) | 1.17.1 | `cli/package.json` |
| Deployment | Docker Compose | — | `docker/` |

The API package version, the web package version and the CLI package version are all `1.17.1` [D: api/pyproject.toml:3; web/package.json; cli/package.json].

I: the monorepo releases these three as one product version — basis: three independently publishable packages carry the identical version string while the private workspace packages do not [D: packages/contracts/package.json].

## Repository layout

| Directory | Code files | Role |
| --- | --- | --- |
| `api/` | 3456 | Flask backend, Celery tasks, RAG core, 43 vector-DB provider packages, 8 tracing providers |
| `web/` | 652 | Next.js console and web app |
| `packages/` | 360 | shared workspace packages, including the generated API contracts |
| `cli/` | 334 | `difyctl` |
| `dify-agent/` | 236 | standalone Python agent service |
| `e2e/` | 104 | Cucumber + Playwright suite |
| `dify-agent-runtime/` | 67 | Go sandbox runtime |
| `sdks/` | 39 | Node and PHP client SDKs |
| `docker/` | 14 | Compose deployment assets |

[D: survey of the working tree]

## Layering, as enforced

The backend layer rule is not a convention but a CI-gated contract. `api/.importlinter` declares **31 contracts**: one `layers` contract and 30 `forbidden` contracts [D: api/.importlinter:1].

The layer order is:

```
controllers  ->  services  ->  core  ->  libs
```

[D: api/.importlinter:21]

Thirteen root packages are in scope: `core`, `constants`, `context`, `configs`, `controllers`, `extensions`, `factories`, `libs`, `machinery`, `models`, `repositories`, `tasks`, `services` [D: api/.importlinter:2].

The layers contract carries **93 grandfathered exceptions**, each written out exactly, under this stated rule:

> "Migration baseline: keep every exception exact. The default unmatched-import error makes this list shrink whenever a legacy dependency is removed." [D: api/.importlinter:26]

I: the 93 exceptions are a debt register being paid down, not an accepted design — basis: the comment above says the list is expected to shrink, and `unmatched_ignore_imports_alerting = error` makes a stale entry fail the build rather than pass silently [D: api/.importlinter:28].

The 30 `forbidden` contracts are almost all of one shape — a named query or application service that only its own controller may import, e.g. `workspace-query-service-boundary`, `app-site-service-boundary`, `web-passport-service-boundary` [D: api/.importlinter:160; api/.importlinter:252; api/.importlinter:456].

I: the team is extracting narrow per-use-case services out of shared service modules and pinning each one with a contract as it lands — basis: 30 such contracts exist, all `forbidden`, all named `<use-case>-service-boundary`, and none carries an exception [D: api/.importlinter].

OPEN: is the target state one service module per controller, or does the extraction stop somewhere? The contracts record what has been pinned, never the destination.

## Lint, format, type-check

| Check | Command | Config |
| --- | --- | --- |
| Python format + lint | `make lint` → `ruff format` then `ruff check --fix` | `api/.ruff.toml` |
| Response contract | `make api-contract-lint` → `api/dev/lint_response_contracts.py` | — |
| Import layers | `uv run --directory api --dev lint-imports` | `api/.importlinter` |
| Env files | `dotenv-linter ./api/.env.example ./web/.env.example` | — |
| Python types | `make type-check` → `pyrefly` then `mypy` | `api/pyproject.toml:314` |
| Backend tests | `make test` → `uv run --project api --dev pytest` | `api/pytest.ini` |

[D: Makefile:78; Makefile:87; Makefile:92; Makefile:104]

`make api-contract-lint` checks that each Flask handler's documented response matches the schema it returns [D: Makefile:87]. A `# response-contract:ignore` comment opts a handler out [D: api/controllers/mcp/mcp.py:69].

OPEN: how many handlers currently carry `response-contract:ignore`, and is that list meant to shrink the way the import-linter baseline is?

## CI

37 workflows in `.github/workflows/` [D: .github/workflows/]. `main-ci.yml` is the pull-request entry point and gates work behind a change detector: `check-changes` decides whether the api, cli and web suites run at all [D: .github/workflows/main-ci.yml:38].

| Workflow | What it runs |
| --- | --- |
| `main-ci.yml` | orchestrates api / cli / web test jobs behind change detection |
| `style.yml` | `python-style`, `web-style`, `ts-common-style`, `superlinter` |
| `api-tests.yml` | `api-unit`, `api-integration`, `api-coverage` |
| `db-migration-test.yml` | applies the Alembic migrations |
| `pyrefly-type-coverage.yml` | tracks Python type coverage and comments it on the PR |

[D: .github/workflows/main-ci.yml:210; .github/workflows/style.yml:45; .github/workflows/api-tests.yml:17]

Integration tests are Docker-backed and CI-owned; `AGENTS.md` states they are not expected to run locally [D: api/AGENTS.md:14].

## Naming, as practised

- Controller classes end in `Api` and subclass `flask_restx.Resource`; the route is a class decorator `@<ns>.route("<path>")` and the HTTP verb is the method name [D: api/controllers/console/app/app.py:638].
- Mount prefixes come from the Blueprint, never the decorator: `/console/api`, `/v1`, `/api`, `/openapi/v1`, `/inner/api`, `/files`, `/mcp`, `/triggers` [D: api/controllers/console/__init__.py:10].
- Table names are plural snake_case; ORM classes are singular PascalCase [D: api/models/model.py:407].
- Enum columns use `EnumText(<StrEnum>)` rather than a database enum type [D: api/models/model.py:425].
- Alembic revisions are named `<date>-<rev>_<description>.py` [D: api/migrations/versions/].

OPEN: which of the above are enforced anywhere, and which merely hold? Only the import layers and the response contract have a checker; the rest is observed regularity.

## Authorization idioms

Five distinct mechanisms guard endpoints in the same tree:

| Idiom | Example | Routes |
| --- | --- | --- |
| Stacked decorators | `@setup_required @login_required @account_initialization_required @rbac_permission_required` | 601 carry `setup_required` |
| Combined admission | `@console_account_admission(rbac_checks=[...])` | 111 |
| Resource base class | `class ChatApi(WebApiResource)` | web app and service API |
| Scope-checked endpoint | `@endpoint(requirements=(CheckSubject(...), CheckScope(...)))` | `/openapi/v1` |
| Module-local composed guard | `@_snippet_draft_var_prerequisite` | per module |

[D: api/controllers/console/app/app.py:638; api/controllers/console/workspace/skills.py:300; api/controllers/web/completion.py:192; api/controllers/openapi/workspaces.py:90; api/controllers/console/snippets/snippet_workflow_draft_variable.py:108]

I: `console_account_admission` is the intended replacement for the stacked decorators — basis: it bundles the same four checks into one call and injects a typed `RequestContext`, and its docstring calls it a declaration of "Console account admission" [D: api/controllers/console/flask_admission.py:55].

OPEN: is the stacked-decorator form deprecated? 601 routes still use it and nothing in the tree says it is on the way out. Unlike the import-linter baseline, this migration has no checker counting it down.

## Generated code

Three generators produce checked-in artefacts:

- `api/dev/generate_swagger_specs.py` → OpenAPI documents, rendered to `api/openapi/markdown/*.md` [D: api/dev/generate_swagger_specs.py:1]
- `packages/contracts/generated/**/*.gen.ts` — 180 files of TypeScript types, Zod schemas and oRPC clients [D: packages/contracts/generated/]
- `cli/src/commands/tree.generated.ts` — the CLI command tree, drift-gated by `pnpm tree:check` in CI [D: cli/src/commands/tree.generated.ts:2]

The generated contract is a runtime dependency, not documentation: the CLI imports its client from it [D: cli/src/api/apps.ts:5].

OPEN: what guarantees the generated contract is regenerated when a handler's response shape changes? `tree.generated.ts` has a CI drift gate; it is not stated whether `packages/contracts` has one.

## Open questions

- OPEN: which conventions above are intentional and which are accidental? Enforcement distinguishes the two only for imports and response contracts.
- OPEN: what is the review checklist for a backend change? That is a team practice and no file states it.
- OPEN: `api/AGENTS.md` and `cli/AGENTS.md` instruct coding agents. Are they also the human contributor guide, or is `CONTRIBUTING.md` authoritative where the two differ?
