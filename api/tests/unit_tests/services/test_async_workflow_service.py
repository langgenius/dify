import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import services.async_workflow_service as async_workflow_service_module
from models.enums import AppTriggerType, CreatorUserRole, WorkflowRunTriggeredFrom, WorkflowTriggerStatus
from services.async_workflow_service import AsyncWorkflowService
from services.errors.app import QuotaExceededError, WorkflowNotFoundError, WorkflowQuotaLimitError
from services.workflow.entities import AsyncTriggerResponse, TriggerData
from services.workflow.queue_dispatcher import QueuePriority


class AsyncWorkflowServiceTestDataFactory:
    """Factory helpers for async workflow service unit tests."""

    @staticmethod
    def create_trigger_data(
        app_id: str = "app-123",
        tenant_id: str = "tenant-123",
        workflow_id: str | None = "workflow-123",
        root_node_id: str = "root-node-123",
    ) -> TriggerData:
        """Create valid trigger data for async workflow execution tests."""
        return TriggerData(
            app_id=app_id,
            tenant_id=tenant_id,
            workflow_id=workflow_id,
            root_node_id=root_node_id,
            inputs={"name": "dify"},
            files=[],
            trigger_type=AppTriggerType.UNKNOWN,
            trigger_from=WorkflowRunTriggeredFrom.APP_RUN,
            trigger_metadata=None,
        )

    @staticmethod
    def create_trigger_log_with_data(trigger_data: TriggerData, retry_count: int = 0) -> MagicMock:
        """Create a mock trigger log with serialized trigger data."""
        trigger_log = MagicMock()
        trigger_log.id = "trigger-log-123"
        trigger_log.trigger_data = trigger_data.model_dump_json()
        trigger_log.retry_count = retry_count
        trigger_log.error = "previous-error"
        trigger_log.status = WorkflowTriggerStatus.FAILED
        trigger_log.to_dict.return_value = {"id": trigger_log.id}
        return trigger_log


class TestAsyncWorkflowService:
    @pytest.fixture
    def async_workflow_trigger_mocks(self):
        """Shared fixture for async workflow trigger tests.

        Yields mocks for:
            - repo: SQLAlchemyWorkflowTriggerLogRepository
            - dispatcher_manager_class: QueueDispatcherManager class
            - dispatcher: dispatcher instance
            - quota_workflow: QuotaType.WORKFLOW
            - get_workflow: AsyncWorkflowService._get_workflow method
            - professional_task: execute_workflow_professional
            - team_task: execute_workflow_team
            - sandbox_task: execute_workflow_sandbox
        """
        mock_repo = MagicMock()

        def _create_side_effect(new_log):
            new_log.id = "trigger-log-123"
            return new_log

        mock_repo.create.side_effect = _create_side_effect

        mock_dispatcher = MagicMock()
        quota_workflow = MagicMock()
        mock_get_workflow = MagicMock()

        mock_professional_task = MagicMock()
        mock_team_task = MagicMock()
        mock_sandbox_task = MagicMock()

        with (
            patch.object(
                async_workflow_service_module,
                "SQLAlchemyWorkflowTriggerLogRepository",
                return_value=mock_repo,
            ),
            patch.object(async_workflow_service_module, "QueueDispatcherManager") as mock_dispatcher_manager_class,
            patch.object(async_workflow_service_module, "WorkflowService"),
            patch.object(
                async_workflow_service_module.AsyncWorkflowService,
                "_get_workflow",
            ) as mock_get_workflow,
            patch.object(
                async_workflow_service_module,
                "QuotaType",
                new=SimpleNamespace(WORKFLOW=quota_workflow),
            ),
            patch.object(async_workflow_service_module, "execute_workflow_professional") as mock_professional_task,
            patch.object(async_workflow_service_module, "execute_workflow_team") as mock_team_task,
            patch.object(async_workflow_service_module, "execute_workflow_sandbox") as mock_sandbox_task,
        ):
            # Configure dispatcher_manager to return our mock_dispatcher
            mock_dispatcher_manager_class.return_value.get_dispatcher.return_value = mock_dispatcher

            yield {
                "repo": mock_repo,
                "dispatcher_manager_class": mock_dispatcher_manager_class,
                "dispatcher": mock_dispatcher,
                "quota_workflow": quota_workflow,
                "get_workflow": mock_get_workflow,
                "professional_task": mock_professional_task,
                "team_task": mock_team_task,
                "sandbox_task": mock_sandbox_task,
            }

    @pytest.mark.parametrize(
        ("queue_name", "selected_task_attr"),
        [
            (QueuePriority.PROFESSIONAL, "execute_workflow_professional"),
            (QueuePriority.TEAM, "execute_workflow_team"),
            (QueuePriority.SANDBOX, "execute_workflow_sandbox"),
        ],
    )
    def test_should_dispatch_to_matching_celery_task_when_triggering_workflow(
        self, queue_name, selected_task_attr, async_workflow_trigger_mocks
    ):
        """Test queue-based task routing and successful async trigger response."""
        # Arrange
        session = MagicMock()
        session.commit = MagicMock()
        app_model = MagicMock()
        app_model.id = "app-123"
        session.scalar.return_value = app_model
        trigger_data = AsyncWorkflowServiceTestDataFactory.create_trigger_data()
        workflow = MagicMock()
        workflow.id = "workflow-123"

        mocks = async_workflow_trigger_mocks
        mocks["dispatcher"].get_queue_name.return_value = queue_name
        mocks["get_workflow"].return_value = workflow

        task_result = MagicMock()
        task_result.id = "task-123"
        mocks["professional_task"].delay.return_value = task_result
        mocks["team_task"].delay.return_value = task_result
        mocks["sandbox_task"].delay.return_value = task_result

        class DummyAccount:
            def __init__(self, user_id: str):
                self.id = user_id

        with patch.object(async_workflow_service_module, "Account", DummyAccount):
            user = DummyAccount("account-123")

            # Act
            result = AsyncWorkflowService.trigger_workflow_async(session=session, user=user, trigger_data=trigger_data)

        # Assert
        assert isinstance(result, AsyncTriggerResponse)
        assert result.workflow_trigger_log_id == "trigger-log-123"
        assert result.task_id == "task-123"
        assert result.status == "queued"
        assert result.queue == queue_name

        mocks["quota_workflow"].consume.assert_called_once_with("tenant-123")
        assert session.commit.call_count == 2

        created_log = mocks["repo"].create.call_args[0][0]
        assert created_log.status == WorkflowTriggerStatus.QUEUED
        assert created_log.queue_name == queue_name
        assert created_log.created_by_role == CreatorUserRole.ACCOUNT
        assert created_log.created_by == "account-123"
        assert created_log.trigger_data == trigger_data.model_dump_json()
        assert created_log.inputs == json.dumps(dict(trigger_data.inputs))
        assert created_log.celery_task_id == "task-123"

        task_mocks = {
            "execute_workflow_professional": mocks["professional_task"],
            "execute_workflow_team": mocks["team_task"],
            "execute_workflow_sandbox": mocks["sandbox_task"],
        }
        for task_attr, task_mock in task_mocks.items():
            if task_attr == selected_task_attr:
                task_mock.delay.assert_called_once_with({"workflow_trigger_log_id": "trigger-log-123"})
            else:
                task_mock.delay.assert_not_called()

    def test_should_set_end_user_role_when_triggered_by_end_user(self, async_workflow_trigger_mocks):
        """Test that non-account users are tracked as END_USER in trigger logs."""
        # Arrange
        session = MagicMock()
        session.commit = MagicMock()
        app_model = MagicMock()
        app_model.id = "app-123"
        session.scalar.return_value = app_model
        trigger_data = AsyncWorkflowServiceTestDataFactory.create_trigger_data()
        workflow = MagicMock()
        workflow.id = "workflow-123"

        mocks = async_workflow_trigger_mocks
        mocks["dispatcher"].get_queue_name.return_value = QueuePriority.SANDBOX
        mocks["get_workflow"].return_value = workflow

        task_result = MagicMock(id="task-123")
        mocks["sandbox_task"].delay.return_value = task_result

        user = SimpleNamespace(id="end-user-123")

        # Act
        AsyncWorkflowService.trigger_workflow_async(session=session, user=user, trigger_data=trigger_data)

        # Assert
        created_log = mocks["repo"].create.call_args[0][0]
        assert created_log.created_by_role == CreatorUserRole.END_USER
        assert created_log.created_by == "end-user-123"

    def test_should_raise_workflow_not_found_when_app_does_not_exist(self):
        """Test trigger failure when app lookup returns no result."""
        # Arrange
        session = MagicMock()
        session.scalar.return_value = None
        trigger_data = AsyncWorkflowServiceTestDataFactory.create_trigger_data(app_id="missing-app")

        with (
            patch.object(async_workflow_service_module, "SQLAlchemyWorkflowTriggerLogRepository"),
            patch.object(async_workflow_service_module, "QueueDispatcherManager"),
            patch.object(async_workflow_service_module, "WorkflowService"),
        ):
            # Act / Assert
            with pytest.raises(WorkflowNotFoundError, match="App not found: missing-app"):
                AsyncWorkflowService.trigger_workflow_async(
                    session=session,
                    user=SimpleNamespace(id="user-123"),
                    trigger_data=trigger_data,
                )

    def test_should_mark_log_rate_limited_and_raise_when_quota_exceeded(self, async_workflow_trigger_mocks):
        """Test quota-exceeded path updates trigger log and raises WorkflowQuotaLimitError."""
        # Arrange
        session = MagicMock()
        session.commit = MagicMock()
        app_model = MagicMock()
        app_model.id = "app-123"
        session.scalar.return_value = app_model
        trigger_data = AsyncWorkflowServiceTestDataFactory.create_trigger_data()
        workflow = MagicMock()
        workflow.id = "workflow-123"

        mocks = async_workflow_trigger_mocks
        mocks["dispatcher"].get_queue_name.return_value = QueuePriority.TEAM
        mocks["get_workflow"].return_value = workflow
        mocks["quota_workflow"].consume.side_effect = QuotaExceededError(
            feature="workflow",
            tenant_id="tenant-123",
            required=1,
        )

        # Act / Assert
        with pytest.raises(
            WorkflowQuotaLimitError,
            match="Workflow execution quota limit reached for tenant tenant-123",
        ):
            AsyncWorkflowService.trigger_workflow_async(
                session=session,
                user=SimpleNamespace(id="user-123"),
                trigger_data=trigger_data,
            )

        assert session.commit.call_count == 2
        updated_log = mocks["repo"].update.call_args[0][0]
        assert updated_log.status == WorkflowTriggerStatus.RATE_LIMITED
        assert "Quota limit reached" in updated_log.error
        mocks["professional_task"].delay.assert_not_called()
        mocks["team_task"].delay.assert_not_called()
        mocks["sandbox_task"].delay.assert_not_called()

    def test_should_raise_when_reinvoke_target_log_does_not_exist(self):
        """Test reinvoke_trigger error path when original trigger log is missing."""
        # Arrange
        session = MagicMock()
        repo = MagicMock()
        repo.get_by_id.return_value = None

        with patch.object(async_workflow_service_module, "SQLAlchemyWorkflowTriggerLogRepository", return_value=repo):
            # Act / Assert
            with pytest.raises(ValueError, match="Trigger log not found: missing-log"):
                AsyncWorkflowService.reinvoke_trigger(
                    session=session,
                    user=SimpleNamespace(id="user-123"),
                    workflow_trigger_log_id="missing-log",
                )

    def test_should_update_original_log_and_requeue_when_reinvoking(self):
        """Test reinvoke flow updates original log state and triggers a new async run."""
        # Arrange
        session = MagicMock()
        trigger_data = AsyncWorkflowServiceTestDataFactory.create_trigger_data()
        trigger_log = AsyncWorkflowServiceTestDataFactory.create_trigger_log_with_data(trigger_data, retry_count=1)
        repo = MagicMock()
        repo.get_by_id.return_value = trigger_log

        expected_response = AsyncTriggerResponse(
            workflow_trigger_log_id="new-trigger-log-456",
            task_id="task-456",
            status="queued",
            queue=QueuePriority.TEAM,
        )

        with (
            patch.object(async_workflow_service_module, "SQLAlchemyWorkflowTriggerLogRepository", return_value=repo),
            patch.object(
                async_workflow_service_module.AsyncWorkflowService,
                "trigger_workflow_async",
                return_value=expected_response,
            ) as mock_trigger_workflow_async,
        ):
            user = SimpleNamespace(id="user-123")

            # Act
            response = AsyncWorkflowService.reinvoke_trigger(
                session=session,
                user=user,
                workflow_trigger_log_id="trigger-log-123",
            )

        # Assert
        assert response == expected_response
        assert trigger_log.status == WorkflowTriggerStatus.RETRYING
        assert trigger_log.retry_count == 2
        assert trigger_log.error is None
        assert trigger_log.triggered_at is not None
        repo.update.assert_called_once_with(trigger_log)
        session.commit.assert_called_once()
        called_trigger_data = mock_trigger_workflow_async.call_args[0][2]
        assert isinstance(called_trigger_data, TriggerData)
        assert called_trigger_data.app_id == "app-123"

    @pytest.mark.parametrize(
        ("repo_result", "expected"),
        [
            (None, None),
            (MagicMock(), {"id": "trigger-log-123"}),
        ],
    )
    def test_should_return_trigger_log_dict_or_none(self, repo_result, expected):
        """Test get_trigger_log returns serialized log data or None."""
        # Arrange
        mock_session = MagicMock()
        mock_repo = MagicMock()
        fake_engine = MagicMock()
        mock_repo.get_by_id.return_value = repo_result
        if repo_result:
            repo_result.to_dict.return_value = expected

        mock_session_context = MagicMock()
        mock_session_context.__enter__.return_value = mock_session
        mock_session_context.__exit__.return_value = None

        with (
            patch.object(async_workflow_service_module, "db", new=SimpleNamespace(engine=fake_engine)),
            patch.object(
                async_workflow_service_module, "Session", return_value=mock_session_context
            ) as mock_session_class,
            patch.object(
                async_workflow_service_module,
                "SQLAlchemyWorkflowTriggerLogRepository",
                return_value=mock_repo,
            ),
        ):
            # Act
            result = AsyncWorkflowService.get_trigger_log("trigger-log-123", tenant_id="tenant-123")

        # Assert
        assert result == expected
        mock_session_class.assert_called_once_with(fake_engine)
        mock_repo.get_by_id.assert_called_once_with("trigger-log-123", "tenant-123")

    def test_should_return_recent_logs_as_dict_list(self):
        """Test get_recent_logs converts repository models into dictionaries."""
        # Arrange
        mock_session = MagicMock()
        mock_repo = MagicMock()
        log1 = MagicMock()
        log1.to_dict.return_value = {"id": "log-1"}
        log2 = MagicMock()
        log2.to_dict.return_value = {"id": "log-2"}
        mock_repo.get_recent_logs.return_value = [log1, log2]

        mock_session_context = MagicMock()
        mock_session_context.__enter__.return_value = mock_session
        mock_session_context.__exit__.return_value = None

        with (
            patch.object(async_workflow_service_module, "db", new=SimpleNamespace(engine=MagicMock())),
            patch.object(async_workflow_service_module, "Session", return_value=mock_session_context),
            patch.object(
                async_workflow_service_module,
                "SQLAlchemyWorkflowTriggerLogRepository",
                return_value=mock_repo,
            ),
        ):
            # Act
            result = AsyncWorkflowService.get_recent_logs(
                tenant_id="tenant-123",
                app_id="app-123",
                hours=12,
                limit=50,
                offset=10,
            )

        # Assert
        assert result == [{"id": "log-1"}, {"id": "log-2"}]
        mock_repo.get_recent_logs.assert_called_once_with(
            tenant_id="tenant-123",
            app_id="app-123",
            hours=12,
            limit=50,
            offset=10,
        )

    def test_should_return_failed_logs_for_retry_as_dict_list(self):
        """Test get_failed_logs_for_retry serializes repository logs into dicts."""
        # Arrange
        mock_session = MagicMock()
        mock_repo = MagicMock()
        log = MagicMock()
        log.to_dict.return_value = {"id": "failed-log-1"}
        mock_repo.get_failed_for_retry.return_value = [log]

        mock_session_context = MagicMock()
        mock_session_context.__enter__.return_value = mock_session
        mock_session_context.__exit__.return_value = None

        with (
            patch.object(async_workflow_service_module, "db", new=SimpleNamespace(engine=MagicMock())),
            patch.object(async_workflow_service_module, "Session", return_value=mock_session_context),
            patch.object(
                async_workflow_service_module,
                "SQLAlchemyWorkflowTriggerLogRepository",
                return_value=mock_repo,
            ),
        ):
            # Act
            result = AsyncWorkflowService.get_failed_logs_for_retry(tenant_id="tenant-123", max_retry_count=4, limit=20)

        # Assert
        assert result == [{"id": "failed-log-1"}]
        mock_repo.get_failed_for_retry.assert_called_once_with(tenant_id="tenant-123", max_retry_count=4, limit=20)


class TestAsyncWorkflowServiceGetWorkflow:
    def test_should_return_specific_workflow_when_workflow_id_exists(self):
        """Test _get_workflow returns published workflow by id when provided."""
        # Arrange
        workflow_service = MagicMock()
        app_model = MagicMock()
        workflow = MagicMock()
        workflow_service.get_published_workflow_by_id.return_value = workflow

        # Act
        result = AsyncWorkflowService._get_workflow(workflow_service, app_model, workflow_id="workflow-123")

        # Assert
        assert result == workflow
        workflow_service.get_published_workflow_by_id.assert_called_once_with(app_model, "workflow-123")
        workflow_service.get_published_workflow.assert_not_called()

    def test_should_raise_when_specific_workflow_id_not_found(self):
        """Test _get_workflow raises WorkflowNotFoundError for unknown workflow id."""
        # Arrange
        workflow_service = MagicMock()
        app_model = MagicMock()
        workflow_service.get_published_workflow_by_id.return_value = None

        # Act / Assert
        with pytest.raises(WorkflowNotFoundError, match="Published workflow not found: workflow-404"):
            AsyncWorkflowService._get_workflow(workflow_service, app_model, workflow_id="workflow-404")

    def test_should_return_default_published_workflow_when_workflow_id_not_provided(self):
        """Test _get_workflow returns default published workflow when no id is provided."""
        # Arrange
        workflow_service = MagicMock()
        app_model = MagicMock()
        app_model.id = "app-123"
        workflow = MagicMock()
        workflow_service.get_published_workflow.return_value = workflow

        # Act
        result = AsyncWorkflowService._get_workflow(workflow_service, app_model)

        # Assert
        assert result == workflow
        workflow_service.get_published_workflow.assert_called_once_with(app_model)
        workflow_service.get_published_workflow_by_id.assert_not_called()

    def test_should_raise_when_default_published_workflow_not_found(self):
        """Test _get_workflow raises WorkflowNotFoundError when app has no published workflow."""
        # Arrange
        workflow_service = MagicMock()
        app_model = MagicMock()
        app_model.id = "app-123"
        workflow_service.get_published_workflow.return_value = None

        # Act / Assert
        with pytest.raises(WorkflowNotFoundError, match="No published workflow found for app: app-123"):
            AsyncWorkflowService._get_workflow(workflow_service, app_model)
