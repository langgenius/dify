# Builder 完整 Workflow 原生测试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Builder 使用原生运行时测试完整生成的 Workflow，包含 New Agent；风险操作在实际执行位置等待明确确认，恢复与复测不重复已执行副作用。

**Architecture:** 保留原生 Workflow/Agent/Code 运行时，以服务端测试上下文串联 effect 授权、共享预算和持久化 continuation。普通运行与已有 v1 策略保持兼容。四张票共用领域契约，三条执行基座 lane 在契约稳定后并行，再统一 Local/Dev 验收。

**Tech Stack:** Python 3.13、Pydantic v2、SQLAlchemy/PostgreSQL、Celery/Redis、Graphon 0.7 系列、FastAPI/Pydantic AI Agent backend、Go CodeSandbox、Linux Docker、GitHub Actions、Helm/Kubernetes。

**Spec:** [已批准设计](../specs/2026-10-14-builder-unified-native-testing-design.md)，批准提交 `1bd826e4a27e95b88b4310f34b7c923467ac6941`；用户答复“认可书面设计，编写实施计划”。产品源码基线 `13368bd5fa91a613c65ccc1bd328fcadac732cf2`。

**Execution method:** 用户已指定 GPT 子 agent 并行执行；不使用 Claude。本文与三个子计划共同组成一次计划审阅对象，批准后按下列依赖执行，无需再次选择执行方法。本文是计划，不是已运行的测试报告。

**执行更新（2026-10-15）：** 用户明确撤销 Graphon 0.8 的全部迁移与协议改动，恢复以 Dify main 当前锁定的正式 `0.7.0` 为基线。后续中立控制协议只在 0.7 源码上开发、审查和验证；0.8 的测试结果不能作为 0.7 的验收证据。保留与版本迁移无关的授权、防重放、恢复和 Agent 工作；不修改已安装包，不以 sibling 源码替代正式依赖制品。

## Global Constraints

- ENG-1117 继续暂停。前端不实现；前端缺口先记录，待后端/API 全部在 Dev 验证后再处理前端工单。
- 不扩大 Builder 可以创建的 App 模式。不维护另一个“允许测试节点”清单。
- `api/core/` 只做现有调用者的必要适配；新策略、编排和协议实现放在现有领域所有者及 `api/services/dify_builder/` 下。
- 不建立第二个 Workflow executor。不能改 `.venv` 安装文件或以旧版 sibling checkout 替代 Graphon 0.7。
- 普通业务运行维持原有行为；带 Builder 测试标识的执行缺少上下文时不能切到普通运行。
- 只有 checkpoint 已持久化后才能报告可恢复等待；不得把 approval/configuration/interaction 等待改成成功或普通失败。
- 凭据由原有运行时服务端解析；对话、确认摘要、日志、截图和 Trace 不包含 secret 明文。
- 真实 I/O 在数据库事务外；重复投递、修复和输出校验重试不能产生新的 effect intent 来绕过已用额度。
- Mock/Dry Run 是明确选择的模式，不能以模拟成功代替真实通过。Destructive 操作本期不由 Builder 执行。
- 所有后端/Go 测试在合格 Linux Docker 或正常 CI 中执行；容器集成测试仅正常 CI，宿主不运行 backend import、uv install、pytest 或 Go runtime 测试。
- 不使用活动 API 源码覆盖、临时生产猴子补丁或 `kubectl set image/patch`；正常 CI/制品与 Helm 部署，验实际 Pod。
- 不新建未经审阅的 `privileged:true` 服务或广泛 host cgroup 挂载；受信 supervisor 仅使用明确的最小 capability 与已委派的 cgroup 子树，用户代码/作业保持非特权。
- 本次批准工程推进，不自动消费真实发送/读取授权；具体外呼准备好后按账户/目标/次数确认。

## Review Focus

1. JSON boolean/array/file 与同名字符串不能经摘要或序列化变成同一输入：C01、NW1/NW7、I01 的 typed-boundary 测试。
2. 同一副作用已被服务商接受，但本地结果或 queue ack 丢失：C02/C03 的 crash-after-claim、I01 的未知结果链路。
3. 用户在确认页面停留期间，凭据/权限/Agent snapshot 或依赖改变：C02/C04、A1/A6、CS4 的 drift 测试。
4. Agent 在可见 Tool 调用前执行 OAuth、知识检索、CLI bootstrap 或 stdin：NW4/NW5、A2/A3/A4/A5 的零提前 I/O 测试。
5. 并行 Iteration 的一条分支等待，另一条仍在运行或取消：C03、NW3/NW6、A6、I01 的共享预算/暂停/清理测试。

## 计划包、任务归属与依赖

| 计划 | 主责 | 独立产物 |
| --- | --- | --- |
| 本文 C01–C04 | 1196/1184 共享 owner | 契约、ledger、continuation、认证 API 与兼容迁移 |
| [原生 Workflow 子计划](2026-10-14-builder-native-workflow-testing.md) | 1196，NW 任务 | 原生图运行、真实能力守卫、Graphon 控制流和父子恢复 |
| [New Agent 子计划](2026-10-14-builder-new-agent-testing.md) | 1177/1184，A 任务 | 资源发现/绑定、Agent 协议、内部调用、独立测试 lease 与实际 Local runtime 隔离 |
| [CodeSandbox 子计划](2026-10-14-builder-code-sandbox-testing.md) | 1189，CS 任务 | 请求隔离、预算/取消、实际服务制品和 Code/Jinja adapter |
| 本文 I01–I03 | root 集成 | 完整注册表覆盖、Local/Dev 证据、每票交付判断 |

先完成 C01 和 NW1 的只含契约交付，再并行 C02、A1/A2、CS1；C03 在 C02/NW1 后实现原生持久化端口；C04 在 C02/C03 后暴露 API。A7 在 A2 契约后实现现有 Go Local runtime 的真实测试 scope，A4 使用其能力，A6 完成贯通验收；不能把所有 runtime 都返回 unavailable 当作交付。NW 的运行/能力适配、A 的 runtime/bridge 与 CS 的 transport 在接口稳定后汇合。I01 不能在任一必需 lane 未完成时宣称整图通过。

同一 worktree 内只允许一个 agent 修改同一文件。C lane 独占 `models/dify_builder*`、migration、公开 Console route/DTO、`authorization.py`、`lifecycle.py`、`state_store.py`、`child_invocations.py`；NW 独占 `node_factory.py` 最终组合和通用运行适配；A 独占 Agent bridge/inner route、目录/绑定、`dify-agent/` 和 A7 的 `dify-agent-runtime/`；CS 独占 sandbox 仓库与 Code/Jinja collaborator。`node_policy.py`、共享 config、CI workflow 和依赖锁由 root 顺序集成，不同时派给两人。

每任务按红 → 绿 → 独立规格审查 → 独立质量审查 → commit。审阅者只认可实际运行的 Linux/CI 证据；集成层测试不接受 transport mock 冒充真实框架/网络。普通测试回归在各 lane 首次触及其 owner 时运行，后续仅因新变化或失败补跑。

## 共享类型和调用约定

以下是 C01 要创建的精确接口，其他计划消费这些名称。`contracts.py` 不导入 Flask、SQLAlchemy、Graphon 或 Agent SDK；共享 DTO 是领域协议，不承载 secret 或客户端声明的权限。

```python
from typing import Literal
from pydantic import BaseModel, ConfigDict, JsonValue

class FrozenDTO(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", hide_input_in_errors=True)

class NativeTestContextRef(FrozenDTO):
    policy_version: Literal["builder-native-test-v1"] = "builder-native-test-v1"
    request_id: str
    invocation_id: str
    context_digest: str

class OperationKey(FrozenDTO):
    invocation_id: str
    occurrence_path: tuple[str, ...]
    cursor: int

class EffectIntent(FrozenDTO):
    key: OperationKey
    kind: Literal["code", "model", "http", "tool", "oauth", "knowledge", "file", "shell", "bootstrap"]
    resource_ref: str
    implementation_revision: str
    account_ref: str | None
    target: JsonValue
    parameters: JsonValue
    input_digest: str
    capability_digest: str

class DispatchPermit(FrozenDTO):
    kind: Literal["dispatch"] = "dispatch"
    permit_id: str
    attempt_id: str
    operation_id: str
    expires_at: str

class ApprovalWait(FrozenDTO):
    kind: Literal["waiting"] = "waiting"
    pending_operation_id: str
    wait_reason: Literal["approval", "configuration", "interaction"] = "approval"

class RecordedResult(FrozenDTO):
    kind: Literal["recorded"] = "recorded"
    operation_id: str
    result_ref: str

class PolicyStop(FrozenDTO):
    kind: Literal["stop"] = "stop"
    reason_code: str

EffectDecision = DispatchPermit | ApprovalWait | RecordedResult | PolicyStop

class EffectReceipt(FrozenDTO):
    operation_id: str
    attempt_id: str
    outcome: Literal["completed", "failed", "unknown", "not_dispatched"]
    result_ref: str | None

class CheckpointRef(FrozenDTO):
    checkpoint_id: str
    payload_digest: str
```

C01 为上述 ID/digest/cursor/时间增加严格长度、类型、非负数、UTF-8、UTC 校验，不能只保留示例中的裸 `str`。operation 的 occurrence path 使用持久化的 node/container/iteration 分量；cursor 来自持久化逻辑游标，不使用 worker ID、dispatch attempt 或新模型 retry key。

服务接口：

```text
authorization.EffectAuthorizationService.before_call(*, ref: NativeTestContextRef, intent: EffectIntent) -> EffectDecision
authorization.EffectAuthorizationService.record_outcome(*, permit: DispatchPermit, outcome: Literal["completed","failed","unknown","not_dispatched"], result_ref: str | None) -> EffectReceipt
lifecycle.NativeTestLifecycleService.pause(*, ref: NativeTestContextRef, checkpoint: CheckpointRef, pending_operation_ids: tuple[str, ...], expected_generation: int) -> WaitingReceipt
lifecycle.NativeTestLifecycleService.resume(*, actor: Actor, request_id: str, expected_generation: int, idempotency_key: str) -> ResumeReceipt
lifecycle.NativeTestLifecycleService.cancel(*, actor: Actor, request_id: str, idempotency_key: str) -> CancellationReceipt
```

`WaitingReceipt(request_id, invocation_id, generation, checkpoint, pending_operation_ids, wait_reason)`、`ResumeReceipt(request_id, generation, dispatch_id, status)`、`CancellationReceipt(request_id, generation, status, operation_states)` 均由 C01 在 `contracts.py` 定义：wait_reason 为 approval/configuration/interaction，resume status 为 queued/running/waiting/terminal；cancel status 为 cancelling/cancelled/unknown；operation_states 是 operation ID 到 ledger outcome 的映射。外部 response 不返回可信 `context_digest`、完整执行 payload 或 permit。

`ApprovalWait` 名称保留为共用控制 DTO，但 `wait_reason` 显式区分三类等待：configuration 通过原有配置 owner 完成并重验，interaction 通过原生表单提交；两者不能被“批准外呼”满足。C02 的 pending action 保存 category 和真实配置/表单引用，不能伪造一项 effect 来批准原生 HumanInput。

`NativeStatePort`、`ChildInvocationPort`、`NativeCheckpointPayload`、`ResolvedNativeTestContext`、`NativeWorkflowOutcome` 由 NW1 的 `runtime_contracts.py` 定义，C03 实现这些端口；C01 不反向依赖 NW1。A lane 定义独立 wire DTO，由 API `agent_bridge.py` 映射，不把本模块导入独立 Agent 包。

---

### Task C01：共享领域契约与可信 context 编解码

**Files:** Create `api/services/dify_builder/native_testing/{__init__,contracts}.py`; Test `api/tests/unit_tests/services/dify_builder/native_testing/test_contracts.py` 与现有 context 兼容测试。不改旧 `execution_contracts.py` 的三个 v1 context union/decoder。

**Interfaces:** Produces 本文全部共享 DTO、`operation_digest(key: OperationKey) -> str` 和 `decode_native_ref(raw: JsonValue) -> NativeTestContextRef`。只有服务端 loader 能赋予 ref 权限；decode 只验证结构。Consumes 现有 `canonical_json/canonical_digest`。NW2 单独增加内部 `native_test_required` 与 `native_test_ref` 传递字段，不把 v2 ref 送入旧 restricted admission；required 标记存在而 ref 缺失时必须停止。

- [ ] **Step 1: 写失败测试，覆盖身份稳定及 typed JSON，不测试字段赋值本身。**

```python
def test_occurrence_and_typed_inputs_do_not_alias():
    key = OperationKey(invocation_id="inv-1", occurrence_path=("iteration-1", "0", "tool-1"), cursor=0)
    other = key.model_copy(update={"occurrence_path": ("iteration-1", "1", "tool-1")})
    assert operation_digest(key) != operation_digest(other)
    assert canonical_digest({"input": True}) != canonical_digest({"input": "true"})
    assert canonical_digest({"input": [1, 2]}) != canonical_digest({"input": "[1,2]"})
```

补充负例：NaN/Infinity、bool-as-int cursor、负 cursor、空/超长 ID、畸形 digest、额外 actor/grant 字段、secret 字段和未知 policy_version；旧 restricted/JSON/Gmail context 原样往返且不会变成 native v2。

- [ ] **Step 2: 在合格 Linux 里运行** `uv run --project api --no-sync pytest api/tests/unit_tests/services/dify_builder/native_testing/test_contracts.py -q`；缺模块/decoder 分支应失败，保存 red 日志。
- [ ] **Step 3: 实现 DTO、判别和稳定 key；key 的代码为**：

```python
def operation_digest(key: OperationKey) -> str:
    return canonical_digest(key.model_dump(mode="json"))
```

将可信 authority 检查留给 C02 loader，不因通过 Pydantic 校验而接受客户端权限；直接复用已存在 canonical finite-JSON 实现。

- [ ] **Step 4: 重跑 targeted tests，再跑现有 `test_execution_policy_service.py`、`test_json_tool_execution.py`、`test_real_call_consent_service.py`；均无失败/跳过才通过。**
- [ ] **Step 5: 只提交本任务路径，commit** `feat(builder): define native test scope and effect contracts`。

### Task C02：多操作授权、预算与 append-only dispatch ledger

**Files:** Create `api/models/dify_builder_native_tests.py`, `api/services/dify_builder/native_testing/{repository,authorization,pending_actions}.py`, `api/migrations/versions/2026_10_14_1200-c67e12a904bf_add_builder_native_testing.py`; Modify `api/models/dify_builder.py` 现有 request 的 waiting 状态约束与索引；Test `api/tests/test_containers_integration_tests/core/workflow/test_builder_native_effect_ledger.py`、`api/tests/unit_tests/services/dify_builder/native_testing/test_authorization.py`。

**Interfaces:** Produces `EffectAuthorizationService` 两个精确方法；`OwnedNativeTestLoader.load(*, ref: NativeTestContextRef) -> OwnedNativeTest` 位于 `repository.py`，返回服务端 owner、冻结 revision、权限、resource/credential version、预算及有效 invocation。`OwnedNativeTest` 在同文件定义，不外传秘密。

另提供 `pending_actions.NativePendingActionService.configuration(*, ref, requirements_ref: str, expected_generation: int) -> ApprovalWait` 与 `interaction(*, ref, native_form_ref: str, expected_generation: int) -> ApprovalWait`，分别验证真实配置/表单 owner 并返回对应 wait_reason。新 payload 不接受“已配置/已填表”布尔值；恢复从原有配置/表单 owner 重读事实。尚未配置资源的实际 account/credential version 在配置完成、准备真实调用时才固定；不能在初始 request 中冻结一个不存在的账户。

复用 `DifyBuilderExecutionRequest` 为 request identity；v2 允许 waiting，terminal 仍 sealed，真实终态在 completion summary。新增 grant、operation、attempt、continuation、pending action 表。grant 固定 scope/decision/expiry/次数/费用；operation 唯一键 `(tenant_id, request_id, invocation_id, operation_digest)`；attempt 唯一键 `(operation_id, dispatch_index)`；continuation 唯一键 `(request_id, invocation_id, generation)`。pending action 持久化 approval/configuration/interaction category、owner、version，以及对应 effect/configuration/native-form 引用；configuration 尚未具备实际账户时不冻结一条假账户 effect。所有查询带完整 owner chain。完整业务参数/结果存保护的 execution payload，只在 ledger 记录 hash/ref/脱敏披露。

迁移 down_revision 在当前基线为 `a61e9b2c7d40`；执行前检查实际合并后的唯一 head，若已变则调整父 revision 并重新跑 migration gate。旧 Gmail consent 表及其 CHECK/唯一约束不松绑。

- [ ] **Step 1: 写 CI-only PostgreSQL 竞争/崩溃测试。** 在新模块定义 `ledger_case` fixture：复用现有真实 Flask/Postgres/Redis conftest，创建两个租户、正常 actor、冻结 request/ref、一项待确认 effect；`ledger_case.confirm(max_calls=1,max_dispatches=1)` 仅准备测试 grant，不替代真实 E2E 的用户操作。

```python
def test_duplicate_delivery_does_not_get_second_permit(ledger_case):
    ledger_case.confirm(max_calls=1, max_dispatches=1)
    first = ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent)
    assert isinstance(first, DispatchPermit)
    duplicate = ledger_case.guard.before_call(ref=ledger_case.ref, intent=ledger_case.intent)
    assert isinstance(duplicate, PolicyStop)
    assert duplicate.reason_code == "dispatch_in_progress"
    assert ledger_case.dispatched_attempt_count() == 1
```

同时定义：未批准/拒绝/越权/rotation/drift 0 permit；伪造 kind='code'、resource/capability 或别的 invocation key 0 permit；两个进程竞争只有一个 dispatch；Iteration 两个不同 occurrence 可按批准额度各一次，第三次等待；claim 后崩溃 unknown；已完成结果为 RecordedResult；改参数与同 key 冲突；OAuth 与 business 为明确有界子操作；无事务跨 I/O。

- [ ] **Step 2: 正常 Linux CI 运行** `uv run --project api --no-sync pytest api/tests/test_containers_integration_tests/core/workflow/test_builder_native_effect_ledger.py -q`，记录缺表/原子 claim 不成立的 red。并发测试使用现有 killable process pattern，不用宿主线程假装 PostgreSQL 竞争。
- [ ] **Step 3: 按此顺序实现短事务算法。**

```text
before_call(ref,intent): load complete owners; verify frozen versions and current permissions
validate kind/resource/capability/key against server-owned native binding and persisted cursor
lock request budget + stable operation key; reject changed intent for an existing key
completed -> RecordedResult; active claimed -> PolicyStop(dispatch_in_progress)
uncertain sent -> PolicyStop(outcome_unknown); denied/cancelled -> PolicyStop
approved L1 task + verified isolated code/local-file capability with no new data/egress scope -> bounded task grant
no matching L1/L2 scope -> persist pending operation and return ApprovalWait
matching scope -> reserve shared quota and append spent attempt, commit, return DispatchPermit
record_outcome: verify trusted permit ownership; append outcome/result ref idempotently
conflicting outcome -> refuse; never refund an uncertain attempt or issue it again
```

业务执行方在 permit 提交后才执行 I/O；transport 自带 retry/redirect 也受真实 dispatch 额度控制。opaque invocation 走统一 scope 与披露，不新增逐插件源代码准入清单。

- [ ] **Step 4: targeted unit+Postgres tests、upgrade/downgrade/re-upgrade、旧 consent/execution migration gate 均通过；SQL CHECK 实际拒绝超额和非法状态。**
- [ ] **Step 5: commit** `feat(builder): persist scoped effect approvals and atomic dispatch spends`。

### Task C03：checkpoint、父子调用与可恢复调度

**Files:** Create `api/services/dify_builder/native_testing/{state_store,child_invocations,lifecycle}.py`; Modify `api/tasks/dify_builder_advance_task.py`、`api/schedule/dify_builder_reconcile_task.py` 的 v2 专用分支；Test `api/tests/test_containers_integration_tests/core/workflow/test_builder_native_continuation.py`、`api/tests/unit_tests/services/dify_builder/native_testing/test_lifecycle.py`。

**Dependencies:** C02、NW1。**Interfaces:** `state_store.NativeExecutionStateStore` 实现 NW1 的 NativeStatePort；`child_invocations.NativeChildInvocationService` 实现 NW1 的 ChildInvocationPort；`NativeTestLifecycleService` 实现本文 pause/resume/cancel。现有 task/queue 只传 request/ref/generation 与认证 actor 引用，不传客户端批准布尔值。

- [ ] **Step 1: 创建 `continuation_case` fixture，使用 C02 真实 SQL request 和 fake object-storage fault 注入；另以正常 storage 路径证明真实读回。测试最危险故障点。**

```python
def test_missing_checkpoint_ack_never_reports_resumable_waiting(continuation_case):
    continuation_case.fail_checkpoint_commit()
    receipt = continuation_case.pause_at_pending_effect()
    assert receipt.reason_code == "checkpoint_unavailable"
    assert continuation_case.resumable_event_count() == 0
    assert continuation_case.external_call_count() == 0
```

其余明确用例：双 resume/worker 各一实际 generation；claim 后崩溃、enqueue ack 丢失后恢复投递；已完成子操作读真实 result_ref 而非再次外呼；子 Workflow 等待/完成唤醒同一父；跨租户引用拒绝；取消树停止新 dispatch；过期、权限撤销、snapshot generation 恢复规则；旧 Run 在 Fix 后不可变。

再验证配置与交互的恢复：缺凭据先有 configuration pending action、无 grant/dispatch；正常完成配置后 resolve 实际身份，再准备新的 approval scope；原生 HumanInput 则等待其真实 form submission。批准外呼不能填补配置或替代用户表单答案。`ChildInvocationPort.get_or_create` 显式接收 `input_result_ref: str` 和 `input_digest`，先验证父调用的不可变输入对象 owner/digest，再创建唯一 child。

- [ ] **Step 2: 在正常 CI 运行新 continuation 模块，保存缺少 durable wait/dispatch 的 red。**
- [ ] **Step 3: 实现有确认回执的 checkpoint store 和 continuation 事务。**

```text
commit_checkpoint: validate immutable schema/owner; store protected payload with storage owner
verify payload digest; commit SQL checkpoint ref; only then return CheckpointRef
pause: verify committed checkpoint and pending operations; CAS generation into waiting; emit after commit
resume: verify actor/revision/permission; atomically claim next generation + pending dispatch record
dispatcher: publish same request/generation via existing queue; duplicate deliveries claim only once
worker: reload trusted context; reconstruct same native Run/child operation state; acknowledge generation
cancel: persist cancellation across invocation tree; signal actual runtimes outside SQL; reconcile cleanup
```

使用现有密钥/存储所有者保护模型历史、工具结果、文件引用等实际重建数据；脱敏 receipt 仅作审计。request rows、generation 和可恢复派发记录是权威，Redis lease/事件总线不是唯一事实来源。重投 delivery 可以重复，业务 dispatch 不能因此重复。

- [ ] **Step 4: 正常 CI 的 SQL/storage/queue 失败用例和 native reconstruction 通过，任何 checkpoint 失败均无“可继续”假象；旧 advance/consent task 回归通过。**
- [ ] **Step 5: commit** `feat(builder): persist native test continuations and recoverable dispatch`。

### Task C04：认证 API、批准范围与恢复回执

**Files:** Modify `api/controllers/console/dify_builder.py`、`dify_builder_fields.py`、`api/services/dify_builder/wiring.py`; Create `api/services/dify_builder/native_testing/{api_service,public_contracts}.py`; Test `api/tests/unit_tests/controllers/console/test_builder_native_testing_routes.py` 与 `api/tests/test_containers_integration_tests/core/workflow/test_builder_native_console_api.py`。接口文档与 Pydantic DTO 同步更新，不手写前端组件。

**Dependencies:** C02/C03。**Interfaces:** `NativeTestApiService.start(*,actor,session_id,test_input_id,expected_version,mode,idempotency_key)->NativeTestPublicReceipt`、`get(*,actor,session_id,request_id)->NativeTestPublicReceipt`、`decide(*,actor,session_id,request_id,pending_operation_id,decision,scope_digest,expected_version,idempotency_key)->NativeTestPublicReceipt`；resume/cancel 委托 Lifecycle。actor 从认证上下文重建，公开请求不接受 tenant/actor/ref/permit/执行结果。

公开 v2 资源为现有 session 下的 `/native-tests`，避免更改 Gmail-only v1 路由的 body：POST collection 启动、GET `/{request_id}` 读状态、POST `/{request_id}/decisions` 确认/拒绝、POST `/{request_id}/resume`、POST `/{request_id}/cancel`。共享已有 session SSE 的结构化 v2 execution 事件，包含可重连 event cursor。DTO `schema_version="builder-native-test-v1"` 明确区分版本；不修改 `/system-features`。

`public_contracts.py` 定义完整字段，Pydantic `extra='forbid'`；所有 ID/digest/版本用 C01 严格约束：

```python
class NativeTestStartPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["builder-native-test-v1"]
    test_input_id: str
    expected_version: int
    mode: Literal["native", "mock"]
    idempotency_key: str

class PendingActionDisclosure(BaseModel):
    pending_operation_id: str
    wait_reason: Literal["approval", "configuration", "interaction"]
    version: int
    scope_digest: str | None
    account_label: str | None
    action: str
    target: JsonValue
    parameters_summary: JsonValue
    risk_notice: str | None
    required_configuration: tuple[str, ...]
    native_form_ref: str | None

class NativeTestPublicReceipt(BaseModel):
    schema_version: Literal["builder-native-test-v1"] = "builder-native-test-v1"
    request_id: str
    generation: int
    version: int
    status: Literal["prepared", "running", "waiting", "terminal"]
    wait_reason: Literal["approval", "configuration", "interaction"] | None
    native_run_id: str | None
    native_status: str | None
    pending: tuple[PendingActionDisclosure, ...]
    outcome: Literal["succeeded", "failed", "cancelled", "unknown"] | None
    evidence_refs: tuple[str, ...]
```

Controller response 将 receipt 包装为既有 `fields.base.ResponseModel`；domain service 不依赖 RESTX。`NativeTestDecisionPayload` 的完整字段与 Step 1 中 body 相同但不包含非法 parameters；`NativeTestResumePayload(schema_version,expected_generation,idempotency_key)` 与 `NativeTestCancelPayload(schema_version,idempotency_key)` 只接受这些字段。start 的 expected_version 是会话版本，decision 的 expected_version 是对应 pending action 版本，resume 使用 continuation generation。只允许对 approval category 执行 decision；configuration/interaction 返回专门的配置/表单路径。

- [ ] **Step 1: 建真实认证 wrapper 的 route tests，而不是仅调用 controller 私有函数。**

```python
def test_decision_cannot_replace_effect_parameters(console_case):
    response = console_case.decide({
        "schema_version": "builder-native-test-v1",
        "pending_operation_id": console_case.pending_id,
        "decision": "confirm", "scope_digest": console_case.scope_digest,
        "expected_version": 1, "idempotency_key": "decision-1",
        "parameters": {"recipient": "changed@example.invalid"},
    })
    assert response.status_code == 400
    assert console_case.dispatch_count() == 0
```

`console_case` 在新 CI 模块创建自有 app/session/测试 actor，经正常签名登录与 CSRF wrappers 请求；覆盖未登录/跨租户/无 APP_TEST_AND_RUN、过期/变更 scope、两次同 key 同 receipt、不同 body conflict、批量两次第三次等待、无事务跨凭据/外呼。所有响应和 SSE 均不包含 secret、permit/context_digest 或完整执行状态。

- [ ] **Step 2: 运行 targeted route/真实认证 CI 测试，缺路由/允许多余参数必须 red。**
- [ ] **Step 3: 按 API_SCHEMA_GUIDE 构造 Pydantic v2 payload/response，委托共享 owner 并使用固定脱敏 reason code；读取并确认 pending operation 后才能调用 decide。**

```text
decision endpoint: authenticate -> load actor/session owner -> validate strict body
api_service.decide: reload pending operation/version/scope -> persist explicit decision
return saved receipt; do not accept replacement inputs, credential values or arbitrary graph
resume endpoint: consume decision via lifecycle CAS; return queued/waiting/terminal actual status
```

- [ ] **Step 4: 新 routes/schema/认证集成通过，旧 v1 Gmail/restricted/JSON routes 原样回归，接口文档由同一 DTO 导出。**
- [ ] **Step 5: commit** `feat(builder): expose scoped native test approval and continuation APIs`。

### Task I01：全链路 CI 与节点覆盖完整性

**Files:** Create `api/tests/test_containers_integration_tests/core/workflow/test_builder_unified_native_chain.py`、`api/tests/fixtures/workflow/builder_native_testing/{contract_agent,code_iteration_agent_tool,node_matrix}.json`; Modify `.github/workflows/builder-safe-execution-tests.yml`、`.github/workflows/dify-agent-tests.yml` 与对应正常 reusable CI 调用入口。Test 原有 native suites 全部保留。

**Dependencies:** C01–C04、全部 NW/A/CS 任务的必需交付。**Interfaces:** 以公开 v2 API 驱动运行；native Run/node persistence、实际 Agent backend 测试服务、实际合格 sandbox 和受控 canary 是验证所有者。显式 mock 的外部服务只证明受控业务契约，真实部署/账号调用另列 I02/I03。

- [ ] **Step 1: 写贯通失败测试，在 Code → Iteration(New Agent) → Tool → End 场景使用两个合成合同片段，返回每段 risks/summary，汇总 result。**

```python
def test_approval_resumes_agent_call_without_replaying_effect(unified_case):
    waiting = unified_case.start_public_test()
    assert waiting.wait_reason == "approval"
    assert unified_case.canary_effects() == []
    unified_case.confirm_exact_pending(waiting)
    done = unified_case.resume_and_wait()
    assert done.native_status == "succeeded"
    assert unified_case.canary_effects() == [unified_case.approved_payload]
    assert done.outputs == unified_case.expected_outputs
    unified_case.redeliver_resume()
    assert unified_case.canary_effects() == [unified_case.approved_payload]
```

`unified_case` 在新模块准备真实 tenant/app/发布 Agent fixture、两条路径 direct/core、实际临时执行环境；canary 使用测试控制的可观测网络服务和无真实私人数据的账户。不得以 monkeypatch runtime 的返回值代替真实 Agent/native 调用。

- [ ] **Step 2: 运行正常 Linux CI 新链路和注册表矩阵，保存未接通路径的 red；未知节点导致具体缺失行而不是全局“安全拒绝”。**
- [ ] **Step 3: root 顺序集成共同文件，补齐真实支持模式的注册表 coverage；更新 CI 的 paths 与必收集函数计数，加入 new model/migration、Agent、sandbox/native adapter 路径。**

```text
matrix key = (supported app mode, native node type, native implementation version)
each key -> real minimal runnable fixture or explicit needs-configuration/interaction fixture
compare registered keys with matrix keys; missing/unexpected keys fail CI
business assertions inspect real persisted outputs + effect ledger + observed canary calls
```

既有老 Agent 仅验证已有图兼容，不让 Builder 新生成废弃节点。触发/交互 fixture 不启用生产监听。覆盖 typed array/boolean/file、native output-schema 失败、双确认/重连/重启/并行预算、snapshot/credential drift、旧 API/backend skew 零 I/O、eager/bootstrap/stdin、OAuth-before-approval、cancel/cleanup、unknown、Fix 不重放和 v1 普通运行回归。

- [ ] **Step 4: 正常 CI 报告模块/函数收集完整，无失败/跳过/xfail；区分 unit/真实 native/受控 canary/实际 sandbox 和 Agent 环境，不从总数推断缺失场景通过。**
- [ ] **Step 5: commit** `test(builder): verify complete native and Agent approval chain`，独立整分支审查通过后进入 Local 验收。

### Task I02：Local 完整 E2E 与待发布制品

**Files:** Create/maintain `.superpowers/sdd/2026-10-14-unified-native-testing/local/` 的截图、完整 Trace、call manifest、机器 receipt；若需要共享验证脚本，放在实际测试所有者目录并经独立审查，不提交密钥/登录状态。

**Dependencies:** I01、正常 CI 产物。**Interfaces:** 使用正常认证的 Console API +现有浏览器观察原生画布/Run；复用已授权的测试客户端或正常登录路径，不向用户索要 session-header 文件，不导出浏览器凭据。前端批准 UI 缺口只记录，API 确认 receipt 不冒称 UI 已交付。

- [ ] **Step 1: 正常镜像构建产物核对 Dify/API/Agent/Agent runtime 与独立 sandbox source SHA、digest、平台、配置和 migration；建立发布清单。** 不使用源码覆盖替代镜像，也不将普通服务变更伪称已隔离。
- [ ] **Step 2: 准备 ENG-1177 合同 Agent fixture 和完整组合图，标注与原 A1/v3 的差异；完成实际 Builder 搜索 → 计划选择 → 绑定 → 草稿保存。** 未认证官方 Tool 先绑定显示待配置，配置后从适当状态继续。
- [ ] **Step 3: 准备每个真实外呼的具体 manifest，现有明确授权范围内执行；新账号/目标/次数先确认。** 先无批准验证零调用，再确认一次并完成 native 链路。模型调用使用明确选定的已配置测试模型和有限预算；不安装或假造真实账号凭据来绕开配置等待。
- [ ] **Step 4: 完成原票和组合正例、两次批量/第三次等待、拒绝/过期/漂移/重连/取消/结果未知/修复不重放负例，保存完整页面截图和原始脱敏 Trace。** 每个结果关联 source/image/config、app/session/request/native Run/node、Agent run/snapshot、grant/operation/attempt、实际 canary 调用计数。Code 与 Agent 环境分别有 runtime 证据。
- [ ] **Step 5: root 验收 Local receipt 并写回四票评论，明确仍未覆盖的原 Workspace/真实账号情形。** 验证缺陷在所属任务修复并重跑受影响用例；未完成不进入 Dev/不 In Review。

### Task I03：正常 Dev 部署、实际 Pods 与四票验收

**Files:** 按既有正常 Helm GitOps 仓库/发布所有者更新实际镜像引用；保存 `.superpowers/sdd/2026-10-14-unified-native-testing/dev/` receipts；Linear 四票评论附件。实施时先读取该发布仓库自己的 AGENTS 和当前变更，不能猜测 values 路径。

**Dependencies:** I02 通过、整分支独立审查和正常镜像 CI。**Interfaces:** rollout 使用正常 pipeline/Helm；读取实际 Kubernetes deployment/Pod imageID、Ready 状态、源码与配置。不得只凭工作流成功或 image tag 宣称 Dev 更新。

- [ ] **Step 1: push 已验证实现，正常 CI/image 全部通过，记录 immutable digests；确认 Dev 当前无其他用户保留的测试后按既有授权范围部署。** 有明确并发占用时只协调该部署时间，不停掉其余实现/验证。
- [ ] **Step 2: 验实际 API/worker/Agent/Agent runtime/sandbox Pod、版本、资源/网络配置、migration head 与功能开关；旧 API/backend 组合先做受控零 I/O 检查，确保滚动升级没有不受控窗口。**
- [ ] **Step 3: 在 Dev 自有 Workspace 重新执行 I02 的原场景、组合图和风险/恢复负例，任何真实外呼使用独立明确次数的确认。** 不复用 Local grant，不触碰他人的 Workspace；复验实际保存的资源身份、snapshot 和输出。
- [ ] **Step 4: 上传每票全页截图、完整脱敏 Trace 和机器证据；读回附件，核对渲染与数量。** 1196 证明整图原生测试/等待继续；1177 证明发现/真实绑定/New Agent；1184 证明实际授权/无批准零调用/防重放；1189 证明实际隔离制品/资源限制/取消与 native Code/Jinja。缺项按票保留 In Progress。
- [ ] **Step 5: root 审核所有结果后仅将验收完整的票改 In Review，更新队列与 release receipt。** 前端仍不写；后端/API 均在 Dev 后才整理中文前端票，沿用用户指定 assignee `tianwei wu`。

## root 自审：设计覆盖与接口一致性

| 设计章节 | 实现/验收任务 |
| --- | --- |
| §1 目标、原生语义、模式范围、模拟与真实区分 | C01、NW2/NW7、I01–I03 |
| §2–3 上下文、同步控制、原生 checkpoint 和父子恢复 | C01/C03、NW1–NW3/NW6、A2/A5 |
| §4 动态范围、额度、账户/版本、防重放和 unknown | C02/C04、NW4/NW5、A3/A5、CS4、I01 |
| §5 New Agent 检索/绑定、版本、内部路径与独立 lease | 全部 A 任务、NW6、I02/I03 |
| §6 原生 Code/Jinja、资源隔离、依赖、网络、取消 | CS1–CS6、NW2/NW3、I01–I03 |
| §7 API/DTO/事件/后端边界 | C04、NW7、A2/A5 |
| §8 全链路正负例、实际运行证据 | 各任务 red/green、I01–I03 |
| §9–10 依赖、审查、普通回归、按票关闭与工程未知项 | 本文依赖/所有权、各 lane、I01–I03 |

自审固定事项：共享字段/decision/outcome 由 C01 唯一命名；NW1 先交 types-only，C03 才实现端口，避免循环依赖；ChildInvocationPort 显式携带 input_result_ref；v2 使用独立 native marker/ref，不改变三份 v1 union；code 是明确 effect kind；等待 category 不能互相代替。所有跨 lane 的公共/核心/CI 文件有串行 owner。五项 Review Focus 均对应具体负例，未留仅靠总测试数推断通过的验收项。

## 计划审阅与执行起点

本计划包等待用户审阅。批准后先核对 repo/worktree/source 状态，复用合适的隔离 worktree并同步经验证的基线；只对本文列出的任务启动产品实现。第一轮是 C01 + NW1 契约，随后按上表并行。任何新发现若改变已批准的产品行为或跨运行时接口，先更新该具体契约及受影响计划；不为常规实现选择重复请求许可。

完成的定义是实际完整链路和每票 Local/Dev 证据满足验收，不能把“计划已写好”、只通过本地 unit、只移除白名单、只通过一个 Template/JSON smoke case 或只观察 image build 成功当作本次功能完成。
