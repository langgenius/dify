"""Root admission captures real External ports before context-free child frames."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from flask import Flask, has_app_context
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY, DifyRunContext
from core.workflow.node_factory import DifyNodeFactory
from extensions.ext_application_services import ApplicationServices
from graphon.node_events import StreamCompletedEvent
from graphon.runtime import InitParams, RuntimeState, VariablePool
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.external_agent import ExternalAgentInvocation
from models.model import App, AppMode
from providers.a2a.workflow_node import ExternalAgentNode, task_parts
from services.external_agents.io_contracts import JsonObject
from services.external_agents.runtime_contracts import RuntimeError as ExternalRuntimeError
from tests.workflow_test_utils import build_test_graph_init_params


def _external_config() -> JsonObject:
    """Return an unbound External node whose execution must fail before dispatch."""
    return {
        "id": "external",
        "data": {
            "type": "agent",
            "version": "2",
            "title": "External",
            "agent_node_kind": "external_a2a",
            "agent_task": "Task {{#source.value#}}",
        },
    }


def _state(frame: str) -> RuntimeState:
    """Build a separate frame pool; sibling node construction must retain it."""
    pool = VariablePool()
    pool.add(("source", "value"), frame)
    return RuntimeState(workflow_id="workflow", variable_pool=pool, start_at=0)


def test_external_ports_survive_parallel_and_nested_factory_rebinding_without_flask_context(
    sqlite_session_factory: sessionmaker[Session], account_application_services: ApplicationServices
) -> None:
    """Real thread/frame construction reaches SQL ownership checks without Flask.

    Missing persisted bindings must remain a safe business error; capturing
    dependencies does not manufacture an admitted binding or send a request.
    """
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="threaded external workspace")
        account = Account(name="Owner", email="threaded-external@example.test")
        session.add_all((tenant, account))
        session.flush()
        app = App(
            tenant_id=tenant.id, name="Threaded external", mode=AppMode.WORKFLOW, enable_site=False, enable_api=True
        )
        session.add_all(
            (app, TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER))
        )
        session.flush()
        tenant_id, account_id, app_id = tenant.id, account.id, app.id

    config = _external_config()
    graph: JsonObject = {"nodes": [config], "edges": []}
    params = build_test_graph_init_params(graph_config=graph, tenant_id=tenant_id, app_id=app_id, user_id=account_id)
    application = Flask(__name__)
    application.extensions["application_services"] = account_application_services
    with application.app_context():
        root = DifyNodeFactory(init_params=params, runtime_state=_state("root"))

    barrier = Barrier(2)

    def construct(frame: str) -> ExternalAgentNode:
        assert not has_app_context()
        # Iteration creates a runtime-bound factory, then Graph.init scopes its
        # graph. Repeat that for a nested frame before constructing the node.
        factory = root.with_runtime_state(_state(frame)).with_graph_config(graph)
        state = _state(frame + "/nested")
        nested = factory.with_runtime_state(state).with_graph_config(graph)
        barrier.wait(timeout=10)
        node = nested.create_node(config)
        assert isinstance(node, ExternalAgentNode)
        assert node.runtime_state is state
        assert task_parts(node.node_data.agent_task, node.runtime_state.variable_pool) == (
            {"text": "Task "},
            {"text": frame + "/nested"},
        )
        events = tuple(node._run())
        assert len(events) == 1
        event = events[0]
        assert isinstance(event, StreamCompletedEvent)
        assert event.node_run_result.error_type == "binding_unavailable"
        assert not has_app_context()
        return node

    with ThreadPoolExecutor(max_workers=2) as workers:
        nodes = tuple(workers.map(construct, ("iteration-0", "iteration-1")))
    assert nodes[0].runtime_state is not nodes[1].runtime_state
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(ExternalAgentInvocation)) == 0


@pytest.mark.parametrize("unrelated_extra", [{}, {"agent_node_kind": "external_a2a"}])
def test_native_graph_and_frame_creation_do_not_require_external_composition_root(unrelated_extra: JsonObject) -> None:
    """A Native-only graph constructs in a real thread without any Flask app."""
    start: JsonObject = {"id": "start", "data": {"type": "start", "title": "Start", "variables": [], **unrelated_extra}}
    graph: JsonObject = {"nodes": [start], "edges": []}

    def construct() -> None:
        assert not has_app_context()
        root = DifyNodeFactory(
            init_params=build_test_graph_init_params(graph_config=graph), runtime_state=_state("root")
        )
        state = _state("child")
        child = root.with_runtime_state(state).with_graph_config(graph)
        node = child.create_node(start)
        assert node.runtime_state is state
        assert node.id == "start"

    with ThreadPoolExecutor(max_workers=1) as worker:
        worker.submit(construct).result(timeout=10)


def test_cross_app_tool_profile_is_rejected_before_root_service_capture_in_a_thread() -> None:
    """Delegated source identity cannot replace the admitted root App identity."""
    config = _external_config()
    params = build_test_graph_init_params(graph_config={"nodes": [config], "edges": []}, app_id="source-app")
    source = DifyRunContext.model_validate(params.run_context[DIFY_RUN_CONTEXT_KEY]).model_copy(
        update={"workflow_tool_invocation_id": "server-owned-tool-frame"}
    )
    params = InitParams.model_validate({**params.model_dump(), "run_context": {DIFY_RUN_CONTEXT_KEY: source}})
    root_context = source.model_copy(update={"app_id": "root-app", "workflow_tool_invocation_id": None})

    def construct() -> None:
        assert not has_app_context()
        with pytest.raises(ExternalRuntimeError) as failure:
            DifyNodeFactory(init_params=params, runtime_state=_state("source"), human_input_run_context=root_context)
        assert failure.value.code == "unsupported_profile"

    with ThreadPoolExecutor(max_workers=1) as worker:
        worker.submit(construct).result(timeout=10)


def test_external_node_cannot_implicitly_resolve_services_after_native_root_admission() -> None:
    """A later graph replacement needs captured ports and cannot use a thread local."""
    config = _external_config()

    def construct() -> None:
        assert not has_app_context()
        factory = DifyNodeFactory(init_params=build_test_graph_init_params(), runtime_state=_state("root"))
        replacement = factory.with_graph_config({"nodes": [config], "edges": []})
        with pytest.raises(ValueError, match="not captured by the admitted root graph"):
            replacement.create_node(config)

    with ThreadPoolExecutor(max_workers=1) as worker:
        worker.submit(construct).result(timeout=10)
