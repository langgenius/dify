from collections.abc import Generator
from types import SimpleNamespace
from unittest.mock import ANY, Mock

import pytest

from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    RagPipelineGenerateEntity,
    WorkflowAppGenerateEntity,
)
from models.enums import WorkflowRunTriggeredFrom
from models.model import App, AppMode, Conversation
from models.snippet import CustomizedSnippet
from models.workflow import WorkflowKind
from models.workflow_handoff import WorkflowHandoffResumeRoute
from services import workflow_handoff_resume_routes as routes
from services.workflow_handoff_resume_coordinator import PermanentWorkflowHandoffResumeError


@pytest.fixture(autouse=True)
def _durable_event_transport(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(routes.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "streams")


class _Session:
    def __init__(self, values: dict[type, object] | None = None, *, scalar: object | None = None):
        self._values = values or {}
        self._scalar = scalar

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return None

    def get(self, model, object_id):
        return self._values.get(model)

    def scalar(self, statement):
        return self._scalar


def _entity(entity_type: type, *, route: WorkflowHandoffResumeRoute):
    entity = Mock(spec=entity_type)
    entity.task_id = "task-1"
    entity.user_id = "user-1"
    entity.inputs = {"input": "value"}
    entity.extras = {}
    entity.app_config = SimpleNamespace(tenant_id="tenant-1", app_id="app-1", workflow_id="workflow-1")
    if entity_type is AdvancedChatAppGenerateEntity:
        entity.workflow_run_id = "run-1"
        entity.conversation_id = "conversation-1"
    else:
        entity.workflow_execution_id = "run-1"
    if entity_type is RagPipelineGenerateEntity:
        entity.dataset_id = "dataset-1"
        entity.document_id = "document-1"
    return entity


def _request(route: WorkflowHandoffResumeRoute):
    return SimpleNamespace(
        serialized_state=b"checkpoint",
        handoff=SimpleNamespace(
            id="handoff-1",
            generation=1,
            task_id="task-1",
            workflow_run_id="run-1",
            resume_route=route,
        ),
        lease=SimpleNamespace(repository=Mock()),
    )


def _generator(on_next=None) -> Generator[object, None, None]:
    if on_next is not None:
        on_next()
    yield object()


def test_dispatcher_covers_every_product_route(monkeypatch: pytest.MonkeyPatch) -> None:
    callbacks = {
        WorkflowHandoffResumeRoute.WORKFLOW: Mock(),
        WorkflowHandoffResumeRoute.SNIPPET: Mock(),
        WorkflowHandoffResumeRoute.ADVANCED_CHAT: Mock(),
        WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW: Mock(),
        WorkflowHandoffResumeRoute.RAG_PIPELINE: Mock(),
    }
    monkeypatch.setattr(routes, "_resume_workflow_handoff", callbacks[WorkflowHandoffResumeRoute.WORKFLOW])
    monkeypatch.setattr(routes, "_resume_snippet_handoff", callbacks[WorkflowHandoffResumeRoute.SNIPPET])
    monkeypatch.setattr(routes, "_resume_advanced_chat_handoff", callbacks[WorkflowHandoffResumeRoute.ADVANCED_CHAT])
    monkeypatch.setattr(
        routes,
        "_resume_triggered_workflow_handoff",
        callbacks[WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW],
    )
    monkeypatch.setattr(routes, "_resume_rag_pipeline_handoff", callbacks[WorkflowHandoffResumeRoute.RAG_PIPELINE])
    dispatcher = routes.create_workflow_handoff_resume_dispatcher()

    assert set(callbacks) == set(WorkflowHandoffResumeRoute)
    for route, callback in callbacks.items():
        request = _request(route)
        dispatcher.dispatch(request)
        callback.assert_called_once_with(request)


def test_load_context_rejects_task_and_run_identity_mismatches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(routes.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "streams")
    context = Mock()
    entity = _entity(WorkflowAppGenerateEntity, route=WorkflowHandoffResumeRoute.WORKFLOW)
    context.get_generate_entity.return_value = entity
    context.serialized_graph_runtime_state = "graph-state"
    monkeypatch.setattr(routes.WorkflowResumptionContext, "loads", lambda _: context)
    monkeypatch.setattr(routes.GraphRuntimeState, "from_snapshot", lambda _: Mock())
    request = _request(WorkflowHandoffResumeRoute.WORKFLOW)

    entity.task_id = "different-task"
    with pytest.raises(PermanentWorkflowHandoffResumeError, match="task identity"):
        routes._load_context(request)

    entity.task_id = "task-1"
    entity.workflow_execution_id = "different-run"
    with pytest.raises(PermanentWorkflowHandoffResumeError, match="run identity"):
        routes._load_context(request)


def test_load_context_fails_closed_when_durable_event_transport_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(routes.dify_config, "PUBSUB_REDIS_CHANNEL_TYPE", "pubsub")

    with pytest.raises(PermanentWorkflowHandoffResumeError, match="requires EVENT_BUS_REDIS_CHANNEL_TYPE=streams"):
        routes._load_context(_request(WorkflowHandoffResumeRoute.WORKFLOW))


def test_load_context_carries_cumulative_active_time_to_resumed_entity(monkeypatch: pytest.MonkeyPatch) -> None:
    context = Mock()
    context.active_execution_seconds = 37.5
    entity = _entity(WorkflowAppGenerateEntity, route=WorkflowHandoffResumeRoute.WORKFLOW)
    context.get_generate_entity.return_value = entity
    context.serialized_graph_runtime_state = "graph-state"

    def apply_timing() -> None:
        entity.extras["workflow_handoff_active_execution_seconds"] = context.active_execution_seconds

    context.apply_handoff_execution_timing.side_effect = apply_timing
    monkeypatch.setattr(routes.WorkflowResumptionContext, "loads", lambda _: context)
    monkeypatch.setattr(routes.GraphRuntimeState, "from_snapshot", lambda _: Mock())

    routes._load_context(_request(WorkflowHandoffResumeRoute.WORKFLOW))

    context.apply_handoff_execution_timing.assert_called_once_with()
    assert entity.extras["workflow_handoff_active_execution_seconds"] == 37.5


def test_resumed_terminal_failure_handler_passes_full_owner_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    service = Mock()
    service_factory = Mock(return_value=service)
    failed_at = routes.datetime(2026, 7, 28, 12, 0, 0)
    monkeypatch.setattr(routes, "WorkflowHandoffTerminalService", service_factory)
    monkeypatch.setattr(routes, "naive_utc_now", lambda: failed_at)
    request = _request(WorkflowHandoffResumeRoute.ADVANCED_CHAT)
    workflow_run = SimpleNamespace(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
    )
    failure = routes.WorkflowStreamTerminalFailure(
        error="queue exploded",
        message_answer_delta=" delta",
        message_answer_replacement="partial",
    )

    routes._resumed_terminal_failure_handler(request, workflow_run)(failure)

    service_factory.assert_called_once_with(repository=request.lease.repository, storage=routes.storage)
    service.reconcile_resumed_failure.assert_called_once_with(
        handoff_id="handoff-1",
        generation=1,
        scope=routes.WorkflowHandoffTerminalScope(
            workflow_run_id="run-1",
            task_id="task-1",
            tenant_id="tenant-1",
            app_id="app-1",
            workflow_id="workflow-1",
            resume_route=WorkflowHandoffResumeRoute.ADVANCED_CHAT,
        ),
        error="queue exploded",
        failed_at=failed_at,
        message_answer_delta=" delta",
        message_answer_replacement="partial",
    )


def test_validate_entity_identity_reports_all_ownership_mismatches() -> None:
    entity = _entity(WorkflowAppGenerateEntity, route=WorkflowHandoffResumeRoute.WORKFLOW)
    run = SimpleNamespace(
        tenant_id="other-tenant",
        app_id="other-app",
        workflow_id="other-workflow",
        created_by="other",
    )
    workflow = SimpleNamespace(id="definition-id")

    with pytest.raises(PermanentWorkflowHandoffResumeError) as raised:
        routes._validate_entity_identity(generate_entity=entity, workflow_run=run, workflow=workflow)

    message = str(raised.value)
    assert all(name in message for name in ("tenant", "app", "workflow", "user", "workflow_definition"))


def test_load_run_dependencies_rejects_cross_owner_workflow_definition() -> None:
    workflow_run = SimpleNamespace(
        id="run-1",
        status=routes.WorkflowExecutionStatus.RUNNING,
        workflow_id="workflow-1",
        tenant_id="tenant-1",
        app_id="app-1",
    )
    workflow = SimpleNamespace(id="workflow-1", tenant_id="other-tenant", app_id="app-1")
    session = _Session({routes.WorkflowRun: workflow_run, routes.Workflow: workflow})

    with pytest.raises(PermanentWorkflowHandoffResumeError, match="Workflow definition ownership mismatch: tenant"):
        routes._load_run_dependencies(session, _request(WorkflowHandoffResumeRoute.WORKFLOW))


@pytest.mark.parametrize(
    ("app_id", "tenant_id", "mismatch"),
    [
        ("other-app", "tenant-1", "app"),
        ("app-1", "other-tenant", "tenant"),
    ],
)
def test_validate_app_ownership_rejects_mismatch(app_id: str, tenant_id: str, mismatch: str) -> None:
    app = SimpleNamespace(id=app_id, tenant_id=tenant_id)
    workflow_run = SimpleNamespace(app_id="app-1", tenant_id="tenant-1")

    with pytest.raises(PermanentWorkflowHandoffResumeError, match=rf"Workflow app ownership mismatch: {mismatch}"):
        routes._validate_app_ownership(app, workflow_run)


@pytest.mark.parametrize(
    ("conversation_updates", "message_updates", "resource", "mismatch"),
    [
        ({"app_id": "other-app"}, {}, "conversation", "app"),
        ({"tenant_id": "other-tenant"}, {}, "conversation", "tenant"),
        ({}, {"app_id": "other-app"}, "message", "app"),
        ({}, {"conversation_id": "other-conversation"}, "message", "conversation"),
        ({}, {"workflow_run_id": "other-run"}, "message", "workflow_run"),
    ],
)
def test_validate_chat_records_rejects_cross_owner_records(
    conversation_updates: dict[str, str],
    message_updates: dict[str, str],
    resource: str,
    mismatch: str,
) -> None:
    conversation_values = {"id": "conversation-1", "app_id": "app-1", **conversation_updates}
    message_values = {
        "app_id": "app-1",
        "conversation_id": "conversation-1",
        "workflow_run_id": "run-1",
        **message_updates,
    }

    with pytest.raises(
        PermanentWorkflowHandoffResumeError,
        match=rf"Chatflow {resource} ownership mismatch: {mismatch}",
    ):
        routes._validate_chat_records(
            conversation=SimpleNamespace(**conversation_values),
            message=SimpleNamespace(**message_values),
            workflow_run=SimpleNamespace(id="run-1", app_id="app-1", tenant_id="tenant-1"),
        )


@pytest.mark.parametrize(
    ("field", "value", "mismatch"),
    [
        ("tenant_id", "other-tenant", "tenant"),
        ("app_id", "other-app", "app"),
        ("workflow_id", "other-workflow", "workflow"),
        ("workflow_run_id", "other-run", "workflow_run"),
    ],
)
def test_trigger_layers_reject_cross_owner_trigger_log(field: str, value: str, mismatch: str) -> None:
    trigger_log_values = {
        "id": "trigger-1",
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "workflow_run_id": "run-1",
        "queue_name": "workflow",
    }
    trigger_log_values[field] = value
    session = _Session(scalar=SimpleNamespace(**trigger_log_values))
    workflow_run = SimpleNamespace(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
    )

    with pytest.raises(
        PermanentWorkflowHandoffResumeError,
        match=rf"Workflow trigger log ownership mismatch: {mismatch}",
    ):
        routes._trigger_layers(session, workflow_run)


def test_trigger_layers_preserve_initial_post_only_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    trigger_log = SimpleNamespace(
        id="trigger-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        queue_name=next(iter(routes.AsyncWorkflowQueue)).value,
    )
    workflow_run = SimpleNamespace(
        id="run-1",
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
    )
    post_layer = Mock()
    post_layer_factory = Mock(return_value=post_layer)
    monkeypatch.setattr(routes, "TriggerPostLayer", post_layer_factory)

    layers = routes._trigger_layers(_Session(scalar=trigger_log), workflow_run)

    assert layers == [post_layer]
    post_layer_factory.assert_called_once()


@pytest.mark.parametrize(
    ("route", "triggered_from", "trigger_layers"),
    [
        (WorkflowHandoffResumeRoute.WORKFLOW, WorkflowRunTriggeredFrom.DEBUGGING, []),
        (WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW, WorkflowRunTriggeredFrom.WEBHOOK, [Mock()]),
    ],
)
def test_workflow_resume_rebuilds_route_and_publishes_stream(
    monkeypatch: pytest.MonkeyPatch,
    route: WorkflowHandoffResumeRoute,
    triggered_from: WorkflowRunTriggeredFrom,
    trigger_layers: list[object],
) -> None:
    entity = _entity(WorkflowAppGenerateEntity, route=route)
    context = Mock()
    context.root_node_id = "custom-trigger-root"
    runtime_state = Mock()
    frozen_graph = {"nodes": [{"id": "custom-trigger-root", "data": {"type": "start"}}], "edges": []}
    workflow_run = SimpleNamespace(
        id="run-1",
        app_id="app-1",
        tenant_id="tenant-1",
        workflow_id="workflow-1",
        triggered_from=triggered_from,
        graph_dict=frozen_graph,
        version="published-v1",
    )
    workflow = SimpleNamespace(
        id="workflow-1",
        created_by="owner-1",
        graph_dict={"nodes": [{"id": "edited-draft-root"}], "edges": []},
        version="draft",
    )
    user = Mock()
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    session = _Session({App: app})
    generator = Mock()
    response = _generator()
    generator.resume.return_value = response
    publisher = Mock()
    ack_layer = Mock()

    monkeypatch.setattr(routes, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(routes, "sessionmaker", lambda **kwargs: lambda: session)
    monkeypatch.setattr(routes, "_load_context", lambda request: (context, entity, runtime_state))
    monkeypatch.setattr(routes, "_load_run_dependencies", lambda session, request: (workflow_run, workflow, user))
    monkeypatch.setattr(routes, "_validate_entity_identity", Mock())
    monkeypatch.setattr(routes, "_trigger_layers", lambda session, workflow_run: trigger_layers)
    monkeypatch.setattr(routes, "_build_repositories", lambda **kwargs: ("run-repository", "node-repository"))
    monkeypatch.setattr(routes, "_acknowledgement_layer", lambda request: ack_layer)
    monkeypatch.setattr(routes, "set_login_user", Mock())
    monkeypatch.setattr(routes, "WorkflowAppGenerator", lambda: generator)
    monkeypatch.setattr(routes, "_publish_streaming_response", publisher)

    routes._resume_workflow_route(
        _request(route),
        require_trigger_log=route == WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW,
    )

    layers = generator.resume.call_args.kwargs["graph_engine_layers"]
    assert layers == [ack_layer, *trigger_layers]
    assert generator.resume.call_args.kwargs["graph_config"] is frozen_graph
    assert generator.resume.call_args.kwargs["workflow_version"] == "published-v1"
    assert generator.resume.call_args.kwargs["root_node_id"] == "custom-trigger-root"
    publisher.assert_called_once_with(
        response,
        "run-1",
        AppMode.WORKFLOW,
        "workflow-1",
        entity.inputs,
        started_reason=routes._resumption_reason(),
        terminal_failure_handler=ANY,
    )


def test_workflow_resume_rejects_trigger_route_source_mismatch(monkeypatch: pytest.MonkeyPatch) -> None:
    entity = _entity(WorkflowAppGenerateEntity, route=WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW)
    workflow_run = SimpleNamespace(
        id="run-1",
        app_id="app-1",
        tenant_id="tenant-1",
        workflow_id="workflow-1",
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
    )
    workflow = SimpleNamespace(id="workflow-1", created_by="owner-1")
    session = _Session()
    monkeypatch.setattr(routes, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(routes, "sessionmaker", lambda **kwargs: lambda: session)
    monkeypatch.setattr(routes, "_load_context", lambda request: (Mock(), entity, Mock()))
    monkeypatch.setattr(routes, "_load_run_dependencies", lambda session, request: (workflow_run, workflow, Mock()))
    monkeypatch.setattr(routes, "_validate_entity_identity", Mock())

    with pytest.raises(PermanentWorkflowHandoffResumeError, match="trigger route"):
        routes._resume_workflow_route(_request(WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW), require_trigger_log=True)


@pytest.mark.parametrize("single_run", [None, "iteration", "loop"])
def test_snippet_resume_rebuilds_adapter_filters_virtual_start_and_preserves_single_run_loader(
    monkeypatch: pytest.MonkeyPatch,
    single_run: str | None,
) -> None:
    entity = _entity(WorkflowAppGenerateEntity, route=WorkflowHandoffResumeRoute.SNIPPET)
    entity.single_iteration_run = SimpleNamespace(node_id="iteration-1") if single_run == "iteration" else None
    entity.single_loop_run = SimpleNamespace(node_id="loop-1") if single_run == "loop" else None
    context = Mock()
    context.root_node_id = "snippet-root"
    runtime_state = Mock()
    frozen_graph = {
        "nodes": [{"id": routes.SnippetGenerateService._VIRTUAL_START_NODE_ID, "data": {"type": "start"}}],
        "edges": [],
    }
    workflow_run = SimpleNamespace(
        id="run-1",
        app_id="app-1",
        tenant_id="tenant-1",
        workflow_id="workflow-1",
        graph_dict=frozen_graph,
        version="draft",
    )
    workflow = SimpleNamespace(
        id="workflow-1",
        created_by="owner-1",
        kind_or_standard=WorkflowKind.SNIPPET.value,
    )
    user = SimpleNamespace(id="user-1")
    snippet = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    session = _Session({CustomizedSnippet: snippet})
    app_model = SimpleNamespace(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
    generator = Mock()

    def response():
        yield {
            "event": "node_started",
            "data": {"node_id": routes.SnippetGenerateService._VIRTUAL_START_NODE_ID},
        }
        yield {"event": "node_finished", "data": {"node_id": "visible-node"}}

    generator.resume.return_value = response()
    publisher = Mock()
    ack_layer = Mock()
    draft_loader = Mock()
    draft_loader_factory = Mock(return_value=draft_loader)

    monkeypatch.setattr(routes, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(routes, "sessionmaker", lambda **kwargs: lambda: session)
    monkeypatch.setattr(routes, "_load_context", lambda request: (context, entity, runtime_state))
    monkeypatch.setattr(routes, "_load_run_dependencies", lambda session, request: (workflow_run, workflow, user))
    monkeypatch.setattr(routes, "_validate_entity_identity", Mock())
    monkeypatch.setattr(routes, "_build_repositories", lambda **kwargs: ("run-repository", "node-repository"))
    monkeypatch.setattr(routes, "_acknowledgement_layer", lambda request: ack_layer)
    monkeypatch.setattr(routes, "set_login_user", Mock())
    monkeypatch.setattr(routes.SnippetGenerateService, "build_app_model", Mock(return_value=app_model))
    monkeypatch.setattr(routes, "DraftVarLoader", draft_loader_factory)
    monkeypatch.setattr(routes, "WorkflowAppGenerator", lambda: generator)
    monkeypatch.setattr(routes, "_publish_streaming_response", publisher)

    routes._resume_snippet_handoff(_request(WorkflowHandoffResumeRoute.SNIPPET))

    kwargs = generator.resume.call_args.kwargs
    assert kwargs["app_model"] is app_model
    assert kwargs["graph_engine_layers"] == [ack_layer]
    assert kwargs["graph_config"] is frozen_graph
    assert kwargs["workflow_version"] == "draft"
    assert kwargs["root_node_id"] == "snippet-root"
    assert kwargs["handoff_resume_route"] == WorkflowHandoffResumeRoute.SNIPPET
    if single_run is None:
        assert kwargs["variable_loader"] is routes.DUMMY_VARIABLE_LOADER
        draft_loader_factory.assert_not_called()
    else:
        assert kwargs["variable_loader"] is draft_loader
        draft_loader_factory.assert_called_once_with(
            engine=routes.db.engine,
            app_id="app-1",
            tenant_id="tenant-1",
            user_id="user-1",
        )
    published_response = publisher.call_args.args[0]
    assert list(published_response) == [{"event": "node_finished", "data": {"node_id": "visible-node"}}]
    assert publisher.call_args.args[1:6] == (
        "run-1",
        AppMode.WORKFLOW,
        "workflow-1",
        entity.inputs,
    )


@pytest.mark.parametrize(
    ("snippet", "workflow_kind", "error"),
    [
        (None, WorkflowKind.SNIPPET.value, "Snippet no longer exists"),
        (SimpleNamespace(id="app-1", tenant_id="other-tenant"), WorkflowKind.SNIPPET.value, "ownership mismatch"),
        (SimpleNamespace(id="app-1", tenant_id="tenant-1"), WorkflowKind.STANDARD.value, "not owned by a Snippet"),
    ],
)
def test_snippet_resume_rejects_missing_or_cross_owner_resources(
    monkeypatch: pytest.MonkeyPatch,
    snippet: object | None,
    workflow_kind: str,
    error: str,
) -> None:
    entity = _entity(WorkflowAppGenerateEntity, route=WorkflowHandoffResumeRoute.SNIPPET)
    entity.single_iteration_run = None
    entity.single_loop_run = None
    workflow_run = SimpleNamespace(
        id="run-1",
        app_id="app-1",
        tenant_id="tenant-1",
        workflow_id="workflow-1",
    )
    workflow = SimpleNamespace(id="workflow-1", created_by="owner-1", kind_or_standard=workflow_kind)
    session = _Session({CustomizedSnippet: snippet} if snippet is not None else {})

    monkeypatch.setattr(routes, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(routes, "sessionmaker", lambda **kwargs: lambda: session)
    monkeypatch.setattr(routes, "_load_context", lambda request: (Mock(), entity, Mock()))
    monkeypatch.setattr(routes, "_load_run_dependencies", lambda session, request: (workflow_run, workflow, Mock()))
    monkeypatch.setattr(routes, "_validate_entity_identity", Mock())

    with pytest.raises(PermanentWorkflowHandoffResumeError, match=error):
        routes._resume_snippet_handoff(_request(WorkflowHandoffResumeRoute.SNIPPET))


def test_advanced_chat_resume_preserves_message_and_publishes_continuation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    entity = _entity(AdvancedChatAppGenerateEntity, route=WorkflowHandoffResumeRoute.ADVANCED_CHAT)
    context = Mock()
    context.root_node_id = "chat-root"
    runtime_state = Mock()
    frozen_graph = {"nodes": [{"id": "chat-root"}], "edges": []}
    workflow_run = SimpleNamespace(
        id="run-1",
        app_id="app-1",
        tenant_id="tenant-1",
        workflow_id="workflow-1",
        graph_dict=frozen_graph,
        version="published-v1",
    )
    workflow = SimpleNamespace(id="workflow-1", created_by="owner-1")
    user = Mock()
    app = SimpleNamespace(id="app-1", tenant_id="tenant-1")
    conversation = SimpleNamespace(id="conversation-1", app_id="app-1")
    message = SimpleNamespace(app_id="app-1", conversation_id="conversation-1", workflow_run_id="run-1")
    session = _Session({App: app, Conversation: conversation}, scalar=message)
    generator = Mock()
    response = _generator()
    generator.resume.return_value = response
    publisher = Mock()
    ack_layer = Mock()

    monkeypatch.setattr(routes, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(routes, "sessionmaker", lambda **kwargs: lambda: session)
    monkeypatch.setattr(routes, "_load_context", lambda request: (context, entity, runtime_state))
    monkeypatch.setattr(routes, "_load_run_dependencies", lambda session, request: (workflow_run, workflow, user))
    monkeypatch.setattr(routes, "_validate_entity_identity", Mock())
    monkeypatch.setattr(routes, "_build_repositories", lambda **kwargs: ("run-repository", "node-repository"))
    monkeypatch.setattr(routes, "_acknowledgement_layer", lambda request: ack_layer)
    monkeypatch.setattr(routes, "set_login_user", Mock())
    monkeypatch.setattr(routes, "AdvancedChatAppGenerator", lambda: generator)
    monkeypatch.setattr(routes, "_publish_streaming_response", publisher)

    routes._resume_advanced_chat_handoff(_request(WorkflowHandoffResumeRoute.ADVANCED_CHAT))

    assert generator.resume.call_args.kwargs["message"] is message
    assert generator.resume.call_args.kwargs["graph_engine_layers"] == [ack_layer]
    assert generator.resume.call_args.kwargs["graph_config"] is frozen_graph
    assert generator.resume.call_args.kwargs["workflow_version"] == "published-v1"
    assert generator.resume.call_args.kwargs["root_node_id"] == "chat-root"
    publisher.assert_called_once_with(
        response,
        "run-1",
        AppMode.ADVANCED_CHAT,
        "workflow-1",
        entity.inputs,
        started_reason=routes._resumption_reason(),
        terminal_failure_handler=ANY,
    )


def test_rag_resume_validates_ownership_and_drains_generator(monkeypatch: pytest.MonkeyPatch) -> None:
    entity = _entity(RagPipelineGenerateEntity, route=WorkflowHandoffResumeRoute.RAG_PIPELINE)
    context = Mock()
    context.root_node_id = "rag-root"
    runtime_state = Mock()
    frozen_graph = {"nodes": [{"id": "rag-root"}], "edges": []}
    workflow_run = SimpleNamespace(
        id="run-1",
        app_id="app-1",
        tenant_id="tenant-1",
        workflow_id="workflow-1",
        graph_dict=frozen_graph,
        version="published-v1",
    )
    workflow = SimpleNamespace(id="workflow-1", created_by="owner-1")
    user = Mock()
    dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
    pipeline = SimpleNamespace(tenant_id="tenant-1", retrieve_dataset=lambda session: dataset)
    document = SimpleNamespace(dataset_id="dataset-1", tenant_id="tenant-1")
    session = _Session({routes.Pipeline: pipeline, routes.Document: document})
    generator = Mock()
    drained: list[bool] = []
    generator.resume.return_value = _generator(lambda: drained.append(True))
    ack_layer = Mock()

    monkeypatch.setattr(routes, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(routes, "g", SimpleNamespace())
    monkeypatch.setattr(routes, "sessionmaker", lambda **kwargs: lambda: session)
    monkeypatch.setattr(routes, "_load_context", lambda request: (context, entity, runtime_state))
    monkeypatch.setattr(routes, "_load_run_dependencies", lambda session, request: (workflow_run, workflow, user))
    monkeypatch.setattr(routes, "_validate_entity_identity", Mock())
    monkeypatch.setattr(routes, "_build_repositories", lambda **kwargs: ("run-repository", "node-repository"))
    monkeypatch.setattr(routes, "_acknowledgement_layer", lambda request: ack_layer)
    monkeypatch.setattr(routes, "set_login_user", Mock())
    monkeypatch.setattr(routes, "PipelineGenerator", lambda: generator)
    monkeypatch.setattr(
        routes,
        "_publish_streaming_response",
        Mock(side_effect=lambda response, *_args, **_kwargs: list(response)),
    )

    routes._resume_rag_pipeline_handoff(_request(WorkflowHandoffResumeRoute.RAG_PIPELINE))

    assert drained == [True]
    assert generator.resume.call_args.kwargs["graph_engine_layers"] == [ack_layer]
    assert generator.resume.call_args.kwargs["graph_config"] is frozen_graph
    assert generator.resume.call_args.kwargs["workflow_version"] == "published-v1"
    assert generator.resume.call_args.kwargs["root_node_id"] == "rag-root"


def test_rag_resume_rejects_cross_tenant_document(monkeypatch: pytest.MonkeyPatch) -> None:
    entity = _entity(RagPipelineGenerateEntity, route=WorkflowHandoffResumeRoute.RAG_PIPELINE)
    workflow_run = SimpleNamespace(id="run-1", app_id="app-1", tenant_id="tenant-1")
    workflow = SimpleNamespace(id="workflow-1", created_by="owner-1")
    dataset = SimpleNamespace(id="dataset-1", tenant_id="tenant-1")
    pipeline = SimpleNamespace(tenant_id="tenant-1", retrieve_dataset=lambda session: dataset)
    document = SimpleNamespace(dataset_id="dataset-1", tenant_id="other-tenant")
    session = _Session({routes.Pipeline: pipeline, routes.Document: document})
    monkeypatch.setattr(routes, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(routes, "g", SimpleNamespace())
    monkeypatch.setattr(routes, "sessionmaker", lambda **kwargs: lambda: session)
    monkeypatch.setattr(routes, "_load_context", lambda request: (Mock(), entity, Mock()))
    monkeypatch.setattr(routes, "_load_run_dependencies", lambda session, request: (workflow_run, workflow, Mock()))
    monkeypatch.setattr(routes, "_validate_entity_identity", Mock())

    with pytest.raises(PermanentWorkflowHandoffResumeError, match="document identity"):
        routes._resume_rag_pipeline_handoff(_request(WorkflowHandoffResumeRoute.RAG_PIPELINE))
