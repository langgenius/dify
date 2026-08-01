## Context

当前 Human Input 规划集同时覆盖了 `openspec/specs/` 下的 living core specs，以及 `openspec/changes/` 下多组仍在进行中的 change-local specs。更新后的 PRD 修正了 contact uniqueness、`Dynamic Email` 解析、同邮箱 Contact 选择、migration 语义，以及 EE IM override 规则，但当前 spec 集合在多个层面仍然保留旧假设。

最关键的漂移是跨层的：

- contact governance 和 contact creation 相关 spec 仍然拒绝 `External Contact` 与内部 Contact 同邮箱
- recipient resolution 相关 spec 仍然把 `Dynamic Email` 升级为 Contact recipient
- migration spec 和 console migration-helper contract 仍然把 `whole_workspace` 当作有损静态展开
- node editor spec 还没有为 migration-only 的 `all workspace contacts` 和 preserved duplicate 例外定义明确语义
- 某些 UI spec 仍然把 `Organization` 当作 Contact 类型标签，而 PRD 已统一为 `Platform Contact`
- 当前 planning set 还缺少一个明确规则：当 IM Provider 支持卡片状态更新时，卡片处理完成后需要回写 IM 侧卡片状态

由于多个相关 change 已经在并行推进，这不是一个单文件纠错问题。这个设计需要定义如何把同一套修正后的规则一次性同步到 core domain specs、UI specs、runtime/API contract specs 和 EE adapter 文档里，而不是留下一部分旧约束继续误导实现。

## Goals / Non-Goals

**Goals:**

- 建立一套和修正后 PRD 一致的规则，用于定义 `External Contact` admission、`Dynamic Email` 处理、node 级重复选择限制、migration 语义，以及 EE IM identity 复用。
- 为支持该能力的 IM Provider 增补卡片处理后的状态回写语义。
- 同时修正当前仍然编码旧规则的 living core specs 和 in-progress change-local specs。
- 引入显式的 `all workspace contacts` recipient 模型，用于 migration-time 的无损保留。
- 保持 runtime authorization 与 IM binding 语义和修正后的 recipient/contact 规则一致。
- 产出 implementation-ready 的 planning artifacts，明确未来改 spec 时哪些 requirement 家族必须联动更新。

**Non-Goals:**

- 在这个 change 中实现代码、schema 或 runtime 行为变更。
- 超出当前 PRD 更正范围去重做 Human Input 设计。
- 重构与本次更正无关的 form rendering、delivery retry、message template authoring 或 debug mode UX。
- 在 migration 兼容性之外引入新的通用 recipient authoring 能力。
- 为所有 IM Provider 强制引入统一卡片状态回写要求，不考虑 capability 差异。

## Decisions

### 1. Treat the corrected PRD as the single source of truth across all spec layers

这个 change 会统一修正所有过时的 spec 语义，而不是为了“兼容旧文档”在部分文档里保留旧行为。提出这个 change 的原因就是当前状态已经内在矛盾；如果继续让某些 spec 保留“旧规则”，这些矛盾就会被持续传播。

Alternatives considered:

- Update only the most recent in-progress change specs.
  Rejected because archived/living core specs would still contradict those changes and mislead future work.
- Update only the living core specs.
  Rejected because active implementation-facing specs and contracts would still carry the wrong rules.

### 2. Split the correction into four rule clusters and update every affected spec through those clusters

这个 change 按四组规则组织：

1. contact admission and uniqueness
2. recipient resolution and authorization
3. migration semantics and imported-data exceptions
4. EE IM binding and workspace override scope

这样可以让设计以行为规则为中心，而不是按文件零散修补，同时又能让 tasks 明确回映到审阅中已经识别出的具体 spec 文件。

Alternatives considered:

- Patch each conflicting file independently.
  Rejected because the same rule appears in multiple domains and would likely drift again.

### 3. Dynamic Email remains a one-time email path and never upgrades into a Contact path

修正后的 PRD 已经明确移除了自动升级行为。因此这个设计将 `Dynamic Email` 统一定义为只生成 task-scoped one-time email recipient，并且只走 email-proof runtime 语义。任何把 `Dynamic Email` 升级成 Contact-backed authorization 或 IM delivery 的 spec 都必须被改写。

Alternatives considered:

- Keep upgrade behavior in runtime/domain specs but remove it only from UI docs.
  Rejected because it would preserve a hidden behavioral mismatch.

### 4. `all workspace contacts` is a migration-only compatibility construct, not a lossy expansion

修正后的 PRD 要求 legacy `whole_workspace` 具备无损迁移路径。因此这里把 `all workspace contacts` 定义为一个显式 recipient 概念，用来保留迁移后的原始意图。同时也为 imported migrated duplicates 创建显式例外路径，否则这些数据会和当前 authoring 规则直接冲突。

Alternatives considered:

- Continue expanding `whole_workspace` into a request-time or migration-time static list.
  Rejected because the PRD now calls for lossless migration and preserved duplicate coexistence.
- Allow `all workspace contacts` as a normal authoring feature immediately.
  Rejected because the current requirement is migration compatibility, not a general expansion of authoring scope.

### 5. Node-level duplicate prevention applies to active manual selection, with imported migration exceptions preserved explicitly

手动 authoring 仍然必须阻止在同一个 node 中选择多个 normalized email 相同的 Contact。与此同时，imported migrated DSL 可能会因为 `all workspace contacts` 与具体 Contact 或同邮箱 `External Contact` 重叠而保留重复项。这个设计选择把这些场景保留为 compatibility state，并保持 round-trip，而不是静默归一化掉。

Alternatives considered:

- Apply one universal duplicate rule to both manual authoring and imported migration data.
  Rejected because it would make lossless migration impossible.

### 6. IM identity reuse must be modeled as workspace-scoped resolution, not global uniqueness

修正后的 PRD 允许同一个 IM identity 同时出现在 organization-level binding 和不同 workspace 的 override 中。因此这里把 effective binding resolution 明确定义为 workspace-scoped 和 task-context-scoped，而不是继续依赖任何隐含的全局 `im_user_id -> Contact` 唯一性假设。

这里还需要明确一道职责边界：IM control-plane 只回答“当前有效 IM binding 是谁，或者当前没有有效 IM binding”，而 `Email fallback`、双发策略和无 IM binding 时是否仍可通知，则继续留在 recipient resolution / delivery policy 层定义。

Alternatives considered:

- Preserve a globally unique reverse-mapping assumption for simplicity.
  Rejected because it directly conflicts with the EE override rules in the corrected PRD.

### 7. Terminology must be normalized together with behavior

凡是仍把 `Organization` 作为 Contact 类型标签的 spec，这次都会统一对齐到 `Platform Contact`，除非该文档讨论的确实是 ownership boundary。这里把术语漂移视为 spec correctness 问题，因为它会直接改变读者对 requirement 的理解。

### 8. IM card status update is a capability-gated post-processing side effect

修正后的 PRD 还缺少一个显式规则：当 IM Provider 支持卡片状态更新时，卡片一旦被处理完成，系统必须回写 IM 侧卡片状态。这里把它定义为 capability-gated 的 post-processing side effect，而不是通用前提。也就是说：

- 只有 provider 明确支持 card-status update，才要求执行这一步
- 状态回写发生在任务处理决议已经成立之后，不能替代授权或提交本身
- 不支持该能力的 provider 可以保持现状，但不能因为不支持而阻塞任务处理

Alternatives considered:

- 把卡片状态更新视为所有 IM Provider 的统一硬性要求。
  Rejected because provider capability clearly differs and the PRD wording is conditional.
- 把卡片状态更新完全视为实现细节，不进入 spec。
  Rejected because这是明确的产品规则，会影响交互完成态与 provider contract。

### 9. Inbox event record retains `raw_payload` as part of the same atomic event write

这里既然已经采用 Inbox pattern，就需要把收到时的原始 payload 保留下来用于 debug 和排障。但这个需求只收敛成一个最小字段：`raw_payload`。它直接存放在 event record 上，并和 event 的其他字段一起原子写入；不引入额外的 hash、旁路 blob、或单独写入路径。

同时需要明确边界：

- `raw_payload` 只用于 debug / 排障
- `raw_payload` 不参与 dedupe、routing、authorization 或业务判定
- 不存在“event 已写入但 `raw_payload` 单独写入失败”的独立状态

Alternatives considered:

- 只存 `payload_hash` 或其他摘要字段。
  Rejected because摘要不足以支撑真实集成排障。
- 把 `raw_payload` 放到独立写入路径。
  Rejected because当前要求就是它作为 event record 的一部分原子持久化。

## Risks / Trade-offs

- [Risk] 只更新部分冲突 spec 会留下隐性矛盾。 → Mitigation: tasks 会按规则簇分组修改，并在同一轮覆盖 core specs 和 active change-local specs。
- [Risk] 引入 `all workspace contacts` 可能无意间扩大产品范围。 → Mitigation: 设计明确把它限制为 migration compatibility construct，除非未来 change 显式扩展 authoring 支持。
- [Risk] 已有实现工作可能已经依赖旧规则。 → Mitigation: tasks 会点名当前仍编码旧行为的 spec 家族，后续实现必须按新 contract 复核。
- [Risk] contact uniqueness 语义会分别影响 admission、migration 和 runtime interpretation。 → Mitigation: 设计明确区分 directory admission 规则、node authoring 规则和 runtime authorization 规则，而不是强行用一个过度简化的唯一性模型覆盖全部场景。
- [Risk] IM identity reuse 规则在部分 adapter 文档中可能仍然不够具体。 → Mitigation: 本 change 会把 EE/admin-facing contract 对齐到同一套 workspace-scoped resolution 语义，并把剩余未知项显式记录为 open questions。
- [Risk] IM card 状态回写可能和提交事务边界耦合不清。 → Mitigation: 设计把它定义为处理决议成立后的 capability-gated side effect，而不是授权成功的组成部分。
- [Risk] 保留原始 payload 会扩大 event record 的存储体积。 → Mitigation: 当前先把 `raw_payload` 限定为最小 debug 字段，不额外扩展更多派生 debug 字段。

## Migration Plan

1. 为每个受影响 capability 添加 delta spec，并把修正后的 PRD 规则作为唯一目标行为。
2. 先更新 core capability 的 planning artifacts，再同步修正当前与之冲突的 active change-local contract 和 UI capability。
3. 校验最终 task plan 是否同时覆盖 living specs 和 in-progress change specs，尤其是：
   - contact admission 与 directory 语义
   - recipient resolution 与 runtime auth 语义
   - migration helper 与 node editor 语义
   - IM card post-processing status-update 语义
   - EE IM binding 与 override 语义
4. 这是一个 planning-only change，不涉及部署或回滚；但后续实现需要把当前 in-progress 分支视为可能已经相对新 contract 过时的工作基线。

## Open Questions

- `all workspace contacts` 是否应永久保持 migration-only，还是未来需要单独 change 把它开放成一等可编辑 recipient 类型？
- 迁移后 imported duplicate recipient 在 UI 中应该如何呈现：仅警告、阻止 publish，还是用 compatibility banner 加定向说明？
- 在 migration 之外，是否需要为“Contact recipient 与 one-time email 共用同一个 normalized email”补充显式 spec scenario，还是当前 endpoint-level deduplication 已经足够？
- IM card 状态回写在 provider 支持时，最小需要覆盖哪些处理终态：仅成功提交，还是也包含 reject、timeout、expired 等终态？
