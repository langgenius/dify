## Linter

- Always follow `.ruff.toml`.
- Run `uv run ruff check --fix --unsafe-fixes`.
- Keep each line under 100 characters (including spaces).

## Code Style

- `snake_case` for variables and functions.
- `PascalCase` for classes.
- `UPPER_CASE` for constants.

## Rules

- Use Pydantic v2 standard.
- Use `uv` for package management.
- Do not override dunder methods like `__init__`, `__iadd__`, etc.
- Never launch services (`uv run app.py`, `flask run`, etc.); running tests under `tests/` is allowed.
- Prefer simple functions over classes for lightweight helpers.
- Keep files below 800 lines; split when necessary.
- Keep code readable—no clever hacks.
- Never use `print`; log with `logger = logging.getLogger(__name__)`.

## Guiding Principles

- Mirror the project’s layered architecture: controller → service → core/domain.
- Reuse existing helpers in `core/`, `services/`, and `libs/` before creating new abstractions.
- Optimise for observability: deterministic control flow, clear logging, actionable errors.

## SQLAlchemy Patterns

- Models inherit from `models.base.Base`; never create ad-hoc metadata or engines.

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

- Use SQLAlchemy expressions; avoid raw SQL unless necessary.

- Introduce repository abstractions only for very large tables (e.g., workflow executions) to support alternative storage strategies.

- Always scope queries by `tenant_id` and protect write paths with safeguards (`FOR UPDATE`, row counts, etc.).

## Storage & External IO

- Access storage via `extensions.ext_storage.storage`.
- Use `core.helper.ssrf_proxy` for outbound HTTP fetches.
- Background tasks that touch storage must be idempotent and log the relevant object identifiers.

## Pydantic Usage

- Define DTOs with Pydantic v2 models and forbid extras by default.

- Use `@field_validator` / `@model_validator` for domain rules.

- Example:

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

## Generics & Protocols

- Use `typing.Protocol` to define behavioural contracts (e.g., cache interfaces).
- Apply generics (`TypeVar`, `Generic`) for reusable utilities like caches or providers.
- Validate dynamic inputs at runtime when generics cannot enforce safety alone.

## Error Handling & Logging

- Raise domain-specific exceptions (`services/errors`, `core/errors`) and translate to HTTP responses in controllers.
- Declare `logger = logging.getLogger(__name__)` at module top.
- Include tenant/app/workflow identifiers in log context.
- Log retryable events at `warning`, terminal failures at `error`.

## Tooling & Checks

- Format/lint: `uv run --project api --dev ruff format ./api` and `uv run --project api --dev ruff check --fix --unsafe-fixes ./api`.
- Type checks: `uv run --directory api --dev basedpyright`.
- Tests: `uv run --project api --dev dev/pytest/pytest_unit_tests.sh`.
- Run all of the above before submitting your work.

## Controllers & Services

- Controllers: parse input via Pydantic, invoke services, return serialised responses; no business logic.
- Services: coordinate repositories, providers, background tasks; keep side effects explicit.
- Avoid repositories unless necessary; direct SQLAlchemy usage is preferred for typical tables.
- Document non-obvious behaviour with concise comments.

## Miscellaneous

- Use `configs.dify_config` for configuration—never read environment variables directly.
- Maintain tenant awareness end-to-end; `tenant_id` must flow through every layer touching shared resources.
- Queue async work through `services/async_workflow_service`; implement tasks under `tasks/` with explicit queue selection.
- Keep experimental scripts under `dev/`; do not ship them in production builds.
