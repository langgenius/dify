import json
from collections.abc import Callable, Generator, Mapping
from dataclasses import dataclass, field
from inspect import GEN_CLOSED, getgeneratorstate
from typing import cast, override
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import event, inspect, update
from sqlalchemy.orm import Session, sessionmaker

import services.app_generate_service as generation_module
from core.app.apps import message_based_app_generator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting.rate_limit import RateLimit, RateLimitGenerator
from enums import DeploymentEdition
from extensions.ext_database import db
from libs.broadcast_channel.channel import BroadcastChannel, Subscription, SupportsPreparedSubscription, Topic
from models import Account, App, AppMode, AppModelConfig, Conversation, Message, Workflow
from models.enums import ConversationFromSource
from models.workflow import WorkflowType
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.errors.app import MoreLikeThisDisabledError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError
from services.installed_app_generation_adapters import AppGenerateServiceRuntime
from services.installed_app_generation_service import GenerationResponse

_ARGS: dict[str, object] = {"inputs": {"count": 0}, "query": "hello", "auto_generate_name": False}
_WORKFLOW_ARGS: dict[str, object] = {"inputs": {"count": 0}, "files": []}
_MESSAGE_ID = str(uuid4())


@dataclass
class _RuntimeHarness:
    runtime: AppGenerateServiceRuntime
    app_id: str
    account_id: str
    closed_sessions: list[Session]
    committed_sessions: list[Session]


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> _RuntimeHarness:
    with sqlite_session_factory.begin() as session:
        app = App(
            tenant_id=str(uuid4()), name="Original app", mode=AppMode.COMPLETION, enable_site=True, enable_api=True
        )
        account = Account(name="Viewer", email="viewer@example.com")
        session.add_all([app, account])

    closed_sessions: list[Session] = []
    committed_sessions: list[Session] = []

    class TrackedSession(Session):
        @override
        def close(self) -> None:
            super().close()
            closed_sessions.append(self)
            failure = self.info.get("close_failure")
            if isinstance(failure, Exception):
                raise failure

    # The adapter must preserve loaded snapshots even if its supplied factory
    # normally expires ORM state on commit.
    factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], class_=TrackedSession, expire_on_commit=True)

    @event.listens_for(factory, "after_commit")
    def record_commit(session: Session) -> None:
        committed_sessions.append(session)

    return _RuntimeHarness(
        AppGenerateServiceRuntime(session_factory=cast(sessionmaker[Session], factory)),
        app.id,
        account.id,
        closed_sessions,
        committed_sessions,
    )


def _patch_generation(
    monkeypatch: pytest.MonkeyPatch,
    harness: _RuntimeHarness,
    generate: Callable[[Session], GenerationResponse | Generator[Mapping[str, object] | str, None, None]],
    *,
    streaming: bool,
    more_like_this: bool = False,
) -> None:
    def assert_context(
        *,
        session: Session,
        app_model: App,
        user: Account,
        invoke_from: InvokeFrom,
        streaming: bool,
    ) -> GenerationResponse | Generator[Mapping[str, object] | str, None, None]:
        assert len(harness.closed_sessions) == 1
        read_session = harness.closed_sessions[0]
        assert not read_session.in_transaction()
        assert not read_session.identity_map
        assert session is not read_session
        assert not session.in_transaction()
        assert inspect(app_model).detached
        assert inspect(user).detached
        assert (app_model.id, user.id) == (harness.app_id, harness.account_id)
        assert (app_model.name, user.name) == ("Original app", "Viewer")
        assert invoke_from == InvokeFrom.EXPLORE
        assert streaming is expected_streaming
        return generate(session)

    def legacy_generate(
        *,
        session: Session,
        app_model: App,
        user: Account,
        args: Mapping[str, object],
        invoke_from: InvokeFrom,
        streaming: bool,
    ) -> GenerationResponse | Generator[Mapping[str, object] | str, None, None]:
        assert args == _ARGS
        return assert_context(
            session=session, app_model=app_model, user=user, invoke_from=invoke_from, streaming=streaming
        )

    def legacy_generate_more_like_this(
        *,
        session: Session,
        app_model: App,
        user: Account,
        message_id: str,
        invoke_from: InvokeFrom,
        streaming: bool,
    ) -> GenerationResponse | Generator[Mapping[str, object] | str, None, None]:
        assert message_id == _MESSAGE_ID
        return assert_context(
            session=session, app_model=app_model, user=user, invoke_from=invoke_from, streaming=streaming
        )

    expected_streaming = streaming
    if more_like_this:
        monkeypatch.setattr(
            generation_module.AppGenerateService, "generate_more_like_this", legacy_generate_more_like_this
        )
    else:
        monkeypatch.setattr(generation_module.AppGenerateService, "generate", legacy_generate)


def _invoke_generation(
    harness: _RuntimeHarness,
    *,
    streaming: bool,
    more_like_this: bool,
    app_id: str | None = None,
    account_id: str | None = None,
) -> GenerationResponse:
    app_id = app_id or harness.app_id
    account_id = account_id or harness.account_id
    if more_like_this:
        return harness.runtime.generate_more_like_this(
            app_id=app_id, account_id=account_id, message_id=_MESSAGE_ID, streaming=streaming
        )
    return harness.runtime.generate(app_id=app_id, account_id=account_id, args=_ARGS, streaming=streaming)


@dataclass
class _RateLimitExit:
    exits: list[str] = field(default_factory=list)
    failure: Exception | None = None

    def exit(self, request_id: str) -> None:
        self.exits.append(request_id)
        if self.failure is not None:
            raise self.failure


def _rate_limited_stream(source: Generator[str, None, None], rate: _RateLimitExit) -> RateLimitGenerator:
    return RateLimitGenerator(rate_limit=cast(RateLimit, rate), generator=source, request_id="request-1")


@pytest.mark.parametrize("more_like_this", [False, True])
def test_runtime_loads_detached_entities_then_commits_work_and_returns_the_same_mapping(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    more_like_this: bool,
) -> None:
    response: dict[str, object] = {"answer": "", "metadata": {"tokens": 0}}

    def generate(session: Session) -> GenerationResponse:
        session.execute(update(App).where(App.id == harness.app_id).values(name="Generated app"))
        return response

    _patch_generation(monkeypatch, harness, generate, streaming=False, more_like_this=more_like_this)
    result = _invoke_generation(harness, streaming=False, more_like_this=more_like_this)

    assert result is response
    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == [harness.closed_sessions[1]]
    assert all(not session.in_transaction() for session in harness.closed_sessions)
    with sqlite_session_factory() as session:
        stored = session.get(App, harness.app_id)
        assert stored is not None
        assert stored.name == "Generated app"


@pytest.mark.parametrize("finish", ["complete", "cancel", "error"])
def test_runtime_preserves_stream_identity_and_original_close_lifecycle(
    harness: _RuntimeHarness, monkeypatch: pytest.MonkeyPatch, finish: str
) -> None:
    events: list[str] = []
    failure = RuntimeError("stream failed")
    rate = _RateLimitExit()

    def source() -> Generator[str, None, None]:
        assert len(harness.closed_sessions) == 2
        events.append("start")
        try:
            yield "data: first\n\n"
            if finish == "error":
                raise failure
            yield "data: second\n\n"
        finally:
            events.append("close")

    stream = _rate_limited_stream(source(), rate)
    _patch_generation(monkeypatch, harness, lambda _session: stream, streaming=True)
    result = harness.runtime.generate(app_id=harness.app_id, account_id=harness.account_id, args=_ARGS, streaming=True)

    assert result is stream
    assert events == []
    assert rate.exits == []
    assert harness.committed_sessions == [harness.closed_sessions[1]]
    assert next(stream) == "data: first\n\n"
    if finish == "complete":
        assert list(stream) == ["data: second\n\n"]
    elif finish == "cancel":
        stream.close()
    else:
        with pytest.raises(RuntimeError) as raised:
            next(stream)
        assert raised.value is failure

    stream.close()
    assert stream.closed is True
    assert rate.exits == ["request-1"]
    assert events == ["start", "close"]


@pytest.mark.parametrize("finish", ["complete", "cancel", "error", "close_before_iteration"])
def test_more_like_this_serializes_raw_events_and_closes_source(
    harness: _RuntimeHarness, monkeypatch: pytest.MonkeyPatch, finish: str
) -> None:
    events: list[str] = []
    failure = RuntimeError("more-like-this stream failed")

    def source() -> Generator[Mapping[str, object] | str, None, None]:
        assert len(harness.closed_sessions) == 2
        events.append("start")
        try:
            yield {"event": "message", "answer": "Hello"}
            if finish == "error":
                raise failure
            yield "ping"
        finally:
            events.append("close")

    stream = source()
    _patch_generation(monkeypatch, harness, lambda _session: stream, streaming=True, more_like_this=True)
    result = _invoke_generation(harness, streaming=True, more_like_this=True)

    assert not isinstance(result, Mapping)
    assert events == []
    assert harness.committed_sessions == [harness.closed_sessions[1]]
    if finish != "close_before_iteration":
        assert next(result) == 'data: {"event":"message","answer":"Hello"}\n\n'
        if finish == "complete":
            assert list(result) == ["event: ping\n\n"]
        elif finish == "error":
            with pytest.raises(RuntimeError) as raised:
                next(result)
            assert raised.value is failure
        else:
            result.close()

    result.close()
    result.close()
    assert list(result) == []
    assert getgeneratorstate(stream) == GEN_CLOSED
    assert events == ([] if finish == "close_before_iteration" else ["start", "close"])


@pytest.mark.parametrize("more_like_this", [False, True])
def test_streaming_preparation_errors_raise_eagerly_and_rollback_runtime_writes(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    more_like_this: bool,
) -> None:
    failure = ValueError("query must be a string")

    def generate(session: Session) -> GenerationResponse:
        session.execute(update(App).where(App.id == harness.app_id).values(name="Uncommitted app"))
        raise failure

    _patch_generation(monkeypatch, harness, generate, streaming=True, more_like_this=more_like_this)
    with pytest.raises(ValueError) as raised:
        _invoke_generation(harness, streaming=True, more_like_this=more_like_this)

    assert raised.value is failure
    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == []
    with sqlite_session_factory() as session:
        stored = session.get(App, harness.app_id)
        assert stored is not None
        assert stored.name == "Original app"


@pytest.mark.parametrize("missing", ["app", "account"])
@pytest.mark.parametrize("more_like_this", [False, True])
def test_missing_runtime_entities_keep_precise_errors_and_do_not_enter_generation(
    harness: _RuntimeHarness, monkeypatch: pytest.MonkeyPatch, missing: str, more_like_this: bool
) -> None:
    def unexpected_generation(**_kwargs: object) -> GenerationResponse:
        pytest.fail("Missing app or account must not reach generation")

    monkeypatch.setattr(generation_module.AppGenerateService, "generate", unexpected_generation)
    monkeypatch.setattr(generation_module.AppGenerateService, "generate_more_like_this", unexpected_generation)
    app_id = str(uuid4()) if missing == "app" else harness.app_id
    account_id = str(uuid4()) if missing == "account" else harness.account_id
    error_type = AppDefinitionUnavailableError if missing == "app" else AccountNotFoundError

    with pytest.raises(error_type, match=app_id if missing == "app" else account_id):
        _invoke_generation(harness, app_id=app_id, account_id=account_id, streaming=True, more_like_this=more_like_this)

    assert len(harness.closed_sessions) == 1
    assert harness.committed_sessions == []


@pytest.mark.parametrize("failure_phase", ["commit", "session_close"])
@pytest.mark.parametrize("stream_close_fails", [False, True])
@pytest.mark.parametrize("more_like_this", [False, True])
def test_failure_before_stream_handoff_closes_stream_without_masking_primary_error(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    failure_phase: str,
    stream_close_fails: bool,
    more_like_this: bool,
) -> None:
    failure = RuntimeError(f"runtime {failure_phase} failed")
    rate = _RateLimitExit(failure=ValueError("stream close failed") if stream_close_fails else None)

    def source() -> Generator[str, None, None]:
        pytest.fail("A response that failed before handoff must not be consumed")
        yield "unreachable"

    stream = _rate_limited_stream(source(), rate)

    def generate(session: Session) -> GenerationResponse:
        session.execute(update(App).where(App.id == harness.app_id).values(name="Generated app"))
        if failure_phase == "commit":

            @event.listens_for(session, "before_commit")
            def fail_commit(_session: Session) -> None:
                raise failure
        else:
            session.info["close_failure"] = failure
        return stream

    _patch_generation(monkeypatch, harness, generate, streaming=True, more_like_this=more_like_this)
    with pytest.raises(RuntimeError) as raised:
        _invoke_generation(harness, streaming=True, more_like_this=more_like_this)

    assert raised.value is failure
    assert stream.closed is True
    assert rate.exits == ["request-1"]
    with sqlite_session_factory() as session:
        stored = session.get(App, harness.app_id)
        assert stored is not None
        assert stored.name == ("Original app" if failure_phase == "commit" else "Generated app")


def _seed_more_like_this_message(harness: _RuntimeHarness, session_factory: sessionmaker[Session]) -> str:
    with session_factory.begin() as session:
        conversation = Conversation(
            app_id=harness.app_id,
            mode=AppMode.COMPLETION,
            name="Earlier completion",
            inputs={},
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=harness.account_id,
        )
        session.add(conversation)
        session.flush()
        message = Message(
            app_id=harness.app_id,
            conversation_id=conversation.id,
            inputs={"count": 0},
            query="Earlier query",
            message={},
            answer="Earlier answer",
            message_unit_price=0,
            answer_unit_price=0,
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=harness.account_id,
        )
        session.add(message)
        session.flush()
        return message.id


@pytest.mark.parametrize("inaccessible", ["missing", "other_app", "other_account", "api_source", "end_user"])
def test_more_like_this_checks_real_message_ownership_before_feature_config(
    harness: _RuntimeHarness, sqlite_session_factory: sessionmaker[Session], inaccessible: str
) -> None:
    message_id = _seed_more_like_this_message(harness, sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        message = session.get(Message, message_id)
        assert message is not None
        if inaccessible == "missing":
            message_id = str(uuid4())
        elif inaccessible == "other_app":
            message.app_id = str(uuid4())
        elif inaccessible == "other_account":
            message.from_account_id = str(uuid4())
        elif inaccessible == "api_source":
            message.from_source = ConversationFromSource.API
        else:
            message.from_end_user_id = str(uuid4())

    with pytest.raises(MessageNotExistsError):
        harness.runtime.generate_more_like_this(
            app_id=harness.app_id, account_id=harness.account_id, message_id=message_id, streaming=True
        )

    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == []


@pytest.mark.parametrize("current_config", ["missing", "null", "empty", "disabled"])
def test_more_like_this_disabled_config_fails_eagerly_before_history_lookup(
    harness: _RuntimeHarness, sqlite_session_factory: sessionmaker[Session], current_config: str
) -> None:
    message_id = _seed_more_like_this_message(harness, sqlite_session_factory)
    if current_config != "missing":
        with sqlite_session_factory.begin() as session:
            app = session.get(App, harness.app_id)
            assert app is not None
            feature_config = {"null": None, "empty": "{}", "disabled": '{"enabled":false}'}[current_config]
            config = AppModelConfig(app_id=app.id, more_like_this=feature_config)
            session.add(config)
            app.app_model_config_id = config.id

    with pytest.raises(MoreLikeThisDisabledError):
        harness.runtime.generate_more_like_this(
            app_id=harness.app_id, account_id=harness.account_id, message_id=message_id, streaming=True
        )

    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == []


@pytest.mark.parametrize("missing_config_id", [None, str(uuid4())])
def test_more_like_this_requires_historical_config_even_when_current_config_is_enabled(
    harness: _RuntimeHarness, sqlite_session_factory: sessionmaker[Session], missing_config_id: str | None
) -> None:
    message_id = _seed_more_like_this_message(harness, sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.app_id)
        assert app is not None
        config = AppModelConfig(app_id=app.id, more_like_this='{"enabled":true}')
        session.add(config)
        app.app_model_config_id = config.id
        message = session.get(Message, message_id)
        assert message is not None
        conversation = session.get(Conversation, message.conversation_id)
        assert conversation is not None
        conversation.app_model_config_id = missing_config_id

    with pytest.raises(ValueError, match="Message app_model_config is None"):
        harness.runtime.generate_more_like_this(
            app_id=harness.app_id, account_id=harness.account_id, message_id=message_id, streaming=True
        )

    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == []


@pytest.mark.parametrize("legacy_agent", [False, True])
def test_runtime_keeps_shared_completion_and_legacy_agent_dispatch(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    legacy_agent: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, ENABLE_OTEL=False)
    if legacy_agent:
        with sqlite_session_factory.begin() as session:
            app = session.get(App, harness.app_id)
            assert app is not None
            config = AppModelConfig(app_id=app.id, agent_mode=json.dumps({"enabled": True, "strategy": "react"}))
            session.add(config)
            app.app_model_config_id = config.id

    calls: list[AppMode] = []

    def generate(
        _self: object,
        *,
        app_model: App,
        user: Account,
        args: Mapping[str, object],
        invoke_from: InvokeFrom,
        streaming: bool,
        session: Session,
    ) -> dict[str, object]:
        assert user.id == harness.account_id
        assert args == _ARGS
        assert invoke_from == InvokeFrom.EXPLORE
        assert streaming is True
        calls.append(app_model.mode)
        assert session is not harness.closed_sessions[0]
        return {"mode": app_model.mode.value}

    monkeypatch.setattr(generation_module.CompletionAppGenerator, "generate", generate)
    monkeypatch.setattr(generation_module.AgentChatAppGenerator, "generate", generate)
    monkeypatch.setattr(RateLimit, "__init__", lambda _self, _app_id, _limit: None)
    monkeypatch.setattr(RateLimit, "enter", lambda _self, request_id: request_id)

    result = harness.runtime.generate(app_id=harness.app_id, account_id=harness.account_id, args=_ARGS, streaming=True)

    expected_mode = AppMode.AGENT_CHAT if legacy_agent else AppMode.COMPLETION
    assert result == {"mode": expected_mode.value}
    assert calls == [expected_mode]
    with sqlite_session_factory() as session:
        app = session.get(App, harness.app_id)
        assert app is not None
        assert app.mode == expected_mode


def _seed_chat_conversation(
    harness: _RuntimeHarness,
    session_factory: sessionmaker[Session],
    *,
    mode: AppMode = AppMode.CHAT,
) -> str:
    with session_factory.begin() as session:
        app = session.get(App, harness.app_id)
        assert app is not None
        app.mode = mode
        app.max_active_requests = 0
        conversation = Conversation(
            app_id=app.id,
            mode=mode,
            name="Existing conversation",
            inputs={},
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=harness.account_id,
            from_end_user_id=None,
        )
        session.add(conversation)
        session.flush()
        conversation_id = conversation.id
    return conversation_id


@pytest.mark.parametrize("mismatch", ["missing", "app", "account", "source", "end_user", "deleted"])
def test_conversation_preflight_rejects_each_ownership_mismatch_before_generation(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    mismatch: str,
) -> None:
    conversation_id = _seed_chat_conversation(harness, sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        conversation = session.get(Conversation, conversation_id)
        assert conversation is not None
        match mismatch:
            case "missing":
                conversation_id = str(uuid4())
            case "app":
                conversation.app_id = str(uuid4())
            case "account":
                conversation.from_account_id = str(uuid4())
            case "source":
                conversation.from_source = ConversationFromSource.API
            case "end_user":
                conversation.from_end_user_id = str(uuid4())
            case "deleted":
                conversation.is_deleted = True

    def unexpected_generation(_self: object, **_kwargs: object) -> GenerationResponse:
        pytest.fail("An invisible conversation must fail before entering the generator")

    monkeypatch.setattr(generation_module.ChatAppGenerator, "generate", unexpected_generation)
    with pytest.raises(ConversationNotExistsError):
        harness.runtime.generate(
            app_id=harness.app_id,
            account_id=harness.account_id,
            args={**_ARGS, "conversation_id": conversation_id},
            streaming=True,
        )

    assert len(harness.closed_sessions) == 1
    assert not harness.closed_sessions[0].in_transaction()
    assert harness.committed_sessions == []


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT])
def test_visible_conversation_uses_shared_chat_dispatch_after_preflight_session_closes(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    mode: AppMode,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, ENABLE_OTEL=False, APP_MAX_ACTIVE_REQUESTS=0)
    conversation_id = _seed_chat_conversation(harness, sqlite_session_factory, mode=mode)
    args = {**_ARGS, "conversation_id": conversation_id}
    calls: list[str] = []

    def generate(
        generator: object,
        *,
        session: Session,
        app_model: App,
        user: Account,
        args: Mapping[str, object],
        invoke_from: InvokeFrom,
        streaming: bool,
    ) -> Generator[Mapping[str, object] | str, None, None]:
        assert len(harness.closed_sessions) == 1
        assert not harness.closed_sessions[0].in_transaction()
        assert session is not harness.closed_sessions[0]
        assert inspect(app_model).detached
        assert inspect(user).detached
        assert (app_model.id, user.id) == (harness.app_id, harness.account_id)
        assert args == {**_ARGS, "conversation_id": conversation_id}
        assert invoke_from == InvokeFrom.EXPLORE
        assert streaming is True
        calls.append(type(generator).__name__)

        def chunks() -> Generator[Mapping[str, object] | str, None, None]:
            assert len(harness.closed_sessions) == 2
            assert not session.in_transaction()
            yield {"event": "message", "answer": mode.value}

        return chunks()

    monkeypatch.setattr(generation_module.ChatAppGenerator, "generate", generate)
    monkeypatch.setattr(generation_module.AgentChatAppGenerator, "generate", generate)

    result = harness.runtime.generate(app_id=harness.app_id, account_id=harness.account_id, args=args, streaming=True)

    expected_generator = "ChatAppGenerator" if mode == AppMode.CHAT else "AgentChatAppGenerator"
    assert calls == [expected_generator]
    assert isinstance(result, RateLimitGenerator)
    assert harness.committed_sessions == [harness.closed_sessions[1]]
    assert [json.loads(chunk.removeprefix("data: ")) for chunk in result] == [
        {"event": "message", "answer": mode.value}
    ]
    assert result.closed is True


def _generate_workflow(
    harness: _RuntimeHarness,
    session_factory: sessionmaker[Session],
    args: Mapping[str, object],
) -> GenerationResponse:
    # WorkflowService also creates its repository factory from Flask's db.engine.
    # Bind it to the same real database without replacing workflow lookup or dispatch.
    runtime_app = Flask(__name__)
    runtime_app.config["SQLALCHEMY_DATABASE_URI"] = str(session_factory.kw["bind"].url)
    db.init_app(runtime_app)
    with runtime_app.app_context():
        try:
            return harness.runtime.generate(
                app_id=harness.app_id, account_id=harness.account_id, args=args, streaming=True
            )
        finally:
            db.engine.dispose()


@pytest.mark.parametrize(
    ("mode", "trigger"),
    [
        pytest.param(AppMode.ADVANCED_CHAT, False, id="advanced-chat"),
        pytest.param(AppMode.WORKFLOW, False, id="workflow"),
        pytest.param(AppMode.WORKFLOW, True, id="explore-trigger-workflow"),
    ],
)
def test_workflow_dispatch_starts_task_after_subscription_with_runtime_session_closed(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
    mode: AppMode,
    trigger: bool,
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        ENABLE_OTEL=False,
        APP_DEFAULT_ACTIVE_REQUESTS=0,
        APP_MAX_ACTIVE_REQUESTS=0,
        PUBSUB_REDIS_CHANNEL_TYPE="streams",
    )
    args = _WORKFLOW_ARGS
    if mode == AppMode.ADVANCED_CHAT:
        conversation_id = _seed_chat_conversation(harness, sqlite_session_factory, mode=mode)
        args = {**_ARGS, "conversation_id": conversation_id}
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.app_id)
        assert app is not None
        app.mode = mode
        workflow = Workflow(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.WORKFLOW if mode == AppMode.WORKFLOW else WorkflowType.CHAT,
            version="2026-09-07 00:00:00",
            graph=json.dumps(
                {
                    "nodes": [{"id": "schedule", "data": {"type": "trigger-schedule"}}] if trigger else [],
                    "edges": [],
                }
            ),
            _features="{}",
            created_by=harness.account_id,
        )
        session.add(workflow)
        session.flush()
        app.workflow_id = workflow.id
        workflow_id, tenant_id = workflow.id, app.tenant_id

    transport_events: list[str] = []
    subscription = MagicMock(spec=Subscription)
    subscriber = MagicMock(spec=SupportsPreparedSubscription)
    subscriber.prepare_subscription.return_value = subscription
    topic = MagicMock(spec=Topic)
    topic.as_subscriber.return_value = subscriber
    channel = MagicMock(spec=BroadcastChannel)
    channel.topic.return_value = topic

    def activate_subscription() -> Subscription:
        assert len(harness.closed_sessions) == 2
        assert all(not session.in_transaction() for session in harness.closed_sessions)
        transport_events.append("subscribe")
        return subscription

    subscription.__enter__.side_effect = activate_subscription
    subscription.receive.return_value = b'{"event":"workflow_finished"}'
    monkeypatch.setattr(message_based_app_generator, "get_pubsub_broadcast_channel", lambda: channel)
    submitted: list[generation_module.AppExecutionParams] = []

    def enqueue(payload_json: str) -> None:
        assert transport_events == ["subscribe"]
        assert len(harness.closed_sessions) == 2
        assert all(not session.in_transaction() for session in harness.closed_sessions)
        submitted.append(generation_module.AppExecutionParams.model_validate_json(payload_json))
        transport_events.append("enqueue")

    monkeypatch.setattr(generation_module.workflow_based_app_execution_task, "delay", enqueue)

    result = _generate_workflow(harness, sqlite_session_factory, args)

    assert isinstance(result, RateLimitGenerator)
    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == [harness.closed_sessions[1]]
    assert submitted == []
    subscriber.prepare_subscription.assert_called_once_with()
    subscription.__enter__.assert_not_called()
    assert next(result) == "event: ping\n\n"
    assert submitted == []
    assert json.loads(next(result).removeprefix("data: ")) == {"event": "workflow_finished"}
    assert list(result) == []
    assert transport_events == ["subscribe", "enqueue"]
    assert len(submitted) == 1
    payload = submitted[0]
    assert (payload.app_id, payload.workflow_id, payload.tenant_id) == (harness.app_id, workflow_id, tenant_id)
    assert payload.app_mode == mode
    assert payload.user.model_dump(mode="json") == {"TYPE": "account", "user_id": harness.account_id}
    assert payload.args == args
    assert payload.invoke_from == InvokeFrom.EXPLORE
    assert payload.streaming is True
    subscription.__exit__.assert_called_once()
    assert result.closed is True


def test_unpublished_workflow_raises_before_subscription_or_task_creation(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        ENABLE_OTEL=False,
        APP_DEFAULT_ACTIVE_REQUESTS=0,
        APP_MAX_ACTIVE_REQUESTS=0,
    )
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.app_id)
        assert app is not None
        app.mode = AppMode.WORKFLOW
        session.add(
            Workflow(
                tenant_id=app.tenant_id,
                app_id=app.id,
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph='{"nodes": [], "edges": []}',
                _features="{}",
                created_by=harness.account_id,
            )
        )

    channel = MagicMock(spec=BroadcastChannel)
    monkeypatch.setattr(message_based_app_generator, "get_pubsub_broadcast_channel", lambda: channel)
    enqueue = MagicMock()
    monkeypatch.setattr(generation_module.workflow_based_app_execution_task, "delay", enqueue)

    with pytest.raises(ValueError, match="^Workflow not published$") as raised:
        _generate_workflow(harness, sqlite_session_factory, _WORKFLOW_ARGS)

    assert type(raised.value) is ValueError
    assert len(harness.closed_sessions) == 2
    assert all(not session.in_transaction() for session in harness.closed_sessions)
    assert harness.committed_sessions == []
    channel.topic.assert_not_called()
    enqueue.assert_not_called()
