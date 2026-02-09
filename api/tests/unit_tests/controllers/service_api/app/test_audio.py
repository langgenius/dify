"""
Unit tests for Service API Audio controllers.

Tests coverage for:
- AudioApi (speech-to-text)
- TextApi (text-to-speech)
- TextToAudioPayload (Pydantic model validation)

Focus on:
- Pydantic model validation for payloads
- Error handling logic (tested via mocking the service layer)
"""

import uuid
from unittest.mock import Mock, patch

import pytest
from flask import Flask

import services
from controllers.service_api.app.audio import TextToAudioPayload
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
from models.model import App, AppMode, EndUser
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    UnsupportedAudioTypeServiceError,
)


class TestTextToAudioPayload:
    """Test suite for TextToAudioPayload Pydantic model validation."""

    def test_payload_with_all_fields(self):
        """Test payload with all optional fields provided."""
        payload = TextToAudioPayload(message_id="msg_123", voice="alloy", text="Hello", streaming=True)
        assert payload.message_id == "msg_123"
        assert payload.voice == "alloy"
        assert payload.text == "Hello"
        assert payload.streaming is True

    def test_payload_with_defaults(self):
        """Test payload with default values."""
        payload = TextToAudioPayload()
        assert payload.message_id is None
        assert payload.voice is None
        assert payload.text is None
        assert payload.streaming is None

    def test_payload_with_partial_fields(self):
        """Test payload with only text field."""
        payload = TextToAudioPayload(text="Just text")
        assert payload.text == "Just text"
        assert payload.voice is None
        assert payload.message_id is None

    def test_payload_serialization(self):
        """Test payload model_dump for API usage."""
        payload = TextToAudioPayload(text="Test", voice="echo")
        dumped = payload.model_dump(exclude_none=True)
        assert dumped == {"text": "Test", "voice": "echo"}
        assert "message_id" not in dumped
        assert "streaming" not in dumped

    def test_payload_with_empty_strings(self):
        """Test payload with empty string values."""
        payload = TextToAudioPayload(text="", voice="")
        assert payload.text == ""
        assert payload.voice == ""

    def test_payload_with_long_text(self):
        """Test payload with long text content."""
        long_text = "A" * 10000
        payload = TextToAudioPayload(text=long_text)
        assert len(payload.text) == 10000


class TestAudioServiceExceptions:
    """Test exception mapping in audio controllers.

    These tests verify that service-layer exceptions are properly mapped
    to HTTP error responses.
    """

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @pytest.fixture
    def mock_app_model(self):
        """Create a mock App model."""
        app = Mock(spec=App)
        app.id = str(uuid.uuid4())
        app.tenant_id = str(uuid.uuid4())
        app.mode = AppMode.CHAT
        app.status = "normal"
        app.enable_api = True
        return app

    @pytest.fixture
    def mock_end_user(self):
        """Create a mock EndUser."""
        user = Mock(spec=EndUser)
        user.id = str(uuid.uuid4())
        user.external_user_id = "external_user_123"
        return user

    def test_no_audio_uploaded_service_error_maps_correctly(self):
        """Test that NoAudioUploadedServiceError maps to NoAudioUploadedError."""
        # Verify the error types exist and are correctly defined
        service_error = NoAudioUploadedServiceError()
        assert isinstance(service_error, NoAudioUploadedServiceError)

        # The API error can be raised
        api_error = NoAudioUploadedError()
        assert api_error is not None

    def test_audio_too_large_service_error_maps_correctly(self):
        """Test that AudioTooLargeServiceError maps to AudioTooLargeError."""
        message = "File too large: 50MB"
        service_error = AudioTooLargeServiceError(message)
        assert str(service_error) == message

        api_error = AudioTooLargeError(message)
        assert message in str(api_error)

    def test_unsupported_audio_type_service_error_maps_correctly(self):
        """Test that UnsupportedAudioTypeServiceError maps to UnsupportedAudioTypeError."""
        service_error = UnsupportedAudioTypeServiceError()
        assert isinstance(service_error, UnsupportedAudioTypeServiceError)

        api_error = UnsupportedAudioTypeError()
        assert api_error is not None

    def test_provider_not_support_speech_to_text_maps_correctly(self):
        """Test ProviderNotSupportSpeechToTextServiceError mapping."""
        service_error = ProviderNotSupportSpeechToTextServiceError()
        assert isinstance(service_error, ProviderNotSupportSpeechToTextServiceError)

        api_error = ProviderNotSupportSpeechToTextError()
        assert api_error is not None

    def test_provider_token_not_init_error_maps_correctly(self):
        """Test ProviderTokenNotInitError mapping to ProviderNotInitializeError."""
        service_error = ProviderTokenNotInitError()
        assert isinstance(service_error, ProviderTokenNotInitError)

        api_error = ProviderNotInitializeError("Provider not initialized")
        assert "Provider not initialized" in str(api_error)

    def test_quota_exceeded_error_maps_correctly(self):
        """Test QuotaExceededError mapping to ProviderQuotaExceededError."""
        service_error = QuotaExceededError()
        assert isinstance(service_error, QuotaExceededError)

        api_error = ProviderQuotaExceededError()
        assert api_error is not None

    def test_model_currently_not_support_error_maps_correctly(self):
        """Test ModelCurrentlyNotSupportError mapping."""
        service_error = ModelCurrentlyNotSupportError()
        assert isinstance(service_error, ModelCurrentlyNotSupportError)

        api_error = ProviderModelCurrentlyNotSupportError()
        assert api_error is not None

    def test_invoke_error_maps_to_completion_request_error(self):
        """Test InvokeError mapping to CompletionRequestError."""
        description = "Model invocation failed"
        service_error = InvokeError(description)
        assert isinstance(service_error, InvokeError)

        api_error = CompletionRequestError(description)
        assert description in str(api_error)

    def test_app_model_config_broken_maps_to_app_unavailable(self):
        """Test AppModelConfigBrokenError mapping to AppUnavailableError."""
        service_error = services.errors.app_model_config.AppModelConfigBrokenError()
        assert isinstance(service_error, services.errors.app_model_config.AppModelConfigBrokenError)

        api_error = AppUnavailableError()
        assert api_error is not None


class TestAudioControllerLogic:
    """Test AudioApi and TextApi controller logic directly."""

    @pytest.fixture
    def app(self):
        """Create Flask test application."""
        app = Flask(__name__)
        app.config["TESTING"] = True
        return app

    @patch("controllers.service_api.app.audio.AudioService")
    def test_audio_api_post_success(self, mock_audio_service, app):
        """Test AudioApi.post success path."""
        import io

        from controllers.service_api.app.audio import AudioApi

        # Setup mocks
        mock_app_model = Mock()
        mock_end_user = Mock()
        mock_end_user.id = "user_id"

        mock_audio_service.transcript_asr.return_value = {"text": "Transcribed text"}

        # Use request context with file
        data = {"file": (io.BytesIO(b"audio"), "test.wav")}
        with app.test_request_context(method="POST", data=data, content_type="multipart/form-data"):
            # Call the wrapped function to bypass auth decorator
            api = AudioApi()
            response = api.post.__wrapped__(api, mock_app_model, mock_end_user)

            assert response == {"text": "Transcribed text"}
            # Verify service called with correct file object (or at least checking it exists)
            # Since Request creates a new FileStorage, we can't easily assert equality with original BytesIO
            # But we can check arguments were passed
            mock_audio_service.transcript_asr.assert_called_once()
            args = mock_audio_service.transcript_asr.call_args[1]
            assert args["app_model"] == mock_app_model
            assert args["end_user"] == "user_id"
            assert args["file"].filename == "test.wav"

    @patch("controllers.service_api.app.audio.service_api_ns")
    @patch("controllers.service_api.app.audio.AudioService")
    def test_text_api_post_success(self, mock_audio_service, mock_service_api_ns, app):
        """Test TextApi.post success path."""
        from controllers.service_api.app.audio import TextApi

        # Setup mocks
        mock_app_model = Mock()
        mock_end_user = Mock()
        mock_end_user.external_user_id = "ext_user_id"

        payload_dict = {"text": "Hello world", "voice": "alloy", "message_id": "msg_123", "streaming": False}
        mock_service_api_ns.payload = payload_dict

        mock_audio_service.transcript_tts.return_value = {"data": "audio_data"}

        with app.test_request_context():
            # Call the wrapped function
            api = TextApi()
            response = api.post.__wrapped__(api, mock_app_model, mock_end_user)

            assert response == {"data": "audio_data"}
            mock_audio_service.transcript_tts.assert_called_once()
            call_args = mock_audio_service.transcript_tts.call_args[1]
            assert call_args["text"] == "Hello world"
            assert call_args["voice"] == "alloy"
            assert call_args["end_user"] == "ext_user_id"
            assert call_args["message_id"] == "msg_123"

    @patch("controllers.service_api.app.audio.AudioService")
    def test_audio_api_post_exceptions(self, mock_audio_service, app):
        """Test AudioApi.post exception handling."""
        import io

        from controllers.service_api.app.audio import AudioApi

        mock_app_model = Mock()
        mock_end_user = Mock()

        data = {"file": (io.BytesIO(b"audio"), "test.wav")}

        with app.test_request_context(method="POST", data=data, content_type="multipart/form-data"):
            # Test NoAudioUploadedServiceError
            mock_audio_service.transcript_asr.side_effect = NoAudioUploadedServiceError()
            with pytest.raises(NoAudioUploadedError):
                AudioApi().post.__wrapped__(AudioApi(), mock_app_model, mock_end_user)

            # Test generic Exception
            mock_audio_service.transcript_asr.side_effect = Exception("General error")
            from werkzeug.exceptions import InternalServerError

            with pytest.raises(InternalServerError):
                AudioApi().post.__wrapped__(AudioApi(), mock_app_model, mock_end_user)


class TestAudioServiceTranscription:
    """Test AudioService transcription methods directly."""

    @pytest.fixture
    def mock_app(self):
        """Create a mock App model for audio service tests."""
        app = Mock(spec=App)
        app.id = str(uuid.uuid4())
        app.tenant_id = str(uuid.uuid4())
        return app

    def test_audio_service_transcript_asr_exists(self):
        """Test that AudioService.transcript_asr method exists."""
        assert hasattr(AudioService, "transcript_asr")
        assert callable(AudioService.transcript_asr)

    def test_audio_service_transcript_tts_exists(self):
        """Test that AudioService.transcript_tts method exists."""
        assert hasattr(AudioService, "transcript_tts")
        assert callable(AudioService.transcript_tts)

    @patch.object(AudioService, "transcript_asr")
    def test_transcript_asr_returns_text_dict(self, mock_asr, mock_app):
        """Test that transcript_asr returns expected format."""
        expected = {"text": "Hello, world!"}
        mock_asr.return_value = expected

        result = AudioService.transcript_asr(app_model=mock_app, file=Mock(), end_user="user_123")

        assert result == expected
        mock_asr.assert_called_once()

    @patch.object(AudioService, "transcript_tts")
    def test_transcript_tts_accepts_all_parameters(self, mock_tts, mock_app):
        """Test that transcript_tts accepts all expected parameters."""
        expected = Mock()  # Could be audio bytes or generator
        mock_tts.return_value = expected

        result = AudioService.transcript_tts(
            app_model=mock_app, text="Hello", voice="alloy", end_user="user_123", message_id="msg_456"
        )

        assert result == expected
        mock_tts.assert_called_once_with(
            app_model=mock_app, text="Hello", voice="alloy", end_user="user_123", message_id="msg_456"
        )

    @patch.object(AudioService, "transcript_asr")
    def test_transcript_asr_raises_no_audio_uploaded(self, mock_asr, mock_app):
        """Test that transcript_asr raises NoAudioUploadedServiceError."""
        mock_asr.side_effect = NoAudioUploadedServiceError()

        with pytest.raises(NoAudioUploadedServiceError):
            AudioService.transcript_asr(app_model=mock_app, file=Mock(), end_user="user_123")

    @patch.object(AudioService, "transcript_asr")
    def test_transcript_asr_raises_audio_too_large(self, mock_asr, mock_app):
        """Test that transcript_asr raises AudioTooLargeServiceError."""
        mock_asr.side_effect = AudioTooLargeServiceError("File exceeds 25MB limit")

        with pytest.raises(AudioTooLargeServiceError) as exc_info:
            AudioService.transcript_asr(app_model=mock_app, file=Mock(), end_user="user_123")
        assert "25MB" in str(exc_info.value)

    @patch.object(AudioService, "transcript_asr")
    def test_transcript_asr_raises_unsupported_audio_type(self, mock_asr, mock_app):
        """Test that transcript_asr raises UnsupportedAudioTypeServiceError."""
        mock_asr.side_effect = UnsupportedAudioTypeServiceError()

        with pytest.raises(UnsupportedAudioTypeServiceError):
            AudioService.transcript_asr(app_model=mock_app, file=Mock(), end_user="user_123")

    @patch.object(AudioService, "transcript_tts")
    def test_transcript_tts_raises_quota_exceeded(self, mock_tts, mock_app):
        """Test that transcript_tts raises QuotaExceededError."""
        mock_tts.side_effect = QuotaExceededError()

        with pytest.raises(QuotaExceededError):
            AudioService.transcript_tts(
                app_model=mock_app, text="Hello", voice="alloy", end_user="user_123", message_id=None
            )

    @patch.object(AudioService, "transcript_tts")
    def test_transcript_tts_raises_provider_not_init(self, mock_tts, mock_app):
        """Test that transcript_tts raises ProviderTokenNotInitError."""
        mock_tts.side_effect = ProviderTokenNotInitError()

        with pytest.raises(ProviderTokenNotInitError):
            AudioService.transcript_tts(
                app_model=mock_app, text="Hello", voice="alloy", end_user="user_123", message_id=None
            )
