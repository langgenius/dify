# Human Input Contact Identity and Lifecycle Discussion Summary

## 1. 文档状态

- 日期：2026-07-23
- 状态：讨论总结，尚未作为最终数据库实现方案冻结
- 范围：Contact identity、workspace 可用性、Contact 类型解析、生命周期、稳定 ID 与 IM binding 引用边界

本文档总结当前讨论中已经确认的产品语义、推荐的建模方向，以及仍需进一步决定的工程细节。

## 2. PRD / Spec 基线

Contact 首先按身份来源分为两类：

1. Organization member 对应的 organization contact。
2. 不属于当前 Organization 的 External contact。

`workspace contact` 与 `Platform contact` 不是两种独立的 Organization Contact identity，而是同一个 Organization Contact 相对于某个 workspace 的类型：

| 当前 workspace 中的关系 | Contact type |
| --- | --- |
| Contact 对应的 Account 是当前 workspace member | `WORKSPACE` |
| EE Organization Contact 不是当前 workspace member，但被显式加入当前 workspace Contacts | `PLATFORM` |
| workspace-owned Contact 不属于 Dify Account | `EXTERNAL` |
| 不满足以上条件 | 不在当前 workspace Contacts 中 |

PRD 同时要求：

- EE 中，一个 deployment 构成一个 Organization。
- CE / SaaS 中，一个 workspace 构成一个 Organization。
- EE workspace 不自动展示 Organization 全量 Contact。
- EE admin 可以从 Organization directory 中选择其他 workspace 的 member，并将其加入当前 workspace Contacts。
- CE / SaaS workspace member 自动进入当前 workspace Contacts。
- External contact 只归属单个 workspace。
- External contact 不属于 Dify Account，目前仅通过 Email 触达。
- Platform Contact remove 只移除当前 workspace 的可用性，不删除 Organization member identity。

## 3. 必须分离的三个概念

当前讨论确认，下列三个事实不能继续混在一个 `kind` 字段或一个通用 workspace entry 生命周期中。

### 3.1 Contact identity

Contact identity 是 IM binding、HITL approver grant、delivery endpoint 和 workflow recipient 引用的稳定业务身份。

稳定的含义是：

- 在 Contact 当前生命周期内，workspace role 变化不能替换 Contact ID。
- EE Contact 在 `WORKSPACE` 与 `PLATFORM` 之间切换时必须保持同一个 Contact ID。

稳定不等于永久存在：

- CE / SaaS Workspace Contact 被删除后，Contact ID 不再解析为当前有效 Contact。
- External Contact 被删除后，Contact ID 不再解析为当前有效 Contact。
- 历史 workflow、task 和 audit 依赖冻结快照，不依赖已删除的当前 Contact 行。

### 3.2 Concrete ownership and lifecycle

不同 Contact identity 的 owner 与生命周期不同：

| Identity category | Owner | Creation | Deletion |
| --- | --- | --- | --- |
| EE Organization Account Contact | EE Organization Account | Account 成为有效 Organization member 时建立或物化 | Account 被删除时删除；离开单个 workspace 不删除 |
| CE / SaaS Workspace Member Contact | workspace membership | member 加入 workspace 时创建 | member 被移除时 hard-delete |
| External Contact | workspace | admin 显式创建 | admin 删除时 hard-delete |

### 3.3 Workspace-local availability

Workspace-local availability 回答的是：某个 Contact 是否能在指定 workspace 的 Contacts、HITL recipient selector 和当前授权校验中使用。

它不是 Contact identity 自身的类型。

在 EE 中：

| Workspace-local fact | Resolved type |
| --- | --- |
| 有效 membership 存在 | `WORKSPACE` |
| membership 不存在，但 Platform allow-list entry 存在 | `PLATFORM` |
| membership 与 Platform allow-list 都不存在 | 不在当前 workspace Contacts 中 |

## 4. Edition-specific identity lifecycle

### 4.1 EE Organization Account Contact

EE Organization member 对应一个 Organization-level Contact identity。该 Contact identity 的生命周期绑定 Account，而不是绑定任意单个 workspace。

同一个 Contact 可以同时拥有以下状态：

| Workspace | State |
| --- | --- |
| Workspace A | `WORKSPACE` |
| Workspace B | `PLATFORM` |
| Workspace C | absent |

从 Workspace A 移除 member 不应删除 Organization Contact identity。

如果选择 `Keep as Platform contact`，只改变 Contact 在 Workspace A 的 workspace-local availability；如果不保留，则 Contact 只从 Workspace A Contacts 消失。

### 4.2 CE / SaaS Workspace Member Contact

CE / SaaS 中 `Organization = workspace`，member Contact 是 workspace-owned identity，其生命周期绑定 membership。

member 被移除时：

- 删除 membership。
- hard-delete 当前 workspace-owned Contact identity。
- 删除该 Contact 的当前 bindings 和其他 current-state child records。
- 不保留 inactive 或 tombstoned current Contact。
- 历史 workflow 与 task 只保留冻结快照。
- member 重新加入时创建新的 Contact ID。
- 旧 pending task 不继承重新加入后的审批资格。

### 4.3 External Contact

External Contact 是 workspace-owned identity，不属于 Dify Account。

External Contact 被删除时：

- hard-delete External Contact identity。
- 删除其 current-state child records。
- 历史 task snapshot 保留。
- 使用相同 normalized Email 重新创建时生成新的 Contact ID。
- 新 Contact 不继承旧 pending task 的授权。

## 5. EE Platform allow-list

Platform Contact 在 workspace 内只表达一个 allow-list 事实：

> An existing EE Organization Contact is explicitly available in this workspace.

这条记录是 workspace-local `PLATFORM` projection 的权威输入，但不是 projection cache。它不保存计算后的 `HumanInputContactType`，也不改变 `HumanInputContact` identity。

因此推荐使用专用模型，而不是包含所有 Contact 类型的通用 workspace entry：

`HumanInputPlatformContactWorkspaceEntry`

建议职责：

- 关联一个 EE Organization Contact 与一个 workspace。
- 表示该 Contact 已被显式加入当前 workspace Contacts。
- 保存添加操作者和时间。
- 不拥有 Contact identity。
- 不表达 workspace membership。
- 不保存 `kind=PLATFORM`；entry 的存在已经表达 explicit availability。

建议核心字段：

| Field | Meaning |
| --- | --- |
| `tenant_id` | 允许使用该 Contact 的 workspace |
| `contact_id` | EE Organization Contact identity |
| `added_by_account_id` | 执行显式添加的管理员 |
| `created_at` | 添加时间 |

建议唯一性：

```text
UNIQUE (tenant_id, contact_id)
```

业务不变量：

- `contact_id` 必须指向 `identity_source=ORGANIZATION_ACCOUNT` 的 Contact。
- 只有 EE deployment 可以创建该 entry。
- Workspace member 的 availability 来自 membership，不需要 entry。
- External Contact 的 availability 来自 workspace ownership，不需要 entry。
- entry 删除只撤销 Contact 在目标 workspace 的显式可用性，不删除 Contact identity。
- Organization Account Contact 被删除时，必须删除其全部 Platform entries。
- workspace 被删除时，必须删除属于该 workspace 的 Platform entries。

`contact_id` 到 `HumanInputContact.id` 的普通外键只能保证 Contact 存在，不能保证 referenced Contact 的 `identity_source`。当前建议由 Contact Directory write service 在事务内维护该跨表不变量。如果以后要求数据库独立强制，可以评估 trigger，或带固定 discriminator 的 composite foreign key；不应仅为这一个约束引入 joined-table inheritance。

## 6. Promote / Demote

Promote 与 Demote 只适用于 EE，并且只修改 workspace membership 与 Platform allow-list，不修改 Contact identity。

### 6.1 Promote: Platform to Workspace

针对 Workspace A：

1. 创建 Workspace A membership。
2. 删除 `(workspace A, contact)` Platform allow-list entry。
3. 保持 Contact ID 不变。
4. 保持 Organization default IM binding 不变。
5. 保持 Workspace A IM override 不变。
6. 不修改其他 workspace 的 membership 或 Platform allow-list。

### 6.2 Demote: Workspace to Platform

针对 Workspace A：

1. 创建 `(workspace A, contact)` Platform allow-list entry。
2. 删除 Workspace A membership。
3. 保持 Contact ID 不变。
4. 保持 Organization default IM binding 不变。
5. 保持 Workspace A IM override 不变。
6. 不修改其他 workspace 的 membership 或 Platform allow-list。

### 6.3 Remove without retention

EE member 从 Workspace A 被移除且不保留为 Platform Contact 时：

1. 删除 Workspace A membership。
2. 不创建 Platform allow-list entry。
3. 删除 Workspace A IM override。
4. 保留 Organization Contact identity。
5. 保留 Organization default IM binding。
6. 不影响其他 workspace。

### 6.4 Remove Platform Contact

从 Workspace A 移除 Platform Contact 时：

1. 删除 `(workspace A, contact)` Platform allow-list entry。
2. 删除 Workspace A IM override。
3. 保留 Organization Contact identity。
4. 保留 Organization default IM binding。
5. 不影响其他 workspace。

### 6.5 State transition summary

| Operation | Contact identity | Workspace membership | Platform entry |
| --- | --- | --- | --- |
| Add Platform | unchanged | unchanged | insert |
| Remove Platform | unchanged | unchanged | delete |
| Promote to Workspace | unchanged | insert | delete |
| Demote and retain | unchanged | delete | insert |
| Remove EE member without retain | unchanged | delete | absent |
| Delete Organization Account | delete | delete | delete all entries |
| Delete workspace | unchanged | delete workspace memberships | delete workspace entries |

Promote / Demote 必须在同一事务中完成。正常提交后的状态不应同时存在 membership 与 Platform entry；如果因历史数据或并发异常两者同时存在，读取时必须优先解析为 `WORKSPACE`，并由修复写路径删除冗余 Platform entry。

## 7. External API type

外部 API 仍然需要稳定的 `HumanInputContactType`：

```text
workspace
platform
external
```

该 type 是相对于当前 workspace 解析出的 projection，不要求 ORM 存储同名 `kind` column。
它只适用于当前 workspace Contacts directory 返回的 Contact；尚未加入当前 workspace Contacts 的
Organization candidate 使用独立 candidate DTO。

推荐解析来源：

| Condition | API type |
| --- | --- |
| 当前 workspace membership 有效 | `workspace` |
| EE Platform allow-list entry 存在 | `platform` |
| 当前 workspace-owned External Contact 存在 | `external` |

对于 Account-backed Contact，解析顺序必须是 membership 优先于 Platform entry：

```text
if contact is workspace-owned external:
    EXTERNAL
elif account has active workspace membership:
    WORKSPACE
elif platform workspace entry exists:
    PLATFORM
else:
    ABSENT
```

类型解析应集中在 Contact Directory service/repository 中，controller 和其他调用方不应自行拼装判断规则。

## 8. Stable Contact ID and identity source

所有 Contact 类型需要一个统一、稳定的 Contact ID，供以下对象引用：

- IM binding
- HITL approver grant
- delivery endpoint
- workflow recipient configuration
- Platform workspace allow-list
- current-state authorization revalidation

这个要求只需要所有当前 Contact identity 共享同一个 ID namespace 和引用目标，不要求将 identity 拆成 base table 与 subtype tables。

重新从字段依赖、查询形状和生命周期约束出发后，当前推荐使用一张 `human_input_contacts` 表表达 active Contact identity，并增加明确的 `identity_source` discriminator。

### 8.1 HumanInputContactIdentitySource

`HumanInputContactIdentitySource` 直接定义在 `api/models/human_input_v2.py`，属于 ORM persistence
model，不属于 core 或外部 API contract。它包含：

```text
ORGANIZATION_ACCOUNT
WORKSPACE_MEMBER
EXTERNAL
```

该 discriminator 表达 Contact identity 的来源和 lifecycle owner：

| Identity source | Lifecycle owner | Delete trigger |
| --- | --- | --- |
| `ORGANIZATION_ACCOUNT` | EE Organization Account | Account deletion |
| `WORKSPACE_MEMBER` | CE / SaaS workspace membership | membership removal |
| `EXTERNAL` | workspace-managed Contact record | explicit External Contact deletion |

`identity_source` 与外部 `HumanInputContactType` 不同：

- `identity_source` 是 Contact identity 生命周期内不变的持久化事实。
- 外部 `type` 是相对于当前 workspace 解析出的 `WORKSPACE / PLATFORM / EXTERNAL` projection。
- 一个 `ORGANIZATION_ACCOUNT` Contact 可以在不同 workspace 中同时解析为 `WORKSPACE`、`PLATFORM` 或 absent。
- Promote / Demote 只修改 membership 与 Platform allow-list，不修改 `identity_source`。
- API DTO 不得把 `identity_source` 序列化成外部 Contact `type`。

### 8.2 Recommended single-table shape

建议 `HumanInputContact` 继续作为所有当前 Contact identity 的统一 ORM model 和引用目标。

建议核心字段：

| Field | Meaning |
| --- | --- |
| `id` | 所有 Contact 类型统一稳定 ID |
| `identity_source` | identity 来源和 lifecycle owner |
| `tenant_id` | workspace-owned identity 的 owner tenant |
| `account_id` | Account-backed identity |
| `name` / `email` / normalized fields | 公共身份与搜索数据 |
| `avatar_file_id` | 当前 Contact avatar reference |

### 8.3 Row-shape invariants

三种 identity source 必须满足明确的同表 shape 约束：

| `identity_source` | `tenant_id` | `account_id` |
| --- | --- | --- |
| `ORGANIZATION_ACCOUNT` | `NULL` | non-null |
| `WORKSPACE_MEMBER` | non-null | non-null |
| `EXTERNAL` | non-null | `NULL` |

这些规则应由同表 `CheckConstraint` 和 Contact Directory write service 共同维护。
`EXTERNAL` Contact 还必须同时具有 non-null `email` 与 `normalized_email`。

`tenant_account_joins` 仍然是 membership 的权威来源。Contact 不冗余保存
`tenant_account_join_id`；CE / SaaS member identity 通过 `tenant_id + account_id` 与当前 membership
解析，避免维护第二份 membership owner reference。

不允许：

- 修改 `identity_source` 实现 Contact 类型转换。
- 将 Organization Contact 转换为 External Contact。
- 将 EE Promote / Demote 表达为 Contact identity mutation。
- 保留不满足任一合法 shape 的 current Contact row。

### 8.4 Stable does not mean permanent

统一稳定 ID 的含义是：Contact 当前生命周期内，workspace role 与 binding 变化不能替换 Contact ID。

它不要求已删除 Contact 永久保留 tombstone：

- CE / SaaS Workspace Member Contact 被删除后，该 `contact_id` 不再解析为 current Contact。
- External Contact 被删除后，该 `contact_id` 不再解析为 current Contact。
- 历史 workflow、task 和 audit 依赖冻结 snapshot。
- 相同 Account 或 Email 后续重新创建 Contact 时生成新的 Contact ID。

### 8.5 Uniqueness and lookup indexes

Contact 使用以下已确认约束与索引：

```text
UNIQUE (tenant_id, account_id)
UNIQUE (tenant_id, normalized_email)

INDEX (tenant_id, normalized_email)
INDEX (tenant_id, normalized_name)
```

MySQL 和 PostgreSQL 都允许 Unique Constraint 中出现多个 `NULL`，因此 EE Organization Account
Contact 的 `tenant_id IS NULL` 唯一性不能只依靠普通组合唯一约束。创建或匹配 EE Organization
Contact 时，业务事务必须锁住稳定 Organization owner，例如唯一的 IM integration，再执行查找或创建。

## 9. Persistence and ORM strategy

### 9.1 Single-table storage

三个 identity variant 共享大部分字段、统一引用目标和主要查询路径，subtype-specific 字段较少。Contact Directory 又需要跨全部 identity source 搜索、匹配、分页和去重。

因此单表存储比 joined-table inheritance 更符合当前查询形状：

- Contact list 和 email/name search 不需要 subtype joins。
- IM binding、principal 和 endpoint 可以直接引用一个稳定表。
- lifecycle difference 由 `identity_source` 明确表达。
- 同表 CHECK 可以保护 variant shape。

### 9.2 SQLAlchemy inheritance

当前不建议立即使用 SQLAlchemy inheritance。

这里需要分开两个正交决策：

1. 数据库如何存储不同 identity variant。
2. Python ORM 是否需要通过 subclass 提供多态行为。

单表存储并不必然要求 STI；使用 discriminator 也不必然意味着 ORM subclass。`identity_source` 首先是数据库需要持久化和约束的 lifecycle fact，是否把它映射成 Python subclass，应由领域行为是否真正多态决定。

#### Joined-table inheritance

不推荐。它会为 subtype 数据引入额外 join 或 polymorphic loading 策略，但当前 subtype tables 没有足够多的独立字段来抵消长期查询成本。

具体成本取决于 loading strategy：

- 查询已知 subtype 通常需要 base table 与对应 subtype table 的 join。
- 一次查询全部 Contact variant 时，joined polymorphic load 可能同时 outer join 多个 subtype table。
- 使用 select-in polymorphic load 可以避免一个包含全部 subtype table 的大 join，但会增加额外查询。

这些成本只有在 subtype 拥有大量独立字段、独立约束或独立关系时才合理。当前大部分 Contact list、Email/Name 搜索、IM binding 和 authorization 查询都以统一 Contact identity 为入口，JTI 与主要读路径相反。

更重要的是，删除触发条件依赖 Account、membership 或显式 External delete 操作。JTI 只表达 row shape，不能自动保证这些跨表 lifecycle rule；Contact Directory service 仍然必须负责正确的事务和删除策略。

#### Plain 1:1 owner tables

不使用 SQLAlchemy inheritance、只为每种 identity 建立普通的 1:1 owner table，可以避免 polymorphic mapper 和自动 loading 的复杂度，并允许调用方显式控制 join。但它不能消除主要业务查询读取 owner table 的成本。

Contact list、Organization boundary 匹配、workspace type resolution、pending task revalidation 和 lifecycle deletion 都需要知道 concrete owner，因此仍然需要 join 对应 owner table，或额外发起一次查询。只有完全不关心 owner 与当前有效性的公共 profile / ID 查询可以只读取 identity anchor。考虑到这些查询通常还需要 membership 或 Platform allow-list，额外 owner table 会继续增加核心路径的 join 层级。

因此 plain 1:1 owner tables 与 joined-table inheritance 的 ORM 机制不同，但在当前主要访问路径上具有相近的 subtype data access 成本。当前 subtype-specific 字段和独立关系较少，不足以抵消这种长期读取成本，所以仍选择 single-table storage。

#### Single-table inheritance

STI 在数据库形状上可行，但当前尚未证明需要 Python mapper polymorphism。

从第一性原理看，ORM inheritance 的收益来自行为上的可替换性：调用方通过共同接口操作 Contact，而不同 subtype 对同一操作提供不同且封装良好的实现。当前差异主要是创建来源、删除触发条件和 workspace 关系解析；这些操作依赖 repository、membership 和事务锁，不是单个 ORM entity method 能独立完成的行为。

因此，即使使用 STI，Contact Directory 的集合查询、type projection、Promote/Demote 和删除事务仍然需要显式理解 `identity_source` 与外部关系。subclass 并不会消除这些分支，也不会替代数据库 CHECK。

如果三个 subclass 只用于把 `identity_source` 分支改写成 Python dynamic dispatch，而没有显著的 subtype-specific constructors、字段或行为，STI 会增加：

- SQLAlchemy polymorphic mapper 配置。
- subclass field 与数据库 nullable column 的类型差异。
- `MappedAsDataclass` inheritance 的初始化复杂度。
- bulk mutation 绕过 subclass method 时的额外认知负担。

当前推荐先使用：

```text
Single table
+ Single HumanInputContact ORM model
+ HumanInputContactIdentitySource enum
+ Database CHECK constraints
+ Contact Directory service lifecycle methods
```

如果未来 subtype 出现大量独有字段或真正的多态行为，可以在不改变单表数据库结构的前提下升级为 SQLAlchemy STI。

建议仅在以下条件同时出现时重新评估 STI：

- 多个核心操作可以由 entity 自身完成，而不是依赖跨 aggregate 的 service transaction。
- 各 subtype 对这些操作具有稳定、不同的实现和 invariant。
- 业务代码大多消费具体 subtype 或共同多态接口，而不是跨全部 Contact 做集合查询与 projection。
- subclass 带来的类型收窄足以抵消 mapper、nullable column 和 bulk operation 的复杂度。

#### Effect of the Platform workspace association

`HumanInputPlatformContactWorkspaceEntry` 是只适用于 `ORGANIZATION_ACCOUNT` Contact 的 subtype-specific association，但它本身不足以改变 inheritance 结论。

在当前单表方案中，entry 直接引用统一的 `HumanInputContact.id`，Contact Directory service 负责校验 referenced Contact 的 `identity_source`。JTI 可以让 entry 外键直接指向 Organization Contact subtype table，从而获得更强的数据库引用约束，但会让统一 Contact 查询和 polymorphic loading 长期承担额外复杂度。

只有当多个 subtype-specific relation、字段和约束共同出现，使独立 subtype table 成为自然 aggregate boundary 时，才值得重新评估 JTI。单个 Platform allow-list association 不足以抵消其查询成本。

### 9.3 Domain variants

不使用 ORM inheritance 不代表领域层只能处理弱类型 row。

Contact Directory service 可以将 `HumanInputContact` row 转换为明确的 domain variant，或提供按 lifecycle 命名的窄操作：

```text
OrganizationAccountContact
WorkspaceMemberContact
ExternalContact
```

这样可以在 domain/service 层表达生命周期差异，同时保持 persistence query 简单。

## 10. Rejected or superseded directions

### 10.1 HumanInputContact.scope

不保留。此前 `scope` 只重复表达 `tenant_id` nullability，无法区分 `WORKSPACE_MEMBER` 与 `EXTERNAL`，也没有清晰表达 lifecycle owner。

### 10.2 Generic HumanInputContactWorkspaceEntry

不推荐。Workspace Contact 已由 membership 表达，External Contact 已由 workspace-owned identity 表达，只有 EE Platform Contact 需要额外 workspace allow-list。

通用 entry 会重复保存：

- membership existence
- workspace ownership
- resolved API type

### 10.3 Persisted workspace kind

不持久化 `WORKSPACE / PLATFORM / EXTERNAL` kind。

原因：

- `WORKSPACE` 由 current membership 解析。
- `PLATFORM` 由 EE Platform allow-list 解析。
- `EXTERNAL` 由 `identity_source=EXTERNAL` 和 workspace ownership 解析。
- 持久化 workspace kind 会形成第二份事实来源。

### 10.4 Identity anchor plus concrete owner tables

当前不推荐。该方案可以使用普通 1:1 owner tables，并不要求 SQLAlchemy joined-table inheritance；公共
profile 搜索也可以只查询 anchor table。它的主要收益是让 owner relation 更显式，但当前模型使用逻辑外键，
实际 lifecycle transaction 仍由 Contact Directory service 负责，而 owner-specific query 与完整性检查会增加
额外 join。当前三个 variant 的独立字段不足以抵消这部分复杂度，因此先选择单表 discriminator。

### 10.5 Separate Contact tables without a shared table

不推荐。该方案会迫使 IM binding、principal 和 endpoint 使用 polymorphic reference，或在每个引用点保存 owner kind，增加调用方认知负担。

## 11. Current-state deletion and historical data

当前 Contact 被 hard-delete 后：

- `contact_id` 不再解析为有效 current Contact。
- pending task submit 必须失败。
- form definition 仍可在有效 token 和 task 状态允许时读取。
- 历史 workflow、task、principal、endpoint 和 audit 使用冻结 snapshot 展示。
- 相同 Account 或 Email 后续创建的新 Contact 使用新的 Contact ID。
- 新 Contact 不继承旧 Contact 的 pending task authorization。

Contact Directory service 必须按 `identity_source` 执行 lifecycle：

| Identity source | Workspace removal behavior |
| --- | --- |
| `ORGANIZATION_ACCOUNT` | 只修改 membership / Platform allow-list，不删除 Contact |
| `WORKSPACE_MEMBER` | hard-delete Contact 与 current-state child records |
| `EXTERNAL` | 不受 membership removal 影响；由 External Contact delete 操作 hard-delete |

## 12. Current recommended model

当前推荐的最小概念集合：

| Concept | Responsibility |
| --- | --- |
| `HumanInputContact` | 所有 current Contact identity 的统一稳定 ID、公共 profile 和 identity source |
| `HumanInputContactIdentitySource` | 标识 identity 来源和 lifecycle owner |
| `HumanInputPlatformContactWorkspaceEntry` | EE Organization Contact 的 workspace allow-list |
| `tenant_account_joins` | Workspace membership 权威来源 |
| `HumanInputIMBinding` | Organization default binding 与 workspace override |
| Contact Directory service | 创建、删除、Promote、Demote、type resolution 与 row-shape enforcement |

## 13. Implementation guidance

领域与 API 行为已经冻结，剩余选择均限制在实现内部：

1. EE Organization Contact 的 eager / lazy materialization 由 enterprise adapter 决定，但不得改变 Organization directory 的完整性或 Account-backed Contact 唯一性。
2. Account eligibility 复用现有 Account 状态策略；不可用 Account 不得被新配置选择或提交 pending task。Canonical row 是否保留是内部策略，workspace resolver 仍只返回 `WORKSPACE / PLATFORM / EXTERNAL / ABSENT`。
3. Account-backed Contact profile 是 Account current-state projection，不提供独立的 Human Input profile edit；External Contact profile 仍由 workspace Contact 管理面维护。
4. Promote / Demote 必须锁定对应 membership / Platform entry owner，在同一事务内写入目标状态，并按 desired state 保持幂等。读取仍以 membership 优先，修复路径删除冗余 Platform entry。
5. Contact hard-delete 只删除 current-state children，包括 Platform workspace entry、current IM binding / override 与其他可重建状态。历史 sync result、Approver Grant、Delivery Endpoint、Submission 与 AuditEvent 继续使用冻结 snapshot。
6. 删除后的 Contact 不再通过 current Contact API 展示；历史 workflow、task 与 audit 只使用 snapshot，不新增 deleted-contact current projection。
7. 初版沿用当前 type projection 查询与 B-tree indexes；后续索引调整以真实查询计划和运行指标为依据。
8. 当前继续使用单表、单 ORM model。只有出现能够由 entity 自身封装、且多个 subtype 对同一行为提供稳定可替换实现时，才重新评估 SQLAlchemy STI。

## 14. Decision summary

- Contact identity 与 workspace-local type 必须分离。
- EE Organization Account Contact 生命周期绑定 Account。
- EE Workspace / Platform 是同一 Contact 相对于 workspace 的角色。
- CE / SaaS Workspace Member Contact 生命周期绑定 membership，移除时 hard-delete。
- External Contact 生命周期绑定 workspace 管理记录，删除时 hard-delete。
- Platform Contact 需要专用 workspace allow-list，而不是通用 workspace entry。
- 外部 `HumanInputContactType` 保留，但作为 query projection 解析。
- 所有 Contact identity 使用同一张 `human_input_contacts` 表和统一 ID namespace。
- 内部 `identity_source` 明确 identity 来源与 lifecycle owner，不等同于外部 workspace type。
- 当前使用单表、单 ORM model、显式 enum 与数据库 CHECK，不使用 SQLAlchemy inheritance。
- Contact 唯一约束继续使用 `(tenant_id, account_id)` 与 `(tenant_id, normalized_email)`；EE
  Organization Account Contact 由锁住稳定 owner 后的事务保证唯一性。
- hard-delete 后只保留历史 snapshot，不保留 current Contact tombstone。
