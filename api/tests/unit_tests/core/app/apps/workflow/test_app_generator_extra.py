from __future__ import annotations

import contextlib
import json
from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.workflow import app_generator as app_generator_module
from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY, WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.ops.ops_trace_manager import TraceQueueManager
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowKind, WorkflowType

TENANT_ID = "00000000-0000-0000-0000-000000000001"
OTHER_TENANT_ID = "00000000-0000-0000-0000-000000000002"
APP_ID = "00000000-0000-0000-0000-000000000003"
WORKFLOW_ID = "00000000-0000-0000-0000-000000000004"
END_USER_ID = "00000000-0000-0000-0000-000000000005"
CREATOR_ID = "00000000-0000-0000-0000-000000000006"


@pytest.fixture
def sqlite_generator_scoped_session(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[scoped_session[Session]]:
    """Adapt the shared SQLite session factory to Flask-SQLAlchemy's scoped session API."""
    engine = sqlite_session.get_bind()
    request_sessions = scoped_session(sqlite_session_factory)
    monkeypatch.setattr(
        app_generator_module,
        "db",
        SimpleNamespace(engine=engine, session=request_sessions),
    )
    try:
        yield request_sessions
    finally:
        request_sessions.remove()


def _persist_app(session: Session) -> App:
    app = App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="Workflow app",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type=None,
        icon="",
        icon_background=None,
        app_model_config_id=None,
        workflow_id=WORKFLOW_ID,
        enable_site=False,
        enable_api=True,
        max_active_requests=None,
        created_by=CREATOR_ID,
    )
    session.add(app)
    session.commit()
    return app


def _persist_workflow(
    session: Session,
    *,
    workflow_id: str = WORKFLOW_ID,
    app_id: str = APP_ID,
    tenant_id: str = TENANT_ID,
    kind: WorkflowKind = WorkflowKind.STANDARD,
) -> Workflow:
    workflow = Workflow.new(
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.WORKFLOW.value,
        version="1",
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by=CREATOR_ID,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
        kind=kind.value,
    )
    workflow.id = workflow_id
    session.add(workflow)
    session.commit()
    return workflow


def _persist_end_user(session: Session) -> EndUser:
    end_user = EndUser(
        id=END_USER_ID,
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=EndUserType.BROWSER,
        name="End user",
        session_id="session-id",
    )
    session.add(end_user)
    session.commit()
    return end_user


def _persist_snippet(
    session: Session,
    *,
    snippet_id: str,
    tenant_id: str = TENANT_ID,
) -> CustomizedSnippet:
    snippet = CustomizedSnippet(
        id=snippet_id,
        tenant_id=tenant_id,
        name="Snippet",
        description=None,
        type="node",
    )
    session.add(snippet)
    session.commit()
    return snippet


class TestWorkflowAppGeneratorValidation:
    @pytest.mark.usefixtures("sqlite_generator_scoped_session")
    def test_generate_stream_joins_worker_after_response_exhaustion(self, monkeypatch: pytest.MonkeyPatch):
        generator = WorkflowAppGenerator()
        worker_thread = Mock()
        worker_thread.is_alive.return_value = False
        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        application_generate_entity = WorkflowAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            files=[],
            user_id="user",
            stream=True,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
        )

        def response_stream():
            yield {"event": "workflow_finished"}

        monkeypatch.setattr(generator, "_bind_file_access_scope", lambda **kwargs: contextlib.nullcontext())
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowAppQueueManager",
            lambda **kwargs: SimpleNamespace(**kwargs),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.current_app",
            SimpleNamespace(_get_current_object=lambda: SimpleNamespace(name="flask")),
        )
        monkeypatch.setattr("core.app.apps.workflow.app_generator.contextvars.copy_context", lambda: "ctx")
        monkeypatch.setattr("core.app.apps.workflow.app_generator.threading.Thread", lambda **kwargs: worker_thread)
        monkeypatch.setattr(generator, "_get_draft_var_saver_factory", lambda *args, **kwargs: "draft-factory")
        monkeypatch.setattr(generator, "_handle_response", lambda **kwargs: response_stream())
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowAppGenerateResponseConverter.convert",
            lambda response, invoke_from: response,
        )

        managed_stream = generator._generate(
            app_model=SimpleNamespace(mode=AppMode.WORKFLOW, tenant_id="tenant"),
            workflow=SimpleNamespace(id="workflow-id"),
            user=SimpleNamespace(id="user"),
            application_generate_entity=application_generate_entity,
            invoke_from=InvokeFrom.WEB_APP,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            streaming=True,
        )

        worker_thread.start.assert_called_once_with()
        worker_thread.join.assert_not_called()
        assert list(managed_stream) == [{"event": "workflow_finished"}]
        worker_thread.join.assert_called_once_with(timeout=300)

    def test_ensure_snippet_start_node_returns_original_for_non_snippet_workflow(
        self,
        unbound_session: Session,
    ):
        workflow = SimpleNamespace(kind_or_standard="workflow")

        result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(
            session=unbound_session,
            workflow=workflow,
        )

        assert result is workflow

    def test_ensure_snippet_start_node_returns_original_when_snippet_is_from_another_tenant(
        self,
        sqlite_session: Session,
    ):
        workflow = _persist_workflow(sqlite_session, kind=WorkflowKind.SNIPPET)
        _persist_snippet(sqlite_session, snippet_id=APP_ID, tenant_id=OTHER_TENANT_ID)

        result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(
            session=sqlite_session,
            workflow=workflow,
        )

        assert result is workflow

    def test_ensure_snippet_start_node_delegates_when_snippet_exists(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ):
        workflow = _persist_workflow(sqlite_session, kind=WorkflowKind.SNIPPET)
        snippet = _persist_snippet(sqlite_session, snippet_id=APP_ID)
        injected_workflow = SimpleNamespace(id="workflow-injected")
        ensure_start_node = Mock(return_value=injected_workflow)
        monkeypatch.setattr(
            "services.snippet_generate_service.SnippetGenerateService.ensure_start_node_for_worker",
            ensure_start_node,
        )

        result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(
            session=sqlite_session,
            workflow=workflow,
        )

        assert result is injected_workflow
        ensure_start_node.assert_called_once_with(workflow, snippet)

    def test_should_prepare_user_inputs(self):
        generator = WorkflowAppGenerator()

        assert generator._should_prepare_user_inputs({}) is True
        assert generator._should_prepare_user_inputs({SKIP_PREPARE_USER_INPUTS_KEY: True}) is False

    def test_single_iteration_generate_validates_args(self, sqlite_session: Session):
        generator = WorkflowAppGenerator()

        with pytest.raises(ValueError, match="node_id is required"):
            generator.single_iteration_generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                node_id="",
                user=SimpleNamespace(),
                args={"inputs": {}},
                streaming=False,
                session=sqlite_session,
            )

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_iteration_generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                node_id="node",
                user=SimpleNamespace(),
                args={},
                streaming=False,
                session=sqlite_session,
            )

    def test_single_loop_generate_validates_args(self, sqlite_session: Session):
        generator = WorkflowAppGenerator()

        with pytest.raises(ValueError, match="node_id is required"):
            generator.single_loop_generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                node_id="",
                user=SimpleNamespace(),
                args=SimpleNamespace(inputs={}),
                streaming=False,
                session=sqlite_session,
            )

    @pytest.mark.usefixtures("sqlite_generator_scoped_session")
    def test_single_iteration_generate_includes_trace_session_id_in_extras(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ):
        generator = WorkflowAppGenerator()
        app = _persist_app(sqlite_session)
        workflow = _persist_workflow(sqlite_session)
        user = _persist_end_user(sqlite_session)
        app_config = WorkflowUIBasedAppConfig(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id=WORKFLOW_ID,
        )
        captured: dict[str, object] = {}
        repository_session_makers: list[sessionmaker[Session]] = []
        draft_sessions: list[Session] = []

        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: repository_session_makers.append(kwargs["session_factory"]) or SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: repository_session_makers.append(kwargs["session_factory"]) or SimpleNamespace(),
        )
        monkeypatch.setattr("core.app.apps.workflow.app_generator.DraftVarLoader", lambda **kwargs: SimpleNamespace())
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowDraftVariableService",
            lambda session: (
                draft_sessions.append(session)
                or SimpleNamespace(prefill_conversation_variable_default_values=lambda *args, **kwargs: None)
            ),
        )
        monkeypatch.setattr(generator, "_generate", lambda **kwargs: captured.update(kwargs) or {"ok": True})

        generator.single_iteration_generate(
            app_model=app,
            workflow=workflow,
            node_id="node-1",
            user=user,
            args={"inputs": {"foo": "bar"}, "trace_session_id": "session-1"},
            streaming=False,
            session=sqlite_session,
        )

        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"
        assert len(repository_session_makers) == 2
        assert all(factory.kw["bind"] is sqlite_session.get_bind() for factory in repository_session_makers)
        assert len(draft_sessions) == 1
        assert draft_sessions[0] is sqlite_session

    @pytest.mark.usefixtures("sqlite_generator_scoped_session")
    def test_single_loop_generate_includes_trace_session_id_in_extras(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ):
        generator = WorkflowAppGenerator()
        app = _persist_app(sqlite_session)
        workflow = _persist_workflow(sqlite_session)
        user = _persist_end_user(sqlite_session)
        app_config = WorkflowUIBasedAppConfig(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id=WORKFLOW_ID,
        )
        captured: dict[str, object] = {}
        repository_session_makers: list[sessionmaker[Session]] = []
        draft_sessions: list[Session] = []

        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: repository_session_makers.append(kwargs["session_factory"]) or SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: repository_session_makers.append(kwargs["session_factory"]) or SimpleNamespace(),
        )
        monkeypatch.setattr("core.app.apps.workflow.app_generator.DraftVarLoader", lambda **kwargs: SimpleNamespace())
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowDraftVariableService",
            lambda session: (
                draft_sessions.append(session)
                or SimpleNamespace(prefill_conversation_variable_default_values=lambda *args, **kwargs: None)
            ),
        )
        monkeypatch.setattr(generator, "_generate", lambda **kwargs: captured.update(kwargs) or {"ok": True})

        generator.single_loop_generate(
            app_model=app,
            workflow=workflow,
            node_id="node-2",
            user=user,
            args=SimpleNamespace(inputs={"foo": "bar"}, trace_session_id="session-1"),
            streaming=False,
            session=sqlite_session,
        )

        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"
        assert len(repository_session_makers) == 2
        assert all(factory.kw["bind"] is sqlite_session.get_bind() for factory in repository_session_makers)
        assert len(draft_sessions) == 1
        assert draft_sessions[0] is sqlite_session

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_loop_generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                node_id="node",
                user=SimpleNamespace(),
                args=SimpleNamespace(inputs=None),
                streaming=False,
                session=sqlite_session,
            )


class TestWorkflowAppGeneratorHandleResponse:
    def test_handle_response_closed_file_raises_stopped(self, monkeypatch: pytest.MonkeyPatch):
        generator = WorkflowAppGenerator()

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        application_generate_entity = WorkflowAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=None,
            workflow_execution_id="run-id",
            call_depth=0,
        )

        class _Pipeline:
            def __init__(self, **kwargs) -> None:
                _ = kwargs

            def process(self):
                raise ValueError("I/O operation on closed file.")

        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowAppGenerateTaskPipeline",
            _Pipeline,
        )

        with pytest.raises(GenerateTaskStoppedError):
            generator._handle_response(
                application_generate_entity=application_generate_entity,
                workflow=SimpleNamespace(),
                queue_manager=SimpleNamespace(),
                user=SimpleNamespace(),
                draft_var_saver_factory=lambda **kwargs: None,
                stream=False,
            )


class TestWorkflowAppGeneratorGenerate:
    @pytest.mark.usefixtures("sqlite_generator_scoped_session")
    def test_generate_skips_prepare_inputs_when_flag_set(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
    ):
        generator = WorkflowAppGenerator()
        app = _persist_app(sqlite_session)
        workflow = _persist_workflow(sqlite_session)
        user = _persist_end_user(sqlite_session)

        app_config = WorkflowUIBasedAppConfig(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id=WORKFLOW_ID,
        )
        repository_session_makers: list[sessionmaker[Session]] = []

        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowAppConfigManager.get_app_config",
            lambda app_model, workflow: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.FileUploadConfigManager.convert",
            lambda features_dict, is_vision=False: None,
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.file_factory.build_from_mappings",
            lambda **kwargs: [],
        )
        DummyTraceQueueManager = type(
            "_DummyTraceQueueManager",
            (TraceQueueManager,),
            {
                "__init__": lambda self, app_id=None, user_id=None: (
                    setattr(self, "app_id", app_id) or setattr(self, "user_id", user_id)
                )
            },
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.TraceQueueManager",
            DummyTraceQueueManager,
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: repository_session_makers.append(kwargs["session_factory"]) or SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: repository_session_makers.append(kwargs["session_factory"]) or SimpleNamespace(),
        )

        prepare_inputs = pytest.fail
        monkeypatch.setattr(generator, "_prepare_user_inputs", lambda **kwargs: prepare_inputs())

        monkeypatch.setattr(generator, "_generate", lambda **kwargs: {"ok": True})

        result = generator.generate(
            app_model=app,
            workflow=workflow,
            user=user,
            args={"inputs": {}, SKIP_PREPARE_USER_INPUTS_KEY: True},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=False,
            call_depth=0,
        )

        assert result == {"ok": True}
        assert len(repository_session_makers) == 2
        assert all(factory.kw["bind"] is sqlite_session.get_bind() for factory in repository_session_makers)


class TestWorkflowAppGeneratorResume:
    def test_resume_restores_trace_manager_when_missing(self, monkeypatch: pytest.MonkeyPatch):
        generator = WorkflowAppGenerator()
        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        application_generate_entity = WorkflowAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=None,
            workflow_execution_id="run-id",
            call_depth=0,
        )
        DummyTraceQueueManager = type(
            "_DummyTraceQueueManager",
            (TraceQueueManager,),
            {
                "__init__": lambda self, app_id=None, user_id=None: (
                    setattr(self, "app_id", app_id) or setattr(self, "user_id", user_id)
                )
            },
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.TraceQueueManager",
            DummyTraceQueueManager,
        )
        captured_entity: WorkflowAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=SimpleNamespace(id="app-id"),
            workflow=SimpleNamespace(),
            user=SimpleNamespace(id="end-user-id", session_id="session-id"),
            application_generate_entity=application_generate_entity,
            graph_runtime_state=SimpleNamespace(),
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        trace_manager = captured_entity.trace_manager
        assert isinstance(trace_manager, DummyTraceQueueManager)
        assert trace_manager.app_id == "app-id"
        assert trace_manager.user_id == "session-id"

    def test_resume_preserves_existing_trace_manager(self, monkeypatch: pytest.MonkeyPatch):
        generator = WorkflowAppGenerator()
        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        existing_trace_manager = SimpleNamespace(app_id="existing-app", user_id="existing-user")
        application_generate_entity = WorkflowAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=existing_trace_manager,
            workflow_execution_id="run-id",
            call_depth=0,
        )
        captured_entity: WorkflowAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=SimpleNamespace(id="app-id"),
            workflow=SimpleNamespace(),
            user=SimpleNamespace(id="end-user-id", session_id="session-id"),
            application_generate_entity=application_generate_entity,
            graph_runtime_state=SimpleNamespace(),
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        assert captured_entity.trace_manager is existing_trace_manager


class TestWorkflowAppGeneratorWorker:
    def test_generate_worker_uses_end_user_session_for_external_invocation(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ):
        generator = WorkflowAppGenerator()
        _persist_app(sqlite_session)
        _persist_workflow(sqlite_session)
        _persist_end_user(sqlite_session)

        runner_kwargs = {}

        class _Runner:
            def __init__(self, **kwargs):
                runner_kwargs.update(kwargs)

            def run(self):
                return None

        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.preserve_flask_contexts",
            lambda flask_app, context_vars: contextlib.nullcontext(),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.session_factory.create_session",
            sqlite_session_factory,
        )
        monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppRunner", _Runner)
        restore_workflow_run_graph = Mock()
        monkeypatch.setattr(generator, "_restore_workflow_run_graph", restore_workflow_run_graph)

        app_config = WorkflowUIBasedAppConfig(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id=WORKFLOW_ID,
        )
        application_generate_entity = WorkflowAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            files=[],
            user_id=END_USER_ID,
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=None,
            workflow_execution_id="run-id",
            call_depth=0,
        )

        generator._generate_worker(
            flask_app=SimpleNamespace(),
            application_generate_entity=application_generate_entity,
            queue_manager=SimpleNamespace(),
            context=SimpleNamespace(),
            variable_loader=SimpleNamespace(),
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
        )

        assert runner_kwargs["system_user_id"] == "session-id"
        restore_workflow_run_graph.assert_called_once()
        restore_kwargs = restore_workflow_run_graph.call_args.kwargs
        assert isinstance(restore_kwargs["session"], Session)
        assert restore_kwargs["workflow"] is runner_kwargs["workflow"]
        assert restore_kwargs["workflow_run_id"] == "run-id"
        assert inspect(runner_kwargs["workflow"]).detached is True
