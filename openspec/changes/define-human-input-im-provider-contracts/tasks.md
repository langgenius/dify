## 1. 先解决受影响实现的证据缺口

- [ ] 1.2 在实现 DingTalk、WeCom、Microsoft Teams adapter 时确认并记录各自的权威目录 endpoint、configured visibility scope、分页/组织遍历和完整性边界；这些实现细节不得改变五个 Provider 都必须支持 Directory sync 的范围
- [ ] 1.3 确认 Microsoft Teams 主动投递所需 Provider message destination 的获取、安装、持久化与刷新方式，并在实现 Teams 投递前回写 `design.md` 与 `im-provider-messaging`
- [ ] 1.4 从现有 Form Content controls 推导字段完整的 normalized interactive-card intent 和 card representability 规则，验证 Slack、Feishu/Lark、Microsoft Teams 的等价语义，并在定义或实现 card renderer 前回写 `design.md` 与 `im-provider-messaging`
- [ ] 1.6 在未决问题回写后审计所有共享语义值与操作，只保留能对应具体操作且具有至少两个 Provider 证据的部分

## 2. 添加窄 Provider contracts 与显式组合

- [ ] 2.1 为 Integration diagnostics、完整目录快照、card representability result、各 Provider 的 message destination、Provider-discriminated message reference、`AuthenticatedEvent` 和 `CardSubmissionRequest` 添加 typed Provider-facing values；message destination 只承载发起新消息所需的 Provider-specific addressing facts，且不接收 Contact、binding、grant、task、workflow 或 ORM objects
- [ ] 2.2 添加 Integration diagnostics、Directory reading、Basic Messaging、Dynamic Card Messaging 与 Event decoding 的 typed contracts；Basic Messaging 组合 destination reachability 与 `send_text`，Dynamic Card Messaging 组合 card representability assessment、`send_card` 与 card update
- [ ] 2.3 让 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 显式实现 Basic Messaging，仅让 Slack、Feishu/Lark 与 Microsoft Teams 额外实现 Dynamic Card Messaging，同时允许 credentials、SDK clients、tenant configuration 和 token caches 作为共享实现细节
- [ ] 2.4 添加边界测试，证明不存在 umbrella `IMProvider`、one-capability-per-method、generic operation dispatcher、runtime capability registry、DingTalk/WeCom dummy card methods 或 Messaging 对 Directory 的隐式依赖

## 3. 实现 Integration diagnostics 与本地生命周期

- [ ] 3.1 实现 Provider-specific candidate credential validation、stable tenant identification、baseline permission checks 和安全的 typed diagnostic failures，且不持久化 candidate state
- [ ] 3.2 实现静态 transport matrix：Slack、Feishu/Lark、DingTalk 接受 `WEBHOOK` 与 `STREAM`，WeCom、Microsoft Teams 拒绝 `STREAM`
- [ ] 3.3 添加针对 diagnostic purity、tenant-identification failure、typed Provider credentials 与 matrix validation 的测试

## 4. 实现完整目录快照读取

- [ ] 4.1 实现 Slack 与 Feishu/Lark Directory readers，由其负责 pagination 或 department traversal，并在内存累积全部 entries 后才返回一个 immutable snapshot
- [ ] 4.2 实现 DingTalk、WeCom 与 Microsoft Teams Directory readers，由各 adapter 负责自己的分页、组织层级与可见范围，并在完成全部遍历后返回 immutable snapshot
- [ ] 4.3 只返回最小共享 identity facts：Provider user ID、display name、optional Email 和 availability；cursors、topology 与 raw responses 保留在各 adapter 内部
- [ ] 4.4 任意 page、department node、authentication step 或 rate-limit wait 导致无法完成读取时，返回 typed failure 且不返回可消费 entries
- [ ] 4.5 为 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 添加针对完整多页/层级读取、缺失 Email、late-page failure 和目录同步不调用 Messaging 的测试

## 5. 实现必备基础 Messaging 与可选动态卡片 Messaging

- [ ] 5.1 为 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 实现必备 Basic Messaging：destination-specific reachability test 与 `send_text`；`send_text` 接收业务层产出的 CommonMark 正文（不支持 custom tags），Provider adapter 负责本平台渲染或在不可表达时降级为纯文本发送；两者都不读取 Directory、不把 destination 当作业务 recipient state，且 reachability result 不改变 Integration diagnostics
- [ ] 5.2 完成任务 1.4 后，为 Slack 与 Feishu/Lark 实现可选 Dynamic Card Messaging：无副作用的 card representability assessment、`send_card` 与基于精确 reference 的 card update；renderer mismatch 必须在任何 Provider send call 前抛出明确 exception，且不改调 `send_text`
- [ ] 5.3 完成任务 1.3 与 1.4 后，使用已确认的 Provider message destination lifecycle 为 Microsoft Teams 实现同一组 Dynamic Card Messaging operations
- [ ] 5.4 验证 DingTalk 与 WeCom 只实现 Basic Messaging，不包含 dummy card assessment、send 或 update methods
- [ ] 5.5 验证 Slack、Feishu/Lark 与 Microsoft Teams 的文本 fallback Delivery Endpoint 始终可以使用 Basic Messaging 的 `send_text` 作为基础 fallback
- [ ] 5.6 在 Dynamic Card Messaging 内使用 Slack `channel + ts`、Feishu/Lark `message_id`、Microsoft Teams `activity_id + conversation context` 更新一个精确 prior card instance，并独立于 earlier send outcome 报告 typed update outcome
- [ ] 5.7 强制每个 binding-test、`send_text` 或 `send_card` attempt 最多调用一次 side-effecting Provider operation；保留 timeout、rate-limit、connection-reset 和其他 ambiguous outcomes，不自动 retry
- [ ] 5.8 添加针对五个 Provider 的 Basic Messaging、三种 card-capable Provider 的完整 Dynamic Card Messaging、card-capable Provider 的文本 fallback、DingTalk/WeCom 无 dummy card methods、assessment 无副作用、boolean-only branching、free-form reason 仅记日志、无 Directory send、CommonMark/no-custom-tag 输入、不可表达 markdown 时降级纯文本、card-rendering exception 发生在 Provider call 前且不降级、精确 message locators、stale-reference update、Provider acceptance semantics、ambiguous outcomes 和 one-call-per-attempt invariant 的测试

## 6. 实现 authenticated event 接入、inbox ACK 与 card decoding

- [ ] 6.1 实现 Provider-specific Webhook receivers，由其负责 URL challenge、HTTP validation、signature/timestamp/replay checks、decryption 和 response encoding，仅在认证成功后产出 `AuthenticatedEvent`
- [ ] 6.2 为 Slack、Feishu/Lark、DingTalk 实现最小本地 STREAM lifecycle，将 connection authentication、control frames、reconnect protocol、envelope validation 和 protocol ACK data 保留在 `AuthenticatedEvent` 之外
- [ ] 6.3 用 Provider、tenant ID、optional real Provider event ID、Provider event time、Dify receive time 和 decrypted Provider-native payload 构建 immutable `AuthenticatedEvent`
- [ ] 6.4 添加一张专用 `im_provider_event_inbox` 表，保存 internal record ID、local Integration ID、Provider/tenant/event metadata、immutable Provider-native payload 和最小 processing outcome metadata
- [ ] 6.5 实现简单 Inbox Repository，仅支持原子 insert-or-resolve-identified-duplicate、claim pending records 和记录 terminal processing outcome，不承担 card decoding 或更上层 Human Input business lookup
- [ ] 6.6 将 Webhook/STREAM receiver persistence path 接入 Inbox Repository，在任何成功 ACK 以及 business decoding 前提交 inbox transaction；broker enqueue 不得替代该 commit
- [ ] 6.7 只对非空 Provider event ID 使用 `(provider, provider tenant ID, provider event ID)` 去重；没有 Provider event ID 时存储 `NULL`，并为每次 delivery 创建独立 inbox record
- [ ] 6.8 对具有真实 event ID 的重复 delivery 复用已有 inbox outcome 并 ACK，不调度第二次 processing attempt；inbox commit 失败时不确认 durable receipt 成功
- [ ] 6.9 为 Slack、Feishu/Lark、DingTalk 添加 Webhook/STREAM 汇合测试，并添加针对 Repository responsibility boundary、authentication failure、challenge/control frame、commit-before-ACK ordering、failed commit、identified duplicate、missing event ID 和 worker claim 的测试

## 7. 解码卡片提交并交给 Human Input

- [ ] 7.1 实现 Slack 与 Feishu/Lark card decoders，将 Provider-native `AuthenticatedEvent` payload 转为 `CardSubmissionRequest`
- [ ] 7.2 完成任务 1.4 后，按照已确认的 normalized card intent 和 interaction-context encoding 实现 Microsoft Teams card decoder
- [ ] 7.3 只填充 Provider/tenant/user identity、optional source event metadata、exact message reference、action identifier、submitted values 与 opaque association metadata；排除 transport secrets、ACK state、SDK clients 和 connection state
- [ ] 7.4 对不是 supported card action 的 authenticated event 返回 typed unsupported-event result，不伪造 submission facts
- [ ] 7.5 添加针对 Slack/Feishu 等价 submission semantics、任务 1.4 完成后的 Teams decoding、unsupported events 和排除 transport state 的测试

## 8. 建立逐 Provider 测试与真实 Payload 证据

- [ ] 8.1 建立完整的 `Provider × API operation / event handler` 覆盖矩阵，覆盖每个支持的 Provider、外部 API operation、入站 transport、event type 与 provider-specific handler；逐格记录 unit-test path、integration-test path、real-execution evidence、sanitized fixture path，并为每个不适用项记录明确理由
- [ ] 8.2 对矩阵中每个适用的 outbound Provider API operation，使用 concrete adapter 对授权的非生产 Provider 环境完成至少一次真实调用，并在将该 operation 标记为完成前捕获真实 request/response payload
- [ ] 8.3 对矩阵中每个适用的 inbound Provider event handler，获取 Provider 实际产生的事件，通过 concrete Webhook 或 STREAM 入口完成至少一次真实处理，并在将该 handler 标记为完成前捕获真实 Provider payload
- [ ] 8.4 将所有捕获的真实 payload 完整脱敏后再提交为 unit-test fixture；替换 credential、secret、token、signature、authorization material、个人与租户数据、会话/消息/事件标识和敏感业务内容，同时保留字段名、嵌套结构、数据类型、可选字段、discriminator 与稳定的跨字段引用关系
- [ ] 8.5 为每个 Provider 的每条适用签名验证或 payload 解密路径建立独立测试项；先脱敏真实明文与 metadata，再用测试专用 signing/verification 或 encryption/decryption material 重新生成 cryptographically valid wire fixture，不得提交或复用真实 Provider secret/key
- [ ] 8.6 使用 Provider 官方 SDK、独立 reference implementation 或与被测 verifier/decrypter 分离的测试辅助工具生成签名和密文；保留 Provider 要求的 byte canonicalization、headers、timestamp、nonce/IV 与 sign/decrypt ordering，禁止由被测实现自行生成期望值
- [ ] 8.7 为每个 Provider 的每条适用路径添加额外单元测试和 receiver-level 集成测试，覆盖合法签名/密文成功、payload/header/ciphertext 篡改失败、错误 secret/key 失败，以及适用时的 timestamp window、replay protection、nonce/IV 与处理顺序；断言所有认证或解密失败均不产生 `AuthenticatedEvent` 或 business-processable inbox record
- [ ] 8.8 为 fixture 记录不含敏感信息的 Provider、operation/event type、Provider API/event version 与采集日期；添加敏感数据扫描和 schema/shape 校验，防止 fixture 泄漏数据或因脱敏破坏真实 wire contract
- [ ] 8.9 为矩阵中的每个适用项添加基于真实脱敏 fixture 的单元测试，覆盖 concrete Provider serializer/parser、response mapping、event decoding 与 handler outcome，不能只测试共享 contract
- [ ] 8.10 为矩阵中的每个适用项添加通过 concrete Provider adapter 或 event receiver boundary 的集成测试；至少一次集成执行必须使用真实 Provider 调用或真实 Provider 事件，fixture replay 或 mock server 不能作为唯一的集成证据
- [ ] 8.11 任一适用矩阵项缺少单元测试、集成测试、真实调用/事件处理证据、脱敏后的真实 payload fixture 或适用的验签/解密测试时，保持该实现项未完成；代表性 Provider 覆盖和手工构造 payload 不得关闭另一个 Provider 的矩阵项

## 9. 验证变更

- [ ] 9.1 为所有改动的 provider contracts、adapters、receivers 与 decoders 运行聚焦的 backend test suites
- [ ] 9.2 为所有改动模块运行仓库要求的 backend formatting、linting 与 type checks
- [ ] 9.3 校验最终 OpenSpec change，并确认实现证据满足四份 capability specs 中属于 Provider 适配范围的每个 scenario
- [ ] 9.4 审计最终覆盖矩阵，确认所有适用项都有四类独立证据、所有适用认证路径都有额外的验签/解密测试、所有 fixture 已完成敏感数据扫描，且没有用 fixture replay 替代真实 Provider 执行
