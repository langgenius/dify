"""SQLite-backed tests for workflow app generation and worker reload behavior."""

import contextlib
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

import core.app.apps.workflow.app_generator as app_generator_module
from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY, WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowKind, WorkflowType

SQLITE_MODELS = (Workflow, App, EndUser, CustomizedSnippet)

pytestmark = pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True)


@pytest.fixture(autouse=True)
def _create_sqlite_schema(sqlite_session: Session) -> None:
    """Ensure every test receives an isolated schema for generator ORM state."""


def _workflow(
    *,
    workflow_id: str = "workflow",
    app_id: str = "app",
    tenant_id: str = "tenant",
    kind: WorkflowKind = WorkflowKind.STANDARD,
) -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.WORKFLOW,
        kind=kind,
        version="1",
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by="creator",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
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


def test_should_prepare_user_inputs_defaults_to_true():
    args = {"inputs": {}}

    assert WorkflowAppGenerator()._should_prepare_user_inputs(args)


def test_should_prepare_user_inputs_skips_when_flag_truthy():
    args = {"inputs": {}, SKIP_PREPARE_USER_INPUTS_KEY: True}

    assert not WorkflowAppGenerator()._should_prepare_user_inputs(args)


def test_should_prepare_user_inputs_keeps_validation_when_flag_false():
    args = {"inputs": {}, SKIP_PREPARE_USER_INPUTS_KEY: False}

    assert WorkflowAppGenerator()._should_prepare_user_inputs(args)


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
    generator = WorkflowAppGenerator()
    app, workflow, end_user = _persist_generator_rows(sqlite_session)

    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppGenerator._bind_file_access_scope",
        lambda *args, **kwargs: contextlib.nullcontext(),
    )
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppConfigManager.get_app_config",
        lambda *args, **kwargs: SimpleNamespace(
            app_id=app.id, tenant_id=app.tenant_id, workflow_id=workflow.id, variables=[]
        ),
    )
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.file_factory.build_from_mappings", lambda *args, **kwargs: []
    )
    monkeypatch.setattr("core.app.apps.workflow.app_generator.TraceQueueManager", MagicMock())
    workflow_execution_factory = MagicMock(return_value=MagicMock())
    workflow_node_execution_factory = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
        workflow_execution_factory,
    )
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
        workflow_node_execution_factory,
    )
    monkeypatch.setattr("core.app.apps.workflow.app_generator.db", SimpleNamespace(engine=sqlite_session.get_bind()))
    monkeypatch.setattr(generator, "_prepare_user_inputs", lambda *, user_inputs, **kwargs: user_inputs)

    captured = {}

    def fake_workflow_app_generate_entity(**kwargs):
        captured["workflow_app_generate_entity_kwargs"] = kwargs
        return SimpleNamespace(**kwargs)

    def fake_generate(**kwargs):
        captured["application_generate_entity"] = kwargs["application_generate_entity"]
        return {"data": {}}

    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppGenerateEntity", fake_workflow_app_generate_entity
    )
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
    extras = captured["workflow_app_generate_entity_kwargs"]["extras"]
    assert extras["external_trace_id"] == "trace-1"
    assert extras["parent_trace_context"].model_dump() == {
        "parent_workflow_run_id": "outer-workflow-run-1",
        "parent_node_execution_id": "outer-node-execution-1",
    }
    assert extras["trace_session_id"] == "session-1"
    assert workflow_execution_factory.call_args.kwargs["tenant_id"] == app.tenant_id
    assert workflow_node_execution_factory.call_args.kwargs["tenant_id"] == app.tenant_id


def test_resume_delegates_to_generate(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    generator = WorkflowAppGenerator()
    app, workflow, end_user = _persist_generator_rows(sqlite_session)
    mock_generate = MagicMock(return_value="ok")
    monkeypatch.setattr(generator, "_generate", mock_generate)

    application_generate_entity = SimpleNamespace(
        stream=False, invoke_from=InvokeFrom.DEBUGGER, trace_manager=MagicMock()
    )
    runtime_state = MagicMock(name="runtime-state")
    pause_config = PauseStateLayerConfig(
        session_factory=sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False),
        state_owner_user_id="owner",
    )

    result = generator.resume(
        app_model=app,
        workflow=workflow,
        user=end_user,
        application_generate_entity=application_generate_entity,
        graph_runtime_state=runtime_state,
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        graph_engine_layers=("layer",),
        pause_state_config=pause_config,
        variable_loader=MagicMock(),
    )

    assert result == "ok"
    mock_generate.assert_called_once()
    kwargs = mock_generate.call_args.kwargs
    assert kwargs["graph_runtime_state"] is runtime_state
    assert kwargs["pause_state_config"] is pause_config
    assert kwargs["streaming"] is False
    assert kwargs["invoke_from"] == InvokeFrom.DEBUGGER


def test_generate_appends_pause_layer_and_forwards_state(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    generator = WorkflowAppGenerator()
    app, workflow, end_user = _persist_generator_rows(sqlite_session)

    mock_queue_manager = MagicMock()
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppQueueManager",
        MagicMock(return_value=mock_queue_manager),
    )

    fake_current_app = MagicMock()
    fake_current_app._get_current_object.return_value = MagicMock()
    monkeypatch.setattr("core.app.apps.workflow.app_generator.current_app", fake_current_app)

    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppGenerateResponseConverter.convert",
        MagicMock(return_value="converted"),
    )
    monkeypatch.setattr(WorkflowAppGenerator, "_handle_response", MagicMock(return_value="response"))
    draft_saver_factory = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(
        WorkflowAppGenerator,
        "_get_draft_var_saver_factory",
        draft_saver_factory,
    )

    pause_layer = MagicMock(name="pause-layer")
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.PauseStatePersistenceLayer",
        MagicMock(return_value=pause_layer),
    )

    engine = sqlite_session.get_bind()
    scoped_session = Session(engine, expire_on_commit=False)
    monkeypatch.setattr(app_generator_module.db, "session", scoped_session)

    worker_kwargs: dict[str, object] = {}

    class DummyThread:
        def __init__(self, target, kwargs):
            worker_kwargs["target"] = target
            worker_kwargs["kwargs"] = kwargs

        def start(self):
            return None

    monkeypatch.setattr("core.app.apps.workflow.app_generator.threading.Thread", DummyThread)

    app_config = SimpleNamespace(app_id=app.id, tenant_id=app.tenant_id, workflow_id=workflow.id)
    application_generate_entity = SimpleNamespace(
        task_id="task",
        user_id=end_user.id,
        invoke_from=InvokeFrom.SERVICE_API,
        app_config=app_config,
        files=[],
        stream=True,
        workflow_execution_id="run",
    )

    graph_runtime_state = MagicMock()

    result = generator._generate(
        app_model=app,
        workflow=workflow,
        user=end_user,
        application_generate_entity=application_generate_entity,
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        streaming=True,
        graph_engine_layers=("base-layer",),
        graph_runtime_state=graph_runtime_state,
        pause_state_config=PauseStateLayerConfig(
            session_factory=sessionmaker(bind=engine, expire_on_commit=False),
            state_owner_user_id="owner",
        ),
    )

    assert result == "converted"
    assert worker_kwargs["kwargs"]["graph_engine_layers"] == ("base-layer", pause_layer)
    assert worker_kwargs["kwargs"]["graph_runtime_state"] is graph_runtime_state
    assert draft_saver_factory.call_args.kwargs["tenant_id"] == app.tenant_id


def test_resume_path_runs_worker_with_runtime_state(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    generator = WorkflowAppGenerator()
    app, workflow, end_user = _persist_generator_rows(sqlite_session)
    runtime_state = MagicMock(name="runtime-state")

    pause_layer = MagicMock(name="pause-layer")
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.PauseStatePersistenceLayer",
        MagicMock(return_value=pause_layer),
    )

    queue_manager = MagicMock()
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppQueueManager",
        MagicMock(return_value=queue_manager),
    )

    monkeypatch.setattr(generator, "_handle_response", MagicMock(return_value="raw-response"))
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppGenerateResponseConverter.convert",
        MagicMock(side_effect=lambda response, invoke_from: response),
    )

    engine = sqlite_session.get_bind()
    monkeypatch.setattr(app_generator_module.db, "session", Session(engine, expire_on_commit=False))
    monkeypatch.setattr(
        app_generator_module.session_factory,
        "create_session",
        lambda: Session(engine, expire_on_commit=False),
    )

    runner_instance = MagicMock()

    def runner_ctor(**kwargs):
        assert kwargs["graph_runtime_state"] is runtime_state
        assert kwargs["workflow"].id == workflow.id
        assert kwargs["system_user_id"] == end_user.session_id
        assert kwargs["queue_manager"] is queue_manager
        return runner_instance

    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppRunner",
        MagicMock(side_effect=runner_ctor),
    )

    class ImmediateThread:
        def __init__(self, target, kwargs):
            target(**kwargs)

        def start(self):
            return None

    monkeypatch.setattr("core.app.apps.workflow.app_generator.threading.Thread", ImmediateThread)

    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
        MagicMock(return_value=MagicMock()),
    )
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
        MagicMock(return_value=MagicMock()),
    )

    pause_config = PauseStateLayerConfig(
        session_factory=sessionmaker(bind=engine, expire_on_commit=False),
        state_owner_user_id="owner",
    )

    app_config = SimpleNamespace(app_id=app.id, tenant_id=app.tenant_id, workflow_id=workflow.id)
    application_generate_entity = SimpleNamespace(
        task_id="task",
        user_id=end_user.id,
        invoke_from=InvokeFrom.SERVICE_API,
        app_config=app_config,
        files=[],
        stream=True,
        workflow_execution_id="run",
        trace_manager=MagicMock(),
    )

    result = generator.resume(
        app_model=app,
        workflow=workflow,
        user=end_user,
        application_generate_entity=application_generate_entity,
        graph_runtime_state=runtime_state,
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        pause_state_config=pause_config,
    )

    assert result == "raw-response"
    runner_instance.run.assert_called_once()
