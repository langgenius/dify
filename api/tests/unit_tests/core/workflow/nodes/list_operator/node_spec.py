from unittest.mock import MagicMock

import pytest
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.graph_init_params import GraphInitParams
from core.workflow.graph_engine.entities.graph_runtime_state import GraphRuntimeState

from core.variables import ArrayNumberSegment, ArrayStringSegment
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.nodes.list_operator.node import ListOperatorNode
from models.workflow import WorkflowType


class TestListOperatorNode:
    """Comprehensive tests for ListOperatorNode."""

    @pytest.fixture
    def mock_graph_runtime_state(self):
        """Create mock GraphRuntimeState."""
        mock_state = MagicMock(spec=GraphRuntimeState)
        mock_variable_pool = MagicMock()
        mock_state.variable_pool = mock_variable_pool
        return mock_state

    @pytest.fixture
    def mock_graph(self):
        """Create mock Graph."""
        return MagicMock(spec=Graph)

    @pytest.fixture
    def graph_init_params(self):
        """Create GraphInitParams fixture."""
        return GraphInitParams(
            tenant_id="test",
            app_id="test",
            workflow_type=WorkflowType.WORKFLOW,
            workflow_id="test",
            graph_config={},
            user_id="test",
            user_from="test",
            invoke_from="test",
            call_depth=0,
        )

    @pytest.fixture
    def list_operator_node_factory(self, graph_init_params, mock_graph, mock_graph_runtime_state):
        """Factory fixture for creating ListOperatorNode instances."""

        def _create_node(config, mock_variable):
            mock_graph_runtime_state.variable_pool.get.return_value = mock_variable
            return ListOperatorNode(
                id="test",
                config=config,
                graph_init_params=graph_init_params,
                graph=mock_graph,
                graph_runtime_state=mock_graph_runtime_state,
            )

        return _create_node

    def test_node_initialization(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test node initializes correctly."""
        config = {
            "title": "List Operator",
            "variable": ["sys", "list"],
            "filter_by": {"enabled": False},
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        assert node.node_type == NodeType.LIST_OPERATOR
        assert node._node_data.title == "List Operator"

    def test_version(self):
        """Test version returns correct value."""
        assert ListOperatorNode.version() == "1"

    def test_run_with_string_array(self, list_operator_node_factory):
        """Test with string array."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {"enabled": False},
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_var = ArrayStringSegment(value=["apple", "banana", "cherry"])
        node = list_operator_node_factory(config, mock_var)

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "banana", "cherry"]

    def test_run_with_empty_array(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test with empty array."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {"enabled": False},
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_var = ArrayStringSegment(value=[])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == []
        assert result.outputs["first_record"] is None
        assert result.outputs["last_record"] is None

    def test_run_with_filter_contains(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test filter with contains condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {
                "enabled": True,
                "condition": "contains",
                "value": "app",
            },
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_var = ArrayStringSegment(value=["apple", "banana", "pineapple", "cherry"])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "pineapple"]

    def test_run_with_filter_not_contains(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test filter with not contains condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {
                "enabled": True,
                "condition": "not contains",
                "value": "app",
            },
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_var = ArrayStringSegment(value=["apple", "banana", "pineapple", "cherry"])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["banana", "cherry"]

    def test_run_with_number_filter_greater_than(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test filter with greater than condition on numbers."""
        config = {
            "title": "Test",
            "variable": ["sys", "numbers"],
            "filter_by": {
                "enabled": True,
                "condition": ">",
                "value": "5",
            },
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_var = ArrayNumberSegment(value=[1, 3, 5, 7, 9, 11])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == [7, 9, 11]

    def test_run_with_order_ascending(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test ordering in ascending order."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {"enabled": False},
            "order_by": {
                "enabled": True,
                "value": "asc",
            },
            "limit": {"enabled": False},
        }

        mock_var = ArrayStringSegment(value=["cherry", "apple", "banana"])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "banana", "cherry"]

    def test_run_with_order_descending(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test ordering in descending order."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {"enabled": False},
            "order_by": {
                "enabled": True,
                "value": "desc",
            },
            "limit": {"enabled": False},
        }

        mock_var = ArrayStringSegment(value=["cherry", "apple", "banana"])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["cherry", "banana", "apple"]

    def test_run_with_limit(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test with limit enabled."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {"enabled": False},
            "order_by": {"enabled": False},
            "limit": {
                "enabled": True,
                "size": 2,
            },
        }

        mock_var = ArrayStringSegment(value=["apple", "banana", "cherry", "date"])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "banana"]

    def test_run_with_filter_order_and_limit(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test with filter, order, and limit combined."""
        config = {
            "title": "Test",
            "variable": ["sys", "numbers"],
            "filter_by": {
                "enabled": True,
                "condition": ">",
                "value": "3",
            },
            "order_by": {
                "enabled": True,
                "value": "desc",
            },
            "limit": {
                "enabled": True,
                "size": 3,
            },
        }

        mock_var = ArrayNumberSegment(value=[1, 2, 3, 4, 5, 6, 7, 8, 9])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == [9, 8, 7]

    def test_run_with_variable_not_found(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test when variable is not found."""
        config = {
            "title": "Test",
            "variable": ["sys", "missing"],
            "filter_by": {"enabled": False},
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_graph_runtime_state.variable_pool.get.return_value = None

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Variable not found" in result.error

    def test_run_with_first_and_last_record(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test first_record and last_record outputs."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {"enabled": False},
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_var = ArrayStringSegment(value=["first", "middle", "last"])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["first_record"] == "first"
        assert result.outputs["last_record"] == "last"

    def test_run_with_filter_startswith(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test filter with startswith condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {
                "enabled": True,
                "condition": "start with",
                "value": "app",
            },
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_var = ArrayStringSegment(value=["apple", "application", "banana", "apricot"])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "application"]

    def test_run_with_filter_endswith(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test filter with endswith condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {
                "enabled": True,
                "condition": "end with",
                "value": "le",
            },
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_var = ArrayStringSegment(value=["apple", "banana", "pineapple", "table"])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "pineapple", "table"]

    def test_run_with_number_filter_equals(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test number filter with equals condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "numbers"],
            "filter_by": {
                "enabled": True,
                "condition": "=",
                "value": "5",
            },
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_var = ArrayNumberSegment(value=[1, 3, 5, 5, 7, 9])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == [5, 5]

    def test_run_with_number_filter_not_equals(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test number filter with not equals condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "numbers"],
            "filter_by": {
                "enabled": True,
                "condition": "≠",
                "value": "5",
            },
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        mock_var = ArrayNumberSegment(value=[1, 3, 5, 7, 9])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == [1, 3, 7, 9]

    def test_run_with_number_order_ascending(self, mock_graph, mock_graph_runtime_state, graph_init_params):
        """Test number ordering in ascending order."""
        config = {
            "title": "Test",
            "variable": ["sys", "numbers"],
            "filter_by": {"enabled": False},
            "order_by": {
                "enabled": True,
                "value": "asc",
            },
            "limit": {"enabled": False},
        }

        mock_var = ArrayNumberSegment(value=[9, 3, 7, 1, 5])
        mock_graph_runtime_state.variable_pool.get.return_value = mock_var

        node = ListOperatorNode(
            id="test",
            config=config,
            graph_init_params=graph_init_params,
            graph=mock_graph,
            graph_runtime_state=mock_graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == [1, 3, 5, 7, 9]
