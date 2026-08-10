## Why

现有 IM Provider adapter 能发送 Dynamic Card，并能在 transport authentication 后产出 `AuthenticatedIMEvent`，但尚无公共能力把 Slack、Feishu/Lark 与 Microsoft Teams 的不同卡片回调格式归一化为可供后续处理的 IM 卡片事件。缺少这一边界会迫使 inbox consumer 或 HITL 接入层理解 Provider-specific payload、action metadata 和身份字段。

## What Changes

- 增加 Provider-neutral `IMCardEvent`，只包含 `ProviderUserId`、action identifier、JSON inputs 与原样返回的 `CorrelationToken`。
- 增加 `UnrecognizedIMEvent` 与 `IMCardEventDecodeResult`；非 card event 返回 `UnrecognizedIMEvent`，已识别为 card event 但 payload 无法解析或不符合预期 callback schema 时抛出 card-event decoding error。
- 增加 credential-free、thread-safe `IMCardEventDecoder`，通过 `decode(AuthenticatedIMEvent)` 归一化 Provider-specific card callbacks。
- 让 concrete `IMProviderAdapter` 以 class-level optional capability 暴露 decoder，并要求 Dynamic Card Messaging 与 card-event decoder 始终成对出现。
- 将 callback metadata 的发送编码与回调解析集中在同一 concrete Provider implementation 中，保证 `ProviderUserId`、action identifier、inputs 与 `CorrelationToken` 的 round trip。
- 为 Slack、Feishu/Lark 与 Microsoft Teams adapters 实现 card-event decoding，并要求三类 Dynamic Card implementations 同时提供对应 decoder。
- 保持 inbox persistence、HITL authorization、submission commit、workflow resume 和 card replacement 接线不属于本 change。

## Capabilities

### New Capabilities

- `im-provider-card-events`: 定义归一化 IM card event、decoder result、Provider adapter capability pairing，以及各 Dynamic Card Provider 的 callback decoding semantics。

### Modified Capabilities

无。

## Impact

- 影响 `api/core/human_input_v2/im_provider/` 中的共享 contracts 与 exports。
- 影响 `api/core/human_input_v2/im_integration/adapters/` 中 Slack、Feishu/Lark 与 Microsoft Teams Dynamic Card implementations。
- 需要更新 Provider adapter conformance tests 与脱敏 callback fixtures。
- 依赖 `define-im-provider-adapter-contracts` 提供的 `AuthenticatedIMEvent`、`ProviderUserId`、`CorrelationToken`、Dynamic Card Messaging 和 root adapter contracts。
- 与 `implement-im-message-inbox` 保持顺序边界：decoder 在 authenticated event 被 inbox claim 后使用，但本 change 不实现 consumer wiring 或 inbox state transitions。
