## REMOVED Requirements

### Requirement: Contact 类型与 Organization / Workspace 作用域
**Reason**: 旧 capability 将 current Contact projection 与 Organization classification 绑定在一个全局 governance spec 中，且依赖已删除的 workspace resolution abstraction。
**Migration**: Current Contact type rules 迁移到 `human-input-v2-contact-repository`；`human-input-v2-tenant-ownership-model` 仅继续定义 canonical `tenant_id` terminology 与 owner predicates，不接管任何跨 tenant search。

### Requirement: External contact 准入规则
**Reason**: External Contact admission 现在由 `ContactRepository` 与 `HumanInputExternalContactProfile` schema constraints 直接定义。
**Migration**: External save、tenant ownership、normalized Email uniqueness 与 Account/External same-email coexistence 迁移到 `human-input-v2-contact-repository`；HTTP behavior 继续由 `human-input-console-management-api` 定义。

### Requirement: Contact 生命周期随成员状态变化
**Reason**: 旧 requirement 依赖 workspace resolution 与 `ABSENT`，并错误地令 SaaS/CE membership removal 替换 Contact identity。
**Migration**: Stable Account-backed identity、current Contact omission、External lifecycle 与 Platform entry behavior 迁移到 `human-input-v2-contact-repository`。

### Requirement: Organization 边界必须统一适用于 EE / CE / SaaS
**Reason**: Organization/tenant ownership 不属于独立 Contact governance capability。
**Migration**: Dify core `ContactRepository` 只接受一个 canonical `tenant_id`，不执行跨 tenant search。EE Platform candidate search 与 deployment-wide Organization scope 继续由 EE implementation 和 EE adapter capabilities 定义。

### Requirement: IM Channel、Organization binding 与 workspace override 归属
**Reason**: IM Channel ownership、binding scope 与 override precedence 属于 IM control plane，而不是 Contact governance。
**Migration**: 迁移到 `human-input-v2-im-control-plane-core`、channel management 与 Contact binding capabilities。

### Requirement: IM identity 必须基于手动同步结果选择
**Reason**: IM identity candidate source 与 manual synchronization 属于 IM provider/control-plane workflow。
**Migration**: 继续由 `human-input-v2-im-control-plane-core`、IM provider directory 与 Console IM APIs 定义。

### Requirement: Sync details 必须表达一次 sync run 的 binding 对账结果
**Reason**: Sync result buckets 与 reconciliation semantics 属于 IM synchronization capability。
**Migration**: 继续由 `human-input-v2-im-control-plane-core`、IM sync runtime 与 `human-input-console-management-api` 定义。

### Requirement: Contact 的创建、编辑与可见性必须受权限约束
**Reason**: Contact API authorization 属于 Console/API capability，不需要单独 governance abstraction。
**Migration**: 继续由 `human-input-console-management-api` 与 EE admin API capabilities 定义。

### Requirement: Platform contact 搜索必须限制在 EE Organization 范围内的 owner / admin
**Reason**: Platform candidate search 是 edition-aware Console/EE application behavior。
**Migration**: 继续由 `human-input-console-management-api` 与 EE admin API capabilities 定义；Repository 只执行 tenant/account predicates。

### Requirement: Contact 管理界面必须显式区分联系人分组与添加路径
**Reason**: Contact grouping 与 add-menu behavior 属于 Console transport 和 frontend management surface。
**Migration**: 继续由 `human-input-console-management-api` 与 Contacts management UI capability 定义。
