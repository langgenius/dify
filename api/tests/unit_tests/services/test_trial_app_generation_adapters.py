from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field, replace
from typing import cast, override
from uuid import uuid4

import pytest
from sqlalchemy import Engine, inspect, select, update
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.apps.chat.app_generator import ChatAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from models import Account, App, AppMode, Conversation
from models.enums import ConversationFromSource
from models.model import AccountTrialAppRecord
from repositories.trial_app_repository import TrialAppRepository
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_generate_service import AppGenerateService
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.conversation import ConversationNotExistsError
from services.trial_app_access_service import TrialAppRef
from services.trial_app_generation_adapters import AppGenerateServiceRuntime
from services.trial_app_generation_service import GenerationResponse, TrialAppGenerationService

_ARGS: dict[str, object] = {"inputs": {"count": 0}, "query": "hello", "auto_generate_name": False}


@dataclass
class _Harness:
    runtime: AppGenerateServiceRuntime
    app: TrialAppRef
    account_id: str
    closed_sessions: list[Session]
    committed_sessions: list[Session]


@pytest.fixture
def harness(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> _Harness:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Trial app", mode=AppMode.CHAT, enable_site=True, enable_api=False)
        account = Account(name="Viewer", email="viewer@example.com")
        session.add_all([app, account])

    closed_sessions: list[Session] = []
    committed_sessions: list[Session] = []

    class TrackedSession(Session):
        @override
        def commit(self) -> None:
            failure = self.info.get("commit_failure")
            if isinstance(failure, BaseException):
                raise failure
            super().commit()
            committed_sessions.append(self)

        @override
        def close(self) -> None:
            super().close()
            closed_sessions.append(self)

    factory = sessionmaker(bind=sqlite_engine, class_=TrackedSession, expire_on_commit=True)
    return _Harness(
        runtime=AppGenerateServiceRuntime(session_factory=cast(sessionmaker[Session], factory)),
        app=TrialAppRef(app_id=app.id, tenant_id=app.tenant_id, app_mode=app.mode),
        account_id=account.id,
        closed_sessions=closed_sessions,
        committed_sessions=committed_sessions,
    )


@dataclass
class _Stream:
    close_error: Exception | None = None
    close_calls: int = 0
    read_calls: int = 0
    _chunks: Iterator[str] = field(default_factory=lambda: iter(("data: first\n\n", "data: second\n\n")))

    def __iter__(self) -> "_Stream":
        return self

    def __next__(self) -> str:
        self.read_calls += 1
        return next(self._chunks)

    def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


def _patch_generation(
    monkeypatch: pytest.MonkeyPatch,
    harness: _Harness,
    generate: Callable[[Session], GenerationResponse],
    *,
    streaming: bool,
    args: Mapping[str, object] = _ARGS,
) -> None:
    expected_streaming = streaming
    expected_args = args

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
        assert (app_model.id, app_model.tenant_id, user.id) == (
            harness.app.app_id,
            harness.app.tenant_id,
            harness.account_id,
        )
        assert (app_model.name, user.name) == ("Trial app", "Viewer")
        assert invoke_from == InvokeFrom.EXPLORE
        assert streaming is expected_streaming
        assert args == expected_args
        return generate(session)

    monkeypatch.setattr(AppGenerateService, "generate", legacy_generate)


def test_mapping_result_is_unchanged_and_generation_writes_are_committed(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    response: dict[str, object] = {"answer": "", "metadata": {"tokens": 0}}

    def generate(session: Session) -> GenerationResponse:
        session.execute(update(App).where(App.id == harness.app.app_id).values(name="Generated app"))
        return response

    _patch_generation(monkeypatch, harness, generate, streaming=False)

    result = harness.runtime.generate(app=harness.app, account_id=harness.account_id, args=_ARGS, streaming=False)

    assert result is response
    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == [harness.closed_sessions[1]]
    assert all(not session.in_transaction() for session in harness.closed_sessions)
    with sqlite_session_factory() as session:
        app = session.get(App, harness.app.app_id)
        assert app is not None
        assert app.name == "Generated app"


def test_usage_is_recorded_after_generation_session_closes_and_before_stream_consumption(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> None:
    stream = _Stream()

    def generate(session: Session) -> GenerationResponse:
        session.execute(update(App).where(App.id == harness.app.app_id).values(name="Generated app"))
        return stream

    class UsageRepository(TrialAppRepository):
        @override
        def record(self, *, app_id: str, account_id: str) -> None:
            assert len(harness.closed_sessions) == 2
            assert harness.committed_sessions == [harness.closed_sessions[1]]
            assert isinstance(sqlite_engine.pool, QueuePool)
            assert sqlite_engine.pool.checkedout() == 0
            assert stream.read_calls == 0
            super().record(app_id=app_id, account_id=account_id)

    _patch_generation(monkeypatch, harness, generate, streaming=True)
    service = TrialAppGenerationService(runtime=harness.runtime, usage=UsageRepository(sqlite_session_factory))

    result = service.generate_chat(trial_app=harness.app, account_id=harness.account_id, args=_ARGS)

    assert result is stream
    assert stream.read_calls == stream.close_calls == 0
    with sqlite_session_factory() as session:
        usage = session.scalar(
            select(AccountTrialAppRecord).where(
                AccountTrialAppRecord.app_id == harness.app.app_id,
                AccountTrialAppRecord.account_id == harness.account_id,
            )
        )
        assert usage is not None
        assert usage.count == 1
    assert next(stream) == "data: first\n\n"
    stream.close()
    assert stream.close_calls == 1


@pytest.mark.parametrize("failure", [ValueError("Invalid query"), RuntimeError("Provider failed")])
def test_generation_failure_preserves_error_and_rolls_back_writes(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    failure: Exception,
) -> None:
    def generate(session: Session) -> GenerationResponse:
        session.execute(update(App).where(App.id == harness.app.app_id).values(name="Uncommitted app"))
        raise failure

    _patch_generation(monkeypatch, harness, generate, streaming=True)

    with pytest.raises(type(failure)) as raised:
        harness.runtime.generate(app=harness.app, account_id=harness.account_id, args=_ARGS, streaming=True)

    assert raised.value is failure
    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == []
    with sqlite_session_factory() as session:
        app = session.get(App, harness.app.app_id)
        assert app is not None
        assert app.name == "Trial app"


@pytest.mark.parametrize("close_failure", [False, True])
def test_commit_failure_closes_created_stream_and_preserves_commit_error(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    close_failure: bool,
) -> None:
    failure = RuntimeError("Commit failed")
    stream = _Stream(close_error=RuntimeError("Stream close failed") if close_failure else None)

    def generate(session: Session) -> GenerationResponse:
        session.execute(update(App).where(App.id == harness.app.app_id).values(name="Uncommitted app"))
        session.info["commit_failure"] = failure
        return stream

    _patch_generation(monkeypatch, harness, generate, streaming=True)

    with pytest.raises(RuntimeError) as raised:
        harness.runtime.generate(app=harness.app, account_id=harness.account_id, args=_ARGS, streaming=True)

    assert raised.value is failure
    assert stream.close_calls == 1
    assert stream.read_calls == 0
    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == []
    with sqlite_session_factory() as session:
        app = session.get(App, harness.app.app_id)
        assert app is not None
        assert app.name == "Trial app"


@pytest.mark.parametrize("invalid", ["missing-app", "wrong-owner", "missing-account"])
def test_unavailable_generation_context_fails_before_entering_runtime(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, invalid: str
) -> None:
    def unexpected_generate(**_kwargs: object) -> GenerationResponse:
        pytest.fail("Unavailable context must fail before generation")

    monkeypatch.setattr(AppGenerateService, "generate", unexpected_generate)
    app = harness.app
    account_id = harness.account_id
    error_type: type[Exception] = AppDefinitionUnavailableError
    if invalid == "missing-app":
        app = replace(app, app_id=str(uuid4()))
    elif invalid == "wrong-owner":
        app = replace(app, tenant_id=str(uuid4()))
    else:
        account_id = str(uuid4())
        error_type = AccountNotFoundError

    with pytest.raises(error_type):
        harness.runtime.generate(app=app, account_id=account_id, args=_ARGS, streaming=True)

    assert len(harness.closed_sessions) == 1
    assert not harness.closed_sessions[0].in_transaction()
    assert harness.committed_sessions == []


@pytest.mark.parametrize("current_mode", [AppMode.COMPLETION, AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_mode_changed_after_admission_fails_before_generation_and_usage_recording(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    current_mode: AppMode,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(update(App).where(App.id == harness.app.app_id).values(mode=current_mode))

    def unexpected_generate(**_kwargs: object) -> GenerationResponse:
        pytest.fail("A stale app mode must fail before generation")

    monkeypatch.setattr(AppGenerateService, "generate", unexpected_generate)
    service = TrialAppGenerationService(runtime=harness.runtime, usage=TrialAppRepository(sqlite_session_factory))

    with pytest.raises(AppDefinitionUnavailableError) as raised:
        service.generate_chat(trial_app=harness.app, account_id=harness.account_id, args=_ARGS)

    assert harness.app.app_id in str(raised.value)
    assert harness.app.app_mode in str(raised.value)
    assert current_mode.value in str(raised.value)
    assert len(harness.closed_sessions) == 1
    assert not harness.closed_sessions[0].in_transaction()
    assert harness.committed_sessions == []
    with sqlite_session_factory() as session:
        assert session.scalar(select(AccountTrialAppRecord)) is None


def _add_conversation(harness: _Harness, session_factory: sessionmaker[Session]) -> str:
    with session_factory.begin() as session:
        conversation = Conversation(
            app_id=harness.app.app_id,
            mode=AppMode.CHAT,
            name="Conversation",
            inputs={},
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=harness.account_id,
            from_end_user_id=None,
        )
        session.add(conversation)
        session.flush()
        return conversation.id


def _patch_chat_generation(monkeypatch: pytest.MonkeyPatch, harness: _Harness) -> None:
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
        assert not harness.closed_sessions[0].in_transaction()
        assert session is not harness.closed_sessions[0]
        assert not session.in_transaction()
        response = ChatAppGenerator().generate(
            app_model=app_model, user=user, args=args, invoke_from=invoke_from, streaming=streaming, session=session
        )
        return cast(GenerationResponse, ChatAppGenerator.convert_to_event_stream(response))

    monkeypatch.setattr(AppGenerateService, "generate", legacy_generate)


@pytest.mark.parametrize("mismatch", ["missing", "app", "account", "source", "end-user", "deleted"])
def test_chat_runtime_preserves_legacy_conversation_ownership_errors(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    mismatch: str,
) -> None:
    conversation_id = _add_conversation(harness, sqlite_session_factory)
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
            case "end-user":
                conversation.from_end_user_id = str(uuid4())
            case "deleted":
                conversation.is_deleted = True

    _patch_chat_generation(monkeypatch, harness)

    with pytest.raises(ConversationNotExistsError):
        harness.runtime.generate(
            app=harness.app,
            account_id=harness.account_id,
            args={**_ARGS, "conversation_id": conversation_id},
            streaming=True,
        )

    assert len(harness.closed_sessions) == 2
    assert all(not session.in_transaction() for session in harness.closed_sessions)
    assert harness.committed_sessions == []


def test_chat_runtime_accepts_owned_conversation_before_checking_its_model_config(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    conversation_id = _add_conversation(harness, sqlite_session_factory)
    args = {**_ARGS, "conversation_id": conversation_id}
    _patch_chat_generation(monkeypatch, harness)

    # A visible conversation reaches the following shared model-config check.
    with pytest.raises(AppModelConfigBrokenError):
        harness.runtime.generate(app=harness.app, account_id=harness.account_id, args=args, streaming=True)

    assert len(harness.closed_sessions) == 2
    assert all(not session.in_transaction() for session in harness.closed_sessions)
    assert harness.committed_sessions == []


@pytest.mark.parametrize(("query", "message"), [("", "query is required"), (1, "query must be a string")])
def test_chat_runtime_keeps_query_validation_before_missing_conversation_error(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, query: str | int, message: str
) -> None:
    _patch_chat_generation(monkeypatch, harness)

    with pytest.raises(ValueError, match=message):
        harness.runtime.generate(
            app=harness.app,
            account_id=harness.account_id,
            args={**_ARGS, "query": query, "conversation_id": str(uuid4())},
            streaming=True,
        )

    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == []


def test_advanced_chat_passes_conversation_to_runtime_without_eager_validation(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(update(App).where(App.id == harness.app.app_id).values(mode=AppMode.ADVANCED_CHAT))
    harness.app = replace(harness.app, app_mode=AppMode.ADVANCED_CHAT)
    args = {**_ARGS, "conversation_id": str(uuid4())}
    stream = _Stream()
    _patch_generation(monkeypatch, harness, lambda _session: stream, streaming=True, args=args)

    result = harness.runtime.generate(app=harness.app, account_id=harness.account_id, args=args, streaming=True)

    assert result is stream
    assert len(harness.closed_sessions) == 2
    assert harness.committed_sessions == [harness.closed_sessions[1]]
    assert stream.read_calls == stream.close_calls == 0
    stream.close()
