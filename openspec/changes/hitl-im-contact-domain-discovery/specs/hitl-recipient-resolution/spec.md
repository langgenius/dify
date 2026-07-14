## ADDED Requirements

### Requirement: 配置态 recipient、审批主体、通知落点与身份凭证必须分层建模
系统 MUST 区分以下四类概念：节点配置中的 `RecipientSpecification`、运行时授权主体 `ApprovalPrincipal`、通知落点 `DeliveryEndpoint` 和当前访问者提交时出示的 `IdentityProof`。`RecipientSpecification` MAY 解析出一个或多个 `DeliveryEndpoint`，但系统 MUST 以 `ApprovalPrincipal` 作为 allowed approver 的唯一业务主体；`IdentityProof` 只能证明当前访问者的当前身份，MUST NOT 直接等同于 allowed approver。

#### Scenario: 节点配置只记录 recipient specification
- **WHEN** a workflow editor configures a static contact, one-time email, dynamic email or current initiator in the HITL node
- **THEN** 系统 MUST 将这些配置作为 `RecipientSpecification` 保存，而 MUST NOT 将它们直接落成 delivery endpoint 或 identity proof

#### Scenario: 同一审批主体可以对应多个 delivery endpoint
- **WHEN** one approver receives both IM and Email for the same task
- **THEN** 系统 MUST 为该 task 创建两个 `DeliveryEndpoint`，并 MUST 仍然只保留一个 `ApprovalPrincipal`

### Requirement: 静态通知对象必须区分 Contact recipient 与 one-time Email
HITL 节点中的静态通知对象 MUST 支持两类配置：从当前 workspace Contact 中选择的 `Contact recipient`，以及直接写在节点配置中的 `one-time Email`。`Contact recipient` MUST 存储联系人引用而不是裸 Email；`one-time Email` MUST 保留在当前节点配置中，MUST NOT 写入 Contact。

#### Scenario: 静态 recipient 存储联系人 ID
- **WHEN** a workflow editor selects contacts in the `Notified recipients` picker
- **THEN** 系统 MUST 存储对应的 contact identifier，而不是直接存储 email 字符串

#### Scenario: one-time Email 保留在节点配置中
- **WHEN** a workflow editor enters a one-time email directly in the HITL node
- **THEN** 系统 MUST 将该 email 保留在当前节点配置中，并 MUST NOT 将其写入 workspace Contact

#### Scenario: 已删除 external contact 不能再被新配置选择
- **WHEN** an external contact was deleted from the workspace Contact list
- **THEN** 系统 MUST 禁止新的 HITL 节点继续选择该联系人，但 MAY 在历史配置或历史 task 中保留快照引用

### Requirement: Dynamic Email 解析必须先校验、再匹配 Contact、最后决定 recipient 形态
系统 MUST 先校验 Dynamic Email 是否为合法 string email，再按 normalized email 匹配现有 Contact。命中 Contact 时 MUST 升级为 Contact recipient，并生成以 `contact_id` 为 canonical key 的 `ApprovalPrincipal`；未命中时 MUST 作为 one-time Email recipient，并生成 task-scoped one-time email `ApprovalPrincipal`；非法或不支持类型 MUST 记录失败原因。

#### Scenario: Dynamic Email 命中已有 Contact
- **WHEN** a dynamic email value is a valid normalized email and matches an existing Contact
- **THEN** 系统 MUST 将该对象解析为 Contact recipient，生成 Contact-backed `ApprovalPrincipal`，并 MUST 按该 Contact 的可通知渠道发送通知

#### Scenario: Dynamic Email 未命中 Contact
- **WHEN** a dynamic email value is a valid normalized email and matches no Contact
- **THEN** 系统 MUST 将该对象解析为 one-time Email recipient

#### Scenario: 非法 email 被跳过但 task 仍继续
- **WHEN** one dynamic email value is invalid but another recipient remains valid
- **THEN** 系统 MUST 跳过非法值、记录失败原因，并 MUST 继续创建和等待该 HITL task

#### Scenario: unsupported type 且无有效 recipient 时节点报错
- **WHEN** a dynamic email value is not a string and no other valid recipient exists
- **THEN** 系统 MUST 记录 `unsupported_type`，并 MUST 使节点以 `No valid recipients found` 失败

### Requirement: Recipient canonicalization 必须以 Contact 为中心
系统 MUST 以 Contact 为中心进行 recipient canonicalization 与去重。同一个人从 static recipient、dynamic Email、current initiator 或多渠道命中时，MUST 只生成一个 `ApprovalPrincipal`，但 MUST 保留多来源命中和多渠道投递记录。对于命中 Contact 的对象，canonical key MUST 是 `contact_id`；对于未命中 Contact 的 one-time Email，canonical key MUST 是 task-scoped recipient identity。

#### Scenario: Static recipient 与 current initiator 命中同一人
- **WHEN** the same person is selected as a static recipient and also qualifies as current initiator
- **THEN** 系统 MUST 将其归并为一个 allowed approver，并 MUST 记录两个 matched sources

#### Scenario: 同一 normalized email 被重复命中
- **WHEN** the same normalized email appears multiple times during recipient resolution
- **THEN** 系统 MUST 只保留一个 canonical approval principal；若该 email 未命中 Contact，则该主体 MUST 是 task-scoped one-time email principal，并 MUST 记录 `duplicated_email`

### Requirement: 默认通知策略必须遵循双渠道并行与 Email 必发规则
对于同时具备 IM binding 和 Email 的 recipient，系统 MUST 并行创建 IM 与 Email delivery attempt。对于没有 IM binding 但有 Email 的 recipient，系统 MUST 发送 Email。系统 MUST NOT 因 IM 成功、IM 失败或 provider 能力差异而关闭 Email。

#### Scenario: IM 与 Email 并行发送
- **WHEN** a recipient has both an IM binding and a usable email
- **THEN** 系统 MUST 为同一 task 创建 IM 和 Email 两条 delivery attempt，并 MUST 仍然只保留一个 allowed approver

#### Scenario: 无 IM binding 时仅发送 Email
- **WHEN** a recipient has no IM binding but has a usable email
- **THEN** 系统 MUST 只创建 Email delivery attempt

#### Scenario: 没有任何可用渠道时节点失败
- **WHEN** all resolved recipients lack any available delivery channel and current initiator is unavailable
- **THEN** 系统 MUST 使节点失败，而不是创建一个无法继续等待的 HITL task

### Requirement: 调试收件人与无通知对象报错规则必须显式化
系统 MUST 仅在 debug run 中应用 `Only notify me during debug`。当 notified recipients 为空且 current initiator 不可用时，系统 MUST 直接报错。

#### Scenario: Debug only notify me 替换实际通知对象
- **WHEN** a workflow debug run enables `Only notify me during debug`
- **THEN** 系统 MUST 将实际通知对象替换为当前调试用户，并 MUST NOT 改写正式运行配置

#### Scenario: 没有通知对象也没有可用 initiator
- **WHEN** a node has no notified recipients and current initiator cannot be used
- **THEN** 系统 MUST fail fast with `No notified recipients available`
