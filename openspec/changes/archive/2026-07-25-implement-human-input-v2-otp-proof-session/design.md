## Context

OTP resend、expiry、send/attempt limits 和 verification 与 form submission 使用不同锁作用域。当前 OTP record 已存在，但 lifecycle 主要由字段与 ORM docstring暗示；如果把逻辑加入 Form aggregate，任何 resend/attempt 都会扩大 form transaction，并混淆 proof session 与 current grant authorization。

本 change 在 Form Core 已提供 form/grant identities 后实施，并向 Submission Runtime 输出不可复用的 verified Email proof。

## Goals / Non-Goals

**Goals:**

- 用独立 `OTPChallenge` aggregate 表达 proof-session lifecycle。
- 保证同一 form/grant scope 只有一个 current usable challenge。
- 隔离 plaintext code、hashing 与 clock concerns。
- 提供 grant-scoped atomic replacement port、mapper、adapter、migration 和 concurrency evidence。
- 让成功 verification 产生 Submission Runtime 可消费的 immutable proof。

**Non-Goals:**

- 不授权或提交 form。
- 不发送 Email、不实现 provider adapter 或 controller。
- 不改变 form lifecycle。
- 不让 raw OTP 或 hash 进入 authorization audit snapshot。

## Decisions

### 1. OTPChallenge 是 separate aggregate

Business scope 是 `(form_id, approver_grant_id)`。Aggregate 负责 10-minute expiry、60-second resend cooldown、five-send limit、five-attempt limit、successful verification、invalidation 和 terminal state。Form 只提供 scope identity，不参与 counters。

### 2. Plaintext 与 hashing 在 port boundary

Domain 不持久化 plaintext code。Hash/verify 与 clock 通过窄 ports 注入，tests 使用 deterministic fakes。Successful verification 生成只包含 challenge identity、grant scope、verified normalized Email 和 timestamp 的 immutable proof。

### 3. Replacement 使用 grant-scoped lock

Adapter 锁定稳定的 approver grant row，在同一 transaction 中校验 cooldown/limit、invalidate previous pending challenge、创建 replacement 并 append relevant audit fact。任一 hash/audit/write failure 回滚全部 mutation。

### 4. Verification 仍需 current authorization

OTP proof 只证明某 normalized Email 在某时刻完成 challenge。Submission Runtime 必须重新比较 current grant subject/Contact Email；Contact deletion、same-email recreation 或 Email change 均可使 proof stale。

### 5. OTP schema 独立迁移

本 change 只添加 OTP challenge table/revision，并复用 Form Core 的 form/grant rows 作为 logical lock scope。Mapper 保持 hash 与 structured values 不泄漏到 domain public output。

## Risks / Trade-offs

- [Grant row lock 串行化同一 approver的 resend/verify] → 这是 exactly-one-current-challenge invariant 所需；不同 grants 可并行。
- [Clock-dependent tests 容易不稳定] → 所有 domain tests 注入 fixed clock，repository tests显式设置 timestamps。
- [Verification proof 随 current identity 变化而失效] → 这是设计目标；historical challenge 保留但不等于 current authority。

## Migration Plan

1. 添加 lifecycle/rejection tests 与 `OTPChallenge` implementation。
2. 添加 hash/clock ports、proof output 和 mapping tests。
3. 添加 OTP migration、grant-scoped adapter 和 rollback contract tests。
4. 添加 PostgreSQL concurrent resend coverage，运行 targeted tests/lint/type check。
5. 回滚时先停止 OTP routes/workers，再 downgrade OTP revision；Form Core tables 保留。

## Open Questions

- 无。Email delivery orchestration由后续 implementation change 接入。
