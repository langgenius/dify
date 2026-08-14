## ADDED Requirements

### Requirement: Production Contacts Channels MUST use generated Console clients

非 Enterprise 的 production Contacts Channels composition MUST 通过 generated `consoleClient` / `consoleQuery` bindings 访问 canonical Channels 与 IM sync APIs。内存 mock repository MUST 仅用于测试、Story 或显式开发 fixture，MUST NOT 成为 production page 的默认数据源。

#### Scenario: 管理员打开生产 Channels 页面

- **WHEN** workspace owner or admin opens Contacts Channels in a production composition
- **THEN** 页面 MUST 从 canonical Channels API 读取安全 channel state
- **AND** 页面 MUST NOT instantiate the in-memory mock repository

#### Scenario: Channel mutation 完成

- **WHEN** test、save、replace 或 delete operation returns
- **THEN** frontend MUST refetch the authoritative current channel view through generated bindings
- **AND** frontend MUST NOT infer persisted credential or connection state from the submitted candidate

#### Scenario: 显式开发 fixture 被启用

- **WHEN** a test, Story, or explicit development-only composition injects the mock repository
- **THEN** existing deterministic scenarios MAY remain available
- **AND** that selection MUST be instance-scoped and absent from the production composition

### Requirement: Manual sync UI MUST follow the server-owned latest run

生产 UI MUST 使用现有 latest-only contract 创建或复用 active run，并以 latest run 作为唯一可轮询状态。客户端 MUST NOT 发明 run history、arbitrary run-by-ID read 或第二套 active-run state。

#### Scenario: 管理员手动触发同步

- **WHEN** current IM channel is connected, advertises directory-sync capability, and the authorized administrator selects `Sync now`
- **THEN** frontend MUST issue exactly one create-or-get-active request
- **AND** it MUST render the returned persisted run rather than a client-generated placeholder

#### Scenario: 最新 run 正在执行

- **WHEN** latest run status is `queued` or `running`
- **THEN** frontend MUST poll the latest-run query at a bounded interval
- **AND** it MUST disable duplicate local triggers until the run becomes terminal or the authoritative state changes

#### Scenario: 最新 run 进入终态

- **WHEN** latest run status becomes `succeeded` or `failed`
- **THEN** frontend MUST stop polling
- **AND** it MUST invalidate the current channel summary and selected latest-result bucket

#### Scenario: 创建请求结果不明确

- **WHEN** dispatch or transport failure makes the create response ambiguous
- **THEN** frontend MUST read latest state before allowing another create request
- **AND** it MUST NOT blindly retry a non-idempotent HTTP mutation

#### Scenario: 尚无同步记录

- **WHEN** latest-run query returns the stable not-found response for a configured Integration
- **THEN** frontend MUST render an empty first-sync state
- **AND** it MUST NOT classify that absence as a provider failure

### Requirement: Sync presentation MUST use the canonical reconciliation taxonomy

同步摘要与详情 MUST 使用 `added / not_matched / failed / removed / skipped`，并 MUST preserve the backend meanings of those buckets。Frontend MUST NOT expose mock-only `matched / created_binding / updated_binding / unmatched` transport values。

#### Scenario: 成功 run 不需要人工关注

- **WHEN** a `succeeded` run has zero `not_matched` and zero `failed` results
- **THEN** frontend MUST present a successful terminal state
- **AND** `removed` or `skipped` counts MUST NOT by themselves turn the run into partial failure

#### Scenario: 成功 run 包含待处理结果

- **WHEN** a `succeeded` run has a non-zero `not_matched` or `failed` count
- **THEN** frontend MUST derive a partial-success or attention-required presentation
- **AND** the underlying transport status MUST remain `succeeded`

#### Scenario: Added 结果被展示

- **WHEN** latest results contain an `added` item
- **THEN** frontend MUST display the provider entry and matched Contact snapshot returned by the server
- **AND** it MUST NOT attempt to distinguish mock-only create versus update subtypes

#### Scenario: Removed 结果被展示

- **WHEN** latest results contain a `removed` item
- **THEN** frontend MUST display the last-known identity, Contact snapshot and machine-readable removal reason
- **AND** it MUST NOT interpret removal as Contact deletion

### Requirement: Sync details MUST remain latest-only and bucket-paginated

同步详情 MUST combine the latest run summary with one required result bucket queried by `page / limit`。UI MUST NOT request an `all` bucket, cursor pagination or historical run detail that the server does not provide。

#### Scenario: 管理员打开最新同步详情

- **WHEN** the selected `sync_run_id` equals the current latest run ID
- **THEN** frontend MUST render summary counts from the latest-run response
- **AND** it MUST query one canonical non-empty or administrator-selected result bucket

#### Scenario: 管理员切换结果 bucket

- **WHEN** the administrator selects another canonical result bucket
- **THEN** frontend MUST reset that bucket to page one
- **AND** it MUST NOT mix items or pagination metadata from the previous bucket

#### Scenario: 后续页读取失败

- **WHEN** loading a later page fails with a classified safe error
- **THEN** frontend MUST retain already loaded items and offer retry for the failed page
- **AND** it MUST NOT discard the run summary or other bucket caches

#### Scenario: URL 指向的 run 已不是 latest

- **WHEN** URL state contains a `sync_run_id` different from the authoritative latest run ID
- **THEN** frontend MUST treat the detail context as stale, clear or replace that URL state, and explain that only latest details are available
- **AND** it MUST NOT display latest data under the historical ID

### Requirement: Sync eligibility and failures MUST be server-authoritative

Frontend MUST combine the server-declared directory-sync capability, persisted channel status and current authorization to determine eligibility。Stable application errors MUST map to safe, actionable states without exposing provider payloads or raw exception text。

#### Scenario: Channel is not eligible for sync

- **WHEN** the current IM channel is absent, not connected, or lacks directory-sync capability
- **THEN** frontend MUST disable manual sync and display the corresponding safe reason
- **AND** it MUST NOT call the sync create endpoint

#### Scenario: Client bypasses the eligibility gate

- **WHEN** a caller requests a new sync for an Integration that is not connected or whose provider lacks server-declared directory-sync capability
- **THEN** backend MUST reject the command with a stable safe error before run creation, dispatch, or provider I/O
- **AND** it MUST NOT rely on the frontend gate as an authorization or capability boundary

#### Scenario: Integration revision changes

- **WHEN** sync creation or polling returns the stable revision-changed conflict
- **THEN** frontend MUST invalidate Channels and latest-run state before enabling another action
- **AND** it MUST NOT retry with an inferred newer revision

#### Scenario: Sync infrastructure is unavailable

- **WHEN** Contact projection, Organization write lock, dispatch, or another sync prerequisite returns a stable unavailable failure
- **THEN** frontend MUST show a retryable safe error and preserve the last completed summary
- **AND** it MUST NOT expose internal queue, lock, credential, or provider details

### Requirement: Default runtime MUST consume IM Contact sync work

Every supported default API worker deployment MUST consume the `human_input_contact_sync` queue, and every documented custom queue override MUST state that the queue is required for manual IM Contact synchronization。

#### Scenario: Default worker starts

- **WHEN** the standard Community or Cloud worker starts without a custom queue override
- **THEN** its queue list MUST include `human_input_contact_sync`
- **AND** a persisted queued run MUST be claimable by a registered worker

#### Scenario: Operator configures a custom queue list

- **WHEN** `CELERY_QUEUES` or `CELERY_WORKER_QUEUES` overrides the default list
- **THEN** deployment documentation MUST identify `human_input_contact_sync` as required for this capability
- **AND** automated configuration coverage MUST detect its omission from repository-owned examples

#### Scenario: Worker completes a dispatched run

- **WHEN** the sync endpoint persists and dispatches a run while the provider adapter returns a complete directory
- **THEN** a worker MUST reconcile the captured run idempotently and persist a terminal status plus queryable result counts
- **AND** redelivery MUST NOT duplicate current-state mutations or result facts

### Requirement: Change-scoped test coverage MUST meet release thresholds

Release coverage MUST use executable line coverage aggregated across production modules added or changed by this change。Unit-test line coverage MUST be at least 85%。Integration-test line coverage MUST be at least 80% over backend production modules added or changed by this change，and the CI-owned PostgreSQL/Redis container suite MUST measure and enforce that integration threshold。

#### Scenario: Unit coverage is below the release threshold

- **WHEN** focused unit suites report less than 85% aggregate line coverage for production modules added or changed by this change
- **THEN** release verification MUST fail

#### Scenario: Integration coverage is below the release threshold

- **WHEN** the CI-owned PostgreSQL/Redis container suite reports less than 80% aggregate line coverage for backend production modules added or changed by this change
- **THEN** integration verification MUST fail

### Requirement: Slack MUST be the first end-to-end provider slice

The initial release gate for this capability MUST prove self-managed Slack configuration, directory read, reconciliation, latest query and frontend rendering in Community or non-Enterprise Workspace scope。Other providers MUST remain unavailable unless their management path and the same end-to-end contract are complete。

#### Scenario: Self-managed Slack is connected

- **WHEN** an administrator configures valid Slack credentials with required directory scopes and the server reports the channel connected
- **THEN** the UI MUST allow manual sync and drive the complete production path
- **AND** provider secrets MUST remain absent from frontend state, responses, logs and sync records

#### Scenario: Another provider is incomplete

- **WHEN** Feishu, DingTalk or another provider lacks complete management or release-gate coverage
- **THEN** the server MUST omit directory-sync capability or return a safe unavailable state for that provider
- **AND** frontend MUST NOT enable sync by inferring capability from provider name

#### Scenario: Enterprise workspace opens settings

- **WHEN** an Enterprise-plan workspace uses the existing separate administration boundary
- **THEN** this production Workspace Contacts integration MUST remain hidden
- **AND** it MUST NOT reinterpret deployment-wide IM ownership
