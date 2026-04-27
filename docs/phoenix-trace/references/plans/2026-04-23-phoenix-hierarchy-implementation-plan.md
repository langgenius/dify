# Phoenix Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-implement Phoenix hierarchy improvements inside the Phoenix tracing provider while reusing existing upstream tracing semantics and preserving canonical-root correctness.

**Architecture:** Keep all production changes inside the Phoenix provider package, centered on `arize_phoenix_trace.py`. Reuse upstream `resolved_trace_id`, `parent_trace_context`, and `resolved_parent_context` where they already express stable semantics, then add Phoenix-local helpers for workflow-internal hierarchy reconstruction, session fallback, and canonical-root-safe parent selection for supported node types.

**Tech Stack:** Python 3.12, Pydantic trace entities, OpenTelemetry spans, OpenInference span attributes, pytest, unittest.mock, Dify workflow repositories

---

## File Structure

### Production files

- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
  Purpose:
  - add Phoenix-local hierarchy reconstruction helpers
  - add canonical-root-safe workflow span creation
  - reuse upstream cross-workflow parent context
  - add session fallback resolution
  - add code comments marking future upstream migration targets

### Test files

- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
  Purpose:
  - cover workflow root span creation
  - cover session fallback behavior
  - cover nested workflow parent reuse
  - cover hierarchy reconstruction for serial, branch, loop, and iteration cases

- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
  Purpose:
  - keep helper-level tests colocated with existing provider helpers
  - add focused tests for any pure helper added to `arize_phoenix_trace.py`

### Optional only if the main file becomes unwieldy

- Create: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/hierarchy.py`
  Purpose:
  - isolate pure hierarchy helper functions if `arize_phoenix_trace.py` becomes too large

Do not create this file unless the edited provider file clearly exceeds readability boundaries during implementation.

## Task 1: Lock In Root and Session Expectations With Failing Tests

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Write the failing tests for canonical root and session fallback**

Add tests that assert:

- top-level workflow spans are started without a fabricated parent context
- workflow session falls back to `workflow_run_id` when `conversation_id` is missing
- message traces still use `conversation_id`

Use test code shaped like this:

```python
def test_workflow_trace_uses_true_root_context_for_top_level_workflow(trace_instance):
    info = _make_workflow_info(
        conversation_id=None,
        workflow_run_id="run-root-001",
        trace_id="trace-root-001",
        metadata={"app_id": "app1", "tenant_id": "tenant-1"},
    )

    mock_root_context = object()
    workflow_span = MagicMock()

    with (
        patch.object(trace_instance, "ensure_root_span"),
        patch.object(trace_instance.propagator, "extract", return_value=mock_root_context),
        patch.object(trace_instance.tracer, "start_span", return_value=workflow_span),
        patch.object(trace_instance, "get_service_account_with_tenant"),
        patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker"),
        patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory") as repo_factory,
    ):
        repo_factory.create_workflow_node_execution_repository.return_value.get_by_workflow_execution.return_value = []

        trace_instance.workflow_trace(info)

    trace_instance.tracer.start_span.assert_called_once()
    assert trace_instance.tracer.start_span.call_args.kwargs["context"] is mock_root_context
    attrs = trace_instance.tracer.start_span.call_args.kwargs["attributes"]
    assert attrs[SpanAttributes.SESSION_ID] == "run-root-001"


def test_message_trace_keeps_conversation_session(trace_instance):
    message_data = MagicMock()
    message_data.query = "hello"
    message_data.answer = "world"
    message_data.conversation_id = "conv-001"
    message_data.model_provider = "openai"
    message_data.model_id = "gpt-4"
    message_data.status = "succeeded"
    message_data.from_account_id = "acct-1"
    message_data.from_end_user_id = None
    message_data.error = None
    message_data.message_metadata = None

    info = _make_message_info(message_data=message_data)

    with (
        patch.object(trace_instance, "ensure_root_span"),
        patch.object(trace_instance.propagator, "extract", return_value=object()),
        patch.object(trace_instance.tracer, "start_span", return_value=MagicMock()),
    ):
        trace_instance.message_trace(info)

    attrs = trace_instance.tracer.start_span.call_args_list[0].kwargs["attributes"]
    assert attrs[SpanAttributes.SESSION_ID] == "conv-001"
```

- [ ] **Step 2: Run the provider test file to verify the new tests fail**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

Expected:

- FAIL because current workflow tracing still writes `conversation_id or ""` for workflow sessions
- FAIL because later hierarchy assertions are not implemented yet

- [ ] **Step 3: Commit the failing test checkpoint**

```bash
git add api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
git commit -m "test: define phoenix root and session expectations"
```

## Task 2: Add Phoenix-Local Helper Functions For Session and Parent Resolution

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`

- [ ] **Step 1: Write failing helper tests before changing production code**

Add helper-focused tests for pure resolution logic:

```python
def test_resolve_workflow_session_id_prefers_conversation_for_chatflow():
    metadata = {"conversation_id": "conv-001", "triggered_from": "app"}
    assert _resolve_workflow_session_id("run-001", "conv-001", metadata, nested_parent_session_id=None) == "conv-001"


def test_resolve_workflow_session_id_falls_back_to_workflow_run_for_workflow():
    metadata = {"conversation_id": None, "triggered_from": "workflow"}
    assert _resolve_workflow_session_id("run-001", None, metadata, nested_parent_session_id=None) == "run-001"


def test_resolve_workflow_session_id_prefers_nested_parent_session():
    metadata = {"conversation_id": None}
    assert _resolve_workflow_session_id("run-child", None, metadata, nested_parent_session_id="conv-parent") == "conv-parent"
```

- [ ] **Step 2: Run the focused helper tests and confirm they fail**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
```

Expected:

- FAIL with `NameError` or import failure for new helper names

- [ ] **Step 3: Add minimal helper implementations in the Phoenix provider**

Add small pure helpers near `_get_node_span_kind`:

```python
def _resolve_workflow_session_id(
    workflow_run_id: str,
    conversation_id: str | None,
    metadata: dict[str, Any],
    nested_parent_session_id: str | None,
) -> str:
    if nested_parent_session_id:
        return nested_parent_session_id
    if conversation_id:
        return conversation_id
    return workflow_run_id


def _resolve_parent_trace_context(info: WorkflowTraceInfo) -> tuple[str | None, str | None]:
    return info.resolved_parent_context
```

Add a code comment directly above the session helper:

```python
# Temporary Phoenix-local session fallback.
# Future direction: move standardized session semantics upstream once the shared tracing contract is extended.
```

- [ ] **Step 4: Run the helper tests and verify they pass**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
```

Expected:

- PASS for the new helper tests

- [ ] **Step 5: Commit the helper step**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py
git commit -m "feat: add phoenix-local session resolution helpers"
```

## Task 3: Make Top-Level Workflow Roots Canonical and Reuse Cross-Workflow Parent Context

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Add failing tests for nested workflow parent reuse**

Add tests that assert:

- top-level workflow uses the extracted root context directly
- nested workflow uses upstream parent context to attach under the outer tool span

Example:

```python
def test_workflow_trace_reuses_upstream_parent_context_for_nested_workflow(trace_instance):
    info = _make_workflow_info(
        workflow_run_id="run-child-001",
        conversation_id=None,
        metadata={
            "app_id": "app1",
            "tenant_id": "tenant-1",
            "parent_trace_context": {
                "parent_workflow_run_id": "run-parent-001",
                "parent_node_execution_id": "node-parent-001",
            },
        },
    )

    workflow_span = MagicMock()

    with (
        patch.object(trace_instance, "ensure_root_span"),
        patch.object(trace_instance, "_build_nested_workflow_context", return_value=object()) as nested_ctx,
        patch.object(trace_instance.tracer, "start_span", return_value=workflow_span),
        patch.object(trace_instance, "get_service_account_with_tenant"),
        patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker"),
        patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory") as repo_factory,
    ):
        repo_factory.create_workflow_node_execution_repository.return_value.get_by_workflow_execution.return_value = []

        trace_instance.workflow_trace(info)

    nested_ctx.assert_called_once_with(info)
    assert trace_instance.tracer.start_span.call_args.kwargs["context"] is nested_ctx.return_value
```

- [ ] **Step 2: Run the workflow trace tests and confirm the new expectations fail**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q -k "workflow_trace"
```

Expected:

- FAIL because `_build_nested_workflow_context` does not exist yet
- FAIL because root vs nested context selection is not implemented yet

- [ ] **Step 3: Implement canonical-root-safe workflow span context selection**

Refactor `workflow_trace` so that:

- top-level workflows use the root context extracted from `ensure_root_span`
- nested workflows use a dedicated helper based on `resolved_parent_context`
- no synthetic parent context is assigned to top-level workflow spans

Implementation shape:

```python
def _select_workflow_span_context(self, trace_info: WorkflowTraceInfo):
    trace_override, parent_span_id_source = trace_info.resolved_parent_context
    if trace_override and parent_span_id_source:
        return self._build_nested_workflow_context(trace_info)
    self.ensure_root_span(trace_info.resolved_trace_id or trace_info.workflow_run_id)
    return self.propagator.extract(carrier=self.carrier)
```

Add a comment near the helper:

```python
# Temporary Phoenix-local parent selection.
# Future direction: consume normalized hierarchy metadata from upstream instead of rebuilding context here.
```

- [ ] **Step 4: Update workflow session assignment to use the new helper**

Replace:

```python
SpanAttributes.SESSION_ID: trace_info.conversation_id or "",
```

with:

```python
SpanAttributes.SESSION_ID: _resolve_workflow_session_id(
    workflow_run_id=trace_info.workflow_run_id,
    conversation_id=trace_info.conversation_id,
    metadata=metadata,
    nested_parent_session_id=self._resolve_parent_session_id(trace_info),
),
```

- [ ] **Step 5: Run the workflow trace tests again and verify they pass**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q -k "workflow_trace or message_trace"
```

Expected:

- PASS for root-context and session fallback tests

- [ ] **Step 6: Commit the root and nested-parent step**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py
git commit -m "feat: reuse upstream parent context in phoenix workflow traces"
```

## Task 4: Build a Workflow-Local Hierarchy Map For Supported Node Types

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`

- [ ] **Step 1: Write failing tests for pure hierarchy helper behavior**

Add tests for a pure parent-resolution helper that receives simplified node records:

```python
def test_resolve_node_parent_prefers_predecessor_when_present():
    node = {"node_execution_id": "n2", "predecessor_node_id": "n1", "node_type": "llm"}
    span_ids = {"n1": object()}
    assert _resolve_node_parent(node=node, span_by_execution_id=span_ids, graph_parent_execution_id=None, workflow_span=object()) is span_ids["n1"]


def test_resolve_node_parent_falls_back_to_graph_parent():
    graph_parent = object()
    node = {"node_execution_id": "n2", "predecessor_node_id": None, "node_type": "assigner"}
    assert _resolve_node_parent(node=node, span_by_execution_id={}, graph_parent_execution_id=None, graph_parent_span=graph_parent, workflow_span=object()) is graph_parent


def test_resolve_node_parent_falls_back_to_workflow_root_before_execution_order():
    workflow_span = object()
    node = {"node_execution_id": "n2", "predecessor_node_id": None, "node_type": "end"}
    assert _resolve_node_parent(node=node, span_by_execution_id={}, graph_parent_execution_id=None, graph_parent_span=None, workflow_span=workflow_span) is workflow_span
```

- [ ] **Step 2: Run the helper test file and confirm failure**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
```

Expected:

- FAIL because the hierarchy helper does not exist yet

- [ ] **Step 3: Add minimal pure helpers for hierarchy reconstruction**

Implement helpers inside `arize_phoenix_trace.py`:

```python
def _build_graph_parent_index(node_executions: list[Any]) -> dict[str, str]:
    graph_parent_index: dict[str, str] = {}
    for node_execution in node_executions:
        predecessor = getattr(node_execution, "predecessor_node_id", None)
        current = getattr(node_execution, "id", None)
        if predecessor and current:
            graph_parent_index[str(current)] = str(predecessor)
    return graph_parent_index


def _resolve_node_parent(
    *,
    node: Any,
    span_by_execution_id: dict[str, Span],
    graph_parent_execution_id: str | None,
    graph_parent_span: Span | None,
    workflow_span: Span,
) -> Span:
    predecessor = getattr(node, "predecessor_node_id", None)
    if predecessor and predecessor in span_by_execution_id:
        return span_by_execution_id[predecessor]
    if graph_parent_execution_id and graph_parent_execution_id in span_by_execution_id:
        return span_by_execution_id[graph_parent_execution_id]
    if graph_parent_span is not None:
        return graph_parent_span
    return workflow_span
```

- [ ] **Step 4: Run the helper tests and verify they pass**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
```

Expected:

- PASS for the pure hierarchy helper tests

- [ ] **Step 5: Commit the hierarchy-helper checkpoint**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py
git commit -m "feat: add phoenix hierarchy helper primitives"
```

## Task 5: Attach Serial, Branch, Loop, and Iteration Nodes To Hierarchy Parents

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Write failing workflow-trace tests for serial and structured node parenting**

Add tests that construct mocked node executions for:

- serial chain: `start -> llm -> end`
- branch: `if-else -> llm_selected -> end`
- loop: `loop -> tool(iteration 0) -> assigner(iteration 0) -> end`
- iteration: `iteration -> tool(iteration 0) -> tool(iteration 1)`

Before the tests, add explicit local test helpers in the same file so the plan stays executable out of order:

```python
def _make_node_execution(
    execution_id: str,
    node_type: str,
    *,
    predecessor_node_id: str | None,
    status: str = "succeeded",
):
    node = MagicMock()
    node.id = execution_id
    node.node_type = node_type
    node.status = status
    node.inputs = {}
    node.outputs = {}
    node.created_at = _dt()
    node.elapsed_time = 1.0
    node.process_data = {}
    node.metadata = {}
    node.title = execution_id
    node.error = None
    node.predecessor_node_id = predecessor_node_id
    return node


from contextlib import contextmanager


@contextmanager
def _mock_workflow_run(trace_instance, workflow_span, node_executions, node_spans):
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = node_executions
    start_span_side_effect = [workflow_span, *node_spans]

    with (
        patch.object(trace_instance, "ensure_root_span"),
        patch.object(trace_instance.propagator, "extract", return_value=object()),
        patch.object(trace_instance.tracer, "start_span", side_effect=start_span_side_effect),
        patch.object(trace_instance, "get_service_account_with_tenant"),
        patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker"),
        patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory") as repo_factory,
    ):
        repo_factory.create_workflow_node_execution_repository.return_value = repo
        yield


@contextmanager
def _mock_empty_workflow_execution(trace_instance):
    repo = MagicMock()
    repo.get_by_workflow_execution.return_value = []

    with (
        patch.object(trace_instance, "ensure_root_span"),
        patch.object(trace_instance.propagator, "extract", return_value=object()),
        patch.object(trace_instance.tracer, "start_span", return_value=MagicMock()),
        patch.object(trace_instance, "get_service_account_with_tenant"),
        patch("dify_trace_arize_phoenix.arize_phoenix_trace.sessionmaker"),
        patch("dify_trace_arize_phoenix.arize_phoenix_trace.DifyCoreRepositoryFactory") as repo_factory,
    ):
        repo_factory.create_workflow_node_execution_repository.return_value = repo
        yield
```

Example assertion shape:

```python
def test_workflow_trace_links_serial_nodes_to_previous_runtime_parent(trace_instance):
    info = _make_workflow_info()
    workflow_span = MagicMock(name="workflow_span")
    start_span = MagicMock(name="start_span")
    llm_span = MagicMock(name="llm_span")
    end_span = MagicMock(name="end_span")

    start_node = _make_node_execution("start-1", "start", predecessor_node_id=None)
    llm_node = _make_node_execution("llm-1", "llm", predecessor_node_id="start-1")
    end_node = _make_node_execution("end-1", "end", predecessor_node_id="llm-1")

    with _mock_workflow_run(trace_instance, workflow_span, [start_node, llm_node, end_node], [start_span, llm_span, end_span]):
        trace_instance.workflow_trace(info)

    assert trace_instance.tracer.start_span.call_args_list[1].kwargs["context"] == set_span_in_context(workflow_span)
    assert trace_instance.tracer.start_span.call_args_list[2].kwargs["context"] == set_span_in_context(start_span)
    assert trace_instance.tracer.start_span.call_args_list[3].kwargs["context"] == set_span_in_context(llm_span)
```

- [ ] **Step 2: Run the workflow-trace tests and confirm the hierarchy tests fail**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q -k "serial or loop or iteration or branch"
```

Expected:

- FAIL because node spans currently all use `set_span_in_context(workflow_span)`

- [ ] **Step 3: Replace flat node parenting with resolved parent contexts**

Inside `workflow_trace`, change node creation from:

```python
workflow_span_context = set_span_in_context(workflow_span)
node_span = self.tracer.start_span(..., context=workflow_span_context)
```

to:

```python
span_by_execution_id: dict[str, Span] = {}
graph_parent_index = _build_graph_parent_index(workflow_node_executions)

for node_execution in workflow_node_executions:
    graph_parent_execution_id = graph_parent_index.get(str(node_execution.id))
    graph_parent_span = span_by_execution_id.get(graph_parent_execution_id) if graph_parent_execution_id else None
    parent_span = _resolve_node_parent(
        node=node_execution,
        span_by_execution_id=span_by_execution_id,
        graph_parent_execution_id=graph_parent_execution_id,
        graph_parent_span=graph_parent_span,
        workflow_span=workflow_span,
    )
    node_span = self.tracer.start_span(
        ...,
        context=set_span_in_context(parent_span),
    )
    span_by_execution_id[str(node_execution.id)] = node_span
```

Add comments that clarify:

- this is a transitional Phoenix-local hierarchy reconstruction
- execution-order heuristic is intentionally not the main rule
- future upstream hierarchy metadata should replace this local rebuild

- [ ] **Step 4: Add narrow special cases for `start`, `end`, `loop`, and `iteration`**

Keep the minimal rules explicit:

```python
if node_execution.node_type == "start":
    parent_span = workflow_span
elif node_execution.node_type == "end" and parent_span is workflow_span:
    parent_span = workflow_span
elif node_execution.node_type in {"loop", "iteration"}:
    parent_span = parent_span
```

The main point is not extra logic yet, but to leave a stable insertion point for structured-node refinement without falling back to generic “most recent span” behavior.

- [ ] **Step 5: Run the workflow provider tests and verify they pass**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

Expected:

- PASS for the newly added serial and structured hierarchy cases

- [ ] **Step 6: Commit the node-parenting step**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
git commit -m "feat: reconstruct phoenix workflow node hierarchy"
```

## Task 6: Cover Nested Workflow Session Inheritance and Regression Cases

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: Write regression tests for nested session inheritance and non-supported cases**

Add tests that assert:

- nested workflow inherits outer session identity
- node spans do not write empty session strings in workflow-only runs
- `parallel` is not modeled specially and safely falls back without exploding

Example:

```python
def test_nested_workflow_inherits_outer_session_id(trace_instance):
    info = _make_workflow_info(
        workflow_run_id="run-child-001",
        conversation_id=None,
        metadata={
            "app_id": "app1",
            "tenant_id": "tenant-1",
            "parent_trace_context": {
                "parent_workflow_run_id": "run-parent-001",
                "parent_node_execution_id": "node-parent-001",
                "session_id": "conv-parent-001",
            },
        },
    )

    with _mock_empty_workflow_execution(trace_instance):
        trace_instance.workflow_trace(info)

    attrs = trace_instance.tracer.start_span.call_args.kwargs["attributes"]
    assert attrs[SpanAttributes.SESSION_ID] == "conv-parent-001"
```

- [ ] **Step 2: Run the provider tests and confirm failures**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q -k "session or parallel"
```

Expected:

- FAIL until nested session inheritance is implemented

- [ ] **Step 3: Implement the minimal regression fixes**

Update the workflow session helper to inspect parent metadata only as a fallback source, without redefining upstream semantics:

```python
def _resolve_parent_session_id(self, trace_info: WorkflowTraceInfo) -> str | None:
    parent_ctx = trace_info.metadata.get("parent_trace_context")
    if not isinstance(parent_ctx, dict):
        return None
    session_id = parent_ctx.get("session_id")
    return session_id if isinstance(session_id, str) and session_id else None
```

Keep `parallel` behavior explicit in comments:

```python
# V1 deliberately does not model parallel branches as distinct hierarchy structures.
# Unsupported concurrent shapes safely fall back to workflow-root-compatible parenting.
```

- [ ] **Step 4: Run the provider tests again and verify pass**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

Expected:

- PASS for nested session inheritance and fallback regression tests

- [ ] **Step 5: Commit the regression coverage**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
git commit -m "test: cover phoenix session inheritance and fallbacks"
```

## Task 7: Final Verification and Code Review Pass

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`

- [ ] **Step 1: Run the complete Phoenix provider unit test suite**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests -q
```

Expected:

- PASS

- [ ] **Step 2: Run the targeted enterprise telemetry regression suite**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/enterprise/telemetry/test_enterprise_trace.py -q
```

Expected:

- PASS, confirming Phoenix-side changes did not require upstream enterprise telemetry changes

- [ ] **Step 3: Run formatter and linter for the backend tree**

Run:

```bash
make format
make lint
```

Expected:

- formatting completes without changing unrelated files
- lint passes

- [ ] **Step 4: Perform a manual review checklist before the final commit**

Verify by reading the final diff:

- root workflow/chatflow spans never receive fabricated parent context
- nested workflow spans only reuse upstream parent context
- workflow node spans no longer all attach directly to workflow span
- comments clearly mark temporary Phoenix-local logic and future upstream migration direction
- no production files outside the Phoenix provider package were modified

- [ ] **Step 5: Create the final implementation commit**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py
git commit -m "feat: improve phoenix hierarchy reconstruction"
```

- [ ] **Step 6: Capture manual Phoenix verification evidence**

After local tests pass, verify in Phoenix with a real run that covers:

- top-level workflow root appears as a canonical root
- session view resolves root span for workflow and chatflow runs
- nested workflow appears under the outer tool span
- serial nodes show a parent chain
- branch / loop / iteration runs show stable, non-flat hierarchy
- unsupported `parallel` flows do not crash and remain safely viewable

Record screenshots or query payloads before merging.
