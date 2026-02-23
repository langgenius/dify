"""Unit tests for the message cycle manager optimization."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from flask import current_app

from core.app.entities.queue_entities import QueueAnnotationReplyEvent, QueueRetrieverResourcesEvent
from core.app.entities.task_entities import MessageStreamResponse, StreamEvent, TaskStateMetadata
from core.app.task_pipeline.message_cycle_manager import MessageCycleManager
from core.rag.entities.citation_metadata import RetrievalSourceMetadata


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

    def test_get_message_event_type_with_assistant_file(self, message_cycle_manager):
        """Test get_message_event_type returns MESSAGE_FILE when message has assistant-generated files.

        This ensures that AI-generated images (belongs_to='assistant') trigger the MESSAGE_FILE event,
        allowing the frontend to properly display generated image files with url field.
        """
        with patch("core.app.task_pipeline.message_cycle_manager.session_factory") as mock_session_factory:
            # Setup mock session and message file
            mock_session = Mock()
            mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

            mock_message_file = Mock()
            mock_message_file.belongs_to = "assistant"
            mock_session.scalar.return_value = mock_message_file

            # Execute
            with current_app.app_context():
                result = message_cycle_manager.get_message_event_type("test-message-id")

            # Assert
            assert result == StreamEvent.MESSAGE_FILE
            mock_session.scalar.assert_called_once()

    def test_get_message_event_type_with_user_file(self, message_cycle_manager):
        """Test get_message_event_type returns MESSAGE when message only has user-uploaded files.

        This is a regression test for the issue where user-uploaded images (belongs_to='user')
        caused the LLM text response to be incorrectly tagged with MESSAGE_FILE event,
        resulting in broken images in the chat UI. The query filters for belongs_to='assistant',
        so when only user files exist, the database query returns None, resulting in MESSAGE event type.
        """
        with patch("core.app.task_pipeline.message_cycle_manager.session_factory") as mock_session_factory:
            # Setup mock session and message file
            mock_session = Mock()
            mock_session_factory.create_session.return_value.__enter__.return_value = mock_session

            # When querying for assistant files with only user files present, return None
            # (simulates database query with belongs_to='assistant' filter returning no results)
            mock_session.scalar.return_value = None

            # Execute
            with current_app.app_context():
                result = message_cycle_manager.get_message_event_type("test-message-id")

            # Assert
            assert result == StreamEvent.MESSAGE
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
            mock_message_file.belongs_to = "assistant"
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

    def test_generate_conversation_name_returns_none_for_completion(self, message_cycle_manager):
        """Return None when completion entities are used for conversation naming.

        Args: message_cycle_manager with DummyCompletion injected as CompletionAppGenerateEntity.
        Returns: None, indicating no name generation for completion apps.
        Side effects: None expected.
        """

        class DummyCompletion:
            pass

        with patch("core.app.task_pipeline.message_cycle_manager.CompletionAppGenerateEntity", DummyCompletion):
            message_cycle_manager._application_generate_entity = DummyCompletion()
            result = message_cycle_manager.generate_conversation_name(conversation_id="c1", query="hi")

        assert result is None

    def test_handle_annotation_reply_sets_metadata(self, message_cycle_manager):
        """Populate task metadata from annotation reply events.

        Args: message_cycle_manager with TaskStateMetadata and a mocked AppAnnotationService.
        Returns: The fetched annotation object.
        Side effects: Updates metadata.annotation_reply with id and account name.
        """
        message_cycle_manager._task_state = SimpleNamespace(metadata=TaskStateMetadata())

        annotation = SimpleNamespace(
            id="ann-1",
            account_id="acct-1",
            account=SimpleNamespace(name="Alice"),
        )

        with patch("core.app.task_pipeline.message_cycle_manager.AppAnnotationService") as mock_service:
            mock_service.get_annotation_by_id.return_value = annotation

            result = message_cycle_manager.handle_annotation_reply(
                QueueAnnotationReplyEvent(message_annotation_id="ann-1")
            )

        assert result == annotation
        assert message_cycle_manager._task_state.metadata.annotation_reply.id == "ann-1"
        assert message_cycle_manager._task_state.metadata.annotation_reply.account.name == "Alice"

    def test_handle_retriever_resources_merges_and_deduplicates(self, message_cycle_manager):
        """Merge retriever resources, deduplicate, and preserve ordering positions.

        Args: message_cycle_manager with show_retrieve_source enabled and existing metadata.
        Returns: None.
        Side effects: Updates metadata.retriever_resources with unique items and positions.
        """
        message_cycle_manager._application_generate_entity.app_config = SimpleNamespace(
            additional_features=SimpleNamespace(show_retrieve_source=True)
        )
        existing = RetrievalSourceMetadata(dataset_id="d1", document_id="doc1")
        message_cycle_manager._task_state = SimpleNamespace(metadata=TaskStateMetadata(retriever_resources=[existing]))

        duplicate = RetrievalSourceMetadata(dataset_id="d1", document_id="doc1")
        new_resource = RetrievalSourceMetadata(dataset_id="d2", document_id="doc2")

        event = QueueRetrieverResourcesEvent(retriever_resources=[duplicate, new_resource])
        message_cycle_manager.handle_retriever_resources(event)

        assert len(message_cycle_manager._task_state.metadata.retriever_resources) == 2
        assert message_cycle_manager._task_state.metadata.retriever_resources[0].position == 1
        assert message_cycle_manager._task_state.metadata.retriever_resources[1].position == 2

    def test_message_file_to_stream_response_builds_signed_url(self, message_cycle_manager):
        """Build a stream response with a signed tool file URL.

        Args: message_cycle_manager with mocked Session/db and sign_tool_file.
        Returns: MessageStreamResponse with signed url and belongs_to normalized to user.
        Side effects: Calls sign_tool_file for tool file ids.
        """
        message_cycle_manager._application_generate_entity.task_id = "task-1"

        message_file = SimpleNamespace(
            id="file-1",
            type="image",
            belongs_to=None,
            url="tool://file.verylongextension",
            message_id="msg-1",
        )

        session = Mock()
        session.scalar.return_value = message_file

        with (
            patch("core.app.task_pipeline.message_cycle_manager.Session") as mock_session_cls,
            patch("core.app.task_pipeline.message_cycle_manager.sign_tool_file") as mock_sign,
            patch("core.app.task_pipeline.message_cycle_manager.db") as mock_db,
        ):
            mock_db.engine = Mock()
            mock_session_cls.return_value.__enter__.return_value = session
            mock_sign.return_value = "signed-url"

            response = message_cycle_manager.message_file_to_stream_response(SimpleNamespace(message_file_id="file-1"))

        assert response.url == "signed-url"
        assert response.belongs_to == "user"
        mock_sign.assert_called_once_with(tool_file_id="file", extension=".bin")

    def test_handle_retriever_resources_requires_features(self, message_cycle_manager):
        """Raise when retriever resources are handled without feature config.

        Args: message_cycle_manager with additional_features unset and empty metadata.
        Raises: ValueError when show_retrieve_source configuration is missing.
        """
        message_cycle_manager._application_generate_entity.app_config = SimpleNamespace(additional_features=None)
        message_cycle_manager._task_state = SimpleNamespace(metadata=TaskStateMetadata())

        with pytest.raises(ValueError):
            message_cycle_manager.handle_retriever_resources(QueueRetrieverResourcesEvent(retriever_resources=[]))
