## Why

Canonical Human Input Channels facade 已支持 Resend 与 self-managed Slack，但 Feishu/DingTalk 仍为 unavailable handler，Lark、Microsoft Teams 和 WeCom 尚未进入 management provider/candidate contract。完整 provider configuration lifecycle 必须先在 Channel Management owner 内收敛，不能由 sync runtime 或其他 transport adapter 补齐。

## What Changes

- 扩展 canonical `ChannelProvider`、provider-specific candidate unions、handler registry 和 Workspace Console mappings，覆盖 Slack、Feishu/Lark、DingTalk、Microsoft Teams 与 WeCom。
- 每个 canonical provider value 注册一个完整 handler；`feishu` 与 `lark` 保持独立 value，但共享 provider-family implementation。
- 所有 IM save/reconfigure path 在数据库 transaction 外完成 credential test、required-scope validation 和 provider tenant identity resolution。
- successful save 将 credential-free connected diagnostic 与 trusted `last_checked_at` 和 configuration transition 原子持久化；diagnostic 不单独推进 `config_version`。
- standalone candidate test 保持无持久化；failed save 不修改 credentials、diagnostics、revision、identities 或 bindings。
- management wiring 复用现有 IM Control Plane credential owners 与 provider adapters，不新增 directory client、directory pagination 或 sync-specific credential model。
- Workspace controllers 只负责 authorization、trusted context、DTO mapping 和 stable error translation；provider、credential protector 与 persistence 保持在 application service 下方。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `human-input-channel-management`: 将完整 IM provider set、provider-specific commands 和 verified connectivity persistence 纳入 canonical facade。

## Impact

- Backend: `api/core/human_input_v2/channel_management/`、`HumanInputChannelManagementService`、provider handlers/composition、Workspace Console Pydantic contracts 和 backend tests。
- Provider integration: 复用现有 credential structures 与 adapter construction；只有 failing contract test 证明必要时才允许在原 owner 中做最小兼容调整。
- Dependencies: consumes `implement-human-input-channel-management-api`; `integrate-im-contact-sync-runtime` 只消费这里产生的 persisted connected Integration。
- Excluded: OAuth lifecycle、provider directory synchronization、Celery queue 和 binding mutation。
