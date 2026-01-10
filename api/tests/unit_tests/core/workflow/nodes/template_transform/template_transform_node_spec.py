from unittest.mock import MagicMock, patch

import pytest
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState

from core.workflow.enums import ErrorStrategy, NodeType, WorkflowNodeExecutionStatus
from core.workflow.nodes.template_transform.template_renderer import TemplateRenderError
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode
from models.workflow import WorkflowType


class TestTemplateTransformNode:
    """Comprehensive test suite for TemplateTransformNode."""

    @pytest.fixture
    def mock_graph_runtime_state(self):
        """Create a mock GraphRuntimeState with variable pool."""
        mock_state = MagicMock(spec=GraphRuntimeState)
        mock_variable_pool = MagicMock()
        mock_state.variable_pool = mock_variable_pool
        return mock_state

    @pytest.fixture
    def mock_graph(self):
        """Create a mock Graph."""
        return MagicMock(spec=Graph)

    @pytest.fixture
    def graph_init_params(self):
        """Create a mock GraphInitParams."""
        return GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from="test",
            invoke_from="test",
            call_depth=0,
        )

    @pytest.fixture
    def basic_node_data(self):
        """Create basic node data for testing."""
        return {
            "title": "Template Transform",
            "desc": "Transform data using template",
            "variables": [
                {"variable": "name", "value_selector": ["sys", "user_name"]},
                {"variable": "age", "value_selector": ["sys", "user_age"]},
            ],
            "template": "Hello {{ name }}, you are {{ age }} years old!",
        }

    def test_node_initialization(self, basic_node_data, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test that TemplateTransformNode initializes correctly."""
        node = TemplateTransformNode(
            id="test_node",
            config=basic_node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        assert node.node_type == NodeType.TEMPLATE_TRANSFORM
        assert node._node_data.title == "Template Transform"
        assert len(node._node_data.variables) == 2
        assert node._node_data.template == "Hello {{ name }}, you are {{ age }} years old!"

    def test_get_title(self, basic_node_data, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test _get_title method."""
        node = TemplateTransformNode(
            id="test_node",
            config=basic_node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        assert node._get_title() == "Template Transform"

    def test_get_description(self, basic_node_data, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test _get_description method."""
        node = TemplateTransformNode(
            id="test_node",
            config=basic_node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        assert node._get_description() == "Transform data using template"

    def test_get_error_strategy(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test _get_error_strategy method."""
        node_data = {
            "title": "Test",
            "variables": [],
            "template": "test",
            "error_strategy": "fail-branch",
        }

        node = TemplateTransformNode(
            id="test_node",
            config=node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        assert node._get_error_strategy() == ErrorStrategy.FAIL_BRANCH

    def test_get_default_config(self):
        """Test get_default_config class method."""
        config = TemplateTransformNode.get_default_config()

        assert config["type"] == "template-transform"
        assert "config" in config
        assert "variables" in config["config"]
        assert "template" in config["config"]
        assert config["config"]["template"] == "{{ arg1 }}"

    def test_version(self):
        """Test version class method."""
        assert TemplateTransformNode.version() == "1"

    @patch(
        "core.workflow.nodes.template_transform.template_transform_node.CodeExecutorJinja2TemplateRenderer.render_template"
    )
    def test_run_simple_template(
        self, mock_execute, basic_node_data, mock_graph, mock_graph_runtime_state, graph_init_params
    ):
        """Test _run with simple template transformation."""
        # Setup mock variable pool
        mock_name_value = MagicMock()
        mock_name_value.to_object.return_value = "Alice"
        mock_age_value = MagicMock()
        mock_age_value.to_object.return_value = 30

        variable_map = {
            ("sys", "user_name"): mock_name_value,
            ("sys", "user_age"): mock_age_value,
        }
        mock_graph_runtime_state.variable_pool.get.side_effect = lambda selector: variable_map.get(tuple(selector))

        # Setup mock executor
        mock_execute.return_value = "Hello Alice, you are 30 years old!"

        node = TemplateTransformNode(
            id="test_node",
            config=basic_node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["output"] == "Hello Alice, you are 30 years old!"
        assert result.inputs["name"] == "Alice"
        assert result.inputs["age"] == 30

    @patch(
        "core.workflow.nodes.template_transform.template_transform_node.CodeExecutorJinja2TemplateRenderer.render_template"
    )
    def test_run_with_none_values(self, mock_execute, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test _run with None variable values."""
        node_data = {
            "title": "Test",
            "variables": [{"variable": "value", "value_selector": ["sys", "missing"]}],
            "template": "Value: {{ value }}",
        }

        mock_graph_runtime_state.variable_pool.get.return_value = None
        mock_execute.return_value = "Value: "

        node = TemplateTransformNode(
            id="test_node",
            config=node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.inputs["value"] is None

    @patch(
        "core.workflow.nodes.template_transform.template_transform_node.CodeExecutorJinja2TemplateRenderer.render_template"
    )
    def test_run_with_code_execution_error(
        self, mock_execute, basic_node_data, mock_graph, mock_graph_runtime_state, graph_init_params
    ):
        """Test _run when code execution fails."""
        mock_graph_runtime_state.variable_pool.get.return_value = MagicMock()
        mock_execute.side_effect = TemplateRenderError("Template syntax error")

        node = TemplateTransformNode(
            id="test_node",
            config=basic_node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Template syntax error" in result.error

    @patch(
        "core.workflow.nodes.template_transform.template_transform_node.CodeExecutorJinja2TemplateRenderer.render_template"
    )
    @patch("core.workflow.nodes.template_transform.template_transform_node.MAX_TEMPLATE_TRANSFORM_OUTPUT_LENGTH", 10)
    def test_run_output_length_exceeds_limit(
        self, mock_execute, basic_node_data, mock_graph, mock_graph_runtime_state, graph_init_params
    ):
        """Test _run when output exceeds maximum length."""
        mock_graph_runtime_state.variable_pool.get.return_value = MagicMock()
        mock_execute.return_value = "This is a very long output that exceeds the limit"

        node = TemplateTransformNode(
            id="test_node",
            config=basic_node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Output length exceeds" in result.error

    @patch(
        "core.workflow.nodes.template_transform.template_transform_node.CodeExecutorJinja2TemplateRenderer.render_template"
    )
    def test_run_with_complex_jinja2_template(
        self, mock_execute, mock_graph, mock_graph_runtime_state, graph_init_params
    ):
        """Test _run with complex Jinja2 template including loops and conditions."""
        node_data = {
            "title": "Complex Template",
            "variables": [
                {"variable": "items", "value_selector": ["sys", "items"]},
                {"variable": "show_total", "value_selector": ["sys", "show_total"]},
            ],
            "template": (
                "{% for item in items %}{{ item }}{% if not loop.last %}, {% endif %}{% endfor %}"
                "{% if show_total %} (Total: {{ items|length }}){% endif %}"
            ),
        }

        mock_items = MagicMock()
        mock_items.to_object.return_value = ["apple", "banana", "orange"]
        mock_show_total = MagicMock()
        mock_show_total.to_object.return_value = True

        variable_map = {
            ("sys", "items"): mock_items,
            ("sys", "show_total"): mock_show_total,
        }
        mock_graph_runtime_state.variable_pool.get.side_effect = lambda selector: variable_map.get(tuple(selector))
        mock_execute.return_value = "apple, banana, orange (Total: 3)"

        node = TemplateTransformNode(
            id="test_node",
            config=node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["output"] == "apple, banana, orange (Total: 3)"

    def test_extract_variable_selector_to_variable_mapping(self):
        """Test _extract_variable_selector_to_variable_mapping class method."""
        node_data = {
            "title": "Test",
            "variables": [
                {"variable": "var1", "value_selector": ["sys", "input1"]},
                {"variable": "var2", "value_selector": ["sys", "input2"]},
            ],
            "template": "{{ var1 }} {{ var2 }}",
        }

        mapping = TemplateTransformNode._extract_variable_selector_to_variable_mapping(
            graph_config={}, node_id="node_123", node_data=node_data
        )

        assert "node_123.var1" in mapping
        assert "node_123.var2" in mapping
        assert mapping["node_123.var1"] == ["sys", "input1"]
        assert mapping["node_123.var2"] == ["sys", "input2"]

    @patch(
        "core.workflow.nodes.template_transform.template_transform_node.CodeExecutorJinja2TemplateRenderer.render_template"
    )
    def test_run_with_empty_variables(self, mock_execute, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test _run with no variables (static template)."""
        node_data = {
            "title": "Static Template",
            "variables": [],
            "template": "This is a static message.",
        }

        mock_execute.return_value = "This is a static message."

        node = TemplateTransformNode(
            id="test_node",
            config=node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["output"] == "This is a static message."
        assert result.inputs == {}

    @patch(
        "core.workflow.nodes.template_transform.template_transform_node.CodeExecutorJinja2TemplateRenderer.render_template"
    )
    def test_run_with_numeric_values(self, mock_execute, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test _run with numeric variable values."""
        node_data = {
            "title": "Numeric Template",
            "variables": [
                {"variable": "price", "value_selector": ["sys", "price"]},
                {"variable": "quantity", "value_selector": ["sys", "quantity"]},
            ],
            "template": "Total: ${{ price * quantity }}",
        }

        mock_price = MagicMock()
        mock_price.to_object.return_value = 10.5
        mock_quantity = MagicMock()
        mock_quantity.to_object.return_value = 3

        variable_map = {
            ("sys", "price"): mock_price,
            ("sys", "quantity"): mock_quantity,
        }
        mock_graph_runtime_state.variable_pool.get.side_effect = lambda selector: variable_map.get(tuple(selector))
        mock_execute.return_value = "Total: $31.5"

        node = TemplateTransformNode(
            id="test_node",
            config=node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["output"] == "Total: $31.5"

    @patch(
        "core.workflow.nodes.template_transform.template_transform_node.CodeExecutorJinja2TemplateRenderer.render_template"
    )
    def test_run_with_dict_values(self, mock_execute, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test _run with dictionary variable values."""
        node_data = {
            "title": "Dict Template",
            "variables": [{"variable": "user", "value_selector": ["sys", "user_data"]}],
            "template": "Name: {{ user.name }}, Email: {{ user.email }}",
        }

        mock_user = MagicMock()
        mock_user.to_object.return_value = {"name": "John Doe", "email": "john@example.com"}

        mock_graph_runtime_state.variable_pool.get.return_value = mock_user
        mock_execute.return_value = "Name: John Doe, Email: john@example.com"

        node = TemplateTransformNode(
            id="test_node",
            config=node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "John Doe" in result.outputs["output"]
        assert "john@example.com" in result.outputs["output"]

    @patch(
        "core.workflow.nodes.template_transform.template_transform_node.CodeExecutorJinja2TemplateRenderer.render_template"
    )
    def test_run_with_list_values(self, mock_execute, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test _run with list variable values."""
        node_data = {
            "title": "List Template",
            "variables": [{"variable": "tags", "value_selector": ["sys", "tags"]}],
            "template": "Tags: {% for tag in tags %}#{{ tag }} {% endfor %}",
        }

        mock_tags = MagicMock()
        mock_tags.to_object.return_value = ["python", "ai", "workflow"]

        mock_graph_runtime_state.variable_pool.get.return_value = mock_tags
        mock_execute.return_value = "Tags: #python #ai #workflow "

        node = TemplateTransformNode(
            id="test_node",
            config=node_data,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "#python" in result.outputs["output"]
        assert "#ai" in result.outputs["output"]
        assert "#workflow" in result.outputs["output"]
