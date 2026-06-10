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

- For Agent v2 frontend work under `web/features/agent-v2`, use generated contracts and `consoleQuery` from `@/service/client` for all Agent v2 backend APIs. Do not add ad hoc REST helpers, mock data, compatibility shims, or handwritten API types for new Agent v2 interfaces.
- Keep Agent v2 feature changes aligned with Figma nodes and existing Studio/App card patterns. Use existing `@langgenius/dify-ui/*` primitives for tabs, segmented controls, buttons, dialogs, dropdown menus, alert dialogs, scroll areas, and form fields instead of recreating component chrome.
- Agent roster actions belong in the card `...` dropdown. Use default `DropdownMenu` item styling, use destructive item variants for delete-like actions, and do not expose unsupported actions as active controls.
- Agent roster card and skeleton layouts must stay in sync. Do not render fields absent from the design or generated roster contract, such as version badges, and do not add skeleton placeholders for absent card elements.
- Create Agent split buttons must keep left and right segments as separate button primitives. The left segment opens the create dialog directly; the right segment can stay as a noop until real dropdown behavior is wired.
- Prefer primitive data/CSS selectors for Agent v2 visual states, especially tabs and menus, instead of JS class branching for styling.
- Preserve keyboard accessibility in Agent v2 pages: visible focus rings must not be clipped, and tab order should move from the Create Agent action to the first actionable card without landing on inert layout regions.
- Agent v2 i18n currently maintains only `web/i18n/en-US/agent-v-2.json` and `web/i18n/zh-Hans/agent-v-2.json` unless the supported-locale scope changes.
