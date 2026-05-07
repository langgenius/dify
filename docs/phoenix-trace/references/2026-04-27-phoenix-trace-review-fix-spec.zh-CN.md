# Phoenix Trace Review 修复规格

日期：2026-04-27
状态：Spec
审查来源：`docs/phoenix-trace/references/2026-04-27-phoenix-trace-feature-code-review.zh-CN.md`

## 总结

这份规格覆盖 Phoenix tracing 审查之后的修复工作。目标是在保留 Phoenix nested workflow trace 能力的同时，把内部 tracing metadata 和 retry contract 收回到内部边界内。

本次修复需要解决三个具体风险，并记录一个有意保留的阶段性边界：

- workflow tool 的 parent trace context 不能覆盖用户 workflow 输入
- 通用 trace dispatch 不能 import Phoenix provider 的异常类型
- Phoenix pending-parent retry 不能重复发送 enterprise traces
- Phoenix-local Redis parent span coordination 当前可以继续留在 provider 内，但代码里要明确说明原因，以及未来复用时应该上提的位置

## 目标

1. 保留 Phoenix nested workflow 的 parent trace 透传能力。
2. 防止内部 trace id 被 merge 进公开的 workflow tool input 参数。
3. 让 `tasks.ops_trace_task` 只依赖 core retry contract，不依赖 provider 实现符号。
4. 避免 Phoenix pending-parent bounded retry 导致 enterprise trace 重复发送。
5. 在 Phoenix Redis parent span coordination 附近加短注释，说明 provider-local 边界是阶段性设计。

## 非目标

- 不重做整个 trace provider interface。
- 本轮不抽象共享 Redis parent span context store。
- 不改变 Phoenix span hierarchy 或命名语义。
- 不改变 enterprise telemetry 和 Phoenix 已经消费的 `parent_trace_context` metadata shape。

## 需求

### 1. 私有 Workflow Tool Parent Context

外层 workflow run id 和外层 tool node execution id 必须通过私有 runtime channel 传递，不能通过 `ToolRuntime.runtime_parameters` 传递。

必需行为：

- workflow tool execution 仍然能向 nested workflow 传递：
  - `parent_workflow_run_id`
  - `parent_node_execution_id`
- 用户 workflow input 如果命名为 `outer_workflow_run_id` 或 `outer_node_execution_id`，必须仍然保留用户传入的值。
- 非 workflow provider 不应收到 parent trace context。

推荐设计：

- 扩展 `api/core/workflow/node_runtime.py` 中 workflow-private 的 `_WorkflowToolRuntimeBinding`。
- 把 `parent_trace_context` 存在 binding 上。
- 由 `DifyToolNodeRuntime.invoke()` 通过私有参数把 context 传给 workflow tool invocation。
- 保持 `Tool.invoke()` 和通用 tool invocation 对非 workflow tool 的行为不变。

### 2. Core Retry Contract

pending-parent retry signal 必须定义在 core 代码中。

必需行为：

- `api/tasks/ops_trace_task.py` catch core exception type。
- Phoenix 在 Redis parent span carrier 暂不可用时 raise core exception type。
- 测试不再从 Phoenix provider import retry exception。

推荐设计：

- 新增 `api/core/ops/exceptions.py`。
- 定义 `class RetryableTraceDispatchError(RuntimeError)`。
- 定义 `class PendingTraceParentContextError(RetryableTraceDispatchError)`。
- pending-parent exception 继续暴露 `parent_node_execution_id`。

### 3. Enterprise Trace Retry 幂等边界

Phoenix pending-parent retry 不能导致 enterprise trace emission 再次执行。

必需行为：

- 一次 trace task payload 最多成功发送一次 enterprise telemetry。
- 如果 provider dispatch 在 enterprise emission 成功后请求 retry，retry payload 必须保留足够状态，使下一次 attempt 跳过 enterprise emission。
- 如果 enterprise telemetry 内部抛错并被记录，provider dispatch 行为仍保持现状继续执行。
- terminal task failure 仍然删除 payload 文件。
- Celery retry 成功调度时仍然保留 payload 文件。

推荐设计：

- 在 trace payload file 中保存私有 flag，例如 `_enterprise_trace_dispatched`。
- enterprise trace dispatch block 完成后设置该 flag。
- 调度 retry 前先持久化 payload。
- retry attempt 中如果 flag 已经为 true，则跳过 enterprise dispatch。

### 4. Phoenix-Local Parent Span Coordination 注释

Phoenix provider 当前阶段可以继续负责 Redis key、TTL、carrier validation 和 pending-parent signaling。

必需行为：

- 在 Phoenix Redis parent span helper 附近加简短注释。
- 注释必须说明：当前 feature 只有 Phoenix 使用，所以有意保持 provider-local。
- 注释必须说明：如果其他 provider 也需要同样的 nested workflow parent restoration 行为，storage 和 retry signaling 应该上提为 core abstraction。

## 验收标准

- 名为 `outer_workflow_run_id` 的 workflow-as-tool 输入会作为用户输入传给 nested workflow，不会被内部 trace metadata 覆盖。
- 当 outer workflow run id 和 outer node execution id 都存在时，nested workflow 仍会生成 `parent_trace_context`。
- `tasks.ops_trace_task` 只从 `core.ops` import retry exceptions。
- Phoenix provider import 并 raise core pending-parent exception。
- 单元测试覆盖 retry payload 保留，以及 retry 后跳过 enterprise dispatch。
- 更新 import 后，现有 Phoenix pending-parent retry 测试继续通过。
- Phoenix provider 中有明确的 provider-local coordination 注释。

## 风险说明

风险最高的是替换 `runtime_parameters` 这条 side channel，因为 workflow tool invocation 当前依赖 base `Tool.invoke()` signature。最稳妥的实现应尽量避免修改所有工具的 public base tool contract，优先在 `DifyToolNodeRuntime.invoke()` 和 `WorkflowTool` 内做窄范围私有适配。

第二个风险是把 retry 状态持久化到 trace payload file。实现必须保留现有清理语义：成功和 terminal failure 都删除文件，只有 Celery retry 实际调度成功时才保留文件。
