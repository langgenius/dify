## Context

Workflow node v2 可以产生 static Contact、one-time Email、dynamic Email 和 current initiator recipients。当前没有单一 domain entry point 同时负责 input validation、Contact upgrade、canonical subject deduplication、matched source retention、debug override 和 delivery endpoint planning。后续调用方若各自拼装这些步骤，会产生 change amplification 与不可预测差异。

本 change 只依赖 Contact Directory snapshot 和 IM Control Plane 暴露的 effective delivery capability facts，不依赖它们的 persistence implementation。

## Goals / Non-Goals

**Goals:**

- 提供一个简单的 `RecipientResolver.resolve(...)` public interface。
- 对合法、非法、重复和 unavailable recipients 产生 deterministic、machine-readable result。
- 将同一 canonical subject 的多个来源与多个 channels 收敛到一个 approver plan。
- 让 pure unit tests 不创建 Flask app 或 database engine。

**Non-Goals:**

- 不创建 Human Input form records。
- 不授予当前 submission authority，也不验证 OTP/session/IM callback。
- 不查询数据库、调用 provider 或写 audit event。
- 不定义 delivery retry 或 notification orchestration。

## Decisions

### 1. Resolver 一次返回完整 approval plan

输入包括 immutable recipient specifications、Contact Directory snapshot、optional current initiator、effective delivery capability snapshot 和 debug override context。输出 `ResolvedApprovalPlan`，包含 canonical approvers、matched sources、subject snapshots、endpoint plans 与 rejected-recipient facts。

调用方不得分阶段调用 normalize、match、deduplicate 和 select endpoint helpers。内部实现可以分函数，但 public API 保持一个入口，以把规则变化留在模块内部。

### 2. Canonical subject key 与 delivery endpoint 分离

Contact、EndUser 和 EmailAddress 使用明确的 typed subject keys。同一个 subject 只有一个 approver plan，但可以保留多个 matched sources 与 Email/IM/Web/Console endpoints。Channel 不参与 subject identity。

Unmatched valid Email 形成 EmailAddress subject；matching Email、static Contact 和 initiator collapse 到 Contact subject。Invalid recipient 不阻断其他合法 recipients，而是形成 stable rejected fact。

### 3. Workflow configuration conversion 位于 domain boundary adapter

显式 adapter 将 workflow node v2 configuration 转换为 recipient specifications。Resolver 不 import controller request/response DTO，也不接受任意 dict。Unsupported dynamic value type 在 conversion/resolution 中形成 typed rejection。

### 4. Debug replacement 不修改保存的 specifications

Debug context 生成 request-scoped effective specifications；原 node configuration immutable。Unavailable current initiator 形成 rejection fact，除非其他有效 approver 不存在才返回 no-valid-recipients。

### 5. Deterministic ordering 是 contract

相同 specifications 和 snapshots 必须产生相同 approver、matched-source、endpoint 与 rejection ordering，避免 form snapshots、tests 和 audit diff 不稳定。Ordering 由 source position 与 canonical key tie-breaker 定义并由 tests 固定。

## Risks / Trade-offs

- [单一 resolver implementation 较深] → 保持 public interface 简单，内部按 validation/matching/planning 私有函数组织，并以 scenario matrix 控制复杂度。
- [Snapshot inputs 较丰富] → 使用 capability-specific immutable types，避免传递 ORM graph 或通用 context bag。
- [Domain adapter依赖 workflow node config types] → 只依赖 versioned core configuration，不依赖 controller transport DTO；转换边界有独立 tests。

## Migration Plan

1. 添加 specification/plan value objects 与 red-first tests。
2. 实现 workflow configuration adapter 和 `RecipientResolver`。
3. 验证 import boundaries、determinism 和 existing node config compatibility。
4. 运行 pure domain tests、lint 和 type checking。

## Open Questions

- 无。Provider-specific channel availability 由 upstream snapshot 预先归一化。
