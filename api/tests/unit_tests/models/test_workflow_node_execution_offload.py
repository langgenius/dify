"""
Unit tests for WorkflowNodeExecutionOffload model, focusing on process_data truncation functionality.
"""

from unittest.mock import Mock

import pytest

from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload


class TestWorkflowNodeExecutionModel:
    """Test WorkflowNodeExecutionModel with process_data truncation features."""

    def create_mock_offload_data(
        self,
        inputs_file_id: str | None = None,
        outputs_file_id: str | None = None,
        process_data_file_id: str | None = None,
    ) -> WorkflowNodeExecutionOffload:
        """Create a mock offload data object."""
        offload = Mock(spec=WorkflowNodeExecutionOffload)
        offload.inputs_file_id = inputs_file_id
        offload.outputs_file_id = outputs_file_id
        offload.process_data_file_id = process_data_file_id

        # Mock file objects
        if inputs_file_id:
            offload.inputs_file = Mock(spec=UploadFile)
        else:
            offload.inputs_file = None

        if outputs_file_id:
            offload.outputs_file = Mock(spec=UploadFile)
        else:
            offload.outputs_file = None

        if process_data_file_id:
            offload.process_data_file = Mock(spec=UploadFile)
        else:
            offload.process_data_file = None

        return offload

    def test_process_data_truncated_property_false_when_no_offload_data(self):
        """Test process_data_truncated returns False when no offload_data."""
        execution = WorkflowNodeExecutionModel()
        execution.offload_data = []

        assert execution.process_data_truncated is False

    def test_process_data_truncated_property_false_when_no_process_data_file(self):
        """Test process_data_truncated returns False when no process_data file."""
        from models.enums import ExecutionOffLoadType

        execution = WorkflowNodeExecutionModel()

        # Create real offload instances for inputs and outputs but not process_data
        inputs_offload = WorkflowNodeExecutionOffload()
        inputs_offload.type_ = ExecutionOffLoadType.INPUTS
        inputs_offload.file_id = "inputs-file"

        outputs_offload = WorkflowNodeExecutionOffload()
        outputs_offload.type_ = ExecutionOffLoadType.OUTPUTS
        outputs_offload.file_id = "outputs-file"

        execution.offload_data = [inputs_offload, outputs_offload]

        assert execution.process_data_truncated is False

    def test_process_data_truncated_property_true_when_process_data_file_exists(self):
        """Test process_data_truncated returns True when process_data file exists."""
        from models.enums import ExecutionOffLoadType

        execution = WorkflowNodeExecutionModel()

        # Create a real offload instance for process_data
        process_data_offload = WorkflowNodeExecutionOffload()
        process_data_offload.type_ = ExecutionOffLoadType.PROCESS_DATA
        process_data_offload.file_id = "process-data-file-id"
        execution.offload_data = [process_data_offload]

        assert execution.process_data_truncated is True

    def test_load_full_process_data_with_no_offload_data(self):
        """Test load_full_process_data when no offload data exists."""
        execution = WorkflowNodeExecutionModel()
        execution.offload_data = []
        execution.process_data = '{"test": "data"}'

        # Mock session and storage
        mock_session = Mock()
        mock_storage = Mock()

        result = execution.load_full_process_data(mock_session, mock_storage)

        assert result == {"test": "data"}

    def test_load_full_process_data_with_no_file(self):
        """Test load_full_process_data when no process_data file exists."""
        from models.enums import ExecutionOffLoadType

        execution = WorkflowNodeExecutionModel()

        # Create offload data for inputs only, not process_data
        inputs_offload = WorkflowNodeExecutionOffload()
        inputs_offload.type_ = ExecutionOffLoadType.INPUTS
        inputs_offload.file_id = "inputs-file"

        execution.offload_data = [inputs_offload]
        execution.process_data = '{"test": "data"}'

        # Mock session and storage
        mock_session = Mock()
        mock_storage = Mock()

        result = execution.load_full_process_data(mock_session, mock_storage)

        assert result == {"test": "data"}

    def test_load_full_process_data_with_file(self):
        """Test load_full_process_data when process_data file exists."""
        from models.enums import ExecutionOffLoadType

        execution = WorkflowNodeExecutionModel()

        # Create process_data offload
        process_data_offload = WorkflowNodeExecutionOffload()
        process_data_offload.type_ = ExecutionOffLoadType.PROCESS_DATA
        process_data_offload.file_id = "file-id"

        execution.offload_data = [process_data_offload]
        execution.process_data = '{"truncated": "data"}'

        # Mock session and storage
        mock_session = Mock()
        mock_storage = Mock()

        # Mock the _load_full_content method to return full data
        full_process_data = {"full": "data", "large_field": "x" * 10000}

        with pytest.MonkeyPatch.context() as mp:
            # Mock the _load_full_content method
            def mock_load_full_content(session, file_id, storage):
                assert session == mock_session
                assert file_id == "file-id"
                assert storage == mock_storage
                return full_process_data

            mp.setattr(execution, "_load_full_content", mock_load_full_content)

            result = execution.load_full_process_data(mock_session, mock_storage)

            assert result == full_process_data

    def test_consistency_with_inputs_outputs_truncation(self):
        """Test that process_data truncation behaves consistently with inputs/outputs."""
        from models.enums import ExecutionOffLoadType

        execution = WorkflowNodeExecutionModel()

        # Create offload data for all three types
        inputs_offload = WorkflowNodeExecutionOffload()
        inputs_offload.type_ = ExecutionOffLoadType.INPUTS
        inputs_offload.file_id = "inputs-file"

        outputs_offload = WorkflowNodeExecutionOffload()
        outputs_offload.type_ = ExecutionOffLoadType.OUTPUTS
        outputs_offload.file_id = "outputs-file"

        process_data_offload = WorkflowNodeExecutionOffload()
        process_data_offload.type_ = ExecutionOffLoadType.PROCESS_DATA
        process_data_offload.file_id = "process-data-file"

        execution.offload_data = [inputs_offload, outputs_offload, process_data_offload]

        # All three should be truncated
        assert execution.inputs_truncated is True
        assert execution.outputs_truncated is True
        assert execution.process_data_truncated is True

    def test_mixed_truncation_states(self):
        """Test mixed states of truncation."""
        from models.enums import ExecutionOffLoadType

        execution = WorkflowNodeExecutionModel()

        # Only process_data is truncated
        process_data_offload = WorkflowNodeExecutionOffload()
        process_data_offload.type_ = ExecutionOffLoadType.PROCESS_DATA
        process_data_offload.file_id = "process-data-file"

        execution.offload_data = [process_data_offload]

        assert execution.inputs_truncated is False
        assert execution.outputs_truncated is False
        assert execution.process_data_truncated is True

    def test_preload_offload_data_and_files_method_exists(self):
        """Test that the preload method includes process_data_file."""
        # This test verifies the method exists and can be called
        # The actual SQL behavior would be tested in integration tests
        from sqlalchemy import select

        stmt = select(WorkflowNodeExecutionModel)

        # This should not raise an exception
        preloaded_stmt = WorkflowNodeExecutionModel.preload_offload_data_and_files(stmt)

        # The statement should be modified (different object)
        assert preloaded_stmt is not stmt
