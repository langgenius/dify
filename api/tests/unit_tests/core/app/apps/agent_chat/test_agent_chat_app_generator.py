import contextvars
import logging
import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session

from core.app.apps.agent_chat.app_generator import AgentChatAppGenerator
from core.app.apps.agent_chat.app_runner import AgentChatAppRunner
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import (
    AgentChatAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.queue_entities import QueueErrorEvent
from core.ops.ops_trace_manager import TraceQueueManager
from graphon.model_runtime.errors.invoke import InvokeAuthorizationError
from models import Account
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


@pytest.fixture
def generator(
    agent_runtime_app: Flask,
    agent_queue_manager: MessageBasedAppQueueManager,
    agent_records: tuple[Conversation, Message],
    monkeypatch: pytest.MonkeyPatch,
) -> AgentChatAppGenerator:
    assert agent_runtime_app.name
    assert agent_queue_manager is not None
    assert agent_records[0].id == "conv"
    # Keep trace configuration lookup and initialization real, but do not schedule background timers.
    monkeypatch.setattr(TraceQueueManager, "start_timer", lambda _manager: None)
    return AgentChatAppGenerator()


@pytest.fixture
def scheduled_threads(generator: AgentChatAppGenerator, monkeypatch: pytest.MonkeyPatch) -> list[threading.Thread]:
    """Capture OS scheduling; tests drive the real Thread.run and generator worker synchronously."""
    threads: list[threading.Thread] = []
    initialize = threading.Thread.__init__
    start = threading.Thread.start

    def initialize_thread(
        thread: threading.Thread,
        group: None = None,
        target: Callable[..., object] | None = None,
        name: str | None = None,
        args: Iterable[object] = (),
        kwargs: Mapping[str, object] | None = None,
        *,
        daemon: bool | None = None,
    ) -> None:
        initialize(thread, group=group, target=target, name=name, args=args, kwargs=kwargs, daemon=daemon)
        if target == generator._generate_worker:
            threads.append(thread)

    def defer_start(thread: threading.Thread) -> None:
        if thread not in threads:
            # Resource detectors also use threads; preserve their normal scheduling.
            start(thread)

    monkeypatch.setattr(threading.Thread, "__init__", initialize_thread)
    monkeypatch.setattr(threading.Thread, "start", defer_start)
    return threads


def _raise_in_runner(monkeypatch: pytest.MonkeyPatch, error: Exception) -> None:
    def fail(_runner: AgentChatAppRunner, **_kwargs: object) -> None:
        raise error

    monkeypatch.setattr(AgentChatAppRunner, "run", fail)


class TestAgentChatAppGeneratorGenerate:
    def test_generate_rejects_blocking_mode(self, generator: AgentChatAppGenerator, sqlite_session: Session) -> None:
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

    def test_generate_requires_query(self, generator: AgentChatAppGenerator, sqlite_session: Session) -> None:
        app_model = _app()
        user = _account()
        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=app_model,
                user=user,
                args={"inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=True,
            )

    def test_generate_rejects_non_string_query(self, generator: AgentChatAppGenerator, sqlite_session: Session) -> None:
        app_model = _app()
        user = _account()
        with pytest.raises(ValueError):
            generator.generate(
                session=sqlite_session,
                app_model=app_model,
                user=user,
                args={"query": 123, "inputs": {}},
                invoke_from=InvokeFrom.WEB_APP,
                streaming=True,
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
                streaming=True,
            )

    def test_generate_success_with_debugger_override(
        self,
        generator: AgentChatAppGenerator,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_records: tuple[Conversation, Message],
        scheduled_threads: list[threading.Thread],
    ) -> None:
        app_model = _app()
        app_model_config = AppModelConfig(app_id="app1")

        user = _account()
        invoke_from = InvokeFrom.DEBUGGER

        get_model_config = CallRecorder(app_model_config)
        prepare_inputs = CallRecorder({"x": 1})
        init_records = CallRecorder(agent_records)
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
            CallRecorder(agent_generate_entity.app_config),
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.ModelConfigConverter.convert",
            CallRecorder(agent_generate_entity.model_conf),
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.FileUploadConfigManager.convert", CallRecorder(None)
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.ConversationService.get_conversation",
            CallRecorder(agent_records[0]),
        )
        runner_calls: list[dict[str, object]] = []

        def observe_runner(_runner: AgentChatAppRunner, **kwargs: object) -> None:
            runner_calls.append(kwargs)

        monkeypatch.setattr(AgentChatAppRunner, "run", observe_runner)
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
        assert len(scheduled_threads) == 1
        thread = scheduled_threads[0]
        assert type(thread) is threading.Thread
        thread.run()
        assert len(runner_calls) == 1
        entity = runner_calls[0]["application_generate_entity"]
        assert isinstance(entity, AgentChatAppGenerateEntity)
        assert entity.extras["trace_session_id"] == "session-1"
        assert type(entity.trace_manager) is TraceQueueManager
        assert entity.trace_manager.trace_instance is None
        assert entity.trace_manager.app_id == "app1"
        assert type(runner_calls[0]["queue_manager"]) is MessageBasedAppQueueManager
        conversation = runner_calls[0]["conversation"]
        message = runner_calls[0]["message"]
        assert isinstance(conversation, Conversation)
        assert isinstance(message, Message)
        assert conversation.id == "conv"
        assert message.id == "msg"

    def test_generate_without_file_config(
        self,
        generator: AgentChatAppGenerator,
        monkeypatch: pytest.MonkeyPatch,
        sqlite_session: Session,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_records: tuple[Conversation, Message],
        scheduled_threads: list[threading.Thread],
    ) -> None:
        app_model = _app()
        app_model_config = AppModelConfig(app_id="app1")
        annotation_reply = {"enabled": False}

        user = _account()

        generator._get_app_model_config = CallRecorder(app_model_config)  # type: ignore[method-assign]
        generator._prepare_user_inputs = CallRecorder({"x": 1})  # type: ignore[method-assign]
        generator._init_generate_records = CallRecorder(agent_records)  # type: ignore[method-assign]
        generator._handle_response = CallRecorder("response")  # type: ignore[method-assign]

        to_dict = CallRecorder({"model": {"provider": "p"}})
        monkeypatch.setattr(AppModelConfig, "to_dict", to_dict)

        load_annotation_reply_config = CallRecorder(annotation_reply)
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.load_annotation_reply_config",
            load_annotation_reply_config,
        )
        get_app_config = CallRecorder(agent_generate_entity.app_config)
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.AgentChatAppConfigManager.get_app_config",
            get_app_config,
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.ModelConfigConverter.convert",
            CallRecorder(agent_generate_entity.model_conf),
        )
        monkeypatch.setattr(
            "core.app.apps.agent_chat.app_generator.FileUploadConfigManager.convert",
            CallRecorder(None),
        )
        runner_calls: list[dict[str, object]] = []

        def observe_runner(_runner: AgentChatAppRunner, **kwargs: object) -> None:
            runner_calls.append(kwargs)

        monkeypatch.setattr(AgentChatAppRunner, "run", observe_runner)

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
        assert len(scheduled_threads) == 1
        scheduled_threads[0].run()
        assert len(runner_calls) == 1
        assert type(runner_calls[0]["queue_manager"]) is MessageBasedAppQueueManager


class TestAgentChatAppGeneratorWorker:
    def test_generate_worker_handles_generate_task_stopped(
        self,
        generator: AgentChatAppGenerator,
        monkeypatch: pytest.MonkeyPatch,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
        agent_runtime_app: Flask,
    ) -> None:
        _raise_in_runner(monkeypatch, GenerateTaskStoppedError())

        generator._generate_worker(
            flask_app=agent_runtime_app,
            context=contextvars.copy_context(),
            application_generate_entity=agent_generate_entity,
            queue_manager=agent_queue_manager,
            conversation_id="conv",
            message_id="msg",
        )

        assert agent_queue_manager._q.empty()

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
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
        agent_runtime_app: Flask,
    ) -> None:
        _raise_in_runner(monkeypatch, error)

        generator._generate_worker(
            flask_app=agent_runtime_app,
            context=contextvars.copy_context(),
            application_generate_entity=agent_generate_entity,
            queue_manager=agent_queue_manager,
            conversation_id="conv",
            message_id="msg",
        )

        messages = list(agent_queue_manager.listen())
        assert len(messages) == 1
        assert isinstance(messages[0].event, QueueErrorEvent)
        assert isinstance(messages[0].event.error, type(error))
        if isinstance(error, InvokeAuthorizationError):
            assert str(messages[0].event.error) == "Incorrect API key provided"
        else:
            assert messages[0].event.error is error

    def test_generate_worker_logs_value_error_when_debug(
        self,
        generator: AgentChatAppGenerator,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
        agent_generate_entity: AgentChatAppGenerateEntity,
        agent_queue_manager: MessageBasedAppQueueManager,
        agent_runtime_app: Flask,
    ) -> None:
        _raise_in_runner(monkeypatch, ValueError("bad"))
        apply_config_overrides(monkeypatch, DEBUG=True)

        with caplog.at_level(logging.ERROR, logger="core.app.apps.agent_chat.app_generator"):
            generator._generate_worker(
                flask_app=agent_runtime_app,
                context=contextvars.copy_context(),
                application_generate_entity=agent_generate_entity,
                queue_manager=agent_queue_manager,
                conversation_id="conv",
                message_id="msg",
            )

        assert "Error when generating" in caplog.messages
        messages = list(agent_queue_manager.listen())
        assert len(messages) == 1
        assert isinstance(messages[0].event, QueueErrorEvent)
        assert isinstance(messages[0].event.error, ValueError)
