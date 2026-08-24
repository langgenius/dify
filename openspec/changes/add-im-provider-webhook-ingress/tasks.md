## 1. Webhook route identity 与 persistence

- [ ] 1.1 新增 `WebhookId` value object，完成固定长度、URL-safe 格式校验、cryptographically secure generation 和安全日志表示，并补充 domain unit tests。
- [ ] 1.2 在 `HumanInputIMIntegration` aggregate、ORM model、mapper 和 repository create/update path 中加入 `webhook_id`，确保 credential rotation 保留原值，而 replacement 和 delete/recreate 生成新值。
- [ ] 1.3 编写 expand migration：增加 nullable `webhook_id`、用安全随机值批量回填现有 rows、建立全局 unique constraint，并在回填完成后改为 non-null；覆盖 upgrade/downgrade 和 collision retry tests。
- [ ] 1.4 在所有 application readers 切换到 derived Webhook URL 后编写 contract migration，删除 persisted `callback_url` column 及对应 aggregate、mapper 和 repository 写入逻辑。

## 2. Deployment mode 与 management projection

- [ ] 2.1 新增 `IMEventTransportMode` 和只读 `IMEventTransportModeResolver` port，提供读取 deployment configuration 的 production adapter，默认值设为 `DISABLED`，且不向 tenant input 或 Integration persistence 暴露该字段。
- [ ] 2.2 增加 `HUMAN_INPUT_IM_WEBHOOK_MAX_BODY_BYTES` 配置及合法范围校验，并按部署约定把可选示例放入对应的 service-specific environment sample。
- [ ] 2.3 实现 `generate_im_provider_webhook_url(webhook_id)`，用 `TRIGGER_URL` 和固定 path 动态生成 callback URL，覆盖 origin、path joining 和 escaping tests。
- [ ] 2.4 修改 Channel Management projection：只有 effective mode 为 `WEBHOOK` 且 Provider 支持 Webhook capability 时返回 `webhook_url`，并删除对 persisted `callback_url` 的读取。
- [ ] 2.5 补充 management tests，覆盖 `DISABLED`、`STREAM`、unsupported Provider、`TRIGGER_URL` 变化以及 tenant 试图提交 transport mode 的拒绝语义。

## 3. 共享 Provider adapter composition

- [ ] 3.1 将 `DifyIMProviderAdapterFactory` 抽取到 `services.human_input_v2.im_provider.composition`，让 factory 返回 `IMProviderAdapter` protocol，并集中 owner-scoped credential reveal、credential variant 校验和 concrete adapter construction。
- [ ] 3.2 修改 Contact Sync composition 使用共享 factory，仅访问 adapter 的 directory capability，移除重复或 use-case-private 的 credential mapping。
- [ ] 3.3 为共享 factory 增加 unit tests，覆盖 tenant/deployment owner key selection、Provider discriminator mismatch、credential reveal failure、adapter construction 和 root adapter close lifecycle。

## 4. Route repository、handler cache 与 ingress service

- [ ] 4.1 定义 `IMWebhookIntegrationRepository.load_by_webhook_id()` port 和明确的 not-found/query-failure error contract，只向 service 返回 current domain `IMIntegration`。
- [ ] 4.2 实现按全局唯一 `webhook_id` 查询 authoritative Integration 的 repository adapter，并测试删除、replacement、credential revision 和 database failure 行为。
- [ ] 4.3 实现以 `(integration_id, config_version)` 为 key 的 bounded LRU/TTL handler cache，提供 per-key single-flight construction、线程安全复用和 eviction，并增加 concurrency unit tests。
- [ ] 4.4 实现 `IMWebhookIngressService.handle(webhook_id, request)`：解析 deployment mode 和 current Integration，通过共享 factory 创建 revision-bound handler，将 handler 绑定到 `IMMessageInboxSink`，并在创建 handler 后关闭 root adapter。
- [ ] 4.5 在 ingress service 中实现同形 `404` 与 payload-free `503` 映射，同时原样透传 Provider `WebhookResponse`，且不把 route absence、credential/factory failure 或 unsupported capability 混为同一种内部错误。
- [ ] 4.6 增加 service tests，覆盖 unknown/deleted route、inactive mode、unsupported Provider、query/reveal/construction failure、challenge、authentication failure、durable ACK、duplicate、inbox failure 和 response passthrough。
- [ ] 4.7 增加 revision race tests，证明 rotation commit 后的新 request 使用新 handler、replacement/delete 后旧 route 不命中 cache，而 commit 前已解析旧 revision 的 in-flight request 可以完成且不持有 Integration write transaction。

## 5. Public HTTP callback boundary

- [ ] 5.1 新增独立 `controllers.im_provider_webhook` blueprint 和 `POST /callbacks/human-input/im/<webhook_id>` handler，不安装 Console session、CSRF、workspace/tenant decorator 或 application CORS policy。
- [ ] 5.2 在 controller 入口最早捕获 trusted UTC receive time，先校验 route identity，再使用 bounded reader 获取 exact body bytes，并在 oversize 时于任何 repository、factory 或 inbox 调用前返回 `413`。
- [ ] 5.3 将 uppercase method、Werkzeug 实际暴露的 ordered header field-values、exact body bytes 和 receive time 组装为 `WebhookRequest`；不得解析 payload、按逗号拆分 header 或选择 Provider/tenant。
- [ ] 5.4 将 `WebhookResponse` 的 status、ordered headers 和 exact body 映射为 Flask `Response`，允许框架重算 `Content-Length`，并注册 blueprint 及 ingress service application composition。
- [ ] 5.5 增加真实 Flask request tests，覆盖 malformed/unknown route 的同形 `404`、exact body、receive-time capture ordering、oversize `413`、cookies/CSRF 无效、preflight 无 CORS fallback，以及 challenge/ACK response 的 byte-for-byte adaptation。

## 6. Provider authentication header contract

- [ ] 6.1 审计并更新 Slack、Feishu/Lark 和 Microsoft Teams verifier 的 singleton authentication header 读取逻辑：framework 暴露多个值时 fail closed，WSGI 合并值按一个完整值验证且不得拆分或挑选子值。
- [ ] 6.2 增加 framework-neutral contract 和 adapter tests，覆盖 separately exposed duplicate headers、comma-coalesced authentication headers、framework-visible ordering 和 signature 对 exact body bytes 的依赖。

## 7. Observability、验收与 rollout

- [ ] 7.1 增加低基数 ingress request、route miss、oversize、handler response class、internal unavailable 和 duration metrics；日志仅记录 safe error code、Integration ID 和 Provider。
- [ ] 7.2 增加 observability tests，断言 logs、metrics、traces 和 exceptions 不包含 request/response payload、headers、credentials、tenant ID 或完整 `webhook_id`，且 metric labels 不引入高基数 identity。
- [ ] 7.3 增加 ingress-to-inbox integration coverage，验证 challenge 不写 inbox、认证失败不写 inbox、成功 ACK 依赖 durable accept、real event ID duplicate 可成功 ACK，以及 broker wakeup failure 不撤销已完成的 durable acceptance。
- [ ] 7.4 执行相关 backend unit tests、migration tests、formatting 和 static checks，并按 `DISABLED` 部署、application reader 切换、删除 `callback_url`、最后启用 `WEBHOOK` 的顺序完成 rollout 文档与人工验收清单。
