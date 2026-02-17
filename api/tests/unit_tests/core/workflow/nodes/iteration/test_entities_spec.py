from core.workflow.nodes.iteration.entities import (
    ErrorHandleMode,
    IterationNodeData,
    IterationStartNodeData,
    IterationState,
)


class TestErrorHandleMode:
    """Test suite for ErrorHandleMode enum."""

    def test_terminated_value(self):
        """Test TERMINATED enum value."""
        assert ErrorHandleMode.TERMINATED == "terminated"
        assert ErrorHandleMode.TERMINATED.value == "terminated"

    def test_continue_on_error_value(self):
        """Test CONTINUE_ON_ERROR enum value."""
        assert ErrorHandleMode.CONTINUE_ON_ERROR == "continue-on-error"
        assert ErrorHandleMode.CONTINUE_ON_ERROR.value == "continue-on-error"

    def test_remove_abnormal_output_value(self):
        """Test REMOVE_ABNORMAL_OUTPUT enum value."""
        assert ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT == "remove-abnormal-output"
        assert ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT.value == "remove-abnormal-output"

    def test_error_handle_mode_is_str_enum(self):
        """Test ErrorHandleMode is a string enum."""
        assert isinstance(ErrorHandleMode.TERMINATED, str)
        assert isinstance(ErrorHandleMode.CONTINUE_ON_ERROR, str)
        assert isinstance(ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT, str)

    def test_error_handle_mode_comparison(self):
        """Test ErrorHandleMode can be compared with strings."""
        assert ErrorHandleMode.TERMINATED == "terminated"
        assert ErrorHandleMode.CONTINUE_ON_ERROR == "continue-on-error"

    def test_all_error_handle_modes(self):
        """Test all ErrorHandleMode values are accessible."""
        modes = list(ErrorHandleMode)

        assert len(modes) == 3
        assert ErrorHandleMode.TERMINATED in modes
        assert ErrorHandleMode.CONTINUE_ON_ERROR in modes
        assert ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT in modes


class TestIterationNodeData:
    """Test suite for IterationNodeData model."""

    def test_iteration_node_data_basic(self):
        """Test IterationNodeData with basic configuration."""
        data = IterationNodeData(
            title="Test Iteration",
            iterator_selector=["node1", "output"],
            output_selector=["iteration", "result"],
        )

        assert data.title == "Test Iteration"
        assert data.iterator_selector == ["node1", "output"]
        assert data.output_selector == ["iteration", "result"]

    def test_iteration_node_data_default_values(self):
        """Test IterationNodeData default values."""
        data = IterationNodeData(
            title="Default Test",
            iterator_selector=["start", "items"],
            output_selector=["iter", "out"],
        )

        assert data.parent_loop_id is None
        assert data.is_parallel is False
        assert data.parallel_nums == 10
        assert data.error_handle_mode == ErrorHandleMode.TERMINATED
        assert data.flatten_output is True

    def test_iteration_node_data_parallel_mode(self):
        """Test IterationNodeData with parallel mode enabled."""
        data = IterationNodeData(
            title="Parallel Iteration",
            iterator_selector=["node", "list"],
            output_selector=["iter", "output"],
            is_parallel=True,
            parallel_nums=5,
        )

        assert data.is_parallel is True
        assert data.parallel_nums == 5

    def test_iteration_node_data_custom_parallel_nums(self):
        """Test IterationNodeData with custom parallel numbers."""
        data = IterationNodeData(
            title="Custom Parallel",
            iterator_selector=["a", "b"],
            output_selector=["c", "d"],
            parallel_nums=20,
        )

        assert data.parallel_nums == 20

    def test_iteration_node_data_continue_on_error(self):
        """Test IterationNodeData with continue on error mode."""
        data = IterationNodeData(
            title="Continue Error",
            iterator_selector=["x", "y"],
            output_selector=["z", "w"],
            error_handle_mode=ErrorHandleMode.CONTINUE_ON_ERROR,
        )

        assert data.error_handle_mode == ErrorHandleMode.CONTINUE_ON_ERROR

    def test_iteration_node_data_remove_abnormal_output(self):
        """Test IterationNodeData with remove abnormal output mode."""
        data = IterationNodeData(
            title="Remove Abnormal",
            iterator_selector=["input", "array"],
            output_selector=["output", "result"],
            error_handle_mode=ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT,
        )

        assert data.error_handle_mode == ErrorHandleMode.REMOVE_ABNORMAL_OUTPUT

    def test_iteration_node_data_flatten_output_disabled(self):
        """Test IterationNodeData with flatten output disabled."""
        data = IterationNodeData(
            title="No Flatten",
            iterator_selector=["a"],
            output_selector=["b"],
            flatten_output=False,
        )

        assert data.flatten_output is False

    def test_iteration_node_data_with_parent_loop_id(self):
        """Test IterationNodeData with parent loop ID."""
        data = IterationNodeData(
            title="Nested Loop",
            iterator_selector=["parent", "items"],
            output_selector=["child", "output"],
            parent_loop_id="parent_loop_123",
        )

        assert data.parent_loop_id == "parent_loop_123"

    def test_iteration_node_data_complex_selectors(self):
        """Test IterationNodeData with complex selectors."""
        data = IterationNodeData(
            title="Complex Selectors",
            iterator_selector=["node1", "output", "data", "items"],
            output_selector=["iteration", "result", "value"],
        )

        assert len(data.iterator_selector) == 4
        assert len(data.output_selector) == 3

    def test_iteration_node_data_all_options(self):
        """Test IterationNodeData with all options configured."""
        data = IterationNodeData(
            title="Full Config",
            iterator_selector=["start", "list"],
            output_selector=["end", "result"],
            parent_loop_id="outer_loop",
            is_parallel=True,
            parallel_nums=15,
            error_handle_mode=ErrorHandleMode.CONTINUE_ON_ERROR,
            flatten_output=False,
        )

        assert data.title == "Full Config"
        assert data.parent_loop_id == "outer_loop"
        assert data.is_parallel is True
        assert data.parallel_nums == 15
        assert data.error_handle_mode == ErrorHandleMode.CONTINUE_ON_ERROR
        assert data.flatten_output is False


class TestIterationStartNodeData:
    """Test suite for IterationStartNodeData model."""

    def test_iteration_start_node_data_basic(self):
        """Test IterationStartNodeData basic creation."""
        data = IterationStartNodeData(title="Iteration Start")

        assert data.title == "Iteration Start"

    def test_iteration_start_node_data_with_description(self):
        """Test IterationStartNodeData with description."""
        data = IterationStartNodeData(
            title="Start Node",
            desc="This is the start of iteration",
        )

        assert data.title == "Start Node"
        assert data.desc == "This is the start of iteration"


class TestIterationState:
    """Test suite for IterationState model."""

    def create_state(self, **kwargs):
        return IterationState(
            iteration_node_id="iter_1",
            index=0,
            inputs={},
            metadata=IterationState.MetaData(iterator_length=0),
            **kwargs,
        )

    def test_iteration_state_default_values(self):
        state = self.create_state()
        assert state.outputs == []
        assert state.current_output is None

    def test_iteration_state_with_outputs(self):
        state = self.create_state(outputs=["result1", "result2", "result3"])
        assert len(state.outputs) == 3
        assert state.outputs[2] == "result3"

    def test_iteration_state_with_current_output(self):
        state = self.create_state(current_output="current_value")
        assert state.current_output == "current_value"

    def test_iteration_state_get_last_output_with_outputs(self):
        state = self.create_state(outputs=["first", "second", "last"])
        assert state.get_last_output() == "last"

    def test_iteration_state_get_last_output_empty(self):
        state = self.create_state(outputs=[])
        assert state.get_last_output() is None

    def test_iteration_state_get_last_output_single(self):
        state = self.create_state(outputs=["only_one"])
        assert state.get_last_output() == "only_one"

    def test_iteration_state_get_current_output(self):
        state = self.create_state(current_output={"key": "value"})
        assert state.get_current_output() == {"key": "value"}

    def test_iteration_state_get_current_output_none(self):
        state = self.create_state()
        assert state.get_current_output() is None

    def test_iteration_state_with_complex_outputs(self):
        state = self.create_state(
            outputs=[
                {"id": 1},
                [1, 2, 3],
                "string_output",
            ]
        )
        assert len(state.outputs) == 3

    def test_iteration_state_with_none_outputs(self):
        state = self.create_state(outputs=["value1", None, "value3"])
        assert state.outputs[1] is None

    def test_iteration_state_get_last_output_with_none(self):
        state = self.create_state(outputs=["first", None])
        assert state.get_last_output() is None

    def test_iteration_state_metadata_class(self):
        metadata = IterationState.MetaData(iterator_length=10)
        assert metadata.iterator_length == 10

    def test_iteration_state_outputs_modification(self):
        state = self.create_state(outputs=[])
        state.outputs.append("new_output")
        assert state.get_last_output() == "new_output"

    def test_iteration_state_current_output_update(self):
        state = self.create_state()
        state.current_output = "updated_value"
        assert state.get_current_output() == "updated_value"

    def test_iteration_state_with_numeric_outputs(self):
        state = self.create_state(outputs=[1, 2, 3])
        assert state.get_last_output() == 3

    def test_iteration_state_with_boolean_outputs(self):
        state = self.create_state(outputs=[True, False, True])
        assert state.get_last_output() is True
