# Phoenix Trace Review 修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 修复 Phoenix tracing 审查问题，同时不改变用户可见的 nested workflow trace 行为。

**架构：** 将 retry signaling 移到 `core.ops`，将 workflow-tool parent context 从公开 tool runtime parameters 移到私有路径，并在 ops trace payload 中持久化 retry-local enterprise dispatch 状态。Phoenix parent span Redis coordination 当前继续保持 provider-local，但用明确注释记录未来抽象边界。

**技术栈：** Python、Celery、Pydantic、pytest、Dify workflow tool runtime、Phoenix OpenTelemetry provider。

---

## 文件结构

- 修改：`api/core/workflow/node_runtime.py`
  - 在 `_WorkflowToolRuntimeBinding` 上保存 workflow parent trace context。
  - 通过私有 invocation path 把 context 传给 `WorkflowTool`，不再写 `runtime_parameters`。
- 修改：`api/core/tools/workflow_as_tool/tool.py`
  - 增加私有 parent trace context setter 或 invocation helper。
  - 从私有 context 构建 generator args，不再从 `runtime.runtime_parameters` 读取。
- 新增：`api/core/ops/exceptions.py`
  - 定义 core retryable trace dispatch exceptions。
- 修改：`api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
  - raise core pending-parent exception。
  - 添加 provider-local coordination 注释。
- 修改：`api/tasks/ops_trace_task.py`
  - catch core pending-parent exception。
  - retry 前持久化 `_enterprise_trace_dispatched`。
  - retry attempt 中如果 flag 已存在，则跳过 enterprise dispatch。
- 修改测试：
  - `api/tests/unit_tests/core/workflow/test_node_runtime.py`
  - `api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py`
  - `api/tests/unit_tests/tasks/test_ops_trace_task.py`
  - `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
  - `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

---

### Task 1: 将 Workflow Tool Parent Context 移出 Runtime Parameters

**文件：**
- 修改：`api/core/workflow/node_runtime.py`
- 修改：`api/core/tools/workflow_as_tool/tool.py`
- 测试：`api/tests/unit_tests/core/workflow/test_node_runtime.py`
- 测试：`api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py`

- [ ] **Step 1: 添加用户输入冲突的失败测试**

在 `api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py` 中添加测试，证明用户 input 使用旧内部 key 名时不会被覆盖：

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

同时更新现有 parent context 测试：改成调用 `tool.set_parent_trace_context(...)`，不要直接写 `tool.runtime.runtime_parameters`。

- [ ] **Step 2: 运行 focused failing tests**

运行：

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py::test_workflow_tool_keeps_user_inputs_named_like_trace_runtime_keys \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py::test_workflow_tool_passes_parent_trace_context_from_runtime \
  -q
```

预期实现前结果：新测试失败，因为 `WorkflowTool` 还没有私有 setter，或者 parent context 仍然来自 `runtime_parameters`。

- [ ] **Step 3: 给 `WorkflowTool` 添加私有 context storage**

在 `api/core/tools/workflow_as_tool/tool.py` 的 `__init__` 中添加属性：

```python
self._parent_trace_context: dict[str, str] | None = None
```

在 `WorkflowTool` 上添加方法：

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

更新 `fork_tool_runtime()`，复制这个私有 context：

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

更新 `_invoke()`，移除 `runtime_parameters` lookup，改用私有 context：

```python
generator_args: dict[str, Any] = {"inputs": tool_parameters, "files": files}
if self._parent_trace_context:
    generator_args.update(
        extract_parent_trace_context_from_args({"parent_trace_context": self._parent_trace_context})
    )
```

- [ ] **Step 4: 更新 `DifyToolNodeRuntime` binding**

在 `api/core/workflow/node_runtime.py` 中扩展 `_WorkflowToolRuntimeBinding`：

```python
parent_trace_context: dict[str, str] | None = None
```

在 `get_runtime()` 中，为 workflow provider 构建局部 `parent_trace_context` dict，不再 mutate `tool_runtime.runtime.runtime_parameters`。

返回 binding 时：

```python
return ToolRuntimeHandle(
    raw=_WorkflowToolRuntimeBinding(
        tool=tool_runtime,
        conversation_id=conversation_id,
        parent_trace_context=parent_trace_context,
    )
)
```

在 `invoke()` 中，调用 `ToolEngine.generic_invoke(...)` 前，只对 workflow tool 安装 context：

```python
if runtime_binding.parent_trace_context and hasattr(tool, "set_parent_trace_context"):
    tool.set_parent_trace_context(
        parent_workflow_run_id=runtime_binding.parent_trace_context["parent_workflow_run_id"],
        parent_node_execution_id=runtime_binding.parent_trace_context["parent_node_execution_id"],
    )
```

- [ ] **Step 5: 更新 node runtime 测试**

在 `api/tests/unit_tests/core/workflow/test_node_runtime.py` 中，把对 `runtime_tool.runtime.runtime_parameters` 的断言改成检查 binding：

```python
assert handle.raw.parent_trace_context == {
    "parent_workflow_run_id": "outer-workflow-run-id",
    "parent_node_execution_id": "node-execution-id",
}
assert runtime_tool.runtime.runtime_parameters == {}
```

测试调用中加入 `node_execution_id="node-execution-id"`。

- [ ] **Step 6: 运行 focused tests**

运行：

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/workflow/test_node_runtime.py \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py \
  -q
```

预期：PASS。

---

### Task 2: 将 Pending-Parent Retry Exception 移到 Core

**文件：**
- 新增：`api/core/ops/exceptions.py`
- 修改：`api/tasks/ops_trace_task.py`
- 修改：`api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- 修改所有 import `PendingPhoenixParentSpanContextError` 的测试

- [ ] **Step 1: 添加 core exception**

创建 `api/core/ops/exceptions.py`：

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

- [ ] **Step 2: 更新 imports 和 raises**

在 `api/tasks/ops_trace_task.py` 中，把 Phoenix import 替换为：

```python
from core.ops.exceptions import PendingTraceParentContextError
```

catch `PendingTraceParentContextError`。

在 `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py` 中，import core exception，并删除 provider-local 的 `PendingPhoenixParentSpanContextError` class。改为 raise `PendingTraceParentContextError(parent_node_execution_id)`。

- [ ] **Step 3: 更新测试**

把测试里的 `PendingPhoenixParentSpanContextError` import 替换为：

```python
from core.ops.exceptions import PendingTraceParentContextError
```

构造 exception 时同步替换类名。

- [ ] **Step 4: 运行 focused tests**

运行：

```bash
uv run --project api pytest \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  -q
```

预期：更新 import 后 PASS。

---

### Task 3: 防止 Phoenix Retry 重复发送 Enterprise Trace

**文件：**
- 修改：`api/tasks/ops_trace_task.py`
- 测试：`api/tests/unit_tests/tasks/test_ops_trace_task.py`

- [ ] **Step 1: 添加 retry-state 测试**

在 `api/tests/unit_tests/tasks/test_ops_trace_task.py` 中添加一个测试：enterprise telemetry enabled，provider dispatch raise `PendingTraceParentContextError`，并断言 `storage.save` 在 retry raise 前收到包含 `_enterprise_trace_dispatched: true` 的 payload。

再添加一个测试：loaded payload 已经包含 `_enterprise_trace_dispatched: true`，断言 `EnterpriseOtelTrace().trace(...)` 不会被调用，provider dispatch 仍然执行。

- [ ] **Step 2: 运行测试并确认失败**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

预期实现前结果：新测试失败，因为 retry state 尚未持久化，也没有跳过 enterprise trace。

- [ ] **Step 3: 持久化 enterprise dispatch state**

在 `api/tasks/ops_trace_task.py` 加载 `file_data` 后读取：

```python
enterprise_trace_dispatched = bool(file_data.get("_enterprise_trace_dispatched"))
```

包裹 enterprise dispatch：

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

在 pending-parent exception branch 中，调度 retry 前持久化更新后的 payload：

```python
storage.save(file_path, json.dumps(file_data))
```

然后再调用 `self.retry(...)`。

- [ ] **Step 4: 运行 task tests**

运行：

```bash
uv run --project api pytest api/tests/unit_tests/tasks/test_ops_trace_task.py -q
```

预期：PASS。

---

### Task 4: 记录 Phoenix-Local Coordination 边界

**文件：**
- 修改：`api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`

- [ ] **Step 1: 在 Redis helper 附近添加注释**

在 `_PHOENIX_PARENT_SPAN_CONTEXT_TTL_SECONDS` 上方或 `_publish_parent_span_context` 上方添加：

```python
# This parent-span carrier store is intentionally Phoenix-local for the current
# nested workflow tracing feature. If other trace providers need the same
# cross-task parent restoration behavior, move the storage and retry signaling
# behind a core trace coordination interface instead of duplicating it here.
```

- [ ] **Step 2: 运行 Phoenix provider tests**

运行：

```bash
uv run --project api pytest \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  -q
```

预期：PASS。

---

### Task 5: 最终验证和提交

**文件：**
- Tasks 1-4 中所有修改文件。

- [ ] **Step 1: 运行 combined focused suite**

运行：

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/workflow/test_node_runtime.py \
  api/tests/unit_tests/core/tools/workflow_as_tool/test_tool.py \
  api/tests/unit_tests/tasks/test_ops_trace_task.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py \
  api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py \
  -q
```

预期：PASS。

- [ ] **Step 2: 检查 diff**

运行：

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

预期：diff 只包含本计划描述的 review fixes 和 tests。

- [ ] **Step 3: 提交**

运行：

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
