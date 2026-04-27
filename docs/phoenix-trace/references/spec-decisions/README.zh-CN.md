# Phoenix Hierarchy Spec 决策索引

日期：2026-04-23
状态：决策记录型 spec 草案
读者：正在推进 Phoenix 侧过渡性 hierarchy 实现的开发者

## 目的

这个目录用于把之前较分散的分析笔记，收敛成一组更适合直接进入 implementation plan 的决策记录。

此前的笔记仍然是更详细的证据链；这里的文件则是整理后的决策层。

## 来源笔记

这些决策记录基于以下历史分析文件整理而来：

- `../2026-04-23-prototype-hierarchy-analysis.md`
- `../2026-04-23-prototype-session-rootspan-analysis.md`
- `../2026-04-23-dify-session-id-semantics.md`
- `../2026-04-23-session-id-vs-phoenix-sessions.md`
- `../2026-04-23-ops-trace-manager-vs-prototype.md`
- `../2026-04-23-open-questions-before-spec.md`
- `../2026-04-23-phoenix-local-spec-decisions.md`

## 相关提交

底层分析笔记对应的 commit 如下：

- `b74a60b2c8` `docs: add prototype hierarchy analysis notes`
- `13eaf0b3d7` `docs: add session and root span analysis notes`
- `25274e76d0` `docs: refine orphan root analysis for phoenix sessions`
- `d5d362210d` `docs: add dify session id semantics notes`
- `4e252c2b53` `docs: add session id versus phoenix sessions notes`
- `65dd285d1b` `docs: compare ops trace manager with prototype`
- `f3f37c87df` `docs: add open questions before spec`
- `3649456650` `docs: add phoenix-local spec decisions notes`

## 决策记录列表

### 0001. 过渡性 Phoenix-Local 实现边界

文件：`0001-phoenix-local-boundary.md`

定义 v1 的实现边界：

- 改动留在 Phoenix provider 文件中
- 尽量复用上游已有能力
- 这一阶段不修改上游 tracing builder 或 contract

### 0002. 复用与过渡策略

文件：`0002-reuse-and-transition-strategy.md`

定义复用原则：

- 上游语义优先
- Phoenix 只在必要时补位
- 许多 Phoenix-local 语义只是过渡性实现，未来应上移

### 0003. V1 Hierarchy 范围与 Parent 规则

文件：`0003-v1-hierarchy-scope-and-parent-rules.md`

定义 v1 的覆盖范围和 parent 规则方向：

- 串行节点
- nested workflow
- `if/else`
- `loop`
- `iteration`
- v1 不覆盖 `parallel`
- execution-order heuristic 仅作为最后兜底

### 0004. Canonical Root 与 Session 原则

文件：`0004-canonical-root-and-session-principles.md`

定义：

- canonical root 是硬约束
- workflow / chatflow 的 session 语义
- Phoenix 侧优先复用上游 session 语义，必要时再本地补位

### 0005. Phoenix 中 Nested Workflow 的 Session 继承规则

文件：`0005-nested-workflow-session-inheritance.md`

定义 Phoenix-local 的 nested workflow session 合并规则：

- chatflow 仍然优先使用 `conversation_id`
- nested workflow 通过 `parent_workflow_run_id` 继承外层 workflow session
- session 合并与 session 页面 input/output 缺失属于两个独立问题

### 0006. 上游 Parent Context 的两阶段补丁策略

文件：`0006-two-phase-upstream-parent-context-strategy.md`

定义 workflow-as-tool 缺口排查之后的下一步上游方向：

- 阶段一先补 `outer_workflow_run_id`，优先解开 session 合并
- 阶段二再单独设计 `outer_node_execution_id` 的暴露方式
- 不把 session 正确性和 parent span 正确性强行塞进同一个补丁

### 0007. 跨仓库的 Workflow-Tool Parent Context 透传方案

文件：`0007-cross-repo-workflow-tool-parent-context.md`

定义这次跨仓库改造的所有权边界：

- Graphon 负责 tool runtime contract 和执行上下文暴露
- Dify 负责把 runtime 上下文翻译成 runtime parameters 与 tracing metadata
- 这项功能应作为 Graphon + Dify 的协同改造交付

### 0008. Phoenix 中嵌套 Workflow 挂到父 Tool Span 的解析方案

文件：`0008-phoenix-parent-tool-span-resolution.md`

定义 trace/session 统一之后的最后一层 Phoenix-local 补丁：

- 按 `node_execution_id` 发布已发出的 tool span context
- 通过 `parent_node_execution_id` 解析 nested workflow 的父上下文
- 当 child trace task 先到、父上下文尚未生成时，使用有限次重试而不是第一次就直接退回 root

## 使用方式

这组决策文件应作为 implementation plan 的策略层输入。

- 历史分析请回看旧笔记
- 当前决策请优先引用本目录文件
- 实现中的 comment 应与这里描述的“过渡性”意图保持一致
