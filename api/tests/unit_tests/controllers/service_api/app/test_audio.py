"""Audio contracts through real admission, SQLite, and the provider HTTP protocol."""

from http import HTTPStatus
from io import BytesIO
from typing import cast
from uuid import uuid4

import pytest
from sqlalchemy import select, update

from models import App, AppModelConfig, EndUser, Message
from models.enums import DEFAULT_END_USER_SESSION_ID, EndUserType, MessageStatus
from models.provider import Provider
from services.audio_service import FILE_SIZE_LIMIT
from tests.unit_tests.services.audio_runtime_fixtures import WAV_AUDIO, AudioHarness, AudioSurface

pytest_plugins = ("tests.unit_tests.services.audio_runtime_fixtures",)


@pytest.fixture
def audio_surface() -> AudioSurface:
    return "service_api"


def test_asr_uses_real_provider_and_releases_admission_and_configuration(audio_harness: AudioHarness) -> None:
    response = audio_harness.asr(mime_type="audio/x-m4a")
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"text": " transcript "}
    assert response.content_type == "application/json"
    calls = audio_harness.plugin.invocations("speech2text")
    assert len(calls) == 1
    assert calls[0]["user_id"] == audio_harness.end_user.id
    data = cast(dict[str, object], calls[0]["data"])
    assert data["file"] == b"recording".hex()
    assert data["model_type"] == "speech2text"
    audio_harness.assert_preparation_closed()


def test_tts_returns_provider_bytes_and_mime_with_configured_voice(audio_harness: AudioHarness) -> None:
    response = audio_harness.tts({"text": "  Say hello  "})
    try:
        assert response.status_code == HTTPStatus.OK
        assert response.data == WAV_AUDIO
        assert response.content_type == "audio/wav"
        assert "Content-Disposition" not in response.headers
        assert "Content-Length" not in response.headers
        calls = audio_harness.plugin.invocations("tts")
        assert len(calls) == 1
        assert calls[0]["user_id"] == audio_harness.end_user.external_user_id
        data = cast(dict[str, object], calls[0]["data"])
        assert data["content_text"] == "Say hello"
        assert data["voice"] == "configured-voice"
        assert data["tenant_id"] == audio_harness.target.tenant_id
        audio_harness.assert_preparation_closed()
    finally:
        response.close()


def test_owned_message_precedes_text_and_explicit_voice_precedes_configuration(audio_harness: AudioHarness) -> None:
    response = audio_harness.tts(
        {"message_id": audio_harness.message.id, "text": "Ignored text", "voice": "chosen-voice"}
    )
    try:
        assert response.status_code == HTTPStatus.OK
        assert response.data == WAV_AUDIO
        calls = audio_harness.plugin.invocations("tts")
        assert len(calls) == 1
        data = cast(dict[str, object], calls[0]["data"])
        assert data["content_text"] == "Owned message answer"
        assert data["voice"] == "chosen-voice"
    finally:
        response.close()


@pytest.mark.parametrize("field", ["app_id", "from_end_user_id"])
def test_foreign_message_returns_null_without_invoking_provider(audio_harness: AudioHarness, field: str) -> None:
    with audio_harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == audio_harness.message.id).values({field: str(uuid4())}))
    response = audio_harness.tts({"message_id": audio_harness.message.id, "text": "Must not be used"})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() is None
    assert response.content_type == "application/json"
    assert not audio_harness.plugin.requests
    audio_harness.assert_preparation_closed()


@pytest.mark.parametrize("status", [MessageStatus.NORMAL, MessageStatus.PAUSED])
def test_empty_owned_message_returns_null_without_text_fallback(
    audio_harness: AudioHarness, status: MessageStatus
) -> None:
    with audio_harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == audio_harness.message.id).values(answer="", status=status))
    response = audio_harness.tts({"message_id": audio_harness.message.id, "text": "Must not be used"})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() is None
    assert not audio_harness.plugin.requests


@pytest.mark.parametrize(
    ("content", "mime_type", "status", "code"),
    [
        (None, "audio/mp3", HTTPStatus.BAD_REQUEST, "no_audio_uploaded"),
        (b"not audio", "text/plain", HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_audio_type"),
    ],
)
def test_upload_validation_preserves_http_errors(
    audio_harness: AudioHarness, content: bytes | None, mime_type: str, status: HTTPStatus, code: str
) -> None:
    response = audio_harness.asr(content, mime_type=mime_type)
    assert response.status_code == status
    assert response.get_json()["code"] == code
    assert not audio_harness.plugin.requests
    audio_harness.assert_preparation_closed()


def test_oversized_audio_is_rejected_before_provider_io(audio_harness: AudioHarness) -> None:
    response = audio_harness.asr(b"a" * (FILE_SIZE_LIMIT + 1))
    assert response.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE
    assert response.get_json()["code"] == "audio_too_large"
    assert response.get_json()["message"] == "Audio size larger than 30 mb"
    assert not audio_harness.plugin.requests


@pytest.mark.parametrize("missing_config", [False, True], ids=["disabled", "missing-config"])
def test_asr_requires_enabled_configuration(audio_harness: AudioHarness, missing_config: bool) -> None:
    with audio_harness.factory.begin() as session:
        if missing_config:
            session.execute(
                update(App).where(App.id == audio_harness.target.id).values({App.app_model_config_id: None})
            )
        else:
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == audio_harness.config.id)
                .values(speech_to_text='{"enabled":false}')
            )
    response = audio_harness.asr()
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "speech_to_text_disabled"
    assert not audio_harness.plugin.requests


@pytest.mark.parametrize(
    ("payload", "configuration", "message"),
    [
        ({}, '{"enabled":true}', "Text is required"),
        ({"text": "hello"}, '{"enabled":false}', "TTS is not enabled"),
    ],
)
def test_tts_request_and_feature_errors_remain_specific(
    audio_harness: AudioHarness, payload: dict[str, object], configuration: str, message: str
) -> None:
    with audio_harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == audio_harness.config.id)
            .values(text_to_speech=configuration)
        )
    response = audio_harness.tts(payload)
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert response.get_json()["message"] == message
    assert not audio_harness.plugin.requests


@pytest.mark.parametrize("endpoint", ["asr", "tts"])
def test_real_provider_failure_maps_to_completion_request_error(audio_harness: AudioHarness, endpoint: str) -> None:
    audio_harness.plugin.error = "InvokeServerUnavailableError"
    response = audio_harness.asr() if endpoint == "asr" else audio_harness.tts({"text": "hello"})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "completion_request_error"
    assert "Audio provider unavailable" in response.get_json()["message"]
    operation = "speech2text" if endpoint == "asr" else "tts"
    assert len(audio_harness.plugin.invocations(operation)) == 1
    audio_harness.assert_preparation_closed()


@pytest.mark.parametrize("endpoint", ["asr", "tts"])
def test_missing_user_provisions_default_identity_for_form_and_json(audio_harness: AudioHarness, endpoint: str) -> None:
    client = audio_harness.app.test_client()
    response = (
        client.post(
            "/audio-to-text",
            data={"file": (BytesIO(b"recording"), "recording.mp3", "audio/mp3")},
            headers=audio_harness.headers,
        )
        if endpoint == "asr"
        else client.post("/text-to-audio", json={"text": "hello"}, headers=audio_harness.headers)
    )
    try:
        assert response.status_code == HTTPStatus.OK
        if endpoint == "tts":
            assert response.data == WAV_AUDIO
        else:
            assert response.get_json() == {"text": " transcript "}
        with audio_harness.factory() as session:
            end_user = session.scalar(
                select(EndUser).where(
                    EndUser.tenant_id == audio_harness.target.tenant_id,
                    EndUser.app_id == audio_harness.target.id,
                    EndUser.type == EndUserType.SERVICE_API,
                    EndUser.session_id == DEFAULT_END_USER_SESSION_ID,
                )
            )
            assert end_user is not None
            assert end_user.id != audio_harness.end_user.id
            assert end_user._is_anonymous
            assert end_user.external_user_id == DEFAULT_END_USER_SESSION_ID
            calls = audio_harness.plugin.invocations("speech2text" if endpoint == "asr" else "tts")
            assert len(calls) == 1
            assert calls[0]["user_id"] == (end_user.id if endpoint == "asr" else end_user.external_user_id)
        audio_harness.assert_preparation_closed()
    finally:
        response.close()


@pytest.mark.parametrize("endpoint", ["asr", "tts"])
def test_null_external_user_id_keeps_existing_provider_identity(audio_harness: AudioHarness, endpoint: str) -> None:
    with audio_harness.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == audio_harness.end_user.id).values(external_user_id=None))
    response = audio_harness.asr() if endpoint == "asr" else audio_harness.tts({"text": "hello"})
    try:
        assert response.status_code == HTTPStatus.OK
        if endpoint == "tts":
            assert response.data == WAV_AUDIO
        operation = "speech2text" if endpoint == "asr" else "tts"
        calls = audio_harness.plugin.invocations(operation)
        assert len(calls) == 1
        expected = audio_harness.end_user.id if endpoint == "asr" else None
        if expected is None:
            assert "user_id" not in calls[0]
        else:
            assert calls[0]["user_id"] == expected
    finally:
        response.close()


def test_missing_tts_configuration_is_reported_without_provider_call(audio_harness: AudioHarness) -> None:
    with audio_harness.factory.begin() as session:
        session.execute(update(App).where(App.id == audio_harness.target.id).values({App.app_model_config_id: None}))
    response = audio_harness.tts({"text": "hello"})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert response.get_json()["message"] == "AppModelConfig not found"
    assert not audio_harness.plugin.requests


def test_explicit_voice_keeps_legacy_disabled_feature_override_and_empty_text(audio_harness: AudioHarness) -> None:
    with audio_harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == audio_harness.config.id)
            .values(text_to_speech='{"enabled":false}')
        )
    response = audio_harness.tts({"text": "   ", "voice": "explicit-voice", "streaming": False})
    try:
        assert response.status_code == HTTPStatus.OK
        assert response.data == WAV_AUDIO
        calls = audio_harness.plugin.invocations("tts")
        assert len(calls) == 1
        data = cast(dict[str, object], calls[0]["data"])
        assert data["content_text"] == ""
        assert data["voice"] == "explicit-voice"
    finally:
        response.close()


def test_unknown_message_id_returns_null_without_text_fallback(audio_harness: AudioHarness) -> None:
    response = audio_harness.tts({"message_id": str(uuid4()), "text": "Ignored text"})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() is None
    assert not audio_harness.plugin.requests


@pytest.mark.parametrize("endpoint", ["asr", "tts"])
def test_missing_provider_credentials_keep_precise_error(audio_harness: AudioHarness, endpoint: str) -> None:
    with audio_harness.factory.begin() as session:
        session.execute(
            update(Provider).where(Provider.tenant_id == audio_harness.target.tenant_id).values(is_valid=False)
        )
    response = audio_harness.asr() if endpoint == "asr" else audio_harness.tts({"text": "hello"})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "provider_not_initialize"
    assert "credentials" in response.get_json()["message"]
    assert not audio_harness.plugin.invocations("speech2text")
    assert not audio_harness.plugin.invocations("tts")


def test_provider_mime_mismatch_preserves_error_response(audio_harness: AudioHarness) -> None:
    audio_harness.plugin.audio = b"OggS" + b"a" * 32
    audio_harness.plugin.mime_type = "audio/wav"
    response = audio_harness.tts({"text": "hello"})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "completion_request_error"
    assert "MIME does not match" in response.get_json()["message"]


def test_service_api_keeps_null_for_malformed_message_id(audio_harness: AudioHarness) -> None:
    response = audio_harness.tts({"message_id": "not-a-uuid", "text": "Ignored text"})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() is None
    assert not audio_harness.plugin.requests
    audio_harness.assert_preparation_closed()
