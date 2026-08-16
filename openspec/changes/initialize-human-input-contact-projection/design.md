## Context

Human Input Contact schema 已存在，但已有 Account/member 尚未形成 source-backed Contact baseline。Ongoing Account/member write-through 和 periodic repair 已由 `implement-contact-projection-lifecycle-maintenance` 独立建模；本 change 只处理版本升级时的一次性 initialization，并复用 Contact Directory 的 identity、ownership 和 persistence primitives。

该命令需要同时满足大数据量分页、可审计 dry-run、页面级原子性、失败后可恢复和安全重跑。它不能成为 runtime service，否则 Contact read 或 optional IM sync 会隐式承担 Contact correctness。

## Goals / Non-Goals

**Goals:**

- 为已有 eligible Account/member 建立幂等 source-backed Contact baseline。
- 让 dry-run 与 apply 使用同一 Plan/Apply 决策路径。
- 将 transaction、cursor、日志和失败恢复语义固定为可测试的运维 contract。
- 保持 internal/external same-email coexistence 与 source-backed uniqueness。

**Non-Goals:**

- 不实现 authoritative Account/member write-through、availability 或 periodic repair。
- 不暴露 HTTP/application command，不由 Contact read 或 manual sync 调用。
- 不读取 provider directory，不创建 IM identity、binding 或 override。
- 不建立通用 data-migration framework。

## Decisions

### 1. Initialization is an operations-only composition root

在 `flask data-migrate` namespace 注册 `human-input-contacts`。命令组合 source reader、Contact Directory repository primitives、page transaction 和 JSONL writer；runtime services 不能依赖该 composition。这样 Contact lifecycle knowledge 保持在 Contact Directory，IM runtime 只消费 current projection。

备选方案是在 manual sync 前 ensure missing Contacts。该方案会把 Contact correctness 绑定到 optional provider operation，并把 uniqueness、failure recovery 和 rollout sequencing 泄漏到 IM boundary，因此拒绝。

### 2. Stable keyset pages produce immutable plans

Source facts 按稳定 `(created_at, id)` keyset cursor 分页。每页先完整 materialize immutable Plan，Plan 固定 action、source/target IDs、expected values 和 next cursor；Apply 只能消费 Plan，不得重新扫描 source facts或重新分类。

Offset pagination 会在并发 source 变化时跳过或重复记录，因此拒绝。跨页 transaction 会扩大 lock/resource lifetime，因此每页使用独立 session/transaction。

### 3. Dry-run and apply differ only at the page transaction outcome

两种 mode 运行相同的 page Plan/Apply path。dry-run 在 page flush 后 rollback 并记录 planned outcomes；apply commit 后才记录 actual changes。这样预览和执行不会形成两套分类算法。

### 4. A failed write rolls back one page and scanning continues

任一 record write、flush 或 commit failure rollback并关闭整页 transaction。命令记录 failing record、完整 page Plan/cursor context，以新 session 从已读取 Plan 的 next cursor 继续。Source/page read failure 立即中止，因为此时无法证明 cursor 可以安全推进。存在未收敛 write failure 或 read failure 时最终返回 non-zero。

Per-record commit 会产生难以复核的部分页面状态；nested transaction/savepoint 会模糊实际 commit 边界，因此均禁止。

### 5. JSONL separates intent from committed facts

stdout 只输出独立 JSON objects。事件包含 mode、phase、cursor、action/outcome 和当前事实可用的 tenant/account/member/contact IDs；不输出 Email、display name 或其他 PII。Apply 只有在 page commit 成功后才能发出 changed records，rollback/attempted writes 不得冒充 committed facts。

## Risks / Trade-offs

- [Write failure pages are skipped during the current run] → 完成剩余扫描后返回 non-zero，并依赖 source-backed uniqueness 允许修复后从头安全重跑。
- [Source facts change between pages] → 使用稳定 keyset cursor 和独立 page snapshot；ongoing convergence 由 lifecycle maintenance 负责。
- [Migration and lifecycle changes diverge] → 二者复用同一 Contact Directory identity/transition primitives，并用 architecture tests 禁止复制 domain policy。

## Migration Plan

1. 先运行默认 dry-run，逐行复核 JSONL Plan 与 summary。
2. 修复任何 uniqueness/source-data blocker，直到 dry-run 收敛。
3. 在版本升级中运行 `flask data-migrate human-input-contacts --apply` 并保存 committed-change JSONL。
4. 只有命令成功且 lifecycle maintenance ready 后才解除 Contacts/IM rollout gate。
5. 回滚 release 时保持已创建 Contact；downgraded code 忽略它们，后续升级可安全重跑命令。

## Open Questions

无。
