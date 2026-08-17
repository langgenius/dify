## Why

一次性 Contact initialization import 只能建立 rollout 时的初始 projection，无法保证后续 Account/member mutation 持续反映到 `HumanInputContact`。持续 write-through 与 periodic repair 具有独立的事务、调度和故障恢复边界，不应继续与 optional manual IM sync 的生产接线耦合。

## What Changes

- 在 Contact Directory owner 下接入 authoritative Account/member write paths，使 eligible Account/member create、profile update 与 membership add 持续创建或更新 source-backed Contact。
- Account disabled 只改变 current availability，不修改、删除 Contact 或改变 Contact ID。
- CE/SaaS membership removal hard-delete workspace-owned Contact 与 current IM bindings；重新加入创建新 Contact ID。
- EE membership removal 保留 Organization-owned Contact，并由 membership 与 Platform allow-list 决定 workspace-relative resolution。
- 增加独立、分页且可恢复的 periodic Contact reconciliation，使用与 authoritative write paths 相同的 transition rules 修复旁路写入造成的 drift。
- 明确 Contact reads 与 manual IM sync 只消费 current projection，不触发 backfill、write-through 或 repair。
- Initial Contact import 继续由 `initialize-human-input-contact-projection` change 以版本升级命令 `flask data-migrate human-input-contacts --apply` 拥有；本 change 消费其初始化结果，不复制导入逻辑。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `contact-directory-governance`: 将 Account/member write-through、Account availability、deployment-specific membership removal/rejoin 与 periodic repair 固化为独立于 IM sync 的 Contact lifecycle contract。

## Impact

- Backend services: Account/member application operations、Contact projection application service、Contact Directory repository transaction boundaries。
- Runtime: 独立 periodic reconciliation task、bounded page processing、retry/idempotency、metrics and recovery。
- Persistence: workspace-owned Contact hard-delete、current IM binding cleanup、stable Organization Contact identity。
- Tests: lifecycle transaction、Account disable availability、member removal/rejoin、periodic drift repair、concurrency and no-sync-time-Contact-write architecture coverage。
- Dependencies: requires the successful version-upgrade execution of `flask data-migrate human-input-contacts --apply` owned by `initialize-human-input-contact-projection`; production Contacts/IM rollout remains blocked until this lifecycle maintenance change is complete。
