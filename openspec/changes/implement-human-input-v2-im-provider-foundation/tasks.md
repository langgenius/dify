## 1. Deployment transport policy and operational persistence

- [ ] 1.1 为deployment-owned `IMEventTransportMode`配置解析与runtime gating编写失败测试，覆盖safe default `DISABLED`、`WEBHOOK`只启用public callback、`STREAM`只启用persistent connection、existing provider incompatibility fail-closed，以及mode不进入Integration CAS。
- [ ] 1.2 通过`configs.dify_config`增加startup-time `DISABLED / WEBHOOK / STREAM` runtime policy；不得增加Integration mode column、mapper、migration或management write command。
- [ ] 1.3 增加 owner-scoped Integration repository 操作和独立 operational health persistence，保持 provider-specific secret replacement、stale revision、provider replacement 与 credential rotation 语义，并证明deployment mode rollout不修改Integration revision。
- [ ] 1.4 增加 stream lease、heartbeat 与 fencing persistence，并验证同一 `integration_id + config_version` 只有一个 fencing-valid owner。

## 2. Integration management boundary

- [ ] 2.1 为 `IMIntegrationManagementService` 编写失败测试，覆盖 read/configure/delete/test、完整 CAS、secret replace/preserve、provider tenant confirmation、deployment-mode compatibility 与 safe diagnostics；management command不得接受mode。
- [ ] 2.2 实现单一 Dify-owned `IMIntegrationManagementService` 及 transport-neutral service factory/composition entry point，供 workspace 与 trusted internal Integration handlers 消费；handlers 由 `human-input-v2-api-contracts` 独占。
- [ ] 2.3 实现 provider-neutral management projection，只读暴露effective deployment mode、masked configuration、`WEBHOOK` deployment下由deployment public base URL与Integration route identity计算的webhook URL，以及operational health；不得持久化callback URL、暴露tenant-selectable mode choices或因deployment URL变化推进Integration revision。
- [ ] 2.4 增加 architecture tests，阻止 EE credential/client/event-runtime ownership，并提供 API-consumer fixtures；trusted internal HTTP call-graph tests 由 `human-input-v2-api-contracts` 拥有。

## 3. Credential and provider client foundation

- [ ] 3.1 为 credential encryption/rotation、最小 credential view、plaintext lifetime 与 error redaction 编写失败测试。
- [ ] 3.2 实现 owner-scoped credential loader 和 provider-local client factory，统一 timeout、proxy、user-agent、SDK lifecycle 与 sanitized construction errors。
- [ ] 3.3 为 Feishu、Lark 与 DingTalk 增加 provider contract suite，固定验证 directory read、message send、message/card update 与 provider tenant confirmation 基线。
- [ ] 3.4 确保 SDK clients、credential DTOs、raw responses 与 SDK exceptions 留在 provider package，并只向 Sync/Card adapter 返回 provider-neutral results。

## 4. Authenticated event contract and routing

- [ ] 4.1 为 webhook/stream 等价 envelope、payload size bounds、secret exclusion 与 immutable metadata 编写失败测试。
- [ ] 4.2 实现 `AuthenticatedIMEventEnvelope`、`AuthenticatedIMEventSink` 与 `ACCEPTED / IGNORED / RETRY` durability result contract。
- [ ] 4.3 实现 authenticated provider/event-name 到显式 business sink 的静态 router；强制 provider transport normalization 在 router 之前、capability-owned semantic normalization 在 sink 选择之后，并保持 unknown-event safe-ignore policy 与 Card/Sync 业务语义隔离。
- [ ] 4.4 增加日志、trace、metrics 与 transport error 的 allow-list redaction 测试，禁止持久化 raw webhook body 或 raw stream payload。

## 5. Webhook transport

- [ ] 5.1 为 Feishu、Lark 与 DingTalk webhook verification、decrypt、handshake、revision staleness、body limit 与 provider-specific acknowledgement 编写失败测试。
- [ ] 5.2 实现薄 public webhook controller、Integration route resolution 与 provider-local webhook transport adapters。
- [ ] 5.3 将 webhook acknowledgement 绑定到 sink durable acceptance，确保 `RETRY` 不返回 success acknowledgement且不在request path执行业务处理；`DISABLED`与`STREAM` deployment必须拒绝或不注册business callback。
- [ ] 5.4 增加 verification material rotation、obsolete request rejection 与 safe webhook operational diagnostics 测试。

## 6. Stream transport

- [ ] 6.1 为 single-owner lease、fencing、revision change shutdown、lease loss takeover 与 bounded reconnect backoff 编写失败测试。
- [ ] 6.2 实现只在deployment mode为`STREAM`时启用的专用supervised persistent connection runtime、current Integration discovery、lease renewal、fencing check与graceful session shutdown。
- [ ] 6.3 实现 Feishu、Lark 与 DingTalk provider-local SDK stream adapters，将 SDK callbacks 转换为共享 authenticated envelope 而不执行 Card/Sync 逻辑。
- [ ] 6.4 在每次 sink delivery 前校验 current revision 与 fencing token，并实现 jittered reconnect、heartbeat 与 safe connection health reporting。

## 7. Deployment, rollout and verification

- [ ] 7.1 注册persistent connection process role、deployment mode配置与health endpoints，确保Flask、Socket.IO与finite Celery workers不持有long-lived SDK sessions，并确保非`STREAM` profile不启动该role。
- [ ] 7.2 使用独立deployment profiles覆盖 `DISABLED / WEBHOOK / STREAM` rollout与rollback，验证mode切换不写Integration records，且manual sync、binding与outbound messaging始终可用。
- [ ] 7.3 运行 Foundation domain/application/provider contract tests、repository tests、provider webhook controller tests 与 stream concurrency tests，并修复 typing、lint 和 migration checks；不在本 change 运行 workspace/internal Integration controller tests。
- [ ] 7.4 更新下游 dependency wiring并增加architecture tests：Dify application不导入concrete provider package，provider adapter不导入Sync/Card/HITL service、repository或controller，只有显式composition/factory module同时认识两侧；Sync复用client foundation、Card注册authenticated event sink，且directory/card adapter ownership不移入Foundation。
