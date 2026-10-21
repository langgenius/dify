"""Offline zero-resource admission with real compiler, delivery bridge and Graphon.

SQL/RBAC reads and protected state are explicit in-memory boundary doubles. These
units qualify no database authorization, persistence, host cleanup or external I/O.
"""

import json
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from typing import NoReturn, cast

import httpx
import pytest
from sqlalchemy import Select
from sqlalchemy.orm import Session as OrmSession
from sqlalchemy.orm import sessionmaker

from core.dify_builder.models import Actor
from graphon.runtime.runtime_state.state import RuntimeState
from models.dify_builder import DifyBuilderSession, DifyBuilderTestInput
from models.model import App
from models.workflow import Workflow
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import NativeTestContextRef
from runtime_contracts.builder.native.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.execution_policy_service import ExecutionOwnerSnapshot
from services.dify_builder.native_testing import context_binding, http_binding
from services.dify_builder.native_testing.context_binding import NativeAdmissionCompilation, NativeAdmissionCompiler
from services.dify_builder.native_testing.control import BoundaryOwnerState
from services.workflow_runtime.node_factory import DifyNodeFactory
from tests.unit_tests.services.dify_builder.native_testing.test_observation_privacy import FixtureGraph, FixtureNode


@dataclass
class ZeroHttpCase:
    graph: FixtureGraph
    workflow: Workflow
    actor: Actor
    monkeypatch: pytest.MonkeyPatch
    active: int = 0
    permissions: list[tuple[str, str, str]] = field(default_factory=list)
    owner_reads: list[dict[str, object]] = field(default_factory=list)
    workflow_reads: int = 0
    permission_failure: int | None = None
    workflow_failure: str | None = None
    sessions: Callable[[], AbstractContextManager[object]] | None = None
    forbidden_io: Callable[..., NoReturn] | None = None
    snapshot: http_binding.NativeHttpResourceSnapshot | None = None
    compiler: NativeAdmissionCompiler | None = None

    def compile(self) -> NativeAdmissionCompilation:
        self.workflow.graph = json.dumps(self.graph)
        assert self.compiler is not None
        return self.compiler.compile(
            actor=self.actor,
            session_id="session",
            test_input_id="input",
            expected_version=1,
            mode="native",
            request_id="request",
            invocation_id="invocation",
            native_run_id="run",
            profile=http_binding.build_native_http_profile(),
        )


@pytest.fixture
def zero_http_case(monkeypatch: pytest.MonkeyPatch) -> ZeroHttpCase:
    graph: FixtureGraph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": list[object]()}},
            {"id": "end", "data": {"type": "end", "title": "End", "outputs": list[object]()}},
        ],
        "edges": [{"source": "start", "target": "end"}],
    }
    workflow = Workflow(
        tenant_id="tenant",
        created_by="actor",
        version="draft",
        id="workflow",
        app_id="app",
        graph=json.dumps(graph),
        type="workflow",
        kind="standard",
        _features="{}",
        _environment_variables="[]",
        _conversation_variables="[]",
    )
    actor = Actor(tenant_id="tenant", account_id="actor")
    builder = DifyBuilderSession(
        id="session",
        app_id="app",
        version=1,
        tenant_id="tenant",
        owner_account_id="actor",
        entry_mode="build",
        current_state="build.execution",
    )
    test_input = DifyBuilderTestInput(
        id="input", inputs={}, start_schema_hash="a" * 64, session_id="session", source="mock"
    )
    case = ZeroHttpCase(graph=graph, workflow=workflow, actor=actor, monkeypatch=monkeypatch)

    class Session:
        def get(self, model: type[DifyBuilderSession], object_id: str) -> DifyBuilderSession:
            assert model is context_binding.DifyBuilderSession
            assert object_id == "session"
            return builder

        def scalar(self, statement: Select[tuple[object, ...]]) -> Workflow:
            # Actual validate_invocation_workflow builds the complete scoped query.
            assert statement.compile().params == {
                "id_1": "workflow",
                "app_id_1": "app",
                "tenant_id_1": "tenant",
                "tenant_id_2": "tenant",
                "status_1": "normal",
                "type_1": "workflow",
            }
            case.workflow_reads += 1
            if case.workflow_failure:
                raise BuilderExecutionPolicyError(case.workflow_failure)
            return workflow

    @contextmanager
    def sessions() -> Generator[Session]:
        case.active += 1
        try:
            yield Session()
        finally:
            case.active -= 1

    def owners(session: object, **kwargs: object) -> ExecutionOwnerSnapshot:
        del session
        assert case.active == 1
        assert kwargs == {"actor": actor, "app_id": "app", "session_id": "session", "test_input_id": "input"}
        case.owner_reads.append(kwargs)
        return ExecutionOwnerSnapshot(
            app=App(id="app", mode="workflow", tenant_id="tenant", status="normal"),
            workflow=workflow,
            session=builder,
            test_input=test_input,
        )

    def permission(actual_actor: Actor, app_id: str, factory: object) -> None:
        assert case.active == 0
        assert actual_actor is actor
        assert app_id == "app"
        assert factory is sessions
        case.permissions.append((actual_actor.tenant_id, actual_actor.account_id, app_id))
        if case.permission_failure == len(case.permissions):
            raise BuilderExecutionPolicyError("execution_permission_denied")

    def forbidden_io(*args: object, **kwargs: object) -> NoReturn:
        del args, kwargs
        pytest.fail("zero HTTP workflow attempted transport or protected effect I/O")

    monkeypatch.setattr(context_binding, "load_execution_owners", owners)
    monkeypatch.setattr(context_binding, "check_execution_permission", permission)
    monkeypatch.setattr(http_binding, "check_execution_permission", permission)
    monkeypatch.setattr(httpx.Client, "send", forbidden_io)
    case.sessions, case.forbidden_io = sessions, forbidden_io
    case.snapshot = http_binding.NativeHttpResourceSnapshot(session_factory=sessions)
    case.compiler = NativeAdmissionCompiler(
        session_factory=cast(sessionmaker[OrmSession], sessions), resources=case.snapshot
    )

    return case


def delivery_factory(
    case: ZeroHttpCase, context: ResolvedNativeTestContext
) -> tuple[DifyNodeFactory, RuntimeState, BoundaryOwnerState]:
    from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
    from graphon.runtime import RuntimeState, VariablePool
    from services.dify_builder.native_testing.runtime import DifyNativeRuntime, build_delivery_bridge
    from services.workflow_runtime.node_factory import DifyGraphInitContext, DifyNodeFactory

    def load_context(*, ref: NativeTestContextRef) -> ResolvedNativeTestContext:
        assert ref == context.ref
        return context

    from services.dify_builder.native_testing.api_service import NativeTestApiService
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetimeRegistry
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from services.dify_builder.native_testing.runtime import DifyNativeResumeSettlement

    # This unit replaces protected-object/RBAC readback, while preserving the
    # actual delivery, host, journal, control and collaborator composition.
    api = NativeTestApiService(
        session_factory=cast(sessionmaker[OrmSession], case.sessions),
        actor=case.actor,
        resolver=http_binding.NativeHttpBindingResolver(),
        admission=None,
        resolution=None,
        runtime=None,
        disclosure=None,
    )
    case.monkeypatch.setattr(api.store, "load_context", load_context)
    api.lifecycle.resume_settlement = DifyNativeResumeSettlement()
    from services.dify_builder.native_testing.host_execution import NativeHostLaunch

    # C03/telemetry acquisition is outside this compiler/bridge unit boundary.
    # Preserve the real inactive constructor, then explicitly activate this
    # test-owned lifetime for the isolated Graphon execution below.
    with case.monkeypatch.context() as construction:
        construction.setattr(NativeHostLaunch, "bind_observation", lambda _self: None)
        runtime = DifyNativeRuntime(
            delivery=NativeDispatchRef(context.ref, context.generation, "dispatch"),
            lifecycle=api.lifecycle,
            registry=NativeHostLifetimeRegistry(),
        )
    runtime.registry.activate(lifetime=runtime.host.lifetime)
    owner = runtime.host.boundary_owner
    for method in ("make_calls", "register_proposals", "register_http_request"):
        case.monkeypatch.setattr(runtime.host, method, case.forbidden_io)
    case.monkeypatch.setattr(runtime.host.control_sink, "record_control", case.forbidden_io)
    case.monkeypatch.setattr(runtime._journal, "open", case.forbidden_io)
    case.monkeypatch.setattr(runtime.authorization, "before_call", case.forbidden_io)
    bridge = build_delivery_bridge(runtime=runtime)
    prepared = bridge.prepare_inputs(context)
    assert prepared.inputs == {}
    assert prepared.files == ()
    assert prepared.environment_variables == ()
    run = DifyRunContext(
        tenant_id=context.tenant_id,
        app_id=context.app_id,
        user_id=context.actor_id,
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        native_test_required=True,
        native_test_ref=context.ref,
    )
    state = RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0)
    factory = DifyNodeFactory.from_graph_init_context(
        graph_init_context=DifyGraphInitContext(
            workflow_id=context.workflow_id,
            graph_config=context.graph,
            run_context={"_dify": run},
            call_depth=0,
        ),
        runtime_state=state,
        native_runtime=bridge,
    )
    return factory, state, owner


def test_owned_zero_http_admission_runs_real_start_end_without_resource_binding(zero_http_case: ZeroHttpCase) -> None:
    """Rejecting an empty HTTP manifest must not prevent a pure native run."""
    from graphon.engine import Engine
    from graphon.engine.command import InMemoryChannel
    from graphon.engine_events.graph import GraphRunSucceededEvent
    from graphon.engine_events.node import NodeRunSucceededEvent
    from graphon.graph.graph import Graph

    case = zero_http_case
    compiled = case.compile()
    assert compiled.context.resource_manifest == ()
    # SHA256 of the literal canonical empty JSON array; no fabricated descriptor.
    assert compiled.request_context["resource_manifest_digest"] == (
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
    )
    assert (
        compiled.context.tenant_id,
        compiled.context.actor_id,
        compiled.context.app_id,
        compiled.context.workflow_id,
        compiled.session_id,
        compiled.test_input_id,
    ) == (
        "tenant",
        "actor",
        "app",
        "workflow",
        "session",
        "input",
    )
    factory, state, owner = delivery_factory(case, compiled.context)
    engine = Engine(
        graph=Graph.init(graph_config=case.graph, node_factory=factory, root_node_id="start"),
        runtime_state=state,
        command_channel=InMemoryChannel(),
        workers=1,
    )
    events = list(engine.run())
    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert {event.node_id for event in events if isinstance(event, NodeRunSucceededEvent)} == {"start", "end"}
    assert state.outputs == {}
    assert owner.records == ()
    assert owner.dispatch_admissible
    assert case.permissions == [("tenant", "actor", "app"), ("tenant", "actor", "app")]
    assert len(case.owner_reads) == 1
    assert case.workflow_reads == 2
    assert case.active == 0


@pytest.mark.parametrize("failure_at", [1, 2])
def test_zero_http_admission_preserves_each_permission_gate(zero_http_case: ZeroHttpCase, failure_at: int) -> None:
    case = zero_http_case
    case.permission_failure = failure_at
    with pytest.raises(BuilderExecutionPolicyError, match="execution_permission_denied$"):
        case.compile()
    assert len(case.permissions) == failure_at
    assert case.workflow_reads == 0
    assert case.active == 0


def test_zero_http_snapshot_preserves_workflow_ownership_refusal(zero_http_case: ZeroHttpCase) -> None:
    case = zero_http_case
    case.workflow_failure = "native_owner_mismatch"
    with pytest.raises(BuilderExecutionPolicyError, match="native_owner_mismatch$"):
        case.compile()
    assert case.workflow_reads == 1
    assert case.active == 0


def test_zero_http_snapshot_preserves_revision_refusal(zero_http_case: ZeroHttpCase) -> None:
    case = zero_http_case
    assert case.snapshot is not None
    with pytest.raises(BuilderExecutionPolicyError, match="native_revision_drift$"):
        case.snapshot(
            actor=case.actor,
            app_id="app",
            workflow_id="workflow",
            graph={"nodes": [], "edges": []},
            profile=http_binding.build_native_http_profile(),
        )
    assert case.workflow_reads == 1
    assert case.active == 0


def test_zero_http_snapshot_preserves_profile_refusal_before_owner_reads(zero_http_case: ZeroHttpCase) -> None:
    case = zero_http_case
    assert case.snapshot is not None
    with pytest.raises(BuilderExecutionPolicyError, match="native_http_profile_drift$"):
        case.snapshot(
            actor=case.actor,
            app_id="app",
            workflow_id="workflow",
            graph=cast(dict[str, object], case.graph),
            profile=http_binding.build_native_http_profile().model_copy(update={"implementation_revision": "foreign"}),
        )
    assert case.permissions == []
    assert case.workflow_reads == 0


def literal_http() -> FixtureNode:
    return {
        "id": "http",
        "data": {
            "type": "http-request",
            "title": "HTTP",
            "method": "get",
            "url": "https://example.invalid",
            "authorization": {"type": "no-auth"},
            "headers": "",
            "params": "",
        },
    }


def test_declared_http_still_requires_a_real_qualified_resource(zero_http_case: ZeroHttpCase) -> None:
    case = zero_http_case
    case.graph["nodes"].insert(1, literal_http())
    compiled = case.compile()
    assert len(compiled.context.resource_manifest) == 1
    entry = compiled.context.resource_manifest[0]
    assert (entry["kind"], entry["node_id"], entry["app_id"], entry["workflow_id"]) == (
        "http",
        "http",
        "app",
        "workflow",
    )
    assert entry["workflow_revision"] == compiled.context.graph_revision
    policy = entry["policy"]
    assert isinstance(policy, dict)
    assert policy["approval_scope"] == "operation"


def test_unqualified_http_cannot_be_disguised_as_zero_resources(zero_http_case: ZeroHttpCase) -> None:
    case = zero_http_case
    node = literal_http()
    node["data"]["headers"] = "X-Secret:unsupported"
    case.graph["nodes"].insert(1, node)
    with pytest.raises(BuilderExecutionPolicyError, match="native_http_resource_unsupported$"):
        case.compile()


def test_duplicate_http_resource_ids_still_refuse(zero_http_case: ZeroHttpCase) -> None:
    case = zero_http_case
    case.graph["nodes"].extend([literal_http(), deepcopy(literal_http())])
    with pytest.raises(BuilderExecutionPolicyError, match="native_http_manifest_unavailable$"):
        case.compile()


def test_empty_manifest_does_not_enable_unsupported_native_collaborators(zero_http_case: ZeroHttpCase) -> None:
    case = zero_http_case
    node: FixtureNode = {
        "id": "code",
        "data": {
            "type": "code",
            "title": "Code",
            "code_language": "python3",
            "code": "pass",
            "variables": list[object](),
            "outputs": dict[str, object](),
        },
    }
    case.graph["nodes"].insert(1, node)
    compiled = case.compile()
    assert compiled.context.resource_manifest == ()
    factory, _, _ = delivery_factory(case, compiled.context)
    with pytest.raises(BuilderExecutionPolicyError, match="native_capability_unavailable$"):
        factory.create_node(cast(dict[str, object], node))
