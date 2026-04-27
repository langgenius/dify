# Workflow Tool Parent Trace Context Implementation Plan

> **给 agent 的说明：** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐步执行本计划。步骤使用 checkbox（`- [ ]`）语法做跟踪。

**目标：** 让通过 workflow-as-tool 触发的子 workflow 在上游生产并透传 `parent_trace_context`，从而让下游 tracing 能复用父 workflow / 父 span 上下文。

**架构：** 增加一个小型 `parent_trace_context` 提取 helper，在 workflow-as-tool 调用现场构造该上下文，通过 `WorkflowAppGenerator.generate(..., args=...)` 带入 `application_generate_entity.extras`，最后在 workflow trace task 入队时传下去。这样补丁贴近 workflow-as-tool 调用链，不需要改 `ops_trace_manager`，也不需要再改 Phoenix consumer。

**技术栈：** Python、Pydantic、pytest、Dify backend workflow runtime、Celery trace task queue

---

## 文件范围

### 生产代码

- 修改：`api/core/helper/trace_id_helper.py`
  - 增加 `parent_trace_context` 的轻量提取 helper
  - 让它和现有 trace 相关 args helper 放在同一个位置

- 修改：`api/core/tools/workflow_as_tool/tool.py`
  - 在 nested workflow 调用点构造 `parent_trace_context`
  - 调用 `WorkflowAppGenerator.generate(...)` 时通过 `args` 传下去

- 修改：`api/core/app/apps/workflow/app_generator.py`
  - 从 `args` 提取 `parent_trace_context`
  - 和 `external_trace_id` 一样合并进 `extras`

- 修改：`api/core/app/workflow/layers/persistence.py`
  - 从 `application_generate_entity.extras` 里取出 `parent_trace_context`
  - 在创建 `TraceTask` 时继续往下传

### 测试代码

- 修改：`api/tests/unit_tests/core/helper/test_trace_id_helper.py`
  - 覆盖 `parent_trace_context` 提取逻辑

- 修改：`api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py`
  - 断言 workflow-as-tool 会把 `parent_trace_context` 放进 generator args

- 修改：`api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py`
  - 断言 `WorkflowAppGenerator.generate()` 会把 `parent_trace_context` 合并进 `extras`

- 修改：`api/tests/unit_tests/core/app/workflow/test_persistence_layer.py`
  - 断言 trace task 入队时会携带 `parent_trace_context`

---

## Task 1：先用测试锁定 Helper Contract

**文件：**
- 修改：`api/tests/unit_tests/core/helper/test_trace_id_helper.py`
- 修改：`api/core/helper/trace_id_helper.py`

- [ ] **Step 1：新增失败测试，锁定 parent trace context 提取规则**

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

- [ ] **Step 2：运行 helper 测试，确认先红灯**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/core/helper/test_trace_id_helper.py -q
```

预期：

```text
FAIL ... cannot import name 'extract_parent_trace_context_from_args'
```

- [ ] **Step 3：实现最小 helper**

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

- [ ] **Step 4：再次运行 helper 测试**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/core/helper/test_trace_id_helper.py -q
```

预期：

```text
... passed
```

- [ ] **Step 5：提交 helper 检查点**

```bash
git add api/core/helper/trace_id_helper.py \
        api/tests/unit_tests/core/helper/test_trace_id_helper.py
git commit -m "test: add parent trace context arg extraction helper"
```

## Task 2：让 WorkflowTool 生产 Parent Trace Context

**文件：**
- 修改：`api/core/tools/workflow_as_tool/tool.py`
- 修改：`api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py`

- [ ] **Step 1：新增失败测试，断言 workflow-as-tool 会把 parent trace context 传给 generator**

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

- [ ] **Step 2：运行 workflow-as-tool 测试，确认先失败**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py -q
```

预期：

```text
FAIL ... KeyError: 'parent_trace_context'
```

- [ ] **Step 3：在 `WorkflowTool._invoke()` 里实现 parent trace context 生产**

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

- [ ] **Step 4：重新运行 workflow-as-tool 测试**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py -q
```

预期：

```text
... passed
```

- [ ] **Step 5：提交 workflow-as-tool 检查点**

```bash
git add api/core/tools/workflow_as_tool/tool.py \
        api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py
git commit -m "feat: propagate parent trace context from workflow tools"
```

## Task 3：把 Parent Trace Context 带入 Workflow Extras

**文件：**
- 修改：`api/core/app/apps/workflow/app_generator.py`
- 修改：`api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py`

- [ ] **Step 1：新增失败测试，断言 `application_generate_entity.extras` 会包含 `parent_trace_context`**

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

- [ ] **Step 2：运行 generator 测试，确认先红灯**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py -q
```

预期：

```text
FAIL ... KeyError: 'parent_trace_context'
```

- [ ] **Step 3：在 `WorkflowAppGenerator.generate()` 里合并新 helper**

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

- [ ] **Step 4：重新运行 generator 测试**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py -q
```

预期：

```text
... passed
```

- [ ] **Step 5：提交 generator 检查点**

```bash
git add api/core/app/apps/workflow/app_generator.py \
        api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py
git commit -m "feat: carry parent trace context into workflow extras"
```

## Task 4：在 Workflow Trace Task 入队时继续透传

**文件：**
- 修改：`api/core/app/workflow/layers/persistence.py`
- 修改：`api/tests/unit_tests/core/app/workflow/test_persistence_layer.py`

- [ ] **Step 1：新增失败测试，断言 `TraceTask` 会收到 `parent_trace_context`**

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

- [ ] **Step 2：运行 persistence-layer 测试，确认先失败**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/core/app/workflow/test_persistence_layer.py -q
```

预期：

```text
FAIL ... KeyError: 'parent_trace_context'
```

- [ ] **Step 3：在 `_enqueue_trace_task()` 里透传该上下文**

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

- [ ] **Step 4：重新运行 persistence-layer 测试**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/core/app/workflow/test_persistence_layer.py -q
```

预期：

```text
... passed
```

- [ ] **Step 5：提交 persistence 检查点**

```bash
git add api/core/app/workflow/layers/persistence.py \
        api/tests/unit_tests/core/app/workflow/test_persistence_layer.py
git commit -m "feat: enqueue parent trace context for workflow traces"
```

## Task 5：做聚焦回归验证并最终提交

**文件：**
- 修改：none

- [ ] **Step 1：运行这次补丁相关的完整聚焦测试集**

运行：

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/helper/test_trace_id_helper.py \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py \
  api/tests/unit_tests/core/app/apps/test_workflow_app_generator.py \
  api/tests/unit_tests/core/app/workflow/test_persistence_layer.py -q
```

预期：

```text
all selected tests pass
```

- [ ] **Step 2：再跑现有 Phoenix 定向回归**

运行：

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

预期：

```text
all selected tests pass
```

- [ ] **Step 3：人工验证日志信号**

跑一轮本地 workflow-as-tool debugging 场景，确认 Phoenix 诊断日志从：

```text
parent_workflow_run_id=None parent_node_execution_id=None
```

变成：

```text
parent_workflow_run_id=<outer workflow run id> parent_node_execution_id=<outer node execution id>
```

- [ ] **Step 4：创建最终实现提交**

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

- Spec 覆盖范围：这份计划只覆盖我们刚确认的上游缺口，也就是 workflow-as-tool 的 parent context 生产与透传；不扩展到 Phoenix UI 展示或 synthetic root 行为。
- Placeholder 扫描：没有保留 TBD/TODO；每个任务都给了明确文件、命令和代码片段。
- 类型一致性：透传 payload 使用的正是 `resolved_parent_context` 现有消费的两个 key：
  - `parent_workflow_run_id`
  - `parent_node_execution_id`
