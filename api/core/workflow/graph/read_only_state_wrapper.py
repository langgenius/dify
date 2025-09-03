from copy import deepcopy
from typing import Any

from core.model_runtime.entities.llm_entities import LLMUsage
from core.workflow.entities.graph_runtime_state import GraphRuntimeState
from core.workflow.entities.variable_pool import VariablePool


class ReadOnlyVariablePoolWrapper:
    """Wrapper that provides read-only access to VariablePool."""

    def __init__(self, variable_pool: VariablePool):
        self._variable_pool = variable_pool

    def get(self, node_id: str, variable_key: str) -> Any:
        """Get a variable value (returns a defensive copy)."""
        value = self._variable_pool.get(node_id, variable_key)
        return deepcopy(value) if value is not None else None

    def get_all_by_node(self, node_id: str) -> dict[str, Any]:
        """Get all variables for a node (returns defensive copies)."""
        variables = {}
        if node_id in self._variable_pool.variable_dictionary:
            for key, var in self._variable_pool.variable_dictionary[node_id].items():
                # FIXME(-LAN-): Handle the actual Variable object structure
                value = var.value if hasattr(var, "value") else var
                variables[key] = deepcopy(value)
        return variables


class ReadOnlyGraphRuntimeStateWrapper:
    """
    Wrapper that provides read-only access to GraphRuntimeState.

    This wrapper ensures that layers can observe the state without
    modifying it. All returned values are defensive copies.
    """

    def __init__(self, state: GraphRuntimeState):
        self._state = state
        self._variable_pool_wrapper = ReadOnlyVariablePoolWrapper(state.variable_pool)

    @property
    def variable_pool(self) -> ReadOnlyVariablePoolWrapper:
        """Get read-only access to the variable pool."""
        return self._variable_pool_wrapper

    @property
    def start_at(self) -> float:
        """Get the start time (read-only)."""
        return self._state.start_at

    @property
    def total_tokens(self) -> int:
        """Get the total tokens count (read-only)."""
        return self._state.total_tokens

    @property
    def llm_usage(self) -> LLMUsage:
        """Get a copy of LLM usage info (read-only)."""
        # Return a copy to prevent modification
        return self._state.llm_usage.model_copy()

    @property
    def outputs(self) -> dict[str, Any]:
        """Get a defensive copy of outputs (read-only)."""
        return deepcopy(self._state.outputs)

    @property
    def node_run_steps(self) -> int:
        """Get the node run steps count (read-only)."""
        return self._state.node_run_steps

    def get_output(self, key: str, default: Any = None) -> Any:
        """Get a single output value (returns a copy)."""
        return self._state.get_output(key, default)
