## Context

Recipient Resolution 会生成 immutable approval plan，但当前 `HumanInputV2Form`、grant 与 endpoint 仍只有 persistence records。Form active-state、selected-action validation、global expiry 和 first-success transition decision 若继续留在 service/ORM，会迫使 submission、delivery 和 query consumers理解相同状态细节。

本 change 将 Form 建成深 aggregate，但不包含跨 current identity snapshots 的 authorization，也不包含 OTP proof-session lifecycle。

## Goals / Non-Goals

**Goals:**

- 让 `HumanInputForm` 直接拥有 local lifecycle 与 transition invariants。
- 将 approver grant、subject snapshot、delivery endpoint、delivery attempt 和 frozen definition 建模为明确概念。
- 从 `ResolvedApprovalPlan` 创建可持久化 form snapshot，保持 deterministic mapping。
- 提供 operation-oriented form persistence ports、mappers、adapter 和 schema slice。
- 保证逻辑 relationships 不发生 hidden lazy load/N+1。

**Non-Goals:**

- 不验证 current Account/Contact/Email/IM identity。
- 不实现 OTP lifecycle 或 raw credential verification。
- 不提交 authorization audit/submission，也不 enqueue workflow resume。
- 不实现 controller、provider delivery 或 Celery tasks。

## Decisions

### 1. Form aggregate 拥有 lifecycle，不增加 pass-through lifecycle object

`HumanInputForm` 负责 waiting/expired/timeout/submitted active-state、global expiry、grant membership、selected action validation 和 transition decision。Domain method 只返回 decision，不声称 persistence 已成功。

替代方案 `FormLifecycle` 会使用几乎相同的参数转发到 Form state，形成 shallow module，因此不采用。

### 2. Form creation 冻结 plan，但不冻结当前 authority

Approver grant 保存 canonical subject 与 matched-source snapshot；endpoint 保存 channel/address/provider interaction snapshot；frozen form definition 保存 render/validation definition。这些记录用于历史、delivery 和后续 current-state authorization input，但都不自动证明提交权限。

同一 grant 可以有多个 endpoints；endpoint token 只提供 scoped interaction/access capability，不生成 actor 或 verified proof。

### 3. Aggregate load 按操作重建必要状态

Form 是逻辑 consistency boundary，但不要求每次加载 grants、endpoints、delivery attempts、uploads 和 audit graph。Repository 为 creation、lifecycle transition 和 delivery append 提供不同的 operation-specific load/write methods，所有 relationships 明确 eager load 或不加载，保留 `lazy="raise"`。

### 4. Delivery facts append-oriented

Delivery attempt failure 不改变 form status。Email provider configuration 作为 endpoint planning/delivery infrastructure 的 persistence record留在 adapter layer；本 change 不实现 provider I/O。Upload token/file records保持 endpoint-scoped capability semantics。

### 5. Form persistence slice 独立迁移

本 change 迁移 Email provider、form、grant、endpoint、delivery attempt、upload token/file tables。Mapper 不返回 ORM instances，structured JSON values 使用 strict immutable Pydantic types round-trip。

## Risks / Trade-offs

- [Form tables 数量较多] → 它们共享 form/grant/endpoint snapshot knowledge；按表继续拆分会让同一 logical reference 与 lifecycle 决策泄漏。
- [Operation-specific repository methods 比 CRUD 多] → Interface 直接表达 invariant，调用方不再手动拼 transaction 和 eager-loading strategy。
- [Form snapshot 与 current identity 有意不同步] → 命名/docstrings 明确 historical snapshot；current authority 由后续 submission runtime 重新验证。

## Migration Plan

1. 添加 Form/grant/endpoint/domain result tests 与 implementation。
2. 添加 plan-to-form creation mapping、record mappers 和 repository contract tests。
3. 添加 form persistence migration 与 metadata/downgrade tests。
4. 实现 SQLAlchemy adapter、query-count assertions 和 existing v1 regression checks。
5. 回滚时确保不存在 dependent OTP/submission revisions，再 downgrade form revision。

## Open Questions

- 无。Submission transaction 与 OTP replacement 分别由后续 changes 拥有。
