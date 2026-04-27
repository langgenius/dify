# 0002. 复用与过渡策略

日期：2026-04-23
状态：v1 已接受

## 背景

当前代码库里已经有一部分 tracing 语义被上游标准化了，尤其是跨 workflow 的 parent context 传播。如果 Phoenix 再重新实现一遍，会增加分叉，并让未来迁移更困难。

与此同时，workflow 内部 hierarchy 还没有被完整上移，因此 v1 里仍然需要 Phoenix-local 实现。

## 决策

v1 的复用原则是：

- 上游语义优先
- Phoenix 只在必要时补位

这意味着：

- 如果上游已经表达了稳定语义，Phoenix 应直接信任并复用
- 如果上游还不足以支撑 Phoenix 目标行为，Phoenix 才允许进行本地 fallback
- Phoenix 不应重新定义上游已经稳定下来的业务语义

## 什么算“上游优先”

在 v1 中，Phoenix 应优先复用：

- trace identity 与 trace correlation 结果
- 跨 workflow 的 parent trace context
- 上游已表达出的 session 语义
- 现有 workflow 与 trace metadata

## v1 中仍然保留在 Phoenix 侧的内容

在 v1 中，Phoenix 仍可本地实现：

- workflow 内部 hierarchy 重建
- node-parent 规则执行
- Phoenix-specific 的 span naming
- 面向 Phoenix UI 的 metadata polish

## 面向未来迁移的说明

Phoenix 侧的 hierarchy 和 session fallback 逻辑有相当一部分是过渡性的。

实现中的 comment 应明确把这些区域标记为未来上移候选。
