# API Agent Guide

## Agent Notes (must-check)

Before you start work on any backend file under `api/`, you MUST check whether a related note exists under:

- `agent-notes/<same-relative-path-as-target-file>.md`

Rules:

- **Path mapping**: for a target file `<path>/<name>.py`, the note must be `agent-notes/<path>/<name>.py.md` (same folder structure, same filename, plus `.md`).
- **Before working**:
  - If the note exists, read it first and follow any constraints/decisions recorded there.
  - If the note conflicts with the current code, or references an "origin" file/path that has been deleted, renamed, or migrated, treat the **code as the single source of truth** and update the note to match reality.
  - If the note does not exist, create it with a short architecture/intent summary and any relevant invariants/edge cases.
- **During working**:
  - Keep the note in sync as you discover constraints, make decisions, or change approach.
  - If you move/rename a file, migrate its note to the new mapped path (and fix any outdated references inside the note).
  - Record non-obvious edge cases, trade-offs, and the test/verification plan as you go (not just at the end).
  - Keep notes **coherent**: integrate new findings into the relevant sections and rewrite for clarity; avoid append-only “recent fix” / changelog-style additions unless the note is explicitly intended to be a changelog.
- **When finishing work**:
  - Update the related note(s) to reflect what changed, why, and any new edge cases/tests.
  - If a file is deleted, remove or clearly deprecate the corresponding note so it cannot be mistaken as current guidance.
  - Keep notes concise and accurate; they are meant to prevent repeated rediscovery.

## Skill Index

Start with the section that best matches your need. Each entry lists the problems it solves plus key files/concepts so you know what to expect before opening it.

### Platform Foundations

#### [Infrastructure Overview](agent_skills/infra.md)

- **When to read this**
  - You need to understand where a feature belongs in the architecture.
  - You’re wiring storage, Redis, vector stores, or OTEL.
  - You’re about to add CLI commands or async jobs.
- **What it covers**
  - Configuration stack (`configs/app_config.py`, remote settings)
  - Storage entry points (`extensions/ext_storage.py`, `core/file/file_manager.py`)
  - Redis conventions (`extensions/ext_redis.py`)
  - Plugin runtime topology
  - Vector-store factory (`core/rag/datasource/vdb/*`)
  - Observability hooks
  - SSRF proxy usage
  - Core CLI commands

### Plugin & Extension Development

#### [Plugin Systems](agent_skills/plugin.md)

- **When to read this**
  - You’re building or debugging a marketplace plugin.
  - You need to know how manifests, providers, daemons, and migrations fit together.
- **What it covers**
  - Plugin manifests (`core/plugin/entities/plugin.py`)
  - Installation/upgrade flows (`services/plugin/plugin_service.py`, CLI commands)
  - Runtime adapters (`core/plugin/impl/*` for tool/model/datasource/trigger/endpoint/agent)
  - Daemon coordination (`core/plugin/entities/plugin_daemon.py`)
  - How provider registries surface capabilities to the rest of the platform

#### [Plugin OAuth](agent_skills/plugin_oauth.md)

- **When to read this**
  - You must integrate OAuth for a plugin or datasource.
  - You’re handling credential encryption or refresh flows.
- **Topics**
  - Credential storage
  - Encryption helpers (`core/helper/provider_encryption.py`)
  - OAuth client bootstrap (`services/plugin/oauth_service.py`, `services/plugin/plugin_parameter_service.py`)
  - How console/API layers expose the flows

### Workflow Entry & Execution

#### [Trigger Concepts](agent_skills/trigger.md)

- **When to read this**
  - You’re debugging why a workflow didn’t start.
  - You’re adding a new trigger type or hook.
  - You need to trace async execution, draft debugging, or webhook/schedule pipelines.
- **Details**
  - Start-node taxonomy
  - Webhook & schedule internals (`core/workflow/nodes/trigger_*`, `services/trigger/*`)
  - Async orchestration (`services/async_workflow_service.py`, Celery queues)
  - Debug event bus
  - Storage/logging interactions

## General Reminders

- All skill docs assume you follow the coding style rules below—run the lint/type/test commands before submitting changes.
- When you cannot find an answer in these briefs, search the codebase using the paths referenced (e.g., `core/plugin/impl/tool.py`, `services/dataset_service.py`).
- If you run into cross-cutting concerns (tenancy, configuration, storage), check the infrastructure guide first; it links to most supporting modules.
- Keep multi-tenancy and configuration central: everything flows through `configs.dify_config` and `tenant_id`.
- When touching plugins or triggers, consult both the system overview and the specialised doc to ensure you adjust lifecycle, storage, and observability consistently.

## Coding Style

This is the default standard for backend code in this repo. Follow it for new code and use it as the checklist when reviewing changes.

### Linting & Formatting

- Use Ruff for formatting and linting (follow `.ruff.toml`).
- Keep each line under 120 characters (including spaces).

### Naming Conventions

- Use `snake_case` for variables and functions.
- Use `PascalCase` for classes.
- Use `UPPER_CASE` for constants.

### Typing & Class Layout

- Code should usually include type annotations that match the repo’s current Python version (avoid untyped public APIs and “mystery” values).
- Prefer modern typing forms (e.g. `list[str]`, `dict[str, int]`) and avoid `Any` unless there’s a strong reason.
- For classes, declare member variables at the top of the class body (before `__init__`) so the class shape is obvious at a glance:

```python
from datetime import datetime


class Example:
    user_id: str
    created_at: datetime

    def __init__(self, user_id: str, created_at: datetime) -> None:
        self.user_id = user_id
        self.created_at = created_at
```

### General Rules

- Use Pydantic v2 conventions.
- Use `uv` for Python package management in this repo (usually with `--project api`).
- Prefer simple functions over small “utility classes” for lightweight helpers.
- Avoid implementing dunder methods unless it’s clearly needed and matches existing patterns.
- Never start long-running services as part of agent work (`uv run app.py`, `flask run`, etc.); running tests is allowed.
- Keep files below ~800 lines; split when necessary.
- Keep code readable and explicit—avoid clever hacks.

### Architecture & Boundaries

- Mirror the layered architecture: controller → service → core/domain.
- Reuse existing helpers in `core/`, `services/`, and `libs/` before creating new abstractions.
- Optimise for observability: deterministic control flow, clear logging, actionable errors.

### Logging & Errors

- Never use `print`; use a module-level logger:
  - `logger = logging.getLogger(__name__)`
- Include tenant/app/workflow identifiers in log context when relevant.
- Raise domain-specific exceptions (`services/errors`, `core/errors`) and translate them into HTTP responses in controllers.
- Log retryable events at `warning`, terminal failures at `error`.

### SQLAlchemy Patterns

- Models inherit from `models.base.TypeBase`; do not create ad-hoc metadata or engines.
- Open sessions with context managers:

```python
from sqlalchemy.orm import Session

with Session(db.engine, expire_on_commit=False) as session:
    stmt = select(Workflow).where(
        Workflow.id == workflow_id,
        Workflow.tenant_id == tenant_id,
    )
    workflow = session.execute(stmt).scalar_one_or_none()
```

- Prefer SQLAlchemy expressions; avoid raw SQL unless necessary.
- Always scope queries by `tenant_id` and protect write paths with safeguards (`FOR UPDATE`, row counts, etc.).
- Introduce repository abstractions only for very large tables (e.g., workflow executions) or when alternative storage strategies are required.

### Storage & External I/O

- Access storage via `extensions.ext_storage.storage`.
- Use `core.helper.ssrf_proxy` for outbound HTTP fetches.
- Background tasks that touch storage must be idempotent, and should log relevant object identifiers.

### Pydantic Usage

- Define DTOs with Pydantic v2 models and forbid extras by default.
- Use `@field_validator` / `@model_validator` for domain rules.

Example:

```python
from pydantic import BaseModel, ConfigDict, HttpUrl, field_validator


class TriggerConfig(BaseModel):
    endpoint: HttpUrl
    secret: str

    model_config = ConfigDict(extra="forbid")

    @field_validator("secret")
    def ensure_secret_prefix(cls, value: str) -> str:
        if not value.startswith("dify_"):
            raise ValueError("secret must start with dify_")
        return value
```

### Generics & Protocols

- Use `typing.Protocol` to define behavioural contracts (e.g., cache interfaces).
- Apply generics (`TypeVar`, `Generic`) for reusable utilities like caches or providers.
- Validate dynamic inputs at runtime when generics cannot enforce safety alone.

### Tooling & Checks

Quick checks while iterating:

- Format: `make format`
- Lint (includes auto-fix): `make lint`
- Type check: `make type-check`
- Targeted tests: `make test TARGET_TESTS=./api/tests/<target_tests>`

Before opening a PR / submitting:

- `make lint`
- `make type-check`
- `make test`

### Controllers & Services

- Controllers: parse input via Pydantic, invoke services, return serialised responses; no business logic.
- Services: coordinate repositories, providers, background tasks; keep side effects explicit.
- Document non-obvious behaviour with concise comments.

### Miscellaneous

- Use `configs.dify_config` for configuration—never read environment variables directly.
- Maintain tenant awareness end-to-end; `tenant_id` must flow through every layer touching shared resources.
- Queue async work through `services/async_workflow_service`; implement tasks under `tasks/` with explicit queue selection.
- Keep experimental scripts under `dev/`; do not ship them in production builds.
