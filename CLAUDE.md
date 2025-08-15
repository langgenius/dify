# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dify is an open-source platform for developing LLM applications with an intuitive interface combining agentic AI workflows, RAG pipelines, agent capabilities, and model management.

The codebase consists of:
- **Backend API** (`/api`): Python Flask application with Domain-Driven Design architecture
- **Frontend Web** (`/web`): Next.js 15 application with TypeScript and React 19
- **Docker deployment** (`/docker`): Containerized deployment configurations

## Development Commands

### Backend (API)

All Python commands must be prefixed with `uv run --project api`:

```bash
# Start development servers
./dev/start-api                   # Start API server
./dev/start-worker                # Start Celery worker

# Run tests
uv run --project api pytest      # Run all tests
uv run --project api pytest tests/unit_tests/     # Unit tests only
uv run --project api pytest tests/integration_tests/  # Integration tests

# Code quality
./dev/reformat                    # Run all formatters and linters
uv run --project api ruff check --fix ./    # Fix linting issues
uv run --project api ruff format ./         # Format code
uv run --project api mypy .                 # Type checking
```

### Frontend (Web)

```bash
cd web
pnpm lint                         # Run ESLint
pnpm eslint-fix                   # Fix ESLint issues
pnpm test                         # Run Jest tests
```

## Testing Guidelines

### Backend Testing
- Use `pytest` for all backend tests
- Write tests first (TDD approach)
- Test structure: Arrange-Act-Assert

## Code Style Requirements

### Python
- Use type hints for all functions and class attributes
- No `Any` types unless absolutely necessary
- Implement special methods (`__repr__`, `__str__`) appropriately

### TypeScript/JavaScript  
- Strict TypeScript configuration
- ESLint with Prettier integration
- Avoid `any` type

## Important Notes

- **Environment Variables**: Always use UV for Python commands: `uv run --project api <command>`
- **Comments**: Only write meaningful comments that explain "why", not "what"
- **File Creation**: Always prefer editing existing files over creating new ones
- **Documentation**: Don't create documentation files unless explicitly requested
- **Code Quality**: Always run `./dev/reformat` before committing backend changes

## Common Development Tasks

### Adding a New API Endpoint
1. Create controller in `/api/controllers/`
2. Add service logic in `/api/services/`
3. Update routes in controller's `__init__.py`
4. Write tests in `/api/tests/`

## Project-Specific Conventions

- All async tasks use Celery with Redis as broker
