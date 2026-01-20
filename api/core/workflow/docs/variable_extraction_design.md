# Variable Extraction Design

从 `list[PromptMessage]` 类型变量中通过 LLM 调用提取参数值的功能设计。

---

## 1. 概述

### 1.1 背景

目前 LLM 节点会输出 `context`，它是 `list[dict]` 类型，保存了当前对话的 prompt messages（不含 system message）。

```python
# LLM Node outputs
outputs = {
    "text": "LLM response text",
    "context": [
        {"role": "user", "text": "user input", "files": []},
        {"role": "assistant", "text": "assistant response", "files": []},
    ],
    # ...
}
```

### 1.2 需求

允许其他节点（如工具节点）通过特殊语法引用 LLM 节点的 `context`，并附带一个 prompt，再次调用 LLM 来提取所需的参数值。

**使用场景示例**：

```
工具节点参数 = "@llm1.context | 提取关键词"

执行流程：
1. 获取 llm1 节点的 context（对话历史）
2. 将 context + 提取 prompt 组合成新的 prompt messages
3. 调用 LLM 获取提取结果
4. 将结果作为工具节点的参数值
```

### 1.3 节点组概念

当 Tool 节点使用了 `@llm1.context` 时，Tool 节点变成一个"节点组"：

```
┌─────────────────────────────────────────────────────┐
│   Tool 节点组 (tool1)                                │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Extraction 子节点 (tool1_ext_1)               │  │
│  │  - 有独立的 node_id                           │  │
│  │  - 有独立的日志和流式输出                      │  │
│  │  - 输出存入 variable_pool                     │  │
│  └───────────────────────────────────────────────┘  │
│                     │                               │
│                     ▼                               │
│  ┌───────────────────────────────────────────────┐  │
│  │  Tool 主节点 (tool1)                          │  │
│  │  - 使用 extraction 的输出作为参数             │  │
│  │  - 有自己的日志和输出                         │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 2. 现有调用链分析

### 2.1 Graph Engine 执行流程

```
GraphEngine.run()
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  WorkerPool                                                       │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Worker Thread                                              │  │
│  │                                                             │  │
│  │  Worker._execute_node(node)                                 │  │
│  │      │                                                      │  │
│  │      ├─ node.run()                                          │  │
│  │      │     │                                                │  │
│  │      │     ├─ yield NodeRunStartedEvent                     │  │
│  │      │     ├─ yield NodeRunStreamChunkEvent (多次)           │  │
│  │      │     └─ yield NodeRunSucceededEvent                   │  │
│  │      │                                                      │  │
│  │      └─ for event in node.run():                            │  │
│  │             event_queue.put(event)  ──────────────────────┐ │  │
│  │                                                           │ │  │
│  └───────────────────────────────────────────────────────────│─┘  │
└──────────────────────────────────────────────────────────────│────┘
                                                               │
        ┌──────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  Dispatcher Thread                                                │
│                                                                   │
│  _dispatcher_loop():                                              │
│      while True:                                                  │
│          event = event_queue.get()                                │
│          event_handler.dispatch(event)                            │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│  EventHandler.dispatch(event)                                     │
│                                                                   │
│  ┌─ NodeRunStartedEvent ─────────────────────────────────────┐    │
│  │  → event_collector.collect(event)                         │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─ NodeRunStreamChunkEvent ─────────────────────────────────┐    │
│  │  → response_coordinator.intercept_event(event)            │    │
│  │  → event_collector.collect(stream_events)                 │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌─ NodeRunSucceededEvent ───────────────────────────────────┐    │
│  │  → _store_node_outputs(node_id, outputs)                  │    │
│  │       └─ variable_pool.add((node_id, var_name), value)    │    │
│  │  → response_coordinator.intercept_event(event)            │    │
│  │  → edge_processor.process_node_success(node_id)           │    │
│  │       └─ ready_queue.put(next_nodes)                      │    │
│  └───────────────────────────────────────────────────────────┘    │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 关键点

1. **事件驱动**：节点通过 yield 事件与引擎通信
2. **Variable Pool 写入时机**：在 `NodeRunSucceededEvent` 处理时，outputs 被写入 variable_pool
3. **事件收集**：所有事件都通过 `event_collector.collect()` 收集，最终返回给调用方

---

## 3. 节点内嵌子节点设计

### 3.1 设计原则

**核心思想**：虚拟节点本质上就是一个完整的节点（如 LLM 节点），应该用完整的节点配置来定义，而不是把配置塞到其他地方。

**方案**：在节点配置中添加 `virtual_nodes` 字段，定义该节点依赖的子节点列表。子节点是完整的节点定义，执行时先执行子节点，再执行主节点。

### 3.2 DSL 设计

```yaml
nodes:
  - id: tool1
    type: tool
    data:
      # 虚拟子节点列表 - 完整的节点定义
      virtual_nodes:
        - id: ext_1                      # 局部 ID，实际会变成 tool1.ext_1
          type: llm                      # 就是一个完整的 LLM 节点！
          data:
            title: "提取关键词"
            model:
              provider: openai
              name: gpt-4o-mini
              mode: chat
            prompt_template:
              - role: user
                text: "{{#llm1.context#}}"   # 引用上游 context
              - role: user
                text: "请提取关键词，只返回关键词本身"

      # 主节点参数引用子节点输出
      tool_parameters:
        query:
          type: variable
          value: [ext_1, text]           # 引用子节点输出
```

### 3.3 完整示例

```yaml
nodes:
  # 上游 LLM 节点
  - id: llm1
    type: llm
    data:
      model:
        provider: openai
        name: gpt-4
      prompt_template:
        - role: user
          text: "{{#start.query#}}"

  # Tool 节点 - 包含虚拟子节点
  - id: tool1
    type: tool
    data:
      # 子节点列表
      virtual_nodes:
        - id: ext_1
          type: llm
          data:
            title: "提取搜索关键词"
            model:
              provider: openai
              name: gpt-4o-mini
            prompt_template:
              - role: user
                text: "{{#llm1.context#}}"
              - role: user
                text: "请从对话中提取用户想要搜索的关键词"

        - id: ext_2
          type: llm
          data:
            title: "提取搜索范围"
            model:
              provider: openai
              name: gpt-4o-mini
            prompt_template:
              - role: user
                text: "{{#llm1.context#}}"
              - role: user
                text: "请提取用户想要的搜索范围（如：最近一周）"

      # 主节点配置
      tool_name: google_search
      tool_parameters:
        query:
          type: variable
          value: [ext_1, text]          # 引用子节点 ext_1 的输出
        time_range:
          type: variable
          value: [ext_2, text]          # 引用子节点 ext_2 的输出
        limit:
          type: constant
          value: 10
```

### 3.4 子节点 ID 规则

子节点的局部 ID 会被转换为全局 ID：

| 局部 ID | 父节点 ID | 全局 ID |
|---------|-----------|---------|
| `ext_1` | `tool1` | `tool1.ext_1` |
| `ext_2` | `tool1` | `tool1.ext_2` |

子节点引用使用局部 ID：`[ext_1, text]`

### 3.5 实体定义

```python
# core/workflow/entities/virtual_node.py

from pydantic import BaseModel
from typing import Any


class VirtualNodeConfig(BaseModel):
    """Configuration for a virtual sub-node"""

    # Local ID within parent node (e.g., "ext_1")
    id: str

    # Node type (e.g., "llm", "code")
    type: str

    # Full node data configuration
    data: dict[str, Any]


# core/workflow/nodes/base/entities.py

class BaseNodeData(BaseModel):
    """Base class for all node data"""

    title: str
    desc: str | None = None
    # ... existing fields ...

    # Virtual sub-nodes
    virtual_nodes: list[VirtualNodeConfig] = []
```

### 3.6 支持的节点类型

以下节点需要输出 `context` 变量以支持 extraction：

| 节点类型            | NodeType                       | context 来源            | 模型配置位置                       |
| ------------------- | ------------------------------ | ----------------------- | ---------------------------------- |
| LLM                 | `NodeType.LLM`                 | 已实现 `_build_context` | `node_data.model`                  |
| Agent               | `NodeType.AGENT`               | 需要添加                | `agent_parameters` 中的 model 参数 |
| Question Classify   | `NodeType.QUESTION_CLASSIFIER` | 需要添加                | `node_data.model`                  |
| Parameter Extractor | `NodeType.PARAMETER_EXTRACTOR` | 需要添加                | `node_data.model`                  |

**context 结构**（统一格式）：

```python
context = [
    {"role": "user", "text": "用户输入", "files": []},
    {"role": "assistant", "text": "模型回复", "files": []},
]
```

---

## 4. 执行流程

### 4.1 节点内嵌子节点执行流程

```
Tool 节点组执行
    │
    ├─ node.run() 被调用
    │
    ├─ Step 1: 执行虚拟子节点
    │  │
    │  │  遍历 node_data.virtual_nodes
    │  │
    │  │  ┌─────────────────────────────────────────────────────────┐
    │  │  │  虚拟节点 (tool1.ext_1)                                 │
    │  │                                                         │
    │  │  yield NodeRunStartedEvent (tool1_ext_1, type=LLM)      │
    │  │  yield NodeRunStreamChunkEvent (tool1_ext_1, chunk)     │
    │  │  yield NodeRunSucceededEvent (tool1_ext_1, outputs)     │
    │  │                                                         │
    │  │  → variable_pool.add((tool1_ext_1, "text"), result)     │
    │  └─────────────────────────────────────────────────────────┘
    │
    ├─ Tool 参数解析：使用 {{#tool1_ext_1.text#}} 替代原 @llm1.context
    │
    │  ┌─────────────────────────────────────────────────────────┐
    │  │  Tool 主节点 (tool1)                                    │
    │  │                                                         │
    │  │  yield NodeRunStartedEvent (tool1)                      │
    │  │  yield NodeRunStreamChunkEvent (tool1, tool output)     │
    │  │  yield NodeRunSucceededEvent (tool1, outputs)           │
    │  └─────────────────────────────────────────────────────────┘
    │
    └─ 完成
```

**优点**：

- 虚拟节点有独立的 node_id，有独立的日志
- 虚拟节点的 outputs 存入 variable_pool，可被其他节点引用
- UI 可以清晰展示两个独立的执行过程

**缺点**：

- 实现稍复杂
- 需要处理虚拟节点的 ID 生成和关联

### 4.2 推荐方案：思路 B

采用虚拟节点方案，因为：

1. 符合你说的"节点组"概念
2. 两个调用都有独立的日志和输出
3. 更清晰的执行边界

### 4.3 执行位置选择

在节点 \_run() 方法开始时（推荐）

```python
# tool_node.py
def _run(self) -> Generator[NodeEventBase, None, None]:
    # Step 1: 预处理 - 执行所有 extraction
    extraction_results = yield from self._process_extractions()

    # Step 2: 使用 extraction 结果生成参数
    parameters = self._generate_parameters(extraction_results)

    # Step 3: 执行 tool 调用
    ...
```

**优点**：

- 可以 yield 事件
- 在节点控制范围内
- 清晰的执行顺序

## 5. 详细执行流程

### 5.1 完整调用链

用户定义的 Tool 节点参数（结构化配置）：

```yaml
# Tool 节点配置
- id: tool1
  type: tool
  data:
    tool_name: google_search
    inputs:
      # extraction 类型输入
      - name: query
        type: extraction
        value:
          source_node_id: llm1
          source_variable: context
          extraction_prompt: "提取关键词"
          # model 不指定，自动继承 llm1 的模型配置
```

执行流程：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Worker Thread                                                              │
│                                                                             │
│  Worker._execute_node(tool_node)                                            │
│      │                                                                      │
│      └─ for event in tool_node.run():                                       │
│              event_queue.put(event)                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  ToolNode.run()                                                             │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Step 1: 预处理 - 发现并执行 extractions                                 │  │
│  │                                                                       │  │
│  │  yield from self._process_extractions()                               │  │
│  │      │                                                                │  │
│  │      ├─ 解析参数，发现 type=extraction 的 input                         │  │
│  │      │                                                                │  │
│  │      ├─ 创建虚拟节点 ID: "tool1_ext_1"                                  │  │
│  │      │                                                                │  │
│  │      ├─ yield NodeRunStartedEvent(                                    │  │
│  │      │      node_id="tool1_ext_1",                                    │  │
│  │      │      node_type=NodeType.LLM,                                   │  │
│  │      │      node_title="Extraction: 提取关键词"                         │  │
│  │      │  )                                                             │  │
│  │      │                                                                │  │
│  │      ├─ 获取 llm1.context 并构建 prompt_messages                        │  │
│  │      │                                                                │  │
│  │      ├─ 调用 LLM (流式)                                               │  │
│  │      │      for chunk in llm_invoke():                                │  │
│  │      │          yield NodeRunStreamChunkEvent(                        │  │
│  │      │              node_id="tool1_ext_1",                            │  │
│  │      │              selector=["tool1_ext_1", "text"],                 │  │
│  │      │              chunk=chunk                                       │  │
│  │      │          )                                                     │  │
│  │      │                                                                │  │
│  │      ├─ yield NodeRunSucceededEvent(                                  │  │
│  │      │      node_id="tool1_ext_1",                                    │  │
│  │      │      outputs={"text": "关键词A, 关键词B"}                       │  │
│  │      │  )                                                             │  │
│  │      │                                                                │  │
│  │      └─ 返回 extraction_results = {"tool1_ext_1": "关键词A, 关键词B"}  │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Step 2: 主节点执行                                                    │  │
│  │                                                                       │  │
│  │  yield NodeRunStartedEvent(                                           │  │
│  │      node_id="tool1",                                                 │  │
│  │      node_type=NodeType.TOOL                                          │  │
│  │  )                                                                    │  │
│  │                                                                       │  │
│  │  parameters = _generate_parameters(extraction_results)                │  │
│  │  # param = "关键词A, 关键词B"                                          │  │
│  │                                                                       │  │
│  │  tool.invoke(parameters)                                              │  │
│  │      for chunk in tool_output:                                        │  │
│  │          yield NodeRunStreamChunkEvent(                               │  │
│  │              node_id="tool1",                                         │  │
│  │              selector=["tool1", "text"],                              │  │
│  │              chunk=chunk                                              │  │
│  │          )                                                            │  │
│  │                                                                       │  │
│  │  yield NodeRunSucceededEvent(                                         │  │
│  │      node_id="tool1",                                                 │  │
│  │      outputs={"text": "tool output..."}                               │  │
│  │  )                                                                    │  │
│  │                                                                       │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Dispatcher Thread                                                          │
│                                                                             │
│  收到事件序列:                                                               │
│                                                                             │
│  1. NodeRunStartedEvent(node_id="tool1_ext_1")                              │
│     → event_collector.collect()                                             │
│                                                                             │
│  2. NodeRunStreamChunkEvent(node_id="tool1_ext_1", chunk="关键词")           │
│     → response_coordinator → event_collector.collect()                      │
│                                                                             │
│  3. NodeRunSucceededEvent(node_id="tool1_ext_1", outputs={...})             │
│     → _store_node_outputs("tool1_ext_1", outputs)                           │
│       └─ variable_pool.add(("tool1_ext_1", "text"), "关键词A, 关键词B")      │
│     → event_collector.collect()                                             │
│     注意：不触发 edge_processor，因为这是虚拟节点                            │
│                                                                             │
│  4. NodeRunStartedEvent(node_id="tool1")                                    │
│     → event_collector.collect()                                             │
│                                                                             │
│  5. NodeRunStreamChunkEvent(node_id="tool1", chunk="tool output")           │
│     → response_coordinator → event_collector.collect()                      │
│                                                                             │
│  6. NodeRunSucceededEvent(node_id="tool1", outputs={...})                   │
│     → _store_node_outputs("tool1", outputs)                                 │
│     → edge_processor.process_node_success("tool1")                          │
│       └─ ready_queue.put(next_nodes)                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 关键问题：虚拟节点的事件处理

虚拟节点（如 `tool1_ext_1`）的事件需要特殊处理：

```python
# EventHandler 需要区分虚拟节点和真实节点
def _(self, event: NodeRunSucceededEvent) -> None:
    # 存储输出到 variable_pool（虚拟节点也需要）
    self._store_node_outputs(event.node_id, event.node_run_result.outputs)

    # 检查是否是虚拟节点（通过 node_id 格式判断：包含 _ext_）
    if self._is_virtual_node(event.node_id):
        # 虚拟节点不触发边处理，只收集事件
        self._event_collector.collect(event)
        return

    # 真实节点：触发边处理，推进工作流
    ready_nodes = self._edge_processor.process_node_success(event.node_id)
    ...

def _is_virtual_node(self, node_id: str) -> bool:
    """Check if node_id represents a virtual extraction node."""
    return "_ext_" in node_id
```

### 5.3 虚拟节点 ID 命名规则

```python
def _generate_extraction_node_id(
    parent_node_id: str,
    extraction_index: int,
) -> str:
    """
    Generate unique ID for extraction virtual node.

    Format: {parent_node_id}_ext_{index}
    Example: tool1_ext_1, tool1_ext_2
    """
    return f"{parent_node_id}_ext_{extraction_index}"
```

### 5.4 ExtractionExecutor 详细设计

**设计原则**：

1. **直接实例化并运行 LLMNode**：创建真正的 LLMNode 实例并调用 `run()`
2. **完全复用节点逻辑**：LLMNode 的 `_run()`、Node 基类的 `run()` 和异常处理全部复用
3. **通过重新实例化实现重试**：失败时重新创建 LLMNode 实例并再次运行
4. **自动获得所有能力**：token 统计、流式输出、完整的 NodeRunResult 格式

```python
# core/workflow/nodes/base/extraction_executor.py

class ExtractionExecutor:
    """
    Executes LLM calls for extracting values from PromptMessage-type variables.

    This executor directly instantiates LLMNode instances, fully reusing:
    - LLMNode's _run() logic
    - Node base class's run() method and exception handling
    - All events and token statistics

    Retry is implemented at this level by re-instantiating and re-running the node.
    """

    def __init__(
        self,
        *,
        variable_pool: VariablePool,
        graph_config: Mapping[str, Any],
        graph_init_params: GraphInitParams,
        graph_runtime_state: GraphRuntimeState,
        parent_node_id: str,
        parent_retry_config: RetryConfig | None = None,
    ):
        # Store graph context for creating LLMNode instances
        self._graph_init_params = graph_init_params
        self._graph_runtime_state = graph_runtime_state
        # ...

    def _execute_single_extraction(
        self,
        spec: VariableExtractionSpec,
        ext_node_id: str,
    ) -> Generator[GraphNodeEventBase, None, str]:
        """
        Execute a single extraction by instantiating and running a real LLMNode.
        """
        # Create LLMNode instance with minimal config
        llm_node = self._create_llm_node(
            ext_node_id=ext_node_id,
            context=context,
            extraction_prompt=spec.extraction_prompt,
            model_config=model_config,
            spec=spec,
        )

        # Run the node and collect events - FULLY REUSES LLMNode's logic!
        for event in llm_node.run():
            # Mark events as virtual
            event = self._mark_event_as_virtual(event, spec)
                yield event

            if isinstance(event, NodeRunSucceededEvent):
                result_text = event.node_run_result.outputs.get("text", "")
            elif isinstance(event, NodeRunFailedEvent):
                raise LLMInvocationError(Exception(event.error))

            return result_text

    def _create_llm_node(self, ...) -> LLMNode:
        """
        Create a real LLMNode instance for extraction.
        Constructs minimal required configuration.
        """
        # Build prompt template from context + extraction prompt
        prompt_template = [...]  # LLMNodeChatModelMessage list

        # Create LLMNode with full graph context
        llm_node = LLMNode(
            id=ext_node_id,
            config=node_config,
            graph_init_params=self._graph_init_params,
            graph_runtime_state=self._graph_runtime_state,
        )
        return llm_node

    def _execute_with_retry(self, spec, ext_node_id) -> Generator[...]:
        """
        Retry by re-instantiating and re-running the LLMNode.
        """
        for attempt in range(retry_config.max_retries + 1):
            try:
                return (yield from self._execute_single_extraction(spec, ext_node_id))
            except Exception as e:
                if attempt < retry_config.max_retries:
                    yield NodeRunRetryEvent(...)
                    time.sleep(retry_config.retry_interval_seconds)
                    continue
                raise
```

---

## 6. 事件设计

### 6.1 复用现有事件类型

采用虚拟节点方案后，**不需要新增事件类型**。虚拟节点直接使用现有的：

- `NodeRunStartedEvent`
- `NodeRunStreamChunkEvent`
- `NodeRunSucceededEvent`
- `NodeRunFailedEvent`

**区分虚拟节点的方式**：在 `NodeRunStartedEvent` 中添加可选字段：

```python
# core/workflow/graph_events/node.py

class NodeRunStartedEvent(GraphNodeEventBase):
    node_title: str
    predecessor_node_id: str | None = None
    agent_strategy: AgentNodeStrategyInit | None = None
    start_at: datetime = Field(..., description="node start time")

    # Existing fields for ToolNode
    provider_type: str = ""
    provider_id: str = ""

    # NEW: Virtual node fields for extraction
    is_virtual: bool = False
    parent_node_id: str | None = None
    extraction_source: str | None = None  # e.g., "llm1.context"
    extraction_prompt: str | None = None
```

**字段说明**：

| 字段                | 类型          | 说明                           |
| ------------------- | ------------- | ------------------------------ |
| `is_virtual`        | `bool`        | 是否为虚拟节点，默认 `False`   |
| `parent_node_id`    | `str \| None` | 父节点 ID，如 `"tool1"`        |
| `extraction_source` | `str \| None` | 提取来源，如 `"llm1.context"`  |
| `extraction_prompt` | `str \| None` | 提取 prompt，如 `"提取关键词"` |

### 6.2 事件序列示例

前端收到的事件序列：

```
1. NodeRunStartedEvent
   - node_id: "tool1_ext_1"
   - node_type: NodeType.LLM
   - node_title: "Extraction: 提取关键词"
   - is_virtual: true
   - parent_node_id: "tool1"
   - extraction_source: "llm1.context"
   - extraction_prompt: "提取关键词"

2. NodeRunStreamChunkEvent
   - node_id: "tool1_ext_1"
   - selector: ["tool1_ext_1", "text"]
   - chunk: "关键词"

3. NodeRunSucceededEvent
   - node_id: "tool1_ext_1"
   - outputs: {"text": "关键词A, 关键词B"}

4. NodeRunStartedEvent
   - node_id: "tool1"
   - node_type: NodeType.TOOL
   - node_title: "Search Tool"
   - is_virtual: false

5. NodeRunStreamChunkEvent
   - node_id: "tool1"
   - selector: ["tool1", "text"]
   - chunk: "search result..."

6. NodeRunSucceededEvent
   - node_id: "tool1"
   - outputs: {"text": "..."}
```

### 6.3 前端展示建议

前端可以根据 `is_virtual` 和 `parent_node_id` 字段：

1. **嵌套展示**：将虚拟节点的输出显示在父节点内部
2. **分开展示**：作为独立的节点展示，但用 UI 标识关联关系
3. **折叠展示**：默认折叠虚拟节点，可展开查看详情

---

## 7. 日志与记录

### 7.1 虚拟节点的 NodeRunResult

虚拟节点有独立的 `NodeRunResult`，结构与普通 LLM 节点一致：

```python
NodeRunResult(
    status=WorkflowNodeExecutionStatus.SUCCEEDED,
    inputs={
        "context_source": "llm1.context",
        "extraction_prompt": "提取关键词",
    },
    process_data={
        "source": "llm1.context",
        "prompt": "提取关键词",
        "model_mode": "chat",
        "prompts": [
            {"role": "user", "text": "原始用户输入"},
            {"role": "assistant", "text": "原始助手回复"},
            {"role": "user", "text": "提取关键词"},
        ],
        "usage": {
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "total_tokens": 120,
        },
    },
    outputs={
        "text": "关键词A, 关键词B",
    },
    metadata={
        WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 120,
        WorkflowNodeExecutionMetadataKey.TOTAL_PRICE: 0.0001,
        WorkflowNodeExecutionMetadataKey.CURRENCY: "USD",
    },
    llm_usage=LLMUsage(
        prompt_tokens=100,
        completion_tokens=20,
        total_tokens=120,
    ),
)
```

### 7.2 父节点的 process_data

父节点（如 ToolNode）可以在 `process_data` 中记录关联的虚拟节点：

```python
process_data = {
    # ... existing fields
    "extraction_nodes": ["tool1_ext_1", "tool1_ext_2"],
}
```

### 7.3 数据库记录

虚拟节点的执行记录会被保存到 `workflow_node_executions` 表：

| 字段        | 值                                        |
| ----------- | ----------------------------------------- |
| `node_id`   | `"tool1_ext_1"`                           |
| `node_type` | `"llm"`                                   |
| `title`     | `"Extraction: 提取关键词..."`             |
| `inputs`    | `{"context_source": "llm1.context", ...}` |
| `outputs`   | `{"text": "关键词A, 关键词B"}`            |
| `status`    | `"succeeded"`                             |

前端可以通过 `node_id` 中的 `_ext_` 识别虚拟节点，并关联到父节点。

---

## 8. 集成示例

### 8.1 ToolNode 集成

```python
# core/workflow/nodes/tool/tool_node.py

from core.workflow.nodes.base.extraction_executor import ExtractionExecutor


class ToolNode(Node[ToolNodeData]):

    def _run(self) -> Generator[NodeEventBase, None, None]:
        # Step 1: 创建 ExtractionExecutor（传入父节点的 retry_config）
        extraction_executor = ExtractionExecutor(
            variable_pool=self.graph_runtime_state.variable_pool,
            graph_config=self.graph_config,
            graph_init_params=self._graph_init_params,
            graph_runtime_state=self.graph_runtime_state,
            parent_node_id=self._node_id,
            parent_retry_config=self.retry_config,  # 继承父节点的重试配置
        )

        # Step 2: 查找所有 extraction 类型的 inputs
        specs = extraction_executor.find_extractions(self.node_data.model_dump())

        # Step 3: 执行 extractions（yield 虚拟节点事件，包括重试事件）
        extraction_results: dict[str, str] = {}
        if specs:
            try:
            extraction_results = yield from extraction_executor.process_extractions(specs)
            except ExtractionError as e:
                # ExtractionExecutor 已 yield 了 NodeRunFailedEvent
                # 根据父节点的 error_strategy 决定如何处理
                if self.error_strategy == ErrorStrategy.DEFAULT_VALUE:
                    extraction_results = self._get_default_extraction_values(specs)
                else:
                    raise

        # Step 4: 生成参数（使用 extraction 结果作为对应 input 的值）
        parameters = self._generate_parameters_with_extractions(
            tool_parameters=tool_parameters,
            extraction_results=extraction_results,
        )

        # Step 5: 继续正常的 tool 调用流程...
        ...

    def _generate_parameters_with_extractions(
        self,
        *,
        tool_parameters: Sequence[ToolParameter],
        extraction_results: dict[str, str],  # input_name -> extracted_value
    ) -> dict[str, Any]:
        """Generate parameters, using extraction results for extraction-type inputs."""
        result: dict[str, Any] = {}

        for parameter_name, tool_input in self.node_data.tool_parameters.items():
            # Check if this input is an extraction type (result already in extraction_results)
            if parameter_name in extraction_results:
                result[parameter_name] = extraction_results[parameter_name]

            elif tool_input.type in {"mixed", "constant"}:
                template = str(tool_input.value)
                    resolved = self.graph_runtime_state.variable_pool.convert_template(template).text
                result[parameter_name] = resolved

            elif tool_input.type == "variable":
                variable = self.graph_runtime_state.variable_pool.get(tool_input.value)
                result[parameter_name] = variable.value if variable else None

        return result

    def _get_default_extraction_values(
        self,
        specs: list[VariableExtractionSpec],
    ) -> dict[str, str]:
        """Return default values for failed extractions."""
        return {spec.input_name: "" for spec in specs}
```

### 8.2 通用基类集成（可选方案）

如果多个节点类型都需要支持 extraction，可以在基类中统一处理：

```python
# core/workflow/nodes/base/node.py

class Node(Generic[NodeDataT]):

    def run(self) -> Generator[GraphNodeEventBase, None, None]:
        # Step 1: 预处理 extractions（如果有）
        extraction_results = yield from self._preprocess_extractions()

        # Step 2: 正常执行
        execution_id = self.ensure_execution_id()
        # ...existing logic...

    def _preprocess_extractions(self) -> Generator[GraphNodeEventBase, None, dict[str, str]]:
        """
        Override in subclasses that support extraction.
        Default implementation returns empty dict.
        """
        return {}

    def _supports_extraction(self) -> bool:
        """Override to return True if node supports extraction."""
        return False
```

### 8.3 为其他节点添加 context 输出

以下节点需要在 outputs 中添加 `context`：

```python
# core/workflow/nodes/question_classifier/question_classifier_node.py

def _run(self) -> NodeRunResult:
    # ...existing logic...

    outputs = {
        "class_name": result.class_name,
        # NEW: Add context for extraction support
        "context": self._build_context(prompt_messages, result.text),
    }

    return NodeRunResult(
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        outputs=outputs,
    )
```

```python
# core/workflow/nodes/parameter_extractor/parameter_extractor_node.py

def _run(self) -> NodeRunResult:
    # ...existing logic...

    outputs = {
        **extracted_parameters,
        # NEW: Add context for extraction support
        "context": self._build_context(prompt_messages, assistant_response),
    }
```

**注意**：`_build_context` 方法可以从 `LLMNode` 中提取为公共函数，或者直接复用：

```python
# core/workflow/nodes/llm/llm_utils.py

def build_context(
    prompt_messages: Sequence[PromptMessage],
    assistant_response: str,
    model_mode: str,
) -> list[dict[str, Any]]:
    """
    Build context from prompt messages and assistant response.
    Excludes system messages and includes the current LLM response.
    """
    context_messages = [m for m in prompt_messages if m.role != PromptMessageRole.SYSTEM]
    context_messages.append(AssistantPromptMessage(content=assistant_response))
    return PromptMessageUtil.prompt_messages_to_prompt_for_saving(
        model_mode=model_mode, prompt_messages=context_messages
    )
```

---

## 9. 配置选项

### 9.1 模型配置策略

提取调用使用的模型，按优先级：

| 优先级 | 来源       | 说明                                 |
| ------ | ---------- | ------------------------------------ |
| 1      | 显式指定   | `extraction.value.model` 配置        |
| 2      | 源节点配置 | 继承 `source_node_id` 节点的模型配置 |

### 9.2 ExtractionModelConfig 使用

```python
# 在 ExtractionExecutor 中获取模型配置

def _get_model_config(self, spec: VariableExtractionSpec) -> dict:
    # 如果显式指定了 model，使用它
    if spec.model:
        return {
            "provider": spec.model.provider,
            "name": spec.model.name,
            "mode": spec.model.mode.value,
            "completion_params": spec.model.completion_params,
        }

    # 否则继承源节点的模型配置
    source_model_config = self._get_source_node_model_config(spec.source_node_id)
    if source_model_config is None:
        raise ModelConfigNotFoundError(spec.source_node_id, spec.source_variable)

    return source_model_config
```

### 9.3 模型配置示例

**场景 1：继承源节点配置（推荐）**

```yaml
# 节点配置
inputs:
  - name: query
    type: extraction
    value:
      source_node_id: llm1
      source_variable: context
      extraction_prompt: "提取关键词"
      # 不指定 model，自动继承 llm1 的模型配置

# llm1 节点配置
data:
  model:
    provider: openai
    name: gpt-4
    mode: chat
    completion_params:
      temperature: 0.7
# 结果：使用 openai/gpt-4
```

**场景 2：显式指定模型**

```yaml
# 节点配置
inputs:
  - name: query
    type: extraction
    value:
      source_node_id: llm1
      source_variable: context
      extraction_prompt: "提取关键词"
      model:
        provider: openai
        name: gpt-4o-mini
        mode: chat
        completion_params:
          temperature: 0.3
# 结果：使用 openai/gpt-4o-mini（忽略源节点配置）
```

---

## 10. 错误处理与重试机制

### 10.1 设计考量

**重要说明**：虚拟节点（Extraction 节点）的重试机制**无法**直接复用现有的节点级别重试机制。

原因分析：

- Worker 从 `ready_queue` 取节点时，通过 `graph.nodes[node_id]` 获取节点实例
- 虚拟节点不在 `graph.nodes` 中
- `ErrorHandler._handle_retry()` 无法找到虚拟节点进行重试

因此，**ExtractionExecutor 需要在内部实现重试逻辑**。

### 10.2 错误类型

```python
# core/workflow/nodes/base/extraction_errors.py

class ExtractionError(Exception):
    """Base exception for extraction operations"""
    pass


class VariableNotFoundError(ExtractionError):
    """Source variable not found in variable pool"""

    def __init__(self, selector: list[str]):
        self.selector = selector
        super().__init__(f"Variable {'.'.join(selector)} not found in variable pool")


class InvalidVariableTypeError(ExtractionError):
    """Source variable is not a valid context type (list[dict])"""

    def __init__(self, selector: list[str], actual_type: type):
        self.selector = selector
        self.actual_type = actual_type
        super().__init__(
            f"Variable {'.'.join(selector)} is not a list type, got {actual_type.__name__}"
        )


class SourceNodeNotFoundError(ExtractionError):
    """Source node not found in graph config"""

    def __init__(self, node_id: str):
        self.node_id = node_id
        super().__init__(f"Source node {node_id} not found in graph config")


class LLMInvocationError(ExtractionError):
    """LLM invocation failed during extraction"""

    def __init__(self, original_error: Exception):
        self.original_error = original_error
        super().__init__(f"LLM invocation failed: {original_error}")
```

### 10.3 内部重试机制

虚拟节点的重试在 `ExtractionExecutor` 内部处理，继承父节点的 `retry_config`：

```python
# ExtractionExecutor 的重试实现

def _execute_single_extraction_with_retry(
    self,
    spec: VariableExtractionSpec,
    ext_node_id: str,
) -> Generator[..., None, tuple[str, LLMUsage]]:
    """
    Execute extraction with internal retry support.

    Retry config is inherited from parent node.
    """
    retry_config = self._parent_retry_config
    last_error: Exception | None = None

    for attempt in range(retry_config.max_retries + 1):
        try:
            return (yield from self._execute_single_extraction(spec, ext_node_id))
        except LLMInvocationError as e:
            last_error = e

            if attempt < retry_config.max_retries:
                # Yield retry event for frontend display
                yield NodeRunRetryEvent(
                    id=str(uuid4()),
                    node_id=ext_node_id,
                    node_type=NodeType.LLM,
                    node_title=f"Extraction: {spec.extraction_prompt[:30]}...",
                    start_at=self._start_time,
                    error=str(e),
                    retry_index=attempt + 1,
                )

                # Wait for retry interval
                time.sleep(retry_config.retry_interval_seconds)
                continue

            # Max retries exceeded, raise
            raise

    # Should not reach here, but for type safety
    raise last_error or LLMInvocationError(Exception("Unknown error"))
```

### 10.4 错误传播

```python
# ToolNode 中的错误处理示例

def _run(self) -> Generator[NodeEventBase, None, None]:
    try:
        # 执行 extractions（内部已处理重试）
        extraction_results = yield from extraction_executor.process_extractions(specs)
    except ExtractionError as e:
        # 虚拟节点已 yield 了 NodeRunFailedEvent
        # 异常传播到父节点，由父节点的 error_strategy 决定后续处理
        if self.error_strategy == ErrorStrategy.DEFAULT_VALUE:
            extraction_results = self._get_default_extraction_values(specs)
        else:
            raise  # 终止执行

    # 继续执行...
```

### 10.5 为什么不能复用节点级别重试

节点级别的重试流程：

```
Worker 执行节点
    → 失败 → NodeRunFailedEvent
    → Dispatcher → EventHandler
    → ErrorHandler._handle_retry()
    → 检查 graph.nodes[node_id]  ← 虚拟节点不存在！
    → 重新入队 ready_queue
```

虚拟节点不在 `graph.nodes` 中，无法进入此流程。因此重试必须在 ExtractionExecutor 内部完成。

---

## 11. 设计决策

### 11.1 模型配置

**决定：使用结构化配置，可选显式指定模型**

**配置方式**：

```yaml
# 继承源节点模型（推荐）
- name: query
  type: extraction
  value:
    source_node_id: llm1
    source_variable: context
    extraction_prompt: "提取关键词"

# 显式指定模型
- name: summary
  type: extraction
  value:
    source_node_id: agent1
    source_variable: context
    extraction_prompt: "总结对话"
    model:
      provider: openai
      name: gpt-4o-mini
```

**优先级**：

1. 如果 `extraction.value.model` 存在，使用指定的模型
2. 否则，继承源节点的模型配置

**模型配置字段**：

| 字段                | 说明       | 来源                      |
| ------------------- | ---------- | ------------------------- |
| `provider`          | 模型提供商 | 显式指定 或 源节点配置    |
| `name`              | 模型名称   | 显式指定 或 源节点配置    |
| `mode`              | LLM 模式   | 默认 `chat` 或 源节点配置 |
| `completion_params` | 推理参数   | 显式指定 或 源节点配置    |

### 11.2 Token 计费

**决定：A - 虚拟节点独立计费**

虚拟节点有独立的 `NodeRunResult`，token 消耗记录在虚拟节点的 `metadata` 中。

### 11.3 context 变量类型

**决定：C - 暂不新增类型**

当前 `context` 使用 `list[dict]` 格式（`ArrayAnySegment`），先这样实现，后续视需要再考虑新增 `PromptMessagesSegment` 类型。

### 11.4 支持范围

**决定：A - 支持所有使用 LLM 的节点**

包括：

- LLM 节点
- Agent 节点
- Question Classify 节点
- Parameter Extractor 节点

这些节点都需要输出 `context` 变量。

### 11.5 重试机制

**决定：A - 内部实现重试**

虚拟节点在 `ExtractionExecutor` 内部实现重试机制，而非复用节点级别的重试流程。

**原因**：

- 节点级别的重试需要节点在 `graph.nodes` 中，虚拟节点不满足此条件
- `ErrorHandler._handle_retry()` 无法找到虚拟节点

**实现方式**：

- 继承父节点的 `retry_config`（max_retries, retry_interval_seconds）
- 在 `ExtractionExecutor._execute_with_retry()` 中实现重试循环
- 每次重试 yield `NodeRunRetryEvent` 供前端展示

### 11.6 复用 LLMNode 逻辑

**决定：使用 LLMNode 静态方法**

ExtractionExecutor 复用 `LLMNode.invoke_llm()` 和 `LLMNode.handle_invoke_result()` 静态方法：

**优点**：

- 获得完整的 streaming 处理能力
- 获得完整的 token 统计（`LLMUsage`）
- 获得文件处理能力（multimodal）
- 返回格式与真正的 LLM 节点一致

**NodeRunResult 包含**：

- `outputs`: `{"text": "..."}`
- `llm_usage`: `LLMUsage` 对象
- `metadata`: token 计费信息（TOTAL_TOKENS, TOTAL_PRICE, CURRENCY）

---

## 12. 实现计划

### Phase 1: 基础设施

| Task | 文件                                            | 说明                                                   |
| ---- | ----------------------------------------------- | ------------------------------------------------------ |
| 1.1  | `core/workflow/entities/variable_extraction.py` | 定义 `VariableExtractionSpec`、`ExtractionModelConfig` |
| 1.2  | `core/workflow/graph_events/node.py`            | 在 `NodeRunStartedEvent` 添加虚拟节点字段              |
| 1.3  | `core/workflow/nodes/llm/llm_utils.py`          | 提取 `build_context` 为公共函数                        |

### Phase 2: 核心执行器

| Task | 文件                                                            | 说明                                                        |
| ---- | --------------------------------------------------------------- | ----------------------------------------------------------- |
| 2.1  | `core/workflow/nodes/base/extraction_errors.py`                 | 定义错误类型                                                |
| 2.2  | `core/workflow/nodes/base/extraction_executor.py`               | 实现 `ExtractionExecutor`                                   |
| 2.3  | `core/workflow/graph_engine/event_management/event_handlers.py` | 修改 `_is_virtual_node` 判断，虚拟节点不触发 edge_processor |

### Phase 3: 节点 context 输出

| Task | 文件                                       | 说明                |
| ---- | ------------------------------------------ | ------------------- |
| 3.1  | `core/workflow/nodes/agent/agent_node.py`  | 添加 `context` 输出 |
| 3.2  | `core/workflow/nodes/question_classifier/` | 添加 `context` 输出 |
| 3.3  | `core/workflow/nodes/parameter_extractor/` | 添加 `context` 输出 |

### Phase 4: 节点集成

| Task | 文件                                      | 说明                      |
| ---- | ----------------------------------------- | ------------------------- |
| 4.1  | `core/workflow/nodes/tool/tool_node.py`   | 集成 `ExtractionExecutor` |
| 4.2  | `core/workflow/nodes/agent/agent_node.py` | 集成 `ExtractionExecutor` |
| 4.3  | 其他节点                                  | 按需集成                  |

### Phase 5: 测试

| Task | 说明                               |
| ---- | ---------------------------------- |
| 5.1  | 单元测试：结构化配置解析           |
| 5.2  | 单元测试：ExtractionExecutor       |
| 5.3  | 集成测试：ToolNode with extraction |
| 5.4  | 集成测试：多个 extraction 场景     |

---

## 13. 附录

### 13.1 相关代码位置

| 模块          | 路径                                                            | 说明                              |
| ------------- | --------------------------------------------------------------- | --------------------------------- |
| LLM Node      | `core/workflow/nodes/llm/node.py`                               | `_build_context` 方法（line 600） |
| Tool Node     | `core/workflow/nodes/tool/tool_node.py`                         | `_generate_parameters` 方法       |
| Agent Node    | `core/workflow/nodes/agent/agent_node.py`                       | 需要添加 context 输出             |
| Variable Pool | `core/workflow/runtime/variable_pool.py`                        | 变量存取和模板解析                |
| Graph Events  | `core/workflow/graph_events/node.py`                            | 节点事件定义                      |
| Event Handler | `core/workflow/graph_engine/event_management/event_handlers.py` | 事件处理和变量存储                |
| Worker        | `core/workflow/graph_engine/worker.py`                          | 节点执行和事件队列                |

### 13.2 参考实现

| 功能          | 参考代码                 | 说明                                                   |
| ------------- | ------------------------ | ------------------------------------------------------ |
| 模板解析      | `VariableTemplateParser` | `core/workflow/nodes/base/variable_template_parser.py` |
| 历史消息处理  | `TokenBufferMemory`      | `core/memory/token_buffer_memory.py`                   |
| LLM 流式调用  | `LLMNode.invoke_llm`     | `core/workflow/nodes/llm/node.py` line 386             |
| 事件 dispatch | `Node._dispatch`         | `core/workflow/nodes/base/node.py` line 559            |

### 13.3 新增文件

实现本功能需要新增以下文件：

```
core/workflow/
├── entities/
│   └── variable_extraction.py      # NEW: VariableExtractionSpec 定义
└── nodes/
    └── base/
        ├── extraction_errors.py    # NEW: 错误类型定义
        └── extraction_executor.py  # NEW: ExtractionExecutor 实现
```

### 13.4 修改文件清单

| 文件                                                            | 修改内容                                    |
| --------------------------------------------------------------- | ------------------------------------------- |
| `core/workflow/graph_events/node.py`                            | 添加 `is_virtual`, `parent_node_id` 等字段  |
| `core/workflow/graph_engine/event_management/event_handlers.py` | 添加 `_is_virtual_node` 判断                |
| `core/workflow/nodes/llm/llm_utils.py`                          | 提取 `build_context` 公共函数               |
| `core/workflow/nodes/tool/tool_node.py`                         | 集成 ExtractionExecutor                     |
| `core/workflow/nodes/agent/agent_node.py`                       | 添加 context 输出 + 集成 ExtractionExecutor |
| `core/workflow/nodes/question_classifier/*.py`                  | 添加 context 输出                           |
| `core/workflow/nodes/parameter_extractor/*.py`                  | 添加 context 输出                           |
