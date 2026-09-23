import json
from collections.abc import Generator
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

import controllers.console.explore.completion as completion_module
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeError
from models import AppMode, Conversation, Tenant
from repositories.app_definition_query_repository import AppDefinitionQueryRepository
from repositories.installed_app_repository import SQLAlchemyInstalledAppRepository
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionQueryService
from services.app_generate_service import AppGenerateService
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.conversation import ConversationCompletedError, ConversationNotExistsError
from services.errors.llm import InvokeRateLimitError
from services.installed_app_generation_adapters import AppGenerateServiceRuntime
from services.installed_app_generation_service import GenerationResponse, InstalledAppGenerationService
from tests.unit_tests.controllers.console.explore.test_installed_app_admission import (
    _assert_json_response,
    _Harness,
    _set_app_mode,
    harness,
)
from tests.unit_tests.controllers.console.explore.test_installed_app_completion import (
    _USED_AT,
    _last_used_at,
    _Runtime,
    _RuntimeCall,
    _Services,
    runtime,
)

__all__ = ["harness", "runtime"]

_CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_PARENT_MESSAGE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"


@pytest.fixture
def chat_runtime(
    harness: _Harness,
    runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
) -> _Runtime:
    _set_app_mode(harness, sqlite_session_factory, AppMode.CHAT)
    harness.api.add_resource(completion_module.ChatApi, "/installed-apps/<uuid:installed_app_id>/chat-messages")
    return runtime


def _url(harness: _Harness) -> str:
    return f"/installed-apps/{harness.installed_app.id}/chat-messages"


@pytest.mark.parametrize(
    ("payload", "expected_args"),
    [
        (
            {"inputs": {"zero": 0, "enabled": False, "empty": [], "nullable": None}, "query": ""},
            {"inputs": {"zero": 0, "enabled": False, "empty": [], "nullable": None}, "query": ""},
        ),
        (
            {"inputs": {}, "query": "Hi", "files": None, "conversation_id": None, "parent_message_id": None},
            {"inputs": {}, "query": "Hi"},
        ),
        (
            {
                "inputs": {},
                "query": "Hi",
                "files": [],
                "conversation_id": "",
                "parent_message_id": "",
                "response_mode": "blocking",
                "auto_generate_name": True,
            },
            {"inputs": {}, "query": "Hi", "files": []},
        ),
        (
            {
                "inputs": {},
                "query": "Hi",
                "files": [{"type": "image", "transfer_method": "remote_url", "url": "https://example.com/image.png"}],
                "conversation_id": _CONVERSATION_ID.upper(),
                "parent_message_id": _PARENT_MESSAGE_ID.replace("-", ""),
                "retriever_from": "custom-source",
            },
            {
                "inputs": {},
                "query": "Hi",
                "files": [{"type": "image", "transfer_method": "remote_url", "url": "https://example.com/image.png"}],
                "conversation_id": _CONVERSATION_ID,
                "parent_message_id": _PARENT_MESSAGE_ID,
                "retriever_from": "custom-source",
            },
        ),
    ],
)
def test_chat_preserves_payload_defaults_and_always_requests_streaming(
    harness: _Harness,
    chat_runtime: _Runtime,
    payload: dict[str, object],
    expected_args: dict[str, object],
) -> None:
    def chunks() -> Generator[str]:
        yield 'data: {"answer":"你好","metadata":{},"usage":null}\n\n'

    chat_runtime.response = chunks()
    response = harness.app.test_client().post(_url(harness), json=payload)

    assert response.status_code == 200
    assert dict(response.headers) == {"Content-Type": "text/event-stream; charset=utf-8"}
    assert response.data == 'data: {"answer":"你好","metadata":{},"usage":null}\n\n'.encode()
    response.close()
    expected_args = {"retriever_from": "explore_app", **expected_args, "auto_generate_name": False}
    assert chat_runtime.calls == [_RuntimeCall(harness.target_app.id, harness.account.id, expected_args, True)]
    assert harness.installed_app.tenant_id != harness.target_app.tenant_id


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
@pytest.mark.parametrize("consume_all", [False, True])
def test_chat_modes_preserve_stream_bytes_headers_and_close_on_completion_or_disconnect(
    harness: _Harness,
    chat_runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    mode: AppMode,
    consume_all: bool,
) -> None:
    _set_app_mode(harness, sqlite_session_factory, mode)
    closed: list[bool] = []

    def chunks() -> Generator[str]:
        try:
            yield 'data: {"answer":"Hello"}\n\n'
            yield "data: [DONE]\n\n"
        finally:
            closed.append(True)

    chat_runtime.response = chunks()
    response = harness.app.test_client().post(_url(harness), json={"inputs": {}, "query": "Hi"}, buffered=False)

    assert response.status_code == 200
    assert dict(response.headers) == {"Content-Type": "text/event-stream; charset=utf-8"}
    if consume_all:
        assert response.data == b'data: {"answer":"Hello"}\n\ndata: [DONE]\n\n'
    else:
        assert next(iter(response.response)) == b'data: {"answer":"Hello"}\n\n'
        assert closed == []
    response.close()
    assert closed == [True]
    assert len(chat_runtime.calls) == 1
    assert chat_runtime.calls[0].streaming is True
    assert _last_used_at(harness, sqlite_session_factory) == _USED_AT


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
        (ProviderTokenNotInitError("Missing credentials"), 400, "provider_not_initialize", "Missing credentials"),
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
        (
            InvokeRateLimitError("Concurrent request limit exceeded"),
            429,
            "rate_limit_error",
            "Concurrent request limit exceeded",
        ),
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
def test_chat_preserves_precise_errors_and_committed_usage_when_generation_fails(
    harness: _Harness,
    chat_runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    failure: Exception,
    status: int,
    code: str,
    message: str,
) -> None:
    chat_runtime.error = failure

    response = harness.app.test_client().post(_url(harness), json={"inputs": {}, "query": "Hi"})

    _assert_json_response(response, status=status, body={"code": code, "message": message, "status": status})
    assert len(chat_runtime.calls) == 1
    assert chat_runtime.calls[0].streaming is True
    assert _last_used_at(harness, sqlite_session_factory) == _USED_AT
    if status == 401:
        assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


@pytest.mark.parametrize(
    ("payload", "error"),
    [
        ({"inputs": {}}, {"type": "missing", "loc": ["query"], "msg": "Field required"}),
        (
            {"inputs": {}, "query": None},
            {"type": "string_type", "loc": ["query"], "msg": "Input should be a valid string"},
        ),
        (
            {"inputs": None, "query": "Hi"},
            {"type": "dict_type", "loc": ["inputs"], "msg": "Input should be a valid dictionary"},
        ),
        (
            {"inputs": {}, "query": "Hi", "conversation_id": "invalid"},
            {"type": "value_error", "loc": ["conversation_id"], "msg": "Value error, must be a valid UUID"},
        ),
        (
            {"inputs": {}, "query": "Hi", "parent_message_id": "invalid"},
            {"type": "value_error", "loc": ["parent_message_id"], "msg": "Value error, must be a valid UUID"},
        ),
    ],
)
def test_chat_validates_payload_before_mode_and_never_records_usage_for_invalid_input(
    harness: _Harness,
    chat_runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    payload: dict[str, object],
    error: dict[str, object],
) -> None:
    _set_app_mode(harness, sqlite_session_factory, AppMode.COMPLETION)

    response = harness.app.test_client().post(_url(harness), json=payload)

    _assert_json_response(
        response,
        status=422,
        body={"code": "unprocessable_entity", "message": json.dumps([error]), "status": 422},
    )
    assert chat_runtime.calls == []
    assert _last_used_at(harness, sqlite_session_factory) is None


@pytest.mark.parametrize(
    "mode", [AppMode.COMPLETION, AppMode.WORKFLOW, AppMode.AGENT, AppMode.CHANNEL, AppMode.RAG_PIPELINE]
)
def test_chat_rejects_other_modes_before_recording_usage(
    harness: _Harness,
    chat_runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    mode: AppMode,
) -> None:
    _set_app_mode(harness, sqlite_session_factory, mode)

    response = harness.app.test_client().post(_url(harness), json={"inputs": {}, "query": "Hi"})

    _assert_json_response(
        response, status=400, body={"code": "not_chat_app", "message": "App mode is invalid.", "status": 400}
    )
    assert chat_runtime.calls == []
    assert _last_used_at(harness, sqlite_session_factory) is None


@pytest.mark.parametrize("rejection", ["permission", "tenant"])
def test_chat_enforces_admission_before_payload_validation(
    harness: _Harness,
    chat_runtime: _Runtime,
    sqlite_session_factory: sessionmaker[Session],
    rejection: str,
) -> None:
    if rejection == "permission":
        harness.state.allowed = False
    else:
        harness.account._current_tenant = Tenant(name="Other workspace")

    response = harness.app.test_client().post(_url(harness), json={})

    if rejection == "permission":
        _assert_json_response(
            response, status=403, body={"code": "access_denied", "message": "App access denied.", "status": 403}
        )
    else:
        _assert_json_response(
            response, status=404, body={"code": "not_found", "message": "Installed app not found", "status": 404}
        )
    assert chat_runtime.calls == []
    assert _last_used_at(harness, sqlite_session_factory) is None


@pytest.mark.parametrize("rejection", ["missing", "other_app", "other_account", "api", "deleted"])
@pytest.mark.usefixtures("chat_runtime")
def test_chat_conversation_preflight_returns_404_before_starting_generation_and_preserves_usage(
    harness: _Harness,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    rejection: str,
) -> None:
    conversation_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(harness.account)
        if rejection != "missing":
            session.add(
                Conversation(
                    id=conversation_id,
                    app_id=str(uuid4()) if rejection == "other_app" else harness.target_app.id,
                    from_account_id=str(uuid4()) if rejection == "other_account" else harness.account.id,
                    from_source="api" if rejection == "api" else "console",
                    mode=AppMode.CHAT,
                    name="Existing conversation",
                    _inputs={},
                    is_deleted=rejection == "deleted",
                )
            )

    services = _Services(
        installed_app_generation=InstalledAppGenerationService(
            app_definitions=AppDefinitionQueryService(
                definitions=AppDefinitionQueryRepository(session_factory=sqlite_session_factory),
                builtin_icon_url_prefix="/tools/icons",
            ),
            usage=SQLAlchemyInstalledAppRepository(session_factory=sqlite_session_factory),
            runtime=AppGenerateServiceRuntime(session_factory=sqlite_session_factory),
        )
    )
    monkeypatch.setattr(completion_module, "application_services", lambda: services)
    generation_started: list[bool] = []

    def generate(**_kwargs: object) -> GenerationResponse:
        generation_started.append(True)
        pytest.fail("The generation runtime must not start for an inaccessible conversation")

    monkeypatch.setattr(AppGenerateService, "generate", generate)

    response = harness.app.test_client().post(
        _url(harness), json={"inputs": {}, "query": "Hi", "conversation_id": conversation_id}, buffered=False
    )

    _assert_json_response(
        response, status=404, body={"code": "not_found", "message": "Conversation Not Exists.", "status": 404}
    )
    assert generation_started == []
    assert _last_used_at(harness, sqlite_session_factory) == _USED_AT
