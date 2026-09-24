"""Trial audio admission, response and usage contracts through HTTP and SQLite."""

from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from io import BytesIO
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
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from enums import DeploymentEdition
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from graphon.model_runtime.errors.invoke import InvokeBadRequestError, InvokeError
from libs.external_api import ExternalApi
from models import Account, AccountTrialAppRecord, App, AppMode, Tenant, TrialApp
from models.account import AccountStatus
from repositories.trial_app_repository import TrialAppRepository
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.audio_types import AudioAppRef, AudioOutput, AudioUpload
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)
from services.trial_app_access_service import TrialAppAccessService

_ASR = "audio-to-text"
_TTS = "text-to-audio"
_WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"a" * 32


@dataclass
class _FeatureState:
    enabled: bool = True
    setup_completed: bool = True
    events: list[str] = field(default_factory=list)

    def is_trial_enabled(self) -> bool:
        self.events.append("feature")
        return self.enabled


@dataclass(frozen=True)
class _AsrCall:
    app: AudioAppRef
    content: bytes | None
    mime_type: str | None


@dataclass(frozen=True)
class _TtsCall:
    app: AudioAppRef
    account_id: str
    text: str | None
    voice: str | None
    message_id: str | None


@dataclass
class _Stream(Iterator[bytes]):
    chunks: Iterator[bytes] = field(default_factory=lambda: iter([b"a" * 32, b"remaining-audio"]))
    reads: int = 0
    close_calls: int = 0
    close_error: Exception | None = None

    @override
    def __next__(self) -> bytes:
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
    output: AudioOutput | None = field(default_factory=lambda: AudioOutput(data=_WAV, mime_type=None))
    error: Exception | None = None
    calls: list[_AsrCall | _TtsCall] = field(default_factory=list)

    def _assert_admission_closed(self) -> None:
        assert self.sessions
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)

    def transcript_asr(self, *, app: AudioAppRef, audio: AudioUpload | None) -> dict[str, str]:
        self._assert_admission_closed()
        self.calls.append(_AsrCall(app, audio.stream.read() if audio else None, audio.mime_type if audio else None))
        if self.error is not None:
            raise self.error
        if audio is None:
            raise NoAudioUploadedServiceError()
        return {"text": " transcript "}

    def transcript_tts(
        self,
        *,
        app: AudioAppRef,
        account_id: str,
        text: str | None,
        voice: str | None,
        message_id: str | None,
    ) -> AudioOutput | None:
        self._assert_admission_closed()
        self.calls.append(_TtsCall(app, account_id, text, voice, message_id))
        if self.error is not None:
            raise self.error
        return self.output


@dataclass(frozen=True)
class _ApplicationServices:
    trial_app_access: TrialAppAccessService
    trial_app_usage: TrialAppRepository
    app_audio: _Runtime
    recommended_app_queries: _FeatureState


@dataclass(frozen=True)
class _Harness:
    app: Flask
    account: Account
    target: App
    trial: TrialApp
    factory: sessionmaker[Session]
    runtime: _Runtime
    state: _FeatureState

    def post(self, endpoint: str, *, payload: Mapping[str, object] | None = None) -> TestResponse:
        client = self.app.test_client()
        url = f"/trial-apps/{self.target.id}/{endpoint}"
        if endpoint == _ASR:
            return client.post(url, data={"file": (BytesIO(b"audio input"), "recording.m4a", "audio/x-m4a")})
        return client.post(url, json=dict(payload) if payload is not None else {"text": "Hello"})

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
    account.status = AccountStatus.ACTIVE
    account._current_tenant = Tenant(name="Viewer workspace")
    target = App(
        id=str(uuid4()), tenant_id=str(uuid4()), name="Trial app", mode=AppMode.CHAT, enable_site=True, enable_api=True
    )
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
    services = _ApplicationServices(TrialAppAccessService(apps=repository), repository, runtime, state)

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
    api.add_resource(trial_module.TrialChatAudioApi, "/trial-apps/<uuid:app_id>/audio-to-text")
    api.add_resource(trial_module.TrialChatTextApi, "/trial-apps/<uuid:app_id>/text-to-audio")
    return _Harness(app, account, target, trial, sqlite_session_factory, runtime, state)


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


def test_asr_upload_keeps_transcript_and_owner_tenant(harness: _Harness) -> None:
    response = harness.post(_ASR)

    assert response.status_code == 200
    assert response.get_json() == {"text": " transcript "}
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)
    assert harness.runtime.calls == [
        _AsrCall(AudioAppRef(harness.target.id, harness.target.tenant_id, "chat"), b"audio input", "audio/x-m4a")
    ]
    assert harness.target.tenant_id != harness.account.current_tenant_id
    assert harness.state.events == ["setup", "csrf", "feature"]
    assert harness.usage() == 1


@pytest.mark.parametrize("streaming", [None, False, True])
def test_tts_preserves_payload_actor_and_binary_response_ignoring_streaming_flag(
    harness: _Harness, streaming: bool | None
) -> None:
    message_id = str(uuid4())
    response = harness.post(
        _TTS, payload={"text": "  hello  ", "voice": "voice-1", "message_id": message_id, "streaming": streaming}
    )

    assert response.status_code == 200
    assert response.data == _WAV
    assert response.headers["Content-Type"] == "audio/wav"
    assert int(response.headers["Content-Length"]) == len(_WAV)
    assert harness.runtime.calls == [
        _TtsCall(
            AudioAppRef(harness.target.id, harness.target.tenant_id, "chat"),
            harness.account.id,
            "  hello  ",
            "voice-1",
            message_id,
        )
    ]
    assert harness.usage() == 1


@pytest.mark.parametrize("null_fields", [False, True])
def test_missing_message_null_response_still_records_usage(harness: _Harness, null_fields: bool) -> None:
    harness.runtime.output = None
    payload: dict[str, object] = {"text": None, "voice": None, "message_id": None} if null_fields else {}
    response = harness.post(_TTS, payload=payload)

    assert response.status_code == 200
    assert response.get_json() is None
    assert response.headers["Content-Type"] == "application/json"
    assert harness.runtime.calls == [
        _TtsCall(AudioAppRef(harness.target.id, harness.target.tenant_id, "chat"), harness.account.id, None, None, None)
    ]
    assert harness.usage() == 1


def test_missing_upload_passes_none_and_does_not_record_usage(harness: _Harness) -> None:
    response = harness.app.test_client().post(f"/trial-apps/{harness.target.id}/{_ASR}", data={})

    _assert_error(response, 400, "no_audio_uploaded")
    assert harness.runtime.calls == [
        _AsrCall(AudioAppRef(harness.target.id, harness.target.tenant_id, "chat"), None, None)
    ]
    assert harness.usage() is None


@pytest.mark.parametrize("endpoint", [_ASR, _TTS])
@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (AppDefinitionUnavailableError("app removed"), 400, "app_unavailable"),
        (AppModelConfigBrokenError(), 400, "app_unavailable"),
        (NoAudioUploadedServiceError(), 400, "no_audio_uploaded"),
        (AudioTooLargeServiceError("Audio size larger than 30 mb"), 413, "audio_too_large"),
        (UnsupportedAudioTypeServiceError(), 415, "unsupported_audio_type"),
        (ProviderNotSupportSpeechToTextServiceError(), 400, "provider_not_support_speech_to_text"),
        (SpeechToTextDisabledServiceError(), 400, "speech_to_text_disabled"),
        (ProviderTokenNotInitError("provider key missing"), 400, "provider_not_initialize"),
        (QuotaExceededError(), 400, "provider_quota_exceeded"),
        (ModelCurrentlyNotSupportError(), 400, "model_currently_not_support"),
        (InvokeError("provider rejected audio"), 400, "completion_request_error"),
        (ValueError("Text is required"), 400, "invalid_param"),
        (Unauthorized("session expired"), 401, "unauthorized"),
        (RuntimeError("private provider failure"), 500, "internal_server_error"),
    ],
)
def test_runtime_errors_keep_specific_codes_without_recording_usage(
    harness: _Harness, endpoint: str, error: Exception, status: int, code: str
) -> None:
    harness.runtime.error = error
    response = harness.post(endpoint)

    body = _assert_error(response, status, code)
    if isinstance(error, (ProviderTokenNotInitError, InvokeError)):
        assert body["message"] == error.description
    elif code in {"audio_too_large", "invalid_param"}:
        assert str(error) in str(body["message"])
    assert harness.usage() is None


@pytest.mark.parametrize("field", ["text", "voice", "message_id", "streaming"])
def test_invalid_tts_payload_keeps_field_context(harness: _Harness, field: str) -> None:
    response = harness.post(_TTS, payload={field: ["invalid"]})

    body = _assert_error(response, 422, "unprocessable_entity")
    assert field in str(body)
    assert harness.runtime.calls == []
    assert harness.usage() is None


@pytest.mark.parametrize("endpoint", [_ASR, _TTS])
@pytest.mark.parametrize(
    ("gate", "status", "code"),
    [
        ("setup", 401, "not_setup"),
        ("login", 401, "unauthorized"),
        ("csrf", 401, "unauthorized"),
        ("initialization", 400, "account_not_initialized"),
        ("feature", 403, "trial_app_feature_disabled"),
    ],
)
def test_console_and_trial_gates_run_before_app_lookup(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, endpoint: str, gate: str, status: int, code: str
) -> None:
    if gate == "setup":
        harness.state.setup_completed = False
    elif gate == "login":
        monkeypatch.setattr(login_module, "current_user", None)
    elif gate == "csrf":

        def reject_csrf(_request: Request, _account_id: str) -> None:
            raise Unauthorized("invalid csrf token")

        monkeypatch.setattr(login_module, "check_csrf_token", reject_csrf)
    elif gate == "initialization":
        harness.account.status = AccountStatus.UNINITIALIZED
    else:
        harness.state.enabled = False
    response = harness.post(endpoint)

    if gate == "login":
        assert response.status_code == 401
        assert response.get_json() == {"code": "unauthorized", "message": "Unauthorized."}
        assert response.headers["Content-Type"] == "application/json"
    else:
        _assert_error(response, status, code)
    assert harness.runtime.calls == []
    assert harness.runtime.sessions == []
    assert harness.usage() is None


@pytest.mark.parametrize("endpoint", [_ASR, _TTS])
@pytest.mark.parametrize("gate", ["membership", "missing-app", "quota"])
def test_trial_membership_and_account_quota_block_audio(harness: _Harness, endpoint: str, gate: str) -> None:
    with harness.factory.begin() as session:
        if gate == "membership":
            trial = session.get(TrialApp, harness.trial.id)
            assert trial is not None
            session.delete(trial)
        elif gate == "missing-app":
            app = session.get(App, harness.target.id)
            assert app is not None
            session.delete(app)
        else:
            session.add(AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=3))
    response = harness.post(endpoint)

    _assert_error(response, 403, "trial_app_limit_exceeded" if gate == "quota" else "trial_app_not_allowed")
    assert harness.runtime.calls == []
    assert harness.usage() == (3 if gate == "quota" else None)


@pytest.mark.parametrize("endpoint", [_ASR, _TTS])
def test_usage_is_isolated_to_current_account(harness: _Harness, endpoint: str) -> None:
    other_id = str(uuid4())
    with harness.factory.begin() as session:
        session.add_all(
            [
                AccountTrialAppRecord(app_id=harness.target.id, account_id=harness.account.id, count=1),
                AccountTrialAppRecord(app_id=harness.target.id, account_id=other_id, count=99),
            ]
        )
    response = harness.post(endpoint)

    assert response.status_code == 200
    assert harness.usage() == 2
    with harness.factory() as session:
        assert (
            session.scalar(select(AccountTrialAppRecord.count).where(AccountTrialAppRecord.account_id == other_id))
            == 99
        )


@pytest.mark.parametrize("failure", ["mime", "first-chunk"])
def test_stream_preparation_failure_closes_provider_without_consuming_trial(harness: _Harness, failure: str) -> None:
    def broken_chunks() -> Iterator[bytes]:
        raise InvokeBadRequestError("first audio chunk failed")
        yield b"unreachable"

    stream = _Stream(chunks=iter([_WAV]) if failure == "mime" else broken_chunks())
    harness.runtime.output = AudioOutput(data=stream, mime_type="audio/mpeg")
    response = harness.post(_TTS)

    body = _assert_error(response, 400, "completion_request_error")
    assert ("MIME" if failure == "mime" else "first audio chunk failed") in str(body["message"])
    assert stream.close_calls == 1
    assert harness.usage() is None


@pytest.mark.parametrize("cleanup_fails", [False, True])
def test_usage_write_failure_closes_stream_without_hiding_database_error(
    harness: _Harness, cleanup_fails: bool, caplog: pytest.LogCaptureFixture
) -> None:
    stream = _Stream(close_error=RuntimeError("cleanup failed") if cleanup_fails else None)
    harness.runtime.output = AudioOutput(data=stream, mime_type="audio/mpeg")
    failure = RuntimeError("usage database unavailable")

    def reject_usage_insert(
        _mapper: Mapper[AccountTrialAppRecord], _connection: Connection, _record: AccountTrialAppRecord
    ) -> None:
        raise failure

    event.listen(AccountTrialAppRecord, "before_insert", reject_usage_insert)
    try:
        response = harness.post(_TTS)
    finally:
        event.remove(AccountTrialAppRecord, "before_insert", reject_usage_insert)

    _assert_error(response, 500, "internal_server_error")
    assert stream.reads == 1
    assert stream.close_calls == 1
    assert harness.usage() is None
    assert any(record.exc_info is not None and record.exc_info[1] is failure for record in caplog.records)


def test_partial_http_consumption_closes_provider_stream(harness: _Harness) -> None:
    stream = _Stream()
    harness.runtime.output = AudioOutput(data=stream, mime_type="audio/mpeg")
    response = harness.post(_TTS)

    assert response.status_code == 200
    assert response.headers["Content-Type"] == "audio/mpeg"
    assert "Content-Length" not in response.headers
    assert next(iter(response.response)) == b"a" * 32
    assert stream.reads == 1
    assert stream.close_calls == 0
    response.close()
    assert stream.close_calls == 1
    assert harness.usage() == 1
