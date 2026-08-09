## Context

HITL v2 的 authoring schema 继续复用 v1 `FormInputConfig` 和 `UserActionConfig`。运行时需要同时处理 `form_content`、inputs、变量来源、resolved defaults、actions 和 legacy `rendered_content`。当前 `FrozenFormDefinition` 把这些不同阶段的数据混在一起，并通过 `NormalizedCardIntent` 暴露给 IM adapters。

Slack、Microsoft Teams 和 Feishu/Lark adapters 因而分别执行 raw mapping 识别、默认值合并、selector 检查、select option 校验和 action style 映射。它们还把完整 Markdown 放在 inputs 之前，丢失 `{{#$output.<name>#}}` 在 Markdown 中表达的原位顺序。前端已经按照该 token 切割内容并原位渲染字段，但仍需自行合并 inputs 和 resolved defaults。

本设计把 workflow authoring DSL 编译为一份不可变的 resolved snapshot。当前迁移以 IM 为目标；模型所有权保持渠道无关，以免未来迁移前端时再次设计一套表单协议。

## Goals / Non-Goals

**Goals:**

- 建立一份有序、不可变、渠道无关的 `ResolvedForm`。
- 在进入 IM adapter 前完成 Markdown variable replacement、input slot expansion、default resolution 和 select option resolution。
- 让 IM adapters 只负责 provider capability assessment 和 serialization。
- 让 form aggregate、异步 delivery 和 action selection 引用同一份 resolved snapshot。
- 保持 v1 compatibility 所需的 `legacy_form_content`，同时明确 blocks 是 v2 权威来源。
- 为未来 Web DTO 投影提供足够信息，但不在本变更中迁移前端。

**Non-Goals:**

- 不修改 HITL v1 delivery 或前端 authoring DSL。
- 不迁移现有 React renderer 和 v2 public transport。
- 不新增 `required`、label、layout metadata 或其他当前 DSL 不具备的语义。
- 不解决各 IM provider 本身不支持 file upload 或复杂 card layout 的限制。
- 不重新设计 recipient、authorization、delivery attempt 或 callback correlation 模型。

## Decisions

### 1. Define a channel-neutral resolved form model

在 `core/human_input_v2` 的通用模块中定义 domain dataclasses，而不是放入 `im_provider`：

```python
@dataclass(frozen=True, slots=True)
class MarkdownText:
    text: str


@dataclass(frozen=True, slots=True)
class ParagraphInput:
    output_name: str
    default_value: str | None


@dataclass(frozen=True, slots=True)
class SelectInput:
    output_name: str
    options: tuple[str, ...]
    default_value: str | None


@dataclass(frozen=True, slots=True)
class FileInput:
    output_name: str
    allowed_file_types: tuple[FileType, ...]
    allowed_file_extensions: tuple[str, ...]
    allowed_upload_methods: tuple[FileTransferMethod, ...]


@dataclass(frozen=True, slots=True)
class FileListInput:
    output_name: str
    allowed_file_types: tuple[FileType, ...]
    allowed_file_extensions: tuple[str, ...]
    allowed_upload_methods: tuple[FileTransferMethod, ...]
    maximum_count: int


type Input = ParagraphInput | SelectInput | FileInput | FileListInput
type CardContent = MarkdownText | Input


@dataclass(frozen=True, slots=True)
class ResolvedForm:
    title: str | None
    blocks: tuple[CardContent, ...]
    actions: tuple[CardAction, ...]
    # All non-output variables are resolved; {{#$output.<name>#}} slots remain.
    legacy_form_content: str
```

具体 input 本身就是 block，不增加 `InputBlock` wrapper。`output_name` 是提交值与 workflow output 的稳定关联。`default_value` 只保存最终标量，不保存 constant/variable source 或 selector。File constraints 和 `maximum_count` 保存实际生效的不可变值；`allowed_file_types` 和 `allowed_upload_methods` 分别保留 `FileType` 与 `FileTransferMethod` enums，不退化为字符串。

`legacy_form_content` 仅为 v1 compatibility 保留。它保存完成所有非输出变量替换后的表单文本，同时原样保留 `{{#$output.<name>#}}` slots。除 compiler 在构造 blocks 时使用该中间结果外，任何 v2 consumer 都不得把该字段作为 typed rendering 的内容来源。

替代方案是在 `NormalizedCardIntent` 内定义相同结构。该方案会让未来前端依赖 IM package，因此拒绝。另一替代方案是保留 raw definition 与 resolved snapshot 两个长期权威来源；该方案存在漂移风险，因此也拒绝。

### 2. Compile authoring data at the workflow boundary

compiler 位于 `core/workflow/nodes/human_input_v2`，因为只有该层应理解 `HumanInputNodeData`、workflow variable pool、value sources 和 `{{#$output.<name>#}}` DSL。它执行以下步骤：

1. 按 `output_variable_name` 建立 typed input config 索引。
2. 区分普通 workflow variable tokens 与 `$output` input slots，替换所有非输出变量并原样保留 output slots，得到 `ResolvedForm.legacy_form_content`。
3. 按保留的 `$output` tokens 保持原位顺序切割 `ResolvedForm.legacy_form_content`。
4. 对非 token fragment，仅当 `fragment != ""` 时产生 `MarkdownText`；不得调用 `strip()`。因此相邻 inputs 之间不会产生空 Markdown block，而真实空白和换行仍被保留。
5. 对 input slot 产生与 node config 对齐的 `ParagraphInput`、`SelectInput`、`FileInput` 或 `FileListInput`，并把配置名映射为 `output_name`。
6. 解析 paragraph defaults、select options/defaults 和 file-list effective maximum count，使 snapshot 中不再出现 selector、source discriminator、`Segment` 或 raw JSON mapping。
7. 冻结 title 和 actions，并把第 2 步得到的部分解析文本保存为 `legacy_form_content`。

DSL 写入阶段已经负责 input slot 的重复性校验，compiler 和 adapters 不重复该检查。引用不存在 input config 的 slot 属于无法构造完整 snapshot 的错误；没有被 `form_content` 引用的 input config 不进入 blocks。

替代方案是在每个 delivery adapter 中按需解析。它看似缩小初始改动，但会继续复制 workflow knowledge，且不同渠道可能展示不同默认值或顺序，因此拒绝。

### 3. Make the rendered snapshot authoritative in the form aggregate

`HumanInputForm` 用 `resolved_form: ResolvedForm` 取代 `definition + rendered_content` 的并列状态。Action membership 从该 snapshot 读取，确保接受的 action 与展示给用户的 actions 一致。Input submission canonicalization 尚未在 v2 public transport 中实现，不在本变更中新增。

ORM 可以继续使用现有 `form_definition` JSON column 和 `rendered_content` text column，不要求 SQL DDL：mapper 把 title、blocks 和 actions 写入 JSON column，把 `ResolvedForm.legacy_form_content` 写入现有 `rendered_content` physical column，读取时重新组合 domain object。`display_in_ui` 等非展示 DSL metadata 保留在 aggregate/persistence projection 中，不加入 `ResolvedForm`。

仓库中尚无调用 `HumanInputV2FormCreationService` 的 production node execution path，HITL v2 public transports 也仍未实现，因此本变更按不存在需要跨版本读取的 production form records 处理，不设计 legacy dual-read schema。

### 4. Let IM adapters consume ordered blocks directly

`IMDynamicCardMessaging.assess` 和 `send_card` 直接接收 `ResolvedForm`。`NormalizedCardIntent` 不再作为另一个 runtime object；如迁移期间需要保留 import name，只允许使用 type alias，不增加 wrapper。

每个 adapter 按 `ResolvedForm.blocks` 顺序执行 provider capability assessment 和 serialization：

- `MarkdownText` 映射为 provider text/Markdown element。
- `ParagraphInput` 和 `SelectInput` 使用已经解析的 defaults/options。
- 不支持的 `FileInput` 或 `FileListInput` 产生完整 intent 的 unrepresentable assessment。
- provider-specific block count、text length、option count 和 action style 限制仍由 adapter 判断。
- provider 如果不能保持给定顺序，必须返回 unrepresentable；不得静默把所有 inputs 移到 Markdown 之后。
- unrepresentable assessment 只报告能力边界，不携带 delivery 决策。外层 orchestration 如需降级到 Web，应通过 `IMMessaging.send_text` 发送包含 Web URL 的文本消息，而不是调用 `replace_with_static`。

Correlation token 继续作为 `send_card` 的独立参数，不属于 form presentation snapshot。`replace_with_static` 和 `StaticCardIntent` 继续只负责替换已经成功发送且持有 `MessageReference` 的 dynamic card，与 unrepresentable handling 无关。

### 5. Preserve a future frontend migration path without changing Web now

本次不修改前端 renderer、Web DTO 或尚未完成的 HITL v2 public transport。未来前端迁移能力通过通用模型本身保证：

- `ResolvedForm` 不定义在 IM package 中。
- blocks 保留与当前前端 `$output` renderer 相同的原位顺序。
- persistence serialization 为 `MarkdownText` 和各 input variants 提供稳定 discriminator，未来 Web DTO 可以直接投影该 union。
- resolved defaults、options 和 file constraints 内聚在对应 input 中，未来前端不需要再次合并独立 mappings。

本变更不创建 compatibility projection；未来真正迁移前端时再根据 public API versioning 和 transport 约束设计 DTO。

## Risks / Trade-offs

- [Provider 无法表达任意交错顺序] → 由 whole-form capability assessment 明确拒绝；禁止静默重排，后续 delivery 决策留在本 capability 之外。
- [Resolved snapshot 会丢失 selector 和 authoring source] → 这是预期边界；authoring 配置由 workflow definition 保留，runtime form 只保存用户实际看到和能够提交的内容。
- [`legacy_form_content` 可能被误当成 v2 渲染来源] → API 和 tests 明确它仅属于 v1 compatibility，并断言 dynamic-card adapters 不读取该字段生成 typed content。
- [持久化 JSON shape 改变导致混合版本 worker 不兼容] → 当前 v2 尚无 production creation/transport path；首次启用该路径时所有 workers 必须使用相同 schema version。
- [通用模型可能被当前 IM 需求过度塑形] → common domain 不包含 provider-specific limits、callback metadata 或 provider element types，并以 ordered blocks 保留前端需要的表达能力。

## Migration Plan

1. 引入 common resolved-form dataclasses、serialization models 和 unit tests。
2. 引入 workflow compiler 及 Markdown/input/default resolution tests。
3. 将 form aggregate、creation service 和 repository mapper 切换为 `ResolvedForm`，保留现有 physical columns。
4. 修改 IM contracts，并依次迁移 Slack、Microsoft Teams、Feishu/Lark adapters 与 capability tests。
5. 将 action selection validation 改为读取 authoritative snapshot，并确认本变更未引入 Web/frontend dependencies。
6. 删除 adapter-local raw definition/default resolution helpers 和不再使用的 `FrozenFormDefinition` exports。

回滚不需要数据库 DDL 回退，但旧代码无法读取新 JSON shape。部署期间如果需要可回滚性，必须在写入新 shape 前先发布能够 dual-read 的兼容版本。

## Open Questions

无。
