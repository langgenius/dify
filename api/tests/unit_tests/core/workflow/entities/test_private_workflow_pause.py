"""Tests for _PrivateWorkflowPauseEntity implementation."""

from datetime import datetime
from unittest.mock import patch

from models.workflow import WorkflowPause as WorkflowPauseModel
from repositories.sqlalchemy_api_workflow_run_repository import _PrivateWorkflowPauseEntity


def _make_workflow_pause(
    *,
    pause_id: str = "pause-123",
    workflow_run_id: str = "execution-456",
    state_object_key: str = "test-state-key",
    resumed_at: datetime | None = None,
) -> WorkflowPauseModel:
    pause = WorkflowPauseModel(
        workflow_id="workflow-789",
        workflow_run_id=workflow_run_id,
        state_object_key=state_object_key,
        resumed_at=resumed_at,
    )
    pause.id = pause_id
    return pause


class TestPrivateWorkflowPauseEntity:
    """Test _PrivateWorkflowPauseEntity implementation."""

    def test_entity_initialization(self):
        """Test entity initialization with required parameters."""
        pause_model = _make_workflow_pause()

        # Create entity
        entity = _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=[], human_input_form=[])

        # Verify initialization
        assert entity._pause_model is pause_model
        assert entity._cached_state is None

    def test_id_property(self):
        """Test id property returns pause model ID."""
        pause_model = _make_workflow_pause()

        entity = _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=[], human_input_form=[])

        assert entity.id == "pause-123"

    def test_workflow_execution_id_property(self):
        """Test workflow_execution_id property returns workflow run ID."""
        pause_model = _make_workflow_pause()

        entity = _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=[], human_input_form=[])

        assert entity.workflow_execution_id == "execution-456"

    def test_resumed_at_property(self):
        """Test resumed_at property returns pause model resumed_at."""
        resumed_at = datetime(2023, 12, 25, 15, 30, 45)

        pause_model = _make_workflow_pause(resumed_at=resumed_at)

        entity = _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=[], human_input_form=[])

        assert entity.resumed_at == resumed_at

    def test_resumed_at_property_none(self):
        """Test resumed_at property returns None when not set."""
        pause_model = _make_workflow_pause()

        entity = _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=[], human_input_form=[])

        assert entity.resumed_at is None

    @patch("repositories.sqlalchemy_api_workflow_run_repository.storage", autospec=True)
    def test_get_state_first_call(self, mock_storage):
        """Test get_state loads from storage on first call."""
        state_data = b'{"test": "data", "step": 5}'
        mock_storage.load.return_value = state_data

        pause_model = _make_workflow_pause()

        entity = _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=[], human_input_form=[])

        # First call should load from storage
        result = entity.get_state()

        assert result == state_data
        mock_storage.load.assert_called_once_with("test-state-key")
        assert entity._cached_state == state_data

    @patch("repositories.sqlalchemy_api_workflow_run_repository.storage", autospec=True)
    def test_get_state_cached_call(self, mock_storage):
        """Test get_state returns cached data on subsequent calls."""
        state_data = b'{"test": "data", "step": 5}'
        mock_storage.load.return_value = state_data

        pause_model = _make_workflow_pause()

        entity = _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=[], human_input_form=[])

        # First call
        result1 = entity.get_state()
        # Second call should use cache
        result2 = entity.get_state()

        assert result1 == state_data
        assert result2 == state_data
        # Storage should only be called once
        mock_storage.load.assert_called_once_with("test-state-key")

    @patch("repositories.sqlalchemy_api_workflow_run_repository.storage", autospec=True)
    def test_get_state_with_pre_cached_data(self, mock_storage):
        """Test get_state returns pre-cached data."""
        state_data = b'{"test": "data", "step": 5}'

        pause_model = _make_workflow_pause()

        entity = _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=[], human_input_form=[])

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

        with patch("repositories.sqlalchemy_api_workflow_run_repository.storage", autospec=True) as mock_storage:
            mock_storage.load.return_value = binary_data

            pause_model = _make_workflow_pause()

            entity = _PrivateWorkflowPauseEntity(pause_model=pause_model, reason_models=[], human_input_form=[])

            result = entity.get_state()

            assert result == binary_data
