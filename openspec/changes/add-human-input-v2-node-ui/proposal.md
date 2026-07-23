## Why

现有 Human Input 节点的 delivery-method 配置无法承载新的 Contact、动态 Email、一次性 Email、发起人、消息模板和多渠道 debug 体验。后端已提供 `human_input_v2/entities.py` 作为新 DSL 结构草案，需要新增一套独立的 Human Input v2 前端，同时完整保留原 Human Input 节点及既有 DSL 的编辑能力。

## What Changes

- 新增 Human Input v2 节点前端，以 `type: human-input` 且 `version: '2'` 作为唯一版本判别；缺失 `version` 或 `version !== '2'` 的节点继续使用原 Human Input UI。
- 在前端 block catalog 中为 Human Input v2 提供独立创建入口，同时保留原 Human Input 创建入口；v2 candidate 可以使用仅前端可见的 catalog identity，但保存时必须规范化为 `type: human-input` 与 `version: '2'`。
- 新增 v2 node card 与 panel，并按 Figma 展示 recipient 的摘要、空状态、配置状态和异常 / 截断状态。
- 新增 recipient 配置区域与 recipient input 组件，支持 DSL 中四种 recipient：`contact`、`dynamic_email`、`onetime_email`、`initiator`。
- 新增 debug mode 组件，编辑 `debug_mode.enabled` 和 `debug_mode.channels`，channel 值严格使用 `email`、`feishu`、`slack`、`ding_talk`、`ms_teams`、`we_com`。
- 新增 message template 弹窗，编辑 `message_template.subject` 与 `message_template.body`，并覆盖校验、未保存修改、提交和关闭行为。
- v2 继续复用现有 Human Input 的 `form_content`、`inputs`、`user_actions`、`timeout` 与 `timeout_unit` 领域结构和适用 UI primitives，但不得复用 v1 的 `delivery_methods` 数据模型。
- 前端序列化必须使用当前后端实体中的字段名 `recipients_spec`，不得继续生成旧拼写 `recpients_spec`。
- 新建 v2 节点默认写入 `version: '2'`；不自动迁移、覆盖或静默改写任何 v1 节点。
- Contact recipient 通过窄的 typed provider 搜索与回显；已保存 `contact_id` 的回显必须以 `{ contact_ids }` 作为一次批量查询解析。当前前端 provider 使用 mock 数据，后续只替换 provider adapter。
- 本 change 只更新前端与 OpenSpec，不修改后端 API contract、generated client、Contact 后端业务、graphon、运行时、数据库或 DSL migration。
- 以用户提供的八个 Figma 节点作为布局、状态、交互和文案验收基准。

## Capabilities

### New Capabilities

- `human-input-v2-node-editor`: Human Input v2 的版本识别、节点注册、node card recipient 状态、panel 组合、默认值、校验与 v1 共存。
- `human-input-v2-recipient-configuration`: 四种 recipient 的添加、编辑、去重、排序、变量选择、Contact 选择与 DSL 序列化。
- `human-input-v2-debug-mode`: Debug mode 开关、debug channel 多选、禁用 / 只读状态及 DSL 更新。
- `human-input-v2-message-template`: Subject / body 消息模板弹窗、变量插入、校验、草稿状态和确认行为。

### Modified Capabilities

无。

## Impact

- 前端需要新增 `human-input-v2` feature 目录、类型守卫、default config、node / panel、recipient components、debug component、message-template overlay、版本路由和测试。
- workflow block catalog 可使用前端专用的 v2 catalog identity，但持久化 node data MUST 保持 `type: human-input` 与 `version: '2'`；现有 v1 metadata、node、panel 和测试继续保留。
- v2 应复用现有 form editor、form inputs、user actions、timeout、输出变量和 branch handle 能力，避免复制无版本差异的逻辑；共享前必须消除对 v1 `delivery_methods` 的隐式依赖。
- Contact recipient option source 必须通过可替换的前端 provider 边界接入。当前搜索与回显由 mock provider 提供；node card 与 panel 对已存 `contact_id` 的解析必须向 provider 传入去重后的 `contact_ids`，并在缺失或失败时保留原始 ID。真实 Contact adapter 在后续后端契约可用时接入。
- 本 change 不修改 `api/core/workflow/nodes/human_input_v2/entities.py`，并接受 graphon 尚未注册 v2 runtime 的当前状态；运行时接入属于后续 change。
- 需要同步 `web/i18n/en-US/` 与 `web/i18n/zh-Hans/`，本 change 不修改其他 locale；使用 `@langgenius/dify-ui/*` overlay primitives，并为版本共存、DSL round-trip、recipient 状态、debug mode 和 message template 增加 Vitest / Testing Library 测试。
- 设计验收来源：
  - Node recipient 状态：Figma nodes `25096:30986`、`25096:32299`、`25096:32351`、`25096:32400`
  - Recipient 配置：Figma node `25094:31750`
  - Recipient input：Figma node `25087:29285`
  - Debug mode：Figma node `25212:78480`
  - Message template：Figma node `25170:22597`
