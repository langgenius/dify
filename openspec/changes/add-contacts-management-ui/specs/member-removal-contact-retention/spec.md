## ADDED Requirements

### Requirement: 移除 active member 必须使用单一 Contacts-aware 确认流程

前端 MUST 在 workspace member 的移除入口中使用一个同时表达 membership 与 Contacts 影响的确认 surface，MUST NOT 先后展示两个独立确认弹窗。

#### Scenario: 打开 active member 移除确认

- **WHEN** 具备 member 管理权限的用户请求移除可操作的 active member
- **THEN** 前端 MUST 打开包含成员身份和 Contacts 影响说明的确认 surface

#### Scenario: 用户取消移除

- **WHEN** 用户关闭确认 surface 或选择取消
- **THEN** 前端 MUST 保持 mock member 与 Contact 状态不变

#### Scenario: 不可移除成员

- **WHEN** 当前成员受现有 owner、自身或权限规则保护
- **THEN** 前端 MUST 保持现有不可操作行为，MUST NOT 通过 Contacts dialog 绕过限制

### Requirement: CE / SaaS 必须提示 Contact 将同步移除

在 CE / SaaS mock deployment 中，确认 surface MUST 明确说明 active member 被移除后，其 workspace contact identity 会被删除，且不能继续被新的 HITL 配置选择。历史 task 只保留已有快照；成员重新加入时视为新的 Contact identity。

#### Scenario: CE / SaaS 确认移除

- **WHEN** 用户在 CE 或 SaaS 确认移除 active member
- **THEN** mock repository MUST 移除 member 并删除对应 workspace contact，MUST NOT 保留 inactive contact

#### Scenario: CE / SaaS 不提供保留选项

- **WHEN** deployment 为 CE 或 SaaS
- **THEN** 前端 MUST NOT 展示 `Keep as Platform contact` 控件

### Requirement: EE 必须允许选择是否保留为 Platform contact

在 EE mock deployment 中，确认 surface MUST 展示 `Keep as Platform contact` 或设计等价控件，并 MUST 清晰表达当前选择。最终行为 MUST 使用用户确认时的选择。

#### Scenario: EE 保留为 Platform contact

- **WHEN** EE 管理员勾选保留选项并确认移除 member
- **THEN** mock repository MUST 移除 workspace membership，同时保留 Contact 并将其 `kind` 更新为 `platform`

#### Scenario: EE 不保留 Contact

- **WHEN** EE 管理员未选择保留选项并确认
- **THEN** mock repository MUST 同时移除 workspace membership 与当前 workspace Contact

#### Scenario: 用户切换保留选择

- **WHEN** 用户在确认前改变 `Keep as Platform contact` 状态
- **THEN** 前端 MUST 保持所见状态与最终 typed command 一致

### Requirement: 取消 pending invitation 不得显示 Contact 去留选项

Contacts 影响提示只适用于已经成为 workspace contact 的 active member。取消尚未加入 workspace 的 pending invitation MUST 保持独立的现有确认语义。

#### Scenario: 取消 pending invitation

- **WHEN** 用户请求取消尚未激活的 member invitation
- **THEN** 前端 MUST NOT 展示 workspace contact 移除或 `Keep as Platform contact` 选项

### Requirement: 移除 mutation 必须防止重复操作并可恢复

前端 MUST 为 mock member removal 提供 pending、失败和成功状态。mutation pending 时 MUST 禁止重复确认；失败时 MUST 保持 dialog 与原数据，成功后 MUST 刷新相关 view model。

#### Scenario: 移除进行中

- **WHEN** mock removal mutation 尚未结束
- **THEN** 前端 MUST 禁用重复确认并展示进行中状态

#### Scenario: 移除失败

- **WHEN** repository 返回 removal failure
- **THEN** 前端 MUST 保持确认 surface 和 EE 保留选择、展示安全错误，MUST NOT 提前移除成员行或 Contact 行

#### Scenario: 移除成功且 Contact 被删除

- **WHEN** mock mutation 成功并决定不保留 Contact
- **THEN** 前端 MUST 刷新 mock member list、Contacts list 和详情，并移除对应行

#### Scenario: 移除成功且保留 Platform contact

- **WHEN** EE mock mutation 成功并保留 Contact
- **THEN** 前端 MUST 从 member list 移除成员，同时刷新 Contacts 行和详情为 Platform contact

### Requirement: 本 change 不得调用真实 member removal 服务

member removal 提醒和结果仅用于 mock-backed 前端验收。当前 change MUST NOT 调用真实 `deleteMemberOrCancelInvitation`、后端成员 endpoint 或 Contact endpoint。

#### Scenario: 确认 mock 移除

- **WHEN** 用户在 Contacts-aware dialog 中确认
- **THEN** 前端 MUST 只调用 typed mock repository

#### Scenario: Feature gate 关闭

- **WHEN** Contacts mock feature gate 未开启
- **THEN** 前端 MUST 保持现有 production member removal 流程，不得被 mock mutation 接管

#### Scenario: 未来接入正式删除

- **WHEN** 后端支持原子 member removal 与 Contact retention contract
- **THEN** 后续 change MUST 用真实 repository adapter 替换 mock，并保留当前可观察 UI 语义

### Requirement: 移除确认必须可访问并恢复焦点

确认 surface 的标题、影响说明、保留控件、错误与 pending 状态 MUST 能被辅助技术识别，关闭后 MUST 恢复触发点焦点。

#### Scenario: 键盘完成确认

- **WHEN** 用户只使用键盘检查影响、切换 EE 保留选项并确认
- **THEN** 前端 MUST 保持合理焦点顺序、可见焦点和明确控件名称

#### Scenario: 关闭确认 surface

- **WHEN** 用户取消或 mutation 成功后 dialog 关闭
- **THEN** 前端 MUST 将焦点恢复到成员菜单触发点或下一个合理可操作元素
