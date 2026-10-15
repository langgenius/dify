"""All six Console audio routes use real admission, configuration and provider HTTP."""

import json
from collections.abc import Callable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy import update

from enums.account import TenantAccountRole
from models import App, AppModelConfig, Message, TenantAccountJoin
from models.enums import MessageStatus
from models.model import AppMode
from models.provider import Provider
from services.audio_service import FILE_SIZE_LIMIT
from services.enterprise.base import EnterpriseRequest
from tests.unit_tests.model_factories import make_workflow
from tests.unit_tests.services.audio_runtime_fixtures import WAV_AUDIO
from tests.unit_tests.services.console_audio_fixtures import AudioOperation, ConsoleAudioHarness

pytest_plugins = (
    "tests.unit_tests.services.audio_runtime_fixtures",
    "tests.unit_tests.services.console_audio_fixtures",
)


@pytest.mark.parametrize("agent", [False, True], ids=["app", "agent"])
@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
def test_six_audio_routes_use_real_provider(
    console_audio: ConsoleAudioHarness, agent: bool, operation: AudioOperation
) -> None:
    if agent:
        console_audio.add_agent()
    response = console_audio.request(
        operation,
        agent=agent,
        payload={"language": "en-US"}
        if operation == "voices"
        else {"text": "  Preview  "}
        if operation == "tts"
        else {},
    )
    try:
        assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
        if operation == "tts":
            assert response.data == WAV_AUDIO
            assert response.content_type == "audio/wav"
            assert "Content-Disposition" not in response.headers
            assert "Content-Length" not in response.headers
            invocation = console_audio.plugin.invocations("tts")[0]
            data = cast(dict[str, object], invocation["data"])
            assert data["content_text"] == "Preview"
            # Console preview does not use the published configuration's voice.
            assert data["voice"] == "fallback-voice"
        elif operation == "asr":
            assert response.get_json() == {"text": " transcript "}
            invocation = console_audio.plugin.invocations("speech2text")[0]
            assert cast(dict[str, object], invocation["data"])["file"] == b"recording".hex()
        else:
            assert response.get_json() == [{"name": "Fallback voice", "value": "fallback-voice"}]
            invocation = next(
                payload for path, payload in console_audio.plugin.requests if path.endswith("/tts/model/voices")
            )
            assert cast(dict[str, object], invocation["data"])["language"] == "en-US"
        assert "user_id" not in invocation
        assert console_audio.sessions
        console_audio.assert_closed()
    finally:
        response.close()


@pytest.mark.parametrize("agent", [False, True])
def test_owned_message_takes_priority_over_text(console_audio: ConsoleAudioHarness, agent: bool) -> None:
    if agent:
        console_audio.add_agent()
    response = console_audio.request(
        "tts", agent=agent, payload={"text": "Ignored", "message_id": console_audio.message.id, "voice": "selected"}
    )
    try:
        assert response.status_code == HTTPStatus.OK
        assert response.data == WAV_AUDIO
        data = cast(dict[str, object], console_audio.plugin.invocations("tts")[0]["data"])
        assert data["content_text"] == "Owned console answer"
        assert data["voice"] == "selected"
    finally:
        response.close()


@pytest.mark.parametrize("field", ["app_id", "from_account_id"])
def test_unowned_message_returns_null_without_text_fallback(console_audio: ConsoleAudioHarness, field: str) -> None:
    with console_audio.factory.begin() as session:
        session.execute(update(Message).where(Message.id == console_audio.message.id).values({field: str(uuid4())}))
    response = console_audio.request("tts", payload={"text": "Must not speak", "message_id": console_audio.message.id})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() is None
    assert not console_audio.plugin.requests


@pytest.mark.parametrize("status", [MessageStatus.NORMAL, MessageStatus.PAUSED])
def test_empty_owned_message_returns_null(console_audio: ConsoleAudioHarness, status: MessageStatus) -> None:
    with console_audio.factory.begin() as session:
        session.execute(update(Message).where(Message.id == console_audio.message.id).values(answer="", status=status))
    response = console_audio.request("tts", payload={"text": "Must not speak", "message_id": console_audio.message.id})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() is None
    assert not console_audio.plugin.requests


@pytest.mark.parametrize("agent", [False, True])
@pytest.mark.parametrize(
    ("content", "mime_type", "status", "code"),
    [
        (None, "audio/mp3", HTTPStatus.BAD_REQUEST, "no_audio_uploaded"),
        (b"x", "text/plain", HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_audio_type"),
    ],
)
def test_upload_errors_are_specific(
    console_audio: ConsoleAudioHarness,
    agent: bool,
    content: bytes | None,
    mime_type: str,
    status: HTTPStatus,
    code: str,
) -> None:
    if agent:
        console_audio.add_agent()
    response = console_audio.request("asr", agent=agent, content=content, mime_type=mime_type)
    assert response.status_code == status
    assert response.get_json()["code"] == code
    assert not console_audio.plugin.requests


def test_oversized_upload_never_reaches_provider(console_audio: ConsoleAudioHarness) -> None:
    response = console_audio.request("asr", content=b"x" * (FILE_SIZE_LIMIT + 1))
    assert response.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE
    assert response.get_json()["code"] == "audio_too_large"
    assert not console_audio.plugin.requests


@pytest.mark.parametrize("missing", [False, True], ids=["disabled", "missing"])
def test_app_asr_requires_published_configuration(console_audio: ConsoleAudioHarness, missing: bool) -> None:
    with console_audio.factory.begin() as session:
        if missing:
            session.execute(
                update(App).where(App.id == console_audio.target.id).values({App.app_model_config_id: None})
            )
        else:
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == console_audio.config.id)
                .values(speech_to_text='{"enabled":false}')
            )
    response = console_audio.request("asr")
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "speech_to_text_disabled"
    assert not console_audio.plugin.requests


@pytest.mark.parametrize("published_enabled", [False, True])
def test_app_agent_asr_uses_published_soul_but_agent_asr_uses_draft(
    console_audio: ConsoleAudioHarness, published_enabled: bool
) -> None:
    console_audio.add_agent(published_enabled=published_enabled, draft_enabled=not published_enabled)
    app_response = console_audio.request("asr")
    agent_response = console_audio.request("asr", agent=True)
    assert app_response.status_code == (HTTPStatus.OK if published_enabled else HTTPStatus.BAD_REQUEST)
    assert agent_response.status_code == (HTTPStatus.BAD_REQUEST if published_enabled else HTTPStatus.OK)
    denied = agent_response if published_enabled else app_response
    assert denied.get_json()["code"] == "speech_to_text_disabled"
    assert len(console_audio.plugin.invocations("speech2text")) == 1


@pytest.mark.parametrize("own_build", [False, True], ids=["other-account", "own-account"])
def test_debug_build_is_scoped_to_current_account(console_audio: ConsoleAudioHarness, own_build: bool) -> None:
    console_audio.add_agent(
        draft_enabled=False,
        debug_enabled=True,
        debug_account_id=console_audio.account.id if own_build else str(uuid4()),
    )
    response = console_audio.request("asr", agent=True, payload={"draft_type": "debug_build"})
    assert response.status_code == (HTTPStatus.OK if own_build else HTTPStatus.NOT_FOUND)
    assert bool(console_audio.plugin.invocations("speech2text")) is own_build


def test_app_tts_preview_does_not_require_published_enabled_configuration(console_audio: ConsoleAudioHarness) -> None:
    with console_audio.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == console_audio.config.id)
            .values(text_to_speech='{"enabled":false}')
        )
    response = console_audio.request("tts", payload={"text": "Preview"})
    try:
        assert response.status_code == HTTPStatus.OK
        assert response.data == WAV_AUDIO
    finally:
        response.close()


@pytest.mark.parametrize("draft_enabled", [False, True])
def test_advanced_chat_tts_preview_uses_draft_not_published_workflow(
    console_audio: ConsoleAudioHarness, draft_enabled: bool
) -> None:
    with console_audio.factory.begin() as session:
        published = make_workflow(
            tenant_id=console_audio.tenant.id,
            app_id=console_audio.target.id,
            version="published",
            features={"text_to_speech": {"enabled": not draft_enabled, "voice": "published"}},
        )
        draft = make_workflow(
            tenant_id=console_audio.tenant.id,
            app_id=console_audio.target.id,
            features={"text_to_speech": {"enabled": draft_enabled, "voice": "draft"}},
        )
        session.add_all([published, draft])
        session.flush()
        session.execute(
            update(App)
            .where(App.id == console_audio.target.id)
            .values({App.mode: AppMode.ADVANCED_CHAT, App.workflow_id: published.id})
        )
    response = console_audio.request("tts", payload={"text": "Preview"})
    try:
        assert response.status_code == (HTTPStatus.OK if draft_enabled else HTTPStatus.BAD_REQUEST)
        if draft_enabled:
            assert response.data == WAV_AUDIO
            assert cast(dict[str, object], console_audio.plugin.invocations("tts")[0]["data"])["voice"] == "draft"
        else:
            assert response.get_json()["code"] == "invalid_param"
            assert not console_audio.plugin.requests
    finally:
        response.close()


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
@pytest.mark.parametrize("agent", [False, True])
def test_real_provider_failure_is_translated(
    console_audio: ConsoleAudioHarness, operation: AudioOperation, agent: bool
) -> None:
    if agent:
        console_audio.add_agent()
    console_audio.plugin.error = "InvokeServerUnavailableError"
    response = console_audio.request(
        operation,
        agent=agent,
        payload={"language": "en-US"}
        if operation == "voices"
        else {"text": "Preview", "voice": "selected"}
        if operation == "tts"
        else {},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "completion_request_error"
    assert "Audio provider unavailable" in response.get_json()["message"]


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
def test_missing_provider_credentials_keep_specific_error(
    console_audio: ConsoleAudioHarness, operation: AudioOperation
) -> None:
    with console_audio.factory.begin() as session:
        session.execute(update(Provider).values(is_valid=False))
    response = console_audio.request(
        operation,
        payload={"language": "en-US"} if operation == "voices" else {"text": "Preview"} if operation == "tts" else {},
    )
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "provider_not_initialize"


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
@pytest.mark.parametrize(
    "role",
    [
        TenantAccountRole.OWNER,
        TenantAccountRole.ADMIN,
        TenantAccountRole.EDITOR,
        TenantAccountRole.NORMAL,
        TenantAccountRole.DATASET_OPERATOR,
    ],
)
def test_agent_role_matrix_preserves_readonly_voice_access(
    console_audio: ConsoleAudioHarness, operation: AudioOperation, role: TenantAccountRole
) -> None:
    console_audio.add_agent()
    with console_audio.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == console_audio.account.id).values(role=role)
        )
    response = console_audio.request(
        operation,
        agent=True,
        payload={"language": "en-US"} if operation == "voices" else {"text": "Preview"} if operation == "tts" else {},
    )
    try:
        assert response.status_code == (
            HTTPStatus.OK
            if operation == "voices"
            or role in (TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR)
            else HTTPStatus.FORBIDDEN
        )
        if response.status_code == HTTPStatus.FORBIDDEN:
            assert not console_audio.plugin.requests
    finally:
        response.close()


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
def test_normal_members_can_use_plain_app_audio(console_audio: ConsoleAudioHarness, operation: AudioOperation) -> None:
    with console_audio.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin)
            .where(TenantAccountJoin.account_id == console_audio.account.id)
            .values(role=TenantAccountRole.NORMAL)
        )
    response = console_audio.request(
        operation,
        payload={"language": "en-US"} if operation == "voices" else {"text": "Preview"} if operation == "tts" else {},
    )
    try:
        assert response.status_code == HTTPStatus.OK
    finally:
        response.close()


@pytest.mark.parametrize("authenticated", [False, True], ids=["missing-login", "missing-csrf"])
def test_authentication_and_csrf_precede_audio(console_audio: ConsoleAudioHarness, authenticated: bool) -> None:
    response = console_audio.request("asr", authenticated=authenticated, csrf=False)
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert not console_audio.plugin.requests


@pytest.mark.parametrize("operation", ["tts", "voices"])
def test_required_transport_fields_are_validated(console_audio: ConsoleAudioHarness, operation: AudioOperation) -> None:
    response = console_audio.request(operation, payload={})
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert not console_audio.plugin.requests


def test_rbac_plain_app_gate_keeps_roster_agent_asr_hidden(
    console_audio: ConsoleAudioHarness, config_overrides: Callable[..., None]
) -> None:
    console_audio.add_agent()
    config_overrides(RBAC_ENABLED=True)
    response = console_audio.request("asr", agent=True)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert not console_audio.plugin.requests


@pytest.mark.parametrize(
    ("agent", "operation", "scene"),
    [
        (False, "voices", "app_view_layout"),
        (True, "voices", "agent_preview"),
        (True, "tts", "agent_test_and_run"),
    ],
)
@pytest.mark.parametrize("allowed", [False, True])
def test_rbac_calls_real_enterprise_boundary_before_provider(
    console_audio: ConsoleAudioHarness,
    config_overrides: Callable[..., None],
    agent: bool,
    operation: AudioOperation,
    scene: str,
    allowed: bool,
) -> None:
    if agent:
        console_audio.add_agent()
    with console_audio.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin)
            .where(TenantAccountJoin.account_id == console_audio.account.id)
            .values(role=TenantAccountRole.NORMAL)
        )
    calls: list[dict[str, object]] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            assert self.path == "/rbac/check-access"
            assert not console_audio.plugin.requests
            console_audio.assert_closed()
            calls.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            body = json.dumps({"allowed": allowed}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    old_url = EnterpriseRequest.rbac_base_url
    EnterpriseRequest.rbac_base_url = f"http://127.0.0.1:{server.server_port}"
    config_overrides(RBAC_ENABLED=True)
    thread.start()
    try:
        response = console_audio.request(
            operation, agent=agent, payload={"language": "en-US"} if operation == "voices" else {"text": "Preview"}
        )
        try:
            assert response.status_code == (HTTPStatus.OK if allowed else HTTPStatus.FORBIDDEN)
            assert calls == [
                {
                    "account_id": console_audio.account.id,
                    "tenant_id": console_audio.tenant.id,
                    "scene": scene,
                    "resource_type": "agent" if agent else "app",
                    "resource_id": console_audio.agent_id if agent else console_audio.target.id,
                }
            ]
            assert bool(console_audio.plugin.requests) is allowed
        finally:
            response.close()
    finally:
        EnterpriseRequest.rbac_base_url = old_url
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


@pytest.mark.parametrize("operation", ["asr", "tts", "voices"])
def test_app_from_another_workspace_is_not_found(console_audio: ConsoleAudioHarness, operation: AudioOperation) -> None:
    with console_audio.factory.begin() as session:
        session.execute(update(App).where(App.id == console_audio.target.id).values(tenant_id=str(uuid4())))
    response = console_audio.request(
        operation,
        payload={"language": "en-US"} if operation == "voices" else {"text": "Preview"} if operation == "tts" else {},
    )
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert not console_audio.plugin.requests


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_asr_rejects_non_chat_app_modes(console_audio: ConsoleAudioHarness, mode: AppMode) -> None:
    with console_audio.factory.begin() as session:
        session.execute(update(App).where(App.id == console_audio.target.id).values(mode=mode))
    response = console_audio.request("asr")
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert not console_audio.plugin.requests


@pytest.mark.parametrize("payload", [{"draft_type": "unknown"}, {"extra": "unexpected"}])
def test_agent_asr_validates_debug_source(console_audio: ConsoleAudioHarness, payload: dict[str, object]) -> None:
    console_audio.add_agent()
    response = console_audio.request("asr", agent=True, payload=payload)
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert not console_audio.plugin.requests
