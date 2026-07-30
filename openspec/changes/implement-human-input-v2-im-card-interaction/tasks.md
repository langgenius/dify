## 1. HITL v2 card document and sender

- [ ] 1.1 为 immutable `IMCardDocument`、frozen presentation、canonical controls/actions 与 provider-neutral delivery results 编写失败测试。
- [ ] 1.2 扩展 `FormDeliveryProjection`，只加入sender所需的 frozen App/node/message presentation、definition、expiry、Grant与Endpoint facts，并保持显式 eager loading/query-count tests。
- [ ] 1.3 定义基于`FormDeliveryProjection`的Dify-facing `IMCardSender`与provider-neutral `IMCardTransportAdapter`；direct render前生成`IMCardDocument`，`UnsupportedCardShape`返回sender后再生成canonical text fallback，terminal update也使用canonical command；adapter不得接收Form/Grant/Contact/workflow/submission service，并禁止provider SDK types、JSON或credential进入application/core。
- [ ] 1.4 为action-only direct card、supported inline controls、unsupported required controls、fallback文案与secure link编写renderer/sender tests。
- [ ] 1.5 实现逐Form direct-render判断；provider renderer返回typed incompatibility时，由`IMCardSender`发送text message + secure form link且不丢失required input。

## 2. Durable delivery and terminal update operations

- [ ] 2.1 为stable delivery operation、Endpoint capability hash、encrypted short-lived escrow、safe send outcomes与opaque update handles编写mapper/repository失败测试。
- [ ] 2.2 增加create-once delivery operation、claim、attempt append、terminal escrow purge、ambiguous reconciliation与retry scheduling的transaction-shaped repository methods。
- [ ] 2.3 将HITL v2 Form creation与Endpoint capability hash、delivery operation和after-commit dispatch连接起来，保持legacy v1和Email delivery独立。
- [ ] 2.4 为terminal card update operation编写失败测试并实现create-once scheduling、independent retry与retention cleanup，不修改Form lifecycle。

## 3. Provider card adapters

- [ ] 3.1 固定Feishu、Lark与DingTalk用于card/message send/update的官方SDK版本，并为card document mapping、text fallback、safe handles与error classification建立共享contract suite。
- [ ] 3.2 实现Feishu render/send/update adapter，通过Foundation provider-local client lifecycle执行I/O。
- [ ] 3.3 实现Lark render/send/update adapter，保持与Feishu相同的provider-neutral sender/result contract。
- [ ] 3.4 实现DingTalk render/send/update adapter，保持与其他provider相同的provider-neutral sender/result contract。
- [ ] 3.5 增加cross-provider architecture tests，证明不存在`CARD_SEND / CARD_UPDATE` runtime flags、通用capability registry、adapter以上的provider branches或Dify application对concrete provider package的import；只有显式composition/factory module同时认识sender与concrete adapter。
- [ ] 3.6 覆盖provider idempotency、deterministic reconciliation与ambiguous timeout，禁止blind mutation replay。

## 4. Authenticated card event consumption

- [ ] 4.1 为Card-owned `AuthenticatedIMEventSink`编写失败测试，固定`provider entrypoint -> transport adapter -> authenticated envelope -> router -> Card sink -> provider normalizer -> canonical interaction`顺序，并覆盖deployment-selected `WEBHOOK`/`STREAM`等价envelope、rollout期间cross-transport dedup、authenticated provider/tenant facts不可被payload覆盖、unrelated event、normalization failure、durable accept与retry结果。
- [ ] 4.2 为Feishu、Lark与DingTalk实现sink选择之后执行的`IMCardEventNormalizer`，只从authenticated envelope和provider payload生成provider actor、endpoint capability、selected action与bounded inputs；只做结构/type/size validation，不加载Integration/identity/binding/Contact/Account/Grant/Form，不做signature/session verification、provider acknowledgement、Dify authorization、proof construction、Form validation或submission。
- [ ] 4.3 为`CanonicalIMCardInteraction`和inbox编写repository失败测试，覆盖`(integration_id, provider_event_id)`唯一性、bounded values、capability hashing、processing lease与crash recovery。
- [ ] 4.4 实现Card interaction inbox及`accept_once / claim / complete` operations，禁止持久化raw envelope payload、headers、signature、SDK object或plaintext capability。
- [ ] 4.5 注册Card sink到Foundation explicit event router，只有inbox commit/idempotent existence后返回`ACCEPTED`，persistence failure返回`RETRY`，unowned event返回`IGNORED`。
- [ ] 4.6 增加boundary tests，证明raw webhook/SDK callback不能绕过Foundation router直达Card、router不生成canonical Card event、Card不实现webhook controller/ack、stream supervisor、lease/fencing、reconnect或Integration transport configuration。

## 5. HITL v2 card interaction submission

- [ ] 5.1 为capability owner-chain、provider/tenant/endpoint identity mismatch编写processor/proof-resolver失败测试；为binding change、deleted Contact、disabled Account与workspace availability编写shared submission authorization tests，证明Card processor不复制这些规则。
- [ ] 5.2 实现transport-neutral capability resolver和proof-evidence factory，只有它可以从canonical authenticated provider actor与Endpoint owner chain构造`VerifiedIMIdentityProof`；不得在该边界决定Contact、Account、workspace或Form authorization。
- [ ] 5.3 复用或提取frozen-form input validator，并增加IM/Web/Service API canonical values与rejection parity tests。
- [ ] 5.4 覆盖unknown/duplicate fields、invalid action、missing required input与fallback-link伪造direct submission。
- [ ] 5.5 实现只接受`CanonicalIMCardInteraction`与provider-neutral application boundaries的`IMCardInteractionProcessor`，禁止callback/webhook/stream/HTTP request/SDK event/raw provider payload概念进入processor，并通过现有`SubmitHumanInputFormHandler`独占current binding/Contact/Account/workspace/Form authorization、first-success commit与workflow resume。
- [ ] 5.6 扩展submission/inbox transaction boundary或增加transactional outcome bridge，使retry从committed submission恢复而不重复audit/resume/update dispatch。
- [ ] 5.7 增加finite inbox processing tasks、bounded retries、stable terminal rejection与interrupted-processing recovery。

## 6. Terminal state, security and verification

- [ ] 6.1 为IM、Email、Web与Service API winner增加after-commit terminal update scheduling，并验证update failure只影响delivery diagnostics。
- [ ] 6.2 扩展authorization audit projection，保留safe provider event correlation与IM proof snapshot，同时保持resolved Dify Account为Submission actor。
- [ ] 6.3 增加security tests，覆盖cross-tenant capability、raw-payload retention、secret/log redaction、update-handle encryption与provider-response allow-list。
- [ ] 6.4 增加structured metrics和safe logs，覆盖delivery/update、Card sink acceptance、inbox lag/dedup/outcome与submission result，不使用PII或input labels。
- [ ] 6.5 运行targeted domain/service/repository/provider contract/concurrency tests、CI-only first-success integration tests、formatting、linting与type checking。
- [ ] 6.6 验证Foundation、Sync与Card ownership及source dependency graph：同一Card pipeline可消费deployment-selected `WEBHOOK`和`STREAM`，Card不读取、选择或持久化deployment mode，Dify business只依赖provider-neutral contracts，provider adapters不导入Card/HITL service implementation，且Card不复制Foundation transport或Sync reconciliation。
