"""
Unit tests for WorkflowResponseConverter focusing on process_data truncation functionality.
"""

import uuid
from collections.abc import Mapping
from typing import Any
from unittest.mock import Mock

import pytest

from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
)
from core.workflow.enums import NodeType
from core.workflow.system_variable import SystemVariable
from libs.datetime_utils import naive_utc_now
from models import Account


class TestWorkflowResponseConverterCenarios:
    """Test process_data truncation in WorkflowResponseConverter."""

    def create_mock_generate_entity(self) -> WorkflowAppGenerateEntity:
        """Create a mock WorkflowAppGenerateEntity."""
        mock_entity = Mock(spec=WorkflowAppGenerateEntity)
        mock_app_config = Mock()
        mock_app_config.tenant_id = "test-tenant-id"
        mock_entity.app_config = mock_app_config
        mock_entity.inputs = {}
        return mock_entity

    def create_workflow_response_converter(self) -> WorkflowResponseConverter:
        """Create a WorkflowResponseConverter for testing."""

        mock_entity = self.create_mock_generate_entity()
        mock_user = Mock(spec=Account)
        mock_user.id = "test-user-id"
        mock_user.name = "Test User"
        mock_user.email = "test@example.com"

        system_variables = SystemVariable(workflow_id="wf-id", workflow_execution_id="initial-run-id")
        return WorkflowResponseConverter(
            application_generate_entity=mock_entity,
            user=mock_user,
            system_variables=system_variables,
        )

    def create_node_started_event(self, *, node_execution_id: str | None = None) -> QueueNodeStartedEvent:
        """Create a QueueNodeStartedEvent for testing."""
        return QueueNodeStartedEvent(
            node_execution_id=node_execution_id or str(uuid.uuid4()),
            node_id="test-node-id",
            node_title="Test Node",
            node_type=NodeType.CODE,
            start_at=naive_utc_now(),
            predecessor_node_id=None,
            in_iteration_id=None,
            in_loop_id=None,
            provider_type="built-in",
            provider_id="code",
        )

    def create_node_succeeded_event(
        self,
        *,
        node_execution_id: str,
        process_data: Mapping[str, Any] | None = None,
    ) -> QueueNodeSucceededEvent:
        """Create a QueueNodeSucceededEvent for testing."""
        return QueueNodeSucceededEvent(
            node_id="test-node-id",
            node_type=NodeType.CODE,
            node_execution_id=node_execution_id,
            start_at=naive_utc_now(),
            parallel_id=None,
            parallel_start_node_id=None,
            parent_parallel_id=None,
            parent_parallel_start_node_id=None,
            in_iteration_id=None,
            in_loop_id=None,
            inputs={},
            process_data=process_data or {},
            outputs={},
            execution_metadata={},
        )

    def create_node_retry_event(
        self,
        *,
        node_execution_id: str,
        process_data: Mapping[str, Any] | None = None,
    ) -> QueueNodeRetryEvent:
        """Create a QueueNodeRetryEvent for testing."""
        return QueueNodeRetryEvent(
            inputs={"data": "inputs"},
            outputs={"data": "outputs"},
            process_data=process_data or {},
            error="oops",
            retry_index=1,
            node_id="test-node-id",
            node_type=NodeType.CODE,
            node_title="test code",
            provider_type="built-in",
            provider_id="code",
            node_execution_id=node_execution_id,
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

        converter.workflow_start_to_stream_response(task_id="bootstrap", workflow_run_id="run-id", workflow_id="wf-id")
        start_event = self.create_node_started_event()
        converter.workflow_node_start_to_stream_response(
            event=start_event,
            task_id="test-task-id",
        )

        event = self.create_node_succeeded_event(
            node_execution_id=start_event.node_execution_id,
            process_data=original_data,
        )

        def fake_truncate(mapping):
            if mapping == dict(original_data):
                return truncated_data, True
            return mapping, False

        converter._truncator.truncate_variable_mapping = fake_truncate  # type: ignore[assignment]

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
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

        converter.workflow_start_to_stream_response(task_id="bootstrap", workflow_run_id="run-id", workflow_id="wf-id")
        start_event = self.create_node_started_event()
        converter.workflow_node_start_to_stream_response(
            event=start_event,
            task_id="test-task-id",
        )

        event = self.create_node_succeeded_event(
            node_execution_id=start_event.node_execution_id,
            process_data=original_data,
        )

        def fake_truncate(mapping):
            return mapping, False

        converter._truncator.truncate_variable_mapping = fake_truncate  # type: ignore[assignment]

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
        )

        # Response should use original data
        assert response is not None
        assert response.data.process_data == original_data
        assert response.data.process_data_truncated is False

    def test_workflow_node_finish_response_with_none_process_data(self):
        """Test node finish response when process_data is None."""
        converter = self.create_workflow_response_converter()

        converter.workflow_start_to_stream_response(task_id="bootstrap", workflow_run_id="run-id", workflow_id="wf-id")
        start_event = self.create_node_started_event()
        converter.workflow_node_start_to_stream_response(
            event=start_event,
            task_id="test-task-id",
        )

        event = self.create_node_succeeded_event(
            node_execution_id=start_event.node_execution_id,
            process_data=None,
        )

        def fake_truncate(mapping):
            return mapping, False

        converter._truncator.truncate_variable_mapping = fake_truncate  # type: ignore[assignment]

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test-task-id",
        )

        # Response should normalize missing process_data to an empty mapping
        assert response is not None
        assert response.data.process_data == {}
        assert response.data.process_data_truncated is False

    def test_workflow_node_retry_response_uses_truncated_process_data(self):
        """Test that node retry response uses get_response_process_data()."""
        converter = self.create_workflow_response_converter()

        original_data = {"large_field": "x" * 10000, "metadata": "info"}
        truncated_data = {"large_field": "[TRUNCATED]", "metadata": "info"}

        converter.workflow_start_to_stream_response(task_id="bootstrap", workflow_run_id="run-id", workflow_id="wf-id")
        start_event = self.create_node_started_event()
        converter.workflow_node_start_to_stream_response(
            event=start_event,
            task_id="test-task-id",
        )

        event = self.create_node_retry_event(
            node_execution_id=start_event.node_execution_id,
            process_data=original_data,
        )

        def fake_truncate(mapping):
            if mapping == dict(original_data):
                return truncated_data, True
            return mapping, False

        converter._truncator.truncate_variable_mapping = fake_truncate  # type: ignore[assignment]

        response = converter.workflow_node_retry_to_stream_response(
            event=event,
            task_id="test-task-id",
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

        converter.workflow_start_to_stream_response(task_id="bootstrap", workflow_run_id="run-id", workflow_id="wf-id")
        start_event = self.create_node_started_event()
        converter.workflow_node_start_to_stream_response(
            event=start_event,
            task_id="test-task-id",
        )

        event = self.create_node_retry_event(
            node_execution_id=start_event.node_execution_id,
            process_data=original_data,
        )

        def fake_truncate(mapping):
            return mapping, False

        converter._truncator.truncate_variable_mapping = fake_truncate  # type: ignore[assignment]

        response = converter.workflow_node_retry_to_stream_response(
            event=event,
            task_id="test-task-id",
        )

        assert response is not None
        assert response.data.process_data == original_data
        assert response.data.process_data_truncated is False

    def test_iteration_and_loop_nodes_return_none(self):
        """Test that iteration and loop nodes return None (no streaming events)."""
        converter = self.create_workflow_response_converter()

        iteration_event = QueueNodeSucceededEvent(
            node_id="iteration-node",
            node_type=NodeType.ITERATION,
            node_execution_id=str(uuid.uuid4()),
            start_at=naive_utc_now(),
            parallel_id=None,
            parallel_start_node_id=None,
            parent_parallel_id=None,
            parent_parallel_start_node_id=None,
            in_iteration_id=None,
            in_loop_id=None,
            inputs={},
            process_data={},
            outputs={},
            execution_metadata={},
        )

        response = converter.workflow_node_finish_to_stream_response(
            event=iteration_event,
            task_id="test-task-id",
        )
        assert response is None

        loop_event = iteration_event.model_copy(update={"node_type": NodeType.LOOP})
        response = converter.workflow_node_finish_to_stream_response(
            event=loop_event,
            task_id="test-task-id",
        )
        assert response is None

    def test_finish_without_start_raises(self):
        """Ensure finish responses require a prior workflow start."""
        converter = self.create_workflow_response_converter()
        event = self.create_node_succeeded_event(
            node_execution_id=str(uuid.uuid4()),
            process_data={},
        )

        with pytest.raises(ValueError):
            converter.workflow_node_finish_to_stream_response(
                event=event,
                task_id="test-task-id",
            )
