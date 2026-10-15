# Builder Native Workflow Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Builder 通过现有原生 Workflow 引擎测试完整图，在真实操作前同步授权，并持久化等待、恢复、父子调用及实际执行证据。

**Architecture:** 本计划只负责原生 Workflow lane，消费协调计划提供的上下文、effect ledger、预算、授权及生命周期服务。原生节点类、变量类型和图语义继续由 Dify/Graphon 所有；新领域逻辑放在 `api/services/dify_builder/native_testing/`，`api/core/` 仅增加依赖注入和控制结果透传。Agent 协议和 CodeSandbox 基座由对应 lane 交付后接入，不在本计划重复实现。

**Tech Stack:** Python 3.13、Pydantic v2、SQLAlchemy、现有 Celery、Graphon 当前锁定 `0.7.0` 及本计划要求发布的兼容 0.7 补丁。

**Spec:** [已批准设计](../specs/2026-10-14-builder-unified-native-testing-design.md)。源码基线 `13368bd5fa91a613c65ccc1bd328fcadac732cf2`。

## Global Constraints

- 所有运行验证命令只在已具备依赖和隔离的 Linux 测试容器或正常 CI 内执行；不在 macOS host 执行 backend import、pytest、服务或构建。
- 本文件是实施计划；写计划期间不执行下列测试、提交、CI、真实调用或部署。提交步骤由后续实施者执行。
- 不创建第二套 Workflow executor；不增加 Builder 可创建的 App 模式；不实施前端或 ENG-1117。
- 不修改 `.venv` 或使用 sibling Graphon 0.6 源码；Graphon 改动必须来自可追踪的 0.7 上游源码和正式依赖制品。
- 保留 restricted v1、JSON Parse v1、confirmed Gmail-read v1 的全部拒绝、凭据、输出脱敏和 anti-replay 语义；新权限不得由旧 receipt 推导。
- 授权/等待/拒绝不是普通工具错误，不能进入默认输出、失败分支、模型重规划或自动 Fix；业务运行无测试标记时维持原行为。
- 真实 HTTP、模型、Tool、OAuth、知识和文件操作必须先同步授权；数据库事务不得覆盖外部 I/O。
- 同一 Run 从真实子操作状态重建；跨 Fix Run 复用旧响应必须标记模拟，不能称为新的真实通过。
- 旧路径默认保持启用；新 native v1 入口只有依赖协议、守卫和资格验证完整时才能启动，不能降级普通运行。

## Review Focus

- 丢失 ref、错误租户、旧 continuation generation：必须在 metadata、refresh 和业务 I/O 前拒绝；NW2/NW6。
- checkpoint 对象写入或 SQL 提交失败：不能报告可恢复等待，也不能重复已经 claim 的操作；NW3。
- HTTP redirect、重试、轮询和 stream 关闭：不能在一次批准之外暗增 dispatch 或漏记 unknown；NW4/NW5。
- 并行 Iteration 与 Agent 输出重试：相同逻辑操作不能换 key 重派，不同 occurrence 不能错误共用结果；NW3/NW7。
- 下游失败后的 Fix 或用户拒绝：保留已执行事实，禁止新 Run 自动重放，也不能把真实业务错误全部标为安全拒绝；NW7。

## 文件和接口所有权

协调计划拥有 `contracts.py`、SQL/对象存储、授权 scope/intent/attempt、公共 API DTO、持久化预算、outbox、continuation generation 与取消树。本计划不修改这些实现；提出的 adapter ports 由协调所有者实现。

本 lane 新增：`runtime_contracts.py`（适配器端口/返回值）、`context_binding.py`（可信重载）、`runtime_bridge.py`（collaborator 装配）、`native_execution.py`（原生启动/恢复）、`control.py`（类型化控制结果）、`checkpoint_bridge.py`（持久化 barrier）、`operation_journal.py`（真实子操作重建）、`call_adapter.py`（统一调用决策）、`http_adapter.py`、`model_adapter.py`、`retrieval_adapter.py`、`file_adapter.py`、`tool_adapter.py`、`oauth_adapter.py`、`child_workflow.py`、`builder_projection.py`、`registry_matrix.py`。测试放在同名 `api/tests/unit_tests/services/dify_builder/native_testing/`；集成用例放在任务列出的现有测试层级。

消费协调计划冻结的 `NativeTestContextRef(policy_version='builder-native-test-v1', request_id, invocation_id, context_digest)`、`OperationKey(invocation_id, occurrence_path: tuple[str, ...], cursor: int)`、`EffectIntent(key, kind, resource_ref, implementation_revision, account_ref, target, parameters, input_digest, capability_digest)` 和有限 `JsonValue`。

消费 `EffectAuthorizationService.before_call(*, ref, intent) -> DispatchPermit | ApprovalWait | RecordedResult | PolicyStop`、`record_outcome(*, permit, outcome, result_ref) -> EffectReceipt`。决策消费字段为 `DispatchPermit.permit_id`、`ApprovalWait.pending_operation_id`、`ApprovalWait.wait_reason: Literal['approval', 'configuration', 'interaction']`（默认 approval）、`RecordedResult.result_ref`、`PolicyStop.reason_code`，由协调合同一次性定义并冻结。

消费 `NativeTestLifecycleService.pause(*, ref, checkpoint: CheckpointRef, pending_operation_ids: tuple[str, ...], expected_generation: int) -> WaitingReceipt`、`resume(*, actor, request_id, expected_generation, idempotency_key) -> ResumeReceipt`、`cancel(*, actor, request_id, idempotency_key) -> CancellationReceipt`。

本 lane 定义并供协调所有者实现的 `NativeStatePort`：

```text
load_context(*, ref: NativeTestContextRef) -> ResolvedNativeTestContext
commit_checkpoint(*, ref: NativeTestContextRef, generation: int, payload: NativeCheckpointPayload) -> CheckpointRef
read_checkpoint(*, ref: NativeTestContextRef, checkpoint: CheckpointRef) -> NativeCheckpointPayload
store_result(*, ref: NativeTestContextRef, key: OperationKey, result: JsonValue) -> str
load_result(*, ref: NativeTestContextRef, result_ref: str) -> JsonValue
```

`ResolvedNativeTestContext` 包含服务端确认的 ref、tenant/actor/app/workflow ID、不可变 graph/inputs、graph/input revision、资源 manifest、当前 generation、根 native Run ID 和预算/取消引用。`NativeCheckpointPayload` 包含 generate entity、Graphon state、stream-filter state、occurrence 路径、子操作 cursor/results、必要输入/文件引用与子 continuation；执行数据按原有敏感数据权限保存，不能用公开 receipt 代替。`commit_checkpoint` 必须确认载荷和元数据均已提交，返回的 `CheckpointRef` 才能交给 lifecycle。

`NativeWorkflowOutcome` 为判别返回值：`status: Literal['completed', 'waiting', 'stopped', 'unknown']`、`ref`、`native_run_id: str | None`、`checkpoint_ref: CheckpointRef | None`、`pending_operation_ids: tuple[str, ...]`、`reason_code: str | None`、`wait_reason: Literal['approval', 'configuration', 'interaction'] | None`。`completed` 还携带原生终态/输出引用；`waiting` 必须有已提交 checkpoint 和非空 wait_reason，其他状态 wait_reason 为 None。类别取自 C03 已提交 WaitingReceipt；业务失败用 `completed + native failed` 表达，不伪装成 `stopped`。

`ChildInvocationPort.get_or_create(*, parent_ref: NativeTestContextRef, key: OperationKey, child_app_id: str, child_workflow_revision: str, input_digest: str, input_result_ref: str) -> NativeTestContextRef` 原子返回唯一子调用；`complete(*, child_ref: NativeTestContextRef, outcome: NativeWorkflowOutcome) -> None` 原子记录终态并向协调 outbox 写入唯一父恢复事件。C03 验证 input_result_ref 的 owner 和内容 digest 后创建 child context，不能只持久化 input_digest。父子授权、租户和预算由协调所有者校验；本 lane 不自己发放新权限。

---

### Task NW1: 冻结 types-only 原生适配合同

**Dependencies:** 只依赖协调 C01 的 `contracts.py`；不导入 Flask、SQLAlchemy、core factory、Graphon runtime 或任何运行时服务。

**Files:**
- Create: `api/services/dify_builder/native_testing/runtime_contracts.py`。
- Test (Create): `api/tests/unit_tests/services/dify_builder/native_testing/test_runtime_contracts.py`。

**Interfaces:**
- Consumes: C01 `NativeTestContextRef`、`OperationKey`、`CheckpointRef`、`JsonValue`。
- Produces: 上文完整 `NativeStatePort`/`ChildInvocationPort` 签名；下面的 frozen Pydantic 数据结构由协调 C03 唯一实现存储，无第二份 root DTO。
- Produces: `NativeWorkflowOutcome`、`NativeBuilderProjection`、`NativeNodeCoverage` 的判别模型，禁止依赖 native runtime 初始化。`NativeBuilderProjection` 字段为 `route: Literal['waiting', 'review', 'diagnose', 'stopped', 'unknown']`、`native_run_id: str | None`、`public_receipt_ref: str | None`、`wait_reason: Literal['approval', 'configuration', 'interaction'] | None`、`can_diagnose: bool`、`can_start_new_run: bool`；waiting/unknown/stopped 的两个 can 字段均为 False。`NativeNodeCoverage` 字段为 `mode: str`、`node_type: str`、`node_version: str`、`implementation: str`、`schema_fixture: str`、`effect_owners: tuple[str, ...]`、`test_ids: tuple[str, ...]`、`limitation_reason: str | None`。

- [ ] **NW1.1 Red:** 对 checkpoint 序列化 round-trip、不同租户上下文、不允许额外字段、负 generation/call_depth、非有限 JSON，以及 waiting 缺少 checkpoint/native Run ID 写模型测试。

```python
REF_DATA = {
    "policy_version": "builder-native-test-v1",
    "request_id": "f8e67cb1-6451-4c33-85d5-0f32768f1844",
    "invocation_id": "25d69d99-d42b-4c50-a2f7-c2a69580d6ed",
    "context_digest": "a" * 64,
}

def test_waiting_requires_committed_checkpoint():
    with pytest.raises(ValidationError, match="checkpoint"):
        NativeWorkflowOutcome.model_validate({
            "status": "waiting", "ref": REF_DATA, "native_run_id": "run-1",
            "checkpoint_ref": None, "pending_operation_ids": ["operation-1"],
            "wait_reason": "approval",
            "reason_code": None, "native_status": None, "output_result_ref": None,
        })
```

- [ ] **NW1.2 Red run:** 在合格 Linux 容器运行 `uv run --project api pytest api/tests/unit_tests/services/dify_builder/native_testing/test_runtime_contracts.py -q`；预期新数据模型缺失而失败。
- [ ] **NW1.3 Implement types:** `ResolvedNativeTestContext` 精确字段如下；graph/inputs 和引用的资源 manifest 由协调 owner 读取验证，模型自校验不能替代授权。

```python
class ResolvedNativeTestContext(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    ref: NativeTestContextRef
    tenant_id: str
    actor_id: str
    app_id: str
    workflow_id: str
    graph: dict[str, JsonValue]
    inputs: dict[str, JsonValue]
    graph_revision: str
    input_revision: str
    resource_manifest: tuple[dict[str, JsonValue], ...]
    generation: Annotated[int, Field(ge=0)]
    root_native_run_id: str | None
    native_run_id: str | None
    parent_invocation_id: str | None
    call_depth: Annotated[int, Field(ge=0)]
    budget_ref: str
    cancellation_ref: str
    execution_mode: Literal["native", "mock"]
```

- [ ] **NW1.4 Implement checkpoint:** `NodeJournalState` 字段为 `invocation_id: str`、`occurrence_path: tuple[str, ...]`、`input_result_ref: str`、`input_digest: str`、`cursor: int >= 0`、`operation_keys: tuple[OperationKey, ...]`、`result_refs: tuple[str, ...]`。`NativeCheckpointPayload` 精确字段为 `schema_version: Literal['1']`、`native_run_id: str`、`generation: int >= 0`、`generate_entity_json: str`、`graph_runtime_state_json: str`、`response_stream_filter_json: str`、`node_journals: tuple[NodeJournalState, ...]`、`child_refs: tuple[NativeTestContextRef, ...]`、`input_result_refs: tuple[str, ...]`；JSON 字符串解析/有限值校验，文件二进制仅允许存储引用。
- [ ] **NW1.5 Implement outcomes/ports:** 为 `NativeWorkflowOutcome` 定义全量必填字段：上文公共字段加 `native_status: Literal['succeeded', 'failed', 'partial-succeeded', 'stopped'] | None`、`output_result_ref: str | None`。waiting 要求 checkpoint/native Run/pending IDs/wait_reason，completed 要求 native Run/native_status，其他状态不允许成功输出引用。三类等待分别 round-trip；configuration/interaction 不允许被投影成 approval。Protocol 方法只使用已定义合同类型和内置集合，不导入实际实现；测试 REF_DATA 使用 C01 合法 ref，不能用伪 UUID 躲过验证。
- [ ] **NW1.6 Green:** 在合格 Linux 容器重跑合同测试；用源码 import-boundary 测试断言本文件没有 runtime/core/DB 导入。交付给协调 C03，之后才开始 NW2/NW3。
- [ ] **NW1.7 Commit:** `git commit -m "feat(builder): define native workflow adapter contracts"`；types-only 提交可独立审阅和回滚。

### Task NW2: 可信原生启动、worker 重载与 collaborator 注入

**Dependencies:** NW1、协调 C03 的 `state_store.py`/`child_invocations.py`；NW3 控制协议完成前只允许 stub collaborator 的隔离单元测试，不开放入口。依赖方向为 C01 → NW1 → C03 → NW2/NW3，没有 state_store 导入 runtime bridge 的循环。

**Files:**
- Create: `api/services/dify_builder/native_testing/context_binding.py`, `api/services/dify_builder/native_testing/runtime_bridge.py`, `api/services/dify_builder/native_testing/native_execution.py`。
- Modify: `api/core/app/entities/app_invoke_entities.py`, `api/core/app/apps/workflow/app_generator.py`, `api/core/app/apps/workflow/app_runner.py`, `api/core/app/apps/workflow_app_runner.py`, `api/core/workflow/node_factory.py`。
- Modify: `api/services/dify_builder/dify_port.py`, `api/tasks/app_generate/workflow_execute_task.py`（仅 native 分派/可信引用适配）。
- Test (Create): `api/tests/unit_tests/services/dify_builder/native_testing/test_context_binding.py`, `api/tests/unit_tests/services/dify_builder/native_testing/test_native_execution.py`, `api/tests/unit_tests/services/dify_builder/native_testing/test_runtime_bridge.py`。

**Interfaces:**
- Consumes: `NativeStatePort.load_context`、不可变 graph/inputs；所有冻结共享合同。
- Produces: `resolve_native_context(*, required: bool, ref: NativeTestContextRef | None, state: NativeStatePort) -> ResolvedNativeTestContext | None`。
- Produces: `NativeContextUnavailable(RuntimeError)`，只包含固定 reason code，不拼入敏感原始配置。
- Produces: `NativeWorkflowExecutionService.run(*, ref, on_event: Callable[[Mapping[str, JsonValue]], None]) -> NativeWorkflowOutcome`、`resume_worker(*, ref, generation: int) -> NativeWorkflowOutcome`。
- Produces: `NativeRuntimeBridge.for_node(*, ref, occurrence_path: tuple[str, ...], runtime_state) -> NativeCollaborators`；`NativeCollaborators` 是 native HTTP/model/Tool/retrieval/file/Code/Jinja collaborator 的显式 bundle，无进程全局替换。

- [ ] **NW2.1 Red:** 在 `test_context_binding.py` 写缺失引用负例，测试 state/metadata owner 调用数为零；再加入错租户、篡改 digest、权限撤销、未知 tag、普通业务无标记及三个旧 v1 分派用例。

```python
def test_required_scope_never_falls_back_to_ordinary(mocker):
    state = mocker.Mock(spec=NativeStatePort)
    with pytest.raises(NativeContextUnavailable, match="native_context_missing"):
        resolve_native_context(required=True, ref=None, state=state)
    state.load_context.assert_not_called()
```

- [ ] **NW2.2 Red run:** 在合格 Linux 容器运行 `uv run --project api pytest api/tests/unit_tests/services/dify_builder/native_testing/test_context_binding.py -q`；预期新函数/错误类型不存在而失败，不能接受环境导入失败作 red。
- [ ] **NW2.3 Implement:** `DifyRunContext`/generate entity 添加独立 `native_test_required` 与 `native_test_ref`；三个旧 `builder_execution` 变体原封不动。worker 只接收 ref，加载完整 owner chain 后从不可变 graph/input 构造原生 generate entity；scope 缺失直接终止。

```python
def resolve_native_context(*, required, ref, state):
    if ref is None:
        if required:
            raise NativeContextUnavailable("native_context_missing")
        return None
    if ref.policy_version != "builder-native-test-v1":
        raise NativeContextUnavailable("native_context_version")
    return state.load_context(ref=ref)
```

- [ ] **NW2.4 Implement:** 新 native ref 选择普通生产注册表，但所有可能触发 I/O 的 collaborator 延迟到授权边界；禁止先运行现有 eager `build_dify_model_access`/ToolManager 再装守卫。保留 `AppGenerateService`、`WorkflowAppGenerator`、原生 persistence/stream 语义；生成真实 native Run ID 后回写协调 owner。
- [ ] **NW2.5 Implement:** `DifyNodeFactory.with_runtime_state` 传递同一 ref/bridge，调用 `for_node` 绑定当前 occurrence，不拷贝独立预算。Code/Jinja bundle 消费 ENG-1189 资格化 executor；Agent bundle 消费 Agent lane bridge；未交付能力返回配置/能力原因，不能用普通 collaborator 补位。
- [ ] **NW2.6 Green:** 在合格 Linux 容器运行本任务三个新测试文件，以及现有 `api/tests/unit_tests/core/app/workflow/test_node_factory.py`、`api/tests/unit_tests/services/dify_builder/test_native_execution_admission.py`；覆盖普通 Run 和旧 v1 均未改变。
- [ ] **NW2.7 Commit:** `git add` 仅本任务文件；`git commit -m "feat(builder): bind trusted native test runtime context"`。

### Task NW3: Graphon 0.7 控制协议、真实子操作 journal 与 checkpoint barrier

**Dependencies:** NW1、协调 C03 结果存储/continuation port；运行集成消费 NW2，类型和上游工作可在 NW2 同时准备。阻塞依赖为可发布的 Graphon 0.7 上游补丁。

**Files:**
- Create: `api/services/dify_builder/native_testing/control.py`, `api/services/dify_builder/native_testing/checkpoint_bridge.py`, `api/services/dify_builder/native_testing/operation_journal.py`。
- Modify: `api/core/app/layers/pause_state_persist_layer.py`, `api/core/workflow/nodes/human_input/boundary.py`, `api/core/app/apps/workflow_app_runner.py`, `api/pyproject.toml`, `api/uv.lock`。
- Test (Create): `api/tests/unit_tests/services/dify_builder/native_testing/test_control.py`, `api/tests/unit_tests/services/dify_builder/native_testing/test_operation_journal.py`, `api/tests/unit_tests/services/dify_builder/native_testing/test_checkpoint_bridge.py`。
- Test (Create, normal Linux CI only): `api/tests/test_containers_integration_tests/core/workflow/test_builder_native_pause.py`。
- Upstream Modify (package-relative): `graphon/entities/pause_reason.py`, `graphon/graph_events/node.py`, `graphon/graph_events/__init__.py`, `graphon/nodes/base/node.py`, `graphon/graph_engine/event_management/event_handlers.py`, `graphon/graph_engine/graph_engine.py`；相关 Tool/HTTP/LLM broad-catch 透传位置随同一补丁提交。Upstream Create: `graphon/entities/execution_control.py`；Upstream test Create (official repository-relative): `tests/unit_tests/test_execution_control.py`, `tests/unit_tests/test_control_pause_resume.py`。

**Interfaces:**
- Consumes: `NativeStatePort`、lifecycle `pause`；NW2 ref 和原生 stream filter。
- Produces: 上游中立 `graphon.entities.execution_control.NodeExecutionControl(disposition: Literal['pause', 'stop'], continuation_ref: str, reason_code: str)`；新的 `ExternalInterventionRequired(TYPE='external_intervention_required', continuation_ref: str, node_id: str, node_title: str)` 只携带 opaque ref/node identity。新增 `NodeRunControlStoppedEvent` 携带原生事件 identity、continuation_ref/reason_code；新 event handler 复用现有同步 abort 路径，不调用 failure/error handler，精确源路径及终态见 NW3.3b。
- Produces: `NativeControlBridge.resolve(*, ref: NativeTestContextRef, decision: EffectDecision) -> DispatchPermit | RecordedResult`；`NativeCheckpointBridge.commit_wait(*, ref, generation, payload, pending_operation_ids) -> WaitingReceipt`。
- Produces: `control.NativeApprovalWait(NodeExecutionControl)` 和 `control.NativePolicyStop(NodeExecutionControl)`；前者 disposition 固定 pause、continuation_ref 为 pending action ID、附带 `pending_operation_id: str` 和 `wait_reason: Literal['approval', 'configuration', 'interaction']`，后者 disposition 固定 stop、携带固定 reason_code 和当前 invocation ref。名称 NativeApprovalWait 保留但不抹平类别。两者均为 Exception 子类并由 upstream 原生控制入口捕获，不能伪装成 CodeExecutionError/ToolNodeError。
- Produces: `NodeOperationJournal.open(*, ref, occurrence_path) -> OperationCursor`；`OperationCursor.next_key() -> OperationKey`、`rewind() -> None`；从不可变 invocation/occurrence 的已持久化序列重建 cursor，不能用队列 delivery ID 或 Agent validation attempt 生成 identity。

- [ ] **NW3.1 Red:** 为待确认节点开启 retry/default/failure-branch，断言授权暂停产生 `waiting`、调用数 0、retry/default/失败分支计数 0；拒绝产生结构化 stop。加入两轮 pause、并行 frame、checkpoint 存储失败、相同 occurrence 重启与不同 Iteration index 的 key 隔离用例。

```python
def test_iteration_occurrence_survives_delivery_restart(journal, ref):
    first = journal.open(ref=ref, occurrence_path=("root", "iter:items:2", "tool:send"))
    original = first.next_key()
    restarted = journal.open(ref=ref, occurrence_path=("root", "iter:items:2", "tool:send"))
    other = journal.open(ref=ref, occurrence_path=("root", "iter:items:3", "tool:send"))
    assert restarted.next_key() == original
    assert other.next_key() != original
```

- [ ] **NW3.2 Red run:** 在合格 Linux 容器运行 `uv run --project api pytest api/tests/unit_tests/services/dify_builder/native_testing/test_control.py api/tests/unit_tests/services/dify_builder/native_testing/test_operation_journal.py api/tests/unit_tests/services/dify_builder/native_testing/test_checkpoint_bridge.py -q`；预期缺少新控制/持久化 barrier，不能以修改安装包使其通过。
- [ ] **NW3.3 Implement upstream:** 获取发布 `0.7.0` 所对应的官方源码基线，记录 commit 与 sdist hash；上游新增 typed control，先于普通 Exception/NodeRunResult/failure-policy 转换捕获。pause 进入现有 defer-ready/frame snapshot；stop 直接控制图终止，不能构造普通失败事件触发错误分支。Tool、HTTP、模型和容器恢复 broad catch 必须显式透传此类型；普通异常语义保持不变。

```python
try:
    yield from self._run_events()
except NodeExecutionControl as control:
    if control.disposition == "pause":
        reason = ExternalInterventionRequired(
            continuation_ref=control.continuation_ref, node_id=self.id, node_title=self.title,
        )
        yield self._dispatch(PauseRequestedEvent(reason=reason))
    else:
        yield NodeRunControlStoppedEvent(
            id=self.execution_id, node_id=self.id, node_type=self.node_type,
            continuation_ref=control.continuation_ref, reason_code=control.reason_code,
        )
except Exception as error:
    yield self._build_run_failed_event(error)
```

- [ ] **NW3.3a Implement bridge:** 在 `control.py` 实现 `NativeControlBridge.resolve`：DispatchPermit/RecordedResult 原样返回；ApprovalWait 抛保留 wait_reason 的 `NativeApprovalWait`，PolicyStop 抛 `NativePolicyStop`，opaque continuation ref 由服务端 decision/上下文构造。同步 Code/Jinja collaborator 使用此函数；API Agent lane 在 `_run` broad catch 前重抛，Graphon `populate_start_event`/`resume_container` 同样不能吞控制结果。控制类型不得包含 secret 或任意异常原文；lifecycle 只管理状态，不发明运行时 raise 方法。
- [ ] **NW3.3b Implement stop handler:** 上游 `graphon/graph_engine/event_management/event_handlers.py` 注册 `NodeRunControlStoppedEvent`，调用现有 `GraphExecutionProtocol.abort(reason: str) -> None`。该接口实际声明于安装版本 package-relative `graphon/runtime/graph_runtime_state.py:67–70`，实现为 `graphon/graph_engine/domain/graph_execution.py:117–120`，既有 `graphon/graph_engine/command_processing/command_handlers.py:19–27` 同样使用它。`graphon/graph_engine/graph_engine.py:280–290` 在 failed 处理前输出 GraphRunAbortedEvent；新 handler 仅传固定 reason_code，Dify 把它映射为 stopped/unknown，绝不进入默认值/失败分支或 Fix。并行 pause+stop 时终态必须优先 stop，新补丁显式调整 terminal 优先级并测试。
- [ ] **NW3.4 Deliver upstream:** 准备可审阅的上游 0.7 源码补丁及发布说明，按已有授权的正常 review/release 流程产生兼容 `0.7.x` 制品，保存确切版本、commit、wheel/sdist hashes 和上游测试结果；本计划不授权给维护者发送消息。缺少实际发布权限时保留补丁并报告依赖阻塞，不自行发布。获得正式制品后再将 Dify 从 `graphon==0.7.0` 精确 pin 到该版本并更新 lock；不得捏造版本号或从 sibling 安装。
- [ ] **NW3.5 Implement:** journal 保存每个节点的必要输入、真实结果 ref、文件 identity、模型/Tool 历史和 cursor；stream 结果必须完整关闭并封存后才可重建。序列/参数 digest 与历史不匹配则等待冲突决定，不能猜测后重派。Graphon 的 pending-node restart 从 cursor 0 重建，同一 Run 的 RecordedResult 不标成 mock。

```python
def commit_wait(self, *, ref, generation, payload, pending_operation_ids):
    checkpoint = self.state.commit_checkpoint(ref=ref, generation=generation, payload=payload)
    return self.lifecycle.pause(
        ref=ref, checkpoint=checkpoint,
        pending_operation_ids=pending_operation_ids, expected_generation=generation,
    )
```

- [ ] **NW3.6 Implement:** 外部控制 pause ref 在 Dify boundary 重载 pending action 的 wait_reason；原生 HumanInput interaction 保留真实 form/session 绑定及原有提交 owner，不能伪造外呼 effect。checkpoint barrier 在不可吞异常的 coordinator 内运行；C03 receipt 提交后再复制其 wait_reason 到 outcome/SSE，失败产生 `checkpoint_unavailable/unknown`。configuration 必须由真实配置变更满足，interaction 必须由真实表单提交满足；三类等待的 resolve→checkpoint→receipt→projection 测试逐一断言类别未改变。
- [ ] **NW3.7 Green:** 合格 Linux 容器重跑 NW3 单元测试和现有 `api/tests/unit_tests/core/app/apps/test_pause_resume.py`、`api/tests/unit_tests/core/app/layers/test_pause_state_persist_layer.py`；正常 Linux CI 跑新 pause 集成用例及既有 parallel HumanInput join/resume 测试。
- [ ] **NW3.8 Commit:** 上游补丁独立审查/发布；Dify `git commit -m "feat(builder): persist native execution control checkpoints"`，只包含本任务 Dify 文件。

### Task NW4: HTTP、模型、知识和文件的实际调用适配器

**Dependencies:** NW2/NW3、协调 `EffectAuthorizationService` 和实际结果存储。

**Files:**
- Create: `api/services/dify_builder/native_testing/call_adapter.py`, `api/services/dify_builder/native_testing/http_adapter.py`, `api/services/dify_builder/native_testing/model_adapter.py`, `api/services/dify_builder/native_testing/retrieval_adapter.py`, `api/services/dify_builder/native_testing/file_adapter.py`。
- Modify thin DI/pass-through only: `api/core/workflow/node_factory.py`, `api/core/workflow/node_runtime.py`, `api/core/workflow/nodes/knowledge_retrieval/knowledge_retrieval_node.py`, `api/core/rag/retrieval/dataset_retrieval.py`, `api/core/file/remote_fetcher.py`。
- Test (Create): `api/tests/unit_tests/services/dify_builder/native_testing/test_call_adapter.py`, `api/tests/unit_tests/services/dify_builder/native_testing/test_http_adapter.py`, `api/tests/unit_tests/services/dify_builder/native_testing/test_model_adapter.py`, `api/tests/unit_tests/services/dify_builder/native_testing/test_retrieval_adapter.py`, `api/tests/unit_tests/services/dify_builder/native_testing/test_file_adapter.py`。

**Interfaces:**
- Consumes: `before_call`、`record_outcome`、`NativeStatePort.store_result/load_result`、NW3 journal/control bridge。
- Produces: `NativeCallAdapter.call(*, ref, intent: EffectIntent, dispatch: Callable[[DispatchPermit], JsonValue]) -> JsonValue`、私有 `_execute_claimed_call(*, ref, intent, permit: DispatchPermit, dispatch) -> JsonValue`；HTTP/model stream variants hold the same permit until terminal/close, then persist a bounded typed result。
- Produces: `NativeHttpClient` implements Graphon `HttpClientProtocol`；`NativeModelAdapter` wraps `DifyPreparedLLM` and polling start/check/finalize；`NativeRetrievalAdapter.knowledge_retrieval(request)` matches existing `RAGRetrievalProtocol`；`NativeFileAdapter` wraps existing file-reference/fetch/save protocols without altering their native values。

- [ ] **NW4.1 Red:** 在 `test_call_adapter.py` 使用 fake authorization service + counter dispatch 写以下真实 decision 测试；fixture `approval_wait` 从协调合同构造 pending operation，`intent` 使用 `OperationKey(invocation_id=ref.invocation_id, occurrence_path=('root', 'http:write'), cursor=0)` 和合成参数。

```python
@pytest.mark.parametrize("wait_reason", ["approval", "configuration", "interaction"])
def test_wait_is_control_flow_and_never_dispatches(mocker, adapter, ref, intent, approval_wait, wait_reason):
    adapter.authorization.before_call.return_value = approval_wait.model_copy(update={"wait_reason": wait_reason})
    dispatch = mocker.Mock()
    with pytest.raises(NodeExecutionControl) as raised:
        adapter.call(ref=ref, intent=intent, dispatch=dispatch)
    assert raised.value.disposition == "pause"
    assert raised.value.wait_reason == wait_reason
    dispatch.assert_not_called()
    adapter.authorization.record_outcome.assert_not_called()
```

- [ ] **NW4.2 Red run:** 在合格 Linux 容器运行 `uv run --project api pytest api/tests/unit_tests/services/dify_builder/native_testing/test_call_adapter.py -q`，预期新 adapter 不存在；加入 completed recorded result 返回相同真实结果且 dispatch 0 次，以及 in-flight/unknown 不发新 permit 的用例。
- [ ] **NW4.3 Implement:** `before_call` 返回 RecordedResult 时从 owner-scoped结果存储加载；ApprovalWait/PolicyStop 交给 NW3 控制桥；只有 DispatchPermit 能调用实际 owner。返回后先存结果再追加 outcome；dispatch 异常、流截断/关闭或 completion 写入失败按实际派发证据记录 unknown，不能重新申请 permit 来“补救”。

```python
decision = control.resolve(ref=ref, decision=authorization.before_call(ref=ref, intent=intent))
match decision:
    case RecordedResult(result_ref=result_ref):
        return state.load_result(ref=ref, result_ref=result_ref)
    case DispatchPermit():
        return self._execute_claimed_call(ref=ref, intent=intent, permit=decision, dispatch=dispatch)
```

- [ ] **NW4.4 Implement HTTP:** 在变量、headers/body/query/files 全部解析后生成 intent；secret 值不进入披露/Trace。包装现有 SSRF-safe client；native v1 禁止透明业务重试，redirect 每跳重新检查目标和额度，不把同一 permit 隐式沿用到新主机。保留原生 HTTP response/default output 数据类型，审批控制始终越过 defaults。
- [ ] **NW4.5 Implement model:** 覆盖 LLM、classifier、parameter extractor、retrieval query/rerank/embedding 实际 provider 调用。metadata/token 估计不允许先触发收费调用；polling start 为 dispatch，check 为关联 observation，恢复连接不新建模型任务。必要 prompt/usage/结构化输出状态写 journal，模型输出校验重试不重置预算或 effect key。
- [ ] **NW4.6 Implement knowledge/files:** 增加 `KnowledgeRetrievalNode` 可注入 retrieval collaborator，原有默认不变；在原始 dataset scope 与实际模型/外部检索 owner 分别守卫，不把一次顶层批准当无限内部调用。覆盖 retriever attachment、remote GET/HEAD、file upload/export、Tool/LLM 文件落盘；区分隔离临时文件与读新账户/持久化输出，验证完整 tenant→app→run→file chain。
- [ ] **NW4.7 Green:** 合格 Linux 容器运行本任务五个测试文件；测试 HTTP 302 改目标、POST timeout、SSRF 拒绝、模型 polling 重连、并行额度、跨租户 attachment、remote file HEAD/GET 和流中断。各负例断言真实 transport counter，普通网络 canary 必须先证明计数器可观测。
- [ ] **NW4.8 Commit:** `git commit -m "feat(builder): authorize native HTTP model retrieval and file effects"`；不包含 Tool/OAuth 或 Agent lane 文件。

### Task NW5: Tool 参数、metadata 与 OAuth refresh 的同步守卫

**Dependencies:** NW2/NW3/NW4、协调 scope/credential revision CAS；NW6 提供 Workflow Tool 分派后才能开放该 provider。

**Files:**
- Create: `api/services/dify_builder/native_testing/tool_adapter.py`, `api/services/dify_builder/native_testing/oauth_adapter.py`。
- Modify thin DI/pass-through only: `api/core/workflow/node_runtime.py`, `api/core/tools/tool_manager.py`, `api/core/tools/plugin_tool/tool.py`, `api/core/plugin/impl/tool.py`, `api/core/plugin/impl/oauth.py`, `api/core/tools/tool_engine.py`。
- Test (Create): `api/tests/unit_tests/services/dify_builder/native_testing/test_tool_adapter.py`, `api/tests/unit_tests/services/dify_builder/native_testing/test_oauth_adapter.py`。
- Regression: `api/tests/unit_tests/core/tools/test_confirmed_tool_runtime.py`, `api/tests/unit_tests/services/dify_builder/test_confirmed_tool_launch.py`, `api/tests/unit_tests/services/dify_builder/test_json_tool_runtime.py`。

**Interfaces:**
- Consumes: NW4 `NativeCallAdapter`、NW3 journal/control、协调 credential revisions。
- Produces: `NativeToolAdapter.prepare_metadata(*, ref, node_data) -> NativeToolMetadata`（无 refresh/业务 dispatch）；`invoke(*, ref, node_id, node_execution_id, tool_parameters, workflow_call_depth) -> Iterator[ToolRuntimeMessage]`。
- Produces: `NativeToolMetadata` frozen DTO 字段为 `resource_ref: str`、`implementation_revision: str`、`account_ref: str | None`、`parameter_schema: dict[str, JsonValue]`、`configuration_state: Literal['ready', 'missing_credentials', 'refresh_required', 'metadata_unavailable']`；不包含凭据值。
- Produces: `NativeOAuthAdapter.refresh(*, ref, intent: EffectIntent, refresh_call: Callable[[DispatchPermit], JsonValue]) -> JsonValue`；刷新与 business intent 使用同一 occurrence 的独立 cursor，授权 scope 包含必要 refresh，ciphertext 仍只写原凭据 owner。

- [ ] **NW5.1 Red:** 加入“为展示 Tool 需要 metadata，但 OAuth 已过期”的测试；把 refresh/daemon business call 均设为计数器，准备确认及等待时计数必须为 0。覆盖 `get_runtime_parameters` 可能跨 daemon、API/MCP/builtin/plugin 参数合并、缺凭据配置等待及业务调用完整参数 digest。

```python
def test_metadata_does_not_refresh_expired_oauth(tool_adapter, expired_tool, counters):
    metadata = tool_adapter.prepare_metadata(ref=expired_tool.ref, node_data=expired_tool.node_data)
    assert metadata.configuration_state == "refresh_required"
    assert counters.oauth_refresh == 0
    assert counters.business_dispatch == 0
```

- [ ] **NW5.2 Red run:** 合格 Linux 容器运行 `uv run --project api pytest api/tests/unit_tests/services/dify_builder/native_testing/test_tool_adapter.py api/tests/unit_tests/services/dify_builder/native_testing/test_oauth_adapter.py -q`；预期当前 eager refresh/普通 Tool 调用无法满足零调用保证。
- [ ] **NW5.3 Implement:** native v1 使用无外部 I/O metadata owner；缺账户/凭据时由 C02 pending-action owner 建立 configuration 等待和真实配置引用，不先构造假 account_ref 的 EffectIntent。正常配置完成、解析出实际身份后才准备 approval scope；批准外呼不能满足 configuration。ToolManager 的凭据准备可注入，旧 v1/普通分支保留。runtime parameters 合并后再计算 intent；无法本地获取的 metadata RPC 作为单独 effect，不偷用调用权限。
- [ ] **NW5.4 Implement:** refresh permit 原子消耗后才发 OAuth 请求；用原凭据 owner 全引用/revision CAS 保存刷新结果并关闭事务；再检查业务 scope 后获取 business permit。刷新成功但保存/缓存失效失败标 unknown，业务调用 0 次；401 不自动再 refresh/replay。
- [ ] **NW5.5 Implement:** `ToolEngine`/runtime broad catch 显式透传 `NodeExecutionControl`，stream finally 关闭一次、封存 outcome；审批不能变为模型可读错误。插件 daemon/APITool/MCP/builtin 的真实 transport 均接入 scope；opaque plugin 只获一次有界调用披露，不声称控制了隐藏内部每个动作。
- [ ] **NW5.6 Green:** 合格 Linux 容器运行两个新测试文件及三组旧 v1 regression；正常 Linux CI 跑既有 `api/tests/test_containers_integration_tests/core/workflow/test_builder_confirmed_tool_native.py`。断言两次并发 refresh claim 只有一条实际请求、unknown 不重派、无 SQL 事务覆盖网络。
- [ ] **NW5.7 Commit:** `git commit -m "feat(builder): guard native tool metadata refresh and dispatch"`。

### Task NW6: Workflow-as-Tool 父子 continuation 与恢复传播

**Dependencies:** NW2–NW5、协调 `ChildInvocationPort`/outbox/generation claim；Agent lane 通过同一 port 调用子 Workflow。

**Files:**
- Create: `api/services/dify_builder/native_testing/child_workflow.py`。
- Modify thin dispatch only: `api/core/tools/workflow_as_tool/tool.py`, `api/core/tools/workflow_as_tool/provider.py`, `api/core/tools/tool_engine.py`, `api/tasks/app_generate/workflow_execute_task.py`。
- Test (Create): `api/tests/unit_tests/services/dify_builder/native_testing/test_child_workflow.py`。
- Test (Create, normal Linux CI only): `api/tests/test_containers_integration_tests/core/workflow/test_builder_native_child_continuation.py`。

**Interfaces:**
- Consumes: `ChildInvocationPort`、NW2 run/resume、NW3 checkpoint、同一预算/取消树。
- Produces: `NativeChildWorkflowAdapter.invoke(*, parent_ref, key: OperationKey, child_app_id: str, child_workflow_revision: str, inputs: Mapping[str, JsonValue]) -> JsonValue`；等待通过 typed control 返回，不能阻塞父 worker 轮询。
- Produces: `deliver_child_terminal(*, child_ref, outcome: NativeWorkflowOutcome) -> None`；只委托 port.complete 原子记录/发父恢复事件，不在 worker 自行递归启动父流程。

- [ ] **NW6.1 Red:** 用 parent→Workflow Tool→child HTTP 的合成图；child 等待时 parent 也有可恢复 checkpoint，父 worker/连接释放。重复队列消息返回同一个 child ref，不生成第二个 child Run；父恢复只消费已完成 child result。

```python
def test_duplicate_child_reservation_keeps_one_invocation(port, state, parent_ref, operation_key):
    inputs = {"contract_text": "synthetic contract", "jurisdiction": "test"}
    result_ref = state.store_result(ref=parent_ref, key=operation_key, result=inputs)
    args = dict(parent_ref=parent_ref, key=operation_key, child_app_id="child-app",
                child_workflow_revision="a" * 64, input_digest=canonical_digest(inputs),
                input_result_ref=result_ref)
    first = port.get_or_create(**args)
    assert port.get_or_create(**args) == first
    assert port.reservation_count == 1
```

- [ ] **NW6.2 Red run:** 合格 Linux 容器运行 `uv run --project api pytest api/tests/unit_tests/services/dify_builder/native_testing/test_child_workflow.py -q`；预期当前 `pause_state_config=None`、无 ref 传播路径不满足测试。
- [ ] **NW6.3 Implement:** 在现有 WorkflowTool 的 native-test 分支委托 adapter，普通分支保留。完整 owner chain 重新校验子 App/发布版本和输入文件；使用冻结 child revision、真实父 node/occurrence path，传播调用深度、预算和取消引用。去掉 native-test 路径中 depth 重置/额外重复增量，不改变普通深度行为。
- [ ] **NW6.4 Implement:** 用 state.store_result 存不可变 child inputs，并把返回的 input_result_ref 与 canonical input_digest 显式传给 get_or_create；C03 验证 ref owner/内容后原子写入 child reservation、启动 outbox、parent pending-child 状态。child wait 通过 parent control 进入 checkpoint，child terminal 生成唯一父 resume 事件。resume worker 必须先 claim generation，再装载 immutable checkpoint；禁止直接读取当前可变 draft 取代原图。
- [ ] **NW6.5 Implement:** 已完成 child 返回 stored typed outputs/usage/file refs；child unknown 传播 unknown，不调用另一个 child 模拟继续。拒绝/取消阻止整个调用树新派发；从等待配置恢复仍重验权限。父/子任何 context 丢失、版本撤销、loop 次数超限均在 I/O 前返回具体状态。
- [ ] **NW6.6 Green:** 合格 Linux 容器跑新单元测试；正常 Linux CI 跑新父子集成测试，覆盖两层嵌套、并行 Iteration child、parent/child worker 重启、重复 terminal 事件、取消与事件乱序、图编辑后恢复、子结果文件跨租户拒绝。
- [ ] **NW6.7 Commit:** `git commit -m "feat(builder): resume nested native workflow tool invocations"`。

### Task NW7: Build/Edit/Fix 等待投影、原生节点矩阵与组合贯通

**Dependencies:** NW2–NW6、协调公共 API/会话状态合同、Agent lane 完整暂停协议、ENG-1189 合格 Code/Jinja executor、ENG-1177 真实绑定。

**Files:**
- Create: `api/services/dify_builder/native_testing/builder_projection.py`, `api/services/dify_builder/native_testing/registry_matrix.py`。
- Modify: `api/services/dify_builder/dify_port.py`, `api/services/dify_builder/run_mapping.py`, `api/services/dify_builder/presentation.py`, `api/services/dify_builder/progress_snapshot.py`, `api/tasks/dify_builder_advance_task.py`。
- Modify thin delegation only: `api/core/dify_builder/handlers_build.py`, `api/core/dify_builder/handlers_edit.py`, `api/core/dify_builder/handlers_fix.py`, `api/core/dify_builder/ports.py`, `api/core/dify_builder/models.py`, `api/core/dify_builder/runner.py`。
- Test (Create): `api/tests/unit_tests/services/dify_builder/native_testing/test_builder_projection.py`, `api/tests/unit_tests/services/dify_builder/native_testing/test_registry_matrix.py`。
- Test (Create, normal Linux CI only): `api/tests/test_containers_integration_tests/core/workflow/test_builder_native_full_workflow.py`。
- Create: `api/tests/unit_tests/services/dify_builder/native_testing/fixtures/native_node_matrix.json`, `docs/superpowers/reports/2026-10-14-builder-native-node-matrix.md`（执行时填写真实覆盖结果）。

**Interfaces:**
- Consumes: `NativeWorkflowOutcome`、coordinator waiting/session DTO、resume/cancel actions；NW2 native run adapter。
- Produces: `project_native_test_outcome(*, outcome, builder_mode: Literal['build', 'edit', 'fix']) -> NativeBuilderProjection`，包含 `route: Literal['waiting', 'review', 'diagnose', 'stopped', 'unknown']`、native Run identity 和 public receipt ref；不会启动外部调用。
- Produces: `native_node_matrix() -> tuple[NativeNodeCoverage, ...]`；每行标记 mode/type/version/实现、schema 样例、effect owners、测试 ID 和限制原因，不能作为第二套 runtime admission whitelist。

- [ ] **NW7.1 Red:** 对 Build/Edit/Fix 参数化测试等待、拒绝、配置等待、unknown、真实业务失败和成功；审批等待不走 `map_run_result` 的 paused→failed 分支。对真实业务失败允许诊断，对未知/拒绝禁止 `diagnose/propose_repair/run_draft`。

```python
@pytest.mark.parametrize("mode", ["build", "edit", "fix"])
@pytest.mark.parametrize("wait_reason", ["approval", "configuration", "interaction"])
def test_wait_never_enters_repair(mode, wait_reason, waiting_outcome):
    outcome = waiting_outcome.model_copy(update={"wait_reason": wait_reason})
    projection = project_native_test_outcome(outcome=outcome, builder_mode=mode)
    assert projection.route == "waiting"
    assert projection.native_run_id == waiting_outcome.native_run_id
    assert projection.wait_reason == wait_reason
    assert projection.can_diagnose is False
    assert projection.can_start_new_run is False
```

- [ ] **NW7.2 Red run:** 合格 Linux 容器运行 `uv run --project api pytest api/tests/unit_tests/services/dify_builder/native_testing/test_builder_projection.py api/tests/unit_tests/services/dify_builder/native_testing/test_registry_matrix.py -q`；预期旧 paused 失败映射和无矩阵覆盖门禁不满足测试。
- [ ] **NW7.3 Implement:** 旧 `run_draft` 与 confirmed 调用保留；新 versioned action 调 NW2 原生服务，thin handlers 委托 projection。等待时保存原 Run/reference 并停在已提交会话等待态；resume action 委托 lifecycle，不只翻转 `fc.paused`。SSE/进度重连从持久化 request/generation/receipt 重建，不能靠末帧推断成功。
- [ ] **NW7.4 Implement:** 只有真正 native failed 才进入现有诊断/修复；新 graph revision 产生新的验证 Run 并关联历史 effect。跨 Fix 重新真实调用必须新批准；选择旧结果通过显式 mock 模式/证据标识传入，不能静默复制 permit。所有旧 v1 copy、结果脱敏和 immutable verification 约束保持。
- [ ] **NW7.5 Implement matrix:** 从 `get_node_type_classes_mapping()` 及 Builder 已支持的 App mode 生成覆盖清单；对每个注册 native type/version 分配现有或新用例。触发节点注入明确合成事件，不注册生产监听；HumanInput 使用真实等待/提交；纯逻辑/变量/文件/知识/容器覆盖真实原生语义。新增注册项无对应测试时 CI 明确失败，不在运行时拒绝该节点。
- [ ] **NW7.6 Green integration:** 正常 Linux CI 跑新 full-workflow 用例：`Start → Code → Iteration(New Agent) → Tool → End`，Python/JS 各一例；Agent 内部实际 fake transport guard 产生一次动态审批，恢复后输出正确，第三次超批量额度再等。另跑独立 HTTP/Tool/Workflow Tool/Agent shell 路径的控制穿透与真实结果重建；外部真账号另按具体批准计划执行，不由合成测试自动授权。
- [ ] **NW7.7 Green regression:** 合格 Linux 容器跑本目录全部单元测试、现有 `api/tests/unit_tests/services/dify_builder/test_run_mapping.py`、`test_native_execution_admission.py`、`test_confirmed_tool_launch.py`、`test_execution_policy_service.py`、`test_json_tool_execution.py`，以及 `api/tests/unit_tests/core/dify_builder/test_handlers_build.py`、`test_handlers_edit.py`、`test_handlers_fix.py`；正常 Linux CI 跑旧 Template/JSON/Gmail/HumanInput 原生回归，不把零收集或跳过当通过。
- [ ] **NW7.8 Review and commit:** 独立审查调用计数、checkpoint、ledger 与 native Run/node identity 是否一致；记录 Linux 资格化镜像/依赖和覆盖矩阵；`git commit -m "feat(builder): integrate complete native workflow test lifecycle"`。部署和 Dev 验收由协调计划统一安排，不能以本 lane 单测替代。

## 交付与阻塞判定

NW1–NW7 各自提交有测试证据的可审阅变更；NW4 与 NW5 不并行修改 `node_runtime.py`/`node_factory.py`，NW6 等待 NW5 后再接入 `tool_engine.py`。Agent/Code lane 对共享 core 调用点的改动由本 lane 集成所有者串行应用，禁止各 lane 独立改同一文件。

开始实施前必须冻结协调 port 的存储/decision 字段，并取得 Graphon 0.7 上游补丁发布路径；这两项是真实依赖。若缺少制品、checkpoint 不能可靠提交或某实际 owner 尚未守卫，native v1 入口必须拒绝启动并报告具体缺口，不能用旧普通运行宣称完整链路已交付。
