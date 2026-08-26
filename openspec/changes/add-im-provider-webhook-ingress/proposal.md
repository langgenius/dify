## Why

Human Input 已经具备 canonical IM Channel Management API、Provider-specific `IMWebhookHandler`、opaque IM credential envelope、durable `IMMessageInboxSink` 和异步 inbox worker，但没有公开 HTTP ingress 将 Provider callback 路由到当前 IM Integration。部署选择 Webhook transport 时，`ChannelSummary.webhook_url` 因此仍然无法指向可工作的 callback endpoint，Provider challenge、签名校验和业务事件也无法进入 durable inbox。

## What Changes

- 新增独立、无 Console session 的 `POST /callbacks/human-input/v2/im/<webhook_id>` HTTP endpoint；它只负责有界读取原始请求、构造 framework-neutral `WebhookRequest`，并原样映射 `WebhookResponse`。
- 为每个 `HumanInputIMIntegration` 持久化全局唯一、不可枚举且不承担认证职责的 `webhook_id`；该字段是 encrypted credential envelope 之外的 server-generated routing metadata。Credential rotation 保留该值，replacement 和 delete/recreate 生成新值。
- 删除 Integration 中持久化的 `callback_url`。IM Integration owner 使用 `TRIGGER_URL` 和 `webhook_id` 派生 `IMIntegrationView.webhook_url`，现有 Console projection 继续将其映射到 canonical `ChannelSummary`。
- 新增 `IMWebhookIngressService`，按 `webhook_id` 读取 authoritative Integration，校验 deployment-owned transport mode，并为每个 admitted callback 构造绑定到 `IMMessageInboxSink` 的 request-scoped Provider handler。
- 将 Contact Sync 私有的 `DifyIMIntegrationAdapterFactory` 提升到共享 runtime composition。该 factory 通过现有 `IMCredentialCodec` 解封 opaque credential envelope，并通过现有 `build_im_provider_adapter()` 构造 `IMProviderAdapter`；Webhook ingress 不新增 credential parser、cipher policy 或 Provider constructor registry。
- 新增 credential-free Webhook capability check。IM owner 使用该 check 在不解密 credential envelope、不构造 adapter的前提下决定是否返回 `webhook_url`。
- 增加请求体上限、无 CORS/CSRF/session 的 callback blueprint、安全错误映射、低基数指标和不包含 payload、credential plaintext/ciphertext 的日志。
- 明确 Flask header adaptation：controller 使用 `tuple(request.headers.items())` 填充 `WebhookRequest.headers`，不执行额外解析或转换。
- 直接修订尚未发布的 IM control-plane migration：新增 non-null unique `webhook_id` 并移除 `callback_url`，不增加旧格式回填、双读或 expand/contract migration。

## Capabilities

### New Capabilities

- `im-provider-webhook-ingress`: 定义公开 callback route、Integration route identity、HTTP adaptation、Service orchestration、opaque credential recovery、durable inbox handoff、错误语义和安全约束。

### Modified Capabilities

- `im-provider-events`: 明确 Flask controller 到 framework-neutral `WebhookRequest.headers` 的映射。
- `human-input-v2-im-control-plane-core`: 明确 `webhook_id` 是 encrypted credential envelope 之外的 Integration routing metadata，并固定 rotation、replacement 和 deletion 对该字段的影响。
- `human-input-channel-management`: 让现有 IM owner snapshot 使用 credential-free Webhook capability check，不在 Channel read 中解密 credential envelope或构造 Provider adapter。

## Impact

- Backend model and unshipped migration: `HumanInputIMIntegration`、IM Integration aggregate/mappers、`webhook_id` 全局唯一约束，以及 `callback_url` 删除。
- HTTP: 新 callback blueprint、blueprint registration、request-size configuration、callback URL generator 和 controller tests；现有 Console route 和 `ChannelSummary` schema 不变。
- Services: 新 Webhook ingress application service、request-scoped handler composition、共享 `DifyIMIntegrationAdapterFactory`、inbox sink composition、Webhook capability check 和 observability。
- Reused credential/runtime contracts: `EncryptedCredentials` opaque envelope、`BoundCredentialCipher`、`IMCredentialCodec`、`build_im_provider_adapter()` 和 `IMProviderAdapter`。
- Reused event contracts: `IMWebhookHandler`、`WebhookRequest`、`WebhookResponse`、`IMMessageInboxSink`、`SQLAlchemyIMMessageInboxRepository` 和当前 IM Integration complete-CAS semantics。
- Supported Webhook providers remain Slack、Feishu/Lark and Microsoft Teams；DingTalk and WeCom continue to expose no Webhook handler in this release。
- Workspace-owned Integration 使用现有 tenant-bound cipher。Deployment-owned Integration 只有在显式注入 deployment-bounded cipher 后才能构造 handler；本 change 不实现 deployment cipher provisioning、storage 或 rotation。
- No new Provider authentication scheme、business-event decoder、submission behavior、STREAM lifecycle owner or inbox retention policy is introduced。
