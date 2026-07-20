## ADDED Requirements

### Requirement: EE dashboard MUST expose Organization-level IM integration APIs via protobuf and `google.api.http`
EE 管理后台 MUST 通过 protobuf / `google.api.http` 暴露 Organization 级 IM integration API，覆盖读取配置、保存配置、删除配置和连接测试。该 surface MUST 只允许一个 Organization 级 IM channel 生效。

#### Scenario: 读取当前 IM integration
- **WHEN** an EE admin calls `GetHumanInputIMIntegration`
- **THEN** 系统 MUST 返回当前唯一 IM channel 的配置摘要与连接状态；如果未配置，MUST 返回 `Not configured`

#### Scenario: 保存或更新 IM integration
- **WHEN** an EE admin calls `UpsertHumanInputIMIntegration`
- **THEN** 系统 MUST 保存新的 Organization-level IM channel config，并保持“同一时刻只允许一个 channel 生效”的约束

#### Scenario: 测试 IM integration
- **WHEN** an EE admin calls `TestHumanInputIMIntegration`
- **THEN** 系统 MUST 返回连接、callback 或 permission 检查结果

#### Scenario: 删除 IM integration
- **WHEN** an EE admin calls `DeleteHumanInputIMIntegration`
- **THEN** 系统 MUST 清空当前 IM integration，并使后续读取结果回到 `Not configured`

### Requirement: EE dashboard MUST expose manual IM sync latest-run APIs
EE 管理后台 MUST 通过 protobuf / `google.api.http` 暴露 manual IM sync API，覆盖创建 sync run、读取最近一次 sync run summary，以及按 result 分页读取最近一次 sync 的结果条目。sync result MUST 能表达 `added / not_matched / failed / removed / skipped` 五类 bucket。

#### Scenario: 手动触发 sync run
- **WHEN** an EE admin calls `CreateHumanInputIMSyncRun`
- **THEN** 系统 MUST 创建一条新的 sync run，并返回新的 run metadata

#### Scenario: 查看最近一次 sync run summary
- **WHEN** an EE admin calls `GetLatestIMSyncRun`
- **THEN** 系统 MUST 返回最近一次 sync run 的 summary，包括 run metadata 和五类 bucket 的 aggregate counts

#### Scenario: 按 bucket 分页查看最近一次 sync result
- **WHEN** an EE admin calls `ListLatestIMSyncRunResults`
- **THEN** 系统 MUST 只返回最近一次 sync run 中某一个 result bucket 的结果条目分页，以及与该分页关联的 run summary

### Requirement: EE human-input admin proto MUST stay narrow and avoid duplicating existing member or workspace CRUD
本 change 的 EE human-input admin proto MUST 只承担 Organization 级 IM control-plane 与 sync state，不得复制已有 enterprise member / workspace 基础 CRUD。workspace console 在 EE 下若需要 Organization member source data，MUST 继续复用已有 enterprise member / workspace API。

#### Scenario: 不新增重复的 member CRUD
- **WHEN** the EE human-input proto package is reviewed
- **THEN** 它 MUST NOT 引入新的 workspace member CRUD RPC；member / workspace source data MUST continue to come from existing enterprise APIs

#### Scenario: sync result item 可以引用现有 member / workspace identifier
- **WHEN** one sync result item is returned from `ListLatestIMSyncRunResults`
- **THEN** 它 MAY 引用已有的 member / workspace identifier，但 MUST 仍然把自己限制在 sync result payload，而不是扩成新的 member detail API
