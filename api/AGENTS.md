# API Agent Guide

## Notes for Agent (must-check)

Before changing any backend code under `api/`, you MUST read the surrounding docstrings and comments. These notes contain required context (invariants, edge cases, trade-offs) and are treated as part of the spec.

Look for:

- The module (file) docstring at the top of a source code file
- Docstrings on classes and functions/methods
- Paragraph/block comments for non-obvious logic

### What to write where

- Keep notes scoped: module notes cover module-wide context, class notes cover class-wide context, function/method notes cover behavioural contracts, and paragraph/block comments cover local “why”. Avoid duplicating the same content across scopes unless repetition prevents misuse.
- **Module (file) docstring**: purpose, boundaries, key invariants, and “gotchas” that a new reader must know before editing.
  - Include cross-links to the key collaborators (modules/services) when discovery is otherwise hard.
  - Prefer stable facts (invariants, contracts) over ephemeral “today we…” notes.
- **Class docstring**: responsibility, lifecycle, invariants, and how it should be used (or not used).
  - If the class is intentionally stateful, note what state exists and what methods mutate it.
  - If concurrency/async assumptions matter, state them explicitly.
- **Function/method docstring**: behavioural contract.
  - Document arguments, return shape, side effects (DB writes, external I/O, task dispatch), and raised domain exceptions.
  - Add examples only when they prevent misuse.
- **Paragraph/block comments**: explain *why* (trade-offs, historical constraints, surprising edge cases), not what the code already states.
  - Keep comments adjacent to the logic they justify; delete or rewrite comments that no longer match reality.

### Rules (must follow)

In this section, “notes” means module/class/function docstrings plus any relevant paragraph/block comments.

- **Before working**
  - Read the notes in the area you’ll touch; treat them as part of the spec.
  - If a docstring or comment conflicts with the current code, treat the **code as the single source of truth** and update the docstring or comment to match reality.
  - If important intent/invariants/edge cases are missing, add them in the closest docstring or comment (module for overall scope, function for behaviour).
- **During working**
  - Keep the notes in sync as you discover constraints, make decisions, or change approach.
  - If you move/rename responsibilities across modules/classes, update the affected docstrings and comments so readers can still find the “why” and the invariants.
  - Record non-obvious edge cases, trade-offs, and the test/verification plan in the nearest docstring or comment that will stay correct.
  - Keep the notes **coherent**: integrate new findings into the relevant docstrings and comments; avoid append-only “recent fix” / changelog-style additions.
- **When finishing**
  - Update the notes to reflect what changed, why, and any new edge cases/tests.
  - Remove or rewrite any comments that could be mistaken as current guidance but no longer apply.
  - Keep docstrings and comments concise and accurate; they are meant to prevent repeated rediscovery.

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
- Document non-obvious behaviour with concise docstrings and comments.

### Miscellaneous

- Use `configs.dify_config` for configuration—never read environment variables directly.
- Maintain tenant awareness end-to-end; `tenant_id` must flow through every layer touching shared resources.
- Queue async work through `services/async_workflow_service`; implement tasks under `tasks/` with explicit queue selection.
- Keep experimental scripts under `dev/`; do not ship them in production builds.
