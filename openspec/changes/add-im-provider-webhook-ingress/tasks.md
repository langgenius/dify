## 1. Webhook route identity 与 persistence

- [ ] 1.1 新增 `WebhookId` value object，完成固定长度、URL-safe 格式校验、cryptographically secure generation 和安全日志表示，并补充 domain unit tests。
- [ ] 1.2 在 `IMIntegration` aggregate、`HumanInputIMIntegration` ORM、mapper 和 guarded UoW 中加入 `webhook_id`；让 `HumanInputIMIntegrationManagementService` 使用独立 `webhook_id_factory`，确保 create/replacement 生成新值而 credential rotation 不能覆盖原值。
- [ ] 1.3 直接修改尚未发布的 IM control-plane migration，创建 `VARCHAR(32) NOT NULL` 的 `webhook_id` 和全局 unique constraint，并移除 `callback_url`；覆盖 schema upgrade/downgrade、唯一约束和 ORM strict mapping tests，不实现旧 row backfill 或双读。
- [ ] 1.4 从 `ConfirmedIMConfiguration`、aggregate、ORM、mapper、guarded UoW 和 management write path 删除 `callback_url`；保留 `IMIntegrationView.webhook_url` 作为 runtime-derived credential-free field。

## 2. Deployment mode 与 management projection

- [ ] 2.1 新增只包含 `WEBHOOK` 和 `STREAM` 的 `IMEventTransportMode` 及只读 `IMEventTransportModeResolver`；要求 deployment configuration 必须选择其中一个值，缺失或非法配置直接失败，并保持 mode 不进入 Console DTO 或 Integration persistence。
- [ ] 2.2 增加 `HUMAN_INPUT_IM_WEBHOOK_MAX_BODY_BYTES` 配置及合法范围校验，并按部署约定把可选示例放入对应的 service-specific environment sample。
- [ ] 2.3 实现 `generate_im_provider_webhook_url(webhook_id)`，用 `TRIGGER_URL` 和固定 path 动态生成 callback URL，覆盖 origin、path joining 和 escaping tests。
- [ ] 2.4 在 `IMProvider` 上实现 `supports_webhook() -> bool`，让 IM Integration owner 使用 mode、该方法和 credential-runtime availability 生成 `IMIntegrationView.webhook_url`；现有 Console mapper只负责映射到 `ChannelSummary`。
- [ ] 2.5 增加 management tests，覆盖 canonical list/detail/mutation summaries、`WEBHOOK`、`STREAM`、缺失/非法 deployment configuration、unsupported Provider、`TRIGGER_URL` 变化、tenant mode override rejection，以及所有 projection 不调用 `IMCredentialCodec.load()` 或构造 adapter。

## 3. 共享 opaque-credential runtime composition

- [ ] 3.1 将现有 `DifyIMIntegrationAdapterFactory` 从 Contact Sync composition 提升到共享 Human Input v2 runtime module，保留 `cipher_resolver` injection，并复用 `IMCredentialCodec` 和 `build_im_provider_adapter()`。
- [ ] 3.2 修改 Contact Sync 和 Webhook ingress composition 使用共享 factory；保持 `DifyIMProviderConfigurationService` 直接复用已有 `build_im_provider_adapter()`，不得新增第二套 Provider constructor dispatch。
- [ ] 3.3 为共享 factory 增加 tests，覆盖 workspace tenant-bound cipher、显式 deployment-bounded cipher、tenant-less cipher unavailable、envelope version/decrypt/JSON/Pydantic failure、Provider discriminator mismatch，以及失败时不调用 adapter factory或 Provider I/O。
- [ ] 3.4 增加 adapter lifecycle tests，验证 Contact Sync 只访问 directory capability、Webhook ingress 只创建 Webhook handler，且关闭 root adapter 不会 invalidate 已创建的 handler。

## 4. Route repository 与 ingress service

- [ ] 4.1 定义 `IMWebhookIntegrationRepository.load_by_webhook_id()` port 和明确的 not-found/query-failure error contract；返回 current domain `IMIntegration` 及其 opaque envelope，但不执行 credential recovery。
- [ ] 4.2 实现按全局唯一 `webhook_id` 查询 authoritative Integration 的 repository adapter，并测试删除、replacement、credential revision、opaque envelope mapping 和 database failure 行为。
- [ ] 4.3 实现 `IMWebhookIngressService.handle(webhook_id, request)`：解析 deployment mode 和 current Integration，为每个 admitted callback 通过共享 factory恢复 credentials并创建 request-scoped handler，将 handler 绑定到 `IMMessageInboxSink`，随后关闭 root adapter且不保留 handler。
- [ ] 4.4 实现安全失败映射：malformed/unknown route、`STREAM` mode、`IMProvider.supports_webhook() == False` 和 `create_webhook_handler() is None` 返回同形 `404`；query failure、cipher unavailable、`IMCredentialError`、adapter construction 或其他内部失败返回 payload-free `503`。
- [ ] 4.5 增加 service tests，覆盖每个 admitted callback 独立构造和释放 handler、static unsupported Provider、credential-bound handler unavailable、query/cipher/envelope/factory failure、challenge、authentication failure、durable ACK、duplicate、inbox failure 和 response passthrough。
- [ ] 4.6 增加 revision race tests，证明 rotation commit 后开始 lookup 的 request恢复新 envelope、replacement/delete 后旧 route 返回 `404`，而 commit 前已读取旧 revision 的 in-flight request 可以完成且不持有 Integration write transaction。

## 5. Public HTTP callback boundary

- [ ] 5.1 新增独立 `controllers.im_provider_webhook` blueprint 和 `POST /callbacks/human-input/v2/im/<webhook_id>` handler，不安装 Console session、CSRF、workspace/tenant decorator 或 application CORS policy。
- [ ] 5.2 在 controller 入口最早捕获 trusted UTC receive time，先校验 route identity，再使用 bounded reader 获取 exact body bytes，并在 oversize 时于任何 repository、factory 或 inbox 调用前返回 `413`。
- [ ] 5.3 将 uppercase method、`tuple(request.headers.items())`、exact body bytes 和 receive time 组装为 adapters package 中的 `WebhookRequest`；不得额外解析或转换 header name/value。
- [ ] 5.4 将 `WebhookResponse` 的 status、ordered headers 和 exact body 映射为 Flask `Response`，允许框架重算 `Content-Length`，并注册 blueprint 及 ingress service application composition。
- [ ] 5.5 增加真实 Flask request tests，覆盖 malformed/unknown route 的同形 `404`、exact body、receive-time capture ordering、oversize `413`、cookies/CSRF 无效、preflight 无 CORS fallback，以及 challenge/ACK response 的 byte-for-byte adaptation。

## 6. Flask request mapping contract

- [ ] 6.1 更新 adapters `entities`/`protocols` 的 framework-neutral contract tests，要求 `WebhookRequest.headers` 接收 Flask controller 提供的 name/value pairs。
- [ ] 6.2 增加真实 Flask request tests，断言 `WebhookRequest.headers == tuple(request.headers.items())`，并覆盖 signature verification 对 exact body bytes 的依赖。

## 7. Observability、验收与 rollout

- [ ] 7.1 增加低基数 ingress request、route miss、oversize、handler response class、internal unavailable 和 duration metrics；每次 successful Integration lookup 后立即记录 `im_webhook_integration_resolved` structured log，包含 `provider` 和 `integration_id`。
- [ ] 7.2 增加 observability tests，断言 lookup log 发生在 `IMProvider.supports_webhook()`、cipher、credential 和 adapter work 前，且 logs、metrics、traces 和 exceptions 不包含 request/response payload、headers、credential plaintext、credential ciphertext、tenant ID 或完整 `webhook_id`；metric labels 不得引入高基数 identity。
- [ ] 7.3 增加 Provider adapter tests，固定 `IMProvider.supports_webhook()` 的静态结果；验证 Feishu/Lark 同时缺少 `verification_token` 与 `encrypt_key` 时 `create_webhook_handler()` 返回 `None`、任一字段存在时返回 handler，并验证 Slack resolved credential schema 必须包含 `signing_secret`；callers不得重复检查这些字段。
- [ ] 7.4 增加 ingress-to-inbox integration coverage，验证 challenge 不写 inbox、认证失败不写 inbox、成功 ACK 依赖 durable accept、real event ID duplicate 可成功 ACK，以及 broker wakeup failure 不撤销已完成的 durable acceptance。
- [ ] 7.5 执行相关 backend unit tests、unshipped migration tests、formatting 和 static checks；按 schema/API 一次切换、deployment mode 保持 `STREAM`、确认 management projection 正确、最后选择 `WEBHOOK` 的顺序完成人工验收清单。
- [ ] 7.6 验证 Workspace Integration 使用 tenant-bound cipher 可以完成 callback；验证未注入 deployment-bounded cipher 时 tenant-less Integration 不暴露可用 URL且 ingress 返回安全 `503`，注入后才允许启用 deployment-owned callback。
