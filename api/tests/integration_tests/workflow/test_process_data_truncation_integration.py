"""
Integration tests for process_data truncation functionality.

These tests verify the end-to-end behavior of process_data truncation across
the entire system, from database storage to API responses.
"""

import json
from dataclasses import dataclass
from datetime import datetime
from unittest.mock import Mock, patch

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution, WorkflowNodeExecutionStatus
from core.workflow.nodes.enums import NodeType
from models import Account
from models.workflow import WorkflowNodeExecutionTriggeredFrom


@dataclass
class TruncationTestData:
    """Test data for truncation scenarios."""

    name: str
    process_data: dict[str, any]
    should_truncate: bool
    expected_storage_interaction: bool


class TestProcessDataTruncationIntegration:
    """Integration tests for process_data truncation functionality."""

    @pytest.fixture
    def in_memory_db_engine(self):
        """Create an in-memory SQLite database for testing."""
        engine = create_engine("sqlite:///:memory:")

        # Create minimal table structure for testing
        with engine.connect() as conn:
            # Create workflow_node_executions table
            conn.execute(
                text("""
                CREATE TABLE workflow_node_executions (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    app_id TEXT NOT NULL,
                    workflow_id TEXT NOT NULL,
                    triggered_from TEXT NOT NULL,
                    workflow_run_id TEXT,
                    index_ INTEGER NOT NULL,
                    predecessor_node_id TEXT,
                    node_execution_id TEXT,
                    node_id TEXT NOT NULL,
                    node_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    inputs TEXT,
                    process_data TEXT,
                    outputs TEXT,
                    status TEXT NOT NULL,
                    error TEXT,
                    elapsed_time REAL DEFAULT 0,
                    execution_metadata TEXT,
                    created_at DATETIME NOT NULL,
                    created_by_role TEXT NOT NULL,
                    created_by TEXT NOT NULL,
                    finished_at DATETIME
                )
            """)
            )

            # Create workflow_node_execution_offload table
            conn.execute(
                text("""
                CREATE TABLE workflow_node_execution_offload (
                    id TEXT PRIMARY KEY,
                    created_at DATETIME NOT NULL,
                    tenant_id TEXT NOT NULL,
                    app_id TEXT NOT NULL,
                    node_execution_id TEXT NOT NULL UNIQUE,
                    inputs_file_id TEXT,
                    outputs_file_id TEXT,
                    process_data_file_id TEXT
                )
            """)
            )

            # Create upload_files table (simplified)
            conn.execute(
                text("""
                CREATE TABLE upload_files (
                    id TEXT PRIMARY KEY,
                    tenant_id TEXT NOT NULL,
                    storage_key TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    created_at DATETIME NOT NULL
                )
            """)
            )

            conn.commit()

        return engine

    @pytest.fixture
    def mock_account(self):
        """Create a mock account for testing."""
        account = Mock(spec=Account)
        account.id = "test-user-id"
        account.tenant_id = "test-tenant-id"
        return account

    @pytest.fixture
    def repository(self, in_memory_db_engine, mock_account):
        """Create a repository instance for testing."""
        session_factory = sessionmaker(bind=in_memory_db_engine)

        return SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            user=mock_account,
            app_id="test-app-id",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

    def create_test_execution(
        self, process_data: dict[str, any] | None = None, execution_id: str = "test-execution-id"
    ) -> WorkflowNodeExecution:
        """Create a test execution with process_data."""
        return WorkflowNodeExecution(
            id=execution_id,
            workflow_id="test-workflow-id",
            workflow_execution_id="test-run-id",
            index=1,
            node_id="test-node-id",
            node_type=NodeType.LLM,
            title="Test Node",
            process_data=process_data,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            created_at=datetime.now(),
            finished_at=datetime.now(),
        )

    def get_truncation_test_data(self) -> list[TruncationTestData]:
        """Get test data for various truncation scenarios."""
        return [
            TruncationTestData(
                name="small_process_data",
                process_data={"small": "data", "count": 5},
                should_truncate=False,
                expected_storage_interaction=False,
            ),
            TruncationTestData(
                name="large_process_data",
                process_data={"large_field": "x" * 10000, "metadata": "info"},
                should_truncate=True,
                expected_storage_interaction=True,
            ),
            TruncationTestData(
                name="complex_large_data",
                process_data={
                    "logs": ["log entry"] * 500,  # Large array
                    "config": {"setting": "value"},
                    "status": "processing",
                    "details": {"description": "y" * 5000},  # Large string
                },
                should_truncate=True,
                expected_storage_interaction=True,
            ),
        ]

    @patch("core.repositories.sqlalchemy_workflow_node_execution_repository.dify_config")
    @patch("services.file_service.FileService.upload_file")
    @patch("extensions.ext_storage.storage")
    def test_end_to_end_process_data_truncation(self, mock_storage, mock_upload_file, mock_config, repository):
        """Test end-to-end process_data truncation functionality."""
        # Configure truncation limits
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE = 1000
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH = 100
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH = 500

        # Create large process_data that should be truncated
        large_process_data = {
            "large_field": "x" * 10000,  # Exceeds string length limit
            "metadata": {"type": "processing", "timestamp": 1234567890},
        }

        # Mock file upload
        mock_file = Mock()
        mock_file.id = "mock-process-data-file-id"
        mock_upload_file.return_value = mock_file

        # Create and save execution
        execution = self.create_test_execution(process_data=large_process_data)
        repository.save(execution)

        # Verify truncation occurred
        assert execution.process_data_truncated is True
        truncated_data = execution.get_truncated_process_data()
        assert truncated_data is not None
        assert truncated_data != large_process_data  # Should be different due to truncation

        # Verify file upload was called for process_data
        assert mock_upload_file.called
        upload_args = mock_upload_file.call_args
        assert "_process_data" in upload_args[1]["filename"]

    @patch("core.repositories.sqlalchemy_workflow_node_execution_repository.dify_config")
    def test_small_process_data_no_truncation(self, mock_config, repository):
        """Test that small process_data is not truncated."""
        # Configure truncation limits
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE = 1000
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH = 100
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH = 500

        # Create small process_data
        small_process_data = {"small": "data", "count": 5}

        execution = self.create_test_execution(process_data=small_process_data)
        repository.save(execution)

        # Verify no truncation occurred
        assert execution.process_data_truncated is False
        assert execution.get_truncated_process_data() is None
        assert execution.get_response_process_data() == small_process_data

    @pytest.mark.parametrize(
        "test_data",
        get_truncation_test_data(None),
        ids=[data.name for data in get_truncation_test_data(None)],
    )
    @patch("core.repositories.sqlalchemy_workflow_node_execution_repository.dify_config")
    @patch("services.file_service.FileService.upload_file")
    def test_various_truncation_scenarios(
        self, mock_upload_file, mock_config, test_data: TruncationTestData, repository
    ):
        """Test various process_data truncation scenarios."""
        # Configure truncation limits
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE = 1000
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH = 100
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH = 500

        if test_data.expected_storage_interaction:
            # Mock file upload for truncation scenarios
            mock_file = Mock()
            mock_file.id = f"file-{test_data.name}"
            mock_upload_file.return_value = mock_file

        execution = self.create_test_execution(process_data=test_data.process_data)
        repository.save(execution)

        # Verify truncation behavior matches expectations
        assert execution.process_data_truncated == test_data.should_truncate

        if test_data.should_truncate:
            assert execution.get_truncated_process_data() is not None
            assert execution.get_truncated_process_data() != test_data.process_data
            assert mock_upload_file.called
        else:
            assert execution.get_truncated_process_data() is None
            assert execution.get_response_process_data() == test_data.process_data

    @patch("core.repositories.sqlalchemy_workflow_node_execution_repository.dify_config")
    @patch("services.file_service.FileService.upload_file")
    @patch("extensions.ext_storage.storage")
    def test_load_truncated_execution_from_database(
        self, mock_storage, mock_upload_file, mock_config, repository, in_memory_db_engine
    ):
        """Test loading an execution with truncated process_data from database."""
        # Configure truncation
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE = 1000
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH = 100
        mock_config.WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH = 500

        # Create and save execution with large process_data
        large_process_data = {"large_field": "x" * 10000, "metadata": "info"}

        # Mock file upload
        mock_file = Mock()
        mock_file.id = "process-data-file-id"
        mock_upload_file.return_value = mock_file

        execution = self.create_test_execution(process_data=large_process_data)
        repository.save(execution)

        # Mock storage load for reconstruction
        mock_storage.load.return_value = json.dumps(large_process_data).encode()

        # Create a new repository instance to simulate fresh load
        session_factory = sessionmaker(bind=in_memory_db_engine)
        new_repository = SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=session_factory,
            user=Mock(spec=Account, id="test-user", tenant_id="test-tenant"),
            app_id="test-app-id",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

        # Load executions from database
        executions = new_repository.get_by_workflow_run("test-run-id")

        assert len(executions) == 1
        loaded_execution = executions[0]

        # Verify that full data is loaded
        assert loaded_execution.process_data == large_process_data
        assert loaded_execution.process_data_truncated is True

        # Verify truncated data for responses
        response_data = loaded_execution.get_response_process_data()
        assert response_data != large_process_data  # Should be truncated version

    def test_process_data_none_handling(self, repository):
        """Test handling of None process_data."""
        execution = self.create_test_execution(process_data=None)
        repository.save(execution)

        # Should handle None gracefully
        assert execution.process_data is None
        assert execution.process_data_truncated is False
        assert execution.get_response_process_data() is None

    def test_empty_process_data_handling(self, repository):
        """Test handling of empty process_data."""
        execution = self.create_test_execution(process_data={})
        repository.save(execution)

        # Should handle empty dict gracefully
        assert execution.process_data == {}
        assert execution.process_data_truncated is False
        assert execution.get_response_process_data() == {}


class TestProcessDataTruncationApiIntegration:
    """Integration tests for API responses with process_data truncation."""

    def test_api_response_includes_truncated_flag(self):
        """Test that API responses include the process_data_truncated flag."""
        from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
        from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
        from core.app.entities.queue_entities import QueueNodeSucceededEvent

        # Create execution with truncated process_data
        execution = WorkflowNodeExecution(
            id="test-execution-id",
            workflow_id="test-workflow-id",
            workflow_execution_id="test-run-id",
            index=1,
            node_id="test-node-id",
            node_type=NodeType.LLM,
            title="Test Node",
            process_data={"large": "x" * 10000},
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            created_at=datetime.now(),
            finished_at=datetime.now(),
        )

        # Set truncated data
        execution.set_truncated_process_data({"large": "[TRUNCATED]"})

        # Create converter and event
        converter = WorkflowResponseConverter(
            application_generate_entity=Mock(spec=WorkflowAppGenerateEntity, app_config=Mock(tenant_id="test-tenant"))
        )

        event = QueueNodeSucceededEvent(
            node_id="test-node-id",
            node_type=NodeType.LLM,
            node_data=Mock(),
            parallel_id=None,
            parallel_start_node_id=None,
            parent_parallel_id=None,
            parent_parallel_start_node_id=None,
            in_iteration_id=None,
            in_loop_id=None,
        )

        # Generate response
        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=execution,
        )

        # Verify response includes truncated flag and data
        assert response is not None
        assert response.data.process_data_truncated is True
        assert response.data.process_data == {"large": "[TRUNCATED]"}

        # Verify response can be serialized
        response_dict = response.to_dict()
        assert "process_data_truncated" in response_dict["data"]
        assert response_dict["data"]["process_data_truncated"] is True

    def test_workflow_run_fields_include_truncated_flag(self):
        """Test that workflow run fields include process_data_truncated."""
        from fields.workflow_run_fields import workflow_run_node_execution_fields

        # Verify the field is included in the definition
        assert "process_data_truncated" in workflow_run_node_execution_fields

        # The field should be a Boolean field
        field = workflow_run_node_execution_fields["process_data_truncated"]
        from flask_restful import fields

        assert isinstance(field, fields.Boolean)
