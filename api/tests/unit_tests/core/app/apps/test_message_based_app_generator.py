from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps import message_based_app_generator
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity, InvokeFrom
from models.model import AppMode, Conversation, Message
from services.errors.app_model_config import AppModelConfigBrokenError


class DummyModelConf:
    def __init__(self, provider: str = "mock-provider", model: str = "mock-model") -> None:
        self.provider = provider
        self.model = model


class DummyCompletionGenerateEntity:
    __slots__ = ("app_config", "invoke_from", "user_id", "query", "inputs", "files", "model_conf")
    app_config: EasyUIBasedAppConfig
    invoke_from: InvokeFrom
    user_id: str
    query: str
    inputs: dict
    files: list
    model_conf: DummyModelConf

    def __init__(self, app_config: EasyUIBasedAppConfig) -> None:
        self.app_config = app_config
        self.invoke_from = InvokeFrom.WEB_APP
        self.user_id = "user-id"
        self.query = "hello"
        self.inputs = {}
        self.files = []
        self.model_conf = DummyModelConf()


def _make_app_config(app_mode: AppMode) -> EasyUIBasedAppConfig:
    return EasyUIBasedAppConfig(
        tenant_id="tenant-id",
        app_id="app-id",
        app_mode=app_mode,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
        app_model_config_id="model-config-id",
        app_model_config_dict={},
        model=ModelConfigEntity(provider="mock-provider", model="mock-model", mode="chat"),
        prompt_template=PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="Hello",
        ),
        additional_features=AppAdditionalFeatures(),
        variables=[],
    )


def _make_chat_generate_entity(app_config: EasyUIBasedAppConfig) -> ChatAppGenerateEntity:
    return ChatAppGenerateEntity.model_construct(
        task_id="task-id",
        app_config=app_config,
        model_conf=DummyModelConf(),
        file_upload_config=None,
        conversation_id=None,
        inputs={},
        query="hello",
        files=[],
        parent_message_id=None,
        user_id="user-id",
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        extras={},
        call_depth=0,
        trace_manager=None,
    )


@pytest.fixture(autouse=True)
def _mock_db_session(monkeypatch: pytest.MonkeyPatch):
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


def test_init_generate_records_skips_conversation_fields_for_non_conversation_entity():
    app_config = _make_app_config(AppMode.COMPLETION)
    entity = DummyCompletionGenerateEntity(app_config=app_config)

    generator = MessageBasedAppGenerator()

    conversation, message = generator._init_generate_records(entity, conversation=None)

    assert conversation.id == "generated-conversation-id"
    assert message.id == "generated-message-id"
    assert hasattr(entity, "conversation_id") is False
    assert hasattr(entity, "is_new_conversation") is False


def test_init_generate_records_sets_conversation_fields_for_chat_entity():
    app_config = _make_app_config(AppMode.CHAT)
    entity = _make_chat_generate_entity(app_config)

    generator = MessageBasedAppGenerator()

    conversation, _ = generator._init_generate_records(entity, conversation=None)

    assert entity.conversation_id == "generated-conversation-id"
    assert entity.is_new_conversation is True
    assert conversation.id == "generated-conversation-id"


class TestMessageBasedAppGeneratorExtras:
    def test_handle_response_closed_file_raises_stopped(self, monkeypatch: pytest.MonkeyPatch):
        generator = MessageBasedAppGenerator()

        class _Pipeline:
            def __init__(self, **kwargs) -> None:
                _ = kwargs

            def process(self):
                raise ValueError("I/O operation on closed file.")

        monkeypatch.setattr(
            "core.app.apps.message_based_app_generator.EasyUIBasedGenerateTaskPipeline",
            _Pipeline,
        )

        with pytest.raises(GenerateTaskStoppedError):
            generator._handle_response(
                application_generate_entity=_make_chat_generate_entity(_make_app_config(AppMode.CHAT)),
                queue_manager=SimpleNamespace(),
                conversation=SimpleNamespace(id="conv"),
                message=SimpleNamespace(id="msg"),
                user=SimpleNamespace(),
                stream=False,
            )

    def test_get_app_model_config_requires_valid_config(self, monkeypatch: pytest.MonkeyPatch):
        generator = MessageBasedAppGenerator()
        app_model = SimpleNamespace(id="app", app_model_config_id=None, app_model_config=None)

        with pytest.raises(AppModelConfigBrokenError):
            generator._get_app_model_config(app_model, conversation=None)

        conversation = SimpleNamespace(app_model_config_id="missing-id")
        monkeypatch.setattr(
            message_based_app_generator, "db", SimpleNamespace(session=SimpleNamespace(scalar=lambda _: None))
        )

        with pytest.raises(AppModelConfigBrokenError):
            generator._get_app_model_config(app_model=SimpleNamespace(id="app"), conversation=conversation)

    def test_get_conversation_introduction_handles_missing_inputs(self):
        app_config = _make_app_config(AppMode.CHAT)
        app_config.additional_features.opening_statement = "Hello {{name}}"
        entity = _make_chat_generate_entity(app_config)
        entity.inputs = {}

        generator = MessageBasedAppGenerator()

        assert generator._get_conversation_introduction(entity) == "Hello {name}"
