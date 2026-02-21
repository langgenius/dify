from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.app_config.entities import AppAdditionalFeatures, WorkflowUIBasedAppConfig
from core.app.apps import message_based_app_generator
from core.app.apps.advanced_chat.app_generator import AdvancedChatAppGenerator
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.task_pipeline import message_cycle_manager
from core.app.task_pipeline.message_cycle_manager import MessageCycleManager
from models.model import AppMode, Conversation, Message


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


@pytest.fixture(autouse=True)
def _mock_db_session(monkeypatch):
    session = MagicMock()

    def refresh_side_effect(obj):
        if isinstance(obj, Conversation) and obj.id is None:
            obj.id = "generated-conversation-id"
        if isinstance(obj, Message) and obj.id is None:
            obj.id = "generated-message-id"

    session.refresh.side_effect = refresh_side_effect
    session.add.return_value = None
    session.commit.return_value = None

    monkeypatch.setattr(message_based_app_generator, "db", SimpleNamespace(session=session))
    return session


def test_init_generate_records_sets_conversation_metadata():
    app_config = _make_app_config()
    entity = _make_generate_entity(app_config)

    generator = AdvancedChatAppGenerator()

    conversation, _ = generator._init_generate_records(entity, conversation=None)

    assert entity.conversation_id == "generated-conversation-id"
    assert conversation.id == "generated-conversation-id"
    assert entity.is_new_conversation is True


def test_init_generate_records_marks_existing_conversation():
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
        from_source="api",
        from_end_user_id="user-id",
        from_account_id=None,
    )
    existing_conversation.id = "existing-conversation-id"

    generator = AdvancedChatAppGenerator()

    conversation, _ = generator._init_generate_records(entity, conversation=existing_conversation)

    assert entity.conversation_id == "existing-conversation-id"
    assert conversation is existing_conversation
    assert entity.is_new_conversation is False


def test_message_cycle_manager_uses_new_conversation_flag(monkeypatch):
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

    def fake_thread(**kwargs):
        thread = DummyThread(**kwargs)
        captured["thread"] = thread
        return thread

    monkeypatch.setattr(message_cycle_manager, "Thread", fake_thread)

    manager = MessageCycleManager(application_generate_entity=entity, task_state=MagicMock())
    thread = manager.generate_conversation_name(conversation_id="existing-conversation-id", query="hello")

    assert thread is captured["thread"]
    assert thread.started is True
    assert entity.is_new_conversation is False
