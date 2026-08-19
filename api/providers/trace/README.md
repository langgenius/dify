# Trace providers

This directory holds **optional workspace packages** that send Dify **ops tracing** data (workflows, messages, tools, moderation, etc.) to an external observability backend (Langfuse, LangSmith, OpenTelemetry-style exporters, and others).

Unlike VDB providers, trace plugins are **not** discovered via entry points. The API core imports your package **explicitly** from `core/ops/ops_trace_manager.py` after you register the provider id and mapping.

## Architecture

| Layer | Location | Role |
|--------|----------|------|
| Contracts | `api/core/ops/base_trace_instance.py`, `api/core/ops/entities/trace_entity.py`, `api/core/ops/entities/config_entity.py` | `BaseTraceInstance`, `BaseTracingConfig`, and typed `*TraceInfo` payloads |
| Registry | `api/core/ops/ops_trace_manager.py` | `TracingProviderEnum`, `OpsTraceProviderConfigMap` — maps provider **string** → config class, encrypted keys, and trace class |
| Your package | `api/providers/trace/trace-<name>/` | Pydantic config + subclass of `BaseTraceInstance` |

At runtime, `OpsTraceManager` decrypts stored credentials, builds your config model, caches a trace instance, and calls `trace(trace_info)` with a concrete `BaseTraceInfo` subtype.

## What you implement

### 1. Config model (`BaseTracingConfig`)

Subclass `BaseTracingConfig` from `core.ops.entities.config_entity`. Use Pydantic validators; reuse helpers from `core.ops.utils` (for example `validate_url`, `validate_url_with_path`, `validate_project_name`) where appropriate.

Fields fall into two groups used by the manager:

- **`secret_keys`** — names of fields that are **encrypted at rest** (API keys, tokens, passwords).
- **`other_keys`** — non-secret connection settings (hosts, project names, endpoints).

List these key names in your `OpsTraceProviderConfigMap` entry so encrypt/decrypt and merge logic stay correct.

### 2. Trace instance (`BaseTraceInstance`)

Subclass `BaseTraceInstance` and implement:

```python
def trace(self, trace_info: BaseTraceInfo) -> None:
    ...
```

Dispatch on the concrete type with `isinstance` (see `trace_langfuse` or `trace_langsmith` for full patterns). Payload types are defined in `core/ops/entities/trace_entity.py`, including:

- `WorkflowTraceInfo`, `WorkflowNodeTraceInfo`, `DraftNodeExecutionTrace`
- `MessageTraceInfo`, `ToolTraceInfo`, `ModerationTraceInfo`, `SuggestedQuestionTraceInfo`
- `DatasetRetrievalTraceInfo`, `GenerateNameTraceInfo`, `PromptGenerationTraceInfo`

You may ignore categories your backend does not support; existing providers often no-op unhandled types.

Optional: use `get_service_account_with_tenant(app_id)` from the base class when you need tenant-scoped account context.

### 3. Register in the API core

Upstream changes are required so Dify knows your provider exists:

1. **`TracingProviderEnum`** (`api/core/ops/entities/config_entity.py`) — add a new member whose **value** is the stable string stored in app tracing config (e.g. `"mybackend"`).
2. **`OpsTraceProviderConfigMap.__getitem__`** (`api/core/ops/ops_trace_manager.py`) — add a `match` case for that enum member returning:
   - `config_class`: your Pydantic config type
   - `secret_keys` / `other_keys`: lists of field names as above
   - `trace_instance`: your `BaseTraceInstance` subclass  
   Lazy-import your package inside the case so missing optional installs raise a clear `ImportError`.

If the `match` case is missing, the provider string will not resolve and tracing will be disabled for that app.

## Package layout

Each provider is a normal uv workspace member, for example:

- `api/providers/trace/trace-<name>/pyproject.toml` — project name `dify-trace-<name>`, dependencies on vendor SDKs
- `api/providers/trace/trace-<name>/src/dify_trace_<name>/` — `config.py`, `<name>_trace.py`, optional `entities/`, and an empty **`py.typed`** file (PEP 561) so the API type checker treats the package as typed; list `py.typed` under `[tool.setuptools.package-data]` for that import name in `pyproject.toml`.

Reference implementations: `trace-langfuse/`, `trace-langsmith/`, `trace-opik/`.

## Wiring into the `api` workspace

In `api/pyproject.toml`:

1. **`[tool.uv.sources]`** — `dify-trace-<name> = { workspace = true }`
2. **`[dependency-groups]`** — add `trace-<name> = ["dify-trace-<name>"]` and include `dify-trace-<name>` in `trace-all` if it should ship with the default bundle

After changing metadata, run **`uv sync`** from `api/`.
