from __future__ import annotations

import contextlib
import contextvars
import json
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, create_autospec

import pytest
from flask import Flask
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueWorkflowSucceededEvent
from core.app.layers.pause_state_persist_layer import PauseStateLayerConfig
from core.ops.ops_trace_manager import OpsTraceManager, TraceQueueManager
from core.repositories import SQLAlchemyWorkflowExecutionRepository, SQLAlchemyWorkflowNodeExecutionRepository
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime import RuntimeState, VariablePool
from graphon.variable_loader import DUMMY_VARIABLE_LOADER, VariableLoader
from models.enums import CreatorUserRole, EndUserType, WorkflowRunTriggeredFrom
from models.model import App, AppMode, EndUser
from models.workflow import Workflow, WorkflowKind, WorkflowNodeExecutionTriggeredFrom, WorkflowRun, WorkflowType
from repositories.workflow.definition_repository import workflow_snapshot
from services.workflow.execution.adapters.workflow.app_generator import WorkflowAppGenerator
from services.workflow.execution.adapters.workflow.app_queue_manager import WorkflowAppQueueManager
from services.workflow.execution.ports import WorkflowRuntime
from tests.helpers.unit.model_factories import make_workflow

"""SQLite-backed tests for workflow app generation and worker reload behavior."""


def _generator(runtime: WorkflowRuntime | None = None) -> WorkflowAppGenerator:
    runtime = runtime or MagicMock()
    return WorkflowAppGenerator(runtime=runtime, execution_driver=runtime.execution_driver)


def _workflow_app_generator_workflow(
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
    workflow = _workflow_app_generator_workflow()
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


class TestWorkflowAppGeneratorCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def disable_trace_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
        """Construct real trace managers without provider lookup or background delivery."""
        monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", lambda app_id: None)
        monkeypatch.setattr(TraceQueueManager, "start_timer", lambda self: None)
        monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)

    @staticmethod
    def test_worker_executes_and_persists_a_workflow_through_the_injected_driver(
        app: Flask,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        *,
        workflow_runtime: WorkflowRuntime,
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

        _generator(workflow_runtime)._generate_worker(
            flask_app=app,
            system_user_id=end_user.session_id or "",
            workflow=workflow_snapshot(workflow),
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

    @staticmethod
    def test_generate_includes_parent_trace_context_in_extras(
        monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, *, workflow_runtime: WorkflowRuntime
    ) -> None:
        generator = _generator(workflow_runtime)
        app, workflow, end_user = _persist_generator_rows(sqlite_session)

        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator._bind_file_access_scope",
            lambda *args, **kwargs: contextlib.nullcontext(),
        )
        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppConfigManager.get_app_config",
            lambda *args, **kwargs: _app_config(app, workflow),
        )
        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.file_factory.build_from_mappings",
            lambda *args, **kwargs: [],
        )
        repository_tenant_ids: dict[str, str] = {}
        workflow_execution_factory = workflow_runtime.execution_writer
        workflow_node_execution_factory = workflow_runtime.node_writer

        def create_workflow_execution_repository(**kwargs):
            repository_tenant_ids["workflow"] = kwargs["tenant_id"]
            return workflow_execution_factory(**kwargs)

        def create_workflow_node_execution_repository(**kwargs):
            repository_tenant_ids["node"] = kwargs["tenant_id"]
            return workflow_node_execution_factory(**kwargs)

        generator._runtime = replace(
            workflow_runtime,
            execution_writer=create_workflow_execution_repository,
            node_writer=create_workflow_node_execution_repository,
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

    @staticmethod
    def test_resume_delegates_to_generate(
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        *,
        workflow_runtime: WorkflowRuntime,
    ) -> None:
        generator = _generator(workflow_runtime)
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
            workflow=workflow_snapshot(workflow),
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

    @staticmethod
    def test_generate_forwards_pause_configuration_and_state(
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        *,
        workflow_runtime: WorkflowRuntime,
    ) -> None:
        generator = _generator(workflow_runtime)
        app, workflow, end_user = _persist_generator_rows(sqlite_session)

        queue_manager = MagicMock()
        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppQueueManager",
            MagicMock(return_value=queue_manager),
        )

        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerateResponseConverter.convert",
            MagicMock(return_value="converted"),
        )
        monkeypatch.setattr(WorkflowAppGenerator, "_handle_response", MagicMock(return_value="response"))

        draft_factory_tenant_ids: list[str] = []
        get_draft_var_saver_factory = generator._get_draft_var_saver_factory

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

        monkeypatch.setattr("services.workflow.execution.adapters.workflow.app_generator.threading.Thread", DummyThread)

        application_generate_entity = _generate_entity(app, workflow, end_user)
        graph_runtime_state = _runtime_state()
        workflow_execution_repository, workflow_node_execution_repository = _repositories(
            sqlite_session_factory, app, end_user
        )

        flask_app = Flask(__name__)
        with flask_app.app_context():
            result = generator._generate(
                app_model=app,
                workflow=workflow_snapshot(workflow),
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

    @staticmethod
    def test_resume_path_runs_worker_with_runtime_state(
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        *,
        workflow_runtime: WorkflowRuntime,
    ) -> None:
        generator = _generator(workflow_runtime)
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
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppQueueManager",
            MagicMock(return_value=queue_manager),
        )

        monkeypatch.setattr(generator, "_handle_response", MagicMock(return_value="raw-response"))
        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerateResponseConverter.convert",
            MagicMock(side_effect=lambda response, invoke_from: response),
        )

        runner_instance = MagicMock()
        runner_instance.prepare.return_value = None

        def runner_ctor(**kwargs):
            assert kwargs["graph_runtime_state"] is runtime_state
            assert kwargs["workflow"].id == workflow.id
            assert kwargs["system_user_id"] == end_user.session_id
            assert kwargs["queue_manager"] is queue_manager
            return runner_instance

        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppRunner",
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

        monkeypatch.setattr(
            "services.workflow.execution.adapters.workflow.app_generator.threading.Thread", ImmediateThread
        )

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
            workflow=workflow_snapshot(workflow),
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


TENANT_ID = "00000000-0000-0000-0000-000000000001"
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


def _app_generator_extra_workflow(
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
    workflow = _app_generator_extra_workflow(
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


class TestAppGeneratorExtraCases:
    @staticmethod
    @pytest.fixture(autouse=True)
    def disable_trace_delivery(monkeypatch: pytest.MonkeyPatch) -> None:
        """Construct real trace managers without provider lookup or background delivery."""
        monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", lambda app_id: None)
        monkeypatch.setattr(TraceQueueManager, "start_timer", lambda self: None)
        monkeypatch.setattr("core.telemetry.gateway.is_enterprise_telemetry_enabled", lambda: False)

    class TestWorkflowAppGeneratorValidation:
        def test_generate_stream_joins_worker_after_response_exhaustion(
            self,
            monkeypatch: pytest.MonkeyPatch,
            sqlite_session: Session,
            *,
            workflow_runtime: WorkflowRuntime,
        ):
            generator = _generator(workflow_runtime)
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
            generator = _generator(workflow_runtime)

            with pytest.raises(ValueError, match="node_id is required"):
                generator.single_iteration_generate(
                    app_model=_app(),
                    workflow=_app_generator_extra_workflow(),
                    node_id="",
                    user=_end_user(),
                    args={"inputs": {}},
                    streaming=False,
                )

            with pytest.raises(ValueError, match="inputs is required"):
                generator.single_iteration_generate(
                    app_model=_app(),
                    workflow=_app_generator_extra_workflow(),
                    node_id="node",
                    user=_end_user(),
                    args={},
                    streaming=False,
                )

        def test_single_loop_generate_validates_args(self, *, workflow_runtime: WorkflowRuntime):
            generator = _generator(workflow_runtime)

            with pytest.raises(ValueError, match="node_id is required"):
                generator.single_loop_generate(
                    app_model=_app(),
                    workflow=_app_generator_extra_workflow(),
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
            generator = WorkflowAppGenerator(
                draft_variable_loader=loader_factory,
                runtime=workflow_runtime,
                execution_driver=workflow_runtime.execution_driver,
            )
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
            generator = WorkflowAppGenerator(
                draft_variable_loader=loader_factory,
                runtime=workflow_runtime,
                execution_driver=workflow_runtime.execution_driver,
            )
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
                    workflow=_app_generator_extra_workflow(),
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
            generator = _generator(workflow_runtime)

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
                    workflow=_app_generator_extra_workflow(),
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
            generator = _generator(workflow_runtime)
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
                                    {
                                        "variable": "question",
                                        "label": "Question",
                                        "type": "text-input",
                                        "required": True,
                                    },
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
            generator = _generator(workflow_runtime)
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
            dummy_trace_queue_manager = type(
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
                dummy_trace_queue_manager,
            )
            captured_entity: WorkflowAppGenerateEntity | None = None

            def _fake_generate(**kwargs):
                nonlocal captured_entity
                captured_entity = kwargs["application_generate_entity"]
                return SimpleNamespace(ok=True)

            monkeypatch.setattr(generator, "_generate", _fake_generate)

            result = generator.resume(
                app_model=_app(),
                workflow=_app_generator_extra_workflow(),
                user=_end_user(),
                application_generate_entity=application_generate_entity,
                graph_runtime_state=SimpleNamespace(),
                workflow_execution_repository=SimpleNamespace(),
                workflow_node_execution_repository=SimpleNamespace(),
            )

            assert result.ok is True
            assert captured_entity is not None
            trace_manager = captured_entity.trace_manager
            assert isinstance(trace_manager, dummy_trace_queue_manager)
            assert trace_manager.app_id == APP_ID
            assert trace_manager.user_id == "session-id"

        def test_resume_preserves_existing_trace_manager(
            self, monkeypatch: pytest.MonkeyPatch, *, workflow_runtime: WorkflowRuntime
        ):
            generator = _generator(workflow_runtime)
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
                workflow=_app_generator_extra_workflow(),
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
            generator = _generator(workflow_runtime)
            _persist_app(sqlite_session)
            workflow = _persist_workflow(sqlite_session)
            _persist_end_user(sqlite_session)
            sqlite_session.expunge(workflow)

            runner_kwargs = {}

            class _Runner:
                def __init__(self, **kwargs):
                    runner_kwargs.update(kwargs)

                def prepare(self):
                    return None

            monkeypatch.setattr(
                "services.workflow.execution.adapters.workflow.app_generator.preserve_flask_contexts",
                lambda flask_app, context_vars: contextlib.nullcontext(),
            )
            monkeypatch.setattr(
                "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppRunner", _Runner
            )
            restore_workflow_run_graph = Mock(side_effect=lambda workflow, _run_id: workflow)
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
                workflow=workflow_snapshot(workflow),
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
            assert "execution_driver" not in runner_kwargs
            restore_workflow_run_graph.assert_called_once()
            restore_workflow_run_graph.assert_called_once_with(runner_kwargs["workflow"], "run-id")
