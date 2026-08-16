## ADDED Requirements

### Requirement: Human Input control-plane orchestration MUST converge in reusable Dify application services

IM credential/configuration、manual sync、automatic binding reconciliation、Organization binding与workspace override的业务规则 MUST 由各自Dify-owned application services或其worker orchestration拥有。Workspace Console与未来Dify EE inner API MUST 作为thin transport adapters调用同一service boundary；它们 MAY 负责各自入口的authentication/authorization、trusted scope/actor construction、必要audit/correlation metadata、DTO mapping与stable error translation，但 MUST NOT 直接编排repository、provider adapter、credential protector、Celery task或reconciliation mutation。Contact initialization MUST only run as the version-upgrade operation `flask data-migrate human-input-contacts --apply`; transports and sync workers MUST NOT expose or invoke it。Ongoing Account/member-to-Contact projection and lifecycle maintenance, including authoritative Account/member write-through and periodic reconciliation, MUST remain owned by the independent `implement-contact-projection-lifecycle-maintenance` change and MUST NOT be implemented or repaired by this production IM sync integration.

#### Scenario: Workspace管理员配置IM channel

- **WHEN** an authenticated Workspace administrator tests, saves, replaces or deletes an IM configuration
- **THEN** Workspace controller MUST map the trusted Workspace context into the shared channel-management application service
- **AND** credential validation/protection、Integration CAS与provider diagnostics MUST remain below that service boundary

#### Scenario: Workspace管理员触发同步或修改关联

- **WHEN** an authenticated Workspace administrator starts manual sync, creates/deletes an Organization binding, or sets/resets a workspace override
- **THEN** controller MUST call the shared manual-sync or binding application service
- **AND** eligibility、dispatch、automatic reconciliation、owner predicates与binding transaction MUST NOT be implemented in the controller

#### Scenario: Manual sync reads current Contacts without repairing them

- **WHEN** the manual-sync worker has read a complete provider directory
- **THEN** the guarded reconciliation input load MUST query currently available Contacts and current membership facts for the trusted scope before planning
- **AND** the manual-sync service、worker、planner and IM repository MUST NOT create、update、delete or backfill Contacts

#### Scenario: Future EE inner API reuses the application services

- **WHEN** a future trusted EE inner API adapter exposes Organization-level credential configuration, manual sync or Contact/IM Identity binding
- **THEN** it MUST reuse the same Dify application services with deployment-scoped trusted context
- **AND** it MUST restrict itself to trusted-service authentication/authorization, necessary audit/correlation handling, DTO/error mapping and transport concerns rather than copying Workspace or domain orchestration

#### Scenario: Multiple transport entrypoints exist

- **WHEN** Workspace Console and EE inner API both expose one Human Input operation
- **THEN** both call paths MUST converge before repository、provider、worker or reconciliation access
- **AND** neither controller MAY invoke the other transport endpoint or form a `Dify -> EE -> Dify` loop

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

#### Scenario: 非生产 composition 显式注入 mock repository

- **WHEN** a test、Storybook Story or development-only entrypoint explicitly injects an in-memory mock repository and named scenario into the Contacts Channels composition
- **THEN** the repository、selected scenario and mutable state MUST be owned by that composition instance
- **AND** different composition instances MUST NOT share or mutate each other's mock state
- **AND** production composition MUST instantiate only generated-client repositories
- **AND** production runtime MUST NOT provide a feature flag、URL parameter、browser storage、global variable or fallback path that selects a mock repository or mock scenario

### Requirement: Manual sync UI MUST follow the server-owned latest run

生产 UI MUST 使用现有 latest-only contract 创建或复用 active run，并以 latest run 作为唯一可轮询状态。客户端 MUST NOT 发明 run history、arbitrary run-by-ID read 或第二套 active-run state。

#### Scenario: 管理员手动触发同步

- **WHEN** the current channel is IM, has persisted connected status, and the authorized administrator selects `Sync now`
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
- **THEN** backend MUST generate immutable last-known identity and Contact snapshots from pre-reconciliation state before mutating or deleting the current binding or identity
- **AND** backend MUST persist those snapshots and the machine-readable removal reason with the `removed` result in the same transaction
- **AND** frontend MUST display the persisted snapshots and removal reason without resolving current identity or Contact state
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

Frontend MUST combine channel kind, persisted channel status and current authorization to determine eligibility。Every current IM provider uses directory synchronization; Email channels do not。Stable application errors MUST map to safe, actionable states without exposing provider payloads or raw exception text。

#### Scenario: Channel is not eligible for sync

- **WHEN** the current channel is absent, is not an IM channel, or does not have persisted connected status
- **THEN** frontend MUST disable manual sync and display the corresponding safe reason
- **AND** it MUST NOT call the sync create endpoint

#### Scenario: Client bypasses the eligibility gate

- **WHEN** a caller requests a new sync without a connected IM Integration in the trusted scope
- **THEN** backend MUST reject the command with a stable safe error before run creation, dispatch, or provider I/O
- **AND** it MUST NOT rely on the frontend gate as an authorization or channel-kind boundary

#### Scenario: Integration revision changes

- **WHEN** sync creation or polling returns the stable revision-changed conflict
- **THEN** frontend MUST invalidate Channels and latest-run state before enabling another action
- **AND** it MUST NOT retry with an inferred newer revision

#### Scenario: Sync infrastructure is unavailable

- **WHEN** Organization write lock、dispatch or another sync prerequisite returns a stable unavailable failure
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
- **THEN** deployment documentation MUST identify `human_input_contact_sync` as required for manual IM Contact synchronization
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

### Requirement: Existing IMProviderAdapter implementations MUST remain the sole provider directory integration

All provider directory synchronization MUST reuse the existing provider-specific `IMProviderAdapter` implementations。The worker MUST obtain the adapter through the existing `DifyIMProviderAdapterFactory` path and MUST read the directory through `adapter.directory.read_directory()`。This change MUST NOT introduce a parallel directory adapter、provider directory HTTP client、pagination/normalization pipeline or management-owned directory read。Existing credential structures MUST remain unchanged when they can already construct and operate the corresponding adapter；a credential change is allowed only when a failing adapter-construction or adapter-contract test proves it necessary，and it MUST be the smallest change that restores the existing adapter path。

#### Scenario: A current provider directory is synchronized

- **WHEN** a worker executes a manual sync for any current IM provider
- **THEN** it MUST construct the existing provider-specific `IMProviderAdapter` through the existing factory path and call its `directory.read_directory()` capability
- **AND** no controller、management handler、application service or frontend repository MAY implement or invoke a parallel provider directory read

#### Scenario: Existing credential structures satisfy adapter construction

- **WHEN** the current plaintext/encrypted credential models can round-trip persisted configuration and construct the existing provider adapter
- **THEN** this change MUST reuse those structures without renaming、duplicating or replacing them
- **AND** provider management wiring MUST adapt its candidate mapping to the existing credential owner rather than introduce a sync-specific credential model

#### Scenario: A credential adjustment is demonstrably required

- **WHEN** a failing test proves that one existing provider adapter cannot be correctly constructed or exercised from the current credential mapping
- **THEN** the implementation MAY minimally adjust the credential structure in its existing owner
- **AND** tests MUST cover encryption round-trip、adapter construction、directory contract compatibility and unaffected provider regressions
- **AND** the adjustment MUST NOT create another directory implementation or move directory ownership out of `IMProviderAdapter`

### Requirement: Current supported IM providers MUST complete end-to-end directory synchronization

The production Workspace path MUST cover the current five IM provider families: Slack、Feishu/Lark、DingTalk、Microsoft Teams and WeCom。`feishu` and `lark` MUST remain separate canonical provider values while sharing their provider-family implementation。For every current IM provider，the Channel API and frontend MUST support credential configuration，manual sync dispatch，complete provider directory read in the worker，binding reconciliation，latest-run and paginated latest-result queries，and frontend result rendering through the same production path。Email MUST remain outside directory synchronization by channel kind。

#### Scenario: A current self-managed IM channel is connected

- **WHEN** an administrator configures valid credentials and required directory scopes for any current IM provider named by this requirement and the server reports the channel connected
- **THEN** the UI MUST allow manual sync and drive run creation、worker directory read、reconciliation、latest query and result rendering through the complete production path
- **AND** provider secrets MUST remain absent from frontend state, responses, logs and sync records

#### Scenario: An Email channel is configured

- **WHEN** the configured Human Input channel is an Email channel
- **THEN** the UI MUST NOT offer directory synchronization
- **AND** the server MUST reject directory-sync operations for that channel before run creation, dispatch or provider I/O

#### Scenario: Enterprise workspace opens settings

- **WHEN** an Enterprise-plan workspace uses the existing separate administration boundary
- **THEN** this production Workspace Contacts integration MUST remain hidden
- **AND** it MUST NOT reinterpret deployment-wide IM ownership
