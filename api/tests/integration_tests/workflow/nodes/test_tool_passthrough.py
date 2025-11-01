import time
from unittest.mock import MagicMock, patch

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams, GraphRuntimeState, VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph import Graph
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.nodes.tool.tool_node import ToolNode
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom


def init_tool_node_with_passthrough(config: dict, passthrough_value: str | None = None):
    """Initialize a tool node with passthrough parameter"""
    graph_config = {
        "edges": [
            {
                "id": "start-source-next-target",
                "source": "start",
                "target": "1",
            },
        ],
        "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}, config],
    }

    init_params = GraphInitParams(
        tenant_id="550e8400-e29b-41d4-a716-446655440000",
        app_id="550e8400-e29b-41d4-a716-446655440001",
        workflow_id="550e8400-e29b-41d4-a716-446655440002",
        graph_config=graph_config,
        user_id="550e8400-e29b-41d4-a716-446655440003",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool with passthrough
    system_variable = SystemVariable(user_id="aaa", files=[])
    if passthrough_value:
        system_variable.passthrough = passthrough_value

    variable_pool = VariablePool(
        system_variables=system_variable,
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    # Create node factory
    node_factory = DifyNodeFactory(graph_init_params=init_params, graph_runtime_state=graph_runtime_state)
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    # Create tool node directly
    import uuid

    tool_node = ToolNode(
        id=str(uuid.uuid4()),
        config=config,
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )
    tool_node.init_node_data(config.get("data", {}))
    return tool_node


class TestToolNodePassthrough:
    """Test passthrough parameter functionality in tool nodes"""

    def test_tool_node_with_passthrough_parameter(self):
        """Test that tool node correctly passes passthrough parameter to tools"""
        # Mock tool configuration
        tool_config = {
            "data": {
                "type": "tool",
                "title": "Current Time Tool",
                "desc": "Get current time",
                "provider_type": "builtin",
                "provider_id": "time",
                "provider_name": "time",
                "tool_name": "current_time",
                "tool_label": "current_time",
                "tool_configurations": {},
                "tool_parameters": {"timezone": {"type": "constant", "value": "UTC"}},
            },
            "id": "1",
        }

        # Initialize tool node with passthrough
        passthrough_value = "test_passthrough_data"
        tool_node = init_tool_node_with_passthrough(tool_config, passthrough_value)

        # Mock the tool runtime and invoke method
        with patch("core.tools.tool_engine.ToolEngine.generic_invoke") as mock_invoke:
            # Configure mock to return a generator
            from core.tools.entities.tool_entities import ToolInvokeMessage

            mock_message = ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="Test response")
            )
            mock_invoke.return_value = iter([mock_message])

            # Run the tool node
            events = list(tool_node._run())

            # Verify that generic_invoke was called with passthrough parameter
            mock_invoke.assert_called_once()
            call_args = mock_invoke.call_args

            # Check that passthrough parameter was passed
            assert "passthrough" in call_args.kwargs
            assert call_args.kwargs["passthrough"] == passthrough_value

    def test_tool_node_without_passthrough_parameter(self):
        """Test that tool node works correctly when no passthrough parameter is provided"""
        # Mock tool configuration
        tool_config = {
            "data": {
                "type": "tool",
                "title": "Current Time Tool",
                "desc": "Get current time",
                "provider_type": "builtin",
                "provider_id": "time",
                "provider_name": "time",
                "tool_name": "current_time",
                "tool_label": "current_time",
                "tool_configurations": {},
                "tool_parameters": {"timezone": {"type": "constant", "value": "UTC"}},
            },
            "id": "1",
        }

        # Initialize tool node without passthrough
        tool_node = init_tool_node_with_passthrough(tool_config, None)

        # Mock the tool runtime and invoke method
        with patch("core.tools.tool_engine.ToolEngine.generic_invoke") as mock_invoke:
            # Configure mock to return a generator
            from core.tools.entities.tool_entities import ToolInvokeMessage

            mock_message = ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT, message=ToolInvokeMessage.TextMessage(text="Test response")
            )
            mock_invoke.return_value = iter([mock_message])

            # Run the tool node
            events = list(tool_node._run())

            # Verify that generic_invoke was called with None passthrough
            mock_invoke.assert_called_once()
            call_args = mock_invoke.call_args

            # Check that passthrough parameter was None
            assert "passthrough" in call_args.kwargs
            assert call_args.kwargs["passthrough"] is None

    def test_system_variable_passthrough_extraction(self):
        """Test that SystemVariable correctly handles passthrough parameter"""
        # Test with passthrough value
        system_var_with_passthrough = SystemVariable(user_id="test_user", files=[], passthrough="test_data")

        # Test to_dict method includes passthrough
        var_dict = system_var_with_passthrough.to_dict()
        assert SystemVariableKey.PASSTHROUGH in var_dict
        assert var_dict[SystemVariableKey.PASSTHROUGH] == "test_data"

        # Test without passthrough value
        system_var_without_passthrough = SystemVariable(user_id="test_user", files=[])

        var_dict = system_var_without_passthrough.to_dict()
        assert SystemVariableKey.PASSTHROUGH not in var_dict

    def test_workflow_service_passthrough_extraction(self):
        """Test that _setup_variable_pool correctly extracts passthrough from user_inputs"""
        from core.workflow.enums import NodeType, WorkflowType
        from services.workflow_service import _setup_variable_pool

        # Mock workflow
        mock_workflow = MagicMock()
        mock_workflow.app_id = "test_app"
        mock_workflow.id = "test_workflow"
        mock_workflow.type = WorkflowType.WORKFLOW
        mock_workflow.environment_variables = []

        # Test with passthrough in user_inputs
        user_inputs_with_passthrough = {"query": "test query", "passthrough": "test_passthrough_data"}

        variable_pool = _setup_variable_pool(
            query="test query",
            files=[],
            user_id="test_user",
            user_inputs=user_inputs_with_passthrough,
            workflow=mock_workflow,
            node_type=NodeType.START,
            conversation_id="test_conversation",
            conversation_variables=[],
        )

        # Verify passthrough was extracted
        assert variable_pool.system_variables.passthrough == "test_passthrough_data"

        # Test without passthrough in user_inputs
        user_inputs_without_passthrough = {"query": "test query"}

        variable_pool = _setup_variable_pool(
            query="test query",
            files=[],
            user_id="test_user",
            user_inputs=user_inputs_without_passthrough,
            workflow=mock_workflow,
            node_type=NodeType.START,
            conversation_id="test_conversation",
            conversation_variables=[],
        )

        # Verify passthrough was None
        assert variable_pool.system_variables.passthrough is None


class TestPluginToolManagerPassthrough:
    """Test passthrough parameter functionality in plugin tool manager"""

    def test_plugin_tool_manager_invoke_with_passthrough(self):
        """Test that PluginToolManager correctly passes passthrough parameter"""
        from core.plugin.impl.tool import PluginToolManager

        # Mock the plugin tool manager
        with patch.object(PluginToolManager, "_request_with_plugin_daemon_response_stream") as mock_request:
            # Configure mock to return a generator
            mock_response = MagicMock()
            mock_request.return_value = iter([mock_response])

            # Create plugin tool manager instance
            manager = PluginToolManager()

            # Test invoke with passthrough
            passthrough_value = "test_passthrough_data"
            list(
                manager.invoke(
                    tenant_id="test_tenant",
                    user_id="test_user",
                    tool_provider="test_provider",
                    tool_name="test_tool",
                    credentials={},
                    credential_type="api-key",
                    tool_parameters={"param1": "value1"},
                    conversation_id="test_conversation",
                    app_id="test_app",
                    message_id="test_message",
                    passthrough=passthrough_value,
                )
            )

            # Verify that passthrough was included in the request data
            mock_request.assert_called_once()
            call_args = mock_request.call_args

            # Check that passthrough was included in data
            data = call_args.kwargs["data"]
            assert "passthrough" in data
            assert data["passthrough"] == passthrough_value

    def test_plugin_tool_manager_invoke_without_passthrough(self):
        """Test that PluginToolManager works correctly when no passthrough is provided"""
        from core.plugin.impl.tool import PluginToolManager

        # Mock the plugin tool manager
        with patch.object(PluginToolManager, "_request_with_plugin_daemon_response_stream") as mock_request:
            # Configure mock to return a generator
            mock_response = MagicMock()
            mock_request.return_value = iter([mock_response])

            # Create plugin tool manager instance
            manager = PluginToolManager()

            # Test invoke without passthrough
            list(
                manager.invoke(
                    tenant_id="test_tenant",
                    user_id="test_user",
                    tool_provider="test_provider",
                    tool_name="test_tool",
                    credentials={},
                    credential_type="api-key",
                    tool_parameters={"param1": "value1"},
                    conversation_id="test_conversation",
                    app_id="test_app",
                    message_id="test_message",
                    passthrough=None,
                )
            )

            # Verify that passthrough was None in the request data
            mock_request.assert_called_once()
            call_args = mock_request.call_args

            # Check that passthrough was None
            data = call_args.kwargs["data"]
            assert "passthrough" in data
            assert data["passthrough"] is None
