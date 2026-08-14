# human-input-ee-admin-api Specification

## Purpose
TBD - created by archiving change human-input-v2-api-contracts. Update Purpose after archive.
## Requirements
### Requirement: EE dashboard MUST be a Kratos HTTP façade over the Dify-owned Human Input service
EE backend MUST 使用 Protobuf、`google.api.http` 与 Kratos HTTP code generation 定义 Human Input admin service methods，并 MUST NOT 为该 capability 注册 gRPC server 或引入 gRPC-Gateway。每个 endpoint MUST 在完成 EE Dashboard authentication 与 enterprise-administrator authorization 后，通过 typed Dify internal HTTP client 调用 Dify Human Input application service。EE MUST 在 EE-owned audit boundary 持久记录 human actor、operation、target、operation ID 与 outcome，并 MUST 只向 Dify 传播 operation / correlation metadata，不得传播 EE User ID 或要求 Dify 保存 external principal。Dify MUST 是 Organization Contact projection、IM integration、provider adapter、manual sync、reconciliation、worker、latest-result read model 与 binding persistence 的唯一业务 owner；EE MUST NOT 实现第二套 repository、provider adapter、sync worker、reconciler、projector 或 Human Input persistence。

#### Scenario: EE 管理员调用 Human Input endpoint
- **WHEN** an authenticated and authorized EE administrator invokes one Human Input admin endpoint
- **THEN** the operation MUST follow `EE Dashboard -> EE Kratos HTTP -> Dify internal HTTP -> Dify application service`; EE MUST restrict its responsibilities to the EE admin transport and audit boundary, including authentication / authorization, validation / defaulting, typed DTO mapping, EE-owned human-actor audit and operation / correlation orchestration, bounded timeout and operation-safe retry handling, secret-safe observability, and stable error translation; EE MUST delegate all Human Input business commands, queries, execution, and domain persistence to Dify

#### Scenario: Workspace 发起同类操作
- **WHEN** a Dify workspace controller handles an equivalent Human Input operation
- **THEN** it MUST invoke the local Dify application service directly and MUST NOT form a `Dify -> EE -> Dify` request chain

#### Scenario: EE 实现者尝试增加本地 Sync
- **WHEN** an EE implementation introduces a Human Input provider client, sync worker, reconciler, distributed lock, Ent repository, or direct Human Input table access
- **THEN** the implementation MUST be rejected because it creates a second business owner

### Requirement: EE dashboard MUST expose Organization-level IM integration APIs via Protobuf-defined Kratos HTTP
EE 管理后台 MUST 通过 Protobuf / `google.api.http` 生成的 Kratos HTTP handler 暴露 Organization 级 IM integration API，覆盖读取配置、保存provider credential/verification material、删除配置和连接测试。该 façade MUST 只允许一个 Organization 级 IM channel 生效，并 MUST 将所有业务 command/query 委托给 Dify。`DISABLED / WEBHOOK / STREAM` MUST remain deployment-owned runtime configuration and MUST NOT be accepted as an administrator write field.

#### Scenario: 读取当前 IM integration
- **WHEN** an EE admin calls `GetIMIntegration`
- **THEN** 系统 MUST 返回当前唯一 IM channel 的配置摘要、read-only effective deployment event transport mode、适用时的 derived webhook URL、safe operational status、`integration_id` 与 `config_version`；MUST NOT返回tenant-selectable supported modes；如果未配置，MUST 返回 `Not configured`

#### Scenario: 保存或更新 IM integration
- **WHEN** an EE admin calls `UpsertIMIntegration`
- **THEN** EE MUST 将 credentials、provider-specific verification material与CAS command转发给Dify，由Dify按effective deployment mode校验provider transport compatibility、保存新的Organization-level IM channel config，并保持“同一时刻只允许一个channel生效”的约束；EE MUST NOT转发或持久化event transport mode override

#### Scenario: EE admin attempts to override deployment transport
- **WHEN** an EE admin supplies an Integration-level `event_transport_mode` to `UpsertIMIntegration` or `TestIMIntegration`
- **THEN** the Protobuf/Kratos boundary MUST reject the field and MUST NOT forward、persist or shadow deployment runtime configuration

#### Scenario: 首次创建 IM integration
- **WHEN** the deployment has no configured integration and an EE admin calls `UpsertIMIntegration` without an expected integration ID or config version
- **THEN** 系统 MUST 创建新的 integration，并 MUST 从 `config_version = 1` 开始

#### Scenario: Existing integration update 缺少完整 CAS token
- **WHEN** an EE admin updates an existing integration without both `integration_id` and `config_version`, or provides only one of them
- **THEN** 系统 MUST 拒绝请求，并 MUST NOT 修改 integration 或触发 sync

#### Scenario: 使用 stale revision 更新 IM integration
- **WHEN** an EE admin updates an existing integration with a stale or mismatched `integration_id` or `config_version`
- **THEN** 系统 MUST 返回 `409 Conflict`，MUST NOT 修改 integration、清理 IM bindings / workspace overrides 或触发 manual / automatic sync

#### Scenario: 替换当前 IM provider
- **WHEN** an EE admin calls `UpsertIMIntegration` with credentials for a provider different from the current provider
- **THEN** 系统 MUST 将该操作视为 provider replacement，MUST 使旧 provider 的 IM bindings 和 workspace overrides 失效，并 MUST 要求管理员重新执行 manual sync 后才能使用新 provider identity

#### Scenario: 同一 platform tenant 内轮换 provider credentials
- **WHEN** an EE admin updates credentials for the current provider, and the system can confirm that `platform_tenant_id` is unchanged
- **THEN** 系统 MUST 将该操作视为 credential rotation，并 MUST 保留当前 IM identities、Organization bindings 和 workspace overrides

#### Scenario: 更新 credentials 时 platform tenant 变化或无法确认
- **WHEN** an EE admin updates credentials for the current provider, but `platform_tenant_id` has changed or cannot be confirmed as unchanged
- **THEN** 系统 MUST 将该操作视为 provider replacement，MUST 使旧 IM bindings 和 workspace overrides 失效，并 MUST 要求管理员重新执行 manual sync

#### Scenario: 测试 IM integration
- **WHEN** an EE admin calls `TestIMIntegration`
- **THEN** 系统 MUST 返回credential、provider tenant、permission与effective deployment event transport compatibility检查结果，并 MUST NOT接受mode override

#### Scenario: 删除 IM integration
- **WHEN** an EE admin calls `DeleteIMIntegration` with the current `integration_id` and `config_version`
- **THEN** 系统 MUST 清空当前 IM integration，并使后续读取结果回到 `Not configured`

#### Scenario: 使用 stale revision 删除 IM integration
- **WHEN** an EE admin calls `DeleteIMIntegration` with a stale or mismatched `integration_id` or `config_version`
- **THEN** 系统 MUST 返回 `409 Conflict`，并 MUST 保留当前 integration、IM identities、bindings 和 workspace overrides

### Requirement: EE dashboard MUST expose manual IM sync latest-run APIs
EE 管理后台 MUST 通过 Protobuf-defined Kratos HTTP 暴露 manual IM sync API，覆盖触发 sync run、读取最近一次 sync run summary，以及按 result 分页读取最近一次 sync 的结果条目。该 façade MUST 是 latest-only，MUST NOT 新增 run-by-ID、run list 或历史 run detail endpoint。Sync run 的创建或复用、异步调度、provider fetch、reconciliation、persistence 与 result read MUST 全部由 Dify 完成；EE MUST 只转发 command/query 和映射 response。sync result MUST 能表达 `added / not_matched / failed / removed / skipped` 五类 bucket。

#### Scenario: 手动触发 sync run
- **WHEN** an EE admin calls `CreateIMSyncRun`
- **THEN** EE MUST 调用 Dify manual-sync command；Dify MUST 创建新 run 或复用当前 single active run，确保 run 保存当前 `integration_id` 与 `config_version`，并返回 authoritative run metadata

#### Scenario: Sync run 对应的 integration revision 已过期
- **WHEN** an IM sync worker is ready to apply reconciliation results, but the current integration ID or config version no longer matches the revision captured by the run
- **THEN** 系统 MUST 将该 run 作为 stale work 终止，MUST NOT 写入 current IM identities、Organization bindings 或 workspace overrides

#### Scenario: 查看最近一次 sync run summary
- **WHEN** an EE admin calls `GetLatestIMSyncRun`
- **THEN** 系统 MUST 返回最近一次 sync run 的 summary，包括 run metadata、作为 UI 显式同步时间的 `finished_at` 和五类 bucket 的 aggregate counts，并 MUST NOT 返回 `started_by`

#### Scenario: 按 bucket 分页查看最近一次 sync result
- **WHEN** an EE admin calls `ListLatestIMSyncRunResults` with one result bucket plus `page` and `limit`
- **THEN** 系统 MUST 只返回最近一次 sync run 中该 bucket 的结果条目，使用 `page / limit / total` 表达分页状态，MUST NOT 返回 cursor 或重复 run summary；需要 summary 的客户端 MUST 同时请求 `GetLatestIMSyncRun`

#### Scenario: Latest sync result 必须指定真实 bucket
- **WHEN** an EE admin omits `result` or requests an `All` value from `ListLatestIMSyncRunResults`
- **THEN** 系统 MUST 拒绝该请求；`result` MUST 是 `added / not_matched / failed / removed / skipped` 之一，Proto enum MUST NOT 定义 `All` value

#### Scenario: Removed sync result 返回稳定原因
- **WHEN** an EE admin reads one `removed` sync result
- **THEN** 系统 MUST 返回 `not_present_in_directory`、`binding_invalidated` 或 `binding_replaced` 之一作为 machine-readable removal reason

### Requirement: EE dashboard MUST expose Organization Contact IM binding façade APIs
EE 管理后台 MUST 通过 Protobuf-defined Kratos HTTP 暴露 Organization Contact 查询、已同步 IM identity 搜索、binding 创建、删除与连通性测试 API。Dify MUST 通过同一`OrganizationContactProjectionService`负责Account-to-Contact的幂等initial backfill、bounded ensure、periodic reconciliation与availability，并拥有Organization binding transaction boundary；EE MUST 只消费Dify current-state projection。`HumanInputContact`生命周期 MUST 绑定Organization Account，而不是任意单个workspace membership。该façade MUST只适配Organization Contact与Organization-scoped IM binding，MUST NOT承担workspace Contact lifecycle或workspace override。The façade MUST NOT imply one global `im_user_id -> Contact` reverse mapping; identity reuse remains a scope-aware Dify-owned resolution concern.

#### Scenario: 按姓名与 Email 查询 Organization Contact
- **WHEN** an EE admin opens the Contacts admin view or filters by member name or Email
- **THEN** `ListContacts` MUST 返回分页的 Organization Contact、从Dify `Account.created_at`投影的`joined_at`与当前channel binding summary，并 MUST 分别支持member name与Email filter；MUST NOT把`Contact.created_at`解释为加入时间

#### Scenario: Workspace membership 变化不重建 EE Contact identity
- **WHEN** an Organization Account joins or leaves one workspace while the Account remains in the EE Organization
- **THEN** 系统 MUST 保留同一个`HumanInputContact` ID与Contact lifecycle timestamps，MUST NOT因单个workspace membership变化创建或删除该Organization Contact；`joined_at`继续来自同一Account

#### Scenario: Account lifecycle驱动current projection
- **WHEN** an Organization Account is created, updated, disabled, deleted, or reactivated
- **THEN** Dify MUST 通过initial backfill、bounded ensure与periodic reconciliation创建或更新同一Account-backed Contact；unavailable Account MUST 从current-state response省略，同一Account重新active时MUST复用原Contact ID，EE MUST NOT通过Ent或shared-table write修复projection

#### Scenario: 从同步结果搜索 IM identity
- **WHEN** an EE admin adds an IM channel for one Contact
- **THEN** `ListIMIdentities` MUST 支持按 provider 与 IM user ID keyword 搜索已同步 identity，并 MUST NOT 接受自由文本 identity 作为 binding source

#### Scenario: 创建与删除 Organization binding
- **WHEN** an EE admin adds or removes an IM channel for one Contact
- **THEN** `CreateIMBinding` or `DeleteIMBinding` MUST mutate only the selected Organization-scoped binding and return enough identity summary data for the admin view to render the current channel state

#### Scenario: Organization binding reuses one identity already referenced by workspace override
- **WHEN** one provider identity is already reused by a workspace override for another Contact in one workspace
- **THEN** `CreateIMBinding` MUST still be allowed if Dify current-scope predicates pass, and the EE contract MUST NOT reject it as a global uniqueness conflict

#### Scenario: 测试联系人 binding
- **WHEN** an EE admin tests one existing Contact IM channel
- **THEN** `TestIMBinding` MUST test the selected binding's current identity reachability and MUST NOT be implemented as an alias of the Organization-level credentials / deployment-event-transport compatibility / permission test

### Requirement: EE Human Input admin Protobuf contract MUST stay narrow and avoid duplicating business ownership
本 change 的 EE Human Input admin Protobuf contract MUST 只承担 Organization 级 IM integration / sync 与 Organization Contact IM binding 的 Kratos HTTP IDL，不得复制 Dify 业务逻辑，也不得增加已有 enterprise member / workspace 基础 CRUD、workspace Contact lifecycle、workspace IM override、node-data migration 或 Email provider configuration。workspace console 在 EE 下若需要 Organization member source data，MUST 继续复用已有 enterprise member / workspace API。

#### Scenario: 不新增重复的 member CRUD
- **WHEN** the EE human-input proto package is reviewed
- **THEN** 它 MUST NOT 引入新的 workspace member CRUD service method；member / workspace source data MUST continue to come from existing enterprise APIs

#### Scenario: 不新增 workspace-owned management API
- **WHEN** the EE human-input proto package is reviewed
- **THEN** 它 MUST NOT 包含 Platform / External Contact CRUD、workspace IM override、node-data migration 或 Email provider endpoint

#### Scenario: sync result item 可以引用现有 member / workspace identifier
- **WHEN** one sync result item is returned from `ListLatestIMSyncRunResults`
- **THEN** 它 MAY 引用已有的 member / workspace identifier，但 MUST 仍然把自己限制在 sync result payload，而不是扩成新的 member detail API
