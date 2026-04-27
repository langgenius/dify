# Phoenix 嵌套 Workflow 挂到父 Tool Span 的实现计划

日期：2026-04-23
状态：Draft
范围：Dify Phoenix provider 与 trace task 重试路径

## 目标

让 nested workflow span 在 Phoenix 中真正挂到触发它的外层 tool span 下，而不只是共享 trace/session。

## 成功标准

- Phoenix 能按 `node_execution_id` 发布 tool-node span context
- nested workflow 发 span 时会消费 `parent_node_execution_id`
- 当父上下文可用时，child workflow span 会挂到正确的 outer tool span 下
- 当 child trace task 到得过早时，任务会进行有限次重试，而不是第一次就直接退回 synthetic root
- 有针对性的 Phoenix 与 task 测试覆盖 happy path 和 retry path

## 任务 1：父 Span Context Bridge

实现一个 Phoenix-local helper，用于发布和解析父 span 上下文。

预期结果：

- tool node span 能把可恢复的父 span 上下文写入 Redis
- nested workflow 发 span 时能通过 `parent_node_execution_id` 读取已保存的父 span 上下文
- 提供一个专用的 pending-parent 异常，供上层重试流程识别

可能涉及的文件：

- `api/providers/trace/trace-arize-phoenix/src/dify_trace_arize_phoenix/arize_phoenix_trace.py`
- 必要时在同包下增加一个小 helper 模块
- Phoenix 定向单测

## 任务 2：支持重试的 Trace Task 处理

为 Phoenix pending-parent 场景加入有限次重试。

预期结果：

- `process_trace_tasks` 对这一类暂时性时序问题具备 retry 能力
- 安排 retry 时不会提前删除 trace payload 文件
- 到达最终 fallback 时仍会正确清理并留下清晰日志

可能涉及的文件：

- `api/tasks/ops_trace_task.py`
- 如果已有合适测试则补 task 层定向测试，否则新增最小回归覆盖

## 验证

运行聚焦测试：

- Phoenix trace 单测
- 已有 workflow-tool runtime / workflow-as-tool 测试，确认 parent context 传播仍然成立
- ops trace task 的 retry 与 cleanup 行为测试

人工验证场景：

- 一个顶层 workflow
- 在 loop 中触发多个“发布为工具”的 nested workflow

预期 Phoenix 结果：

- 一个 session
- 一棵 trace tree
- nested workflow span 挂到各自对应的 tool span 下，而不是挂到 synthetic `Dify` root 下

## 交付说明

- 继续保持 Phoenix-local、过渡性实现
- 不再改动无关的 upstream 语义
- Redis 协调数据使用较短 TTL
- 优先写紧凑且高价值的定向测试，不盲目扩大全量回归
