## ADDED Requirements

### Requirement: Dify MUST be the single IM Sync implementation owner across all editions

Dify `IMSyncService` MUST exclusively own manual-sync run creation, directory reads through `IMDirectoryReader`, background execution, reconciliation, revision-guarded apply, sync-result persistence, and latest-result queries. Integration configuration、credential/client lifecycle 与 connection test MUST remain owned by `implement-human-input-v2-im-provider-foundation` and consumed through its current Integration boundary. The Sync service factory and composition boundary MUST be transport-neutral and MUST be shared by every workspace or trusted-internal API consumer. EE MUST NOT implement a parallel directory adapter, sync worker, reconciler, repository, distributed lock, or Human Input persistence path. Pydantic DTOs, Flask/internal HTTP adapters, caller authentication/scope mapping, HTTP error mapping, and controller tests MUST remain owned by `human-input-v2-api-contracts`.

#### Scenario: Workspace 与 EE consumer 执行同类 command
- **WHEN** workspace and trusted-internal consumers issue equivalent commands for the same Organization integration
- **THEN** both MUST resolve the same Dify application service implementation and MUST NOT select edition-specific provider, worker, reconciler, or repository paths

#### Scenario: 两个 consumer 并发触发 sync
- **WHEN** commands originating from workspace and EE entry points concurrently target the same current integration
- **THEN** both MUST reach the same Dify single-active-run repository contract, and at most one active run MUST exist

#### Scenario: Dify implementation 不依赖 EE transport
- **WHEN** the Dify application service executes a sync, identity, or binding operation
- **THEN** it MUST NOT import or call an EE Human Input transport implementation and MUST NOT form a `Dify -> EE -> Dify` call chain

### Requirement: The manual-sync application boundary MUST be provider-agnostic

`IMSyncService` MUST provide provider-neutral manual-sync trigger、latest-run summary 和 latest-result pagination operations。Feishu、Lark、DingTalk 或后续 provider 的差异 MUST 被封装在 `IMDirectoryReader` adapter 后面，MUST NOT 进入 command/query type、service branch 或 repository contract。

#### Scenario: 触发一次手动 sync
- **WHEN** an application consumer issues a manual-sync command
- **THEN** the service MUST capture the current Foundation-provided `integration_id + config_version` and use the unified Dify-owned orchestration path rather than a provider-specific or edition-specific sync implementation

#### Scenario: 查询 latest run
- **WHEN** an application consumer requests sync status
- **THEN** the service MUST return one provider-neutral latest-run read model rather than a provider SDK object or provider-specific payload

#### Scenario: 查询 latest results
- **WHEN** an application consumer requests one canonical result bucket
- **THEN** the service MUST paginate through the unified latest-result query boundary for every provider

### Requirement: Manual sync orchestration MUST normalize provider data before reconciliation

系统 MUST 先在 matching provider adapter 内把 provider SDK 或 provider API 返回的数据归一化为统一的 `ProviderDirectoryEntry` 集合，再交给现有 reconciliation 逻辑。`ProviderDirectoryEntry` MUST be the Sync-owned canonical Dify input consumed by `SyncReconciler`, not a provider DTO, and the system MUST NOT introduce a second provider-neutral directory model after the adapter returns it. Application service、worker、reconciler 和 repository MUST NOT directly consume provider SDK models, import concrete provider packages or branch on provider-specific directory shapes. Directory adapters MUST stop at canonical conversion and safe error mapping; they MUST NOT load the Dify reconciliation snapshot, execute matching or reconciliation, mutate Contact/identity/binding state, build `ReconciliationPlan` or persist sync results.

#### Scenario: Provider directory data is fetched
- **WHEN** a sync worker loads members from the configured provider
- **THEN** the adapter MUST convert provider-specific records into `ProviderDirectoryEntry` values before calling the reconciler

#### Scenario: Canonical entries reach reconciliation
- **WHEN** `IMDirectoryReader` returns a normalized directory
- **THEN** the worker MUST pass those `ProviderDirectoryEntry` values and a separately loaded current `ReconciliationSnapshot` to `SyncReconciler` without another provider-specific conversion

#### Scenario: Provider adapter finishes normalization
- **WHEN** a concrete directory adapter has produced canonical entries or a safe failure
- **THEN** it MUST return control to the Sync worker and MUST NOT reconcile, persist or mutate Dify business state

#### Scenario: Provider user ID takes precedence
- **WHEN** a provider directory entry matches an existing identity by provider user ID
- **THEN** the system MUST reconcile that entry through the current provider-user-ID-first rule before considering normalized email fallback

#### Scenario: Provider entry is unmatched
- **WHEN** a provider directory entry matches neither an existing identity nor an eligible organization contact by normalized email
- **THEN** the system MUST keep the entry as `not_matched` and MUST NOT create an `External contact`

### Requirement: Manual sync MUST remain revision-guarded, single-active-run, and latest-only

系统 MUST 保持现有 IM control plane 的并发与 revision 语义：同一 integration 同时最多一个 active run；每次 run MUST capture `integration_id + config_version`；application query boundary MUST only expose the latest run and MUST NOT add run-history semantics。Deployment-owned `DISABLED / WEBHOOK / STREAM` mode MUST NOT enter the run capture、stale predicate or reconciliation input。

#### Scenario: Two sync triggers race
- **WHEN** two commands trigger manual sync for the same integration concurrently
- **THEN** the system MUST create at most one active run and MUST return the existing active run to the loser

#### Scenario: Integration changes before apply
- **WHEN** a sync worker is ready to apply reconciliation but the current integration ID or config version no longer matches the run capture
- **THEN** the system MUST mark the run as stale or failed and MUST NOT mutate current identities or bindings

#### Scenario: Deployment event transport mode changes during sync
- **WHEN** a deployment rollout changes between `DISABLED`, `WEBHOOK` and `STREAM` while a manual sync run is active
- **THEN** the run MUST retain its captured Integration revision and MUST NOT become stale solely because of the deployment mode change

#### Scenario: Reading latest sync summary
- **WHEN** an application consumer queries sync status
- **THEN** the service MUST return only the latest run summary and MUST NOT expose run-by-ID or run-history operations

### Requirement: Sync result persistence MUST retain the canonical five-bucket taxonomy

manual sync 的持久化与 application read model MUST 继续使用 `added / not_matched / failed / removed / skipped` 五类 bucket。系统 MUST NOT 在本 change 中把 presentation-only taxonomy 变成新的后端 canonical result type。

#### Scenario: Listing latest sync results by bucket
- **WHEN** an application consumer queries one canonical bucket from the latest run
- **THEN** the service MUST paginate only that bucket and return a transport-neutral result page

#### Scenario: Requesting a non-canonical bucket
- **WHEN** a result-page query omits the bucket or selects a value outside `added / not_matched / failed / removed / skipped`
- **THEN** the application service MUST reject the query with a typed transport-neutral error

#### Scenario: Mapping presentation-specific labels
- **WHEN** a future presentation layer needs labels such as `created_binding` or `updated_binding`
- **THEN** the system MUST treat those labels as presentation metadata and MUST NOT replace the canonical persisted bucket taxonomy

### Requirement: Directory adapters MUST use the Foundation client lifecycle

Feishu、Lark 与 DingTalk directory adapters MUST use the provider-local client lifecycle supplied by `implement-human-input-v2-im-provider-foundation` and MUST expose only safe diagnostics and normalized directory entries to the application boundary. Provider raw payload、credential plaintext、SDK client objects and SDK exception text MUST NOT leave the provider package.

#### Scenario: Supported provider directory is read
- **WHEN** the system loads directory data from Feishu, Lark or DingTalk
- **THEN** the adapter MUST use the current Foundation client lifecycle and MUST NOT construct a parallel client or handwritten credential-bearing HTTP path

#### Scenario: Directory read fails with sensitive details
- **WHEN** a directory read returns an error containing sensitive request or credential context
- **THEN** the adapter MUST return only a safe transport-neutral diagnostic and MUST retain sensitive details inside the provider boundary

#### Scenario: Directory provider implementation is selected
- **WHEN** a Sync composition factory wires Feishu, Lark or DingTalk directory access
- **THEN** only that explicit composition boundary MAY import both the concrete adapter and the Sync service, while the service and reconciler MUST depend only on `IMDirectoryReader` and canonical Sync values
