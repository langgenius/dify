"""
Tests for AdvancedChatAppGenerateTaskPipeline._handle_node_succeeded_event method,
specifically testing the ANSWER node message_replace logic.
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity
from core.app.entities.queue_entities import QueueNodeSucceededEvent
from core.workflow.enums import NodeType
from models import EndUser
from models.model import AppMode


class TestAnswerNodeMessageReplace:
    """Test cases for ANSWER node message_replace event logic."""

    @pytest.fixture
    def mock_application_generate_entity(self):
        """Create a mock application generate entity."""
        entity = Mock(spec=AdvancedChatAppGenerateEntity)
        entity.task_id = "test-task-id"
        entity.app_id = "test-app-id"
        entity.workflow_run_id = "test-workflow-run-id"
        # minimal app_config used by pipeline internals
        entity.app_config = SimpleNamespace(
            tenant_id="test-tenant-id",
            app_id="test-app-id",
            app_mode=AppMode.ADVANCED_CHAT,
            app_model_config_dict={},
            additional_features=None,
            sensitive_word_avoidance=None,
        )
        entity.query = "test query"
        entity.files = []
        entity.extras = {}
        entity.trace_manager = None
        entity.inputs = {}
        entity.invoke_from = "debugger"
        return entity

    @pytest.fixture
    def mock_workflow(self):
        """Create a mock workflow."""
        workflow = Mock()
        workflow.id = "test-workflow-id"
        workflow.features_dict = {}
        return workflow

    @pytest.fixture
    def mock_queue_manager(self):
        """Create a mock queue manager."""
        manager = Mock()
        manager.listen.return_value = []
        manager.graph_runtime_state = None
        return manager

    @pytest.fixture
    def mock_conversation(self):
        """Create a mock conversation."""
        conversation = Mock()
        conversation.id = "test-conversation-id"
        conversation.mode = "advanced_chat"
        return conversation

    @pytest.fixture
    def mock_message(self):
        """Create a mock message."""
        message = Mock()
        message.id = "test-message-id"
        message.query = "test query"
        message.created_at = Mock()
        message.created_at.timestamp.return_value = 1234567890
        return message

    @pytest.fixture
    def mock_user(self):
        """Create a mock end user."""
        user = MagicMock(spec=EndUser)
        user.id = "test-user-id"
        user.session_id = "test-session-id"
        return user

    @pytest.fixture
    def mock_draft_var_saver_factory(self):
        """Create a mock draft variable saver factory."""
        return Mock()

    @pytest.fixture
    def pipeline(
        self,
        mock_application_generate_entity,
        mock_workflow,
        mock_queue_manager,
        mock_conversation,
        mock_message,
        mock_user,
        mock_draft_var_saver_factory,
    ):
        """Create an AdvancedChatAppGenerateTaskPipeline instance with mocked dependencies."""
        from core.app.apps.advanced_chat.generate_task_pipeline import AdvancedChatAppGenerateTaskPipeline

        with patch("core.app.apps.advanced_chat.generate_task_pipeline.db"):
            pipeline = AdvancedChatAppGenerateTaskPipeline(
                application_generate_entity=mock_application_generate_entity,
                workflow=mock_workflow,
                queue_manager=mock_queue_manager,
                conversation=mock_conversation,
                message=mock_message,
                user=mock_user,
                stream=True,
                dialogue_count=1,
                draft_var_saver_factory=mock_draft_var_saver_factory,
            )
            # Initialize workflow run id to avoid validation errors
            pipeline._workflow_run_id = "test-workflow-run-id"
            # Mock the message cycle manager methods we need to track
            pipeline._message_cycle_manager.message_replace_to_stream_response = Mock()
            return pipeline

    def test_answer_node_with_different_output_sends_message_replace(self, pipeline, mock_application_generate_entity):
        """
        Test that when an ANSWER node's final output differs from accumulated answer,
        a message_replace event is sent.
        """
        # Arrange: Set initial accumulated answer
        pipeline._task_state.answer = "initial answer"

        # Create ANSWER node succeeded event with different final output
        event = QueueNodeSucceededEvent(
            node_execution_id="test-node-execution-id",
            node_id="test-answer-node",
            node_type=NodeType.ANSWER,
            start_at=datetime.now(),
            outputs={"answer": "updated final answer"},
        )

        # Mock the workflow response converter to avoid extra processing
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = Mock(return_value=None)
        pipeline._save_output_for_event = Mock()

        # Act
        responses = list(pipeline._handle_node_succeeded_event(event))

        # Assert
        assert pipeline._task_state.answer == "updated final answer"
        # Verify message_replace was called
        pipeline._message_cycle_manager.message_replace_to_stream_response.assert_called_once_with(
            answer="updated final answer", reason="variable_update"
        )

    def test_answer_node_with_same_output_does_not_send_message_replace(self, pipeline):
        """
        Test that when an ANSWER node's final output is the same as accumulated answer,
        no message_replace event is sent.
        """
        # Arrange: Set initial accumulated answer
        pipeline._task_state.answer = "same answer"

        # Create ANSWER node succeeded event with same output
        event = QueueNodeSucceededEvent(
            node_execution_id="test-node-execution-id",
            node_id="test-answer-node",
            node_type=NodeType.ANSWER,
            start_at=datetime.now(),
            outputs={"answer": "same answer"},
        )

        # Mock the workflow response converter
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = Mock(return_value=None)
        pipeline._save_output_for_event = Mock()

        # Act
        list(pipeline._handle_node_succeeded_event(event))

        # Assert: answer should remain unchanged
        assert pipeline._task_state.answer == "same answer"
        # Verify message_replace was NOT called
        pipeline._message_cycle_manager.message_replace_to_stream_response.assert_not_called()

    def test_answer_node_with_none_output_does_not_send_message_replace(self, pipeline):
        """
        Test that when an ANSWER node's output is None or missing 'answer' key,
        no message_replace event is sent.
        """
        # Arrange: Set initial accumulated answer
        pipeline._task_state.answer = "existing answer"

        # Create ANSWER node succeeded event with None output
        event = QueueNodeSucceededEvent(
            node_execution_id="test-node-execution-id",
            node_id="test-answer-node",
            node_type=NodeType.ANSWER,
            start_at=datetime.now(),
            outputs={"answer": None},
        )

        # Mock the workflow response converter
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = Mock(return_value=None)
        pipeline._save_output_for_event = Mock()

        # Act
        list(pipeline._handle_node_succeeded_event(event))

        # Assert: answer should remain unchanged
        assert pipeline._task_state.answer == "existing answer"
        # Verify message_replace was NOT called
        pipeline._message_cycle_manager.message_replace_to_stream_response.assert_not_called()

    def test_answer_node_with_empty_outputs_does_not_send_message_replace(self, pipeline):
        """
        Test that when an ANSWER node has empty outputs dict,
        no message_replace event is sent.
        """
        # Arrange: Set initial accumulated answer
        pipeline._task_state.answer = "existing answer"

        # Create ANSWER node succeeded event with empty outputs
        event = QueueNodeSucceededEvent(
            node_execution_id="test-node-execution-id",
            node_id="test-answer-node",
            node_type=NodeType.ANSWER,
            start_at=datetime.now(),
            outputs={},
        )

        # Mock the workflow response converter
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = Mock(return_value=None)
        pipeline._save_output_for_event = Mock()

        # Act
        list(pipeline._handle_node_succeeded_event(event))

        # Assert: answer should remain unchanged
        assert pipeline._task_state.answer == "existing answer"
        # Verify message_replace was NOT called
        pipeline._message_cycle_manager.message_replace_to_stream_response.assert_not_called()

    def test_answer_node_with_no_answer_key_in_outputs(self, pipeline):
        """
        Test that when an ANSWER node's outputs don't contain 'answer' key,
        no message_replace event is sent.
        """
        # Arrange: Set initial accumulated answer
        pipeline._task_state.answer = "existing answer"

        # Create ANSWER node succeeded event without 'answer' key in outputs
        event = QueueNodeSucceededEvent(
            node_execution_id="test-node-execution-id",
            node_id="test-answer-node",
            node_type=NodeType.ANSWER,
            start_at=datetime.now(),
            outputs={"other_key": "some value"},
        )

        # Mock the workflow response converter
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = Mock(return_value=None)
        pipeline._save_output_for_event = Mock()

        # Act
        list(pipeline._handle_node_succeeded_event(event))

        # Assert: answer should remain unchanged
        assert pipeline._task_state.answer == "existing answer"
        # Verify message_replace was NOT called
        pipeline._message_cycle_manager.message_replace_to_stream_response.assert_not_called()

    def test_non_answer_node_does_not_send_message_replace(self, pipeline):
        """
        Test that non-ANSWER nodes (e.g., LLM, END) don't trigger message_replace events.
        """
        # Arrange: Set initial accumulated answer
        pipeline._task_state.answer = "existing answer"

        # Test with LLM node
        llm_event = QueueNodeSucceededEvent(
            node_execution_id="test-llm-execution-id",
            node_id="test-llm-node",
            node_type=NodeType.LLM,
            start_at=datetime.now(),
            outputs={"answer": "different answer"},
        )

        # Mock the workflow response converter
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = Mock(return_value=None)
        pipeline._save_output_for_event = Mock()

        # Act
        list(pipeline._handle_node_succeeded_event(llm_event))

        # Assert: answer should remain unchanged
        assert pipeline._task_state.answer == "existing answer"
        # Verify message_replace was NOT called
        pipeline._message_cycle_manager.message_replace_to_stream_response.assert_not_called()

    def test_end_node_does_not_send_message_replace(self, pipeline):
        """
        Test that END nodes don't trigger message_replace events even with 'answer' output.
        """
        # Arrange: Set initial accumulated answer
        pipeline._task_state.answer = "existing answer"

        # Create END node succeeded event with answer output
        event = QueueNodeSucceededEvent(
            node_execution_id="test-end-execution-id",
            node_id="test-end-node",
            node_type=NodeType.END,
            start_at=datetime.now(),
            outputs={"answer": "different answer"},
        )

        # Mock the workflow response converter
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = Mock(return_value=None)
        pipeline._save_output_for_event = Mock()

        # Act
        list(pipeline._handle_node_succeeded_event(event))

        # Assert: answer should remain unchanged
        assert pipeline._task_state.answer == "existing answer"
        # Verify message_replace was NOT called
        pipeline._message_cycle_manager.message_replace_to_stream_response.assert_not_called()

    def test_answer_node_with_numeric_output_converts_to_string(self, pipeline):
        """
        Test that when an ANSWER node's final output is numeric,
        it gets converted to string properly.
        """
        # Arrange: Set initial accumulated answer
        pipeline._task_state.answer = "text answer"

        # Create ANSWER node succeeded event with numeric output
        event = QueueNodeSucceededEvent(
            node_execution_id="test-node-execution-id",
            node_id="test-answer-node",
            node_type=NodeType.ANSWER,
            start_at=datetime.now(),
            outputs={"answer": 12345},
        )

        # Mock the workflow response converter
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = Mock(return_value=None)
        pipeline._save_output_for_event = Mock()

        # Act
        list(pipeline._handle_node_succeeded_event(event))

        # Assert: answer should be converted to string
        assert pipeline._task_state.answer == "12345"
        # Verify message_replace was called with string
        pipeline._message_cycle_manager.message_replace_to_stream_response.assert_called_once_with(
            answer="12345", reason="variable_update"
        )

    def test_answer_node_files_are_recorded(self, pipeline):
        """
        Test that ANSWER nodes properly record files from outputs.
        """
        # Arrange
        pipeline._task_state.answer = "existing answer"

        # Create ANSWER node succeeded event with files
        event = QueueNodeSucceededEvent(
            node_execution_id="test-node-execution-id",
            node_id="test-answer-node",
            node_type=NodeType.ANSWER,
            start_at=datetime.now(),
            outputs={
                "answer": "same answer",
                "files": [
                    {"type": "image", "transfer_method": "remote_url", "remote_url": "http://example.com/img.png"}
                ],
            },
        )

        # Mock the workflow response converter
        pipeline._workflow_response_converter.fetch_files_from_node_outputs = Mock(return_value=event.outputs["files"])
        pipeline._workflow_response_converter.workflow_node_finish_to_stream_response = Mock(return_value=None)
        pipeline._save_output_for_event = Mock()

        # Act
        list(pipeline._handle_node_succeeded_event(event))

        # Assert: files should be recorded
        assert len(pipeline._recorded_files) == 1
        assert pipeline._recorded_files[0] == event.outputs["files"][0]
