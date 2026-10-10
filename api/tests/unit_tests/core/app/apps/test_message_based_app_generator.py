from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity, InvokeFrom
from models.account import Account
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, Message
from services.errors.app_model_config import AppModelConfigBrokenError
from tests.unit_tests.model_factories import make_account, make_app


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


def _app(*, app_id: str = "app") -> App:
    return make_app(app_id=app_id, tenant_id="tenant-id", name="Message App", icon_type=None)


def _account() -> Account:
    return make_account(account_id="user-id", name="Message User", email="message-user@example.com")


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


def test_init_generate_records_skips_conversation_fields_for_non_conversation_entity(sqlite_session: Session):
    app_config = _make_app_config(AppMode.COMPLETION)
    entity = DummyCompletionGenerateEntity(app_config=app_config)

    generator = MessageBasedAppGenerator()

    conversation, message = generator._init_generate_records(
        entity,
        conversation=None,
        session=sqlite_session,
    )

    assert conversation.id is not None
    assert message.id is not None
    assert hasattr(entity, "conversation_id") is False
    assert hasattr(entity, "is_new_conversation") is False


def test_init_generate_records_sets_conversation_fields_for_chat_entity(sqlite_session: Session):
    app_config = _make_app_config(AppMode.CHAT)
    entity = _make_chat_generate_entity(app_config)

    generator = MessageBasedAppGenerator()

    conversation, _ = generator._init_generate_records(
        entity,
        conversation=None,
        session=sqlite_session,
    )

    assert entity.conversation_id == conversation.id
    assert entity.is_new_conversation is True
    assert conversation.id is not None


def test_init_generate_records_uses_provided_conversation_id_for_new_conversation(sqlite_session: Session):
    """Issue #41448: callers (chatflow / chat / completion API) can mint their own
    conversation id. When the generator provisions a new Conversation, it must use
    the provided id verbatim rather than letting the model default mint a UUID.
    """

    app_config = _make_app_config(AppMode.CHAT)
    entity = _make_chat_generate_entity(app_config)
    generator = MessageBasedAppGenerator()

    external_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

    conversation, _ = generator._init_generate_records(
        entity,
        conversation=None,
        session=sqlite_session,
        provided_conversation_id=external_id,
    )

    assert conversation.id == external_id
    assert entity.conversation_id == external_id
    assert entity.is_new_conversation is True


def test_init_generate_records_keeps_existing_conversation_when_provided_id_matches(sqlite_session: Session):
    """If an existing Conversation is supplied the provided_conversation_id must be
    ignored and the existing row reused (we don't repoint the id to the caller's value).
    """

    app_config = _make_app_config(AppMode.CHAT)
    entity = _make_chat_generate_entity(app_config)
    generator = MessageBasedAppGenerator()

    existing = Conversation(
        id="existing-conv",
        app_id="app-id",
        mode=AppMode.CHAT,
        name="Test Conversation",
        status="normal",
        from_source=ConversationFromSource.API,
    )
    existing.inputs = {}
    sqlite_session.add(existing)
    sqlite_session.flush()

    conversation, _ = generator._init_generate_records(
        entity,
        conversation=existing,
        session=sqlite_session,
        provided_conversation_id="ignored-id",
    )

    assert conversation is existing
    assert conversation.id == "existing-conv"


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
                conversation=Conversation(id="conv", app_id="app"),
                message=Message(id="msg", app_id="app", conversation_id="conv"),
                user=_account(),
                stream=False,
            )

    def test_get_app_model_config_requires_valid_config(self, sqlite_session: Session):
        generator = MessageBasedAppGenerator()
        app_model = _app()
        session = sqlite_session

        with pytest.raises(AppModelConfigBrokenError):
            generator._get_app_model_config(app_model, conversation=None, session=session)

        conversation = Conversation(id="conversation-id", app_id="app", app_model_config_id="missing-id")
        with pytest.raises(AppModelConfigBrokenError):
            generator._get_app_model_config(
                app_model=_app(),
                conversation=conversation,
                session=session,
            )

    def test_get_conversation_introduction_handles_missing_inputs(self):
        app_config = _make_app_config(AppMode.CHAT)
        app_config.additional_features.opening_statement = "Hello {{name}}"
        entity = _make_chat_generate_entity(app_config)
        entity.inputs = {}

        generator = MessageBasedAppGenerator()

        assert generator._get_conversation_introduction(entity) == "Hello {name}"
