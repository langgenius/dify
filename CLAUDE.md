# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

jim-dify is a customized fork of Dify - an open-source LLM application development platform. It enables users to build and deploy AI-powered applications with visual workflows, knowledge bases, and various AI capabilities.

## Key Commands

### Frontend Development (web/)

```bash
cd web
pnpm dev              # Start development server with debugging
pnpm build            # Production build
pnpm lint             # Run ESLint
pnpm fix              # Auto-fix linting issues
pnpm test             # Run Jest tests
pnpm check-i18n       # Validate internationalization files
```

### Backend Development (api/)

```bash
cd api
uv sync --dev         # Install dependencies (requires uv package manager)
uv run flask run --host 0.0.0.0 --port=5001 --debug  # Start API server
uv run pytest         # Run all tests
uv run ruff check .   # Lint Python code
uv run ruff format .  # Format Python code
uv run mypy .         # Type check Python code
```

### Database Migration (api/)

The project uses **Flask-Migrate** (Alembic) for database schema management:

```bash
cd api
# Apply pending migrations to database
uv run flask db upgrade

# Generate new migration from model changes  
uv run flask db migrate -m "description_of_changes"

# Check current migration status
uv run flask db current

# View migration history
uv run flask db history

# Downgrade to previous migration (if needed)
uv run flask db downgrade
```

**Migration File Naming Pattern**: `YYYY_MM_DD_HHMM-{revision_id}_{description}.py`

**Key Migration Guidelines**:
- Always review auto-generated migrations before applying
- Use descriptive migration messages
- Test migrations on staging before production
- Migrations are in `api/migrations/versions/`
- Migration templates use `script.py.mako`

### Docker Development

```bash
# Build and push all images
make build-all        # Build all Docker images
make push-all         # Push all images to registry
make build-push-all   # Build and push in one command

# Start middleware services (PostgreSQL, Redis, etc.)
cd docker
docker compose -f docker-compose.middleware.yaml --profile weaviate -p dify up -d
```

## Architecture Overview

### Frontend (Next.js + React + TypeScript)
- **App Router**: Uses Next.js 15 app directory structure
- **State Management**: Zustand for global state, React Context for component trees
- **Data Fetching**: SWR and TanStack Query for server state
- **Styling**: Tailwind CSS with custom design system
- **Key Directories**:
  - `web/app/` - Next.js pages and layouts
  - `web/components/` - Reusable React components
  - `web/service/` - API client layer
  - `web/i18n/` - Internationalization files

### Backend (Flask + Python)
- **API Framework**: Flask with RESTful endpoints
- **Database**: PostgreSQL with SQLAlchemy ORM
- **Task Queue**: Celery with Redis for async operations
- **Key Directories**:
  - `api/controllers/` - HTTP endpoint handlers
  - `api/core/` - Core business logic and AI integrations
  - `api/models/` - Database models
  - `api/services/` - Business service layer
  - `api/tasks/` - Async task definitions

### AI/LLM Integration
- Supports multiple LLM providers (OpenAI, Anthropic, etc.)
- Vector database integration for RAG (Retrieval Augmented Generation)
- Workflow builder for complex AI pipelines
- Agent capabilities with tool use

## Development Workflow

1. **Initial Setup**: 
   - Backend requires PostgreSQL, Redis, and optionally a vector database
   - Frontend uses pnpm for package management
   - Both have separate .env configuration files

2. **Code Quality**:
   - Frontend: ESLint + TypeScript strict mode
   - Backend: Ruff for linting, MyPy for type checking
   - Both have comprehensive test suites

3. **Deployment**:
   - Primary deployment via Docker Compose
   - Images pushed to `akiyu303/jim-*` registry
   - Supports multiple deployment environments

## Important Notes

- ESLint and TypeScript errors are currently ignored in production builds for the frontend
- The project uses standalone Next.js output mode for optimized Docker images
- Multi-language support is extensive - always check i18n when adding new UI strings
- Backend workers handle different task types: dataset processing, generation, mail, operations tracing
- Environment variables control feature flags and integrations