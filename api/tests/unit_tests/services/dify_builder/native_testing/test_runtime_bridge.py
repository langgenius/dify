"""No ordinary collaborator is constructed for a marked native run."""

from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, cast
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Actor
from graphon.engine import Engine
from graphon.entities.base_node_data import BaseNodeData
from graphon.http import HttpResponse
from graphon.nodes.base.node import Node
from graphon.runtime import InitParams, RuntimeState
from runtime_contracts.builder.native.contracts import NativeTestContextRef, OperationKey
from services.dify_builder.native_testing.api_service import NativeTestApiService
from services.dify_builder.native_testing.control import (
    BoundaryOwnerState,
    NativeControlAccepted,
    NativeControlRecord,
    NativeControlSink,
)
from services.dify_builder.native_testing.runtime_bridge import (
    NativeCollaborators,
    NativeNodePreparation,
    NativeRuntimeBridge,
)

if TYPE_CHECKING:
    from services.workflow_runtime.node_factory import DifyNodeFactory

from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing.context_binding import NativeContextUnavailable
from tests.unit_tests.services.dify_builder.native_testing.test_runtime_contracts import CONTEXT


def _api():
    return NativeTestApiService(
        session_factory=sessionmaker(),
        actor=Actor(account_id="actor-1", tenant_id="tenant-1"),
        resolver=None,
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=None,
    )


class _BridgeCollaborators:
    """Explicit collaborator composition port for constructor-only bridge tests."""

    def __init__(self, bundle: NativeCollaborators):
        self.bundle = bundle

    def provide(self, *, association: NativeNodePreparation) -> NativeCollaborators:
        assert isinstance(association, NativeNodePreparation)
        return self.bundle

    def node_arguments(self, **_kwargs) -> Mapping[str, object]:
        return {"http_client": self.bundle.http}


def bridge_fixture(
    mocker,
) -> tuple[ResolvedNativeTestContext, NativeRuntimeBridge, NativeCollaborators, Mock, BoundaryOwnerState, Mock]:
    context = ResolvedNativeTestContext.model_validate(CONTEXT)
    state = _api().store
    mocker.patch.object(state, "load_context", return_value=context)
    bundle = NativeCollaborators(**{name: object() for name in NativeCollaborators.__dataclass_fields__})
    composition = _BridgeCollaborators(bundle)
    provider = mocker.patch.object(composition, "provide", return_value=bundle)
    owner = BoundaryOwnerState(ref=context.ref)
    sink = SyntheticSink()
    arguments = mocker.patch.object(composition, "node_arguments", return_value={"http_client": bundle.http})
    bridge = NativeRuntimeBridge(
        state=state,
        collaborators=provider,
        boundary_owner=owner,
        control_sink=sink,
        node_arguments=arguments,
    )
    return context, bridge, bundle, provider, owner, arguments


def test_marked_factory_requires_bridge_before_eager_model_setup(mocker) -> None:
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from services.workflow_runtime import node_factory

    eager = mocker.patch.object(node_factory, "build_dify_model_access", side_effect=AssertionError("ordinary setup"))
    context = DifyRunContext(
        tenant_id="tenant-1",
        app_id="app-1",
        user_id="actor-1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
    )
    with pytest.raises(NativeContextUnavailable, match="native_context_missing"):
        node_factory.DifyNodeFactory(
            init_params=InitParams(
                run_context={"_dify": context}, workflow_id="workflow", graph_config={}, call_depth=0
            ),
            runtime_state=cast(RuntimeState, object()),
        )
    eager.assert_not_called()


def test_factory_preserves_bridge_on_runtime_clone_and_checks_owners(mocker) -> None:
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from services.workflow_runtime import node_factory

    context, bridge, _, provider, _, _ = bridge_fixture(mocker)
    eager = mocker.patch.object(node_factory, "build_dify_model_access", side_effect=AssertionError("ordinary setup"))
    run = DifyRunContext(
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        user_id=context.actor_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
        native_test_ref=context.ref,
    )
    init = InitParams(
        run_context={"_dify": run}, workflow_id=context.workflow_id, graph_config=context.graph, call_depth=0
    )
    factory = node_factory.DifyNodeFactory(
        init_params=cast(InitParams, init),
        runtime_state=cast(RuntimeState, object()),
        native_runtime=bridge,
    )
    clone = factory.with_runtime_state(cast(RuntimeState, object()))
    assert clone._native_runtime is bridge
    provider.assert_not_called()
    eager.assert_not_called()
    init.workflow_id = "foreign"
    with pytest.raises(NativeContextUnavailable, match="native_context_mismatch"):
        node_factory.DifyNodeFactory(
            init_params=cast(InitParams, init),
            runtime_state=cast(RuntimeState, object()),
            native_runtime=bridge,
        )


def test_unmarked_factory_cannot_accept_native_bridge(mocker) -> None:
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from services.workflow_runtime import node_factory

    _, bridge, _, _, _, _ = bridge_fixture(mocker)
    eager = mocker.patch.object(node_factory, "build_dify_model_access", side_effect=AssertionError("ordinary setup"))
    run = DifyRunContext(
        tenant_id="t", app_id="a", user_id="u", user_from=UserFrom.ACCOUNT, invoke_from=InvokeFrom.DEBUGGER
    )
    with pytest.raises(NativeContextUnavailable, match="native_context_missing"):
        node_factory.DifyNodeFactory(
            init_params=InitParams(run_context={"_dify": run}, workflow_id="w", graph_config={}, call_depth=0),
            runtime_state=cast(RuntimeState, object()),
            native_runtime=bridge,
        )
    eager.assert_not_called()


def test_native_factory_constructs_real_registered_start_without_resolving_occurrence(mocker) -> None:
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from graphon.nodes.start.start_node import StartNode
    from graphon.runtime import RuntimeState, VariablePool
    from services.workflow_runtime.node_factory import DifyGraphInitContext, DifyNodeFactory

    context, bridge, bundle, provider, _, arguments = bridge_fixture(mocker)
    node: dict[str, object] = {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}
    context = context.model_copy(update={"graph": {"nodes": [node], "edges": []}})
    bridge.state.load_context.return_value = context
    arguments.return_value = dict[str, object]()

    run = DifyRunContext(
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        user_id=context.actor_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
        native_test_ref=context.ref,
    )
    factory = DifyNodeFactory.from_graph_init_context(
        graph_init_context=DifyGraphInitContext(
            workflow_id=context.workflow_id, graph_config=context.graph, run_context={"_dify": run}, call_depth=0
        ),
        runtime_state=RuntimeState(workflow_id=CONTEXT["workflow_id"], variable_pool=VariablePool(), start_at=0),
        native_runtime=bridge,
    )
    created = factory.create_node(node)
    assert isinstance(created, StartNode)
    association = provider.call_args.kwargs["association"]
    with pytest.raises(NativeContextUnavailable, match="native_execution_id_missing"):
        _ = association.execution_id
    created.bind_execution_id("00000000-0000-4000-8000-000000000001")
    assert association.execution_id == created.execution_id
    assert association.occurrence_path == (created.execution_id,)
    assert association.resolve().budget_ref == context.budget_ref
    assert list(created.run())
    assert arguments.call_args.kwargs["collaborators"] is bundle


class SyntheticSink:
    """Explicit in-memory acceptance witness; no persistence/checkpoint claim."""

    def __init__(self) -> None:
        self.records: list[NativeControlRecord] = []

    def record_control(self, *, record: NativeControlRecord) -> NativeControlAccepted:
        from services.dify_builder.native_testing.control import NativeControlAccepted

        self.records.append(record)
        return NativeControlAccepted(record=record)


def preparation_fixture(
    mocker,
) -> tuple[ResolvedNativeTestContext, NativeRuntimeBridge, NativeNodePreparation, Node[BaseNodeData], Mock]:
    from graphon.nodes.start.start_node import StartNode
    from graphon.runtime import InitParams, RuntimeState, VariablePool

    context, bridge, _, provider, _, arguments = bridge_fixture(mocker)
    runtime = RuntimeState(workflow_id="unit", variable_pool=VariablePool(), start_at=0)
    arguments.return_value = dict[str, object]()
    prepared = bridge.prepare_node(
        ref=context.ref,
        node_id="start",
        node_data=StartNode.validate_node_data({"type": "start", "variables": []}),
        node_class=StartNode,
        runtime_state=runtime,
    )
    node = prepared.node_class(
        node_id="start",
        data={"type": "start", "variables": []},
        init_params=InitParams(workflow_id="unit", graph_config={}, run_context={}, call_depth=0),
        runtime_state=runtime,
        **prepared.arguments,
    )
    return context, bridge, prepared, node, provider


def test_preparation_and_constructor_cannot_open_context_or_bound_occurrence(mocker) -> None:
    context, bridge, prepared, node, _ = preparation_fixture(mocker)
    bridge.state.load_context.assert_not_called()
    for read in (
        lambda: prepared.execution_id,
        lambda: prepared.occurrence_path,
        prepared.resolve,
        lambda: prepared.runtime_state,
    ):
        with pytest.raises(NativeContextUnavailable, match="native_node_unattached"):
            read()
    prepared.attach(node)
    for read in (lambda: prepared.execution_id, prepared.resolve, lambda: prepared.runtime_state):
        with pytest.raises(NativeContextUnavailable, match="native_execution_id_missing"):
            read()
    bridge.state.load_context.assert_not_called()
    node.bind_execution_id("00000000-0000-4000-8000-000000000001")
    assert prepared.resolve().ref == context.ref
    assert prepared.runtime_state is node.runtime_state


def test_constructor_effect_attempt_is_refused_before_any_context_read(mocker) -> None:
    from graphon.nodes.start.start_node import StartNode

    context, bridge, _, provider, _, _ = bridge_fixture(mocker)

    def eager(*, association: NativeNodePreparation) -> NativeCollaborators:
        association.resolve()
        raise AssertionError("unreachable")

    provider.side_effect = eager
    with pytest.raises(NativeContextUnavailable, match="native_node_unattached"):
        bridge.prepare_node(
            ref=context.ref, node_id="start", node_data={}, node_class=StartNode, runtime_state=object()
        )
    bridge.state.load_context.assert_not_called()


@pytest.mark.parametrize("mutation", ["class", "node_id", "runtime", "double", "ref", "binding", "rebind"])
def test_association_rejects_foreign_or_changed_identity_without_context_read(mocker, mutation: str) -> None:
    from graphon.nodes.start.start_node import StartNode

    context, bridge, prepared, node, _ = preparation_fixture(mocker)
    if mutation == "class":
        foreign = StartNode(
            node_id="start",
            data=StartNode.validate_node_data({"type": "start", "variables": []}),
            init_params=node.init_params,
            runtime_state=node.runtime_state,
        )
    else:
        foreign = node
    if mutation == "node_id":
        foreign.id = "private-canary"
    if mutation == "runtime":
        foreign.runtime_state = cast(RuntimeState, object())
    if mutation in {"class", "node_id", "runtime"}:
        with pytest.raises(NativeContextUnavailable, match="native_node_mismatch") as caught:
            prepared.attach(foreign)
    else:
        prepared.attach(node)
        node.bind_execution_id("00000000-0000-4000-8000-000000000001")
        if mutation == "double":
            with pytest.raises(NativeContextUnavailable, match="native_node_already_attached") as caught:
                prepared.attach(node)
        else:
            if mutation == "ref":
                bridge._boundary_owner.ref = context.ref.model_copy(update={"invocation_id": "private-canary"})
            elif mutation == "binding":
                node.bind_execution_id("private-canary")
            else:
                assert prepared.execution_id == "00000000-0000-4000-8000-000000000001"
                node.bind_execution_id("00000000-0000-4000-8000-000000000002")
            with pytest.raises(NativeContextUnavailable) as caught:
                prepared.resolve()
    assert "private-canary" not in str(caught.value)
    bridge.state.load_context.assert_not_called()


def test_preparation_requires_exact_owner_ref_and_explicit_control_dependencies(mocker) -> None:
    from graphon.nodes.start.start_node import StartNode
    from services.dify_builder.native_testing.runtime_bridge import NativeRuntimeBridge

    context, bridge, _, provider, _, _ = bridge_fixture(mocker)
    with pytest.raises(NativeContextUnavailable, match="native_context_mismatch"):
        bridge.prepare_node(
            ref=context.ref.model_copy(update={"invocation_id": "foreign"}),
            node_id="start",
            node_data={},
            node_class=StartNode,
            runtime_state=object(),
        )
    provider.assert_not_called()
    with pytest.raises(NativeContextUnavailable, match="native_control_unavailable"):
        NativeRuntimeBridge(
            state=bridge.state,
            collaborators=provider,
            node_arguments=lambda **_: {},
            boundary_owner=cast(BoundaryOwnerState, None),
            control_sink=cast(NativeControlSink, None),
        )


def test_effect_revalidates_full_private_context_each_time(mocker) -> None:
    context, bridge, prepared, node, _ = preparation_fixture(mocker)
    prepared.attach(node)
    node.bind_execution_id("00000000-0000-4000-8000-000000000001")
    assert prepared.resolve().ref == context.ref
    bridge.state.load_context.return_value = context.model_copy(
        update={"ref": context.ref.model_copy(update={"invocation_id": "foreign"})}
    )
    with pytest.raises(NativeContextUnavailable, match="native_context_mismatch"):
        prepared.resolve()


class EffectsWitness:
    """Synthetic physical effect witness, never external business/provider I/O."""

    def __init__(self, mode: str = "allow") -> None:
        from threading import Lock

        self.mode = mode
        self.entries: list[tuple[OperationKey, object]] = []
        self.dispatches: list[OperationKey] = []
        self.failed: set[OperationKey] = set()
        self.bound_associations: dict[OperationKey, NativeNodePreparation] = {}
        self.owner: BoundaryOwnerState
        self.lock = Lock()

    def enter(self, association: NativeNodePreparation, inputs: object) -> None:
        from runtime_contracts.builder.native.contracts import ApprovalWait, OperationKey
        from services.dify_builder.native_testing.control import NativeControlBridge

        context = association.resolve()
        key = OperationKey(
            invocation_id=context.ref.invocation_id, occurrence_path=association.occurrence_path, cursor=0
        )
        with self.lock:
            self.entries.append((key, inputs))
            self.bound_associations[key] = association
        if self.mode == "wait":
            NativeControlBridge.resolve(
                ref=context.ref, decision=ApprovalWait(pending_operation_id="synthetic-pending")
            )
        if self.mode == "retry":
            with self.lock:
                first = key not in self.failed
                self.failed.add(key)
            if first:
                raise RuntimeError("synthetic ordinary failure")
        assert self.owner.dispatch_admissible
        with self.lock:
            self.dispatches.append(key)


class DeferredCode:
    def __init__(self, association: NativeNodePreparation, witness: EffectsWitness) -> None:
        self.association, self.witness = association, witness

    def execute(self, *, language: str, code: str, inputs: Mapping[str, object]) -> dict[str, str]:
        assert language == "python3"
        assert code == "synthetic"
        self.witness.enter(self.association, inputs)
        return {"output": "same"}

    def is_execution_error(self, error: BaseException) -> bool:
        return isinstance(error, RuntimeError)


class DeferredHttp:
    request_error = ValueError
    max_retries_exceeded_error = TimeoutError

    def __init__(self, association: NativeNodePreparation, witness: EffectsWitness) -> None:
        self.association, self.witness = association, witness

    def request(self, method: str, url: str, **kwargs: object) -> HttpResponse:
        from graphon.http import HttpResponse

        assert kwargs["max_retries"] == 0
        self.witness.enter(self.association, (method, url))
        return HttpResponse(status_code=200, headers={"content-type": "text/plain"}, content=b"same", url=url)

    def get(self, url: str, **kwargs: object) -> HttpResponse:
        return self.request("get", url, **kwargs)

    head = post = put = delete = patch = get


class DeniedFiles:
    """No file preparation is expected for literal file-free fixture HTTP."""

    def __getattr__(self, name: str) -> object:
        raise AssertionError("unexpected file collaborator operation")


def native_factory(
    mocker, config: Mapping[str, object], runtime: RuntimeState, witness: EffectsWitness
) -> tuple[DifyNodeFactory, BoundaryOwnerState, SyntheticSink, list[NativeNodePreparation]]:
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from graphon.nodes.code.limits import CodeNodeLimits
    from graphon.nodes.http_request import HttpRequestNodeConfig
    from services.dify_builder.native_testing.control import BoundaryOwnerState
    from services.dify_builder.native_testing.runtime_bridge import NativeCollaborators, NativeRuntimeBridge
    from services.workflow_runtime.node_factory import DifyGraphInitContext, DifyNodeFactory

    context = ResolvedNativeTestContext.model_validate({**CONTEXT, "graph": config})
    state = _api().store
    mocker.patch.object(state, "load_context", return_value=context)
    owner, sink = BoundaryOwnerState(ref=context.ref), SyntheticSink()
    witness.owner = owner
    associations: list[NativeNodePreparation] = []
    denied = DeniedFiles()

    def collaborators(*, association: NativeNodePreparation) -> NativeCollaborators:
        associations.append(association)
        return NativeCollaborators(
            http=DeferredHttp(association, witness),
            code=DeferredCode(association, witness),
            **{name: denied for name in NativeCollaborators.__dataclass_fields__ if name not in {"http", "code"}},
        )

    def arguments(
        *,
        node_id: str,
        node_data: BaseNodeData,
        node_class: type[Node[BaseNodeData]],
        collaborators: NativeCollaborators,
    ) -> Mapping[str, object]:
        assert node_id
        assert node_class.node_type == node_data.type
        if node_data.type == "code":
            return {
                "code_executor": collaborators.code,
                "code_limits": CodeNodeLimits(
                    max_string_length=1000,
                    max_number=1000,
                    min_number=-1000,
                    max_precision=10,
                    max_depth=10,
                    max_number_array_length=100,
                    max_string_array_length=100,
                    max_object_array_length=100,
                ),
            }
        if node_data.type == "http-request":
            return {
                "http_client": collaborators.http,
                "file_manager": collaborators.file,
                "tool_file_manager_factory": lambda: collaborators.file,
                "file_reference_factory": collaborators.file,
                "http_request_config": HttpRequestNodeConfig(
                    max_connect_timeout=2,
                    max_read_timeout=2,
                    max_write_timeout=2,
                    max_binary_size=4096,
                    max_text_size=4096,
                    ssl_verify=True,
                    ssrf_default_max_retries=0,
                ),
            }
        return {}

    bridge = NativeRuntimeBridge(
        state=state, collaborators=collaborators, node_arguments=arguments, boundary_owner=owner, control_sink=sink
    )
    run = DifyRunContext(
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        user_id=context.actor_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
        native_test_ref=context.ref,
    )
    factory = DifyNodeFactory.from_graph_init_context(
        graph_init_context=DifyGraphInitContext(
            workflow_id=context.workflow_id, graph_config=config, run_context={"_dify": run}, call_depth=0
        ),
        runtime_state=runtime,
        native_runtime=bridge,
    )
    return factory, owner, sink, associations


def native_engine(
    mocker, config: Mapping[str, object], runtime: RuntimeState, witness: EffectsWitness
) -> tuple[Engine, BoundaryOwnerState, SyntheticSink, list[NativeNodePreparation]]:
    from graphon.engine.command import InMemoryChannel
    from graphon.graph.graph import Graph

    factory, owner, sink, associations = native_factory(mocker, config, runtime, witness)
    graph = Graph.init(graph_config=config, node_factory=factory, root_node_id="start")
    engine = Engine(
        graph=graph,
        runtime_state=runtime,
        command_channel=InMemoryChannel(),
        workers=2,
    )
    return engine, owner, sink, associations


def raw_node(node_id: str, kind: str, **data: object) -> dict[str, object]:
    return {"id": node_id, "data": {"type": kind, "title": node_id, **data}}


@pytest.mark.parametrize("mode", ["allow", "wait"])
def test_real_factory_http_effect_uses_public_binding_and_marked_control(mocker, mode: str) -> None:
    from graphon.engine_events.graph import GraphRunPausedEvent, GraphRunSucceededEvent
    from graphon.engine_events.node import NodeRunPauseRequestedEvent, NodeRunStartedEvent
    from graphon.runtime import RuntimeState, VariablePool

    config = {
        "nodes": [
            raw_node("start", "start", variables=[]),
            raw_node(
                "http",
                "http-request",
                method="get",
                url="https://synthetic.invalid/path",
                authorization={"type": "no-auth"},
                headers="",
                params="",
            ),
            raw_node("end", "end", outputs=[{"variable": "answer", "value_selector": ["http", "body"]}]),
        ],
        "edges": [{"source": "start", "target": "http"}, {"source": "http", "target": "end"}],
    }
    witness = EffectsWitness(mode)
    engine, owner, sink, associations = native_engine(
        mocker,
        config,
        RuntimeState(workflow_id=CONTEXT["workflow_id"], variable_pool=VariablePool(), start_at=0),
        witness,
    )
    assert witness.entries == []
    events = list(engine.run())
    native_id = next(event.id for event in events if isinstance(event, NodeRunStartedEvent) and event.node_id == "http")
    assert witness.entries[0][0].occurrence_path == (native_id,)
    assert witness.entries[0][0].invocation_id == owner.ref.invocation_id
    if mode == "wait":
        assert isinstance(events[-1], GraphRunPausedEvent)
        assert witness.dispatches == []
        assert owner.status == "WAIT_RECORDED"
        assert sink.records[0].native_execution_id == native_id
        assert next(event.id for event in events if isinstance(event, NodeRunPauseRequestedEvent)) == native_id
    else:
        assert isinstance(events[-1], GraphRunSucceededEvent)
        assert engine.runtime_state.outputs == {"answer": "same"}
        assert len(witness.dispatches) == 1
    assert len(associations) == 3


@pytest.mark.parametrize("kind", ["loop", "iteration"])
def test_actual_engine_equal_inputs_distinct_occurrences_restore_retry_and_fresh_clone(mocker, kind: str) -> None:
    from graphon.engine_events.graph import GraphRunPartialSucceededEvent, GraphRunPausedEvent
    from graphon.runtime import RuntimeState, VariablePool

    if kind == "loop":
        container = raw_node(
            "container",
            "loop",
            loop_count=2,
            start_node_id="body-start",
            break_conditions=[],
            logical_operator="and",
            loop_variables=[],
        )
        starter = raw_node("body-start", "loop-start", loop_id="container")
        membership = {"loop_id": "container"}
        outputs = [{"variable": "rounds", "value_selector": ["container", "loop_round"]}]
    else:
        container = raw_node(
            "container",
            "iteration",
            iterator_selector=["start", "items"],
            output_selector=["guard", "output"],
            start_node_id="body-start",
            is_parallel=True,
            parallel_nums=2,
            error_handle_mode="terminated",
            flatten_output=True,
        )
        starter = raw_node("body-start", "iteration-start", iteration_id="container")
        membership = {"iteration_id": "container"}
        outputs = [{"variable": "items", "value_selector": ["container", "output"]}]
    guard = raw_node(
        "guard",
        "code",
        code="synthetic",
        code_language="python3",
        variables=[],
        outputs={"output": {"type": "string"}},
        retry_config={"retry_enabled": True, "max_retries": 1, "retry_interval": 0},
        **membership,
    )
    config = {
        "nodes": [
            raw_node("start", "start", variables=[]),
            container,
            starter,
            guard,
            raw_node("end", "end", outputs=outputs),
        ],
        "edges": [
            {"source": "start", "target": "container"},
            {"source": "body-start", "target": "guard"},
            {"source": "container", "target": "end"},
        ],
    }
    pool = VariablePool()
    pool.add(("start", "items"), ["same", "same"])
    runtime = RuntimeState(workflow_id=CONTEXT["workflow_id"], variable_pool=pool, start_at=0)
    before = EffectsWitness("wait")
    first, owner, sink, preparations = native_engine(mocker, config, runtime, before)
    assert isinstance(list(first.run())[-1], GraphRunPausedEvent)
    assert before.dispatches == []
    assert owner.status == "WAIT_RECORDED"
    waited_keys = {key for key, _ in before.entries}
    # The first pause defers unclaimed siblings. A parallel sibling may have
    # reached its guard already, but both must complete distinctly on restore.
    assert 1 <= len(waited_keys) <= (1 if kind == "loop" else 2)
    assert len(waited_keys) == len(before.entries)
    assert {record.native_execution_id for record in sink.records} == {key.occurrence_path[0] for key in waited_keys}
    restored = RuntimeState.from_snapshot(runtime.dumps())
    after = EffectsWitness("retry")
    second, new_owner, _, new_preparations = native_engine(mocker, config, restored, after)
    terminal = list(second.run())[-1]
    assert isinstance(terminal, GraphRunPartialSucceededEvent)
    assert terminal.exceptions_count == 2
    completed_keys = set(after.dispatches)
    assert len(after.dispatches) == len(completed_keys) == 2
    assert waited_keys <= completed_keys
    for key in completed_keys:
        assert len([entry for entry, _ in after.entries if entry == key]) == 2
    assert all(inputs == {} for _, inputs in before.entries + after.entries)
    assert all(key.invocation_id == owner.ref.invocation_id for key in completed_keys)
    assert all(a is not b for a in preparations for b in new_preparations)
    guards = list(after.bound_associations.values())
    assert len(guards) == 2
    assert guards[0].runtime_state is not guards[1].runtime_state
    assert all(a.ref == new_owner.ref for a in new_preparations)
    assert second.runtime_state.outputs == ({"rounds": 2} if kind == "loop" else {"items": ["same", "same"]})
    print(  # noqa: T201
        "ACTUAL_ENGINE_OCCURRENCE",
        kind,
        sorted(key.occurrence_path for key in completed_keys),
        "waited",
        len(waited_keys),
        "restored_entries",
        len(after.entries),
    )


@pytest.mark.parametrize(
    "reserved",
    ["node_id", "data", "graph_init_params", "graph_runtime_state", "native_control_owner", "native_control_sink"],
)
def test_constructor_adapter_cannot_replace_attached_identity_or_control_owner(mocker, reserved: str) -> None:
    from graphon.nodes.start.start_node import StartNode

    context, bridge, _, _, _, arguments = bridge_fixture(mocker)
    arguments.return_value = {reserved: "private-canary"}
    with pytest.raises(NativeContextUnavailable, match="native_node_arguments_invalid") as caught:
        bridge.prepare_node(
            ref=context.ref, node_id="start", node_data={}, node_class=StartNode, runtime_state=object()
        )
    assert "private-canary" not in str(caught.value)
    bridge.state.load_context.assert_not_called()


@pytest.mark.parametrize("invalid", [None, "missing-slot"])
def test_missing_deferred_collaborator_never_uses_ordinary_fallback(mocker, invalid: str | None) -> None:
    from dataclasses import replace

    from graphon.nodes.start.start_node import StartNode

    context, bridge, bundle, provider, _, _ = bridge_fixture(mocker)
    provider.return_value = None if invalid is None else replace(bundle, http=None)
    with pytest.raises(NativeContextUnavailable, match="native_collaborator_unavailable"):
        bridge.prepare_node(
            ref=context.ref, node_id="start", node_data={}, node_class=StartNode, runtime_state=object()
        )
    bridge.state.load_context.assert_not_called()


@pytest.mark.parametrize("field", ["ref", "node_id", "node_class", "arguments"])
def test_preparation_public_expected_identity_cannot_be_replaced(mocker, field: str) -> None:
    _, _, prepared, _, _ = preparation_fixture(mocker)
    with pytest.raises(AttributeError):
        setattr(prepared, field, "private-canary")


def test_constructor_argument_mapping_cannot_replace_control_dependencies(mocker) -> None:
    _, _, prepared, _, _ = preparation_fixture(mocker)
    with pytest.raises(TypeError):
        cast(dict[str, object], prepared.arguments)["native_control_owner"] = "private-canary"


@pytest.mark.parametrize("mutation", ["id", "runtime", "ref", "execution_id"])
def test_effect_rechecks_attached_identity_after_private_context_read(mocker, mutation: str) -> None:
    context, bridge, prepared, node, _ = preparation_fixture(mocker)
    prepared.attach(node)
    node.bind_execution_id("00000000-0000-4000-8000-000000000001")

    def load(*, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        assert ref == context.ref
        if mutation == "id":
            node.id = "private-canary"
        elif mutation == "runtime":
            node.runtime_state = cast(RuntimeState, object())
        elif mutation == "ref":
            bridge._boundary_owner.ref = context.ref.model_copy(update={"invocation_id": "private-canary"})
        else:
            node.bind_execution_id("00000000-0000-4000-8000-000000000002")
        return context

    bridge.state.load_context.side_effect = load
    with pytest.raises(NativeContextUnavailable) as caught:
        prepared.resolve()
    assert "private-canary" not in str(caught.value)


def test_bound_node_getter_requires_attachment_and_public_binding_without_context_read(mocker) -> None:
    _, bridge, prepared, node, _ = preparation_fixture(mocker)
    with pytest.raises(NativeContextUnavailable, match="native_node_unattached"):
        _ = prepared.bound_node
    prepared.attach(node)
    with pytest.raises(NativeContextUnavailable, match="native_execution_id_missing"):
        _ = prepared.bound_node
    node.bind_execution_id("00000000-0000-4000-8000-000000000001")
    assert prepared.bound_node is node
    bridge.state.load_context.assert_not_called()
    property_name = "bound_node"
    with pytest.raises(AttributeError):
        setattr(prepared, property_name, object())


@pytest.mark.parametrize("mutation", ["node_id", "runtime", "class", "ref", "execution_id"])
def test_bound_node_getter_rejects_attached_identity_drift_without_context_read(mocker, mutation: str) -> None:
    context, bridge, prepared, node, _ = preparation_fixture(mocker)
    prepared.attach(node)
    node.bind_execution_id("00000000-0000-4000-8000-000000000001")
    assert prepared.bound_node is node
    if mutation == "node_id":
        node.id = "private-canary"
    elif mutation == "runtime":
        node.runtime_state = cast(RuntimeState, object())
    elif mutation == "class":
        property_name = "__class__"
        foreign_class = type("ForeignMarkedNode", (type(node),), {"__slots__": ()})
        setattr(node, property_name, foreign_class)
    elif mutation == "ref":
        bridge._boundary_owner.ref = context.ref.model_copy(update={"invocation_id": "private-canary"})
    else:
        node.bind_execution_id("00000000-0000-4000-8000-000000000002")
    with pytest.raises(NativeContextUnavailable) as caught:
        _ = prepared.bound_node
    assert "private-canary" not in str(caught.value)
    bridge.state.load_context.assert_not_called()


@pytest.mark.parametrize("foreign", ["owner", "sink"])
def test_attach_rejects_foreign_control_composition_with_same_native_class_and_runtime(mocker, foreign: str) -> None:
    context, bridge, prepared, node, _ = preparation_fixture(mocker)
    arguments = dict(prepared.arguments)
    if foreign == "owner":
        arguments["native_control_owner"] = BoundaryOwnerState(ref=context.ref)
    else:
        arguments["native_control_sink"] = SyntheticSink()
    other = prepared.node_class(
        node_id="start",
        data=node.node_data,
        init_params=node.init_params,
        runtime_state=node.runtime_state,
        **arguments,
    )
    with pytest.raises(NativeContextUnavailable, match="native_node_mismatch"):
        prepared.attach(other)
    bridge.state.load_context.assert_not_called()


def _delivery_runtime(mocker, case):
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeResumeSettlement, DifyNativeRuntime
    from services.dify_builder.native_testing.sandbox.host import NativeCodeHostOwner

    api = _api()
    load = mocker.patch.object(api.store, "load_context", return_value=case.state.context)
    api.lifecycle.resume_settlement = DifyNativeResumeSettlement()
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch

    # This constructor-only bridge contract does not acquire the telemetry owner.
    with patch.object(NativeHostLaunch, "bind_observation"):
        runtime = DifyNativeRuntime(
            delivery=NativeDispatchRef(
                ref=case.state.context.ref, generation=case.state.context.generation, dispatch_id="dispatch"
            ),
            lifecycle=api.lifecycle,
            registry=case.registry,
        )
    runtime.host = case.host
    runtime._journal = case.journal
    runtime.authorization = case.authorization
    runtime.code_owner = NativeCodeHostOwner(host=case.host, loader=api.loader)
    load.reset_mock()
    return runtime


@pytest.mark.parametrize("kind", ["code", "template-transform"])
def test_code_delivery_composes_actual_native_protocol_without_eager_payload(mocker, kind):
    from graphon.nodes.code.code_node import CodeNode
    from graphon.nodes.code.entities import CodeNodeData
    from graphon.nodes.template_transform.entities import TemplateTransformNodeData
    from graphon.nodes.template_transform.template_transform_node import (
        TemplateTransformNode,
    )
    from graphon.runtime import VariablePool
    from services.dify_builder.native_testing.runtime import DifyNativeRuntime, build_delivery_bridge
    from services.dify_builder.native_testing.sandbox.executor import NativeCodeExecutor
    from tests.unit_tests.services.dify_builder.native_testing.test_code_host import (
        code_case,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_code_qualification import (
        qualification,
        raw_code,
    )

    case = code_case()
    q, _ = qualification()
    runtime = _delivery_runtime(mocker, case)
    runtime.code_qualification = q
    store = runtime.lifecycle.store
    store.load_context.side_effect = AssertionError("eager protected input")
    bridge = build_delivery_bridge(runtime=cast(DifyNativeRuntime, runtime))
    state = RuntimeState(workflow_id=CONTEXT["workflow_id"], variable_pool=VariablePool(), start_at=0)
    cls = CodeNode if kind == "code" else TemplateTransformNode
    data = (
        CodeNodeData.model_validate(raw_code())
        if kind == "code"
        else TemplateTransformNodeData.model_validate(
            {
                "type": kind,
                "title": "private",
                "template": "{{ secret }}",
                "variables": [],
            }
        )
    )
    prepared = bridge.prepare_node(
        ref=case.state.context.ref,
        node_id="code",
        node_data=data,
        node_class=cls,
        runtime_state=state,
    )
    args = prepared.arguments
    executor = args["code_executor"] if kind == "code" else args["jinja2_template_renderer"]._executor
    assert type(executor) is NativeCodeExecutor
    assert executor.owner is runtime.code_owner
    assert executor.producer.association is prepared
    assert executor.calls._host is case.host
    assert args["code_limits"].max_string_length > 0 if kind == "code" else args["max_output_length"] > 0
    store.load_context.assert_not_called()


def test_default_delivery_refuses_code_before_protected_payload(mocker):
    from graphon.nodes.code.code_node import CodeNode
    from graphon.nodes.code.entities import CodeNodeData
    from runtime_contracts.builder.execution import BuilderExecutionPolicyError
    from services.dify_builder.native_testing.runtime import DifyNativeRuntime, build_delivery_bridge
    from tests.unit_tests.services.dify_builder.native_testing.test_code_host import (
        code_case,
    )
    from tests.unit_tests.services.dify_builder.native_testing.test_code_qualification import (
        raw_code,
    )

    case = code_case()
    runtime = _delivery_runtime(mocker, case)
    store = runtime.lifecycle.store
    store.load_context.side_effect = AssertionError("unqualified payload read")
    bridge = build_delivery_bridge(runtime=cast(DifyNativeRuntime, runtime))
    with pytest.raises(BuilderExecutionPolicyError, match="native_capability_unavailable"):
        bridge.prepare_node(
            ref=case.state.context.ref,
            node_id="code",
            node_data=CodeNodeData.model_validate(raw_code()),
            node_class=CodeNode,
            runtime_state=object(),
        )
    store.load_context.assert_not_called()
