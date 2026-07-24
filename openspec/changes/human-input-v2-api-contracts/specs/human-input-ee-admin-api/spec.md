## ADDED Requirements

### Requirement: EE dashboard MUST expose Organization-level IM integration APIs via protobuf and `google.api.http`
EE 管理后台 MUST 通过 protobuf / `google.api.http` 暴露 Organization 级 IM integration API，覆盖读取配置、保存配置、删除配置和连接测试。该 surface MUST 只允许一个 Organization 级 IM channel 生效。

#### Scenario: 读取当前 IM integration
- **WHEN** an EE admin calls `GetHumanInputIMIntegration`
- **THEN** 系统 MUST 返回当前唯一 IM channel 的配置摘要、连接状态、`integration_id` 与 `config_version`；如果未配置，MUST 返回 `Not configured`

#### Scenario: 保存或更新 IM integration
- **WHEN** an EE admin calls `UpsertHumanInputIMIntegration`
- **THEN** 系统 MUST 保存新的 Organization-level IM channel config，并保持“同一时刻只允许一个 channel 生效”的约束

#### Scenario: 首次创建 IM integration
- **WHEN** the deployment has no configured integration and an EE admin calls `UpsertHumanInputIMIntegration` without an expected integration ID or config version
- **THEN** 系统 MUST 创建新的 integration，并 MUST 从 `config_version = 1` 开始

#### Scenario: Existing integration update 缺少完整 CAS token
- **WHEN** an EE admin updates an existing integration without both `integration_id` and `config_version`, or provides only one of them
- **THEN** 系统 MUST 拒绝请求，并 MUST NOT 修改 integration 或触发 sync

#### Scenario: 使用 stale revision 更新 IM integration
- **WHEN** an EE admin updates an existing integration with a stale or mismatched `integration_id` or `config_version`
- **THEN** 系统 MUST 返回 `409 Conflict`，MUST NOT 修改 integration、清理 IM bindings / workspace overrides 或触发 manual / automatic sync

#### Scenario: 替换当前 IM provider
- **WHEN** an EE admin calls `UpsertHumanInputIMIntegration` with credentials for a provider different from the current provider
- **THEN** 系统 MUST 将该操作视为 provider replacement，MUST 使旧 provider 的 IM bindings 和 workspace overrides 失效，并 MUST 要求管理员重新执行 manual sync 后才能使用新 provider identity

#### Scenario: 同一 platform tenant 内轮换 provider credentials
- **WHEN** an EE admin updates credentials for the current provider, and the system can confirm that `platform_tenant_id` is unchanged
- **THEN** 系统 MUST 将该操作视为 credential rotation，并 MUST 保留当前 IM identities、Organization bindings 和 workspace overrides

#### Scenario: 更新 credentials 时 platform tenant 变化或无法确认
- **WHEN** an EE admin updates credentials for the current provider, but `platform_tenant_id` has changed or cannot be confirmed as unchanged
- **THEN** 系统 MUST 将该操作视为 provider replacement，MUST 使旧 IM bindings 和 workspace overrides 失效，并 MUST 要求管理员重新执行 manual sync

#### Scenario: 测试 IM integration
- **WHEN** an EE admin calls `TestHumanInputIMIntegration`
- **THEN** 系统 MUST 返回连接、callback 或 permission 检查结果

#### Scenario: 删除 IM integration
- **WHEN** an EE admin calls `DeleteHumanInputIMIntegration` with the current `integration_id` and `config_version`
- **THEN** 系统 MUST 清空当前 IM integration，并使后续读取结果回到 `Not configured`

#### Scenario: 使用 stale revision 删除 IM integration
- **WHEN** an EE admin calls `DeleteHumanInputIMIntegration` with a stale or mismatched `integration_id` or `config_version`
- **THEN** 系统 MUST 返回 `409 Conflict`，并 MUST 保留当前 integration、IM identities、bindings 和 workspace overrides

### Requirement: EE dashboard MUST expose manual IM sync latest-run APIs
EE 管理后台 MUST 通过 protobuf / `google.api.http` 暴露 manual IM sync API，覆盖创建 sync run、读取最近一次 sync run summary，以及按 result 分页读取最近一次 sync 的结果条目。该 surface MUST 是 latest-only，MUST NOT 新增 run-by-ID、run list 或历史 run detail RPC。sync result MUST 能表达 `added / not_matched / failed / removed / skipped` 五类 bucket。

#### Scenario: 手动触发 sync run
- **WHEN** an EE admin calls `CreateHumanInputIMSyncRun`
- **THEN** 系统 MUST 创建一条新的 sync run，保存当前 `integration_id` 与 `config_version`，并返回新的 run metadata

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

### Requirement: EE dashboard MUST expose Organization Contact IM binding control-plane APIs
EE 管理后台 MUST 通过 protobuf / `google.api.http` 暴露 Organization Contact 查询、已同步 IM identity 搜索、binding 创建、删除与连通性测试 API。EE `HumanInputContact` 的生命周期 MUST 绑定 Organization Account，而不是任意单个 workspace membership。该 surface MUST 只管理 Organization Contact 与 Organization-scoped IM binding，MUST NOT 承担 workspace Contact lifecycle 或 workspace override。

#### Scenario: 按姓名与 Email 查询 Organization Contact
- **WHEN** an EE admin opens the Contacts control-plane or filters by member name or Email
- **THEN** `ListHumanInputContacts` MUST 返回分页的 Organization Contact、`created_at` 与当前 channel binding summary，并 MUST 分别支持 member name 与 Email filter；控制面 MUST 将 `created_at` 展示为 `Joined`

#### Scenario: Workspace membership 变化不重建 EE Contact identity
- **WHEN** an Organization Account joins or leaves one workspace while the Account remains in the EE Organization
- **THEN** 系统 MUST 保留同一个 `HumanInputContact` ID 与 `created_at`，MUST NOT 因单个 workspace membership 变化创建或删除该 Organization Contact

#### Scenario: 从同步结果搜索 IM identity
- **WHEN** an EE admin adds an IM channel for one Contact
- **THEN** `ListHumanInputIMIdentities` MUST 支持按 provider 与 IM user ID keyword 搜索已同步 identity，并 MUST NOT 接受自由文本 identity 作为 binding source

#### Scenario: 创建与删除 Organization binding
- **WHEN** an EE admin adds or removes an IM channel for one Contact
- **THEN** `CreateHumanInputIMBinding` or `DeleteHumanInputIMBinding` MUST mutate only the selected Organization-scoped binding and return enough identity summary data for the control-plane to render the current channel state

#### Scenario: 测试联系人 binding
- **WHEN** an EE admin tests one existing Contact IM channel
- **THEN** `TestHumanInputIMBinding` MUST test the selected binding's current identity reachability and MUST NOT be implemented as an alias of the Organization-level credentials / callback / permission test

### Requirement: EE human-input admin proto MUST stay narrow and avoid duplicating existing member or workspace CRUD
本 change 的 EE human-input admin proto MUST 只承担 Organization 级 IM integration / sync 与 Organization Contact IM binding control-plane，不得复制已有 enterprise member / workspace 基础 CRUD、workspace Contact lifecycle、workspace IM override、node-data migration 或 Email provider configuration。workspace console 在 EE 下若需要 Organization member source data，MUST 继续复用已有 enterprise member / workspace API。

#### Scenario: 不新增重复的 member CRUD
- **WHEN** the EE human-input proto package is reviewed
- **THEN** 它 MUST NOT 引入新的 workspace member CRUD RPC；member / workspace source data MUST continue to come from existing enterprise APIs

#### Scenario: 不新增 workspace-owned management API
- **WHEN** the EE human-input proto package is reviewed
- **THEN** 它 MUST NOT 包含 Platform / External Contact CRUD、workspace IM override、node-data migration 或 Email provider RPC

#### Scenario: sync result item 可以引用现有 member / workspace identifier
- **WHEN** one sync result item is returned from `ListLatestIMSyncRunResults`
- **THEN** 它 MAY 引用已有的 member / workspace identifier，但 MUST 仍然把自己限制在 sync result payload，而不是扩成新的 member detail API
