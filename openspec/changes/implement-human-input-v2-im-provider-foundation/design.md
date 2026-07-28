## Context

当前 IM 相关能力已经存在稳定的 core domain：`IMIntegration`、complete CAS revision、provider tenant identity、sync run、identity/binding 与 effective binding resolution。缺失的是一个 active implementation owner，把 provider credential、SDK client construction、Integration management和事件传输统一放在 Dify 内。

如果继续由 Sync change 实现 credential/client foundation、由 Card change 实现 webhook/stream foundation，同一个 Integration 会出现两套 provider initialization、错误清洗、revision capture和connection health。另一方面，当前 provider 集合与产品要求是确定的：受支持 provider 必须能读取目录并发送/更新消息；无需为这些必备操作引入通用 capability registry。

Webhook 与 provider stream 是真正可跨业务复用的 transport。Card action 当前使用它们，未来 provider directory change也可能使用它们触发增量或防抖后的sync。Foundation应验证transport并交付authenticated envelope，但不能理解card submission或directory reconciliation。

```text
Workspace / Trusted Internal API adapters
        (`human-input-v2-api-contracts`)
              |
              v
  IM Integration Management Service
              |
              v
      IM Control-Plane Repository

Sync Directory Adapter -----> Provider Client Factory <----- Card Provider Adapter

Provider Webhook ----+
                     +--> Authenticated Event Transport --> Business Event Sink
Provider Stream -----+                                  |        |
                                                        |        +--> Card Interaction
                                                        +----------> Future Directory Change
```

## Goals / Non-Goals

**Goals:**

- 建立 Integration、credential、provider client与safe diagnostic的单一Dify owner。
- 将 Integration CRUD/test application logic 从 manual sync orchestration 中拆出，提供 transport-neutral composition boundary 供 workspace 与 trusted internal API adapters 共同使用。
- 提供可复用的`WEBHOOK / STREAM` transport，统一authentication、revision binding、ack、lease/fencing与reconnect。
- 让Card与Sync通过明确依赖使用foundation，同时保持自己的domain/application service。
- 保持实现直接、静态和可审阅，不引入通用plugin capability framework。

**Non-Goals:**

- 不实现directory fetch、sync run、reconciliation、identity/binding mutation。
- 不实现card document、card fallback、message send/update orchestration、card interaction inbox或Form submission。
- 不定义`DIRECTORY_READ / CARD_SEND / CARD_UPDATE`等运行时capability flags。
- 不根据capability动态组装adapter graph；provider到具体实现的composition继续使用显式Dify dependency wiring。
- 不在EE中解密credential、创建provider client或运行webhook/stream consumer。
- 不在本change中实现联系人自动同步；只保证未来可以复用authenticated event transport。
- 不拥有 workspace/trusted internal Integration route、Pydantic DTO、authentication/scope/operation-metadata mapping、HTTP error mapping 或 controller tests；这些管理 transport concerns 全部由 `human-input-v2-api-contracts` 独占。Foundation 仍拥有不与管理 API 重叠的 provider public webhook transport。

## Decisions

### 1. Foundation拥有Integration与client lifecycle，不拥有下游业务adapter

新增`IMIntegrationManagementService`，负责Integration read/configure/delete/test、provider tenant confirmation、credential encryption/rotation、CAS与safe status。Sync和Card不再各自实现这些操作。

Provider-specific client factory位于foundation/provider package，负责使用current encrypted configuration创建官方SDK client、设置timeout/proxy/user-agent并清洗construction错误。SDK client只传给同一个provider package内的directory或card adapter，不越过provider adapter边界。

Sync继续拥有`IMDirectoryReader`及`ProviderDirectoryEntry` normalization；Card继续拥有provider-specific card renderer/sender/updater。Foundation只提供受控credential/client construction，不提供巨型`IMProviderAdapter`。

原因：client construction与credential lifecycle是真正共享的基础；directory与card语义不同，合并会放大接口并使change ownership含糊。

### 2. 不建立通用CapabilityRegistry

Feishu、Lark、DingTalk等被Dify声明为Human Input支持的provider时，必须通过固定contract suite证明：

- 可以读取directory；
- 可以发送message；
- 可以更新已发送message/card；
- credential与provider tenant可以被安全确认。

这些是provider接入验收条件，不是tenant runtime flags。Card能否完整表达某个HITL Form由`IMCardSender`和card renderer决定；不兼容时由Card change fallback到text message + secure link。

唯一需要运行时暴露的差异是event transport mode，因为管理员必须选择provider实际支持的`WEBHOOK`或`STREAM`。该差异使用窄的`SupportedEventTransports`值，不扩展成通用capability vocabulary。

### 3. Event transport mode使用`DISABLED / WEBHOOK / STREAM`

`IMEventTransportMode`属于Integration configuration：

- `DISABLED`: 保留manual sync、identity/binding和outbound messaging，不接收provider events。
- `WEBHOOK`: provider通过public HTTP callback交付事件。
- `STREAM`: Dify通过官方SDK建立authenticated long-lived event stream。

Provider foundation为每个provider声明其支持的event transport mode集合。配置不支持的mode必须在CAS write前失败。既有Integration迁移到`DISABLED`，不能因schema rollout自动开放public callback或启动stream。

使用`STREAM`而不是`LONG_POLLING`：Feishu/Lark long connection和DingTalk Stream Mode是SDK管理的长连接事件流，不是HTTP polling loop。

### 4. Foundation只交付Authenticated Event Envelope

Provider webhook/stream adapter完成signature、timestamp、nonce、decrypt、handshake或SDK session authentication后，生成immutable `AuthenticatedIMEventEnvelope`：

- current `IntegrationRevisionToken`；
- provider与provider tenant；
- stable provider event ID、event name与occurred time；
- bounded provider-neutral metadata；
- 已解密但未进行业务解释的bounded event payload。

Envelope不能包含credential、signature、encrypt key、SDK token、HTTP header或SDK object。Payload使用严格大小限制与immutable JSON boundary，只在进程内交给业务sink；Foundation不把raw provider payload持久化。

Foundation使用显式event router把已知provider event name交给一个`AuthenticatedIMEventSink`。当前Card change注册card interaction sink；未来directory change consumer可以增加独立sink。Router是transport dispatch，不是provider capability registry。

### 5. Ack依赖业务sink的durable acceptance

Webhook/stream transport不宣称业务处理完成。Sink返回以下transport-neutral结果：

- `ACCEPTED`: 事件已由业务owner durable accept或已幂等存在；可以success ack。
- `IGNORED`: 事件不是已启用业务topic；可以按provider contract安全ack而不产生业务记录。
- `RETRY`: durable acceptance失败；不得success ack，允许provider redelivery。

Card sink负责自己的canonical interaction inbox与deduplication。Foundation不建立通用业务event inbox，避免现在为未来directory事件预设错误的retention、payload与ordering语义。

### 6. Webhook controller保持薄且provider-specific验证封装在foundation

Public webhook surface只负责route resolution、body size gate、加载current verification context、调用provider transport adapter并映射ack。Provider handshake、signature/encryption与ack body都留在foundation provider package。

Callback URL包含non-secret Integration route identity；安全性来自current provider verification material而不是URL secrecy。Provider replacement或verification secret rotation推进config revision，obsolete request不能通过current verifier。

### 7. Stream runtime使用revision-bound lease与fencing

`STREAM`由专用supervised process role运行，不在Flask request、Socket.IO worker或finite Celery task中常驻。Supervisor读取desired stream Integrations，为完整`integration_id + config_version`获取renewable lease/fencing token，然后启动provider SDK session。

每个event在交付sink前必须再次确认lease fence与current revision。Mode change、credential rotation、provider replacement或lease loss会关闭旧session。Reconnect使用bounded exponential backoff with jitter；heartbeat与connection health属于operational facts，不推进config revision。

### 8. Credential和diagnostic使用allow-list

Encrypted credential只在provider-specific factory/verifier/session construction边界解密。Management response只暴露masked configuration与safe diagnostic。Logs、traces、metrics与error responses禁止包含raw provider response、credential、verification material、SDK token、provider user PII或event payload。

Foundation定义稳定基础错误：invalid configuration、stale revision、authentication failed、permission denied、provider unavailable、rate limited、ambiguous diagnostic与sanitized internal failure。Sync/Card在自己的业务层决定这些错误如何影响run或delivery。

### 9. Dify拥有runtime，EE只消费 transport-neutral boundary

Foundation 暴露单一 `IMIntegrationManagementService` composition entry point，不区分 workspace 与 EE 业务实现。workspace/internal handler、caller authentication、scope/actor mapping 与 `EE Dashboard -> EE Kratos HTTP -> Dify internal HTTP` call graph 由 `human-input-v2-api-contracts` 规范和验证。EE不读取Human Input tables、不持有plaintext provider credential、不运行provider SDK或event transport。

## Risks / Trade-offs

- [Foundation继续膨胀成provider framework] -> 明确只拥有Integration/client/event transport；directory与card adapter仍由downstream change拥有。
- [固定provider baseline无法表达未来部分支持provider] -> Human Input provider接入必须满足完整产品baseline；确需partial provider时重新评估产品层级，而不是提前引入capability registry。
- [Authenticated payload仍可能包含敏感内容] -> strict size/type boundary、in-memory only、禁止raw persistence/logging；业务sink只持久化自己的allow-listed canonical fields。
- [Webhook ack依赖业务sink增加latency] -> sink只执行durable accept/dedup，不同步执行submission或reconciliation；监控ack latency与timeout budget。
- [Stream多实例重复连接] -> Integration revision lease、fencing token、pre-delivery current check与provider event dedup。
- [Credential rotation中断stream] -> config revision推进并受控重启；current identities/bindings按rotation语义保留。
- [Foundation与Sync/Card deployment顺序错位] -> 先部署`DISABLED` foundation和client boundary，再逐个切换downstream adapter与event sink。

## Migration Plan

1. 落地Integration management service、credential/client factory与schema，所有既有Integration迁移为`DISABLED`。
2. 交付 transport-neutral `IMIntegrationManagementService` factory、command/query results 与 API-consumer fixtures；由 `human-input-v2-api-contracts` 将 workspace/trusted internal handlers 接入并保持 HTTP DTO/CAS contract 稳定。
3. 将Sync directory adapters改为使用foundation provider client factory，再移除Sync change内重复的credential/client ownership。
4. 部署webhook transport与event sink contract，但在Card sink完成前保持event mode `DISABLED`。
5. 部署stream runtime、lease/fencing和provider transport adapters，验证shutdown/revision restart后再允许配置`STREAM`。
6. 将Card change接入authenticated event sink，分别灰度`WEBHOOK`与`STREAM`。
7. Rollback时将Integration切回`DISABLED`并停止stream runtime；保留manual sync、identity/binding和outbound message能力。

## Open Questions

- Stream process role最终作为现有API image的新entrypoint还是独立deployment发布，由部署owner决定；lease/fencing contract不依赖打包选择。
- Provider event payload在Foundation与sink之间采用进程内typed object还是bounded immutable JSON，需要在官方SDK版本冻结后选择最小转换方案；两者都不得持久化raw payload。
