# Dify 中 `session.id` 的统一语义

日期：2026-04-23
背景：为 Phoenix tracing 明确 Dify 中 `session.id` 的正确语义。

## 目标

建立一条在 Dify 中统一且稳定的 `session.id` 规则，覆盖：

- Workflow app
- Chatflow app
- 通过 workflow tool 触发的嵌套 workflow

## 核心结论

`session.id` 应该跟随“顶层用户可感知的执行容器”，而不是当前局部嵌套 workflow 自己的 run ID。

因此规则应该是：

1. 顶层 Workflow app
   `session.id = workflow_run_id`
2. 顶层 Chatflow app
   `session.id = conversation_id`
3. 无论哪种模式下的嵌套 workflow
   都应该继承外层 session ID，而不是用自己新的 `workflow_run_id` 重新定义 session

## 为什么这条规则符合 Dify

Phoenix 的 session 本质上是把多条 traces 聚合进同一个逻辑会话里。

而在 Dify 中，“会话”的自然语义随 app mode 不同而不同：

- Workflow app：每一次 run 都是一个独立执行
- Chatflow app：多次 workflow run 共同属于同一段对话

所以 session 边界本来就应该随 mode 不同而变化。

## Workflow App 的语义

### 期望的 session 含义

对于 workflow app，session 应该表示“一次 workflow 执行”。

因此：

- `session.id = workflow_run_id`

### 源码证据

workflow 的对外响应稳定暴露 `workflow_run_id` 作为主执行标识。

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/workflow/generate_response_converter.py:47`

workflow 执行初始化时，会显式生成 `workflow_run_id`，然后把它作为 workflow execution identity 使用。

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/workflow/app_generator.py:166`

`WorkflowRun` 模型本身就是 workflow 执行记录，它的主键 `id` 就是 workflow run identity。

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/models/workflow.py:737`

### 解释

这说明在 workflow mode 下，最自然的外层执行容器就是 workflow run 本身，因此 `workflow_run_id` 就是正确的 session identity。

## Chatflow 的语义

### 期望的 session 含义

对于 chatflow，session 应该表示“整段持续对话”，而不是单轮 workflow 执行。

因此：

- `session.id = conversation_id`

### 源码证据

advanced chat 的 blocking 和 streaming 响应都会稳定返回 `conversation_id`。

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/advanced_chat/generate_response_converter.py:26`
- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/advanced_chat/generate_response_converter.py:63`

chatflow 的运行 payload schema 也把 `conversation_id` 当作一等输入字段。

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/controllers/console/app/workflow.py:117`

在内部实现里，每一轮 chatflow 消息又会关联一个 `workflow_run_id`。这个 run ID 描述的是“这一轮”的执行，而不是整段会话。

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/advanced_chat/generate_task_pipeline.py:356`
- `/Users/yang/.codex/worktrees/ace8/dify/api/core/app/apps/advanced_chat/generate_task_pipeline.py:364`

`Message` 模型里同时保存了：

- `conversation_id`
- `workflow_run_id`

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/models/model.py:1392`
- `/Users/yang/.codex/worktrees/ace8/dify/api/models/model.py:1430`

### 解释

这两个字段的分工很清楚：

- `conversation_id` 标识多轮对话会话
- `workflow_run_id` 标识某一轮对应的单次执行

所以在 chatflow 模式下，Phoenix 的 session key 应该用 `conversation_id`。

## 嵌套 Workflow 的语义

### 核心规则

嵌套 workflow 不应该重新定义 session 边界。

它应该继承顶层模式已经确定好的 session identity。

也就是说：

- 顶层是 workflow app 时，嵌套 workflow 继承外层 `workflow_run_id`
- 顶层是 chatflow 时，嵌套 workflow 继承外层 `conversation_id`

### 为什么

嵌套 workflow 是更大一层用户可见执行过程中的内部实现细节。

如果每个嵌套 workflow 都使用自己新的 `workflow_run_id` 作为 `session.id`，Phoenix session 会被切碎：

- 一次顶层执行会被拆成多个 session
- session 视图将不再对应用户真正感知的会话边界

## 最终规则

正确的 session identity 应该由最外层 invocation mode 决定：

- 最外层 mode = workflow
  使用 `workflow_run_id`
- 最外层 mode = chatflow
  使用 `conversation_id`
- 所有嵌套 workflow / tool 调用
  原样继承外层 session identity

## 对 tracing 实现的直接启发

tracing 系统不应该在每条 trace path 上都根据“当前局部 workflow run”重新计算 `session.id`。

更合理的做法是：在最顶层请求上下文中先解析出一个统一的 session identity，然后在整条调用链中复用它，包括：

- root workflow span
- 子 node spans
- 嵌套 workflow spans
- 嵌套 workflow 内部的子 spans

## 当前建议

当我们在 `origin/main` 上重做 Phoenix session 支持时，应该引入一条统一的 resolved session identity 规则：

- 在顶层 app mode 边界只解析一次
- 在嵌套 workflow 中继续传播
- 对同一逻辑 session 内的所有 spans 一致使用

这样 Phoenix 的 session grouping 才会和 Dify 产品本身的语义保持一致。
