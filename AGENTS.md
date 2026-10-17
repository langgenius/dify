# AGENTS.md

Dify is an open-source platform for building LLM applications, agentic workflows, and RAG pipelines. This monorepo contains the backend API (`api/`), frontend application (`web/`), deployment assets (`docker/`), standalone agent backend (`dify-agent/`), CLI (`cli/`), and end-to-end suite (`e2e/`). Follow the nearest scoped `AGENTS.md` for the files being changed. Apply its guidance within the user's requested scope; explicit user instructions take precedence over workflow defaults.

## Builder native testing: repository boundary

- Implement this project in the Dify monorepo wherever practical, including `api/`, `dify-agent/`, `dify-agent-runtime/`, and deployment assets. Reuse existing runtime and dependency capabilities before proposing another repository change.
- Changes to Sandbox, Graphon, plugin daemon, or any other repository are exceptions. Consider them only when a concrete verified gap and a comparison with Dify-only alternatives demonstrate a substantial benefit in correctness, simplicity, or maintenance. Document that comparison before proceeding; a theoretical stronger guarantee is insufficient.
- Cross-repository builds, releases, and publication are not default prerequisites for this MVP. Existing Sandbox work remains frozen; use the official locked Graphon 0.7.0 dependency. Earlier plans requiring upstream changes do not override this user instruction of 2026-10-16.
- Report unsupported capabilities honestly. Do not bypass authorization, claim remote process cleanup from an HTTP timeout, or call a partial/mock result full native acceptance. Frontend and ENG-1117 remain out of the current implementation scope.

## Repository Gotchas

- Run backend commands through `uv run --project api <command>`.
- Backend integration tests run locally. They provision ephemeral PostgreSQL and Redis through testcontainers, so they need a working Docker daemon; run them before relying on CI.
- Keep `docker/.env.example` limited to variables required for a default Docker Compose deployment to start. Put optional and provider-specific settings in the matching `docker/envs/*.env.example` file; `docker/.env` overrides those service-specific env files.
