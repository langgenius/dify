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

## Project Conventions

- Backend architecture adheres to DDD and Clean Architecture principles.
- Async work runs through Celery with Redis as the broker.
- Frontend user-facing strings must use `web/i18n/en-US/`; avoid hardcoded text.

## Agent V2 Frontend Constraints

- Treat workflow Agent and Agent v2 as separate product surfaces. The existing workflow `agent` node is the legacy Old Agent and should keep its current strategy/plugin-based behavior. Do not refactor legacy Agent code to support Agent v2 unless explicitly requested.
- New Agent work must use the Agent v2 surface and code path: `web/features/agent-v2`, `web/app/components/workflow/nodes/agent-v2`, `BlockEnum.AgentV2`, and the `agentV2` i18n namespace where applicable. Do not add new Agent behavior to legacy `web/app/components/workflow/nodes/agent`.
- Do not mix, alias, or compatibility-bridge Old Agent and Agent v2 data shapes. Keep fields such as `agent_strategy_*` on legacy Agent only, and fields such as `agent_roster`, `agent_task`, and Agent v2 backend bindings on Agent v2 only.
- Shared workflow utilities may branch on the explicit node type/discriminator when necessary, but they must preserve the boundary: legacy Agent behavior must not depend on Agent v2 data, and Agent v2 behavior must not fall back to legacy Agent strategy/plugin behavior.
- For Agent v2 frontend work under `web/features/agent-v2`, use generated contracts and `consoleQuery` from `@/service/client` for all Agent v2 backend APIs. Do not add ad hoc REST helpers, mock data, compatibility shims, or handwritten API types for new Agent v2 interfaces.
- Use existing `@langgenius/dify-ui/*` primitives before adding feature-local UI chrome. Prefer primitive default styles; add call-site CSS only for real design deltas.
- Prefer primitive data/CSS selectors for visual states instead of mirroring state in React only to choose classes.
- Avoid arbitrary Tailwind values when an existing project utility or token class expresses the same value. Keep arbitrary values only for design-system exceptions without a native utility.
- Preserve keyboard accessibility in Agent v2 pages: visible focus rings must not be clipped, and inert layout regions should not become keyboard focus targets.
- Keep Agent v2 i18n scoped to the explicitly maintained locales unless the supported-locale scope changes.
- Keep Agent v2 module copy in the `agentV2` namespace; use shared namespaces such as `common` only for genuinely shared operation labels.
