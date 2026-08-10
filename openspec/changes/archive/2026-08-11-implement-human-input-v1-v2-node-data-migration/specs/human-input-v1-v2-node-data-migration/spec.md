## ADDED Requirements

### Requirement: Migration helper MUST accept an exact legacy batch boundary
系统 MUST 在 `POST /console/api/workspaces/current/human-input/node-data-migration` 接受 non-empty `nodes: [{ node_id, node_data }]` batch。每个 `node_id` MUST 在 request 内唯一；`node_data` 缺失 `version` 时 MUST 规范化为字符串 `"1"`，显式 version MUST 是精确字符串 `"1"`。request envelope、node envelope 和 legacy node data 中当前 helper 不消费的额外字段 MUST 被忽略。

#### Scenario: Missing legacy version is accepted
- **WHEN** 一个输入节点省略 `node_data.version`
- **THEN** helper MUST 将它按 version `"1"` 处理

#### Scenario: Exact legacy version is accepted
- **WHEN** 一个输入节点显式提供字符串 version `"1"`
- **THEN** helper MUST 允许该节点进入 conversion preflight

#### Scenario: Unsupported explicit version is rejected
- **WHEN** 一个输入节点显式提供 `"2"`、其他字符串或非字符串 version
- **THEN** 整个 request MUST 在产生任何成功 node data 前失败

#### Scenario: Unknown compatibility fields are ignored
- **WHEN** request、node envelope 或 legacy node data 包含当前 helper 不消费的额外字段
- **THEN** helper MUST 忽略这些字段且 MUST NOT 把它们无类型复制到 v2 output

#### Scenario: Duplicate node identifiers are rejected
- **WHEN** 同一 request 包含两个相同 `node_id`
- **THEN** 整个 request MUST 在 conversion 前失败且 MUST NOT 返回部分结果

### Requirement: Every legacy Email recipient MUST become normalized `onetime_email`
helper MUST 将 enabled Email delivery 中的每个合法 legacy Email source 转换为 `onetime_email`。Email identity MUST 在 trim 和 case-insensitive normalization 后用于 output 与 dedupe。helper MUST NOT 因该 Email 匹配任何 Account 或 Contact 而输出 Contact recipient。

#### Scenario: Arbitrary external Email is migrated
- **WHEN** 一个 legacy external recipient 包含合法 Email
- **THEN** helper MUST 输出一个使用规范化 Email 的 `onetime_email`

#### Scenario: Email matches a current Contact
- **WHEN** 一个 legacy Email 的规范化值与 Workspace、Platform 或 External Contact 相同
- **THEN** helper MUST 仍输出 `onetime_email`，MUST NOT 查询 Contact 以升级 recipient type

#### Scenario: Duplicate Email sources use first occurrence
- **WHEN** 多个 legacy source 在 trim 和 case-insensitive normalization 后表示同一 Email
- **THEN** helper MUST 只保留第一个 canonical `onetime_email` 位置

#### Scenario: Invalid external Email blocks its node
- **WHEN** 一个 legacy external recipient 不包含合法 Email
- **THEN** helper MUST 为该 source 返回 `invalid-email` blocker

### Requirement: Legacy member references MUST use one tenant-scoped Email snapshot
helper MUST 先收集整个 batch 中的 legacy member references，再通过一次只读、当前 workspace 限定的 lookup 建立 request-local member Email mapping。成功解析的 member Email MUST 走与 external Email 相同的 `onetime_email` normalization；helper MUST NOT 把 member reference 转换为 Contact recipient。

#### Scenario: Current workspace member is resolved
- **WHEN** 一个 legacy member reference 指向当前 workspace 中可用且具有合法 Email 的 Account
- **THEN** helper MUST 从 request-local mapping 取得 Email 并输出 `onetime_email`

#### Scenario: Referenced member is unavailable
- **WHEN** legacy member reference 不属于当前 workspace、Account 不可用、Email 为空或 Email 非法
- **THEN** helper MUST 为该 source 返回 `unresolved-member` blocker

#### Scenario: Cross-workspace Account is not resolved by identifier
- **WHEN** 一个 Account ID 存在但不在当前 workspace membership scope 内
- **THEN** helper MUST NOT 使用该 Account Email，并 MUST 返回 `unresolved-member`

#### Scenario: All nodes share one lookup snapshot
- **WHEN** 一个 batch 的多个节点引用相同或不同 member IDs
- **THEN** helper MUST 只从一个 request-local lookup result 转换全部节点，MUST NOT 在逐节点或逐 recipient 转换时重新读取数据库

### Requirement: Migration MUST NOT read or mutate Contact state
helper MUST NOT list、match、create、update 或 delete Workspace、Platform 或 External Contact。Contact Directory 内容及其变化 MUST NOT 改变相同 legacy Email batch 的转换结果。

#### Scenario: No matching Contact exists
- **WHEN** 一个合法 legacy Email 不匹配任何当前 Contact
- **THEN** helper MUST 输出 `onetime_email` 且 MUST NOT 创建 External Contact

#### Scenario: Matching Contact exists
- **WHEN** 相同 legacy Email 匹配一个或多个当前 Contact
- **THEN** helper MUST 输出与无匹配 Contact 时相同的 `onetime_email`

#### Scenario: Migration runs with a write-observing repository harness
- **WHEN** service 转换任意成功或失败 batch
- **THEN** Contact write count MUST 为零且 Contact lookup MUST 未被调用

### Requirement: Legacy whole-workspace intent MUST become one explicit marker
enabled Email configuration 的 legacy `whole_workspace: true` MUST 转换为 recipient value `{"type": "all_workspace_contacts"}`。helper MUST NOT 把该 intent 展开为当前成员或 Contact 静态列表，并 MUST NOT 因该 marker 执行 workspace member enumeration。

#### Scenario: Whole workspace is the only Email recipient
- **WHEN** 一个 enabled Email method 设置 `whole_workspace: true` 且没有 item recipients
- **THEN** helper MUST 成功输出一个 `all_workspace_contacts` marker

#### Scenario: Multiple methods request whole workspace
- **WHEN** 同一节点的多个 enabled Email methods 设置 `whole_workspace: true`
- **THEN** output MUST 按 first occurrence 只包含一个 `all_workspace_contacts` marker

#### Scenario: Whole workspace does not enumerate members
- **WHEN** helper 转换包含 `whole_workspace: true` 的节点
- **THEN** member lookup MUST NOT 因该 flag 加载整个 workspace member set

### Requirement: Migration-produced compatibility overlaps MUST be preserved
`all_workspace_contacts`、`initiator` 和显式 `onetime_email` MUST 作为不同 canonical kinds 处理。只要每个单独 recipient 有效，helper MUST NOT 因 marker 当前可能覆盖某个 Email 或 initiator 而删除、合并或拒绝它们。

#### Scenario: Marker overlaps a current member Email
- **WHEN** 一个 legacy node 同时包含 `whole_workspace: true` 和解析为当前 workspace member Email 的显式 recipient
- **THEN** output MUST 同时保留 `all_workspace_contacts` 与对应 `onetime_email`

#### Scenario: Marker is combined with WebApp
- **WHEN** 一个 legacy node 同时启用 WebApp 和 whole-workspace Email
- **THEN** output MUST 同时保留 `initiator` 与 `all_workspace_contacts`

#### Scenario: Duplicate markers do not erase other recipients
- **WHEN** marker 自身被 canonical dedupe 且节点还包含其他有效 recipient kinds
- **THEN** helper MUST 只移除重复 marker，MUST 保留其他 recipient 的 source order

### Requirement: Enabled delivery methods MUST map deterministically to v2 fields
helper MUST 按 legacy delivery method 与 recipient source order 构造 v2 fields。enabled WebApp MUST 产生 `initiator`。enabled Email MUST 提供 non-blank `subject` 和 `body`；多个 enabled Email methods 的 template 必须完全相同。任一 enabled Email debug flag 为 true 时，v2 debug mode MUST 只启用 `email` channel。

#### Scenario: WebApp maps to initiator
- **WHEN** 一个或多个 WebApp methods 被启用
- **THEN** output MUST 在首次出现位置包含且仅包含一个 `initiator`

#### Scenario: Email template is preserved exactly
- **WHEN** 所有 enabled Email methods 具有相同的 non-blank `subject` 和 `body`
- **THEN** output `message_template` MUST 原样保留该 subject 和 body，包括有意义的边界 whitespace

#### Scenario: Node has no enabled Email method
- **WHEN** 节点仅通过 enabled WebApp 获得有效 recipient
- **THEN** output MUST 使用空 `message_template` 且 disabled empty-channel `debug_mode`

#### Scenario: Any Email debug flag enables Email debug
- **WHEN** 至少一个 enabled Email method 设置 legacy `debug_mode: true`
- **THEN** output MUST 使用 `debug_mode.enabled: true` 且 channels MUST 精确为 `["email"]`

### Requirement: Shared Human Input node fields MUST survive typed conversion
成功 output MUST 强制 `type: human-input` 和 version `"2"`，MUST 删除 legacy `delivery_methods`，并 MUST 通过 typed v2 model 保留 title、form content、inputs、user actions、timeout、timeout unit 及其他由共享 Human Input model 明确定义的字段。

#### Scenario: Complete shared node data is migrated
- **WHEN** 一个合法 legacy node 包含非默认共享 Human Input fields
- **THEN** output MUST 保留这些 typed field values，并只用 `recipients_spec`、`message_template` 和 `debug_mode` 替换 delivery configuration

#### Scenario: Output is validated as v2 data
- **WHEN** converter 为一个节点生成成功结果
- **THEN** result MUST 通过包含 migration-only marker representation 的 typed v2 migration output model validation

### Requirement: Lossy or unsupported delivery configuration MUST produce stable blockers
helper MUST 使用稳定 blocker taxonomy 报告不能无损转换的有效 request。blocker MUST 包含 `node_id` 和 `node_title`，并在适用时包含 `method_id` 与最小化 safe `value`。

#### Scenario: Disabled method retains material configuration
- **WHEN** 一个 disabled delivery method 包含若静默丢弃会损失的 recipient、template 或 debug configuration
- **THEN** helper MUST 返回 `configured-disabled-method`

#### Scenario: Enabled delivery method is unsupported
- **WHEN** 一个 enabled method 不是 WebApp 或 Email
- **THEN** helper MUST 返回 `unsupported-delivery-method`

#### Scenario: Email configuration is incomplete
- **WHEN** enabled Email method 的 subject 或 body 缺失、类型错误或仅为空白
- **THEN** helper MUST 返回 `invalid-email-configuration`

#### Scenario: Email templates conflict
- **WHEN** 同一节点的 enabled Email methods 具有不完全相同的 subject 或 body
- **THEN** helper MUST 返回 `conflicting-email-templates`

#### Scenario: No valid recipient path remains
- **WHEN** 一个节点不能产生 `initiator`、`onetime_email` 或 `all_workspace_contacts`
- **THEN** helper MUST 返回 `missing-recipients`

### Requirement: Batch conversion MUST aggregate blockers and remain all-or-error
service MUST preflight request 中的全部节点。blockers MUST 按 node order、delivery method order、recipient order 和 node-level validation order 确定性排序。任一 blocker 存在时，failure response MUST NOT 包含任何成功节点的 v2 node data。

#### Scenario: Multiple nodes contain blockers
- **WHEN** 同一 batch 的多个节点分别包含一个或多个 migration blockers
- **THEN** `400 Bad Request` response MUST 包含所有 node-scoped blockers 且 MUST NOT 包含 `data`

#### Scenario: One node fails among valid nodes
- **WHEN** batch 中至少一个节点失败而其他节点可成功转换
- **THEN** helper MUST 丢弃内部成功结果并返回 whole-batch failure

#### Scenario: Entire batch succeeds
- **WHEN** 每个输入节点都可生成完整 v2 output
- **THEN** success response MUST 按输入顺序为每个 `node_id` 返回且仅返回一个 result

### Requirement: Repeated conversion MUST be deterministic and side-effect-free
相同 ordered input 与相同 request-local member Email snapshot MUST 产生等价 success output 或等价 ordered blockers。helper MUST NOT 写入 workflow DSL、Draft、Published workflow、graph state、Contact、task snapshot 或 migration history，也 MUST NOT `commit` 或 `flush` 数据库 session。

#### Scenario: Successful batch is retried
- **WHEN** 调用方在 member Email state 未变化时重复提交同一 ordered batch
- **THEN** helper MUST 返回 byte-equivalent semantic node data ordering 且 MUST NOT 创建 migration state

#### Scenario: Failed batch is retried
- **WHEN** 调用方在 member Email state 未变化时重复提交同一 failing batch
- **THEN** helper MUST 返回等价且顺序相同的 blockers 且 MUST NOT 修改任何持久化状态

#### Scenario: Dry run is compared with a normal call
- **WHEN** 调用方把一次普通 helper 调用视作 dry run
- **THEN** 该调用 MUST 已具有完整真实转换语义，因为 endpoint 本身没有持久化 mutation

### Requirement: Workspace endpoint MUST preserve authentication and scope boundaries
endpoint MUST 保留 setup、login、account initialization、workflow edit permission 和 current workspace scope enforcement。controller MUST 只做 transport mapping，MUST NOT 构造 ORM query、Contact resolution 或 workflow mutation。

#### Scenario: Authorized editor converts a valid batch
- **WHEN** 具有当前 workspace edit permission 的已认证用户提交合法 batch
- **THEN** endpoint MUST 返回 `200 OK` 和 `data: [{ node_id, node_data }]`

#### Scenario: Authorized editor submits a blocked batch
- **WHEN** 具有权限的用户提交包含 migration blocker 的 batch
- **THEN** endpoint MUST 返回 `400 Bad Request` 和 `hitl_node_data_migration_failure` body，其中包含 `blockers` 且不包含部分 `data`

#### Scenario: Caller lacks edit permission
- **WHEN** 已认证 caller 不具有当前 workspace workflow edit permission
- **THEN** endpoint MUST 在调用 migration service 前拒绝 request

#### Scenario: Lookup attempts cross-workspace access
- **WHEN** request 中的 member reference 只能在其他 workspace 找到
- **THEN** tenant-scoped lookup MUST 将其视为 unresolved，MUST NOT 泄露跨 workspace Email
