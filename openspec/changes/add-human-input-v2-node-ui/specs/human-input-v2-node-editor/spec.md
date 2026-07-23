## ADDED Requirements

### Requirement: 前端必须按字符串 version 精确区分 Human Input v2

前端 MUST 仅将同时满足 `type: human-input` 与 `version: '2'` 的 node data 识别为 Human Input v2。原 Human Input 的 node、panel、默认值和编辑行为 MUST 保留，且不得因为引入 v2 被自动迁移。

#### Scenario: 打开 Human Input v2

- **WHEN** workflow DSL 中的节点 `type` 为 `human-input` 且 `version` 为字符串 `'2'`
- **THEN** 前端 MUST 使用 Human Input v2 node、panel、metadata 和 validation

#### Scenario: 打开没有 version 的原 Human Input

- **WHEN** workflow DSL 中的 Human Input 节点没有 `version`
- **THEN** 前端 MUST 使用原 Human Input UI，并 MUST 保留其 `delivery_methods`

#### Scenario: 打开 version 1 的原 Human Input

- **WHEN** workflow DSL 中的 Human Input 节点 `version` 为字符串 `'1'`
- **THEN** 前端 MUST 使用原 Human Input UI，MUST NOT 将其改写为 v2

#### Scenario: version 使用数字 2

- **WHEN** Human Input node data 的 `version` 为数字 `2`
- **THEN** 前端 MUST NOT 将该节点识别为 Human Input v2

### Requirement: 新建 Human Input v2 必须写入完整且独立的默认结构

从独立 v2 创建入口新建节点时，节点 MUST 持久化为 `type: human-input` 与 `version: '2'`，并 MUST 一次性包含 v2 required nested objects。v1 与 v2 MUST 使用不同的 default config。

#### Scenario: 创建 Human Input v2

- **WHEN** 用户从 block catalog 的 Human Input v2 candidate 创建节点
- **THEN** 新节点 MUST 包含 `version: '2'`、空的 `recipients_spec`、空 subject/body 的 `message_template`、`enabled: false` 且 channels 为空的 `debug_mode`、空的 `form_content`、`inputs` 和 `user_actions`、`timeout: 36` 与 `timeout_unit: hour`

#### Scenario: 序列化新建节点

- **WHEN** 前端将新建 Human Input v2 导出到 workflow DSL
- **THEN** 持久化 `type` MUST 为 `human-input`，MUST NOT 写入仅供前端 catalog 使用的 v2 identity

#### Scenario: Block catalog 保留原 Human Input

- **WHEN** 用户查看或使用原 Human Input candidate
- **THEN** 前端 MUST 使用现有 v1 default，MUST NOT 向该节点写入 v2 recipient、message template 或 debug mode 字段

### Requirement: Human Input v2 必须保持 DSL 字段无损 round-trip

前端 MUST 使用 `api/core/workflow/nodes/human_input_v2/entities.py` 中现阶段的字段和值作为 v2 DSL contract。node data key MUST 保持为 `recipients_spec`，并 MUST NOT 在导入、编辑、复制粘贴或导出时生成旧拼写 `recpients_spec`。

#### Scenario: 导入并导出未修改的 v2 节点

- **WHEN** 前端导入一个包含完整 v2 recipient、message template、debug mode 和共享 form 字段的节点后未作修改直接导出
- **THEN** 所有受支持字段、数组顺序、discriminator 与值 MUST 保持等价

#### Scenario: 编辑无关字段

- **WHEN** 用户只修改 v2 节点的 timeout
- **THEN** 前端 MUST 保留原 `recipients_spec`、`message_template`、`debug_mode` 和未知但未被编辑的兼容数据

#### Scenario: 检查 recipient wire key

- **WHEN** v2 节点被保存、复制或粘贴
- **THEN** 输出 MUST 包含 `recipients_spec`，MUST NOT 生成 `recpients_spec`

### Requirement: Node card 必须呈现 Figma 定义的 recipient 状态

Human Input v2 node card MUST 根据 `recipients_spec` 和 Contact option resolution 派生 recipient summary，并 MUST 覆盖 Figma nodes `25096:30986`、`25096:32299`、`25096:32351` 与 `25096:32400` 所定义的状态。summary 计算 MUST 为纯派生逻辑，不得修改 node data。

#### Scenario: 没有 recipient

- **WHEN** `recipients_spec` 为空
- **THEN** node card MUST 展示 Figma 对应的未配置状态

#### Scenario: 展示已配置 recipient

- **WHEN** `recipients_spec` 包含一个或多个有效 recipient
- **THEN** node card MUST 按 DSL 顺序展示设计指定的类型、label、组合和 overflow 信息

#### Scenario: Contact 无法解析

- **WHEN** 已存 `contact_id` 无法从 Contact `contact_ids` 批量查询边界解析
- **THEN** node card MUST 展示稳定的 unresolved fallback，并 MUST 保留该 `contact_id`

#### Scenario: recipient 配置无效

- **WHEN** recipient 缺少 required field、Email 无效或 selector 无效
- **THEN** node card MUST 展示 Figma 对应的异常状态，MUST NOT 静默删除该配置

### Requirement: Human Input v2 panel 必须组合 v2 与共享配置能力

Human Input v2 panel MUST 按 Figma 提供 Recipients、Message Template 和 Debug Mode，并 MUST 继续提供适用于 v1/v2 的 form content、form inputs、user actions、timeout 与 outputs。v2 panel MUST NOT 读取或编辑 v1 `delivery_methods`。

#### Scenario: 打开 v2 panel

- **WHEN** 用户选中 Human Input v2 节点
- **THEN** panel MUST 展示 recipient、message template、debug mode 和共享 form 配置区

#### Scenario: 编辑共享 form 配置

- **WHEN** 用户在 v2 panel 修改 form content、input、user action 或 timeout
- **THEN** 前端 MUST 只更新对应的共享 DSL 字段，并保持 v2 专属字段不变

#### Scenario: 打开 v1 panel

- **WHEN** 用户选中原 Human Input 节点
- **THEN** panel MUST 继续展示现有 Delivery Method 和共享配置，MUST NOT 展示 v2 recipient、debug mode 或 message template UI

### Requirement: Human Input v2 必须保留共享的 branch 与 output 语义

Human Input v2 MUST 从 `user_actions[].id` 生成 action branch handles，并 MUST 保留 `__timeout` branch。其 output variables MUST 延续 Human Input form input 与 action/rendered-content 的既有语义。

#### Scenario: 添加 user action

- **WHEN** 用户为 v2 节点添加一个带稳定 id 的 user action
- **THEN** node card、edge handle、layout 和 branch sorting MUST 使用该 action id 表示对应分支

#### Scenario: 删除 user action

- **WHEN** 用户删除一个已有连接边的 v2 user action
- **THEN** 前端 MUST 使用现有 Human Input 的确认与 edge cleanup 语义处理该分支

#### Scenario: 读取 outputs

- **WHEN** 其他节点选择 Human Input v2 的输出变量
- **THEN** 前端 MUST 提供 form inputs 以及 `__action_id`、`__action_value`、`__rendered_content` 等适用输出

#### Scenario: timeout branch

- **WHEN** v2 节点出现在 graph layout 或 edge editor
- **THEN** 前端 MUST 保持 `__timeout` branch 可辨识且排序稳定

### Requirement: Human Input v2 validation 必须按 v2 数据模型执行

前端 MUST 为 v2 使用独立 validation，并 MUST 至少验证版本、recipient、message template、debug mode 以及共享 form/action 规则。错误 MUST 在 node checklist 与对应 panel 区域可定位。

#### Scenario: 没有有效 recipient

- **WHEN** v2 `recipients_spec` 为空或全部 recipient 无效
- **THEN** validation MUST 阻止该节点被视为配置完整，并 MUST 将错误关联到 recipient 配置区

#### Scenario: Debug mode 没有 channel

- **WHEN** `debug_mode.enabled` 为 true 且没有合法 channel
- **THEN** validation MUST 报告 debug channel 错误

#### Scenario: 共享字段无效

- **WHEN** v2 form input、user action 或 timeout 违反现有 Human Input 共享规则
- **THEN** v2 validation MUST 返回与对应共享配置关联的错误

#### Scenario: v1 validation

- **WHEN** 前端校验原 Human Input
- **THEN** 前端 MUST 继续使用 v1 validation，MUST NOT 要求 v2 recipient、message template 或 debug channel

### Requirement: Frontend-only 实现不得依赖或伪造 Human Input v2 runtime

本 change MUST 只提供前端创建、配置、编辑和 DSL round-trip。前端 MUST 在 graphon 尚未导出 Human Input v2 class 时使用本地严格类型完成 UI，不得为此修改 graphon 或后端。单节点运行、debug run、发布和正式运行行为 MUST 保持在本 change 范围之外，且 MUST NOT 新增模拟成功结果。

#### Scenario: graphon 没有 Human Input v2 定义

- **WHEN** 前端构建时 graphon 只提供原 Human Input runtime 类型
- **THEN** Human Input v2 node、panel、catalog 与 DSL types MUST 仍能通过前端类型检查且不要求 graphon 改动

#### Scenario: 打开已有 v2 节点

- **WHEN** workflow 已含 `version: '2'` 的 Human Input
- **THEN** 前端 MUST 允许查看和编辑其前端配置

#### Scenario: 本 change 不接入 runtime

- **WHEN** 实现者完成 Human Input v2 前端创建与编辑能力
- **THEN** 本 change MUST NOT 新增 graphon adapter、runtime request、模拟执行器或模拟运行结果
