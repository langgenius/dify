# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dify is an open-source LLM application development platform with agentic AI workflows, RAG pipelines, agent capabilities, model management, and observability features. It consists of two main components:
- **api/**: Python backend (Flask + Celery)
- **web/**: Next.js frontend (React 19 + TypeScript)

## Common Commands

### Development Setup (from root)
```bash
make dev-setup          # Full setup: Docker middleware + web + API
make prepare-docker     # Start PostgreSQL, Redis, Weaviate via Docker
make prepare-web        # Install web dependencies (pnpm)
make prepare-api        # Install API dependencies (uv) + run migrations
make dev-clean          # Stop middleware and clean volumes
```

### Backend (api/)
```bash
# Dependencies & migrations
uv sync --dev
uv run flask db upgrade

# Run services
uv run flask run --host 0.0.0.0 --port=5001 --debug
uv run celery -A app.celery worker -P threads -c 2 --loglevel INFO -Q dataset,priority_dataset,priority_pipeline,pipeline,mail,ops_trace,app_deletion,plugin,workflow_storage,conversation,workflow,schedule_poller,schedule_executor,triggered_workflow_dispatcher,trigger_refresh_executor

# Code quality
uv run ruff format ./api                    # Format
uv run ruff check --fix ./api               # Lint with fixes
uv run basedpyright                         # Type check (from api/ dir)
uv run lint-imports                         # Import linter (from api/ dir)

# Tests
uv run pytest                               # All tests
uv run pytest tests/unit_tests/             # Unit tests only
uv run pytest tests/integration_tests/      # Integration tests

# Makefile shortcuts (from root)
make format && make check && make lint && make type-check && make test
```

### Frontend (web/)
```bash
pnpm install
pnpm run dev                # Development server with Turbopack
pnpm run build              # Production build
pnpm run lint               # ESLint + oxlint
pnpm run type-check         # TypeScript check
pnpm test                   # Jest tests
pnpm test -- --watch        # Watch mode
pnpm analyze-component <path>  # Analyze component complexity for testing
pnpm storybook              # Start Storybook
```

## Architecture

### Backend Structure
```
api/
├── controllers/          # HTTP endpoints (console/, web/, service_api/)
├── services/             # Business logic orchestration
├── core/                 # Domain logic
│   ├── app/              # Application runtime (chat, workflow, agent)
│   ├── workflow/         # Workflow engine and nodes
│   ├── rag/              # RAG pipelines and vector store clients
│   ├── tools/            # Tool manager and implementations
│   ├── plugin/           # Plugin runtime (impl/, entities/)
│   └── file/             # File handling
├── models/               # SQLAlchemy ORM models
├── configs/              # Configuration (DifyConfig via pydantic-settings)
├── extensions/           # Flask extensions (storage, redis, logging)
├── tasks/                # Celery background tasks
└── migrations/           # Alembic database migrations
```

### Frontend Structure
```
web/
├── app/                  # Next.js App Router pages
│   └── components/       # React components
│       └── base/         # Reusable base components (never mock in tests)
├── context/              # React context providers
├── service/              # API client services
├── hooks/                # Custom React hooks
├── i18n/                 # Internationalization
├── testing/              # Test utilities and guidelines
└── __tests__/            # Integration test suites
```

### Key Patterns

**Backend:**
- Configuration: Always use `configs.dify_config`, never read env vars directly
- Storage: Use `extensions.ext_storage.storage` for blob IO
- Redis: Use `extensions.ext_redis.redis_client`
- HTTP: Use `core.helper.ssrf_proxy` for outbound requests (SSRF protection)
- Sessions: Use `with Session(db.engine, expire_on_commit=False)` context manager
- Logging: `logger = logging.getLogger(__name__)`, never use `print`
- Tenancy: Always scope queries/operations by `tenant_id`

**Frontend:**
- State: Zustand for stores, React context for providers
- Forms: react-hook-form with zod validation
- Queries: TanStack Query for API calls
- Workflow: ReactFlow for workflow canvas
- Testing: Jest + React Testing Library (see web/testing/testing.md)

## Backend Code Style

- Python 3.11-3.12, managed with `uv`
- Follow `.ruff.toml` rules, max 100 chars/line
- Pydantic v2 for DTOs with `extra="forbid"`
- SQLAlchemy expressions preferred over raw SQL
- Controllers parse input, call services, return responses (no business logic)
- Services coordinate domain operations, explicit side effects
- Keep files under 800 lines
- Domain exceptions in `services/errors`, `core/errors`

## Frontend Testing

Tests use Jest 29.7 + React Testing Library 16.0 with @happy-dom/jest-environment.
- File naming: `ComponentName.spec.tsx` in same directory as component
- Never mock base components from `@/app/components/base/`
- Mock external dependencies only: `@/service/*`, `next/navigation`
- Use `jest.clearAllMocks()` in `beforeEach()`, not `afterEach()`
- Mock i18n: `t: (key: string) => key`

See `web/testing/testing.md` for complete guidelines.

## Database Migrations

```bash
# Generate migration
uv run flask db revision --autogenerate -m "<summary>"

# Apply migrations
uv run flask db upgrade

# Other CLI commands
uv run flask reset-password    # Reset user password (SELF_HOSTED)
uv run flask reset-email       # Reset user email (SELF_HOSTED)
uv run flask vdb-migrate       # Vector database migration
```

## Plugins

Plugins are tenant-installable bundles with providers (tool, model, datasource, trigger, endpoint, agent strategy):
- Manifests: `core/plugin/entities/plugin.py`
- Installation: `services/plugin/plugin_service.py`
- Runtime: `core/plugin/impl/*` (normalizes builtin and plugin capabilities)
- Tools: Acquire via `core/tools/tool_manager.py`

## Additional Resources

- Backend skills docs: `api/agent_skills/` (infra.md, coding_style.md, plugin.md, trigger.md)
- Frontend testing: `web/testing/testing.md`
- API setup: `api/README.md`
- Web setup: `web/README.md`
