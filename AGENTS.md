# AGENTS.md

## Project Overview

Dify is an open-source platform for developing LLM applications with an intuitive interface combining agentic AI workflows, RAG pipelines, agent capabilities, and model management.

The codebase is split into:

- **Backend API** (`/api`): Python Flask application organized with Domain-Driven Design
- **Frontend Web** (`/web`): Next.js application using TypeScript and React
- **Docker deployment** (`/docker`): Containerized deployment configurations
- **Dify Agent Backend** (`/dify-agent`): Backend services for managing and executing agent

## Backend Workflow

- Read `api/AGENTS.md` for details
- Run backend CLI commands through `uv run --project api <command>`.
- Integration tests are CI-only and are not expected to run in the local environment.

## Frontend Workflow

- Read `web/AGENTS.md` for details
- For enterprise Docker validation, image builds, or project-scoped image cleanup, read `docker/README.enterprise.md` and use `.agents/skills/enterprise-docker-workflow/`.

## Enterprise Agent Entrypoint

When Codex, Claude Code, or another coding agent enters this repository for enterprise work, read these files first and treat them as the current source of truth:

- `AGENTS.md`: repository-level agent rules and enterprise branch truth.
- `README.enterprise-maintenance.md`: enterprise branch strategy, official-stable-tag workflow, release rules, and stale-history warnings.
- `ENTERPRISE_REPLAY_PLAN.md`: required enterprise patch groups to replay on top of a clean official stable tag/tree.
- `docker/README.enterprise.md`: enterprise compose overlay, image rebuild, offline package, and verified-image rules.

Do not use old chat summaries, local memory, the previous dirty `enterprise/main` tree, or `upstream/main` development state as authority. The old `D:\CodexSpace\dify-enterprise-candidate-20260424` workspace and `codex/enterprise-candidate-20260424` branch are historical `1.13.3` enterprise references only; copy from them only when a patch is listed in the replay plan or re-proven by current-source tests and runtime validation.

## Enterprise Branch Strategy

- Official stable tag/tree `1.15.0` is the current enterprise release baseline.
- `main` may mirror or observe official development state, but it is not the enterprise release base.
- `codex/enterprise-candidate-1.15.0-20260626` is the current clean enterprise candidate rebuilt from official tag `1.15.0`.
- The enterprise version for this candidate is `1.15.0-enterprise`.
- Enterprise images: `dify-api-enterprise:1.15.0-enterprise`, `dify-web-enterprise:1.15.0-enterprise`.
- `worker` and `worker_beat` reuse the enterprise API image.
- Future official releases should start from the new official stable tag/tree and replay required enterprise patch groups, instead of mechanically merging official changes into an old enterprise tree.
- The previous `enterprise/main`, `codex/enterprise-candidate-20260424`, and `D:\CodexSpace\dify-enterprise-candidate-20260424` are historical references only unless a specific patch is re-selected and validated.

## Enterprise PR Safety

- Never open pull requests against the official upstream repository `langgenius/dify` for enterprise candidate work.
- GitHub may print or display an upstream "Create pull request" link after pushing a branch; do not use that link for enterprise work.
- Enterprise PRs, if needed, must be created only inside the fork `D-S-William-Guo/dify`, with both base and head branches in that fork.
- Before creating or updating any PR, explicitly verify the base repository is `D-S-William-Guo/dify`, not `langgenius/dify`.
- If an upstream PR is opened by mistake, close it immediately with a short explanation and do not request review.

## Testing & Quality Practices

- Follow TDD: red → green → refactor.
- Use `pytest` for backend tests with Arrange-Act-Assert structure.
- Enforce strong typing; avoid `Any` and prefer explicit type annotations.
- Write self-documenting code; only add comments that explain intent.

## Language Style

- **Python**: Keep type hints on functions and attributes, and implement relevant special methods (e.g., `__repr__`, `__str__`). Prefer `TypedDict` over `dict` or `Mapping` for type safety and better code documentation.
- **TypeScript**: Use the strict config, rely on ESLint (`pnpm lint:fix` preferred) plus `pnpm type-check`, and avoid `any` types.

## General Practices

- Prefer editing existing files; add new documentation only when requested.
- Inject dependencies through constructors and preserve clean architecture boundaries.
- Handle errors with domain-specific exceptions at the correct layer.

## Enterprise Sync Rule

- Do not treat "merge `upstream/main` into `enterprise/main`" as the enterprise maintenance method.
- The default method is: fetch the official stable tag/tree, create a clean enterprise candidate from that release baseline, replay the required enterprise patch groups, validate each group, then promote the candidate.
- Enterprise workspace, platform-admin, 智慧广场, Docker enterprise overlay, offline packaging, plugin offline install fixes, and dataset/hit-testing fixes are the business baseline that must survive each release sync.
- When upgrading to a new official stable tag, keep official source first and re-apply only the minimum enterprise adjustments on top.  Never carry local runtime data, build caches, or stale tests into the new candidate.
- Never carry local runtime data, build caches, `node_modules`, stale tests, or broad unproven UI/performance experiments into a new candidate.
- A release candidate is valid only after source checks, enterprise image rebuild, compose service recreation, browser-click validation, and log inspection all point to the same rebuilt image batch.

## Project Conventions

- Backend architecture adheres to DDD and Clean Architecture principles.
- Async work runs through Celery with Redis as the broker.
- Frontend user-facing strings must use `web/i18n/en-US/`; avoid hardcoded text.
