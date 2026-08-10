## ADDED Requirements

### Requirement: 渠道无关的 resolved form snapshot
系统 MUST 使用不可变的 `ResolvedForm` 表达 HITL v2 表单的最终展示状态。该 snapshot MUST 包含可选 title、有序 `MarkdownText | Input` blocks、`user_actions` 和 `legacy_form_content`，并且 MUST 不包含 workflow selector、value-source discriminator、未解析的非输出 variable value 或 raw input mapping。通用 domain action 和 content 类型 MUST 分别命名为 `ResolvedFormAction` 和 `ResolvedFormContent`，不得暴露 `CardAction` 或 `CardContent` 等 IM/card 语义。生成的 `ResolvedForm` 代码 MUST 在 `legacy_form_content` 字段紧邻上方包含准确的 English comment：`# All non-output variables are resolved; {{#$output.<name>#}} slots remain.`

#### Scenario: Snapshot contains only resolved values
- **WHEN** 系统从包含 variable-backed paragraph default 和 select options 的 HITL v2 node 创建表单
- **THEN** `ResolvedForm` 包含最终 paragraph default 和具体 select option strings
- **AND** snapshot 不包含原 selector 或 variable source metadata

#### Scenario: Input variants expose stable output names
- **WHEN** compiler 为 paragraph、select、file 或 file-list slot 创建 input block
- **THEN** 对应 input 沿用上游 `output_variable_name` 标识提交值
- **AND** input 不包含未由当前 DSL 定义的 `required` 或 label 字段

#### Scenario: File inputs preserve constraint enums
- **WHEN** compiler 创建 `FileInput` 或 `FileListInput`
- **THEN** `allowed_file_types` 保存 immutable `FileType` enum tuple
- **AND** `allowed_file_upload_methods` 保存 immutable `FileTransferMethod` enum tuple
- **AND** domain model 不把 file types 或 upload methods 降级为 strings

#### Scenario: Actions preserve the upstream style enum
- **WHEN** compiler 创建 resolved user action
- **THEN** `button_style` 保存上游 `ButtonStyle` enum
- **AND** domain 和 persistence model 不把 action style 降级为 string

#### Scenario: Domain type names remain channel-neutral
- **WHEN** caller 从通用 Human Input v2 domain 导入 resolved form values
- **THEN** action 和 content union 分别通过 `ResolvedFormAction` 和 `ResolvedFormContent` 暴露
- **AND** 通用 domain 不导出 `CardAction` 或 `CardContent`

#### Scenario: Form content resolves non-output variables and preserves output slots
- **WHEN** authoring `form_content` 同时包含普通 workflow variable 和 `{{#$output.<name>#}}` slot
- **THEN** `ResolvedForm.legacy_form_content` 包含普通 variable 的最终替换值
- **AND** `{{#$output.<name>#}}` slot 保持原样

#### Scenario: Generated field includes the required semantic comment
- **WHEN** `ResolvedForm` domain code 被生成或实现
- **THEN** `legacy_form_content` 字段紧邻上方包含 `# All non-output variables are resolved; {{#$output.<name>#}} slots remain.`

### Requirement: 保持 Markdown 与 input 的原位顺序
系统 MUST 按 `{{#$output.<name>#}}` token 切割 `ResolvedForm.legacy_form_content`，将非 token fragments 表达为 `MarkdownText`，并将 tokens 表达为具体 input variants。具体 input MUST 直接出现在 blocks 中，不得增加 `InputBlock` wrapper。

#### Scenario: Interleaved content is compiled in source order
- **WHEN** `form_content` 在两个 Markdown fragments 之间包含一个有效 output token
- **THEN** `ResolvedForm.blocks` 按 `MarkdownText`、对应 input、`MarkdownText` 的顺序保存内容

#### Scenario: Consecutive inputs do not create an empty Markdown block
- **WHEN** 两个有效 output tokens 在 `form_content` 中直接相邻
- **THEN** blocks 中两个 inputs 直接相邻
- **AND** 系统不在它们之间插入空 `MarkdownText`

#### Scenario: Meaningful whitespace is preserved
- **WHEN** output token 之间的 Markdown fragment 非空但只包含空格或换行
- **THEN** 系统保留该 fragment 的原始文本

### Requirement: Form compilation resolves runtime presentation data once
workflow form compiler MUST 在创建 form snapshot 时完成普通 Markdown variable replacement、paragraph default resolution、select option/default resolution 和 file constraints normalization。任何下游 IM consumer MUST 不再执行 workflow variable lookup 或 value-source interpretation。

#### Scenario: Variable-backed paragraph default is resolved
- **WHEN** paragraph input default 引用一个可转换为文本的 runtime variable
- **THEN** `ParagraphInput.default_value` 保存最终字符串

#### Scenario: Variable-backed select options are resolved
- **WHEN** select option source 引用一个有效的 runtime string list
- **THEN** `SelectInput.options` 保存对应的 immutable string tuple

#### Scenario: Referenced input does not exist
- **WHEN** `form_content` 引用一个不存在对应 input config 的 output token
- **THEN** compiler 拒绝创建不完整的 `ResolvedForm`

#### Scenario: Unreferenced input is omitted
- **WHEN** input config 未被 `form_content` 中的 output token 引用
- **THEN** 该 input 不出现在 `ResolvedForm.blocks` 中

### Requirement: Rendered snapshot is authoritative for runtime behavior
HITL v2 form aggregate MUST 持有并持久化单一 authoritative `ResolvedForm`。异步 delivery 和 action membership validation MUST 使用该 snapshot，而不是重新读取 workflow variables 或重新解释 authoring definition。

#### Scenario: Runtime variables change after form creation
- **WHEN** form 创建后，其原始 workflow variables 发生变化
- **THEN** 后续 IM delivery 继续使用创建时冻结的 defaults、options 和 actions
- **AND** action membership validation 使用创建时冻结的 actions

#### Scenario: Legacy form content differs from blocks
- **WHEN** `legacy_form_content` 与 typed blocks 表达不一致
- **THEN** v2 dynamic rendering 和 validation 使用 blocks
- **AND** `legacy_form_content` 仅用于 v1 compatibility

### Requirement: IM adapters consume the resolved form contract
IM dynamic-card contracts MUST 接收 `ResolvedForm`，adapters MUST 按 blocks 顺序进行 provider capability assessment 和 serialization。Adapters MUST 不接收 `FrozenFormDefinition`，也 MUST 不解析 `$output` tokens、selectors、raw input mappings 或独立的 default-values mapping。

#### Scenario: Representable ordered form is rendered
- **WHEN** provider 支持 form 中的全部 block types、顺序和 provider-specific limits
- **THEN** adapter 按 `ResolvedForm.blocks` 的顺序生成 dynamic card elements

#### Scenario: Provider cannot preserve block order
- **WHEN** provider 无法保持 `ResolvedForm.blocks` 的给定顺序
- **THEN** whole-form assessment 返回 unrepresentable
- **AND** adapter 不得静默把 inputs 移动到 Markdown 之后

#### Scenario: Provider does not support file inputs
- **WHEN** form 包含 provider 不支持的 `FileInput` 或 `FileListInput`
- **THEN** whole-form assessment 返回 unrepresentable
