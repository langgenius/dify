"""SQLite-backed tests for workflow app generation and worker reload behavior."""

import contextlib
import contextvars
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

import services.workflow_runtime.workflow_generator as app_generator_module
from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowSucceededEvent
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.ops.ops_trace_manager import OpsTraceManager, TraceQueueManager
from core.repositories import SQLAlchemyWorkflowExecutionRepository, SQLAlchemyWorkflowNodeExecutionRepository
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import RuntimeState, VariablePool
from graphon.variable_loader import DUMMY_VARIABLE_LOADER
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import App, AppMode, EndUser
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowKind, WorkflowNodeExecutionTriggeredFrom, WorkflowRun
from services.workflow_run_agg import WorkflowRunAgg
from services.workflow_runtime.workflow_generator import WorkflowAppGenerator
from services.workflow_runtime.workflow_queue import WorkflowAppQueueManager
from tests.unit_tests.model_factories import make_workflow


@pytest.fixture(autouse=True)
def disable_trace_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
    """Construct real trace managers without provider lookup or background delivery."""
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", lambda app_id: None)
    monkeypatch.setattr(TraceQueueManager, "start_timer", lambda self: None)
    monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)


def _workflow(
    *,
    workflow_id: str = "workflow",
    app_id: str = "app",
    tenant_id: str = "tenant",
    kind: WorkflowKind = WorkflowKind.STANDARD,
) -> Workflow:
    return make_workflow(
        workflow_id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        kind=kind,
        version="1",
        created_by="creator",
        graph={"nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}], "edges": []},
    )


def _persist_generator_rows(sqlite_session: Session) -> tuple[App, Workflow, EndUser]:
    workflow = _workflow()
    app = App(
        id="app",
        tenant_id="tenant",
        name="Workflow app",
        description="",
        mode=AppMode.WORKFLOW,
        workflow_id=workflow.id,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )
    end_user = EndUser(
        id="user",
        tenant_id="tenant",
        app_id=app.id,
        type=EndUserType.SERVICE_API,
        name="End user",
        session_id="end-user-session",
    )
    sqlite_session.add_all([workflow, app, end_user])
    sqlite_session.commit()
    return app, workflow, end_user


def _app_config(app: App, workflow: Workflow) -> WorkflowUIBasedAppConfig:
    return WorkflowUIBasedAppConfig(
        tenant_id=app.tenant_id,
        app_id=app.id,
        app_mode=app.mode,
        workflow_id=workflow.id,
    )


def _generate_entity(
    app: App,
    workflow: Workflow,
    end_user: EndUser,
    *,
    invoke_from: InvokeFrom = InvokeFrom.SERVICE_API,
    stream: bool = True,
) -> WorkflowAppGenerateEntity:
    return WorkflowAppGenerateEntity(
        task_id="task",
        app_config=_app_config(app, workflow),
        inputs={},
        files=[],
        user_id=end_user.id,
        stream=stream,
        invoke_from=invoke_from,
        trace_manager=TraceQueueManager(app_id=app.id, user_id=end_user.id),
        workflow_execution_id="run",
    )


def _runtime_state() -> RuntimeState:
    return RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0.0)


def _repositories(
    sqlite_session_factory: sessionmaker[Session], app: App, end_user: EndUser
) -> tuple[SQLAlchemyWorkflowExecutionRepository, SQLAlchemyWorkflowNodeExecutionRepository]:
    return (
        SQLAlchemyWorkflowExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=app.tenant_id,
            user=end_user,
            app_id=app.id,
            triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        ),
        SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=sqlite_session_factory,
            tenant_id=app.tenant_id,
            user=end_user,
            app_id=app.id,
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        ),
    )


def test_worker_executes_and_persists_a_workflow_through_the_injected_driver(
    app: Flask, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    app_model, workflow, end_user = _persist_generator_rows(sqlite_session)
    workflow.graph = json.dumps(
        {
            "nodes": [
                {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
                {
                    "id": "end",
                    "data": {
                        "type": "end",
                        "title": "End",
                        "outputs": [{"variable": "caller", "value_selector": ["sys", "user_id"]}],
                    },
                },
            ],
            "edges": [{"id": "start-end", "source": "start", "target": "end"}],
        }
    )
    sqlite_session.commit()
    entity = WorkflowAppGenerateEntity(
        task_id="worker-task",
        app_config=_app_config(app_model, workflow),
        inputs={},
        files=[],
        user_id=end_user.id,
        stream=True,
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_execution_id="worker-run",
    )
    queue = WorkflowAppQueueManager(entity.task_id, end_user.id, entity.invoke_from, AppMode.WORKFLOW)
    execution_repository, node_repository = _repositories(sqlite_session_factory, app_model, end_user)

    WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)._generate_worker(
        flask_app=app,
        application_generate_entity=entity,
        queue_manager=queue,
        context=contextvars.copy_context(),
        variable_loader=DUMMY_VARIABLE_LOADER,
        workflow_execution_repository=execution_repository,
        workflow_node_execution_repository=node_repository,
    )

    events = [message.event for message in queue.listen()]
    assert isinstance(events[-1], QueueWorkflowSucceededEvent), events
    assert events[-1].outputs == {"caller": end_user.session_id}
    run = sqlite_session.get(WorkflowRun, entity.workflow_execution_id)
    assert run is not None
    assert run.status == "succeeded"
    assert run.outputs_dict == {"caller": end_user.session_id}


def test_ensure_snippet_start_node_in_worker_returns_standard_workflow_without_lookup(
    sqlite_session: Session,
) -> None:
    workflow = _workflow()
    sqlite_session.add(workflow)
    sqlite_session.commit()

    result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(session=sqlite_session, workflow=workflow)

    assert result is workflow


def test_ensure_snippet_start_node_in_worker_returns_snippet_workflow_when_snippet_missing(
    sqlite_session: Session,
) -> None:
    workflow = _workflow(app_id="snippet-1", tenant_id="tenant-1", kind=WorkflowKind.SNIPPET)
    other_tenant_snippet = CustomizedSnippet(
        id="snippet-1",
        tenant_id="tenant-2",
        name="Other tenant snippet",
        description="",
        type="node",
    )
    sqlite_session.add_all([workflow, other_tenant_snippet])
    sqlite_session.commit()

    result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(session=sqlite_session, workflow=workflow)

    assert result is workflow


def test_ensure_snippet_start_node_in_worker_applies_snippet_start_injection(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    workflow = _workflow(app_id="snippet-1", tenant_id="tenant-1", kind=WorkflowKind.SNIPPET)
    snippet = CustomizedSnippet(
        id="snippet-1",
        tenant_id="tenant-1",
        name="Matching snippet",
        description="",
        type="node",
    )
    sqlite_session.add_all([workflow, snippet])
    sqlite_session.commit()
    ensure_start_node = MagicMock(return_value=workflow)
    monkeypatch.setattr(
        "services.snippet_generate_service.SnippetGenerateService.ensure_start_node_for_worker",
        ensure_start_node,
    )

    result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(session=sqlite_session, workflow=workflow)

    assert result is workflow
    ensure_start_node.assert_called_once_with(workflow, snippet)


def test_generate_includes_parent_trace_context_in_extras(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    generator = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
    app, workflow, end_user = _persist_generator_rows(sqlite_session)

    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.WorkflowAppGenerator._bind_file_access_scope",
        lambda *args, **kwargs: contextlib.nullcontext(),
    )
    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.WorkflowAppConfigManager.get_app_config",
        lambda *args, **kwargs: _app_config(app, workflow),
    )
    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.file_factory.build_from_mappings", lambda *args, **kwargs: []
    )
    repository_tenant_ids: dict[str, str] = {}
    workflow_execution_factory = app_generator_module.DifyCoreRepositoryFactory.create_workflow_execution_repository
    workflow_node_execution_factory = (
        app_generator_module.DifyCoreRepositoryFactory.create_workflow_node_execution_repository
    )

    def create_workflow_execution_repository(**kwargs):
        repository_tenant_ids["workflow"] = kwargs["tenant_id"]
        return workflow_execution_factory(**kwargs)

    def create_workflow_node_execution_repository(**kwargs):
        repository_tenant_ids["node"] = kwargs["tenant_id"]
        return workflow_node_execution_factory(**kwargs)

    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
        create_workflow_execution_repository,
    )
    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
        create_workflow_node_execution_repository,
    )
    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.db", SimpleNamespace(engine=sqlite_session.get_bind())
    )
    monkeypatch.setattr(generator, "_prepare_user_inputs", lambda *, user_inputs, **kwargs: user_inputs)

    captured = {}

    def fake_generate(**kwargs):
        captured.update(kwargs)
        return {"data": {}}

    monkeypatch.setattr(generator, "_generate", fake_generate)

    result = generator.generate(
        app_model=app,
        workflow=workflow,
        user=end_user,
        args={
            "inputs": {"query": "hello"},
            "files": [],
            "external_trace_id": "trace-1",
            "parent_trace_context": {
                "parent_workflow_run_id": "outer-workflow-run-1",
                "parent_node_execution_id": "outer-node-execution-1",
            },
            "trace_session_id": "session-1",
        },
        invoke_from=InvokeFrom.SERVICE_API,
        streaming=False,
        call_depth=0,
    )

    assert result == {"data": {}}
    application_generate_entity = captured["application_generate_entity"]
    assert isinstance(application_generate_entity, WorkflowAppGenerateEntity)
    extras = application_generate_entity.extras
    assert extras["external_trace_id"] == "trace-1"
    assert extras["parent_trace_context"].model_dump() == {
        "parent_workflow_run_id": "outer-workflow-run-1",
        "parent_node_execution_id": "outer-node-execution-1",
    }
    assert extras["trace_session_id"] == "session-1"
    assert isinstance(captured["workflow_execution_repository"], SQLAlchemyWorkflowExecutionRepository)
    assert isinstance(captured["workflow_node_execution_repository"], SQLAlchemyWorkflowNodeExecutionRepository)
    assert repository_tenant_ids == {"workflow": app.tenant_id, "node": app.tenant_id}


@pytest.mark.parametrize("case", ["valid", "run_mismatch", "non_debugger", "native_mix", "nested"])
def test_confirmed_agent_generator_keeps_preallocated_identity(monkeypatch, sqlite_session, case):
    from models.model import Account
    from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError
    from tests.unit_tests.services.dify_builder.native_testing.test_agent_context import marker

    generator = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
    app, workflow, _ = _persist_generator_rows(sqlite_session)
    account = MagicMock(spec=Account)
    account.id = "actor"
    context = marker()
    captured = {}
    monkeypatch.setattr(generator, "_bind_file_access_scope", lambda **_: contextlib.nullcontext())
    monkeypatch.setattr(
        app_generator_module.WorkflowAppConfigManager, "get_app_config", lambda **_: _app_config(app, workflow)
    )
    monkeypatch.setattr(app_generator_module.file_factory, "build_from_mappings", lambda **_: [])
    monkeypatch.setattr(app_generator_module, "db", SimpleNamespace(engine=sqlite_session.get_bind()))
    monkeypatch.setattr(generator, "_prepare_user_inputs", lambda *, user_inputs, **_: user_inputs)
    monkeypatch.setattr(generator, "_generate", lambda **kw: captured.update(kw))
    kwargs = {
        "app_model": app,
        "workflow": workflow,
        "user": account,
        "args": {"inputs": {}},
        "invoke_from": InvokeFrom.SERVICE_API if case == "non_debugger" else InvokeFrom.DEBUGGER,
        "builder_agent_execution": context,
        "workflow_run_id": "other" if case == "run_mismatch" else None,
        "call_depth": 1 if case == "nested" else 0,
        "native_test_required": case == "native_mix",
    }
    if case != "valid":
        with pytest.raises(BuilderExecutionPolicyError):
            generator.generate(**kwargs)
        assert captured == {}
        return
    generator.generate(**kwargs)
    entity = captured["application_generate_entity"]
    assert entity.builder_agent_execution == context
    assert entity.workflow_execution_id == context.native_run_id


@pytest.mark.parametrize("valid", [True, False])
def test_confirmed_agent_resume_keeps_original_context_and_run(monkeypatch, sqlite_session, valid):
    from models.model import Account
    from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError
    from tests.unit_tests.services.dify_builder.native_testing.test_agent_context import marker

    app, workflow, end_user = _persist_generator_rows(sqlite_session)
    context = marker()
    entity = _generate_entity(app, workflow, end_user, invoke_from=InvokeFrom.DEBUGGER).model_copy(
        update={"builder_agent_execution": context, "workflow_execution_id": context.native_run_id}
    )
    # Exercise the persisted carrier, including reconstruction of transient tracing.
    entity = WorkflowAppGenerateEntity.model_validate_json(entity.model_dump_json())
    user = MagicMock(spec=Account)
    user.id = entity.user_id
    if not valid:
        entity.invoke_from = InvokeFrom.SERVICE_API
    captured = {}
    generator = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
    monkeypatch.setattr(generator, "_generate", lambda **kw: captured.update(kw))
    kwargs = {
        "app_model": app,
        "workflow": workflow,
        "user": user,
        "application_generate_entity": entity,
        "graph_runtime_state": _runtime_state(),
        "workflow_execution_repository": MagicMock(),
        "workflow_node_execution_repository": MagicMock(),
    }
    if not valid:
        with pytest.raises(BuilderExecutionPolicyError):
            generator.resume(**kwargs)
        assert captured == {}
        return
    generator.resume(**kwargs)
    restored = captured["application_generate_entity"]
    assert restored.builder_agent_execution == context
    assert restored.workflow_execution_id == context.native_run_id


def test_resume_delegates_to_generate(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    generator = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
    app, workflow, end_user = _persist_generator_rows(sqlite_session)
    mock_generate = MagicMock(return_value="ok")
    monkeypatch.setattr(generator, "_generate", mock_generate)

    application_generate_entity = _generate_entity(
        app,
        workflow,
        end_user,
        invoke_from=InvokeFrom.DEBUGGER,
        stream=False,
    )
    runtime_state = _runtime_state()
    workflow_execution_repository, workflow_node_execution_repository = _repositories(
        sqlite_session_factory, app, end_user
    )
    pause_config = PauseStateLayerConfig(
        session_factory=sqlite_session_factory,
        state_owner_user_id="owner",
    )

    result = generator.resume(
        app_model=app,
        workflow=workflow,
        user=end_user,
        application_generate_entity=application_generate_entity,
        graph_runtime_state=runtime_state,
        workflow_execution_repository=workflow_execution_repository,
        workflow_node_execution_repository=workflow_node_execution_repository,
        graph_engine_layers=("layer",),
        pause_state_config=pause_config,
    )

    assert result == "ok"
    mock_generate.assert_called_once()
    kwargs = mock_generate.call_args.kwargs
    assert kwargs["graph_runtime_state"] is runtime_state
    assert kwargs["pause_state_config"] is pause_config
    assert kwargs["streaming"] is False
    assert kwargs["invoke_from"] == InvokeFrom.DEBUGGER


def test_generate_forwards_pause_configuration_and_state(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    generator = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
    app, workflow, end_user = _persist_generator_rows(sqlite_session)

    queue_manager = MagicMock()
    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.WorkflowAppQueueManager",
        MagicMock(return_value=queue_manager),
    )

    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.WorkflowAppGenerateResponseConverter.convert",
        MagicMock(return_value="converted"),
    )
    monkeypatch.setattr(WorkflowAppGenerator, "_handle_response", MagicMock(return_value="response"))

    draft_factory_tenant_ids: list[str] = []
    get_draft_var_saver_factory = WorkflowAppGenerator._get_draft_var_saver_factory

    def get_recording_draft_var_saver_factory(
        invoke_from: InvokeFrom, account: EndUser, *, tenant_id: str
    ) -> DraftVariableSaverFactory:
        draft_factory_tenant_ids.append(tenant_id)
        return get_draft_var_saver_factory(invoke_from, account, tenant_id=tenant_id)

    monkeypatch.setattr(
        WorkflowAppGenerator,
        "_get_draft_var_saver_factory",
        staticmethod(get_recording_draft_var_saver_factory),
    )

    db_session = sqlite_session_factory()
    monkeypatch.setattr(app_generator_module.db, "session", db_session)

    worker_kwargs: dict[str, object] = {}

    class DummyThread:
        def __init__(self, target, kwargs):
            worker_kwargs["target"] = target
            worker_kwargs["kwargs"] = kwargs

        def start(self):
            return None

        def join(self, timeout):
            worker_kwargs["joined"] = True
            worker_kwargs["join_timeout"] = timeout

        def is_alive(self):
            return False

    monkeypatch.setattr("services.workflow_runtime.workflow_generator.threading.Thread", DummyThread)

    application_generate_entity = _generate_entity(app, workflow, end_user)
    graph_runtime_state = _runtime_state()
    workflow_execution_repository, workflow_node_execution_repository = _repositories(
        sqlite_session_factory, app, end_user
    )

    flask_app = Flask(__name__)
    with flask_app.app_context():
        result = generator._generate(
            app_model=app,
            workflow=workflow,
            user=end_user,
            application_generate_entity=application_generate_entity,
            invoke_from=InvokeFrom.SERVICE_API,
            workflow_execution_repository=workflow_execution_repository,
            workflow_node_execution_repository=workflow_node_execution_repository,
            streaming=True,
            graph_engine_layers=("base-layer",),
            graph_runtime_state=graph_runtime_state,
            pause_state_config=PauseStateLayerConfig(
                session_factory=sqlite_session_factory,
                state_owner_user_id="owner",
            ),
        )

    assert result == "converted"
    graph_engine_layers = worker_kwargs["kwargs"]["graph_engine_layers"]
    assert graph_engine_layers == ("base-layer",)
    assert worker_kwargs["kwargs"]["pause_state_config"].state_owner_user_id == "owner"
    assert worker_kwargs["kwargs"]["graph_runtime_state"] is graph_runtime_state
    assert worker_kwargs["joined"] is True
    assert worker_kwargs["join_timeout"] == 300
    assert draft_factory_tenant_ids == [app.tenant_id]


def test_resume_path_runs_worker_with_runtime_state(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    generator = WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)
    app, workflow, end_user = _persist_generator_rows(sqlite_session)
    workflow_run = WorkflowRun(
        id="run",
        tenant_id=workflow.tenant_id,
        app_id=app.id,
        workflow_id=workflow.id,
        type=workflow.type,
        triggered_from=WorkflowRunTriggeredFrom.APP_RUN,
        version=workflow.version,
        graph=workflow.graph,
        inputs="{}",
        status=WorkflowExecutionStatus.RUNNING,
        created_by_role=CreatorUserRole.END_USER,
        created_by=end_user.id,
    )
    sqlite_session.add(workflow_run)
    sqlite_session.commit()
    runtime_state = _runtime_state()

    queue_manager = MagicMock()
    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.WorkflowAppQueueManager",
        MagicMock(return_value=queue_manager),
    )

    monkeypatch.setattr(generator, "_handle_response", MagicMock(return_value="raw-response"))
    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.WorkflowAppGenerateResponseConverter.convert",
        MagicMock(side_effect=lambda response, invoke_from: response),
    )

    db_session = sqlite_session_factory()
    monkeypatch.setattr(app_generator_module.db, "session", db_session)

    runner_instance = MagicMock()
    runner_instance.prepare.return_value = None

    def runner_ctor(**kwargs):
        assert kwargs["graph_runtime_state"] is runtime_state
        assert kwargs["workflow"].id == workflow.id
        assert kwargs["system_user_id"] == end_user.session_id
        assert kwargs["queue_manager"] is queue_manager
        return runner_instance

    monkeypatch.setattr(
        "services.workflow_runtime.workflow_generator.WorkflowAppRunner",
        MagicMock(side_effect=runner_ctor),
    )

    worker_lifecycle: dict[str, object] = {}

    class ImmediateThread:
        def __init__(self, target, kwargs):
            target(**kwargs)

        def start(self):
            return None

        def join(self, timeout):
            worker_lifecycle["joined"] = True
            worker_lifecycle["join_timeout"] = timeout

        def is_alive(self):
            return False

    monkeypatch.setattr("services.workflow_runtime.workflow_generator.threading.Thread", ImmediateThread)

    pause_config = PauseStateLayerConfig(
        session_factory=sqlite_session_factory,
        state_owner_user_id="owner",
    )

    application_generate_entity = _generate_entity(app, workflow, end_user)
    workflow_execution_repository, workflow_node_execution_repository = _repositories(
        sqlite_session_factory, app, end_user
    )

    result = generator.resume(
        app_model=app,
        workflow=workflow,
        user=end_user,
        application_generate_entity=application_generate_entity,
        graph_runtime_state=runtime_state,
        workflow_execution_repository=workflow_execution_repository,
        workflow_node_execution_repository=workflow_node_execution_repository,
        pause_state_config=pause_config,
    )

    assert result == "raw-response"
    assert worker_lifecycle["joined"] is True
    assert worker_lifecycle["join_timeout"] == 300
    runner_instance.prepare.assert_called_once()


def test_builder_worker_refuses_draft_changed_after_confirmation_before_runner(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from services.dify_builder.revision import execution_revision

    app, workflow, end_user = _persist_generator_rows(sqlite_session)
    graph = workflow.graph_dict
    graph["nodes"].append({"id": "send", "data": {"type": "http-request", "url": "https://approved.example"}})
    workflow.graph = json.dumps(graph)
    sqlite_session.commit()
    approved_revision = execution_revision(workflow)
    entity = _generate_entity(app, workflow, end_user, invoke_from=InvokeFrom.DEBUGGER)
    entity.builder_expected_revision = approved_revision
    # Same node identity, changed executable data in the worker's independent read.
    workflow.graph = workflow.graph.replace("https://approved.example", "https://changed.example")
    sqlite_session.commit()
    monkeypatch.setattr(
        app_generator_module, "preserve_flask_contexts", lambda *args, **kwargs: contextlib.nullcontext()
    )
    monkeypatch.setattr(app_generator_module, "session_factory", SimpleNamespace(create_session=sqlite_session_factory))
    reached = []

    def first_node(**kwargs):
        reached.append(kwargs)
        return SimpleNamespace(run=lambda: None)

    monkeypatch.setattr(app_generator_module, "WorkflowAppRunner", first_node)
    queue = MagicMock()
    repositories = _repositories(sqlite_session_factory, app, end_user)
    WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run)._generate_worker(
        flask_app=Flask(__name__),
        application_generate_entity=entity,
        queue_manager=queue,
        context=SimpleNamespace(),
        variable_loader=SimpleNamespace(),
        workflow_execution_repository=repositories[0],
        workflow_node_execution_repository=repositories[1],
    )

    assert reached == []
    assert queue.publish_error.call_args.args[0].reason_code == "stale_execution_revision"


def test_actual_generation_marks_configuration_failure_before_worker_dispatch(
    monkeypatch,
    sqlite_session,
):
    from services.dify_builder.native_launch_observation import NativeLaunchObservation

    app, workflow, user = _persist_generator_rows(sqlite_session)
    monkeypatch.setattr(
        app_generator_module.WorkflowAppConfigManager,
        "get_app_config",
        MagicMock(side_effect=ConnectionRefusedError("private plugin schema service")),
    )
    observation = NativeLaunchObservation()
    with observation.track(), pytest.raises(ConnectionRefusedError):
        WorkflowAppGenerator(execution_driver=WorkflowRunAgg.run).generate(
            app_model=app,
            workflow=workflow,
            user=user,
            args={"inputs": {}},
            invoke_from=InvokeFrom.DEBUGGER,
            streaming=True,
        )
    assert observation.failed_before_dispatch
