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

- **Isolation Strategy**: External dependencies (ModelManager and FileStorage) are mocked,
  while database paths use isolated in-memory SQLite sessions
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

from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest
from sqlalchemy.orm import Session
from werkzeug.datastructures import FileStorage

from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource, MessageStatus
from models.model import App, AppMode, AppModelConfig, Message
from models.workflow import Workflow
from services.app_ref_service import MessageRef
from services.audio_service import AudioService
from services.errors.audio import (
    AudioTooLargeServiceError,
    NoAudioUploadedServiceError,
    ProviderNotSupportSpeechToTextServiceError,
    ProviderNotSupportTextToSpeechServiceError,
    SpeechToTextDisabledServiceError,
    UnsupportedAudioTypeServiceError,
)

APP_ID = "11111111-1111-1111-1111-111111111111"
TENANT_ID = "22222222-2222-2222-2222-222222222222"
MESSAGE_ID = "33333333-3333-3333-3333-333333333333"
CONVERSATION_ID = "44444444-4444-4444-4444-444444444444"
END_USER_ID = "55555555-5555-5555-5555-555555555555"
ACCOUNT_ID = "66666666-6666-6666-6666-666666666666"
OTHER_ID = "77777777-7777-7777-7777-777777777777"


def _message(*, answer: str = "Message answer") -> Message:
    message = Message(
        id=MESSAGE_ID,
        app_id=APP_ID,
        conversation_id=CONVERSATION_ID,
        query="Question",
        message={"role": "user", "content": "Question"},
        answer=answer,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        status=MessageStatus.NORMAL,
        from_source=ConversationFromSource.API,
        from_end_user_id=END_USER_ID,
        from_account_id=ACCOUNT_ID,
    )
    message._inputs = {}
    return message


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
        app.workflow_with_session.return_value = app.workflow
        app.app_model_config_with_session.return_value = app.app_model_config
        for key, value in kwargs.items():
            setattr(app, key, value)
        return app

    @staticmethod
    def create_workflow_mock(features_dict: dict[str, Any] | None = None, **kwargs) -> Mock:
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
        speech_to_text_dict: dict[str, Any] | None = None,
        text_to_speech_dict: dict[str, Any] | None = None,
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
        file.stream = Mock()
        file.stream.read = Mock(return_value=content)
        for key, value in kwargs.items():
            setattr(file, key, value)
        return file


@pytest.fixture
def factory():
    """Provide the test data factory to all tests."""
    return AudioServiceTestDataFactory


class TestAudioServiceASR:
    """Test speech-to-text (ASR) operations."""

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_asr_success_chat_mode(self, mock_model_manager_class, factory: AudioServiceTestDataFactory):
        """Test successful ASR transcription in CHAT mode."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )
        file = factory.create_file_storage_mock()

        # Mock ModelManager
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_instance = MagicMock()
        mock_model_instance.invoke_speech2text.return_value = "Transcribed text"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_asr(app_model=app, file=file, session=MagicMock(), end_user="user-123")

        # Assert
        assert result == {"text": "Transcribed text"}
        mock_model_instance.invoke_speech2text.assert_called_once()
        mock_model_manager_class.assert_called_once_with(tenant_id=app.tenant_id, user_id="user-123")

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_asr_success_advanced_chat_mode(
        self, mock_model_manager_class, factory: AudioServiceTestDataFactory
    ):
        """Test successful ASR transcription in ADVANCED_CHAT mode."""
        # Arrange
        workflow = factory.create_workflow_mock(features_dict={"speech_to_text": {"enabled": True}})
        app = factory.create_app_mock(
            mode=AppMode.ADVANCED_CHAT,
            workflow=workflow,
        )
        file = factory.create_file_storage_mock()

        # Mock ModelManager
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_instance = MagicMock()
        mock_model_instance.invoke_speech2text.return_value = "Workflow transcribed text"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_asr(app_model=app, file=file, session=MagicMock())

        # Assert
        assert result == {"text": "Workflow transcribed text"}

    @patch("services.audio_service.AgentRosterService", autospec=True)
    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_asr_success_published_agent_mode(
        self,
        mock_model_manager_class,
        mock_roster_service_class,
        factory: AudioServiceTestDataFactory,
    ):
        app = factory.create_app_mock(mode=AppMode.AGENT)
        file = factory.create_file_storage_mock()
        agent_soul = AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": True}}})
        mock_roster_service_class.return_value.get_published_agent_soul_for_app.return_value = agent_soul
        mock_model_instance = MagicMock()
        mock_model_instance.invoke_speech2text.return_value = "Published Agent transcript"
        mock_model_manager_class.return_value.get_default_model_instance.return_value = mock_model_instance

        result = AudioService.transcript_asr(app_model=app, file=file, session=MagicMock(), end_user="end-user-1")

        assert result == {"text": "Published Agent transcript"}
        mock_roster_service_class.return_value.get_published_agent_soul_for_app.assert_called_once_with(
            tenant_id=app.tenant_id,
            app_id=app.id,
        )

    @patch("services.audio_service.AgentRosterService", autospec=True)
    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_asr_legacy_agent_falls_back_to_app_model_config(
        self,
        mock_model_manager_class,
        mock_roster_service_class,
        factory: AudioServiceTestDataFactory,
    ):
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app = factory.create_app_mock(mode=AppMode.AGENT, app_model_config=app_model_config)
        file = factory.create_file_storage_mock()
        mock_roster_service_class.return_value.get_published_agent_soul_for_app.return_value = None
        mock_model_instance = MagicMock()
        mock_model_instance.invoke_speech2text.return_value = "Legacy Agent transcript"
        mock_model_manager_class.return_value.get_default_model_instance.return_value = mock_model_instance

        result = AudioService.transcript_asr(app_model=app, file=file, session=MagicMock())

        assert result == {"text": "Legacy Agent transcript"}

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_agent_asr_uses_agent_soul_feature(
        self, mock_model_manager_class, factory: AudioServiceTestDataFactory
    ):
        app = factory.create_app_mock(mode=AppMode.AGENT)
        file = factory.create_file_storage_mock()
        agent_soul = AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": True}}})
        mock_model_instance = MagicMock()
        mock_model_instance.invoke_speech2text.return_value = "Agent transcript"
        mock_model_manager_class.return_value.get_default_model_instance.return_value = mock_model_instance

        result = AudioService.transcript_agent_asr(
            app_model=app,
            agent_soul=agent_soul,
            file=file,
            session=MagicMock(),
            end_user="account-1",
        )

        assert result == {"text": "Agent transcript"}
        mock_model_manager_class.assert_called_once_with(tenant_id=app.tenant_id, user_id="account-1")

    @pytest.mark.parametrize(
        "agent_soul",
        [
            AgentSoulConfig(),
            AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": False}}}),
        ],
    )
    def test_transcript_agent_asr_rejects_disabled_feature(
        self, factory: AudioServiceTestDataFactory, agent_soul: AgentSoulConfig
    ):
        app = factory.create_app_mock(mode=AppMode.AGENT)
        file = factory.create_file_storage_mock()

        with pytest.raises(SpeechToTextDisabledServiceError):
            AudioService.transcript_agent_asr(app_model=app, agent_soul=agent_soul, file=file, session=MagicMock())

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_agent_asr_preserves_legacy_feature_fallback(
        self, mock_model_manager_class, factory: AudioServiceTestDataFactory
    ):
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app_model_config.to_dict.return_value = {"speech_to_text": {"enabled": True}}
        app = factory.create_app_mock(mode=AppMode.AGENT, app_model_config=app_model_config)
        file = factory.create_file_storage_mock()
        mock_model_instance = MagicMock()
        mock_model_instance.invoke_speech2text.return_value = "Legacy feature transcript"
        mock_model_manager_class.return_value.get_default_model_instance.return_value = mock_model_instance

        result = AudioService.transcript_agent_asr(
            app_model=app,
            agent_soul=AgentSoulConfig(),
            file=file,
            session=MagicMock(),
        )

        assert result == {"text": "Legacy feature transcript"}

    def test_transcript_agent_asr_soul_disabled_overrides_legacy_feature(self, factory: AudioServiceTestDataFactory):
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app_model_config.to_dict.return_value = {"speech_to_text": {"enabled": True}}
        app = factory.create_app_mock(mode=AppMode.AGENT, app_model_config=app_model_config)
        file = factory.create_file_storage_mock()
        agent_soul = AgentSoulConfig.model_validate({"app_features": {"speech_to_text": {"enabled": False}}})

        with pytest.raises(SpeechToTextDisabledServiceError):
            AudioService.transcript_agent_asr(app_model=app, agent_soul=agent_soul, file=file, session=MagicMock())

    def test_transcript_asr_raises_error_when_feature_disabled_chat_mode(self, factory: AudioServiceTestDataFactory):
        """Test that ASR raises error when speech-to-text is disabled in CHAT mode."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": False})
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )
        file = factory.create_file_storage_mock()

        # Act & Assert
        with pytest.raises(SpeechToTextDisabledServiceError):
            AudioService.transcript_asr(app_model=app, file=file, session=MagicMock())

    def test_transcript_asr_raises_error_when_feature_disabled_workflow_mode(
        self, factory: AudioServiceTestDataFactory
    ):
        """Test that ASR raises error when speech-to-text is disabled in WORKFLOW mode."""
        # Arrange
        workflow = factory.create_workflow_mock(features_dict={"speech_to_text": {"enabled": False}})
        app = factory.create_app_mock(
            mode=AppMode.WORKFLOW,
            workflow=workflow,
        )
        file = factory.create_file_storage_mock()

        # Act & Assert
        with pytest.raises(SpeechToTextDisabledServiceError):
            AudioService.transcript_asr(app_model=app, file=file, session=MagicMock())

    def test_transcript_asr_raises_error_when_workflow_missing(self, factory: AudioServiceTestDataFactory):
        """Test that ASR raises error when workflow is missing in WORKFLOW mode."""
        # Arrange
        app = factory.create_app_mock(
            mode=AppMode.WORKFLOW,
            workflow=None,
        )
        file = factory.create_file_storage_mock()

        # Act & Assert
        with pytest.raises(SpeechToTextDisabledServiceError):
            AudioService.transcript_asr(app_model=app, file=file, session=MagicMock())

    def test_transcript_asr_raises_error_when_no_file_uploaded(self, factory: AudioServiceTestDataFactory):
        """Test that ASR raises error when no file is uploaded."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )

        # Act & Assert
        with pytest.raises(NoAudioUploadedServiceError):
            AudioService.transcript_asr(app_model=app, file=None, session=MagicMock())

    def test_transcript_asr_raises_error_for_unsupported_audio_type(self, factory: AudioServiceTestDataFactory):
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
            AudioService.transcript_asr(app_model=app, file=file, session=MagicMock())

    def test_transcript_asr_raises_error_for_large_file(self, factory: AudioServiceTestDataFactory):
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
            AudioService.transcript_asr(app_model=app, file=file, session=MagicMock())

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_asr_raises_error_when_no_model_instance(
        self, mock_model_manager_class, factory: AudioServiceTestDataFactory
    ):
        """Test that ASR raises error when no model instance is available."""
        # Arrange
        app_model_config = factory.create_app_model_config_mock(speech_to_text_dict={"enabled": True})
        app = factory.create_app_mock(
            mode=AppMode.CHAT,
            app_model_config=app_model_config,
        )
        file = factory.create_file_storage_mock()

        # Mock ModelManager to return None
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_manager.get_default_model_instance.return_value = None

        # Act & Assert
        with pytest.raises(ProviderNotSupportSpeechToTextServiceError):
            AudioService.transcript_asr(app_model=app, file=file, session=MagicMock())


@pytest.mark.parametrize("sqlite_session", [(Message,)], indirect=True)
class TestAudioServiceTTS:
    """Test text-to-speech (TTS) operations."""

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_tts_with_text_success(
        self,
        mock_model_manager_class,
        factory: AudioServiceTestDataFactory,
        sqlite_session: Session,
    ):
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
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_instance = MagicMock()
        mock_model_instance.invoke_tts.return_value = b"audio data"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            session=sqlite_session,
            text="Hello world",
            voice="en-US-Neural",
            end_user="user-123",
        )

        # Assert
        assert result == b"audio data"
        mock_model_manager_class.assert_called_once_with(tenant_id=app.tenant_id, user_id="user-123")
        mock_model_instance.invoke_tts.assert_called_once_with(
            content_text="Hello world",
            voice="en-US-Neural",
        )

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_tts_with_default_voice(
        self,
        mock_model_manager_class,
        factory: AudioServiceTestDataFactory,
        sqlite_session: Session,
    ):
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
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_instance = MagicMock()
        mock_model_instance.invoke_tts.return_value = b"audio data"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            session=sqlite_session,
            text="Test",
        )

        # Assert
        assert result == b"audio data"
        # Verify default voice was used
        call_args = mock_model_instance.invoke_tts.call_args
        assert call_args.kwargs["voice"] == "default-voice"

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_tts_gets_first_available_voice_when_none_configured(
        self,
        mock_model_manager_class,
        factory: AudioServiceTestDataFactory,
        sqlite_session: Session,
    ):
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
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_instance = MagicMock()
        mock_model_instance.get_tts_voices.return_value = [{"value": "auto-voice"}]
        mock_model_instance.invoke_tts.return_value = b"audio data"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            session=sqlite_session,
            text="Test",
        )

        # Assert
        assert result == b"audio data"
        call_args = mock_model_instance.invoke_tts.call_args
        assert call_args.kwargs["voice"] == "auto-voice"

    @patch("services.audio_service.WorkflowService", autospec=True)
    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_tts_workflow_mode_with_draft(
        self,
        mock_model_manager_class,
        mock_workflow_service_class,
        factory: AudioServiceTestDataFactory,
        sqlite_session: Session,
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
        mock_workflow_service = mock_workflow_service_class.return_value
        mock_workflow_service.get_draft_workflow.return_value = draft_workflow

        # Mock ModelManager
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_instance = MagicMock()
        mock_model_instance.invoke_tts.return_value = b"draft audio"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance
        # Act
        result = AudioService.transcript_tts(
            app_model=app,
            session=sqlite_session,
            text="Draft test",
            is_draft=True,
        )

        # Assert
        assert result == b"draft audio"
        mock_workflow_service.get_draft_workflow.assert_called_once_with(app_model=app, session=sqlite_session)

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_tts_message_id_uses_provided_session(
        self,
        mock_model_manager_class,
        factory: AudioServiceTestDataFactory,
        sqlite_session: Session,
    ):
        """Test TTS message lookup uses the injected session."""
        # Arrange
        app = factory.create_app_mock(app_id=APP_ID, tenant_id=TENANT_ID, mode=AppMode.CHAT)
        message_ref = MessageRef(
            tenant_id=TENANT_ID,
            app_id=APP_ID,
            message_id=MESSAGE_ID,
            end_user_id=END_USER_ID,
            account_id=ACCOUNT_ID,
        )
        sqlite_session.add(_message())
        sqlite_session.commit()

        mock_model_manager = mock_model_manager_class.return_value
        mock_model_instance = MagicMock()
        mock_model_instance.invoke_tts.return_value = b"message audio"
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        for wrong_ref in (
            MessageRef(
                tenant_id=TENANT_ID,
                app_id=OTHER_ID,
                message_id=MESSAGE_ID,
                end_user_id=END_USER_ID,
                account_id=ACCOUNT_ID,
            ),
            MessageRef(
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                message_id=MESSAGE_ID,
                end_user_id=OTHER_ID,
                account_id=ACCOUNT_ID,
            ),
            MessageRef(
                tenant_id=TENANT_ID,
                app_id=APP_ID,
                message_id=MESSAGE_ID,
                end_user_id=END_USER_ID,
                account_id=OTHER_ID,
            ),
        ):
            assert (
                AudioService.transcript_tts(
                    app_model=app,
                    session=sqlite_session,
                    message_ref=wrong_ref,
                    voice="message-voice",
                )
                is None
            )

        result = AudioService.transcript_tts(
            app_model=app,
            session=sqlite_session,
            message_ref=message_ref,
            voice="message-voice",
        )

        # Assert
        assert result == b"message audio"
        mock_model_instance.invoke_tts.assert_called_once_with(
            content_text="Message answer",
            voice="message-voice",
        )

    def test_transcript_tts_raises_error_when_text_missing(
        self,
        factory: AudioServiceTestDataFactory,
        sqlite_session: Session,
    ):
        """Test that TTS raises error when text is missing."""
        # Arrange
        app = factory.create_app_mock()

        # Act & Assert
        with pytest.raises(ValueError, match="Text is required"):
            AudioService.transcript_tts(app_model=app, session=sqlite_session, text=None)

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_tts_raises_error_when_no_voices_available(
        self,
        mock_model_manager_class,
        factory: AudioServiceTestDataFactory,
        sqlite_session: Session,
    ):
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
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_instance = MagicMock()
        mock_model_instance.get_tts_voices.return_value = []  # No voices available
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act & Assert
        with pytest.raises(ValueError, match="Sorry, no voice available"):
            AudioService.transcript_tts(app_model=app, session=sqlite_session, text="Test")


class TestAudioServiceTTSVoices:
    """Test TTS voice listing operations."""

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_tts_voices_success(self, mock_model_manager_class, factory: AudioServiceTestDataFactory):
        """Test successful retrieval of TTS voices."""
        # Arrange
        tenant_id = "tenant-123"
        language = "en-US"

        expected_voices = [
            {"name": "Voice 1", "value": "voice-1"},
            {"name": "Voice 2", "value": "voice-2"},
        ]

        # Mock ModelManager
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_instance = MagicMock()
        mock_model_instance.get_tts_voices.return_value = expected_voices
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act
        result = AudioService.transcript_tts_voices(tenant_id=tenant_id, language=language)

        # Assert
        assert result == expected_voices
        mock_model_instance.get_tts_voices.assert_called_once_with(language)

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_tts_voices_raises_error_when_no_model_instance(
        self, mock_model_manager_class, factory: AudioServiceTestDataFactory
    ):
        """Test that TTS voices raises error when no model instance is available."""
        # Arrange
        tenant_id = "tenant-123"
        language = "en-US"

        # Mock ModelManager to return None
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_manager.get_default_model_instance.return_value = None

        # Act & Assert
        with pytest.raises(ProviderNotSupportTextToSpeechServiceError):
            AudioService.transcript_tts_voices(tenant_id=tenant_id, language=language)

    @patch("services.audio_service.ModelManager.for_tenant", autospec=True)
    def test_transcript_tts_voices_propagates_exceptions(
        self, mock_model_manager_class, factory: AudioServiceTestDataFactory
    ):
        """Test that TTS voices propagates exceptions from model instance."""
        # Arrange
        tenant_id = "tenant-123"
        language = "en-US"

        # Mock ModelManager
        mock_model_manager = mock_model_manager_class.return_value
        mock_model_instance = MagicMock()
        mock_model_instance.get_tts_voices.side_effect = RuntimeError("Model error")
        mock_model_manager.get_default_model_instance.return_value = mock_model_instance

        # Act & Assert
        with pytest.raises(RuntimeError, match="Model error"):
            AudioService.transcript_tts_voices(tenant_id=tenant_id, language=language)
