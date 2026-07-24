## Context

Human Input v2 的领域规则已经分别在 `hitl-im-contact-domain-discovery` 和 `human-input-v2-api-contracts` 中收敛，当前仓库也已有 API stub、Pydantic DTO 与 SQLAlchemy model。现有实现基础仍存在三个结构性问题：

- `api/core/human_input_v2/entities.py` 主要提供 enum 与 identifier，尚未承载领域行为和不变量。
- Contact lifecycle、IM revision、OTP concurrency、submission uniqueness 等规则主要写在 ORM constraint 和 docstring 中，容易在 service/controller 中再次实现。
- API contract tasks 以 DTO/controller 为起点，缺少稳定的 domain-to-persistence boundary。

本 change 先建立领域核心与 persistence contract。后续 Contact management、Email approval、IM control-plane、authenticated approval、migration helper 和 EE adapter change 都依赖这里定义的模型与事务语义。

## Goals / Non-Goals

**Goals:**

- 固定 Contact Directory、IM Control Plane、Approval Runtime 的 bounded context 与依赖方向。
- 用纯 Python domain objects 表达 identity、resolution、grant、proof、submission 和 revision 等业务概念。
- 把 recipient resolution、current-state authorization 和 effective IM binding 封装为深模块。
- 把并发不变量下沉到 aggregate-oriented persistence ports 与 SQLAlchemy adapter。
- 使核心业务规则可通过不依赖 Flask 和 SQLAlchemy 的单元测试验证。
- 为现有 SQLAlchemy stub 增加与领域模型一致的 schema migration 和 mapping tests。

**Non-Goals:**

- 不填充 workspace、web、service API controller stub。
- 不接入真实 Email、IM provider 或 Celery delivery worker。
- 不实现 EE protobuf 或 enterprise backend adapter。
- 不实现 Human Input v1 → v2 node-data migration helper。
- 不重写现有 Human Input v1 domain/service。

## Decisions

### 1. Domain、transport 与 persistence 使用不同模型

领域对象放在 `api/core/human_input_v2/`，不得依赖 Flask、Flask-RESTX、SQLAlchemy model 或 controller DTO。Pydantic 可以用于不可变值对象的输入校验，但 domain public API 不接受 controller request model，也不返回 response model。

SQLAlchemy model 继续作为 persistence record，由 repository adapter 显式映射到 domain object。现有 `api/controllers/common/human_input_v2_contracts.py` 只保留 transport contract，不成为领域模块依赖。

放弃直接把 ORM class 当 aggregate root 的方案，因为它会让 lazy loading、session lifecycle、column nullability 和 transport serialization 泄漏到业务规则中。

### 2. 按业务知识拆分模块，而不是按执行阶段拆分

总体职责分配以行为依赖为主轴：局部不变量和生命周期由 rich state model 持有；需要组合多个 current snapshot 的规则由 pure domain service 持有；I/O 与事务由 application handler 编排；锁、CAS、唯一约束和冲突翻译由 repository adapter 持有。

目标 bounded context 如下：

```text
api/core/human_input_v2/
  contact_directory/
  approval/
  im_integration/
  shared/
```

context 内的模块按被隐藏的业务知识命名，例如 `recipient_resolution.py`、`submission_authorization.py`、`sync_reconciliation.py`；不强制每个 context 都机械创建 `entities.py / policies.py / ports.py / errors.py` 四件套，也不为每一个执行步骤创建一个 class。

`services/human_input_v2/` 中的 application handler 负责 orchestration，provider、database、queue 等 side effect 通过 ports 注入。不得建立一个同时处理 Contact CRUD、IM sync、recipient resolution、OTP 和 form submission 的大 `HumanInputV2Service`，也不得形成 `Load -> Resolve -> Authorize -> Commit -> Resume` 每一步一个 pass-through service 的时间分解。

Domain 内部对象丰富程度按知识所有权决定：

| 概念或行为 | 归属 |
| --- | --- |
| `NormalizedEmail`、typed ID、subject key | value object / factory |
| Contact owner/source 合法组合 | `Contact` entity / factory |
| workspace Contact type | `ContactDirectoryPolicy` pure policy |
| recipient canonicalization | `RecipientResolver` pure domain service |
| form lifecycle | `HumanInputForm` rich aggregate，不增加独立 `FormLifecycle` |
| current submission authorization | `SubmissionAuthorizer` pure domain service |
| OTP lifecycle | `OTPChallenge` rich state model / separate aggregate |
| integration revision token | immutable value object |
| integration configuration transition | `IMIntegration` aggregate |
| sync matching | `SyncReconciler` pure domain service |
| atomic commit、lock 与 CAS | repository adapter |
| delivery / resume orchestration | application handler |
| list / detail | dedicated query/read model |

### 3. Contact identity 与 workspace Contact type 分离

`Contact` 是 canonical identity，持有不可变 `identity_source` 和 owner reference。`WORKSPACE / PLATFORM / EXTERNAL / ABSENT` 是 `ContactDirectoryPolicy.resolve_for_workspace(...)` 的结果，不是 Contact subclass，也不写回 `identity_source`。

External Contact 的 normalized email、organization boundary 和 lifecycle validation 在 domain factory/policy 中完成。跨 Contact 的唯一性与 member/platform facts 由 application service 通过一个 request-scoped directory snapshot 提供，domain 不直接查询 Account 或 membership 表。

### 4. Recipient resolution 是单一深模块

`RecipientResolver` 接收：

- immutable `RecipientSpecification` sequence；
- current tenant/organization Contact snapshot；
- optional current initiator；
- effective delivery capability snapshot；
- debug override context。

它一次性返回 `ResolvedApprovalPlan`，其中包含 canonical approver、matched sources、subject snapshot、delivery endpoint plan 和 rejected recipient facts。调用方不得自行执行 normalized email matching、dedup、Contact upgrade 或 endpoint selection。

同一个 canonical subject 只能生成一个 approver grant，但可以拥有多个 matched source 和多个 delivery endpoint。

### 5. Form submission 与 proof session 使用不同并发边界

`HumanInputForm` 是 approval aggregate root，负责 active state、grant membership、selected action validation 和 first-success transition。状态转换直接属于 Form，不增加只转发状态的独立 `FormLifecycle`。

Form 的领域方法返回 transition decision，不提前宣称数据库已经完成提交；只有 repository transaction 成功后，application handler 才能对外报告 submission 已完成。Form 是逻辑一致性边界，但不要求每次操作加载全部 grants、endpoints、delivery attempts、OTP challenges 和 audit events。提交路径只重建当前操作需要的 Form state、target grant、relevant endpoint 和 frozen definition。

`ApproverGrant` 与 immutable endpoint plan 属于 form 创建结果，但 Grant 表示创建时的候选审批资格，不等同于当前提交权限；Endpoint 只表示通知或交互落点，不等同于身份或授权。

`OTPChallenge` 是独立 proof-session aggregate，以 `(form_id, approver_grant_id)` 为业务作用域，负责 resend interval、send limit、attempt limit、expiry 和 invalidation。OTP challenge 不直接提交 form，也不能单独证明 grant 当前仍有效。

`DeliveryAttempt` 和 `AuditEvent` 是 append-oriented facts；delivery failure 不改变 form status，audit snapshot 不参与当前授权。

### 6. Submission authorization 先解析当前 Actor，再提交聚合

Proof-specific verifier 负责把 raw OTP、session、trusted EndUser context 或 IM callback evidence 转换成不可复用的 `VerifiedProof`。`SubmissionAuthorizer` 不接受 raw credential；它接收 form/grant snapshot、`VerifiedProof` 和 immutable `AuthorizationContext`，返回 `AuthorizedSubmission` 或 domain rejection。

`AuthorizationContext` 由一个 tenant-scoped repository operation 一次性加载，至少包含当前 Contact、email、Account、workspace availability 和 relevant IM binding。Authorizer 不能只依赖 form 创建时 snapshot，也不直接访问数据库。

授权采用明确的 snapshot 语义：只要主体在 submission transaction 读取到的 `AuthorizationContext` 中有效，本次提交即可继续；Contact、email、membership 或 binding 在该 context 读取后发生的并发变化，不追溯性否定本次提交。Repository 应通过一个聚合读取或明确的事务隔离保证 context 内部一致，不为 Contact 或 Binding 增加额外 version、fingerprint 或跨聚合锁。

成功路径在一个数据库事务内完成：

1. 锁定当前 Form，并确认仍可提交；
2. 加载 `AuthorizationContext`，验证 proof 并生成 `AuthorizedSubmission`；
3. 由 Form 生成 submission transition；
4. 写入 `submission_authorized` audit event；
5. 插入唯一 form submission；
6. 将 form 状态转换为 `SUBMITTED`；
7. 提交事务后再 enqueue workflow resume。

First-success 同时由三个层次表达：Form aggregate 拒绝无效状态转换；repository adapter 使用 Form row lock、唯一 submission constraint 和原子事务；application handler 组织 authorization、commit 与 post-commit resume。后到请求统一映射为稳定的 already-completed domain error。

第一版采用简单的 `commit -> enqueue resume`。不引入 transactional outbox；enqueue 失败不得回滚已提交的 Submission，必须记录 tenant/form/workflow run identifiers。Resume operation 必须按 form/run identity 幂等，具体失败补偿沿用现有 runtime 机制或作为后续增强。

### 7. IM Integration 是 CAS aggregate，sync run 是独立异步 aggregate

`IntegrationRevisionToken` 是由 `integration_id + config_version` 组成的 immutable value object，不是独立 aggregate。`IMIntegration` 负责 provider、provider tenant identity、credentials revision 和 replacement/rotation decision。更新与删除必须携带完整 revision token，repository adapter 执行带条件的数据库 CAS。

单个 Integration 同时最多允许一个 active sync。创建 sync run 时 repository adapter 锁定 Integration row、检查 active run 并创建新 run；并发触发不得创建第二个 active run。Worker 对同一个 `sync_run_id` 的重试必须幂等。

`IMSyncRun` 保存启动时捕获的 integration ID 与 revision。Application handler 读取 provider/current snapshot，`SyncReconciler` 只执行纯匹配并返回 `ReconciliationPlan`，repository adapter 在应用 plan 前再次比较 current revision；不匹配时只记录 stale result，不更新 current identity 或 binding。由于 active sync 唯一，本期不增加独立 `sync_generation`。

Contact effective binding resolution 使用 workspace override、organization binding、Email fallback 的明确优先级，不由 controller 或 provider adapter决定。

### 8. Persistence ports 按事务能力定义，不按表定义 CRUD

核心 ports 提供 use-case-oriented atomic operations，例如：

- load one directory snapshot for recipient resolution；
- save Contact lifecycle mutation；
- compare-and-swap IM Integration configuration；
- replace current OTP challenge while locking the grant scope；
- load one coherent submission `AuthorizationContext`；
- commit authorized submission once；
- append delivery/audit facts。

不为每张表创建通用 repository，不暴露 SQLAlchemy `Session`、ORM instance 或 query expression。需要多表一致性的操作由一个 adapter 方法拥有完整事务。Application handler 决定调用顺序和 post-commit effect，repository 不重新实现 recipient matching、authorization 或 sync reconciliation 规则。

只读 list/detail surface 使用 dedicated query service/read model，可以从数据库 projection 映射到 application read model，不要求为了无行为查询重建完整 aggregate。

### 9. Domain errors 使用稳定 taxonomy

Domain errors 表达业务拒绝原因，不继承 HTTP exception。Controller 和 worker adapter 负责将它们映射为 HTTP status、API error code、retry policy 或 audit reason。

首批 taxonomy 至少覆盖：

- contact unavailable / absent / cross-organization；
- duplicate or conflicting contact identity；
- no valid recipients；
- unsupported recipient value；
- form completed / expired；
- grant not matched；
- stale identity proof；
- OTP cooldown / send limit / attempt limit / expired；
- stale integration revision。

### 10. 测试按 domain、mapping、concurrency 分层

- Pure domain tests 不启动 Flask、不创建数据库 engine。
- Mapping tests 验证 domain object 与 ORM record 的双向转换及 structured JSON types。
- Repository contract tests 验证 tenant scope、atomic write 和 rollback。
- PostgreSQL CI integration tests 验证 nullable uniqueness、row locking、CAS、OTP replacement 和 concurrent first-success；SQLite 测试不作为这些语义的充分证明。

## Risks / Trade-offs

- [Domain object 与 ORM record 分离增加 mapping 代码] → 只在 aggregate boundary 显式映射，并用 contract tests 防止字段漂移；换取 domain tests 不依赖数据库。
- [首个 change 看起来不直接交付 API] → 将完成条件限定为可被后续垂直切片直接调用的 domain API、persistence adapter 和 migration，避免只产出空抽象。
- [过度拆分 repository port] → 以事务不变量而不是表数量决定 port 方法；对只读 projection 可直接使用 dedicated query service。
- [现有 v1 service 与 v2 domain 同时存在] → 保持 version boundary，禁止 v2 adapter 调用 v1 submission primitive；只复用无版本语义的基础设施。
- [SQLite 与 PostgreSQL 行为不同] → 把关键并发与 nullable uniqueness 场景明确标记为 CI-only PostgreSQL integration coverage。
- [授权后 Contact 或 Binding 并发变化] → 明确采用 transaction authorization snapshot 语义；只要求 context 内部一致，不增加 current-state version 或跨聚合锁。
- [active sync worker 崩溃后 run 长期停留] → 第一版保证创建与重试幂等；active run 超时恢复或人工终止作为运维增强单独处理。
- [Submission commit 后 enqueue resume 失败] → 接受第一版的短暂可靠性窗口；Submission 保持成功，resume 幂等并记录可操作日志，不在本 change 引入 outbox。
- [Domain 过度充血或 Service 过度拆分] → 只有拥有局部不变量和生命周期的对象采用 rich model；跨多个 current facts 的规则收敛到少量 pure domain service，每个 module 必须隐藏明确的业务知识。

## Migration Plan

1. 先加入 pure domain modules、tests 和 error taxonomy，不改变现有 runtime route。
2. 加入 repository ports、SQLAlchemy adapters 和 v2 schema migration；API stub 仍返回 not-implemented。
3. 运行 mapping、repository contract、lint 和 type checks，确认现有 v1 tests 不受影响。
4. 后续 implementation changes 逐个将 Contact、Email approval、IM 和 authenticated approval controller 接到新 application services。
5. 若上线前需要回滚，本 change 尚无生产调用路径；可先停止后续 adapter rollout，再回退未被生产数据使用的 schema migration。

## Open Questions

- PostgreSQL repository contract tests 在当前仓库中应复用哪一组 CI fixture，还是新增 Human Input v2 专用 fixture？
- EE Organization Contact 创建时用于序列化 null-owner uniqueness 的稳定 lock owner，最终使用 deployment singleton、enterprise organization record 还是 IM Integration row？该决策必须在 Contact repository adapter 实现前收敛。
