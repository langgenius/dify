from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy
from typing import Any

from core.model_runtime.entities.llm_entities import LLMUsage
from core.variables.segments import Segment
from core.workflow.system_variable import SystemVariableReadOnlyView

from .graph_runtime_state import GraphRuntimeState
from .variable_pool import VariablePool


class ReadOnlyVariablePoolWrapper:
    """Provide defensive, read-only access to ``VariablePool``."""

    def __init__(self, variable_pool: VariablePool) -> None:
        self._variable_pool = variable_pool

    def get(self, selector: Sequence[str], /) -> Segment | None:
        """Return a copy of a variable value if present."""
        value = self._variable_pool.get(selector)
        return deepcopy(value) if value is not None else None

    def get_all_by_node(self, node_id: str) -> Mapping[str, object]:
        """Return a copy of all variables for the specified node."""
        variables: dict[str, object] = {}
        if node_id in self._variable_pool.variable_dictionary:
            for key, variable in self._variable_pool.variable_dictionary[node_id].items():
                variables[key] = deepcopy(variable.value)
        return variables

    def get_by_prefix(self, prefix: str) -> Mapping[str, object]:
        """Return a copy of all variables stored under the given prefix."""
        return self._variable_pool.get_by_prefix(prefix)


class ReadOnlyGraphRuntimeStateWrapper:
    """Expose a defensive, read-only view of ``GraphRuntimeState``."""

    def __init__(self, state: GraphRuntimeState) -> None:
        self._state = state
        self._variable_pool_wrapper = ReadOnlyVariablePoolWrapper(state.variable_pool)

    @property
    def system_variable(self) -> SystemVariableReadOnlyView:
        return self._state.variable_pool.system_variables.as_view()

    @property
    def variable_pool(self) -> ReadOnlyVariablePoolWrapper:
        return self._variable_pool_wrapper

    @property
    def start_at(self) -> float:
        return self._state.start_at

    @property
    def total_tokens(self) -> int:
        return self._state.total_tokens

    @property
    def llm_usage(self) -> LLMUsage:
        return self._state.llm_usage.model_copy()

    @property
    def outputs(self) -> dict[str, Any]:
        return deepcopy(self._state.outputs)

    @property
    def node_run_steps(self) -> int:
        return self._state.node_run_steps

    @property
    def ready_queue_size(self) -> int:
        return self._state.ready_queue.qsize()

    @property
    def exceptions_count(self) -> int:
        return self._state.graph_execution.exceptions_count

    def get_output(self, key: str, default: Any = None) -> Any:
        return self._state.get_output(key, default)

    def dumps(self) -> str:
        """Serialize the underlying runtime state for external persistence."""
        return self._state.dumps()
