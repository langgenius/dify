import json
from collections.abc import Callable, Generator, Mapping
from dataclasses import dataclass, field
from typing import cast, override
from uuid import uuid4

import pytest
from sqlalchemy import event, inspect, update
from sqlalchemy.orm import Session, sessionmaker

import services.app_generate_service as generation_module
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.features.rate_limiting.rate_limit import RateLimit, RateLimitGenerator
from enums import DeploymentEdition
from models import Account, App, AppMode, AppModelConfig
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.installed_app_completion_adapters import AppGenerateServiceCompletionRuntime
from services.installed_app_completion_service import CompletionResponse

_ARGS: dict[str, object] = {"inputs": {"count": 0}, "query": "hello", "auto_generate_name": False}


@dataclass
class _RuntimeHarness:
    runtime: AppGenerateServiceCompletionRuntime
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
        AppGenerateServiceCompletionRuntime(session_factory=cast(sessionmaker[Session], factory)),
        app.id,
        account.id,
        closed_sessions,
        committed_sessions,
    )


def _patch_generation(
    monkeypatch: pytest.MonkeyPatch,
    harness: _RuntimeHarness,
    generate: Callable[[Session], CompletionResponse],
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
    ) -> CompletionResponse:
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

    def generate(session: Session) -> CompletionResponse:
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

    def generate(session: Session) -> CompletionResponse:
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
    def unexpected_generation(**_kwargs: object) -> CompletionResponse:
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

    def generate(session: Session) -> CompletionResponse:
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
