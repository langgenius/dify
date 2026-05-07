# 0007. 跨仓库的 Workflow-Tool Parent Context 透传方案

日期：2026-04-23
状态：Accepted

## 背景

此前的 Phoenix-local 和 Dify-only 修复，已经把 workflow-tool parent context 的下游透传链打通了：

- workflow tool runtime parameters
- `parent_trace_context`
- app generator `extras`
- persistence `TraceTask`
- Phoenix `resolved_parent_context`

但真实的生产 debugging 已经证明，这条链在“发布为工具的 nested workflow”场景下仍然失效，因为更上游的 runtime 边界没有暴露出足够的上下文。

我们已经识别出两个缺口：

1. 对旧版 tool node 形态，workflow-tool runtime 可能拿到的是 `variable_pool=None`
2. 当前 tool node 的 execution identity 根本没有暴露给 workflow runtime adapter

这两个问题都不是 Phoenix 的问题，而是 `graphon` 与 Dify 之间共享的 runtime 边界问题。

## 决策

把这项工作视为一个跨 `graphon` 和 Dify 的联合特性来实现。

### Graphon 的职责

`graphon` 负责 runtime contract 和 tool-node execution 边界。

这一轮改动应确保 workflow tool runtime 构造时能获得足够的执行上下文，从而支持：

- 外层 workflow run identity
- 外层 tool node execution identity
- 对旧版 tool-node 运行形态的兼容

### Dify 的职责

Dify 负责 workflow-layer adapter，把 graph runtime 上下文翻译成 tool runtime parameters，再进一步翻译成 tracing 语义。

这一轮改动应确保 Dify：

- 消费新的 Graphon runtime contract
- 填充 workflow-tool runtime parameters
- 生成 `parent_trace_context`
- 继续复用现有的下游透传链进入 Phoenix

## 目标结果

对于一个顶层 workflow 调用多个“发布为工具”的 nested workflow 的场景：

- nested workflow trace 继承外层 workflow 的 session
- nested workflow trace 能解析出外层 workflow 作为 parent trace source
- nested workflow trace 能解析出外层 tool node execution 作为 parent span source

## 决策理由

这个拆分符合实际所有权边界：

- Graphon 决定 tool-node runtime adapter 能拿到什么
- Dify 决定如何把这些 runtime 上下文映射成 tracing metadata

如果只在 Dify 里修，会继续堆出脆弱的 fallback。
如果只在 Graphon 里修 tracing 语义，又会把应用层策略错误地下沉。

## 结果与影响

这项功能现在需要协调但分离的实现方式：

- Graphon 的 PR / commit 负责 runtime 边界变更
- Dify 的 PR / commit 负责 adapter 和 tracing 集成

开发期间允许使用 editable 的本地 Graphon 依赖，但在 Graphon 正式发布新版本之前，这个依赖覆盖必须保持为本地设置，不进入功能提交。
