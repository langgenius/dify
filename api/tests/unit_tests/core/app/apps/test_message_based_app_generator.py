from __future__ import annotations

import pytest

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import (
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
)
from core.app.entities.queue_entities import AppQueueEvent
from models.model import App, AppMode, Conversation, Message
from services.app.generation.message_records import MessageBasedAppGenerator
from services.errors.app_model_config import AppModelConfigBrokenError
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.model_factories import make_app, make_end_user


def _make_model_conf() -> ModelConfigWithCredentialsEntity:
    return make_model_config(provider="mock-provider", model="mock-model", mode="chat")


def _app(*, app_id: str = "app") -> App:
    return make_app(app_id=app_id, tenant_id="tenant-id", name="Message App", icon_type=None)


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
        model_conf=_make_model_conf(),
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
        trace_scope=None,
    )


def _make_completion_generate_entity(app_config: EasyUIBasedAppConfig) -> CompletionAppGenerateEntity:
    return CompletionAppGenerateEntity.model_construct(
        task_id="task-id",
        app_config=app_config,
        model_conf=_make_model_conf(),
        file_upload_config=None,
        inputs={},
        query="hello",
        files=[],
        user_id="user-id",
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        extras={},
        call_depth=0,
        trace_scope=None,
    )


def test_init_generate_records_skips_conversation_fields_for_non_conversation_entity(
    app_records, *, annotation_replies
) -> None:
    app_config = _make_app_config(AppMode.COMPLETION)
    entity = _make_completion_generate_entity(app_config)

    generator = MessageBasedAppGenerator(
        annotations=annotation_replies,
        records=app_records,
    )

    conversation, message = generator._init_generate_records(
        entity,
        conversation=None,
    )

    assert conversation.id is not None
    assert message.id is not None
    assert hasattr(entity, "conversation_id") is False
    assert hasattr(entity, "is_new_conversation") is False


def test_init_generate_records_sets_conversation_fields_for_chat_entity(app_records, *, annotation_replies):
    app_config = _make_app_config(AppMode.CHAT)
    entity = _make_chat_generate_entity(app_config)

    generator = MessageBasedAppGenerator(
        annotations=annotation_replies,
        records=app_records,
    )

    conversation, _ = generator._init_generate_records(
        entity,
        conversation=None,
    )

    assert entity.conversation_id == conversation.id
    assert entity.is_new_conversation is True
    assert conversation.id is not None


class _RecordedQueueManager(AppQueueManager):
    """A queue manager that records published events instead of reaching redis."""

    def __init__(self) -> None:
        self.events: list[AppQueueEvent] = []
        self.published_from: list[PublishFrom] = []

    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        self.events.append(event)
        self.published_from.append(pub_from)


class TestMessageBasedAppGeneratorExtras:
    def test_handle_response_closed_file_raises_stopped(
        self, app_records, monkeypatch: pytest.MonkeyPatch, *, annotation_replies
    ):
        generator = MessageBasedAppGenerator(
            annotations=annotation_replies,
            records=app_records,
        )

        class _Pipeline:
            def __init__(self, **kwargs: object) -> None:
                _ = kwargs

            def process(self) -> None:
                raise ValueError("I/O operation on closed file.")

        monkeypatch.setattr(
            "services.app.generation.message_records.EasyUIBasedGenerateTaskPipeline",
            _Pipeline,
        )

        with pytest.raises(GenerateTaskStoppedError):
            generator._handle_response(
                application_generate_entity=_make_chat_generate_entity(_make_app_config(AppMode.CHAT)),
                queue_manager=_RecordedQueueManager(),
                conversation=Conversation(id="conv", app_id="app"),
                message=Message(id="msg", app_id="app", conversation_id="conv"),
                user=make_end_user(end_user_id="user-id"),
                stream=False,
            )

    def test_get_app_model_config_requires_valid_config(self, app_records, *, annotation_replies):
        generator = MessageBasedAppGenerator(
            annotations=annotation_replies,
            records=app_records,
        )
        app_model = _app()

        with pytest.raises(AppModelConfigBrokenError):
            generator._get_app_model_config(app_model, conversation=None)

        conversation = Conversation(id="conversation-id", app_id="app", app_model_config_id="missing-id")
        with pytest.raises(AppModelConfigBrokenError):
            generator._get_app_model_config(
                app_model=_app(),
                conversation=conversation,
            )

    def test_get_conversation_introduction_handles_missing_inputs(self, app_records, *, annotation_replies):
        app_config = _make_app_config(AppMode.CHAT)
        assert app_config.additional_features is not None
        app_config.additional_features.opening_statement = "Hello {{name}}"
        entity = _make_chat_generate_entity(app_config)
        entity.inputs = {}

        generator = MessageBasedAppGenerator(
            annotations=annotation_replies,
            records=app_records,
        )

        assert generator._get_conversation_introduction(entity) == "Hello {name}"


@pytest.fixture(autouse=True)
def message_app(sqlite_session):
    sqlite_session.add(make_app(app_id="app-id", tenant_id="tenant-id"))
    sqlite_session.commit()
