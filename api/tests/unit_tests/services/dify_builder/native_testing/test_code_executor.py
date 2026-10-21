"""Real native nodes/transformers/C02; explicit SQL and deployment doubles only."""

from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from graphon.nodes.code.code_node import CodeNode
from graphon.nodes.code.entities import CodeLanguage, CodeNodeData
from graphon.runtime import InitParams, RuntimeState, VariablePool
from runtime_contracts.builder.execution import (
    BuilderExecutionPolicyError,
    canonical_digest,
)
from services.dify_builder.native_testing.call_adapter import NativeCallAdapter
from services.dify_builder.native_testing.checkpoint_bridge import NativeCheckpointBridge
from services.dify_builder.native_testing.control import (
    BoundaryOwnerState,
    NativeApprovalWait,
    NativePolicyStop,
    marked_native_node_class,
)
from services.dify_builder.native_testing.host_execution import NativeHostLaunch
from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime
from services.dify_builder.native_testing.operation_journal import NodeOperationJournal
from services.dify_builder.native_testing.private_reads import PrivateReadOwner
from services.dify_builder.native_testing.repository import OwnedNativeTest
from services.dify_builder.native_testing.runtime_bridge import NativeNodePreparation, NativeRuntimeBridge
from services.dify_builder.native_testing.sandbox.host import NativeCodeHostOwner
from services.dify_builder.native_testing.sandbox.qualification import (
    NativeCodeBindingProducer,
    NativeCodeQualification,
)
from tests.unit_tests.services.dify_builder.native_testing.test_call_adapter import (
    REF,
    Authorization,
    State,
)
from tests.unit_tests.services.dify_builder.native_testing.test_code_qualification import (
    qualification,
    raw_code,
)
from tests.unit_tests.services.dify_builder.native_testing.test_host_execution import (
    DurablePorts,
    NoCheckpointLifecycle,
)
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_bridge import SyntheticSink, _api


@dataclass
class CodeExecutorCase:
    q: NativeCodeQualification
    seen: list
    events: list
    state: State
    auth: Authorization
    journal: NodeOperationJournal
    producer: NativeCodeBindingProducer
    node: CodeNode
    association: NativeNodePreparation
    raw: dict
    installed: list[dict]
    owner: NativeCodeHostOwner


def refuse_constructor_collaborators(**_kwargs):
    raise AssertionError("node preparation collaborators are not used by executor tests")


@pytest.fixture
def case(monkeypatch):
    from services.dify_builder.native_testing.sandbox import qualification as module

    q, seen = qualification()
    events = []
    state, auth = State(events), Authorization(events)
    raw = raw_code()
    graph = {"nodes": [{"id": "code", "data": raw}], "edges": []}
    descriptor = module.describe_code_resource(
        qualification=q,
        node_id="code",
        raw=raw,
        workflow_revision="a" * 64,
        app_id="app",
        workflow_id="workflow",
    )
    state.context = state.context.model_copy(
        update={
            "graph": graph,
            "graph_revision": "a" * 64,
            "resource_manifest": (descriptor,),
        }
    )

    def store_inputs(**kw):
        events.append(("input_ack", kw["native_execution_id"]))
        ref = "node-input:" + kw["native_execution_id"]
        prior = state.values.setdefault(ref, deepcopy(kw["inputs"]))
        if canonical_digest(prior) != canonical_digest(kw["inputs"]):
            raise BuilderExecutionPolicyError("native_payload_conflict")
        return ref

    monkeypatch.setattr(state, "store_node_inputs", store_inputs, raising=False)
    runtime = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    bridge = NativeRuntimeBridge(
        state=state,
        boundary_owner=BoundaryOwnerState(ref=REF),
        control_sink=SyntheticSink(),
        collaborators=refuse_constructor_collaborators,
        node_arguments=refuse_constructor_collaborators,
    )
    association = NativeNodePreparation(
        bridge=bridge,
        ref=REF,
        node_id="code",
        node_class=marked_native_node_class(CodeNode, marked=True),
        runtime_state=runtime,
    )
    node = association.node_class(
        native_control_owner=bridge._boundary_owner,
        native_control_sink=bridge._control_sink,
        node_id="code",
        data=CodeNodeData.model_validate(raw),
        init_params=InitParams(workflow_id="workflow", graph_config=graph, run_context={}, call_depth=0),
        runtime_state=runtime,
        code_executor=object(),
        code_limits=module.code_limits(),
    )
    association.attach(node)
    api = _api()
    loader = api.loader
    context = state.context
    owned = OwnedNativeTest(
        ref=context.ref,
        tenant_id=context.tenant_id,
        actor_id=context.actor_id,
        app_id=context.app_id,
        workflow_id=context.workflow_id,
        session_id="session",
        test_input_id="input",
        bindings={},
        generation=0,
        task_approved=True,
        expires_at=datetime(2030, 1, 1, tzinfo=UTC),
        state="running",
    )
    monkeypatch.setattr(loader, "load", lambda **_kw: owned)
    authority = PrivateReadOwner(
        tenant_id=context.tenant_id,
        actor_id=context.actor_id,
        app_id=context.app_id,
        workflow_id=context.workflow_id,
        parent_invocation_id=None,
        context_object_id="context",
        generation=0,
        graph_revision=context.graph_revision,
        root_revision_matches=True,
        input_revision=context.input_revision,
        expires_at=owned.expires_at,
        cancelled=False,
        active=True,
        request_state="running",
    )
    monkeypatch.setattr(module, "validate_private_read", lambda *_a: authority)
    journal = NodeOperationJournal(state=state, authorization=auth)
    dispatch_id = str(uuid4())
    lifetime = NativeHostLifetime(context=context, dispatch_id=dispatch_id)
    ports = DurablePorts()
    host = NativeHostLaunch(
        context=context,
        dispatch_id=dispatch_id,
        lifetime=lifetime,
        journal=journal,
        checkpoints=NativeCheckpointBridge(state=state, lifecycle=NoCheckpointLifecycle()),
        fence_pending=ports.fence_pending,
        stop_sealer=ports,
        authorization=auth,
        http_baseline=(1, 1, 1),
    )
    owner = NativeCodeHostOwner(host=host, loader=loader)
    monkeypatch.setattr(owner, "check_current", lambda _acquisition: None)
    producer = module.NativeCodeBindingProducer(
        association=association,
        loader=loader,
        state_store=state,
        journal=journal,
        qualification=q,
    )
    installed = []
    monkeypatch.setattr(producer, "_install", lambda **kw: installed.append(kw))
    return CodeExecutorCase(
        owner=owner,
        q=q,
        seen=seen,
        events=events,
        state=state,
        auth=auth,
        journal=journal,
        producer=producer,
        node=node,
        association=association,
        raw=raw,
        installed=installed,
    )


def test_unbound_public_uuid_refuses_before_protected_input(case):
    with pytest.raises(Exception, match="native_execution_id_missing"):
        case.producer.prepare(language=CodeLanguage.PYTHON3, code=case.raw["code"], inputs={})
    assert case.events == []
    assert case.installed == []


def test_prepare_attests_actual_native_code_and_stable_reopened_intent(case):
    case.node.bind_execution_id(str(uuid4()))
    a = case.producer.prepare(language=CodeLanguage.PYTHON3, code=case.raw["code"], inputs={})
    b = case.producer.prepare(language=CodeLanguage.PYTHON3, code=case.raw["code"], inputs={})
    assert a.intent == b.intent
    assert a.spec == b.spec
    assert a.intent.key.occurrence_path == (case.node.execution_id,)
    assert len(case.installed) == 2
    assert a.intent.target["code_physical"]["base_snapshot_digest"] == case.q.capability.empty_snapshot_digest
    assert case.events[0][0] == "input_ack"


@pytest.mark.parametrize("change", ["code", "input", "config", "qualification"])
def test_producer_refuses_changed_protected_material(case, change):
    case.node.bind_execution_id(str(uuid4()))
    code, inputs = case.raw["code"], {}
    if change == "code":
        code = "changed"
    if change == "input":
        inputs = {"unexpected": True}
    if change == "config":
        case.node.node_data.code = "changed"
    if change == "qualification":
        case.q.owner.validate = lambda **_kw: True
    with pytest.raises(BuilderExecutionPolicyError):
        case.producer.prepare(language=CodeLanguage.PYTHON3, code=code, inputs=inputs)
    assert case.installed == []


def test_code_result_replay_has_zero_sdk_io_and_real_transformer(case, monkeypatch):
    from services.dify_builder.native_testing.sandbox import executor as module
    from services.dify_builder.native_testing.sandbox.executor import NativeCodeExecutor

    case.node.bind_execution_id(str(uuid4()))
    physical = []

    class Transport:
        def __init__(self, **kw):
            physical.append(kw)

        def execute(self, **kw):
            assert kw["language"] == "python3"
            assert "CANARY" in kw["code"]
            return '<<RESULT>>{"result":"actual parsed"}<<RESULT>>'

    monkeypatch.setattr(module, "HostNativeCodeTransport", Transport)
    calls = NativeCallAdapter(
        state=case.state,
        authorization=case.auth,
        journal=case.journal,
        max_result_bytes=8 << 20,
    )
    owner = case.owner
    execute = NativeCodeExecutor(producer=case.producer, calls=calls, owner=owner, on_prepared=lambda: None)
    assert execute.execute(language=CodeLanguage.PYTHON3, code=case.raw["code"], inputs={}) == {
        "result": "actual parsed"
    }
    assert execute.execute(language=CodeLanguage.PYTHON3, code=case.raw["code"], inputs={}) == {
        "result": "actual parsed"
    }
    assert len(physical) == 1


def test_approval_wait_has_no_scope_and_exports_real_proposal(case, monkeypatch):
    from runtime_contracts.builder.native.contracts import ApprovalWait
    from services.dify_builder.native_testing.sandbox import executor as module
    from services.dify_builder.native_testing.sandbox.executor import NativeCodeExecutor

    case.node.bind_execution_id(str(uuid4()))
    case.auth.decisions[0] = ApprovalWait(pending_operation_id="pending")
    monkeypatch.setattr(module, "HostNativeCodeTransport", lambda **_kw: pytest.fail("scope during wait"))
    calls = NativeCallAdapter(
        state=case.state,
        authorization=case.auth,
        journal=case.journal,
        max_result_bytes=8 << 20,
    )
    execute = NativeCodeExecutor(producer=case.producer, calls=calls, owner=object(), on_prepared=lambda: None)
    with pytest.raises(NativeApprovalWait):
        execute.execute(language=CodeLanguage.PYTHON3, code=case.raw["code"], inputs={})
    assert len(case.producer.approval_proposals()) == 1
    assert not execute.is_execution_error(NativePolicyStop(ref=REF, reason_code="test_stop"))


def test_non_json_input_error_never_contains_private_values(case):
    case.node.bind_execution_id(str(uuid4()))
    with pytest.raises(BuilderExecutionPolicyError) as error:
        case.producer.prepare(
            language=CodeLanguage.PYTHON3,
            code=case.raw["code"],
            inputs={"CANARY_PRIVATE": float("nan")},
        )
    assert "CANARY_PRIVATE" not in str(error.value)
    assert case.installed == []


def variable_case(case, value):
    from services.dify_builder.native_testing.sandbox.qualification import (
        describe_code_resource,
    )

    raw = raw_code(variables=[{"variable": "value", "value_selector": ["start", "value"]}])
    graph = {
        "nodes": [
            {
                "id": "start",
                "data": {"type": "start", "title": "Start", "variables": []},
            },
            {"id": "code", "data": raw},
        ],
        "edges": [],
    }
    context = case.state.context
    descriptor = describe_code_resource(
        qualification=case.q,
        node_id="code",
        raw=raw,
        workflow_revision=context.graph_revision,
        app_id=context.app_id,
        workflow_id=context.workflow_id,
    )
    case.state.context = context.model_copy(update={"graph": graph, "resource_manifest": (descriptor,)})
    case.node.node_data.variables = CodeNodeData.model_validate(raw).variables
    case.node.bind_execution_id(str(uuid4()))
    case.association.runtime_state.variable_pool.add(["start", "value"], value)
    return raw


def test_typed_selector_input_does_not_conflate_boolean_and_integer(case):
    raw = variable_case(case, True)
    with pytest.raises(BuilderExecutionPolicyError):
        case.producer.prepare(language=CodeLanguage.PYTHON3, code=raw["code"], inputs={"value": 1})
    assert case.installed == []


def test_current_selector_change_after_claim_refuses_before_transport(case, monkeypatch):
    from services.dify_builder.native_testing.sandbox import executor as module

    raw = variable_case(case, 1)

    class Calls:
        def call(self, *, dispatch, **kw):
            del kw
            case.association.runtime_state.variable_pool.add(["start", "value"], 2)
            return dispatch(object())

    monkeypatch.setattr(
        module,
        "HostNativeCodeTransport",
        lambda **_kw: pytest.fail("changed actual input dispatched"),
    )
    execute = module.NativeCodeExecutor(
        producer=case.producer,
        calls=Calls(),
        owner=case.owner,
        on_prepared=lambda: None,
    )
    with pytest.raises(BuilderExecutionPolicyError):
        execute.execute(language=CodeLanguage.PYTHON3, code=raw["code"], inputs={"value": 1})


def test_wait_then_claim_preserves_logical_intent_and_replay_never_constructs_transport(case, monkeypatch):
    from runtime_contracts.builder.native.contracts import ApprovalWait
    from services.dify_builder.native_testing.sandbox import executor as module

    case.node.bind_execution_id(str(uuid4()))
    initial = case.producer.prepare(language=CodeLanguage.PYTHON3, code=case.raw["code"], inputs={})
    physical = []

    class Transport:
        def __init__(self, **kwargs):
            physical.append(kwargs)
            assert case.auth.claimed
            assert kwargs["intent"] == initial.intent
            assert kwargs["spec"] == initial.spec

        def execute(self, **kwargs):
            del kwargs
            return '<<RESULT>>{"result":"ok"}<<RESULT>>'

    monkeypatch.setattr(module, "HostNativeCodeTransport", Transport)
    calls = NativeCallAdapter(
        state=case.state,
        authorization=case.auth,
        journal=case.journal,
        max_result_bytes=8 << 20,
    )
    execute = module.NativeCodeExecutor(
        producer=case.producer,
        calls=calls,
        owner=case.owner,
        on_prepared=lambda: None,
    )
    case.auth.decisions[0] = ApprovalWait(pending_operation_id="pending")
    with pytest.raises(NativeApprovalWait):
        execute.execute(language=CodeLanguage.PYTHON3, code=case.raw["code"], inputs={})
    assert not physical
    assert not case.auth.claimed
    del case.auth.decisions[0]
    assert execute.execute(language=CodeLanguage.PYTHON3, code=case.raw["code"], inputs={}) == {"result": "ok"}
    assert execute.execute(language=CodeLanguage.PYTHON3, code=case.raw["code"], inputs={}) == {"result": "ok"}
    assert len(physical) == 1
