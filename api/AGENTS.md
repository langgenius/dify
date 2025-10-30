# Agent Skill Index

Start with the section that best matches your need. Each entry lists the problems it solves plus key files/concepts so you know what to expect before opening it.

______________________________________________________________________

## Platform Foundations

- **[Infrastructure Overview](agent_skills/infra.md)**\
  When to read this:

  - You need to understand where a feature belongs in the architecture.
  - You’re wiring storage, Redis, vector stores, or OTEL.
  - You’re about to add CLI commands or async jobs.\
    What it covers: configuration stack (`configs/app_config.py`, remote settings), storage entry points (`extensions/ext_storage.py`, `core/file/file_manager.py`), Redis conventions (`extensions/ext_redis.py`), plugin runtime topology, vector-store factory (`core/rag/datasource/vdb/*`), observability hooks, SSRF proxy usage, and core CLI commands.

- **[Coding Style](agent_skills/coding_style.md)**\
  When to read this:

  - You’re writing or reviewing backend code and need the authoritative checklist.
  - You’re unsure about Pydantic validators, SQLAlchemy session usage, or logging patterns.
  - You want the exact lint/type/test commands used in PRs.\
    Includes: Ruff & BasedPyright commands, no-annotation policy, session examples (`with Session(db.engine, ...)`), `@field_validator` usage, logging expectations, and the rule set for file size, helpers, and package management.

______________________________________________________________________

## Plugin & Extension Development

- **[Plugin Systems](agent_skills/plugin.md)**\
  When to read this:

  - You’re building or debugging a marketplace plugin.
  - You need to know how manifests, providers, daemons, and migrations fit together.\
    What it covers: plugin manifests (`core/plugin/entities/plugin.py`), installation/upgrade flows (`services/plugin/plugin_service.py`, CLI commands), runtime adapters (`core/plugin/impl/*` for tool/model/datasource/trigger/endpoint/agent), daemon coordination (`core/plugin/entities/plugin_daemon.py`), and how provider registries surface capabilities to the rest of the platform.

- **[Plugin OAuth](agent_skills/plugin_oauth.md)**\
  When to read this:

  - You must integrate OAuth for a plugin or datasource.
  - You’re handling credential encryption or refresh flows.\
    Topics: credential storage, encryption helpers (`core/helper/provider_encryption.py`), OAuth client bootstrap (`services/plugin/oauth_service.py`, `services/plugin/plugin_parameter_service.py`), and how console/API layers expose the flows.

______________________________________________________________________

## Workflow Entry & Execution

- **[Trigger Concepts](agent_skills/trigger.md)**\
  When to read this:
  - You’re debugging why a workflow didn’t start.
  - You’re adding a new trigger type or hook.
  - You need to trace async execution, draft debugging, or webhook/schedule pipelines.\
    Details: Start-node taxonomy, webhook & schedule internals (`core/workflow/nodes/trigger_*`, `services/trigger/*`), async orchestration (`services/async_workflow_service.py`, Celery queues), debug event bus, and storage/logging interactions.

______________________________________________________________________

## Additional Notes for Agents

- All skill docs assume you follow the coding style guide—run Ruff/BasedPyright/tests listed there before submitting changes.
- When you cannot find an answer in these briefs, search the codebase using the paths referenced (e.g., `core/plugin/impl/tool.py`, `services/dataset_service.py`).
- If you run into cross-cutting concerns (tenancy, configuration, storage), check the infrastructure guide first; it links to most supporting modules.
- Keep multi-tenancy and configuration central: everything flows through `configs.dify_config` and `tenant_id`.
- When touching plugins or triggers, consult both the system overview and the specialised doc to ensure you adjust lifecycle, storage, and observability consistently.
