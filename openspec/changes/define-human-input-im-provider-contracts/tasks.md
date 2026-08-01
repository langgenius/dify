## 1. 先解决受影响实现的证据缺口

- [ ] 1.1 确认由部署控制的 SaaS、CE、EE 到 `WEBHOOK` 或 `STREAM` 的映射，并在接入部署配置前回写 `design.md` 与 `im-provider-integration`；无证据时不得推断映射
- [ ] 1.2 在实现 DingTalk、WeCom、Microsoft Teams adapter 时确认并记录各自的权威目录 endpoint、configured visibility scope、分页/组织遍历和完整性边界；这些实现细节不得改变五个 Provider 都必须支持 Directory sync 的范围
- [ ] 1.3 确认 Microsoft Teams 主动投递所需 Provider message destination 的获取、安装、持久化与刷新方式，并在实现 Teams 投递前回写 `design.md` 与 `im-provider-messaging`
- [ ] 1.4 从现有 Form Content controls 推导字段完整的 normalized interactive-card intent 和 card representability 规则，验证 Slack、Feishu/Lark、Microsoft Teams 的等价语义，并在定义或实现 card renderer 前回写 `design.md` 与 `im-provider-messaging`
- [ ] 1.5 确认本地删除 Integration 后，各 Provider 对迟到 Webhook 或 STREAM delivery 的 terminal ACK，并在实现该响应前回写 `design.md` 与 `im-provider-events`
- [ ] 1.6 在未决问题回写后审计所有共享语义值与操作，只保留能对应具体操作且具有至少两个 Provider 证据的部分

## 2. 添加窄 Provider contracts 与显式组合

- [ ] 2.1 为 Integration diagnostics、完整目录快照、card representability result、各 Provider 的 message destination、Provider-discriminated message reference、`AuthenticatedEvent` 和 `CardSubmissionRequest` 添加 typed Provider-facing values；message destination 只承载发起新消息所需的 Provider-specific addressing facts，且不接收 Contact、binding、grant、task、workflow 或 ORM objects
- [ ] 2.2 添加 Integration diagnostics、Directory reading、Basic Messaging、Dynamic Card Messaging 与 Event decoding 的 typed contracts；Basic Messaging 组合 destination reachability 与 `send_link_message`，Dynamic Card Messaging 组合 card representability assessment、`send_card` 与 card update
- [ ] 2.3 让 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 显式实现 Basic Messaging，仅让 Slack、Feishu/Lark 与 Microsoft Teams 额外实现 Dynamic Card Messaging，同时允许 credentials、SDK clients、tenant configuration 和 token caches 作为共享实现细节
- [ ] 2.4 添加边界测试，证明不存在 umbrella `IMProvider`、one-capability-per-method、generic operation dispatcher、runtime capability registry、DingTalk/WeCom dummy card methods 或 Messaging 对 Directory 的隐式依赖

## 3. 实现 Integration diagnostics 与本地生命周期

- [ ] 3.1 实现 Provider-specific candidate credential validation、stable tenant identification、baseline permission checks 和安全的 typed diagnostic failures，且不持久化 candidate state
- [ ] 3.2 实现静态 transport matrix：Slack、Feishu/Lark、DingTalk 接受 `WEBHOOK` 与 `STREAM`，WeCom、Microsoft Teams 拒绝 `STREAM`
- [ ] 3.3 从部署配置向 Integration create、update、test flows 注入 effective transport mode，并拒绝 tenant-supplied mode override
- [ ] 3.4 实现仅本地的 Integration deletion：先禁止新 send 和 inbound business processing，再停止本地 STREAM connection、删除 credentials 与 active organization bindings/workspace overrides、保留历史事实，且不调用 remote cleanup
- [ ] 3.5 添加针对 diagnostic purity、tenant-identification failure、typed Provider credentials、matrix validation、immutable deployment mode、historical-record preservation 和无 remote deletion call 的测试

## 4. 实现完整目录快照读取

- [ ] 4.1 实现 Slack 与 Feishu/Lark Directory readers，由其负责 pagination 或 department traversal，并在内存累积全部 entries 后才返回一个 immutable snapshot
- [ ] 4.2 实现 DingTalk、WeCom 与 Microsoft Teams Directory readers，由各 adapter 负责自己的分页、组织层级与可见范围，并在完成全部遍历后返回 immutable snapshot
- [ ] 4.3 只返回最小共享 identity facts：Provider user ID、display name、optional Email 和 availability；cursors、topology 与 raw responses 保留在各 adapter 内部
- [ ] 4.4 任意 page、department node、authentication step 或 rate-limit wait 导致无法完成读取时，返回 typed failure 且不返回可消费 entries
- [ ] 4.5 只有收到成功的完整 snapshot 后，才允许 Contact matching、absence detection、binding removal 与 reconciliation
- [ ] 4.6 为 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 添加针对完整多页/层级读取、缺失 Email、late-page failure、不完整读取时零 reconciliation，以及目录同步不调用 Messaging 的测试

## 5. 实现必备基础 Messaging 与可选动态卡片 Messaging

- [ ] 5.1 为 Slack、Feishu/Lark、DingTalk、WeCom 与 Microsoft Teams 实现必备 Basic Messaging：destination-specific reachability test 与 `send_link_message`；两者接收各 Provider 尝试新消息所需的 message destination，不读取 Directory、不把 destination 当作业务 recipient state，且 reachability result 不改变 Integration diagnostics
- [ ] 5.2 完成任务 1.4 后，为 Slack 与 Feishu/Lark 实现可选 Dynamic Card Messaging：无副作用的 card representability assessment、`send_card` 与基于精确 reference 的 card update；renderer mismatch 必须在任何 Provider send call 前抛出明确 exception，且不改调 `send_link_message`
- [ ] 5.3 完成任务 1.3 与 1.4 后，使用已确认的 Provider message destination lifecycle 为 Microsoft Teams 实现同一组 Dynamic Card Messaging operations
- [ ] 5.4 验证 DingTalk 与 WeCom 只实现 Basic Messaging，不包含 dummy card assessment、send 或 update methods
- [ ] 5.5 验证 Slack、Feishu/Lark 与 Microsoft Teams 的 Request URL Delivery Endpoint 始终可以使用 Basic Messaging 的 `send_link_message` 作为基础 fallback
- [ ] 5.6 将 Provider acceptance 与 end-user delivery 分开持久化，并为每次 accepted send 保留精确的 Provider-discriminated message reference
- [ ] 5.7 在 Dynamic Card Messaging 内使用 Slack `channel + ts`、Feishu/Lark `message_id`、Microsoft Teams `activity_id + conversation context` 更新一个精确 prior card instance，并独立于 earlier send outcome 报告 typed update outcome
- [ ] 5.8 在 Human Input application service 中按 card Delivery Endpoint 创建或寻址独立 card instance 与 opaque endpoint-scoped handle / access token；即使多个 Contacts 映射到同一个 Provider identity/destination 也保持独立 reference，并由 Dify 选择实例、逐个 fan out update 和记录 per-Delivery outcome
- [ ] 5.9 强制每个 binding-test、`send_link_message` 或 `send_card` attempt 最多调用一次 side-effecting Provider operation；保留 timeout、rate-limit、connection-reset 和其他 ambiguous outcomes，不自动 retry；人工 Resend 建模为新 attempt
- [ ] 5.10 添加针对五个 Provider 的 Basic Messaging、三种 card-capable Provider 的完整 Dynamic Card Messaging、card-capable Provider 的 link fallback、DingTalk/WeCom 无 dummy card methods、assessment 无副作用、boolean-only branching、free-form reason 仅记日志、无 Directory send、card-rendering exception 发生在 Provider call 前且不降级、同一 Provider identity/destination 下的多 Contact card isolation、Dify-owned update fan-out、精确 message locators、stale-reference update、Provider acceptance semantics、ambiguous outcomes 和 one-call-per-attempt invariant 的测试

## 6. 实现 authenticated event 接入与 inbox ACK

- [ ] 6.1 实现 Provider-specific Webhook receivers，由其负责 URL challenge、HTTP validation、signature/timestamp/replay checks、decryption 和 response encoding，仅在认证成功后产出 `AuthenticatedEvent`
- [ ] 6.2 为 Slack、Feishu/Lark、DingTalk 实现最小本地 STREAM lifecycle，将 connection authentication、control frames、reconnect protocol、envelope validation 和 protocol ACK data 保留在 `AuthenticatedEvent` 之外
- [ ] 6.3 用 Provider、tenant ID、optional real Provider event ID、Provider event time、Dify receive time 和 decrypted Provider-native payload 构建 immutable `AuthenticatedEvent`
- [ ] 6.4 添加一张专用 `im_provider_event_inbox` 表，保存 internal record ID、local Integration ID、Provider/tenant/event metadata、immutable Provider-native payload 和最小 processing outcome metadata
- [ ] 6.5 实现简单 Inbox Repository，仅支持原子 insert-or-resolve-identified-duplicate、claim pending records 和记录 terminal processing outcome，不承担 card decoding 或 Human Input business lookup
- [ ] 6.6 将 Webhook/STREAM receiver persistence path 接入 Inbox Repository，在任何成功 ACK 以及 business decoding/authorization 前提交 inbox transaction；broker enqueue 不得替代该 commit
- [ ] 6.7 只对非空 Provider event ID 使用 `(provider, provider tenant ID, provider event ID)` 去重；没有 Provider event ID 时存储 `NULL`，并为每次 delivery 创建独立 inbox record
- [ ] 6.8 对具有真实 event ID 的重复 delivery 复用已有 inbox outcome 并 ACK，不调度第二次 processing attempt；inbox commit 失败时不确认 durable receipt 成功
- [ ] 6.9 完成任务 1.5 后，实现 Integration 本地删除后迟到事件的 Provider-specific terminal handling，且不创建 business-processable inbox record 或重建 Integration state
- [ ] 6.10 为 Slack、Feishu/Lark、DingTalk 添加 Webhook/STREAM 汇合测试，并添加针对 Repository responsibility boundary、authentication failure、challenge/control frame、commit-before-ACK ordering、failed commit、identified duplicate、missing event ID、worker claim、deleted Integration 和删除前 inbox record 在删除后处理的测试

## 7. 解码卡片提交并交给 Human Input

- [ ] 7.1 实现 Slack 与 Feishu/Lark card decoders，将 Provider-native `AuthenticatedEvent` payload 转为 `CardSubmissionRequest`
- [ ] 7.2 完成任务 1.4 后，按照已确认的 normalized card intent 和 interaction-context encoding 实现 Microsoft Teams card decoder
- [ ] 7.3 只填充 Provider/tenant/user identity、optional source event metadata、exact message reference、action identifier、submitted values 与 opaque interaction context；排除 transport secrets、ACK state、SDK clients 和 connection state
- [ ] 7.4 对不是 supported card action 的 authenticated event 返回 typed unsupported-event result，不伪造 submission facts
- [ ] 7.5 将 `CardSubmissionRequest` 交给现有 Human Input application service，由后者重新校验 opaque context、current identity/binding、allowed approver、task state 和 first-success rules
- [ ] 7.6 添加针对 Slack/Feishu 等价 submission semantics、任务 1.4 完成后的 Teams decoding、unsupported events、排除 transport state，以及 binding 或 Integration 删除后拒绝请求的测试

## 8. 在不扩大范围的前提下切换 callers

- [ ] 8.1 将 manual directory sync 切换到 Directory contract 与 complete-snapshot reconciliation gate
- [ ] 8.2 将 Delivery Endpoint selection 切换到 card representability assessment，并将 binding test、Request URL notification、interactive-card notification 和 card update 切换到 endpoint 已选定的对应 Messaging operation
- [ ] 8.3 将 Webhook/STREAM receivers 切换到 authenticated-event inbox path，并将 inbox workers 切换到 Provider card decoders 与现有 Human Input handoff
- [ ] 8.4 仅在 callers 完成迁移后移除或禁用 bypass paths，同时将 Provider-specific credentials、SDK lifecycle、payload rendering 和 wire protocols 保留在 concrete adapters 内部
- [ ] 8.5 验证没有引入 group messaging、automatic directory scheduling、delivery receipts、automatic send retry、remote revoke/unsubscribe、connection quotas 或 rolling-deployment coordination

## 9. 验证变更

- [ ] 9.1 为所有改动的 contract、adapter、worker、receiver、inbox repository 与 Human Input handoff 运行聚焦的 backend test suites
- [ ] 9.2 为所有改动模块运行仓库要求的 backend formatting、linting 与 type checks
- [ ] 9.3 校验最终 OpenSpec change，并确认实现证据满足四份 capability specs 的每个 scenario
