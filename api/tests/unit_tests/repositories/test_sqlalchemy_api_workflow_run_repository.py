"""Unit tests for DifyAPISQLAlchemyWorkflowRunRepository implementation."""

from datetime import UTC, datetime
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.entities.workflow_pause import WorkflowPauseEntity
from core.workflow.enums import WorkflowExecutionStatus
from models.model import UploadFile
from models.workflow import WorkflowPause as WorkflowPauseModel
from models.workflow import WorkflowRun
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    _PrivateWorkflowPauseEntity,
    _WorkflowRunError,
)
from services.file_service import FileService


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

        # Create a mock file service with properly configured methods
        mock_file_service = MagicMock(spec=FileService)
        mock_file_service.upload_text = MagicMock(return_value=Mock(spec=UploadFile))
        mock_file_service.delete_file = MagicMock()
        mock_file_service.download_text = MagicMock(return_value='{"test": "state"}')

        # Create a testable subclass that implements the save method
        class TestableDifyAPISQLAlchemyWorkflowRunRepository(DifyAPISQLAlchemyWorkflowRunRepository):
            def __init__(self, session_maker, file_service):
                # Initialize without calling parent __init__ to avoid FileService instantiation
                self._session_maker = session_maker
                self._file_service = file_service

            def save(self, execution):
                """Mock implementation of save method."""
                return None

        with patch("repositories.sqlalchemy_api_workflow_run_repository.FileService"):
            # Create repository instance
            repo = TestableDifyAPISQLAlchemyWorkflowRunRepository(mock_session_maker, mock_file_service)

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
        workflow_run.pause_id = None
        return workflow_run

    @pytest.fixture
    def sample_upload_file(self):
        """Create a sample UploadFile model."""
        upload_file = Mock(spec=UploadFile)
        upload_file.id = "file-123"
        upload_file.key = "upload_files/tenant-123/file-123.txt"
        upload_file.name = "workflow-state-123.txt"
        upload_file.size = 100
        upload_file.extension = "txt"
        upload_file.mime_type = "text/plain"
        return upload_file

    @pytest.fixture
    def sample_workflow_pause(self, sample_upload_file):
        """Create a sample WorkflowPauseModel."""
        pause = Mock(spec=WorkflowPauseModel)
        pause.id = "pause-123"
        pause.tenant_id = "tenant-123"
        pause.app_id = "app-123"
        pause.workflow_id = "workflow-123"
        pause.workflow_run_id = "workflow-run-123"
        pause.state_file_id = "file-123"
        pause.state_file = sample_upload_file
        pause.resumed_at = None
        pause.created_at = datetime.now(UTC)
        return pause


class TestCreateWorkflowPause(TestDifyAPISQLAlchemyWorkflowRunRepository):
    """Test create_workflow_pause method."""

    def test_create_workflow_pause_success(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        mock_session: Mock,
        sample_workflow_run: Mock,
        sample_upload_file: Mock,
    ):
        """Test successful workflow pause creation."""
        # Arrange
        workflow_run_id = "workflow-run-123"
        state_owner_user_id = "user-123"
        state = '{"test": "state"}'

        mock_session.get.return_value = sample_workflow_run
        repository._file_service.upload_text.return_value = sample_upload_file

        with patch("repositories.sqlalchemy_api_workflow_run_repository.uuidv7") as mock_uuidv7:
            mock_uuidv7.side_effect = ["workflow-state-123", "pause-123"]

            # Act
            result = repository.create_workflow_pause(
                workflow_run_id=workflow_run_id,
                state_owner_user_id=state_owner_user_id,
                state=state,
            )

            # Assert
            assert isinstance(result, _PrivateWorkflowPauseEntity)
            assert result.id == "pause-123"
            assert result.workflow_execution_id == workflow_run_id

            # Verify database interactions
            mock_session.get.assert_called_once_with(WorkflowRun, workflow_run_id)
            repository._file_service.upload_text.assert_called_once_with(
                text=state,
                text_name="workflow-state-workflow-state-123",
                user_id=state_owner_user_id,
                tenant_id=sample_workflow_run.tenant_id,
            )
            mock_session.add.assert_called()
            # When using session.begin() context manager, commit is handled automatically
            # No explicit commit call is expected

    def test_create_workflow_pause_not_found(
        self, repository: DifyAPISQLAlchemyWorkflowRunRepository, mock_session: Mock
    ):
        """Test workflow pause creation when workflow run not found."""
        # Arrange
        mock_session.get.return_value = None
        repository._file_service.upload_text.return_value = Mock(spec=UploadFile)

        # Act & Assert
        with pytest.raises(ValueError, match="WorkflowRun not found: workflow-run-123"):
            repository.create_workflow_pause(
                workflow_run_id="workflow-run-123",
                state_owner_user_id="user-123",
                state='{"test": "state"}',
            )

        mock_session.get.assert_called_once_with(WorkflowRun, "workflow-run-123")
        repository._file_service.upload_text.assert_not_called()

    def test_create_workflow_pause_invalid_status(
        self, repository: DifyAPISQLAlchemyWorkflowRunRepository, mock_session: Mock, sample_workflow_run: Mock
    ):
        """Test workflow pause creation when workflow not in RUNNING status."""
        # Arrange
        sample_workflow_run.status = WorkflowExecutionStatus.PAUSED
        mock_session.get.return_value = sample_workflow_run
        repository._file_service.upload_text.return_value = Mock(spec=UploadFile)

        # Act & Assert
        with pytest.raises(_WorkflowRunError, match="Only WorkflowRun with RUNNING status can be paused"):
            repository.create_workflow_pause(
                workflow_run_id="workflow-run-123",
                state_owner_user_id="user-123",
                state='{"test": "state"}',
            )


class TestResumeWorkflowPause(TestDifyAPISQLAlchemyWorkflowRunRepository):
    """Test resume_workflow_pause method."""

    def test_resume_workflow_pause_success(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        mock_session: Mock,
        sample_workflow_run: Mock,
        sample_workflow_pause: Mock,
        sample_upload_file: Mock,
    ):
        """Test successful workflow pause resume."""
        # Arrange
        workflow_run_id = "workflow-run-123"
        pause_entity = Mock(spec=WorkflowPauseEntity)
        pause_entity.id = "pause-123"

        # Setup workflow run and pause
        sample_workflow_run.status = WorkflowExecutionStatus.PAUSED
        sample_workflow_run.pause_id = "pause-123"
        sample_workflow_run.pause = sample_workflow_pause
        sample_workflow_pause.resumed_at = None

        mock_session.scalar.return_value = sample_workflow_run
        mock_session.get.return_value = sample_upload_file

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
            assert sample_workflow_run.pause_id is None

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

    def test_resume_workflow_pause_pause_id_mismatch(
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
        sample_workflow_run.pause_id = "pause-123"
        sample_workflow_run.pause = sample_workflow_pause
        mock_session.scalar.return_value = sample_workflow_run

        # Act & Assert
        with pytest.raises(_WorkflowRunError, match="different id in WorkflowRun and WorkflowPauseEntity"):
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

        # Act
        repository.delete_workflow_pause(pause_entity=pause_entity)

        # Assert
        repository._file_service.delete_file.assert_called_once_with(sample_workflow_pause.state_file_id)
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

        repository._file_service.delete_file.assert_not_called()


class TestGetWorkflowCurrentPause(TestDifyAPISQLAlchemyWorkflowRunRepository):
    """Test get_workflow_current_pause method."""

    def test_get_workflow_current_pause_found(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        mock_session: Mock,
        sample_workflow_pause: Mock,
        sample_upload_file: Mock,
    ):
        """Test getting current pause when it exists."""
        # Arrange
        workflow_id = "workflow-123"

        mock_session.scalar.return_value = sample_workflow_pause

        # Act
        result = repository.get_workflow_current_pause(workflow_id=workflow_id)

        # Assert
        assert isinstance(result, _PrivateWorkflowPauseEntity)
        assert result.id == sample_workflow_pause.id

    def test_get_workflow_current_pause_not_found(
        self,
        repository: DifyAPISQLAlchemyWorkflowRunRepository,
        mock_session: Mock,
    ):
        """Test getting current pause when none exists."""
        # Arrange
        workflow_id = "workflow-123"

        mock_session.scalar.return_value = None

        # Act
        result = repository.get_workflow_current_pause(workflow_id=workflow_id)

        # Assert
        assert result is None


class TestPrivateWorkflowPauseEntity(TestDifyAPISQLAlchemyWorkflowRunRepository):
    """Test _PrivateWorkflowPauseEntity class."""

    def test_from_models(self, sample_workflow_pause: Mock, sample_upload_file: Mock):
        """Test creating _PrivateWorkflowPauseEntity from models."""
        # Act
        entity = _PrivateWorkflowPauseEntity.from_models(sample_workflow_pause, sample_upload_file)

        # Assert
        assert isinstance(entity, _PrivateWorkflowPauseEntity)
        assert entity._pause_model == sample_workflow_pause
        assert entity._state_file == sample_upload_file

    def test_properties(self, sample_workflow_pause: Mock, sample_upload_file: Mock):
        """Test entity properties."""
        # Arrange
        entity = _PrivateWorkflowPauseEntity.from_models(sample_workflow_pause, sample_upload_file)

        # Act & Assert
        assert entity.id == sample_workflow_pause.id
        assert entity.workflow_execution_id == sample_workflow_pause.workflow_run_id
        assert entity.resumed_at == sample_workflow_pause.resumed_at

    def test_get_state(self, sample_workflow_pause: Mock, sample_upload_file: Mock):
        """Test getting state from storage."""
        # Arrange
        entity = _PrivateWorkflowPauseEntity.from_models(sample_workflow_pause, sample_upload_file)
        expected_state = b'{"test": "state"}'

        with patch("repositories.sqlalchemy_api_workflow_run_repository.storage") as mock_storage:
            mock_storage.load.return_value = expected_state

            # Act
            result = entity.get_state()

            # Assert
            assert result == expected_state
            mock_storage.load.assert_called_once_with(sample_upload_file.key)

    def test_get_state_caching(self, sample_workflow_pause: Mock, sample_upload_file: Mock):
        """Test state caching in get_state method."""
        # Arrange
        entity = _PrivateWorkflowPauseEntity.from_models(sample_workflow_pause, sample_upload_file)
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
