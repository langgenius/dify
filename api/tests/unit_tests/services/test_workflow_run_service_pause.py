"""Comprehensive unit tests for WorkflowRunService class.

This test suite covers all pause state management operations including:
- Retrieving pause state for workflow runs
- Saving pause state with file uploads
- Marking paused workflows as resumed
- Error handling and edge cases
- Database transaction management
- Storage operations mocking
"""

import json
from datetime import datetime
from unittest.mock import MagicMock, create_autospec, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.workflow.enums import WorkflowExecutionStatus
from libs.datetime_utils import naive_utc_now
from models import WorkflowPause as WorkflowPauseModel
from models.model import UploadFile
from models.workflow import WorkflowRun
from services.file_service import FileService
from services.workflow_run_service import (
    WorkflowPauseEntity,
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
        mock_run = MagicMock(spec=WorkflowRun)
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
        workflow_run_id: str = "workflow-run-123",
        state_file_id: str = "file-456",
        resumed_at: datetime | None = None,
        **kwargs,
    ) -> MagicMock:
        """Create a mock WorkflowPauseModel object."""
        mock_pause = MagicMock(spec=WorkflowPauseModel)
        mock_pause.id = id
        mock_pause.tenant_id = tenant_id
        mock_pause.app_id = app_id
        mock_pause.workflow_id = workflow_id
        mock_pause.workflow_run_id = workflow_run_id
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
        mock_file = MagicMock(spec=UploadFile)
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
    ) -> MagicMock:
        """Create a mock WorkflowPauseEntity object."""
        mock_entity = MagicMock(spec=WorkflowPauseEntity)
        mock_entity._model = pause_model or TestDataFactory.create_workflow_pause_mock()
        mock_entity._upload_file = upload_file or TestDataFactory.create_upload_file_mock()
        mock_entity.id = mock_entity._model.id
        mock_entity.workflow_id = mock_entity._model.workflow_id
        mock_entity.get_state.return_value = '{"test": "state"}'

        return mock_entity


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
    def mock_file_service(self):
        """Create a mock FileService."""
        mock_service = create_autospec(FileService)
        return mock_service

    @pytest.fixture
    def workflow_run_service(self, mock_session_factory, mock_file_service):
        """Create WorkflowRunService instance with mocked dependencies."""
        session_factory, _ = mock_session_factory
        return WorkflowRunService(session_factory, mock_file_service)

    @pytest.fixture
    def workflow_run_service_with_engine(self, mock_session_factory, mock_file_service):
        """Create WorkflowRunService instance with Engine input."""
        mock_engine = create_autospec(Engine)
        session_factory, _ = mock_session_factory
        return WorkflowRunService(mock_engine, mock_file_service)

    # ==================== Initialization Tests ====================

    def test_init_with_session_factory(self, mock_session_factory, mock_file_service):
        """Test WorkflowRunService initialization with session_factory."""
        session_factory, _ = mock_session_factory
        service = WorkflowRunService(session_factory, mock_file_service)

        assert service._session_factory == session_factory
        assert service._file_srv == mock_file_service

    def test_init_with_engine(self, mock_session_factory, mock_file_service):
        """Test WorkflowRunService initialization with Engine (should convert to sessionmaker)."""
        mock_engine = create_autospec(Engine)
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.sessionmaker", return_value=session_factory) as mock_sessionmaker:
            service = WorkflowRunService(mock_engine, mock_file_service)

            mock_sessionmaker.assert_called_once_with(bind=mock_engine, expire_on_commit=False)
            assert service._session_factory == session_factory
            assert service._file_srv == mock_file_service

    def test_init_with_default_file_service(self, mock_session_factory):
        """Test WorkflowRunService initialization creates default FileService."""
        session_factory, _ = mock_session_factory

        with patch("services.workflow_run_service.FileService") as mock_file_service_class:
            service = WorkflowRunService(session_factory)

            mock_file_service_class.assert_called_once_with(session_factory)
            assert service._file_srv == mock_file_service_class.return_value

    # ==================== get_pause_state Tests ====================

    def test_get_pause_state_workflow_not_found(self, workflow_run_service, mock_session_factory):
        """Test get_pause_state when workflow run is not found."""
        session_factory, mock_session = mock_session_factory

        # Setup query to return None
        mock_scalars = MagicMock()
        mock_scalars.first.return_value = None
        mock_session.scalars.return_value = mock_scalars

        # Execute test and verify exception
        with pytest.raises(_WorkflowRunNotFoundError) as exc_info:
            workflow_run_service.get_pause_state("non-existent-run")

        assert "WorkflowRun not found, id=non-existent-run" in str(exc_info.value)

    def test_get_pause_state_no_pause_state(self, workflow_run_service, mock_session_factory):
        """Test get_pause_state when workflow run has no pause state."""
        session_factory, mock_session = mock_session_factory

        # Setup test data
        workflow_run = TestDataFactory.create_workflow_run_mock()
        workflow_run.pause = None

        # Setup SQLAlchemy query mock
        mock_scalars = MagicMock()
        mock_scalars.first.return_value = workflow_run
        mock_session.scalars.return_value = mock_scalars

        # Execute test
        result = workflow_run_service.get_pause_state("workflow-run-123")

        # Verify result is None
        assert result is None

    def test_get_pause_state_state_file_not_exists(self, workflow_run_service, mock_session_factory):
        """Test get_pause_state when state file is missing."""
        session_factory, mock_session = mock_session_factory

        # Setup test data
        workflow_run = TestDataFactory.create_workflow_run_mock()
        pause_model = TestDataFactory.create_workflow_pause_mock()
        pause_model.state_file = None
        workflow_run.pause = pause_model

        # Setup SQLAlchemy query mock
        mock_scalars = MagicMock()
        mock_scalars.first.return_value = workflow_run
        mock_session.scalars.return_value = mock_scalars

        # Execute test and verify exception
        with pytest.raises(_StateFileNotExistError) as exc_info:
            workflow_run_service.get_pause_state("workflow-run-123")

    # ==================== save_pause_state Tests ====================

    def test_save_pause_state_transaction_handling(self, workflow_run_service, mock_session_factory, mock_file_service):
        """Test that save_pause_state properly handles database transactions."""
        session_factory, mock_session = mock_session_factory

        # Setup test data
        workflow_run = TestDataFactory.create_workflow_run_mock(status="running")
        upload_file = TestDataFactory.create_upload_file_mock()
        test_state = json.dumps({"test": "state"})

        # Setup mocks
        mock_file_service.upload_text.return_value = upload_file
        mock_session.get.return_value = workflow_run

        # Mock the transaction context manager
        mock_transaction = MagicMock()
        mock_session.begin.return_value = mock_transaction
        mock_transaction.__enter__ = MagicMock(return_value=mock_session)
        mock_transaction.__exit__ = MagicMock(return_value=None)

        with patch("services.workflow_run_service.uuidv7", return_value="pause-123"):
            result = workflow_run_service.save_pause_state(workflow_run, "user-456", test_state)

        # Verify transaction was used
        mock_session.begin.assert_called_once()
        mock_transaction.__enter__.assert_called_once()
        mock_transaction.__exit__.assert_called_once()
        # Verify the workflow run was updated
        assert workflow_run.pause_id is not None
        assert workflow_run.status == WorkflowExecutionStatus.PAUSED

    # ==================== mark_as_resumed Tests ====================

    def test_mark_as_resumed_transaction_handling(self, workflow_run_service: WorkflowRunService, mock_session_factory):
        """Test that mark_as_resumed properly handles database transactions."""
        session_factory, mock_session = mock_session_factory

        # Setup test data
        pause_model = TestDataFactory.create_workflow_pause_mock()

        pause_entity = TestDataFactory.create_pause_entity_mock(pause_model)
        pause_entity.resumed_at = None
        workflow_run = TestDataFactory.create_workflow_run_mock(
            status=WorkflowExecutionStatus.PAUSED, pause_id=pause_entity.id
        )
        pause_entity.workflow_run_id = workflow_run.id

        # Setup database mocks
        mock_session.get.side_effect = lambda model, id: pause_model if model == WorkflowPauseModel else workflow_run

        # Mock the transaction context manager
        mock_transaction = MagicMock()
        mock_session.begin.return_value = mock_transaction
        mock_transaction.__enter__ = MagicMock(return_value=mock_session)
        mock_transaction.__exit__ = MagicMock(return_value=None)

        result = workflow_run_service.mark_as_resumed(pause_entity)

        # Verify the method returns the updated WorkflowRun
        assert result == workflow_run
        # Verify the workflow run was updated
        assert workflow_run.pause_id is None
        assert workflow_run.status == WorkflowExecutionStatus.RUNNING

        # Verify transaction was used
        mock_session.begin.assert_called_once()
        mock_transaction.__enter__.assert_called_once()
        mock_transaction.__exit__.assert_called_once()

    # ==================== Edge Cases Tests ====================

    def test_mark_as_resumed_with_already_resumed_entity(self, workflow_run_service, mock_session_factory):
        """Test mark_as_resumed with entity that was already resumed."""
        session_factory, mock_session = mock_session_factory

        # Setup test data - pause model already has resumed_at
        past_time = naive_utc_now()
        pause_model = TestDataFactory.create_workflow_pause_mock(resumed_at=past_time)
        workflow_run = TestDataFactory.create_workflow_run_mock()
        pause_entity = TestDataFactory.create_pause_entity_mock(pause_model)

        # Setup database mocks
        mock_session.get.side_effect = lambda model, id: pause_model if model == WorkflowPauseModel else workflow_run

        # Execute test
        with patch("services.workflow_run_service.naive_utc_now") as mock_now:
            new_time = naive_utc_now()
            mock_now.return_value = new_time
            with pytest.raises(_InvalidStateTransitionError):
                result = workflow_run_service.mark_as_resumed(pause_entity)


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
            id="different-pause-id", workflow_id="different-workflow-id", tenant_id="different-tenant-id"
        )
        mock_upload_file = TestDataFactory.create_upload_file_mock(
            id="different-file-id", key="different/path/state.json"
        )

        # Act
        entity = WorkflowPauseEntity(model=mock_model, upload_file=mock_upload_file)

        # Assert
        assert entity._model == mock_model
        assert entity._upload_file == mock_upload_file
        assert entity._model.id == "different-pause-id"
        assert entity._model.workflow_id == "different-workflow-id"

    # ==================== Property Tests ====================

    def test_id_property_returns_correct_value(self):
        """Test id property returns the correct value from the model."""
        # Arrange
        expected_id = "pause-123"
        mock_model = TestDataFactory.create_workflow_pause_mock(id=expected_id)
        mock_upload_file = TestDataFactory.create_upload_file_mock()
        entity = WorkflowPauseEntity(model=mock_model, upload_file=mock_upload_file)

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
        entity = WorkflowPauseEntity(model=mock_model, upload_file=mock_upload_file)

        # Act
        result_workflow_id = entity.workflow_id

        # Assert
        assert result_workflow_id == expected_workflow_id
        assert result_workflow_id == mock_model.workflow_id

    def test_workflow_run_id_property_returns_correct_value(self):
        """Test workflow_run_id property returns the correct value from the model."""
        # Arrange
        expected_workflow_run_id = "workflow-run-789"
        mock_model = TestDataFactory.create_workflow_pause_mock(workflow_run_id=expected_workflow_run_id)
        mock_upload_file = TestDataFactory.create_upload_file_mock()
        entity = WorkflowPauseEntity(model=mock_model, upload_file=mock_upload_file)

        # Act
        result_workflow_run_id = entity.workflow_run_id

        # Assert
        assert result_workflow_run_id == expected_workflow_run_id
        assert result_workflow_run_id == mock_model.workflow_run_id

    # ==================== get_state Tests ====================

    def test_get_state_with_json_content(self):
        """Test get_state method with JSON content."""
        # Arrange
        test_state = json.dumps({"key": "value", "number": 42, "nested": {"data": "test"}})
        mock_model = TestDataFactory.create_workflow_pause_mock()
        mock_upload_file = TestDataFactory.create_upload_file_mock(key="test/state.json")
        entity = WorkflowPauseEntity(model=mock_model, upload_file=mock_upload_file)

        # Act & Assert
        with patch("services.workflow_run_service.storage.load", return_value=test_state.encode()) as mock_storage_load:
            result = entity.get_state()

            # Verify storage was called with correct key
            mock_storage_load.assert_called_once_with("test/state.json")
            # Verify result matches original state
            assert result == test_state
            # Verify result is a string
            assert isinstance(result, str)

    def test_get_state_with_empty_content(self):
        """Test get_state method with empty content."""
        # Arrange
        test_state = ""
        mock_model = TestDataFactory.create_workflow_pause_mock()
        mock_upload_file = TestDataFactory.create_upload_file_mock(key="test/empty.json")
        entity = WorkflowPauseEntity(model=mock_model, upload_file=mock_upload_file)

        # Act & Assert
        with patch("services.workflow_run_service.storage.load", return_value=test_state.encode()) as mock_storage_load:
            result = entity.get_state()

            mock_storage_load.assert_called_once_with("test/empty.json")
            assert result == test_state
            assert result == ""

    def test_get_state_with_special_characters(self):
        """Test get_state method with special characters and Unicode."""
        # Arrange
        test_state = "Special chars: éàüöß 中文 العربية 🚀 emoji 🎉\nNewlines\tTabs\"Quotes'"
        mock_model = TestDataFactory.create_workflow_pause_mock()
        mock_upload_file = TestDataFactory.create_upload_file_mock(key="test/special.json")
        entity = WorkflowPauseEntity(model=mock_model, upload_file=mock_upload_file)

        # Act & Assert
        with patch(
            "services.workflow_run_service.storage.load", return_value=test_state.encode("utf-8")
        ) as mock_storage_load:
            result = entity.get_state()

            mock_storage_load.assert_called_once_with("test/special.json")
            assert result == test_state

    # ==================== Integration Tests ====================

    def test_workflow_pause_entity_full_workflow(self):
        """Test complete workflow of creating entity and accessing its properties."""
        # Arrange
        test_state = json.dumps({"workflow": "test", "step": 1, "data": {"value": 42}})
        mock_model = TestDataFactory.create_workflow_pause_mock(id="pause-123", workflow_id="workflow-456")
        mock_upload_file = TestDataFactory.create_upload_file_mock(id="file-789", key="workflow/state.json")
        entity = WorkflowPauseEntity(model=mock_model, upload_file=mock_upload_file)

        # Act & Assert
        # Test properties
        assert entity.id == "pause-123"
        assert entity.workflow_id == "workflow-456"

        # Test state retrieval
        with patch("services.workflow_run_service.storage.load", return_value=test_state.encode()) as mock_storage_load:
            state = entity.get_state()

            # Verify state content
            assert state == test_state
            parsed_state = json.loads(state)
            assert parsed_state["workflow"] == "test"
            assert parsed_state["step"] == 1
            assert parsed_state["data"]["value"] == 42

            # Verify storage interaction
            mock_storage_load.assert_called_once_with("workflow/state.json")
