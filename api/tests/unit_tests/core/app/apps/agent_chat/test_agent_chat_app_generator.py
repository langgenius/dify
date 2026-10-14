import contextlib
import contextvars
import inspect
import logging
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from decimal import Decimal

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core.app.app_config.entities import PromptTemplateEntity
from core.app.apps.agent_chat.app_config_manager import AgentChatAppConfig
from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.agent_chat.app_runner import AgentChatAppRunner
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    InvokeFrom,
    ModelConfigWithCredentialsEntity,
)
from core.ops.ops_trace_manager import TraceQueueManager
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from models import Account
from models.enums import ConversationFromSource
from models.model import App, AppMode, AppModelConfig, Conversation, Message
from tests.unit_tests.config_override import apply_config_overrides


@dataclass(frozen=True)
class RecordedCall:
    args: tuple[object, ...]
    kwargs: dict[str, object]


@dataclass
class CallRecorder[T]:
    """Callable test implementation that retains arguments and returns a configured value."""

    result: T
    calls: list[RecordedCall] = field(default_factory=list)

    def __call__(self, *args: object, **kwargs: object) -> T:
        self.calls.append(RecordedCall(args=args, kwargs=kwargs))
        return self.result


class RecordingTraceQueueManager(TraceQueueManager):
    """Trace manager with the real public shape and no background timer."""

    def __init__(self, app_id: str | None = None, user_id: str | None = None) -> None:
        self.app_id = app_id
        self.user_id = user_id


class RecordingQueueManager(MessageBasedAppQueueManager):
    def __init__(self, **kwargs: object) -> None:
        self.init_kwargs = kwargs
        self.published_errors: list[tuple[Exception, object]] = []

    def publish_error(self, error: Exception, publish_from: object) -> None:
        self.published_errors.append((error, publish_from))


class RecordingThread(threading.Thread):
    def __init__(self, *, target: object, kwargs: dict[str, object]) -> None:
        self.target = target
        self.kwargs = kwargs
        self.started = False

    def start(self) -> None:
        self.started = True


@dataclass
class RecordingThreadFactory:
    threads: list[RecordingThread] = field(default_factory=list)

    def __call__(self, *, target: object, kwargs: dict[str, object]) -> RecordingThread:
        thread = RecordingThread(target=target, kwargs=kwargs)
        self.threads.append(thread)
        return thread


def _app_config() -> AgentChatAppConfig:
    return AgentChatAppConfig.model_construct(
        tenant_id="tenant",
        app_id="app1",
        app_mode=AppMode.AGENT_CHAT,
        variables=[],
        prompt_template=PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="You are helpful.",
        ),
        external_data_variables=[],
    )


def _model_config() -> ModelConfigWithCredentialsEntity:
    return ModelConfigWithCredentialsEntity.model_construct(provider="provider", model="model", mode="chat")


def _generate_entity() -> AgentChatAppGenerateEntity:
    return AgentChatAppGenerateEntity.model_construct(
        task_id="task",
        app_config=_app_config(),
        model_conf=_model_config(),
        inputs={},
        query="hello",
        files=[],
        user_id="user",
        stream=True,
        invoke_from=InvokeFrom.WEB_APP,
    )


def _runner_raising(error: Exception) -> type:
    class FailingRunner(AgentChatAppRunner):
        def run(self, **kwargs: object) -> None:
            _ = kwargs
            raise error

    return FailingRunner


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
def generator() -> Iterator[AgentChatAppGenerator]:
    app = Flask(__name__)
    with app.app_context():
        yield AgentChatAppGenerator()


class TestAgentChatAppGeneratorGenerate:
    def test_generate_rejects_blocking_mode(self, generator: AgentChatAppGenerator, sqlite_session: Session):
        app_model = _app()
        user = _account()
        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=app_model,
                user=user,
                args={},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=False,
            )

    def test_generate_requires_query(self, generator: AgentChatAppGenerator, sqlite_session: Session):
        app_model = _app()
        user = _account()
        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=app_model,
                user=user,
                args={"inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_rejects_non_string_query(self, generator: AgentChatAppGenerator, sqlite_session: Session):
        app_model = _app()
        user = _account()
        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=app_model,
                user=user,
                args={"query": 123, "inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_override_requires_debugger(
        self, generator: AgentChatAppGenerator, sqlite_session: Session
    ) -> None:
        app_model = _app()
        user = _account()
        generator._get_app_model_config = CallRecorder(AppModelConfig(app_id="app1"))  # type: ignore[method-assign]

        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=app_model,
                user=user,
                args={"query": "hi", "inputs": {}, "model_config": {"model": {"provider": "p"}}},
                invoke_from=InvokeFrom.WEB_APP,
            )

    def test_generate_success_with_debugger_override(
        self, generator: AgentChatAppGenerator, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ) -> None:
        app_model = _app()
        app_model_config = AppModelConfig(app_id="app1")

        user = _account()
        invoke_from = InvokeFrom.DEBUGGER

        get_model_config = CallRecorder(app_model_config)
        prepare_inputs = CallRecorder({"x": 1})
        init_records = CallRecorder((_conversation(), _message()))
        handle_response = CallRecorder("response")
        generator._get_app_model_config = get_model_config  # type: ignore[method-assign]
        generator._prepare_user_inputs = prepare_inputs  # type: ignore[method-assign]
        generator._init_generate_records = init_records  # type: ignore[method-assign]
        generator._handle_response = handle_response  # type: ignore[method-assign]

        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.AgentChatAppConfigManager.config_validate",
            CallRecorder({"validated": True}),
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.AgentChatAppConfigManager.get_app_config",
            CallRecorder(_app_config()),
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.ModelConfigConverter.convert", CallRecorder(_model_config())
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.FileUploadConfigManager.convert", CallRecorder(None)
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.ConversationService.get_conversation",
            CallRecorder(_conversation()),
        )
        monkeypatch.setattr("core.app.apps.agent_chat.app_generator.TraceQueueManager", RecordingTraceQueueManager)
        monkeypatch.setattr("core.app.apps.agent_chat.app_generator.MessageBasedAppQueueManager", RecordingQueueManager)

        thread_factory = RecordingThreadFactory()
        monkeypatch.setattr("core.app.apps.agent_chat.app_generator.threading.Thread", thread_factory)
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.AgentChatAppGenerateResponseConverter.convert",
            CallRecorder({"result": "ok"}),
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
        assert get_model_config.calls[-1].kwargs["session"] is session
        assert init_records.calls[-1].kwargs["session"] is session
        thread = thread_factory.threads[0]
        entity = thread.kwargs["application_generate_entity"]
        assert isinstance(entity, AgentChatAppGenerateEntity)
        assert entity.extras["trace_session_id"] == "session-1"
        inspect.signature(thread.target).bind(**thread.kwargs)
        assert thread.started is True

    def test_generate_without_file_config(
        self, generator: AgentChatAppGenerator, monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ) -> None:
        app_model = _app()
        app_model_config = AppModelConfig(app_id="app1")
        annotation_reply = {"enabled": False}

        user = _account()

        generator._get_app_model_config = CallRecorder(app_model_config)  # type: ignore[method-assign]
        generator._prepare_user_inputs = CallRecorder({"x": 1})  # type: ignore[method-assign]
        generator._init_generate_records = CallRecorder((_conversation(), _message()))  # type: ignore[method-assign]
        generator._handle_response = CallRecorder("response")  # type: ignore[method-assign]

        to_dict = CallRecorder({"model": {"provider": "p"}})
        monkeypatch.setattr(AppModelConfig, "to_dict", to_dict)

        load_annotation_reply_config = CallRecorder(annotation_reply)
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.load_annotation_reply_config",
            load_annotation_reply_config,
        )
        get_app_config = CallRecorder(_app_config())
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.AgentChatAppConfigManager.get_app_config",
            get_app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.ModelConfigConverter.convert",
            CallRecorder(_model_config()),
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.FileUploadConfigManager.convert",
            CallRecorder(None),
        )
        monkeypatch.setattr("core.app.apps.agent_chat.app_generator.TraceQueueManager", RecordingTraceQueueManager)
        monkeypatch.setattr("core.app.apps.agent_chat.app_generator.MessageBasedAppQueueManager", RecordingQueueManager)

        thread_factory = RecordingThreadFactory()
        monkeypatch.setattr("core.app.apps.agent_chat.app_generator.threading.Thread", thread_factory)

        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.AgentChatAppGenerateResponseConverter.convert",
            CallRecorder({"result": "ok"}),
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
        assert load_annotation_reply_config.calls == [RecordedCall(args=(session, "app1"), kwargs={})]
        assert to_dict.calls == [RecordedCall(args=(), kwargs={"annotation_reply": annotation_reply})]
        assert get_app_config.calls[-1].kwargs["annotation_reply"] is annotation_reply
        assert thread_factory.threads[0].started is True


class TestAgentChatAppGeneratorWorker:
    @pytest.fixture(autouse=True)
    def patch_context(self, monkeypatch: pytest.MonkeyPatch) -> None:
        @contextlib.contextmanager
        def ctx_manager[**P](*args: P.args, **kwargs: P.kwargs):
            yield

        monkeypatch.setattr("core.app.apps.agent_chat.app_generator.preserve_flask_contexts", ctx_manager)

    def test_generate_worker_handles_generate_task_stopped(
        self, generator: AgentChatAppGenerator, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        queue_manager = RecordingQueueManager()
        generator._get_conversation = CallRecorder(_conversation())  # type: ignore[method-assign]
        generator._get_message = CallRecorder(_message())  # type: ignore[method-assign]

        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.AgentChatAppRunner",
            _runner_raising(GenerateTaskStoppedError()),
        )

        generator._generate_worker(
            flask_app=Flask("worker"),
            context=contextvars.copy_context(),
            application_generate_entity=_generate_entity(),
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
        )

        assert queue_manager.published_errors == []

    @pytest.mark.parametrize(
        "error",
        [
            InvokeAuthorizationError("bad"),
            ValidationError.from_exception_data("TestModel", []),
            ValueError("bad"),
            Exception("bad"),
        ],
    )
    def test_generate_worker_publishes_errors(
        self,
        generator: AgentChatAppGenerator,
        monkeypatch: pytest.MonkeyPatch,
        error: Exception,
    ) -> None:
        queue_manager = RecordingQueueManager()
        generator._get_conversation = CallRecorder(_conversation())  # type: ignore[method-assign]
        generator._get_message = CallRecorder(_message())  # type: ignore[method-assign]

        monkeypatch.setattr("core.app.apps.agent_chat.app_generator.AgentChatAppRunner", _runner_raising(error))

        generator._generate_worker(
            flask_app=Flask("worker"),
            context=contextvars.copy_context(),
            application_generate_entity=_generate_entity(),
            queue_manager=queue_manager,
            conversation_id="conv",
            message_id="msg",
        )

        assert len(queue_manager.published_errors) == 1
        assert isinstance(queue_manager.published_errors[0][0], type(error))

    def test_generate_worker_logs_value_error_when_debug(
        self,
        generator: AgentChatAppGenerator,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        queue_manager = RecordingQueueManager()
        generator._get_conversation = CallRecorder(_conversation())  # type: ignore[method-assign]
        generator._get_message = CallRecorder(_message())  # type: ignore[method-assign]

        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.AgentChatAppRunner", _runner_raising(ValueError("bad"))
        )

        apply_config_overrides(monkeypatch, DEBUG=True)

        with caplog.at_level(logging.ERROR, logger="core.app.apps.agent_chat.app_generator"):
            generator._generate_worker(
                flask_app=Flask("worker"),
                context=contextvars.copy_context(),
                application_generate_entity=_generate_entity(),
                queue_manager=queue_manager,
                conversation_id="conv",
                message_id="msg",
            )

        assert "Error when generating" in caplog.messages
