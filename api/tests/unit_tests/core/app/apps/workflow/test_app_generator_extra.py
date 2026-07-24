from __future__ import annotations

import contextlib
import json
from collections.abc import Iterator
from dataclasses import dataclass
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import Engine, inspect
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.workflow import app_generator as app_generator_module
from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY, WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.ops.ops_trace_manager import TraceQueueManager
from models.base import TypeBase
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


@dataclass(frozen=True)
class SqliteGeneratorDb:
    engine: Engine
    session_maker: sessionmaker[Session]
    caller_session: Session
    scoped_session: scoped_session[Session]


@pytest.fixture
def sqlite_generator_db(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> Iterator[SqliteGeneratorDb]:
    """Bind request- and service-owned generator sessions to an isolated SQLite engine."""
    models = (CustomizedSnippet, Workflow, EndUser, App)
    TypeBase.metadata.create_all(sqlite_engine, tables=[model.__table__ for model in models])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    request_sessions = scoped_session(session_maker)
    monkeypatch.setattr(
        app_generator_module,
        "db",
        SimpleNamespace(engine=sqlite_engine, session=request_sessions),
    )
    with session_maker() as caller_session:
        yield SqliteGeneratorDb(
            engine=sqlite_engine,
            session_maker=session_maker,
            caller_session=caller_session,
            scoped_session=request_sessions,
        )
    request_sessions.remove()


def _persist_app(db: SqliteGeneratorDb) -> App:
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
    db.caller_session.add(app)
    db.caller_session.commit()
    return app


def _persist_workflow(
    db: SqliteGeneratorDb,
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
    db.caller_session.add(workflow)
    db.caller_session.commit()
    return workflow


def _persist_end_user(db: SqliteGeneratorDb) -> EndUser:
    end_user = EndUser(
        id=END_USER_ID,
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=EndUserType.BROWSER,
        name="End user",
        session_id="session-id",
    )
    db.caller_session.add(end_user)
    db.caller_session.commit()
    return end_user


def _persist_snippet(
    db: SqliteGeneratorDb,
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
    db.caller_session.add(snippet)
    db.caller_session.commit()
    return snippet


class TestWorkflowAppGeneratorValidation:
    def test_ensure_snippet_start_node_returns_original_for_non_snippet_workflow(
        self,
        sqlite_generator_db: SqliteGeneratorDb,
    ):
        workflow = _persist_workflow(sqlite_generator_db)

        result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(
            session=sqlite_generator_db.caller_session,
            workflow=workflow,
        )

        assert result is workflow

    def test_ensure_snippet_start_node_returns_original_when_snippet_is_from_another_tenant(
        self,
        sqlite_generator_db: SqliteGeneratorDb,
    ):
        workflow = _persist_workflow(sqlite_generator_db, kind=WorkflowKind.SNIPPET)
        _persist_snippet(sqlite_generator_db, snippet_id=APP_ID, tenant_id=OTHER_TENANT_ID)

        result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(
            session=sqlite_generator_db.caller_session,
            workflow=workflow,
        )

        assert result is workflow

    def test_ensure_snippet_start_node_delegates_when_snippet_exists(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_generator_db: SqliteGeneratorDb,
    ):
        workflow = _persist_workflow(sqlite_generator_db, kind=WorkflowKind.SNIPPET)
        snippet = _persist_snippet(sqlite_generator_db, snippet_id=APP_ID)
        injected_workflow = SimpleNamespace(id="workflow-injected")
        ensure_start_node = Mock(return_value=injected_workflow)
        monkeypatch.setattr(
            "services.snippet_generate_service.SnippetGenerateService.ensure_start_node_for_worker",
            ensure_start_node,
        )

        result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(
            session=sqlite_generator_db.caller_session,
            workflow=workflow,
        )

        assert result is injected_workflow
        ensure_start_node.assert_called_once_with(workflow, snippet)

    def test_should_prepare_user_inputs(self):
        generator = WorkflowAppGenerator()

        assert generator._should_prepare_user_inputs({}) is True
        assert generator._should_prepare_user_inputs({SKIP_PREPARE_USER_INPUTS_KEY: True}) is False

    def test_single_iteration_generate_validates_args(self):
        generator = WorkflowAppGenerator()

        with pytest.raises(ValueError, match="node_id is required"):
            generator.single_iteration_generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                node_id="",
                user=SimpleNamespace(),
                args={"inputs": {}},
                streaming=False,
                session=Mock(),
            )

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_iteration_generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                node_id="node",
                user=SimpleNamespace(),
                args={},
                streaming=False,
                session=Mock(),
            )

    def test_single_loop_generate_validates_args(self):
        generator = WorkflowAppGenerator()

        with pytest.raises(ValueError, match="node_id is required"):
            generator.single_loop_generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                node_id="",
                user=SimpleNamespace(),
                args=SimpleNamespace(inputs={}),
                streaming=False,
                session=Mock(),
            )

    def test_single_iteration_generate_includes_trace_session_id_in_extras(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_generator_db: SqliteGeneratorDb,
    ):
        generator = WorkflowAppGenerator()
        app = _persist_app(sqlite_generator_db)
        workflow = _persist_workflow(sqlite_generator_db)
        user = _persist_end_user(sqlite_generator_db)
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
            session=sqlite_generator_db.caller_session,
        )

        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"
        assert len(repository_session_makers) == 2
        assert all(factory.kw["bind"] is sqlite_generator_db.engine for factory in repository_session_makers)
        assert len(draft_sessions) == 1
        assert draft_sessions[0] is sqlite_generator_db.caller_session

    def test_single_loop_generate_includes_trace_session_id_in_extras(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_generator_db: SqliteGeneratorDb,
    ):
        generator = WorkflowAppGenerator()
        app = _persist_app(sqlite_generator_db)
        workflow = _persist_workflow(sqlite_generator_db)
        user = _persist_end_user(sqlite_generator_db)
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
            session=sqlite_generator_db.caller_session,
        )

        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"
        assert len(repository_session_makers) == 2
        assert all(factory.kw["bind"] is sqlite_generator_db.engine for factory in repository_session_makers)
        assert len(draft_sessions) == 1
        assert draft_sessions[0] is sqlite_generator_db.caller_session

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_loop_generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                node_id="node",
                user=SimpleNamespace(),
                args=SimpleNamespace(inputs=None),
                streaming=False,
                session=Mock(),
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
    def test_generate_skips_prepare_inputs_when_flag_set(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_generator_db: SqliteGeneratorDb,
    ):
        generator = WorkflowAppGenerator()
        app = _persist_app(sqlite_generator_db)
        workflow = _persist_workflow(sqlite_generator_db)
        user = _persist_end_user(sqlite_generator_db)

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
        assert all(factory.kw["bind"] is sqlite_generator_db.engine for factory in repository_session_makers)


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
        sqlite_generator_db: SqliteGeneratorDb,
    ):
        generator = WorkflowAppGenerator()
        _persist_app(sqlite_generator_db)
        _persist_workflow(sqlite_generator_db)
        _persist_end_user(sqlite_generator_db)

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
            sqlite_generator_db.session_maker,
        )
        monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppRunner", _Runner)

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
        )

        assert runner_kwargs["system_user_id"] == "session-id"
        assert inspect(runner_kwargs["workflow"]).detached is True
