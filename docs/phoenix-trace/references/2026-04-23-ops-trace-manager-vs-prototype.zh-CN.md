# `ops_trace_manager` 与 Prototype 的职责对照

日期：2026-04-23
背景：明确 prototype 在 Phoenix tracing 里做的哪些事情已经迁移到了 `ops_trace_manager` / trace contract 上游，哪些部分仍然留在 provider-specific 层。

## 目标

为后续 spec 建立清晰边界：

- 复用 `ops_trace_manager` 和 trace contract 已经做好的部分
- 避免在 Phoenix provider 里重复实现上游已经有的逻辑
- 明确哪些部分仍然需要在 Phoenix / exporter 侧处理

## 核心结论

`ops_trace_manager` 已经接住了 prototype 中相当一部分工作，但还没有接住完整的 hierarchy 逻辑。

当前更准确的分工是：

### 已经迁移到上游的部分

- workflow trace 数据加载与标准化
- node execution trace 数据加载与标准化
- 类型化 trace contract（`WorkflowTraceInfo`、`WorkflowNodeTraceInfo`）
- 标准化 trace ID fallback
- 标准化跨工作流 parent context 传递
- workflow / message / conversation 的关联字段
- token split 和 metadata enrichment

### 还没有迁移到上游的部分

- 基于 workflow graph 的 hierarchy 重建
- workflow 内部 node-to-node 的父节点重建
- branch / loop / iteration-aware 的 hierarchy 规则
- execution-order fallback 父节点解析
- Phoenix-specific 的 span naming 策略
- 作为一等 contract 的 session ID 解析与传播
- canonical root 与 orphan root 的约束规则

## Prototype 在 Provider 里做了什么

prototype provider（`arize_phoenix_trace.py`）实际上把两件事都做了：

1. 构建 trace 语义
2. 导出 Phoenix spans

所以这个文件才会很重。它不仅仅是在序列化 `TraceInfo`，还会：

- 查询 workflow nodes
- 查询 workflow graph
- 重建 parent-child hierarchy
- 推断 nested workflow 关系
- 选择 span name
- 赋值 session ID
- 直接发 spans

相关 prototype 位置：

- workflow 级逻辑：`/Users/yang/Downloads/arize_phoenix_trace.py:190`
- node hierarchy 逻辑：`/Users/yang/Downloads/arize_phoenix_trace.py:298`
- hierarchy map 构建：`/Users/yang/Downloads/arize_phoenix_trace.py:1182`
- child workflow 推断：`/Users/yang/Downloads/arize_phoenix_trace.py:1664`
- logical parent fallback：`/Users/yang/Downloads/arize_phoenix_trace.py:1819`

## `ops_trace_manager` 已经做了哪些 prototype 原本也做过的事

## 1. Workflow trace 数据加载与标准化

`ops_trace_manager.TraceTask.workflow_trace(...)` 已经会在 provider 看到数据之前，先把 workflow execution 的核心信息加载并标准化。

它已经解析了：

- `workflow_id`
- `tenant_id`
- `workflow_run_id`
- workflow inputs/outputs
- status / error / version
- workflow app log id
- 可选的关联 message id
- prompt/completion token split
- app/workspace name enrichment

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/ops_trace_manager.py:784`

这部分和 prototype 中 workflow metadata 构建的职责是重叠的。

## 2. Node execution trace 数据加载与标准化

`ops_trace_manager.TraceTask.node_execution_trace(...)` 已经会从 runtime / persistence payload 构建标准化的 node execution trace object。

它已经解析了：

- workflow 与 node identity
- node execution identity
- node type / title / status / error
- node timing与 index
- predecessor id
- model/token/tool 字段
- iteration / loop / parallel identifiers
- 可选的 message / conversation 关联
- app/workspace/credential/plugin/dataset metadata

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/ops_trace_manager.py:1328`

这部分和 prototype 中 node metadata 构建的职责也是重叠的。

## 3. 类型化 trace contract

当前 trace contract 已经承载了很多 prototype 以前只能在 provider 里临时处理的字段：

- `WorkflowTraceInfo`
- `WorkflowNodeTraceInfo`
- workflow/node ids
- timing
- tokens
- `predecessor_node_id`
- `iteration_id`
- `loop_id`
- `parallel_id`
- `process_data`

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/entities/trace_entity.py:79`
- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/entities/trace_entity.py:189`

这是一种上游 contract 化，而 prototype 当时并没有形成这种可复用的统一表达。

## 4. 标准化 trace ID fallback

`BaseTraceInfo.resolved_trace_id` 已经把 trace identity 的 fallback 顺序标准化了：

1. external `trace_id`
2. `workflow_run_id`
3. `message_id`

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/entities/trace_entity.py:30`

这已经替代了 prototype 一部分 provider-local 的 trace ID 决策逻辑。

## 5. 跨工作流 parent context 传递

这是 prototype 逻辑中最明确已经成功迁移到上游的一部分。

`ops_trace_manager` 已经会把 `parent_trace_context` 放入 workflow 和 node trace metadata：

- workflow trace 路径：`/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/ops_trace_manager.py:859`
- node trace 路径：`/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/ops_trace_manager.py:1373`

然后 `BaseTraceInfo.resolved_parent_context` 再把这份非类型化 metadata 解析成标准化 transport：

- `trace_correlation_override`
- `parent_span_id_source`

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/entities/trace_entity.py:50`

这说明 prototype 中一个很关键的行为已经上游化了：

- nested workflow 的 parent linking

## 6. 下游已经按这个上游 contract 在消费

`enterprise_trace.py` 已经不是重新猜 parent linkage，而是直接消费 `resolved_parent_context`。

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/enterprise_trace.py:184`
- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/enterprise_trace.py:343`

这进一步证明：prototype 的一部分语义已经正式进入标准 tracing contract 了。

## 哪些事还没有迁移到上游

## 1. 基于 workflow graph 的 hierarchy 重建

prototype provider 现在仍然会本地做这些事：

- 查询 workflow graph
- 查询 workflow nodes
- 构建 hierarchy map

相关 prototype 代码：

- `/Users/yang/Downloads/arize_phoenix_trace.py:298`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1182`

`ops_trace_manager` 里目前没有等价的 graph-based hierarchy builder。

## 2. 单个 workflow 内部 node-to-node 父节点解析

prototype 当前会用这些规则决定 node parent：

- 图上的显式父节点
- `start` / `end` 的特殊处理
- 最近一次更早执行节点的 fallback

相关 prototype 代码：

- `/Users/yang/Downloads/arize_phoenix_trace.py:456`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1819`

目前 `ops_trace_manager` 虽然承载了 node metadata，但还没有显式计算 node-parent contract。

## 3. branch / loop / iteration-aware 的 hierarchy 规则

prototype 现在本地还有这些逻辑：

- question-classifier / if-else 的 decision context
- loop context
- tool 触发 child workflow 的本地推断

相关 prototype 代码：

- `/Users/yang/Downloads/arize_phoenix_trace.py:369`
- `/Users/yang/Downloads/arize_phoenix_trace.py:379`
- `/Users/yang/Downloads/arize_phoenix_trace.py:384`

上游 contract 目前虽然已经暴露了 loop/iteration ids，但还没有根据这些字段定义完整 hierarchy 规则。

## 4. Phoenix-specific 的 span naming

prototype 使用了大量高度定制的名字策略，例如：

- 带 nested 标识的 workflow name
- 带 child workflow 标识的 tool name
- classifier / loop / API call 的额外装饰

相关 prototype 代码：

- `/Users/yang/Downloads/arize_phoenix_trace.py:236`
- `/Users/yang/Downloads/arize_phoenix_trace.py:508`

这部分没有上游化，而且除非有明确跨 provider 命名 contract 的需求，否则大概率仍应保留为 provider-specific 或 presentation-specific。

## 5. Session ID 的解析与传播

prototype 目前是直接在 provider 里设置 `SpanAttributes.SESSION_ID`。

这部分今天还没有进入 `TraceInfo` 的一等 contract 字段里。

相关 prototype 代码：

- `/Users/yang/Downloads/arize_phoenix_trace.py:261`
- `/Users/yang/Downloads/arize_phoenix_trace.py:608`

我们已经从概念上认定它应该上移，但在当前代码里它还没有成为标准化 trace field。

## 6. Canonical root 保护

prototype provider 现在创建 workflow root span 的方式仍然可能制造 orphan root，而不是 canonical root。

这说明 root-construction 的约束还没有在标准 contract 层得到保护。

## 对后续 Spec 的直接边界建议

后续 spec 最适合采用这样的复用边界：

### 直接复用上游现有能力

- `ops_trace_manager` 中的 workflow / node trace 数据加载
- `trace_entity.py` 中的类型化 trace contract
- 现有 `parent_trace_context` transport
- 现有 `resolved_parent_context`
- 已有的 workflow/node identity 与 timing 字段

### 在上游继续扩展

- 增加显式的 session identity contract
- 如果要标准化 hierarchy，则增加显式的 node-parent / hierarchy contract
- 增加基于顶层 mode 的 session resolution
- 视情况增加 canonical-root invariants

### 暂时保留在 provider-specific

- Phoenix 展示导向的 span naming
- 不属于核心 tracing semantics 的 UI-oriented metadata

## 当前建议

spec 里应该明确写出：

1. 不要重复实现 `ops_trace_manager` 已经完成的上游标准化
2. 复用现有 parent context transport 和 typed trace contracts
3. 如果希望 hierarchy 标准化，就把 workflow 内部 hierarchy 重建继续前移到上游
4. Phoenix-specific 的 naming 与 display polish 不要直接塞进核心 contract，除非有足够明确的理由
