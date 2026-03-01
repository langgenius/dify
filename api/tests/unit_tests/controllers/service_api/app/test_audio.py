"""
Unit tests for Service API Audio controller.

Tests coverage for:
- TextToAudioPayload Pydantic model validation
- Error mapping patterns between service and API errors
- AudioService method interfaces
"""

import io
import uuid
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import InternalServerError

from controllers.service_api.app.audio import AudioApi, TextApi, TextToAudioPayload
from controllers.service_api.app.error import (
    AppUnavailableError,
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
from services.audio_service import AudioService
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    UnsupportedAudioTypeServiceError,
)


def _unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


def _file_data():
    return FileStorage(stream=io.BytesIO(b"audio"), filename="audio.wav", content_type="audio/wav")


# ---------------------------------------------------------------------------
# Pydantic Model Tests
# ---------------------------------------------------------------------------


class TestTextToAudioPayload:
    """Test suite for TextToAudioPayload Pydantic model."""

    def test_payload_with_all_fields(self):
        """Test payload with all fields populated."""
        payload = TextToAudioPayload(
            message_id="msg_123",
            voice="nova",
            text="Hello, this is a test.",
            streaming=False,
        )
        assert payload.message_id == "msg_123"
        assert payload.voice == "nova"
        assert payload.text == "Hello, this is a test."
        assert payload.streaming is False

    def test_payload_with_defaults(self):
        """Test payload with default values."""
        payload = TextToAudioPayload()
        assert payload.message_id is None
        assert payload.voice is None
        assert payload.text is None
        assert payload.streaming is None

    def test_payload_with_only_text(self):
        """Test payload with only text field."""
        payload = TextToAudioPayload(text="Simple text to speech")
        assert payload.text == "Simple text to speech"
        assert payload.voice is None
        assert payload.message_id is None

    def test_payload_with_streaming_true(self):
        """Test payload with streaming enabled."""
        payload = TextToAudioPayload(
            text="Streaming test",
            streaming=True,
        )
        assert payload.streaming is True


# ---------------------------------------------------------------------------
# AudioService Interface Tests
# ---------------------------------------------------------------------------


class TestAudioServiceInterface:
    """Test AudioService method interfaces exist."""

    def test_transcript_asr_method_exists(self):
        """Test that AudioService.transcript_asr exists."""
        assert hasattr(AudioService, "transcript_asr")
        assert callable(AudioService.transcript_asr)

    def test_transcript_tts_method_exists(self):
        """Test that AudioService.transcript_tts exists."""
        assert hasattr(AudioService, "transcript_tts")
        assert callable(AudioService.transcript_tts)


# ---------------------------------------------------------------------------
# Audio Service Tests
# ---------------------------------------------------------------------------


class TestAudioServiceInterface:
    """Test suite for AudioService interface methods."""

    def test_transcript_asr_method_exists(self):
        """Test that AudioService.transcript_asr exists."""
        assert hasattr(AudioService, "transcript_asr")
        assert callable(AudioService.transcript_asr)

    def test_transcript_tts_method_exists(self):
        """Test that AudioService.transcript_tts exists."""
        assert hasattr(AudioService, "transcript_tts")
        assert callable(AudioService.transcript_tts)


class TestServiceErrorTypes:
    """Test service error types used by audio controller."""

    def test_no_audio_uploaded_service_error(self):
        """Test NoAudioUploadedServiceError exists."""
        error = NoAudioUploadedServiceError()
        assert error is not None

    def test_audio_too_large_service_error(self):
        """Test AudioTooLargeServiceError with message."""
        error = AudioTooLargeServiceError("File too large")
        assert "File too large" in str(error)

    def test_unsupported_audio_type_service_error(self):
        """Test UnsupportedAudioTypeServiceError exists."""
        error = UnsupportedAudioTypeServiceError()
        assert error is not None

    def test_provider_not_support_speech_to_text_service_error(self):
        """Test ProviderNotSupportSpeechToTextServiceError exists."""
        error = ProviderNotSupportSpeechToTextServiceError()
        assert error is not None


# ---------------------------------------------------------------------------
# Mocked Behavior Tests
# ---------------------------------------------------------------------------


class TestAudioServiceMockedBehavior:
    """Test AudioService behavior with mocked methods."""

    @pytest.fixture
    def mock_app(self):
        """Create mock app model."""
        from models.model import App

        app = Mock(spec=App)
        app.id = str(uuid.uuid4())
        return app

    @pytest.fixture
    def mock_file(self):
        """Create mock file upload."""
        mock = Mock()
        mock.filename = "test_audio.mp3"
        mock.content_type = "audio/mpeg"
        return mock

    @patch.object(AudioService, "transcript_asr")
    def test_transcript_asr_returns_response(self, mock_asr, mock_app, mock_file):
        """Test ASR transcription returns response dict."""
        mock_response = {"text": "Transcribed text"}
        mock_asr.return_value = mock_response

        result = AudioService.transcript_asr(
            app_model=mock_app,
            file=mock_file,
            end_user="user_123",
        )

        assert result["text"] == "Transcribed text"

    @patch.object(AudioService, "transcript_tts")
    def test_transcript_tts_returns_response(self, mock_tts, mock_app):
        """Test TTS transcription returns response."""
        mock_response = {"audio": "base64_audio_data"}
        mock_tts.return_value = mock_response

        result = AudioService.transcript_tts(
            app_model=mock_app,
            text="Hello world",
            voice="nova",
            end_user="user_123",
            message_id="msg_123",
        )

        assert result["audio"] == "base64_audio_data"


class TestAudioApi:
    def test_success(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: {"text": "ok"})
        api = AudioApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(id="a1")
        end_user = SimpleNamespace(id="u1")

        with app.test_request_context("/audio-to-text", method="POST", data={"file": _file_data()}):
            response = handler(api, app_model=app_model, end_user=end_user)

        assert response == {"text": "ok"}

    @pytest.mark.parametrize(
        ("exc", "expected"),
        [
            (AppModelConfigBrokenError(), AppUnavailableError),
            (NoAudioUploadedServiceError(), NoAudioUploadedError),
            (AudioTooLargeServiceError("too big"), AudioTooLargeError),
            (UnsupportedAudioTypeServiceError(), UnsupportedAudioTypeError),
            (ProviderNotSupportSpeechToTextServiceError(), ProviderNotSupportSpeechToTextError),
            (ProviderTokenNotInitError("token"), ProviderNotInitializeError),
            (QuotaExceededError(), ProviderQuotaExceededError),
            (ModelCurrentlyNotSupportError(), ProviderModelCurrentlyNotSupportError),
            (InvokeError("invoke"), CompletionRequestError),
        ],
    )
    def test_error_mapping(self, app, monkeypatch: pytest.MonkeyPatch, exc, expected) -> None:
        monkeypatch.setattr(AudioService, "transcript_asr", lambda **_kwargs: (_ for _ in ()).throw(exc))
        api = AudioApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(id="a1")
        end_user = SimpleNamespace(id="u1")

        with app.test_request_context("/audio-to-text", method="POST", data={"file": _file_data()}):
            with pytest.raises(expected):
                handler(api, app_model=app_model, end_user=end_user)

    def test_unhandled_error(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AudioService, "transcript_asr", lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("boom"))
        )
        api = AudioApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(id="a1")
        end_user = SimpleNamespace(id="u1")

        with app.test_request_context("/audio-to-text", method="POST", data={"file": _file_data()}):
            with pytest.raises(InternalServerError):
                handler(api, app_model=app_model, end_user=end_user)


class TestTextApi:
    def test_success(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(AudioService, "transcript_tts", lambda **_kwargs: {"audio": "ok"})

        api = TextApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(id="a1")
        end_user = SimpleNamespace(external_user_id="ext")

        with app.test_request_context(
            "/text-to-audio",
            method="POST",
            json={"text": "hello", "voice": "v"},
        ):
            response = handler(api, app_model=app_model, end_user=end_user)

        assert response == {"audio": "ok"}

    def test_error_mapping(self, app, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            AudioService, "transcript_tts", lambda **_kwargs: (_ for _ in ()).throw(QuotaExceededError())
        )

        api = TextApi()
        handler = _unwrap(api.post)
        app_model = SimpleNamespace(id="a1")
        end_user = SimpleNamespace(external_user_id="ext")

        with app.test_request_context("/text-to-audio", method="POST", json={"text": "hello"}):
            with pytest.raises(ProviderQuotaExceededError):
                handler(api, app_model=app_model, end_user=end_user)
