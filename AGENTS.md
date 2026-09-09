# AGENTS.md

Dify is an open-source platform for building LLM applications, agentic workflows, and RAG pipelines. This monorepo contains the backend API (`api/`), frontend application (`web/`), deployment assets (`docker/`), standalone agent backend (`dify-agent/`), CLI (`cli/`), and end-to-end suite (`e2e/`). Follow the nearest scoped `AGENTS.md` for the files being changed. Apply its guidance within the user's requested scope; explicit user instructions take precedence over workflow defaults.

## Development Principles

- Before developing or changing features that involve users or tenants, read and follow [User and tenant isolation](docs/tenant-isolation.md). Pass or create the relevant users and tenants explicitly, and do not share stateful objects between operations.
- At the end of every development cycle, read [Naming](docs/naming.md), review the names of files, functions, classes, methods, and variables in the changed code, and correct abstract or unclear names before finishing. Update affected references with each rename.

## Repository Gotchas

- Run backend commands through `uv run --project api <command>`.
- Backend integration tests are CI-only and are not expected to run locally.
- Keep `docker/.env.example` limited to variables required for a default Docker Compose deployment to start. Put optional and provider-specific settings in the matching `docker/envs/*.env.example` file; `docker/.env` overrides those service-specific env files.
