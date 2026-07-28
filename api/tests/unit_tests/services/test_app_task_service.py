from unittest.mock import patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from models.enums import CreatorUserRole
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
            (AppMode.AGENT, False),
            (AppMode.CHANNEL, False),
            (AppMode.RAG_PIPELINE, True),
            (AppMode.ADVANCED_CHAT, True),
            (AppMode.WORKFLOW, True),
        ],
    )
    @patch("services.app_task_service.request_workflow_handoff_cancel_for_app")
    @patch("services.app_task_service.AppQueueManager")
    @patch("services.app_task_service.GraphEngineManager")
    def test_stop_task_with_different_app_modes(
        self,
        mock_graph_engine_manager,
        mock_app_queue_manager,
        mock_handoff_cancel,
        app_mode,
        should_call_graph_engine,
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
        tenant_id = "tenant-123"
        app_id = "app-123"

        # Act
        AppTaskService.stop_task(
            task_id,
            invoke_from,
            user_id,
            app_mode,
            tenant_id=tenant_id,
            app_id=app_id,
        )

        # Assert
        mock_app_queue_manager.set_stop_flag.assert_called_once_with(task_id, invoke_from, user_id)
        if should_call_graph_engine:
            mock_handoff_cancel.assert_called_once_with(
                task_id,
                tenant_id=tenant_id,
                app_id=app_id,
                created_by_role=CreatorUserRole.END_USER,
                created_by=user_id,
            )
            mock_graph_engine_manager.assert_called_once()
            mock_graph_engine_manager.return_value.send_stop_command.assert_called_once_with(task_id)
        else:
            mock_handoff_cancel.assert_not_called()
            mock_graph_engine_manager.assert_not_called()

    @pytest.mark.parametrize(
        "invoke_from",
        [
            InvokeFrom.WEB_APP,
            InvokeFrom.SERVICE_API,
            InvokeFrom.DEBUGGER,
            InvokeFrom.EXPLORE,
        ],
    )
    @patch("services.app_task_service.request_workflow_handoff_cancel_for_app")
    @patch("services.app_task_service.AppQueueManager")
    @patch("services.app_task_service.GraphEngineManager")
    def test_stop_task_with_different_invoke_sources(
        self, mock_graph_engine_manager, mock_app_queue_manager, mock_handoff_cancel, invoke_from
    ):
        """Test stop_task behavior with different invoke sources.

        Verifies that the method works correctly regardless of the invoke source.
        """
        # Arrange
        task_id = "task-789"
        user_id = "user-999"
        app_mode = AppMode.ADVANCED_CHAT
        tenant_id = "tenant-789"
        app_id = "app-789"

        # Act
        AppTaskService.stop_task(
            task_id,
            invoke_from,
            user_id,
            app_mode,
            tenant_id=tenant_id,
            app_id=app_id,
        )

        # Assert
        mock_app_queue_manager.set_stop_flag.assert_called_once_with(task_id, invoke_from, user_id)
        mock_handoff_cancel.assert_called_once_with(
            task_id,
            tenant_id=tenant_id,
            app_id=app_id,
            created_by_role=(CreatorUserRole.ACCOUNT if invoke_from.runs_as_account() else CreatorUserRole.END_USER),
            created_by=user_id,
        )
        mock_graph_engine_manager.assert_called_once()
        mock_graph_engine_manager.return_value.send_stop_command.assert_called_once_with(task_id)

    @patch("services.app_task_service.request_workflow_handoff_cancel_for_app")
    @patch("services.app_task_service.GraphEngineManager")
    @patch("services.app_task_service.AppQueueManager")
    def test_stop_task_legacy_mechanism_called_even_if_graph_engine_fails(
        self, mock_app_queue_manager, mock_graph_engine_manager, mock_handoff_cancel
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
        tenant_id = "tenant-123"
        app_id = "app-123"

        # Simulate GraphEngine failure
        mock_graph_engine_manager.return_value.send_stop_command.side_effect = Exception("GraphEngine error")

        # Act & Assert - should raise the exception since it's not caught
        with pytest.raises(Exception, match="GraphEngine error"):
            AppTaskService.stop_task(
                task_id,
                invoke_from,
                user_id,
                app_mode,
                tenant_id=tenant_id,
                app_id=app_id,
            )

        # Verify legacy mechanism was still called before the exception
        mock_app_queue_manager.set_stop_flag.assert_called_once_with(task_id, invoke_from, user_id)
        mock_handoff_cancel.assert_called_once_with(
            task_id,
            tenant_id=tenant_id,
            app_id=app_id,
            created_by_role=CreatorUserRole.END_USER,
            created_by=user_id,
        )

    @patch("services.app_task_service.request_workflow_handoff_cancel_for_app")
    @patch("services.app_task_service.GraphEngineManager")
    @patch("services.app_task_service.AppQueueManager")
    def test_stop_task_does_not_send_graph_abort_or_report_success_when_handoff_cancel_fails(
        self, mock_app_queue_manager, mock_graph_engine_manager, mock_handoff_cancel
    ):
        mock_handoff_cancel.side_effect = RuntimeError("database unavailable")

        with pytest.raises(RuntimeError, match="database unavailable"):
            AppTaskService.stop_task(
                "task-123",
                InvokeFrom.WEB_APP,
                "user-456",
                AppMode.ADVANCED_CHAT,
                tenant_id="tenant-123",
                app_id="app-123",
            )

        mock_app_queue_manager.set_stop_flag.assert_called_once_with(
            "task-123",
            InvokeFrom.WEB_APP,
            "user-456",
        )
        mock_graph_engine_manager.assert_not_called()

    @patch("services.app_task_service.request_workflow_handoff_cancel_for_app", return_value=0)
    @patch("services.app_task_service.GraphEngineManager")
    @patch("services.app_task_service.AppQueueManager")
    def test_stop_task_rejects_unowned_task_id(
        self,
        mock_app_queue_manager,
        mock_graph_engine_manager,
        mock_handoff_cancel,
    ) -> None:
        mock_app_queue_manager.set_stop_flag.return_value = False

        AppTaskService.stop_task(
            "another-users-task",
            InvokeFrom.WEB_APP,
            "requesting-user",
            AppMode.ADVANCED_CHAT,
            tenant_id="tenant-123",
            app_id="app-123",
        )

        mock_handoff_cancel.assert_called_once_with(
            "another-users-task",
            tenant_id="tenant-123",
            app_id="app-123",
            created_by_role=CreatorUserRole.END_USER,
            created_by="requesting-user",
        )
        mock_graph_engine_manager.assert_not_called()

    @patch("services.app_task_service.request_workflow_handoff_cancel_for_app", return_value=1)
    @patch("services.app_task_service.GraphEngineManager")
    @patch("services.app_task_service.AppQueueManager")
    def test_stop_task_accepts_explicit_creator_role_for_openapi_account(
        self,
        mock_app_queue_manager,
        mock_graph_engine_manager,
        mock_handoff_cancel,
    ) -> None:
        mock_app_queue_manager.set_stop_flag.return_value = True

        AppTaskService.stop_task(
            "task-123",
            InvokeFrom.OPENAPI,
            "account-123",
            AppMode.WORKFLOW,
            tenant_id="tenant-123",
            app_id="app-123",
            created_by_role=CreatorUserRole.ACCOUNT,
        )

        mock_handoff_cancel.assert_called_once_with(
            "task-123",
            tenant_id="tenant-123",
            app_id="app-123",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-123",
        )
        mock_graph_engine_manager.return_value.send_stop_command.assert_called_once_with("task-123")
