## ADDED Requirements

### Requirement: Current initiator 只能在身份可解析时成为审批主体
系统 MUST 将 `Allow Current Initiator to Approve` 视为独立的 allowed approver 来源。业务主体类型仍然只有 `workspace user` 和 `end_user` 两类；`Service API` 与 `CLI` 只是调用来源，MUST NOT 产生第三种 initiator identity。对于 `Service API` 发起的运行，调用请求 MUST 显式提供 `user`，系统 MUST 将该 `user` 物化为当前 app 下的 request-scoped `end_user` 并据此判断 current initiator，而 MUST NOT 将持有 API token 的调用者本人视为审批主体。对于 `CLI` 发起的运行，只有在调用方最终可解析为 `workspace user` 或 `end_user` 时，系统 MUST 允许 current initiator 成为审批主体；否则 MUST 视为 initiator identity unavailable。

#### Scenario: WebApp 发起者作为额外审批主体
- **WHEN** a workflow run is initiated from WebApp and `Allow Current Initiator to Approve` is enabled
- **THEN** 系统 MUST 允许当前发起者作为额外 allowed approver 提交该 task

#### Scenario: Service API 通过 request-scoped end_user 参与 Current Initiator 判断
- **WHEN** a workflow run is initiated from Service API with an explicit `user`
- **THEN** 系统 MUST 将该 `user` 物化为当前 app 下的 request-scoped `end_user`，并 MUST 仅基于该 `end_user` 判断 current initiator，而 MUST NOT 将 API token 持有者本人视为审批主体

#### Scenario: Service API 不能回退到 API token 持有者身份
- **WHEN** a workflow run is initiated from Service API without an explicit `user`, or the caller tries to rely on the API token holder identity itself
- **THEN** 系统 MUST 将 current initiator 视为 unavailable，并 MUST NOT 从 API credential holder 派生审批主体

#### Scenario: CLI 解析为 workspace user 或 end_user
- **WHEN** a workflow run is initiated by CLI and the caller can be resolved to a `workspace user` or `end_user`
- **THEN** 系统 MUST 允许该已解析身份作为 current initiator 参与 allowed approver 计算

#### Scenario: CLI 无法解析为可用业务主体
- **WHEN** a workflow run is initiated by CLI without a resolvable `workspace user` or `end_user` identity and no other notified recipient exists
- **THEN** 系统 MUST 拒绝将 current initiator 作为审批主体，并 MUST 使节点直接报错

### Requirement: Web 与 IM 审批必须按审批主体选择鉴权链路
系统 MUST 按审批主体类型决定审批鉴权链路。以 Dify 登录身份承载的 workspace contact 与 Platform contact MUST 使用 Dify 登录；不具备 Dify 登录身份的 external contact、one-time Email 和未命中 Contact 的 dynamic Email MUST 使用 Email OTP；IM 卡片内审批 MUST 通过 IM identity 映射到当前有效 Contact 后再校验 allowed approver。

#### Scenario: Platform contact 通过 Web 审批
- **WHEN** a platform contact opens the standalone approval page
- **THEN** 系统 MUST 要求其使用 Dify 登录，并 MUST 在提交时校验其是否命中 allowed approver

#### Scenario: External contact 通过 Web 审批
- **WHEN** an external contact opens the standalone approval page
- **THEN** 系统 MUST 要求其完成 Email OTP 验证，并 MUST 在提交时再次校验 allowed approver

#### Scenario: OTP 验证与表单提交可合并为同一请求
- **WHEN** an external contact submits an OTP code together with the approval form in one request
- **THEN** 系统 MUST 允许在同一请求中完成 OTP 验证与表单提交，并 MUST 继续执行完整的 task 状态与 allowed approver 校验

#### Scenario: Dynamic Email 命中 Contact 后沿用 Contact 鉴权
- **WHEN** a dynamic email value is upgraded to a Contact recipient
- **THEN** 系统 MUST 使用该 Contact 对应的鉴权方式，而 MUST NOT 继续按 anonymous email recipient 处理

#### Scenario: IM 卡片内审批校验当前 IM identity
- **WHEN** an approver submits from an IM card
- **THEN** 系统 MUST 先将当前 IM identity 解析到 current IM Binding 和 valid Contact，再校验其是否命中 allowed approver

### Requirement: Task snapshot 只能用于回溯，不能单独赋予提交权限
系统 MUST 在 task 创建时冻结 `RecipientSpecification`、`ApprovalPrincipal` 和 `DeliveryEndpoint` 的快照，用于历史展示、审计和问题排查。系统 MUST 在打开审批页与提交表单时重新按当前身份链路、当前 Contact 状态、当前 IM Binding 状态和当前 task 状态判定权限；任何历史 snapshot 或 URL token MUST NOT 单独赋予提交权限。

#### Scenario: Task 创建时冻结 recipient、principal 与 endpoint 快照
- **WHEN** a HITL task is created
- **THEN** 系统 MUST 持久化该 task 的 `RecipientSpecification`、`ApprovalPrincipal` 和 `DeliveryEndpoint` 快照，用于后续展示与审计

#### Scenario: 历史链接不能替代当前身份证明
- **WHEN** a caller presents a previously issued form link without a currently valid `IdentityProof`
- **THEN** 系统 MUST NOT 仅凭该 link 或 token 允许提交，而 MUST 继续执行当前身份链路与 allowed approver 校验

### Requirement: 打开页面与提交表单都必须重新校验 task 当前可访问性
系统 MUST 在打开审批页和提交表单时重新校验 task 状态、有效期、身份状态与 allowed approver 关系。历史 snapshot MUST 用于展示和审计，但 MUST NOT 单独赋予提交权限。

#### Scenario: 已完成 task 不可再次提交
- **WHEN** a task is already `SUBMITTED`
- **THEN** 系统 MUST 拒绝再次提交，并 MUST 返回 `This task has already been completed.`

#### Scenario: 成员退出 workspace 后失去 pending task 提交资格
- **WHEN** a workspace contact was removed from the workspace before submitting a pending task
- **THEN** 系统 MUST 拒绝其继续打开或提交该 task

#### Scenario: IM Binding 变更后旧身份失效
- **WHEN** a pending task was sent to an IM identity that no longer maps to the current binding or valid Contact
- **THEN** 系统 MUST 拒绝旧 IM identity 继续提交该 task

#### Scenario: external contact 删除后旧 pending task 失效
- **WHEN** an external contact was deleted after a pending task was created
- **THEN** 系统 MUST 拒绝该 deleted contact 继续打开或提交旧 pending task

#### Scenario: 同邮箱重建的新 external contact 不继承旧授权
- **WHEN** an external contact was deleted and a new external contact is recreated later with the same normalized email
- **THEN** 系统 MUST NOT 让新 contact 继承旧 pending task 的审批授权

#### Scenario: contact email 变更后旧 email proof 失效
- **WHEN** the email of a contact changes after a pending task was created
- **THEN** 系统 MUST 使旧 email 对应的 proof、OTP 或 link 失效，并 MUST 要求后续按当前有效渠道身份重新验证

#### Scenario: task 超时或过期后不可访问
- **WHEN** a task is `TIMEOUT` or `EXPIRED`
- **THEN** 系统 MUST 拒绝打开或提交该 task，并 MUST 返回对应的过期类错误提示

### Requirement: 并发提交必须采用单次成功语义
系统 MUST 保证同一 task 只有一次成功提交。第一个成功请求 MUST 完成 task 并推动 workflow 继续；后到请求 MUST 被拒绝且不能覆盖已有结果。

#### Scenario: IM 与 Email 并发提交
- **WHEN** two allowed approvers submit the same task concurrently from different channels
- **THEN** 系统 MUST 让第一个成功请求完成该 task，并 MUST 使后到请求失败

#### Scenario: 后到请求收到已完成提示
- **WHEN** a second submission arrives after the task was already completed
- **THEN** 系统 MUST 返回 `This task has already been completed.`

### Requirement: 审计必须记录通知、访问、提交与拒绝的最小事实
系统 MUST 为同一 task 记录通知对象、解析结果、delivery 渠道、访问尝试、身份校验结果、提交结果和拒绝原因。本期 MAY 不提供审计 UI，但 MUST 保留可查询的审计数据。

#### Scenario: 记录未授权提交尝试
- **WHEN** a user who is not an allowed approver tries to submit a task
- **THEN** 系统 MUST 记录该次访问与提交被拒绝的事实、渠道和原因

#### Scenario: 记录多渠道 delivery attempt
- **WHEN** a recipient receives both IM and Email for the same task
- **THEN** 系统 MUST 分别记录两条 delivery attempt，并 MUST 将它们关联到同一个 canonical approver 和同一个 task
