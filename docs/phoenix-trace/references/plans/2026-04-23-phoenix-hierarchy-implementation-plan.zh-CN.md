# Phoenix Hierarchy 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改上游 tracing builder 和 contract 的前提下，只在 Phoenix tracing provider 内重新实现 hierarchy 改进，并保证 canonical root 正确性。

**Architecture:** 所有生产代码改动都收敛在 `arize_phoenix_trace.py` 所在的 Phoenix provider 包中。优先复用上游已经存在的 `resolved_trace_id`、`parent_trace_context`、`resolved_parent_context` 等语义，再在 Phoenix 侧补上 workflow 内部 hierarchy 重建、session fallback、以及 canonical-root-safe 的 parent 选择逻辑。

**Tech Stack:** Python 3.12、Pydantic trace entities、OpenTelemetry spans、OpenInference span attributes、pytest、unittest.mock、Dify workflow repositories

---

## 文件结构

### 生产文件

- 修改：`api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
  责任：
  - 增加 Phoenix-local 的 hierarchy helper
  - 保证 workflow root span 的 canonical-root-safe 创建方式
  - 复用上游 cross-workflow parent context
  - 增加 session fallback 解析
  - 通过 comment 标注未来上移目标

### 测试文件

- 修改：`api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
  责任：
  - 覆盖 workflow root span 创建
  - 覆盖 session fallback 行为
  - 覆盖 nested workflow parent 复用
  - 覆盖串行、branch、loop、iteration 的 hierarchy 重建

- 修改：`api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
  责任：
  - 为新增的纯 helper 保持轻量级测试
  - 补充 `arize_phoenix_trace.py` 中纯函数的单元测试

### 仅在主文件明显失控时才允许新增

- 创建：`api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/hierarchy.py`
  责任：
  - 如果 `arize_phoenix_trace.py` 过于臃肿，再把纯 hierarchy helper 抽出来

除非在实现过程中 `arize_phoenix_trace.py` 的可读性明显失控，否则不要创建这个新文件。

## Task 1: 先用失败测试锁定 Root 与 Session 预期

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: 先写 canonical root 和 session fallback 的失败测试**

新增测试，明确断言：

- 顶层 workflow span 必须以真正 root context 启动，不能伪造 parent
- 当 `conversation_id` 缺失时，workflow 的 session 应回退到 `workflow_run_id`
- message trace 仍然使用 `conversation_id`

测试代码按这个形状写：

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

- [ ] **Step 2: 运行 provider 测试文件，确认这些新测试先失败**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

Expected:

- FAIL，因为当前 workflow tracing 还是 `conversation_id or ""`
- FAIL，因为后续 hierarchy 断言尚未实现

- [ ] **Step 3: 提交失败测试检查点**

```bash
git add api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
git commit -m "test: define phoenix root and session expectations"
```

## Task 2: 给 Phoenix Provider 增加 Session 与 Parent 解析 Helper

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`

- [ ] **Step 1: 先为纯 helper 写失败测试**

为纯解析逻辑新增测试：

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

- [ ] **Step 2: 运行 helper 测试并确认失败**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
```

Expected:

- FAIL，因为这些 helper 还不存在

- [ ] **Step 3: 在 Phoenix provider 中补最小 helper 实现**

在 `_get_node_span_kind` 附近加入这些小型纯 helper：

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

在 session helper 上方增加 comment：

```python
# Temporary Phoenix-local session fallback.
# Future direction: move standardized session semantics upstream once the shared tracing contract is extended.
```

- [ ] **Step 4: 运行 helper 测试并确认通过**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
```

Expected:

- 新增 helper 测试 PASS

- [ ] **Step 5: 提交 helper 阶段改动**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py
git commit -m "feat: add phoenix-local session resolution helpers"
```

## Task 3: 让顶层 Workflow Root 变成 Canonical Root，并复用 Cross-Workflow Parent Context

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: 先补 nested workflow parent 复用的失败测试**

新增测试，明确断言：

- 顶层 workflow 应直接使用 root context
- nested workflow 应通过上游 parent context 挂到 outer tool span 下

示例：

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

- [ ] **Step 2: 运行 workflow trace 测试并确认失败**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q -k "workflow_trace"
```

Expected:

- FAIL，因为 `_build_nested_workflow_context` 还不存在
- FAIL，因为当前没有 root / nested 的上下文分流

- [ ] **Step 3: 实现 canonical-root-safe 的 workflow span context 选择逻辑**

重构 `workflow_trace`，做到：

- 顶层 workflow 使用 `ensure_root_span` 提取出的 root context
- nested workflow 使用基于 `resolved_parent_context` 的专用 helper
- 顶层 workflow span 不再拥有合成 parent

实现形状：

```python
def _select_workflow_span_context(self, trace_info: WorkflowTraceInfo):
    trace_override, parent_span_id_source = trace_info.resolved_parent_context
    if trace_override and parent_span_id_source:
        return self._build_nested_workflow_context(trace_info)
    self.ensure_root_span(trace_info.resolved_trace_id or trace_info.workflow_run_id)
    return self.propagator.extract(carrier=self.carrier)
```

在 helper 附近加 comment：

```python
# Temporary Phoenix-local parent selection.
# Future direction: consume normalized hierarchy metadata from upstream instead of rebuilding context here.
```

- [ ] **Step 4: 更新 workflow session 赋值逻辑，改为使用 helper**

把：

```python
SpanAttributes.SESSION_ID: trace_info.conversation_id or "",
```

替换成：

```python
SpanAttributes.SESSION_ID: _resolve_workflow_session_id(
    workflow_run_id=trace_info.workflow_run_id,
    conversation_id=trace_info.conversation_id,
    metadata=metadata,
    nested_parent_session_id=self._resolve_parent_session_id(trace_info),
),
```

- [ ] **Step 5: 再次运行 workflow trace 测试并确认通过**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q -k "workflow_trace or message_trace"
```

Expected:

- root context 与 session fallback 相关测试 PASS

- [ ] **Step 6: 提交 root 与 nested parent 阶段**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py
git commit -m "feat: reuse upstream parent context in phoenix workflow traces"
```

## Task 4: 为支持的节点类型构建 Workflow 内部 Hierarchy Helper

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`

- [ ] **Step 1: 先为纯 hierarchy helper 写失败测试**

为 parent 解析 helper 新增测试：

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

- [ ] **Step 2: 运行 helper 测试并确认失败**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
```

Expected:

- FAIL，因为 hierarchy helper 尚未实现

- [ ] **Step 3: 增加最小纯 helper 实现**

在 `arize_phoenix_trace.py` 中加入：

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

- [ ] **Step 4: 再运行 helper 测试并确认通过**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py -q
```

Expected:

- 新增 hierarchy helper 测试 PASS

- [ ] **Step 5: 提交 hierarchy helper 阶段**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py
git commit -m "feat: add phoenix hierarchy helper primitives"
```

## Task 5: 把串行、Branch、Loop、Iteration 节点挂到解析出的 Parent 上

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: 先写串行和结构化节点 parenting 的失败测试**

构造 mocked node executions，覆盖：

- 串行链路：`start -> llm -> end`
- branch：`if-else -> llm_selected -> end`
- loop：`loop -> tool(iteration 0) -> assigner(iteration 0) -> end`
- iteration：`iteration -> tool(iteration 0) -> tool(iteration 1)`

在测试前，先把这些局部 helper 一起写进同一个测试文件，避免后续执行计划时还要自己补全上下文：

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

断言形状如下：

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

- [ ] **Step 2: 运行 workflow trace 测试并确认失败**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q -k "serial or loop or iteration or branch"
```

Expected:

- FAIL，因为当前所有 node span 都挂在 workflow span 下

- [ ] **Step 3: 用解析出的 parent context 替换当前平铺 parenting**

把 `workflow_trace` 中这段：

```python
workflow_span_context = set_span_in_context(workflow_span)
node_span = self.tracer.start_span(..., context=workflow_span_context)
```

替换成：

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

同时补充 comment，明确说明：

- 这是过渡性的 Phoenix-local hierarchy reconstruction
- execution-order heuristic 故意不作为主规则
- 未来上游若提供标准 hierarchy metadata，应移除这段本地重建逻辑

- [ ] **Step 4: 为 `start`、`end`、`loop`、`iteration` 加入窄范围特殊规则**

先保持最小规则，不要引入大量 heuristic：

```python
if node_execution.node_type == "start":
    parent_span = workflow_span
elif node_execution.node_type == "end" and parent_span is workflow_span:
    parent_span = workflow_span
elif node_execution.node_type in {"loop", "iteration"}:
    parent_span = parent_span
```

这里的目标不是先做复杂逻辑，而是给结构化节点留下稳定的扩展点，同时避免退回“谁最近执行就挂谁”的模型。

- [ ] **Step 5: 运行 workflow provider 测试并确认通过**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

Expected:

- 新增的串行与结构化 hierarchy 测试 PASS

- [ ] **Step 6: 提交 node-parenting 阶段**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
git commit -m "feat: reconstruct phoenix workflow node hierarchy"
```

## Task 6: 覆盖 Nested Workflow Session 继承与回归场景

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
- Test: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`

- [ ] **Step 1: 先为 nested session inheritance 和非支持场景写回归测试**

新增测试，断言：

- nested workflow 会继承 outer session identity
- workflow-only 场景下 node spans 不再写入空 session 字符串
- `parallel` 暂不做特殊建模，但 fallback 行为不能炸

示例：

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

- [ ] **Step 2: 运行 provider 测试并确认失败**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q -k "session or parallel"
```

Expected:

- FAIL，直到 nested session inheritance 实现完成

- [ ] **Step 3: 实现最小回归修复**

把 workflow session helper 扩展为只在 fallback 路径读取 parent metadata，不重定义上游语义：

```python
def _resolve_parent_session_id(self, trace_info: WorkflowTraceInfo) -> str | None:
    parent_ctx = trace_info.metadata.get("parent_trace_context")
    if not isinstance(parent_ctx, dict):
        return None
    session_id = parent_ctx.get("session_id")
    return session_id if isinstance(session_id, str) and session_id else None
```

同时用 comment 明确 `parallel` 的边界：

```python
# V1 deliberately does not model parallel branches as distinct hierarchy structures.
# Unsupported concurrent shapes safely fall back to workflow-root-compatible parenting.
```

- [ ] **Step 4: 再次运行 provider 测试并确认通过**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py -q
```

Expected:

- nested session inheritance 与 fallback 回归测试 PASS

- [ ] **Step 5: 提交回归覆盖**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py
git commit -m "test: cover phoenix session inheritance and fallbacks"
```

## Task 7: 最终验证与代码审查收口

**Files:**
- Modify: `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py`
- Modify: `api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py`

- [ ] **Step 1: 运行 Phoenix provider 全量单测**

Run:

```bash
uv run --project api pytest api/providers/trace/trace-arize-phoenix/tests/unit_tests -q
```

Expected:

- PASS

- [ ] **Step 2: 运行 enterprise telemetry 的目标回归测试**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/enterprise/telemetry/test_enterprise_trace.py -q
```

Expected:

- PASS，证明 Phoenix 侧变更没有要求同步改上游 enterprise telemetry

- [ ] **Step 3: 跑后端格式化和 lint**

Run:

```bash
make format
make lint
```

Expected:

- format 完成且不改动无关文件
- lint PASS

- [ ] **Step 4: 在最终 commit 前执行手工检查清单**

通过阅读最终 diff，确认：

- 顶层 workflow/chatflow root span 不再拥有伪造 parent
- nested workflow span 只复用上游 parent context
- workflow node spans 不再全部直接挂到 workflow span
- comment 明确标出了临时 Phoenix-local 逻辑与未来上移方向
- 生产代码没有改出 Phoenix provider 包之外

- [ ] **Step 5: 创建最终实现 commit**

```bash
git add api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/arize_phoenix_trace/test_arize_phoenix_trace.py api/providers/trace/trace-arize-phoenix/tests/unit_tests/test_arize_phoenix_trace.py
git commit -m "feat: improve phoenix hierarchy reconstruction"
```

- [ ] **Step 6: 补充 Phoenix 人工验证证据**

本地测试通过后，再用真实运行到 Phoenix 中核验：

- 顶层 workflow root 在 Phoenix 中显示为 canonical root
- session 视图可以正确解析 workflow 和 chatflow 的 root span
- nested workflow 挂在 outer tool span 下
- 串行节点能展示成 parent chain
- branch / loop / iteration 能展示成稳定、非平铺 hierarchy
- 不支持的 `parallel` 流程不会报错，至少能被安全查看

在合并前保留截图或查询响应作为证据。
