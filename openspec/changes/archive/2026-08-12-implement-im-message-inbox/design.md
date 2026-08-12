## Context

`478021c5385e2f192b32b3eae3f7e87f5e522b16` 首次把 inbox port、commit-before-ACK 与 worker claim contract 归到 IM event processing boundary，同时把 repository、table 与 worker 明确为 Dify-owned implementation。`b28429ad33a764313c1838ab67cff1a2bfabfdb5` 又把 Provider adapter 收窄为 infrastructure facade：Webhook 与 STREAM 在 `AuthenticatedIMEvent` 和 application-supplied `IMEventSink` 汇合，adapter 只依据 sink 的 `ACCEPTED` / `RETRY` outcome 映射 Provider-specific ACK，不感知 persistence、broker、router 或 business handler。

当前缺口正好位于这两个边界之间。Dify 需要一个 concrete `IMEventSink`，在 Provider ACK deadline 内完成最小 durable acceptance，并在 ACK 后把 event 可靠地交给独立 consumer。这个组件属于 application/persistence infrastructure，不属于 Provider adapter，也不属于 Human Input submission domain。

Inbox implementation 使用 SQLAlchemy persistence boundary。它的 event inbox 单元测试固定使用 SQLite，database integration tests 固定使用 PostgreSQL；只有 PostgreSQL integration tests 能作为 transaction isolation、row lock、`SKIP LOCKED` 与多 worker 并发行为的验收证据。运行时还必须处理多个 API/worker replica、Provider redelivery、Celery publish failure 和 worker crash。`AuthenticatedIMEvent` 可能没有真实 Provider event ID；此时系统不能通过 payload hash、receive time 或 transport envelope 猜测 identity。Provider-native payload 是后续 consumer decoding 的输入，inbox infrastructure 只负责无损保存与重建，不解释其业务语义。

## Goals / Non-Goals

**Goals:**

- 让 `EventAcceptance.ACCEPTED` 严格表示 event 或其 identified duplicate 已经被 Dify durable inbox 接管。
- 在 ACK path 上只完成最小数据库事务，不执行 event decoding、Contact/binding lookup、authorization 或 workflow resume。
- 在多 replica 下只允许一个有效 lease owner 处理一条 record，并能回收 crashed worker 的过期 claim。
- 提供显式 retry、terminal outcome 与 fencing 语义，使 pending work 可恢复、terminal work 不被自动 replay。
- 保持 local Integration routing metadata 与 provider-neutral `AuthenticatedIMEvent` 分离。
- 提供一个明确的 `IMEventSink` adapter，把每次 durable acceptance 映射到单一 `im_message_inbox` 表。
- 保留足够的结构化 metadata、metrics 与安全日志，以诊断 intake、backlog、retry 和 terminal failure。

**Non-Goals:**

- 不实现或修改 concrete Provider Webhook/STREAM capability、authentication、decryption、challenge/control frame 或 ACK encoding。
- 不定义 card submission 等 business event schema，不实现 Human Input authorization、first-success 或 workflow resume。
- 不提供 exactly-once business side effects；consumer 仍需在自己的 domain boundary 实现 idempotency 或 first-success protection。
- 不把 inbox 扩展为通用 event bus、dynamic router、Provider plugin framework 或 arbitrary Celery task store。
- 不处理 Integration create/update/delete、adapter cache replacement、STREAM connection shutdown 或 late delivery policy。
- 不提供 operator replay UI、manual dead-letter repair 或跨 region active-active replication。

## Decisions

### 1. Adapt IMEventSink to one inbox table without changing AuthenticatedIMEvent

`IMMessageInboxSink` 是 `IMEventSink` port 的 concrete adapter。Composition layer 为每个 active local Integration 构造一个 sink；sink 捕获 `integration_id` 与预期 Provider/tenant identity，然后以已有 `IMEventSink.accept(event)` 形式传给对应 Provider adapter capability。每次 `accept()` 通过 repository 写入同一个 `im_message_inbox` table，Provider adapter 不直接依赖 repository、ORM model 或 database session。

该单表同时保存 immutable authenticated event facts 与 processing metadata，不增加独立 event table、payload side table 或 broker outbox table。Local Integration ID 不加入 `AuthenticatedIMEvent`；它只作为 Dify persistence routing metadata 写入 inbox record。

Sink 在持久化前校验 event 的 Provider/tenant facts 与绑定上下文一致。不一致时不创建 record，并返回 `RETRY` 或抛出由 adapter 映射为 retry-compatible failure 的 typed error。Inbox record 对 Integration 使用 logical reference，而不是会随 Integration 删除级联清理的 physical ownership；已接受 event 的历史不能因为当前配置生命周期变化而消失。

Alternative considered: 把 `integration_id` 加进 `AuthenticatedIMEvent`。Rejected because这会污染 Provider-neutral convergence boundary，并让 adapter contract 依赖 Dify persistence identity。

Alternative considered: 让 Provider adapter 直接调用 inbox repository。Rejected because这会把 database contract 拉进 Provider boundary，并绕过 `IMEventSink` 控制反转。

### 2. Commit the database record before returning ACCEPTED

Sink 同步调用 repository 执行一个短事务：序列化 event、insert new record 或解析 identified duplicate，并提交。只有 commit 成功后 sink 才返回 `ACCEPTED`。已识别 duplicate 无论当前是 pending、processing 还是 terminal，都表示 Dify 已经接管同一 Provider event，因此同样返回 `ACCEPTED`。

数据库 serialization、insert、duplicate resolution 或 commit 失败时，sink 返回 `RETRY`；Provider adapter 因而不得发送 successful ACK。Sink 不在该事务中 publish broker message，也不调用 downstream consumer。

Alternative considered: 先 publish Celery 再 ACK。Rejected because broker publish 既不能与数据库事实原子提交，也无法提供可查询的 accepted-event source of truth。

Alternative considered: 在 receiver request/callback 中同步执行业务处理。Rejected because ACK latency、业务可用性和 Provider redelivery 会重新耦合。

### 3. Persist one immutable event record and deduplicate only a real Provider event ID

Dedicated `im_message_inbox` record 至少保存：

- internal UUID、logical local Integration ID；
- Provider、stable Provider tenant ID、nullable real Provider event ID；
- nullable Provider event time、Dify receive time、optional Provider event type；
- serialized decrypted Provider-native `raw_payload` 与 serialization version；
- processing status、attempt count、next availability、claim token、lease expiry；
- terminal outcome、sanitized error code、created/updated/completed timestamps。

`raw_payload` 与其余 event facts 在同一 insert 中写入。Record 在 retention 生命周期内不修改这些 immutable event facts；只有 processing metadata 发生状态转换。Inbox infrastructure 不依据 `raw_payload` deduplicate、select、authorize 或 route，只在 worker handoff 时用它重建原 `AuthenticatedIMEvent`；具体 consumer 可以在自己的 schema boundary 解码 payload。

非空 Provider event ID 使用 `(provider, provider_tenant_id, provider_event_id)` unique constraint。普通 nullable unique constraint 在两种受支持数据库中允许多个 `NULL`，因此 absent event ID 的每次 delivery 都会 insert 新 record。Integration ID 不进入 dedupe key，payload hash、timestamp、message reference 与 ACK envelope identifier 都不得作为替代键。

发生 concurrent insert race 时，repository 在 transaction boundary 解析 unique conflict 并读取既有 record；它不把 duplicate constraint error 泄漏给 adapter。若 duplicate record 仍待处理，post-commit wakeup 可以再次提示 recovery path，但 claim fencing 仍保证只有一个有效 processing attempt。

### 4. Claim with short transactions, renewable leases and fencing tokens

Processing state machine 为：

```text
PENDING -> PROCESSING -> SUCCEEDED
                      -> IGNORED
                      -> FAILED
                      -> PENDING
PROCESSING (expired lease) -> PROCESSING (new claim token)
```

Worker 在短事务中使用 `SELECT ... FOR UPDATE SKIP LOCKED` 选择已经 available 的 `PENDING` record 或 lease 已过期的 `PROCESSING` record，写入新的 opaque `claim_token`、`lease_expires_at` 和递增后的 attempt count，然后提交。Consumer execution 在 claim transaction 之外进行，避免长时间持有 database locks。

若正常处理时间可能超过 lease，worker 使用 record ID 与当前 claim token 续租。完成、ignore、terminal failure 或 retry transition 都必须以 record ID 和 claim token 做 compare-and-swap。旧 worker 在 lease 过期后恢复时无法覆盖新 owner 的结果；lost-lease outcome 只记录结构化 warning，不重新执行业务逻辑。

Alternative considered: 在完整业务处理期间持有 row lock。Rejected because external I/O 或 workflow work 会放大 lock duration、connection pressure 与 failure blast radius。

Alternative considered: 只写 `PROCESSING` 而没有 lease。Rejected because worker crash 会永久搁置 record。

### 5. Make retry and terminal outcomes explicit

Worker 将 record 与重建后的 `AuthenticatedIMEvent` 组装成包含 local routing metadata 的 `IMInboxDelivery`，再调用独立 `IMInboxConsumer`。Consumer 返回以下 typed decision：

- `SUCCEEDED`: 处理完成，record 进入 terminal success；
- `IGNORED`: event 不属于该 consumer 或无需业务动作，record 进入 terminal ignored；
- `RETRY`: transient failure，record 按 bounded backoff 回到 `PENDING`；
- `FAILED`: non-retryable failure，record 进入 terminal failure。

Unexpected exception 按 retryable failure 处理并只记录 sanitized error classification。达到配置的 maximum attempts 后转为 `FAILED`。`SUCCEEDED`、`IGNORED` 与 `FAILED` 都不会被 recovery 自动 claim；未来 manual replay 必须作为显式的新能力设计。

该模型提供 at-least-once consumer delivery，而不是 exactly-once side effects。Worker 可能在 consumer 完成 side effect 后、写 terminal outcome 前崩溃，过期 lease 会导致再次 delivery。Human Input 等 consumer 必须依靠现有 first-success/CAS invariant 防止重复业务提交。

### 6. Treat Celery as a wakeup path, never as durable truth

New record commit 后，application service best-effort publish 一个只携带 inbox record ID 的 Celery task。Publish 必须发生在 transaction commit 之后，避免 worker 观察到尚未提交的 record。Publish failure 不把已经 durable accepted 的 event 改回 `RETRY`；sink 仍返回 `ACCEPTED`，并通过 metrics/logging 暴露 dispatch failure。

Periodic recovery task 以 bounded batch 扫描 available `PENDING` 和 expired `PROCESSING` records，并触发或直接执行同一 claim path。Direct task、duplicate wakeup 与 recovery scan 都不能绕过 repository claim。Broker payload 不复制 `raw_payload`、Integration credentials 或 claim token。

### 7. Keep observability metadata structured and payload-safe

Metrics 至少区分 acceptance、identified duplicate、acceptance failure、dispatch failure、claim、lease reclaim、retry、terminal outcome、lost lease，并暴露 oldest pending age 和 pending/processing backlog。Logs 只包含 inbox record ID、logical Integration ID、Provider、attempt、outcome/error code 等结构化 metadata；不得输出 `raw_payload`、credentials、verification material 或 submitted form values。

本 change 不自动删除 inbox record。若未来需要清除 terminal payload 或 record，必须先定义 dedupe window，并为仍在 window 内的 identified event 保留足够 tombstone facts，避免同一 event 被当作新 event 重新处理；该 retention 能力需要独立 change。

### 8. Use SQLite for unit tests and PostgreSQL for integration tests

Event inbox unit tests 使用真实 SQLite engine 和 `im_message_inbox` schema，覆盖 mapping、insert-or-resolve、nullable event ID、state transition、sink acceptance、worker outcome 与 failure mapping。它们不得用纯 repository mock 替代 persistence behavior；上层 receiver test 可以注入 fake sink，但 inbox 自身的 unit-test suite 必须经过 SQLite table。

Database integration tests 使用 PostgreSQL，覆盖 concurrent insert、unique-conflict resolution、transaction rollback、`SELECT ... FOR UPDATE SKIP LOCKED`、exclusive claim、expired lease reclaim、renewal 与 claim-token fencing。SQLite 会省略或弱化 row lock/isolation semantics，因此 SQLite test success 不得关闭任何 PostgreSQL concurrency acceptance item。

Alternative considered: 所有测试都使用 SQLite。Rejected because SQLite 不能证明 production row-lock 与 concurrent-claim contract。

Alternative considered: 单元测试使用 mocked session。Rejected because它无法验证 single-table mapping、atomic write、nullable uniqueness 和 transaction rollback behavior。

## Risks / Trade-offs

- [Database write latency consumes Provider ACK budget] → 保持 acceptance transaction 最小、为 dedupe index 建立覆盖测试，并监控 commit latency 与 ACK deadline margin。
- [Lease expiry can cause overlapping consumer execution] → 使用 renewable lease 与 claim-token fencing；consumer 仍必须满足 at-least-once idempotency contract。
- [Broker outage delays accepted events] → 数据库保持 canonical backlog，periodic recovery 在 broker 恢复后扫描 pending/expired records。
- [Poison event can retry indefinitely] → 使用 bounded attempts、backoff 与 terminal `FAILED`，并输出 failure metrics。
- [Provider payload contains sensitive data] → 原子保存但不写日志，限制 repository/API exposure，并在后续 retention change 中保留 dedupe tombstone；operator payload inspection 不进入公共业务接口。
- [SQLite unit tests can hide PostgreSQL locking defects] → SQLite 只验证快速 persistence behavior；所有 isolation、row-lock 与 concurrent-claim invariants 必须由 PostgreSQL integration tests 验收。
- [Terminal record retention grows table/index size] → 以 status、availability 和 lease expiry 建立最小索引并监控增长；在定义 dedupe tombstone 前不自动清理。

## Migration Plan

1. 先落地 `define-im-provider-adapter-contracts` 中的 `AuthenticatedIMEvent`、`EventAcceptance` 与 `IMEventSink` contracts。
2. 增加单一 `im_message_inbox` model、forward migration、repository ports 与 `IMMessageInboxSink` adapter；先用 SQLite unit tests 验证 persistence behavior，部署时尚不切换 receiver traffic。
3. 增加 consumer port、worker、recovery task、metrics 与配置，并用 SQLite unit tests 和 fake consumer 验证完整 intake/claim/finalize path。
4. Production Provider ingress、task runtime 与 concrete consumer composition 由 Linear issue [WTA-1962](https://linear.app/dify/issue/WTA-1962) 独立跟踪，不阻塞本 infrastructure change 归档。
5. 回滚 application code 时先停止新 receiver intake 与 inbox workers，保留 table 和 accepted records；只有在 backlog 清空或已安全导出后才允许执行 destructive downgrade。

## Open Questions

- 初始 `maximum_attempts`、lease duration、heartbeat interval 与 retry backoff 的 production defaults 应取何值？这些值只影响运行策略，不改变状态机 contract。
- 后续 retention change 应如何让 terminal payload lifecycle、privacy policy 和 dedupe tombstone window 对齐？
- Recovery 使用 Celery beat 定时扫描还是复用现有 scheduler infrastructure；哪种方式能在 CE、SaaS 与多 replica 部署中保持单次 bounded scan？
