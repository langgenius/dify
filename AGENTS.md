# AGENTS.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## Project Overview

Dify is an open-source platform for developing LLM applications with an intuitive interface combining agentic AI workflows, RAG pipelines, agent capabilities, and model management.

## Repository Structure

- **`api/`** — Python Flask backend (DDD architecture: controller → service → core/domain)
- **`web/`** — Next.js 16 frontend (TypeScript, React 19, Tailwind CSS 4)
- **`packages/`** — Shared monorepo packages (`dify-ui` component library, tsconfig)
- **`e2e/`** — End-to-end tests (Cucumber + Playwright)
- **`sdks/`** — Client SDKs (Node.js, PHP)
- **`docker/`** — Docker deployment configs
- **`dev/`** — Development scripts

## Toolchain

- **Backend**: Python 3.12, `uv` package manager
- **Frontend**: Node.js (see `.nvmrc`), pnpm 10, TypeScript 6
- **Monorepo**: pnpm workspaces (`pnpm-workspace.yaml`)

## Quick Reference

### Environment Setup

```bash
make dev-setup              # full dev environment (Docker middleware + web + API)
make prepare-docker         # start only Docker middleware (PostgreSQL, Redis, etc.)
make prepare-web            # frontend env + pnpm install
make prepare-api            # backend env + uv sync --dev + flask db upgrade
```

### Backend (run from repo root)

```bash
uv run --project api <command>        # prefix for all backend CLI commands
make format                           # ruff formatting
make lint                             # ruff format + fix + import-linter + dotenv-linter
make type-check                       # basedpyright + pyrefly + mypy
make test                             # pytest full suite
make test TARGET_TESTS=./api/tests/path/to/test_file.py                  # single test file
make test TARGET_TESTS=./api/tests/path/to/test_file.py::TestClass::test_method  # single test
```

### Frontend (run from `web/`)

```bash
pnpm dev                   # Next.js dev server (port 3000)
pnpm build                 # production build
pnpm test                  # Vitest unit tests
pnpm lint:fix              # ESLint auto-fix
pnpm type-check            # tsgo type checking
```

### E2E (run from repo root)

```bash
pnpm -C e2e e2e            # run E2E against running stack
pnpm -C e2e e2e:full       # full reset + fresh install + E2E
pnpm -C e2e check          # format + lint + type-check
```

## Component Guides

- **Backend**: read `api/AGENTS.md` for architecture, coding style, SQLAlchemy patterns, and Pydantic usage
- **Frontend**: read `web/AGENTS.md` for overlay components, query/mutation patterns, and test generation
- **E2E**: read `e2e/AGENTS.md` for lifecycle, writing scenarios, and step definition conventions
- **Shared UI**: read `packages/dify-ui/AGENTS.md` for component authoring rules and design token mapping

## Important Patterns

- Backend config: use `configs.dify_config` — never read environment variables directly
- Tenant awareness: `tenant_id` must flow through every layer touching shared resources
- Frontend i18n: user-facing strings must use `web/i18n/en-US/`; no hardcoded text
- Async work: queue through Celery with Redis as the broker; implement tasks under `api/tasks/`
- Integration tests are CI-only; not expected to run locally

## General Practices

- Follow TDD: red → green → refactor
- Use `pytest` for backend tests with Arrange-Act-Assert structure
- Enforce strong typing; avoid `Any`/`any`; prefer `TypedDict` over `dict` for known schemas
- Prefer editing existing files; add new documentation only when requested
- Inject dependencies through constructors and preserve clean architecture boundaries
- Handle errors with domain-specific exceptions at the correct layer
