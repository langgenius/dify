## ADDED Requirements

### Requirement: Debug Mode 必须编辑准确的 DSL 结构

Debug Mode 组件 MUST 编辑 `debug_mode.enabled` 与 `debug_mode.channels`，并 MUST 只向新配置提供 `email`、`feishu`、`slack`、`ding_talk`、`ms_teams`、`we_com` 六个 entity 枚举值。

#### Scenario: 开启 Debug Mode

- **WHEN** 用户启用 Debug Mode
- **THEN** 前端 MUST 将 `debug_mode.enabled` 更新为 true，并保持当前 channels 数组

#### Scenario: 选择 channel

- **WHEN** 用户选择一个或多个受支持 channel
- **THEN** 前端 MUST 按设计顺序将对应枚举字符串写入 `debug_mode.channels`

#### Scenario: 取消一个 channel

- **WHEN** 用户取消指定 channel
- **THEN** 前端 MUST 只移除该 channel，MUST NOT 改变其他 channel 或 v2 配置

### Requirement: Debug Mode 关闭后必须保留已选 channel

关闭 Debug Mode MUST 只更新 `enabled`，不得隐式清空 `channels`。重新开启时 MUST 恢复此前选择，除非用户显式移除。

#### Scenario: 关闭已有 channel 的 Debug Mode

- **WHEN** `debug_mode.channels` 非空且用户关闭 Debug Mode
- **THEN** 前端 MUST 保存 `enabled: false` 并保持 channels 数组不变

#### Scenario: 重新开启 Debug Mode

- **WHEN** 用户再次开启此前关闭的 Debug Mode
- **THEN** 组件 MUST 展示并使用保留的 channel selection

### Requirement: Debug Mode 必须表达有效、无效与兼容状态

组件 MUST 按 Figma node `25212:78480` 呈现开关、channel selection、disabled、read-only 与错误状态。`enabled: true` 且没有合法 channel 时 MUST 视为配置无效。

#### Scenario: 开启但没有 channel

- **WHEN** Debug Mode 已开启但 channels 为空
- **THEN** panel 与 node validation MUST 展示需要选择 channel 的错误

#### Scenario: Debug Mode 关闭

- **WHEN** `enabled` 为 false
- **THEN** 组件 MUST 按 Figma 表达关闭状态，并 MUST NOT 将保留的 channels 视为当前启用

#### Scenario: 只读 workflow

- **WHEN** workflow editor 处于只读状态
- **THEN** 组件 MUST 展示 enabled 与 channel summary，但 MUST 禁止修改

#### Scenario: imported unknown channel

- **WHEN** imported DSL 包含当前前端不支持的 channel string
- **THEN** UI MUST 显示 unsupported 状态或兼容错误，且一次无关字段编辑 MUST NOT 静默丢弃该值

### Requirement: Debug Mode UI 不得发送真实通知

本 change 中的 Debug Mode 组件 MUST 只编辑前端 DSL，不得调用 Email、IM provider、Contact API 或 Human Input runtime。

#### Scenario: 更改 Debug Mode

- **WHEN** 用户切换 enabled 或 channel selection
- **THEN** 前端 MUST 只更新当前 node data，MUST NOT 发出 debug notification 网络请求

#### Scenario: graphon 尚未支持 v2

- **WHEN** 用户配置 Debug Mode 而 runtime adapter 尚不可用
- **THEN** UI MUST 保留配置供后续 runtime 使用，MUST NOT 模拟任何 channel 的发送结果

### Requirement: Debug Mode 必须本地化且可访问

Debug Mode 标题、说明、channel label、错误与只读状态 MUST 使用 i18n 文案；开关和多选控件 MUST 具有明确 accessible state 与 keyboard interaction。

#### Scenario: 使用键盘配置 channel

- **WHEN** 用户只使用键盘开启 Debug Mode 并选择 channels
- **THEN** 控件 MUST 提供合理焦点顺序、可见焦点、选中状态和可辨识名称

#### Scenario: 辅助技术读取错误

- **WHEN** Debug Mode 开启但没有 channel
- **THEN** validation error MUST 与 Debug Mode 区域建立可感知关联
