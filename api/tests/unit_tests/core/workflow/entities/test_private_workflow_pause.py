"""Tests for _PrivateWorkflowPauseEntity implementation."""

from datetime import datetime
from unittest.mock import MagicMock, patch

from models.model import UploadFile
from models.workflow import WorkflowPause as WorkflowPauseModel
from repositories.sqlalchemy_api_workflow_run_repository import _PrivateWorkflowPauseEntity


class TestPrivateWorkflowPauseEntity:
    """Test _PrivateWorkflowPauseEntity implementation."""

    def test_entity_initialization(self):
        """Test entity initialization with required parameters."""
        # Create mock models
        mock_pause_model = MagicMock(spec=WorkflowPauseModel)
        mock_pause_model.id = "pause-123"
        mock_pause_model.workflow_run_id = "execution-456"
        mock_pause_model.resumed_at = None

        mock_state_file = MagicMock(spec=UploadFile)
        mock_state_file.key = "test-state-key"

        # Create entity
        entity = _PrivateWorkflowPauseEntity(
            pause_model=mock_pause_model,
            state_file=mock_state_file,
        )

        # Verify initialization
        assert entity._pause_model is mock_pause_model
        assert entity._state_file is mock_state_file
        assert entity._cached_state is None

    def test_from_models_classmethod(self):
        """Test from_models class method."""
        # Create mock models
        mock_pause_model = MagicMock(spec=WorkflowPauseModel)
        mock_pause_model.id = "pause-123"
        mock_pause_model.workflow_run_id = "execution-456"

        mock_state_file = MagicMock(spec=UploadFile)
        mock_pause_model.state_file = mock_state_file

        # Create entity using from_models
        entity = _PrivateWorkflowPauseEntity.from_models(
            workflow_pause_model=mock_pause_model,
            upload_file_model=mock_state_file,
        )

        # Verify entity creation
        assert isinstance(entity, _PrivateWorkflowPauseEntity)
        assert entity._pause_model is mock_pause_model
        assert entity._state_file is mock_state_file

    def test_id_property(self):
        """Test id property returns pause model ID."""
        mock_pause_model = MagicMock(spec=WorkflowPauseModel)
        mock_pause_model.id = "pause-123"

        mock_state_file = MagicMock(spec=UploadFile)

        entity = _PrivateWorkflowPauseEntity(
            pause_model=mock_pause_model,
            state_file=mock_state_file,
        )

        assert entity.id == "pause-123"

    def test_workflow_execution_id_property(self):
        """Test workflow_execution_id property returns workflow run ID."""
        mock_pause_model = MagicMock(spec=WorkflowPauseModel)
        mock_pause_model.workflow_run_id = "execution-456"

        mock_state_file = MagicMock(spec=UploadFile)

        entity = _PrivateWorkflowPauseEntity(
            pause_model=mock_pause_model,
            state_file=mock_state_file,
        )

        assert entity.workflow_execution_id == "execution-456"

    def test_resumed_at_property(self):
        """Test resumed_at property returns pause model resumed_at."""
        resumed_at = datetime(2023, 12, 25, 15, 30, 45)

        mock_pause_model = MagicMock(spec=WorkflowPauseModel)
        mock_pause_model.resumed_at = resumed_at

        mock_state_file = MagicMock(spec=UploadFile)

        entity = _PrivateWorkflowPauseEntity(
            pause_model=mock_pause_model,
            state_file=mock_state_file,
        )

        assert entity.resumed_at == resumed_at

    def test_resumed_at_property_none(self):
        """Test resumed_at property returns None when not set."""
        mock_pause_model = MagicMock(spec=WorkflowPauseModel)
        mock_pause_model.resumed_at = None

        mock_state_file = MagicMock(spec=UploadFile)

        entity = _PrivateWorkflowPauseEntity(
            pause_model=mock_pause_model,
            state_file=mock_state_file,
        )

        assert entity.resumed_at is None

    @patch("repositories.sqlalchemy_api_workflow_run_repository.storage")
    def test_get_state_first_call(self, mock_storage):
        """Test get_state loads from storage on first call."""
        state_data = b'{"test": "data", "step": 5}'
        mock_storage.load.return_value = state_data

        mock_pause_model = MagicMock(spec=WorkflowPauseModel)
        mock_state_file = MagicMock(spec=UploadFile)
        mock_state_file.key = "test-state-key"

        entity = _PrivateWorkflowPauseEntity(
            pause_model=mock_pause_model,
            state_file=mock_state_file,
        )

        # First call should load from storage
        result = entity.get_state()

        assert result == state_data
        mock_storage.load.assert_called_once_with("test-state-key")
        assert entity._cached_state == state_data

    @patch("repositories.sqlalchemy_api_workflow_run_repository.storage")
    def test_get_state_cached_call(self, mock_storage):
        """Test get_state returns cached data on subsequent calls."""
        state_data = b'{"test": "data", "step": 5}'
        mock_storage.load.return_value = state_data

        mock_pause_model = MagicMock(spec=WorkflowPauseModel)
        mock_state_file = MagicMock(spec=UploadFile)
        mock_state_file.key = "test-state-key"

        entity = _PrivateWorkflowPauseEntity(
            pause_model=mock_pause_model,
            state_file=mock_state_file,
        )

        # First call
        result1 = entity.get_state()
        # Second call should use cache
        result2 = entity.get_state()

        assert result1 == state_data
        assert result2 == state_data
        # Storage should only be called once
        mock_storage.load.assert_called_once_with("test-state-key")

    @patch("repositories.sqlalchemy_api_workflow_run_repository.storage")
    def test_get_state_with_pre_cached_data(self, mock_storage):
        """Test get_state returns pre-cached data."""
        state_data = b'{"test": "data", "step": 5}'

        mock_pause_model = MagicMock(spec=WorkflowPauseModel)
        mock_state_file = MagicMock(spec=UploadFile)

        entity = _PrivateWorkflowPauseEntity(
            pause_model=mock_pause_model,
            state_file=mock_state_file,
        )

        # Pre-cache data
        entity._cached_state = state_data

        # Should return cached data without calling storage
        result = entity.get_state()

        assert result == state_data
        mock_storage.load.assert_not_called()

    def test_entity_with_binary_state_data(self):
        """Test entity with binary state data."""
        # Test with binary data that's not valid JSON
        binary_data = b"\x00\x01\x02\x03\x04\x05\xff\xfe"

        with patch("repositories.sqlalchemy_api_workflow_run_repository.storage") as mock_storage:
            mock_storage.load.return_value = binary_data

            mock_pause_model = MagicMock(spec=WorkflowPauseModel)
            mock_state_file = MagicMock(spec=UploadFile)
            mock_state_file.key = "binary-state-key"

            entity = _PrivateWorkflowPauseEntity(
                pause_model=mock_pause_model,
                state_file=mock_state_file,
            )

            result = entity.get_state()

            assert result == binary_data
