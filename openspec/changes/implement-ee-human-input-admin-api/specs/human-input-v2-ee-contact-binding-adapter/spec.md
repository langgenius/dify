## ADDED Requirements

### Requirement: Organization Contact projection MUST 由 Dify application service拥有

EE MUST 通过 Dify internal API列出 current Organization Contact，并 MUST 不在 EE 中实现 Account-to-Contact projector、backfill、normalized-email collision或 availability规则。Dify response MUST 是 Contact ID、current name/email/avatar、Organization binding与`joined_at`的唯一current-state业务投影；`joined_at` MUST 来自Dify `Account.created_at`，MUST NOT 使用或重新解释`Contact.created_at`。

#### Scenario: 历史 Organization Account 执行 initialization import
- **WHEN** production rollout finds an eligible existing Organization Account without a canonical Human Input Contact
- **THEN** the version upgrade MUST use `flask data-migrate human-input-contacts --apply` owned by `integrate-im-contact-sync-end-to-end` to idempotently create or reuse the Account-backed Contact, and EE MUST NOT create or backfill that projection

#### Scenario: Organization Account 在初始化后首次进入 projection
- **WHEN** an eligible Organization Account is created after the initialization baseline
- **THEN** the authoritative write-through owned by `implement-contact-projection-lifecycle-maintenance` MUST create the Account-backed Contact and preserve that identity across later profile updates

#### Scenario: Organization Account属性变化
- **WHEN** current Account的name、email、avatar或active status变化
- **THEN** Dify authoritative Account write path MUST更新同一Account-backed Contact的mutable profile projection；disable MUST NOT修改或删除Contact，disabled或deleted Account MUST从current-state结果省略但不得把旧Contact ID分配给另一Account，同一Account重新active时MUST复用原Contact

#### Scenario: Organization Contact read或manual sync消费projection
- **WHEN** EE lists Organization Contacts or starts a manual IM sync
- **THEN** Dify MUST read the current projection without triggering Contact initialization or repair
- **AND** post-initialization projection drift MUST remain owned by authoritative Account writes and periodic reconciliation

#### Scenario: Organization Account不再可用
- **WHEN** Dify availability policy excludes an Account-backed Contact
- **THEN** Dify MUST omit or reject the Contact through the current-state contract, and EE MUST NOT restore it from membership data or a local cache

#### Scenario: EE 管理员搜索 Organization Contact
- **WHEN** `ListContacts` 包含 member name、email、page 或 limit filter
- **THEN** EE MUST 将 filter转发给 Dify，并 MUST 无损映射 Dify返回的 current eligible Account-backed Contacts及其`joined_at`，MUST NOT 从EE membership table补算timestamp

#### Scenario: Account workspace membership变化
- **WHEN** 同一 Account加入或离开 workspace
- **THEN** EE MUST 依赖 Dify保持 Contact identity稳定，MUST NOT 从 EE membership table重建或覆盖 Contact ID

### Requirement: Synced IM identity search MUST 由 Dify current integration scope决定

EE `ListIMIdentities` MUST 调用 Dify internal query，并 MUST 透传 provider、keyword与pagination。Current integration/provider scoping、provider user ID/display name/email matching、stale identity omission与bound/unbound status MUST 由 Dify实现。

#### Scenario: 管理员按 provider user ID搜索
- **WHEN** keyword命中 current synchronized identity
- **THEN** EE MUST 返回 Dify projection中的 identity与binding status，MUST NOT 查询 shared DB或解释 provider raw payload

#### Scenario: 只有 stale identity命中
- **WHEN** Dify current-state query返回空结果
- **THEN** EE MUST 返回空 page，MUST NOT 从历史 integration或sync result补齐 candidate

### Requirement: Organization binding mutation MUST 委托给 Dify transaction boundary

`CreateIMBinding` 与 `DeleteIMBinding` MUST 通过 Dify internal command执行。Contact availability、identity ownership、current integration/provider、Organization scope、exact retry idempotency、unique conflict与完整 Contact-to-binding owner predicate MUST 由 Dify repository/application service保证。EE MUST 不增加本地 binding cache或补偿性 DB write。

#### Scenario: 当前 Contact绑定 current identity
- **WHEN** Dify接受 binding command
- **THEN** EE MUST 返回 Dify提供的 refreshed Contact projection，并 MUST 不在本地重复 mutation

#### Scenario: Dify拒绝 competing binding
- **WHEN** internal API返回 stable binding-conflict code
- **THEN** EE MUST 映射为 `409`，MUST NOT 自动删除、替换或重新绑定 identity

#### Scenario: 使用错误 Contact删除 binding
- **WHEN** Dify owner predicate拒绝 delete command
- **THEN** EE MUST 保留 not-found/conflict语义，MUST NOT 按 binding ID直接访问数据库完成删除

### Requirement: Binding reachability test MUST 调用 Dify-owned provider path

`TestIMBinding` MUST 通过 Dify internal API验证 current binding identity reachability。Stored integration credential解密、provider adapter调用与safe diagnostic生成 MUST 位于 Dify；EE 只映射 `reachable` 与operator-safe message。

#### Scenario: Bound identity可达
- **WHEN** Dify provider path返回 reachable result
- **THEN** EE MUST 返回 `reachable: true`，且 MUST 不缓存 credential、provider response或test result为binding state

#### Scenario: Binding stale或不可达
- **WHEN** Dify返回 stable current-state error或safe unreachable diagnostic
- **THEN** EE MUST 保留该 typed outcome，MUST NOT在EE直接调用 provider复核

### Requirement: EE admin adapter MUST 不接管 workspace override

EE admin service MUST 只适配 Organization binding control-plane。Workspace override的set/reset和 `workspace override > organization binding > Email fallback` resolution MUST 保持在Dify workspace/runtime boundary。

#### Scenario: EE admin client请求 workspace override
- **WHEN** client需要设置或清除 workspace-scoped override
- **THEN** `EnterpriseHumanInputAdmin` MUST 不提供对应 service method，operation MUST 继续使用 Dify workspace-owned API
