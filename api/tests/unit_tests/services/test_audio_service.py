"""
Comprehensive unit tests for AudioService.

This test suite provides complete coverage of audio processing operations in Dify,
following TDD principles with the Arrange-Act-Assert pattern.

## Test Coverage

### 1. Speech-to-Text (ASR) Operations (TestAudioServiceASR)
Tests audio transcription functionality:
- Successful transcription for different app modes
- File validation (size, type, presence)
- Feature flag validation (speech-to-text enabled)
- Error handling for various failure scenarios
- Model instance availability checks

### 2. Text-to-Speech (TTS) Operations (TestAudioServiceTTS)
Tests text-to-audio conversion:
- TTS with text input
- TTS with message ID
- Voice selection (explicit and default)
- Feature flag validation (text-to-speech enabled)
- Draft workflow handling
- Streaming response handling
- Error handling for missing/invalid inputs

### 3. TTS Voice Listing (TestAudioServiceTTSVoices)
Tests available voice retrieval:
- Get available voices for a tenant
- Language filtering
- Error handling for missing provider

## Testing Approach

- **Mocking Strategy**: All external dependencies (ModelManager, db, FileStorage) are mocked
  for fast, isolated unit tests
- **Factory Pattern**: AudioServiceTestDataFactory provides consistent test data
- **Fixtures**: Mock objects are configured per test method
- **Assertions**: Each test verifies return values, side effects, and error conditions

## Key Concepts

**Audio Formats:**
- Supported: mp3, wav, m4a, flac, ogg, opus, webm
- File size limit: 30 MB

**App Modes:**
- ADVANCED_CHAT/WORKFLOW: Use workflow features
- CHAT/COMPLETION: Use app_model_config

**Feature Flags:**
- speech_to_text: Enables ASR functionality
- text_to_speech: Enables TTS functionality
"""

from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest
from werkzeug.datastructures import FileStorage

from models.enums import MessageStatus
from models.model import App, AppMode, AppModelConfig, Message
from models.workflow import Workflow
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
    UnsupportedAudioTypeServiceError,
)


class AudioServiceTestDataFactory:
    """
    Factory for creating test data and mock objects.

    Provides reusable methods to create consistent mock objects for testing
    audio-related operations.
    """

    @staticmethod
    def create_app_mock(
        app_id: str = "app-123",
        mode: AppMode = AppMode.CHAT,
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock App object.

        Args:
            app_id: Unique identifier for the app
            mode: App mode (CHAT, ADVANCED_CHAT, WORKFLOW, etc.)
            tenant_id: Tenant identifier
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock App object with specified attributes
        """
        app = create_autospec(App, instance=True)
        app.id = app_id
        app.mode = mode
        app.tenant_id = tenant_id
        app.workflow = kwargs.get("workflow")
        app.app_model_config = kwargs.get("app_model_config")
        for key, value in kwargs.items():
            setattr(app, key, value)
        return app

    @staticmethod
    def create_workflow_mock(features_dict: dict | None = None, **kwargs) -> Mock:
        """
        Create a mock Workflow object.

        Args:
            features_dict: Dictionary of workflow features
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Workflow object with specified attributes
        """
        workflow = create_autospec(Workflow, instance=True)
        workflow.features_dict = features_dict or {}
        for key, value in kwargs.items():
            setattr(workflow, key, value)
        return workflow

    @staticmethod
    def create_app_model_config_mock(
        speech_to_text_dict: dict | None = None,
        text_to_speech_dict: dict | None = None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock AppModelConfig object.

        Args:
            speech_to_text_dict: Speech-to-text configuration
            text_to_speech_dict: Text-to-speech configuration
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock AppModelConfig object with specified attributes
        """
        config = create_autospec(AppModelConfig, instance=True)
        config.speech_to_text_dict = speech_to_text_dict or {"enabled": False}
        config.text_to_speech_dict = text_to_speech_dict or {"enabled": False}
        for key, value in kwargs.items():
            setattr(config, key, value)
        return config

    @staticmethod
    def create_file_storage_mock(
        filename: str = "test.mp3",
        mimetype: str = "audio/mp3",
        content: bytes = b"fake audio content",
        **kwargs,
    ) -> Mock:
        """
        Create a mock FileStorage object.

        Args:
            filename: Name of the file
            mimetype: MIME type of the file
            content: File content as bytes
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock FileStorage object with specified attributes
        """
        file = Mock(spec=FileStorage)
        file.filename = filename
        file.mimetype = mimetype
        file.read = Mock(return_value=content)
        for key, value in kwargs.items():
            setattr(file, key, value)
        return file

    @staticmethod
    def create_message_mock(
        message_id: str = "msg-123",
        answer: str = "Test answer",
        status: MessageStatus = MessageStatus.NORMAL,
        **kwargs,
    ) -> Mock:
        """
        Create a mock Message object.

        Args:
            message_id: Unique identifier for the message
            answer: Message answer text
            status: Message status
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock Message object with specified attributes
        """
        message = create_autospec(Message, instance=True)
        message.id = message_id
        message.answer = answer
        message.status = status
        for key, value in kwargs.items():
            setattr(message, key, value)
        return message


@pytest.fixture
def factory():
    """Provide the test data factory to all tests."""
    return AudioServiceTestDataFactory


class TestAudioServiceASR:
    """Test speech-to-text (ASR) operations."""

    @patch("services.audio_service.ModelManager")
    def test_transcript_asr_success_chat_mode(self, mock_model_manager_class, factory):
        """Test successful ASR transcription in CHAT mode."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )
        file = factory.create_file_storage_mock()

        # Mock ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_instance.invoke_speech2text.return_value = "Transcribed text"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_asr(app_model=app, file=file, end_user="user-123")

        # Assert
        assert result == {"text": "Transcribed text"}
        mock_model_instance.invoke_speech2text.assert_called_once()
        call_args = mock_model_instance.invoke_speech2text.call_args
        assert call_args.kwargs["user"] == "user-123"

    @patch("services.audio_service.ModelManager")
    def test_transcript_asr_success_advanced_chat_mode(self, mock_model_manager_class, factory):
        """Test successful ASR transcription in ADVANCED_CHAT mode."""
        # Arrange
        workflow = factory.create_workflow_mock(features_dict={"speech_to_text": {"enabled": True}})
        app = factory.create_app_mock(
            mode=AppMode.ADVANCED_CHAT,
            workflow=workflow,
        )
        file = factory.create_file_storage_mock()

        # Mock ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_instance.invoke_speech2text.return_value = "Workflow transcribed text"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_asr(app_model=app, file=file)

        # Assert
        assert result == {"text": "Workflow transcribed text"}

    def test_transcript_asr_raises_error_when_feature_disabled_chat_mode(self, factory):
        """Test that ASR raises error when speech-to-text is disabled in CHAT mode."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": False})
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )
        file = factory.create_file_storage_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="Speech to text is not enabled"):
            AudioService.transcript_asr(app_model=app, file=file)

    def test_transcript_asr_raises_error_when_feature_disabled_workflow_mode(self, factory):
        """Test that ASR raises error when speech-to-text is disabled in WORKFLOW mode."""
        # Arrange
        workflow = factory.create_workflow_mock(features_dict={"speech_to_text": {"enabled": False}})
        app = factory.create_app_mock(
            mode=AppMode.WORKFLOW,
            workflow=workflow,
        )
        file = factory.create_file_storage_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="Speech to text is not enabled"):
            AudioService.transcript_asr(app_model=app, file=file)

    def test_transcript_asr_raises_error_when_workflow_missing(self, factory):
        """Test that ASR raises error when workflow is missing in WORKFLOW mode."""
        # Arrange
        app = factory.create_app_mock(
            mode=AppMode.WORKFLOW,
            workflow=None,
        )
        file = factory.create_file_storage_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="Speech to text is not enabled"):
            AudioService.transcript_asr(app_model=app, file=file)

    def test_transcript_asr_raises_error_when_no_file_uploaded(self, factory):
        """Test that ASR raises error when no file is uploaded."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )

        # Act & Assert
        with pytest.raises(NoAudioUploadedServiceError):
            AudioService.transcript_asr(app_model=app, file=None)

    def test_transcript_asr_raises_error_for_unsupported_audio_type(self, factory):
        """Test that ASR raises error for unsupported audio file types."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )
        file = factory.create_file_storage_mock(mimetype="video/mp4")

        # Act & Assert
        with pytest.raises(UnsupportedAudioTypeServiceError):
            AudioService.transcript_asr(app_model=app, file=file)

    def test_transcript_asr_raises_error_for_large_file(self, factory):
        """Test that ASR raises error when file exceeds size limit (30MB)."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )
        # Create file larger than 30MB
        large_content = b"x" * (31 * 1024 * 1024)
        file = factory.create_file_storage_mock(content=large_content)

        # Act & Assert
        with pytest.raises(AudioTooLargeServiceError, match="Audio size larger than 30 mb"):
            AudioService.transcript_asr(app_model=app, file=file)

    @patch("services.audio_service.ModelManager")
    def test_transcript_asr_raises_error_when_no_model_instance(self, mock_model_manager_class, factory):
        """Test that ASR raises error when no model instance is available."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )
        file = factory.create_file_storage_mock()

        # Mock ModelManager to return None
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager
        mock_model_manager.get_default_model_instance.return_value = None

        # Act & Assert
        with pytest.raises(ProviderNotSupportSpeechToTextServiceError):
            AudioService.transcript_asr(app_model=app, file=file)


class TestAudioServiceTTS:
    """Test text-to-speech (TTS) operations."""

    @patch("services.audio_service.ModelManager")
    def test_transcript_tts_with_text_success(self, mock_model_manager_class, factory):
        """Test successful TTS with text input."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(
            text_to_speech_dict={"enabled": True, "voice": "en-US-Neural"}
        )
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )

        # Mock ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_instance.invoke_tts.return_value = b"audio data"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            text="Hello world",
            voice="en-US-Neural",
            end_user="user-123",
        )

        # Assert
        assert result == b"audio data"
        mock_model_instance.invoke_tts.assert_called_once_with(
            content_text="Hello world",
            user="user-123",
            tenant_id=app.tenant_id,
            voice="en-US-Neural",
        )

    @patch("services.audio_service.db.session")
    @patch("services.audio_service.ModelManager")
    def test_transcript_tts_with_message_id_success(self, mock_model_manager_class, mock_db_session, factory):
        """Test successful TTS with message ID."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(
            text_to_speech_dict={"enabled": True, "voice": "en-US-Neural"}
        )
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )

        message = factory.create_message_mock(
            message_id="550e8400-e29b-41d4-a716-446655440000",
            answer="Message answer text",
        )

        # Mock database query
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = message

        # Mock ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_instance.invoke_tts.return_value = b"audio from message"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            message_id="550e8400-e29b-41d4-a716-446655440000",
        )

        # Assert
        assert result == b"audio from message"
        mock_model_instance.invoke_tts.assert_called_once()

    @patch("services.audio_service.ModelManager")
    def test_transcript_tts_with_default_voice(self, mock_model_manager_class, factory):
        """Test TTS uses default voice when none specified."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(
            text_to_speech_dict={"enabled": True, "voice": "default-voice"}
        )
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )

        # Mock ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_instance.invoke_tts.return_value = b"audio data"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            text="Test",
        )

        # Assert
        assert result == b"audio data"
        # Verify default voice was used
        call_args = mock_model_instance.invoke_tts.call_args
        assert call_args.kwargs["voice"] == "default-voice"

    @patch("services.audio_service.ModelManager")
    def test_transcript_tts_gets_first_available_voice_when_none_configured(self, mock_model_manager_class, factory):
        """Test TTS gets first available voice when none is configured."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(
            text_to_speech_dict={"enabled": True}  # No voice specified
        )
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )

        # Mock ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_instance.get_tts_voices.return_value = [{"value": "auto-voice"}]
        mock_model_instance.invoke_tts.return_value = b"audio data"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            text="Test",
        )

        # Assert
        assert result == b"audio data"
        call_args = mock_model_instance.invoke_tts.call_args
        assert call_args.kwargs["voice"] == "auto-voice"

    @patch("services.audio_service.WorkflowService")
    @patch("services.audio_service.ModelManager")
    def test_transcript_tts_workflow_mode_with_draft(
        self, mock_model_manager_class, mock_workflow_service_class, factory
    ):
        """Test TTS in WORKFLOW mode with draft workflow."""
        # Arrange
        draft_workflow = factory.create_workflow_mock(
            features_dict={"text_to_speech": {"enabled": True, "voice": "draft-voice"}}
        )
        app = factory.create_app_mock(
            mode=AppMode.WORKFLOW,
        )

        # Mock WorkflowService
        mock_workflow_service = MagicMock()
        mock_workflow_service_class.return_value = mock_workflow_service
        mock_workflow_service.get_draft_workflow.return_value = draft_workflow

        # Mock ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_instance.invoke_tts.return_value = b"draft audio"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            text="Draft test",
            is_draft=True,
        )

        # Assert
        assert result == b"draft audio"
        mock_workflow_service.get_draft_workflow.assert_called_once_with(app_model=app)

    def test_transcript_tts_raises_error_when_text_missing(self, factory):
        """Test that TTS raises error when text is missing."""
        # Arrange
        app = factory.create_app_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="Text is required"):
            AudioService.transcript_tts(app_model=app, text=None)

    @patch("services.audio_service.db.session")
    def test_transcript_tts_returns_none_for_invalid_message_id(self, mock_db_session, factory):
        """Test that TTS returns None for invalid message ID format."""
        # Arrange
        app = factory.create_app_mock()

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            message_id="invalid-uuid",
        )

        # Assert
        assert result is None

    @patch("services.audio_service.db.session")
    def test_transcript_tts_returns_none_for_nonexistent_message(self, mock_db_session, factory):
        """Test that TTS returns None when message doesn't exist."""
        # Arrange
        app = factory.create_app_mock()

        # Mock database query returning None
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = None

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            message_id="550e8400-e29b-41d4-a716-446655440000",
        )

        # Assert
        assert result is None

    @patch("services.audio_service.db.session")
    def test_transcript_tts_returns_none_for_empty_message_answer(self, mock_db_session, factory):
        """Test that TTS returns None when message answer is empty."""
        # Arrange
        app = factory.create_app_mock()

        message = factory.create_message_mock(
            answer="",
            status=MessageStatus.NORMAL,
        )

        # Mock database query
        mock_query = MagicMock()
        mock_db_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.first.return_value = message

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            message_id="550e8400-e29b-41d4-a716-446655440000",
        )

        # Assert
        assert result is None

    @patch("services.audio_service.ModelManager")
    def test_transcript_tts_raises_error_when_no_voices_available(self, mock_model_manager_class, factory):
        """Test that TTS raises error when no voices are available."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(
            text_to_speech_dict={"enabled": True}  # No voice specified
        )
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )

        # Mock ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_instance.get_tts_voices.return_value = []  # No voices available
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act & Assert
        with pytest.raises(ValueError, match="Sorry, no voice available"):
            AudioService.transcript_tts(app_model=app, text="Test")


class TestAudioServiceTTSVoices:
    """Test TTS voice listing operations."""

    @patch("services.audio_service.ModelManager")
    def test_transcript_tts_voices_success(self, mock_model_manager_class, factory):
        """Test successful retrieval of TTS voices."""
        # Arrange
        tenant_id = "tenant-123"
        language = "en-US"

        expected_voices = [
            {"name": "Voice 1", "value": "voice-1"},
            {"name": "Voice 2", "value": "voice-2"},
        ]

        # Mock ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_instance.get_tts_voices.return_value = expected_voices
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_tts_voices(tenant_id=tenant_id, language=language)

        # Assert
        assert result == expected_voices
        mock_model_instance.get_tts_voices.assert_called_once_with(language)

    @patch("services.audio_service.ModelManager")
    def test_transcript_tts_voices_raises_error_when_no_model_instance(self, mock_model_manager_class, factory):
        """Test that TTS voices raises error when no model instance is available."""
        # Arrange
        tenant_id = "tenant-123"
        language = "en-US"

        # Mock ModelManager to return None
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager
        mock_model_manager.get_default_model_instance.return_value = None

        # Act & Assert
        with pytest.raises(ProviderNotSupportTextToSpeechServiceError):
            AudioService.transcript_tts_voices(tenant_id=tenant_id, language=language)

    @patch("services.audio_service.ModelManager")
    def test_transcript_tts_voices_propagates_exceptions(self, mock_model_manager_class, factory):
        """Test that TTS voices propagates exceptions from model instance."""
        # Arrange
        tenant_id = "tenant-123"
        language = "en-US"

        # Mock ModelManager
        mock_model_manager = MagicMock()
        mock_model_manager_class.return_value = mock_model_manager

        mock_model_instance = MagicMock()
        mock_model_instance.get_tts_voices.side_effect = RuntimeError("Model error")
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act & Assert
        with pytest.raises(RuntimeError, match="Model error"):
            AudioService.transcript_tts_voices(tenant_id=tenant_id, language=language)
