## 1. Integration configuration and persistence

- [ ] 1.1 为 `IMIntegration` 的 event transport configuration、完整 CAS transition 和既有记录迁移编写失败测试，覆盖默认 `DISABLED`、mode/secret rotation 推进 revision，以及 operational state 不推进 revision。
- [ ] 1.2 增加 `IMEventTransportMode`、provider-neutral transport configuration 与显式 mapper，并将既有 Integration 无副作用迁移为 `DISABLED`。
- [ ] 1.3 增加 owner-scoped Integration repository 操作和独立 operational health persistence，保持 stale revision、provider replacement 与 credential rotation 语义。
- [ ] 1.4 增加 stream lease、heartbeat 与 fencing persistence，并验证同一 `integration_id + config_version` 只有一个 fencing-valid owner。

## 2. Integration management boundary

- [ ] 2.1 为 `IMIntegrationManagementService` 编写失败测试，覆盖 read/configure/delete/test、完整 CAS、secret replace/preserve、provider tenant confirmation 与 safe diagnostics。
- [ ] 2.2 实现单一 Dify-owned `IMIntegrationManagementService` 及 transport-neutral service factory/composition entry point，供 workspace 与 trusted internal Integration handlers 消费；handlers 由 `human-input-v2-api-contracts` 独占。
- [ ] 2.3 实现 provider-neutral management projection，安全暴露 masked configuration、supported event transports、derived webhook URL 与 operational health。
- [ ] 2.4 增加 architecture tests，阻止 EE credential/client/event-runtime ownership，并提供 API-consumer fixtures；trusted internal HTTP call-graph tests 由 `human-input-v2-api-contracts` 拥有。

## 3. Credential and provider client foundation

- [ ] 3.1 为 credential encryption/rotation、最小 credential view、plaintext lifetime 与 error redaction 编写失败测试。
- [ ] 3.2 实现 owner-scoped credential loader 和 provider-local client factory，统一 timeout、proxy、user-agent、SDK lifecycle 与 sanitized construction errors。
- [ ] 3.3 为 Feishu、Lark 与 DingTalk 增加 provider contract suite，固定验证 directory read、message send、message/card update 与 provider tenant confirmation 基线。
- [ ] 3.4 确保 SDK clients、credential DTOs、raw responses 与 SDK exceptions 留在 provider package，并只向 Sync/Card adapter 返回 provider-neutral results。

## 4. Authenticated event contract and routing

- [ ] 4.1 为 webhook/stream 等价 envelope、payload size bounds、secret exclusion 与 immutable metadata 编写失败测试。
- [ ] 4.2 实现 `AuthenticatedIMEventEnvelope`、`AuthenticatedIMEventSink` 与 `ACCEPTED / IGNORED / RETRY` durability result contract。
- [ ] 4.3 实现 event-name 到显式 business sink 的静态 router，并保持 unknown-event safe-ignore policy 与 Card/Sync 业务语义隔离。
- [ ] 4.4 增加日志、trace、metrics 与 transport error 的 allow-list redaction 测试，禁止持久化 raw webhook body 或 raw stream payload。

## 5. Webhook transport

- [ ] 5.1 为 Feishu、Lark 与 DingTalk webhook verification、decrypt、handshake、revision staleness、body limit 与 provider-specific acknowledgement 编写失败测试。
- [ ] 5.2 实现薄 public webhook controller、Integration route resolution 与 provider-local webhook transport adapters。
- [ ] 5.3 将 webhook acknowledgement 绑定到 sink durable acceptance，确保 `RETRY` 不返回 success acknowledgement 且不在 request path 执行业务处理。
- [ ] 5.4 增加 verification material rotation、obsolete request rejection 与 safe webhook operational diagnostics 测试。

## 6. Stream transport

- [ ] 6.1 为 single-owner lease、fencing、revision change shutdown、lease loss takeover 与 bounded reconnect backoff 编写失败测试。
- [ ] 6.2 实现专用 supervised stream runtime、desired Integration discovery、lease renewal、fencing check 与 graceful session shutdown。
- [ ] 6.3 实现 Feishu、Lark 与 DingTalk provider-local SDK stream adapters，将 SDK callbacks 转换为共享 authenticated envelope 而不执行 Card/Sync 逻辑。
- [ ] 6.4 在每次 sink delivery 前校验 current revision 与 fencing token，并实现 jittered reconnect、heartbeat 与 safe connection health reporting。

## 7. Deployment, rollout and verification

- [ ] 7.1 注册 stream consumer process role、配置项与 health endpoints，确保 Flask、Socket.IO 与 finite Celery workers 不持有 long-lived SDK sessions。
- [ ] 7.2 增加 `DISABLED -> WEBHOOK / STREAM -> DISABLED` rollout 与 rollback 测试，验证 manual sync、binding 与 outbound messaging 始终可用。
- [ ] 7.3 运行 Foundation domain/application/provider contract tests、repository tests、provider webhook controller tests 与 stream concurrency tests，并修复 typing、lint 和 migration checks；不在本 change 运行 workspace/internal Integration controller tests。
- [ ] 7.4 更新下游 dependency wiring，使 Sync 复用 client foundation、Card 注册 authenticated event sink，同时不把 directory/card adapter ownership 移入 Foundation。
