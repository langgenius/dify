## Phoenix 侧 Spec 决策记录

日期：2026-04-23
背景：在重新讨论遗留问题后，把已经拍板的设计决策记录下来。这一版实现刻意限制在 Phoenix provider 侧，不去介入其他人正在推进的上游重构。

### 1. 实现边界

第一版实现应当留在 Phoenix tracing 文件中完成。

这意味着：

- 复用上游已经存在的能力
- 不修改 `ops_trace_manager.py`
- 不修改 `trace_entity.py`
- 不修改 `enterprise_trace.py`

Phoenix 侧可以消费现有的上游标准化字段，例如：

- `parent_trace_context`
- `resolved_parent_context`
- 现有 trace / workflow metadata

### 2. 职责划分

当前确认的分工是一个折中模型：

- 跨 workflow 的 parent / trace / session 传播，尽量复用上游已有数据
- workflow 内部的 node hierarchy，继续在 Phoenix 文件中重建

也就是说，Phoenix provider 仍然负责 workflow 内部层级重建，但不再重复实现上游已经具备的跨 workflow 上下文传播。

### 3. Phoenix 侧允许做的事

在 v1 中，Phoenix 文件允许：

- 读取 workflow graph 结构
- 解释 workflow node 之间的关系
- 针对支持的 workflow 结构重建 node-to-node hierarchy

在 v1 中，应尽量避免反过来要求新增上游 contract。

### 4. Node-Parent 规则方向

当前拍板的方向是：

- execution-order heuristic 不作为主规则
- 优先使用 runtime-actual parent
- graph parent 作为结构化 fallback
- workflow root 作为安全 fallback
- execution-order heuristic 只作为最后兜底，最好限制在非常窄的场景里

简化后就是：

1. runtime actual parent
2. graph parent
3. workflow root
4. execution-order heuristic 仅在绝对必要时才启用

### 5. V1 支持范围

第一版应支持：

- 顶层 workflow
- 顶层 chatflow
- nested workflow
- 串行节点链路
- `if/else`
- `loop`
- `iteration`

第一版暂不显式覆盖：

- `parallel`
- 更复杂的并发汇合场景

### 6. Canonical Root 要求

第一版必须把 canonical root 正确性当作硬约束。

规则是：

- 顶层 workflow 或 chatflow trace 的 root span 必须以真正无 parent 的方式创建
- 只有 nested workflow 允许显式挂到 outer tool span 下
- Phoenix 侧的 hierarchy 重建不能再像 prototype 一样，为顶层 root span 伪造 parent context

这一决定来自此前对 prototype 的分析：

- prototype 很可能生成的是 orphan-root trace，而不是 canonical-root trace
- 这种行为很可能是 Phoenix session 视图中 `rootSpan` 无法正常解析的原因之一

### 7. 总体方向

这一版 v1 方案刻意保持保守：

- 上游已经表达清楚的业务语义就复用上游
- 新的 hierarchy 重建逻辑留在 Phoenix 实现中
- 优先保证正确性和可解释性，而不是扩大 heuristic 猜测范围
- 先排除 `parallel`，避免重新把 parent 规则拖回高 heuristic 的实现方式

### 8. 仍然留待后续的问题

即使做出了这些决策，仍有一些细节故意留到 implementation plan 阶段再定：

- 针对每种支持的 node 类型，现有上游字段是否足够
- 每一类 node 的精确 parent 规则
- loop 和 iteration 的 runtime context 在实现中该如何解释
- canonical root、hierarchy、session grouping 的验证清单如何定义

### 总结

当前 spec 方向可以总结为：

- 在 Phoenix 侧实现
- 上游已有能力尽量复用
- workflow 内部 hierarchy 继续在 Phoenix 文件中重建
- v1 支持串行流、nested workflow、`if/else`、`loop`、`iteration`
- v1 明确不覆盖 `parallel`
- canonical root 正确性是不可妥协的约束
