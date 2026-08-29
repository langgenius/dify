## Context

现有代码以 `HumanInputContact` 同时表示持久化 identity 与 mutable profile。`api/core/human_input_v2/contact_directory` 又定义 `ContactDirectorySnapshot`、`ContactDirectoryPolicy` 与 `ContactResolution`，SQLAlchemy adapter 为一次操作加载 Contact、membership、Platform entry 与 Account availability 集合。recipient resolution 随后再次查找 Contact、解释 `ABSENT` 并捕获 domain error；approval、submission 与 IM repositories 仍有路径直接 join `HumanInputContact`。

该实现尚未发布，现有 migration 可以直接改为最终 schema。`schema.py` 定义 `HumanInputContactIdentity` 与 `HumanInputExternalContactProfile`；`domain.py` 定义 current `Contact`、`ExternalContact`、`ContactQuery`、`ContactRepository` 与 `ContactIMBindingRepository`。二者是本 change 的实现基准。

## Goals / Non-Goals

**Goals:**

- 删除旧 Contact domain package、snapshot、policy、resolution enum 与 aggregate repository。
- 让 `HumanInputContactIdentity` 只保存 immutable subject mapping，让 profile 始终从 `Account` 或 `HumanInputExternalContactProfile` 读取。
- 让所有 current Contact consumers 只依赖 `ContactRepository`，需要 IM binding 时额外依赖 `ContactIMBindingRepository`。
- 在 Repository 内统一执行 tenant predicates、Account availability、membership/Platform precedence、External ownership 与 Email matching。
- 使用调用方注入的 SQLAlchemy `Session` 共享 transaction 和 identity map。
- 保留现有 UUID `ContactId`、transport payload、workflow DSL 与历史 snapshot。

**Non-Goals:**

- 不修改 Console Contact route、response field、workflow recipient schema、grant、OTP、sync result 或 reconciliation history 的外部 shape。
- 不为 External Contact 添加 IM binding。
- 不把历史 snapshot 改成 current Contact 查询。
- 不增加兼容 column、dual read/write、旧 Contact row migration 或 rollback rehydration；旧 schema 未发布。
- 不引入额外 Unit of Work class，也不改变 IM control-plane 对 binding mutation 的 ownership。

## Decisions

### 1. Schema 只保存 Contact identity 与 External Contact profile

`human_input_contact_identities` 保存 `id`、`subject_type`、`account_id` 与默认时间字段。`ContactSubjectType.ACCOUNT` 必须引用一个全局唯一 Account；`ContactSubjectType.EXTERNAL` 必须令 `account_id` 为 null。

`human_input_external_contact_profiles` 以 `contact_id` 为主键，保存 `tenant_id`、name、normalized name、Email、normalized Email 与 avatar。`UNIQUE(tenant_id, normalized_email)` 只约束 External Contact；Account Email 与 External Email 不共享 uniqueness boundary。

所有 durable `contact_id` 继续引用 `HumanInputContactIdentity.id`。`HumanInputPlatformContactWorkspaceEntry.contact_id` 引用 Account-backed Contact identity；它只表示该 identity 在一个 workspace 的 Platform visibility，不创建新的 Contact identity。

拒绝在 identity row 保存 Account name、Email、avatar、membership、Platform visibility 或 authorization state。该选择避免 profile write-through 与 drift repair。

### 2. `Contact` 是 current read value，不是持久化 aggregate

`Contact` 只包含 current consumers 需要的 `id`、`type`、name、Email、avatar 与 creation time。`Contact.type` 只允许：

- owning tenant 的 External profile → `EXTERNAL`；
- active Account 加当前 `TenantAccountJoin` → `WORKSPACE`；
- active Account 加当前 `HumanInputPlatformContactWorkspaceEntry` → `PLATFORM`；
- membership 与 Platform entry 同时存在 → `WORKSPACE`。

inactive Account、缺少 membership 与 Platform entry 的 Account identity、其他 tenant 的 External profile，以及不存在的 identity 均不产生 current `Contact`。Repository 通过缺失结果表达不可用，不构造第四种 Contact type。

`ExternalContact` 是 External write value，只能传给 `save_external_contact` 与 `delete_external_contact`。Account-backed profile 永远从 `Account` 读取。

### 3. `ContactRepository` 是 current Contact 的唯一 port

`count_contact` 与 `list_contact` 接收相同的 `ContactQuery`，并使用完全相同的 visibility、keyword 与 type predicates；filtering 必须先于 count 和 pagination。

`get_contacts_by_id` 返回一个 current `Contact` 或 `None`。`get_contacts_by_ids` 省略 missing/unavailable Contact、对重复 ID 最多返回一次且不承诺顺序。`available` 为请求的 Contact IDs 返回 tenant-scoped availability mapping。

`query_contacts_by_email` 只返回当前 tenant 可用的 Contact。若一个 normalized Email 同时匹配 Account-backed Contact 与 External Contact，结果必须包含两者；结果不承诺顺序。

`provision_account_backed_contact` 以 `account_id` 幂等分配全局 Contact ID。并发调用由 `UNIQUE(account_id)` 收敛到同一个 ID；冲突后的成功 retry 返回已提交的 ID。

`create_platform_entry` 与 `delete_platform_entry` 接收 `account_id`，因为业务操作针对 Account。adapter 使用 Account-backed identity 的 `contact_id` 持久化或删除 `(tenant_id, contact_id)` entry。该 mutation 不创建 Platform-specific identity，也不修改 Contact identity。

`save_external_contact` 原子创建 identity/profile 或只更新现有 profile；`delete_external_contact` 删除 owning tenant 的 External profile 与对应 identity。删除后使用相同 Email 创建 External Contact 必须获得新的 Contact ID。

`ContactRepository` 的所有 read 和 mutation methods 都只处理一个 `tenant_id`。它不搜索其他 tenant，也不解释 deployment-wide Organization scope。EE Platform candidate search 由 EE implementation 查询 deployment-owned Accounts；选定 Account 后，EE application service 调用 tenant-scoped Repository provisioning 与 Platform entry methods。

### 4. `ContactIMBindingRepository` 只提供 Contact-facing binding query

Contact detail 与 recipient delivery 通过 `ContactIMBindingRepository.get_im_bindings` 批量读取指定 Contact IDs 在 tenant 中可见的 bindings。`Contact` 不包含 binding，Contact query 不隐式 eager-load binding。

IM binding create/update/delete 继续由现有 IM control-plane repository 与 synchronization transaction 管理。本 change 不把 mutation methods 复制到 `ContactIMBindingRepository`。

### 5. SQLAlchemy `Session` 直接承担 transaction boundary

SQLAlchemy Repository implementation 由调用方注入 `Session`。需要组合 Contact 与 binding mutation 的 application operation 必须把两个 Repository 绑定到同一个 Session，并由外层 `session.begin()` 管理 commit 与 rollback。

Repository methods 可以 flush，但不得创建独立 Session、commit、rollback 或开启嵌套 application transaction。该选择保留 SQLAlchemy 自身的 transaction 与 identity-map 语义，不增加重复 Unit of Work abstraction。

### 6. 删除旧实现并迁移所有 consumer

删除 `api/core/human_input_v2/contact_directory` 与 `api/repositories/human_input_v2/contact_directory`。同时删除旧 owner/source values、snapshot、policy、resolution enum、errors、ports、mappers 与 SQLAlchemy aggregate adapter。

Console Contact services、recipient resolution、approval、submission authorization 与 IM code 通过注入的 Repository 读取 current Contact。除 SQLAlchemy Contact adapter 外，任何 module 都不得组合 `HumanInputContactIdentity`、`Account`、`TenantAccountJoin`、`HumanInputPlatformContactWorkspaceEntry` 与 `HumanInputExternalContactProfile` 来重新实现 current Contact rules。

Recipient application orchestration 先调用 `ContactRepository.get_contacts_by_ids` 与 `ContactIMBindingRepository.get_im_bindings`，再把 immutable Contact、binding 与 delivery capability values 传给 pure resolver。Resolver 不导入 Repository、Session、ORM 或旧 snapshot/policy types。

Historical grant、OTP、sync 与 audit readers 继续读取各自冻结字段。它们只有在执行 current authorization 时才调用 `ContactRepository`。

### 7. 直接改写未发布 schema

修改现有 Contact migration 与 ORM 为最终 shape，不新增迁移旧 `human_input_contacts` row 的 revision。所有 referencing column 保持 UUID shape，避免改写 workflow、grant、OTP、binding、sync 与 reconciliation 数据结构。

## Risks / Trade-offs

- [Account list/search 不再使用 Contact profile 副本索引] → 直接查询 Account-owned fields，使用 query-plan tests；只有测量证明需要时才增加 Account-owned 或 expression index。
- [consumer 绕过 Repository 重新 join source tables] → 增加 import/call-graph tests，并扫描 Contact ORM/table imports。
- [count 与 list predicates 漂移] → 复用同一个 query builder，并增加 type、keyword、pagination parity tests。
- [并发 Account provisioning 返回不同 Contact ID] → 依赖 `UNIQUE(account_id)`、conflict translation 与 same-ID retry tests。
- [Repository 各自创建 Session 导致部分提交] → constructor 注入 Session，增加 transaction rollback tests，禁止 Repository commit。
- [其他 active changes 继续描述 profile projection 或旧 snapshot] → 在 implementation gate 前修订相关 artifacts，并对 dependency graph 做术语与 contract 检查。
- [core Repository 被用于 EE 跨 tenant search] → architecture tests 限制 Repository 为 single-tenant port；EE candidate search 继续留在 EE adapter/application service。

## Migration Plan

1. 直接修改未发布 ORM 与 schema revision，并先加入 constraint tests。
2. 定义 Contact values 与两个 Repository protocols，实现 SQLAlchemy adapters。
3. 迁移 current Contact consumers 后删除旧 packages 与直接 ORM joins。
4. 接通 Account provisioning、External lifecycle 与 Platform entry mutations。
5. 运行 focused unit/type/lint/schema tests；PostgreSQL/MySQL concurrency 与 transaction coverage 由 CI 执行。
6. 所有 consumer 与 dependent changes 使用新 contracts 后再打开 Contact/IM rollout gate。

## Open Questions

None.
