## Context

Form Core 负责 local lifecycle，OTP Proof Session 负责 Email proof，Contact Directory 与 IM Control Plane 提供 current identity facts。Submission 仍需要一个独立模块把这些 immutable snapshots组合成 authorization decision，并由 repository/application layers在正确 transaction/post-commit 边界执行。

若 controller 手动执行 `load -> verify -> authorize -> insert -> transition -> resume`，锁、rollback、actor semantics 和 stale-proof rules 会泄漏到每个 transport。

## Goals / Non-Goals

**Goals:**

- 建立 pure `SubmissionAuthorizer`，只接收 verified proof 与 coherent current facts。
- 保持 grant、endpoint、proof 与 actor 四个概念无隐式转换。
- 保证每个 form 最多一个 successful submission/audit/transition transaction。
- 明确 authorization snapshot concurrency semantics。
- 将 resume 调度放在 commit 后，并使用 idempotent identity 与 actionable logging。

**Non-Goals:**

- 不验证 raw session、OTP code 或 IM callback payload；proof-specific adapters 在边界外完成验证。
- 不实现 HTTP controller、real provider adapter 或 transactional outbox。
- 不增加 Contact/Binding versions、fingerprints 或跨 aggregate locks。
- 不改变 recipient resolution 与 form creation semantics。

## Decisions

### 1. Authorizer 是 pure cross-snapshot decision module

`SubmissionAuthorizer` 接收 Form/grant/endpoint snapshot、typed `VerifiedProof` 和 immutable `AuthorizationContext`，返回 `AuthorizedSubmission` 或 typed rejection。它不访问 database，不执行 commit，也不接受 raw credential。

Account session、trusted EndUser、Email OTP 和 IM identity proofs 分别映射为 Account、EndUser 或 EmailAddress actor。IM identity 只作为 proof evidence；Contact-backed IM approval actor 必须是 current Dify Account。

### 2. AuthorizationContext 一次性、coherent、tenant-scoped

Repository 在 submission transaction 中加载 current Contact、Account、workspace availability、Email 与 relevant effective IM binding facts。Authorizer 基于该 context 重校验 current identity，而不是只信任 form creation snapshot。

Context 加载后发生的 Contact/Email/membership/binding change 不追溯性否定当前 transaction；不执行第二次 version check。这避免跨 aggregate locking，同时要求 adapter 保证 context 内部一致。

### 3. First-success 由三层不同抽象共同保证

- Form aggregate 拒绝非 active transition。
- Repository 锁定 Form row，写 authorization audit、unique submission 和 form status，并在一个 transaction 内 commit。
- Application handler 仅在 commit 成功后 enqueue resume。

后到 request 统一返回 stable already-completed result。Unique-conflict race 被 adapter翻译，而不是泄漏 `IntegrityError`。

### 4. Resume 使用简单 commit-then-enqueue

第一版不引入 transactional outbox。Enqueue failure 不回滚 submission，必须记录 tenant/form/workflow identifiers。Resume port 以 form/workflow run identity 幂等，重复 dispatch 安全。

### 5. Submission ports 围绕 atomic use case

Port 提供 coherent context load、append rejection audit 和 `commit_authorized_submission_once`，不提供 submission/audit/form generic CRUD。Submission 与 audit records 使用 explicit mappers；adapter不重新实现 domain authorization。

### 6. Submission schema 独立迁移

本 change 添加 submission 与 audit tables/revision，并复用 Form Core records。PostgreSQL CI tests验证 concurrent Email/IM submission、rollback 和 authorization snapshot semantics；SQLite 仅用于非并发 contract tests。

## Risks / Trade-offs

- [Commit 后 enqueue 存在可靠性窗口] → Submission 保持成功，resume identity 幂等并记录可操作日志；outbox 作为后续增强。
- [AuthorizationContext 读取后可能变旧] → 明确 transaction snapshot contract，避免隐含 retries/version checks。
- [跨多个 context 的输入较丰富] → 使用 capability-specific immutable facts，不传 ORM graph 或通用 dict。
- [Adapter transaction 较深] → Public port保持单一 atomic operation，把 rollback/locking complexity从所有 callers 拉到底层。

## Migration Plan

1. 添加 proof/actor distinctions、authorizer 和 stale-proof domain tests。
2. 添加 submission/audit mappers 与 repository contract tests。
3. 添加 schema revision、SQLAlchemy adapter 和 first-success concurrency tests。
4. 添加 submit handler、post-commit ordering/failure/idempotency tests。
5. 运行 targeted suites、Human Input v1 regression、lint 和 type checking。
6. 回滚时停止 submission routes，确认无 dependent production data，再 downgrade submission revision；Form/OTP tables保留。

## Open Questions

- Transactional outbox、resume retry scheduling 和 operational repair UI 留给后续 reliability change。
