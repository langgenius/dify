## Context

现有前端只注册了一套 `web/app/components/workflow/nodes/human-input/` UI，其 node data 使用 `delivery_methods`，并由 `BlockEnum.HumanInput` 直接映射到 v1 node 和 panel。新 Human Input v2 仍持久化为 `type: human-input`，但用户已明确要求使用字符串 `version: '2'` 区分；原 Human Input 必须保留。

`api/core/workflow/nodes/human_input_v2/entities.py` 是本 change 的 DSL 结构事实来源：

```text
HumanInputNodeData
  type: human-input
  version: '2'
  recipients_spec: RecipientConfig[]
  message_template:
    subject: string
    body: string
  debug_mode:
    enabled: boolean
    channels: DebugChannel[]
  form_content: string
  inputs: FormInputConfig[]
  user_actions: UserActionConfig[]
  timeout: number
  timeout_unit: hour | day

RecipientConfig
  contact       { contact_id }
  dynamic_email { selector }
  onetime_email { email }
  initiator     {}

DebugChannel
  email | feishu | slack | ding_talk | ms_teams | we_com
```

实体当前使用 `recipients_spec` 拼写。前端同步以此作为 wire contract，不得继续生成旧拼写 `recpients_spec`。graphon 尚未注册 Human Input v2 runtime；本 change 只实现前端配置与 DSL round-trip，不补后端运行能力。

现有 v1 的 form content、form inputs、user actions、timeout、输出变量和 branch handles 与 v2 DSL 兼容。v2 可以复用这些领域能力，但不能让共享组件继续依赖 v1 的 `delivery_methods` 或 `HumanInputNodeType` 整体。

设计验收来源：

| 范围                | Figma node                                                 |
| ------------------- | ---------------------------------------------------------- |
| Node recipient 状态 | `25096:30986`、`25096:32299`、`25096:32351`、`25096:32400` |
| Recipient 配置      | `25094:31750`                                              |
| Recipient input     | `25087:29285`                                              |
| Debug mode          | `25212:78480`                                              |
| Message template    | `25170:22597`                                              |

实施开始时已通过授权访问读取全部八个 Figma 节点，并将逐节点布局、文案、状态、键盘、只读和响应式验收记录在 `figma-acceptance.md`。实现与视觉核对以该矩阵为准。

## Goals / Non-Goals

**Goals:**

- 新增一套 Human Input v2 node、panel、default config 和类型系统，并与 v1 安全共存。
- 以 `version === '2'` 精确识别 v2，确保旧 DSL、旧节点 UI 和旧测试不被静默迁移。
- 完整编辑 `recipients_spec`、`message_template` 和 `debug_mode`，并保持与 Python entity 的字段和值一致。
- 复用 v1/v2 共同的 form content、inputs、user actions、timeout、outputs 和 branch behavior。
- 为 Contact recipient 使用可替换的前端 option-provider 边界；已存 recipient 回显统一通过 `{ contact_ids }` 单次批量解析，当前数据由 mock provider 提供。
- 覆盖 DSL import、前端编辑、复制粘贴、变量重命名与导出前数据的 round-trip。
- 遵循 dify-ui、英语与简体中文 i18n、可访问性和 Vitest / Testing Library 规范；本 change 不修改其他 locale。

**Non-Goals:**

- 不修改 graphon、Human Input v2 Python entity、node factory、runtime、callback、API、数据库或 DSL migration。
- 不让 v2 单节点运行、workflow debug 或正式运行假装成功；运行时支持属于后续后端 change。
- 不将 v1 `delivery_methods` 转换成 v2 recipient/message/debug 结构。
- 不自动升级已有 v1 Human Input，也不在打开旧 workflow 时写入 `version: '2'`。
- 不实现 Contacts 目录本身、IM platform 绑定或 Contact API 的后端业务逻辑，也不修改 API contract 或 generated client；真实 Contact adapter 属于后续接入。
- 不重新设计 v1 Human Input UI。

## Decisions

### 1. 使用持久化 version 与前端 catalog identity 两层判别

新增纯函数：

```text
isHumanInputV2NodeData(data)
  data.type === human-input
  && data.version === '2'
```

持久化 DSL 只使用 `type: human-input` 和 `version: '2'`。前端 block catalog 可以增加 `HumanInputV2` identity，使 v1/v2 拥有独立 metadata、default config 和校验器；创建 candidate node 时，v2 default 的实际 `data.type` 必须映射回 `human-input`。

`getNodeCatalogType`、node/panel component router、checklist 和 metadata lookup 必须先使用 `isHumanInputV2NodeData` 分流。只有精确字符串 `'2'` 进入 v2；缺失、数字 `2`、字符串 `'1'` 或未知版本均不得被误识别为 v2。

该方案沿用仓库中 versioned node 的 catalog / persisted-type 分离模式。备选方案“新增持久化 type `human-input-v2`”违反用户指定 DSL；“用字段存在性猜测版本”会在不完整 DSL 或未来扩展中产生误判，因此不采用。

### 2. v1 与 v2 使用 wrapper 路由，v1 代码保持原位

`BlockEnum.HumanInput` 的运行时组件映射改为薄 wrapper：

- `version === '2'` → v2 node / panel。
- 其他情况 → 当前 v1 node / panel。

若 candidate node 暂时使用 UI-only `HumanInputV2` catalog type，component map 同时直接映射到 v2，直到 candidate 被规范化为持久化 type。现有 v1 文件、defaults、delivery-method components 和 tests 保留，不进行大规模搬迁。

这比直接用 v2 替换 `HumanInputNode` 风险更低，也避免为 v1 workflow 引入非必要 diff。

### 3. v2 TypeScript 类型严格镜像现阶段 DSL

定义 discriminated unions：

```text
ContactRecipient
  type: contact
  contact_id: string

DynamicEmailRecipient
  type: dynamic_email
  selector: ValueSelector

OnetimeEmailRecipient
  type: onetime_email
  email: string

InitiatorRecipient
  type: initiator
```

`HumanInputV2NodeType` 必须包含：

```text
type: human-input | HumanInputV2 catalog identity
version: '2'
recipients_spec: HumanInputV2Recipient[]
message_template: { subject; body }
debug_mode: { enabled; channels }
form_content
inputs
user_actions
timeout
timeout_unit
```

TypeScript model 与 wire contract 必须直接使用 `recipients_spec`，不得保留旧拼写或增加序列化转换层。UI 局部可以继续使用语义化变量名 `recipients`，但 node data key 必须始终为 `recipients_spec`。

### 4. 新 v2 default 与 v1 default 完全分离

v2 default 以 entity 默认值为基础：

```text
version: '2'
recipients_spec: []
message_template: { subject: '', body: '' }
debug_mode: { enabled: false, channels: [] }
form_content: ''
inputs: []
user_actions: []
timeout: 36
timeout_unit: hour
```

新建节点时必须一次性写入完整 v2 discriminators 和 required nested objects，避免 panel 首次渲染时修补数据。v1 default 继续使用当前 `delivery_methods` 和既有 timeout 默认值。

### 5. Recipient editor 使用一个 ordered discriminated list

`recipients_spec` 的数组顺序是 node card 和配置列表的展示顺序。recipient input 负责选择类型并生成 typed draft；列表项负责编辑、删除和错误展示。

建议的前端去重 key：

- Contact：`contact_id`。
- Dynamic Email：完整 selector path。
- One-time Email：trim 后 lower-case 的完整 Email。
- Initiator：全列表最多一个。

UI 必须阻止新增相同 recipient，并在 imported DSL 已含重复项时展示可修复错误，而不是静默删除。删除或编辑只更新目标 index，不改变其他 recipient 顺序。

### 6. Contact 选项通过可替换的 typed provider 注入

定义窄接口，例如：

```text
searchContactRecipientOptions(query)
getContactRecipientOptionsByIds(ids)
```

node card 与 panel 对已存 `contact_id` 的回显必须调用 provider 的 `{ contact_ids }` 批量查询边界，单次解析当前节点/配置中去重后的全部 Contact ID，不得用列表第一页或逐 ID 请求。provider 读取失败或响应缺少某个 ID 时，已存 `contact_id` 必须保留，UI 显示 unresolved 状态，不能删除 DSL 数据。

当前 provider 使用确定性 mock 数据，并保持与最终 Contact 批量查询相同的 `{ contact_ids }` 入参形状。组件只依赖窄接口；后续真实接口就绪后，用网络 adapter 替换 mock 即可，本 change 不修改后端契约或生成 client。搜索暂时继续由同一 mock provider 提供。

### 7. Dynamic Email 与 message template 接入 workflow 变量基础设施

Dynamic Email 使用现有 ValueSelector / variable selector primitives，只允许设计和 DSL 支持的变量类型。message template subject/body 若支持变量插入，使用现有 workflow variable picker 和模板 token 语义。

前端变量依赖工具必须识别：

- `recipients_spec[].type === dynamic_email` 的 `selector`。
- `message_template.subject` 与 `message_template.body` 中的 workflow variable tokens。
- 已复用 `form_content` 和 input default 中的变量。

节点 / 变量重命名、变量删除和复制粘贴时必须同时处理这些 v2 引用，且不得进入 v1 `delivery_methods` 更新路径。

### 8. Node card 使用纯派生 summary model

node card 不直接遍历并临时拼装复杂 JSX。建立纯函数将 `recipients_spec` 与 Contact option state 转换为 Figma 所需的 summary model，至少能表达：

- 无 recipient。
- 每种 recipient 类型的可辨识 label。
- 多 recipient 的顺序、截断 / overflow 信息。
- unresolved Contact、invalid Email 或 invalid selector 等配置异常。

四个 Figma recipient-state 节点决定最终视觉组合。summary 派生不得修改 node data；Contact label 加载失败时使用稳定 fallback。

### 9. Debug mode 开关保留 channel 草稿

`debug_mode.enabled` 与 `debug_mode.channels` 分开更新。关闭 debug mode 时保留已选择 channels，以便重新开启；只有用户显式移除 channel 才改变数组。

当 debug mode 开启但没有 channel 时，node validation 必须展示配置错误。channel 选项严格限制为 entity 枚举；imported unknown value 必须保留在原始 node data 或显示 unsupported 状态，不能在一次无关编辑中静默改写整个 config。

本组件只编辑 DSL，不触发真实 debug 通知。

### 10. Message template overlay 使用局部 draft 与原子提交

打开 overlay 时从 node data 创建 subject/body draft。Cancel、Escape 或关闭操作丢弃 draft；Confirm 在校验通过后一次性写回完整 `message_template`。mutation 期间没有网络请求，但组件仍应防止重复 confirm。

Subject 和 body 的空白校验、字符限制、变量插入、预览和辅助文案以 Figma acceptance matrix 为准。不得继承 v1 Email delivery 中 `{{#url#}}` 的隐式校验，除非 v2 DSL 或设计明确要求。

overlay 使用 `@langgenius/dify-ui/*`，关闭后恢复触发点焦点，并在存在未保存修改时按设计处理关闭确认。

### 11. 共享 form 能力通过窄类型抽取，不共享完整 panel

从 v1 中抽取仅依赖以下字段的公共类型 / components / hooks：

- `form_content`
- `inputs`
- `user_actions`
- `timeout`
- `timeout_unit`

v1 panel 继续组合 Delivery Method；v2 panel 组合 Recipients、Message Template 和 Debug Mode。两者再组合同一套 form content、user actions、timeout 和 output sections。

不直接让 v2 import v1 `HumanInputNodeType`，也不把两个完整 panel 合并成大量版本条件分支。

### 12. Validation 与 branch/output 行为按版本路由

v2 checkValid 至少验证：

- `version` 精确为 `'2'`。
- 至少一个有效 recipient。
- 四种 recipient 的 required fields。
- message template 的 Figma-required fields。
- debug enabled 时至少一个合法 channel。
- 共享 user action 与 form input 规则。

v2 的 branch handles 仍来自 `user_actions[].id`，并保留 `__timeout`；output vars 继续使用 form inputs 与 `__action_id`、`__action_value`、`__rendered_content`。ELK branch sorting、edge deletion、output derivation和 variable utilities 必须接受 v1/v2 的共享最小类型。

### 13. 前端独立注册 v2 创建入口，不等待 graphon 更新

前端 block catalog 增加 Human Input v2 的独立 candidate，同时保留原 Human Input candidate。v2 candidate 使用 UI-only catalog identity 区分 metadata 与 default config；加入画布或保存时规范化为 `type: human-input` 与 `version: '2'`。

Human Input v2 TypeScript model、routing 和 editor MUST NOT 依赖 graphon 已经导出 v2 node class。graphon/runtime 缺失不阻止本 change 完成前端创建与编辑；运行、debug 和发布行为保持在本 change 范围之外，且不得加入模拟 v2 execution support。

## Risks / Trade-offs

- [graphon 尚未支持 v2 runtime] → 使用本地前端类型和 catalog identity 完成创建与编辑，明确本 change 只保证配置和 DSL round-trip，不宣称运行可用。
- [同一 persisted type 对应两套 UI] → 统一使用 `isHumanInputV2NodeData`，所有 metadata、component、validation 和 utility lookup 走同一 catalog resolver。
- [字段更名后前后端 contract 可能继续漂移] → 类型、fixtures、round-trip tests 和最终 diff audit 均断言使用 `recipients_spec` 且不再生成 `recpients_spec`。
- [Contact 查询失败或批量响应不完整] → provider 保留 unresolved ID fallback；组件不删除 DSL 数据，并允许用户重试、替换或删除。
- [共享 v1 组件时带入 delivery-method 假设] → 只抽取共享字段的窄 props 和 hooks，不共享完整 `HumanInputNodeType`。
- [变量引用工具遗漏 v2 selector/template] → 为提取、重命名、删除、复制和粘贴建立独立回归测试。
- [Figma 具体状态尚未核对] → 实施首项建立 acceptance matrix，再冻结 node summary、recipient input、debug 和 modal 行为。
- [未知 debug channel 或不完整 import 被无关编辑抹掉] → 对 unsupported data 使用显式错误和局部字段更新，避免全对象重建。
- [v1 被意外迁移] → golden DSL tests 验证 v1 import/edit/export 不新增 version 2 字段，不删除 `delivery_methods`。

## Migration Plan

1. 通过授权 Figma 访问建立八个节点的 acceptance matrix。
2. 增加 v2 types、guard、catalog identity、default、独立 catalog candidate 和 version-aware component / metadata routing。
3. 抽取 v1/v2 共享的 form、action、timeout、output 最小边界，并保持 v1 tests 通过。
4. 实现 typed mock Contact option provider、recipient editor、node summary、debug mode 和 message template overlay；回显统一走 `{ contact_ids }` 批量查询边界。
5. 更新变量依赖、复制粘贴、branch layout、validation 与 checklist utilities。
6. 完成 i18n、可访问性、响应式、DSL round-trip 和 v1 regression tests。
7. 对创建、导入、编辑、复制粘贴和导出执行前端验收，并记录 graphon/runtime 后续接入点。

本 change 没有数据迁移。回滚前端创建入口时，已存在的 v2 DSL 仍必须保留，不能降级写成 v1。

## Open Questions

- v2 candidate 在 block catalog 中的最终产品名称、说明和排序需以设计验收为准，但它必须与原 Human Input candidate 同时保留。
- graphon/runtime 后续接入后，单节点运行、workflow debug、发布前校验和 capability handshake 的正式 contract 由后续 change 定义。
- Figma 四个 node recipient 状态分别对应空、单项、多项、overflow 还是 validation 状态，需要通过授权设计访问确认。
- Contact provider 的最终回显边界已确定为 `contact_ids` 批量查询；当前使用 mock 数据，真实 adapter 待后端契约与 client 可用后接入。
- Message template 的 subject/body 字符限制、变量类型范围和关闭未保存草稿策略，以 Figma 与产品验收为准。
- v2 runtime 未就绪时，single run、workflow run 和 publish checklist 应隐藏、禁用还是展示 unsupported 提示，需要与后端 rollout change 协调。
