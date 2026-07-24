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

目标模块边界如下：

```text
api/core/human_input_v2/
  contact_directory/
    entities.py
    policies.py
    ports.py
    errors.py
  approval/
    entities.py
    recipient_resolution.py
    authorization.py
    ports.py
    errors.py
  im_integration/
    entities.py
    policies.py
    ports.py
    errors.py
  shared/
    identifiers.py
    values.py
```

`services/` 负责 orchestration，provider、database、queue 等 side effect 通过 ports 注入。不得建立一个同时处理 Contact CRUD、IM sync、recipient resolution、OTP 和 form submission 的大 `HumanInputV2Service`。

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

`HumanInputForm` 是 approval aggregate root，负责 active state、grant membership、selected action validation 和 first-success transition。`ApproverGrant` 与 immutable endpoint plan 属于 form 创建结果。

`OTPChallenge` 是独立 proof-session aggregate，以 `(form_id, approver_grant_id)` 为业务作用域，负责 resend interval、send limit、attempt limit、expiry 和 invalidation。OTP challenge 不直接提交 form，也不能单独证明 grant 当前仍有效。

`DeliveryAttempt` 和 `AuditEvent` 是 append-oriented facts；delivery failure 不改变 form status，audit snapshot 不参与当前授权。

### 6. Submission authorization 先解析当前 Actor，再提交聚合

`SubmissionAuthorizer` 接收 form/grant snapshot、verified proof 和 current identity state，返回 `AuthorizedSubmission` 或 domain rejection。它必须重新校验当前 Contact、email、Account、workspace availability 和 IM binding，不能只依赖 form 创建时 snapshot。

成功路径在一个数据库事务内完成：

1. 写入 `submission_authorized` audit event；
2. 插入唯一 form submission；
3. 将 form 状态转换为 `SUBMITTED`；
4. 提交事务后再调度 workflow resume。

唯一 submission constraint 是最终并发防线。后到请求统一映射为稳定的 already-completed domain error。

### 7. IM Integration 是 CAS aggregate，sync run 是独立异步 aggregate

`IMIntegration` 负责 provider、provider tenant identity、credentials revision 和 replacement/rotation decision。更新与删除必须携带完整 `(integration_id, config_version)` token。

`IMSyncRun` 保存启动时捕获的 integration ID 与 revision。应用 reconciliation 前，repository adapter 必须再次比较 current revision；不匹配时只记录 stale result，不更新 current identity 或 binding。

Contact effective binding resolution 使用 workspace override、organization binding、Email fallback 的明确优先级，不由 controller 或 provider adapter决定。

### 8. Persistence ports 按事务能力定义，不按表定义 CRUD

核心 ports 提供 use-case-oriented atomic operations，例如：

- load one directory snapshot for recipient resolution；
- save Contact lifecycle mutation；
- compare-and-swap IM Integration configuration；
- replace current OTP challenge while locking the grant scope；
- commit authorized submission once；
- append delivery/audit facts。

不为每张表创建通用 repository，不暴露 SQLAlchemy `Session`、ORM instance 或 query expression。需要多表一致性的操作由一个 adapter 方法拥有完整事务。

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

## Migration Plan

1. 先加入 pure domain modules、tests 和 error taxonomy，不改变现有 runtime route。
2. 加入 repository ports、SQLAlchemy adapters 和 v2 schema migration；API stub 仍返回 not-implemented。
3. 运行 mapping、repository contract、lint 和 type checks，确认现有 v1 tests 不受影响。
4. 后续 implementation changes 逐个将 Contact、Email approval、IM 和 authenticated approval controller 接到新 application services。
5. 若上线前需要回滚，本 change 尚无生产调用路径；可先停止后续 adapter rollout，再回退未被生产数据使用的 schema migration。

## Open Questions

- PostgreSQL repository contract tests 在当前仓库中应复用哪一组 CI fixture，还是新增 Human Input v2 专用 fixture？
- EE Organization Contact 创建时用于序列化 null-owner uniqueness 的稳定 lock owner，最终使用 deployment singleton、enterprise organization record 还是 IM Integration row？该决策必须在 Contact repository adapter 实现前收敛。
