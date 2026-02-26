from unittest.mock import patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from models.model import AppMode
from services.app_task_service import AppTaskService


class TestAppTaskService:
    """Test suite for AppTaskService.stop_task method."""

    @pytest.mark.parametrize(
        ("app_mode", "should_call_graph_engine"),
        [
            (AppMode.CHAT, False),
            (AppMode.COMPLETION, False),
            (AppMode.AGENT_CHAT, False),
            (AppMode.CHANNEL, False),
            (AppMode.RAG_PIPELINE, False),
            (AppMode.ADVANCED_CHAT, True),
            (AppMode.WORKFLOW, True),
        ],
    )
    @patch("services.app_task_service.AppQueueManager")
    @patch("services.app_task_service.GraphEngineManager")
    def test_stop_task_with_different_app_modes(
        self, mock_graph_engine_manager, mock_app_queue_manager, app_mode, should_call_graph_engine
    ):
        """Test stop_task behavior with different app modes.

        Verifies that:
        - Legacy Redis flag is always set via AppQueueManager
        - GraphEngine stop command is only sent for ADVANCED_CHAT and WORKFLOW modes
        """
        # Arrange
        task_id = "task-123"
        invoke_from = InvokeFrom.WEB_APP
        user_id = "user-456"

        # Act
        AppTaskService.stop_task(task_id, invoke_from, user_id, app_mode)

        # Assert
        mock_app_queue_manager.set_stop_flag.assert_called_once_with(task_id, invoke_from, user_id)
        if should_call_graph_engine:
            mock_graph_engine_manager.send_stop_command.assert_called_once_with(task_id)
        else:
            mock_graph_engine_manager.send_stop_command.assert_not_called()

    @pytest.mark.parametrize(
        "invoke_from",
        [
            InvokeFrom.WEB_APP,
            InvokeFrom.SERVICE_API,
            InvokeFrom.DEBUGGER,
            InvokeFrom.EXPLORE,
        ],
    )
    @patch("services.app_task_service.AppQueueManager")
    @patch("services.app_task_service.GraphEngineManager")
    def test_stop_task_with_different_invoke_sources(
        self, mock_graph_engine_manager, mock_app_queue_manager, invoke_from
    ):
        """Test stop_task behavior with different invoke sources.

        Verifies that the method works correctly regardless of the invoke source.
        """
        # Arrange
        task_id = "task-789"
        user_id = "user-999"
        app_mode = AppMode.ADVANCED_CHAT

        # Act
        AppTaskService.stop_task(task_id, invoke_from, user_id, app_mode)

        # Assert
        mock_app_queue_manager.set_stop_flag.assert_called_once_with(task_id, invoke_from, user_id)
        mock_graph_engine_manager.send_stop_command.assert_called_once_with(task_id)

    @patch("services.app_task_service.GraphEngineManager")
    @patch("services.app_task_service.AppQueueManager")
    def test_stop_task_legacy_mechanism_called_even_if_graph_engine_fails(
        self, mock_app_queue_manager, mock_graph_engine_manager
    ):
        """Test that legacy Redis flag is set even if GraphEngine fails.

        This ensures backward compatibility: the legacy mechanism should complete
        before attempting the GraphEngine command, so the stop flag is set
        regardless of GraphEngine success.
        """
        # Arrange
        task_id = "task-123"
        invoke_from = InvokeFrom.WEB_APP
        user_id = "user-456"
        app_mode = AppMode.ADVANCED_CHAT

        # Simulate GraphEngine failure
        mock_graph_engine_manager.send_stop_command.side_effect = Exception("GraphEngine error")

        # Act & Assert - should raise the exception since it's not caught
        with pytest.raises(Exception, match="GraphEngine error"):
            AppTaskService.stop_task(task_id, invoke_from, user_id, app_mode)

        # Verify legacy mechanism was still called before the exception
        mock_app_queue_manager.set_stop_flag.assert_called_once_with(task_id, invoke_from, user_id)
