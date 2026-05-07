# 跨仓库 Workflow-Tool Parent Context 实施计划

日期：2026-04-23
状态：Draft
范围：Graphon + Dify 协同实现

## 目标

让“发布为工具的 nested workflow”能够把外层 workflow 和外层 tool-node execution 的上下文，一路透传到 Phoenix tracing。

## 成功标准

对于一个顶层 workflow 调用多个 nested workflow-as-tool 的场景：

- workflow tool 调用时可以拿到外层 workflow run id
- workflow tool 调用时可以拿到外层 tool node execution id
- Dify 能基于这两个值生成 `parent_trace_context`
- Phoenix 能解析继承 session 和 parent span context

## 任务 1：Graphon Runtime Contract

调整 Graphon 的 tool runtime API，让 tool-node execution 上下文对 workflow adapter 可见。

预期结果：

- runtime 边界不再因为旧版 tool-node 形态而丢掉 `variable_pool`
- 当前 tool node execution id 能在 runtime 创建或调用时被获取

可能涉及文件：

- `src/graphon/nodes/runtime.py`
- `src/graphon/nodes/tool/tool_node.py`
- Graphon 相关 node/runtime 定向测试

## 任务 2：Dify Workflow Adapter 集成

更新 Dify 的 workflow tool runtime 集成逻辑，消费新的 Graphon contract。

预期结果：

- workflow-tool runtime parameters 包含 `outer_workflow_run_id`
- workflow-tool runtime parameters 包含 `outer_node_execution_id`
- 不影响非 workflow 类型的工具

可能涉及文件：

- `api/core/workflow/node_runtime.py`
- `api/tests/unit_tests/core/workflow/test_node_runtime.py`

## 任务 3：Parent Trace Context 构建

更新 workflow-as-tool tracing 输入构造逻辑，使用现在已经完整的上游 runtime parameters。

预期结果：

- `WorkflowTool._invoke()` 能产出 `parent_trace_context`
- 现有 app generator 和 persistence 透传链尽量保持不变或只做最小适配

可能涉及文件：

- `api/core/tools/workflow_as_tool/tool.py`
- `api/tests/unit_tests/core/tools/workflow_as_tool/` 相关测试
- 如果 payload 校验规则变化，可能涉及 helper 测试

## 任务 4：Phoenix 集成验证

对最终 trace 路径做端到端验证。

预期结果：

- Phoenix 日志里出现非空的 `parent_workflow_run_id`
- Phoenix 日志里出现非空的 `parent_node_execution_id`
- nested workflow session 继承生效
- nested workflow 的 parent span 解析具备条件，可继续验证 hierarchy 展示

可能涉及文件：

- `api/providers/trace/trace-arize-phoenix/...`
- 现有 Phoenix 定向单测

## 验证方式

### Graphon

运行最小相关 Graphon 测试，覆盖：

- tool-node runtime 边界
- tool-node execution 上下文暴露

### Dify

运行 Dify 定向测试，覆盖：

- workflow node runtime
- workflow-as-tool
- app generator
- persistence layer
- Phoenix 定向单测

### 手工验证

使用真实 debugger 场景：

- 一个顶层 workflow
- 多个发布为工具的 nested workflow

预期日志形态：

- `parent_workflow_run_id=<outer run id>`
- `parent_node_execution_id=<outer tool node execution id>`

## 交付备注

- `api/pyproject.toml` 中的 editable Graphon 覆盖保持为本地设置，不进入功能提交
- Graphon 改动只从干净的 Graphon worktree 提交
- Dify 改动在 Dify 仓库里单独提交
