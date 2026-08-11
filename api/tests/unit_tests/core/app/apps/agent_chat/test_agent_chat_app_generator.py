import contextlib
import inspect
import logging
from decimal import Decimal

import pytest
from pydantic import ValidationError
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from models import Account
from models.enums import ConversationFromSource
from models.model import App, AppMode, AppModelConfig, Conversation, Message


def _app() -> App:
    return App(
        id="app1",
        tenant_id="tenant",
        name="Agent chat app",
        description="",
        mode=AppMode.AGENT_CHAT,
        enable_site=False,
        enable_api=False,
    )


def _account() -> Account:
    account = Account(name="User", email="user@example.com")
    account.id = "user"
    return account


def _conversation() -> Conversation:
    conversation = Conversation(
        id="conv",
        app_id="app1",
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.AGENT_CHAT,
        name="Conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.WEB_APP,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id="user",
    )
    return conversation


def _message() -> Message:
    return Message(
        id="msg",
        app_id="app1",
        conversation_id="conv",
        inputs={},
        query="hello",
        message={},
        message_unit_price=Decimal(0),
        answer="",
        answer_unit_price=Decimal(0),
        total_price=Decimal(0),
        currency="USD",
        invoke_from=InvokeFrom.WEB_APP,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id="user",
        app_mode=AppMode.AGENT_CHAT,
    )


@pytest.fixture
def generator(mocker: MockerFixture):
    gen = AgentChatAppGenerator()
    mocker.patch(
        "core.app.apps.agent_chat.app_generator.current_app",
        new=mocker.MagicMock(_get_current_object=mocker.MagicMock()),
    )
    mocker.patch("core.app.apps.agent_chat.app_generator.contextvars.copy_context", return_value="ctx")
    return gen


class TestAgentChatAppGeneratorGenerate:
    def test_generate_rejects_blocking_mode(self, generator, mocker: MockerFixture, sqlite_session: Session):
        app_model = _app()
        user = _account()
        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=app_model,
                user=user,
                args={},
                invoke_from=mocker.MagicMock(),
                streaming=False,
            )

    def test_generate_requires_query(self, generator, mocker: MockerFixture, sqlite_session: Session):
        app_model = _app()
        user = _account()
        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=app_model,
                user=user,
                args={"inputs": {}},
                invoke_from=mocker.MagicMock(),
            )

    def test_generate_rejects_non_string_query(self, generator, mocker: MockerFixture, sqlite_session: Session):
        app_model = _app()
        user = _account()
        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=app_model,
                user=user,
                args={"query": 123, "inputs": {}},
                invoke_from=mocker.MagicMock(),
            )

    def test_generate_override_requires_debugger(self, generator, mocker: MockerFixture, sqlite_session: Session):
        app_model = _app()
        user = _account()
        generator._get_app_model_config = mocker.MagicMock(return_value=AppModelConfig(app_id="app1"))

        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=app_model,
                user=user,
                args={"query": "hi", "inputs": {}, "model_config": {"model": {"provider": "p"}}},
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_success_with_debugger_override(self, generator, mocker: MockerFixture, sqlite_session: Session):
        app_model = _app()
        app_model_config = AppModelConfig(app_id="app1")

        user = _account()
        invoke_from = InvokeFrom.DEBUGGER

        generator._get_app_model_config = mocker.MagicMock(return_value=app_model_config)
        generator._prepare_user_inputs = mocker.MagicMock(return_value={"x": 1})
        generator._init_generate_records = mocker.MagicMock(return_value=(_conversation(), _message()))
        generator._handle_response = mocker.MagicMock(return_value="response")

        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppConfigManager.config_validate",
            return_value={"validated": True},
        )
        app_config = mocker.MagicMock(variables={}, prompt_template=mocker.MagicMock(), external_data_variables=[])
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppConfigManager.get_app_config",
            return_value=app_config,
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.ModelConfigConverter.convert",
            return_value=mocker.MagicMock(),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.FileUploadConfigManager.convert",
            return_value=mocker.MagicMock(),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.file_factory.build_from_mappings",
            return_value=["file-obj"],
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.ConversationService.get_conversation",
            return_value=_conversation(),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.TraceQueueManager",
            return_value=mocker.MagicMock(),
        )

        queue_manager = mocker.MagicMock()
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.MessageBasedAppQueueManager",
            return_value=queue_manager,
        )

        thread_obj = mocker.MagicMock()
        thread_constructor = mocker.patch(
            "core.app.apps.agent_chat.app_generator.threading.Thread",
            return_value=thread_obj,
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppGenerateResponseConverter.convert",
            return_value={"result": "ok"},
        )
        app_entity = mocker.MagicMock(task_id="task", user_id="user", invoke_from=invoke_from)
        generate_entity = mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppGenerateEntity",
            return_value=app_entity,
        )

        args = {
            "query": "hello",
            "inputs": {"name": "world"},
            "conversation_id": "conv",
            "model_config": {"model": {"provider": "p"}},
            "files": [{"id": "f1"}],
            "trace_session_id": "session-1",
        }
        session = sqlite_session

        result = generator.generate(
            session=session,
            app_model=app_model,
            user=user,
            args=args,
            invoke_from=invoke_from,
            streaming=True,
        )

        assert result == {"result": "ok"}
        assert generator._get_app_model_config.call_args.kwargs["session"] is session
        assert generator._init_generate_records.call_args.kwargs["session"] is session
        assert generate_entity.call_args.kwargs["extras"]["trace_session_id"] == "session-1"
        worker_call = thread_constructor.call_args
        inspect.signature(worker_call.kwargs["target"]).bind(**worker_call.kwargs["kwargs"])
        thread_obj.start.assert_called_once()

    def test_generate_without_file_config(self, generator, mocker: MockerFixture, sqlite_session: Session):
        app_model = _app()
        app_model_config = AppModelConfig(app_id="app1")
        annotation_reply = {"enabled": False}

        user = _account()

        generator._get_app_model_config = mocker.MagicMock(return_value=app_model_config)
        generator._prepare_user_inputs = mocker.MagicMock(return_value={"x": 1})
        generator._init_generate_records = mocker.MagicMock(return_value=(_conversation(), _message()))
        generator._handle_response = mocker.MagicMock(return_value="response")

        to_dict = mocker.patch.object(AppModelConfig, "to_dict", return_value={"model": {"provider": "p"}})

        load_annotation_reply_config = mocker.patch(
            "core.app.apps.agent_chat.app_generator.load_annotation_reply_config",
            return_value=annotation_reply,
        )
        get_app_config = mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppConfigManager.get_app_config",
            return_value=mocker.MagicMock(variables={}, prompt_template=mocker.MagicMock(), external_data_variables=[]),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.ModelConfigConverter.convert",
            return_value=mocker.MagicMock(),
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.FileUploadConfigManager.convert",
            return_value=None,
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.file_factory.build_from_mappings",
            return_value=["file-obj"],
        )
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.TraceQueueManager",
            return_value=mocker.MagicMock(),
        )

        mocker.patch(
            "core.app.apps.agent_chat.app_generator.MessageBasedAppQueueManager",
            return_value=mocker.MagicMock(),
        )

        thread_obj = mocker.MagicMock()
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.threading.Thread",
            return_value=thread_obj,
        )

        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppGenerateResponseConverter.convert",
            return_value={"result": "ok"},
        )
        app_entity = mocker.MagicMock(task_id="task", user_id="user", invoke_from=InvokeFrom.WEB_APP)
        mocker.patch(
            "core.app.apps.agent_chat.app_generator.AgentChatAppGenerateEntity",
            return_value=app_entity,
        )

        args = {"query": "hello", "inputs": {"name": "world"}}
        session = sqlite_session

        result = generator.generate(
            session=session,
            app_model=app_model,
            user=user,
            args=args,
            invoke_from=InvokeFrom.WEB_APP,
            streaming=True,
        )

        assert result == {"result": "ok"}
        load_annotation_reply_config.assert_called_once_with(session, "app1")
        to_dict.assert_called_once_with(annotation_reply=annotation_reply)
        assert get_app_config.call_args.kwargs["annotation_reply"] is annotation_reply


class TestAgentChatAppGeneratorWorker:
    @pytest.fixture(autouse=True)
    def patch_context(self, mocker: MockerFixture):
        @contextlib.contextmanager
        def ctx_manager(*args, **kwargs):
            yield

        mocker.patch("core.app.apps.agent_chat.app_generator.preserve_flask_contexts", ctx_manager)

    def test_generate_worker_handles_generate_task_stopped(self, generator, mocker: MockerFixture):
        queue_manager = mocker.MagicMock()
        generator._get_conversation = mocker.MagicMock(return_value=_conversation())
        generator._get_message = mocker.MagicMock(return_value=_message())

        runner = mocker.MagicMock()
        runner.run.side_effect = GenerateTaskStoppedError()
        mocker.patch("core.app.apps.agent_chat.app_generator.AgentChatAppRunner", return_value=runner)

        generator._generate_worker(
            flask_app=mocker.MagicMock(),
            context=mocker.MagicMock(),
            application_generate_entity=mocker.MagicMock(),
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
        )

        queue_manager.publish_error.assert_not_called()

    @pytest.mark.parametrize(
        "error",
        [
            InvokeAuthorizationError("bad"),
            ValidationError.from_exception_data("TestModel", []),
            ValueError("bad"),
            Exception("bad"),
        ],
    )
    def test_generate_worker_publishes_errors(self, generator, mocker: MockerFixture, error):
        queue_manager = mocker.MagicMock()
        generator._get_conversation = mocker.MagicMock(return_value=_conversation())
        generator._get_message = mocker.MagicMock(return_value=_message())

        runner = mocker.MagicMock()
        runner.run.side_effect = error
        mocker.patch("core.app.apps.agent_chat.app_generator.AgentChatAppRunner", return_value=runner)

        generator._generate_worker(
            flask_app=mocker.MagicMock(),
            context=mocker.MagicMock(),
            application_generate_entity=mocker.MagicMock(),
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
        )

        assert queue_manager.publish_error.called

    def test_generate_worker_logs_value_error_when_debug(
        self,
        generator,
        mocker: MockerFixture,
        caplog: pytest.LogCaptureFixture,
    ):
        queue_manager = mocker.MagicMock()
        generator._get_conversation = mocker.MagicMock(return_value=_conversation())
        generator._get_message = mocker.MagicMock(return_value=_message())

        runner = mocker.MagicMock()
        runner.run.side_effect = ValueError("bad")
        mocker.patch("core.app.apps.agent_chat.app_generator.AgentChatAppRunner", return_value=runner)

        mocker.patch("core.app.apps.agent_chat.app_generator.dify_config", new=mocker.MagicMock(DEBUG=True))

        with caplog.at_level(logging.ERROR, logger="core.app.apps.agent_chat.app_generator"):
            generator._generate_worker(
                flask_app=mocker.MagicMock(),
                context=mocker.MagicMock(),
                application_generate_entity=mocker.MagicMock(),
                queue_manager=queue_manager,
                conversation_id="conv",
                message_id="msg",
            )

        assert "Error when generating" in caplog.messages
