## Context

Human Input v2 的前端批量迁移流程、Workspace Console request/response DTO 和 route scaffold 已存在，但 `NodeDataMigrationAPI` 仍返回 `501`。前端当前使用的 mock converter 会把命中 Contact 的 Email 自动升级为 Contact recipient，并把 `whole_workspace` 展开成当前成员静态列表；这两点都与修订后的 PRD 和 WTA-1288 相反。

WTA-1288 的边界已经收窄为一个只读、无持久化副作用的 v1 → v2 node-data helper。它必须把 legacy external Email 和 legacy member reference 最终都转换成 `onetime_email`，并把 `whole_workspace: true` 表达成显式 `all_workspace_contacts` marker。它不创建 Contact，不使用 Contact 目录做匹配，也不更新 workflow。

现有 Linear `blocked-by` 关系并不构成该 helper 的编码前置：

- WTA-1272 的 v2 runtime resolver 负责运行时 Contact-centric resolution，不应被 legacy converter 复用，因为它会改变 Email-to-Contact 语义。
- WTA-1273 的 task snapshot 和 resolution records 位于 runtime task 创建之后，与无副作用 node-data conversion 无直接依赖。

但是 `all_workspace_contacts` 被写入 Draft 后，editor round-trip 和 runtime resolution 必须能够识别它。因此 WTA-1272 及相邻前端 change 是发布启用依赖，而不是本 change 的 converter 实现依赖。

## Goals / Non-Goals

**Goals:**

- 为 Workspace Console 提供确定性、all-or-error 的 batch node-data migration helper。
- 使用只读、tenant-scoped member Email snapshot 解析 legacy member reference。
- 将全部 legacy Email 目标规范化为 `onetime_email`，不读取或写入 Contact。
- 无损保留 `whole_workspace` 意图和 migration-produced compatibility overlap。
- 为每个失败节点返回稳定、可测试的 structured blocker，同时不返回部分转换结果。
- 让 controller、application service、pure converter 和数据库读取边界保持清晰且可独立单测。

**Non-Goals:**

- 不修改 Draft、Published workflow、graph、migration history 或运行中 task snapshot。
- 不创建、更新、删除或自动初始化任何 Contact。
- 不实现 v2 runtime recipient resolution、allowed approver、delivery 或 resolution records。
- 不实现前端 generated-client 接入、graph replacement、draft sync、rollback 或 UI feedback。
- 不处理 workflow import/export 或 DSL ID-Email portability conversion。
- 不把本 helper 扩展成通用 migration framework 或持久化 dry-run job。

## Decisions

### 1. 采用 thin controller、application service、pure converter 和只读 lookup port

调用链固定为：

```text
NodeDataMigrationAPI
  -> HumanInputNodeDataMigrationService
       -> WorkspaceMemberEmailLookup
       -> convert_legacy_human_input_node_data
  -> NodeDataMigrationResponse | NodeDataMigrationFailureResponse
```

- `NodeDataMigrationAPI` 只负责认证后的 payload validation、service 调用和 HTTP mapping，不直接查询 ORM 或包含转换规则。
- `HumanInputNodeDataMigrationService` 负责 batch preflight、一次性 member lookup、遍历全部节点、聚合 blockers 和 all-or-error 决策。
- pure converter 只接收 legacy node value 和不可变的 member Email mapping，返回完整 v2 value 或有序 blockers；它不导入 Flask、SQLAlchemy、repository 或 Contact domain。
- `WorkspaceMemberEmailLookup` 只暴露按当前 `workspace_id` 和一组 Account IDs 批量读取有效 Email 的能力。SQL adapter 使用 `TenantAccountJoin` 与 `Account` 完整限定 workspace ownership，并把结果复制成 request-local mapping 后立即关闭 read session。

放弃直接复用 WTA-1272 recipient resolver。该 resolver 的运行时职责包含 Contact matching、dynamic values、delivery capability 和 approver dedupe；把它用于迁移会引入错误的 Contact 自动升级语义和不必要的 rollout coupling。

### 2. 每个 request 只建立一个稳定 member Email snapshot

service 先按 request node、delivery method 和 recipient 的出现顺序收集去重后的 legacy member IDs，再执行一次 tenant-scoped batch lookup。converter 在整个 request 内只读取这份不可变 mapping，不在逐节点或逐 recipient 转换时访问数据库。

lookup 只返回仍属于当前 workspace、Account 状态允许使用且 Email 有效的记录。缺失 membership、不可用 Account、空 Email 或非法 Email 均表现为对应 source recipient 的 `unresolved-member` blocker。`whole_workspace` 不触发成员枚举，因为它直接转换为 marker。

这比为整个 Contact Directory 建快照更小，也足以保证同一 request 的一致性。它不打开显式写事务；如果 Account 在 lookup 完成后变化，本次转换仍使用已经冻结的 request-local value。

### 3. 所有 legacy Email source 统一输出规范化 `onetime_email`

legacy external Email 直接验证并规范化；legacy member reference 先从 request-local mapping 取得 Email，再走同一规范化路径。规范化使用 trim 和 case-insensitive canonical form，输出值与 dedupe key 使用同一结果。

converter 不查询 Contact，也不根据 Email 是否匹配 Workspace、Platform 或 External Contact 改变 recipient type。这样可保证相同 legacy Email 在不同 Contact Directory 状态下得到相同结果，并满足无副作用与可重复性要求。

普通 recipient 使用 canonical key 做 first-occurrence-wins 去重：`initiator` 按类型去重，`onetime_email` 按规范化 Email 去重，`all_workspace_contacts` 按 marker 类型去重。不同 canonical kind 之间不互相消除。

### 4. `whole_workspace` 使用显式 migration-only marker，不做静态展开

v2 migration output 增加无 payload 字段的 recipient value：`{"type": "all_workspace_contacts"}`。一个节点中无论有多少 enabled Email method 声明 `whole_workspace`，输出最多保留第一个 marker。

marker 与显式 `onetime_email` 或 `initiator` 是不同 canonical kind。即使某个 Email 当前属于 workspace member，converter 也必须同时保留 marker 和该 Email；这是 migration-produced compatibility overlap，不适用 manual authoring 的 overlap rejection 或 Contact-centric dedupe。

该 marker 必须有 typed Pydantic representation，成功响应不能退化为未验证的 `dict[str, Any]`。它需要进入 v2 workflow recipient schema 后，才能让 migration response 保持完整的 v2 node-data contract。runtime adapter 如何把 marker 解析成当前 workspace Contact 集合由 WTA-1272 或其明确 successor 所有；本 change 不复制该解析逻辑。

### 5. 按 source order 转换 delivery methods，并明确字段映射

converter 按 legacy `delivery_methods` 顺序处理：

- enabled WebApp 产生一个 `initiator`；多个 enabled WebApp 按 first occurrence 去重。
- enabled Email 按 `recipients.items` 顺序添加 `onetime_email`，随后在该 method 的 `whole_workspace: true` 位置添加 marker。
- 多个 enabled Email method 允许合并 recipients，但其 `subject` 和 `body` 必须完全一致，否则返回 `conflicting-email-templates`。
- Email `subject` 与 `body` 必须是 non-blank string，成功时原样保留，不 trim template whitespace。
- 任一 enabled Email method 的 `debug_mode` 为 true 时，v2 `debug_mode` 为 `enabled: true` 且 channels 仅包含 `email`；否则为 disabled empty channels。
- 没有 enabled Email method 时，`message_template` 使用空 subject/body；enabled WebApp 仍可单独构成有效 recipient。
- v1/v2 共享字段由 typed model 显式复制，输出强制 `type: human-input`、`version: "2"` 并移除 `delivery_methods`。未知 legacy extension fields 按现有 migration DTO contract 忽略，而不是无类型透传。

disabled Email method 若带有可观察配置，静默丢弃会造成数据损失，因此返回 `configured-disabled-method`。enabled IM 或未知 delivery type 返回 `unsupported-delivery-method`。本 change 不猜测这些 channel 的 v2 等价语义。

### 6. 聚合全部 blockers，但 batch response 严格 all-or-error

service 不在第一个失败处短路。它处理完整批次并按以下稳定顺序聚合 blockers：request node order、delivery method order、recipient order，最后追加 template conflict 和 missing-recipient 等 node-level blocker。

blocker 使用现有 taxonomy：

- `unsupported-version`
- `configured-disabled-method`
- `unsupported-delivery-method`
- `invalid-email-configuration`
- `invalid-email`
- `unresolved-member`
- `conflicting-email-templates`
- `missing-recipients`

每个 blocker 包含 `node_id`、`node_title`，并在适用时包含 `method_id` 和经过最小化的 safe `value`。只要存在一个 blocker，service 丢弃所有内部成功结果并返回 failure value；controller 映射为 `400 Bad Request`，body 不包含 `data`。全部成功时，response 对每个输入 `node_id` 返回且仅返回一个结果，顺序与 request 相同。

payload envelope、空 batch、重复 `node_id` 和不能构成 migration DTO 的结构错误仍由 Pydantic request validation 在 service 之前拒绝。缺失 `version` 继续规范化为字符串 `"1"`，其他显式 version 在转换前拒绝；所有这些路径都不得产生部分 node data。

### 7. endpoint 本身不区分 dry run 与真实调用

helper 不接受 `dry_run` 或 `confirmed`。每次调用都只执行读取和纯转换，因此真实调用与 dry run 在相同输入和相同 member snapshot 下语义相同。用户确认、Draft mutation 与 rollback 都在前端 migration flow 中完成。

service 和 lookup adapter 不调用 `commit`、`flush` 或任何 Contact repository。controller 保留现有 setup、login、account initialization、edit permission 和 current-tenant decorators，避免扩大 endpoint 权限面。

### 8. 本 change 接管 backend conversion ownership

`human-input-v2-api-contracts` 的 tasks 4.1 和 4.2 仍描述旧的 Contact-aware、`whole_workspace` 静态展开实现。本 change 是修订后 backend node-data converter 的单一 owner；实施时必须把旧 tasks 标为 superseded 或明确引用本 change，避免两套 service 并行实现。

`add-human-input-v2-migration-ui` 在 generated client 可用后删除 mock converter，并只消费本 endpoint；这项 frontend wiring 不属于本 change。`align-human-input-specs-with-prd-corrections` 继续拥有跨 capability 的 PRD 修正规格，而本 change 提供具体 backend implementation plan。

## Risks / Trade-offs

- [Canonical v2 recipient schema 在 runtime 之前出现新 marker] → 将 `all_workspace_contacts` 的 editor round-trip 和 runtime resolution 设为 merge/rollout gate；在 companion support 未验证前不得启用真实 migration client。
- [Account Email 在请求期间变化] → 所有 legacy member IDs 一次批量读取并复制成 request-local immutable mapping；同一请求不重复查询。
- [规范化改变 Email 原始大小写或空白] → 只规范化 recipient identity value，不改 message template；使用与 Human Input v2 identity matching 一致的 case-insensitive canonical form，并用 golden tests 固定输出。
- [多个 Email method 的模板无法无损合并] → 不选择任意模板，返回 `conflicting-email-templates`，让用户先手工消解。
- [聚合 blockers 增加少量 CPU] → batch 规模受 editor 中 legacy node 数限制，完整诊断带来的可操作性优先于 fail-fast。
- [与 active OpenSpec changes 重叠] → 在 tasks 中显式更新 ownership/supersession，并以本 change 的 corrected mapping tests 作为 backend converter 的唯一验收证据。

## Migration Plan

1. 先落 typed marker 和 converter contract tests，但不启用前端真实 client。
2. 实现 pure converter、member lookup port/adapter、application service 和 controller mapping。
3. 运行 DTO、converter、service 与 controller targeted tests，证明无 Contact query/write 和无 workflow persistence。
4. 与 WTA-1272 及前端 correction change 做 contract check，确认 `all_workspace_contacts` 可 parse、round-trip 和 runtime resolve。
5. 只有在上述 rollout gate 满足后，前端才移除 mock converter 并调用真实 endpoint。

本 change 没有数据库 migration，也没有持久化状态，因此 backend rollback 是恢复 controller stub/wiring 或关闭调用方接入；已保存的 migrated Draft 不由本 helper 自动回滚，仍由调用方 draft history/rollback 机制负责。

## Open Questions

当前没有阻碍 converter 实现的产品或技术问题。Linear 中 WTA-1272/WTA-1273 的关系是否删除属于项目管理动作；建议把 WTA-1272 改为 rollout coordination，把 WTA-1273 的 `blocked-by` 删除。
