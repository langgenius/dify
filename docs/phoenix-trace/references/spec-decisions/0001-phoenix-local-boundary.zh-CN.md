# 0001. 过渡性 Phoenix-Local 实现边界

日期：2026-04-23
状态：v1 已接受

## 背景

prototype 把 hierarchy 逻辑写在 Phoenix-specific tracing adapter 里。

长期来看，架构方向仍然更偏向把 tracing 语义进一步上移标准化；但当前上游 tracing 重构正由其他开发者负责。为了避免冲突、控制范围，这一版重新实现不应修改上游 tracing builder 或 contract。

## 决策

v1 的所有新增实现工作都留在 Phoenix provider 文件中完成。

这具体意味着：

- 不修改 `api/core/ops/ops_trace_manager.py`
- 不修改 `api/core/ops/entities/trace_entity.py`
- 不修改 `api/enterprise/telemetry/enterprise_trace.py`

Phoenix 实现应直接消费上游当前已经产出的结果。

## 影响

### 正面影响

- 避免与正在进行的上游重构发生冲突
- 使实现范围保持收敛
- 可以复用上游已经提供的 parent trace 等上下文

### 代价与折中

- 一些理论上更适合上移的语义，在过渡期内仍然会暂时留在 Phoenix 层中推断或补位
- Phoenix 文件在这一阶段仍会承载一部分面向业务语义的 hierarchy 逻辑

## 面向未来迁移的说明

这个边界是过渡性的，不是最终架构。

实现中的 comment 应明确说明：某些 Phoenix-local 规则之所以存在，仅仅是因为这一阶段不改共享上游 tracing contract。
