from time import time

import pytest

from core.workflow.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.entities.variable_pool import VariablePool


class TestGraphRuntimeState:
    def test_property_getters_and_setters(self):
        # FIXME(-LAN-): Mock VariablePool if needed
        variable_pool = VariablePool()
        start_time = time()

        state = GraphRuntimeState(variable_pool=variable_pool, start_at=start_time)

        # Test variable_pool property (read-only)
        assert state.variable_pool == variable_pool

        # Test start_at property
        assert state.start_at == start_time
        new_time = time() + 100
        state.start_at = new_time
        assert state.start_at == new_time

        # Test total_tokens property
        assert state.total_tokens == 0
        state.total_tokens = 100
        assert state.total_tokens == 100

        # Test node_run_steps property
        assert state.node_run_steps == 0
        state.node_run_steps = 5
        assert state.node_run_steps == 5

    def test_outputs_immutability(self):
        variable_pool = VariablePool()
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())

        # Test that getting outputs returns a copy
        outputs1 = state.outputs
        outputs2 = state.outputs
        assert outputs1 == outputs2
        assert outputs1 is not outputs2  # Different objects

        # Test that modifying retrieved outputs doesn't affect internal state
        outputs = state.outputs
        outputs["test"] = "value"
        assert "test" not in state.outputs

        # Test set_output method
        state.set_output("key1", "value1")
        assert state.get_output("key1") == "value1"

        # Test update_outputs method
        state.update_outputs({"key2": "value2", "key3": "value3"})
        assert state.get_output("key2") == "value2"
        assert state.get_output("key3") == "value3"

    def test_llm_usage_immutability(self):
        variable_pool = VariablePool()
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())

        # Test that getting llm_usage returns a copy
        usage1 = state.llm_usage
        usage2 = state.llm_usage
        assert usage1 is not usage2  # Different objects

    def test_type_validation(self):
        variable_pool = VariablePool()
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())

        # Test total_tokens validation
        with pytest.raises(ValueError):
            state.total_tokens = -1

        # Test node_run_steps validation
        with pytest.raises(ValueError):
            state.node_run_steps = -1

    def test_helper_methods(self):
        variable_pool = VariablePool()
        state = GraphRuntimeState(variable_pool=variable_pool, start_at=time())

        # Test increment_node_run_steps
        initial_steps = state.node_run_steps
        state.increment_node_run_steps()
        assert state.node_run_steps == initial_steps + 1

        # Test add_tokens
        initial_tokens = state.total_tokens
        state.add_tokens(50)
        assert state.total_tokens == initial_tokens + 50

        # Test add_tokens validation
        with pytest.raises(ValueError):
            state.add_tokens(-1)
