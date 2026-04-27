# Prototype 层级关系分析

日期：2026-04-23
背景：需要在当前 `origin/main` 基础上，重新实现 `/Users/yang/Downloads/arize_phoenix_trace.py` 里改进过的 tracing hierarchy 能力。

## 目标

搞清楚 prototype 是如何让 Dify tracing 展示出更好的层级关系，重点包括：

- 子工作流挂在父工具节点下面
- 单个工作流内部的节点不再全部平铺在 workflow root 下，而是尽量体现 node-to-node 的父子关系

## 结论摘要

prototype 的关键不在于“多写了一些 metadata”或“span 名字更好看”，而在于它主动重建了 OTEL span 的父子关系。

它主要做了两层 hierarchy：

1. 跨工作流层级
   子工作流 span 挂到父工作流里的 tool span 下面，并复用父 trace ID。
2. 工作流内部层级
   节点 span 优先按 workflow graph 的边关系确定父节点，不够时再用执行顺序做回退。

## 第一层：跨工作流层级

### 核心行为

在 `workflow_trace()` 中，prototype 会先判断当前 workflow run 是否是被另一个 workflow 以工具方式调用的子工作流。

如果是：

- 不再新建独立 trace，而是复用父 trace ID
- 使用父 tool span 的 span ID 作为 parent context
- 子 workflow span 在这个 parent context 下启动

相关代码位置：

- `/Users/yang/Downloads/arize_phoenix_trace.py:207`
- `/Users/yang/Downloads/arize_phoenix_trace.py:210`
- `/Users/yang/Downloads/arize_phoenix_trace.py:269`
- `/Users/yang/Downloads/arize_phoenix_trace.py:288`

### 父工作流上下文如何确定

prototype 有两种来源：

1. 优先读取 metadata 中显式传入的字段
   - `parent_trace_id`
   - `parent_span_id`
2. 如果没有，再通过数据库反查
   - 先确认子 app 是否注册为 workflow tool
   - 再按时间窗口寻找可能触发它的父 tool execution

相关代码位置：

- `/Users/yang/Downloads/arize_phoenix_trace.py:1226`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1255`

### tool 节点如何与子工作流关联

prototype 在处理 tool 节点时，会尝试识别这个 tool 是否触发了一个 child workflow。

识别顺序大致是：

1. 在 `outputs` 中查直接的 workflow 标识
2. 在 `process_data` 中查 workflow 执行痕迹
3. 不够时按时间窗口去匹配最近创建的 `WorkflowRun`

它还会尽量避免把同一个子工作流错误地分配给同一父 workflow 中的多个 tool。

相关代码位置：

- `/Users/yang/Downloads/arize_phoenix_trace.py:1664`

### 为什么这样能改善 hierarchy

因为 OTEL parent context 被显式设置了，Phoenix 才能真实显示出：

- 外层 workflow root
- tool span
- 嵌套的 child workflow root
- child workflow 自己的节点

而不是把 child workflow 显示成一个完全独立的 trace，或者只是一个平铺的兄弟节点。

## 第二层：工作流内部节点层级

### 核心行为

在单个 workflow 内部，prototype 并没有把所有 node span 都直接挂到 workflow span 下。

它会尝试重建更接近真实执行流的 node hierarchy。

相关代码位置：

- `/Users/yang/Downloads/arize_phoenix_trace.py:298`
- `/Users/yang/Downloads/arize_phoenix_trace.py:456`

### 层级关系的数据来源

prototype 综合了多种信号：

1. Workflow graph 边关系
   把保存下来的图结构转成 `target -> source` 映射。
2. 决策路径修正
   对 classifier / if-else 这类分支节点修正父子关系。
3. Loop 修正
   对循环执行场景修正父子关系。
4. 执行顺序回退
   如果图上的父节点当前还没创建 span，就退化成选择“最近一个已创建且 index 更小的 span”作为父节点。

相关代码位置：

- `/Users/yang/Downloads/arize_phoenix_trace.py:1182`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1211`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1215`
- `/Users/yang/Downloads/arize_phoenix_trace.py:1819`

### prototype 中能看到的父节点选择规则

对于每个 node span：

- `start` 节点直接挂在 workflow span 下
- `end` 节点尽量挂到最后执行的非 end 节点下面
- 如果图上的父节点已经处理过，就直接挂到那个父节点 span 下
- 对 `tool`、`llm`、`http-request` 这类执行型节点，找不到图父节点时，回退到最近一个更早执行的 span
- 其他情况默认直接挂到 workflow span 下

相关代码位置：

- `/Users/yang/Downloads/arize_phoenix_trace.py:460`
- `/Users/yang/Downloads/arize_phoenix_trace.py:480`
- `/Users/yang/Downloads/arize_phoenix_trace.py:487`

### 为什么这样能改善 hierarchy

这样展示出来的 trace tree 会更像真实执行流，而不是“所有节点都平铺在 root 下的一包 spans”。它尤其改善了以下场景：

- 分支节点
- 循环节点
- 串联的 tool / LLM 执行
- 表示某条路径收束的 end 节点

## 一个关键细节：稳定的确定性 ID

prototype 使用了稳定的哈希 ID：

- trace ID 来自 `trace_id` 或 `workflow_run_id`
- workflow span ID 来自 `workflow_run_id`
- node span ID 来自 `workflow_run_id + node_execution_id`

相关代码位置：

- `/Users/yang/Downloads/arize_phoenix_trace.py:95`
- `/Users/yang/Downloads/arize_phoenix_trace.py:111`
- `/Users/yang/Downloads/arize_phoenix_trace.py:222`
- `/Users/yang/Downloads/arize_phoenix_trace.py:227`
- `/Users/yang/Downloads/arize_phoenix_trace.py:438`

这很重要，因为后续的 hierarchy 重建依赖稳定的 span identity。

## 与当前 `origin/main` 的对应关系

当前 `origin/main` 其实已经具备了跨工作流 hierarchy 的关键构件。

### 目前已经存在的部分

`BaseTraceInfo.resolved_parent_context` 会从 `metadata["parent_trace_context"]` 中解析出类型化的父上下文信息。

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/core/ops/entities/trace_entity.py:50`

`EnterpriseOtelTrace._workflow_trace()` 会把以下两个关键参数继续传给 exporter：

- `trace_correlation_override`
- `parent_span_id_source`

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/enterprise_trace.py:184`

`export_span()` 已经支持：

- 使用外层 workflow 的 trace correlation
- 基于显式 parent span source 构造 non-recording parent span context

相关代码：

- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/exporter.py:184`
- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/exporter.py:209`

另外，当前 README 也明确写了 nested sub-workflow 的目标形态。

相关文档：

- `/Users/yang/.codex/worktrees/ace8/dify/api/enterprise/telemetry/README.md:66`

### 相比 prototype 目前可能还缺什么

和 prototype 相比，当前 `origin/main` 看起来已经支持：

- 子工作流挂到父 tool span 下

但很可能还没有实现 prototype 的第二层能力：

- 同一 workflow 内部基于 graph 与执行顺序重建 node-to-node hierarchy

当前 exporter 的默认行为更像是：

- 同一 workflow 下的节点默认都挂在 workflow root span 下

除非额外显式提供其他 parent。

## 对后续重实现的直接启发

如果我们要在 `origin/main` 上把 prototype 的两层 hierarchy 都带回来，比较自然的做法是把它拆成两个问题分别处理：

1. 确认并保留现有的跨工作流父子传播
   - parent workflow run ID
   - parent node execution ID
   - nested workflow 与 outer workflow 共享 trace ID
2. 补上工作流内部 node hierarchy 重建
   - 大概率会落在 workflow node tracing 路径
   - 依据 graph 结构并辅以执行顺序 fallback

## 当前工作假设

prototype 真正重要的创新并不是 span naming。

真正关键的是：

- 通过共享 trace ID 和显式 parent tool span 建立跨工作流层级
- 通过 graph / execution relationship 重建单个 workflow 内部的节点层级

这两点才是我们在 `origin/main` 上需要保留和重实现的核心行为。
