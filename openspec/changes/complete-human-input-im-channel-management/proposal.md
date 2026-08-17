## Why

Canonical Human Input Channels facade 已支持 Resend 与 self-managed Slack，但 Feishu/DingTalk 仍为 unavailable implementation，Lark、Microsoft Teams 和 WeCom 尚未进入 management provider/candidate contract。完整 provider configuration lifecycle 必须先在 Channel Management owner 内收敛，不能由 sync runtime 或其他 transport adapter 补齐。

## What Changes

- 扩展 canonical `ChannelProvider`、provider-specific candidate types、provider manager composition 和 Workspace Console mappings，覆盖 Slack、Feishu/Lark、DingTalk、Microsoft Teams 与 WeCom。
- 删除 `ChannelHandler`、`ChannelHandlerRegistry` 与 `DuplicateChannelHandlerError`；concrete route 在 composition time 绑定对应 provider manager，不再通过 `ChannelRef` runtime lookup。`feishu` 与 `lark` 保持独立 value，但共享 provider-family implementation。
- 将 Workspace Console item/test surface 展开为 `email/resend` 和每个 `im/<provider>` 的 concrete route；未知 route 由 HTTP routing 直接返回 `404`，不进入 management facade。
- 将 configuration create/update 分为 `POST` 与 `PUT`，并为每个 provider 注册 operation-specific request schema；公开 request 不再携带 provider discriminator 或 `PreserveOriginalValue`。
- create、update 与 connection test 使用相同的完整 provider-specific candidate；所有 non-nullable fields（包括 secrets）都必须提交，nullable fields 可省略或提交 `null`。IM update 只额外携带完整 CAS 和 `replace_current`，后者显式授权可能使 identities/bindings 失效的 provider/provider-tenant replacement。
- 所有 IM create/update path 在数据库 transaction 外完成 credential test、required-scope validation 和 provider tenant identity resolution。
- successful create/update 将 credential-free connected diagnostic 与 trusted `last_checked_at` 和 configuration transition 原子持久化；diagnostic 不单独推进 `config_version`。
- connection test 只验证 request 中提交的完整新 credentials，不读取或复用已保存 credentials，也不持久化任何 configuration state；failed create/update 不修改 credentials、diagnostics、revision、identities 或 bindings。
- management wiring 复用现有 IM Control Plane credential owners 与 provider adapters，不新增 directory client、directory pagination 或 sync-specific credential model。
- Workspace controllers 只负责 authorization、trusted context、DTO mapping 和 stable error translation；provider、credential protector 与 persistence 保持在 application service 下方。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `human-input-channel-management`: 将完整 IM provider set、provider-specific commands 和 verified connectivity persistence 纳入 canonical facade。
- `human-input-email-channel-management`: 要求 Resend create/update/test 都提交包含新 API key 的完整 candidate，移除 API key retention。
- `human-input-console-management-api`: 将 concrete provider routes、create/update lifecycle、complete-candidate semantics 和显式 replacement authorization 纳入 Workspace Console contract。

## Impact

- Backend: `api/core/human_input_v2/channel_management/`、`HumanInputChannelManagementService`、provider managers/direct composition、concrete Workspace Console resources/Pydantic contracts 和 backend tests。
- Provider integration: 复用现有 credential structures 与 adapter construction；只有 failing contract test 证明必要时才允许在原 owner 中做最小兼容调整。
- Dependencies: consumes `implement-human-input-channel-management-api`; `integrate-im-contact-sync-runtime` 只消费这里产生的 persisted connected Integration。
- Excluded: OAuth lifecycle、provider directory synchronization、Celery queue 和 binding mutation。
