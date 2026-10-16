"""Exercise web audio handlers through AudioService, SQLite and real plugin model runtimes."""

import inspect
import json
from decimal import Decimal
from io import BytesIO

import pytest
from flask import Flask, Response
from sqlalchemy.orm import Session

from controllers.web.audio import AudioApi, TextApi, TextToAudioPayload
from controllers.web.error import (
    AudioTooLargeError,
    CompletionRequestError,
    NoAudioUploadedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderNotSupportSpeechToTextError,
    ProviderQuotaExceededError,
    SpeechToTextDisabledError,
    UnsupportedAudioTypeError,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from graphon.model_runtime.errors.invoke import InvokeError
from models.enums import ConversationFromSource
from models.model import App, AppMode, AppModelConfig, EndUser
from services.app_ref_service import AppRef, MessageRef
from services.audio_service import FILE_SIZE_LIMIT, AudioService
from services.errors.audio import ProviderNotSupportSpeechToTextServiceError
from tests.unit_tests.audio_runtime_fixtures import AudioRuntimeObservations, record_calls
from tests.unit_tests.model_factories import make_app, make_end_user, make_message


@pytest.fixture
def web_app(sqlite_session: Session) -> App:
    config = AppModelConfig(
        app_id="app-1",
        speech_to_text=json.dumps({"enabled": True}),
        text_to_speech=json.dumps({"enabled": True, "voice": "alloy"}),
    )
    sqlite_session.add(config)
    sqlite_session.flush()
    model = make_app(app_id="app-1", tenant_id="tenant-1", mode=AppMode.CHAT)
    model.app_model_config_id = config.id
    sqlite_session.add(model)
    sqlite_session.commit()
    return model


@pytest.fixture
def service_calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, object]]:
    calls: list[dict[str, object]] = []
    monkeypatch.setattr(AudioService, "transcript_asr", record_calls(AudioService.transcript_asr, calls))
    monkeypatch.setattr(AudioService, "transcript_tts", record_calls(AudioService.transcript_tts, calls))
    return calls


def _end_user() -> EndUser:
    return make_end_user(end_user_id="eu-1", app_id="app-1", external_user_id="ext-1", name="Web User")


# Unwrap only for the injected-session tests; normal tests execute the request-session decorator.
_audio_post = inspect.unwrap(AudioApi.post)
_text_post = inspect.unwrap(TextApi.post)


class TestAudioApi:
    @pytest.mark.parametrize("injected_session", [False, True])
    def test_happy_path_and_session_forwarding(
        self,
        app: Flask,
        sqlite_session: Session,
        web_app: App,
        audio_runtime: AudioRuntimeObservations,
        service_calls: list[dict[str, object]],
        injected_session: bool,
    ) -> None:
        audio_runtime.speech_to_text_result = "hello"
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        data = {"file": (BytesIO(b"uploaded audio"), "test.mp3", "audio/mp3")}
        with app.test_request_context("/audio-to-text", method="POST", data=data):
            if injected_session:
                result = _audio_post(AudioApi(), sqlite_session, web_app, _end_user())
            else:
                result = AudioApi().post(web_app, _end_user())

        assert result == {"text": "hello"}
        assert len(service_calls) == 1
        assert isinstance(service_calls[0]["session"], Session)
        if injected_session:
            assert service_calls[0]["session"] is sqlite_session
        assert audio_runtime.speech_to_text_calls == [b"uploaded audio"]
        assert audio_runtime.manager_requests[0]["user_id"] == "ext-1"

    @pytest.mark.parametrize(
        ("condition", "expected_error"),
        [
            ("missing", NoAudioUploadedError),
            ("large", AudioTooLargeError),
            ("unsupported", UnsupportedAudioTypeError),
            ("disabled", SpeechToTextDisabledError),
        ],
    )
    def test_invalid_upload_or_disabled_feature(
        self,
        condition: str,
        expected_error: type[Exception],
        app: Flask,
        web_app: App,
        sqlite_session: Session,
        audio_runtime: AudioRuntimeObservations,
    ) -> None:
        if condition == "disabled":
            config = web_app.app_model_config_with_session(session=sqlite_session)
            assert config is not None
            config.speech_to_text = json.dumps({"enabled": False})
            sqlite_session.commit()
        content = b"x" * (FILE_SIZE_LIMIT + 1) if condition == "large" else b"audio"
        mime = "video/mp4" if condition == "unsupported" else "audio/mp3"
        data: dict[str, object] = {} if condition == "missing" else {"file": (BytesIO(content), "test.mp3", mime)}
        with app.test_request_context("/audio-to-text", method="POST", data=data):
            with pytest.raises(expected_error):
                AudioApi().post(web_app, _end_user())
        assert audio_runtime.resolutions == []
        assert audio_runtime.daemon_calls == []

    @pytest.mark.parametrize(
        ("provider_error", "expected_error"),
        [
            (ProviderNotSupportSpeechToTextServiceError(), ProviderNotSupportSpeechToTextError),
            (ProviderTokenNotInitError(description="no token"), ProviderNotInitializeError),
            (QuotaExceededError(), ProviderQuotaExceededError),
            (ModelCurrentlyNotSupportError(), ProviderModelCurrentlyNotSupportError),
        ],
    )
    def test_provider_failure_mapping(
        self,
        provider_error: Exception,
        expected_error: type[Exception],
        app: Flask,
        web_app: App,
        audio_runtime: AudioRuntimeObservations,
    ) -> None:
        audio_runtime.lookup_error = provider_error
        with app.test_request_context(
            "/audio-to-text", method="POST", data={"file": (BytesIO(b"audio"), "x.mp3", "audio/mp3")}
        ):
            with pytest.raises(expected_error):
                AudioApi().post(web_app, _end_user())
        assert len(audio_runtime.resolutions) == 1
        assert audio_runtime.daemon_calls == []

    def test_missing_default_model(self, app: Flask, web_app: App, audio_runtime: AudioRuntimeObservations) -> None:
        audio_runtime.default_available = False
        with app.test_request_context(
            "/audio-to-text", method="POST", data={"file": (BytesIO(b"audio"), "x.mp3", "audio/mp3")}
        ):
            with pytest.raises(ProviderNotInitializeError):
                AudioApi().post(web_app, _end_user())


class TestTextApi:
    @pytest.mark.parametrize("injected_session", [False, True])
    def test_happy_path_and_session_forwarding(
        self,
        app: Flask,
        sqlite_session: Session,
        web_app: App,
        audio_runtime: AudioRuntimeObservations,
        service_calls: list[dict[str, object]],
        injected_session: bool,
    ) -> None:
        audio_runtime.tts_result = b"audio-bytes"
        with app.test_request_context("/text-to-audio", method="POST", json={"text": "hello", "voice": "alloy"}):
            if injected_session:
                payload = TextToAudioPayload.model_validate({"text": "hello", "voice": "alloy"})
                result = _text_post(TextApi(), payload, sqlite_session, web_app, _end_user())
            else:
                result = TextApi().post(web_app, _end_user())
            assert isinstance(result, Response)
            try:
                assert result.get_data() == b"audio-bytes"
                assert result.content_type == "audio/mpeg"
            finally:
                result.close()

        assert len(service_calls) == 1
        assert isinstance(service_calls[0]["session"], Session)
        if injected_session:
            assert service_calls[0]["session"] is sqlite_session
        assert audio_runtime.tts_calls == [{"content_text": "hello", "voice": "alloy"}]
        assert audio_runtime.manager_requests[0]["user_id"] == "ext-1"

    @pytest.mark.parametrize("owner", ["current", "other-app", "other-user"])
    def test_owned_message_ref(
        self,
        owner: str,
        app: Flask,
        sqlite_session: Session,
        web_app: App,
        audio_runtime: AudioRuntimeObservations,
        service_calls: list[dict[str, object]],
    ) -> None:
        message_id = "550e8400-e29b-41d4-a716-446655440000"
        sqlite_session.add(
            make_message(
                message_id=message_id,
                app_id="other-app" if owner == "other-app" else web_app.id,
                from_end_user_id="other-user" if owner == "other-user" else "eu-1",
                answer="persisted answer",
                inputs={},
                query="Question",
                message={"role": "user", "content": "Question"},
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
            )
        )
        sqlite_session.commit()
        with app.test_request_context(
            "/text-to-audio", method="POST", json={"text": "ignored input", "message_id": message_id}
        ):
            result = TextApi().post(web_app, _end_user())
            if owner == "current":
                assert isinstance(result, Response)
                try:
                    assert result.get_data() == b"audio data"
                finally:
                    result.close()
            else:
                assert result is None

        assert service_calls[0]["message_ref"] == MessageRef(
            AppRef("tenant-1", "app-1"), message_id, end_user_id="eu-1"
        )
        assert audio_runtime.tts_calls == (
            [{"content_text": "persisted answer", "voice": "alloy"}] if owner == "current" else []
        )
        if owner != "current":
            assert audio_runtime.resolutions == []

    def test_invoke_error_mapped(self, app: Flask, web_app: App, audio_runtime: AudioRuntimeObservations) -> None:
        audio_runtime.lookup_error = InvokeError(description="invoke failed")
        with app.test_request_context("/text-to-audio", method="POST", json={"text": "hello"}):
            with pytest.raises(CompletionRequestError):
                TextApi().post(web_app, _end_user())
