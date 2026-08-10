# Reconciliation Property Checklist

## Scope

本清单只约束 IM identity 与 IM binding pure reconciliation：

`ReconciliationInput -> ReconciliationPlan | BlockedReconciliation`

除 convergence 外，PBT 直接观察 plan 或 blocker。Convergence 使用测试侧的最小 pure projector 把 typed mutations 投影成下一轮 logical state。projector 不执行 email matching、不选择 Contact，也不复用 planner internal indexes 或 matching helpers。

projector MAY 为新 identity 与新 binding 分配 deterministic test-only IDs，以便构造下一轮 `ReconciliationInput`。这些 synthetic IDs 不表达 production persistence allocation，不进入 semantic equality；projector 只需保持引用闭合与跨两轮稳定。

数据库事务、Organization-scoped Redis write lock、ORM mapping、worker delivery 与 Provider I/O 不属于 PBT。它们由 SQLite-backed unit tests 与 Testcontainers PostgreSQL/Redis integration tests 覆盖。

## Observables

- `structural result`：同一 input 重放时比较 immutable plan 或 blocker value 的结构化相等。
- `semantic plan`：比较 mutation kind、logical endpoint、reason、result type 与 operation key，忽略 phase 内无业务含义的 tuple 顺序和 projector synthetic IDs。
- `projected state`：比较 identity natural keys、profiles 与 binding endpoints，用于验证引用闭合、partial bijection 与 convergence。
- `business outcome`：按 Directory entry、IM binding 与 Contact logical key 观察 `Added`、`Not Matched`、`Removed` 和 `Skipped`。

任何性质都不要求 JSON、pickle 或其他 serialized bytes 相等。

## Generated Domains

### Valid domain

一个 composite strategy 生成满足以下约束的 relationship graph：

- [ ] `D-V01` 所有 input values 属于同一个 `ReconciliationRunRef` namespace。
- [ ] `D-V02` Directory Provider user IDs 唯一；current identity IDs 与 natural keys 分别唯一。
- [ ] `D-V03` `contacts_for_email_matching` 中 Contact IDs 与 non-null normalized emails 分别唯一。
- [ ] `D-V04` current binding IDs 唯一，每条 binding 引用一个 current identity；同一 identity MAY 被多个 non-reconciled bindings 引用。
- [ ] `D-V05` `reconciled_binding_ids` 是 current binding IDs 的子集，且选中的 Identity-to-Contact graph 是 partial bijection。
- [ ] `D-V06` reconciled binding 的 Contact MAY 缺席 `contacts_for_email_matching`；该集合只约束 create/replace。
- [ ] `D-V07` generator 覆盖 empty、directory-only、current-only、overlap 与最小非空 graph。

### Business ambiguity and recovery subdomains

从 valid graph 定向派生：

- [ ] `D-A01` missing email 或没有 Contact match。
- [ ] `D-A02` 多个尚无 reconciled binding 的 Directory entries 使用同一 normalized email。
- [ ] `D-A03` email 命中的 Contact 已绑定到仍在 Directory 中的 identity。
- [ ] `D-A04` absent identity、唯一 replacement entry 与其他竞争 entry 的组合。
- [ ] `D-R01` 显式注入 duplicate Contact normalized email；该状态违反 input invariant，但按保守恢复规则返回 plan 而不是 blocker。

`D-R01` 中已有 reconciled binding 仍按 Provider user ID 保留。只有尚无 reconciled binding、因 collision 无法安全创建或替换 binding 的 entries 产生 `Not Matched(ambiguous_contact_email)`；warning data 包含全部 collision-related identity refs 与全部 collision Contact IDs。

### Invalid structural subdomains

每个 generated invalid case 只从 valid graph 注入一个明确 violation：

- [ ] `D-I01` duplicate Directory Provider user ID。
- [ ] `D-I02` duplicate current identity natural key 或 identity ID。
- [ ] `D-I03` duplicate binding ID 或 dangling identity reference。
- [ ] `D-I04` `reconciled_binding_ids` 不是 current binding IDs 的子集，或选中的 bindings 违反 partial bijection。

多个 violation 的 aggregation 不作为 PBT release gate；确有稳定诊断 contract 的组合使用少量 example tests。

## Required Properties

### `P-01 Valid-plan closure and conservation`

对 valid、business ambiguity 或 `D-R01` input，planner 不抛异常并返回 `ReconciliationPlan`。同一个 property 验证：

- 每个 Directory Provider identity 恰好有一个 `CREATE`、`UPDATE` 或 `REFRESH`；
- identity deletion targets 恰好是 current identity natural keys 减去 Directory natural keys；
- plan 中每个 identity reference 均能解析为 current identity 或同一 plan 的 identity create；
- 删除 identity 前，每个引用它的 current binding 恰好被 delete 或 replace 一次；
- projected state 不存在 dangling binding，reconciled binding graph 仍是 partial bijection；
- projected identity natural keys 恰好等于 Directory natural keys。

这是主要 preservation/closure law，不要求测试侧重新实现完整 matching decision table。

### `P-02 Determinism and input permutation invariance`

相同 immutable input 重放产生结构上相等的 result。分别重排 directory entries、current identities、current bindings 与 `contacts_for_email_matching` 后，`semantic plan` 或 blocker semantics 不变。结果不依赖 clock、random ID、hash iteration 或 external state。

### `P-03 Projection convergence`

把 valid `ReconciliationPlan` 投影到 logical state 后，以相同 Directory、`contacts_for_email_matching` 和 Integration revision 开启下一 run：

- 第二份 plan 不包含 binding mutation 或 identity deletion；
- 每个 Directory entry 只产生 `REFRESH` identity upsert；
- preserved reconciled binding 产生 `Skipped`，unbound entry 保持相同 `Not Matched` business outcome。

### `P-04 Existing-binding and override non-interference`

在 transformed input 仍满足 valid-domain invariants 的前提下：

- identity 仍在 Directory 时，已有 reconciled binding 不因 profile email、email-match membership 或无关 graph component 变化而迁移；
- identity 仍在 Directory 时，不在 `reconciled_binding_ids` 中的 bindings 不参与 automatic matching，也不被删除；
- identity 消失时，引用它的 reconciled and non-reconciled bindings 全部满足 `P-01` 的 binding-reference closure。

### `P-05 Safe binding mutation`

每个 binding create/replace 只需满足可独立检查的必要条件：

- target Contact 来自 `contacts_for_email_matching`；
- normalized email match 唯一，且 logical post-upsert reconciled graph 中没有仍有效的 competing binding；
- create target identity 尚无 reconciled binding；
- replacement old identity 不在 Directory，new identity 在 Directory 且尚无 reconciled binding；
- planner 不抢占指向仍在 Directory 中 identity 的 Contact；
- Provider 或 Contact email ambiguity 不按 tuple order 选择 winner。

该 property 不构造一个重新决定所有 expected mutations 的 reference planner。

### `P-06 Result and operation-key consistency`

- binding create 对应 `Added`；delete 对应 `Removed`；replace 对应 previous `Removed` 与 replacement `Added`；
- unbound identity deletion 不产生 `Removed`；preserved reconciled binding 产生 `Skipped`；
- mutation operation keys 在 mutation stream 内唯一，result operation keys 在 result stream 内唯一；
- 相同 semantic operation 在相同 input 重放或 input permutation 后保持相同 key，且 key 不依赖 tuple index、clock 或 persistence-generated ID。

### `P-07 Single-violation blocker soundness and completeness`

从 valid graph 注入一个 `D-I01` 至 `D-I04` violation 时，planner 返回包含对应 code 的 `BlockedReconciliation`，且不携带可执行 plan。每个 blocker 必须能由注入的 violation 解释。`D-A01` 至 `D-A04` 与 `D-R01` 不产生 whole-plan blocker。

## Example Tests That Must Remain

PBT 不替代以下可读的 decision-table 与 regression tests：

- [ ] `E-01` Provider user ID 优先于冲突 email。
- [ ] `E-02` unmatched Provider entry 仍创建 identity。
- [ ] `E-03` duplicate Contact email 不自动选择；已有 binding 保留，尚无 binding 的 affected entries 产生 `Not Matched`，warning data 包含全部 collision-related identity refs 与 Contact IDs。
- [ ] `E-04` 两个 Provider identities 竞争一个 Contact 时全部不匹配。
- [ ] `E-05` Contact 已绑定到仍在 Directory 中的 identity 时不被抢占。
- [ ] `E-06` identity absent from Directory 时的唯一 replacement。
- [ ] `E-07` 已绑定 Contact 不在 `contacts_for_email_matching` 中时保留 binding。
- [ ] `E-08` identity deletion 清理 Organization binding 与 workspace overrides。
- [ ] `E-09` unbound identity deletion 不产生 product `Removed`。
- [ ] `E-10` 每种 structural blocker 的最小 human-readable case；只有 contract 明确时才增加 multi-violation aggregation examples。
- [ ] `E-11` executor 解析 `D-R01` warning identity refs，coordinator 记录完整 identifiers 且不记录 raw email 或 Contact profile。

`E-11` 属于 executor/coordinator unit tests，不属于 pure planner PBT。

## Implementation Checklist

- [ ] `T-01` 使用一个 Hypothesis composite strategy 生成 valid relationship graph，再通过小型 transforms 派生 ambiguity、`D-R01` 与 single-violation invalid inputs。
- [ ] `T-02` generator、projector 和 properties 不导入 ORM、repository、Provider adapter、Flask app 或 database fixture。
- [ ] `T-03` projector 只解释 typed mutations；新 identity/binding 使用 deterministic test-only IDs，且 semantic assertions 忽略这些 synthetic IDs。
- [ ] `T-04` 实现 `semantic plan` observable，不通过 serialized bytes 比较结果。
- [ ] `T-05` generator 通过构造保持 domain preconditions，不使用 broad `assume()` 丢弃大量 examples。
- [ ] `T-06` PBT 覆盖 `P-01` 至 `P-07`；一个 property function MAY 同时验证同一 law 下的强相关 assertions。
- [ ] `T-07` 首版不要求 `RuleBasedStateMachine` 或任意长度 sequence PBT；`P-03` 的 two-run projection 足以作为 release gate。只有真实 multi-run regression 或新增 stateful policy 时再引入 stateful PBT。
- [ ] `T-08` decision-table、warning、blocker 与历史 regression cases 保留独立 example-test names。
- [ ] `T-09` pure planner suite 保持至少 95% statement coverage 与至少 95% branch coverage；PBT 不承担填满所有 coverage branch 的职责。
- [ ] `T-10` CI failure 必须输出 Hypothesis minimized falsifying example 或 reproduction blob；不强制依赖固定 seed。
