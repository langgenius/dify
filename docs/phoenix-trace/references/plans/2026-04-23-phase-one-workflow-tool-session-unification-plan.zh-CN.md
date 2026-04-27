# 阶段一：Workflow-Tool Session 合并实施计划

日期：2026-04-23
状态：Draft
范围：只覆盖上游阶段一补丁

## 目标

让 workflow-as-tool 执行链暴露出足够的上游上下文，使 nested workflow trace 可以继承外层 workflow 的 session。

这一阶段只解决 session 合并。

这一阶段不尝试解决 nested workflow 精确挂到父 tool span 的问题。

## 为什么需要这份计划

真实运行已经证明，下游透传链只有在 `parent_trace_context` 存在时才能工作。

缺口不在 Phoenix，而在更上游的 runtime parameters 没有提供足够信息去构造 `parent_trace_context`。

在目前缺失的两个值里：

- `outer_workflow_run_id` 看起来现在就能安全获取
- `outer_node_execution_id` 暂时还不能

所以阶段一应当只做当前能稳妥拿到的部分。

## 目标文件

- `api/core/workflow/node_runtime.py`
- 如有需要，`api/core/tools/tool_manager.py`
- 与 workflow tool runtime 构造、workflow-as-tool 调用相关的测试

## 拟议改动

### 1. Runtime 注入

调整 workflow-tool runtime 的构造逻辑，让 workflow-as-tool 调用的 runtime parameters 至少包含：

- `outer_workflow_run_id`

这个值应当从 workflow system variables / variable pool 中读取，而不是在后面再推断。

### 2. 复用现有下游透传链

这一阶段不重设计后半段链路。

继续复用现在已经打通的流程：

- workflow tool 生成 `parent_trace_context`
- app generator 通过 `extras` 携带
- persistence 送入 `TraceTask`
- Phoenix 从 `parent_workflow_run_id` 解析 session 继承

### 3. 不伪造 Node Execution Identity

这一阶段不为 `outer_node_execution_id` 增加 heuristic 或占位值。

如果当前 runtime 边界拿不到它，就明确留给阶段二处理。

## 测试策略

### 单元测试

- 增加或更新 runtime 构造测试，验证 workflow-tool runtime parameters 中包含 `outer_workflow_run_id`
- 保留 workflow-as-tool 测试，验证当 runtime parameters 达到阶段一要求时，能够产出 `parent_trace_context`

### 回归测试

- 重跑现有上游透传链测试
- 重跑 Phoenix 侧定向 workflow session 测试

### 手工验证

使用真实场景：

- 一个顶层 workflow
- 多个发布为工具的 nested workflow

阶段一完成后的预期结果：

- Phoenix 日志里出现 `parent_workflow_run_id=<outer workflow run id>`
- nested workflow 解析出的 `session.id` 与外层 workflow 相同

阶段一仍可接受的状态：

- `parent_node_execution_id` 仍然可能是 `None`
- 父 tool span 挂载仍可能不完整

## 不在本阶段范围内

- 通过 runtime / protocol 边界暴露当前 tool node execution id
- 修改 Phoenix 的 parent-span wiring 规则
- 使用数据库或时间窗口 heuristic 推断 parent node execution id

## 后续工作

阶段一完成并验证后，再单独准备阶段二计划：

- 如何暴露 `outer_node_execution_id`
- 是否需要修改 graphon/runtime protocol
- 如何对 parent-span attachment 做端到端验证
