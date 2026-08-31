## Why

Human Input Channel Management 已经拥有稳定 `webhook_id`、deployment transport mode、`IMProvider.supports_webhook()`、Human Input callback URL generator 和 canonical `ChannelSummary.webhook_url` projection。Provider adapters 也具备 `IMWebhookHandler`，但尚无公开 HTTP ingress 把该 URL 路由到 current `IMChannel`、恢复 `IMEncryptedCredentials` 并将认证事件交给 durable inbox。

## What Changes

- 新增独立、无 Console session 的 `POST /callbacks/human-input/v2/im/<webhook_id>` HTTP endpoint；它只负责有界读取原始请求、构造 framework-neutral `WebhookRequest`，并原样映射 `WebhookResponse`。
- 新增 `IMWebhookChannelRepository.load_by_webhook_id()` reverse lookup；它按全局唯一 `webhook_id` 返回 owner-free `IMChannel` 与受控 `WorkspaceScope | DeploymentScope`，不向 Service 暴露 raw `owner_key`。
- 新增 `IMWebhookIngressService`；它复用 deployment transport mode 与 Provider capability，从 authoritative Channel route snapshot 选择 bound credential cipher，通过 `IMCredentialCodec` 恢复 `IMEncryptedCredentials`，并使用 `build_im_provider_adapter()` 构造 request-scoped Provider handler。
- 将 `IMMessageInboxSink`、inbox contracts、ORM、repository 和 mapper 的本地路由键从旧 `integration_id` 迁移为 `channel_id`；Provider event deduplication key 与 processing lifecycle 保持不变。
- 增加请求体上限、无 CORS/CSRF/session 的 callback blueprint、安全错误映射、低基数指标和不包含 payload、credential plaintext/ciphertext 的日志。
- 明确 Flask header adaptation：controller 使用 `tuple(request.headers.items())` 填充 `WebhookRequest.headers`，不执行额外解析或转换。

## Capabilities

### New Capabilities

- `im-provider-webhook-ingress`: 定义公开 callback route、current Channel reverse lookup、owner-safe credential resolution、HTTP adaptation、Service orchestration、durable inbox handoff、错误语义和安全约束。

### Modified Capabilities

- `im-provider-events`: 明确 Flask controller 到 framework-neutral `WebhookRequest.headers` 的映射。
- `im-message-inbox`: 将 authenticated event 的本地路由 identity 从已移除的 Integration 改为 current IM Channel，保持 deduplication、lease、retry 和 terminal semantics 不变。

## Impact

- HTTP: 新 callback blueprint、blueprint registration、request-size configuration 和 controller tests；现有 Console route、URL generator 和 `ChannelSummary` projection 不变。
- Services: 新 Webhook ingress application service、Channel reverse lookup、request-scoped credential recovery、Provider handler composition、Channel-bound inbox sink composition 和 observability。
- Reused credential/runtime contracts: `IMEncryptedCredentials`、`BoundCredentialCipher`、`IMCredentialCodec`、`build_im_provider_adapter()` 和 `IMProviderAdapter`。
- Reused event contracts: `IMWebhookHandler`、`WebhookRequest`、`WebhookResponse`、`IMMessageInboxSink` 和 `SQLAlchemyIMMessageInboxRepository`。
- Reused management contracts: `IMChannel`、`IMChannelId`、`WebhookId`、`IMEventTransportMode`、typed `dify_config.HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE`、`IMProvider.supports_webhook()` and `generate_im_provider_webhook_url()`。
- Persistence: inbox local routing column and values migrate from `integration_id` to `channel_id` under the existing no-historical-data precondition；Channel schema、owner key、configuration CAS and Webhook ID lifecycle remain unchanged。
- Workspace-owned Channel 使用 tenant-bound cipher。Deployment-owned Channel 只有在显式注入 deployment-bound cipher 后才能构造 handler；本 change 不实现 deployment cipher provisioning、storage 或 rotation。
- No new Provider authentication scheme、business-event decoder、submission behavior、STREAM lifecycle owner or inbox retention policy is introduced。
