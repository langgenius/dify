## Context

Contact Directory main spec 已定义 current workspace projection、editor-safe contact-options、synchronized identity selection、Organization binding 和 workspace override。Backend 已有 `IMSyncService.search_identities`、`ContactIMBindingService` 和 guarded repository/UoW，但部分 Workspace Contact detail/options endpoints 仍为 stub，且 multi-transport application boundary 需要独立验收。

本 change 只完成 backend query/command API。

## Goals / Non-Goals

**Goals:**

- 实现 current Contact detail/options projections并复用 lifecycle owner 的 availability。
- 让 synchronized identity search 成为 binding target 的唯一候选源。
- 保证 Workspace binding/override controllers 只调用 transport-neutral application services。
- 保持 Organization binding、workspace override 和 effective binding 的 scope semantics。
- 冻结未来 EE transport 可复用且无回环的 call graph。

**Non-Goals:**

- 不读取 provider directory，不触发 sync run。
- 不创建、初始化或 repair Contact。
- 不实现 External Contact management 或 Contact lifecycle transitions。
- 不实现 EE inner API surface。

## Decisions

### 1. Contact option filtering and pagination stay in the query repository

Contact detail query 只加载目标 Contact 及其 current Account、membership 和 Platform allow-list facts。Contact-options batch 只加载请求中的 `contact_ids` 及其对应 facts。Contact-options list 由 query repository 在 database query 中应用 workspace availability 与 `keyword` predicates，并对过滤后的结果执行 count 和 `page / limit`。

List query 不物化 workspace-wide `ContactDirectorySnapshot`，也不先分页再过滤 unavailable Contacts。Repository query 与 `ContactDirectoryPolicy.resolve_for_workspace` 必须通过 parity tests 保持 `WORKSPACE / PLATFORM / EXTERNAL / ABSENT` 语义一致。Query application service 隐藏 database joins、count 与 pagination，并且不依赖 Contact initialization 或 periodic reconciliation。

### 2. Admin detail and editor options remain different abstractions

Admin detail 可以返回 management projection；editor-safe options 只返回 `id/type/name/avatar_url/email`，不包含 IM binding、management metadata 或 canonical unavailable facts。复用一个宽 DTO 会把管理权限与 workflow editing 混合，因此拒绝。

### 3. Binding targets are synchronized identities, not free text

Identity search 复用 `IMSyncService.search_identities`，匹配 display name、Email 和 provider user ID，包括尚未绑定的 identity。Mutation command 必须引用 persisted identity ID；controller 不接受自由文本 provider user ID 作为 binding target。

### 4. ContactIMBindingService owns all mutations

Organization binding create/delete 与 workspace override set/reset 统一调用 `ContactIMBindingService`。该 service 继续拥有 Organization-scoped lock/UoW、owner predicates、binding ID、clock 和 effective view load。Controller 不直接使用 repository 或 lock。

### 5. Scope semantics stay explicit

Organization binding 是默认关系，workspace override 只覆盖一个 workspace 的 effective binding。Reset override 只删除 override 并恢复 Organization binding，不删除底层 Organization binding。Identity reuse 按 scope 解释，不引入 global uniqueness。

### 6. Workspace and future EE transports converge before infrastructure

Application ports 接受 trusted `DirectoryScope`、workspace context、typed commands/queries并返回 transport-neutral results/errors。未来 EE adapter 必须在 repository、lock 或 binding mutation 前与 Workspace call path 收敛；本 change 不实现 EE controller。

## Risks / Trade-offs

- [Current availability owner is incomplete] → backend code可以合入但 capability gate 保持关闭，并依赖 `implement-contact-projection-lifecycle-maintenance`。
- [Binding API accidentally leaks Contact management data to editors] → 保持独立 query/result types并增加 field allowlist tests。
- [Identity reuse is mistaken for global conflict] → repository predicates 和 API tests 明确 Organization/workspace scope。

## Migration Plan

1. 实现 current Contact query services/repository projections和 focused tests。
2. 接通 detail/options stubs并验证 admin/editor authorization 与 DTO separation。
3. 审计 binding/override controllers全部委托给 `ContactIMBindingService`。
4. 运行 backend unit、controller contract 和 CI PostgreSQL integration；downstream transport exposure 保持独立 gated。

## Open Questions

无。
