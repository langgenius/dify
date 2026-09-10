from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, Mock, patch

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session

import core.app.apps.chat.app_generator as generator_module
from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.apps.chat.app_runner import ChatAppRunner
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueAnnotationReplyEvent
from core.moderation.base import ModerationError
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from models import Account
from models.enums import ConversationFromSource
from models.model import App, AppMode, AppModelConfig, Conversation, IconType, Message, MessageAnnotation


class DummyGenerateEntity:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class DummyQueueManager:
    def __init__(self, *args, **kwargs):
        self.published = []

    def publish_error(self, error, pub_from):
        self.published.append((error, pub_from))

    def publish(self, event, pub_from):
        self.published.append((event, pub_from))


def _app() -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Chat app",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#ffffff",
        enable_site=False,
        enable_api=True,
    )


def _account() -> Account:
    account = Account(name="User", email="user-1@example.com")
    account.id = "user-1"
    return account


def _conversation() -> Conversation:
    conversation = Conversation(
        id="c1",
        app_id="app-1",
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.CHAT,
        name="Conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=None,
        from_account_id="user-1",
    )
    return conversation


def _message() -> Message:
    return Message(
        id="m1",
        app_id="app-1",
        conversation_id="c1",
        inputs={},
        query="hi",
        message={},
        message_tokens=0,
        message_unit_price=Decimal(0),
        message_price_unit=Decimal(0),
        answer="",
        answer_tokens=0,
        answer_unit_price=Decimal(0),
        answer_price_unit=Decimal(0),
        provider_response_latency=0,
        total_price=Decimal(0),
        currency="USD",
        invoke_from=InvokeFrom.SERVICE_API,
        from_source=ConversationFromSource.API,
        from_end_user_id=None,
        from_account_id="user-1",
        app_mode=AppMode.CHAT,
    )


def _persist_records(session: Session) -> tuple[App, Conversation, Message]:
    app = _app()
    conversation = _conversation()
    message = _message()
    session.add_all([app, conversation, message])
    session.commit()
    return app, conversation, message


@pytest.fixture(autouse=True)
def _bind_db_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(generator_module.db, "session", sqlite_session)


class TestChatAppGenerator:
    def test_generate_requires_query(self, unbound_session: Session):
        generator = ChatAppGenerator()
        with pytest.raises(ValueError):
            generator.generate(
                session=unbound_session,
                app_model=_app(),
                user=_account(),
                args={"inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
            )

    def test_generate_rejects_non_string_query(self, unbound_session: Session):
        generator = ChatAppGenerator()
        with pytest.raises(ValueError):
            generator.generate(
                session=unbound_session,
                app_model=_app(),
                user=_account(),
                args={"query": 1, "inputs": {}},
                invoke_from=InvokeFrom.SERVICE_API,
                streaming=False,
            )

    def test_generate_debugger_overrides_model_config(self, unbound_session: Session):
        generator = ChatAppGenerator()
        app_model = _app()
        user = _account()
        args = {
            "query": "hi",
            "inputs": {},
            "conversation_id": "conversation-1",
            "model_config": {"foo": "bar"},
            "trace_session_id": "session-1",
        }

        with (
            patch(
                "core.app.apps.chat.app_generator.ConversationService.get_conversation", return_value=None
            ) as get_conversation,
            patch("core.app.apps.chat.app_generator.ChatAppConfigManager.config_validate", return_value={"x": 1}),
            patch(
                "core.app.apps.chat.app_generator.ChatAppConfigManager.get_app_config",
                return_value=SimpleNamespace(
                    variables=[], external_data_variables=[], app_model_config_dict={}, app_mode=AppMode.CHAT
                ),
            ),
            patch("core.app.apps.chat.app_generator.ModelConfigConverter.convert", return_value=SimpleNamespace()),
            patch("core.app.apps.chat.app_generator.FileUploadConfigManager.convert", return_value=None),
            patch("core.app.apps.chat.app_generator.file_factory.build_from_mappings", return_value=[]),
            patch(
                "core.app.apps.chat.app_generator.ChatAppGenerateEntity",
                Mock(side_effect=DummyGenerateEntity),
            ) as generate_entity,
            patch("core.app.apps.chat.app_generator.TraceQueueManager", return_value=SimpleNamespace()),
            patch("core.app.apps.chat.app_generator.MessageBasedAppQueueManager", DummyQueueManager),
            patch(
                "core.app.apps.chat.app_generator.ChatAppGenerateResponseConverter.convert", return_value={"ok": True}
            ),
            patch.object(ChatAppGenerator, "_get_app_model_config", return_value=AppModelConfig(app_id="app-1")),
            patch.object(ChatAppGenerator, "_prepare_user_inputs", return_value={}),
            patch.object(
                ChatAppGenerator,
                "_init_generate_records",
                return_value=(_conversation(), _message()),
            ),
            patch.object(ChatAppGenerator, "_handle_response", return_value={"response": True}),
            patch("core.app.apps.chat.app_generator.copy_current_request_context", side_effect=lambda f: f),
            patch("core.app.apps.chat.app_generator.threading.Thread") as mock_thread,
        ):
            mock_thread.return_value.start.return_value = None
            result = generator.generate(
                app_model, user, args, InvokeFrom.DEBUGGER, streaming=False, session=unbound_session
            )

        assert result == {"ok": True}
        assert get_conversation.call_args.kwargs["session"] is unbound_session
        assert generate_entity.call_args.kwargs["extras"]["trace_session_id"] == "session-1"

    def test_generate_uses_session_for_annotation_reply(self, unbound_session: Session):
        generator = ChatAppGenerator()
        app_model = _app()
        app_model_config = AppModelConfig(app_id="app-1")
        annotation_reply = {"enabled": False}
        user = _account()

        with (
            patch.object(ChatAppGenerator, "_get_app_model_config", return_value=app_model_config),
            patch.object(AppModelConfig, "to_dict", return_value={}) as to_dict,
            patch(
                "core.app.apps.chat.app_generator.load_annotation_reply_config",
                return_value=annotation_reply,
            ) as load_annotation_reply_config,
            patch("core.app.apps.chat.app_generator.FileUploadConfigManager.convert", return_value=None),
            patch(
                "core.app.apps.chat.app_generator.ChatAppConfigManager.get_app_config",
                side_effect=RuntimeError("stop after app config"),
            ) as get_app_config,
        ):
            with pytest.raises(RuntimeError, match="stop after app config"):
                generator.generate(
                    app_model,
                    user,
                    {"query": "hi", "inputs": {}},
                    InvokeFrom.WEB_APP,
                    session=unbound_session,
                )

        load_annotation_reply_config.assert_called_once_with(unbound_session, "app-1")
        to_dict.assert_called_once_with(annotation_reply=annotation_reply)
        assert get_app_config.call_args.kwargs["annotation_reply"] is annotation_reply

    def test_generate_rejects_model_config_override_for_non_debugger(self, unbound_session: Session):
        generator = ChatAppGenerator()
        with pytest.raises(ValueError):
            with (
                patch.object(ChatAppGenerator, "_get_app_model_config", return_value=AppModelConfig(app_id="app-1")),
                patch.object(AppModelConfig, "to_dict", return_value={}),
            ):
                generator.generate(
                    session=unbound_session,
                    app_model=_app(),
                    user=_account(),
                    args={"query": "hi", "inputs": {}, "model_config": {"foo": "bar"}},
                    invoke_from=InvokeFrom.SERVICE_API,
                    streaming=False,
                )

    def test_generate_worker_handles_exceptions(self):
        generator = ChatAppGenerator()
        queue_manager = DummyQueueManager()
        entity = DummyGenerateEntity(task_id="t1", user_id="u1")

        with (
            patch.object(ChatAppGenerator, "_get_conversation", return_value=_conversation()),
            patch.object(ChatAppGenerator, "_get_message", return_value=_message()),
            patch("core.app.apps.chat.app_generator.ChatAppRunner.run", side_effect=InvokeAuthorizationError()),
        ):
            generator._generate_worker(
                flask_app=Mock(app_context=Mock(return_value=Mock(__enter__=Mock(), __exit__=Mock()))),
                application_generate_entity=entity,
                queue_manager=queue_manager,
                conversation_id="c1",
                message_id="m1",
            )

        assert queue_manager.published

        with (
            patch.object(ChatAppGenerator, "_get_conversation", return_value=_conversation()),
            patch.object(ChatAppGenerator, "_get_message", return_value=_message()),
            patch("core.app.apps.chat.app_generator.ChatAppRunner.run", side_effect=GenerateTaskStoppedError()),
        ):
            generator._generate_worker(
                flask_app=Mock(app_context=Mock(return_value=Mock(__enter__=Mock(), __exit__=Mock()))),
                application_generate_entity=entity,
                queue_manager=queue_manager,
                conversation_id="c1",
                message_id="m1",
            )


class TestChatAppRunner:
    def test_run_raises_when_app_missing(self, sqlite_session: Session):
        runner = ChatAppRunner()
        app_config = SimpleNamespace(
            app_id="app-1", tenant_id="tenant-1", prompt_template=None, external_data_variables=[]
        )
        app_generate_entity = DummyGenerateEntity(
            app_config=app_config,
            model_conf=SimpleNamespace(provider_model_bundle=None, model=None, parameters={}, app_model_config_dict={}),
            inputs={},
            query="hi",
            files=[],
            file_upload_config=None,
            conversation_id=None,
            stream=False,
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        with pytest.raises(ValueError):
            runner.run(
                app_generate_entity,
                DummyQueueManager(),
                _conversation(),
                _message(),
                sqlite_session,
            )

    def test_run_moderation_error_direct_output(self, sqlite_session: Session):
        _, conversation, message = _persist_records(sqlite_session)
        runner = ChatAppRunner()
        app_config = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            app_mode=AppMode.CHAT,
            prompt_template=None,
            external_data_variables=[],
            dataset=None,
            additional_features=None,
        )
        app_generate_entity = DummyGenerateEntity(
            app_config=app_config,
            model_conf=SimpleNamespace(provider_model_bundle=None, model=None, parameters={}, app_model_config_dict={}),
            inputs={},
            query="hi",
            files=[],
            file_upload_config=None,
            conversation_id=None,
            stream=False,
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        with (
            patch.object(ChatAppRunner, "organize_prompt_messages", return_value=([], [])),
            patch.object(ChatAppRunner, "moderation_for_inputs", side_effect=ModerationError("blocked")),
            patch.object(ChatAppRunner, "direct_output") as mock_direct,
        ):
            runner.run(
                app_generate_entity,
                DummyQueueManager(),
                conversation,
                message,
                sqlite_session,
            )

        mock_direct.assert_called_once()

    def test_run_annotation_reply_short_circuits(self, sqlite_session: Session):
        _, conversation, message = _persist_records(sqlite_session)
        runner = ChatAppRunner()
        app_config = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            app_mode=AppMode.CHAT,
            prompt_template=None,
            external_data_variables=[],
            dataset=None,
            additional_features=None,
        )
        app_generate_entity = DummyGenerateEntity(
            app_config=app_config,
            model_conf=SimpleNamespace(provider_model_bundle=None, model=None, parameters={}, app_model_config_dict={}),
            inputs={},
            query="hi",
            files=[],
            file_upload_config=None,
            conversation_id=None,
            stream=False,
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        annotation = MessageAnnotation(
            app_id="app-1",
            question="hi",
            content="answer",
            account_id="user-1",
        )

        with (
            patch.object(ChatAppRunner, "organize_prompt_messages", return_value=([], [])),
            patch.object(ChatAppRunner, "moderation_for_inputs", return_value=(None, {}, "hi")),
            patch.object(ChatAppRunner, "query_app_annotations_to_reply", return_value=annotation) as annotation_query,
            patch.object(ChatAppRunner, "direct_output") as mock_direct,
        ):
            queue_manager = DummyQueueManager()
            runner.run(app_generate_entity, queue_manager, conversation, message, sqlite_session)

        assert any(isinstance(item[0], QueueAnnotationReplyEvent) for item in queue_manager.published)
        assert annotation_query.call_args.kwargs["session"] is sqlite_session
        mock_direct.assert_called_once()

    def test_run_returns_when_hosting_moderation_blocks(self, sqlite_session: Session):
        _, conversation, message = _persist_records(sqlite_session)
        runner = ChatAppRunner()
        app_config = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            prompt_template=None,
            external_data_variables=[],
            dataset=None,
            additional_features=None,
        )
        app_generate_entity = DummyGenerateEntity(
            app_config=app_config,
            model_conf=SimpleNamespace(provider_model_bundle=None, model=None, parameters={}, app_model_config_dict={}),
            inputs={},
            query="hi",
            files=[],
            file_upload_config=None,
            conversation_id=None,
            stream=False,
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        with (
            patch.object(ChatAppRunner, "organize_prompt_messages", return_value=([], [])),
            patch.object(ChatAppRunner, "moderation_for_inputs", return_value=(None, {}, "hi")),
            patch.object(ChatAppRunner, "query_app_annotations_to_reply", return_value=None),
            patch.object(ChatAppRunner, "check_hosting_moderation", return_value=True),
        ):
            runner.run(
                app_generate_entity,
                DummyQueueManager(),
                conversation,
                message,
                sqlite_session,
            )

    def test_run_closes_explicit_session_before_stream_consumption(self, sqlite_session: Session):
        _, conversation, message = _persist_records(sqlite_session)
        runner = ChatAppRunner()
        app_config = SimpleNamespace(
            app_id="app-1",
            tenant_id="tenant-1",
            app_mode=AppMode.CHAT,
            prompt_template=None,
            external_data_variables=[],
            dataset=None,
            additional_features=None,
        )
        app_generate_entity = DummyGenerateEntity(
            app_config=app_config,
            model_conf=SimpleNamespace(provider_model_bundle=None, model="model-1", parameters={}),
            inputs={},
            query="hi",
            files=[],
            file_upload_config=None,
            conversation_id=None,
            stream=True,
            user_id="user-1",
            invoke_from=InvokeFrom.SERVICE_API,
        )

        events = []
        queue_manager = DummyQueueManager()
        model_instance = MagicMock()

        def record_commit(_session: Session) -> None:
            events.append("commit")

        def invoke_stream():
            events.append("first-chunk")
            yield "chunk"

        def invoke_llm(**kwargs):
            events.append("invoke")
            return invoke_stream()

        event.listen(sqlite_session, "after_commit", record_commit)
        try:
            with (
                patch.object(ChatAppRunner, "organize_prompt_messages", return_value=([], [])),
                patch.object(ChatAppRunner, "moderation_for_inputs", return_value=(None, {}, "hi")),
                patch.object(ChatAppRunner, "query_app_annotations_to_reply", return_value=None),
                patch.object(ChatAppRunner, "check_hosting_moderation", return_value=False),
                patch.object(ChatAppRunner, "recalc_llm_max_tokens"),
                patch.object(
                    ChatAppRunner,
                    "_handle_invoke_result",
                    side_effect=lambda invoke_result, **kwargs: list(invoke_result),
                ) as mock_handle,
                patch("core.app.apps.chat.app_runner.ModelInstance", return_value=model_instance),
            ):
                model_instance.invoke_llm.side_effect = invoke_llm
                runner.run(app_generate_entity, queue_manager, conversation, message, sqlite_session)
        finally:
            event.remove(sqlite_session, "after_commit", record_commit)

        assert events == ["commit", "commit", "invoke", "first-chunk"]
        mock_handle.assert_called_once_with(
            invoke_result=ANY,
            queue_manager=queue_manager,
            stream=True,
            message_id="m1",
            user_id="user-1",
            tenant_id="tenant-1",
        )
