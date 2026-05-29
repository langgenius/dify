from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel, ValidationError

from constants import UUID_NIL
from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.apps.advanced_chat.generate_task_pipeline import (
    ConversationSnapshot,
    MessageSnapshot,
    WorkflowSnapshot,
)
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.ops.ops_trace_manager import TraceQueueManager
from libs.datetime_utils import naive_utc_now
from models.enums import MessageStatus
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
    @staticmethod
    def _build_app_config() -> WorkflowUIBasedAppConfig:
        return WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )

    def test_generate_loads_conversation_and_files(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        app_config = self._build_app_config()

        conversation = SimpleNamespace(id="conversation-id")
        built_files: list[object] = []
        build_files_called = {"called": False}
        captured: dict[str, object] = {}

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.ConversationService.get_conversation",
            lambda **kwargs: conversation,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.FileUploadConfigManager.convert",
            lambda *args, **kwargs: {"enabled": True},
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.file_factory.build_from_mappings",
            lambda **kwargs: build_files_called.update({"called": True}) or built_files,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
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
            "core.app.apps.advanced_chat.app_generator.sessionmaker", lambda **kwargs: SimpleNamespace()
        )
        monkeypatch.setattr(generator, "_prepare_user_inputs", lambda **kwargs: kwargs["user_inputs"])

        DummyTraceQueueManager = type(
            "_DummyTraceQueueManager",
            (TraceQueueManager,),
            {
                "__init__": lambda self, app_id=None, user_id=None: (
                    setattr(self, "app_id", app_id) or setattr(self, "user_id", user_id)
                )
            },
        )
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.TraceQueueManager", DummyTraceQueueManager)

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        from models import Account

        user = Account(name="Tester", email="tester@example.com")
        user.id = "user-id"

        result = generator.generate(
            app_model=SimpleNamespace(id="app", tenant_id="tenant"),
            workflow=SimpleNamespace(features_dict={}),
            user=user,
            args={
                "query": "hello",
                "inputs": {"k": "v"},
                "conversation_id": "conversation-id",
                "files": [{"id": "f"}],
            },
            invoke_from=InvokeFrom.WEB_APP,
            workflow_run_id="run-id",
            streaming=False,
        )

        assert result == {"ok": True}
        assert captured["conversation"] is conversation
        assert captured["application_generate_entity"].files == built_files
        assert build_files_called["called"] is True

    def test_resume_delegates_to_generate(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        existing_trace_manager = SimpleNamespace(app_id="existing-app", user_id="existing-user")
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=self._build_app_config(),
            inputs={},
            query="hello",
            files=[],
            user_id="user",
            stream=True,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=existing_trace_manager,
            workflow_run_id="run-id",
        )

        captured_entity: AdvancedChatAppGenerateEntity | None = None
        captured_graph_runtime_state: object | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity, captured_graph_runtime_state
            captured_entity = kwargs["application_generate_entity"]
            captured_graph_runtime_state = kwargs["graph_runtime_state"]
            return SimpleNamespace(resumed=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=SimpleNamespace(id="app-id"),
            workflow=SimpleNamespace(),
            user=SimpleNamespace(id="end-user-id", session_id="session-id"),
            conversation=SimpleNamespace(id="conversation-id"),
            message=SimpleNamespace(id="message-id"),
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
            pause_state_config=None,
        )

        assert result.resumed is True
        assert captured_entity is not None
        assert captured_entity.trace_manager is existing_trace_manager
        assert captured_graph_runtime_state is not None

    def test_single_iteration_generate_builds_debug_task(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        app_config = self._build_app_config()
        captured: dict[str, object] = {}
        prefill_calls: list[object] = []
        var_loader = SimpleNamespace(loader="draft")
        workflow = SimpleNamespace(id="workflow-id")

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: SimpleNamespace(repo="execution"),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(repo="node"),
        )
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.DraftVarLoader", lambda **kwargs: var_loader)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.sessionmaker", lambda **kwargs: SimpleNamespace()
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=object(), session=lambda: SimpleNamespace()),
        )

        class _DraftVarService:
            def __init__(self, session):
                _ = session

            def prefill_conversation_variable_default_values(self, workflow, user_id):
                prefill_calls.append((workflow, user_id))

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.WorkflowDraftVariableService", _DraftVarService)

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.single_iteration_generate(
            app_model=SimpleNamespace(id="app", tenant_id="tenant"),
            workflow=workflow,
            node_id="node-1",
            user=SimpleNamespace(id="user-id"),
            args={"inputs": {"foo": "bar"}},
            streaming=False,
        )

        assert result == {"ok": True}
        assert prefill_calls == [(workflow, "user-id")]
        assert captured["variable_loader"] is var_loader
        assert captured["application_generate_entity"].single_iteration_run.node_id == "node-1"

    def test_single_loop_generate_builds_debug_task(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        app_config = self._build_app_config()
        captured: dict[str, object] = {}
        prefill_calls: list[object] = []
        var_loader = SimpleNamespace(loader="draft")
        workflow = SimpleNamespace(id="workflow-id")

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppConfigManager.get_app_config",
            lambda **kwargs: app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
            lambda **kwargs: SimpleNamespace(repo="execution"),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
            lambda **kwargs: SimpleNamespace(repo="node"),
        )
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.DraftVarLoader", lambda **kwargs: var_loader)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.sessionmaker", lambda **kwargs: SimpleNamespace()
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=object(), session=lambda: SimpleNamespace()),
        )

        class _DraftVarService:
            def __init__(self, session):
                _ = session

            def prefill_conversation_variable_default_values(self, workflow, user_id):
                prefill_calls.append((workflow, user_id))

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.WorkflowDraftVariableService", _DraftVarService)

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.single_loop_generate(
            app_model=SimpleNamespace(id="app", tenant_id="tenant"),
            workflow=workflow,
            node_id="node-2",
            user=SimpleNamespace(id="user-id"),
            args=SimpleNamespace(inputs={"foo": "bar"}),
            streaming=False,
        )

        assert result == {"ok": True}
        assert prefill_calls == [(workflow, "user-id")]
        assert captured["variable_loader"] is var_loader
        assert captured["application_generate_entity"].single_loop_run.node_id == "node-2"

    def test_generate_internal_flow_initial_conversation_with_pause_layer(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        generator._dialogue_count = 0
        app_config = self._build_app_config()

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

        workflow = SimpleNamespace(id="wf-1", tenant_id="tenant", features={"feature": True}, features_dict={})
        conversation = SimpleNamespace(id="conv-1", mode=AppMode.ADVANCED_CHAT, override_model_configs=None)
        message = SimpleNamespace(
            id="msg-1",
            query="hello",
            created_at=naive_utc_now(),
            status=MessageStatus.NORMAL,
            answer="",
        )
        db_session = SimpleNamespace(commit=MagicMock(), refresh=MagicMock(), close=MagicMock())
        captured: dict[str, object] = {}
        thread_data: dict[str, object] = {}

        monkeypatch.setattr(generator, "_init_generate_records", lambda *args: (conversation, message))
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.get_thread_messages_length", lambda _: 2)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.MessageBasedAppQueueManager",
            lambda **kwargs: SimpleNamespace(**kwargs),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.PauseStatePersistenceLayer",
            lambda **kwargs: "pause-layer",
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.current_app",
            SimpleNamespace(_get_current_object=lambda: SimpleNamespace(name="flask")),
        )
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.contextvars.copy_context", lambda: "ctx")

        class _Thread:
            def __init__(self, *, target, kwargs):
                thread_data["target"] = target
                thread_data["kwargs"] = kwargs

            def start(self):
                thread_data["started"] = True

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.threading.Thread", _Thread)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db", SimpleNamespace(engine=object(), session=db_session)
        )
        monkeypatch.setattr(generator, "_get_draft_var_saver_factory", lambda *args, **kwargs: "draft-factory")
        monkeypatch.setattr(
            generator,
            "_handle_advanced_chat_response",
            lambda **kwargs: captured.update(kwargs) or {"raw": True},
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppGenerateResponseConverter.convert",
            lambda response, invoke_from: {"response": response, "invoke_from": invoke_from},
        )

        pause_state_config = SimpleNamespace(session_factory="session-factory", state_owner_user_id="owner")

        response = generator._generate(
            workflow=workflow,
            user=SimpleNamespace(id="user"),
            invoke_from=InvokeFrom.WEB_APP,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            conversation=None,
            message=None,
            stream=False,
            pause_state_config=pause_state_config,
        )

        assert response["response"] == {"raw": True}
        assert thread_data["started"] is True
        assert "pause-layer" in thread_data["kwargs"]["graph_engine_layers"]
        assert generator._dialogue_count == 3
        db_session.commit.assert_called_once()
        db_session.refresh.assert_called_once_with(conversation)
        db_session.close.assert_called_once()
        assert captured["draft_var_saver_factory"] == "draft-factory"
        assert isinstance(captured["workflow"], WorkflowSnapshot)
        assert isinstance(captured["conversation"], ConversationSnapshot)
        assert isinstance(captured["message"], MessageSnapshot)

    def test_generate_internal_flow_with_existing_records_skips_init(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        generator._dialogue_count = 0
        app_config = self._build_app_config()

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

        workflow = SimpleNamespace(id="wf-2", tenant_id="tenant", features={}, features_dict={})
        conversation = SimpleNamespace(id="conv-2", mode=AppMode.ADVANCED_CHAT, override_model_configs=None)
        message = SimpleNamespace(
            id="msg-2",
            query="hello",
            created_at=naive_utc_now(),
            status=MessageStatus.NORMAL,
            answer="",
        )
        db_session = SimpleNamespace(close=MagicMock(), commit=MagicMock(), refresh=MagicMock())
        init_records = MagicMock()
        thread_data: dict[str, object] = {}

        monkeypatch.setattr(generator, "_init_generate_records", init_records)
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.get_thread_messages_length", lambda _: 0)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.MessageBasedAppQueueManager",
            lambda **kwargs: SimpleNamespace(**kwargs),
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.current_app",
            SimpleNamespace(_get_current_object=lambda: SimpleNamespace(name="flask")),
        )
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.contextvars.copy_context", lambda: "ctx")

        class _Thread:
            def __init__(self, *, target, kwargs):
                thread_data["target"] = target
                thread_data["kwargs"] = kwargs

            def start(self):
                thread_data["started"] = True

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.threading.Thread", _Thread)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db", SimpleNamespace(engine=object(), session=db_session)
        )
        monkeypatch.setattr(generator, "_get_draft_var_saver_factory", lambda *args, **kwargs: "draft-factory")
        monkeypatch.setattr(
            generator,
            "_handle_advanced_chat_response",
            lambda **kwargs: {"raw": True},
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.AdvancedChatAppGenerateResponseConverter.convert",
            lambda response, invoke_from: response,
        )

        response = generator._generate(
            workflow=workflow,
            user=SimpleNamespace(id="user"),
            invoke_from=InvokeFrom.WEB_APP,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )

        assert response == {"raw": True}
        init_records.assert_not_called()
        assert thread_data["started"] is True
        db_session.commit.assert_not_called()
        db_session.refresh.assert_not_called()
        db_session.close.assert_called_once()

    def test_generate_worker_raises_when_workflow_not_found(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        generator._dialogue_count = 1
        app_config = self._build_app_config()

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

        generator._get_conversation = MagicMock(return_value=SimpleNamespace(id="conv"))
        generator._get_message = MagicMock(return_value=SimpleNamespace(id="msg"))

        @contextmanager
        def _fake_context(*args, **kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        class _Session:
            def __init__(self, *args, **kwargs):
                self.scalar = MagicMock(return_value=None)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.Session", _Session)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=object(), session=SimpleNamespace(close=lambda: None)),
        )

        with pytest.raises(ValueError, match="Workflow not found"):
            generator._generate_worker(
                flask_app=SimpleNamespace(),
                application_generate_entity=application_generate_entity,
                queue_manager=MagicMock(),
                conversation_id="conv",
                message_id="msg",
                context=SimpleNamespace(),
                variable_loader=SimpleNamespace(),
                workflow_execution_repository=SimpleNamespace(),
                workflow_node_execution_repository=SimpleNamespace(),
                graph_engine_layers=(),
                graph_runtime_state=None,
            )

    def test_generate_worker_raises_when_app_not_found_for_internal_call(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        generator._dialogue_count = 1
        app_config = self._build_app_config()

        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="internal-user",
            stream=False,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={},
            trace_manager=None,
            workflow_run_id="run-id",
        )

        generator._get_conversation = MagicMock(return_value=SimpleNamespace(id="conv"))
        generator._get_message = MagicMock(return_value=SimpleNamespace(id="msg"))

        @contextmanager
        def _fake_context(*args, **kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        class _Session:
            def __init__(self, *args, **kwargs):
                self.scalar = MagicMock(
                    side_effect=[
                        SimpleNamespace(id="workflow-id", tenant_id="tenant", app_id="app"),
                        None,
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

        with pytest.raises(ValueError, match="App not found"):
            generator._generate_worker(
                flask_app=SimpleNamespace(),
                application_generate_entity=application_generate_entity,
                queue_manager=MagicMock(),
                conversation_id="conv",
                message_id="msg",
                context=SimpleNamespace(),
                variable_loader=SimpleNamespace(),
                workflow_execution_repository=SimpleNamespace(),
                workflow_node_execution_repository=SimpleNamespace(),
                graph_engine_layers=(),
                graph_runtime_state=None,
            )

    def test_generate_worker_handles_stopped_error(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        generator._dialogue_count = 1
        app_config = self._build_app_config()

        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="internal-user",
            stream=False,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={},
            trace_manager=None,
            workflow_run_id="run-id",
        )

        queue_manager = MagicMock()
        generator._get_conversation = MagicMock(return_value=SimpleNamespace(id="conv"))
        generator._get_message = MagicMock(return_value=SimpleNamespace(id="msg"))

        @contextmanager
        def _fake_context(*args, **kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        class _Session:
            def __init__(self, *args, **kwargs):
                self.scalar = MagicMock(
                    side_effect=[
                        SimpleNamespace(id="workflow-id", tenant_id="tenant", app_id="app"),
                        SimpleNamespace(id="app"),
                    ]
                )

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        class _Runner:
            def __init__(self, **kwargs):
                _ = kwargs

            def run(self):
                raise GenerateTaskStoppedError()

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.Session", _Session)
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner", _Runner)
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

        queue_manager.publish_error.assert_not_called()

    def test_generate_worker_handles_validation_error(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        generator._dialogue_count = 1
        app_config = self._build_app_config()

        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            query="hello",
            files=[],
            user_id="internal-user",
            stream=False,
            invoke_from=InvokeFrom.DEBUGGER,
            extras={},
            trace_manager=None,
            workflow_run_id="run-id",
        )

        class _ValidationModel(BaseModel):
            value: int

        try:
            _ValidationModel(value="invalid")
        except ValidationError as error:
            validation_error = error
        else:
            raise AssertionError("validation error should be created")

        queue_manager = MagicMock()
        generator._get_conversation = MagicMock(return_value=SimpleNamespace(id="conv"))
        generator._get_message = MagicMock(return_value=SimpleNamespace(id="msg"))

        @contextmanager
        def _fake_context(*args, **kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        class _Session:
            def __init__(self, *args, **kwargs):
                self.scalar = MagicMock(
                    side_effect=[
                        SimpleNamespace(id="workflow-id", tenant_id="tenant", app_id="app"),
                        SimpleNamespace(id="app"),
                    ]
                )

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        class _Runner:
            def __init__(self, **kwargs):
                _ = kwargs

            def run(self):
                raise validation_error

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.Session", _Session)
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner", _Runner)
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

        queue_manager.publish_error.assert_called_once()

    def test_generate_worker_handles_value_and_unknown_errors(self, monkeypatch: pytest.MonkeyPatch):
        app_config = self._build_app_config()

        @contextmanager
        def _fake_context(*args, **kwargs):
            yield

        def _make_runner(error: Exception):
            class _Runner:
                def __init__(self, **kwargs):
                    _ = kwargs

                def run(self):
                    raise error

            return _Runner

        for raised_error in [ValueError("bad input"), RuntimeError("unexpected")]:
            generator = AdvancedChatAppGenerator()
            generator._dialogue_count = 1
            application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
                task_id="task",
                app_config=app_config,
                inputs={},
                query="hello",
                files=[],
                user_id="internal-user",
                stream=False,
                invoke_from=InvokeFrom.DEBUGGER,
                extras={},
                trace_manager=None,
                workflow_run_id="run-id",
            )

            queue_manager = MagicMock()
            generator._get_conversation = MagicMock(return_value=SimpleNamespace(id="conv"))
            generator._get_message = MagicMock(return_value=SimpleNamespace(id="msg"))

            class _Session:
                def __init__(self, *args, **kwargs):
                    self.scalar = MagicMock(
                        side_effect=[
                            SimpleNamespace(id="workflow-id", tenant_id="tenant", app_id="app"),
                            SimpleNamespace(id="app"),
                        ]
                    )

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

            monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)
            monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.Session", _Session)
            monkeypatch.setattr(
                "core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner",
                _make_runner(raised_error),
            )
            monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.dify_config", SimpleNamespace(DEBUG=True))
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

            queue_manager.publish_error.assert_called_once()

    def test_handle_response_closed_file_raises_stopped(self, monkeypatch: pytest.MonkeyPatch):
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
                workflow=WorkflowSnapshot(id="wf", tenant_id="tenant", features_dict={}),
                queue_manager=SimpleNamespace(),
                conversation=ConversationSnapshot(id="conv", mode=AppMode.ADVANCED_CHAT),
                message=MessageSnapshot(
                    id="msg",
                    query="hello",
                    created_at=naive_utc_now(),
                    status=MessageStatus.NORMAL,
                    answer="",
                ),
                user=SimpleNamespace(),
                draft_var_saver_factory=lambda **kwargs: None,
                stream=False,
            )

    def test_handle_response_re_raises_value_error(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        generator._dialogue_count = 1
        app_config = self._build_app_config()
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
            def __init__(self, **kwargs):
                _ = kwargs

            def process(self):
                raise ValueError("other error")

        logger_exception = MagicMock()
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.logger.exception", logger_exception)
        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppGenerateTaskPipeline", _Pipeline)

        with pytest.raises(ValueError, match="other error"):
            generator._handle_advanced_chat_response(
                application_generate_entity=application_generate_entity,
                workflow=WorkflowSnapshot(id="wf", tenant_id="tenant", features_dict={}),
                queue_manager=SimpleNamespace(),
                conversation=ConversationSnapshot(id="conv", mode=AppMode.ADVANCED_CHAT),
                message=MessageSnapshot(
                    id="msg",
                    query="hello",
                    created_at=naive_utc_now(),
                    status=MessageStatus.NORMAL,
                    answer="",
                ),
                user=SimpleNamespace(),
                draft_var_saver_factory=lambda **kwargs: None,
                stream=False,
            )

        logger_exception.assert_called_once()

    def test_generate_worker_handles_invoke_auth_error(self, monkeypatch: pytest.MonkeyPatch):
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
                from graphon.model_runtime.errors.invoke import InvokeAuthorizationError

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

    def test_generate_debugger_enables_retrieve_source(self, monkeypatch: pytest.MonkeyPatch):
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
                "__init__": lambda self, app_id=None, user_id=None: (
                    setattr(self, "app_id", app_id) or setattr(self, "user_id", user_id)
                )
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

    def test_generate_service_api_sets_parent_message_id(self, monkeypatch: pytest.MonkeyPatch):
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
                "__init__": lambda self, app_id=None, user_id=None: (
                    setattr(self, "app_id", app_id) or setattr(self, "user_id", user_id)
                )
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


class TestAdvancedChatAppGeneratorResume:
    @staticmethod
    def _build_app_config() -> WorkflowUIBasedAppConfig:
        return WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )

    def test_resume_restores_trace_manager_when_missing(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=self._build_app_config(),
            file_upload_config=None,
            conversation_id="conversation-id",
            inputs={},
            query="hello",
            files=[],
            parent_message_id="parent-message-id",
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=None,
            workflow_run_id="run-id",
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
            "core.app.apps.advanced_chat.app_generator.TraceQueueManager",
            DummyTraceQueueManager,
        )
        captured_entity: AdvancedChatAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=SimpleNamespace(id="app-id"),
            workflow=SimpleNamespace(),
            user=SimpleNamespace(id="end-user-id", session_id="session-id"),
            conversation=SimpleNamespace(id="conversation-id"),
            message=SimpleNamespace(id="message-id"),
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        trace_manager = captured_entity.trace_manager
        assert isinstance(trace_manager, DummyTraceQueueManager)
        assert trace_manager.app_id == "app-id"
        assert trace_manager.user_id == "session-id"

    def test_resume_preserves_existing_trace_manager(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        existing_trace_manager = SimpleNamespace(app_id="existing-app", user_id="existing-user")
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=self._build_app_config(),
            file_upload_config=None,
            conversation_id="conversation-id",
            inputs={},
            query="hello",
            files=[],
            parent_message_id="parent-message-id",
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=existing_trace_manager,
            workflow_run_id="run-id",
        )
        captured_entity: AdvancedChatAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=SimpleNamespace(id="app-id"),
            workflow=SimpleNamespace(),
            user=SimpleNamespace(id="end-user-id", session_id="session-id"),
            conversation=SimpleNamespace(id="conversation-id"),
            message=SimpleNamespace(id="message-id"),
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        assert captured_entity.trace_manager is existing_trace_manager
