from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.nodes.base.entities import VariableSelector
from graphon.nodes.template_transform.entities import TemplateTransformNodeData
from graphon.nodes.template_transform.template_transform_node import TemplateTransformNode
from graphon.runtime import RuntimeState, VariablePool
from graphon.template_rendering import TemplateRenderError
from tests.workflow_test_utils import build_test_graph_init_params


def _build_template_transform_node(
    *,
    node_data,
    init_params,
    runtime_state,
    node_id: str = "test_node",
    **kwargs,
) -> TemplateTransformNode:
    typed_node_data = (
        node_data
        if isinstance(node_data, TemplateTransformNodeData)
        else TemplateTransformNodeData.model_validate(node_data)
    )
    return TemplateTransformNode(
        node_id=node_id,
        data=typed_node_data,
        init_params=init_params,
        runtime_state=runtime_state,
        **kwargs,
    )


class TestTemplateTransformNode:
    """Comprehensive test suite for TemplateTransformNode."""

    @pytest.fixture
    def graph_runtime_state(self) -> RuntimeState:
        """Create graph state with real variable storage and conversion."""
        return RuntimeState(workflow_id="test_workflow", variable_pool=VariablePool(), start_at=0)

    @pytest.fixture
    def graph_init_params(self):
        """Create validated graph initialization parameters."""
        return build_test_graph_init_params(
            workflow_id="test_workflow",
            graph_config={},
            tenant_id="test_tenant",
            app_id="test_app",
            user_id="test_user",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
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

    @pytest.mark.parametrize("max_output_length", [0, -1])
    def test_node_initialization_rejects_non_positive_max_output_length(
        self,
        basic_node_data,
        graph_runtime_state,
        graph_init_params,
        max_output_length,
    ):
        mock_renderer = MagicMock()

        with pytest.raises(ValueError, match="max_output_length must be a positive integer"):
            _build_template_transform_node(
                node_data=basic_node_data,
                init_params=graph_init_params,
                runtime_state=graph_runtime_state,
                jinja2_template_renderer=mock_renderer,
                max_output_length=max_output_length,
            )

    def test_run_simple_template(self, basic_node_data, graph_runtime_state, graph_init_params):
        """Test _run with simple template transformation using injected renderer."""
        name_value = "Alice"
        age_value = 30

        variable_map = {
            ("sys", "user_name"): name_value,
            ("sys", "user_age"): age_value,
        }
        for selector, value in variable_map.items():
            graph_runtime_state.variable_pool.add(selector, value)

        # Setup mock renderer
        mock_renderer = MagicMock()
        mock_renderer.render_template.return_value = "Hello Alice, you are 30 years old!"

        node = _build_template_transform_node(
            node_data=basic_node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            jinja2_template_renderer=mock_renderer,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["output"] == "Hello Alice, you are 30 years old!"
        assert result.inputs["name"] == "Alice"
        assert result.inputs["age"] == 30

    def test_run_with_none_values(self, graph_runtime_state, graph_init_params):
        """Test _run with None variable values."""
        node_data = {
            "title": "Test",
            "variables": [{"variable": "value", "value_selector": ["sys", "missing"]}],
            "template": "Value: {{ value }}",
        }

        mock_renderer = MagicMock()
        mock_renderer.render_template.return_value = "Value: "

        node = _build_template_transform_node(
            node_data=node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            jinja2_template_renderer=mock_renderer,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.inputs["value"] is None

    def test_run_with_render_error(self, basic_node_data, graph_runtime_state, graph_init_params):
        """Test _run when template rendering fails."""
        graph_runtime_state.variable_pool.add(["sys", "user_name"], "Alice")
        graph_runtime_state.variable_pool.add(["sys", "user_age"], 30)

        mock_renderer = MagicMock()
        mock_renderer.render_template.side_effect = TemplateRenderError("Template syntax error")

        node = _build_template_transform_node(
            node_data=basic_node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            jinja2_template_renderer=mock_renderer,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Template syntax error" in result.error

    def test_run_output_length_exceeds_limit(self, basic_node_data, graph_runtime_state, graph_init_params):
        """Test _run when output exceeds maximum length."""
        graph_runtime_state.variable_pool.add(["sys", "user_name"], "Alice")
        graph_runtime_state.variable_pool.add(["sys", "user_age"], 30)

        mock_renderer = MagicMock()
        mock_renderer.render_template.return_value = "This is a very long output that exceeds the limit"

        node = _build_template_transform_node(
            node_data=basic_node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            jinja2_template_renderer=mock_renderer,
            max_output_length=10,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Output length exceeds" in result.error

    def test_run_output_length_equal_to_limit_succeeds(self, basic_node_data, graph_runtime_state, graph_init_params):
        graph_runtime_state.variable_pool.add(["sys", "user_name"], "Alice")
        graph_runtime_state.variable_pool.add(["sys", "user_age"], 30)

        mock_renderer = MagicMock()
        mock_renderer.render_template.return_value = "1234567890"

        node = _build_template_transform_node(
            node_data=basic_node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            jinja2_template_renderer=mock_renderer,
            max_output_length=10,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["output"] == "1234567890"

    def test_run_with_complex_jinja2_template(self, graph_runtime_state, graph_init_params):
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

        items = ["apple", "banana", "orange"]
        show_total = True

        variable_map = {
            ("sys", "items"): items,
            ("sys", "show_total"): show_total,
        }
        for selector, value in variable_map.items():
            graph_runtime_state.variable_pool.add(selector, value)

        mock_renderer = MagicMock()
        mock_renderer.render_template.return_value = "apple, banana, orange (Total: 3)"

        node = _build_template_transform_node(
            node_data=node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            jinja2_template_renderer=mock_renderer,
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

    def test_extract_variable_selector_to_variable_mapping_accepts_validated_node_data(self):
        node_data = TemplateTransformNodeData(
            title="Test",
            variables=[VariableSelector(variable="var1", value_selector=["sys", "input1"])],
            template="{{ var1 }}",
        )

        mapping = TemplateTransformNode._extract_variable_selector_to_variable_mapping(
            graph_config={}, node_id="node_123", node_data=node_data
        )

        assert mapping == {"node_123.var1": ["sys", "input1"]}

    def test_extract_variable_selector_to_variable_mapping_returns_empty_mapping_without_variables(self):
        node_data = {
            "title": "Test",
            "template": "{{ missing }}",
        }

        mapping = TemplateTransformNode._extract_variable_selector_to_variable_mapping(
            graph_config={}, node_id="node_123", node_data=node_data
        )

        assert mapping == {}

    def test_extract_variable_selector_to_variable_mapping_accepts_sequence_value_selectors(self):
        node_data = {
            "title": "Test",
            "variables": [
                {"variable": "var1", "value_selector": ("sys", "input1")},
                {"variable": "empty_selector", "value_selector": ()},
            ],
            "template": "{{ var1 }}",
        }

        mapping = TemplateTransformNode._extract_variable_selector_to_variable_mapping(
            graph_config={}, node_id="node_123", node_data=node_data
        )

        assert mapping == {
            "node_123.var1": ("sys", "input1"),
            "node_123.empty_selector": (),
        }

    def test_extract_variable_selector_to_variable_mapping_ignores_invalid_entries(self):
        node_data = {
            "title": "Test",
            "variables": [
                {"variable": "var1", "value_selector": ["sys", "input1"]},
                {"variable": "missing_selector"},
                ["not", "a", "mapping"],
                {"variable": 1, "value_selector": ["sys", "input2"]},
                {"variable": "invalid_selector", "value_selector": ["sys", 2]},
            ],
            "template": "{{ var1 }}",
        }

        mapping = TemplateTransformNode._extract_variable_selector_to_variable_mapping(
            graph_config={}, node_id="node_123", node_data=node_data
        )

        assert mapping == {"node_123.var1": ["sys", "input1"]}

    def test_run_with_empty_variables(self, graph_runtime_state, graph_init_params):
        """Test _run with no variables (static template)."""
        node_data = {
            "title": "Static Template",
            "variables": [],
            "template": "This is a static message.",
        }

        mock_renderer = MagicMock()
        mock_renderer.render_template.return_value = "This is a static message."

        node = _build_template_transform_node(
            node_data=node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            jinja2_template_renderer=mock_renderer,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["output"] == "This is a static message."
        assert result.inputs == {}

    def test_run_with_numeric_values(self, graph_runtime_state, graph_init_params):
        """Test _run with numeric variable values."""
        node_data = {
            "title": "Numeric Template",
            "variables": [
                {"variable": "price", "value_selector": ["sys", "price"]},
                {"variable": "quantity", "value_selector": ["sys", "quantity"]},
            ],
            "template": "Total: ${{ price * quantity }}",
        }

        price = 10.5
        quantity = 3

        variable_map = {
            ("sys", "price"): price,
            ("sys", "quantity"): quantity,
        }
        for selector, value in variable_map.items():
            graph_runtime_state.variable_pool.add(selector, value)

        mock_renderer = MagicMock()
        mock_renderer.render_template.return_value = "Total: $31.5"

        node = _build_template_transform_node(
            node_data=node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            jinja2_template_renderer=mock_renderer,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["output"] == "Total: $31.5"

    def test_run_with_dict_values(self, graph_runtime_state, graph_init_params):
        """Test _run with dictionary variable values."""
        node_data = {
            "title": "Dict Template",
            "variables": [{"variable": "user", "value_selector": ["sys", "user_data"]}],
            "template": "Name: {{ user.name }}, Email: {{ user.email }}",
        }

        user = {"name": "John Doe", "email": "john@example.com"}

        graph_runtime_state.variable_pool.add(["sys", "user_data"], user)

        mock_renderer = MagicMock()
        mock_renderer.render_template.return_value = "Name: John Doe, Email: john@example.com"

        node = _build_template_transform_node(
            node_data=node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            jinja2_template_renderer=mock_renderer,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "John Doe" in result.outputs["output"]
        assert "john@example.com" in result.outputs["output"]

    def test_run_with_list_values(self, graph_runtime_state, graph_init_params):
        """Test _run with list variable values."""
        node_data = {
            "title": "List Template",
            "variables": [{"variable": "tags", "value_selector": ["sys", "tags"]}],
            "template": "Tags: {% for tag in tags %}#{{ tag }} {% endfor %}",
        }

        tags = ["python", "ai", "workflow"]

        graph_runtime_state.variable_pool.add(["sys", "tags"], tags)

        mock_renderer = MagicMock()
        mock_renderer.render_template.return_value = "Tags: #python #ai #workflow "

        node = _build_template_transform_node(
            node_data=node_data,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
            jinja2_template_renderer=mock_renderer,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert "#python" in result.outputs["output"]
        assert "#ai" in result.outputs["output"]
        assert "#workflow" in result.outputs["output"]
