# Phoenix Parent Trace Fallback Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Phoenix/Arize parent trace fallback fix from commit `f224813e63d33f582a79f5c76e573738620f28b0` into the current trace-provider package layout.

**Architecture:** Keep the existing Redis parent-carrier path for traced parent workflows. When the Redis carrier is missing, inspect the parent workflow run's app tracing config and fall back to a synthetic parent workflow root only when that parent app cannot publish Phoenix/Arize carrier data. Preserve retry behavior for traceable or unresolved parents, and make Phoenix root span creation independent of any ambient OpenTelemetry context.

**Tech Stack:** Python 3.12, pytest, SQLAlchemy models, OpenTelemetry trace context propagation, Dify provider package `dify_trace_arize_phoenix`.

---

## File Map

- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
  - Import `Context` from OpenTelemetry.
  - Import `App` and `WorkflowRun`.
  - Add helpers that determine whether a parent workflow run can publish Phoenix/Arize parent span context.
  - Add a narrow carrier-resolution fallback helper.
  - Update `workflow_trace()` to fallback only for non-publishable parents.
  - Update `ensure_root_span()` so synthetic roots do not inherit ambient OTel context.

- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
  - Add helper tests for parent publishability.
  - Add workflow trace tests for fallback and retry preservation.
  - Add root span test for ignoring unsampled ambient OTel parent.

- Do not modify: `api/extensions/ext_otel.py`, `api/extensions/otel/instrumentation.py`, `api/pyproject.toml`, `api/uv.lock`
  - Current branch already has Redis instrumentation and the `opentelemetry-instrumentation-redis` dependency.

## Task 1: Add Parent Publishability Tests

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Add failing imports and fake query helper**

Update the import block for `dify_trace_arize_phoenix.arize_phoenix_trace` to include the helpers that do not exist yet:

```python
from dify_trace_arize_phoenix.arize_phoenix_trace import (
    _NODE_TYPE_TO_SPAN_KIND,
    ArizePhoenixDataTrace,
    _app_uses_phoenix_provider,
    _build_graph_parent_index,
    _get_node_span_kind,
    _parent_workflow_can_publish_span_context,
    _phoenix_parent_span_redis_key,
    _resolve_node_parent,
    _resolve_published_parent_span_context,
    _resolve_structured_parent_execution_id,
    _resolve_workflow_parent_context,
    _resolve_workflow_session_id,
    datetime_to_nanos,
    error_to_string,
    safe_json_dumps,
    set_span_status,
    setup_tracer,
    wrap_span_metadata,
)
```

Add this helper after `_get_start_span_call()`:

```python
class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._result
```

- [ ] **Step 2: Add failing helper behavior tests**

Add these tests near the existing setup/config helper tests, before `# --- ArizePhoenixDataTrace Class Tests ---`:

```python
def test_app_uses_phoenix_provider_only_for_enabled_arize_or_phoenix():
    assert _app_uses_phoenix_provider({"enabled": True, "tracing_provider": "phoenix"}) is True
    assert _app_uses_phoenix_provider({"enabled": True, "tracing_provider": "arize"}) is True
    assert _app_uses_phoenix_provider({"enabled": False, "tracing_provider": "phoenix"}) is False
    assert _app_uses_phoenix_provider({"enabled": True, "tracing_provider": "langfuse"}) is False
    assert _app_uses_phoenix_provider(None) is False


def test_parent_workflow_can_publish_span_context_keeps_unknown_parent_retryable(monkeypatch):
    monkeypatch.setattr(
        "dify_trace_arize_phoenix.arize_phoenix_trace.db.session.query",
        lambda model: _FakeQuery(None),
    )

    assert _parent_workflow_can_publish_span_context("missing-run") is True


def test_parent_workflow_can_publish_span_context_checks_parent_app_tracing(monkeypatch):
    parent_run = SimpleNamespace(app_id="parent-app")
    parent_app = SimpleNamespace(tracing=json.dumps({"enabled": True, "tracing_provider": "phoenix"}))

    def fake_query(model):
        if getattr(model, "__tablename__", None) == "workflow_runs":
            return _FakeQuery(parent_run)
        if getattr(model, "__tablename__", None) == "apps":
            return _FakeQuery(parent_app)
        raise AssertionError(f"Unexpected model query: {model}")

    monkeypatch.setattr("dify_trace_arize_phoenix.arize_phoenix_trace.db.session.query", fake_query)

    assert _parent_workflow_can_publish_span_context("parent-run") is True

    parent_app.tracing = json.dumps({"enabled": False, "tracing_provider": "phoenix"})
    assert _parent_workflow_can_publish_span_context("parent-run") is False

    parent_app.tracing = json.dumps({"enabled": True, "tracing_provider": "langfuse"})
    assert _parent_workflow_can_publish_span_context("parent-run") is False
```

- [ ] **Step 3: Run helper tests to verify RED**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_app_uses_phoenix_provider_only_for_enabled_arize_or_phoenix \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_parent_workflow_can_publish_span_context_keeps_unknown_parent_retryable \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_parent_workflow_can_publish_span_context_checks_parent_app_tracing \
  -q
```

Expected: FAIL during import with an error like `ImportError: cannot import name '_app_uses_phoenix_provider'`.

## Task 2: Implement Parent Publishability Helpers

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Add model imports**

Change:

```python
from models.model import EndUser, MessageFile
from models.workflow import WorkflowNodeExecutionTriggeredFrom
```

to:

```python
from models.model import App, EndUser, MessageFile
from models.workflow import WorkflowNodeExecutionTriggeredFrom, WorkflowRun
```

- [ ] **Step 2: Add helper functions**

Add these helpers immediately after `_resolve_published_parent_span_context()`:

```python
def _app_uses_phoenix_provider(app_tracing_config: Mapping[str, Any] | None) -> bool:
    if not app_tracing_config or not app_tracing_config.get("enabled"):
        return False
    return app_tracing_config.get("tracing_provider") in {"arize", "phoenix"}


def _parent_workflow_can_publish_span_context(parent_workflow_run_id: str) -> bool:
    parent_run = db.session.query(WorkflowRun).filter(WorkflowRun.id == parent_workflow_run_id).first()
    if parent_run is None:
        return True

    parent_app = db.session.query(App).filter(App.id == parent_run.app_id).first()
    if parent_app is None or not parent_app.tracing:
        return False

    try:
        app_tracing_config = json.loads(parent_app.tracing)
    except (TypeError, json.JSONDecodeError):
        return False
    if not isinstance(app_tracing_config, Mapping):
        return False

    return _app_uses_phoenix_provider(app_tracing_config)
```

- [ ] **Step 3: Run helper tests to verify GREEN**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_app_uses_phoenix_provider_only_for_enabled_arize_or_phoenix \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_parent_workflow_can_publish_span_context_keeps_unknown_parent_retryable \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_parent_workflow_can_publish_span_context_checks_parent_app_tracing \
  -q
```

Expected: PASS.

## Task 3: Add Workflow Carrier Fallback Tests

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Add missing-carrier fallback test**

Add this test after `test_workflow_trace_raises_pending_parent_error_when_parent_node_context_is_missing()`:

```python
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_falls_back_when_parent_app_tracing_cannot_publish_parent_context(
    mock_sessionmaker,
    mock_repo_factory,
    mock_db,
    trace_instance,
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(
        message_id="message-1",
        workflow_run_id="workflow-run-1",
        metadata={
            "app_id": "app1",
            "parent_trace_context": {
                "parent_workflow_run_id": "outer-workflow-run-1",
                "parent_node_execution_id": "outer-node-execution-1",
            },
        },
    )
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo
    trace_instance._mock_redis_client.get.return_value = None

    parent_carrier = {}
    parent_context = object()

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch(
            "dify_trace_arize_phoenix.arize_phoenix_trace._parent_workflow_can_publish_span_context",
            return_value=False,
        ),
        patch.object(trace_instance, "ensure_root_span", return_value=parent_carrier) as mock_ensure_root_span,
        patch.object(trace_instance.propagator, "extract", return_value=parent_context) as mock_extract,
    ):
        trace_instance.workflow_trace(info)

    mock_ensure_root_span.assert_called_once_with(
        "outer-workflow-run-1",
        root_span_name="workflow-run-1",
        root_span_attributes={
            SpanAttributes.INPUT_VALUE: safe_json_dumps(info.workflow_run_inputs),
            SpanAttributes.INPUT_MIME_TYPE: "application/json",
            SpanAttributes.OUTPUT_VALUE: safe_json_dumps(info.workflow_run_outputs),
            SpanAttributes.OUTPUT_MIME_TYPE: "application/json",
        },
    )
    mock_extract.assert_called_once_with(carrier=parent_carrier)
    workflow_span_call = _get_start_span_call(trace_instance.tracer.start_span, span_name="workflow_workflow-run-1")
    assert workflow_span_call.kwargs["context"] is parent_context
```

- [ ] **Step 2: Add retry-preservation test**

Add this test immediately after the fallback test:

```python
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.db")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory")
@patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker")
def test_workflow_trace_still_retries_when_parent_app_can_publish_parent_context(
    mock_sessionmaker,
    mock_repo_factory,
    mock_db,
    trace_instance,
):
    mock_db.engine = MagicMock()
    info = _make_workflow_info(
        message_id="message-1",
        workflow_run_id="workflow-run-1",
        metadata={
            "app_id": "app1",
            "parent_trace_context": {
                "parent_workflow_run_id": "outer-workflow-run-1",
                "parent_node_execution_id": "outer-node-execution-1",
            },
        },
    )
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []
    mock_repo_factory.create_workflow_node_execution_repository.return_value = repo
    trace_instance._mock_redis_client.get.return_value = None

    with (
        patch.object(trace_instance, "get_service_account_with_tenant", return_value=MagicMock()),
        patch(
            "dify_trace_arize_phoenix.arize_phoenix_trace._parent_workflow_can_publish_span_context",
            return_value=True,
        ),
        patch.object(trace_instance, "ensure_root_span") as mock_ensure_root_span,
        pytest.raises(PendingTraceParentContextError) as exc_info,
    ):
        trace_instance.workflow_trace(info)

    assert exc_info.value.parent_node_execution_id == "outer-node-execution-1"
    mock_ensure_root_span.assert_not_called()
```

- [ ] **Step 3: Run workflow fallback tests to verify RED**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_workflow_trace_falls_back_when_parent_app_tracing_cannot_publish_parent_context \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_workflow_trace_still_retries_when_parent_app_can_publish_parent_context \
  -q
```

Expected: first test FAILS because `workflow_trace()` still raises `PendingTraceParentContextError`; second test PASSES because current behavior still retries.

## Task 4: Implement Narrow Workflow Carrier Fallback

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Add fallback helper**

Add this helper after `_parent_workflow_can_publish_span_context()`:

```python
def _resolve_workflow_parent_carrier(
    parent_node_execution_id: str,
    parent_workflow_run_id: str | None,
) -> dict[str, str] | None:
    try:
        return _resolve_published_parent_span_context(parent_node_execution_id)
    except PendingTraceParentContextError:
        if parent_workflow_run_id and not _parent_workflow_can_publish_span_context(parent_workflow_run_id):
            logger.info(
                "[Arize/Phoenix] Parent workflow %s cannot publish parent span context; using fallback root",
                parent_workflow_run_id,
            )
            return None
        raise
```

- [ ] **Step 2: Update workflow_trace parent carrier resolution**

In `ArizePhoenixDataTrace.workflow_trace()`, replace:

```python
        if parent_node_execution_id:
            workflow_parent_carrier = _resolve_published_parent_span_context(parent_node_execution_id)
        else:
            root_trace_id = _resolve_workflow_root_trace_id(trace_info)
            workflow_root_span_name: str | None = trace_info.workflow_run_id
            if not isinstance(workflow_root_span_name, str) or not workflow_root_span_name.strip():
                workflow_root_span_name = None

            workflow_parent_carrier = self.ensure_root_span(
                root_trace_id,
                root_span_name=workflow_root_span_name,
                root_span_attributes={
                    SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.workflow_run_inputs),
                    SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                    SpanAttributes.OUTPUT_VALUE: safe_json_dumps(trace_info.workflow_run_outputs),
                    SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                },
            )
```

with:

```python
        workflow_parent_carrier = (
            _resolve_workflow_parent_carrier(parent_node_execution_id, parent_workflow_run_id)
            if parent_node_execution_id
            else None
        )
        if workflow_parent_carrier is None:
            root_trace_id = _resolve_workflow_root_trace_id(trace_info)
            workflow_root_span_name: str | None = trace_info.workflow_run_id
            if not isinstance(workflow_root_span_name, str) or not workflow_root_span_name.strip():
                workflow_root_span_name = None

            workflow_parent_carrier = self.ensure_root_span(
                root_trace_id,
                root_span_name=workflow_root_span_name,
                root_span_attributes={
                    SpanAttributes.INPUT_VALUE: safe_json_dumps(trace_info.workflow_run_inputs),
                    SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                    SpanAttributes.OUTPUT_VALUE: safe_json_dumps(trace_info.workflow_run_outputs),
                    SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
                },
            )
```

- [ ] **Step 3: Run workflow fallback tests to verify GREEN**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_workflow_trace_falls_back_when_parent_app_tracing_cannot_publish_parent_context \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_workflow_trace_still_retries_when_parent_app_can_publish_parent_context \
  -q
```

Expected: PASS.

- [ ] **Step 4: Run existing parent-context regression tests**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_workflow_trace_uses_published_parent_node_context_for_nested_workflow \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_workflow_trace_raises_pending_parent_error_when_parent_node_context_is_missing \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_workflow_trace_reuses_upstream_parent_workflow_context_when_no_parent_node_execution_id_is_available \
  -q
```

Expected: PASS.

## Task 5: Add Root Span Ambient Context Regression Test

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Add OpenTelemetry SDK imports**

Change:

```python
from opentelemetry.sdk.trace import Tracer
from opentelemetry.semconv.trace import SpanAttributes as OTELSpanAttributes
from opentelemetry.trace import StatusCode
```

to:

```python
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.trace import Tracer
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, SpanExporter, SpanExportResult
from opentelemetry.semconv.trace import SpanAttributes as OTELSpanAttributes
from opentelemetry.trace import NonRecordingSpan, SpanContext, StatusCode, TraceFlags, TraceState, use_span
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
```

- [ ] **Step 2: Add collecting exporter helper**

Add this helper after `_FakeQuery`:

```python
class _CollectingSpanExporter(SpanExporter):
    def __init__(self):
        self.spans = []

    def export(self, spans):
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self):
        return None
```

- [ ] **Step 3: Add failing ambient-context test**

Add this test near the existing `ensure_root_span` tests:

```python
def test_ensure_root_span_ignores_unsampled_ambient_otel_parent():
    exporter = _CollectingSpanExporter()
    provider = trace_sdk.TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))

    instance = ArizePhoenixDataTrace.__new__(ArizePhoenixDataTrace)
    instance.tracer = provider.get_tracer("test")
    instance.project = "test"
    instance.propagator = TraceContextTextMapPropagator()
    instance.dify_trace_ids = set()
    instance.root_span_carriers = {}
    instance.carrier = {}

    unsampled_context = SpanContext(
        trace_id=1,
        span_id=2,
        is_remote=False,
        trace_flags=TraceFlags(0),
        trace_state=TraceState(),
    )

    with use_span(NonRecordingSpan(unsampled_context), end_on_exit=False):
        instance.ensure_root_span("workflow-run-123456", root_span_name="workflow-run-123456")

    assert [span.name for span in exporter.spans] == ["workflow-run-123456"]
    assert exporter.spans[0].context.trace_flags.sampled
```

- [ ] **Step 4: Run ambient-context test to verify RED**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_ensure_root_span_ignores_unsampled_ambient_otel_parent \
  -q
```

Expected: FAIL because the synthetic root span inherits the unsampled ambient context and is not exported.

## Task 6: Make Root Span Creation Independent From Ambient Context

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Import OpenTelemetry Context**

Add this import with the other OpenTelemetry imports:

```python
from opentelemetry.context import Context
```

- [ ] **Step 2: Pass empty context to root span creation**

In `ArizePhoenixDataTrace.ensure_root_span()`, replace:

```python
            root_span = self.tracer.start_span(name=span_name, attributes=root_span_attributes_dict)
```

with:

```python
            root_span = self.tracer.start_span(
                name=span_name,
                attributes=root_span_attributes_dict,
                context=Context(),
            )
```

- [ ] **Step 3: Update existing mock assertion for root span creation**

In `test_ensure_root_span_uses_custom_name_and_attributes()`, update the `assert_called_once_with` expected kwargs to include `context=Context()`.

The assertion should become:

```python
    trace_instance.tracer.start_span.assert_called_once_with(
        name="Workflow Name",
        attributes={
            SpanAttributes.OPENINFERENCE_SPAN_KIND: "CHAIN",
            "dify_project_name": "p",
            "dify_trace_id": "tid",
            SpanAttributes.INPUT_VALUE: '{"input":"value"}',
            SpanAttributes.OUTPUT_VALUE: '{"output":"value"}',
        },
        context=Context(),
    )
```

If this test file does not already import `Context`, add:

```python
from opentelemetry.context import Context
```

- [ ] **Step 4: Run root span tests to verify GREEN**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_ensure_root_span_ignores_unsampled_ambient_otel_parent \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_ensure_root_span_uses_custom_name_and_attributes \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py::test_ensure_root_span_basic \
  -q
```

Expected: PASS.

## Task 7: Verification and Review

**Files:**
- Review: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Review: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Run provider test file**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  -q
```

Expected: PASS.

- [ ] **Step 2: Run ops trace task regression tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

Expected: PASS.

- [ ] **Step 3: Run formatting check for touched Python files**

Run:

```bash
uv run --project api ruff format --check \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
```

Expected: PASS.

- [ ] **Step 4: Run lint check for touched Python files**

Run:

```bash
uv run --project api ruff check \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
```

Expected: PASS.

- [ ] **Step 5: Inspect diff**

Run:

```bash
git diff -- \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
```

Expected diff properties:
- No changes to unrelated existing dirty files under `Makefile` or `docker/`.
- Missing carrier still raises `PendingTraceParentContextError` when the parent app can publish Phoenix/Arize context.
- Missing carrier falls back only when the parent app cannot publish Phoenix/Arize context.
- Unknown parent workflow run remains retryable.
- Invalid Redis carrier contents remain hard errors.
- `ensure_root_span()` starts synthetic roots with `context=Context()`.

## Plan Self-Review

- Spec coverage: The plan covers the original commit's fallback behavior, retry preservation, unknown-parent behavior, invalid-carrier preservation, and ambient OTel root-span isolation.
- Placeholder scan: No placeholder markers or unspecified "add tests" steps remain; each code-changing step includes concrete snippets.
- Type consistency: Helper names and signatures are consistent across tests and implementation: `_app_uses_phoenix_provider()`, `_parent_workflow_can_publish_span_context()`, and `_resolve_workflow_parent_carrier()`.
