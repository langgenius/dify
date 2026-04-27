# 写 Spec 前的遗留问题

日期：2026-04-23
背景：在上下文压缩前，把 Dify Phoenix hierarchy / session 方案里还没拍板的重要问题记录下来，方便后续继续推进 spec。

## 已经确认的结论

以下结论目前可以视为已定，除非后续出现新的反证。

### 1. Dify 中的 session 语义

- 顶层 workflow app：`session.id = workflow_run_id`
- 顶层 chatflow app：`session.id = conversation_id`
- 嵌套 workflow 继承外层 session identity

### 2. Session 语义不是 Phoenix 专属

- `session.id` 应该属于 Dify tracing contract
- Phoenix 的 session 页面 / API / 查询能力只是建立在这个属性上的产品能力

### 3. Prototype 的 root-span 问题

- prototype 在 trace detail 页面里可以显示 hierarchy
- 但它大概率生成的是 orphan-root trace，而不是 canonical-root trace
- 这很可能解释了 Phoenix session 查询中 `rootSpan = null`

### 4. 当前上游 / 下游职责分界

- `ops_trace_manager` 已经承担了相当一部分 trace 标准化工作
- `trace_entity.py` 已经承载了一部分标准 contract
- `enterprise_trace.py` 已经在消费 `resolved_parent_context`
- workflow 内部 hierarchy 重建还没有真正上移

## 遗留问题

## 1. 新 hierarchy 构建逻辑到底放在哪一层

我们已经基本同意，新逻辑应该上移，而不是继续留在 Phoenix-specific provider 里。

但还没有最终定下精确落点：

- 只放在 `ops_trace_manager.py`
- 放在 `ops_trace_manager.py` + `trace_entity.py`
- 还是一部分在 `ops_trace_manager.py`，一部分在 `enterprise_trace.py` 收尾

### 为什么重要

这会决定：

- contract 结构
- 测试边界
- provider 复用程度
- 还有多少逻辑会继续留在 Phoenix-specific 侧

## 2. workflow 内部 node-parent 规则的最终版本

我们已经讨论过一些候选规则，但还没有正式冻结。

当前候选大致是：

- 优先使用 graph parent
- 对 branch / loop / iteration 场景用 runtime 语义做修正
- 只有在显式结构不可用时，才回退到 execution-order heuristic

### 目前还不明确的点

- `predecessor_node_id` 是否足够可靠，可以直接参与 parent 解析
- `end` 节点是否需要特殊规则
- parallel 节点应该如何表达
- v1 是否允许保留较多 heuristic fallback，还是尽量收紧

## 3. v1 hierarchy 支持范围

我们还需要决定第一版到底覆盖到什么程度。

可能的范围有：

- 最小范围：
  - workflow
  - chatflow
  - nested workflow 挂到 tool 下
- 中等范围：
  - 再加上 loop / branch
- 较大范围：
  - 再加上 iteration / parallel / 多层 nested workflow

### 为什么重要

这会影响：

- spec 规模
- 实现风险
- 测试矩阵
- 交付顺序

## 4. canonical-root 保证策略

我们已经知道 prototype 大概率会制造 orphan root。

但还没形式化这些问题：

- canonical-root invariant 应该在哪一层强制保证
- root 创建规则应该属于 trace contract 还是 exporter 行为
- 如何在测试中验证 root 正确性

## 5. session 传播 contract 的具体形态

session 语义我们已经定了，但字段设计还没最后拍板。

还没定的问题包括：

- `session_id` 是否要成为 `BaseTraceInfo` 的一等字段
- 还是先继续从 metadata 派生
- 顶层 session resolution 应该在哪一层做
- 嵌套 workflow 如何接收到继承而来的 session identity

## 6. 哪些内容在上移之后仍然保留 Phoenix-specific

我们已经知道，有些逻辑不适合进入核心 tracing contract。

spec 里还要进一步明确：

- span naming 是否继续保留为 Phoenix-specific
- 是否还需要附带某些 Phoenix-only metadata
- 展示导向的 polish 有多少应该留在共享 contract 之外

## 7. 验证计划

我们还没有把最终验证清单写出来。

仍需定义：

- 哪些场景需要在 Phoenix UI 中人工验证
- 哪些响应需要通过 API / GraphQL 直接检查
- 需要补哪些自动化测试
- 什么证据才算确认 canonical root、session grouping、hierarchy 正确

## 建议的优先级顺序

如果下一个会话从这里继续，最值得优先回答的遗留问题是：

1. workflow 内部 node-parent 的最终规则
2. hierarchy 构建在上游代码中的精确落点
3. v1 的支持范围
4. canonical-root 的保证策略
5. session 传播字段的最终设计

## 关键参考文件

目前 `docs/phoenix-trace/references/` 中已经写好的关键信息文件有：

- `2026-04-23-prototype-hierarchy-analysis.md`
- `2026-04-23-prototype-session-rootspan-analysis.md`
- `2026-04-23-dify-session-id-semantics.md`
- `2026-04-23-session-id-vs-phoenix-sessions.md`
- `2026-04-23-ops-trace-manager-vs-prototype.md`

## 当前总结

现在真正剩下的工作，已经不再是“搞懂 prototype 在做什么”。

接下来更重要的是把设计产品化：

- 定下标准化 hierarchy contract
- 定下精确的上游实现边界
- 定下第一版交付范围
- 定义如何验证正确性
