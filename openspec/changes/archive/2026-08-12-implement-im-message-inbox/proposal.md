## Why

`define-im-provider-adapter-contracts` 已将 Provider transport 与下游处理解耦到 application-supplied `IMEventSink`，但 Dify 尚无能够兑现 `ACCEPTED` 语义的 durable consumer。现在需要补齐独立的 IM message inbox，使 Webhook 与 STREAM 只有在事件已被 Dify 持久接管后才成功 ACK，并让业务处理脱离 Provider 的 ACK deadline。

## What Changes

- 增加 Dify-owned `IMMessageInboxSink`，作为把 `IMEventSink.accept()` 适配到单一 `im_message_inbox` 表的 concrete adapter；它绑定一个本地 Integration、捕获本地路由上下文，但不改变 provider-neutral `AuthenticatedIMEvent` contract。
- 增加专用 inbox persistence，在同一原子事务中保存 Provider、tenant、可选真实 event ID、event/receive time、local Integration ID 与 immutable `raw_payload`。
- 只有真实 Provider event ID 存在时，按 `(provider, provider tenant ID, provider event ID)` 去重；缺少 event ID 的每次 delivery 均保留为独立记录，不使用 payload hash 或 transport envelope 合成标识符。
- 增加可并发、可在 worker crash 后回收的 lease-based claim contract，以及明确的 pending、processing 和 terminal outcome 语义。
- 增加 inbox worker 与 recovery dispatch path。Broker publish 只用于降低处理延迟；数据库 inbox 始终是 durable source of truth，broker failure 不撤销已经持久接管的事件。
- 定义独立的 downstream consumer port。Inbox worker 只负责可靠交付 authenticated event 和记录处理结果，不在 repository 或 claim transaction 中解码 card、加载 Contact/binding、执行 submission authorization 或恢复 workflow。
- 增加 migration、repository、sink、worker 和并发/故障恢复测试，覆盖 commit-before-ACK、identified duplicate、missing event ID、atomic `raw_payload`、concurrent claim、expired lease 与 terminal record non-replay。
- 固定 database test matrix：event inbox 单元测试使用 SQLite，database integration tests 使用 PostgreSQL；SQLite 不作为 row-lock、`SKIP LOCKED` 或多 worker 并发语义的证据。

## Capabilities

### New Capabilities

- `im-message-inbox`: 将 `IMEventSink` 适配到单一 inbox table，并提供 authenticated IM events 的 durable acceptance、real-ID deduplication、lease-based worker claim、recovery dispatch 与 downstream consumer handoff contract。

### Modified Capabilities

无。

## Impact

- 影响 backend IM application boundary、SQLAlchemy model/migration、repository、`IMEventSink` composition、Celery worker/recovery task 与 observability。
- Provider adapter 继续只依赖 `IMEventSink`，不感知 inbox model、database session、broker、claim lease 或业务 consumer。
- 测试影响限定为 SQLite unit-test harness 与 PostgreSQL integration-test environment；PostgreSQL integration tests 负责验证真实 transaction isolation、row lock 和并发 claim。
- 新增的 inbox table 会承载 Provider-native `raw_payload`；inbox infrastructure 只负责原样持久化和重建 authenticated event，不解释 payload，且必须遵守 retention 与日志最小化边界。
- 本 change 不实现 Provider-specific Webhook/STREAM adapter、card decoder、Contact/binding resolution、Human Input authorization、workflow resume、通用 event bus 或 exactly-once business execution。
