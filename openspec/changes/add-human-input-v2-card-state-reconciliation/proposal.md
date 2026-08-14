## Why

Human Input v2 已经分别定义 submission transaction、Form lifecycle、IM card callback decoding 和 Provider-neutral card replacement，但缺少一个 application-level owner 在 Form 的 terminal handling outcome 成功 commit 后，将结果同步到该 Form 已投递的全部动态 IM card instances。这个缺口不应由 submission transaction、workflow node runtime 或 IM Provider abstraction 承担。

## What Changes

- 新增 Human Input v2 card-state reconciliation application capability，在 committed Form terminal outcome 之后枚举属于同一 `HumanInputForm` 的全部 accepted dynamic-card deliveries，并分别请求静态卡片替换。
- Terminal coverage MUST include an accepted selected-action submission, including a business rejection action, as well as committed node-timeout and expiry transitions. Authorization rejection or a rolled-back transition MUST NOT trigger reconciliation.
- 将 reconciliation 范围定义为 Form 的完整 card-instance 集合，而不是触发 submission 的单个 interaction、单个 delivery endpoint 或单个 `MessageLocator`。
- 每个 card instance 必须使用其自身持久化的 Provider/tenant-compatible `MessageLocator`；Provider compatibility、locator validation 和 exact-message mutation 继续由现有 IM capability 负责。
- Supported、unsupported、stale、failed card instances 必须独立处理；单张卡片的结果不得阻止其他卡片 reconciliation。
- Card replacement 只允许在 Form terminal outcome commit 后执行。Replacement failure 不得回滚 submission、timeout/expiry state、Form lifecycle 或 workflow progress。
- 当前不引入 card replacement retry。Failed、stale 或 uncertain replacement 必须记录为独立 operational outcome，且不得触发第二次 submission 或自动 Provider retry。
- 保存 authoritative Form outcome 与 per-card reconciliation outcome 两类独立事实，使部分成功可以被诊断和审计。
- 保持 `im-provider-adapter`、`im-provider-messaging`、`im-provider-message-locator` 和 `im-provider-card-events` 的 Provider-neutral 边界；它们不感知 Form、Grant、submission 或 workflow state。

## Capabilities

### New Capabilities

- `human-input-v2-card-state-reconciliation`: 定义 committed Form submission、timeout 与 expiry outcome 触发的全量 card-instance reconciliation、Provider invocation 编排、无自动重试策略及 per-card operational outcome。

### Modified Capabilities

- `human-input-v2-form-core`: 明确 post-handling card reconciliation facts 与其他 delivery facts 一样不得控制、回滚或补偿 `HumanInputForm` lifecycle。

## Impact

- Human Input v2 application orchestration and post-commit effect dispatch
- Form/delivery persistence ports and mappers for accepted dynamic-card locators, committed submission/timeout/expiry outcomes and reconciliation outcomes
- IM delivery producer/worker integration that records accepted `MessageLocator` values
- Provider adapter composition used to invoke existing `replace_with_static(reference, intent)`
- Operational diagnostics and tests for all-card fan-out, partial success, stale references, unsupported capabilities and failure isolation
- No change to public submission payloads, workflow node data, Provider callback DTOs or Provider-specific locator schemas
- No automatic card replacement retry in this change
