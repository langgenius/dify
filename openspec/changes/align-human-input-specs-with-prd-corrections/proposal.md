## Why

当前 Human Input 与 Contact 相关 spec 已经和更新后的 PRD 发生漂移。现有多份 spec 仍然保留旧规则，例如 `External Contact` 与内部 Contact 的邮箱冲突、`Dynamic Email` 自动升级为 Contact recipient、以及 legacy `whole_workspace` 的迁移语义，导致 contact governance、recipient resolution、migration 与 API contract 文档之间出现互相矛盾的要求。

这个偏差需要现在修正，因为受影响的多个 change 已经处于进行中状态。如果继续保留当前这种不一致状态，不同实现分支就会分别落地互不兼容的 contact admission、recipient authorization、migration 行为，以及 EE IM override 语义。

## What Changes

- Align contact uniqueness rules with the updated PRD:
  - allow an `External contact` to share a normalized email with a `workspace contact` or `Platform contact` in the same workspace
  - continue to reject duplicate normalized emails among `External contact` records inside the same workspace
  - preserve the rule that `workspace contact` and `Platform contact` cannot coexist as separate contacts for the same Dify identity
- 移除将 `Dynamic Email` 或 legacy email recipient 自动升级为 Contact recipient 的 spec 语义；`Dynamic Email` 必须始终解析为 task-scoped one-time email。
- 收紧 HITL node 的重复选择规则，使同一个 node 不能主动选择多个 normalized email 相同的 Contact，同时为迁移保留数据增加显式的 migration-only 例外。
- 引入并定义 `all workspace contacts` 作为迁移导向的 recipient 类型，用于实现 v1 的无损迁移，而不是继续把 `whole_workspace` 展开成有损静态快照。
- 澄清 EE IM binding 语义，使同一个 IM identity 可以在 organization binding 和 workspace override 场景中被复用，而不再隐含全局唯一的 `im_user_id -> Contact` 映射假设。
- 补充 PRD 中漏写的 IM card 规则：当对应 IM Provider 支持卡片状态更新时，卡片被处理后必须回写 IM 侧卡片状态。
- 将 console/runtime API contract、node editor 行为、migration helper 行为，以及相关术语统一到修正后的 PRD 规则。

## Capabilities

### New Capabilities

- `human-input-console-management-api`: Console 与 migration-helper contract 对齐修正后的 contact uniqueness、recipient migration 语义，以及 EE workspace override 规则。
- `human-input-im-card-status-sync`: IM card 在任务被处理后，按 provider capability 回写卡片状态的运行时 contract。
- `human-input-runtime-form-api`: Runtime API contract 保证 `Dynamic Email` 与 one-time email 始终走 email-proof 路径。
- `human-input-v2-node-editor`: V2 node editor 与 recipient 配置规则对齐同邮箱 Contact 去重和迁移保留例外。
- `human-input-v2-migration`: V1 到 V2 的迁移规则对齐 `all workspace contacts`、无损迁移和 imported duplicate recipient 保留语义。

### Modified Capabilities

- `human-input-v2-contact-directory-core`: 调整 `External Contact` 的 admission 与 collision 规则，允许其与内部 Contact 同邮箱共存，同时保留 workspace 内 `External Contact` 的唯一性。
- `human-input-v2-recipient-resolution-core`: 移除 `Dynamic Email -> Contact` 自动升级，并使 canonicalization 对齐 one-time email 语义与迁移例外。
- `human-input-v2-im-control-plane-core`: 澄清 IM identity 复用与 workspace override 语义，使 binding resolution 不再假设同一 IM identity 全局只属于一个 Contact。
- `human-input-v2-submission-runtime`: 使授权行为对齐修正后的 recipient 语义，并在 Contact 删除、重建或 binding 变化后继续保留正确的历史快照语义。

## Impact

- 受影响的 OpenSpec 领域包括：contact governance、contact management UI、node editor、migration UI、API contracts、IM card runtime 行为、EE admin adapter 文档，以及 archived/living core specs。
- 后续需要跟进的实现面包括：contact admission validation、recipient resolution、migration helper 行为、console DTO、runtime/public form 行为、IM card post-submit update，以及 EE override/binding workflow。
- 不引入新的外部依赖，但需要一次性协调多组正在进行中的 spec，避免后续实现工作建立在互相冲突的文档约束之上。
