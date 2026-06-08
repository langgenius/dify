from __future__ import annotations

import contextlib
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY, WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.ops.ops_trace_manager import TraceQueueManager
from models.model import AppMode


class TestWorkflowAppGeneratorValidation:
    def test_ensure_snippet_start_node_returns_original_for_non_snippet_workflow(self):
        workflow = SimpleNamespace(kind_or_standard="workflow")
        session = SimpleNamespace(scalar=Mock())

        result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(session=session, workflow=workflow)

        assert result is workflow
        session.scalar.assert_not_called()

    def test_ensure_snippet_start_node_returns_original_when_snippet_missing(self):
        workflow = SimpleNamespace(kind_or_standard="snippet", app_id="snippet-1", tenant_id="tenant-1")
        session = SimpleNamespace(scalar=Mock(return_value=None))

        result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(session=session, workflow=workflow)

        assert result is workflow
        session.scalar.assert_called_once()

    def test_ensure_snippet_start_node_delegates_when_snippet_exists(self, monkeypatch: pytest.MonkeyPatch):
        workflow = SimpleNamespace(kind_or_standard="snippet", app_id="snippet-1", tenant_id="tenant-1")
        snippet = SimpleNamespace(id="snippet-1")
        injected_workflow = SimpleNamespace(id="workflow-injected")
        session = SimpleNamespace(scalar=Mock(return_value=snippet))
        ensure_start_node = Mock(return_value=injected_workflow)
        monkeypatch.setattr(
            "services.snippet_generate_service.SnippetGenerateService.ensure_start_node_for_worker",
            ensure_start_node,
        )

        result = WorkflowAppGenerator._ensure_snippet_start_node_in_worker(session=session, workflow=workflow)

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
            )

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_iteration_generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                node_id="node",
                user=SimpleNamespace(),
                args={},
                streaming=False,
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
            )

    def test_single_iteration_generate_includes_trace_session_id_in_extras(self, monkeypatch: pytest.MonkeyPatch):
        generator = WorkflowAppGenerator()
        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        captured: dict[str, object] = {}

        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr("core.app.apps.workflow.app_generator.DraftVarLoader", lambda **kwargs: SimpleNamespace())
        monkeypatch.setattr("core.app.apps.workflow.app_generator.sessionmaker", lambda **kwargs: SimpleNamespace())
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.db",
            SimpleNamespace(engine=object(), session=lambda: SimpleNamespace()),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowDraftVariableService",
            lambda session: SimpleNamespace(prefill_conversation_variable_default_values=lambda *args, **kwargs: None),
        )
        monkeypatch.setattr(generator, "_generate", lambda **kwargs: captured.update(kwargs) or {"ok": True})

        generator.single_iteration_generate(
            app_model=SimpleNamespace(id="app", tenant_id="tenant"),
            workflow=SimpleNamespace(id="workflow-id"),
            node_id="node-1",
            user=SimpleNamespace(id="user-id"),
            args={"inputs": {"foo": "bar"}, "trace_session_id": "session-1"},
            streaming=False,
        )

        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"

    def test_single_loop_generate_includes_trace_session_id_in_extras(self, monkeypatch: pytest.MonkeyPatch):
        generator = WorkflowAppGenerator()
        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        captured: dict[str, object] = {}

        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr("core.app.apps.workflow.app_generator.DraftVarLoader", lambda **kwargs: SimpleNamespace())
        monkeypatch.setattr("core.app.apps.workflow.app_generator.sessionmaker", lambda **kwargs: SimpleNamespace())
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.db",
            SimpleNamespace(engine=object(), session=lambda: SimpleNamespace()),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowDraftVariableService",
            lambda session: SimpleNamespace(prefill_conversation_variable_default_values=lambda *args, **kwargs: None),
        )
        monkeypatch.setattr(generator, "_generate", lambda **kwargs: captured.update(kwargs) or {"ok": True})

        generator.single_loop_generate(
            app_model=SimpleNamespace(id="app", tenant_id="tenant"),
            workflow=SimpleNamespace(id="workflow-id"),
            node_id="node-2",
            user=SimpleNamespace(id="user-id"),
            args=SimpleNamespace(inputs={"foo": "bar"}, trace_session_id="session-1"),
            streaming=False,
        )

        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_loop_generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                node_id="node",
                user=SimpleNamespace(),
                args=SimpleNamespace(inputs=None),
                streaming=False,
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
    def test_generate_skips_prepare_inputs_when_flag_set(self, monkeypatch: pytest.MonkeyPatch):
        generator = WorkflowAppGenerator()

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )

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
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.db",
            SimpleNamespace(engine=object(), session=SimpleNamespace(close=lambda: None)),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.sessionmaker",
            lambda **kwargs: SimpleNamespace(),
        )

        prepare_inputs = pytest.fail
        monkeypatch.setattr(generator, "_prepare_user_inputs", lambda **kwargs: prepare_inputs())

        monkeypatch.setattr(generator, "_generate", lambda **kwargs: {"ok": True})

        result = generator.generate(
            app_model=SimpleNamespace(id="app", tenant_id="tenant"),
            workflow=SimpleNamespace(features_dict={}),
            user=SimpleNamespace(id="user", session_id="session"),
            args={"inputs": {}, SKIP_PREPARE_USER_INPUTS_KEY: True},
            invoke_from=InvokeFrom.WEB_APP,
            streaming=False,
            call_depth=0,
        )

        assert result == {"ok": True}


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
    def test_generate_worker_uses_end_user_session_for_external_invocation(self, monkeypatch: pytest.MonkeyPatch):
        generator = WorkflowAppGenerator()

        workflow = SimpleNamespace(
            id="workflow-id",
            tenant_id="tenant",
            app_id="app",
            graph_dict={},
            type="workflow",
            version="1",
        )
        end_user = SimpleNamespace(id="end-user-id", session_id="session-id")
        session = SimpleNamespace(scalar=Mock(side_effect=[workflow, end_user]))

        class _SessionContext:
            def __enter__(self):
                return session

            def __exit__(self, exc_type, exc, tb):
                return False

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
            lambda: _SessionContext(),
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.WorkflowAppGenerator._ensure_snippet_start_node_in_worker",
            lambda self, *, session, workflow: workflow,
        )
        monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppRunner", _Runner)

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
            user_id="end-user-id",
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
