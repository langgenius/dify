from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from sqlalchemy import inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.ops.ops_trace_manager import TraceQueueManager
from models import Account, Workflow
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation
from services.app.generation.adapters import message_cycle as message_cycle_manager
from services.app.generation.adapters.message_cycle import MessageCycleManager
from services.errors.conversation import ConversationNotExistsError
from services.workflow.execution.adapters.chatflow.app_generator import AdvancedChatAppGenerator
from services.workflow.execution.adapters.chatflow.record_preparation import prepare_chat_records
from services.workflow.execution.ports import WorkflowRuntime


def _make_app_config() -> WorkflowUIBasedAppConfig:
    return WorkflowUIBasedAppConfig(
        tenant_id="tenant-id",
        app_id="app-id",
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id="workflow-id",
        additional_features=AppAdditionalFeatures(),
        variables=[],
    )


def _make_generate_entity(app_config: WorkflowUIBasedAppConfig) -> AdvancedChatAppGenerateEntity:
    return AdvancedChatAppGenerateEntity(
        task_id="task-id",
        app_config=app_config,
        file_upload_config=None,
        conversation_id=None,
        inputs={},
        query="hello",
        files=[],
        parent_message_id=None,
        user_id="user-id",
        stream=True,
        invoke_from=InvokeFrom.WEB_APP,
        extras={},
        workflow_run_id="workflow-run-id",
    )


def _app() -> App:
    return App(
        id="app-id",
        tenant_id="tenant-id",
        name="Advanced chat app",
        description="",
        mode=AppMode.ADVANCED_CHAT,
        enable_site=False,
        enable_api=False,
    )


def _workflow() -> Workflow:
    return Workflow.new(
        tenant_id="tenant-id",
        app_id="app-id",
        type="chat",
        version=Workflow.VERSION_DRAFT,
        graph='{"nodes": [], "edges": []}',
        features="{}",
        created_by="user-id",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def _account() -> Account:
    account = Account(name="User", email="user@example.com")
    account.id = "user-id"
    return account


def test_init_generate_records_sets_conversation_metadata(
    sqlite_session: Session, *, workflow_runtime: WorkflowRuntime
):
    app_config = _make_app_config()
    entity = _make_generate_entity(app_config)

    sqlite_session.add(_app())
    sqlite_session.commit()
    conversation, message = workflow_runtime.chat_records.initialize(
        tenant_id=app_config.tenant_id,
        app_id=app_config.app_id,
        conversation_id=None,
        seed=prepare_chat_records(entity, "{}"),
    )

    assert message.conversation_id == conversation.id
    assert conversation.id is not None
    assert inspect(conversation).detached
    assert inspect(message).detached
    assert conversation.from_end_user_id == entity.user_id


def test_init_generate_records_marks_existing_conversation(
    sqlite_session: Session, *, workflow_runtime: WorkflowRuntime
):
    app_config = _make_app_config()
    entity = _make_generate_entity(app_config)

    existing_conversation = Conversation(
        app_id=app_config.app_id,
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=app_config.app_mode.value,
        name="existing",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.WEB_APP.value,
        from_source=ConversationFromSource.API,
        from_end_user_id="user-id",
        from_account_id=None,
    )
    existing_conversation.id = "existing-conversation-id"
    sqlite_session.add_all([_app(), existing_conversation])
    sqlite_session.commit()

    conversation, message = workflow_runtime.chat_records.initialize(
        tenant_id=app_config.tenant_id,
        app_id=app_config.app_id,
        conversation_id=existing_conversation.id,
        seed=prepare_chat_records(entity, "{}"),
    )

    assert message.conversation_id == "existing-conversation-id"
    assert conversation.id == existing_conversation.id
    assert conversation.name == "existing"


def test_generate_falls_back_to_new_conversation_when_conversation_missing(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
    *,
    workflow_runtime: WorkflowRuntime,
):
    app_config = _make_app_config()
    workflow = _workflow()
    app_model = _app()
    user = _account()

    def raise_conversation_not_exists(**_kwargs):
        raise ConversationNotExistsError()

    monkeypatch.setattr(
        workflow_runtime.chat_records,
        "conversation",
        raise_conversation_not_exists,
    )
    monkeypatch.setattr(
        "services.workflow.execution.adapters.chatflow.app_generator.FileUploadConfigManager.convert",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "services.workflow.execution.adapters.chatflow.app_generator.AdvancedChatAppConfigManager.get_app_config",
        lambda **_kwargs: app_config,
    )
    trace_manager = object.__new__(TraceQueueManager)
    monkeypatch.setattr(
        "services.workflow.execution.adapters.chatflow.app_generator.TraceQueueManager",
        lambda **_kwargs: trace_manager,
    )

    captured: dict[str, object] = {}
    session = sqlite_session

    def fake_generate(self, **kwargs):
        captured.update(kwargs)
        return {"status": "ok"}

    monkeypatch.setattr(AdvancedChatAppGenerator, "_generate", fake_generate)

    result = AdvancedChatAppGenerator(runtime=workflow_runtime).generate(
        app_model=app_model,
        workflow=workflow,
        user=user,
        args={"inputs": {}, "query": "hello", "conversation_id": "missing-conversation-id"},
        invoke_from=InvokeFrom.SERVICE_API,
        workflow_run_id="workflow-run-id",
        streaming=False,
    )

    assert result == {"status": "ok"}
    assert captured["conversation"] is None
    application_generate_entity = captured["application_generate_entity"]
    assert isinstance(application_generate_entity, AdvancedChatAppGenerateEntity)
    assert application_generate_entity.conversation_id is None


def test_message_cycle_manager_uses_new_conversation_flag(app_records, monkeypatch: pytest.MonkeyPatch):
    app_config = _make_app_config()
    entity = _make_generate_entity(app_config)
    entity.conversation_id = "existing-conversation-id"
    entity.is_new_conversation = True
    entity.extras = {"auto_generate_conversation_name": True}

    captured = {}

    class DummyThread:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.started = False

        def start(self):
            self.started = True

    def fake_thread[**P](*args: P.args, **kwargs: P.kwargs):
        thread = DummyThread(**kwargs)
        captured["thread"] = thread
        return thread

    monkeypatch.setattr(message_cycle_manager, "Timer", fake_thread)

    manager = MessageCycleManager(records=app_records, application_generate_entity=entity, task_state=MagicMock())
    thread = manager.generate_conversation_name(conversation_id="existing-conversation-id", query="hello")

    assert thread is captured["thread"]
    assert thread.started is True
    assert entity.is_new_conversation is False
