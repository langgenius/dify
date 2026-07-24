# Human Input Contact 数据库模型设计

## 1. 背景与边界

`Organization` 是产品边界，不是当前系统中的数据库实体，因此 Human Input Contact 不保存
`organization_id`。

不同部署形态中的 Organization 边界为：

- EE：一个 deployment 构成一个 Organization，Organization Account Contact 可以参与多个 workspace。
- CE / SaaS：一个 workspace 构成一个 Organization，member Contact 由该 workspace 持有。
- External Contact：始终由单个 workspace 持有，不属于 Dify Account。

数据库模型必须分开表达三个事实：

1. Contact identity：稳定的 `contact_id` 以及 identity 的 lifecycle owner。
2. Workspace availability：Contact 为什么在当前 workspace 可见和可选。
3. External API type：当前 workspace 中解析出的 `workspace / platform / external` projection。

## 2. 最小模型集合

```text
HumanInputContact
    |
    +-- HumanInputPlatformContactWorkspaceEntry
    |
    +-- HumanInputIMBinding

tenant_account_joins
    +-- authoritative workspace membership
```

不使用通用 `HumanInputContactWorkspaceEntry`。Workspace Contact 已由 membership 表达，External
Contact 已由 workspace ownership 表达，只有 EE Platform Contact 需要额外的 workspace allow-list。

## 3. HumanInputContact

`HumanInputContact` 是所有 current Contact identity 的统一引用目标。IM binding、HITL approval
principal、delivery endpoint 和 workflow recipient configuration 都引用同一个 `id` namespace。

稳定 ID 的含义是：

- Contact 在当前生命周期内发生 workspace role 或 binding 变化时不更换 ID。
- EE Contact 在 `WORKSPACE` 与 `PLATFORM` 之间转换时保持同一个 ID。
- stable 不等于 permanent；workspace-owned identity 被删除后不保留 current tombstone。

主要字段：

| Field | Meaning |
| --- | --- |
| `id` | 所有 Contact identity 共用的稳定 identifier |
| `identity_source` | 不可变的 identity 来源与 lifecycle source |
| `tenant_id` | workspace-owned identity 的 owner tenant；EE Organization Contact 为 `NULL` |
| `account_id` | Account-backed identity 对应的 `accounts.id` |
| `name` / `normalized_name` | 当前展示名称与搜索值 |
| `email` / `normalized_email` | 当前 Email 与精确匹配值 |
| `avatar_file_id` | 当前 avatar reference |

### 3.1 HumanInputContactIdentitySource

`HumanInputContactIdentitySource` 直接定义在 `api/models/human_input_v2.py`，是 ORM persistence
discriminator，不属于 core API contract：

```text
ORGANIZATION_ACCOUNT
WORKSPACE_MEMBER
EXTERNAL
```

它与外部 `HumanInputContactType` 不同：

- `identity_source` 在 Contact 当前生命周期内不可变化，用于决定 owner 与删除策略。
- 外部 `type` 是相对于当前 workspace 解析出的 projection。
- 一个 `ORGANIZATION_ACCOUNT` Contact 可以在 workspace A 是 `workspace`，在 workspace B 是
  `platform`，在 workspace C 不可见。
- Promote / Demote 只改变 membership 与 Platform allow-list，不修改 `identity_source`。
- API DTO 不得把 `identity_source` 序列化成外部 Contact `type`。

### 3.2 Row-shape invariants

| `identity_source` | `tenant_id` | `account_id` | Lifecycle owner |
| --- | --- | --- | --- |
| `ORGANIZATION_ACCOUNT` | `NULL` | non-null | EE Organization Account |
| `WORKSPACE_MEMBER` | non-null | non-null | CE / SaaS workspace membership |
| `EXTERNAL` | non-null | `NULL` | workspace-managed External Contact |

这些同表 shape 由数据库 `CheckConstraint` 和 Contact Directory write service 共同保护。
`EXTERNAL` Contact 还必须同时具有 non-null `email` 与 `normalized_email`。

`tenant_account_joins` 是 membership 的权威来源。Contact 不冗余保存
`tenant_account_join_id`；CE / SaaS member identity 通过 `tenant_id + account_id` 与当前 membership
解析，避免保存第二份 membership owner reference。

不允许通过修改 `identity_source` 实现 Contact 类型转换。Organization Account Contact 不能转换成
External Contact，EE Promote / Demote 也不能修改 Contact identity。

## 4. HumanInputPlatformContactWorkspaceEntry

`HumanInputPlatformContactWorkspaceEntry` 是 EE-only workspace allow-list：

> An existing EE Organization Account Contact is explicitly available in this workspace.

它不拥有 Contact identity，不表达 workspace membership，也不保存计算后的 API type。entry 的存在本身
就是 `PLATFORM` availability 的权威事实。

主要字段：

| Field | Meaning |
| --- | --- |
| `tenant_id` | 允许使用该 Contact 的 workspace |
| `contact_id` | 被显式收录的 EE Organization Account Contact |
| `added_by_account_id` | 执行添加或 retain-as-Platform 操作的管理员 |
| `created_at` | entry 创建时间 |

约束与索引：

```text
UNIQUE (tenant_id, contact_id)
INDEX (tenant_id, created_at, id)
INDEX (contact_id)
```

业务不变量：

- 只有 EE deployment 可以创建该 entry。
- `contact_id` 必须指向 `identity_source=ORGANIZATION_ACCOUNT` 的 Contact。
- 当前 workspace member 的 availability 来自 `tenant_account_joins`，不需要 entry。
- External Contact 的 availability 来自 Contact ownership，不需要 entry。
- 正常提交状态下，同一 `(workspace, contact)` 不应同时存在 membership 与 Platform entry。
- 删除 entry 只撤销当前 workspace 的显式可用性，不删除 Contact identity。
- 删除 Organization Account Contact 时必须删除其全部 Platform entries。
- 删除 workspace 时必须删除属于该 workspace 的 Platform entries。

普通外键只能保证 Contact 存在，无法保证 referenced Contact 的 `identity_source`。该跨表不变量由
Contact Directory write service 在事务内维护。

## 5. Workspace-local type resolution

外部 `HumanInputContactType` 保留：

```text
workspace
platform
external
```

它只适用于当前 workspace Contacts directory 返回的 Contact projection，不是 ORM discriminator。
Organization candidate 尚未加入当前 workspace Contacts，应使用独立 candidate DTO。

解析顺序：

```text
if contact.identity_source == EXTERNAL and contact.tenant_id == current_tenant_id:
    EXTERNAL
elif account has current workspace membership:
    WORKSPACE
elif EE Platform allow-list entry exists:
    PLATFORM
else:
    ABSENT
```

membership 优先于 Platform entry。若历史数据或并发异常导致两者同时存在，读取结果必须为
`WORKSPACE`，修复写路径应删除冗余 Platform entry。

## 6. Lifecycle and state transitions

### 6.1 EE Organization Account Contact

EE Account-backed Contact 的 lifecycle 绑定 Account，不绑定任意单个 workspace。离开 workspace
不会删除 Contact identity。

Promote `PLATFORM -> WORKSPACE`：

1. 创建 workspace membership。
2. 删除当前 workspace Platform entry。
3. 保持 Contact ID、Organization default IM binding 和 workspace IM override 不变。
4. 不修改其他 workspace 的 membership 或 Platform entry。

Demote `WORKSPACE -> PLATFORM`：

1. 创建当前 workspace Platform entry。
2. 删除 workspace membership。
3. 保持 Contact ID、Organization default IM binding 和 workspace IM override 不变。
4. 不修改其他 workspace。

Remove without retention：

1. 删除 workspace membership。
2. 不创建 Platform entry。
3. 删除当前 workspace IM override。
4. 保留 Organization Contact 与 Organization default IM binding。

Remove Platform Contact：

1. 删除当前 workspace Platform entry。
2. 删除当前 workspace IM override。
3. 保留 Organization Contact 与 Organization default IM binding。

Promote / Demote 必须在同一事务中修改 membership 与 Platform entry。

### 6.2 CE / SaaS Workspace Member Contact

member 加入 workspace 时创建新的 `WORKSPACE_MEMBER` Contact。member 被移除时：

- 删除 membership。
- hard-delete workspace-owned Contact 与 current-state child records。
- 不保留 inactive 或 tombstoned current Contact。
- 历史 workflow、task 和 audit 只依赖冻结 snapshot。
- 同一 Account 重新加入时创建新的 Contact ID。
- 新 Contact 不继承旧 pending task 的审批资格。

### 6.3 External Contact

External Contact 由 workspace 管理，显式删除时 hard-delete identity 与 current-state child records。
使用相同 normalized Email 重新创建时生成新的 Contact ID，不继承旧 pending task authorization。

## 7. Contact constraints and indexes

Contact 继续使用已经确认的约束：

```text
UNIQUE (tenant_id, account_id)
UNIQUE (tenant_id, normalized_email)

INDEX (tenant_id, normalized_email)
INDEX (tenant_id, normalized_name)
```

MySQL 和 PostgreSQL 都允许 Unique Constraint 中出现多个 `NULL`，因此
`tenant_id IS NULL` 的 EE Organization Contact 唯一性不能只依赖普通组合唯一约束。
创建或匹配 EE Organization Contact 时，业务事务必须锁住稳定 Organization owner，例如唯一的 IM
integration，再执行查找或创建。

## 8. IM binding

Organization default binding 和 per-workspace override 都引用同一个 `HumanInputContact.id`：

```text
Default binding:
contact_id = contact
scope = ORGANIZATION
scope_id = integration_id

Workspace override:
contact_id = contact
scope = WORKSPACE
scope_id = tenant_id
```

运行时优先使用当前 workspace override；不存在时回退到 Organization default binding。

## 9. Implementation guidance

Contact 的业务边界已经冻结；以下内容是实现约束或可在 adapter / repository 内选择的策略，不再作为 schema blocker：

- EE Organization Contact 可以 eager 或 lazy materialize，但 repository 必须保证 Organization directory 语义完整，并通过稳定 owner lock 保证 Account-backed Contact 唯一性。
- Account eligibility 复用现有 Account 状态策略。当前不可用的 Account 不得被新配置选择，也不得提交 pending task；是否保留 canonical row 是 Contact Directory 内部实现，不改变 workspace projection contract。
- Account-backed Contact profile 是 Account current-state projection，不在 Human Input Contact surface 提供独立编辑能力。External Contact 继续由 Human Input Contact surface 管理自己的 profile。
- Hard-delete 只清理 Contact Directory current-state children，包括 Platform workspace entry、current IM binding / override 与其他可重建状态。历史 sync result、Approver Grant、Delivery Endpoint、Submission 与 AuditEvent 继续保留冻结 snapshot。
- 初版保留 `(tenant_id, normalized_name)` B-tree index；是否增加全文或其他索引由真实查询计划和指标决定，不阻塞首版 schema。

## 10. Decision summary

- `HumanInputContact` 提供所有 current Contact identity 的统一稳定 ID。
- 使用 `HumanInputContactIdentitySource` 表达不可变 lifecycle source。
- 使用 nullable `tenant_id` 表达 ownership boundary；`NULL` 只允许 EE Organization Account Contact。
- CE / SaaS 不得创建 `tenant_id IS NULL` 的 Contact。
- 不使用 `HumanInputContact.scope`。
- 不使用通用 `HumanInputContactWorkspaceEntry` 或持久化 workspace `kind`。
- Workspace membership 由 `tenant_account_joins` 表达。
- EE Platform availability 由 `HumanInputPlatformContactWorkspaceEntry` 表达。
- 外部 `HumanInputContactType` 在 query boundary 按当前 workspace 解析。
- CE / SaaS member Contact 与 External Contact 删除时 hard-delete，不保留 current tombstone。
- EE Organization Contact 唯一性由锁住稳定 owner 后的事务保证。
- IM integration 是唯一使用 optimistic concurrency 的 aggregate root；sync run 捕获其 `integration_id + config_version`，其他 Contact / binding current-state records 不维护独立 version。
