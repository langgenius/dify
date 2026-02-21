"""Unit tests for controllers.web.audio endpoints."""

from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from controllers.web.audio import AudioApi, TextApi
from controllers.web.error import (
    AudioTooLargeError,
    CompletionRequestError,
    NoAudioUploadedError,
    ProviderModelCurrentlyNotSupportError,
    ProviderNotInitializeError,
    ProviderNotSupportSpeechToTextError,
    ProviderQuotaExceededError,
    UnsupportedAudioTypeError,
)
from core.errors.error import ModelCurrentlyNotSupportError, ProviderTokenNotInitError, QuotaExceededError
from core.model_runtime.errors.invoke import InvokeError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    UnsupportedAudioTypeServiceError,
)


def _app_model() -> SimpleNamespace:
    return SimpleNamespace(id="app-1", mode="chat")


def _end_user() -> SimpleNamespace:
    return SimpleNamespace(id="eu-1", external_user_id="ext-1")


# ---------------------------------------------------------------------------
# AudioApi (audio-to-text)
# ---------------------------------------------------------------------------
class TestAudioApi:
    @patch("controllers.web.audio.AudioService.transcript_asr", return_value={"text": "hello"})
    def test_happy_path(self, mock_asr: MagicMock, app: Flask) -> None:
        app.config["RESTX_MASK_HEADER"] = "X-Fields"
        data = {"file": (BytesIO(b"fake-audio"), "test.mp3")}
        with app.test_request_context("/audio-to-text", method="POST", data=data, content_type="multipart/form-data"):
            result = AudioApi().post(_app_model(), _end_user())

        assert result == {"text": "hello"}

    @patch("controllers.web.audio.AudioService.transcript_asr", side_effect=NoAudioUploadedServiceError())
    def test_no_audio_uploaded(self, mock_asr: MagicMock, app: Flask) -> None:
        data = {"file": (BytesIO(b""), "empty.mp3")}
        with app.test_request_context("/audio-to-text", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(NoAudioUploadedError):
                AudioApi().post(_app_model(), _end_user())

    @patch("controllers.web.audio.AudioService.transcript_asr", side_effect=AudioTooLargeServiceError("too big"))
    def test_audio_too_large(self, mock_asr: MagicMock, app: Flask) -> None:
        data = {"file": (BytesIO(b"big"), "big.mp3")}
        with app.test_request_context("/audio-to-text", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(AudioTooLargeError):
                AudioApi().post(_app_model(), _end_user())

    @patch("controllers.web.audio.AudioService.transcript_asr", side_effect=UnsupportedAudioTypeServiceError())
    def test_unsupported_type(self, mock_asr: MagicMock, app: Flask) -> None:
        data = {"file": (BytesIO(b"bad"), "bad.xyz")}
        with app.test_request_context("/audio-to-text", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(UnsupportedAudioTypeError):
                AudioApi().post(_app_model(), _end_user())

    @patch(
        "controllers.web.audio.AudioService.transcript_asr",
        side_effect=ProviderNotSupportSpeechToTextServiceError(),
    )
    def test_provider_not_support(self, mock_asr: MagicMock, app: Flask) -> None:
        data = {"file": (BytesIO(b"x"), "x.mp3")}
        with app.test_request_context("/audio-to-text", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(ProviderNotSupportSpeechToTextError):
                AudioApi().post(_app_model(), _end_user())

    @patch(
        "controllers.web.audio.AudioService.transcript_asr",
        side_effect=ProviderTokenNotInitError(description="no token"),
    )
    def test_provider_not_init(self, mock_asr: MagicMock, app: Flask) -> None:
        data = {"file": (BytesIO(b"x"), "x.mp3")}
        with app.test_request_context("/audio-to-text", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(ProviderNotInitializeError):
                AudioApi().post(_app_model(), _end_user())

    @patch("controllers.web.audio.AudioService.transcript_asr", side_effect=QuotaExceededError())
    def test_quota_exceeded(self, mock_asr: MagicMock, app: Flask) -> None:
        data = {"file": (BytesIO(b"x"), "x.mp3")}
        with app.test_request_context("/audio-to-text", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(ProviderQuotaExceededError):
                AudioApi().post(_app_model(), _end_user())

    @patch("controllers.web.audio.AudioService.transcript_asr", side_effect=ModelCurrentlyNotSupportError())
    def test_model_not_support(self, mock_asr: MagicMock, app: Flask) -> None:
        data = {"file": (BytesIO(b"x"), "x.mp3")}
        with app.test_request_context("/audio-to-text", method="POST", data=data, content_type="multipart/form-data"):
            with pytest.raises(ProviderModelCurrentlyNotSupportError):
                AudioApi().post(_app_model(), _end_user())


# ---------------------------------------------------------------------------
# TextApi (text-to-audio)
# ---------------------------------------------------------------------------
class TestTextApi:
    @patch("controllers.web.audio.AudioService.transcript_tts", return_value="audio-bytes")
    @patch("controllers.web.audio.web_ns")
    def test_happy_path(self, mock_ns: MagicMock, mock_tts: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"text": "hello", "voice": "alloy"}

        with app.test_request_context("/text-to-audio", method="POST"):
            result = TextApi().post(_app_model(), _end_user())

        assert result == "audio-bytes"
        mock_tts.assert_called_once()

    @patch(
        "controllers.web.audio.AudioService.transcript_tts",
        side_effect=InvokeError(description="invoke failed"),
    )
    @patch("controllers.web.audio.web_ns")
    def test_invoke_error_mapped(self, mock_ns: MagicMock, mock_tts: MagicMock, app: Flask) -> None:
        mock_ns.payload = {"text": "hello"}

        with app.test_request_context("/text-to-audio", method="POST"):
            with pytest.raises(CompletionRequestError):
                TextApi().post(_app_model(), _end_user())
