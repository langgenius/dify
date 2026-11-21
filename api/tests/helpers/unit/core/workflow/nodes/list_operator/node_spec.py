import pytest

from core.app.entities.app_invoke_entities import DIFY_RUN_CONTEXT_KEY
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.nodes.list_operator.entities import ListOperatorNodeData
from graphon.nodes.list_operator.node import ListOperatorNode
from graphon.runtime import InitParams, RuntimeState, VariablePool
from graphon.variables import ArrayNumberSegment, ArrayStringSegment


class TestListOperatorNode:
    """Comprehensive tests for ListOperatorNode."""

    @staticmethod
    def _build_node(*, data, init_params, runtime_state):
        return ListOperatorNode(
            node_id="test",
            data=data if isinstance(data, ListOperatorNodeData) else ListOperatorNodeData.model_validate(data),
            init_params=init_params,
            runtime_state=runtime_state,
        )

    @staticmethod
    def _filter_by(comparison_operator: str, value: str) -> dict[str, object]:
        return {
            "enabled": True,
            "conditions": [{"comparison_operator": comparison_operator, "value": value}],
        }

    @pytest.fixture
    def graph_runtime_state(self):
        """Create graph state backed by the real variable pool."""
        return RuntimeState(workflow_id="test", variable_pool=VariablePool(), start_at=0)

    @pytest.fixture
    def graph_init_params(self):
        """Create InitParams fixture."""
        return InitParams(
            workflow_id="test",
            graph_config={},
            run_context={
                DIFY_RUN_CONTEXT_KEY: {
                    "tenant_id": "test",
                    "app_id": "test",
                    "user_id": "test",
                    "user_from": "test",
                    "invoke_from": "test",
                }
            },
            call_depth=0,
        )

    @pytest.fixture
    def list_operator_node_factory(self, graph_init_params, graph_runtime_state):
        """Factory fixture for creating ListOperatorNode instances."""

        def _create_node(config, variable):
            graph_runtime_state.variable_pool.add(config["variable"], variable)
            return self._build_node(
                data=config,
                init_params=graph_init_params,
                runtime_state=graph_runtime_state,
            )

        return _create_node

    def test_run_with_string_array(self, list_operator_node_factory):
        """Test with string array."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {"enabled": False},
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        variable = ArrayStringSegment(value=["apple", "banana", "cherry"])
        node = list_operator_node_factory(config, variable)

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "banana", "cherry"]

    def test_run_with_empty_array(self, graph_runtime_state, graph_init_params):
        """Test with empty array."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {"enabled": False},
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        variable = ArrayStringSegment(value=[])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == []
        assert result.outputs["first_record"] is None
        assert result.outputs["last_record"] is None

    def test_run_with_filter_contains(self, graph_runtime_state, graph_init_params):
        """Test filter with contains condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": self._filter_by("contains", "app"),
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        variable = ArrayStringSegment(value=["apple", "banana", "pineapple", "cherry"])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "pineapple"]

    def test_run_with_filter_not_contains(self, graph_runtime_state, graph_init_params):
        """Test filter with not contains condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": self._filter_by("not contains", "app"),
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        variable = ArrayStringSegment(value=["apple", "banana", "pineapple", "cherry"])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["banana", "cherry"]

    def test_run_with_number_filter_greater_than(self, graph_runtime_state, graph_init_params):
        """Test filter with greater than condition on numbers."""
        config = {
            "title": "Test",
            "variable": ["sys", "numbers"],
            "filter_by": self._filter_by(">", "5"),
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        variable = ArrayNumberSegment(value=[1, 3, 5, 7, 9, 11])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == [7, 9, 11]

    def test_run_with_order_ascending(self, graph_runtime_state, graph_init_params):
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

        variable = ArrayStringSegment(value=["cherry", "apple", "banana"])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "banana", "cherry"]

    def test_run_with_order_descending(self, graph_runtime_state, graph_init_params):
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

        variable = ArrayStringSegment(value=["cherry", "apple", "banana"])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["cherry", "banana", "apple"]

    def test_run_with_limit(self, graph_runtime_state, graph_init_params):
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

        variable = ArrayStringSegment(value=["apple", "banana", "cherry", "date"])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "banana"]

    def test_run_with_filter_order_and_limit(self, graph_runtime_state, graph_init_params):
        """Test with filter, order, and limit combined."""
        config = {
            "title": "Test",
            "variable": ["sys", "numbers"],
            "filter_by": self._filter_by(">", "3"),
            "order_by": {
                "enabled": True,
                "value": "desc",
            },
            "limit": {
                "enabled": True,
                "size": 3,
            },
        }

        variable = ArrayNumberSegment(value=[1, 2, 3, 4, 5, 6, 7, 8, 9])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == [9, 8, 7]

    def test_run_with_variable_not_found(self, graph_runtime_state, graph_init_params):
        """Test when variable is not found."""
        config = {
            "title": "Test",
            "variable": ["sys", "missing"],
            "filter_by": {"enabled": False},
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.FAILED
        assert "Variable not found" in result.error

    def test_run_with_first_and_last_record(self, graph_runtime_state, graph_init_params):
        """Test first_record and last_record outputs."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": {"enabled": False},
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        variable = ArrayStringSegment(value=["first", "middle", "last"])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["first_record"] == "first"
        assert result.outputs["last_record"] == "last"

    def test_run_with_filter_startswith(self, graph_runtime_state, graph_init_params):
        """Test filter with startswith condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": self._filter_by("start with", "app"),
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        variable = ArrayStringSegment(value=["apple", "application", "banana", "apricot"])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "application"]

    def test_run_with_filter_endswith(self, graph_runtime_state, graph_init_params):
        """Test filter with endswith condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "items"],
            "filter_by": self._filter_by("end with", "le"),
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        variable = ArrayStringSegment(value=["apple", "banana", "pineapple", "table"])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == ["apple", "pineapple", "table"]

    def test_run_with_number_filter_equals(self, graph_runtime_state, graph_init_params):
        """Test number filter with equals condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "numbers"],
            "filter_by": self._filter_by("=", "5"),
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        variable = ArrayNumberSegment(value=[1, 3, 5, 5, 7, 9])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == [5, 5]

    def test_run_with_number_filter_not_equals(self, graph_runtime_state, graph_init_params):
        """Test number filter with not equals condition."""
        config = {
            "title": "Test",
            "variable": ["sys", "numbers"],
            "filter_by": self._filter_by("≠", "5"),
            "order_by": {"enabled": False},
            "limit": {"enabled": False},
        }

        variable = ArrayNumberSegment(value=[1, 3, 5, 7, 9])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == [1, 3, 7, 9]

    def test_run_with_number_order_ascending(self, graph_runtime_state, graph_init_params):
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

        variable = ArrayNumberSegment(value=[9, 3, 7, 1, 5])
        graph_runtime_state.variable_pool.add(config["variable"], variable)

        node = self._build_node(
            data=config,
            init_params=graph_init_params,
            runtime_state=graph_runtime_state,
        )

        result = node._run()

        assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
        assert result.outputs["result"].value == [1, 3, 5, 7, 9]
