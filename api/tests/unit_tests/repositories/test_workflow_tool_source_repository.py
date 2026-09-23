import json
from functools import partial

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.tools.workflow_as_tool.repository import WorkflowToolSource
from core.workflow.workflow_tool_container_types import WorkflowToolContainerPayload
from models.model import App, AppMode
from models.tools import WorkflowToolProvider
from models.workflow import Workflow, WorkflowKind, WorkflowType
from repositories.workflow_tool_source_repository import SQLAlchemyWorkflowToolSourceRepository


def test_materialized_tool_sources_keep_the_published_version_and_tenant(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from services.workflow_tool_source_service import WorkflowToolSourceService

    _save_source(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        provider = WorkflowToolProvider(
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            version=_PUBLISHED_VERSION,
            name="source",
            label="Source",
            icon="{}",
            user_id=_ACCOUNT_ID,
            description="Source",
        )
        session.add(provider)
        session.flush()
        provider_id = provider.id
    graph = {"nodes": [{"data": {"type": "tool", "provider_type": "workflow", "provider_id": provider_id}}]}
    service = WorkflowToolSourceService(SQLAlchemyWorkflowToolSourceRepository(sqlite_session_factory))

    sources = service.load(tenant_id=_TENANT_ID, graph_config=graph)
    assert set(sources) == {_PUBLISHED_WORKFLOW_ID}
    assert sources[_PUBLISHED_WORKFLOW_ID].graph_config == _GRAPH
    assert service.load(tenant_id=_OTHER_TENANT_ID, graph_config=graph) == {}

    with sqlite_session_factory.begin() as session:
        provider = session.get(WorkflowToolProvider, provider_id)
        assert provider is not None
        provider.version = "latest-published-version"
    assert sources[_PUBLISHED_WORKFLOW_ID].graph_config == _GRAPH
    assert set(service.load(tenant_id=_TENANT_ID, graph_config=graph)) == {_LATEST_WORKFLOW_ID}

    suspended = WorkflowToolContainerPayload(
        source_app_id=_APP_ID,
        source_workflow_id=_PUBLISHED_WORKFLOW_ID,
        source_workflow_version=_PUBLISHED_VERSION,
        call_depth=1,
    )
    resumed = service.load(tenant_id=_TENANT_ID, graph_config=graph, suspended_tools=[suspended])
    assert set(resumed) == {_PUBLISHED_WORKFLOW_ID, _LATEST_WORKFLOW_ID}
    assert resumed[_PUBLISHED_WORKFLOW_ID].graph_config == _GRAPH
    with pytest.raises(ValueError, match="source was not found"):
        service.load(tenant_id=_OTHER_TENANT_ID, graph_config=graph, suspended_tools=[suspended])


_TENANT_ID = "11111111-1111-1111-1111-111111111111"
_OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
_APP_ID = "33333333-3333-3333-3333-333333333333"
_PUBLISHED_WORKFLOW_ID = "44444444-4444-4444-4444-444444444444"
_LATEST_WORKFLOW_ID = "77777777-7777-7777-7777-777777777777"
_DRAFT_WORKFLOW_ID = "55555555-5555-5555-5555-555555555555"
_ACCOUNT_ID = "66666666-6666-6666-6666-666666666666"
_PUBLISHED_VERSION = "published-version"

_GRAPH: dict[str, object] = {
    "nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": list[object]()}}],
    "edges": list[object](),
}
_FEATURES: dict[str, object] = {"file_upload": {"enabled": False}}
_LATEST_GRAPH: dict[str, object] = {
    "nodes": [{"id": "latest-start", "data": {"type": "start", "title": "Start", "variables": list[object]()}}],
    "edges": list[object](),
}


def _save_source(session_factory: sessionmaker[Session]) -> None:
    app = App(
        id=_APP_ID,
        tenant_id=_TENANT_ID,
        name="Workflow Tool source",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type=None,
        icon=None,
        icon_background=None,
        enable_site=False,
        enable_api=False,
        is_public=False,
        max_active_requests=None,
        created_by=_ACCOUNT_ID,
    )
    workflows = [
        Workflow(
            id=workflow_id,
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            type=WorkflowType.WORKFLOW,
            kind=WorkflowKind.STANDARD,
            version=version,
            graph=json.dumps(graph),
            features=json.dumps(_FEATURES),
            created_by=_ACCOUNT_ID,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        for workflow_id, version, graph in (
            (_PUBLISHED_WORKFLOW_ID, _PUBLISHED_VERSION, _GRAPH),
            (_LATEST_WORKFLOW_ID, "latest-published-version", _LATEST_GRAPH),
            (_DRAFT_WORKFLOW_ID, Workflow.VERSION_DRAFT, _GRAPH),
        )
    ]
    app.workflow_id = _LATEST_WORKFLOW_ID
    with session_factory.begin() as session:
        session.add_all((app, *workflows))


def test_get_source_returns_requested_workflow_after_a_new_version_is_published(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _save_source(sqlite_session_factory)
    repository = SQLAlchemyWorkflowToolSourceRepository(sqlite_session_factory)

    source = repository.get_source(
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        workflow_id=_PUBLISHED_WORKFLOW_ID,
        version=_PUBLISHED_VERSION,
    )

    assert source == WorkflowToolSource(
        app_id=_APP_ID,
        workflow_id=_PUBLISHED_WORKFLOW_ID,
        graph_config=_GRAPH,
        features_dict=_FEATURES,
        environment_variables=(),
        workflow_kind=WorkflowKind.STANDARD,
    )


@pytest.mark.parametrize(
    ("tenant_id", "workflow_id", "version"),
    [
        pytest.param(_OTHER_TENANT_ID, _PUBLISHED_WORKFLOW_ID, _PUBLISHED_VERSION, id="wrong-tenant"),
        pytest.param(_TENANT_ID, _PUBLISHED_WORKFLOW_ID, "wrong-version", id="wrong-version"),
        pytest.param(_TENANT_ID, _DRAFT_WORKFLOW_ID, Workflow.VERSION_DRAFT, id="draft"),
    ],
)
def test_get_source_rejects_unavailable_source(
    sqlite_session_factory: sessionmaker[Session],
    tenant_id: str,
    workflow_id: str,
    version: str,
) -> None:
    _save_source(sqlite_session_factory)
    repository = SQLAlchemyWorkflowToolSourceRepository(sqlite_session_factory)

    assert (
        repository.get_source(
            tenant_id=tenant_id,
            app_id=_APP_ID,
            workflow_id=workflow_id,
            version=version,
        )
        is None
    )


@pytest.mark.parametrize(
    ("stored_kind", "expected_kind"),
    [(None, WorkflowKind.STANDARD), ("standard", WorkflowKind.STANDARD), ("snippet", WorkflowKind.SNIPPET)],
)
def test_get_source_returns_workflow_kind_enum(
    sqlite_session_factory: sessionmaker[Session], stored_kind: str | None, expected_kind: WorkflowKind
) -> None:
    _save_source(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        workflow = session.get(Workflow, _PUBLISHED_WORKFLOW_ID)
        assert workflow is not None
        workflow.kind = None if stored_kind is None else WorkflowKind.value_of(stored_kind)

    source = SQLAlchemyWorkflowToolSourceRepository(sqlite_session_factory).get_source(
        tenant_id=_TENANT_ID,
        app_id=_APP_ID,
        workflow_id=_PUBLISHED_WORKFLOW_ID,
        version=_PUBLISHED_VERSION,
    )

    assert source is not None
    assert source.workflow_kind is expected_kind


@pytest.mark.parametrize("allow_human_input", [False, True])
def test_materialize_recursive_tools_checks_nested_human_input(
    sqlite_session_factory: sessionmaker[Session],
    allow_human_input: bool,
) -> None:
    from services.workflow_tool_source_service import WorkflowToolSourceService

    _save_source(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        child_app_id = "88888888-8888-8888-8888-888888888888"
        session.add(
            App(
                id=child_app_id,
                tenant_id=_TENANT_ID,
                name="Approval",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
            )
        )
        providers = [
            WorkflowToolProvider(
                tenant_id=_TENANT_ID,
                app_id=app_id,
                version=version,
                name=name,
                label=name,
                icon="{}",
                user_id=_ACCOUNT_ID,
                description=name,
            )
            for name, app_id, version in (
                ("parent", _APP_ID, _PUBLISHED_VERSION),
                ("approval", child_app_id, "latest-published-version"),
            )
        ]
        session.add_all(providers)
        session.flush()
        parent_id, child_id = (provider.id for provider in providers)

        def graph(provider_id: str) -> dict[str, list[dict[str, object]]]:
            return {"nodes": [{"data": {"type": "tool", "provider_type": "workflow", "provider_id": provider_id}}]}

        parent = session.get(Workflow, _PUBLISHED_WORKFLOW_ID)
        child = session.get(Workflow, _LATEST_WORKFLOW_ID)
        assert parent is not None
        assert child is not None
        child.app_id = child_app_id
        parent.graph = json.dumps(graph(child_id))
        child.graph = json.dumps({"nodes": [*graph(parent_id)["nodes"], {"data": {"type": "human-input"}}]})
    service = WorkflowToolSourceService(SQLAlchemyWorkflowToolSourceRepository(sqlite_session_factory))
    if allow_human_input:
        sources = service.load(tenant_id=_TENANT_ID, graph_config=graph(parent_id), allow_human_input=True)
        assert set(sources) == {_PUBLISHED_WORKFLOW_ID, _LATEST_WORKFLOW_ID}
    else:
        with pytest.raises(ValueError, match="require Engine-managed container execution"):
            service.load(tenant_id=_TENANT_ID, graph_config=graph(parent_id), allow_human_input=False)


@pytest.mark.parametrize("resuming", [False, True])
def test_running_tool_keeps_materialized_definition_after_republication(
    sqlite_session_factory: sessionmaker[Session],
    resuming: bool,
) -> None:
    from core.workflow.node_factory import DifyNodeFactory
    from core.workflow.workflow_tool_container_handler import WorkflowToolContainerHandler
    from graphon.engine import Engine
    from graphon.engine_events import NodeRunSucceededEvent
    from graphon.engine_events.graph import GraphRunSucceededEvent
    from graphon.graph import Graph
    from graphon.nodes.tool.entities import ToolNodeData
    from graphon.runtime import RuntimeState, VariablePool
    from services.workflow_tool_source_service import WorkflowToolSourceService
    from tests.workflow_test_utils import build_test_graph_init_params

    _save_source(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        provider = WorkflowToolProvider(
            tenant_id=_TENANT_ID,
            app_id=_APP_ID,
            version=_PUBLISHED_VERSION,
            name="source",
            label="Source",
            icon="{}",
            user_id=_ACCOUNT_ID,
            description="Source",
        )
        session.add(provider)
        session.flush()
        provider_id = provider.id
    data = ToolNodeData(
        title="Tool",
        provider_id=provider_id,
        provider_type="workflow",
        provider_name="source",
        tool_name="source",
        tool_label="Source",
        tool_configurations={},
        tool_parameters={},
    )
    graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": list[object]()}},
            {
                "id": "loop",
                "data": {
                    "type": "loop",
                    "title": "Loop",
                    "start_node_id": "loop-start",
                    "loop_count": 1,
                    "break_conditions": list[object](),
                    "logical_operator": "and",
                },
            },
            {"id": "loop-start", "data": {"type": "loop-start", "title": "Loop start", "loop_id": "loop"}},
            {"id": "tool", "data": {**data.model_dump(mode="json"), "loop_id": "loop"}},
        ],
        "edges": [{"source": "start", "target": "loop"}, {"source": "loop-start", "target": "tool"}],
    }
    sources = WorkflowToolSourceService(SQLAlchemyWorkflowToolSourceRepository(sqlite_session_factory)).load(
        tenant_id=_TENANT_ID,
        graph_config=graph,
        suspended_tools=[
            WorkflowToolContainerPayload(
                source_app_id=_APP_ID,
                source_workflow_id=_PUBLISHED_WORKFLOW_ID,
                source_workflow_version=_PUBLISHED_VERSION,
                call_depth=1,
            )
        ]
        if resuming
        else (),
    )
    source = sources[_PUBLISHED_WORKFLOW_ID]
    assert source.tool is not None
    state = RuntimeState(workflow_id="caller", variable_pool=VariablePool(), start_at=1)
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(
            workflow_id="caller", graph_config=graph, tenant_id=_TENANT_ID, app_id=_APP_ID
        ),
        runtime_state=state,
        workflow_tools={provider_id: source.tool},
    )
    completed_nodes = []
    engine = Engine(
        graph=Graph.init(graph_config=graph, node_factory=factory, root_node_id="start"),
        runtime_state=state,
        workers=1,
        container_handler_factories=(
            partial(
                WorkflowToolContainerHandler, sources=sources, event_listener_factory=lambda *_: completed_nodes.append
            ),
        ),
    )
    with sqlite_session_factory.begin() as session:
        provider = session.get(WorkflowToolProvider, provider_id)
        assert provider is not None
        provider.version = "latest-published-version"
        provider.label = "Republished"
    events = list(engine.run())
    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert [event.node_id for event in completed_nodes if isinstance(event, NodeRunSucceededEvent)] == ["start"]
