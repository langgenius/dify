# Phoenix Trace Review Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Phoenix tracing review findings without changing the user-facing nested workflow trace behavior.

**Architecture:** Move retry signaling to `core.ops`, move workflow-tool parent context out of public tool runtime parameters, and persist retry-local enterprise dispatch state in the ops trace payload. Keep Phoenix parent span Redis coordination provider-local for now, with an explicit comment documenting the future extraction boundary.

**Tech Stack:** Python, Celery, Pydantic, pytest, Dify workflow tool runtime, Phoenix OpenTelemetry provider.

---

## File Structure

- Modify: `api/core/workflow/node_runtime.py`
  - Store workflow parent trace context on `_WorkflowToolRuntimeBinding`.
  - Pass context to `WorkflowTool` through a private invocation path instead of `runtime_parameters`.
- Modify: `api/core/tools/workflow_as_tool/tool.py`
  - Add a private parent trace context setter or invocation helper.
  - Build generator args from the private context, not from `runtime.runtime_parameters`.
- Create: `api/core/ops/exceptions.py`
  - Define core retryable trace dispatch exceptions.
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
  - Raise the core pending-parent exception.
  - Add the provider-local coordination comment.
- Modify: `api/tasks/ops_trace_task.py`
  - Catch the core pending-parent exception.
  - Persist `_enterprise_trace_dispatched` before retry.
  - Skip enterprise dispatch when the payload flag is already true.
- Modify tests:
  - `api/tests/unit_tests/core/workflow/test_node_runtime.py`
  - `api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py`
  - `api/tests/unit_tests/tasks/test_ops_trace_task.py`
  - `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
  - `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

---

### Task 1: Move Workflow Tool Parent Context Off Runtime Parameters

**Files:**
- Modify: `api/core/workflow/node_runtime.py`
- Modify: `api/core/tools/workflow_as_tool/tool.py`
- Test: `api/tests/unit_tests/core/workflow/test_node_runtime.py`
- Test: `api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py`

- [ ] **Step 1: Add failing tests for user input collision**

In `api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py`, add a test proving user inputs survive when they use the old internal key names:

```python
def test_workflow_tool_keeps_user_inputs_named_like_trace_runtime_keys(monkeypatch: pytest.MonkeyPatch):
    tool = _build_tool()
    tool.set_parent_trace_context(
        parent_workflow_run_id="outer-workflow-run-1",
        parent_node_execution_id="outer-node-execution-1",
    )

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)
    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)
    generate_mock = MagicMock(return_value={"data": {}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(
        tool.invoke(
            "test_user",
            {
                "outer_workflow_run_id": "user-workflow-input",
                "outer_node_execution_id": "user-node-input",
            },
        )
    )

    call_kwargs = generate_mock.call_args.kwargs
    assert call_kwargs["args"]["inputs"]["outer_workflow_run_id"] == "user-workflow-input"
    assert call_kwargs["args"]["inputs"]["outer_node_execution_id"] == "user-node-input"
    assert call_kwargs["args"]["parent_trace_context"] == {
        "parent_workflow_run_id": "outer-workflow-run-1",
        "parent_node_execution_id": "outer-node-execution-1",
    }
```

Update the existing parent context test to call `tool.set_parent_trace_context(...)` instead of writing to `tool.runtime.runtime_parameters`.

- [ ] **Step 2: Run the focused failing tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py::test_workflow_tool_keeps_user_inputs_named_like_trace_runtime_keys \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py::test_workflow_tool_passes_parent_trace_context_from_runtime \
  -q
```

Expected before implementation: the new test fails because `WorkflowTool` has no private setter yet, or because parent context still comes from `runtime_parameters`.

- [ ] **Step 3: Add private context storage to `WorkflowTool`**

In `api/core/tools/workflow_as_tool/tool.py`, add an attribute initialized in `__init__`:

```python
self._parent_trace_context: dict[str, str] | None = None
```

Add a method on `WorkflowTool`:

```python
def set_parent_trace_context(
    self,
    *,
    parent_workflow_run_id: str,
    parent_node_execution_id: str,
) -> None:
    self._parent_trace_context = {
        "parent_workflow_run_id": parent_workflow_run_id,
        "parent_node_execution_id": parent_node_execution_id,
    }
```

Update `fork_tool_runtime()` to copy the private context:

```python
forked = self.__class__(
    entity=self.entity.model_copy(),
    runtime=runtime,
    workflow_app_id=self.workflow_app_id,
    workflow_as_tool_id=self.workflow_as_tool_id,
    workflow_entities=self.workflow_entities,
    workflow_call_depth=self.workflow_call_depth,
    version=self.version,
    label=self.label,
)
forked._parent_trace_context = self._parent_trace_context.copy() if self._parent_trace_context else None
return forked
```

Update `_invoke()` to remove the `runtime_parameters` lookup and use the private context:

```python
generator_args: dict[str, Any] = {"inputs": tool_parameters, "files": files}
if self._parent_trace_context:
    generator_args.update(
        extract_parent_trace_context_from_args({"parent_trace_context": self._parent_trace_context})
    )
```

- [ ] **Step 4: Update `DifyToolNodeRuntime` binding**

In `api/core/workflow/node_runtime.py`, extend `_WorkflowToolRuntimeBinding`:

```python
parent_trace_context: dict[str, str] | None = None
```

In `get_runtime()`, build a local `parent_trace_context` dict for workflow providers instead of mutating `tool_runtime.runtime.runtime_parameters`.

In the returned binding:

```python
return ToolRuntimeHandle(
    raw=_WorkflowToolRuntimeBinding(
        tool=tool_runtime,
        conversation_id=conversation_id,
        parent_trace_context=parent_trace_context,
    )
)
```

In `invoke()`, before `ToolEngine.generic_invoke(...)`, install the context on workflow tools only:

```python
if runtime_binding.parent_trace_context and hasattr(tool, "set_parent_trace_context"):
    tool.set_parent_trace_context(
        parent_workflow_run_id=runtime_binding.parent_trace_context["parent_workflow_run_id"],
        parent_node_execution_id=runtime_binding.parent_trace_context["parent_node_execution_id"],
    )
```

- [ ] **Step 5: Update node runtime tests**

In `api/tests/unit_tests/core/workflow/test_node_runtime.py`, replace assertions against `runtime_tool.runtime.runtime_parameters` with assertions against the binding:

```python
assert handle.raw.parent_trace_context == {
    "parent_workflow_run_id": "outer-workflow-run-id",
    "parent_node_execution_id": "node-execution-id",
}
assert runtime_tool.runtime.runtime_parameters == {}
```

Add `node_execution_id="node-execution-id"` to the test call.

- [ ] **Step 6: Run focused tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/workflow/test_node_runtime.py \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py \
  -q
```

Expected: PASS.

---

### Task 2: Move Pending-Parent Retry Exception to Core

**Files:**
- Create: `api/core/ops/exceptions.py`
- Modify: `api/tasks/ops_trace_task.py`
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify tests importing `PendingPhoenixParentSpanContextError`

- [ ] **Step 1: Add core exception**

Create `api/core/ops/exceptions.py`:

```python
class RetryableTraceDispatchError(RuntimeError):
    """Base class for transient trace dispatch failures that Celery may retry."""


class PendingTraceParentContextError(RetryableTraceDispatchError):
    """Raised when a nested trace arrives before its parent span context is available."""

    parent_node_execution_id: str

    def __init__(self, parent_node_execution_id: str):
        self.parent_node_execution_id = parent_node_execution_id
        super().__init__(
            "Pending trace parent context for parent_node_execution_id="
            f"{parent_node_execution_id}. Retry after the parent span context is published."
        )
```

- [ ] **Step 2: Update imports and raises**

In `api/tasks/ops_trace_task.py`, replace the Phoenix import with:

```python
from core.ops.exceptions import PendingTraceParentContextError
```

Catch `PendingTraceParentContextError`.

In `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`, import the core exception and remove the provider-local `PendingPhoenixParentSpanContextError` class. Raise `PendingTraceParentContextError(parent_node_execution_id)`.

- [ ] **Step 3: Update tests**

Replace test imports of `PendingPhoenixParentSpanContextError` with:

```python
from core.ops.exceptions import PendingTraceParentContextError
```

Replace constructors accordingly.

- [ ] **Step 4: Run focused tests**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  -q
```

Expected: PASS after imports are updated.

---

### Task 3: Prevent Enterprise Trace Re-Emission on Phoenix Retry

**Files:**
- Modify: `api/tasks/ops_trace_task.py`
- Test: `api/tests/unit_tests/tasks/test_ops_trace_task.py`

- [ ] **Step 1: Add retry-state tests**

In `api/tests/unit_tests/tasks/test_ops_trace_task.py`, add a test where enterprise telemetry is enabled, provider dispatch raises `PendingTraceParentContextError`, and `storage.save` receives payload containing `_enterprise_trace_dispatched: true` before retry is raised.

Also add a test where the loaded payload already has `_enterprise_trace_dispatched: true`, then assert `EnterpriseOtelTrace().trace(...)` is not called and provider dispatch still runs.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

Expected before implementation: the new tests fail because retry state is not persisted and enterprise trace is not skipped.

- [ ] **Step 3: Persist enterprise dispatch state**

In `api/tasks/ops_trace_task.py`, after loading `file_data`, read:

```python
enterprise_trace_dispatched = bool(file_data.get("_enterprise_trace_dispatched"))
```

Wrap enterprise dispatch:

```python
if is_ee_telemetry_enabled() and not enterprise_trace_dispatched:
    from enterprise.telemetry.enterprise_trace import EnterpriseOtelTrace

    try:
        EnterpriseOtelTrace().trace(trace_info)
    except Exception:
        logger.exception("Enterprise trace failed for app_id: %s", app_id)
    finally:
        file_data["_enterprise_trace_dispatched"] = True
        enterprise_trace_dispatched = True
```

Before scheduling retry in the pending-parent exception branch, persist the updated payload:

```python
storage.save(file_path, json.dumps(file_data))
```

Only then call `self.retry(...)`.

- [ ] **Step 4: Run task tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

Expected: PASS.

---

### Task 4: Document Phoenix-Local Coordination Boundary

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`

- [ ] **Step 1: Add comment near Redis helper functions**

Add this comment above `_PHOENIX_PARENT_SPAN_CONTEXT_TTL_SECONDS` or above `_publish_parent_span_context`:

```python
# This parent-span carrier store is intentionally Phoenix-local for the current
# nested workflow tracing feature. If other trace providers need the same
# cross-task parent restoration behavior, move the storage and retry signaling
# behind a core trace coordination interface instead of duplicating it here.
```

- [ ] **Step 2: Run Phoenix provider tests**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  -q
```

Expected: PASS.

---

### Task 5: Final Verification and Commit

**Files:**
- All modified files from Tasks 1-4.

- [ ] **Step 1: Run combined focused suite**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/workflow/test_node_runtime.py \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  -q
```

Expected: PASS.

- [ ] **Step 2: Review diff**

Run:

```bash
git diff -- api/core/workflow/node_runtime.py \
  api/core/tools/workflow_as_tool/tool.py \
  api/core/ops/exceptions.py \
  api/tasks/ops_trace_task.py \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py \
  api/tests/unit_tests/core/workflow/test_node_runtime.py \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
```

Expected: diff contains only the review fixes and tests described in this plan.

- [ ] **Step 3: Commit**

Run:

```bash
git add api/core/workflow/node_runtime.py \
  api/core/tools/workflow_as_tool/tool.py \
  api/core/ops/exceptions.py \
  api/tasks/ops_trace_task.py \
  api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py \
  api/tests/unit_tests/core/workflow/test_node_runtime.py \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
git commit -m "fix: tighten phoenix trace retry boundaries"
```
