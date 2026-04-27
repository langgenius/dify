# 0003. V1 Hierarchy 范围与 Parent 规则

日期：2026-04-23
状态：v1 已接受

## 背景

这次重新实现希望保留 prototype 中真正有价值的 hierarchy 行为，同时避免继续依赖 prototype 那种偏重 execution-order 猜测的方式。

第一版应聚焦真实使用中最重要的 workflow 结构，并尽量让规则保持可解释、可测试。

## 决策

### V1 支持范围

V1 应支持以下 hierarchy 重建：

- 顶层 workflow
- 顶层 chatflow
- nested workflow
- 串行节点链路
- `if/else`
- `loop`
- `iteration`

### V1 明确不覆盖的范围

V1 不显式覆盖：

- `parallel`
- 更复杂的并发汇合模式

## Parent 规则方向

V1 的 parent 选择方向是：

1. runtime actual parent
2. graph parent
3. workflow root
4. execution-order heuristic 仅作为最后兜底

## 规则意图

### Start 节点

`start` 节点应直接挂在当前 workflow span 之下。

### 串行节点

串行节点应优先挂到运行时真正触发它的父节点下。如果无法可靠判定，则可以使用 graph parent；如果两者都不可靠，则安全回退到 workflow root。

### 分支节点

对于 `if/else` 这类分支结构，运行时实际命中的分支应优先于静态 graph 带来的歧义。

### Loop 与 Iteration

对于 `loop` 与 `iteration`，实现应尽量保持运行时局部结构，不应仅因为时间接近，就把不同轮次的节点错误串联起来。

### End 节点

如果能可靠识别最终汇入 `end` 的上游节点，则 `end` 可以挂到该节点下；否则应安全挂到 workflow root，而不是依赖激进猜测。

## 反目标

execution-order heuristic 不应成为主要建模方式。

它可以作为非常窄的兜底存在，但 v1 不能建立在“挂到最近执行节点”这种通用规则之上。
