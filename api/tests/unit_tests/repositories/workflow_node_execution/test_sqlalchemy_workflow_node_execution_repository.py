"""
Unit tests for SQLAlchemyWorkflowNodeExecutionRepository, focusing on process_data truncation functionality.
"""

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy.orm import sessionmaker

from core.repositories.sqlalchemy_workflow_node_execution_repository import (
    SQLAlchemyWorkflowNodeExecutionRepository,
    _InputsOutputsTruncationResult,
)
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution
from core.workflow.enums import NodeType
from models import Account, WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from models.model import UploadFile
from models.workflow import WorkflowNodeExecutionOffload


class TestSQLAlchemyWorkflowNodeExecutionRepositoryProcessData:
    """Test process_data truncation functionality in SQLAlchemyWorkflowNodeExecutionRepository."""

    def create_mock_account(self) -> Account:
        """Create a mock Account for testing."""
        account = Mock(spec=Account)
        account.id = "test-user-id"
        account.tenant_id = "test-tenant-id"
        return account

    def create_mock_session_factory(self) -> sessionmaker:
        """Create a mock session factory for testing."""
        mock_session = MagicMock()
        mock_session_factory = MagicMock(spec=sessionmaker)
        mock_session_factory.return_value.__enter__.return_value = mock_session
        mock_session_factory.return_value.__exit__.return_value = None
        return mock_session_factory

    def create_repository(self, mock_file_service=None) -> SQLAlchemyWorkflowNodeExecutionRepository:
        """Create a repository instance for testing."""
        mock_account = self.create_mock_account()
        mock_session_factory = self.create_mock_session_factory()

        repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=mock_session_factory,
            user=mock_account,
            app_id="test-app-id",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        if mock_file_service:
            repository._file_service = mock_file_service

        return repository

    def create_workflow_node_execution(
        self,
        process_data: dict[str, Any] | None = None,
        execution_id: str = "test-execution-id",
    ) -> WorkflowNodeExecution:
        """Create a WorkflowNodeExecution instance for testing."""
        return WorkflowNodeExecution(
            id=execution_id,
            workflow_id="test-workflow-id",
            index=1,
            node_id="test-node-id",
            node_type=NodeType.LLM,
            title="Test Node",
            process_data=process_data,
            created_at=datetime.now(),
        )

    @patch("core.repositories.sqlalchemy_workflow_node_execution_repository.dify_config")
    def test_to_db_model_with_small_process_data(self, mock_config):
        """Test _to_db_model with small process_data that doesn't need truncation."""
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE = 1000
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH = 100
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH = 500

        repository = self.create_repository()
        small_process_data = {"small": "data", "count": 5}

        execution = self.create_workflow_node_execution(process_data=small_process_data)

        with patch.object(repository, "_truncate_and_upload", return_value=None) as mock_truncate:
            db_model = repository._to_db_model(execution)

            # Should try to truncate but return None (no truncation needed)
            mock_truncate.assert_called_once_with(small_process_data, execution.id, "_process_data")

            # Process data should be stored directly in database
            assert db_model.process_data is not None
            stored_data = json.loads(db_model.process_data)
            assert stored_data == small_process_data

            # No offload data should be created for process_data
            assert db_model.offload_data is None

    def test_to_db_model_with_large_process_data(self):
        """Test _to_db_model with large process_data that needs truncation."""
        repository = self.create_repository()

        # Create large process_data that would need truncation
        large_process_data = {
            "large_field": "x" * 10000,  # Very large string
            "metadata": {"type": "processing", "timestamp": 1234567890},
        }

        # Mock truncation result
        truncated_data = {"large_field": "[TRUNCATED]", "metadata": {"type": "processing", "timestamp": 1234567890}}

        mock_upload_file = Mock(spec=UploadFile)
        mock_upload_file.id = "mock-file-id"

        mock_offload = Mock(spec=WorkflowNodeExecutionOffload)
        truncation_result = _InputsOutputsTruncationResult(
            truncated_value=truncated_data, file=mock_upload_file, offload=mock_offload
        )

        execution = self.create_workflow_node_execution(process_data=large_process_data)

        with patch.object(repository, "_truncate_and_upload", return_value=truncation_result) as mock_truncate:
            db_model = repository._to_db_model(execution)

            # Should call truncate with correct parameters
            mock_truncate.assert_called_once_with(large_process_data, execution.id, "_process_data")

            # Truncated data should be stored in database
            assert db_model.process_data is not None
            stored_data = json.loads(db_model.process_data)
            assert stored_data == truncated_data

            # Domain model should have truncated data set
            assert execution.process_data_truncated is True
            assert execution.get_truncated_process_data() == truncated_data

            # Offload data should be created
            assert db_model.offload_data is not None
            assert len(db_model.offload_data) > 0
            # Find the process_data offload entry
            process_data_offload = next(
                (item for item in db_model.offload_data if hasattr(item, "file_id") and item.file_id == "mock-file-id"),
                None,
            )
            assert process_data_offload is not None

    def test_to_db_model_with_none_process_data(self):
        """Test _to_db_model with None process_data."""
        repository = self.create_repository()
        execution = self.create_workflow_node_execution(process_data=None)

        with patch.object(repository, "_truncate_and_upload") as mock_truncate:
            db_model = repository._to_db_model(execution)

            # Should not call truncate for None data
            mock_truncate.assert_not_called()

            # Process data should be None
            assert db_model.process_data is None

            # No offload data should be created
            assert db_model.offload_data == []

    def test_to_domain_model_with_offloaded_process_data(self):
        """Test _to_domain_model with offloaded process_data."""
        repository = self.create_repository()

        # Create mock database model with offload data
        db_model = Mock(spec=WorkflowNodeExecutionModel)
        db_model.id = "test-execution-id"
        db_model.node_execution_id = "test-node-execution-id"
        db_model.workflow_id = "test-workflow-id"
        db_model.workflow_run_id = None
        db_model.index = 1
        db_model.predecessor_node_id = None
        db_model.node_id = "test-node-id"
        db_model.node_type = "llm"
        db_model.title = "Test Node"
        db_model.status = "succeeded"
        db_model.error = None
        db_model.elapsed_time = 1.5
        db_model.created_at = datetime.now()
        db_model.finished_at = None

        # Mock truncated process_data from database
        truncated_process_data = {"large_field": "[TRUNCATED]", "metadata": "info"}
        db_model.process_data_dict = truncated_process_data
        db_model.inputs_dict = None
        db_model.outputs_dict = None
        db_model.execution_metadata_dict = {}

        # Mock offload data with process_data file
        mock_offload_data = Mock(spec=WorkflowNodeExecutionOffload)
        mock_offload_data.inputs_file_id = None
        mock_offload_data.inputs_file = None
        mock_offload_data.outputs_file_id = None
        mock_offload_data.outputs_file = None
        mock_offload_data.process_data_file_id = "process-data-file-id"

        mock_process_data_file = Mock(spec=UploadFile)
        mock_offload_data.process_data_file = mock_process_data_file

        db_model.offload_data = [mock_offload_data]

        # Mock the file loading
        original_process_data = {"large_field": "x" * 10000, "metadata": "info"}

        with patch.object(repository, "_load_file", return_value=original_process_data) as mock_load:
            domain_model = repository._to_domain_model(db_model)

            # Should load the file
            mock_load.assert_called_once_with(mock_process_data_file)

            # Domain model should have original data
            assert domain_model.process_data == original_process_data

            # Domain model should have truncated data set
            assert domain_model.process_data_truncated is True
            assert domain_model.get_truncated_process_data() == truncated_process_data

    def test_to_domain_model_without_offload_data(self):
        """Test _to_domain_model without offload data."""
        repository = self.create_repository()

        # Create mock database model without offload data
        db_model = Mock(spec=WorkflowNodeExecutionModel)
        db_model.id = "test-execution-id"
        db_model.node_execution_id = "test-node-execution-id"
        db_model.workflow_id = "test-workflow-id"
        db_model.workflow_run_id = None
        db_model.index = 1
        db_model.predecessor_node_id = None
        db_model.node_id = "test-node-id"
        db_model.node_type = "llm"
        db_model.title = "Test Node"
        db_model.status = "succeeded"
        db_model.error = None
        db_model.elapsed_time = 1.5
        db_model.created_at = datetime.now()
        db_model.finished_at = None

        process_data = {"normal": "data"}
        db_model.process_data_dict = process_data
        db_model.inputs_dict = None
        db_model.outputs_dict = None
        db_model.execution_metadata_dict = {}
        db_model.offload_data = None

        domain_model = repository._to_domain_model(db_model)

        # Domain model should have the data from database
        assert domain_model.process_data == process_data

        # Should not be truncated
        assert domain_model.process_data_truncated is False
        assert domain_model.get_truncated_process_data() is None


@dataclass
class TruncationScenario:
    """Test scenario for truncation functionality."""

    name: str
    process_data: dict[str, Any] | None
    should_truncate: bool
    expected_truncated: bool = False


class TestProcessDataTruncationScenarios:
    """Test various scenarios for process_data truncation."""

    def get_truncation_scenarios(self) -> list[TruncationScenario]:
        """Create test scenarios for truncation."""
        return [
            TruncationScenario(
                name="none_data",
                process_data=None,
                should_truncate=False,
            ),
            TruncationScenario(
                name="small_data",
                process_data={"key": "value"},
                should_truncate=False,
            ),
            TruncationScenario(
                name="large_data",
                process_data={"large": "x" * 10000},
                should_truncate=True,
                expected_truncated=True,
            ),
            TruncationScenario(
                name="empty_data",
                process_data={},
                should_truncate=False,
            ),
        ]

    @pytest.mark.parametrize(
        "scenario",
        [
            TruncationScenario("none_data", None, False, False),
            TruncationScenario("small_data", {"small": "data"}, False, False),
            TruncationScenario("large_data", {"large": "x" * 10000}, True, True),
            TruncationScenario("empty_data", {}, False, False),
        ],
        ids=["none_data", "small_data", "large_data", "empty_data"],
    )
    def test_process_data_truncation_scenarios(self, scenario: TruncationScenario):
        """Test various process_data truncation scenarios."""
        repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=MagicMock(spec=sessionmaker),
            user=Mock(spec=Account, id="test-user", tenant_id="test-tenant"),
            app_id="test-app",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        execution = WorkflowNodeExecution(
            id="test-execution-id",
            workflow_id="test-workflow-id",
            index=1,
            node_id="test-node-id",
            node_type=NodeType.LLM,
            title="Test Node",
            process_data=scenario.process_data,
            created_at=datetime.now(),
        )

        # Mock truncation behavior
        if scenario.should_truncate:
            truncated_data = {"truncated": True}
            mock_file = Mock(spec=UploadFile, id="file-id")
            mock_offload = Mock(spec=WorkflowNodeExecutionOffload)
            truncation_result = _InputsOutputsTruncationResult(
                truncated_value=truncated_data, file=mock_file, offload=mock_offload
            )

            with patch.object(repository, "_truncate_and_upload", return_value=truncation_result):
                db_model = repository._to_db_model(execution)

                # Should create offload data
                assert db_model.offload_data is not None
                assert len(db_model.offload_data) > 0
                # Find the process_data offload entry
                process_data_offload = next(
                    (item for item in db_model.offload_data if hasattr(item, "file_id") and item.file_id == "file-id"),
                    None,
                )
                assert process_data_offload is not None
                assert execution.process_data_truncated == scenario.expected_truncated
        else:
            with patch.object(repository, "_truncate_and_upload", return_value=None):
                db_model = repository._to_db_model(execution)

                # Should not create offload data or set truncation
                if scenario.process_data is None:
                    assert db_model.offload_data == []
                    assert db_model.process_data is None
                else:
                    # For small data, might have offload_data from other fields but not process_data
                    if db_model.offload_data:
                        # Check that no process_data offload entries exist
                        process_data_offloads = [
                            item
                            for item in db_model.offload_data
                            if hasattr(item, "type_") and item.type_.value == "process_data"
                        ]
                        assert len(process_data_offloads) == 0

                assert execution.process_data_truncated is False
