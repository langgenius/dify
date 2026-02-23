from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from constants import UUID_NIL
from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.ops.ops_trace_manager import TraceQueueManager
from models.model import AppMode


class TestAdvancedChatAppGeneratorValidation:
    def test_generate_requires_query(self):
        generator = AdvancedChatAppGenerator()

        with pytest.raises(ValueError, match="query is required"):
            generator.generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                user=SimpleNamespace(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
                workflow_run_id="run-id",
                streaming=False,
            )

    def test_generate_requires_string_query(self):
        generator = AdvancedChatAppGenerator()

        with pytest.raises(ValueError, match="query must be a string"):
            generator.generate(
                app_model=SimpleNamespace(),
                workflow=SimpleNamespace(),
                user=SimpleNamespace(),
                args={"inputs": {}, "query": 123},
                invoke_from=InvokeFrom.WEB_APP,
                workflow_run_id="run-id",
                streaming=False,
            )

    def test_single_iteration_generate_validates_args(self):
        generator = AdvancedChatAppGenerator()

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
        generator = AdvancedChatAppGenerator()

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


class TestAdvancedChatAppGeneratorInternals:
    def test_handle_response_closed_file_raises_stopped(self, monkeypatch):
        generator = AdvancedChatAppGenerator()
        generator._dialogue_count = 1

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=None,
            workflow_run_id="run-id",
        )

        class _Pipeline:
            def __init__(self, **kwargs) -> None:
                _ = kwargs

            def process(self):
                raise ValueError("I/O operation on closed file.")

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppGenerateTaskPipeline",
            _Pipeline,
        )

        with pytest.raises(GenerateTaskStoppedError):
            generator._handle_advanced_chat_response(
                application_generate_entity=application_generate_entity,
                workflow=SimpleNamespace(),
                queue_manager=SimpleNamespace(),
                conversation=SimpleNamespace(id="conv", mode=AppMode.ADVANCED_CHAT),
                message=SimpleNamespace(id="msg"),
                user=SimpleNamespace(),
                draft_var_saver_factory=lambda **kwargs: None,
                stream=False,
            )

    def test_generate_worker_handles_invoke_auth_error(self, monkeypatch):
        generator = AdvancedChatAppGenerator()
        generator._dialogue_count = 1

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="end-user-id",
            stream=False,
            invoke_from=InvokeFrom.SERVICE_API,
            extras={},
            trace_manager=None,
            workflow_run_id="run-id",
        )

        queue_manager = MagicMock()

        generator._get_conversation = MagicMock(return_value=SimpleNamespace(id="conv", mode=AppMode.ADVANCED_CHAT))
        generator._get_message = MagicMock(return_value=SimpleNamespace(id="msg"))

        class _Runner:
            def __init__(self, **kwargs) -> None:
                _ = kwargs

            def run(self):
                from core.model_runtime.errors.invoke import InvokeAuthorizationError

                raise InvokeAuthorizationError("bad key")

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner", _Runner)

        @contextmanager
        def _fake_context(*args, **kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        class _Session:
            def __init__(self, *args, **kwargs):
                self.scalar = MagicMock(
                    side_effect=[
                        SimpleNamespace(id="workflow-id", tenant_id="tenant", app_id="app"),
                        SimpleNamespace(id="end-user-id", session_id="session-id"),
                        SimpleNamespace(id="app"),
                    ]
                )

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.Session", _Session)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=object(), session=SimpleNamespace(close=lambda: None)),
        )

        generator._generate_worker(
            flask_app=SimpleNamespace(),
            application_generate_entity=application_generate_entity,
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
            context=SimpleNamespace(),
            variable_loader=SimpleNamespace(),
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_engine_layers=(),
            graph_runtime_state=None,
        )

        assert queue_manager.publish_error.called

    def test_generate_debugger_enables_retrieve_source(self, monkeypatch):
        generator = AdvancedChatAppGenerator()

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppConfigManager.get_app_config",
            lambda app_model, workflow: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.FileUploadConfigManager.convert",
            lambda features_dict, is_vision=False: None,
        )
        DummyTraceQueueManager = type(
            "_DummyTraceQueueManager",
            (TraceQueueManager,),
            {
                "__init__": lambda self, app_id=None, user_id=None: setattr(self, "app_id", app_id)
                or setattr(self, "user_id", user_id)
            },
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.TraceQueueManager",
            DummyTraceQueueManager,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=object(), session=SimpleNamespace(close=lambda: None)),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.sessionmaker",
            lambda **kwargs: SimpleNamespace(),
        )

        captured = {}

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        app_model = SimpleNamespace(id="app", tenant_id="tenant")
        workflow = SimpleNamespace(features_dict={})
        from models import Account

        user = Account(name="Tester", email="tester@example.com")
        user.id = "user"

        result = generator.generate(
            app_model=app_model,
            workflow=workflow,
            user=user,
            args={"query": "hello\x00", "inputs": {}},
            invoke_from=InvokeFrom.DEBUGGER,
            workflow_run_id="run-id",
            streaming=False,
        )

        assert result == {"ok": True}
        assert app_config.additional_features.show_retrieve_source is True
        assert captured["application_generate_entity"].query == "hello"

    def test_generate_service_api_sets_parent_message_id(self, monkeypatch):
        generator = AdvancedChatAppGenerator()

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppConfigManager.get_app_config",
            lambda app_model, workflow: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.FileUploadConfigManager.convert",
            lambda features_dict, is_vision=False: None,
        )
        DummyTraceQueueManager = type(
            "_DummyTraceQueueManager",
            (TraceQueueManager,),
            {
                "__init__": lambda self, app_id=None, user_id=None: setattr(self, "app_id", app_id)
                or setattr(self, "user_id", user_id)
            },
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.TraceQueueManager",
            DummyTraceQueueManager,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=object(), session=SimpleNamespace(close=lambda: None)),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.sessionmaker",
            lambda **kwargs: SimpleNamespace(),
        )

        captured = {}

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        app_model = SimpleNamespace(id="app", tenant_id="tenant")
        workflow = SimpleNamespace(features_dict={})
        from models.model import EndUser

        user = EndUser(tenant_id="tenant", type="session", name="tester", session_id="session")
        user.id = "end-user"

        generator.generate(
            app_model=app_model,
            workflow=workflow,
            user=user,
            args={"query": "hello", "inputs": {}, "parent_message_id": "p1"},
            invoke_from=InvokeFrom.SERVICE_API,
            workflow_run_id="run-id",
            streaming=False,
        )

        assert captured["application_generate_entity"].parent_message_id == UUID_NIL
