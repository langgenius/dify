from __future__ import annotations

import json
import logging
from contextlib import contextmanager
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel, ValidationError
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session

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
from models.account import Account
from models.enums import ConversationFromSource, EndUserType, MessageStatus
from models.model import App, AppMode, Conversation, EndUser, Message
from models.workflow import Workflow, WorkflowType
from tests.unit_tests.config_override import apply_config_overrides


def _make_app(*, app_id: str = "app", tenant_id: str = "tenant") -> App:
    return App(
        id=app_id,
        tenant_id=tenant_id,
        name="Advanced Chat App",
        mode=AppMode.ADVANCED_CHAT,
        enable_site=False,
        enable_api=False,
    )


def _make_workflow(
    *,
    workflow_id: str = "workflow-id",
    tenant_id: str = "tenant",
    app_id: str = "app",
    features: dict[str, object] | None = None,
) -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=WorkflowType.CHAT,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features=json.dumps(features or {}),
        created_by="user",
    )


def _make_account(*, account_id: str = "user-id") -> Account:
    account = Account(name="Advanced Chat User", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _make_end_user(*, end_user_id: str = "end-user-id", session_id: str = "session-id") -> EndUser:
    return EndUser(
        id=end_user_id,
        tenant_id="tenant",
        app_id="app",
        type=EndUserType.BROWSER,
        session_id=session_id,
    )


def _make_conversation(*, conversation_id: str = "conversation-id", app_id: str = "app") -> Conversation:
    return Conversation(
        id=conversation_id,
        app_id=app_id,
        mode=AppMode.ADVANCED_CHAT,
        name="Advanced Chat Conversation",
        inputs={},
        from_source=ConversationFromSource.API,
    )


def _make_message(
    *, message_id: str = "message-id", conversation_id: str = "conversation-id", app_id: str = "app"
) -> Message:
    return Message(
        id=message_id,
        app_id=app_id,
        conversation_id=conversation_id,
        inputs={},
        query="hello",
        message={},
        answer="",
        status=MessageStatus.NORMAL,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        created_at=naive_utc_now(),
    )


class TestAdvancedChatAppGeneratorValidation:
    def test_generate_requires_query(self, unbound_session: Session):
        generator = AdvancedChatAppGenerator()

        with pytest.raises(ValueError, match="query is required"):
            generator.generate(
                app_model=_make_app(),
                workflow=_make_workflow(),
                user=_make_account(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
                workflow_run_id="run-id",
                streaming=False,
                session=unbound_session,
            )

    def test_generate_requires_string_query(self, unbound_session: Session):
        generator = AdvancedChatAppGenerator()

        with pytest.raises(ValueError, match="query must be a string"):
            generator.generate(
                app_model=_make_app(),
                workflow=_make_workflow(),
                user=_make_account(),
                args={"inputs": {}, "query": 123},
                invoke_from=InvokeFrom.WEB_APP,
                workflow_run_id="run-id",
                streaming=False,
                session=unbound_session,
            )

    def test_single_iteration_generate_validates_args(self, unbound_session: Session):
        generator = AdvancedChatAppGenerator()

        with pytest.raises(ValueError, match="node_id is required"):
            generator.single_iteration_generate(
                app_model=_make_app(),
                workflow=_make_workflow(),
                node_id="",
                user=_make_account(),
                args={"inputs": {}},
                streaming=False,
                session=unbound_session,
            )

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_iteration_generate(
                app_model=_make_app(),
                workflow=_make_workflow(),
                node_id="node",
                user=_make_account(),
                args={},
                streaming=False,
                session=unbound_session,
            )

    def test_single_loop_generate_validates_args(self, unbound_session: Session):
        generator = AdvancedChatAppGenerator()

        with pytest.raises(ValueError, match="node_id is required"):
            generator.single_loop_generate(
                app_model=_make_app(),
                workflow=_make_workflow(),
                node_id="",
                user=_make_account(),
                args=SimpleNamespace(inputs={}),
                streaming=False,
                session=unbound_session,
            )

        with pytest.raises(ValueError, match="inputs is required"):
            generator.single_loop_generate(
                app_model=_make_app(),
                workflow=_make_workflow(),
                node_id="node",
                user=_make_account(),
                args=SimpleNamespace(inputs=None),
                streaming=False,
                session=unbound_session,
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

    def test_generate_loads_conversation_and_files(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session, sqlite_engine: Engine
    ):
        generator = AdvancedChatAppGenerator()
        app_config = self._build_app_config()

        conversation = _make_conversation()
        built_files: list[object] = []
        build_files_called = {"called": False}
        captured: dict[str, object] = {}
        session = unbound_session
        get_conversation = MagicMock(return_value=conversation)

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.ConversationService.get_conversation",
            get_conversation,
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
            SimpleNamespace(engine=sqlite_engine, session=unbound_session),
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
            app_model=_make_app(),
            workflow=_make_workflow(),
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
            session=session,
        )

        assert result == {"ok": True}
        assert captured["conversation"] is conversation
        assert captured["application_generate_entity"].files == built_files
        assert captured["session"] is session
        assert build_files_called["called"] is True
        assert get_conversation.call_args.kwargs["session"] is session

    def test_resume_delegates_to_generate(self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session):
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
            app_model=_make_app(app_id="app-id"),
            workflow=_make_workflow(),
            user=_make_end_user(),
            conversation=_make_conversation(),
            message=_make_message(),
            session=unbound_session,
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

    def test_single_iteration_generate_builds_debug_task(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session, sqlite_engine: Engine
    ):
        generator = AdvancedChatAppGenerator()
        app_config = self._build_app_config()
        captured: dict[str, object] = {}
        prefill_calls: list[object] = []
        draft_sessions: list[object] = []
        var_loader = SimpleNamespace(loader="draft")
        workflow = _make_workflow()
        session = unbound_session

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
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=unbound_session),
        )

        class _DraftVarService:
            def __init__(self, session):
                draft_sessions.append(session)

            def prefill_conversation_variable_default_values(self, workflow, user_id):
                prefill_calls.append((workflow, user_id))

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.WorkflowDraftVariableService", _DraftVarService)

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.single_iteration_generate(
            app_model=_make_app(),
            workflow=workflow,
            node_id="node-1",
            user=_make_account(),
            args={"inputs": {"foo": "bar"}, "trace_session_id": "session-1"},
            streaming=False,
            session=session,
        )

        assert result == {"ok": True}
        assert prefill_calls == [(workflow, "user-id")]
        assert draft_sessions == [session]
        assert captured["variable_loader"] is var_loader
        assert captured["session"] is session
        assert captured["application_generate_entity"].single_iteration_run.node_id == "node-1"
        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"

    def test_single_loop_generate_builds_debug_task(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session, sqlite_engine: Engine
    ):
        generator = AdvancedChatAppGenerator()
        app_config = self._build_app_config()
        captured: dict[str, object] = {}
        prefill_calls: list[object] = []
        draft_sessions: list[object] = []
        var_loader = SimpleNamespace(loader="draft")
        workflow = _make_workflow()
        session = unbound_session

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
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=unbound_session),
        )

        class _DraftVarService:
            def __init__(self, session):
                draft_sessions.append(session)

            def prefill_conversation_variable_default_values(self, workflow, user_id):
                prefill_calls.append((workflow, user_id))

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.WorkflowDraftVariableService", _DraftVarService)

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.single_loop_generate(
            app_model=_make_app(),
            workflow=workflow,
            node_id="node-2",
            user=_make_account(),
            args=SimpleNamespace(inputs={"foo": "bar"}, trace_session_id="session-1"),
            streaming=False,
            session=session,
        )

        assert result == {"ok": True}
        assert prefill_calls == [(workflow, "user-id")]
        assert draft_sessions == [session]
        assert captured["variable_loader"] is var_loader
        assert captured["session"] is session
        assert captured["application_generate_entity"].single_loop_run.node_id == "node-2"
        assert captured["application_generate_entity"].extras["trace_session_id"] == "session-1"

    def test_generate_internal_flow_initial_conversation_with_pause_layer(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: Engine
    ):
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

        app = _make_app()
        workflow = _make_workflow(workflow_id="wf-1", features={"feature": True})
        conversation = _make_conversation(conversation_id="conv-1")
        message = _make_message(message_id="msg-1", conversation_id=conversation.id)
        sqlite_session.add_all([app, workflow, conversation, message])
        sqlite_session.commit()
        commit_count = 0

        def _record_commit(session: Session) -> None:
            nonlocal commit_count
            commit_count += 1

        event.listen(sqlite_session, "after_commit", _record_commit)
        captured: dict[str, object] = {}
        thread_data: dict[str, object] = {}
        init_records = MagicMock(return_value=(conversation, message))
        get_thread_messages_length = MagicMock(return_value=2)

        monkeypatch.setattr(generator, "_init_generate_records", init_records)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.get_thread_messages_length", get_thread_messages_length
        )
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

            def join(self, timeout):
                thread_data["joined"] = True
                thread_data["join_timeout"] = timeout

            def is_alive(self):
                return False

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.threading.Thread", _Thread)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
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
            user=_make_account(account_id="user"),
            invoke_from=InvokeFrom.WEB_APP,
            application_generate_entity=application_generate_entity,
            session=sqlite_session,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            conversation=None,
            message=None,
            stream=False,
            pause_state_config=pause_state_config,
        )

        assert response["response"] == {"raw": True}
        assert thread_data["started"] is True
        assert thread_data["joined"] is True
        assert thread_data["join_timeout"] == 300
        assert "pause-layer" in thread_data["kwargs"]["graph_engine_layers"]
        assert generator._dialogue_count == 3
        assert init_records.call_args.kwargs["session"] is sqlite_session
        get_thread_messages_length.assert_called_once_with(conversation.id, session=sqlite_session)
        assert commit_count == 1
        assert json.loads(conversation.override_model_configs) == {"feature": True}
        assert captured["draft_var_saver_factory"] == "draft-factory"
        assert isinstance(captured["workflow"], WorkflowSnapshot)
        assert isinstance(captured["conversation"], ConversationSnapshot)
        assert isinstance(captured["message"], MessageSnapshot)

    def test_generate_internal_flow_with_existing_records_skips_init(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: Engine
    ):
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

        app = _make_app()
        workflow = _make_workflow(workflow_id="wf-2")
        conversation = _make_conversation(conversation_id="conv-2")
        message = _make_message(message_id="msg-2", conversation_id=conversation.id)
        sqlite_session.add_all([app, workflow, conversation, message])
        sqlite_session.commit()
        commit_count = 0

        def _record_commit(session: Session) -> None:
            nonlocal commit_count
            commit_count += 1

        event.listen(sqlite_session, "after_commit", _record_commit)
        init_records = MagicMock()
        get_thread_messages_length = MagicMock(return_value=0)
        thread_data: dict[str, object] = {}

        monkeypatch.setattr(generator, "_init_generate_records", init_records)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.get_thread_messages_length", get_thread_messages_length
        )
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

            def join(self, timeout):
                thread_data["joined"] = True
                thread_data["join_timeout"] = timeout

            def is_alive(self):
                return False

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.threading.Thread", _Thread)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
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
            user=_make_account(account_id="user"),
            invoke_from=InvokeFrom.WEB_APP,
            application_generate_entity=application_generate_entity,
            session=sqlite_session,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            conversation=conversation,
            message=message,
            stream=False,
        )

        assert response == {"raw": True}
        init_records.assert_not_called()
        get_thread_messages_length.assert_called_once_with(conversation.id, session=sqlite_session)
        assert thread_data["started"] is True
        assert thread_data["joined"] is True
        assert thread_data["join_timeout"] == 300
        assert commit_count == 0

    def test_generate_worker_raises_when_workflow_not_found(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: Engine
    ):
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

        generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
        generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))

        @contextmanager
        def _fake_context(*args, **kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
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

    def test_generate_worker_raises_when_app_not_found_for_internal_call(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: Engine
    ):
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

        generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
        generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))
        sqlite_session.add(_make_workflow())
        sqlite_session.commit()

        @contextmanager
        def _fake_context(*args, **kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
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

    def test_generate_worker_handles_stopped_error(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: Engine
    ):
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
        generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
        generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))

        @contextmanager
        def _fake_context(*args, **kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        sqlite_session.add_all([_make_app(), _make_workflow()])
        sqlite_session.commit()

        class _Runner:
            def __init__(self, **kwargs):
                _ = kwargs

            def run(self):
                raise GenerateTaskStoppedError()

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner", _Runner)
        restore_workflow_run_graph = MagicMock()
        monkeypatch.setattr(generator, "_restore_workflow_run_graph", restore_workflow_run_graph)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
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
            graph_runtime_state=SimpleNamespace(),
        )

        queue_manager.publish_error.assert_not_called()
        assert restore_workflow_run_graph.call_args.kwargs["workflow"].id == "workflow-id"
        assert restore_workflow_run_graph.call_args.kwargs["workflow_run_id"] == "run-id"

    def test_generate_worker_handles_validation_error(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: Engine
    ):
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
        generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
        generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))
        sqlite_session.add_all([_make_app(), _make_workflow()])
        sqlite_session.commit()

        @contextmanager
        def _fake_context(*args, **kwargs):
            yield

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)

        class _Runner:
            def __init__(self, **kwargs):
                _ = kwargs

            def run(self):
                raise validation_error

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner", _Runner)
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
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

    def test_generate_worker_handles_value_and_unknown_errors(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: Engine
    ):
        app_config = self._build_app_config()
        sqlite_session.add_all([_make_app(), _make_workflow()])
        sqlite_session.commit()

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
            generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
            generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))

            monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.preserve_flask_contexts", _fake_context)
            monkeypatch.setattr(
                "core.app.apps.advanced_chat.app_generator.AdvancedChatAppRunner",
                _make_runner(raised_error),
            )
            apply_config_overrides(monkeypatch, DEBUG=True)
            monkeypatch.setattr(
                "core.app.apps.advanced_chat.app_generator.db",
                SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
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
                user=_make_account(),
                draft_var_saver_factory=lambda **kwargs: None,
                stream=False,
            )

    def test_handle_response_re_raises_value_error(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ):
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

        monkeypatch.setattr("core.app.apps.advanced_chat.app_generator.AdvancedChatAppGenerateTaskPipeline", _Pipeline)

        with (
            caplog.at_level(logging.ERROR, logger="core.app.apps.advanced_chat.app_generator"),
            pytest.raises(ValueError, match="other error"),
        ):
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
                user=_make_account(),
                draft_var_saver_factory=lambda **kwargs: None,
                stream=False,
            )

        assert "Failed to process generate task pipeline, conversation_id: conv" in caplog.messages

    def test_generate_worker_handles_invoke_auth_error(
        self, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session, sqlite_engine: Engine
    ):
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

        generator._get_conversation = MagicMock(return_value=_make_conversation(conversation_id="conv"))
        generator._get_message = MagicMock(return_value=_make_message(message_id="msg", conversation_id="conv"))
        sqlite_session.add_all([_make_app(), _make_workflow(), _make_end_user()])
        sqlite_session.commit()

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

        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.db",
            SimpleNamespace(engine=sqlite_engine, session=sqlite_session),
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

    def test_generate_debugger_enables_retrieve_source(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session, sqlite_engine: Engine
    ):
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
            SimpleNamespace(engine=sqlite_engine, session=unbound_session),
        )

        captured = {}

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        app_model = _make_app()
        workflow = _make_workflow()
        user = _make_account(account_id="user")

        result = generator.generate(
            app_model=app_model,
            workflow=workflow,
            user=user,
            args={"query": "hello\x00", "inputs": {}},
            invoke_from=InvokeFrom.DEBUGGER,
            workflow_run_id="run-id",
            streaming=False,
            session=unbound_session,
        )

        assert result == {"ok": True}
        assert app_config.additional_features.show_retrieve_source is True
        assert captured["application_generate_entity"].query == "hello"

    def test_generate_service_api_sets_parent_message_id(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session, sqlite_engine: Engine
    ):
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
            SimpleNamespace(engine=sqlite_engine, session=unbound_session),
        )

        captured = {}

        def _fake_generate(**kwargs):
            captured.update(kwargs)
            return {"ok": True}

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        app_model = _make_app()
        workflow = _make_workflow()
        user = _make_end_user(end_user_id="end-user", session_id="session")

        generator.generate(
            app_model=app_model,
            workflow=workflow,
            user=user,
            args={"query": "hello", "inputs": {}, "parent_message_id": "p1"},
            invoke_from=InvokeFrom.SERVICE_API,
            workflow_run_id="run-id",
            streaming=False,
            session=unbound_session,
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

    def test_resume_restores_trace_manager_when_missing(
        self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
    ):
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
            app_model=_make_app(app_id="app-id"),
            workflow=_make_workflow(),
            user=_make_end_user(),
            conversation=_make_conversation(),
            message=_make_message(),
            session=unbound_session,
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

    def test_resume_preserves_existing_trace_manager(self, monkeypatch: pytest.MonkeyPatch, unbound_session: Session):
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
            app_model=_make_app(app_id="app-id"),
            workflow=_make_workflow(),
            user=_make_end_user(),
            conversation=_make_conversation(),
            message=_make_message(),
            session=unbound_session,
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        assert captured_entity.trace_manager is existing_trace_manager
