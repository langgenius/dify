# Agent Guide

## Notes for Agent (must-check)

Before changing any source code under this folder, you MUST read the surrounding docstrings and comments. These notes contain required context (invariants, edge cases, trade-offs) and are treated as part of the spec.

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
- For dictionary-like data with known keys and value types, prefer `TypedDict` over `dict[...]` or `Mapping[...]`.
- For optional keys in typed payloads, use `NotRequired[...]` (or `total=False` when most fields are optional).
- Keep `dict[...]` / `Mapping[...]` for truly dynamic key spaces where the key set is unknown.

```python
from datetime import datetime
from typing import NotRequired, TypedDict


class UserProfile(TypedDict):
    user_id: str
    email: str
    created_at: datetime
    nickname: NotRequired[str]
```

- For classes, declare all member variables explicitly with types at the top of the class body (before `__init__`), even when the class is not a dataclass or Pydantic model, so the class shape is obvious at a glance:

```python
from datetime import datetime


class Example:
    user_id: str
    created_at: datetime

    def __init__(self, user_id: str, created_at: datetime) -> None:
        self.user_id = user_id
        self.created_at = created_at
```

- For dataclasses, prefer `field(default_factory=...)` over `field(init=False)` when a default can be provided declaratively.
- Prefer dataclasses with `slots=True` when defining lightweight data containers:

```python
from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class Example:
    user_id: str
    created_at: datetime
```

### General Rules

- Use Pydantic v2 conventions.
- Use `uv` for Python package management in this repo (usually with `--project dify-agent`).
- Use `make typecheck` to run `basedpyright` against `dify-agent/src` and `dify-agent/tests`.
- Keep type checking passing after every edit you make.
- Use `pytest` for all tests in this package.
- When integrating with, implementing, or mocking a dependency, inspect the dependency's source code to confirm its API shape and runtime behavior instead of guessing from names alone.
- Prefer simple functions over small “utility classes” for lightweight helpers.
- Avoid implementing dunder methods unless it’s clearly needed and matches existing patterns.
- Keep code readable and explicit—avoid clever hacks.

### Testing

- Work in TDD style: write or update a failing test first when changing behavior, then make the implementation pass, then refactor while keeping tests and typecheck green.
- Use `make test` to run the agent pytest suite.
- Keep local tests under `dify-agent/tests/local/`.
- Mirror the `dify-agent/src/` package structure inside `dify-agent/tests/local/` so test locations stay predictable.

#### Local Tests

- Write local tests for stable, externally observable behavior that can run quickly without real external services.
- In this repo, code, comments, docs, and tests are expected to change together. Because of that, a local test is only useful if it would still be correct after an internal refactor that does not change the intended contract.
- Local tests should verify:
  - what callers and downstream code can observe and rely on
  - how the unit is expected to use its dependencies at the boundary
  - how the unit handles dependency success, failure, empty responses, malformed responses, and documented error cases
  - documented invariants, error mapping, and output/input shape guarantees
- When asserting dependency interactions, assert only the parts of the request or response that are part of the real boundary contract. Do not over-specify incidental details that callers or dependencies do not rely on.
- It is acceptable to mock dependencies in local tests, but only when the mock represents a real contract, schema, documented behavior, or known regression.
- Tests may use line-scoped type-ignore comments when intentionally exercising runtime validation paths that static typing would normally reject. Keep the ignore on the exact invalid call.
- Do not use local tests to prove real integration, network wiring, serialization, framework configuration, or third-party runtime behavior; cover those in higher-level tests.
- Meaningless local tests include:
  - tests that only mirror the current implementation or must be updated whenever internal code changes even though the contract did not change
  - tests of private helpers, local variables, temporary state, internal branching, or exact internal call order unless those details are part of the published contract
  - tests with mocked dependency behavior that is invented only to make the current implementation pass
  - tests that add no value beyond static type checking or linting

### Logging & Errors

- Never use `print`; use a module-level logger:
  - `logger = logging.getLogger(__name__)`
- Include tenant/app/workflow identifiers in log context when relevant.
- Raise domain-specific exceptions and translate them into HTTP responses in controllers.
- Log retryable events at `warning`, terminal failures at `error`.

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
