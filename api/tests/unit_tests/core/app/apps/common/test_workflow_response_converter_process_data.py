"""
Unit tests for WorkflowResponseConverter focusing on process_data truncation functionality.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from unittest.mock import Mock

import pytest

from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.app.entities.queue_entities import QueueNodeRetryEvent, QueueNodeSucceededEvent
from core.workflow.entities.workflow_node_execution import WorkflowNodeExecution, WorkflowNodeExecutionStatus
from core.workflow.enums import NodeType
from libs.datetime_utils import naive_utc_now
from models import Account


@dataclass
class ProcessDataResponseScenario:
    """Test scenario for process_data in responses."""

    name: str
    original_process_data: dict[str, Any] | None
    truncated_process_data: dict[str, Any] | None
    expected_response_data: dict[str, Any] | None
    expected_truncated_flag: bool


class TestWorkflowResponseConverterCenarios:
    """Test process_data truncation in WorkflowResponseConverter."""

    def create_mock_generate_entity(self) -> WorkflowAppGenerateEntity:
        """Create a mock WorkflowAppGenerateEntity."""
        mock_entity = Mock(spec=WorkflowAppGenerateEntity)
        mock_app_config = Mock()
        mock_app_config.tenant_id = "test-tenant-id"
        mock_entity.app_config = mock_app_config
        return mock_entity

    def create_workflow_response_converter(self) -> WorkflowResponseConverter:
        """Create a WorkflowResponseConverter for testing."""

        mock_entity = self.create_mock_generate_entity()
        mock_user = Mock(spec=Account)
        mock_user.id = "test-user-id"
        mock_user.name = "Test User"
        mock_user.email = "test@example.com"

        return WorkflowResponseConverter(application_generate_entity=mock_entity, user=mock_user)

    def create_workflow_node_execution(
        self,
        process_data: dict[str, Any] | None = None,
        truncated_process_data: dict[str, Any] | None = None,
        execution_id: str = "test-execution-id",
    ) -> WorkflowNodeExecution:
        """Create a WorkflowNodeExecution for testing."""
        execution = WorkflowNodeExecution(
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

        if truncated_process_data is not None:
            execution.set_truncated_process_data(truncated_process_data)

        return execution

    def create_node_succeeded_event(self) -> QueueNodeSucceededEvent:
        """Create a QueueNodeSucceededEvent for testing."""
        return QueueNodeSucceededEvent(
            node_id="test-node-id",
            node_type=NodeType.CODE,
            node_execution_id=str(uuid.uuid4()),
            start_at=naive_utc_now(),
            parallel_id=None,
            parallel_start_node_id=None,
            parent_parallel_id=None,
            parent_parallel_start_node_id=None,
            in_iteration_id=None,
            in_loop_id=None,
        )

    def create_node_retry_event(self) -> QueueNodeRetryEvent:
        """Create a QueueNodeRetryEvent for testing."""
        return QueueNodeRetryEvent(
            inputs={"data": "inputs"},
            outputs={"data": "outputs"},
            error="oops",
            retry_index=1,
            node_id="test-node-id",
            node_type=NodeType.CODE,
            node_title="test code",
            provider_type="built-in",
            provider_id="code",
            node_execution_id=str(uuid.uuid4()),
            start_at=naive_utc_now(),
            parallel_id=None,
            parallel_start_node_id=None,
            parent_parallel_id=None,
            parent_parallel_start_node_id=None,
            in_iteration_id=None,
            in_loop_id=None,
        )

    def test_workflow_node_finish_response_uses_truncated_process_data(self):
        """Test that node finish response uses get_response_process_data()."""
        converter = self.create_workflow_response_converter()

        original_data = {"large_field": "x" * 10000, "metadata": "info"}
        truncated_data = {"large_field": "[TRUNCATED]", "metadata": "info"}

        execution = self.create_workflow_node_execution(
            process_data=original_data, truncated_process_data=truncated_data
        )
        event = self.create_node_succeeded_event()

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=execution,
        )

        # Response should use truncated data, not original
        assert response is not None
        assert response.data.process_data == truncated_data
        assert response.data.process_data != original_data
        assert response.data.process_data_truncated is True

    def test_workflow_node_finish_response_without_truncation(self):
        """Test node finish response when no truncation is applied."""
        converter = self.create_workflow_response_converter()

        original_data = {"small": "data"}

        execution = self.create_workflow_node_execution(process_data=original_data)
        event = self.create_node_succeeded_event()

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=execution,
        )

        # Response should use original data
        assert response is not None
        assert response.data.process_data == original_data
        assert response.data.process_data_truncated is False

    def test_workflow_node_finish_response_with_none_process_data(self):
        """Test node finish response when process_data is None."""
        converter = self.create_workflow_response_converter()

        execution = self.create_workflow_node_execution(process_data=None)
        event = self.create_node_succeeded_event()

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=execution,
        )

        # Response should have None process_data
        assert response is not None
        assert response.data.process_data is None
        assert response.data.process_data_truncated is False

    def test_workflow_node_retry_response_uses_truncated_process_data(self):
        """Test that node retry response uses get_response_process_data()."""
        converter = self.create_workflow_response_converter()

        original_data = {"large_field": "x" * 10000, "metadata": "info"}
        truncated_data = {"large_field": "[TRUNCATED]", "metadata": "info"}

        execution = self.create_workflow_node_execution(
            process_data=original_data, truncated_process_data=truncated_data
        )
        event = self.create_node_retry_event()

        response = converter.workflow_node_retry_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=execution,
        )

        # Response should use truncated data, not original
        assert response is not None
        assert response.data.process_data == truncated_data
        assert response.data.process_data != original_data
        assert response.data.process_data_truncated is True

    def test_workflow_node_retry_response_without_truncation(self):
        """Test node retry response when no truncation is applied."""
        converter = self.create_workflow_response_converter()

        original_data = {"small": "data"}

        execution = self.create_workflow_node_execution(process_data=original_data)
        event = self.create_node_retry_event()

        response = converter.workflow_node_retry_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=execution,
        )

        # Response should use original data
        assert response is not None
        assert response.data.process_data == original_data
        assert response.data.process_data_truncated is False

    def test_iteration_and_loop_nodes_return_none(self):
        """Test that iteration and loop nodes return None (no change from existing behavior)."""
        converter = self.create_workflow_response_converter()

        # Test iteration node
        iteration_execution = self.create_workflow_node_execution(process_data={"test": "data"})
        iteration_execution.node_type = NodeType.ITERATION

        event = self.create_node_succeeded_event()

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=iteration_execution,
        )

        # Should return None for iteration nodes
        assert response is None

        # Test loop node
        loop_execution = self.create_workflow_node_execution(process_data={"test": "data"})
        loop_execution.node_type = NodeType.LOOP

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=loop_execution,
        )

        # Should return None for loop nodes
        assert response is None

    def test_execution_without_workflow_execution_id_returns_none(self):
        """Test that executions without workflow_execution_id return None."""
        converter = self.create_workflow_response_converter()

        execution = self.create_workflow_node_execution(process_data={"test": "data"})
        execution.workflow_execution_id = None  # Single-step debugging

        event = self.create_node_succeeded_event()

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=execution,
        )

        # Should return None for single-step debugging
        assert response is None

    @staticmethod
    def get_process_data_response_scenarios() -> list[ProcessDataResponseScenario]:
        """Create test scenarios for process_data responses."""
        return [
            ProcessDataResponseScenario(
                name="none_process_data",
                original_process_data=None,
                truncated_process_data=None,
                expected_response_data=None,
                expected_truncated_flag=False,
            ),
            ProcessDataResponseScenario(
                name="small_process_data_no_truncation",
                original_process_data={"small": "data"},
                truncated_process_data=None,
                expected_response_data={"small": "data"},
                expected_truncated_flag=False,
            ),
            ProcessDataResponseScenario(
                name="large_process_data_with_truncation",
                original_process_data={"large": "x" * 10000, "metadata": "info"},
                truncated_process_data={"large": "[TRUNCATED]", "metadata": "info"},
                expected_response_data={"large": "[TRUNCATED]", "metadata": "info"},
                expected_truncated_flag=True,
            ),
            ProcessDataResponseScenario(
                name="empty_process_data",
                original_process_data={},
                truncated_process_data=None,
                expected_response_data={},
                expected_truncated_flag=False,
            ),
            ProcessDataResponseScenario(
                name="complex_data_with_truncation",
                original_process_data={
                    "logs": ["entry"] * 1000,  # Large array
                    "config": {"setting": "value"},
                    "status": "processing",
                },
                truncated_process_data={
                    "logs": "[TRUNCATED: 1000 items]",
                    "config": {"setting": "value"},
                    "status": "processing",
                },
                expected_response_data={
                    "logs": "[TRUNCATED: 1000 items]",
                    "config": {"setting": "value"},
                    "status": "processing",
                },
                expected_truncated_flag=True,
            ),
        ]

    @pytest.mark.parametrize(
        "scenario",
        get_process_data_response_scenarios(),
        ids=[scenario.name for scenario in get_process_data_response_scenarios()],
    )
    def test_node_finish_response_scenarios(self, scenario: ProcessDataResponseScenario):
        """Test various scenarios for node finish responses."""

        mock_user = Mock(spec=Account)
        mock_user.id = "test-user-id"
        mock_user.name = "Test User"
        mock_user.email = "test@example.com"

        converter = WorkflowResponseConverter(
            application_generate_entity=Mock(spec=WorkflowAppGenerateEntity, app_config=Mock(tenant_id="test-tenant")),
            user=mock_user,
        )

        execution = WorkflowNodeExecution(
            id="test-execution-id",
            workflow_id="test-workflow-id",
            workflow_execution_id="test-run-id",
            index=1,
            node_id="test-node-id",
            node_type=NodeType.LLM,
            title="Test Node",
            process_data=scenario.original_process_data,
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            created_at=datetime.now(),
            finished_at=datetime.now(),
        )

        if scenario.truncated_process_data is not None:
            execution.set_truncated_process_data(scenario.truncated_process_data)

        event = QueueNodeSucceededEvent(
            node_id="test-node-id",
            node_type=NodeType.CODE,
            node_execution_id=str(uuid.uuid4()),
            start_at=naive_utc_now(),
            parallel_id=None,
            parallel_start_node_id=None,
            parent_parallel_id=None,
            parent_parallel_start_node_id=None,
            in_iteration_id=None,
            in_loop_id=None,
        )

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=execution,
        )

        assert response is not None
        assert response.data.process_data == scenario.expected_response_data
        assert response.data.process_data_truncated == scenario.expected_truncated_flag

    @pytest.mark.parametrize(
        "scenario",
        get_process_data_response_scenarios(),
        ids=[scenario.name for scenario in get_process_data_response_scenarios()],
    )
    def test_node_retry_response_scenarios(self, scenario: ProcessDataResponseScenario):
        """Test various scenarios for node retry responses."""

        mock_user = Mock(spec=Account)
        mock_user.id = "test-user-id"
        mock_user.name = "Test User"
        mock_user.email = "test@example.com"

        converter = WorkflowResponseConverter(
            application_generate_entity=Mock(spec=WorkflowAppGenerateEntity, app_config=Mock(tenant_id="test-tenant")),
            user=mock_user,
        )

        execution = WorkflowNodeExecution(
            id="test-execution-id",
            workflow_id="test-workflow-id",
            workflow_execution_id="test-run-id",
            index=1,
            node_id="test-node-id",
            node_type=NodeType.LLM,
            title="Test Node",
            process_data=scenario.original_process_data,
            status=WorkflowNodeExecutionStatus.FAILED,  # Retry scenario
            created_at=datetime.now(),
            finished_at=datetime.now(),
        )

        if scenario.truncated_process_data is not None:
            execution.set_truncated_process_data(scenario.truncated_process_data)

        event = self.create_node_retry_event()

        response = converter.workflow_node_retry_to_stream_response(
            event=event,
            task_id="test-task-id",
            workflow_node_execution=execution,
        )

        assert response is not None
        assert response.data.process_data == scenario.expected_response_data
        assert response.data.process_data_truncated == scenario.expected_truncated_flag
