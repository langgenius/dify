from __future__ import annotations

from collections.abc import Mapping, Sequence
from copy import deepcopy

from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.variables.segments import Segment

from .runtime_state import RuntimeState
from .runtime_state_protocol import ReadOnlyVariablePool
from .variable_pool import VariablePool


class ReadOnlyVariablePoolWrapper(ReadOnlyVariablePool):
    """Provide defensive, read-only access to ``VariablePool``."""

    def __init__(self, variable_pool: VariablePool) -> None:
        self._variable_pool = variable_pool

    def get(self, selector: Sequence[str], /) -> Segment | None:
        """Return a copy of a variable value if present."""
        value = self._variable_pool.get(selector)
        return deepcopy(value) if value is not None else None

    def get_by_prefix(self, prefix: str, /) -> Mapping[str, object]:
        """Return a copy of all variables stored under the given prefix."""
        return self._variable_pool.get_by_prefix(prefix)


class ReadOnlyRuntimeStateWrapper:
    """Expose a defensive, read-only view of ``RuntimeState``."""

    def __init__(self, state: RuntimeState) -> None:
        self._state = state
        self._variable_pool_wrapper = ReadOnlyVariablePoolWrapper(state.variable_pool)

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
    def outputs(self) -> dict[str, object]:
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

    def get_output(self, key: str, default: object = None) -> object:
        return self._state.get_output(key, default)

    def dumps(self) -> str:
        """Serialize quiescent state, enforcing the runtime's snapshot guard."""
        return self._state.dumps()
