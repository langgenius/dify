"""Unit tests for the message cycle manager optimization."""

from unittest.mock import Mock, patch

import pytest
from flask import current_app

from core.app.entities.task_entities import MessageStreamResponse, StreamEvent
from core.app.task_pipeline.message_cycle_manager import MessageCycleManager


class TestMessageCycleManagerOptimization:
    """Test cases for the message cycle manager optimization that prevents N+1 queries."""

    @pytest.fixture
    def mock_application_generate_entity(self):
        """Create a mock application generate entity."""
        entity = Mock()
        entity.task_id = "test-task-id"
        return entity

    @pytest.fixture
    def message_cycle_manager(self, mock_application_generate_entity):
        """Create a message cycle manager instance."""
        task_state = Mock()
        return MessageCycleManager(application_generate_entity=mock_application_generate_entity, task_state=task_state)

    def test_get_message_event_type_with_message_file(self, message_cycle_manager):
        """Test get_message_event_type returns MESSAGE_FILE when message has files."""
        with patch("core.app.task_pipeline.message_cycle_manager.session_factory") as mock_session_factory:
            # Setup mock session and message file
            mock_session = Mock()
            mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

            mock_message_file = Mock()
            # Current implementation uses session.scalar(select(...))
            mock_session.scalar.return_value = mock_message_file

            # Execute
            with current_app.app_context():
                result = message_cycle_manager.get_message_event_type("test-message-id")

            # Assert
            assert result == StreamEvent.MESSAGE_FILE
            mock_session.scalar.assert_called_once()

    def test_get_message_event_type_without_message_file(self, message_cycle_manager):
        """Test get_message_event_type returns MESSAGE when message has no files."""
        with patch("core.app.task_pipeline.message_cycle_manager.session_factory") as mock_session_factory:
            # Setup mock session and no message file
            mock_session = Mock()
            mock_session_factory.create_session.return_value.__enter__.return_value = mock_session
            # Current implementation uses session.scalar(select(...))
            mock_session.scalar.return_value = None

            # Execute
            with current_app.app_context():
                result = message_cycle_manager.get_message_event_type("test-message-id")

            # Assert
            assert result == StreamEvent.MESSAGE
            mock_session.scalar.assert_called_once()

    def test_message_to_stream_response_with_precomputed_event_type(self, message_cycle_manager):
        """MessageCycleManager.message_to_stream_response expects a valid event_type; callers should precompute it."""
        with patch("core.app.task_pipeline.message_cycle_manager.session_factory") as mock_session_factory:
            # Setup mock session and message file
            mock_session = Mock()
            mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

            mock_message_file = Mock()
            # Current implementation uses session.scalar(select(...))
            mock_session.scalar.return_value = mock_message_file

            # Execute: compute event type once, then pass to message_to_stream_response
            with current_app.app_context():
                event_type = message_cycle_manager.get_message_event_type("test-message-id")
                result = message_cycle_manager.message_to_stream_response(
                    answer="Hello world", message_id="test-message-id", event_type=event_type
                )

            # Assert
            assert isinstance(result, MessageStreamResponse)
            assert result.answer == "Hello world"
            assert result.id == "test-message-id"
            assert result.event == StreamEvent.MESSAGE_FILE
            mock_session.scalar.assert_called_once()

    def test_message_to_stream_response_with_event_type_skips_query(self, message_cycle_manager):
        """Test that message_to_stream_response skips database query when event_type is provided."""
        with patch("core.app.task_pipeline.message_cycle_manager.session_factory") as mock_session_factory:
            # Execute with event_type provided
            result = message_cycle_manager.message_to_stream_response(
                answer="Hello world", message_id="test-message-id", event_type=StreamEvent.MESSAGE
            )

            # Assert
            assert isinstance(result, MessageStreamResponse)
            assert result.answer == "Hello world"
            assert result.id == "test-message-id"
            assert result.event == StreamEvent.MESSAGE
            # Should not open a session when event_type is provided
            mock_session_factory.create_session.assert_not_called()

    def test_message_to_stream_response_with_from_variable_selector(self, message_cycle_manager):
        """Test message_to_stream_response with from_variable_selector parameter."""
        result = message_cycle_manager.message_to_stream_response(
            answer="Hello world",
            message_id="test-message-id",
            from_variable_selector=["var1", "var2"],
            event_type=StreamEvent.MESSAGE,
        )

        assert isinstance(result, MessageStreamResponse)
        assert result.answer == "Hello world"
        assert result.id == "test-message-id"
        assert result.from_variable_selector == ["var1", "var2"]
        assert result.event == StreamEvent.MESSAGE

    def test_optimization_usage_example(self, message_cycle_manager):
        """Test the optimization pattern that should be used by callers."""
        # Step 1: Get event type once (this queries database)
        with patch("core.app.task_pipeline.message_cycle_manager.session_factory") as mock_session_factory:
            mock_session = Mock()
            mock_session_factory.create_session.return_value.__enter__.return_value = mock_session
            # Current implementation uses session.scalar(select(...))
            mock_session.scalar.return_value = None  # No files
            with current_app.app_context():
                event_type = message_cycle_manager.get_message_event_type("test-message-id")

        # Should open session once
        mock_session_factory.create_session.assert_called_once()
        assert event_type == StreamEvent.MESSAGE

        # Step 2: Use event_type for multiple calls (no additional queries)
        with patch("core.app.task_pipeline.message_cycle_manager.session_factory") as mock_session_factory:
            mock_session_factory.create_session.return_value.__enter__.return_value = Mock()

            chunk1_response = message_cycle_manager.message_to_stream_response(
                answer="Chunk 1", message_id="test-message-id", event_type=event_type
            )

            chunk2_response = message_cycle_manager.message_to_stream_response(
                answer="Chunk 2", message_id="test-message-id", event_type=event_type
            )

            # Should not open session again when event_type provided
            mock_session_factory.create_session.assert_not_called()

            assert chunk1_response.event == StreamEvent.MESSAGE
            assert chunk2_response.event == StreamEvent.MESSAGE
            assert chunk1_response.answer == "Chunk 1"
            assert chunk2_response.answer == "Chunk 2"
