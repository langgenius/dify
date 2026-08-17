## 1. Contact/Binding 契约测试

- [ ] 1.1 盘点当前 Workspace Contact detail/options stubs、lifecycle-owned availability predicates、synchronized identity search、`ContactIMBindingService`、binding/override routes，以及 controller 中的 repository access。
- [ ] 1.2 添加失败的 Contact query tests，覆盖 `WORKSPACE`、`PLATFORM`、`EXTERNAL` resolution，`ABSENT`/unavailable Contact 的 omit/not-found，过滤后 `total` 与 `page / limit`，以及 read-time initialization/repair 不存在。
- [ ] 1.3 添加失败的 DTO allow-list 与 authorization tests，区分 admin Contact detail 和 editor-safe contact options，禁止 binding/management metadata 进入 option results。
- [ ] 1.4 添加失败的 controller-delegation tests，覆盖 Organization binding create/delete、workspace override set/reset、stable error mapping，以及不存在直接 repository/lock/owner-predicate orchestration。

## 2. Current Contact Query Services

- [ ] 2.1 实现 Contact detail 与 contact-options batch queries，只加载目标 Contact 或请求中的 `contact_ids` 及其 resolution facts，并省略 missing/unavailable Contacts。
- [ ] 2.2 定义独立的 admin-safe detail 与 editor-safe option result types；options 仅允许 `id`、`type`、`name`、`avatar_url` 和 nullable `email`。
- [ ] 2.3 实现 contact-options list repository query，在 database query 中先应用 workspace availability 与 `keyword` filters，再计算 `total` 并执行 `page / limit`；禁止物化 workspace-wide `ContactDirectorySnapshot` 或分页后过滤。
- [ ] 2.4 添加 query/policy parity tests，证明 repository filters 与 `ContactDirectoryPolicy.resolve_for_workspace` 对 `WORKSPACE / PLATFORM / EXTERNAL / ABSENT` 的判断一致。
- [ ] 2.5 添加 architecture tests，证明 Contact query paths 不能调用 initialization、backfill、lifecycle repair、provider I/O 或 binding mutation。

## 3. Synchronized Identity Selection

- [ ] 3.1 通过既有 `IMSyncService.search_identities` application query 暴露 synchronized identity search，不新增 provider/repository search path。
- [ ] 3.2 支持 display name、Email 与 provider user ID keyword，包含尚无 current binding 的 persisted identities，并将结果限定在 trusted current Integration scope。
- [ ] 3.3 要求 binding command 引用 persisted synchronized identity ID，并在 mutation 前拒绝 free-text provider user ID。
- [ ] 3.4 添加 query/authorization tests，覆盖 provider/workspace isolation、unbound candidates、unavailable identities，以及不暴露 credential/provider payload。

## 4. Thin Binding/Override Controllers

- [ ] 4.1 将 Workspace Organization binding create/delete controllers 接到 `ContactIMBindingService`，传入 trusted scope、actor、Contact 与 identity references。
- [ ] 4.2 将 workspace override set/reset controllers 接到同一 service，保持 `workspace override > Organization binding` effective resolution 与 reset 不删除 underlying binding 的语义。
- [ ] 4.3 将 contact/identity not found、binding conflict、invalid scope、stale owner state 与 write unavailable 映射为严格、稳定且安全的 responses。
- [ ] 4.4 添加 controller/service tests，覆盖 scope-aware identity reuse、competing mutations、unrelated-override preservation、effective-binding refresh 与 secret/internal-detail redaction。

## 5. 后端验证与发布

- [ ] 5.1 添加 PostgreSQL integration coverage，覆盖 current detail/options、identity search、Organization binding create/delete、workspace override set/reset、conflict handling 与 unavailable Contact rejection。
- [ ] 5.2 添加 cross-boundary tests，证明 Workspace controllers 与 future trusted transports 在 repository、lock 或 mutation ownership 之前收敛到 transport-neutral application services。
- [ ] 5.3 运行 focused backend unit suites、controller/schema checks、formatter、type/lint checks 与 `openspec validate complete-human-input-contact-binding-api --strict`。
- [ ] 5.4 审计最终 dependency graph，确认 lifecycle maintenance 拥有 Contact availability、sync runtime 拥有 synchronized identities，且 `ContactIMBindingService` 是唯一 binding/override mutation owner。
