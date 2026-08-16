## Why

Organization binding、workspace override、identity search 和 guarded mutation services 已存在，但 Workspace Contact detail/options endpoints 仍为 stub，且 controller-to-application-service boundary 尚未完整验收。后端必须先提供 current-state、transport-neutral 的 Contact/identity/binding API，使其他 trusted transport 可以复用而不复制 owner predicates。

## What Changes

- 实现 Workspace Contact detail、contact-options list 和 batch projections，统一消费 Contact Directory owner 提供的 current availability，并省略 `ABSENT`、hard-deleted 或 unavailable Contact。
- 保持 admin Contact detail 与 editor-safe contact-options DTO 分离；options 只返回 recipient selection 所需的最小字段。
- 继续通过 synchronized IM identity search 提供候选源并支持 provider user ID keyword；不接受自由文本 IM user ID 作为 binding target。
- Workspace Organization binding create/delete 与 workspace override set/reset controllers 必须调用 `ContactIMBindingService`，不得直接编排 repository、lock 或 owner predicates。
- Organization binding、workspace override 和 effective binding 保持不同 scope；reset override 恢复 Organization binding，而不删除底层 binding。
- 冻结 transport-neutral service results、stable errors 和 Workspace/未来 EE transport 可复用的 call graph。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `human-input-console-management-api`: 完成 current Contact projections、synchronized identity selection 和 binding/override thin-controller contract。

## Impact

- Backend: Contact query application services/repositories、Workspace Contact detail/options controllers、existing IM identity/binding/override composition 和 backend tests。
- Dependencies: consumes current availability from `implement-contact-projection-lifecycle-maintenance` and synchronized identities from the existing IM sync service; it does not own either lifecycle。
- Excluded: provider directory I/O、Contact initialization、Contact lifecycle repair 和 EE transport。
