# HITL Approval Domain, Contact And IM Domain Model

## 背景

HITL 二期需要在 CE、EE、SaaS 三种部署形态下统一处理联系人、Human Roster、IM 绑定、IM 凭据和运行时审批人解析。

核心张力来自企业边界不同：

| 形态 | 物理部署 | 真实企业边界 | Workspace 语义 |
| --- | --- | --- | --- |
| SaaS | 多个企业共用一个 Dify 部署 | 一个 `Tenant` / workspace 通常就是一个 SMB 企业 | 企业本身 |
| CE | 一个部署对应一个企业 | deployment | 单 workspace facade |
| EE | 一个部署对应一个企业 | deployment | 企业内部门、团队或业务单元 |

因此不要让运行时直接判断 CE / EE / SaaS。领域层应先抽象出稳定的业务边界，再用策略对象处理部署形态差异。

## 直接结论

先引入 `ApprovalDomain` 作为产品层和应用层主抽象。它表示一次 HITL 配置与运行所属的审批域，用来统一回答：

- 当前 workflow 可以从哪个联系人目录和 Human Roster 选择审批人。
- 其他 workspace 的 Dify member 是否在当前审批域内可见。
- External contact 由谁管理，workflow editor 是否能创建。
- IM identity 和 IM app credential 应如何解析。
- 提交时如何校验身份、当前成员状态和 binding 状态。
- 审计时按哪个组织边界解释“谁审批了什么”。

`workspace_id (tenant_id)` 只应作为系统入口 locator：controller、现有 DB 存储、迁移和 adapter 可以使用它；进入应用服务后，应先解析为 `ApprovalDomainContext`，后续领域接口优先传 `ApprovalDomainContext`、`ContactDirectoryId`、`HumanRosterId`、`HITLTaskId` 等业务对象，而不是继续层层传 `workspace_id`。

当前 SaaS 没有“一个企业多个 workspace”的产品计划，因此不建议现在新建 `approval_domains` 表。`ApprovalDomain` 可以先由 `ApprovalDomainResolver` 从 workspace locator 和部署形态推导出来；如果未来 SaaS 需要一个企业多个 workspace，再将 `ApprovalDomain` 或其背后的企业边界持久化。

这样保留产品语言的一致性，同时避免把 CE / EE / SaaS 差异泄漏到 Contact、Roster、Recipient、Task 的核心模型中。

## 领域划分

| Bounded Context | 职责 | 不负责 |
| --- | --- | --- |
| Identity Context | 对齐 `Account`、`TenantAccountJoin`、账号状态和 workspace 成员关系 | 发送通知 |
| Approval Domain Context | 解析当前审批域、联系人目录、Human Roster、IM 集成策略和授权策略 | 发送通知 |
| Contact Directory Context | 管理审批域内可见的 Dify account-backed contact 和 IM identity binding | HITL task 生命周期 |
| Roster Context | 管理当前审批域下可选择的联系人集合、external contact、成员离开后的可选择状态 | IM 凭据存储 |
| IM Integration Context | 管理 IM provider、app installation、credential owner、IM identity binding、通讯录同步 | 表单提交 |
| HITL Runtime Context | 从节点配置解析 recipients，创建 task 快照，发送通知，校验提交人 | 管理联系人目录 |
| Audit Context | 记录解析、投递、访问、提交、拒绝和敏感数据处理策略 | 决定业务权限 |

## 核心对象

### Approval Domain

| 对象 | 类型 | 说明 |
| --- | --- | --- |
| `ApprovalDomain` | Product Concept | 审批域。产品和应用服务讨论“谁可被通知、谁可提交、用哪套集成能力”的主语。 |
| `ApprovalDomainContext` | Application Context | 由 resolver 生成的运行时上下文，聚合联系人目录、Human Roster、IM 集成和授权策略。 |
| `ContactDirectoryId` | Value Object | 当前审批域可见的联系人目录引用。 |
| `HumanRosterId` | Value Object | 当前审批域下 workflow editor 可选择的联系人集合引用。 |
| `IMIntegrationPolicy` | Value Object | 当前审批域解析 IM provider、installation、credential chain 和 channel capability 的策略。 |
| `RosterPolicy` | Value Object | 当前审批域的 roster 初始化、添加、可选择和成员离开处理规则。 |
| `AuthorizationPolicy` | Value Object | 当前审批域打开、提交和 pending task 再校验规则。 |
| `AuditPolicy` | Value Object | 当前审批域审计字段、脱敏和保留策略。 |

`ApprovalDomainContext` 是代码中主要传递的上下文。它可以包含底层 owner / locator，但这些细节不应扩散到普通领域服务。

推荐形态：

```text
ApprovalDomainContext
  id
  contact_directory_id
  human_roster_id
  im_integration_policy
  roster_policy
  authorization_policy
  audit_policy
```

内部实现仍然需要知道当前目录或凭据来自 workspace、deployment、ISV application 还是 tenant self-built app。但这些应封装在 resolver、repository adapter 或 policy 内部，避免让业务代码到处传底层 owner / locator。

当前映射建议：

| 形态 | `ApprovalDomain` 入口 | Contact Directory owner | Human Roster owner | IM credential policy |
| --- | --- | --- | --- | --- |
| SaaS | 当前 `Tenant` / workspace | 当前 `Tenant` | 当前 `Tenant` | Slack ISV workspace installation 或 tenant self-built app |
| CE | 默认 workspace facade | deployment | 默认 `Tenant` | deployment 或 default workspace facade |
| EE | 当前 workspace 的审批域 | deployment | 当前 `Tenant` | 默认 deployment-level，未来可 workspace override |

### Contact Directory

| 对象 | 类型 | 聚合边界 | 关键字段 |
| --- | --- | --- | --- |
| `ContactDirectory` | Aggregate Root | `ApprovalDomain` | `id`、`owner_ref`、`visibility_policy` |
| `ContactIdentity` | Entity | `ContactDirectory` | `id`、`directory_id`、`kind`、`account_id`、`external_contact_id`、`normalized_email`、`display_name`、`status` |
| `ExternalContact` | Entity | `HumanRoster` | `id`、`roster_id`、`normalized_email`、`display_name`、`status` |
| `IMIdentityBinding` | Entity | `ContactIdentity` | `id`、`contact_identity_id`、`provider`、`provider_user_id`、`binding_owner_ref`、`status`、`verified_at` |

建模原则：

- 只要能匹配到 Dify `Account`，就必须建模为 account-backed `ContactIdentity`，不能建模为 `ExternalContact`。
- 其他 workspace 的 member 仍是 Dify member，只是当前审批域里“不属于当前 roster owner”的 account-backed contact。
- `ExternalContact` 只表示不属于 Dify 系统内 `Account` 的外部人员，并且只属于当前 Human Roster。
- Workflow editor 不能创建 `ExternalContact`；编辑节点时只能选择已有 roster entry 或输入 one-time email。
- 当前产品只允许一个联系人绑定一个 IM 身份，但数据模型不应假设永远只有一个 provider；唯一约束应放在 active binding 的策略上。

### Human Roster

| 对象 | 类型 | 聚合边界 | 关键字段 |
| --- | --- | --- | --- |
| `HumanRoster` | Aggregate Root | `ApprovalDomain` | `id`、`owner_ref`、`policy` |
| `RosterEntry` | Entity | `HumanRoster` | `id`、`roster_id`、`contact_identity_id`、`entry_kind`、`status`、`joined_at`、`snapshot` |

`RosterEntry.id` 是 HITL 节点静态 recipient 应保存的稳定引用。产品和 API 可以称为 `contact_id`，但领域语义上它是“当前 Human Roster 中的可选择联系人”，不是全局人。

`entry_kind` 是面向当前 Human Roster 的视图：

| `entry_kind` | 语义 |
| --- | --- |
| `workspace_member` | `Account` 当前属于该 Human Roster 的 owner workspace |
| `dify_member` | `Account` 属于当前审批域的 Contact Directory，但不属于当前 roster owner |
| `external_contact` | 当前 Human Roster 下的外部联系人 |

`status` 至少需要区分：

| `status` | 是否可被新节点选择 | 说明 |
| --- | --- | --- |
| `active` | 是 | 可通知、可审批 |
| `left_workspace` | 否 | 曾是 workspace member，已离开但保留历史引用 |
| `account_disabled` | 否 | 账号被禁用或删除 |
| `removed` | 否 | 被管理员从 roster 移除 |
| `pending_review` | 否 | 需要管理员处理，例如成员离开后选择移除或转 external |

### IM Integration

| 对象 | 类型 | 说明 |
| --- | --- | --- |
| `IMProvider` | Value Object | Slack、DingTalk、Lark、Teams、WeCom、Email |
| `IMProviderApplication` | Aggregate Root | IM app registration。SaaS ISV 的 `app_id` / `app_secret` 属于部署者；企业自建 app 属于 workspace 或 enterprise。 |
| `IMInstallation` | Aggregate Root | 某个 provider 在某个 owner 下的可用安装。运行时从这里得到可发送能力和 credential handle。 |
| `IMCredentialHandle` | Value Object | Secret store 中的引用，不直接暴露 secret。 |
| `IMChannelCapability` | Value Object | 是否支持卡片审批、fallback URL、平台身份获取、通讯录同步等。 |

IM identity 一期通过 directory sync / search 选择 provider user，不支持让管理员直接手动输入 provider user id。这个决定影响产品交互和 provider gateway 能力要求，但不改变 `IMIdentityBinding` 的领域模型。

凭据解析优先级由 `IMIntegrationPolicy` 给出，运行时只调用 resolver，不直接判断 owner 类型。默认顺序为：

1. `workspace` / `tenant` scoped installation。
2. `enterprise` / `deployment` scoped installation。
3. no IM installation，降级到 Email。

不同形态只影响 installation 的来源：

| 场景 | `IMProviderApplication` owner | `IMInstallation` owner |
| --- | --- | --- |
| SaaS Slack ISV | deployment operator | workspace OAuth installation |
| SaaS DingTalk self-built | workspace admin | workspace |
| CE | deployment operator 或 default workspace admin | deployment 或 workspace facade |
| EE | enterprise admin | deployment / enterprise，本期默认 deployment |

### HITL Runtime

| 对象 | 类型 | 现有模型映射 | 说明 |
| --- | --- | --- | --- |
| `NotificationPolicy` | Value Object | `HumanInputNodeData` extension | 节点配置中的通知策略。 |
| `RecipientSelector` | Value Object | node DSL | 静态 roster contact、one-time email、email variable、current initiator。 |
| `ResolvedRecipient` | Value Object | runtime only | 解析后的通知与审批对象，进入 task 前仍可去重。 |
| `AllowedApprover` | Value Object | `HumanInputFormRecipient` snapshot extension | 提交权限的 canonical identity。 |
| `HITLTask` | Aggregate Root | `HumanInputForm` | 一个等待人工输入的持久化 task。 |
| `TaskRecipientSnapshot` | Entity | `HumanInputFormRecipient` | task 创建时的 recipient、contact、email、IM identity、auth requirement 快照。 |
| `DeliveryAttempt` | Entity | `HumanInputDelivery` / future delivery record | 每个 recipient 每个 channel 的投递记录。 |
| `RecipientResolutionRecord` | Entity | future runtime log | 记录 dynamic email 等解析过程。 |

`HumanInputFormRecipient` 不应升级为 Contact。它是运行时 task 下的 recipient snapshot / access token holder。

## 关键不变量

1. `ExternalContact` 创建前必须用 normalized email 查找可见 `Account`；命中时只能添加 Dify member。
2. HITL 节点静态 recipient 只能引用当前 `ApprovalDomainContext.human_roster_id` 下 selectable 的 `RosterEntry`。
3. one-time email 和 dynamic email 不写入 Human Roster。
4. task 创建后，`TaskRecipientSnapshot` 不可变，用于审计和历史显示。
5. 新 task 使用最新 contact、IM binding、credential 和 channel capability。
6. pending task 提交时必须重新校验安全敏感状态：account disabled、left workspace、removed external contact、deleted IM binding、IM identity mismatch。
7. 同一个 Dify `Account` 只能生成一个 `AllowedApprover`。
8. 同一个 normalized email 只能生成一个 email recipient；如果能匹配 roster contact，应优先转成更强身份的 contact recipient。
9. IM + Email 双渠道触达是 delivery 策略，不代表两个 approver。
10. Secret 不进入 audit、delivery record、task snapshot，只保存 credential handle 和 provider metadata。
11. `workspace_id` 是入口 locator，不是领域服务的默认上下文；进入应用服务后应优先传 `ApprovalDomainContext`。

## 策略接口

以下接口是领域层与部署形态差异之间的边界。实现可以在 CE / EE / SaaS 中不同，但调用方使用同一组 port。

```python
class ApprovalDomainResolver(Protocol):
    # Resolves the product-level approval context from a system boundary locator.
    # workspace_id should normally stop here and not leak into downstream services.
    def resolve_for_workspace(self, workspace_id: WorkspaceId) -> ApprovalDomainContext: ...
    # Rebuilds the current approval context for submission, retry, audit, or callback flows.
    def resolve_for_task(self, task_id: HITLTaskId) -> ApprovalDomainContext: ...


class ContactDirectoryRepository(Protocol):
    # Persists person identities visible in one approval domain.
    def get_by_id(self, contact_identity_id: ContactIdentityId) -> ContactIdentity | None: ...
    # Finds the contact identity backed by a Dify Account inside a contact directory.
    def find_account_contact(self, directory_id: ContactDirectoryId, account_id: AccountId) -> ContactIdentity | None: ...
    # Used to prevent creating ExternalContact when the email belongs to a Dify Account.
    def find_by_normalized_email(self, directory_id: ContactDirectoryId, email: NormalizedEmail) -> ContactIdentity | None: ...
    def save(self, contact: ContactIdentity) -> None: ...


class HumanRosterRepository(Protocol):
    # Persists selectable entries used by HITL node configuration.
    def get_entry(self, roster_id: HumanRosterId, roster_entry_id: RosterEntryId) -> RosterEntry | None: ...
    # Helps keep one roster row per contact identity within a roster.
    def find_by_contact_identity(self, roster_id: HumanRosterId, contact_identity_id: ContactIdentityId) -> RosterEntry | None: ...
    # Returns only entries that can be selected by new HITL nodes.
    def list_selectable_entries(self, roster_id: HumanRosterId, query: RosterQuery) -> Sequence[RosterEntry]: ...
    def save_entry(self, entry: RosterEntry) -> None: ...


class AccountDirectoryPort(Protocol):
    # Read-only adapter over Dify Account and TenantAccountJoin.
    def get_account(self, account_id: AccountId) -> AccountProfile | None: ...
    # Used by contact creation, IM sync, import, and recipient canonicalization.
    def find_account_by_email(self, email: NormalizedEmail) -> AccountProfile | None: ...
    # Uses the domain policy to choose the underlying TenantAccountJoin query.
    def list_roster_source_members(self, domain: ApprovalDomainContext) -> Sequence[WorkspaceMemberProfile]: ...
    # Used at submission time to reject approvers who no longer satisfy domain membership rules.
    def has_active_membership(self, domain: ApprovalDomainContext, account_id: AccountId) -> bool: ...


class IMCredentialResolver(Protocol):
    # Resolves the effective IM installation without exposing where credentials came from.
    def resolve_installation(self, domain: ApprovalDomainContext, provider: IMProvider) -> IMInstallation | None: ...
    # Returns provider, credential handle, callback metadata, and capability context for sending.
    def resolve_sender(self, domain: ApprovalDomainContext, provider: IMProvider) -> IMSenderContext | None: ...


class IMBindingRepository(Protocol):
    # Resolves the effective binding according to the domain's override policy.
    def get_effective_binding(self, domain: ApprovalDomainContext, contact_identity_id: ContactIdentityId, provider: IMProvider) -> IMIdentityBinding | None: ...
    # Used by IM card callbacks to map platform user identity back to a Dify contact.
    def find_by_provider_user(self, domain: ApprovalDomainContext, provider: IMProvider, provider_user_id: str) -> IMIdentityBinding | None: ...
    def save(self, binding: IMIdentityBinding) -> None: ...


class IMDirectorySyncGateway(Protocol):
    # Provider-specific gateway. It returns directory data but does not create contacts.
    def list_members(self, installation: IMInstallation) -> Sequence[IMDirectoryMember]: ...


class RecipientResolver(Protocol):
    # Converts node selectors into canonical runtime recipients and resolution records.
    def resolve(self, domain: ApprovalDomainContext, request: RecipientResolutionRequest) -> RecipientResolutionResult: ...


class NotificationPlanner(Protocol):
    # Chooses IM card, IM fallback URL, Email, or skipped delivery per recipient.
    def plan(self, domain: ApprovalDomainContext, task: HITLTask, recipients: Sequence[ResolvedRecipient]) -> NotificationPlan: ...


class NotificationDispatcher(Protocol):
    # Performs side effects and returns durable delivery attempts for audit and Last Run.
    def dispatch(self, plan: NotificationPlan) -> Sequence[DeliveryAttempt]: ...


class RecipientAuthenticator(Protocol):
    # Identifies the actor from Dify login, IM platform identity, magic link, or OTP.
    def authenticate(self, domain: ApprovalDomainContext, request: ApprovalAccessRequest) -> SubmissionIdentity: ...
    # Checks the authenticated actor against allowed approvers and current safety state.
    def authorize_submission(self, domain: ApprovalDomainContext, task: HITLTask, identity: SubmissionIdentity) -> ApprovalDecision: ...


class HITLTaskRepository(Protocol):
    # Persists immutable recipient snapshots when the task is created.
    def create(self, task: HITLTask) -> HITLTaskId: ...
    def get(self, task_id: HITLTaskId) -> HITLTask | None: ...
    # Must be atomic so only one allowed approver can submit a pending task.
    def mark_submitted(self, task_id: HITLTaskId, submission: SubmissionRecord) -> None: ...


class AuditLogPort(Protocol):
    # Stores domain audit events without leaking secrets or raw sensitive content.
    def record(self, event: AuditEvent) -> None: ...


class SecretStore(Protocol):
    # Stores provider credentials and returns opaque handles for domain records.
    def put(self, owner: CredentialOwnerRef, secret: SecretPayload) -> IMCredentialHandle: ...
    # Secret access should be limited to infrastructure code that actually sends requests.
    def get(self, handle: IMCredentialHandle) -> SecretPayload: ...
```

## 应用服务

| 服务 | 说明 |
| --- | --- |
| `ApprovalDomainResolver` | 从 workspace locator 或 task 解析 `ApprovalDomainContext`，隔离 CE / EE / SaaS 拓扑差异。 |
| `RosterBootstrapService` | 根据 `ApprovalDomainContext.roster_policy` 初始化和同步 Human Roster。SaaS / CE 通常同步 workspace member；EE 可使用不同 policy，不默认添加企业全量联系人。 |
| `ContactDirectoryService` | 创建 account-backed contact、拒绝错误 external contact、管理企业级 IM binding。 |
| `HumanRosterService` | 添加 Dify member、添加 external contact、移除或转换 roster entry、计算 selectable 状态。 |
| `IMIntegrationService` | 保存 IM app installation、测试连接、解析 callback URL、触发通讯录同步。 |
| `IMDirectorySyncService` | 从 provider 通讯录同步成员，优先匹配 IM user id，再按 email 匹配 `Account`，未匹配进入 unmatched list。 |
| `RecipientResolutionService` | 将节点配置中的 `RecipientSelector` 解析为 `ResolvedRecipient`，执行 canonicalization 与去重。 |
| `HITLTaskApplicationService` | 创建 `HITLTask`、冻结 snapshot、调用 notification planner 和 dispatcher。 |
| `SubmissionApplicationService` | 处理 IM card、fallback URL、Email OTP、Dify login 等提交入口，执行 authenticate 和 authorize。 |
| `HITLMigrationService` | 迁移旧 email recipient；能匹配 workspace member 则转 contact selector，否则保留 one-time email。 |

## 主要流程

### Roster 初始化

1. 系统边界拿到 `workspace_id` 后调用 `ApprovalDomainResolver.resolve_for_workspace`。
2. `RosterBootstrapService` 读取 `domain.roster_policy` 和 `domain.human_roster_id`。
3. SaaS / CE：adapter 基于现有 `TenantAccountJoin` 查询 roster source members，为成员创建或更新 `ContactIdentity` 与 `RosterEntry`。
4. EE：不导入企业全量联系人；workspace admin 通过 `HumanRosterService.add_dify_member` 添加。
5. 成员离开时不物理删除 `RosterEntry`，改为 `left_workspace` 或 `pending_review`。

### 创建 HITL task

1. workflow 运行上下文用 `workspace_id` 解析 `ApprovalDomainContext`，后续服务不再直接传 `workspace_id`。
2. 从 `HumanInputNodeData.notification_policy` 读取 `RecipientSelector`。
3. `RecipientResolutionService.resolve(domain, request)` 解析 roster entry、one-time email、dynamic email、current initiator。
4. 对解析结果做 canonicalization，合并同一 approver 的多渠道 endpoint。
5. `IMCredentialResolver` 与 `IMBindingRepository` 基于 `domain.im_integration_policy` 为每个 contact 解析 IM endpoint。
6. 创建 `HITLTask` 和 immutable `TaskRecipientSnapshot`。
7. `NotificationPlanner` 按能力矩阵选择 IM card、IM fallback URL 和 Email。
8. `NotificationDispatcher` 发送并写入 `DeliveryAttempt`。
9. 解析、跳过和失败原因进入 `RecipientResolutionRecord` 与 audit log。

### 提交 HITL task

1. 打开 URL 或 IM card callback 时先定位 `HITLTask`，但 URL 本身不代表审批权限。
2. `ApprovalDomainResolver.resolve_for_task` 恢复当前审批域上下文。
3. `RecipientAuthenticator.authenticate(domain, request)` 基于 Dify login、IM platform identity、Magic link 或 Email OTP 识别提交人。
4. `authorize_submission(domain, task, identity)` 用 `AllowedApprover` 和当前安全状态重新校验。
5. 已提交、超时、取消、账号禁用、成员离开、external contact 删除、IM binding 删除、IM identity mismatch 均拒绝提交。
6. 成功提交后只允许一次状态转移到 `submitted`。

## 与现有模型映射

| 现有对象 | 建议领域语义 |
| --- | --- |
| `Account` | account-backed `ContactIdentity` 的身份来源。 |
| `Tenant` | 系统入口 locator 和现有存储 owner；应用服务入口用它解析 `ApprovalDomainContext`。 |
| `TenantAccountJoin` | membership 数据源，用于 resolver / adapter 推导 roster source members 和提交时成员状态。 |
| `HumanInputNodeData` | 继续承载表单 schema；新增 `NotificationPolicy`，不要把 Contact 逻辑塞进旧 `EmailRecipients`。 |
| `HumanInputForm` | `HITLTask` 的持久化实现；应能恢复或重建 task 所属 `ApprovalDomainContext`。 |
| `HumanInputDelivery` | delivery method / delivery batch。后续需要补足 per recipient per channel record。 |
| `HumanInputFormRecipient` | `TaskRecipientSnapshot` 和 access token holder。它不是 Contact。 |

## 分阶段落地建议

1. 先实现 `ApprovalDomainResolver` 和 `ApprovalDomainContext`，把 `workspace_id` 限制在系统入口和 adapter 内。
2. 增加 `ContactDirectory`、`ContactIdentity`、`HumanRoster`、`RosterEntry`，让节点配置保存 roster-scoped contact reference。
3. 扩展 HITL node config，引入 `NotificationPolicy` 和 `RecipientSelector`，兼容旧 `EmailRecipients`。
4. 实现 `RecipientResolutionService.resolve(domain, request)`，把旧 email member / external email 迁移到新 recipient model。
5. 在 `HumanInputFormRecipient` payload 中增加 snapshot 结构，保留旧 payload 兼容读取。
6. 引入 `IMIntegrationService`、`IMCredentialResolver`、`IMBindingRepository` 和 directory sync / search，所有解析均基于 `ApprovalDomainContext`。
7. 补齐 per recipient per channel delivery record、resolution record 和 audit event。

## 已确认决策与剩余风险

以下产品规则已经确认，不影响核心抽象，只影响 policy、权限矩阵或交互实现：

1. Workflow editor 禁止创建 `ExternalContact`，仅允许输入 one-time email。
2. Pending task 在 external contact 删除或 IM binding 删除后拒绝提交。
3. IM identity 一期通过 directory sync / search 选择 provider user。
4. SaaS dynamic email、Magic link、OTP、单 task recipient 数量和每日发送量属于 guardrail 配置，不影响 Contact / Roster / Recipient 抽象。

剩余会影响抽象演进的问题只有一个：SaaS 未来是否会出现“一个企业多个 workspace”。当前没有这个计划，所以 `ApprovalDomain` 暂不需要独立持久化；但领域层仍通过 `ApprovalDomainContext` 隔离拓扑细节，避免未来从 `tenant_id` 迁移到独立企业 ID 时扩散到 Contact、Roster、IM 和 HITL Runtime。
