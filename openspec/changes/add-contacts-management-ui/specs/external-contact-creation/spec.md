## ADDED Requirements

### Requirement: 只有具备 Contact 管理权限的用户才能看到创建入口

前端 MUST 只在 mock context 的 `can_manage_contacts` 为 true 时提供添加 External contact 的入口。

#### Scenario: 管理员打开创建流程

- **WHEN** `can_manage_contacts` 为 true 且管理员激活添加 External contact
- **THEN** 前端 MUST 打开 Figma 定义的创建 surface

#### Scenario: 只读用户浏览 Contacts

- **WHEN** `can_manage_contacts` 为 false
- **THEN** 前端 MUST 隐藏或禁用添加 External contact 的操作并提供权限说明

### Requirement: External contact 表单必须收集可识别身份与必填 Email

前端 MUST 按 Figma 展示 External contact 字段，并至少收集 display name 与 Email。Email MUST 为必填且通过格式校验；用户可见错误 MUST 与对应字段关联。

#### Scenario: 必填字段为空

- **WHEN** 管理员提交时 display name 或 Email 缺失
- **THEN** 前端 MUST 阻止 mutation 并在对应字段展示必填错误

#### Scenario: Email 格式无效

- **WHEN** 管理员输入不合法 Email
- **THEN** 前端 MUST 阻止 mutation、展示 Email 格式错误并将焦点移到或关联至 Email 字段

#### Scenario: 输入合法字段

- **WHEN** display name 与 Email 均通过前端校验
- **THEN** 前端 MUST 构造 typed create command 并调用 mock repository

### Requirement: Mock repository 必须按 lower-case 完整 Email 返回身份冲突

mock repository MUST 使用整条 Email lower-case 后完全相等的规则比较当前 workspace Contacts 与 mock 可添加 Platform-contact identity，并 MUST 返回可区分的 typed result。

#### Scenario: Email 与 External contact 重复

- **WHEN** normalized Email 命中当前 workspace 已有 External contact
- **THEN** repository MUST 返回 `duplicate_external_contact`，前端 MUST 提示查看或使用已有 Contact

#### Scenario: Email 命中 workspace contact

- **WHEN** normalized Email 命中当前 workspace contact
- **THEN** repository MUST 返回 `matches_workspace_contact`，前端 MUST 说明该对象已经是内部 Contact

#### Scenario: Email 命中 Platform contact

- **WHEN** normalized Email 命中当前 Contacts 或可添加数据中的 Platform contact
- **THEN** repository MUST 返回 `matches_platform_contact`，前端 MUST 引导按 Platform contact 处理，MUST NOT 创建 External contact

#### Scenario: Email 未命中任何现有身份

- **WHEN** normalized Email 未命中 workspace contact、Platform contact 或 External contact
- **THEN** repository MUST 允许创建新的 mock External contact

### Requirement: 创建流程必须提供明确的 pending、失败与恢复状态

前端 MUST 在创建 mutation 期间防止重复提交，并 MUST 根据 typed result 展示冲突或失败状态。

#### Scenario: 创建进行中

- **WHEN** mock mutation 尚未结束
- **THEN** 前端 MUST 禁用重复提交和会破坏提交上下文的字段操作，并展示进行中状态

#### Scenario: Mock mutation 失败

- **WHEN** repository 返回 `failed`
- **THEN** 前端 MUST 保留可安全保留的表单值、展示安全错误和重试操作，MUST NOT 添加列表行

#### Scenario: 冲突后修改 Email

- **WHEN** 管理员在冲突结果后修改 Email
- **THEN** 前端 MUST 清除已不适用的冲突错误，并允许重新提交

### Requirement: 创建成功后目录与详情必须保持一致

创建成功后，前端 MUST 刷新 Contacts 列表，并按 Figma 行为关闭创建 surface 或进入新 Contact 详情。新对象 MUST 以 `External contact` 展示，且只表达 Email 联系方式。

#### Scenario: 创建成功

- **WHEN** repository 返回 `created` 与新 `contact_id`
- **THEN** 前端 MUST 在当前目录 query 中显示新 External contact，并清理表单草稿

#### Scenario: 创建后打开详情

- **WHEN** Figma 定义创建成功后进入详情
- **THEN** 前端 MUST 使用 repository 返回的 `contact_id` 打开该 External contact

#### Scenario: 关闭成功反馈后返回列表

- **WHEN** 创建成功流程结束并返回目录
- **THEN** 前端 MUST 保留创建前仍适用的列表浏览上下文

### Requirement: 取消创建不得改变 mock Contacts

用户取消创建时，前端 MUST 丢弃未提交草稿，MUST NOT 调用 create mutation 或新增 Contact。

#### Scenario: 有未保存输入时取消

- **WHEN** 管理员关闭创建 surface 且 mutation 尚未开始
- **THEN** 前端 MUST 不改变 repository，并按设计执行关闭或二次确认

#### Scenario: 关闭 overlay 后恢复焦点

- **WHEN** 创建 dialog 或 drawer 关闭
- **THEN** 前端 MUST 将焦点恢复到添加 External contact 的触发控件

### Requirement: External contact 创建必须只使用 typed mock 数据

本 change MUST NOT 为创建 External contact 新增后端 endpoint、OpenAPI schema、生成式 client 或真实网络请求。

#### Scenario: 提交创建

- **WHEN** 用户提交合法 External contact 表单
- **THEN** 前端 MUST 只调用 Contacts-owned mock repository

#### Scenario: Mock scenario 切换结果

- **WHEN** 测试选择 success、duplicate、workspace-match、platform-match 或 failure scenario
- **THEN** repository MUST 确定性返回对应 typed result

#### Scenario: 未来接入后端

- **WHEN** 正式 Contact API 完成
- **THEN** 后续 change MUST 通过真实 repository adapter 替换 mock，并由服务端执行最终冲突判定
