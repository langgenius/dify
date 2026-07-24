# Human Input v2 Domain Model Stub

该目录是独立于 `api/` 与 ORM `models/` 的领域模型草案。它复用现有 Human Input v2 节点类型和 persistence stubs，只补充 bounded context、核心生命周期、对象关系与接口边界。

## Existing types reused

- `HumanInputNodeData`, `RecipientConfig`, `MessageTemplateConfig`, `DebugModeConfig`, editor `Channel`
- `FormInputConfig`, `UserActionConfig`, `TimeoutUnit`, `HumanInputFormStatus`
- `ContactId`, `IMIdentityId`, `IMBindingId`, `IMSyncRunId`, `IMProvider`
- Contact、approver grant、delivery、OTP、proof 与 audit 的共享 enums，统一由 `core.human_input_v2.entities` 提供

这些类型保持现有定义为唯一真相源，domain stub 不创建平行类型。工作区中已有的 `HumanInputContact`、`HumanInputPlatformContactWorkspaceEntry`、`HumanInputIMBinding`、`HumanInputFormApproverGrant`、`HumanInputFormDeliveryEndpoint`、`HumanInputFormDeliveryAttempt`、`HumanInputFormOTPChallenge`、`HumanInputFormSubmission` 和 `HumanInputFormAuditEvent` 继续承担 persistence 表达；本目录不重复它们的字段。

## Domain contexts

| Context | 核心对象 | 责任边界 |
| --- | --- | --- |
| `configuration` | `FormConfiguration`, existing `HumanInputNodeData` | 从 owner 对应的 immutable Workflow revision 或动态 agent context 构造运行时配置；不额外持久化完整 node snapshot |
| `contact_directory` | `ContactDirectoryService`, `ContactIdentitySnapshot` | 管理当前 Contact、workspace projection 与 IM binding 视图，并向解析和鉴权提供当前状态 |
| `recipient_resolution` | `ApproverGrantDraft`, `DeliveryEndpointDraft`, `ResolvedRecipients`, `RecipientResolver` | 仅在 task 创建期间解析现有 `RecipientConfig`；结果是 factory 内部的一次性计算值，不是 plan 或持久化实体 |
| `approval_runtime` | `FormInstanceFactory`, `FormInstance`, `SubmissionCommand` | 创建完整运行期 task，并维护 WAITING 到终态的状态机与 first-success-wins 语义 |
| `notification_delivery` | `NotificationDeliveryService` | 编排已有 endpoint / attempt 记录；投递状态不进入 form 状态机 |
| `access_control` | transient `IdentityProof`, `AccessDecision`, `ApprovalAccessPolicy` | 仅在提交时读取当前 Contact、membership、email 与 IM binding 状态重新鉴权；form definition read 不授予提交权限 |

## 创建链路

```text
Existing HumanInputNodeData
  contains 0..N existing RecipientConfig values
                 |
                 | capture once at task creation
                 v
FormConfiguration (immutable)
                 |
                 | passed to FormInstanceFactory
                 v
RecipientResolver + current runtime/contact/initiator state
                 |
                 | produces one ephemeral ResolvedRecipients value
                 v
FormInstanceFactory
  +-- freezes 1..N ApproverGrant records
  +-- freezes 0..N DeliveryEndpoint records per grant
  +-- creates exactly one FormInstance
```

这里的 `RecipientConfig` 是 `HumanInputNodeData.recipients_spec` 中已有的配置值，例如固定 Contact、动态 Email 或 initiator。它描述“运行时应该从哪里找审批人”，并不是运行时 recipient 实体。

`RecipientResolver` 在 task 创建时读取这些配置值，并结合当前变量、Contact Directory 和 initiator 得到规范化结果：

1. 多个配置来源可以命中同一个审批人，必须合并成一个 `ApproverGrantDraft`。
2. 一个 grant 可以拥有多个 `DeliveryEndpointDraft`，例如同一个 Contact 同时拥有 Email 和 IM endpoint。
3. endpoint 必须引用已存在的 grant；domain 中不再让 endpoint 独立声明 form ownership。
4. `ResolvedRecipients` 没有 ID、状态或生命周期，只在 `FormInstanceFactory.create()` 的实现内部被消费，不形成可保存、恢复或继续执行的 plan。
5. persistence 若为了查询性能在 endpoint 上冗余 `form_id`，repository 必须保证它与所属 grant 的 `form_id` 相同；该冗余字段不是第二条独立领域关系。

## 核心基数

| 关系 | 基数 | 语义 |
| --- | --- | --- |
| `FormInstance` → `FormConfiguration` | `1 → 1` | instance 在内存中使用从 immutable owner source 构造的配置，不建立独立持久化 snapshot |
| `FormConfiguration` → existing `RecipientConfig` | `1 → 0..N` | 配置内部组合，不是运行期实体关联 |
| `FormInstance` → existing `ApproverGrant` | `1 → 1..N` | 创建成功的 waitable task 至少有一个 allowed grant |
| existing `ApproverGrant` → existing `DeliveryEndpoint` | `1 → 0..N` | grant 是审批资格，endpoint 只是通知或交互落点 |
| existing `DeliveryEndpoint` → existing `DeliveryAttempt` | `1 → 0..N` | 每次发送或重试追加 attempt；失败不改变 form status |
| `FormInstance` → existing `Submission` | `1 → 0..1` | 唯一成功提交落实 first-success-wins |

Contact、workspace membership、IM identity 与 IM binding 属于 `contact_directory` context。运行期 grant 保存最小 subject display snapshot；endpoint 保存自身 immutable address；它们只持有逻辑 ID，不获得 current identity 对象的所有权。

## 打开与提交链路

```text
IdentityProof
  + frozen allowed ApproverGrant
  + current Contact / membership / email / IM binding state
                 |
                 v
AccessDecision
                 |
                 | persist verified proof as AuditEvent
                 v
SubmissionCommand -> FormInstance -> first successful Submission
```

提交时不重新执行 recipient resolution。冻结的 grant 集合只回答“task 创建时谁被授权”，当前 identity state 回答“当前 proof 对应的 actor 是否仍可行使该 grant”。`Submission` 保存 grant、endpoint、actor、action 和 data；它引用的 append-only `AuditEvent` 单独保存 verified proof。form token 或一次成功的 form definition read 都不能替代提交时鉴权。

## 明确避免的 HITL v1 错误

- 不使用同一个对象同时承载节点配置与一次 workflow 执行的运行状态。
- 不再为 configuration 拆出第二层持久化 snapshot；`FormConfiguration` 是从 owner source 构造的不可变运行时值。
- 不把通知渠道上的 recipient 当成审批资格主体；grant 与 endpoint 显式分离。
- 不让 grant 和 endpoint 各自建立可相互矛盾的独立 form ownership 关系。
- 不把 access token、Email OTP 或 IM callback identity 作为 grant 的永久属性。
- 不重新定义 `HumanInputFormStatus`，也不把 `delivery_failed` 或 `canceled` 塞入 form 状态机。
- 不让历史 snapshot 直接授权 pending task；提交必须读取当前身份状态。
- 不在提交阶段重新解析 `RecipientConfig`，避免运行中配置或目录变化扩大 allowed-grant 集合。

## Stub 使用方式

这些类型只表达 domain contract 与关键不变量，不定义数据库 schema、事务、provider client 或 controller contract。后续 application service 应在一个 task-creation 用例中调用 `FormInstanceFactory` 并持久化已有 grant/endpoint models；submission repository 应在同一事务内创建 authorization AuditEvent、Submission，并通过 `WHERE status = WAITING` 的条件更新完成 form 状态迁移。`HumanInputFormSubmission.form_id` 的唯一约束负责落实跨进程 first-success-wins；timeout / expiration 也必须使用相同的条件状态迁移，不能覆盖已经完成的 form。
