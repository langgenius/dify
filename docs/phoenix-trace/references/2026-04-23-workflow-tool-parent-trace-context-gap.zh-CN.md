# Workflow Tool 场景中 Parent Trace Context 缺失分析

日期：2026-04-23
状态：分析笔记

## 总结

在“顶层 workflow 触发多个发布为工具的子 workflow”这个场景里，`WorkflowTraceInfo.resolved_parent_context` 之所以是 `None`，不是因为 Phoenix 解析失败，而是因为上游 `api/` 根本没有为这个 nested workflow run trace 产出 `parent_trace_context`。

这意味着当前 Phoenix-local 的 session fallback 逻辑：

- `conversation_id`
- `parent_trace_context.parent_workflow_run_id`
- `workflow_run_id`

在这个真实场景里无法生效，因为 `parent_workflow_run_id` 根本没有传到 Phoenix。

## Phoenix 侧实际依赖什么

`BaseTraceInfo.resolved_parent_context` 只会读取：

- `metadata["parent_trace_context"]["parent_workflow_run_id"]`
- `metadata["parent_trace_context"]["parent_node_execution_id"]`

参考：

- `api/core/ops/entities/trace_entity.py`

而 `TraceTask.workflow_trace()` 只有在 `self.kwargs` 里已经带着 `parent_trace_context` 时，才会把它复制进 workflow trace metadata。

参考：

- `api/core/ops/ops_trace_manager.py`

所以 Phoenix 在这里完全是消费者，不是生产者。

## Context 在哪里丢了

对于 workflow-as-tool 调用链，父上下文没有在这条路径上被生产或透传。

### 1. tool runtime 调用时没有携带 parent trace context

workflow tool runtime 实际调用工具时，会带类似这些字段：

- `user_id`
- `conversation_id`
- `app_id`
- `workflow_call_depth`

但不会带：

- `parent_trace_context`
- 外层 `workflow_run_id`
- 外层 `node_execution_id`

参考：

- `api/core/workflow/node_runtime.py`
- `api/core/tools/tool_engine.py`

### 2. WorkflowTool 启动子 workflow 时没有传 parent trace context

`WorkflowTool._invoke()` 调 `WorkflowAppGenerator.generate(...)` 时，传的是：

- `args={"inputs": ..., "files": ...}`
- `invoke_from`
- `streaming`
- `call_depth`

但没有把任何 parent trace metadata 一起带下去。

参考：

- `api/core/tools/workflow_as_tool/tool.py`

### 3. WorkflowAppGenerator 只处理 external trace id

`WorkflowAppGenerator.generate()` 会新建一个 `TraceQueueManager`，并且只会从 `args` 中提取 `external_trace_id` 到 `extras`。

它不会提取、更不会保存 `parent_trace_context`。

参考：

- `api/core/app/apps/workflow/app_generator.py`
- `api/core/helper/trace_id_helper.py`

### 4. workflow trace task 入队时也没有 parent trace context

当 workflow trace task 被创建时，persistence layer 传入的是：

- `workflow_execution`
- `conversation_id`
- `user_id`
- `external_trace_id`

依然没有 `parent_trace_context`。

参考：

- `api/core/app/workflow/layers/persistence.py`

## 为什么最后会变成 `None`

因为 workflow-as-tool 这条链路从头到尾都没有提供 `parent_trace_context`：

- `TraceTask.workflow_trace()` 看不到 `self.kwargs["parent_trace_context"]`
- `WorkflowTraceInfo.metadata` 里也没有 `parent_trace_context`
- `resolved_parent_context` 自然返回 `(None, None)`

这和你在 Phoenix 日志里看到的现象一致：

- `parent_workflow_run_id=None`
- `parent_node_execution_id=None`

## 这不是什么问题

这件事看起来**不是**：

- Phoenix 解析 bug
- 使用了别的 key 或别的 shape
- `WorkflowTraceInfo` 序列化/反序列化过程把字段弄丢了

真正的问题发生得更早：在 published-workflow-as-tool 的执行路径里，期望的 parent context 根本没有被生产出来。

## 实际影响

对于这个具体场景，只改 Phoenix 是不够的。只要 session 继承或 cross-workflow parent linking 依赖 `resolved_parent_context`，就必须先让上游把 parent context 传下来。

要让 nested workflow trace 正确继承父 workflow 的 session 和 parent span，至少需要先在上游透传：

- `parent_workflow_run_id`
- `parent_node_execution_id`

## 后续如果要补上游，重点看哪些文件

如果后面要修，最值得看的是这条上游链路：

- `api/core/tools/workflow_as_tool/tool.py`
- `api/core/app/apps/workflow/app_generator.py`
- `api/core/app/workflow/layers/persistence.py`
- `api/core/ops/ops_trace_manager.py`

真正的设计重点不是 Phoenix 怎么读，而是 workflow tool invocation 在哪里最合适去创建并透传这两个字段。
