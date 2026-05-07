# 0006. 上游 Parent Context 的两阶段补丁策略

日期：2026-04-23
状态：Accepted

## 背景

Phoenix 侧的 session 合并 fallback 已经实现，同时下游透传链路也已经打通：

- `workflow_as_tool/tool.py` 可以生产 `parent_trace_context`
- `app_generator.py` 可以通过 `extras` 携带它
- `persistence.py` 可以把它送进 `TraceTask`
- Phoenix 可以消费 `resolved_parent_context`

但是在真实的 workflow-as-tool 运行里，日志仍然显示：

- `parent_workflow_run_id=None`
- `parent_node_execution_id=None`

根因在更前面的边界：`WorkflowTool._invoke()` 假设这两个值已经存在于 `self.runtime.runtime_parameters` 中，但生产环境里的 runtime 构造逻辑并没有把它们放进去。

排查之后我们发现这两个值的可获得性并不对称：

- `outer_workflow_run_id` 很可能可以从 workflow system variables / variable pool 获得
- `outer_node_execution_id` 目前并没有暴露在 workflow-tool runtime 边界上

这意味着，session 合并问题和 parent span 挂载问题的难度不同，不应该强行合并为同一个补丁。

## 决策

采用两阶段的上游补丁策略。

### 阶段一

在 workflow-tool runtime 构造边界补充 `outer_workflow_run_id`，把它注入 workflow tool 的 runtime parameters。

目标：

- 优先打通顶层 workflow debugging 等 workflow-as-tool 场景下的 nested workflow session 合并

预期结果：

- 现有上游透传链能够拿到父 workflow run identity
- Phoenix 侧的 session 继承逻辑终于可以把 nested workflow 归并到外层 workflow 的同一个 session 下

### 阶段二

单独设计并实现 `outer_node_execution_id` 的边界扩展。

目标：

- 让 nested workflow trace 能稳定挂到外层 tool node span 下

这一阶段大概率需要调整 runtime / protocol 边界，而不是继续增加本地 fallback。

## 决策理由

这个拆分符合 “done is better than perfect” 的推进方式，同时也更稳妥：

- session 合并有明确而直接的用户价值
- `outer_workflow_run_id` 看起来可以在不大改架构的前提下拿到
- `outer_node_execution_id` 是一个结构性缺口，值得单独解决
- 如果强行把两者塞进一个补丁，要么会阻塞当前进展，要么会再次引入大量 heuristic

## 结果与影响

短期内：

- 我们可以先把 session 正确性做出来
- 在阶段二完成之前，nested workflow trace 仍可能缺少精确的父 tool span 挂载关系

中期内：

- 阶段二应当扩展 runtime 边界，让 workflow-as-tool 调用可以显式携带当前 tool node 的 execution identity，而不是依赖数据库或时间窗口推断

## 实施备注

阶段一优先推荐的补丁位置是 workflow-tool runtime 构造层：

- `api/core/workflow/node_runtime.py`

可能的辅助修改点：

- `api/core/tools/tool_manager.py`

一旦 `outer_workflow_run_id` 能在这里暴露出来，后面的下游透传链应尽量保持不变并直接复用。
