## Why

Workspace Contact detail 和 contact-options endpoints 目前仍为 stub。Synchronized identity search、Organization binding 和 workspace override 已有 application services。本 change 补齐 Contact 查询服务和 endpoints，并确保相关 Workspace controllers 统一委托给这些 application services，不直接访问 repository，也不重复实现 binding scope/ownership rules。

## What Changes

- 实现 Workspace Contact detail、contact-options list 和 batch projections，统一消费 Contact Directory owner 提供的 current availability，并省略 `ABSENT`、hard-deleted 或 unavailable Contact。
- 保持 admin Contact detail 与 editor-safe contact-options DTO 分离；options 只返回 recipient selection 所需的最小字段。
- 继续通过 synchronized IM identity search 提供候选源并支持 provider user ID keyword；不接受自由文本 IM user ID 作为 binding target。
- Workspace Organization binding create/delete 与 workspace override set/reset controllers 必须调用 `ContactIMBindingService`，不得直接访问 repository、管理 lock 或重复实现 binding scope/ownership validation。
- Organization binding、workspace override 和 effective binding 保持不同 scope；reset override 恢复 Organization binding，而不删除底层 binding。
- 冻结 application service results、stable errors，以及 Workspace controller 到 application service 的调用边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `human-input-console-management-api`: 完成 current Contact projections、synchronized identity selection 和 binding/override thin-controller contract。

## Impact

- Backend: Contact query application services/repositories、Workspace Contact detail/options controllers、existing IM identity/binding/override composition 和 backend tests。
- Dependencies: consumes current availability from `implement-contact-projection-lifecycle-maintenance` and synchronized identities from the existing IM sync service; it does not own either lifecycle。
- Excluded: provider directory I/O、Contact initialization、Contact lifecycle repair 和 EE transport。
