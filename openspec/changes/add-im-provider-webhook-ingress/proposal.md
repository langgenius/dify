## Why

Channel Management 已经生成稳定的 IM Provider callback URL，Provider adapters 也已经实现 `IMWebhookHandler`，但 Flask 尚未暴露对应的公开 HTTP endpoint。Provider 因而无法通过该 URL 完成 challenge、请求认证或把业务事件交给 durable inbox。

## What Changes

- 新增无 Console session 的 `POST /callbacks/human-input/v2/im/<webhook_id>` endpoint。Application 仅在 `WEBHOOK` 模式注册该 callback blueprint；`STREAM` 模式下路由不存在。Flask handler 有界读取原始 body，构造 framework-neutral `WebhookRequest`，并把 `WebhookResponse` 映射为 Flask response。
- 新增 `IMWebhookChannelRepository.find_by_webhook_id()`，按 `webhook_id` 查询当前 `IMChannel` 及其 credential scope。
- 新增可复用的 `IMProviderBuilder`。Builder 绑定一个 `BoundCredentialCipher`，通过 `build(channel: IMChannel)` 恢复 Channel credentials 并构造 `IMProviderAdapter`，不接收 Webhook route 或 owner scope。
- 新增 `IMWebhookIngressService`。Service 按 reverse lookup 返回的 credential scope 选择 owner-bound `IMProviderBuilder`，为 `route.channel` 构造 request-scoped adapter，创建 Webhook handler，并把 authenticated business event 交给 Channel-bound `IMMessageInboxSink`。
- 将 durable inbox 的本地路由 identity 从已移除的 `integration_id` 改为 `channel_id: IMChannelId`，保持 Provider event deduplication 和 processing semantics 不变。
- 保留 Provider handler 的 challenge、authentication、ACK 和 retry response，不在 ingress 中重新实现 Provider protocol。
- 明确 Flask controller 使用 `tuple(request.headers.items())` 填充 `WebhookRequest.headers`，不额外解析或转换 headers。

## Capabilities

### New Capabilities

- `im-provider-webhook-ingress`: 定义公开 callback route、Channel reverse lookup、请求级 Provider handler composition、durable inbox handoff 和 HTTP failure semantics。

### Modified Capabilities

- `im-message-inbox`: 将本地路由 identity 从 Integration 改为当前 IM Channel。

## Impact

- HTTP: 新 callback blueprint 及按 transport mode 执行的条件注册；请求体上限复用现有 `WEBHOOK_REQUEST_BODY_MAX_SIZE`。
- Services: 新增可复用的 `IMProviderBuilder`、Webhook ingress service 及其 application composition。
- Persistence: 新增按 `HumanInputIMChannel.webhook_id` 的只读查询，并将 unpublished inbox schema 的 `integration_id` 改为非空 `channel_id`；不修改 Channel schema、Webhook ID lifecycle 或 configuration CAS。
- Reused contracts: `IMChannel`、`IMEncryptedCredentials`、`BoundCredentialCipher`、`IMCredentialCodec`、`build_im_provider_adapter()`、`IMWebhookHandler`、`WebhookRequest`、`WebhookResponse` 和 `IMMessageInboxSink`。
- Deployment-owned Channel 的 credential cipher provisioning 由独立 change 提供。本 change 不定义新的 cipher lifecycle 或 injection API。
- 本 change 不新增专用 telemetry subsystem，也不修改 request logging、Sentry、OpenTelemetry 或 Nginx 的通用策略。
