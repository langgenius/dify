"""Unit tests for DifyAPISQLAlchemyWorkflowRunRepository implementation."""

from datetime import UTC, datetime
from unittest.mock import Mock, patch

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.enums import WorkflowExecutionStatus
from models.workflow import WorkflowPause as WorkflowPauseModel
from models.workflow import WorkflowRun
from repositories.entities.workflow_pause import WorkflowPauseEntity
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    _PrivateWorkflowPauseEntity,
    _WorkflowRunError,
)


class TestDifyAPISQLAlchemyWorkflowRunRepository:
    """Test DifyAPISQLAlchemyWorkflowRunRepository implementation."""

    @pytest.fixture
    def mock_session(self):
        """Create a mock session."""
        return Mock(spec=Session)

    @pytest.fixture
    def mock_session_maker(self, mock_session):
        """Create a mock sessionmaker."""
        session_maker = Mock(spec=sessionmaker)

        # Create a context manager mock
        context_manager = Mock()
        context_manager.__enter__ = Mock(return_value=mock_session)
        context_manager.__exit__ = Mock(return_value=None)
        session_maker.return_value = context_manager

        # Mock session.begin() context manager
        begin_context_manager = Mock()
        begin_context_manager.__enter__ = Mock(return_value=None)
        begin_context_manager.__exit__ = Mock(return_value=None)
        mock_session.begin = Mock(return_value=begin_context_manager)

        # Add missing session methods
        mock_session.commit = Mock()
        mock_session.rollback = Mock()
        mock_session.add = Mock()
        mock_session.delete = Mock()
        mock_session.get = Mock()
        mock_session.scalar = Mock()
        mock_session.scalars = Mock()

        # Also support expire_on_commit parameter
        def make_session(expire_on_commit=None):
            cm = Mock()
            cm.__enter__ = Mock(return_value=mock_session)
            cm.__exit__ = Mock(return_value=None)
            return cm

        session_maker.side_effect = make_session
        return session_maker

    @pytest.fixture
    def repository(self, mock_session_maker):
        """Create repository instance with mocked dependencies."""

        # Create a testable subclass that implements the save method
        class TestableDifyAPISQLAlchemyWorkflowRunRepository(DifyAPISQLAlchemyWorkflowRunRepository):
            def __init__(self, session_maker):
                # Initialize without calling parent __init__ to avoid any instantiation issues
                self._session_maker = session_maker

            def save(self, execution):
                """Mock implementation of save method."""
                return None

        # Create repository instance
        repo = TestableDifyAPISQLAlchemyWorkflowRunRepository(mock_session_maker)

        return repo

    @pytest.fixture
    def sample_workflow_run(self):
        """Create a sample WorkflowRun model."""
        workflow_run = Mock(spec=WorkflowRun)
        workflow_run.id = "workflow-run-123"
        workflow_run.tenant_id = "tenant-123"
        workflow_run.app_id = "app-123"
        workflow_run.workflow_id = "workflow-123"
        workflow_run.status = WorkflowExecutionStatus.RUNNING
        return workflow_run

    @pytest.fixture
    def sample_workflow_pause(self):
        """Create a sample WorkflowPauseModel."""
        pause = Mock(spec=WorkflowPauseModel)
        pause.id = "pause-123"
        pause.workflow_id = "workflow-123"
        pause.workflow_run_id = "workflow-run-123"
        pause.state_object_key = "workflow-state-123.json"
        pause.resumed_at = None
        pause.created_at = datetime.now(UTC)
        return pause


class TestGetRunsBatchByTimeRange(TestDifyAPISQLAlchemyWorkflowRunRepository):
    def test_get_runs_batch_by_time_range_filters_terminal_statuses(
        self, repository: DifyAPISQLAlchemyWorkflowRunRepository, mock_session: Mock
    ):
        scalar_result = Mock()
        scalar_result.all.return_value = []
        mock_session.scalars.return_value = scalar_result

        repository.get_runs_batch_by_time_range(
            start_from=None,
            end_before=datetime(2024, 1, 1),
            last_seen=None,
            batch_size=50,
        )

        stmt = mock_session.scalars.call_args[0][0]
        compiled_sql = str(
            stmt.compile(
                dialect=postgresql.dialect(),
                compile_kwargs={"literal_binds": True},
            )
        )

        assert "workflow_runs.status" in compiled_sql
        for status in (
            WorkflowExecutionStatus.SUCCEEDED,
            WorkflowExecutionStatus.FAILED,
            WorkflowExecutionStatus.STOPPED,
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED,
        ):
            assert f"'{status.value}'" in compiled_sql

        assert "'running'" not in compiled_sql
        assert "'paused'" not in compiled_sql


class TestCreateWorkflowPause(TestDifyAPISQLAlchemyWorkflowRunRepository):
    """Test create_workflow_pause method."""

    def test_create_workflow_pause_success(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        mock_session: Mock,
        sample_workflow_run: Mock,
    ):
        """Test successful workflow pause creation."""
        # Arrange
        workflow_run_id = "workflow-run-123"
        state_owner_user_id = "user-123"
        state = '{"test": "state"}'

        mock_session.get.return_value = sample_workflow_run

        with patch("repositories.sqlalchemy_api_workflow_run_repository.uuidv7") as mock_uuidv7:
            mock_uuidv7.side_effect = ["pause-123"]
            with patch("repositories.sqlalchemy_api_workflow_run_repository.storage") as mock_storage:
                # Act
                result = repository.create_workflow_pause(
                    workflow_run_id=workflow_run_id,
                    state_owner_user_id=state_owner_user_id,
                    state=state,
                    pause_reasons=[],
                )

                # Assert
                assert isinstance(result, _PrivateWorkflowPauseEntity)
                assert result.id == "pause-123"
                assert result.workflow_execution_id == workflow_run_id
                assert result.get_pause_reasons() == []

                # Verify database interactions
                mock_session.get.assert_called_once_with(WorkflowRun, workflow_run_id)
                mock_storage.save.assert_called_once()
                mock_session.add.assert_called()
                # When using session.begin() context manager, commit is handled automatically
                # No explicit commit call is expected

    def test_create_workflow_pause_not_found(
        self, repository: DifyAPISQLAlchemyWorkflowRunRepository, mock_session: Mock
    ):
        """Test workflow pause creation when workflow run not found."""
        # Arrange
        mock_session.get.return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="WorkflowRun not found: workflow-run-123"):
            repository.create_workflow_pause(
                workflow_run_id="workflow-run-123",
                state_owner_user_id="user-123",
                state='{"test": "state"}',
                pause_reasons=[],
            )

        mock_session.get.assert_called_once_with(WorkflowRun, "workflow-run-123")

    def test_create_workflow_pause_invalid_status(
        self, repository: DifyAPISQLAlchemyWorkflowRunRepository, mock_session: Mock, sample_workflow_run: Mock
    ):
        """Test workflow pause creation when workflow not in RUNNING status."""
        # Arrange
        sample_workflow_run.status = WorkflowExecutionStatus.PAUSED
        mock_session.get.return_value = sample_workflow_run

        # Act & Assert
        with pytest.raises(_WorkflowRunError, match="Only WorkflowRun with RUNNING status can be paused"):
            repository.create_workflow_pause(
                workflow_run_id="workflow-run-123",
                state_owner_user_id="user-123",
                state='{"test": "state"}',
                pause_reasons=[],
            )


class TestDeleteRunsWithRelated(TestDifyAPISQLAlchemyWorkflowRunRepository):
    def test_uses_trigger_log_repository(self, repository: DifyAPISQLAlchemyWorkflowRunRepository, mock_session: Mock):
        node_ids_result = Mock()
        node_ids_result.all.return_value = []
        pause_ids_result = Mock()
        pause_ids_result.all.return_value = []
        mock_session.scalars.side_effect = [node_ids_result, pause_ids_result]

        # app_logs delete, runs delete
        mock_session.execute.side_effect = [Mock(rowcount=0), Mock(rowcount=1)]

        fake_trigger_repo = Mock()
        fake_trigger_repo.delete_by_run_ids.return_value = 3

        run = Mock(id="run-1", tenant_id="t1", app_id="a1", workflow_id="w1", triggered_from="tf")
        counts = repository.delete_runs_with_related(
            [run],
            delete_node_executions=lambda session, runs: (2, 1),
            delete_trigger_logs=lambda session, run_ids: fake_trigger_repo.delete_by_run_ids(run_ids),
        )

        fake_trigger_repo.delete_by_run_ids.assert_called_once_with(["run-1"])
        assert counts["node_executions"] == 2
        assert counts["offloads"] == 1
        assert counts["trigger_logs"] == 3
        assert counts["runs"] == 1


class TestCountRunsWithRelated(TestDifyAPISQLAlchemyWorkflowRunRepository):
    def test_uses_trigger_log_repository(self, repository: DifyAPISQLAlchemyWorkflowRunRepository, mock_session: Mock):
        pause_ids_result = Mock()
        pause_ids_result.all.return_value = ["pause-1", "pause-2"]
        mock_session.scalars.return_value = pause_ids_result
        mock_session.scalar.side_effect = [5, 2]

        fake_trigger_repo = Mock()
        fake_trigger_repo.count_by_run_ids.return_value = 3

        run = Mock(id="run-1", tenant_id="t1", app_id="a1", workflow_id="w1", triggered_from="tf")
        counts = repository.count_runs_with_related(
            [run],
            count_node_executions=lambda session, runs: (2, 1),
            count_trigger_logs=lambda session, run_ids: fake_trigger_repo.count_by_run_ids(run_ids),
        )

        fake_trigger_repo.count_by_run_ids.assert_called_once_with(["run-1"])
        assert counts["node_executions"] == 2
        assert counts["offloads"] == 1
        assert counts["trigger_logs"] == 3
        assert counts["app_logs"] == 5
        assert counts["pauses"] == 2
        assert counts["pause_reasons"] == 2
        assert counts["runs"] == 1


class TestResumeWorkflowPause(TestDifyAPISQLAlchemyWorkflowRunRepository):
    """Test resume_workflow_pause method."""

    def test_resume_workflow_pause_success(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        mock_session: Mock,
        sample_workflow_run: Mock,
        sample_workflow_pause: Mock,
    ):
        """Test successful workflow pause resume."""
        # Arrange
        workflow_run_id = "workflow-run-123"
        pause_entity = Mock(spec=WorkflowPauseEntity)
        pause_entity.id = "pause-123"

        # Setup workflow run and pause
        sample_workflow_run.status = WorkflowExecutionStatus.PAUSED
        sample_workflow_run.pause = sample_workflow_pause
        sample_workflow_pause.resumed_at = None

        mock_session.scalar.return_value = sample_workflow_run

        with patch("repositories.sqlalchemy_api_workflow_run_repository.naive_utc_now") as mock_now:
            mock_now.return_value = datetime.now(UTC)

            # Act
            result = repository.resume_workflow_pause(
                workflow_run_id=workflow_run_id,
                pause_entity=pause_entity,
            )

            # Assert
            assert isinstance(result, _PrivateWorkflowPauseEntity)
            assert result.id == "pause-123"

            # Verify state transitions
            assert sample_workflow_pause.resumed_at is not None
            assert sample_workflow_run.status == WorkflowExecutionStatus.RUNNING

            # Verify database interactions
            mock_session.add.assert_called()
            # When using session.begin() context manager, commit is handled automatically
            # No explicit commit call is expected

    def test_resume_workflow_pause_not_paused(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        mock_session: Mock,
        sample_workflow_run: Mock,
    ):
        """Test resume when workflow is not paused."""
        # Arrange
        workflow_run_id = "workflow-run-123"
        pause_entity = Mock(spec=WorkflowPauseEntity)
        pause_entity.id = "pause-123"

        sample_workflow_run.status = WorkflowExecutionStatus.RUNNING
        mock_session.scalar.return_value = sample_workflow_run

        # Act & Assert
        with pytest.raises(_WorkflowRunError, match="WorkflowRun is not in PAUSED status"):
            repository.resume_workflow_pause(
                workflow_run_id=workflow_run_id,
                pause_entity=pause_entity,
            )

    def test_resume_workflow_pause_id_mismatch(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        mock_session: Mock,
        sample_workflow_run: Mock,
        sample_workflow_pause: Mock,
    ):
        """Test resume when pause ID doesn't match."""
        # Arrange
        workflow_run_id = "workflow-run-123"
        pause_entity = Mock(spec=WorkflowPauseEntity)
        pause_entity.id = "pause-456"  # Different ID

        sample_workflow_run.status = WorkflowExecutionStatus.PAUSED
        sample_workflow_pause.id = "pause-123"
        sample_workflow_run.pause = sample_workflow_pause
        mock_session.scalar.return_value = sample_workflow_run

        # Act & Assert
        with pytest.raises(_WorkflowRunError, match="different id in WorkflowPause and WorkflowPauseEntity"):
            repository.resume_workflow_pause(
                workflow_run_id=workflow_run_id,
                pause_entity=pause_entity,
            )


class TestDeleteWorkflowPause(TestDifyAPISQLAlchemyWorkflowRunRepository):
    """Test delete_workflow_pause method."""

    def test_delete_workflow_pause_success(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        mock_session: Mock,
        sample_workflow_pause: Mock,
    ):
        """Test successful workflow pause deletion."""
        # Arrange
        pause_entity = Mock(spec=WorkflowPauseEntity)
        pause_entity.id = "pause-123"

        mock_session.get.return_value = sample_workflow_pause

        with patch("repositories.sqlalchemy_api_workflow_run_repository.storage") as mock_storage:
            # Act
            repository.delete_workflow_pause(pause_entity=pause_entity)

            # Assert
            mock_storage.delete.assert_called_once_with(sample_workflow_pause.state_object_key)
            mock_session.delete.assert_called_once_with(sample_workflow_pause)
            # When using session.begin() context manager, commit is handled automatically
            # No explicit commit call is expected

    def test_delete_workflow_pause_not_found(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        mock_session: Mock,
    ):
        """Test delete when pause not found."""
        # Arrange
        pause_entity = Mock(spec=WorkflowPauseEntity)
        pause_entity.id = "pause-123"

        mock_session.get.return_value = None

        # Act & Assert
        with pytest.raises(_WorkflowRunError, match="WorkflowPause not found: pause-123"):
            repository.delete_workflow_pause(pause_entity=pause_entity)


class TestPrivateWorkflowPauseEntity(TestDifyAPISQLAlchemyWorkflowRunRepository):
    """Test _PrivateWorkflowPauseEntity class."""

    def test_properties(self, sample_workflow_pause: Mock):
        """Test entity properties."""
        # Arrange
        entity = _PrivateWorkflowPauseEntity(pause_model=sample_workflow_pause, reason_models=[], human_input_form=[])

        # Act & Assert
        assert entity.id == sample_workflow_pause.id
        assert entity.workflow_execution_id == sample_workflow_pause.workflow_run_id
        assert entity.resumed_at == sample_workflow_pause.resumed_at

    def test_get_state(self, sample_workflow_pause: Mock):
        """Test getting state from storage."""
        # Arrange
        entity = _PrivateWorkflowPauseEntity(pause_model=sample_workflow_pause, reason_models=[], human_input_form=[])
        expected_state = b'{"test": "state"}'

        with patch("repositories.sqlalchemy_api_workflow_run_repository.storage") as mock_storage:
            mock_storage.load.return_value = expected_state

            # Act
            result = entity.get_state()

            # Assert
            assert result == expected_state
            mock_storage.load.assert_called_once_with(sample_workflow_pause.state_object_key)

    def test_get_state_caching(self, sample_workflow_pause: Mock):
        """Test state caching in get_state method."""
        # Arrange
        entity = _PrivateWorkflowPauseEntity(pause_model=sample_workflow_pause, reason_models=[], human_input_form=[])
        expected_state = b'{"test": "state"}'

        with patch("repositories.sqlalchemy_api_workflow_run_repository.storage") as mock_storage:
            mock_storage.load.return_value = expected_state

            # Act
            result1 = entity.get_state()
            result2 = entity.get_state()  # Should use cache

            # Assert
            assert result1 == expected_state
            assert result2 == expected_state
            mock_storage.load.assert_called_once()  # Only called once due to caching
