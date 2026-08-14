# hitl-recipient-resolution Specification

## Purpose

定义 HITL recipient specification 如何在 Email 与 IM 渠道中解析为 canonical approver grant 和 immutable delivery endpoint。

## Requirements

### Requirement: 配置态 recipient、审批授权、通知落点与身份凭证必须分层建模
系统 MUST 区分以下四类概念：节点配置中的 `RecipientSpecification`、运行时 form-scoped `ApproverGrant`、通知落点 `DeliveryEndpoint` 和当前访问者提交时出示的 `IdentityProof`。`RecipientSpecification` MAY 解析出一个或多个 `DeliveryEndpoint`，但系统 MUST 以 `ApproverGrant` 表达 allowed approver authorization；`IdentityProof` 只能证明当前访问者的当前身份，MUST NOT 直接等同于 allowed approver。

#### Scenario: 节点配置只记录 recipient specification
- **WHEN** a workflow editor configures a static contact, one-time email, dynamic email or current initiator in the HITL node
- **THEN** 系统 MUST 将这些配置作为 `RecipientSpecification` 保存，而 MUST NOT 将它们直接落成 delivery endpoint 或 identity proof

#### Scenario: 同一审批主体可以对应多个 delivery endpoint
- **WHEN** one approver receives both IM and Email for the same task
- **THEN** 系统 MUST 为该 task 创建两个 `DeliveryEndpoint`，并 MUST 仍然只保留一个 `ApproverGrant`

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

### Requirement: Dynamic Email 解析必须先校验，并始终保持 EmailAddress 语义
系统 MUST 先校验 Dynamic Email 是否为合法 string email。只要值合法，系统 MUST 将其解析为 task-scoped EmailAddress recipient，并生成 task-scoped EmailAddress `ApproverGrant`；系统 MUST NOT 因 normalized email 恰好命中当前 Contact 而把该 recipient 升级为 Contact-backed approver。非法或不支持类型 MUST 记录失败原因。

#### Scenario: Dynamic Email 命中已有 Contact
- **WHEN** a dynamic email value is a valid normalized email and matches an existing Contact
- **THEN** 系统 MUST 仍将该对象解析为 EmailAddress recipient，并生成 EmailAddress-backed `ApproverGrant`

#### Scenario: Dynamic Email 未命中 Contact
- **WHEN** a dynamic email value is a valid normalized email and matches no Contact
- **THEN** 系统 MUST 将该对象解析为 one-time Email recipient

#### Scenario: 非法 email 被跳过但 task 仍继续
- **WHEN** one dynamic email value is invalid but another recipient remains valid
- **THEN** 系统 MUST 跳过非法值、记录失败原因，并 MUST 继续创建和等待该 HITL task

#### Scenario: unsupported type 且无有效 recipient 时节点报错
- **WHEN** a dynamic email value is not a string and no other valid recipient exists
- **THEN** 系统 MUST 记录 `unsupported_type`，并 MUST 使节点以 `No valid recipients found` 失败

### Requirement: Recipient canonicalization 必须以 canonical subject 为中心
系统 MUST 以 canonical subject 为中心进行 recipient canonicalization 与去重。同一个 Contact-backed approver 从 static recipient、current initiator 或多渠道命中时，MUST 只生成一个 `ApproverGrant`，但 MUST 保留多来源命中和多渠道投递记录。Contact-backed对象的 canonical subject MUST 是 `contact_id`；one-time Email 与 Dynamic Email 的 canonical subject MUST 是 task-scoped EmailAddress identity。共享同一 normalized email 的 Contact-backed 与 EmailAddress-backed recipient MUST 保持为两个不同 approver。

#### Scenario: Static recipient 与 current initiator 命中同一人
- **WHEN** the same person is selected as a static recipient and also qualifies as current initiator
- **THEN** 系统 MUST 将其归并为一个 allowed approver，并 MUST 记录两个 matched sources

#### Scenario: 同一 normalized email 被重复命中
- **WHEN** the same normalized email appears multiple times during recipient resolution
- **THEN** 系统 MUST 只保留一个 canonical ApproverGrant；若该 email 未命中 Contact，则该 grant subject MUST 是 task-scoped EmailAddress，并 MUST 记录 `duplicated_email`

#### Scenario: Contact recipient 与 EmailAddress recipient 共享同一 normalized email
- **WHEN** one Contact-backed recipient and one EmailAddress-backed recipient share the same normalized email
- **THEN** 系统 MUST 保留两个不同的 `ApproverGrant`，因为它们的 canonical subject 不同

### Requirement: 默认通知策略必须遵循双渠道并行与 Email 必发规则
对于同时具备 IM binding 和 Email 的 recipient，系统 MUST 并行创建 IM 与 Email delivery attempt。对于没有 IM binding 但有 Email 的 recipient，系统 MUST 发送 Email。系统 MUST NOT 因 IM 成功、IM 失败或 provider 能力差异而关闭 Email。IM control-plane 只负责解析当前是否存在有效 IM binding；是否走 Email、是否双发以及无 IM binding 时的通知行为 MUST 由 recipient resolution 与 delivery policy 决定，而不是由 IM binding resolution 决定。

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

### Requirement: Recipient 配置界面必须支持混合收件人集合
系统 MUST 允许同一个 HITL 节点在单一 recipient 配置集合中同时持有 `Contact recipient`、`one-time Email`、`dynamic Email variable` 和 `current initiator` 这几类来源。界面上的搜索与插入方式 MAY 被统一到同一控件，但持久化时 MUST 继续保留各自的 `RecipientSpecification` 边界，MUST NOT 因 UI 合并而把不同来源抹平成同一种 recipient。

#### Scenario: 单个节点混合配置 contact、email、variable 与 initiator
- **WHEN** a workflow editor configures notified recipients using contacts, direct emails, inserted variables and current initiator in the same node
- **THEN** 系统 MUST 允许这些来源共存于同一个 recipient set，并 MUST 在保存后保留每个来源原本的 `RecipientSpecification` 类型

#### Scenario: 统一 recipient picker 仍保留联系人分组语义
- **WHEN** a workflow editor searches recipients from the unified recipient picker
- **THEN** 系统 MUST 仍然提供 `All`、`Workspace`、`Platform` 和 `External` 联系人分组语义；`All` 只表示不做类型过滤，`Platform` 表示当前 workspace 中的 `Platform contact`，而 `Organization` 只作为 ownership boundary 术语；系统 MUST NOT 把 `Platform contact` 与 `External contact` 混成同一搜索结果含义

### Requirement: Message Template 必须承担 Email 与 IM fallback 的消息文案职责
系统 MUST 将 `Message Template` 作为 Email 投递与 IM fallback message 的统一文案来源。Email 与 IM fallback 中 request URL / fallback link 的呈现方式、位置和 surrounding copy MUST 由 `Message Template` / DSL 决定，而不是额外的硬编码字段清单。对于能够完整映射表单内容的 IM provider，系统 MAY 直接发送 IM card，但该 IM card MUST 至少包含 App 名称、节点名称和渲染后的 `form_content`。对于不能完整映射的 IM provider，系统 MUST 回退到基于 `Message Template` 的 message surface。Web 独立页面 MUST 继续完整渲染 `Form Content`，并与现有 standalone form 实现保持一致，而不是由 `Message Template` 承载全部表单内容。

#### Scenario: Email 总是使用 Message Template
- **WHEN** the system delivers a HITL request by email
- **THEN** 系统 MUST 使用 `Message Template` 生成 email subject / body，并 MUST 让 request URL / fallback link 的呈现方式遵循该模板 DSL

#### Scenario: IM 能完整映射表单时优先发送 IM card
- **WHEN** the selected IM provider can represent the configured form as a complete IM card
- **THEN** 系统 MAY 直接发送 IM card，而不必退回到 `Message Template` 文案；该 IM card MUST 至少展示 App 名称、节点名称和渲染后的 `form_content`

#### Scenario: IM 不能完整映射表单时回退到 Message Template
- **WHEN** the selected IM provider cannot represent the configured form as a complete IM card
- **THEN** 系统 MUST 使用 `Message Template` 作为 IM fallback message 文案，并 MUST 让 request URL / fallback link 的呈现方式遵循该模板 DSL

#### Scenario: Web 独立页继续完整渲染 Form Content
- **WHEN** an approver opens the standalone web approval page
- **THEN** 系统 MUST 完整渲染 `Form Content`，并 MUST 与现有 standalone form implementation 保持一致

### Requirement: Message Template 必须支持发送测试邮件
系统 MUST 在 `Message Template` 编辑能力中提供发送测试邮件的能力，以便管理员或 workflow editor 在不触发真实 HITL task 的前提下验证 Email 文案和基础投递配置。该能力 MUST 被视为产品级规则，而不是仅存在于设计稿的临时交互。

#### Scenario: 编辑 Message Template 时发送测试邮件
- **WHEN** a user edits the `Message Template`
- **THEN** 系统 MUST 允许其触发测试邮件发送，以验证当前模板文案与投递链路

### Requirement: Debug Mode 必须允许按渠道切换并至少保留一个启用渠道
系统 MUST 允许在 `Debug Mode` 下按渠道控制调试通知是否发送到 Email 或各 IM 渠道。系统 MUST 强制至少保留一个可用渠道处于启用状态，MUST NOT 允许把所有渠道同时关闭后仍保存为有效调试配置。

#### Scenario: Debug Mode 逐渠道启停
- **WHEN** a workflow editor configures debug notifications
- **THEN** 系统 MUST 允许其独立切换 Email 与各 IM 渠道的启用状态

#### Scenario: Debug Mode 至少保留一个渠道
- **WHEN** a workflow editor tries to disable every debug notification channel
- **THEN** 系统 MUST 阻止该配置，并 MUST 提示至少保留一个渠道处于启用状态
