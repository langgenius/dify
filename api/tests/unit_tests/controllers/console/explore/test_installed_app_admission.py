import json
from collections.abc import Callable, Generator
from dataclasses import dataclass, field
from operator import itemgetter
from uuid import UUID, uuid4

import pytest
from flask import Flask, Request, got_request_exception
from flask_restx import Resource
from redis.exceptions import ConnectionError as RedisConnectionError
from sqlalchemy import Connection, event, inspect
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.exceptions import Unauthorized
from werkzeug.test import TestResponse

import controllers.console.explore.completion as completion_module
import controllers.console.explore.installed_app_admission as admission_module
import controllers.console.explore.parameter as parameter_module
import controllers.console.explore.saved_message as saved_message_module
import controllers.console.flask_admission as console_admission
import controllers.console.wraps as console_wraps
import core.app.apps.base_app_queue_manager as app_queue_module
import core.app.apps.execution_coordinator as coordinator_module
import libs.login as login_module
import services.app_task_service as app_task_module
from controllers.console.explore.installed_app_admission import get_installed_app
from controllers.console.flask_admission import console_account_admission
from enums import DeploymentEdition
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from libs.external_api import ExternalApi
from machinery.context import RequestContext
from models import Account, App, AppMode, InstalledApp, Tenant
from models.account import AccountStatus
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.app_definition_query_service import AppDefinitionQueryService
from services.app_task_service import AppTaskControlService
from services.installed_app_access_service import InstalledAppAccessService, InstalledAppRef
from services.saved_message_service import SavedMessageActor, SavedMessagePage, SavedMessageRecord, SavedMessageService
from services.webapp_access_query_service import WebAppAccessUnavailableError
from tests.unit_tests.services.test_app_task_service import _StopRedis


@dataclass
class _AdmissionState:
    setup_completed: bool = True
    allowed: bool = True
    permission_error: Exception | None = None
    permission_action: Callable[[], None] | None = None
    events: list[str] = field(default_factory=list)
    permission_calls: list[tuple[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class _ApplicationServices:
    installed_app_access: InstalledAppAccessService


@dataclass(frozen=True)
class _Harness:
    app: Flask
    api: ExternalApi
    account: Account
    installed_app: InstalledApp
    target_app: App
    state: _AdmissionState

    def url(self, *, installed_app_id: str | None = None) -> str:
        return f"/reference/{installed_app_id or self.installed_app.id}/11111111-1111-4111-8111-111111111111"


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
) -> _Harness:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, INIT_PASSWORD="", LOGIN_DISABLED=False)
    state = _AdmissionState()
    account = Account(name="Viewer", email="viewer@example.com")
    viewer_tenant = Tenant(name="Viewer workspace")
    account._current_tenant = viewer_tenant
    target_app = App(
        tenant_id=str(uuid4()),
        name="Shared app",
        mode=AppMode.COMPLETION,
        enable_site=True,
        enable_api=True,
    )
    target_app.id = str(uuid4())
    installed_app = InstalledApp(
        tenant_id=viewer_tenant.id,
        app_id=target_app.id,
        app_owner_tenant_id=target_app.tenant_id,
        position=0,
        is_pinned=False,
        last_used_at=None,
    )
    with sqlite_session_factory() as session:
        session.add_all([target_app, installed_app])
        session.commit()

    # Each real repository session must release its connection before enterprise
    # access is consulted.
    repository_sessions: list[Session] = []

    repository_factory = sessionmaker(
        bind=sqlite_session_factory.kw["bind"],
        expire_on_commit=False,
    )

    @event.listens_for(repository_factory, "after_begin")
    def track_repository_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        repository_sessions.append(session)

    def permission_check(*, user_id: str, app_id: str) -> bool:
        state.events.append("permission")
        state.permission_calls.append((user_id, app_id))
        assert repository_sessions
        assert all(not session.in_transaction() and not session.identity_map for session in repository_sessions)
        if state.permission_error is not None:
            raise state.permission_error
        if state.permission_action is not None:
            state.permission_action()
        return state.allowed

    services = _ApplicationServices(
        installed_app_access=InstalledAppAccessService(
            installed_apps=SQLAlchemyInstalledAppRepository(session_factory=repository_factory),
            is_user_allowed=permission_check,
        )
    )

    def setup_completed() -> bool:
        state.events.append("setup")
        return state.setup_completed

    def check_csrf(_request: Request, user_id: str) -> None:
        assert user_id == account.id
        state.events.append("csrf")

    monkeypatch.setattr(admission_module, "application_services", lambda: services)
    monkeypatch.setattr(login_module, "current_user", account)
    monkeypatch.setattr(login_module, "check_csrf_token", check_csrf)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", setup_completed)
    monkeypatch.setattr(console_admission, "get_request_id", lambda: "request-1")
    monkeypatch.setattr(console_admission, "get_trace_id", lambda: None)

    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    login_manager = DifyLoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized_handler(unauthorized_handler)
    api = ExternalApi(app)

    class ReferenceApi(Resource):
        @console_account_admission()
        @get_installed_app
        def get(
            self,
            request_context: RequestContext,
            reference: InstalledAppRef,
            message_id: UUID,
        ) -> tuple[dict[str, object], int, dict[str, str]]:
            state.events.append("handler")
            assert isinstance(reference, InstalledAppRef)
            assert inspect(reference, raiseerr=False) is None
            return (
                {
                    "id": reference.id,
                    "app_id": reference.app_id,
                    "tenant_id": reference.tenant_id,
                    "account_id": request_context.account_id,
                    "workspace_id": request_context.active_workspace_id,
                    "request_id": request_context.request_id,
                    "trace_id": request_context.trace_id,
                    "message_id": str(message_id),
                },
                202,
                {"X-Installed-App": "accepted"},
            )

    api.add_resource(ReferenceApi, "/reference/<uuid:installed_app_id>/<uuid:message_id>")
    return _Harness(app, api, account, installed_app, target_app, state)


def _assert_json_response(response: TestResponse, *, status: int, body: dict[str, object]) -> None:
    assert response.status_code == status
    assert response.get_json() == body
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)


def test_admission_injects_detached_reference_and_preserves_other_route_arguments(harness: _Harness) -> None:
    response = harness.app.test_client().get(harness.url(), headers={"X-Trace-Id": "trace-1"})

    _assert_json_response(
        response,
        status=202,
        body={
            "id": harness.installed_app.id,
            "app_id": harness.target_app.id,
            "tenant_id": harness.installed_app.tenant_id,
            "account_id": harness.account.id,
            "workspace_id": harness.installed_app.tenant_id,
            "request_id": "request-1",
            "trace_id": "trace-1",
            "message_id": "11111111-1111-4111-8111-111111111111",
        },
    )
    assert response.headers["X-Installed-App"] == "accepted"
    assert harness.installed_app.tenant_id != harness.target_app.tenant_id
    assert harness.state.permission_calls == [(harness.account.id, harness.target_app.id)]
    assert harness.state.events == ["setup", "csrf", "permission", "handler"]


@pytest.mark.parametrize("missing", ["installation", "tenant", "target_app"])
def test_missing_or_foreign_installation_returns_404_before_permission(
    harness: _Harness,
    sqlite_session_factory: sessionmaker[Session],
    missing: str,
) -> None:
    installed_app_id = harness.installed_app.id
    if missing == "installation":
        installed_app_id = str(uuid4())
    elif missing == "tenant":
        harness.account._current_tenant = Tenant(name="Other workspace")
    else:
        with sqlite_session_factory() as session:
            target_app = session.get(App, harness.target_app.id)
            assert target_app is not None
            session.delete(target_app)
            session.commit()

    response = harness.app.test_client().get(harness.url(installed_app_id=installed_app_id))

    _assert_json_response(
        response,
        status=404,
        body={"code": "not_found", "message": "Installed app not found", "status": 404},
    )
    assert harness.state.permission_calls == []
    assert harness.state.events == ["setup", "csrf"]
    with sqlite_session_factory() as session:
        remaining = session.get(InstalledApp, harness.installed_app.id)
        assert (remaining is None) == (missing == "target_app")


def test_access_denied_preserves_error_body_and_never_calls_handler(harness: _Harness) -> None:
    harness.state.allowed = False

    response = harness.app.test_client().get(harness.url())

    _assert_json_response(
        response,
        status=403,
        body={"code": "access_denied", "message": "App access denied.", "status": 403},
    )
    assert harness.state.events == ["setup", "csrf", "permission"]


@pytest.mark.parametrize(
    ("phase", "status", "body", "events"),
    [
        (
            "setup",
            401,
            {
                "code": "not_setup",
                "message": "Dify has not been initialized and installed yet. "
                "Please proceed with the initialization and installation process first.",
                "status": 401,
            },
            ["setup"],
        ),
        ("login", 401, {"code": "unauthorized", "message": "Unauthorized."}, ["setup"]),
        (
            "initialization",
            400,
            {
                "code": "account_not_initialized",
                "message": "The account has not been initialized yet. "
                "Please proceed with the initialization process first.",
                "status": 400,
            },
            ["setup", "csrf"],
        ),
    ],
)
def test_account_admission_precedes_installed_app_lookup(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    phase: str,
    status: int,
    body: dict[str, object],
    events: list[str],
) -> None:
    harness.account.status = AccountStatus.UNINITIALIZED
    if phase in {"setup", "login"}:
        monkeypatch.setattr(login_module, "current_user", None)
    if phase == "setup":
        harness.state.setup_completed = False

    response = harness.app.test_client().get(harness.url(installed_app_id=str(uuid4())))

    _assert_json_response(response, status=status, body=body)
    assert harness.state.events == events
    assert harness.state.permission_calls == []
    if phase == "setup":
        assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


def test_permission_dependency_unavailable_returns_503_without_calling_handler(harness: _Harness) -> None:
    harness.state.permission_error = WebAppAccessUnavailableError()

    response = harness.app.test_client().get(harness.url())

    _assert_json_response(
        response,
        status=503,
        body={
            "code": "web_app_access_unavailable",
            "message": "Web app access service is unavailable.",
            "status": 503,
        },
    )
    assert harness.state.events == ["setup", "csrf", "permission"]
    assert harness.state.permission_calls == [(harness.account.id, harness.target_app.id)]


def test_permission_dependency_http_error_is_not_replaced_by_access_denied(harness: _Harness) -> None:
    error = Unauthorized("Enterprise session expired.")
    harness.state.permission_error = error

    response = harness.app.test_client().get(harness.url())

    _assert_json_response(
        response,
        status=401,
        body={"code": "unauthorized", "message": "Enterprise session expired.", "status": 401},
    )
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert harness.state.events == ["setup", "csrf", "permission"]


def test_csrf_rejection_precedes_account_initialization_and_installation_lookup(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject_csrf(_request: Request, _user_id: str) -> None:
        harness.state.events.append("csrf")
        raise Unauthorized("CSRF token is missing.")

    harness.account.status = AccountStatus.UNINITIALIZED
    monkeypatch.setattr(login_module, "check_csrf_token", reject_csrf)

    response = harness.app.test_client().get(harness.url(installed_app_id=str(uuid4())))

    _assert_json_response(
        response,
        status=401,
        body={"code": "unauthorized", "message": "CSRF token is missing.", "status": 401},
    )
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert harness.state.events == ["setup", "csrf"]
    assert harness.state.permission_calls == []


@dataclass
class _SavedMessageStore:
    messages: set[tuple[str, SavedMessageActor, str]] = field(default_factory=set)

    def pagination_by_last_id(
        self, *, app_id: str, actor: SavedMessageActor, last_id: str | None, limit: int
    ) -> SavedMessagePage:
        assert last_id is None
        return SavedMessagePage(
            limit=limit,
            has_more=False,
            data=tuple(
                SavedMessageRecord(
                    id=message_id,
                    inputs={"count": 0},
                    query="question",
                    answer="answer",
                    message_files=[],
                    user_feedback=None,
                    created_at=None,
                )
                for owner_app, owner_actor, message_id in sorted(self.messages, key=itemgetter(2))
                if (owner_app, owner_actor) == (app_id, actor)
            ),
        )

    def save(self, *, app_id: str, actor: SavedMessageActor, message_id: str) -> None:
        self.messages.add((app_id, actor, message_id))

    def delete(self, *, app_id: str, actor: SavedMessageActor, message_id: str) -> None:
        self.messages.discard((app_id, actor, message_id))


@dataclass(frozen=True)
class _AppDefinitions:
    app_id: str
    parameters: dict[str, object]

    def get_mode(self, app_id: str) -> str:
        assert app_id == self.app_id
        return "completion"

    def get_parameters(self, app_id: str) -> dict[str, object]:
        assert app_id == self.app_id
        return self.parameters

    def get_tool_icons(self, app_id: str) -> dict[str, str]:
        assert app_id == self.app_id
        return {"search": "/tools/search/icon"}


@dataclass(frozen=True)
class _HandlerServices:
    saved_messages: SavedMessageService
    app_definitions: _AppDefinitions


def test_migrated_saved_message_and_parameter_handlers_dispatch_through_full_admission(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parameters: dict[str, object] = {
        "opening_statement": "Welcome",
        "suggested_questions": [],
        "user_input_form": [],
        "system_parameters": {
            "image_file_size_limit": 10,
            "video_file_size_limit": 100,
            "audio_file_size_limit": 50,
            "file_size_limit": 15,
            "workflow_file_upload_limit": 10,
        },
    }
    parameters.update(
        {
            feature: {"enabled": False}
            for feature in (
                "suggested_questions_after_answer",
                "speech_to_text",
                "text_to_speech",
                "retriever_resource",
                "annotation_reply",
                "more_like_this",
                "sensitive_word_avoidance",
                "file_upload",
            )
        }
    )
    store = _SavedMessageStore()
    handler_services = _HandlerServices(
        saved_messages=SavedMessageService(saved_messages=store),
        app_definitions=_AppDefinitions(app_id=harness.target_app.id, parameters=parameters),
    )
    monkeypatch.setattr(saved_message_module, "application_services", lambda: handler_services)
    monkeypatch.setattr(parameter_module, "application_services", lambda: handler_services)
    harness.api.add_resource(saved_message_module.SavedMessageListApi, "/saved/<uuid:installed_app_id>")
    harness.api.add_resource(saved_message_module.SavedMessageApi, "/saved/<uuid:installed_app_id>/<uuid:message_id>")
    harness.api.add_resource(parameter_module.AppParameterApi, "/parameters/<uuid:installed_app_id>")
    harness.api.add_resource(parameter_module.ExploreAppMetaApi, "/meta/<uuid:installed_app_id>")
    client = harness.app.test_client()
    message_id = str(uuid4())
    saved_url = f"/saved/{harness.installed_app.id}"

    created = client.post(saved_url, json={"message_id": message_id})
    _assert_json_response(created, status=200, body={"result": "success"})
    assert store.messages == {(harness.target_app.id, SavedMessageActor.account(harness.account.id), message_id)}
    listed = client.get(saved_url, query_string={"limit": 7})
    _assert_json_response(
        listed,
        status=200,
        body={
            "limit": 7,
            "has_more": False,
            "data": [
                {
                    "id": message_id,
                    "inputs": {"count": 0},
                    "query": "question",
                    "answer": "answer",
                    "message_files": [],
                    "feedback": None,
                    "created_at": None,
                }
            ],
        },
    )
    deleted = client.delete(f"{saved_url}/{message_id}")
    assert deleted.status_code == 204
    assert deleted.data == b""
    assert deleted.headers["Content-Type"] == "application/json"
    assert store.messages == set()
    _assert_json_response(
        client.get(f"/parameters/{harness.installed_app.id}"),
        status=200,
        body=parameters,
    )
    _assert_json_response(
        client.get(f"/meta/{harness.installed_app.id}"),
        status=200,
        body={"tool_icons": {"search": "/tools/search/icon"}},
    )
    assert harness.state.permission_calls == [(harness.account.id, harness.target_app.id)] * 5


@dataclass(frozen=True)
class _StopServices:
    app_definitions: AppDefinitionQueryService
    app_tasks: AppTaskControlService


_TASK_ID = "task-with-non-uuid-id"


@pytest.fixture
def _stop_global_redis(monkeypatch: pytest.MonkeyPatch) -> Generator[_StopRedis]:
    redis = _StopRedis(
        read_error=AssertionError("Must use the injected Redis for ownership reads"),
        flag_error=AssertionError("Must use the injected Redis for stop flags"),
        command_error=AssertionError("Must use the injected Redis for GraphEngine commands"),
    )
    monkeypatch.setattr(app_queue_module, "redis_client", redis)
    monkeypatch.setattr(coordinator_module, "redis_client", redis)
    monkeypatch.setattr(app_task_module, "redis_client", redis)
    yield redis
    # GraphEngine catches Redis failures, so inspect the trap even after HTTP success.
    assert redis.reads == []
    assert redis.operations == []


@pytest.fixture
def stop_redis(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    _stop_global_redis: _StopRedis,
) -> _StopRedis:
    redis = _StopRedis(values={f"generate_task_belong:{_TASK_ID}": f"account-{harness.account.id}".encode()})
    services = _StopServices(
        app_definitions=AppDefinitionQueryService(
            definitions=AppDefinitionQueryRepository(session_factory=sqlite_session_factory),
            builtin_icon_url_prefix="/tools/icons",
        ),
        app_tasks=AppTaskControlService(redis_client=redis),
    )
    monkeypatch.setattr(completion_module, "application_services", lambda: services)
    harness.api.add_resource(
        completion_module.CompletionStopApi,
        "/installed-apps/<uuid:installed_app_id>/completion-messages/<string:task_id>/stop",
    )
    harness.api.add_resource(
        completion_module.ChatStopApi,
        "/installed-apps/<uuid:installed_app_id>/chat-messages/<string:task_id>/stop",
    )
    return redis


def _stop_url(harness: _Harness, message_kind: str) -> str:
    return f"/installed-apps/{harness.installed_app.id}/{message_kind}-messages/{_TASK_ID}/stop"


def _set_app_mode(harness: _Harness, session_factory: sessionmaker[Session], mode: AppMode) -> None:
    with session_factory.begin() as session:
        app = session.get(App, harness.target_app.id)
        assert app is not None
        app.mode = mode


@pytest.mark.parametrize(
    ("message_kind", "mode"),
    [
        ("completion", AppMode.COMPLETION),
        ("chat", AppMode.CHAT),
        ("chat", AppMode.AGENT_CHAT),
        ("chat", AppMode.ADVANCED_CHAT),
    ],
)
def test_stop_handlers_preserve_mode_specific_commands_and_response(
    harness: _Harness,
    stop_redis: _StopRedis,
    sqlite_session_factory: sessionmaker[Session],
    message_kind: str,
    mode: AppMode,
) -> None:
    _set_app_mode(harness, sqlite_session_factory, mode)

    response = harness.app.test_client().post(_stop_url(harness, message_kind))

    _assert_json_response(response, status=200, body={"result": "success"})
    assert stop_redis.reads == [f"generate_task_belong:{_TASK_ID}"]
    assert stop_redis.values[f"generate_task_stopped:{_TASK_ID}"] == b"1"
    assert stop_redis.expirations[f"generate_task_stopped:{_TASK_ID}"] == 600
    if mode == AppMode.ADVANCED_CHAT:
        command_key = f"workflow:{_TASK_ID}:commands"
        assert set(stop_redis.commands) == {command_key}
        assert [json.loads(command) for command in stop_redis.commands[command_key]] == [
            {"command_type": "abort", "payload": None, "reason": "User requested stop"}
        ]
    else:
        assert stop_redis.commands == {}
    assert harness.state.permission_calls == [(harness.account.id, harness.target_app.id)]


@pytest.mark.parametrize(
    ("message_kind", "mode"), [("completion", AppMode.COMPLETION), ("chat", AppMode.ADVANCED_CHAT)]
)
@pytest.mark.parametrize("ownership", ["missing", "different-account", "end-user"])
def test_stop_handlers_preserve_mode_specific_behavior_when_task_ownership_does_not_match(
    harness: _Harness,
    stop_redis: _StopRedis,
    sqlite_session_factory: sessionmaker[Session],
    message_kind: str,
    mode: AppMode,
    ownership: str,
) -> None:
    _set_app_mode(harness, sqlite_session_factory, mode)
    owner_key = f"generate_task_belong:{_TASK_ID}"
    if ownership == "missing":
        stop_redis.values.pop(owner_key)
    elif ownership == "different-account":
        stop_redis.values[owner_key] = b"account-someone-else"
    else:
        stop_redis.values[owner_key] = f"end-user-{harness.account.id}".encode()

    response = harness.app.test_client().post(_stop_url(harness, message_kind))

    _assert_json_response(response, status=200, body={"result": "success"})
    assert stop_redis.reads == [owner_key]
    assert f"generate_task_stopped:{_TASK_ID}" not in stop_redis.values
    if mode == AppMode.ADVANCED_CHAT:
        assert stop_redis.operations == ["graph_command"]
        assert [json.loads(command) for command in stop_redis.commands[f"workflow:{_TASK_ID}:commands"]] == [
            {"command_type": "abort", "payload": None, "reason": "User requested stop"}
        ]
    else:
        assert stop_redis.operations == []
        assert stop_redis.commands == {}


@pytest.mark.parametrize(
    ("message_kind", "mode", "code", "message"),
    [
        ("completion", AppMode.CHAT, "not_completion_app", "Not Completion App"),
        ("chat", AppMode.COMPLETION, "not_chat_app", "App mode is invalid."),
        ("chat", AppMode.WORKFLOW, "not_chat_app", "App mode is invalid."),
    ],
)
def test_stop_handlers_reject_wrong_modes_without_sending_commands(
    harness: _Harness,
    stop_redis: _StopRedis,
    sqlite_session_factory: sessionmaker[Session],
    message_kind: str,
    mode: AppMode,
    code: str,
    message: str,
) -> None:
    _set_app_mode(harness, sqlite_session_factory, mode)

    response = harness.app.test_client().post(_stop_url(harness, message_kind))

    _assert_json_response(response, status=400, body={"code": code, "message": message, "status": 400})
    assert stop_redis.reads == []
    assert stop_redis.commands == {}
    assert f"generate_task_stopped:{_TASK_ID}" not in stop_redis.values


@pytest.mark.parametrize("message_kind", ["completion", "chat"])
def test_stop_handlers_reject_app_removed_after_admission_before_sending_commands(
    harness: _Harness,
    stop_redis: _StopRedis,
    sqlite_session_factory: sessionmaker[Session],
    message_kind: str,
) -> None:
    def remove_app() -> None:
        with sqlite_session_factory.begin() as session:
            app = session.get(App, harness.target_app.id)
            assert app is not None
            session.delete(app)

    harness.state.permission_action = remove_app

    response = harness.app.test_client().post(_stop_url(harness, message_kind))

    _assert_json_response(
        response,
        status=400,
        body={
            "code": "app_unavailable",
            "message": "App unavailable, please check your app configurations.",
            "status": 400,
        },
    )
    assert harness.state.permission_calls == [(harness.account.id, harness.target_app.id)]
    assert stop_redis.reads == []
    assert stop_redis.commands == {}


@pytest.mark.parametrize("message_kind", ["completion", "chat"])
def test_stop_handlers_enforce_admission_before_sending_commands(
    harness: _Harness,
    stop_redis: _StopRedis,
    message_kind: str,
) -> None:
    harness.state.allowed = False

    response = harness.app.test_client().post(_stop_url(harness, message_kind))

    _assert_json_response(
        response,
        status=403,
        body={"code": "access_denied", "message": "App access denied.", "status": 403},
    )
    assert stop_redis.reads == []
    assert stop_redis.commands == {}


@pytest.mark.parametrize(
    ("message_kind", "mode", "failure_stage"),
    [
        ("completion", AppMode.COMPLETION, "read"),
        ("chat", AppMode.CHAT, "read"),
        ("completion", AppMode.COMPLETION, "flag"),
        ("chat", AppMode.ADVANCED_CHAT, "flag"),
    ],
)
def test_stop_handlers_propagate_redis_failure_to_existing_http_error_handler(
    harness: _Harness,
    stop_redis: _StopRedis,
    sqlite_session_factory: sessionmaker[Session],
    message_kind: str,
    mode: AppMode,
    failure_stage: str,
) -> None:
    _set_app_mode(harness, sqlite_session_factory, mode)
    failure = RedisConnectionError("Redis unavailable")
    if failure_stage == "read":
        stop_redis.read_error = failure
    else:
        stop_redis.flag_error = failure
    exceptions: list[Exception] = []

    def capture_exception(_sender: Flask, exception: Exception) -> None:
        exceptions.append(exception)

    with got_request_exception.connected_to(capture_exception):
        response = harness.app.test_client().post(_stop_url(harness, message_kind))

    _assert_json_response(
        response,
        status=500,
        body={"code": "unknown", "message": "Internal Server Error", "status": 500},
    )
    assert any(exception is failure for exception in exceptions)
    assert f"generate_task_stopped:{_TASK_ID}" not in stop_redis.values
    assert stop_redis.commands == {}
    assert stop_redis.operations == (["legacy_flag"] if failure_stage == "flag" else [])


def test_chat_stop_preserves_success_and_legacy_flag_when_graph_redis_fails(
    harness: _Harness,
    stop_redis: _StopRedis,
    sqlite_session_factory: sessionmaker[Session],
    caplog: pytest.LogCaptureFixture,
) -> None:
    _set_app_mode(harness, sqlite_session_factory, AppMode.ADVANCED_CHAT)
    failure = RedisConnectionError("Graph channel unavailable")
    stop_redis.command_error = failure

    response = harness.app.test_client().post(_stop_url(harness, "chat"))

    _assert_json_response(response, status=200, body={"result": "success"})
    assert stop_redis.operations == ["legacy_flag", "graph_command"]
    assert stop_redis.values[f"generate_task_stopped:{_TASK_ID}"] == b"1"
    assert stop_redis.expirations[f"generate_task_stopped:{_TASK_ID}"] == 600
    assert stop_redis.commands == {}
    assert any(record.exc_info is not None and record.exc_info[1] is failure for record in caplog.records)
