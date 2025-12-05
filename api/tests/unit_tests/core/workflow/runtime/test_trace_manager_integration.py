"""
Unit tests for trace_manager integration across workflow runtime, callback handlers, and tool engine.
"""

import time
from collections.abc import Generator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import Mock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.ops.entities.trace_entity import TraceTaskName
from core.ops.ops_trace_manager import TraceQueueManager, TraceTask
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import (
    ToolDescription,
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolProviderType,
)
from core.tools.tool_engine import ToolEngine
from core.workflow.runtime import GraphRuntimeState, VariablePool
from models.model import AppMode, Message


# Helper mock tool implementation
class MockTool(Tool):
    """A simple mock tool for testing purposes"""

    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        yield ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="Test output")
        )


class TestGraphRuntimeStateTraceManager:
    """Test that GraphRuntimeState is initialized with the correct trace_manager"""

    def test_graph_runtime_state_initializes_with_trace_manager(self):
        """Test that GraphRuntimeState correctly stores the trace_manager"""
        # Arrange
        variable_pool = VariablePool()
        mock_trace_manager = Mock(spec=TraceQueueManager)
        start_time = time.time()

        # Act
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=start_time, trace_manager=mock_trace_manager)

        # Assert
        assert state.trace_manager is mock_trace_manager

    def test_graph_runtime_state_initializes_without_trace_manager(self):
        """Test that GraphRuntimeState can be initialized without trace_manager"""
        # Arrange
        variable_pool = VariablePool()
        start_time = time.time()

        # Act
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=start_time, trace_manager=None)

        # Assert
        assert state.trace_manager is None

    def test_trace_manager_is_read_only(self):
        """Test that trace_manager property is read-only"""
        # Arrange
        variable_pool = VariablePool()
        mock_trace_manager = Mock(spec=TraceQueueManager)
        start_time = time.time()
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=start_time, trace_manager=mock_trace_manager)

        # Assert - trace_manager is read-only, trying to set it should fail
        with pytest.raises(AttributeError):
            state.trace_manager = Mock(spec=TraceQueueManager)


class TestAgentToolCallbackTraceManager:
    """Test that Agent tool callback handler correctly logs tool traces using trace_manager"""

    def test_agent_callback_logs_tool_trace_with_trace_manager(self):
        """Test that on_tool_end logs trace when trace_manager is provided"""
        # Arrange
        callback = DifyAgentCallbackHandler(color="green")
        mock_trace_manager = Mock(spec=TraceQueueManager)
        tool_name = "test_tool"
        tool_inputs = {"param1": "value1"}
        tool_outputs = "test output"
        message_id = "msg_123"
        mock_timer = {"start": datetime.now(UTC), "end": datetime.now(UTC)}

        # Act
        callback.on_tool_end(
            tool_name=tool_name,
            tool_inputs=tool_inputs,
            tool_outputs=tool_outputs,
            message_id=message_id,
            timer=mock_timer,
            trace_manager=mock_trace_manager,
        )

        # Assert
        mock_trace_manager.add_trace_task.assert_called_once()
        call_args = mock_trace_manager.add_trace_task.call_args[0][0]
        assert isinstance(call_args, TraceTask)
        assert call_args.trace_type == TraceTaskName.TOOL_TRACE
        assert call_args.message_id == message_id
        assert call_args.kwargs["tool_name"] == tool_name
        assert call_args.kwargs["tool_inputs"] == tool_inputs
        assert call_args.kwargs["tool_outputs"] == tool_outputs
        assert call_args.timer == mock_timer

    def test_agent_callback_does_not_log_without_trace_manager(self):
        """Test that on_tool_end does nothing when trace_manager is None"""
        # Arrange
        callback = DifyAgentCallbackHandler(color="green")
        tool_name = "test_tool"
        tool_inputs = {"param1": "value1"}
        tool_outputs = "test output"
        message_id = "msg_123"

        # Act - should not raise any exceptions
        callback.on_tool_end(
            tool_name=tool_name,
            tool_inputs=tool_inputs,
            tool_outputs=tool_outputs,
            message_id=message_id,
            timer=None,
            trace_manager=None,
        )

        # Assert - no exception is success


class TestWorkflowToolCallbackTraceManager:
    """Test that Workflow tool callback handler correctly logs workflow tool traces using trace_manager"""

    def test_workflow_callback_logs_tool_trace_with_trace_manager(self):
        """Test that on_tool_execution logs trace when trace_manager is provided"""
        # Arrange
        callback = DifyWorkflowCallbackHandler(color="green")
        mock_trace_manager = Mock(spec=TraceQueueManager)
        tool_name = "workflow_tool"
        tool_inputs = {"input_key": "input_value"}
        tool_outputs = [
            ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="output1")
            ),
            ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="output2")
            ),
        ]
        message_id = "msg_456"
        mock_timer = {"start": datetime.now(UTC), "end": datetime.now(UTC)}

        # Act
        result_generator = callback.on_tool_execution(
            tool_name=tool_name,
            tool_inputs=tool_inputs,
            tool_outputs=iter(tool_outputs),
            message_id=message_id,
            timer=mock_timer,
            trace_manager=mock_trace_manager,
        )

        # Consume the generator
        results = list(result_generator)

        # Assert
        assert len(results) == 2
        mock_trace_manager.add_trace_task.assert_called_once()
        call_args = mock_trace_manager.add_trace_task.call_args[0][0]
        assert isinstance(call_args, TraceTask)
        assert call_args.trace_type == TraceTaskName.TOOL_TRACE
        assert call_args.message_id == message_id
        assert call_args.kwargs["tool_name"] == tool_name
        assert call_args.kwargs["tool_inputs"] == tool_inputs
        assert call_args.kwargs["tool_outputs"] == tool_outputs
        assert call_args.timer == mock_timer

    def test_workflow_callback_does_not_log_without_trace_manager(self):
        """Test that on_tool_execution works without trace_manager"""
        # Arrange
        callback = DifyWorkflowCallbackHandler(color="green")
        tool_name = "workflow_tool"
        tool_inputs = {"input_key": "input_value"}
        tool_outputs = [
            ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="output1")
            )
        ]
        message_id = "msg_789"

        # Act
        result_generator = callback.on_tool_execution(
            tool_name=tool_name,
            tool_inputs=tool_inputs,
            tool_outputs=iter(tool_outputs),
            message_id=message_id,
            timer=None,
            trace_manager=None,
        )

        # Consume the generator - should not raise
        results = list(result_generator)

        # Assert
        assert len(results) == 1


class TestGenerateTaskPipelineDebuggerNoLog:
    """Test that no log is saved in generate_task_pipeline when invoke_from is InvokeFrom.DEBUGGER"""

    @patch("core.app.apps.workflow.generate_task_pipeline.Session")
    def test_save_workflow_app_log_skips_debugger_without_extras(self, mock_session):
        """Test that _save_workflow_app_log returns early for DEBUGGER without extras"""
        from core.app.app_config.entities import WorkflowUIBasedAppConfig
        from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
        from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
        from core.file import FileUploadConfig
        from models.workflow import Workflow

        # Arrange
        mock_workflow = Mock(spec=Workflow)
        mock_workflow.id = "workflow_123"
        mock_workflow.features_dict = {}

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant_1",
            app_id="app_1",
            app_mode=AppMode.WORKFLOW,
            workflow_id="wf_1",
        )

        app_generate_entity = WorkflowAppGenerateEntity(
            task_id="task_123",
            app_config=app_config,
            file_upload_config=Mock(spec=FileUploadConfig),
            inputs={},
            files=[],
            user_id="user_123",
            stream=False,
            invoke_from=InvokeFrom.DEBUGGER,
            workflow_execution_id="exec_123",
            extras={},  # No conversation_id or message_id
            trace_manager=None,
        )

        mock_queue_manager = Mock()
        mock_queue_manager.invoke_from = InvokeFrom.DEBUGGER
        mock_queue_manager.graph_runtime_state = None

        mock_user = Mock()
        mock_user.session_id = "session_123"
        mock_user.id = "user_123"

        mock_draft_var_saver_factory = Mock()

        pipeline = WorkflowAppGenerateTaskPipeline(
            application_generate_entity=app_generate_entity,
            workflow=mock_workflow,
            queue_manager=mock_queue_manager,
            user=mock_user,
            stream=False,
            draft_var_saver_factory=mock_draft_var_saver_factory,
        )

        mock_db_session = Mock()

        # Act
        pipeline._save_workflow_app_log(session=mock_db_session, workflow_run_id="run_123")

        # Assert - session.add should NOT have been called because debugger should skip logging
        mock_db_session.add.assert_not_called()

    @patch("core.app.apps.workflow.generate_task_pipeline.Session")
    def test_save_workflow_app_log_saves_debugger_with_conversation_extras(self, mock_session):
        """Test that _save_workflow_app_log saves for DEBUGGER when extras contains conversation_id"""
        from core.app.app_config.entities import WorkflowUIBasedAppConfig
        from core.app.apps.workflow.generate_task_pipeline import WorkflowAppGenerateTaskPipeline
        from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
        from core.file import FileUploadConfig
        from models.workflow import Workflow

        # Arrange
        mock_workflow = Mock(spec=Workflow)
        mock_workflow.id = "workflow_123"
        mock_workflow.features_dict = {}

        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant_1",
            app_id="app_1",
            app_mode=AppMode.WORKFLOW,
            workflow_id="wf_1",
        )

        app_generate_entity = WorkflowAppGenerateEntity(
            task_id="task_123",
            app_config=app_config,
            file_upload_config=Mock(spec=FileUploadConfig),
            inputs={},
            files=[],
            user_id="user_123",
            stream=False,
            invoke_from=InvokeFrom.DEBUGGER,
            workflow_execution_id="exec_123",
            extras={"conversation_id": "conv_123"},  # Has conversation_id
            trace_manager=None,
        )

        mock_queue_manager = Mock()
        mock_queue_manager.invoke_from = InvokeFrom.DEBUGGER
        mock_queue_manager.graph_runtime_state = None

        mock_user = Mock()
        mock_user.session_id = "session_123"
        mock_user.id = "user_123"

        mock_draft_var_saver_factory = Mock()

        pipeline = WorkflowAppGenerateTaskPipeline(
            application_generate_entity=app_generate_entity,
            workflow=mock_workflow,
            queue_manager=mock_queue_manager,
            user=mock_user,
            stream=False,
            draft_var_saver_factory=mock_draft_var_saver_factory,
        )

        mock_db_session = Mock()

        # Act
        pipeline._save_workflow_app_log(session=mock_db_session, workflow_run_id="run_123")

        # Assert - session.add SHOULD be called because extras has conversation_id
        mock_db_session.add.assert_called_once()


class TestToolEngineTraceManagerPropagation:
    """Test that ToolEngine correctly passes trace_manager to callback handlers during tool invocation"""

    @patch("core.tools.tool_engine.db")
    def test_agent_invoke_passes_trace_manager_to_callback(self, mock_db):
        """Test that agent_invoke passes trace_manager to agent_tool_callback.on_tool_end"""
        # Arrange
        tool_identity = ToolIdentity(
            author="test_author", name="test_tool", label={"en_US": "Test Tool"}, provider="test_provider"
        )
        tool_description = ToolDescription(human={"en_US": "Test description"}, llm="Test LLM description")
        tool_entity = ToolEntity(identity=tool_identity, description=tool_description, parameters=[])

        tool_runtime = ToolRuntime(tenant_id="tenant_123", tool_id="tool_123", invoke_from=InvokeFrom.DEBUGGER)

        mock_tool = MockTool(entity=tool_entity, runtime=tool_runtime)

        mock_callback = Mock(spec=DifyAgentCallbackHandler)
        mock_trace_manager = Mock(spec=TraceQueueManager)

        mock_message = Mock(spec=Message)
        mock_message.id = "msg_123"
        mock_message.conversation_id = "conv_123"

        # Act
        result = ToolEngine.agent_invoke(
            tool=mock_tool,
            tool_parameters={"param1": "value1"},
            user_id="user_123",
            tenant_id="tenant_123",
            message=mock_message,
            invoke_from=InvokeFrom.DEBUGGER,
            agent_tool_callback=mock_callback,
            trace_manager=mock_trace_manager,
            conversation_id="conv_123",
            app_id="app_123",
            message_id="msg_123",
        )

        # Assert
        # Verify that on_tool_start was called
        mock_callback.on_tool_start.assert_called_once_with(tool_name="test_tool", tool_inputs={"param1": "value1"})

        # Verify that on_tool_end was called with trace_manager
        mock_callback.on_tool_end.assert_called_once()
        call_kwargs = mock_callback.on_tool_end.call_args[1]
        assert call_kwargs["trace_manager"] is mock_trace_manager
        assert call_kwargs["message_id"] == "msg_123"

    @patch("core.tools.tool_engine.db")
    def test_generic_invoke_passes_trace_manager_to_callback(self, mock_db):
        """Test that generic_invoke passes trace_manager to workflow_tool_callback.on_tool_execution"""
        # Arrange
        tool_identity = ToolIdentity(
            author="test_author",
            name="workflow_test_tool",
            label={"en_US": "Workflow Test Tool"},
            provider="test_provider",
        )
        tool_description = ToolDescription(human={"en_US": "Test description"}, llm="Test LLM description")
        tool_entity = ToolEntity(identity=tool_identity, description=tool_description, parameters=[])

        tool_runtime = ToolRuntime(tenant_id="tenant_123", tool_id="tool_456", invoke_from=InvokeFrom.DEBUGGER)

        mock_tool = MockTool(entity=tool_entity, runtime=tool_runtime)

        mock_callback = Mock(spec=DifyWorkflowCallbackHandler)
        mock_callback.on_tool_execution = Mock(
            return_value=iter(
                [
                    ToolInvokeMessage(
                        type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="result")
                    )
                ]
            )
        )
        mock_trace_manager = Mock(spec=TraceQueueManager)

        # Act
        result_generator = ToolEngine.generic_invoke(
            tool=mock_tool,
            tool_parameters={"input_key": "input_value"},
            user_id="user_456",
            workflow_tool_callback=mock_callback,
            workflow_call_depth=0,
            conversation_id="conv_456",
            app_id="app_456",
            message_id="msg_456",
            trace_manager=mock_trace_manager,
        )

        # Consume generator
        results = list(result_generator)

        # Assert
        # Verify that on_tool_start was called
        mock_callback.on_tool_start.assert_called_once_with(
            tool_name="workflow_test_tool", tool_inputs={"input_key": "input_value"}
        )

        # Verify that on_tool_execution was called with trace_manager
        mock_callback.on_tool_execution.assert_called_once()
        call_kwargs = mock_callback.on_tool_execution.call_args[1]
        assert call_kwargs["trace_manager"] is mock_trace_manager
        assert call_kwargs["message_id"] == "msg_456"

    @patch("core.tools.tool_engine.db")
    def test_agent_invoke_works_without_trace_manager(self, mock_db):
        """Test that agent_invoke works correctly when trace_manager is None"""
        # Arrange
        tool_identity = ToolIdentity(
            author="test_author", name="test_tool_no_trace", label={"en_US": "Test Tool"}, provider="test_provider"
        )
        tool_description = ToolDescription(human={"en_US": "Test description"}, llm="Test LLM description")
        tool_entity = ToolEntity(identity=tool_identity, description=tool_description, parameters=[])

        tool_runtime = ToolRuntime(tenant_id="tenant_789", tool_id="tool_789", invoke_from=InvokeFrom.DEBUGGER)

        mock_tool = MockTool(entity=tool_entity, runtime=tool_runtime)

        mock_callback = Mock(spec=DifyAgentCallbackHandler)

        mock_message = Mock(spec=Message)
        mock_message.id = "msg_789"
        mock_message.conversation_id = "conv_789"

        # Act - with trace_manager=None
        result = ToolEngine.agent_invoke(
            tool=mock_tool,
            tool_parameters={"param": "value"},
            user_id="user_789",
            tenant_id="tenant_789",
            message=mock_message,
            invoke_from=InvokeFrom.DEBUGGER,
            agent_tool_callback=mock_callback,
            trace_manager=None,  # No trace manager
            conversation_id="conv_789",
            app_id="app_789",
            message_id="msg_789",
        )

        # Assert - should complete without errors
        mock_callback.on_tool_start.assert_called_once()
        mock_callback.on_tool_end.assert_called_once()
        call_kwargs = mock_callback.on_tool_end.call_args[1]
        assert call_kwargs["trace_manager"] is None
