## ADDED Requirements

### Requirement: Workspace console MUST expose one provider-agnostic IM sync management API

系统 MUST 在现有 `/console/api/workspaces/current/human-input` surface 下提供统一的 IM integration 与 manual sync 管理 API。Feishu、Lark 或后续 provider 的差异 MUST 被封装在 provider adapter 后面，MUST NOT 体现在 route、request body 或 controller 类型上。

#### Scenario: 读取当前 IM integration
- **WHEN** a workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-integration`
- **THEN** the system MUST return the current integration summary through the unified IM integration contract rather than a provider-specific payload

#### Scenario: 更新现有 IM integration
- **WHEN** a workspace owner or admin updates IM integration credentials through `PUT /console/api/workspaces/current/human-input/im-integration`
- **THEN** the system MUST use the same endpoint and compare-and-swap contract for every provider

#### Scenario: 触发一次手动 sync
- **WHEN** a workspace owner or admin calls `POST /console/api/workspaces/current/human-input/im-sync-runs`
- **THEN** the system MUST start sync through the unified manual-sync endpoint rather than any provider-specific sync route

### Requirement: Manual sync orchestration MUST normalize provider data before reconciliation

系统 MUST 先把 provider SDK 或 provider API 返回的数据归一化为统一的 `ProviderDirectoryEntry` 集合，再交给现有 reconciliation 逻辑。controller 和 repository MUST NOT 直接消费厂商 SDK model。

#### Scenario: Provider directory data is fetched
- **WHEN** a sync worker loads members from the configured provider
- **THEN** the adapter MUST convert provider-specific records into `ProviderDirectoryEntry` values before calling the reconciler

#### Scenario: Provider user ID takes precedence
- **WHEN** a provider directory entry matches an existing identity by provider user ID
- **THEN** the system MUST reconcile that entry through the current provider-user-ID-first rule before considering normalized email fallback

#### Scenario: Provider entry is unmatched
- **WHEN** a provider directory entry matches neither an existing identity nor an eligible organization contact by normalized email
- **THEN** the system MUST keep the entry as `not_matched` and MUST NOT create an `External contact`

### Requirement: Manual sync MUST remain revision-guarded, single-active-run, and latest-only

系统 MUST 保持现有 IM control plane 的并发与 revision 语义：同一 integration 同时最多一个 active run；每次 run MUST capture `integration_id + config_version`；latest run read surface MUST NOT 扩展为 run history API。

#### Scenario: Two sync triggers race
- **WHEN** two requests trigger manual sync for the same integration concurrently
- **THEN** the system MUST create at most one active run and MUST return the existing active run to the loser

#### Scenario: Integration changes before apply
- **WHEN** a sync worker is ready to apply reconciliation but the current integration ID or config version no longer matches the run capture
- **THEN** the system MUST mark the run as stale or failed and MUST NOT mutate current identities or bindings

#### Scenario: Reading latest sync summary
- **WHEN** a workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-sync-runs/latest`
- **THEN** the system MUST return only the latest run summary and MUST NOT expose run-by-ID or run-history endpoints

### Requirement: Sync result buckets MUST remain the canonical five-bucket contract

manual sync 的持久化和 API contract MUST 继续使用 `added / not_matched / failed / removed / skipped` 五类 bucket。系统 MUST NOT 在本 change 中把 presentation-only taxonomy 变成新的后端 canonical result type。

#### Scenario: Listing latest sync results by bucket
- **WHEN** a workspace owner or admin calls `GET /console/api/workspaces/current/human-input/im-sync-runs/latest/results?result=added&page=1&limit=20`
- **THEN** the system MUST paginate only the requested canonical bucket from the latest run

#### Scenario: Requesting a non-canonical bucket
- **WHEN** a client omits `result` or requests a bucket outside `added / not_matched / failed / removed / skipped`
- **THEN** the system MUST reject the request

#### Scenario: Mapping presentation-specific labels
- **WHEN** a future presentation layer needs labels such as `created_binding` or `updated_binding`
- **THEN** the system MUST treat those labels as presentation metadata and MUST NOT replace the canonical persisted bucket contract

### Requirement: Feishu and Lark directory adapters SHOULD prefer the official server-side SDK

Feishu 和 Lark 的 provider adapter SHOULD 优先使用官方服务端 Python SDK，并且只向上暴露安全诊断与统一 directory entry。provider raw payload、credential 明文和 SDK exception text MUST NOT 直接进入 controller response。

#### Scenario: Feishu or Lark directory read
- **WHEN** the system loads directory data from Feishu or Lark
- **THEN** the adapter SHOULD use the official server-side Python SDK before considering a handwritten HTTP client

#### Scenario: Provider test fails with sensitive details
- **WHEN** the provider SDK or upstream API returns an error containing sensitive request or credential context
- **THEN** the system MUST expose only a safe diagnostic summary through the management API
