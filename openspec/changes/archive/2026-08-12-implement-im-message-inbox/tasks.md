## 1. 固化 inbox domain 与运行策略

- [x] 1.1 在 `define-im-provider-adapter-contracts` 的 provider-neutral IM package 上先添加失败测试，覆盖 `IMInboxDelivery`、processing status、consumer decision、claim token 与 lost-lease result 的类型约束。
- [x] 1.2 实现 immutable inbox event/delivery values、`IMInboxConsumer`、repository port 与 typed acceptance/claim/transition results，不让 ORM record、database session 或 Celery type 穿过 core boundary。
- [x] 1.3 定义 `PENDING`、`PROCESSING`、`SUCCEEDED`、`IGNORED`、`FAILED` 状态转换与 `SUCCEEDED` / `IGNORED` / `RETRY` / `FAILED` consumer decisions，拒绝非法或无 current claim token 的转换。
- [x] 1.4 通过 `configs.dify_config` 增加 maximum attempts、lease duration、heartbeat interval、bounded retry backoff、recovery batch size 与 recovery interval 配置，并为默认值和非法组合添加测试。
- [x] 1.5 扩展 import-boundary tests，确认 Provider adapter 只依赖 `IMEventSink`，inbox core 不依赖 Human Input submission、SQLAlchemy、Flask 或 Celery implementation。

## 2. 增加 inbox schema、model 与 mapping

- [x] 2.1 先使用 SQLite 添加 migration/model unit tests，断言 `im_message_inbox` 的 event facts、processing metadata、nullable Provider event ID、claim lease、terminal outcome、timestamps、constraints 与 indexes。
- [x] 2.2 增加单一 `im_message_inbox` SQLAlchemy model 和 forward migration，原子保存 internal UUID、logical Integration ID、Provider/tenant/event metadata、serialization version 与 Provider-native `raw_payload`；不得增加 payload side table 或 broker outbox table。
- [x] 2.3 增加 `(provider, provider_tenant_id, provider_event_id)` nullable unique constraint，以及支持 available-pending、expired-lease 和 backlog 查询的最小复合 indexes；不得把 Integration ID 或 payload hash 放进 dedupe key。
- [x] 2.4 增加 check constraints，保证 status、claim token、lease expiry、availability、terminal outcome 与 completed time 只能形成合法组合。
- [x] 2.5 增加 record/domain mappers 及单元测试，验证 round trip 能重建相同 `AuthenticatedIMEvent`，processing 更新不会修改 immutable event facts。
- [x] 2.6 验证 migration upgrade/downgrade 和 model metadata 一致；downgrade 测试只验证 schema 操作，不在有 accepted backlog 时执行 destructive rollback。

## 3. 实现 transactional repository

- [x] 3.1 先使用真实 SQLite engine 和 inbox table 添加 repository 单元测试，覆盖 new insert、identified duplicate、absent event ID、跨 Provider/tenant 同 ID、serialization failure、commit failure 与 state transition，不使用 mocked database session 替代 persistence behavior。
- [x] 3.2 实现 insert-or-resolve transaction，在 commit 成功后返回 new/existing typed result，并将 expected persistence failure 转成 sink 可处理的 typed failure。
- [x] 3.3 为 identified duplicate 保留原 record/status/outcome，不创建第二条 processing record；对 absent event ID 的每次 delivery 始终 insert 独立 record。
- [x] 3.4 先使用 SQLite 添加 claim state-machine unit tests，覆盖 claim、expired lease eligibility、renewal、retry、terminal finalize、maximum attempts 与 stale token rejection；不把 SQLite 结果作为 `SKIP LOCKED` 或 concurrent claim 的验收证据。
- [x] 3.5 实现短事务 `claim_by_id` 与 bounded `claim_available`，原子设置新 claim token、lease expiry 和 attempt count，并在事务提交后才返回 delivery。
- [x] 3.6 实现带 record ID 与 claim token CAS 的 renew、retry、succeed、ignore 和 fail operations；stale owner 必须得到 lost-lease result 且不能覆盖 current state。
- [x] 3.7 实现 bounded backoff 与 maximum-attempt transition，清除 retry record 的 active claim metadata，并保证三个 terminal status 永不被 automatic claim。
- [x] 3.8 实现 recovery/backlog queries，返回 available pending、expired processing、各状态 count 与 oldest pending age，且不得读取或筛选 `raw_payload`。
- [x] 3.9 添加 PostgreSQL repository integration tests，验证 transaction rollback、nullable unique semantics、concurrent insert、`FOR UPDATE SKIP LOCKED`、exclusive claim、lease reclaim、renewal 与 fencing；这些 database-backed tests 由 CI 执行。

## 4. 实现 Integration-bound IMEventSink

- [x] 4.1 先使用 SQLite inbox table 添加 sink 单元测试，覆盖匹配/冲突 Provider identity、new commit、identified duplicate、serialization/database failure 和 consumer/broker unavailable。
- [x] 4.2 实现 `IMMessageInboxSink` 作为 `IMEventSink` 到单一 `im_message_inbox` table 的 concrete adapter；它在构造时捕获 logical Integration ID 与 expected Provider/tenant facts，不向 Provider adapter 暴露 repository/ORM，也不修改或扩展 `AuthenticatedIMEvent`。
- [x] 4.3 让 sink 仅在 insert-or-resolve commit 后返回 `EventAcceptance.ACCEPTED`；任何 durable acceptance failure 都返回 `RETRY` 或抛出 adapter 可映射的 typed failure。
- [x] 4.4 对任意状态的 identified duplicate 返回 `ACCEPTED`，但不重置 terminal outcome、不增加 attempt，也不创建第二条 record。
- [x] 4.5 在 commit 后增加 bounded best-effort wakeup；publish failure 只记录安全的 structured signal，不能把已 committed event 改回 `RETRY`，且实现可禁用 wakeup 并完全依赖 recovery。
- [x] 4.6 添加 ordering tests，证明 business consumer 和 broker publish 均不在 acceptance transaction 内，Provider success ACK 永远不早于 durable commit。

## 5. 实现 worker、lease heartbeat 与 recovery

- [x] 5.1 先使用 SQLite inbox table 添加 worker 单元测试，覆盖 claim miss、event reconstruction、consumer decisions、unexpected exception、heartbeat、lost lease、retry exhaustion 与 terminal non-replay。
- [x] 5.2 实现只接收 inbox record ID 的 Celery processing task，通过 repository claim 获取 `IMInboxDelivery` 后再调用 injected `IMInboxConsumer`。
- [x] 5.3 在 consumer execution 期间按配置续租；heartbeat failure 或 lost lease 必须阻止 stale terminal write，并输出不含 payload 的 warning。
- [x] 5.4 将 `SUCCEEDED`、`IGNORED`、`RETRY`、`FAILED` 和 unexpected exception 映射到 repository state transitions，确保 consumer call 不发生在 database claim/finalize transaction 内。
- [x] 5.5 实现 bounded periodic recovery task，扫描 available pending 与 expired processing records，并通过同一个 claim path 调度或处理，不复制 `raw_payload` 到 broker message。
- [x] 5.6 添加 publish failure、worker crash、lease expiry、duplicate wakeup 和 recovery race tests，证明 database inbox 是 canonical backlog 且只有 current claim token 能 finalize。
- [x] 5.7 添加 at-least-once contract test，模拟 consumer side effect 后 terminal write 前 crash，证明 record 可重投且 inbox 不声称 exactly-once business execution。

## 6. 验证 Provider event composition boundary

- [x] 6.2 添加 Webhook receiver-level test，断言 authentication 失败或 challenge 不调用 sink，authenticated event commit 成功后才返回 Provider success response，commit 失败映射 retry-compatible response。
- [x] 6.3 为支持 STREAM 的 Provider 添加 callback-level test，断言同一 callback/connection 保留 ACK ownership，而 sink commit 结果只通过 `ACCEPTED` / `RETRY` 控制 ACK。
- [x] 6.4 验证 Webhook 与 STREAM 产生的 event 可写入同一 inbox contract，且 HTTP objects、ACK envelope、SDK client、claim token 与 local Integration ID 都不进入 `AuthenticatedIMEvent`。
- [x] 6.5 使用 PostgreSQL 和 fake consumer 完成 receiver → sink adapter → single inbox table → worker → terminal outcome 的 backend integration test，不在本 change 中接入 card decoding 或 Human Input submission logic。

## 7. 增加 observability 与敏感数据保护

- [x] 7.1 增加 acceptance、duplicate、acceptance failure、dispatch failure、claim、lease reclaim、retry、terminal outcome、lost lease、backlog count 与 oldest pending age metrics。
- [x] 7.2 审计 sink、repository、Celery task 和 recovery logs，确保只记录 record/Integration ID、Provider、attempt、outcome 与 sanitized error code，不记录 `raw_payload`、credentials、verification material 或 submitted values。
- [x] 7.3 添加日志捕获与 broker-message serialization tests，证明失败路径、retry 和 dead terminal outcome 都不会泄漏 Provider-native payload。
- [x] 7.4 记录 terminal table growth 与 payload retention 为后续独立 change；当前实现不得自动删除 record 或破坏 identified-event dedupe state。

## 8. 验证 change

- [x] 8.1 使用 SQLite 运行 event inbox 的 migration/model、repository、sink 和 worker unit tests，并确认新增测试遵循 Arrange-Act-Assert；独立 receiver contract unit tests 可以注入 fake sink，但不能替代 SQLite inbox tests。
- [x] 8.2 运行 `uv run --project api ruff format --check`、targeted Ruff lint 与 targeted Pyright/type checks，修复 inbox change 引入的所有问题。
- [x] 8.3 在 CI 中使用 PostgreSQL 运行 concurrency integration tests 和 receiver-to-worker backend integration tests；不得用 SQLite 结果关闭 row-lock、`SKIP LOCKED` 或 multi-worker acceptance items，本地环境不把 CI-only integration suite 作为前置条件。
- [x] 8.4 使用 failure injection 验证 database commit failure、broker outage、worker crash、expired lease、stale finalize 与 poison event exhaustion，并保存不含敏感 payload 的验收证据。
- [x] 8.5 运行 `openspec validate implement-im-message-inbox --strict`，确认 proposal、design、spec 与 tasks 一致且 apply-ready。
