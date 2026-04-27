# 0004. Canonical Root 与 Session 原则

日期：2026-04-23
状态：v1 已接受

## 背景

此前对 prototype 的分析强烈表明，Phoenix session 问题不仅和 session 传播不一致有关，也和 trace 被输出成 orphan-root 而不是干净 canonical root 有关。

与此同时，Dify 中的 session 语义已经可以在产品层面明确下来，不应被当作 Phoenix 专属概念。

## 决策

### Canonical Root 是硬约束

顶层 workflow 或 chatflow span 必须以真正无 parent 的方式输出，不能再伪造 parent context。

只有 nested workflow 允许显式挂到 outer tool span 下。

Phoenix-local 的 hierarchy 重建不能给顶层 root span 分配合成 parent。

### Session 语义

在 v1 中，session 规则如下：

- 顶层 workflow：`session.id = workflow_run_id`
- 顶层 chatflow：`session.id = conversation_id`
- nested workflow：继承外层 session identity

### Session 处理的上游优先原则

只要上游已经提供可用的 session 语义，Phoenix 就应优先复用。

如果上游没有显式 session 字段，但现有 metadata 足以推导，Phoenix 才允许按上述规则进行本地 fallback。

Phoenix 不应发明一套与 Dify 业务语义相冲突的 session 模型。

## 面向未来迁移的说明

session fallback 逻辑和 canonical-root 保护逻辑都属于未来可能上移标准化的候选内容。

在实现中，适合通过 comment 明确标注这种未来迁移目标。
