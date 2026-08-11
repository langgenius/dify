## Context

当前代码已经具备 Provider-neutral `IMDirectory`、current `IMIdentity` / `IMBinding` domain values、Integration revision、single-active-run repository 和一个初步的 pure `SyncReconciler`。但现有 `ReconciliationAction` 只保存 `match_kind` 与若干 persistence ID，repository 在 apply 时才决定是否创建 identity/binding、如何分配 ID、如何分类 sync result。这使 plan 不是完整决策，executor 仍然持有领域策略。

现有行为还有四个直接缺口：unmatched Provider entry 不会创建 `IMIdentity`；identity profile 更新会被 product result 归为 `Skipped` 而没有独立 identity change history；所有 scope 的 binding 被压缩成一个 identity-to-binding map，和修正后 PRD 允许的 identity reuse 冲突；email map 对重复 Contact 或重复 Provider email 没有显式 ambiguity 处理。

这个 change 位于已有边界之间：

- Provider adapter 只负责在事务外读取一个 complete immutable Directory；失败不返回 partial entries。
- Contact Directory 与 application / persistence adapter 负责把 CE/SaaS workspace 或 EE deployment 映射为 `current_bindings`、`reconciled_binding_ids`、`contacts_for_email_matching` 和 Organization-scoped Redis write lock key。
- pure planner 只比较输入并生成 plan，不理解 edition、workspace、deployment、ORM、credentials、Provider raw payload 或 transaction。
- executor 只执行 plan 已经编码的语义，并在一个事务中提交 current state、reconciliation change-log records、product sync results 和 run counters。
- reconciliation-backed workspace console Flask transport 由本 change 接入同一个 Dify-owned application service 和 composition factory；Dify EE trusted internal transport、EE Kratos handler 与 Protobuf contract 暂留给后续 EE transport change。

规划接口见同目录的 `reconciliation_api_stub.py`。stub 是 design artifact，不进入 production import graph；所有字段都显式记录语义，实施时应以现有 shared identifiers、domain enums 与 Provider contracts 替换 planning-only surface。

## Goals / Non-Goals

**Goals:**

- 使用 `ReconciliationRunRef` 统一表达 sync run、完整 Integration revision 与 Provider namespace。
- 让相同 immutable input 生成结构上相等且 operation 顺序稳定的 plan，不访问数据库、网络、时钟、随机数或日志设施。
- 为每个 Directory entry 创建或刷新 current `IMIdentity`，再基于逻辑上的 post-upsert state 对账 IM bindings。
- 为 IM identity 与 IM binding mutation 记录 before/after change-log records，同时保持 `Added / Not Matched / Failed / Removed / Skipped` 是 product-facing sync results。
- 将 Organization 定义、Contact email-match admission、允许本次同步对账的 binding IDs 和 Organization-scoped Redis write lock 完全留在 application / reader / executor boundary。
- 让同一 Organization 的 reconciliation 与其他 IM current-state 写入共享线性化边界，并让 worker retry 幂等。
- 对 pure planner 建立 statement 与 branch coverage 均为 95% 的独立 unit-test gate。
- 对本 change 的完整 production-module scope 分别建立 90% unit-test coverage 与 80% integration-test coverage gate；数据库相关 unit tests 使用 SQLite，integration tests 使用 Testcontainers 启动 PostgreSQL。

**Non-Goals:**

- 不修改 Provider adapter 的 Directory 字段、pagination/traversal 或 Provider-specific raw payload contract。
- 不在 pure planner 中实现 Contact lifecycle、workspace-relative Contact type、Email delivery fallback 或 effective runtime channel policy。
- 不在本 change 实现 Dify EE trusted internal handler、EE Kratos handler 或 Protobuf contract。
- 不把 reconciliation plan 暴露为公共 HTTP resource，也不要求本期持久化整份 plan。
- 不自动创建 External Contact，不通过同邮箱把 External Contact 提升、合并或改写为内部 Contact。
- 不以 chunked partial apply 取代初始 atomic apply；超大目录的 resumable execution 留给有规模证据后的独立 change。

## Terminology

本 change 复用项目已有术语，不为同一概念引入额外同义词：

| Term | Meaning |
| --- | --- |
| `DirectoryEntry` | Provider Directory 本次读取到的一个用户条目；它不是持久化的 IM identity。 |
| `IMIdentity` | Dify 持久化的 Provider 用户身份，按 Provider user ID 匹配。 |
| `IMBinding` | Contact 与 IM identity 之间的持久化关系。 |
| Organization binding | Organization 级默认 IM binding；这是 loader/executor 侧术语，不进入 pure planner input。 |
| workspace override | Workspace-scoped IM binding；它可以复用 IM identity，但不参与 Organization binding 的自动 email 匹配。 |
| `current_identities` | 在获取序列化写锁后，从 `ReconciliationRunRef` 对应的 Integration namespace 加载的完整 current `IMIdentity` 快照；包含有 binding 和无 binding 的 identity，不包含其他 Integration、历史记录或已删除记录。 |
| `current_bindings` | 引用 `current_identities` 的全部 current IM bindings，包括 workspace overrides。 |
| `reconciled_binding_ids` | `current_bindings` 的子集；本次 sync 使用这些 binding 进行自动匹配、占用判断、保留与 replacement。集合成员关系只是一份 run-local input fact，不是 IM binding 的持久化类型或状态。子集由 loader 按 scope 决定。 |
| `contacts_for_email_matching` | loader 已允许参与自动 email 匹配的 Contact facts；该集合不决定已有 IM binding 是否继续有效。 |
| reconciliation change log | 每个 IM identity 或 IM binding mutation 对应的 append-only before/after record；它与 product-facing sync results 分开存储。 |
| Organization-scoped Redis write lock | 以稳定 Organization ownership key 为粒度的粗粒度 Redis lock；CE/SaaS 使用 workspace ownership key，EE 使用 deployment ownership key。它不进入 pure planner input。 |
| reconciliation-protected write | 任何会改变 `ReconciliationRunRef`、active sync-run state 或 `ReconciliationInput` facts 的 application write，包括 Integration configuration/revision、current IM identities、current IM bindings，以及用于 Contact email-match admission 的 Contact/Account/membership records。 |
| guarded Organization IM write unit of work | 只在成功获得 Organization-scoped Redis write lock 后创建的可写 transaction boundary；所有 reconciliation-protected repository mutations 只能通过该 boundary 执行。 |

所有 Contact–IM identity 关系统一称为 IM binding。在 pure planner 内，scope 差异只表现为 `current_bindings` 和 `reconciled_binding_ids` 的集合关系。

## Decisions

### 1. Use one public composite planner with internal identity and IM binding phases

对外只暴露 `generate_plan(ReconciliationInput) -> ReconciliationPlan | BlockedReconciliation`。实现内部可以拆成 input validation、identity indexing、post-upsert projection、binding decision、deletion closure 与 sync-result generation，但这些阶段不是可独立调用的 application interfaces。

Plan 按依赖顺序包含：

1. `identity_upserts`：为完整 Directory 中的每个 entry 创建、更新或 refresh identity。
2. `binding_mutations`：使用逻辑上的 post-upsert identity state 创建、替换或删除 IM binding。
3. `identity_deletions`：只在引用目标 identity 的所有 current IM bindings 已被删除或替换后，删除不在完整 Directory 中的 identity。
4. `sync_results`：保存 planner 已决定的 product-facing sync result records。

选择 composite planner 是为了隐藏跨阶段共享的一对一约束、ambiguity group 和 replacement decision。备选方案是 identity plan apply 后重新读取数据库，再生成 binding plan；该方案会形成 temporal decomposition，增加中间态、重试语义与规则泄漏，因此不采用。

### 2. `ReconciliationRunRef` is the only run namespace carried into the planner

`ReconciliationRunRef` 包含 `sync_run_id`、`IntegrationRevisionToken` 和 `provider`。它不包含 workspace ID、deployment mode、credential、provider tenant raw value 或 ORM owner record。

完整 Integration ID + configuration version 防止旧 run 应用到被替换或重新配置的 Integration；Provider discriminator 防止同一个 numeric revision 被错误解释到另一 Provider namespace。apply 必须先验证 persisted run capture，再锁定并验证 current Integration revision。

该名称强调它是 run-bound immutable reference，而不是 authentication token 或独立的 opaque CAS token。

### 3. Input loading owns Organization scope and automatic email-match admission

`ReconciliationInput` 直接保存 shared Provider contract 中的 immutable `DirectoryEntry`，并包含 current identities、全部 current IM bindings、允许本次同步对账的 binding IDs，以及用于 email matching 的 Contact facts。planner 不引入字段重复的 Directory-entry DTO：

- `current_identities` 是 run 对应 Integration namespace 内完整且未分页的 current identity snapshot，包含有 binding 和无 binding 的 identity；每个 `identity_id` 与 Provider user ID 必须唯一。由于 planner 将未出现在 complete Directory 中的 current identity 视为 deletion candidate，loader 不得按 binding 状态、Contact match 或分页条件过滤该集合。
- CE/SaaS reader 只把当前 workspace 内 active account-backed Contact 投影到 `contacts_for_email_matching`。
- EE reader 将当前 deployment Organization 内所有 active Account-backed canonical Contacts 投影到 `contacts_for_email_matching`。某个 Contact 即使在特定 workspace 中呈现为 `Platform Contact`，仍以同一个 canonical Contact 参与 reconciliation；workspace-relative Contact type 与 Platform allow-list 不进入 planner input。
- External Contact、disabled/deleted Account、跨 Organization Contact 和不可解释的 Contact 不进入 `contacts_for_email_matching`。
- `current_bindings` 包含引用 current identities 的全部 IM bindings，包括 Organization bindings 与 workspace overrides。
- `reconciled_binding_ids` 只包含本次 sync 负责比较的 Organization binding IDs；一个 binding 的 Contact 不要求同时出现在 `contacts_for_email_matching`。

planner 因此不导入 `ContactIdentitySource`、`IMBindingScope`、membership、Platform allow-list 或 edition flags。workspace override 可以复用同一 identity，但它的 ID 不出现在 `reconciled_binding_ids`，因此不参与 Organization binding 的自动 email 匹配；当 identity 不在 complete Directory 时，引用它的每个 current binding 都必须先删除或替换。

`contacts_for_email_matching` 只约束新建或 replacement binding 的 email-match target，不表达已有 binding 的 retention policy。只要 identity 仍在 complete Directory，planner 就按 Provider user ID 保留 `reconciled_binding_ids` 中对应的已有 binding，不因关联 Contact 缺席 `contacts_for_email_matching` 而删除。Contact hard-delete 及其 current binding/override 清理由 Contact lifecycle transaction 负责；reconciliation input 不以 Contact 缺席 email-match input 补偿该职责。

备选方案是把 Contact lifecycle 与 `IMBindingScope` 交给 planner，再由 planner 解释 edition/scope。该方案会把 deployment policy 泄漏进纯算法，也会让 CE/SaaS/EE 分支进入 planner coverage matrix，因此不采用。

### 4. Every complete Directory entry becomes or refreshes one current identity

Provider user ID 是 `(provider, provider_tenant)` namespace 内的 identity natural key。planner 对每个 entry 生成恰好一个 `IMIdentityUpsert`：

- natural key 不存在时生成 `CREATE`；
- display name、email 或 normalized email 变化时生成 `UPDATE`，并保存 deterministically ordered `changed_fields`；
- profile 未变化时生成 `REFRESH`，只推进 last-seen run/time，不伪装成 profile update。

没有 email、没有 Contact match 或发生 Contact ambiguity 都不会阻止 identity create/update。这样 unmatched identity 仍可被搜索、人工 binding 或用于后续 override。

`DirectoryEntry` 保留 adapter 返回的 `provider_user_id`、`display_name` 与 `email`。pure planner 负责从 `DirectoryEntry.email` 派生 `NormalizedEmail | None`，用于比较和自动匹配，并把该派生值显式写入 `IMIdentityUpsert`；executor 不重新执行 normalization 或 matching policy。

Directory contract 不包含 Provider raw payload，因此 reconciliation input、identity change log 与 stub 都不要求 raw payload。若未来确有诊断需求，应通过独立 Provider evidence contract 扩展，而不是让 application layer 绕过 shared Directory abstraction。

### 5. Automatic IM binding is conservative and one-to-one

本节中的“可对账 binding”是 `binding.binding_id in reconciliation_input.reconciled_binding_ids` 的简称，不是一种新的 IM binding 类型，也不对应数据库字段或生命周期状态。input loader 在调用 planner 前决定这个集合；当前 scope policy 只把 Organization binding ID 放入其中。workspace override 仍然作为完整 current state 的一部分出现在 `current_bindings` 中，但不进入该集合，因此不参与自动 email matching、Contact 占用判断或 replacement candidate 选择。

planner 将 `reconciled_binding_ids` 中的 binding 视为本次自动匹配使用的一对一 binding graph：仍由 Directory identity 引用的 binding 被保留并占用其 Contact；指向 absent identity 的 binding 才可能被 replacement 或删除。这个集合不限制 referential cleanup：当一个 identity 不在 complete Directory 中时，planner 必须先关闭 `current_bindings` 中引用它的全部 binding，包括不在 `reconciled_binding_ids` 中的 workspace overrides，然后才能删除 identity。

具体匹配机制与优先级由 `specs/human-input-v2-im-control-plane-core/spec.md` 中的 `Provider user ID matches a bound identity`、`Unique email fallback matches a Contact available for binding` 与 `Email fallback matches no Contact` scenarios 定义。

### 6. Structural corruption blocks the plan; duplicate Contact email input is an explicit recovery case

以下情况说明 input contract 或 current-state invariant 已损坏，planner 返回 deterministically ordered `BlockedReconciliation`，executor 不执行任何 current-state mutation：

- Directory 内重复 `provider_user_id`；
- current identities 在同一 namespace 内重复 natural key；
- `current_bindings` 中的 binding ID 重复，或 binding 没有指向 `current_identities` 中存在的 identity；
- `reconciled_binding_ids` 不是 current binding IDs 的子集，或该子集对 identity/Contact 违反当前一对一约束。

缺失 email、多个 Directory entries 同邮箱和 Contact 已被仍在 Directory 中的 identity 绑定属于正常业务 ambiguity，不阻断整份 plan；它们产生 stable `Not Matched` result。

`contacts_for_email_matching` 中多个 Contacts 使用同一 normalized email 不是正常业务 ambiguity，而是违反 input loader 应保证的 email uniqueness invariant。为避免异常 Contact 数据阻断其他 identity 同步，planner 对该情况保留显式的保守恢复：不选择任何 Contact，并产生 `Not Matched(ambiguous_contact_email)`。

planner 同时为每个 collision group 生成一个 deterministically ordered `PlannedReconciliationWarning`，包含 deterministic warning key、affected IM identity refs 与全部 collision Contact IDs。executor 在 phase-one identity upsert 后解析新旧 identity refs，形成 `ResolvedReconciliationWarning`；coordinator 记录 structured warning 时包含 sync run、Integration、collision group count、warning key、全部对应 `IMIdentityId` 与 `ContactId`。日志不包含 raw email 或 Contact profile。planner 本身仍不执行 logging I/O。

上述恢复规则是 whole-plan blocker policy 的一个明确例外。它允许系统继续同步 identity，但不会把重复 Contact 当成健康状态，也不会静默选择 tuple order 中的第一项。

Directory adapter 返回 `DirectoryReadFailure` 时 coordinator 不调用 planner，并单独将 run 终结为 failed。由于没有 complete snapshot，系统绝不能规划 absent identity deletion。

### 7. Plans use new-identity references and deterministic operation keys

Pure planner 不生成 UUID，也不读取时钟。新 identity 使用 `NewIMIdentityRef(provider_user_id)`；executor 在 phase-one create 时通过 production `uuidv7()` 分配一个 `IMIdentityId`，并保存到单个 execution-local `Mapping[NewIMIdentityRef, IMIdentityId]`。后续 binding、sync result、change-log record 与 warning 写入通过一个局部 helper 按需解析 reference，不引入第二套 public 或 persisted materialized plan。

同一 mapping 也用于 `PlannedReconciliationWarning.identity_refs`。每个 `NewIMIdentityRef` 只能在对应 identity create 时分配一次 ID；后续解析不得重新生成 UUID。因此 warning data 对新 identity 保持 pure reference，而最终 structured log 始终使用 executor 解析后的 `IMIdentityId`；`contact_ids` 已经来自 immutable input，不需要 executor 重新匹配。

每个 mutation 与 result 都包含从 run-local semantic key 派生的 deterministic `operation_key`。初始 atomic implementation 通过 Organization-scoped Redis write lock 排除并发 writer，并以 sync-run terminal-state CAS 和 `(sync_run_id, operation_key)` 唯一约束实现数据库侧幂等，防止 retry、lease loss、分块或 supervisor 演进重复写入 change-log/result records。

executor 可以分配 persistence primary key 和 commit timestamp，但不得重新选择 Contact、重新执行 email matching、改变 mutation kind 或修改 result bucket。任何 operation precondition 不成立都返回 `PRECONDITION_FAILED`，不在 repository 内即时重算另一份 plan。

### 8. Reconciliation change log and product sync results are separate records

新增 append-only reconciliation change log，每个 current-state mutation 写入一条 record：

- subject kind：`identity` 或 `binding`；
- operation：`create`、`update`、`refresh`、`replace` 或 `delete`；
- deterministic operation key 与 reason code；
- resolved identity / binding / Contact identifiers；
- mutation 前后的最小 immutable snapshot；
- sync run、Integration 和 commit timestamp。

`refresh` 可以保留为低成本 record 或按 retention policy 聚合，但不能和 profile `update` 混为一谈。change log 不保存 credentials、Provider raw payload、client state 或 transport material。

现有 `HumanInputIMSyncResult` 继续表达 product-facing IM binding reconciliation：

- `Added`：创建 IM binding，或 replacement 后形成的新 binding；
- `Removed`：每个删除/替换的 IM binding 一条，保留 stable removal reason；
- `Not Matched`：identity 已同步但本次无法安全自动关联；
- `Skipped`：Directory entry 对应的可对账 binding 保持不变；
- `Failed`：Directory、plan blocker、stale revision、precondition 或 apply diagnostic。

删除一个没有 current binding 的 absent identity 只写 identity deletion change-log record，不增加 `Removed`。replacement 同时产生一条 `Removed` 和一条 `Added`，因此 run count 是 result records count，不保证等于 Directory entry count。

备选方案是扩展 `HumanInputIMSyncResult` 同时承担 identity change log。该方案会使 identity profile update 被迫映射到 binding bucket，并破坏 existing latest-run UI counts，因此不采用。

### 9. Directory I/O stays outside the write transaction; load, plan, and apply share one unit of work

worker orchestration 固定为：

1. 读取 persisted run 与 encrypted Integration configuration，构造 Provider adapter。
2. 在数据库写事务外调用 `read_directory()`；成功必须是 complete Directory。
3. 解析稳定的 Organization ownership key，获取带 owner token、有限 TTL 与 acquisition timeout 的 Organization-scoped Redis write lock，并重验 `ReconciliationRunRef`；获取失败时 fail closed。
4. 开启短数据库事务并加载完整 current input；不对 identity、binding 或 Contact 集合执行显式 `SELECT ... FOR UPDATE`，而是捕获 apply 所需的 exact revision/precondition values。
5. 在内存中调用 pure planner；Contact email collision 产生 structured warning data，但不执行 logging I/O。
6. executor 在确认 Redis lock 仍由当前 owner 持有后，按 plan phase 使用 conditional DML 执行 current-state mutations，解析 warning identity refs，写 change-log/result records，并更新 run counters 与 terminal state；数据库唯一约束与 exact preconditions 防止 stale writer 提交。
7. 一次提交全部成功状态；任一 current-state、change-log、result write 或 Redis lock ownership check 失败时整体回滚。数据库 commit 或 rollback 完成后才释放 Redis lock。
8. coordinator 根据 executor 返回的 resolved warnings 记录 structured warning，包含全部相关 `IMIdentityId` 与 `ContactId`。

plan generation 虽然在 transaction callback 内被调用，仍是独立的 IO-free function。Organization-scoped Redis write lock 覆盖 input load、plan generation 与 transaction commit，因此不需要锁定大量 current-state rows；数据库 precondition checks 仍用于拒绝未遵循该 lock 的 Contact lifecycle write 或 lease loss 后的 stale apply。

Redis write lock 只负责跨进程 writer serialization，不能替代数据库事务。coordinator 获得 lock 后仍必须开启一个 transaction：input loader 在该 transaction 提供的同一 consistent snapshot 上读取所有相关表，executor 在同一 transaction 中原子写入 current state、change log、sync results 与 run state；commit 或 rollback 完成后才能释放 Redis lock。

stale Integration 或 blocked plan 不修改 identity/binding。它们的 terminal diagnostic 由明确的 failure transaction 提交，不能与一个部分成功 apply 混合。

### 10. All reconciliation-protected writes share one Organization-scoped Redis write lock

single-active-run 防止两个 manual sync 同时执行，但还不足以防止 manual Organization binding、workspace override、Contact/Account/membership lifecycle 或 Integration replacement 与 apply 竞争。因此所有 reconciliation-protected writes 必须先获取同一个粗粒度 Redis write lock。同步持锁期间，其他 writer 必须在执行任何相关 SQL 之前等待该 lock；超过 bounded acquisition timeout 时返回 retryable outcome。普通只读查询不需要获取该 lock。

lock key 必须基于稳定的 Organization ownership key，而不是可被 replacement 改变的 Integration ID：CE/SaaS 映射当前 workspace ownership key，EE 映射 deployment ownership key。该映射由 composition/application boundary 完成；pure planner、`ReconciliationInput` 和 `ReconciliationPlan` 不携带 Redis、workspace、deployment 或 edition 信息。

application/persistence boundary 只在 lock acquisition 成功后创建可写 unit of work，使 protected repository mutations 不能绕过 lock。该 abstraction 使用 redis-py ownership token、有限 TTL、bounded acquisition timeout，以及由持有线程显式执行的 ownership check / TTL extension。它不得复用 migration-only `DbMigrationAutoRenewLock`，也不得在 Redis 不可用、lock acquisition timeout 或 ownership loss 时退化为无锁写入。Directory network I/O 在获取 lock 之前完成；lock 从 current input load 前一直持有到数据库 commit 或 rollback 完成。

数据库 adapter 不对 complete identity/binding/Contact snapshot 获取逐行锁。它使用完整 Integration revision、plan 中的 exact before snapshots、conditional update/delete row counts、foreign keys、natural-key uniqueness 和 `(sync_run_id, operation_key)` uniqueness 判断 apply 是否仍然安全。对实际 mutation target 执行 DML 时由数据库获取的短期写锁是正常事务行为；禁止的是在 input load 阶段预先锁定完整目录对应的大量 rows。lock ownership 丢失或任一 conditional write 未命中时，当前 transaction 必须回滚并返回 retryable lock-loss 或 stable `PRECONDITION_FAILED` outcome，repository 不得即时重算 plan。

Contact lifecycle 不被强行路由到 IM repository，但凡写入的 Contact、Account 或 membership record 会改变 `contacts_for_email_matching` projection，就属于 reconciliation-protected write，并必须通过同一个 guarded write unit of work。executor 对 create/replace target 的 Contact precondition recheck 是 lease loss 或非 application writer 的防御性兜底，不替代 write blocking。target 不再满足 captured precondition 时，当前 plan 以 `PRECONDITION_FAILED` 结束，而不是创建一个已过期 binding；该 precondition 不用于重新判断已有 binding 的 retention。

### 11. Application services remain transport-neutral while workspace Flask adapters are delivered

本 change 提供：

- `IMSyncService`：create-or-get active run、worker dispatch 和 latest-run query；
- `IMContactSyncCoordinator`：Directory success 后协调 unit of work、input loader、planner 和 executor；
- `ContactIMBindingService`：manual Organization binding 与 workspace override command，共享 Organization-scoped Redis write lock；
- repository/query ports 与 composition factory。

本 change 同时替换 `api/controllers/console/workspace/human_input.py` 中由上述 services 支撑的 501 handlers，包括 manual sync create/latest/latest-results、synchronized identity search、Organization binding 与 workspace override。handlers 复用现有 Pydantic HTTP contracts，仅负责 workspace authorization/scope resolution、request validation、DTO mapping 和 stable HTTP error translation，不构造 repository，也不编排 reconciliation transaction。

Dify EE trusted internal handler、EE Kratos handler 与 Protobuf contract 暂不在本 change 实现。未来 EE transport 必须调用同一个 Dify Python application service，不得实现第二套 planner、worker 或 persistence。

### 12. Layered coverage and database test backends are release gates

planner unit tests不得创建 Flask app、database engine、SQLAlchemy model、Provider adapter 或 fake repository。目标模块 statement coverage 与 branch coverage 都必须达到 95%，至少覆盖：

- empty Directory 与 empty current state；
- identity create、update、refresh、delete；
- unmatched identity 仍被创建；
- provider user ID 优先于冲突 email；
- missing/no-match email、Provider email ambiguity，以及违反 input invariant 的 Contact email collision recovery；
- multiple identities 竞争一个 Contact；
- Contact 已通过可对账 binding 绑定到仍在 Directory 中的 identity 时不被抢占；
- identity absent from complete Directory 时的 binding replacement；
- `current_bindings` / `reconciled_binding_ids` 子集关系和 workspace override reuse；
- invalid binding、duplicate Provider ID、duplicate current natural key；
- deterministic ordering、相同 input 的 deterministic output；
- 把 plan 投影到逻辑状态后再次 reconcile 不产生 binding mutation。

除了 planner 的独立 gate，本 change 新增或修改的全部 production modules 构成固定的 project coverage scope。CI 必须显式列出该 scope 中的每个 production module，不能只统计被测试实际 import 的文件，也不能通过删除低覆盖文件缩小 denominator。CI 分别采集并校验：

- unit-test coverage 不低于 90%；开启 branch measurement，并使用 unit suite 自己的 coverage data；
- integration-test coverage 不低于 80%；开启 branch measurement，并使用 integration suite 自己的 coverage data；
- 两份 coverage data 可以额外合并用于报告，但 merged coverage 不能代替任一独立 gate。

pure planner tests继续完全 infrastructure-free。需要验证 mapper、repository、service 或 controller persistence behavior 的 unit tests 使用项目现有 `sqlite_engine`、`sqlite_session_factory` 或 `sqlite_session` fixtures，不启动 PostgreSQL，也不连接共享外部数据库。SQLite 无法证明的 PostgreSQL transaction、conditional DML、concurrency、constraint 和 migration behavior 必须放在 `api/tests/test_containers_integration_tests`，通过 `testcontainers.postgres.PostgresContainer` 启动隔离 PostgreSQL；Redis exclusion、TTL extension 与 ownership loss 使用同一 Testcontainers integration environment 的隔离 Redis 验证。integration suite 不得以 SQLite 替代这些语义。

repository/service tests覆盖 transaction rollback、revision stale、operation-key idempotency、Directory failure、worker retry 和 current Contact precondition。Organization-scoped Redis exclusion、lease loss、concurrent writers、PostgreSQL conditional writes、constraints 与 migrations 由 Testcontainers integration tests 覆盖。

## Risks / Trade-offs

- [单事务处理完整目录可能延长锁持有时间] → Directory network I/O 必须在事务外完成；planner 使用 O(n) indexes；在真实规模证明 atomic apply 不可接受前不引入 partial apply。
- [新增 change log 增加写放大与存储量] → change log 只保留最小 before/after records 与 stable identifiers，不复制 raw payload；后续以独立 retention policy 管理，而不影响 current-state correctness。
- [同邮箱 ambiguity 会增加 `Not Matched`] → 这是有意的安全取舍；planner不得依赖输入顺序自动选中 Contact，管理员仍可使用同步后的 identity 手工 binding。
- [replacement 规则可能错误迁移人工 binding] → replacement 只允许旧 identity 已从 complete Directory 消失且形成唯一一对一 email match；指向仍在 Directory 中 identity 的 binding 永不自动抢占。
- [粗粒度 Organization Redis lock 扩大 manual write contention] → 当前每个 Organization 只允许一个 IM Integration，写入频率低；Directory I/O 放在 lock 外，lock 只覆盖内存 planning 与短 DB transaction。Redis acquisition/ownership failure 时 fail closed，并由 worker retry 恢复。
- [`align-human-input-specs-with-prd-corrections` 尚未同步到 main specs] → 本 change 必须允许同一 `IMIdentity` 出现在多个 scope 的 IM bindings 中；只有 reconciled Organization bindings 构成本次自动匹配的一对一集合，不得对全部 Organization bindings 与 workspace overrides 强加全局 provider identity → Contact 唯一约束。

## Migration Plan

1. 新增 reconciliation change-log table、operation key 唯一约束和必要的 additive result metadata；不删除现有 sync result 或 current-state 列。
2. 先实现 immutable input/plan values 与 pure planner，以 95% statement/branch unit tests固定行为。
3. 实现 Organization-scoped Redis write lock abstraction、transaction-owned input loader 与 plan executor，保留现有 Integration revision 和 current models，使用 exact conditional precondition checks，且不批量锁定 identity/binding/Contact rows。
4. 将现有 repository 内的 `_apply_action` matching policy移入 planner；repository 只执行 typed mutations和 projection writes。
5. 实现 coordinator、Celery worker、manual binding service 和 composition factory，并接入 reconciliation-backed workspace Flask handlers；复用或按需补全现有 Pydantic request/response mapping。
6. 对已有 current identity/binding 不做历史 change-log backfill；第一次新 reconciliation 从当前 snapshot 生成 forward-only change history。已有 sync results 保持只读可查询。
7. 运行 SQLite-backed unit suites 与 Testcontainers PostgreSQL integration suites，分别满足 90% 与 80% project coverage gate；同时运行 type、lint 检查，并证明纳入范围的 workspace IM handlers 不再返回 generic 501 response。

回滚时可以切回旧 application wiring 并保留 additive change-log table；新 current identities/bindings 仍兼容现有 schema。不得在回滚中删除已经写入的 change-log records 或 sync results。

## Open Questions

- reconciliation change log 是否需要在后续 change 提供管理员查询 API，还是本期仅保留数据库与内部 observability 查询；这不影响 change log 的写入 contract。
- 真实 Provider directory 规模达到什么阈值后需要持久化 plan 与 resumable chunk apply；本期默认 atomic apply，并通过 apply duration、row count 与 lock wait 指标收集证据。
