"""Trial admission and generation through real HTTP handlers and SQLite repositories."""

from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import override
from uuid import uuid4

import pytest
from flask import Flask, Request
from sqlalchemy import Connection, event, select
from sqlalchemy.orm import Mapper, Session, SessionTransaction, sessionmaker
from werkzeug.exceptions import Unauthorized
from werkzeug.test import TestResponse

import controllers.console.explore.trial as trial_module
import controllers.console.explore.trial_app_admission as admission_module
import controllers.console.wraps as console_wraps
import libs.login as login_module
from core.errors.error import (
    AppInvokeQuotaExceededError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from enums import DeploymentEdition
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from graphon.model_runtime.errors.invoke import InvokeError
from libs.external_api import ExternalApi
from models import Account, AccountTrialAppRecord, App, AppMode, Tenant, TrialApp
from models.account import AccountStatus
from repositories.trial_app_repository import TrialAppRepository
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.conversation import ConversationCompletedError, ConversationNotExistsError
from services.errors.llm import InvokeRateLimitError
from services.trial_app_access_service import TrialAppAccessService, TrialAppRef
from services.trial_app_generation_service import GenerationResponse, TrialAppGenerationService


@dataclass
class _FeatureState:
    enabled: bool = True
    setup_completed: bool = True
    events: list[str] = field(default_factory=list)

    def is_trial_enabled(self) -> bool:
        self.events.append("feature")
        return self.enabled


@dataclass(frozen=True)
class _GenerationCall:
    app: TrialAppRef
    account_id: str
    args: Mapping[str, object]
    streaming: bool


@dataclass
class _Stream(Iterator[str]):
    chunks: Iterator[str] = field(default_factory=lambda: iter(['data: {"answer":"first"}\n\n', "data: [DONE]\n\n"]))
    reads: int = 0
    close_calls: int = 0
    close_error: Exception | None = None
    on_read: Callable[[], None] | None = None

    @override
    def __next__(self) -> str:
        if self.on_read is not None:
            self.on_read()
        chunk = next(self.chunks)
        self.reads += 1
        return chunk

    def close(self) -> None:
        self.close_calls += 1
        if self.close_error is not None:
            raise self.close_error


@dataclass
class _Runtime:
    sessions: list[Session]
    response: GenerationResponse = field(
        default_factory=lambda: {"answer": "", "metadata": dict[str, object](), "created_at": 0}
    )
    error: Exception | None = None
    calls: list[_GenerationCall] = field(default_factory=list)
    before_generate: Callable[[], None] | None = None

    def generate(
        self, *, app: TrialAppRef, account_id: str, args: Mapping[str, object], streaming: bool
    ) -> GenerationResponse:
        # Database admission must release its connection before model invocation.
        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        self.calls.append(_GenerationCall(app, account_id, dict(args), streaming))
        if self.before_generate is not None:
            self.before_generate()
        if self.error is not None:
            raise self.error
        return self.response


@dataclass
class _Tasks:
    calls: list[str] = field(default_factory=list)

    def stop_workflow_task_no_user_check(self, *, task_id: str) -> None:
        self.calls.append(task_id)


@dataclass(frozen=True)
class _ApplicationServices:
    trial_app_access: TrialAppAccessService
    trial_app_generation: TrialAppGenerationService
    recommended_app_queries: _FeatureState
    app_tasks: _Tasks


@dataclass(frozen=True)
class _Harness:
    app: Flask
    account: Account
    target: App
    trial: TrialApp
    factory: sessionmaker[Session]
    services: _ApplicationServices
    runtime: _Runtime
    state: _FeatureState

    def url(self, endpoint: str, *, app_id: str | None = None) -> str:
        return f"/trial-apps/{app_id or self.target.id}/{endpoint}"

    def post(self, endpoint: str, *, payload: Mapping[str, object] | None = None) -> TestResponse:
        return self.app.test_client().post(self.url(endpoint), json=dict(payload or {"inputs": {}}))

    def set_mode(self, mode: AppMode) -> None:
        with self.factory.begin() as session:
            app = session.get(App, self.target.id)
            assert app is not None
            app.mode = mode

    def usage(self) -> int | None:
        with self.factory() as session:
            return session.scalar(
                select(AccountTrialAppRecord.count).where(
                    AccountTrialAppRecord.app_id == self.target.id,
                    AccountTrialAppRecord.account_id == self.account.id,
                )
            )


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
) -> _Harness:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, INIT_PASSWORD="", LOGIN_DISABLED=False)
    state = _FeatureState()
    account = Account(name="Viewer", email="viewer@example.com")
    account._current_tenant = Tenant(name="Viewer workspace")
    target = App(tenant_id=str(uuid4()), name="Trial app", mode=AppMode.COMPLETION, enable_site=True, enable_api=True)
    target.id = str(uuid4())
    trial = TrialApp(app_id=target.id, tenant_id=target.tenant_id, trial_limit=3)
    with sqlite_session_factory.begin() as session:
        session.add_all([target, trial])

    sessions: list[Session] = []
    repository_factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], expire_on_commit=False)

    @event.listens_for(repository_factory, "after_begin")
    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    runtime = _Runtime(sessions=sessions)
    repository = TrialAppRepository(session_factory=repository_factory)
    services = _ApplicationServices(
        trial_app_access=TrialAppAccessService(apps=repository),
        trial_app_generation=TrialAppGenerationService(runtime=runtime, usage=repository),
        recommended_app_queries=state,
        app_tasks=_Tasks(),
    )

    def setup_completed() -> bool:
        state.events.append("setup")
        return state.setup_completed

    def csrf(_request: Request, account_id: str) -> None:
        assert account_id == account.id
        state.events.append("csrf")

    for module in (trial_module, admission_module):
        monkeypatch.setattr(module, "application_services", lambda: services)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", setup_completed)
    monkeypatch.setattr(login_module, "current_user", account)
    monkeypatch.setattr(login_module, "check_csrf_token", csrf)

    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    login_manager = DifyLoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized_handler(unauthorized_handler)
    api = ExternalApi(app)
    for resource, endpoint in (
        (trial_module.TrialAppWorkflowRunApi, "workflows/run"),
        (trial_module.TrialChatApi, "chat-messages"),
        (trial_module.TrialCompletionApi, "completion-messages"),
        (trial_module.TrialAppWorkflowTaskStopApi, "workflows/tasks/<string:task_id>/stop"),
    ):
        api.add_resource(resource, f"/trial-apps/<uuid:app_id>/{endpoint}")
    return _Harness(app, account, target, trial, sqlite_session_factory, services, runtime, state)


def _assert_error(response: TestResponse, status: int, code: str) -> Mapping[str, object]:
    assert response.status_code == status
    body = response.get_json()
    assert isinstance(body, dict)
    assert body["code"] == code
    assert body["status"] == status
    assert response.headers["Content-Type"] == "application/json"
    assert isinstance(body["message"], str)
    assert body["message"]
    return body


@pytest.mark.parametrize("response_mode", [None, "blocking"])
def test_completion_blocking_preserves_response_and_uses_app_owner(
    harness: _Harness, response_mode: str | None
) -> None:
    response = harness.post("completion-messages", payload={"inputs": {}, "response_mode": response_mode})

    assert response.status_code == 200
    assert response.get_json() == {"answer": "", "metadata": {}, "created_at": 0}
    assert response.headers["Content-Type"] == "application/json; charset=utf-8"
    assert int(response.headers["Content-Length"]) == len(response.data)
    assert harness.usage() == 1
    assert harness.state.events == ["setup", "csrf", "feature"]
    call = harness.runtime.calls[0]
    assert call.app == TrialAppRef(
        app_id=harness.target.id, tenant_id=harness.target.tenant_id, app_mode=AppMode.COMPLETION
    )
    assert call.app.tenant_id != harness.account.current_tenant_id
    assert call.account_id == harness.account.id
    assert call.streaming is False
    assert call.args == {
        "inputs": {},
        "query": "",
        "files": None,
        "response_mode": response_mode,
        "retriever_from": "explore_app",
        "auto_generate_name": False,
    }


@pytest.mark.parametrize(
    ("endpoint", "mode", "payload"),
    [
        ("workflows/run", AppMode.WORKFLOW, {"inputs": {"number": 0}, "files": []}),
        ("chat-messages", AppMode.CHAT, {"inputs": {}, "query": "hello"}),
        ("chat-messages", AppMode.ADVANCED_CHAT, {"inputs": {}, "query": "hello"}),
        ("chat-messages", AppMode.AGENT_CHAT, {"inputs": {}, "query": "hello"}),
        ("completion-messages", AppMode.COMPLETION, {"inputs": {}, "response_mode": "streaming"}),
    ],
)
def test_stream_records_usage_after_runtime_returns_before_consumption(
    harness: _Harness, endpoint: str, mode: AppMode, payload: Mapping[str, object]
) -> None:
    harness.set_mode(mode)

    def before_generate() -> None:
        assert harness.usage() is None

    def before_read() -> None:
        assert harness.usage() == 1

    stream = _Stream(on_read=before_read)
    harness.runtime.response = stream
    harness.runtime.before_generate = before_generate
    response = harness.post(endpoint, payload=payload)

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "text/event-stream; charset=utf-8"
    assert "Content-Length" not in response.headers
    assert response.data == b'data: {"answer":"first"}\n\ndata: [DONE]\n\n'
    response.close()
    assert harness.usage() == 1
    assert harness.runtime.calls[0].streaming is True
    if endpoint == "chat-messages":
        assert harness.runtime.calls[0].args["auto_generate_name"] is False
    elif endpoint == "workflows/run":
        assert harness.runtime.calls[0].args == payload


@pytest.mark.parametrize(
    "endpoint", ["completion-messages", "chat-messages", "workflows/run", "workflows/tasks/task/stop"]
)
@pytest.mark.parametrize(
    ("state", "status", "code"), [("setup", 401, "not_setup"), ("feature", 403, "trial_app_feature_disabled")]
)
def test_bootstrap_and_feature_admission_apply_before_trial_lookup(
    harness: _Harness, endpoint: str, state: str, status: int, code: str
) -> None:
    if state == "setup":
        harness.state.setup_completed = False
    else:
        harness.state.enabled = False
    response = harness.app.test_client().post(harness.url(endpoint, app_id=str(uuid4())), json={})

    _assert_error(response, status, code)
    assert harness.state.events == (["setup"] if state == "setup" else ["setup", "csrf", "feature"])
    assert harness.runtime.calls == []
    assert harness.services.app_tasks.calls == []


@pytest.mark.parametrize(
    ("case", "code"),
    [
        ("missing_trial", "trial_app_not_allowed"),
        ("missing_app", "trial_app_not_allowed"),
        ("limit", "trial_app_limit_exceeded"),
    ],
)
def test_trial_lookup_and_account_limit_block_generation(harness: _Harness, case: str, code: str) -> None:
    with harness.factory.begin() as session:
        if case == "missing_trial":
            trial = session.get(TrialApp, harness.trial.id)
            assert trial is not None
            session.delete(trial)
        elif case == "missing_app":
            target = session.get(App, harness.target.id)
            assert target is not None
            session.delete(target)
        else:
            session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))
    response = harness.post("completion-messages")

    _assert_error(response, 403, code)
    assert harness.runtime.calls == []


@pytest.mark.parametrize("count", [0, 2])
def test_usage_increments_existing_record_and_ignores_other_account(harness: _Harness, count: int) -> None:
    other_id = str(uuid4())
    with harness.factory.begin() as session:
        session.add_all(
            [
                AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=count),
                AccountTrialAppRecord(app_id=harness.target.id, account_id=other_id, count=99),
            ]
        )
    response = harness.post("completion-messages")

    assert response.status_code == 200
    assert harness.usage() == count + 1
    with harness.factory() as session:
        assert (
            session.scalar(select(AccountTrialAppRecord.count).where(AccountTrialAppRecord.account_id == other_id))
            == 99
        )


@pytest.mark.parametrize(
    ("endpoint", "mode", "code"),
    [
        ("completion-messages", AppMode.CHAT, "not_completion_app"),
        ("chat-messages", AppMode.COMPLETION, "not_chat_app"),
        ("workflows/run", AppMode.CHAT, "not_workflow_app"),
        ("workflows/tasks/task/stop", AppMode.CHAT, "not_workflow_app"),
    ],
)
def test_wrong_mode_returns_specific_error_without_invocation(
    harness: _Harness, endpoint: str, mode: AppMode, code: str
) -> None:
    harness.set_mode(mode)
    response = harness.post(endpoint, payload={"inputs": {}, "query": "hello"})

    _assert_error(response, 400, code)
    assert harness.runtime.calls == []
    assert harness.services.app_tasks.calls == []
    assert harness.usage() is None


@pytest.mark.parametrize("field", ["conversation_id", "parent_message_id"])
def test_chat_rejects_invalid_uuid_before_runtime(harness: _Harness, field: str) -> None:
    harness.set_mode(AppMode.CHAT)
    response = harness.post("chat-messages", payload={"inputs": {}, "query": "hello", field: "not-a-uuid"})

    _assert_error(response, 400, "invalid_param")
    assert harness.runtime.calls == []
    assert harness.usage() is None


def test_chat_normalizes_uuid_and_preserves_empty_ids(harness: _Harness) -> None:
    harness.set_mode(AppMode.CHAT)
    conversation_id = uuid4()
    response = harness.post(
        "chat-messages",
        payload={
            "inputs": {},
            "query": "hello",
            "conversation_id": conversation_id.hex.upper(),
            "parent_message_id": "",
        },
    )

    assert response.status_code == 200
    assert harness.runtime.calls[0].args["conversation_id"] == str(conversation_id)
    assert harness.runtime.calls[0].args["parent_message_id"] == ""


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (ProviderTokenNotInitError("missing key for provider"), 400, "provider_not_initialize"),
        (QuotaExceededError(), 400, "provider_quota_exceeded"),
        (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support"),
        (InvokeError("provider rejected request"), 400, "completion_request_error"),
        (InvokeRateLimitError("too many requests"), 429, "rate_limit_error"),
        (AppInvokeQuotaExceededError("active requests exceeded"), 429, "rate_limit_error"),
        (AppDefinitionUnavailableError("app removed"), 400, "app_unavailable"),
        (AccountNotFoundError("account removed"), 401, "unauthorized"),
        (AppModelConfigBrokenError(), 400, "app_unavailable"),
    ],
)
@pytest.mark.parametrize(
    ("endpoint", "mode"),
    [
        ("completion-messages", AppMode.COMPLETION),
        ("chat-messages", AppMode.CHAT),
        ("workflows/run", AppMode.WORKFLOW),
    ],
)
def test_runtime_errors_keep_specific_codes_and_do_not_record_usage(
    harness: _Harness, endpoint: str, mode: AppMode, error: Exception, status: int, code: str
) -> None:
    harness.set_mode(mode)
    harness.runtime.error = error
    response = harness.post(endpoint, payload={"inputs": {}, "query": "hello"})

    body = _assert_error(response, status, code)
    if isinstance(error, (ProviderTokenNotInitError, InvokeError, InvokeRateLimitError)):
        assert body["message"] == error.description
    assert harness.usage() is None


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (ConversationNotExistsError(), 404, "not_found"),
        (ConversationCompletedError(), 400, "conversation_completed"),
        (AppModelConfigBrokenError(), 400, "app_unavailable"),
    ],
)
@pytest.mark.parametrize(
    ("endpoint", "mode"), [("completion-messages", AppMode.COMPLETION), ("chat-messages", AppMode.CHAT)]
)
def test_conversation_and_config_errors_remain_actionable(
    harness: _Harness, endpoint: str, mode: AppMode, error: Exception, status: int, code: str
) -> None:
    harness.set_mode(mode)
    harness.runtime.error = error
    response = harness.post(endpoint, payload={"inputs": {}, "query": "hello"})

    _assert_error(response, status, code)
    assert harness.usage() is None


def test_stop_retains_trial_quota_admission_without_recording_usage(harness: _Harness) -> None:
    harness.set_mode(AppMode.WORKFLOW)
    response = harness.post("workflows/tasks/task-123/stop")

    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}
    assert harness.services.app_tasks.calls == ["task-123"]
    assert harness.usage() is None
    with harness.factory.begin() as session:
        session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))
    blocked = harness.post("workflows/tasks/task-456/stop")
    _assert_error(blocked, 403, "trial_app_limit_exceeded")
    assert harness.services.app_tasks.calls == ["task-123"]


def test_unauthenticated_account_cannot_enter_trial(harness: _Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(login_module, "current_user", None)
    response = harness.post("completion-messages")

    assert response.status_code == 401
    assert harness.state.events == ["setup"]
    assert harness.runtime.calls == []


def test_uninitialized_account_cannot_enter_trial(harness: _Harness) -> None:
    harness.account.status = AccountStatus.UNINITIALIZED
    response = harness.post("completion-messages")

    _assert_error(response, 400, "account_not_initialized")
    assert harness.state.events == ["setup", "csrf"]
    assert harness.runtime.calls == []


def test_failed_csrf_cannot_enter_trial(harness: _Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    def reject_csrf(_request: Request, _account_id: str) -> None:
        raise Unauthorized("invalid csrf token")

    monkeypatch.setattr(login_module, "check_csrf_token", reject_csrf)
    response = harness.post("completion-messages")

    _assert_error(response, 401, "unauthorized")
    assert harness.runtime.calls == []


def test_payload_validation_keeps_field_context(harness: _Harness) -> None:
    response = harness.post("completion-messages", payload={"inputs": [], "response_mode": "invalid"})

    body = _assert_error(response, 422, "unprocessable_entity")
    assert "inputs" in str(body)
    assert harness.runtime.calls == []
    assert harness.usage() is None


@pytest.mark.parametrize("cleanup_fails", [False, True])
@pytest.mark.parametrize(
    ("endpoint", "mode"),
    [("completion-messages", AppMode.COMPLETION), ("chat-messages", AppMode.CHAT), ("workflows/run", AppMode.WORKFLOW)],
)
def test_usage_write_failure_closes_unconsumed_stream_without_hiding_database_error(
    harness: _Harness, endpoint: str, mode: AppMode, cleanup_fails: bool, caplog: pytest.LogCaptureFixture
) -> None:
    harness.set_mode(mode)
    stream = _Stream(close_error=RuntimeError("cleanup failed") if cleanup_fails else None)
    harness.runtime.response = stream
    failure = RuntimeError("usage database unavailable")

    def reject_usage_insert(
        _mapper: Mapper[AccountTrialAppRecord], _connection: Connection, _record: AccountTrialAppRecord
    ) -> None:
        raise failure

    # Fail the persistence boundary, retaining the real service, unit of work,
    # SQLAlchemy rollback and HTTP error handler.
    event.listen(AccountTrialAppRecord, "before_insert", reject_usage_insert)
    try:
        response = harness.post(endpoint, payload={"inputs": {}, "query": "hello", "response_mode": "streaming"})
    finally:
        event.remove(AccountTrialAppRecord, "before_insert", reject_usage_insert)

    _assert_error(response, 500, "internal_server_error")
    assert stream.close_calls == 1
    assert stream.reads == 0
    assert harness.usage() is None
    assert any(record.exc_info is not None and record.exc_info[1] is failure for record in caplog.records)


def test_later_stream_failure_does_not_refund_trial_usage(harness: _Harness) -> None:
    def chunks() -> Iterator[str]:
        yield 'data: {"answer":"partial"}\n\n'
        raise RuntimeError("provider disconnected")

    harness.runtime.response = _Stream(chunks=chunks())
    response = harness.post("completion-messages", payload={"inputs": {}, "response_mode": "streaming"})

    chunks = iter(response.response)
    assert next(chunks) == b'data: {"answer":"partial"}\n\n'
    with pytest.raises(RuntimeError, match="provider disconnected"):
        next(chunks)
    response.close()
    assert harness.usage() == 1
