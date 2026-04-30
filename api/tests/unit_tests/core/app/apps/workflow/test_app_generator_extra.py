from __future__ import annotations

from types import SimpleNamespace

import pytest

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY, WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.ops.ops_trace_manager import TraceQueueManager
from models.model import AppMode


class TestWorkflowAppGeneratorValidation:
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
    def test_handle_response_closed_file_raises_stopped(self, monkeypatch):
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
    def test_generate_skips_prepare_inputs_when_flag_set(self, monkeypatch):
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
