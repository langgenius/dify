# 0005. Phoenix 中 Nested Workflow 的 Session 继承规则

日期：2026-04-23
状态：v1 已接受

## 背景

Phoenix 当前的 session 分组逻辑与现有 Phoenix-local helper 一致：

- 如果有 `conversation_id`，就用 `conversation_id`
- 否则使用当前 workflow 自己的 `workflow_run_id`

这个行为对顶层 chatflow 和顶层 workflow 都比较直接，但会带来一个问题：

当顶层 workflow 触发子 workflow，且子 workflow 没有 `conversation_id` 时，子 workflow 会因为回退到自己的 `workflow_run_id` 而被拆分到独立的 Phoenix session 中。

与此同时，跨 workflow 的 trace 关联其实已经复用了上游的 `parent_trace_context.parent_workflow_run_id`，所以当前的现象是：

- trace tree 已经合并
- Phoenix session 仍然分裂

## 决策

### Session 解析规则

对于 Phoenix v1 中的 workflow tracing，本地 fallback 顺序应调整为：

1. `conversation_id`
2. `parent_trace_context.parent_workflow_run_id`
3. 当前 `workflow_run_id`

这意味着：

- 顶层 chatflow 仍按 `conversation_id` 聚合
- 顶层 workflow 仍按自己的 `workflow_run_id` 聚合
- 没有 `conversation_id` 的 nested workflow，会通过外层 `workflow_run_id` 继承父 session

### 作用范围

这个决策只影响 Phoenix-local 的 session 分组行为。

它不修改上游 trace contract，也不改变上游定义的 session 语义。

### 非目标

这个决策**不负责**解决 Phoenix session 详情页中的首个 input / 最后 output 缺失问题。当前这类问题与 Phoenix 将 synthetic root span 显示在 workflow span 之上有关，属于另一类展示/root-shaping 问题。

因此，不应把它与 nested workflow 的 session 合并问题混为一谈。

## 理由

对于我们此前已经明确的 workflow 语义：

- 顶层 workflow 的 session identity 就是 `workflow_run_id`
- nested workflow 应继承外层 workflow 的 session

而现有上游 parent context 已经带有父 workflow 的 run 标识，因此 Phoenix 可以在本地完成这条继承规则，而无需等待上游显式提供 `parent_session_id`。

## 未来上移说明

这仍然是一条过渡性的 Phoenix-local 规则。

如果未来上游 tracing 明确提供了 `parent_session_id` 或完整标准化的 session contract，Phoenix 就不应再通过 `parent_workflow_run_id` 推断 nested workflow 的 session，而应直接消费上游 session 字段。
