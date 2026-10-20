# AGENTS.md

Dify is an open-source platform for building LLM applications, agentic workflows, and RAG pipelines. This monorepo contains the backend API (`api/`), frontend application (`web/`), deployment assets (`docker/`), standalone agent backend (`dify-agent/`), CLI (`cli/`), and end-to-end suite (`e2e/`). Follow the nearest scoped `AGENTS.md` for the files being changed. Apply its guidance within the user's requested scope; explicit user instructions take precedence over workflow defaults.

## Builder native testing: repository boundary

- Implement this project in the Dify monorepo wherever practical, including `api/`, `dify-agent/`, `dify-agent-runtime/`, and deployment assets. Reuse existing runtime and dependency capabilities before proposing another repository change.
- Changes to Sandbox, Graphon, plugin daemon, or any other repository are exceptions. Consider them only when a concrete verified gap and a comparison with Dify-only alternatives demonstrate a substantial benefit in correctness, simplicity, or maintenance. Document that comparison before proceeding; a theoretical stronger guarantee is insufficient.
- Cross-repository builds, releases, and publication are not default prerequisites for this MVP. Existing Sandbox work remains frozen. Follow main’s official locked Graphon 0.8.0 dependency, as approved by the user on 2026-10-20; this supersedes the earlier 0.7.0 pin. Upstream repository changes remain outside the default scope.
- Report unsupported capabilities honestly. Do not bypass authorization, claim remote process cleanup from an HTTP timeout, or call a partial/mock result full native acceptance. Frontend and ENG-1117 remain out of the current implementation scope.

## Confirmed Test Run: product direction (2026-10-17)

- Prefer the existing ordinary native Test Run and existing Code runtime. Code may access the network; networking alone is not a reason to block a test, require another sandbox, or add approval for every Code request. Avoid excessive Mock/Dry Run isolation and unnecessary engineering complexity.
- Builder should assess possible risks from the user's task, generated code, node configuration, tool declarations, Agent capabilities, accounts and targets, then explain the concrete risks before running. Use Builder's reasoning capability; node-type and name/keyword heuristics alone are not the intended risk assessment.
- Reuse the existing test interaction for risk disclosure and applicable confirmations. Use Mock selectively according to the test choice and actual risk; never fabricate credentials, permissions or real resource availability. The user has not removed existing Workspace permissions or the PRD's explicit side-effect and destructive-operation rules.
- Reuse existing execution, authorization, Run and recovery facilities. Keep fixes for stale confirmations, duplicate effects after recovery, and autosave revision conflicts narrow. Do not introduce a new generic risk engine, isolation service or cross-repository prerequisite for these fixes. Frontend requirements are recorded, not implemented, unless the user changes that scope.

## Repository Gotchas

- Run backend commands through `uv run --project api <command>`.
- Backend integration tests run locally. They provision ephemeral PostgreSQL and Redis through testcontainers, so they need a working Docker daemon; run them before relying on CI.
- Keep `docker/.env.example` limited to variables required for a default Docker Compose deployment to start. Put optional and provider-specific settings in the matching `docker/envs/*.env.example` file; `docker/.env` overrides those service-specific env files.
