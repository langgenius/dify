## Why

HITL v2 当前把 Markdown、原始 input 定义、动态默认值和已渲染文本分别传递，导致各 IM adapter 重复理解 workflow 表单 DSL，并且无法保持前端已经采用的 Markdown 与 input 原位交错语义。现在需要在 v2 中建立一份渠道无关、变量已经解析的表单快照，先统一 IM 渲染边界，同时为未来前端迁移保留稳定模型。

## What Changes

- 新增渠道无关的 `ResolvedForm` 模型，以有序的 `MarkdownText | Input` blocks 表达最终展示内容，并携带 title、actions 和 `legacy_form_content`；该字符串已替换所有非输出变量，但保留 `{{#$output.<name>#}}` slots。
- 新增 HITL v2 form compilation/resolution 边界：替换 Markdown 中的非输出 workflow variables，按 `{{#$output.<name>#}}` 原位切割内容，解析 paragraph defaults 和 select options/defaults，并冻结 file constraints。
- 让 HITL v2 form aggregate 持有并持久化 `ResolvedForm` snapshot，使异步 delivery、交互回调和 action selection 使用同一份已展示定义。
- **BREAKING (internal)**：调整 `NormalizedCardIntent` 及 IM dynamic-card contracts，使 adapters 消费 `ResolvedForm`，不再接收或解析 `FrozenFormDefinition`、raw mappings、selectors 或独立的 default-values mapping。
- 保留已部分解析的 `legacy_form_content`，仅用于 v1 compatibility；v2 rendering 不得消费该字段。
- 本变更不迁移现有前端 renderer 或 Web transport；`ResolvedForm` 的模块归属、命名和 serialization shape 保持渠道无关，避免未来前端迁移时再次重塑 schema。

## Capabilities

### New Capabilities

- `hitl-v2-resolved-form`: 定义 HITL v2 resolved form snapshot、编译不变量、持久化语义，以及 IM consumer 的能力评估和渲染边界。

### Modified Capabilities

无。

## Impact

- 后端 workflow node：`api/core/workflow/nodes/human_input_v2/` 中的表单解析与 snapshot 构建。
- HITL v2 domain 和 persistence：form aggregate、creation request、repository models/mappers 与 submission validation。
- IM contracts 和 adapters：Slack、Microsoft Teams、Feishu/Lark 以及相关 dynamic-card tests。
- 现有 Web API 和前端表单渲染不在本次变更范围内。
- 不引入新的外部依赖，也不改变 v1 delivery 模型。
