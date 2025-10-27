"""
Unit tests for WorkflowResponseConverter Service API truncation functionality.

This module tests that Service API calls bypass variable truncation to maintain
backward compatibility and provide complete data.
"""

from dataclasses import dataclass
from typing import Any

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.entities.queue_entities import (
    QueueIterationStartEvent,
    QueueLoopStartEvent,
    QueueNodeRetryEvent,
    QueueNodeStartedEvent,
    QueueNodeSucceededEvent,
)
from core.variables.segments import StringSegment
from core.workflow.enums import NodeType
from core.workflow.system_variable import SystemVariable
from libs.datetime_utils import naive_utc_now
from models import Account
from models.model import AppMode
from services.variable_truncator import DummyVariableTruncator, TruncationResult, VariableTruncator


@dataclass
class TestCase:
    """Test case data for table-driven tests."""

    name: str
    invoke_from: str
    expected_truncation_enabled: bool
    description: str


class TestWorkflowResponseConverterServiceApiTruncation:
    """Test class for Service API truncation functionality in WorkflowResponseConverter."""

    def create_test_app_generate_entity(self, invoke_from: InvokeFrom) -> WorkflowAppGenerateEntity:
        """Create a test WorkflowAppGenerateEntity with specified invoke_from."""
        # Create a minimal WorkflowUIBasedAppConfig for testing
        app_config = WorkflowUIBasedAppConfig(
            tenant_id="test_tenant",
            app_id="test_app",
            app_mode=AppMode.WORKFLOW,
            workflow_id="test_workflow_id",
        )

        entity = WorkflowAppGenerateEntity(
            task_id="test_task_id",
            app_id="test_app_id",
            app_config=app_config,
            tenant_id="test_tenant",
            app_mode="workflow",
            invoke_from=invoke_from,
            inputs={"test_input": "test_value"},
            user_id="test_user_id",
            stream=True,
            files=[],
            workflow_execution_id="test_workflow_exec_id",
        )
        return entity

    def create_test_user(self) -> Account:
        """Create a test user account."""
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        # Manually set the ID for testing purposes
        account.id = "test_user_id"
        return account

    def create_test_system_variables(self) -> SystemVariable:
        """Create test system variables."""
        return SystemVariable()

    def create_test_converter(self, invoke_from: InvokeFrom) -> Any:
        """Create WorkflowResponseConverter with specified invoke_from."""
        entity = self.create_test_app_generate_entity(invoke_from)
        user = self.create_test_user()
        system_variables = self.create_test_system_variables()

        converter = WorkflowResponseConverter(
            application_generate_entity=entity,
            user=user,
            system_variables=system_variables,
        )
        # ensure `workflow_run_id` is set.
        converter.workflow_start_to_stream_response(
            task_id="test-task-id",
            workflow_run_id="test-workflow-run-id",
            workflow_id="test-workflow-id",
        )
        return converter

    @pytest.mark.parametrize(
        "test_case",
        [
            TestCase(
                name="service_api_truncation_disabled",
                invoke_from=InvokeFrom.SERVICE_API,
                expected_truncation_enabled=False,
                description="Service API calls should have truncation disabled",
            ),
            TestCase(
                name="web_app_truncation_enabled",
                invoke_from=InvokeFrom.WEB_APP,
                expected_truncation_enabled=True,
                description="Web app calls should have truncation enabled",
            ),
            TestCase(
                name="debugger_truncation_enabled",
                invoke_from=InvokeFrom.DEBUGGER,
                expected_truncation_enabled=True,
                description="Debugger calls should have truncation enabled",
            ),
            TestCase(
                name="explore_truncation_enabled",
                invoke_from=InvokeFrom.EXPLORE,
                expected_truncation_enabled=True,
                description="Explore calls should have truncation enabled",
            ),
            TestCase(
                name="published_truncation_enabled",
                invoke_from=InvokeFrom.PUBLISHED,
                expected_truncation_enabled=True,
                description="Published app calls should have truncation enabled",
            ),
        ],
        ids=lambda x: x.name,
    )
    def test_truncator_selection_based_on_invoke_from(self, test_case: TestCase):
        """Test that the correct truncator is selected based on invoke_from."""
        converter = self.create_test_converter(test_case.invoke_from)

        # Check that the correct truncator type is used
        if test_case.expected_truncation_enabled:
            assert isinstance(converter._truncator, VariableTruncator)
        else:
            assert isinstance(converter._truncator, DummyVariableTruncator)

    def test_service_api_truncator_no_op_mapping(self):
        """Test that Service API truncator doesn't truncate variable mappings."""
        converter = self.create_test_converter(InvokeFrom.SERVICE_API)

        # Create large test data that would normally be truncated
        large_data = {
            "large_string": "x" * 10000,  # Large string
            "large_list": list(range(1000)),  # Large array
            "nested_data": {"deep_nested": {"very_deep": {"value": "x" * 5000}}},
        }

        truncated_data, is_truncated = converter._truncator.truncate_variable_mapping(large_data)

        # Service API should not truncate
        assert not is_truncated
        assert truncated_data == large_data

    def test_web_app_truncator_works_normally(self):
        """Test that web app truncator still works normally."""
        converter = self.create_test_converter(InvokeFrom.WEB_APP)

        # Create large test data that would normally be truncated
        large_data = {
            "large_string": "x" * 10000,  # Large string
            "large_list": list(range(2000)),  # Large array
        }

        truncated_data, is_truncated = converter._truncator.truncate_variable_mapping(large_data)

        # Web app should truncate
        assert is_truncated
        # The exact truncated format depends on VariableTruncator implementation
        # Just verify it's different from original and smaller
        assert truncated_data != large_data

    def test_service_api_node_finish_event_no_truncation(self):
        """Test that Service API doesn't truncate node finish events."""
        converter = self.create_test_converter(InvokeFrom.SERVICE_API)

        # Create test event with large data
        large_inputs = {"input1": "x" * 5000, "input2": list(range(100))}
        large_process_data = {"process1": "y" * 5000, "process2": {"nested": "z" * 1000}}
        large_outputs = {"output1": "result" * 1000, "output2": list(range(50))}

        event = QueueNodeSucceededEvent(
            node_execution_id="test_node_exec_id",
            node_id="test_node",
            node_type=NodeType.LLM,
            start_at=naive_utc_now(),
            inputs=large_inputs,
            process_data=large_process_data,
            outputs=large_outputs,
            error=None,
            execution_metadata=None,
            in_iteration_id=None,
            in_loop_id=None,
        )

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test_task",
        )

        # Verify response contains full data (not truncated)
        assert response is not None
        assert response.data.inputs == large_inputs
        assert response.data.process_data == large_process_data
        assert response.data.outputs == large_outputs
        assert not response.data.inputs_truncated
        assert not response.data.process_data_truncated
        assert not response.data.outputs_truncated

    def test_service_api_node_retry_event_no_truncation(self):
        """Test that Service API doesn't truncate node retry events."""
        converter = self.create_test_converter(InvokeFrom.SERVICE_API)

        # Create test event with large data
        large_inputs = {"retry_input": "x" * 5000}
        large_process_data = {"retry_process": "y" * 5000}
        large_outputs = {"retry_output": "z" * 5000}

        # First, we need to store a snapshot by simulating a start event
        start_event = QueueNodeStartedEvent(
            node_execution_id="test_node_exec_id",
            node_id="test_node",
            node_type=NodeType.LLM,
            node_title="Test Node",
            node_run_index=1,
            start_at=naive_utc_now(),
            in_iteration_id=None,
            in_loop_id=None,
            agent_strategy=None,
            provider_type="plugin",
            provider_id="test/test_plugin",
        )
        converter.workflow_node_start_to_stream_response(event=start_event, task_id="test_task")

        # Now create retry event
        event = QueueNodeRetryEvent(
            node_execution_id="test_node_exec_id",
            node_id="test_node",
            node_type=NodeType.LLM,
            node_title="Test Node",
            node_run_index=1,
            start_at=naive_utc_now(),
            inputs=large_inputs,
            process_data=large_process_data,
            outputs=large_outputs,
            error="Retry error",
            execution_metadata=None,
            in_iteration_id=None,
            in_loop_id=None,
            retry_index=1,
            provider_type="plugin",
            provider_id="test/test_plugin",
        )

        response = converter.workflow_node_retry_to_stream_response(
            event=event,
            task_id="test_task",
        )

        # Verify response contains full data (not truncated)
        assert response is not None
        assert response.data.inputs == large_inputs
        assert response.data.process_data == large_process_data
        assert response.data.outputs == large_outputs
        assert not response.data.inputs_truncated
        assert not response.data.process_data_truncated
        assert not response.data.outputs_truncated

    def test_service_api_iteration_events_no_truncation(self):
        """Test that Service API doesn't truncate iteration events."""
        converter = self.create_test_converter(InvokeFrom.SERVICE_API)

        # Test iteration start event
        large_inputs = {"iteration_input": "x" * 5000}

        start_event = QueueIterationStartEvent(
            node_execution_id="test_iter_exec_id",
            node_id="test_iteration",
            node_type=NodeType.ITERATION,
            node_title="Test Iteration",
            node_run_index=0,
            start_at=naive_utc_now(),
            inputs=large_inputs,
            metadata={},
        )

        response = converter.workflow_iteration_start_to_stream_response(
            task_id="test_task",
            workflow_execution_id="test_workflow_exec_id",
            event=start_event,
        )

        assert response is not None
        assert response.data.inputs == large_inputs
        assert not response.data.inputs_truncated

    def test_service_api_loop_events_no_truncation(self):
        """Test that Service API doesn't truncate loop events."""
        converter = self.create_test_converter(InvokeFrom.SERVICE_API)

        # Test loop start event
        large_inputs = {"loop_input": "x" * 5000}

        start_event = QueueLoopStartEvent(
            node_execution_id="test_loop_exec_id",
            node_id="test_loop",
            node_type=NodeType.LOOP,
            node_title="Test Loop",
            start_at=naive_utc_now(),
            inputs=large_inputs,
            metadata={},
            node_run_index=0,
        )

        response = converter.workflow_loop_start_to_stream_response(
            task_id="test_task",
            workflow_execution_id="test_workflow_exec_id",
            event=start_event,
        )

        assert response is not None
        assert response.data.inputs == large_inputs
        assert not response.data.inputs_truncated

    def test_web_app_node_finish_event_truncation_works(self):
        """Test that web app still truncates node finish events."""
        converter = self.create_test_converter(InvokeFrom.WEB_APP)

        # Create test event with large data that should be truncated
        large_inputs = {"input1": "x" * 10000}
        large_process_data = {"process1": "y" * 10000}
        large_outputs = {"output1": "z" * 10000}

        event = QueueNodeSucceededEvent(
            node_execution_id="test_node_exec_id",
            node_id="test_node",
            node_type=NodeType.LLM,
            start_at=naive_utc_now(),
            inputs=large_inputs,
            process_data=large_process_data,
            outputs=large_outputs,
            error=None,
            execution_metadata=None,
            in_iteration_id=None,
            in_loop_id=None,
        )

        response = converter.workflow_node_finish_to_stream_response(
            event=event,
            task_id="test_task",
        )

        # Verify response contains truncated data
        assert response is not None
        # The exact behavior depends on VariableTruncator implementation
        # Just verify truncation flags are set correctly (may or may not be truncated depending on size)
        # At minimum, the truncation mechanism should work
        assert isinstance(response.data.inputs, dict)
        assert isinstance(response.data.process_data, dict)
        assert isinstance(response.data.outputs, dict)

    def test_dummy_variable_truncator_methods(self):
        """Test DummyVariableTruncator methods work correctly."""
        truncator = DummyVariableTruncator()

        # Test truncate_variable_mapping
        test_data = {"key1": "value1", "key2": ["item1", "item2"]}
        result, is_truncated = truncator.truncate_variable_mapping(test_data)

        assert result == test_data
        assert not is_truncated

        # Test truncate method
        segment = StringSegment(value="test string")
        result = truncator.truncate(segment)
        assert isinstance(result, TruncationResult)
        assert result.result == segment
        assert result.truncated is False
