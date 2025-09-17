"""
Unit tests for SQLAlchemyWorkflowNodeExecutionRepository, focusing on process_data truncation functionality.
"""

from datetime import datetime
from typing import Any
from unittest.mock import MagicMock, Mock

from sqlalchemy.orm import sessionmaker

from core.repositories.sqlalchemy_workflow_node_execution_repository import (
    SQLAlchemyWorkflowNodeExecutionRepository,
)
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution
from core.workflow.enums import NodeType
from models import Account, WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom


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
