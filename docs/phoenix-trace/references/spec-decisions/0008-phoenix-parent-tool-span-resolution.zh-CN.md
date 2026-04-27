# 0008. Phoenix 中嵌套 Workflow 挂到父 Tool Span 的解析方案

日期：2026-04-23
状态：Accepted

## 背景

前面的 cross-repo parent-context 改造已经足够让嵌套 workflow：

- 进入与外层 workflow 相同的 trace
- 进入与外层 workflow 相同的 session

但真实 Phoenix trace 结果说明，嵌套 workflow span 仍然挂在 synthetic `Dify` root span 下，
而不是挂在触发它的外层 tool span 下。

当前 Phoenix 行为是：

- 用 `parent_workflow_run_id` 复用外层 trace root
- 能解析并记录 `parent_node_execution_id`
- 但还没有真正用 `parent_node_execution_id` 去恢复父 tool span 的上下文

由于 Phoenix span 是异步在 trace task 里发出的，child workflow task 并不持有外层 tool span
的内存对象，所以要恢复父子关系，必须增加一层 Phoenix-local bridge。

## 决策

在 Phoenix 侧实现“父 span 上下文持久化 + 任务重试”的 bridge。

### 父 span 发布

当 Phoenix 为 workflow 内部的 tool node 发 span 时，应将该 span 的上下文写入 Redis，
并以 `node_execution_id` 为 key 保存。

保存内容只需要覆盖后续 child workflow 重建父上下文所必需的最小字段。

### 父 span 消费

当 Phoenix 为 nested workflow 发 span 且 `parent_node_execution_id` 存在时，应：

1. 先根据 `parent_node_execution_id` 从 Redis 读取父 span 上下文
2. 如果读取成功，则用该上下文启动 child workflow span
3. 如果暂时还未写入，则不要第一次就静默挂到 synthetic root 下，而是抛出一个可重试的
   pending-parent 条件

### 重试策略

`ops_trace_task` 需要为这个特定的 pending-parent 条件提供有限次数的重试能力。

重试期间必须保留 trace payload 文件，不能像普通失败那样立即删除。

如果超过重试预算后仍然拿不到父 span 上下文，可以退回当前的 root-parenting 行为，
但必须记录清晰日志，说明这次未能及时恢复正确的 tool-parent 关系。

## 理由

这个方案符合当前边界：

- upstream / Graphon 已经负责把 `parent_node_execution_id` 传下来
- Phoenix 自己负责 provider-local 的异步发 span 顺序问题
- Redis 已经可用，适合做短生命周期的跨任务协调

它也避免了去改造 OpenTelemetry SDK 路径、硬做 deterministic span id。

## 影响

预计会改到：

- Phoenix provider 的 span emission helper
- 一个小的基于 Redis 的 parent-span context helper
- `ops_trace_task` 对 Phoenix pending-parent 的重试逻辑
- 有针对性的 Phoenix 与 task 层测试

这仍然是一个过渡性的 Phoenix-local 方案。若未来 upstream tracing 暴露出稳定且
provider-agnostic 的 parent-span contract，这层 bridge 应该可以被移除。
