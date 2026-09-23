import json
from collections.abc import Callable, Generator, Mapping
from dataclasses import dataclass, field
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
from models import Account, App, AppMode, AppModelConfig, Conversation, Workflow
from models.enums import ConversationFromSource
from models.workflow import WorkflowType
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.errors.conversation import ConversationNotExistsError
from services.installed_app_generation_adapters import AppGenerateServiceRuntime
from services.installed_app_generation_service import GenerationResponse

_ARGS: dict[str, object] = {"inputs": {"count": 0}, "query": "hello", "auto_generate_name": False}


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
    generate: Callable[[Session], GenerationResponse],
    *,
    streaming: bool,
) -> None:
    def legacy_generate(
        *,
        session: Session,
        app_model: App,
        user: Account,
        args: Mapping[str, object],
        invoke_from: InvokeFrom,
        streaming: bool,
    ) -> GenerationResponse:
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
        assert args == _ARGS
        assert invoke_from == InvokeFrom.EXPLORE
        assert streaming is expected_streaming
        return generate(session)

    expected_streaming = streaming
    monkeypatch.setattr(generation_module.AppGenerateService, "generate", legacy_generate)


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


def test_runtime_loads_detached_entities_then_commits_work_and_returns_the_same_mapping(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    response: dict[str, object] = {"answer": "", "metadata": {"tokens": 0}}

    def generate(session: Session) -> GenerationResponse:
        session.execute(update(App).where(App.id == harness.app_id).values(name="Generated app"))
        return response

    _patch_generation(monkeypatch, harness, generate, streaming=False)
    result = harness.runtime.generate(app_id=harness.app_id, account_id=harness.account_id, args=_ARGS, streaming=False)

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


def test_streaming_preparation_errors_raise_eagerly_and_rollback_runtime_writes(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    failure = ValueError("query must be a string")

    def generate(session: Session) -> GenerationResponse:
        session.execute(update(App).where(App.id == harness.app_id).values(name="Uncommitted app"))
        raise failure

    _patch_generation(monkeypatch, harness, generate, streaming=True)
    with pytest.raises(ValueError) as raised:
        harness.runtime.generate(app_id=harness.app_id, account_id=harness.account_id, args=_ARGS, streaming=True)

    assert raised.value is failure
    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == []
    with sqlite_session_factory() as session:
        stored = session.get(App, harness.app_id)
        assert stored is not None
        assert stored.name == "Original app"


@pytest.mark.parametrize("missing", ["app", "account"])
def test_missing_runtime_entities_keep_precise_errors_and_do_not_enter_generation(
    harness: _RuntimeHarness, monkeypatch: pytest.MonkeyPatch, missing: str
) -> None:
    def unexpected_generation(**_kwargs: object) -> GenerationResponse:
        pytest.fail("Missing app or account must not reach generation")

    monkeypatch.setattr(generation_module.AppGenerateService, "generate", unexpected_generation)
    app_id = str(uuid4()) if missing == "app" else harness.app_id
    account_id = str(uuid4()) if missing == "account" else harness.account_id
    error_type = AppDefinitionUnavailableError if missing == "app" else AccountNotFoundError

    with pytest.raises(error_type, match=app_id if missing == "app" else account_id):
        harness.runtime.generate(app_id=app_id, account_id=account_id, args=_ARGS, streaming=True)

    assert len(harness.closed_sessions) == 1
    assert harness.committed_sessions == []


@pytest.mark.parametrize("failure_phase", ["commit", "session_close"])
@pytest.mark.parametrize("stream_close_fails", [False, True])
def test_failure_before_stream_handoff_closes_stream_without_masking_primary_error(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    failure_phase: str,
    stream_close_fails: bool,
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

    _patch_generation(monkeypatch, harness, generate, streaming=True)
    with pytest.raises(RuntimeError) as raised:
        harness.runtime.generate(app_id=harness.app_id, account_id=harness.account_id, args=_ARGS, streaming=True)

    assert raised.value is failure
    assert stream.closed is True
    assert rate.exits == ["request-1"]
    with sqlite_session_factory() as session:
        stored = session.get(App, harness.app_id)
        assert stored is not None
        assert stored.name == ("Original app" if failure_phase == "commit" else "Generated app")


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


def test_advanced_chat_dispatch_starts_task_after_subscription_with_runtime_session_closed(
    harness: _RuntimeHarness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    config_overrides: Callable[..., None],
) -> None:
    config_overrides(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        ENABLE_OTEL=False,
        APP_MAX_ACTIVE_REQUESTS=0,
        PUBSUB_REDIS_CHANNEL_TYPE="streams",
    )
    conversation_id = _seed_chat_conversation(harness, sqlite_session_factory, mode=AppMode.ADVANCED_CHAT)
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.app_id)
        assert app is not None
        workflow = Workflow(
            tenant_id=app.tenant_id,
            app_id=app.id,
            type=WorkflowType.CHAT,
            version="2026-09-07 00:00:00",
            graph='{"nodes": [], "edges": []}',
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
    args = {**_ARGS, "conversation_id": conversation_id}
    submitted: list[generation_module.AppExecutionParams] = []

    def enqueue(payload_json: str) -> None:
        assert transport_events == ["subscribe"]
        assert len(harness.closed_sessions) == 2
        assert all(not session.in_transaction() for session in harness.closed_sessions)
        submitted.append(generation_module.AppExecutionParams.model_validate_json(payload_json))
        transport_events.append("enqueue")

    monkeypatch.setattr(generation_module.workflow_based_app_execution_task, "delay", enqueue)

    # WorkflowService also creates its repository factory from Flask's db.engine.
    # Bind it to the same real database without replacing workflow lookup or dispatch.
    runtime_app = Flask(__name__)
    runtime_app.config["SQLALCHEMY_DATABASE_URI"] = str(sqlite_session_factory.kw["bind"].url)
    db.init_app(runtime_app)
    with runtime_app.app_context():
        try:
            result = harness.runtime.generate(
                app_id=harness.app_id, account_id=harness.account_id, args=args, streaming=True
            )
        finally:
            db.engine.dispose()

    assert isinstance(result, RateLimitGenerator)
    assert len(harness.closed_sessions) == 2
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
    assert payload.app_mode == AppMode.ADVANCED_CHAT
    assert payload.user.model_dump(mode="json") == {"TYPE": "account", "user_id": harness.account_id}
    assert payload.args == args
    assert payload.invoke_from == InvokeFrom.EXPLORE
    assert payload.streaming is True
    subscription.__exit__.assert_called_once()
    assert result.closed is True
