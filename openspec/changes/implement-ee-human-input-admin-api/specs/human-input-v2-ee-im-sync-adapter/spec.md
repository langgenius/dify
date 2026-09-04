## ADDED Requirements

### Requirement: Dify MUST 是 IM Channel 与 sync 逻辑的唯一 owner

EE Human Input admin implementation MUST NOT 实现 provider adapter、credential persistence、Channel aggregate、CAS repository、sync reconciler、background worker 或 sync-result persistence。所有 Channel 与 sync command/query MUST 通过 typed Dify internal client进入 Dify Human Input application service。

#### Scenario: EE 管理员触发 manual sync
- **WHEN** `CreateIMSyncRun` 通过 Kratos HTTP service到达 EE backend
- **THEN** EE MUST 调用 Dify internal Human Input endpoint，并 MUST NOT 在 EE process中拉取 provider directory、创建 worker job或直接写 Human Input tables

#### Scenario: 实现者尝试复用 EE Dify DB client
- **WHEN** Channel、run、identity、binding 或 result需要读取或修改
- **THEN** EE adapter MUST 使用 Dify internal HTTP contract，MUST NOT 添加对应 Ent schema、repository或 raw SQL access

### Requirement: Typed Dify client MUST 保持 Channel CAS、credential command与read-only deployment transport语义

EE client MUST 一对一转发 Channel get/upsert/delete/test request，包括完整 `channel_id + config_version` CAS token、provider-specific credential shape和replace-or-preserve operation。Upsert/test request MUST NOT携带`DISABLED / WEBHOOK / STREAM` mode；get/test response MAY映射Dify返回的read-only effective deployment mode和safe compatibility/health。EE MUST NOT在本地模拟或覆盖deployment transport policy、transport support、version advancement、provider replacement、credential rotation或identity invalidation。

#### Scenario: 管理员更新当前 Channel
- **WHEN** request包含 current CAS token 与 credential command
- **THEN** EE MUST 将 command原样映射到 Dify internal DTO，并 MUST 以 Dify response作为唯一 current-state result

#### Scenario: Update 遇到 stale revision
- **WHEN** Dify 返回 stale-revision conflict
- **THEN** EE MUST 原子地向调用方暴露 conflict，MUST NOT 读取共享 DB后重试或在 EE 中合并 state

### Requirement: Manual sync MUST 由 Dify 创建并异步执行

EE `CreateIMSyncRun` MUST 只调用 Dify command endpoint并返回 Dify创建或复用的 active run。Single-active-run、captured Channel revision、async scheduling、retry、idempotent apply 与 terminal transition MUST 全部由 Dify保证。EE client MUST NOT 对 timed-out mutation执行 blind retry。

#### Scenario: 两个 EE 请求并发触发 sync
- **WHEN** 两个 administrator request同时到达 EE
- **THEN** 两个请求 MUST 独立转发到 Dify，由 Dify single-active-run contract决定结果，EE MUST NOT 增加第二套 distributed lock

#### Scenario: Create sync response timeout
- **WHEN** Dify可能已接受 command但 EE 未收到 response
- **THEN** EE MUST 返回可识别的 upstream outcome并允许调用方重新读取 latest run，MUST NOT 自行创建 run或启动 provider fetch

### Requirement: Latest sync read model MUST 原样来自 Dify

EE MUST 通过 Dify internal API读取 latest run summary 与 latest result page。Result request MUST 指定 `added`、`not_matched`、`failed`、`removed` 或 `skipped` 中一个真实 bucket，并使用 `page / limit / total`；response MUST 使用 `finished_at`，省略 `started_by`，且 result page MUST 不重复 run summary。

#### Scenario: 管理员读取 latest result bucket
- **WHEN** request包含有效 bucket、page 与 limit
- **THEN** EE MUST 转发相同 query并仅做 Dify DTO到 Protobuf response的无损 mapping

#### Scenario: Dify 尚无 sync run
- **WHEN** Dify返回稳定的 latest-run-not-found outcome
- **THEN** EE MUST 映射为约定的 not-found/empty state，MUST NOT 从 EE DB或缓存构造历史结果

### Requirement: Human Input sync execution path MUST 不产生跨系统调用回环

该 capability 的运行时方向 MUST 固定为 `EE Dashboard → EE Kratos HTTP → Dify internal HTTP → Dify application service/worker → provider`。Dify Human Input internal controller、application service与 worker MUST NOT 在本次 operation中调用 EE Human Input API。Dify workspace controller MUST 直接调用同一 Python application service，而不是通过 EE Kratos API转发。

#### Scenario: EE Dashboard 发起 sync
- **WHEN** operation进入 Dify Human Input application service
- **THEN** 后续 provider fetch、reconciliation、persistence与readback MUST 在 Dify-owned boundary内完成，MUST NOT callback EE

#### Scenario: Dify workspace 发起同类 operation
- **WHEN** workspace endpoint被当前 edition允许调用
- **THEN** controller MUST 直接调用本地 Human Input application service，MUST NOT形成 `Dify → EE → Dify` request chain

### Requirement: Internal client resilience MUST 区分 query 与 mutation

EE Dify client MUST 为所有 operation设置 bounded timeout并传播 correlation ID。Safe GET query MAY 按现有 client policy有限重试；CAS mutation、binding mutation与manual sync command MUST NOT blind retry，除非 Dify contract提供明确 idempotency guarantee并有对应 contract test。

#### Scenario: GET latest run遇到瞬时网络错误
- **WHEN** existing safe-read retry policy允许重试且总 timeout未超限
- **THEN** client MAY 进行有限重试并 MUST 保持同一 correlation context

#### Scenario: Upsert integration遇到 connection reset
- **WHEN** request可能已经到达 Dify
- **THEN** client MUST NOT 自动重放 mutation，并 MUST 返回 ambiguous upstream failure供调用方重新读取 current revision
