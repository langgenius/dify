# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Backend (Python Flask API)
All Python commands must be prefixed with `uv run --project api`:

```bash
# Development server
uv run flask run --host 0.0.0.0 --port=5001 --debug

# Database operations
uv run flask db upgrade              # Run database migrations
uv run flask db migrate -m "message" # Create new migration

# Testing
uv run pytest                          # All tests
uv run pytest tests/unit_tests/        # Unit tests only
uv run pytest tests/integration_tests/ # Integration tests only
uv run pytest -k "test_name"           # Run specific test

# Code quality (run before commits)
./dev/reformat                         # Format, lint, and type check
uv run ruff check --fix ./            # Fix linting issues
uv run ruff format ./                 # Format code
uv run basedpyright .                 # Type checking
./dev/basedpyright-check [path]       # Type check specific path

# Celery workers
uv run celery -A app.celery worker -P gevent -c 1 --loglevel INFO
uv run celery -A app.celery worker -P gevent -c 1 --loglevel INFO -Q dataset,generation,mail,ops_trace,app_deletion,plugin,workflow_storage,conversation
uv run celery -A app.celery beat      # Scheduled tasks
```

### Frontend (Next.js)
```bash
cd web
pnpm dev                              # Development server with Turbopack
pnpm build                            # Production build
pnpm lint                             # ESLint check
pnpm lint:fix                        # ESLint fix
pnpm test                             # Jest tests
pnpm test:watch                       # Jest in watch mode
pnpm storybook                        # Component development

# i18n management
pnpm check-i18n                      # Check internationalization completeness
pnpm auto-gen-i18n                   # Auto-generate i18n keys
pnpm gen:i18n-types                  # Generate TypeScript types for i18n
```

### Environment Setup
```bash
make dev-setup                        # Complete development setup
make prepare-docker                   # Setup Docker middleware (PostgreSQL, Redis, Weaviate)
make prepare-api                      # Setup API environment
make prepare-web                      # Setup web environment
make dev-clean                        # Clean development environment

# Alternative quality commands
make lint                             # Backend linting with ruff and import-linter
make format                           # Backend code formatting
make type-check                       # Backend type checking
```

## Architecture

### Project Structure
- `/api` - Python Flask backend with Domain-Driven Design
- `/web` - Next.js 15 frontend with React 19 and TypeScript
- `/docker` - Docker configurations for middleware services
- `/sdks/nodejs-client` - Node.js SDK for Dify API

### Tech Stack
- **Backend**: Python Flask, UV package manager, Celery, Redis, PostgreSQL
- **Frontend**: Next.js 15, React 19, TypeScript (strict), TailwindCSS, pnpm v10.x
- **Requirements**: Node.js ≥ v22.11.0, Python ≥ 3.11 < 3.13

### Key Components
- **Workflow Engine**: Visual workflow builder with agentic capabilities
- **RAG Pipeline**: Document processing and vector database integration
- **Model Management**: Support for 20+ LLM providers and vector databases
- **Observability**: Application monitoring and analytics

### Backend Architecture (Domain-Driven Design)
- **Controllers**: API endpoints and request/response handling
- **Services**: Business logic implementation
- **Repositories**: Data access layer abstraction
- **Models**: Database entities and domain models
- **Core**: Framework-agnostic business logic
  - `core/workflow/`: Workflow execution engine
  - `core/rag/`: RAG pipeline implementation
  - `core/model_runtime/`: LLM provider abstractions
  - `core/agent/`: Agent capabilities and tools
  - `core/memory/`: Conversation memory management

### Frontend Architecture (Next.js App Router)
- **App Router**: Next.js 15 with React 19 Server Components
- **Components**: Shared UI components in `/app/components/`
- **Layouts**: Route-specific layouts in `(commonLayout)` and `(shareLayout)`
- **State Management**: Zustand for client state, React Context for themes
- **Routing**: File-based routing with App Router structure

### Database & Storage
- **Primary DB**: PostgreSQL with SQLAlchemy ORM and Alembic migrations
- **Cache/Queue**: Redis for caching and Celery message broker
- **Vector DB**: Weaviate (default), ChromaDB, Qdrant, and 20+ others supported
- **File Storage**: Local, S3, Azure Blob, Google Cloud Storage

## Development Guidelines

### Code Quality
- **Python**: Type hints required, use ruff formatting, no `Any` types
- **TypeScript**: Strict mode enabled, no `any` types, ESLint compliance
- **Always run** `./dev/reformat` before backend commits
- **Testing**: TDD approach, pytest for backend, Jest for frontend
- **Import Linting**: Use `lint-imports` to enforce architectural boundaries

### Internationalization
- All user-facing text must use i18n keys
- Edit files in `/web/i18n/en-US/` for English text
- No hardcoded strings in components
- Use `pnpm check-i18n` to verify completeness
- Generate TypeScript types with `pnpm gen:i18n-types`

### Testing Strategy
- **Backend**: Unit tests in `tests/unit_tests/`, integration tests in `tests/integration_tests/`
- **Frontend**: Component tests with Jest and React Testing Library
- **API Testing**: Use TestContainers for integration tests with real databases
- **Mock System**: Configure environment variables in `pyproject.toml` under `tool.pytest_env`

### Environment Variables
- Copy `.env.example` to `.env` in both `/api` and `/web` directories
- Backend env vars are documented in `/api/.env.example`
- Frontend env vars are documented in `/web/.env.example`

## Important Notes
- Use **UV package manager** for all Python commands: `uv run --project api <command>`
- Frontend uses **pnpm** for dependency management (v10.x required)
- Docker setup includes PostgreSQL, Redis, and Weaviate by default
- Current development branch: `local`, main branch for PRs: `main`

## Common Development Workflows

### Adding a New Feature
1. Create feature branch from `main`
2. Implement backend changes in `/api`
3. Add corresponding frontend changes in `/web`
4. Run `./dev/reformat` for backend code quality
5. Run `pnpm lint:fix` for frontend code quality
6. Write tests for new functionality
7. Ensure all tests pass with `uv run pytest`
8. Verify i18n completeness with `pnpm check-i18n`

### Database Changes
1. Modify models in `/api/models/`
2. Generate migration: `uv run flask db migrate -m "description"`
3. Review generated migration file
4. Apply migration: `uv run flask db upgrade`
5. Test migration rollback if needed

### Working with Celery Tasks
- Background tasks are queued to: `dataset`, `generation`, `mail`, `ops_trace`, `app_deletion`, `plugin`, `workflow_storage`, `conversation`
- Start worker for specific queue: `uv run celery -A app.celery worker -Q queue_name`
- Monitor scheduled tasks with `uv run celery -A app.celery beat`