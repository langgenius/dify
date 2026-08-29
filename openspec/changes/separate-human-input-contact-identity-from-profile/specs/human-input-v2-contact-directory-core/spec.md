## REMOVED Requirements

### Requirement: Contact Directory domain MUST remain independent from transport and ORM models
**Reason**: 旧 domain package、snapshot 与 policy 将被删除，不再构成运行时 abstraction。
**Migration**: Current Contact consumers 改为依赖 `ContactRepository`；binding reads 额外依赖 `ContactIMBindingRepository`。

### Requirement: Contact identity source MUST be immutable and owner-valid
**Reason**: 旧 `ORGANIZATION_ACCOUNT / WORKSPACE_MEMBER / EXTERNAL` source model 被最终 schema 取代。
**Migration**: 使用 `HumanInputContactIdentity.subject_type` 的 `ACCOUNT / EXTERNAL` mapping，以及独立的 `HumanInputExternalContactProfile`。

### Requirement: Workspace-relative Contact resolution MUST remain separate from canonical identity
**Reason**: 旧 resolution operation 与第四种 `ABSENT` 状态被删除。
**Migration**: `ContactRepository` 只返回 `WORKSPACE / PLATFORM / EXTERNAL` current Contacts；不可用由缺失结果、`None` 或 `False` 表达。

### Requirement: Contact lifecycle MUST enforce directory admission rules
**Reason**: Admission 不再由旧 policy/snapshot domain 执行。
**Migration**: `ContactRepository` 与 schema constraints 执行 Account provisioning、External uniqueness 与 External lifecycle；`EnterpriseContactRepository` 执行 EE candidate 与 Platform entry invariants。

### Requirement: Directory snapshot MUST provide one coherent operation-scoped view
**Reason**: 全量 directory snapshot 被删除。
**Migration**: 调用方按操作使用 `ContactRepository` 的 detail、batch、availability、Email 与 paginated query methods。

### Requirement: Contact persistence MUST own directory transaction invariants
**Reason**: 旧 aggregate repository 与其内部 transaction ownership 被删除。
**Migration**: SQLAlchemy Repository 接收调用方提供的 `Session`；调用方直接使用 `session.begin()` 管理 transaction。
