"""Comprehensive unit tests for WorkflowRunService class.

This test suite covers all pause state management operations including:
- Retrieving pause state for workflow runs
- Saving pause state with file uploads
- Marking paused workflows as resumed
- Error handling and edge cases
- Database transaction management
- Repository-based approach testing
"""

import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock, create_autospec, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.workflow.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.sqlalchemy_api_workflow_run_repository import _PrivateWorkflowPauseEntity
from services.workflow_run_service import (
    WorkflowRunService,
    _InvalidStateTransitionError,
    _StateFileNotExistError,
    _WorkflowRunNotFoundError,
)


class TestDataFactory:
    """Factory class for creating test data objects."""

    @staticmethod
    def create_workflow_run_mock(
        id: str = "workflow-run-123",
        tenant_id: str = "tenant-456",
        app_id: str = "app-789",
        workflow_id: str = "workflow-101",
        status: str | WorkflowExecutionStatus = "paused",
        pause_id: str | None = None,
        **kwargs,
    ) -> MagicMock:
        """Create a mock WorkflowRun object."""
        mock_run = MagicMock()
        mock_run.id = id
        mock_run.tenant_id = tenant_id
        mock_run.app_id = app_id
        mock_run.workflow_id = workflow_id
        mock_run.status = status
        mock_run.pause_id = pause_id

        for key, value in kwargs.items():
            setattr(mock_run, key, value)

        return mock_run

    @staticmethod
    def create_workflow_pause_mock(
        id: str = "pause-123",
        tenant_id: str = "tenant-456",
        app_id: str = "app-789",
        workflow_id: str = "workflow-101",
        workflow_execution_id: str = "workflow-execution-123",
        state_file_id: str = "file-456",
        resumed_at: datetime | None = None,
        **kwargs,
    ) -> MagicMock:
        """Create a mock WorkflowPauseModel object."""
        mock_pause = MagicMock()
        mock_pause.id = id
        mock_pause.tenant_id = tenant_id
        mock_pause.app_id = app_id
        mock_pause.workflow_id = workflow_id
        mock_pause.workflow_execution_id = workflow_execution_id
        mock_pause.state_file_id = state_file_id
        mock_pause.resumed_at = resumed_at

        for key, value in kwargs.items():
            setattr(mock_pause, key, value)

        return mock_pause

    @staticmethod
    def create_upload_file_mock(
        id: str = "file-456",
        key: str = "upload_files/test/state.json",
        name: str = "state.json",
        tenant_id: str = "tenant-456",
        **kwargs,
    ) -> MagicMock:
        """Create a mock UploadFile object."""
        mock_file = MagicMock()
        mock_file.id = id
        mock_file.key = key
        mock_file.name = name
        mock_file.tenant_id = tenant_id

        for key, value in kwargs.items():
            setattr(mock_file, key, value)

        return mock_file

    @staticmethod
    def create_pause_entity_mock(
        pause_model: MagicMock | None = None,
        upload_file: MagicMock | None = None,
    ) -> _PrivateWorkflowPauseEntity:
        """Create a mock _PrivateWorkflowPauseEntity object."""
        if pause_model is None:
            pause_model = TestDataFactory.create_workflow_pause_mock()
        if upload_file is None:
            upload_file = TestDataFactory.create_upload_file_mock()

        return _PrivateWorkflowPauseEntity.from_models(pause_model, upload_file)


class TestWorkflowRunService:
    """Comprehensive unit tests for WorkflowRunService class."""

    @pytest.fixture
    def mock_session_factory(self):
        """Create a mock session factory with proper session management."""
        mock_session = create_autospec(Session)

        # Create a mock context manager for the session
        mock_session_cm = MagicMock()
        mock_session_cm.__enter__ = MagicMock(return_value=mock_session)
        mock_session_cm.__exit__ = MagicMock(return_value=None)

        # Create a mock context manager for the transaction
        mock_transaction_cm = MagicMock()
        mock_transaction_cm.__enter__ = MagicMock(return_value=mock_session)
        mock_transaction_cm.__exit__ = MagicMock(return_value=None)

        mock_session.begin = MagicMock(return_value=mock_transaction_cm)

        # Create mock factory that returns the context manager
        mock_factory = MagicMock()
        mock_factory.return_value = mock_session_cm

        return mock_factory, mock_session

    @pytest.fixture
    def mock_workflow_run_repository(self):
        """Create a mock APIWorkflowRunRepository."""
        mock_repo = create_autospec(APIWorkflowRunRepository)
        return mock_repo

    @pytest.fixture
    def workflow_run_service(self, mock_session_factory, mock_workflow_run_repository):
        """Create WorkflowRunService instance with mocked dependencies."""
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory") as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            service = WorkflowRunService(session_factory)
            return service

    @pytest.fixture
    def workflow_run_service_with_engine(self, mock_session_factory, mock_workflow_run_repository):
        """Create WorkflowRunService instance with Engine input."""
        mock_engine = create_autospec(Engine)
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory") as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            service = WorkflowRunService(mock_engine)
            return service

    # ==================== Initialization Tests ====================

    def test_init_with_session_factory(self, mock_session_factory, mock_workflow_run_repository):
        """Test WorkflowRunService initialization with session_factory."""
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory") as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            service = WorkflowRunService(session_factory)

            assert service._session_factory == session_factory
            mock_factory.create_api_workflow_run_repository.assert_called_once_with(session_factory)

    def test_init_with_engine(self, mock_session_factory, mock_workflow_run_repository):
        """Test WorkflowRunService initialization with Engine (should convert to sessionmaker)."""
        mock_engine = create_autospec(Engine)
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.DifyAPIRepositoryFactory") as mock_factory:
            mock_factory.create_api_workflow_run_repository.return_value = mock_workflow_run_repository
            with patch("services.workflow_run_service.sessionmaker", return_value=session_factory) as mock_sessionmaker:
                service = WorkflowRunService(mock_engine)

                mock_sessionmaker.assert_called_once_with(bind=mock_engine, expire_on_commit=False)
                assert service._session_factory == session_factory
                mock_factory.create_api_workflow_run_repository.assert_called_once_with(session_factory)

    def test_init_with_default_dependencies(self, mock_session_factory):
        """Test WorkflowRunService initialization with default dependencies."""
        session_factory, _ = mock_session_factory

        service = WorkflowRunService(session_factory)

        assert service._session_factory == session_factory

    # ==================== get_pause_state Tests ====================

    def test_get_pause_state_workflow_not_found(self, workflow_run_service, mock_workflow_run_repository):
        """Test get_pause_state when workflow run is not found."""
        # Setup repository to raise ValueError
        mock_workflow_run_repository.get_workflow_pause.side_effect = ValueError(
            "WorkflowRun not found: non-existent-run"
        )

        # Execute test and verify exception
        with pytest.raises(_WorkflowRunNotFoundError) as exc_info:
            workflow_run_service.get_pause_state("non-existent-run")

        assert "WorkflowRun not found: non-existent-run" in str(exc_info.value)
        mock_workflow_run_repository.get_workflow_pause.assert_called_once_with("non-existent-run")

    def test_get_pause_state_no_pause_state(self, workflow_run_service, mock_workflow_run_repository):
        """Test get_pause_state when workflow run has no pause state."""
        # Setup repository to return None
        mock_workflow_run_repository.get_workflow_current_pause.return_value = None

        # Execute test
        result = workflow_run_service.get_pause_state("workflow-run-123")

        # Verify result is None
        assert result is None
        mock_workflow_run_repository.get_workflow_pause.assert_called_once_with("workflow-run-123")

    def test_get_pause_state_state_file_not_exists(self, workflow_run_service, mock_workflow_run_repository):
        """Test get_pause_state when state file is missing."""
        # Setup repository to raise RuntimeError
        mock_workflow_run_repository.get_workflow_current_pause.side_effect = RuntimeError("StateFile not exists")

        # Execute test and verify exception
        with pytest.raises(_StateFileNotExistError) as exc_info:
            workflow_run_service.get_pause_state("workflow-run-123")

        assert "StateFile not exists" in str(exc_info.value)
        mock_workflow_run_repository.get_workflow_pause.assert_called_once_with("workflow-run-123")

    # ==================== save_pause_state Tests ====================

    def test_save_pause_state_success(self, workflow_run_service, mock_workflow_run_repository):
        """Test save_pause_state successfully creates pause state."""
        # Setup test data
        workflow_run = TestDataFactory.create_workflow_run_mock(status="running", id="run-123")
        test_state = json.dumps({"test": "state"})
        expected_entity = TestDataFactory.create_pause_entity_mock()

        # Setup repository mock
        mock_workflow_run_repository.create_workflow_pause.return_value = expected_entity

        # Execute test
        result = workflow_run_service.save_pause_state(workflow_run, "user-456", test_state)

        # Verify result and repository call
        assert result == expected_entity
        mock_workflow_run_repository.create_workflow_pause.assert_called_once_with(
            workflow_run_id="run-123", state_owner_user_id="user-456", state=test_state
        )

    def test_save_pause_state_workflow_not_found(self, workflow_run_service, mock_workflow_run_repository):
        """Test save_pause_state when workflow run is not found."""
        # Setup test data
        workflow_run = TestDataFactory.create_workflow_run_mock(status="running", id="run-123")
        test_state = json.dumps({"test": "state"})

        # Setup repository to raise ValueError
        mock_workflow_run_repository.create_workflow_pause.side_effect = ValueError("WorkflowRun not found")

        # Execute test and verify exception
        with pytest.raises(_InvalidStateTransitionError) as exc_info:
            workflow_run_service.save_pause_state(workflow_run, "user-456", test_state)

        assert "WorkflowRun not found" in str(exc_info.value)
        mock_workflow_run_repository.create_workflow_pause.assert_called_once_with(
            workflow_run_id="run-123", state_owner_user_id="user-456", state=test_state
        )

    def test_save_pause_state_invalid_status(self, workflow_run_service, mock_workflow_run_repository):
        """Test save_pause_state when workflow is not in running status."""
        # Setup test data
        workflow_run = TestDataFactory.create_workflow_run_mock(status="completed", id="run-123")
        test_state = json.dumps({"test": "state"})

        # Setup repository to raise RuntimeError
        mock_workflow_run_repository.create_workflow_pause.side_effect = RuntimeError(
            "Only RUNNING status can be paused"
        )

        # Execute test and verify exception
        with pytest.raises(_InvalidStateTransitionError) as exc_info:
            workflow_run_service.save_pause_state(workflow_run, "user-456", test_state)

        assert "Only RUNNING status can be paused" in str(exc_info.value)

    # ==================== mark_as_resumed Tests ====================

    def test_resume_workflow_pause_success(self, workflow_run_service, mock_workflow_run_repository):
        """Test resume_workflow_pause successfully resumes a paused workflow."""
        # Setup test data
        pause_entity = TestDataFactory.create_pause_entity_mock()
        pause_entity.workflow_execution_id = "run-123"
        workflow_run = TestDataFactory.create_workflow_run_mock(status=WorkflowExecutionStatus.RUNNING, pause_id=None)

        # Setup repository mocks
        mock_workflow_run_repository.resume_workflow_pause.return_value = pause_entity
        with patch.object(workflow_run_service, "get_workflow_run_by_id_direct", return_value=workflow_run):
            # Execute test
            result = workflow_run_service.resume_workflow_pause("run-123", pause_entity)

            # Verify result and repository calls
            assert result == workflow_run
            mock_workflow_run_repository.resume_workflow_pause.assert_called_once_with("run-123", pause_entity)
            workflow_run_service.get_workflow_run_by_id_direct.assert_called_once_with("run-123")

    def test_mark_as_resumed_workflow_not_found(self, workflow_run_service, mock_workflow_run_repository):
        """Test mark_as_resumed when workflow run is not found."""
        # Setup test data
        pause_entity = TestDataFactory.create_pause_entity_mock()
        pause_entity.workflow_execution_id = "run-123"

        # Setup repository mocks
        mock_workflow_run_repository.resume_workflow_pause.return_value = pause_entity
        with patch.object(workflow_run_service, "get_workflow_run_by_id_direct", return_value=None):
            # Execute test and verify exception
            with pytest.raises(_WorkflowRunNotFoundError) as exc_info:
                workflow_run_service.mark_as_resumed(pause_entity)

            assert "WorkflowRun not found for pause" in str(exc_info.value)

        mock_workflow_run_repository.resume_workflow_pause.assert_called_once_with("run-123", pause_entity)

    def test_mark_as_resumed_invalid_state_transition(self, workflow_run_service, mock_workflow_run_repository):
        """Test mark_as_resumed when workflow is not in proper state."""
        # Setup test data
        pause_entity = TestDataFactory.create_pause_entity_mock()
        pause_entity.workflow_execution_id = "run-123"
        workflow_run = TestDataFactory.create_workflow_run_mock(status="completed", pause_id="pause-123")

        # Setup repository mocks
        mock_workflow_run_repository.resume_workflow_pause.return_value = pause_entity
        with patch.object(workflow_run_service, "get_workflow_run_by_id_direct", return_value=workflow_run):
            # Execute test and verify exception
            with pytest.raises(_InvalidStateTransitionError) as exc_info:
                workflow_run_service.mark_as_resumed(pause_entity)

            assert "Workflow is not in paused status" in str(exc_info.value)

        mock_workflow_run_repository.resume_workflow_pause.assert_called_once_with("run-123", pause_entity)

    # ==================== delete_workflow_pause Tests ====================

    def test_delete_workflow_pause_success(self, workflow_run_service, mock_workflow_run_repository):
        """Test delete_workflow_pause successfully deletes a pause state."""
        # Setup test data
        pause_entity = TestDataFactory.create_pause_entity_mock()
        pause_entity.workflow_execution_id = "run-123"

        # Setup repository mock
        mock_workflow_run_repository.delete_workflow_pause.return_value = None

        # Execute test
        result = workflow_run_service.delete_workflow_pause(pause_entity)

        # Verify result and repository call
        assert result is None
        mock_workflow_run_repository.delete_workflow_pause.assert_called_once_with(pause_entity)

    def test_delete_workflow_pause_not_found(self, workflow_run_service, mock_workflow_run_repository):
        """Test delete_workflow_pause when pause is not found."""
        # Setup test data
        pause_entity = TestDataFactory.create_pause_entity_mock()
        pause_entity.workflow_execution_id = "run-123"

        # Setup repository to raise ValueError
        mock_workflow_run_repository.delete_workflow_pause.side_effect = ValueError("WorkflowPause not found")

        # Execute test and verify exception
        with pytest.raises(ValueError, match="WorkflowPause not found"):
            workflow_run_service.delete_workflow_pause(pause_entity)

        mock_workflow_run_repository.delete_workflow_pause.assert_called_once_with(pause_entity)

    def test_mark_as_resumed_workflow_not_found(self, workflow_run_service, mock_workflow_run_repository):
        """Test mark_as_resumed when workflow run is not found."""
        # Setup test data
        pause_entity = TestDataFactory.create_pause_entity_mock()
        pause_entity.workflow_execution_id = "run-123"

        # Setup repository mocks
        mock_workflow_run_repository.resume_workflow_pause.return_value = pause_entity
        with patch.object(workflow_run_service, "get_workflow_run_by_id_direct", return_value=None):
            # Execute test and verify exception
            with pytest.raises(_WorkflowRunNotFoundError) as exc_info:
                workflow_run_service.mark_as_resumed(pause_entity)

            assert "WorkflowRun not found for pause" in str(exc_info.value)

    def test_mark_as_resumed_invalid_state_transition(self, workflow_run_service, mock_workflow_run_repository):
        """Test mark_as_resumed when workflow is not in proper state."""
        # Setup test data
        pause_entity = TestDataFactory.create_pause_entity_mock()
        pause_entity.workflow_execution_id = "run-123"

        # Setup repository to raise RuntimeError
        mock_workflow_run_repository.resume_workflow_pause.side_effect = RuntimeError("Workflow is not paused")

        # Execute test and verify exception
        with pytest.raises(_InvalidStateTransitionError) as exc_info:
            workflow_run_service.mark_as_resumed(pause_entity)

        assert "Workflow is not paused" in str(exc_info.value)

    # ==================== Edge Cases Tests ====================

    def test_mark_as_resumed_with_already_resumed_entity(self, workflow_run_service, mock_workflow_run_repository):
        """Test mark_as_resumed with entity that was already resumed."""
        # Setup test data - pause entity already has resumed_at
        past_time = naive_utc_now()
        pause_model = TestDataFactory.create_workflow_pause_mock(resumed_at=past_time)
        pause_entity = TestDataFactory.create_pause_entity_mock(pause_model)
        pause_entity.workflow_execution_id = "run-123"

        # Setup repository to raise RuntimeError
        mock_workflow_run_repository.resume_workflow_pause.side_effect = RuntimeError(
            "Cannot resume already resumed pause"
        )

        # Execute test and verify exception
        with pytest.raises(_InvalidStateTransitionError) as exc_info:
            workflow_run_service.mark_as_resumed(pause_entity)

        assert "Cannot resume already resumed pause" in str(exc_info.value)


class TestWorkflowPauseEntity:
    """
    Comprehensive unit tests for WorkflowPauseEntity class.

    This test suite covers all WorkflowPauseEntity operations including:
    - Constructor initialization with model and upload_file
    - Property accessors (id, workflow_id)
    - State retrieval with various content types
    - UTF-8 encoding/decoding behavior
    - Error handling for storage operations
    """

    # ==================== Constructor Tests ====================

    def test_constructor_with_valid_parameters(self):
        """Test constructor with different model parameter values."""
        # Arrange
        mock_model = TestDataFactory.create_workflow_pause_mock(
            id="different-pause-id", workflow_id="different-workflow-id", workflow_execution_id="different-execution-id"
        )
        mock_upload_file = TestDataFactory.create_upload_file_mock(
            id="different-file-id", key="different/path/state.json"
        )

        # Act
        entity = _PrivateWorkflowPauseEntity.from_models(mock_model, mock_upload_file)

        # Assert
        assert entity.id == "different-pause-id"
        assert entity.workflow_id == "different-workflow-id"
        assert entity.workflow_execution_id == "different-execution-id"
        assert entity.state_file_id == "different-file-id"
        assert entity.state_file_key == "different/path/state.json"

    # ==================== Property Tests ====================

    def test_id_property_returns_correct_value(self):
        """Test id property returns the correct value from the model."""
        # Arrange
        expected_id = "pause-123"
        mock_model = TestDataFactory.create_workflow_pause_mock(id=expected_id)
        mock_upload_file = TestDataFactory.create_upload_file_mock()
        entity = _PrivateWorkflowPauseEntity.from_models(mock_model, mock_upload_file)

        # Act
        result_id = entity.id

        # Assert
        assert result_id == expected_id
        assert result_id == mock_model.id

    def test_workflow_id_property_returns_correct_value(self):
        """Test workflow_id property returns the correct value from the model."""
        # Arrange
        expected_workflow_id = "workflow-456"
        mock_model = TestDataFactory.create_workflow_pause_mock(workflow_id=expected_workflow_id)
        mock_upload_file = TestDataFactory.create_upload_file_mock()
        entity = _PrivateWorkflowPauseEntity.from_models(mock_model, mock_upload_file)

        # Act
        result_workflow_id = entity.workflow_id

        # Assert
        assert result_workflow_id == expected_workflow_id
        assert result_workflow_id == mock_model.workflow_id

    def test_workflow_execution_id_property_returns_correct_value(self):
        """Test workflow_execution_id property returns the correct value from the model."""
        # Arrange
        expected_workflow_execution_id = "workflow-run-789"
        mock_model = TestDataFactory.create_workflow_pause_mock(workflow_execution_id=expected_workflow_execution_id)
        mock_upload_file = TestDataFactory.create_upload_file_mock()
        entity = _PrivateWorkflowPauseEntity.from_models(mock_model, mock_upload_file)

        # Act
        result_workflow_execution_id = entity.workflow_execution_id

        # Assert
        assert result_workflow_execution_id == expected_workflow_execution_id
        assert result_workflow_execution_id == mock_model.workflow_execution_id

    # ==================== get_state Tests ====================

    def test_get_state_with_json_content(self):
        """Test get_state method with JSON content."""
        # Arrange
        test_state = {"key": "value", "number": 42, "nested": {"data": "test"}}
        test_state_json = json.dumps(test_state)
        mock_model = TestDataFactory.create_workflow_pause_mock()
        mock_upload_file = TestDataFactory.create_upload_file_mock(key="test/state.json")
        entity = _PrivateWorkflowPauseEntity.from_models(mock_model, mock_upload_file)

        # Act & Assert
        with patch(
            "repositories.entities.workflow_pause.storage.load", return_value=test_state_json.encode()
        ) as mock_storage_load:
            result = entity.get_state()

            # Verify storage was called with correct key
            mock_storage_load.assert_called_once_with("test/state.json")
            # Verify result matches original state
            assert result == test_state
            # Verify result is a dict
            assert isinstance(result, dict)

    def test_get_state_with_empty_content(self):
        """Test get_state method with empty content."""
        # Arrange
        test_state = {}
        test_state_json = json.dumps(test_state)
        mock_model = TestDataFactory.create_workflow_pause_mock()
        mock_upload_file = TestDataFactory.create_upload_file_mock(key="test/empty.json")
        entity = _PrivateWorkflowPauseEntity.from_models(mock_model, mock_upload_file)

        # Act & Assert
        with patch(
            "services.file_service.FileService.load_file", return_value=test_state_json.encode()
        ) as mock_storage_load:
            result = entity.get_state()

            mock_storage_load.assert_called_once_with("test/empty.json")
            assert result == test_state
            assert isinstance(result, dict)

    def test_get_state_with_special_characters(self):
        """Test get_state method with special characters and Unicode."""
        # Arrange
        test_state = {"text": "Special chars: éàüöß 中文 العربية 🚀 emoji 🎉\nNewlines\tTabs\"Quotes'"}
        test_state_json = json.dumps(test_state, ensure_ascii=False)
        mock_model = TestDataFactory.create_workflow_pause_mock()
        mock_upload_file = TestDataFactory.create_upload_file_mock(key="test/special.json")
        entity = _PrivateWorkflowPauseEntity.from_models(mock_model, mock_upload_file)

        # Act & Assert
        with patch(
            "services.file_service.FileService.load_file", return_value=test_state_json.encode("utf-8")
        ) as mock_storage_load:
            result = entity.get_state()

            mock_storage_load.assert_called_once_with("test/special.json")
            assert result == test_state

    # ==================== Integration Tests ====================

    def test_workflow_pause_entity_full_workflow(self):
        """Test complete workflow of creating entity and accessing its properties."""
        # Arrange
        test_state = {"workflow": "test", "step": 1, "data": {"value": 42}}
        test_state_json = json.dumps(test_state)
        mock_model = TestDataFactory.create_workflow_pause_mock(
            id="pause-123", workflow_id="workflow-456", workflow_execution_id="execution-456"
        )
        mock_upload_file = TestDataFactory.create_upload_file_mock(id="file-789", key="workflow/state.json")
        entity = _PrivateWorkflowPauseEntity.from_models(mock_model, mock_upload_file)

        # Act & Assert
        # Test properties
        assert entity.id == "pause-123"
        assert entity.workflow_id == "workflow-456"
        assert entity.workflow_execution_id == "execution-456"

        # Test state retrieval
        with patch(
            "services.file_service.FileService.load_file", return_value=test_state_json.encode()
        ) as mock_storage_load:
            state = entity.get_state()

            # Verify state content
            assert state == test_state
            assert state["workflow"] == "test"
            assert state["step"] == 1
            assert state["data"]["value"] == 42

            # Verify storage interaction
            mock_storage_load.assert_called_once_with("workflow/state.json")

    def test_get_workflow_current_pause_success(self, workflow_run_service, mock_workflow_run_repository):
        """Test successful retrieval of current workflow pause."""
        # Setup test data
        expected_pause = TestDataFactory.create_pause_entity_mock()
        expected_pause.workflow_execution_id = "workflow-execution-123"

        # Setup repository mock
        mock_workflow_run_repository.get_workflow_current_pause.return_value = expected_pause

        # Execute test
        result = workflow_run_service.get_workflow_current_pause("workflow-456")

        # Verify result and repository call
        assert result == expected_pause
        mock_workflow_run_repository.get_workflow_current_pause.assert_called_once_with("workflow-456")

    def test_get_workflow_current_pause_not_found(self, workflow_run_service, mock_workflow_run_repository):
        """Test get_workflow_current_pause when workflow is not found."""
        # Setup repository to raise ValueError
        mock_workflow_run_repository.get_workflow_current_pause.side_effect = ValueError("Workflow not found")

        # Execute test and verify exception
        with pytest.raises(ValueError, match="Workflow not found"):
            workflow_run_service.get_workflow_current_pause("non-existent")

        mock_workflow_run_repository.get_workflow_current_pause.assert_called_once_with("non-existent")

    def test_get_workflow_current_pause_no_pause(self, workflow_run_service, mock_workflow_run_repository):
        """Test get_workflow_current_pause when workflow has no pause."""
        # Setup repository to return None
        mock_workflow_run_repository.get_workflow_current_pause.return_value = None

        # Execute test
        result = workflow_run_service.get_workflow_current_pause("workflow-456")

        # Verify result is None
        assert result is None
        mock_workflow_run_repository.get_workflow_current_pause.assert_called_once_with("workflow-456")

    def test_prune_pauses_success(self, workflow_run_service, mock_workflow_run_repository):
        """Test successful pruning of expired and old pause states."""

        # Setup test data
        expiration_time = naive_utc_now() - timedelta(days=7)
        resumption_time = naive_utc_now() - timedelta(days=3)
        expected_count = 5

        # Setup repository mock
        mock_workflow_run_repository.prune_pauses.return_value = expected_count

        # Execute test
        result = workflow_run_service.prune_pauses(expiration_time, resumption_time)

        # Verify result and repository call
        assert result == expected_count
        mock_workflow_run_repository.prune_pauses.assert_called_once_with(expiration_time, resumption_time)

    def test_prune_pauses_invalid_parameters(self, workflow_run_service, mock_workflow_run_repository):
        """Test prune_pauses with invalid parameters."""

        # Test with None expiration
        with pytest.raises(ValueError, match="Expiration time cannot be None"):
            workflow_run_service.prune_pauses(None, naive_utc_now() - timedelta(days=1))

        # Test with None resumption_duration
        with pytest.raises(ValueError, match="Resumption duration cannot be None"):
            workflow_run_service.prune_pauses(naive_utc_now() - timedelta(days=1), None)
