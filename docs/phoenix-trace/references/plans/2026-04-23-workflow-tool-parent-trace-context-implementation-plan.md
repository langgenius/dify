# Workflow Tool Parent Trace Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and propagate `parent_trace_context` for workflows invoked through workflow-as-tool so nested workflow traces can reuse parent workflow/span context downstream.

**Architecture:** Add one small extraction helper for `parent_trace_context`, create the context at the workflow-as-tool invocation site, carry it through `WorkflowAppGenerator.generate(..., args=...)` into `application_generate_entity.extras`, and finally enqueue it on the workflow trace task. This keeps the patch close to the workflow-as-tool call chain and avoids changing `ops_trace_manager` or Phoenix consumer code.

**Tech Stack:** Python, Pydantic, pytest, Dify backend workflow runtime, Celery trace task queue

---

## Files

### Production

- Modify: `api/core/helper/trace_id_helper.py`
  - add a small extractor for `parent_trace_context`
  - keep extraction logic colocated with existing trace-related arg helpers

- Modify: `api/core/tools/workflow_as_tool/tool.py`
  - build `parent_trace_context` for nested workflow invocation
  - pass it through `args` when calling `WorkflowAppGenerator.generate(...)`

- Modify: `api/core/app/apps/workflow/app_generator.py`
  - extract `parent_trace_context` from `args`
  - merge it into `extras` alongside `external_trace_id`

- Modify: `api/core/app/workflow/layers/persistence.py`
  - pass `parent_trace_context` from `application_generate_entity.extras` into `TraceTask`

### Tests

- Modify: `api/tests/unit_tests/core/helper/test_trace_id_helper.py`
  - cover extraction of `parent_trace_context`

- Modify: `api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py`
  - assert workflow-as-tool produces `parent_trace_context` in generator args

- Modify: `api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py`
  - assert `WorkflowAppGenerator.generate()` merges `parent_trace_context` into `extras`

- Modify: `api/tests/unit_tests/core/app/workflow/test_persistence_layer.py`
  - assert trace tasks include `parent_trace_context` when present in extras

---

## Task 1: Lock The Helper Contract With Tests

**Files:**
- Modify: `api/tests/unit_tests/core/helper/test_trace_id_helper.py`
- Modify: `api/core/helper/trace_id_helper.py`

- [ ] **Step 1: Add failing helper tests for parent trace context extraction**

```python
from core.helper.trace_id_helper import (
    extract_external_trace_id_from_args,
    extract_parent_trace_context_from_args,
    get_external_trace_id,
    is_valid_trace_id,
)


@pytest.mark.parametrize(
    ("args", "expected"),
    [
        (
            {
                "parent_trace_context": {
                    "parent_workflow_run_id": "run-1",
                    "parent_node_execution_id": "node-exec-1",
                }
            },
            {
                "parent_trace_context": {
                    "parent_workflow_run_id": "run-1",
                    "parent_node_execution_id": "node-exec-1",
                }
            },
        ),
        ({"parent_trace_context": {"parent_workflow_run_id": "run-1"}}, {}),
        ({}, {}),
    ],
)
def test_extract_parent_trace_context_from_args(args, expected):
    assert extract_parent_trace_context_from_args(args) == expected
```

- [ ] **Step 2: Run the targeted helper test to verify it fails**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/helper/test_trace_id_helper.py -q
```

Expected:

```text
FAIL ... cannot import name 'extract_parent_trace_context_from_args'
```

- [ ] **Step 3: Implement the minimal helper**

```python
def extract_parent_trace_context_from_args(args: Mapping[str, Any]) -> dict[str, Any]:
    """
    Extract a complete parent_trace_context from args.

    Returns a dict suitable for merging into extras. Incomplete contexts are
    ignored so downstream tracing only receives the canonical two-key payload.
    """
    candidate = args.get("parent_trace_context")
    if not isinstance(candidate, Mapping):
        return {}

    parent_workflow_run_id = candidate.get("parent_workflow_run_id")
    parent_node_execution_id = candidate.get("parent_node_execution_id")
    if parent_workflow_run_id and parent_node_execution_id:
        return {
            "parent_trace_context": {
                "parent_workflow_run_id": parent_workflow_run_id,
                "parent_node_execution_id": parent_node_execution_id,
            }
        }
    return {}
```

- [ ] **Step 4: Run the helper test again**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/helper/test_trace_id_helper.py -q
```

Expected:

```text
... passed
```

- [ ] **Step 5: Commit the helper checkpoint**

```bash
git add api/core/helper/trace_id_helper.py \
        api/tests/unit_tests/core/helper/test_trace_id_helper.py
git commit -m "test: add parent trace context arg extraction helper"
```

## Task 2: Make WorkflowTool Produce Parent Trace Context

**Files:**
- Modify: `api/core/tools/workflow_as_tool/tool.py`
- Modify: `api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py`

- [ ] **Step 1: Add a failing workflow-as-tool test that expects parent trace context in generator args**

```python
def test_workflow_tool_passes_parent_trace_context_to_generator(monkeypatch: pytest.MonkeyPatch):
    tool = _build_tool()
    tool.runtime = ToolRuntime(
        tenant_id="tenant-1",
        user_id="user-1",
        invoke_from=InvokeFrom.DEBUGGER,
        runtime_parameters={
            "workflow_run_id": "outer-run-1",
            "node_execution_id": "outer-node-exec-1",
        },
    )

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: Mock())

    generate_mock = MagicMock(return_value={"data": {"outputs": {}}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)

    list(tool.invoke("test_user", {}))

    assert generate_mock.call_args.kwargs["args"]["parent_trace_context"] == {
        "parent_workflow_run_id": "outer-run-1",
        "parent_node_execution_id": "outer-node-exec-1",
    }
```

- [ ] **Step 2: Run the workflow-as-tool test to verify it fails**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py -q
```

Expected:

```text
FAIL ... KeyError: 'parent_trace_context'
```

- [ ] **Step 3: Implement parent trace context production in `WorkflowTool._invoke()`**

```python
parent_trace_context: dict[str, str] | None = None
runtime_parameters = self.runtime.runtime_parameters if self.runtime else {}
parent_workflow_run_id = runtime_parameters.get("workflow_run_id")
parent_node_execution_id = runtime_parameters.get("node_execution_id")
if parent_workflow_run_id and parent_node_execution_id:
    parent_trace_context = {
        "parent_workflow_run_id": str(parent_workflow_run_id),
        "parent_node_execution_id": str(parent_node_execution_id),
    }

generator_args: dict[str, Any] = {"inputs": tool_parameters, "files": files}
if parent_trace_context:
    generator_args["parent_trace_context"] = parent_trace_context

result = generator.generate(
    app_model=app,
    workflow=workflow,
    user=user,
    args=generator_args,
    invoke_from=self.runtime.invoke_from,
    streaming=False,
    call_depth=self.workflow_call_depth + 1,
    pause_state_config=None,
)
```

- [ ] **Step 4: Re-run the workflow-as-tool test**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py -q
```

Expected:

```text
... passed
```

- [ ] **Step 5: Commit the workflow-as-tool checkpoint**

```bash
git add api/core/tools/workflow_as_tool/tool.py \
        api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py
git commit -m "feat: propagate parent trace context from workflow tools"
```

## Task 3: Carry Parent Trace Context Into Workflow Extras

**Files:**
- Modify: `api/core/app/apps/workflow/app_generator.py`
- Modify: `api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py`

- [ ] **Step 1: Add a failing generator test that expects `parent_trace_context` in `application_generate_entity.extras`**

```python
def test_generate_includes_parent_trace_context_in_extras(mocker):
    generator = WorkflowAppGenerator()

    captured_entities: list[object] = []

    def workflow_entity_ctor(**kwargs):
        captured_entities.append(kwargs)
        return SimpleNamespace(**kwargs)

    mocker.patch("core.app.apps.workflow.app_generator.WorkflowAppGenerateEntity", side_effect=workflow_entity_ctor)
    mocker.patch("core.app.apps.workflow.app_generator.WorkflowAppConfigManager.get_app_config", return_value=SimpleNamespace(app_id="app"))
    mocker.patch("core.app.apps.workflow.app_generator.FileUploadConfigManager.convert", return_value=SimpleNamespace())
    mocker.patch("core.app.apps.workflow.app_generator.file_factory.build_from_mappings", return_value=[])
    mocker.patch("core.app.apps.workflow.app_generator.TraceQueueManager", return_value=MagicMock())
    mocker.patch.object(generator, "_generate", return_value="ok")
    mocker.patch("core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository", return_value=MagicMock())
    mocker.patch("core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository", return_value=MagicMock())

    generator.generate(
        app_model=SimpleNamespace(id="app", tenant_id="tenant"),
        workflow=SimpleNamespace(features_dict={}, type="workflow"),
        user=SimpleNamespace(id="user"),
        args={
            "inputs": {},
            "files": [],
            "parent_trace_context": {
                "parent_workflow_run_id": "outer-run-1",
                "parent_node_execution_id": "outer-node-exec-1",
            },
        },
        invoke_from=InvokeFrom.DEBUGGER,
        streaming=False,
    )

    assert captured_entities[-1]["extras"]["parent_trace_context"] == {
        "parent_workflow_run_id": "outer-run-1",
        "parent_node_execution_id": "outer-node-exec-1",
    }
```

- [ ] **Step 2: Run the generator test to verify it fails**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py -q
```

Expected:

```text
FAIL ... KeyError: 'parent_trace_context'
```

- [ ] **Step 3: Merge the new helper into `extras` in `WorkflowAppGenerator.generate()`**

```python
from core.helper.trace_id_helper import (
    extract_external_trace_id_from_args,
    extract_parent_trace_context_from_args,
)

extras = {
    **extract_external_trace_id_from_args(args),
    **extract_parent_trace_context_from_args(args),
}
```

- [ ] **Step 4: Re-run the generator test**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py -q
```

Expected:

```text
... passed
```

- [ ] **Step 5: Commit the generator checkpoint**

```bash
git add api/core/app/apps/workflow/app_generator.py \
        api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py
git commit -m "feat: carry parent trace context into workflow extras"
```

## Task 4: Enqueue Parent Trace Context On Workflow Trace Tasks

**Files:**
- Modify: `api/core/app/workflow/layers/persistence.py`
- Modify: `api/tests/unit_tests/core/app/workflow/test_persistence_layer.py`

- [ ] **Step 1: Add a failing persistence-layer test that expects `TraceTask` to receive `parent_trace_context`**

```python
def test_handle_graph_run_failed_enqueues_parent_trace_context(self):
    trace_tasks: list[object] = []
    trace_manager = SimpleNamespace(user_id="user", add_trace_task=lambda task: trace_tasks.append(task))
    extras = {
        "external_trace_id": "trace",
        "parent_trace_context": {
            "parent_workflow_run_id": "outer-run-1",
            "parent_node_execution_id": "outer-node-exec-1",
        },
    }
    layer, _, _, _ = _make_layer(extras=extras, trace_manager=trace_manager)
    layer._handle_graph_run_started()

    layer._handle_graph_run_failed(GraphRunFailedEvent(error="boom", exceptions_count=1))

    assert trace_tasks
    assert trace_tasks[-1].kwargs["parent_trace_context"] == {
        "parent_workflow_run_id": "outer-run-1",
        "parent_node_execution_id": "outer-node-exec-1",
    }
```

- [ ] **Step 2: Run the persistence-layer test to verify it fails**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/workflow/test_persistence_layer.py -q
```

Expected:

```text
FAIL ... KeyError: 'parent_trace_context'
```

- [ ] **Step 3: Pass the context through `_enqueue_trace_task()`**

```python
parent_trace_context = None
if isinstance(self._application_generate_entity, (WorkflowAppGenerateEntity, AdvancedChatAppGenerateEntity)):
    external_trace_id = self._application_generate_entity.extras.get("external_trace_id")
    parent_trace_context = self._application_generate_entity.extras.get("parent_trace_context")

trace_task = TraceTask(
    TraceTaskName.WORKFLOW_TRACE,
    workflow_execution=execution,
    conversation_id=conversation_id,
    user_id=self._trace_manager.user_id,
    external_trace_id=external_trace_id,
    parent_trace_context=parent_trace_context,
)
```

- [ ] **Step 4: Re-run the persistence-layer test**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/workflow/test_persistence_layer.py -q
```

Expected:

```text
... passed
```

- [ ] **Step 5: Commit the persistence checkpoint**

```bash
git add api/core/app/workflow/layers/persistence.py \
        api/tests/unit_tests/core/app/workflow/test_persistence_layer.py
git commit -m "feat: enqueue parent trace context for workflow traces"
```

## Task 5: Run Focused Regression Verification And Final Commit

**Files:**
- Modify: none

- [ ] **Step 1: Run the full focused test set for this patch**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/helper/test_trace_id_helper.py \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py \
  api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py \
  api/tests/unit_tests/core/app/workflow/test_persistence_layer.py -q
```

Expected:

```text
all selected tests pass
```

- [ ] **Step 2: Run the existing Phoenix targeted regression after the upstream patch**

Run:

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

Expected:

```text
all selected tests pass
```

- [ ] **Step 3: Manually verify the runtime signal in logs**

Run a local workflow-as-tool debugging scenario and confirm the Phoenix diagnostic log changes from:

```text
parent_workflow_run_id=None parent_node_execution_id=None
```

to:

```text
parent_workflow_run_id=<outer workflow run id> parent_node_execution_id=<outer node execution id>
```

- [ ] **Step 4: Create the final implementation commit**

```bash
git add api/core/helper/trace_id_helper.py \
        api/core/tools/workflow_as_tool/tool.py \
        api/core/app/apps/workflow/app_generator.py \
        api/core/app/workflow/layers/persistence.py \
        api/tests/unit_tests/core/helper/test_trace_id_helper.py \
        api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py \
        api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py \
        api/tests/unit_tests/core/app/workflow/test_persistence_layer.py
git commit -m "feat: propagate workflow tool parent trace context"
```

## Self-Review Notes

- Spec coverage: this plan covers the agreed upstream gap only for workflow-as-tool parent context production and propagation; it does not broaden into Phoenix display changes or synthetic-root behavior.
- Placeholder scan: no TBD/TODO markers remain; each task has explicit files, commands, and code snippets.
- Type consistency: the propagated payload uses the exact two keys already consumed by `resolved_parent_context`:
  - `parent_workflow_run_id`
  - `parent_node_execution_id`
