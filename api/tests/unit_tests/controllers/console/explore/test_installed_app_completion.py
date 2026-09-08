import json
from collections.abc import Generator, Mapping
from dataclasses import dataclass, field
from datetime import datetime

import pytest
from sqlalchemy.orm import Session, sessionmaker

import controllers.console.explore.completion as completion_module
import services.installed_app_completion_service as completion_service_module
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeError
from models import App, AppMode, InstalledApp, Tenant
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionQueryService
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.conversation import ConversationCompletedError, ConversationNotExistsError
from services.installed_app_completion_service import CompletionResponse, InstalledAppCompletionService
from tests.unit_tests.controllers.console.explore.test_installed_app_admission import (
    _assert_json_response,
    _Harness,
    harness,
)

__all__ = ["harness"]

_USED_AT = datetime(2026, 9, 6, 12, 30, 0)
_BLOCKING_RESPONSE: dict[str, object] = {"event": "message", "answer": "Hello", "metadata": {}, "usage": None}


@dataclass(frozen=True)
class _RuntimeCall:
    app_id: str
    account_id: str
    args: Mapping[str, object]
    streaming: bool


@dataclass
class _Runtime:
    session_factory: sessionmaker[Session]
    installed_app_id: str
    response: CompletionResponse = field(default_factory=lambda: dict(_BLOCKING_RESPONSE))
    error: Exception | None = None
    calls: list[_RuntimeCall] = field(default_factory=list)

    def generate(
        self, *, app_id: str, account_id: str, args: Mapping[str, object], streaming: bool
    ) -> CompletionResponse:
        # The runtime sees a committed usage update through an independent
        # connection, including when generation immediately fails.
        with self.session_factory() as session:
            installation = session.get(InstalledApp, self.installed_app_id)
            assert installation is not None
            assert installation.last_used_at == _USED_AT
        self.calls.append(_RuntimeCall(app_id, account_id, dict(args), streaming))
        if self.error is not None:
            raise self.error
        return self.response


@dataclass(frozen=True)
class _Services:
    installed_app_completion: InstalledAppCompletionService


@pytest.fixture
def runtime(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> _Runtime:
    runtime = _Runtime(sqlite_session_factory, harness.installed_app.id)
    service = InstalledAppCompletionService(
        app_definitions=AppDefinitionQueryService(
            definitions=AppDefinitionQueryRepository(session_factory=sqlite_session_factory),
            builtin_icon_url_prefix="/tools/icons",
        ),
        usage=SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory),
        runtime=runtime,
    )
    services = _Services(installed_app_completion=service)
    monkeypatch.setattr(completion_module, "application_services", lambda: services)
    monkeypatch.setattr(completion_service_module, "naive_utc_now", lambda: _USED_AT)
    harness.api.add_resource(
        completion_module.CompletionApi,
        "/installed-apps/<uuid:installed_app_id>/completion-messages",
    )
    return runtime


def _url(harness: _Harness) -> str:
    return f"/installed-apps/{harness.installed_app.id}/completion-messages"


def _last_used_at(harness: _Harness, session_factory: sessionmaker[Session]) -> datetime | None:
    with session_factory() as session:
        installation = session.get(InstalledApp, harness.installed_app.id)
        assert installation is not None
        return installation.last_used_at


@pytest.mark.parametrize(
    ("payload", "expected_args"),
    [
        (
            {"inputs": {"zero": 0, "enabled": False, "empty": [], "nullable": None}},
            {
                "inputs": {"zero": 0, "enabled": False, "empty": [], "nullable": None},
                "query": "",
                "retriever_from": "explore_app",
                "auto_generate_name": False,
            },
        ),
        (
            {"inputs": {}, "query": "Hi", "files": None, "response_mode": None},
            {"inputs": {}, "query": "Hi", "retriever_from": "explore_app", "auto_generate_name": False},
        ),
        (
            {"inputs": {}, "files": [], "response_mode": "blocking", "auto_generate_name": True},
            {
                "inputs": {},
                "query": "",
                "files": [],
                "response_mode": "blocking",
                "retriever_from": "explore_app",
                "auto_generate_name": False,
            },
        ),
        (
            {
                "inputs": {},
                "files": [{"type": "image", "transfer_method": "remote_url", "url": "https://example.com/image.png"}],
                "retriever_from": "custom-source",
            },
            {
                "inputs": {},
                "query": "",
                "files": [{"type": "image", "transfer_method": "remote_url", "url": "https://example.com/image.png"}],
                "retriever_from": "custom-source",
                "auto_generate_name": False,
            },
        ),
    ],
)
def test_blocking_completion_preserves_payload_defaults_and_response(
    harness: _Harness,
    runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    payload: dict[str, object],
    expected_args: dict[str, object],
) -> None:
    response = harness.app.test_client().post(_url(harness), json=payload)

    assert response.status_code == 200
    assert response.get_json() == _BLOCKING_RESPONSE
    assert dict(response.headers) == {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": str(len(response.data)),
    }
    assert runtime.calls == [_RuntimeCall(harness.target_app.id, harness.account.id, expected_args, False)]
    assert _last_used_at(harness, sqlite_session_factory) == _USED_AT
    assert harness.installed_app.tenant_id != harness.target_app.tenant_id


@pytest.mark.parametrize("consume_all", [False, True])
def test_streaming_completion_preserves_bytes_headers_and_closes_runtime_iterator(
    harness: _Harness,
    runtime: _Runtime,
    consume_all: bool,
) -> None:
    closed: list[bool] = []

    def chunks() -> Generator[str]:
        try:
            yield 'data: {"answer":"你好"}\n\n'
            yield "data: [DONE]\n\n"
        finally:
            closed.append(True)

    runtime.response = chunks()
    response = harness.app.test_client().post(
        _url(harness), json={"inputs": {}, "response_mode": "streaming"}, buffered=False
    )

    assert response.status_code == 200
    assert dict(response.headers) == {"Content-Type": "text/event-stream; charset=utf-8"}
    if consume_all:
        assert response.data == 'data: {"answer":"你好"}\n\ndata: [DONE]\n\n'.encode()
    else:
        assert next(iter(response.response)) == 'data: {"answer":"你好"}\n\n'.encode()
        assert closed == []
    response.close()
    assert closed == [True]
    assert runtime.calls == [
        _RuntimeCall(
            harness.target_app.id,
            harness.account.id,
            {
                "inputs": {},
                "query": "",
                "response_mode": "streaming",
                "retriever_from": "explore_app",
                "auto_generate_name": False,
            },
            True,
        )
    ]


@pytest.mark.parametrize("response_mode", ["blocking", "streaming"])
@pytest.mark.parametrize(
    ("failure", "status", "code", "message"),
    [
        (ConversationNotExistsError(), 404, "not_found", "Conversation Not Exists."),
        (
            ConversationCompletedError(),
            400,
            "conversation_completed",
            "The conversation has ended. Please start a new conversation.",
        ),
        (AppModelConfigBrokenError(), 400, "app_unavailable", "App unavailable, please check your app configurations."),
        (
            ProviderTokenNotInitError("Missing provider credentials"),
            400,
            "provider_not_initialize",
            "Missing provider credentials",
        ),
        (
            QuotaExceededError(),
            400,
            "provider_quota_exceeded",
            "Your quota for Dify Hosted Model Provider has been exhausted. "
            "Please go to Settings -> Model Provider to complete your own provider credentials.",
        ),
        (
            ModelCurrentlyNotSupportError(),
            400,
            "model_currently_not_support",
            "Dify Hosted OpenAI trial currently not support the GPT-4 model.",
        ),
        (InvokeError("Provider rejected input"), 400, "completion_request_error", "Provider rejected input"),
        (ValueError("Invalid runtime arguments"), 400, "invalid_param", "Invalid runtime arguments"),
        (AccountNotFoundError(), 401, "unauthorized", "Account no longer exists."),
        (
            RuntimeError("Unexpected runtime failure"),
            500,
            "internal_server_error",
            "The server encountered an internal error and was unable to complete your request. "
            "Either the server is overloaded or there is an error in the application.",
        ),
    ],
)
def test_completion_preserves_error_contract_and_committed_usage_on_runtime_failure(
    harness: _Harness,
    runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    failure: Exception,
    status: int,
    code: str,
    message: str,
    response_mode: str,
) -> None:
    runtime.error = failure

    response = harness.app.test_client().post(_url(harness), json={"inputs": {}, "response_mode": response_mode})

    _assert_json_response(response, status=status, body={"code": code, "message": message, "status": status})
    assert len(runtime.calls) == 1
    assert runtime.calls[0].streaming == (response_mode == "streaming")
    assert _last_used_at(harness, sqlite_session_factory) == _USED_AT
    if status == 401:
        assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


@pytest.mark.parametrize(
    ("payload", "error"),
    [
        ({}, {"type": "missing", "loc": ["inputs"], "msg": "Field required"}),
        ({"inputs": None}, {"type": "dict_type", "loc": ["inputs"], "msg": "Input should be a valid dictionary"}),
        (
            {"inputs": {}, "response_mode": "invalid"},
            {"type": "literal_error", "loc": ["response_mode"], "msg": "Input should be 'blocking' or 'streaming'"},
        ),
    ],
)
def test_invalid_payload_does_not_record_usage_or_start_runtime(
    harness: _Harness,
    runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    payload: dict[str, object],
    error: dict[str, object],
) -> None:
    response = harness.app.test_client().post(_url(harness), json=payload)

    _assert_json_response(
        response,
        status=422,
        body={"code": "unprocessable_entity", "message": json.dumps([error]), "status": 422},
    )
    assert runtime.calls == []
    assert _last_used_at(harness, sqlite_session_factory) is None


def test_wrong_mode_does_not_record_usage_or_start_runtime(
    harness: _Harness,
    runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.target_app.id)
        assert app is not None
        app.mode = AppMode.CHAT

    response = harness.app.test_client().post(_url(harness), json={"inputs": {}})

    _assert_json_response(
        response, status=400, body={"code": "not_completion_app", "message": "Not Completion App", "status": 400}
    )
    assert runtime.calls == []
    assert _last_used_at(harness, sqlite_session_factory) is None


@pytest.mark.parametrize("rejection", ["permission", "missing", "tenant"])
def test_completion_requires_installed_app_admission_before_payload_validation(
    harness: _Harness,
    runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    rejection: str,
) -> None:
    if rejection == "permission":
        harness.state.allowed = False
    elif rejection == "tenant":
        harness.account._current_tenant = Tenant(name="Other workspace")
    else:
        with sqlite_session_factory.begin() as session:
            installation = session.get(InstalledApp, harness.installed_app.id)
            assert installation is not None
            session.delete(installation)

    response = harness.app.test_client().post(_url(harness), json={})

    if rejection == "permission":
        _assert_json_response(
            response, status=403, body={"code": "access_denied", "message": "App access denied.", "status": 403}
        )
    else:
        _assert_json_response(
            response, status=404, body={"code": "not_found", "message": "Installed app not found", "status": 404}
        )
    assert runtime.calls == []
    if rejection != "missing":
        assert _last_used_at(harness, sqlite_session_factory) is None


@pytest.mark.parametrize("deleted_resource", ["app", "installation"])
def test_resource_removed_after_admission_does_not_start_runtime(
    harness: _Harness,
    runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    deleted_resource: str,
) -> None:
    def delete_resource() -> None:
        with sqlite_session_factory.begin() as session:
            if deleted_resource == "app":
                resource = session.get(App, harness.target_app.id)
            else:
                resource = session.get(InstalledApp, harness.installed_app.id)
            assert resource is not None
            session.delete(resource)

    harness.state.permission_action = delete_resource

    response = harness.app.test_client().post(_url(harness), json={"inputs": {}})

    if deleted_resource == "app":
        _assert_json_response(
            response,
            status=400,
            body={
                "code": "app_unavailable",
                "message": "App unavailable, please check your app configurations.",
                "status": 400,
            },
        )
        assert _last_used_at(harness, sqlite_session_factory) is None
    else:
        _assert_json_response(
            response, status=404, body={"code": "not_found", "message": "Installed app not found", "status": 404}
        )
    assert runtime.calls == []
