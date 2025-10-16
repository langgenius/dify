"""
Test cases for Mock Template Transform and Code nodes.

This module tests the functionality of MockTemplateTransformNode and MockCodeNode
to ensure they work correctly with the TableTestRunner.
"""

from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from tests.unit_tests.core.workflow.graph_engine.test_mock_config import MockConfig, MockConfigBuilder, NodeMockConfig
from tests.unit_tests.core.workflow.graph_engine.test_mock_factory import MockNodeFactory
from tests.unit_tests.core.workflow.graph_engine.test_mock_nodes import MockCodeNode, MockTemplateTransformNode


class TestMockTemplateTransformNode:
    """Test cases for MockTemplateTransformNode."""

    def test_mock_template_transform_node_default_output(self):
        """Test that MockTemplateTransformNode processes templates with Jinja2."""
        from core.workflow.entities import GraphInitParams
        from core.workflow.runtime import GraphRuntimeState, VariablePool

        # Create test parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )

        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        )

        # Create mock config
        mock_config = MockConfig()

        # Create node config
        node_config = {
            "id": "template_node_1",
            "data": {
                "type": "template-transform",
                "title": "Test Template Transform",
                "variables": [],
                "template": "Hello {{ name }}",
            },
        }

        # Create mock node
        mock_node = MockTemplateTransformNode(
            id="template_node_1",
            config=node_config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            mock_config=mock_config,
        )
        mock_node.init_node_data(node_config["data"])

        # Run the node
        result = mock_node._run()

        # Verify results
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "output" in result.outputs
        # The template "Hello {{ name }}" with no name variable renders as "Hello "
        assert result.outputs["output"] == "Hello "

    def test_mock_template_transform_node_custom_output(self):
        """Test that MockTemplateTransformNode returns custom configured output."""
        from core.workflow.entities import GraphInitParams
        from core.workflow.runtime import GraphRuntimeState, VariablePool

        # Create test parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )

        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        )

        # Create mock config with custom output
        mock_config = (
            MockConfigBuilder().with_node_output("template_node_1", {"output": "Custom template output"}).build()
        )

        # Create node config
        node_config = {
            "id": "template_node_1",
            "data": {
                "type": "template-transform",
                "title": "Test Template Transform",
                "variables": [],
                "template": "Hello {{ name }}",
            },
        }

        # Create mock node
        mock_node = MockTemplateTransformNode(
            id="template_node_1",
            config=node_config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            mock_config=mock_config,
        )
        mock_node.init_node_data(node_config["data"])

        # Run the node
        result = mock_node._run()

        # Verify results
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "output" in result.outputs
        assert result.outputs["output"] == "Custom template output"

    def test_mock_template_transform_node_error_simulation(self):
        """Test that MockTemplateTransformNode can simulate errors."""
        from core.workflow.entities import GraphInitParams
        from core.workflow.runtime import GraphRuntimeState, VariablePool

        # Create test parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )

        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        )

        # Create mock config with error
        mock_config = MockConfigBuilder().with_node_error("template_node_1", "Simulated template error").build()

        # Create node config
        node_config = {
            "id": "template_node_1",
            "data": {
                "type": "template-transform",
                "title": "Test Template Transform",
                "variables": [],
                "template": "Hello {{ name }}",
            },
        }

        # Create mock node
        mock_node = MockTemplateTransformNode(
            id="template_node_1",
            config=node_config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            mock_config=mock_config,
        )
        mock_node.init_node_data(node_config["data"])

        # Run the node
        result = mock_node._run()

        # Verify results
        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert result.error == "Simulated template error"

    def test_mock_template_transform_node_with_variables(self):
        """Test that MockTemplateTransformNode processes templates with variables."""
        from core.variables import StringVariable
        from core.workflow.entities import GraphInitParams
        from core.workflow.runtime import GraphRuntimeState, VariablePool

        # Create test parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )

        # Add a variable to the pool
        variable_pool.add(["test", "name"], StringVariable(name="name", value="World", selector=["test", "name"]))

        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        )

        # Create mock config
        mock_config = MockConfig()

        # Create node config with a variable
        node_config = {
            "id": "template_node_1",
            "data": {
                "type": "template-transform",
                "title": "Test Template Transform",
                "variables": [{"variable": "name", "value_selector": ["test", "name"]}],
                "template": "Hello {{ name }}!",
            },
        }

        # Create mock node
        mock_node = MockTemplateTransformNode(
            id="template_node_1",
            config=node_config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            mock_config=mock_config,
        )
        mock_node.init_node_data(node_config["data"])

        # Run the node
        result = mock_node._run()

        # Verify results
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "output" in result.outputs
        assert result.outputs["output"] == "Hello World!"


class TestMockCodeNode:
    """Test cases for MockCodeNode."""

    def test_mock_code_node_default_output(self):
        """Test that MockCodeNode returns default output."""
        from core.workflow.entities import GraphInitParams
        from core.workflow.runtime import GraphRuntimeState, VariablePool

        # Create test parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )

        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        )

        # Create mock config
        mock_config = MockConfig()

        # Create node config
        node_config = {
            "id": "code_node_1",
            "data": {
                "type": "code",
                "title": "Test Code",
                "variables": [],
                "code_language": "python3",
                "code": "result = 'test'",
                "outputs": {},  # Empty outputs for default case
            },
        }

        # Create mock node
        mock_node = MockCodeNode(
            id="code_node_1",
            config=node_config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            mock_config=mock_config,
        )
        mock_node.init_node_data(node_config["data"])

        # Run the node
        result = mock_node._run()

        # Verify results
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "result" in result.outputs
        assert result.outputs["result"] == "mocked code execution result"

    def test_mock_code_node_with_output_schema(self):
        """Test that MockCodeNode generates outputs based on schema."""
        from core.workflow.entities import GraphInitParams
        from core.workflow.runtime import GraphRuntimeState, VariablePool

        # Create test parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )

        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        )

        # Create mock config
        mock_config = MockConfig()

        # Create node config with output schema
        node_config = {
            "id": "code_node_1",
            "data": {
                "type": "code",
                "title": "Test Code",
                "variables": [],
                "code_language": "python3",
                "code": "name = 'test'\ncount = 42\nitems = ['a', 'b']",
                "outputs": {
                    "name": {"type": "string"},
                    "count": {"type": "number"},
                    "items": {"type": "array[string]"},
                },
            },
        }

        # Create mock node
        mock_node = MockCodeNode(
            id="code_node_1",
            config=node_config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            mock_config=mock_config,
        )
        mock_node.init_node_data(node_config["data"])

        # Run the node
        result = mock_node._run()

        # Verify results
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "name" in result.outputs
        assert result.outputs["name"] == "mocked_name"
        assert "count" in result.outputs
        assert result.outputs["count"] == 42
        assert "items" in result.outputs
        assert result.outputs["items"] == ["item1", "item2"]

    def test_mock_code_node_custom_output(self):
        """Test that MockCodeNode returns custom configured output."""
        from core.workflow.entities import GraphInitParams
        from core.workflow.runtime import GraphRuntimeState, VariablePool

        # Create test parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )

        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        )

        # Create mock config with custom output
        mock_config = (
            MockConfigBuilder()
            .with_node_output("code_node_1", {"result": "Custom code result", "status": "success"})
            .build()
        )

        # Create node config
        node_config = {
            "id": "code_node_1",
            "data": {
                "type": "code",
                "title": "Test Code",
                "variables": [],
                "code_language": "python3",
                "code": "result = 'test'",
                "outputs": {},  # Empty outputs for default case
            },
        }

        # Create mock node
        mock_node = MockCodeNode(
            id="code_node_1",
            config=node_config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
            mock_config=mock_config,
        )
        mock_node.init_node_data(node_config["data"])

        # Run the node
        result = mock_node._run()

        # Verify results
        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "result" in result.outputs
        assert result.outputs["result"] == "Custom code result"
        assert "status" in result.outputs
        assert result.outputs["status"] == "success"


class TestMockNodeFactory:
    """Test cases for MockNodeFactory with new node types."""

    def test_code_and_template_nodes_mocked_by_default(self):
        """Test that CODE and TEMPLATE_TRANSFORM nodes are mocked by default (they require SSRF proxy)."""
        from core.workflow.entities import GraphInitParams
        from core.workflow.runtime import GraphRuntimeState, VariablePool

        # Create test parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )

        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        )

        # Create factory
        factory = MockNodeFactory(
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # Verify that CODE and TEMPLATE_TRANSFORM ARE mocked by default (they require SSRF proxy)
        assert factory.should_mock_node(NodeType.CODE)
        assert factory.should_mock_node(NodeType.TEMPLATE_TRANSFORM)

        # Verify that other third-party service nodes ARE also mocked by default
        assert factory.should_mock_node(NodeType.LLM)
        assert factory.should_mock_node(NodeType.AGENT)

    def test_factory_creates_mock_template_transform_node(self):
        """Test that MockNodeFactory creates MockTemplateTransformNode for template-transform type."""
        from core.workflow.entities import GraphInitParams
        from core.workflow.runtime import GraphRuntimeState, VariablePool

        # Create test parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )

        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        )

        # Create factory
        factory = MockNodeFactory(
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # Create node config
        node_config = {
            "id": "template_node_1",
            "data": {
                "type": "template-transform",
                "title": "Test Template",
                "variables": [],
                "template": "Hello {{ name }}",
            },
        }

        # Create node through factory
        node = factory.create_node(node_config)

        # Verify the correct mock type was created
        assert isinstance(node, MockTemplateTransformNode)
        assert factory.should_mock_node(NodeType.TEMPLATE_TRANSFORM)

    def test_factory_creates_mock_code_node(self):
        """Test that MockNodeFactory creates MockCodeNode for code type."""
        from core.workflow.entities import GraphInitParams
        from core.workflow.runtime import GraphRuntimeState, VariablePool

        # Create test parameters
        graph_init_params = GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="account",
            invoke_from="debugger",
            call_depth=0,
        )

        variable_pool = VariablePool(
            system_variables={},
            user_inputs={},
        )

        graph_runtime_state = GraphRuntimeState(
            variable_pool=variable_pool,
            start_at=0,
        )

        # Create factory
        factory = MockNodeFactory(
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )

        # Create node config
        node_config = {
            "id": "code_node_1",
            "data": {
                "type": "code",
                "title": "Test Code",
                "variables": [],
                "code_language": "python3",
                "code": "result = 42",
                "outputs": {},  # Required field for CodeNodeData
            },
        }

        # Create node through factory
        node = factory.create_node(node_config)

        # Verify the correct mock type was created
        assert isinstance(node, MockCodeNode)
        assert factory.should_mock_node(NodeType.CODE)
