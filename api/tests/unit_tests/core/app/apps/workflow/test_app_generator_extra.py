from __future__ import annotations

import contextlib
import json
from types import SimpleNamespace
from unittest.mock import Mock, create_autospec

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.ops.ops_trace_manager import OpsTraceManager, TraceQueueManager
from graphon.variable_loader import VariableLoader
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from models.snippet import CustomizedSnippet
from models.workflow import Workflow, WorkflowKind, WorkflowType
from repositories.agent.runtime_repository import WorkflowAgentBindingResolver
from services.workflow.execution.adapters.workflow.app_generator import WorkflowAppGenerator
from services.workflow.execution.ports import WorkflowRuntime


@pytest.fixture(autouse=True)
def disable_trace_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
    """Construct real trace managers without provider lookup or background delivery."""
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", lambda app_id: None)
    monkeypatch.setattr(TraceQueueManager, "start_timer", lambda self: None)
    monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)


TENANT_ID = "00000000-0000-0000-0000-000000000001"
OTHER_TENANT_ID = "00000000-0000-0000-0000-000000000002"
APP_ID = "00000000-0000-0000-0000-000000000003"
WORKFLOW_ID = "00000000-0000-0000-0000-000000000004"
END_USER_ID = "00000000-0000-0000-0000-000000000005"
CREATOR_ID = "00000000-0000-0000-0000-000000000006"


def _app() -> App:
    return App(
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


def _persist_app(session: Session) -> App:
    app = _app()
    session.add(app)
    session.commit()
    return app


def _workflow(
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
    return workflow


def _persist_workflow(
    session: Session,
    *,
    workflow_id: str = WORKFLOW_ID,
    app_id: str = APP_ID,
    tenant_id: str = TENANT_ID,
    kind: WorkflowKind = WorkflowKind.STANDARD,
) -> Workflow:
    workflow = _workflow(
        workflow_id=workflow_id,
        app_id=app_id,
        tenant_id=tenant_id,
        kind=kind,
    )
    session.add(workflow)
    session.commit()
    return workflow


def _end_user() -> EndUser:
    return EndUser(
        id=END_USER_ID,
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=EndUserType.BROWSER,
        name="End user",
        session_id="session-id",
    )


def _persist_end_user(session: Session) -> EndUser:
    end_user = _end_user()
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
    def test_generate_stream_joins_worker_after_response_exhaustion(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        *,
        workflow_runtime: WorkflowRuntime,
    ):
        generator = WorkflowAppGenerator(runtime=workflow_runtime)
        app = _persist_app(sqlite_session)
        workflow = _persist_workflow(sqlite_session)
        user = _persist_end_user(sqlite_session)
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
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppQueueManager",
            lambda **kwargs: SimpleNamespace(**kwargs),
        )
        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.current_app",
            SimpleNamespace(_get_current_object=lambda: SimpleNamespace(name="flask")),
        )
        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.contextvars.copy_context", lambda: "ctx"
        )
        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.threading.Thread",
            lambda **kwargs: worker_thread,
        )
        monkeypatch.setattr(generator, "_get_draft_var_saver_factory", lambda *args, **kwargs: "draft-factory")
        monkeypatch.setattr(generator, "_handle_response", lambda **kwargs: response_stream())
        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerateResponseConverter.convert",
            lambda response, invoke_from: response,
        )

        managed_stream = generator._generate(
            app_model=app,
            workflow=workflow,
            user=user,
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

    def test_single_iteration_generate_validates_args(self, *, workflow_runtime: WorkflowRuntime):
        generator = WorkflowAppGenerator(runtime=workflow_runtime)

        with pytest.raises(ValueError, match="node_id is required"):
            generator.single_iteration_generate(
                app_model=_app(),
                workflow=_workflow(),
                node_id="",
                user=_end_user(),
                args={"inputs": {}},
                streaming=False,
            )

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_iteration_generate(
                app_model=_app(),
                workflow=_workflow(),
                node_id="node",
                user=_end_user(),
                args={},
                streaming=False,
            )

    def test_single_loop_generate_validates_args(self, *, workflow_runtime: WorkflowRuntime):
        generator = WorkflowAppGenerator(runtime=workflow_runtime)

        with pytest.raises(ValueError, match="node_id is required"):
            generator.single_loop_generate(
                app_model=_app(),
                workflow=_workflow(),
                node_id="",
                user=_end_user(),
                args={"inputs": {}},
                streaming=False,
            )

    def test_single_iteration_generate_includes_trace_session_id_in_extras(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        *,
        workflow_runtime: WorkflowRuntime,
    ):
        loader = create_autospec(VariableLoader, instance=True)
        loader_factory = Mock(return_value=loader)
        generator = WorkflowAppGenerator(draft_variable_loader=loader_factory, runtime=workflow_runtime)
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

        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(generator, "_generate", lambda **kwargs: captured.update(kwargs) or {"ok": True})

        generator.single_iteration_generate(
            app_model=app,
            workflow=workflow,
            node_id="node-1",
            user=user,
            args={"inputs": {"foo": "bar"}, "trace_session_id": "session-1"},
            streaming=False,
        )

        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"
        assert generator._runtime is workflow_runtime

        loader_factory.assert_called_once_with(workflow, user.id)
        assert captured["variable_loader"] is loader

    def test_single_loop_generate_includes_trace_session_id_in_extras(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        *,
        workflow_runtime: WorkflowRuntime,
    ):
        loader = create_autospec(VariableLoader, instance=True)
        loader_factory = Mock(return_value=loader)
        generator = WorkflowAppGenerator(draft_variable_loader=loader_factory, runtime=workflow_runtime)
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

        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(generator, "_generate", lambda **kwargs: captured.update(kwargs) or {"ok": True})

        generator.single_loop_generate(
            app_model=app,
            workflow=workflow,
            node_id="node-2",
            user=user,
            args={"inputs": {"foo": "bar"}, "trace_session_id": "session-1"},
            streaming=False,
        )

        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"
        assert generator._runtime is workflow_runtime

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_loop_generate(
                app_model=_app(),
                workflow=_workflow(),
                node_id="node",
                user=_end_user(),
                args={"inputs": None},
                streaming=False,
            )

        loader_factory.assert_called_once_with(workflow, user.id)
        assert captured["variable_loader"] is loader


class TestWorkflowAppGeneratorHandleResponse:
    def test_handle_response_closed_file_raises_stopped(
        self, monkeypatch: pytest.MonkeyPatch, *, workflow_runtime: WorkflowRuntime
    ):
        generator = WorkflowAppGenerator(runtime=workflow_runtime)

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
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerateTaskPipeline",
            _Pipeline,
        )

        with pytest.raises(GenerateTaskStoppedError):
            generator._handle_response(
                application_generate_entity=application_generate_entity,
                workflow=_workflow(),
                queue_manager=SimpleNamespace(),
                user=_end_user(),
                draft_var_saver_factory=lambda **kwargs: None,
                stream=False,
            )


class TestWorkflowAppGeneratorGenerate:
    @pytest.fixture
    def generation(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        *,
        workflow_runtime: WorkflowRuntime,
    ):
        """Keep input preparation real and stop at the execution boundary."""
        generator = WorkflowAppGenerator(runtime=workflow_runtime)
        app = _persist_app(sqlite_session)
        workflow = _persist_workflow(sqlite_session)
        user = _persist_end_user(sqlite_session)
        execute = Mock(return_value={"ok": True})
        monkeypatch.setattr(generator, "_generate", execute)
        return generator, app, workflow, user, execute

    @pytest.mark.parametrize("node_type", ["trigger-webhook", "trigger-schedule", "trigger-plugin"])
    @pytest.mark.parametrize("root_node_id", [None, "selected-trigger"])
    @pytest.mark.parametrize("invoke_from", [InvokeFrom.SERVICE_API, InvokeFrom.DEBUGGER])
    def test_generate_preserves_trigger_inputs(self, generation, node_type, root_node_id, invoke_from):
        generator, app, workflow, user, execute = generation
        workflow.graph = json.dumps(
            {
                "nodes": [
                    {"id": "first-trigger", "data": {"type": node_type, "title": "First trigger"}},
                    {"id": "selected-trigger", "data": {"type": node_type, "title": "Selected trigger"}},
                ],
                "edges": [],
            }
        )
        inputs = {"event": {"message": "hello", "items": [1, 2]}, "enabled": False}

        result = generator.generate(
            app_model=app,
            workflow=workflow,
            user=user,
            args={"inputs": inputs},
            invoke_from=invoke_from,
            streaming=False,
            root_node_id=root_node_id,
        )

        assert result == {"ok": True}
        assert execute.call_args.kwargs["application_generate_entity"].inputs == inputs
        assert execute.call_args.kwargs["root_node_id"] == (root_node_id or "first-trigger")

    @pytest.mark.parametrize("root_node_id", [None, "start"])
    def test_generate_prepares_start_inputs(self, generation, root_node_id):
        generator, app, workflow, user, execute = generation
        workflow.graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": "start",
                        "data": {
                            "type": "start",
                            "title": "Start",
                            "variables": [
                                {"variable": "question", "label": "Question", "type": "text-input", "required": True},
                                {"variable": "count", "label": "Count", "type": "number", "default": "3"},
                            ],
                        },
                    }
                ],
                "edges": [],
            }
        )

        generator.generate(
            app_model=app,
            workflow=workflow,
            user=user,
            args={"inputs": {"question": "hello", "unknown": "filtered"}},
            invoke_from=InvokeFrom.SERVICE_API,
            streaming=False,
            root_node_id=root_node_id,
        )

        assert execute.call_args.kwargs["application_generate_entity"].inputs == {"question": "hello", "count": 3}
        assert execute.call_args.kwargs["root_node_id"] == "start"

        execute.reset_mock()
        with pytest.raises(ValueError, match="question is required in input form"):
            generator.generate(
                app_model=app,
                workflow=workflow,
                user=user,
                args={"inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
                root_node_id=root_node_id,
            )
        execute.assert_not_called()


class TestWorkflowAppGeneratorResume:
    def test_resume_restores_trace_manager_when_missing(
        self, monkeypatch: pytest.MonkeyPatch, *, workflow_runtime: WorkflowRuntime
    ):
        generator = WorkflowAppGenerator(runtime=workflow_runtime)
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
            "services.workflow.execution.adapters.workflow.app_generator.TraceQueueManager",
            DummyTraceQueueManager,
        )
        captured_entity: WorkflowAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=_app(),
            workflow=_workflow(),
            user=_end_user(),
            application_generate_entity=application_generate_entity,
            graph_runtime_state=SimpleNamespace(),
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        trace_manager = captured_entity.trace_manager
        assert isinstance(trace_manager, DummyTraceQueueManager)
        assert trace_manager.app_id == APP_ID
        assert trace_manager.user_id == "session-id"

    def test_resume_preserves_existing_trace_manager(
        self, monkeypatch: pytest.MonkeyPatch, *, workflow_runtime: WorkflowRuntime
    ):
        generator = WorkflowAppGenerator(runtime=workflow_runtime)
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
            app_model=_app(),
            workflow=_workflow(),
            user=_end_user(),
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
        *,
        workflow_runtime: WorkflowRuntime,
    ):
        resolver = WorkflowAgentBindingResolver(sessionmaker(bind=sqlite_session.get_bind()))
        generator = WorkflowAppGenerator(runtime=workflow_runtime)
        _persist_app(sqlite_session)
        workflow = _persist_workflow(sqlite_session)
        _persist_end_user(sqlite_session)
        sqlite_session.expunge(workflow)

        runner_kwargs = {}

        class _Runner:
            def __init__(self, **kwargs):
                runner_kwargs.update(kwargs)

            def run(self):
                return None

        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.preserve_flask_contexts",
            lambda flask_app, context_vars: contextlib.nullcontext(),
        )
        monkeypatch.setattr("services.workflow.execution.adapters.workflow.app_generator.WorkflowAppRunner", _Runner)
        restore_workflow_run_graph = Mock()
        monkeypatch.setattr(generator._runtime.contexts, "restore_graph", restore_workflow_run_graph)

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
            system_user_id="session-id",
            workflow=workflow,
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
        assert runner_kwargs["runtime"] is workflow_runtime
        assert runner_kwargs["workflow"] is workflow
        restore_workflow_run_graph.assert_called_once()
        restore_workflow_run_graph.assert_called_once_with(workflow, "run-id")
        assert inspect(runner_kwargs["workflow"]).detached is True
