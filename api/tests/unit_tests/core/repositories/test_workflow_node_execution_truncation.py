"""
Unit tests for WorkflowNodeExecution truncation functionality.

Tests the truncation and offloading logic for large inputs and outputs
in the SQLAlchemyWorkflowNodeExecutionRepository.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock

from sqlalchemy import Engine

from core.repositories.sqlalchemy_workflow_node_execution_repository import (
    SQLAlchemyWorkflowNodeExecutionRepository,
)
from core.workflow.entities.workflow_node_execution import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionStatus,
)
from core.workflow.enums import NodeType
from models import Account, WorkflowNodeExecutionTriggeredFrom
from models.enums import ExecutionOffLoadType
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionOffload


@dataclass
class TruncationTestCase:
    """Test case data for truncation scenarios."""

    name: str
    inputs: dict[str, Any] | None
    outputs: dict[str, Any] | None
    should_truncate_inputs: bool
    should_truncate_outputs: bool
    description: str


def create_test_cases() -> list[TruncationTestCase]:
    """Create test cases for different truncation scenarios."""
    # Create large data that will definitely exceed the threshold (10KB)
    large_data = {"data": "x" * (TRUNCATION_SIZE_THRESHOLD + 1000)}
    small_data = {"data": "small"}

    return [
        TruncationTestCase(
            name="small_data_no_truncation",
            inputs=small_data,
            outputs=small_data,
            should_truncate_inputs=False,
            should_truncate_outputs=False,
            description="Small data should not be truncated",
        ),
        TruncationTestCase(
            name="large_inputs_truncation",
            inputs=large_data,
            outputs=small_data,
            should_truncate_inputs=True,
            should_truncate_outputs=False,
            description="Large inputs should be truncated",
        ),
        TruncationTestCase(
            name="large_outputs_truncation",
            inputs=small_data,
            outputs=large_data,
            should_truncate_inputs=False,
            should_truncate_outputs=True,
            description="Large outputs should be truncated",
        ),
        TruncationTestCase(
            name="large_both_truncation",
            inputs=large_data,
            outputs=large_data,
            should_truncate_inputs=True,
            should_truncate_outputs=True,
            description="Both large inputs and outputs should be truncated",
        ),
        TruncationTestCase(
            name="none_inputs_outputs",
            inputs=None,
            outputs=None,
            should_truncate_inputs=False,
            should_truncate_outputs=False,
            description="None inputs and outputs should not be truncated",
        ),
    ]


def create_workflow_node_execution(
    execution_id: str = "test-execution-id",
    inputs: dict[str, Any] | None = None,
    outputs: dict[str, Any] | None = None,
) -> WorkflowNodeExecution:
    """Factory function to create a WorkflowNodeExecution for testing."""
    return WorkflowNodeExecution(
        id=execution_id,
        node_execution_id="test-node-execution-id",
        workflow_id="test-workflow-id",
        workflow_execution_id="test-workflow-execution-id",
        index=1,
        node_id="test-node-id",
        node_type=NodeType.LLM,
        title="Test Node",
        inputs=inputs,
        outputs=outputs,
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        created_at=datetime.now(UTC),
    )


def mock_user() -> Account:
    """Create a mock Account user for testing."""
    from unittest.mock import MagicMock

    user = MagicMock(spec=Account)
    user.id = "test-user-id"
    user.current_tenant_id = "test-tenant-id"
    return user


class TestSQLAlchemyWorkflowNodeExecutionRepositoryTruncation:
    """Test class for truncation functionality in SQLAlchemyWorkflowNodeExecutionRepository."""

    def create_repository(self) -> SQLAlchemyWorkflowNodeExecutionRepository:
        """Create a repository instance for testing."""
        return SQLAlchemyWorkflowNodeExecutionRepository(
            session_factory=MagicMock(spec=Engine),
            user=mock_user(),
            app_id="test-app-id",
            triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        )

    def test_to_domain_model_without_offload_data(self):
        """Test _to_domain_model correctly handles models without offload data."""
        repo = self.create_repository()

        # Create a mock database model without offload data
        db_model = WorkflowNodeExecutionModel()
        db_model.id = "test-id"
        db_model.node_execution_id = "node-exec-id"
        db_model.workflow_id = "workflow-id"
        db_model.workflow_run_id = "run-id"
        db_model.index = 1
        db_model.predecessor_node_id = None
        db_model.node_id = "node-id"
        db_model.node_type = NodeType.LLM
        db_model.title = "Test Node"
        db_model.inputs = json.dumps({"value": "inputs"})
        db_model.process_data = json.dumps({"value": "process_data"})
        db_model.outputs = json.dumps({"value": "outputs"})
        db_model.status = WorkflowNodeExecutionStatus.SUCCEEDED
        db_model.error = None
        db_model.elapsed_time = 1.0
        db_model.execution_metadata = "{}"
        db_model.created_at = datetime.now(UTC)
        db_model.finished_at = None
        db_model.offload_data = []

        domain_model = repo._to_domain_model(db_model)

        # Check that no truncated data was set
        assert domain_model.get_truncated_inputs() is None
        assert domain_model.get_truncated_outputs() is None


class TestWorkflowNodeExecutionModelTruncatedProperties:
    """Test the truncated properties on WorkflowNodeExecutionModel."""

    def test_inputs_truncated_with_offload_data(self):
        """Test inputs_truncated property when offload data exists."""
        model = WorkflowNodeExecutionModel()
        offload = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.INPUTS)
        model.offload_data = [offload]

        assert model.inputs_truncated is True
        assert model.process_data_truncated is False
        assert model.outputs_truncated is False

    def test_outputs_truncated_with_offload_data(self):
        """Test outputs_truncated property when offload data exists."""
        model = WorkflowNodeExecutionModel()

        # Mock offload data with outputs file
        offload = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.OUTPUTS)
        model.offload_data = [offload]

        assert model.inputs_truncated is False
        assert model.process_data_truncated is False
        assert model.outputs_truncated is True

    def test_process_data_truncated_with_offload_data(self):
        model = WorkflowNodeExecutionModel()
        offload = WorkflowNodeExecutionOffload(type_=ExecutionOffLoadType.PROCESS_DATA)
        model.offload_data = [offload]
        assert model.process_data_truncated is True
        assert model.inputs_truncated is False
        assert model.outputs_truncated is False

    def test_truncated_properties_without_offload_data(self):
        """Test truncated properties when no offload data exists."""
        model = WorkflowNodeExecutionModel()
        model.offload_data = []

        assert model.inputs_truncated is False
        assert model.outputs_truncated is False
        assert model.process_data_truncated is False

    def test_truncated_properties_without_offload_attribute(self):
        """Test truncated properties when offload_data attribute doesn't exist."""
        model = WorkflowNodeExecutionModel()
        # Don't set offload_data attribute at all

        assert model.inputs_truncated is False
        assert model.outputs_truncated is False
        assert model.process_data_truncated is False
