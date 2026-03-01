from core.workflow.enums import NodeType
from core.workflow.nodes.iteration.entities import ErrorHandleMode, IterationNodeData
from core.workflow.nodes.iteration.exc import (
    InvalidIteratorValueError,
    IterationGraphNotFoundError,
    IterationIndexNotFoundError,
    IterationNodeError,
    IteratorVariableNotFoundError,
    StartNodeIdNotFoundError,
)
from core.workflow.nodes.iteration.iteration_node import IterationNode


class TestIterationNodeExceptions:
    """Test suite for iteration node exceptions."""

    def test_iteration_node_error_is_value_error(self):
        """Test IterationNodeError inherits from ValueError."""
        error = IterationNodeError("test error")

        assert isinstance(error, ValueError)
        assert str(error) == "test error"

    def test_iterator_variable_not_found_error(self):
        """Test IteratorVariableNotFoundError."""
        error = IteratorVariableNotFoundError("Iterator variable not found")

        assert isinstance(error, IterationNodeError)
        assert isinstance(error, ValueError)
        assert "Iterator variable not found" in str(error)

    def test_invalid_iterator_value_error(self):
        """Test InvalidIteratorValueError."""
        error = InvalidIteratorValueError("Invalid iterator value")

        assert isinstance(error, IterationNodeError)
        assert "Invalid iterator value" in str(error)

    def test_start_node_id_not_found_error(self):
        """Test StartNodeIdNotFoundError."""
        error = StartNodeIdNotFoundError("Start node ID not found")

        assert isinstance(error, IterationNodeError)
        assert "Start node ID not found" in str(error)

    def test_iteration_graph_not_found_error(self):
        """Test IterationGraphNotFoundError."""
        error = IterationGraphNotFoundError("Iteration graph not found")

        assert isinstance(error, IterationNodeError)
        assert "Iteration graph not found" in str(error)

    def test_iteration_index_not_found_error(self):
        """Test IterationIndexNotFoundError."""
        error = IterationIndexNotFoundError("Iteration index not found")

        assert isinstance(error, IterationNodeError)
        assert "Iteration index not found" in str(error)

    def test_exception_with_empty_message(self):
        """Test exception with empty message."""
        error = IterationNodeError("")

        assert str(error) == ""

    def test_exception_with_detailed_message(self):
        """Test exception with detailed message."""
        error = IteratorVariableNotFoundError("Variable 'items' not found in node 'start_node'")

        assert "items" in str(error)
        assert "start_node" in str(error)

    def test_all_exceptions_inherit_from_base(self):
        """Test all exceptions inherit from IterationNodeError."""
        exceptions = [
            IteratorVariableNotFoundError("test"),
            InvalidIteratorValueError("test"),
            StartNodeIdNotFoundError("test"),
            IterationGraphNotFoundError("test"),
            IterationIndexNotFoundError("test"),
        ]

        for exc in exceptions:
            assert isinstance(exc, IterationNodeError)
            assert isinstance(exc, ValueError)


class TestIterationNodeClassAttributes:
    """Test suite for IterationNode class attributes."""

    def test_node_type(self):
        """Test IterationNode node_type attribute."""
        assert IterationNode.node_type == NodeType.ITERATION

    def test_version(self):
        """Test IterationNode version method."""
        version = IterationNode.version()

        assert version == "1"


class TestIterationNodeDefaultConfig:
    """Test suite for IterationNode get_default_config."""

    def test_get_default_config_returns_dict(self):
        """Test get_default_config returns a dictionary."""
        config = IterationNode.get_default_config()

        assert isinstance(config, dict)

    def test_get_default_config_type(self):
        """Test get_default_config includes type."""
        config = IterationNode.get_default_config()

        assert config.get("type") == "iteration"

    def test_get_default_config_has_config_section(self):
        """Test get_default_config has config section."""
        config = IterationNode.get_default_config()

        assert "config" in config
        assert isinstance(config["config"], dict)

    def test_get_default_config_is_parallel_default(self):
        """Test get_default_config is_parallel default value."""
        config = IterationNode.get_default_config()

        assert config["config"]["is_parallel"] is False

    def test_get_default_config_parallel_nums_default(self):
        """Test get_default_config parallel_nums default value."""
        config = IterationNode.get_default_config()

        assert config["config"]["parallel_nums"] == 10

    def test_get_default_config_error_handle_mode_default(self):
        """Test get_default_config error_handle_mode default value."""
        config = IterationNode.get_default_config()

        assert config["config"]["error_handle_mode"] == ErrorHandleMode.TERMINATED

    def test_get_default_config_flatten_output_default(self):
        """Test get_default_config flatten_output default value."""
        config = IterationNode.get_default_config()

        assert config["config"]["flatten_output"] is True

    def test_get_default_config_with_none_filters(self):
        """Test get_default_config with None filters."""
        config = IterationNode.get_default_config(filters=None)

        assert config is not None
        assert "type" in config

    def test_get_default_config_with_empty_filters(self):
        """Test get_default_config with empty filters."""
        config = IterationNode.get_default_config(filters={})

        assert config is not None


class TestIterationNodeInitialization:
    """Test suite for IterationNode initialization."""

    def test_init_node_data_basic(self):
        """Test init_node_data with basic configuration."""
        node = IterationNode.__new__(IterationNode)
        data = {
            "title": "Test Iteration",
            "iterator_selector": ["start", "items"],
            "output_selector": ["iteration", "result"],
        }

        node.init_node_data(data)

        assert node._node_data.title == "Test Iteration"
        assert node._node_data.iterator_selector == ["start", "items"]

    def test_init_node_data_with_parallel(self):
        """Test init_node_data with parallel configuration."""
        node = IterationNode.__new__(IterationNode)
        data = {
            "title": "Parallel Iteration",
            "iterator_selector": ["node", "list"],
            "output_selector": ["out", "result"],
            "is_parallel": True,
            "parallel_nums": 5,
        }

        node.init_node_data(data)

        assert node._node_data.is_parallel is True
        assert node._node_data.parallel_nums == 5

    def test_init_node_data_with_error_handle_mode(self):
        """Test init_node_data with error handle mode."""
        node = IterationNode.__new__(IterationNode)
        data = {
            "title": "Error Handle Test",
            "iterator_selector": ["a", "b"],
            "output_selector": ["c", "d"],
            "error_handle_mode": "continue-on-error",
        }

        node.init_node_data(data)

        assert node._node_data.error_handle_mode == ErrorHandleMode.CONTINUE_ON_ERROR

    def test_get_title(self):
        """Test _get_title method."""
        node = IterationNode.__new__(IterationNode)
        node._node_data = IterationNodeData(
            title="My Iteration",
            iterator_selector=["x"],
            output_selector=["y"],
        )

        assert node._get_title() == "My Iteration"

    def test_get_description_none(self):
        """Test _get_description returns None when not set."""
        node = IterationNode.__new__(IterationNode)
        node._node_data = IterationNodeData(
            title="Test",
            iterator_selector=["a"],
            output_selector=["b"],
        )

        assert node._get_description() is None

    def test_get_description_with_value(self):
        """Test _get_description with value."""
        node = IterationNode.__new__(IterationNode)
        node._node_data = IterationNodeData(
            title="Test",
            desc="This is a description",
            iterator_selector=["a"],
            output_selector=["b"],
        )

        assert node._get_description() == "This is a description"

    def test_node_data_property(self):
        """Test node_data property returns node data."""
        node = IterationNode.__new__(IterationNode)
        node._node_data = IterationNodeData(
            title="Base Test",
            iterator_selector=["x"],
            output_selector=["y"],
        )

        result = node.node_data

        assert result == node._node_data


class TestIterationNodeDataValidation:
    """Test suite for IterationNodeData validation scenarios."""

    def test_valid_iteration_node_data(self):
        """Test valid IterationNodeData creation."""
        data = IterationNodeData(
            title="Valid Iteration",
            iterator_selector=["start", "items"],
            output_selector=["end", "result"],
        )

        assert data.title == "Valid Iteration"

    def test_iteration_node_data_with_all_error_modes(self):
        """Test IterationNodeData with all error handle modes."""
        modes = [
            ErrorHandleMode.TERMINATED,
            ErrorHandleMode.CONTINUE_ON_ERROR,
            ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT,
        ]

        for mode in modes:
            data = IterationNodeData(
                title=f"Test {mode}",
                iterator_selector=["a"],
                output_selector=["b"],
                error_handle_mode=mode,
            )
            assert data.error_handle_mode == mode

    def test_iteration_node_data_parallel_configuration(self):
        """Test IterationNodeData parallel configuration combinations."""
        configs = [
            (False, 10),
            (True, 1),
            (True, 5),
            (True, 20),
            (True, 100),
        ]

        for is_parallel, parallel_nums in configs:
            data = IterationNodeData(
                title="Parallel Test",
                iterator_selector=["x"],
                output_selector=["y"],
                is_parallel=is_parallel,
                parallel_nums=parallel_nums,
            )
            assert data.is_parallel == is_parallel
            assert data.parallel_nums == parallel_nums

    def test_iteration_node_data_flatten_output_options(self):
        """Test IterationNodeData flatten_output options."""
        data_flatten = IterationNodeData(
            title="Flatten True",
            iterator_selector=["a"],
            output_selector=["b"],
            flatten_output=True,
        )

        data_no_flatten = IterationNodeData(
            title="Flatten False",
            iterator_selector=["a"],
            output_selector=["b"],
            flatten_output=False,
        )

        assert data_flatten.flatten_output is True
        assert data_no_flatten.flatten_output is False

    def test_iteration_node_data_complex_selectors(self):
        """Test IterationNodeData with complex selectors."""
        data = IterationNodeData(
            title="Complex",
            iterator_selector=["node1", "output", "data", "items", "list"],
            output_selector=["iteration", "result", "value", "final"],
        )

        assert len(data.iterator_selector) == 5
        assert len(data.output_selector) == 4

    def test_iteration_node_data_single_element_selectors(self):
        """Test IterationNodeData with single element selectors."""
        data = IterationNodeData(
            title="Single",
            iterator_selector=["items"],
            output_selector=["result"],
        )

        assert len(data.iterator_selector) == 1
        assert len(data.output_selector) == 1


class TestIterationNodeErrorStrategies:
    """Test suite for IterationNode error strategies."""

    def test_get_error_strategy_default(self):
        """Test _get_error_strategy with default value."""
        node = IterationNode.__new__(IterationNode)
        node._node_data = IterationNodeData(
            title="Test",
            iterator_selector=["a"],
            output_selector=["b"],
        )

        result = node._get_error_strategy()

        assert result is None or result == node._node_data.error_strategy

    def test_get_retry_config(self):
        """Test _get_retry_config method."""
        node = IterationNode.__new__(IterationNode)
        node._node_data = IterationNodeData(
            title="Test",
            iterator_selector=["a"],
            output_selector=["b"],
        )

        result = node._get_retry_config()

        assert result is not None

    def test_get_default_value_dict(self):
        """Test _get_default_value_dict method."""
        node = IterationNode.__new__(IterationNode)
        node._node_data = IterationNodeData(
            title="Test",
            iterator_selector=["a"],
            output_selector=["b"],
        )

        result = node._get_default_value_dict()

        assert isinstance(result, dict)
